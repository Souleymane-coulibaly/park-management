import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { normalizeSearch, studentIdentityKey } from '@ocall/shared';
import {
  PRINT_GATEWAY,
  type PrintActor,
  type PrintGateway,
  type PrintPersonExport,
} from '../../common/integration/print-gateway';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
  privateKey,
} from '../../common/storage/storage-provider';
import type { SchoolContext } from './school-access';
import { SchoolPrismaService } from './school-prisma.service';
import { SchoolStaffService } from './school-staff.service';
import { SchoolStudentsService } from './school-students.service';
import { SchoolService } from './school.service';

export type ImportOutcome =
  | { personId: string; status: 'CREATED' | 'LINKED'; targetId: string }
  | { personId: string; status: 'SKIPPED'; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUnique = (e: unknown) => (e as { code?: string })?.code === 'P2002';

/**
 * Activation d'Ocall School après un usage autonome d'Ocall Print (décision du 19/11/2026) : les fiches
 * et photos Print sont reprises dans School SANS double saisie et SANS doublon :
 * - une fiche School déjà liée à la fiche Print (`printPersonId`, unique) est retrouvée ;
 * - sinon un élève existant (mêmes nom, prénom et date de naissance) ou un membre du personnel existant
 *   (même nom dans l'établissement) est rattaché ;
 * - sinon la fiche est créée, avec sa photo.
 * Les cartes passent ensuite à School, numéro et QR conservés : rien n'est à réimprimer. Une reprise
 * interrompue se relance sans effet de bord.
 */
@Injectable()
export class SchoolPrintImportService {
  constructor(
    private readonly db: SchoolPrismaService,
    private readonly school: SchoolService,
    private readonly students: SchoolStudentsService,
    private readonly staff: SchoolStaffService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Optional() @Inject(PRINT_GATEWAY) private readonly print?: PrintGateway,
  ) {}

  /** Les fiches autonomes couvrent toute l'organisation : reprise réservée à qui voit tous les établissements. */
  private assertGroupScope(ctx: SchoolContext) {
    if (ctx.schoolIds !== null)
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'La reprise des fiches Ocall Print est réservée à la direction du groupe.',
      });
  }

  private gw(): PrintGateway {
    if (!this.print?.enabled())
      throw new ServiceUnavailableException({
        code: 'PRINT_DISABLED',
        message: 'Ocall Print n’est pas disponible pour le moment.',
      });
    return this.print;
  }

  private actor(ctx: SchoolContext): PrintActor {
    return { organizationId: ctx.organizationId, userId: ctx.userId };
  }

  /** Fiches Print à reprendre, avec la fiche School déjà correspondante le cas échéant. */
  async candidates(ctx: SchoolContext) {
    this.assertGroupScope(ctx);
    const persons = await this.gw().transferablePersons(this.actor(ctx));
    return Promise.all(persons.map(async (p) => ({ ...p, match: await this.match(ctx, p, null) })));
  }

  /** Fiche School correspondante : déjà liée, ou même personne (sans doublon). */
  private async match(ctx: SchoolContext, p: PrintPersonExport, schoolId: string | null) {
    const org = ctx.organizationId;
    if (p.kind === 'STUDENT') {
      const linked = await this.db.schoolStudent.findFirst({
        where: { organizationId: org, printPersonId: p.id },
        select: { id: true, schoolId: true },
      });
      if (linked) return { id: linked.id, schoolId: linked.schoolId, linked: true };
      if (!p.birthDate) return null;
      const twin = await this.db.schoolStudent.findFirst({
        where: {
          organizationId: org,
          identityKey: studentIdentityKey(p, p.birthDate),
          printPersonId: null,
          ...(schoolId ? { schoolId } : {}),
        },
        select: { id: true, schoolId: true },
      });
      return twin ? { id: twin.id, schoolId: twin.schoolId, linked: false } : null;
    }
    const linked = await this.db.schoolStaff.findFirst({
      where: { organizationId: org, printPersonId: p.id },
      select: { id: true, schoolId: true },
    });
    if (linked) return { id: linked.id, schoolId: linked.schoolId, linked: true };
    const name = normalizeSearch(`${p.lastName} ${p.firstName}`);
    const twin = (
      await this.db.schoolStaff.findMany({
        where: { organizationId: org, printPersonId: null, ...(schoolId ? { schoolId } : {}) },
        select: { id: true, schoolId: true, lastName: true, firstName: true },
      })
    ).find((s) => normalizeSearch(`${s.lastName} ${s.firstName}`) === name);
    return twin ? { id: twin.id, schoolId: twin.schoolId, linked: false } : null;
  }

  async import(ctx: SchoolContext, dto: { schoolId: string; personIds: string[] }) {
    this.assertGroupScope(ctx);
    await this.school.assertSchool(ctx, dto.schoolId);
    if (
      !Array.isArray(dto.personIds) ||
      dto.personIds.length === 0 ||
      !dto.personIds.every((i) => UUID.test(i))
    )
      throw new BadRequestException({
        code: 'IMPORT_INVALID',
        message: 'Aucune fiche sélectionnée.',
      });
    const gw = this.gw();
    const available = new Map(
      (await gw.transferablePersons(this.actor(ctx))).map((p) => [p.id, p]),
    );
    const outcomes: ImportOutcome[] = [];
    for (const personId of [...new Set(dto.personIds)]) {
      const p = available.get(personId);
      if (!p) {
        outcomes.push({
          personId,
          status: 'SKIPPED',
          reason: 'Fiche introuvable ou déjà reprise.',
        });
        continue;
      }
      try {
        outcomes.push(await this.importOne(ctx, gw, p, dto.schoolId));
      } catch (error) {
        const reason =
          error instanceof ConflictException || error instanceof BadRequestException
            ? ((error.getResponse() as { message?: string }).message ?? 'Refusée.')
            : null;
        if (!reason) throw error;
        outcomes.push({ personId, status: 'SKIPPED', reason });
      }
    }
    await this.school.log(ctx, 'school.print_import', 'SchoolStudent', null, {
      schoolId: dto.schoolId,
      created: outcomes.filter((o) => o.status === 'CREATED').length,
      linked: outcomes.filter((o) => o.status === 'LINKED').length,
      skipped: outcomes.filter((o) => o.status === 'SKIPPED').length,
    });
    return outcomes;
  }

  private async importOne(
    ctx: SchoolContext,
    gw: PrintGateway,
    p: PrintPersonExport,
    schoolId: string,
  ): Promise<ImportOutcome> {
    const existing = await this.match(ctx, p, schoolId);
    let targetId: string;
    let created = false;
    if (existing) {
      targetId = existing.id;
      if (!existing.linked) await this.link(ctx, p, existing.id);
    } else if (p.kind === 'STUDENT') {
      if (!p.birthDate)
        return {
          personId: p.id,
          status: 'SKIPPED',
          reason: 'Date de naissance manquante : complétez la fiche dans Ocall Print.',
        };
      targetId = await this.createStudent(ctx, gw, p, schoolId);
      created = true;
    } else {
      targetId = await this.createStaff(ctx, gw, p, schoolId);
      created = true;
    }
    await gw.completeTransfer(this.actor(ctx), p.id, {
      sourceApp: 'OCALL_SCHOOL',
      holderId: targetId,
      scopeId: existing?.schoolId ?? schoolId,
    });
    return { personId: p.id, status: created ? 'CREATED' : 'LINKED', targetId };
  }

  private async link(ctx: SchoolContext, p: PrintPersonExport, targetId: string) {
    const where = { id: targetId, organizationId: ctx.organizationId, printPersonId: null };
    if (p.kind === 'STUDENT')
      await this.db.schoolStudent.updateMany({ where, data: { printPersonId: p.id } });
    else await this.db.schoolStaff.updateMany({ where, data: { printPersonId: p.id } });
  }

  private async createStudent(
    ctx: SchoolContext,
    gw: PrintGateway,
    p: PrintPersonExport,
    schoolId: string,
  ): Promise<string> {
    const photo = p.hasPhoto ? await gw.personPhoto(this.actor(ctx), p.id) : null;
    const docId = randomUUID();
    const key = photo ? privateKey(ctx.organizationId, schoolId, docId, 'jpg') : null;
    if (photo && key) await this.storage.put(key, photo, 'image/jpeg');
    try {
      const student = await this.db.$transaction(async (tx) => {
        await this.school.guardSchools(tx, [schoolId]);
        const st = await this.students.createInTx(tx, ctx, {
          schoolId,
          lastName: p.lastName,
          firstName: p.firstName,
          lastNameAr: p.lastNameAr,
          firstNameAr: p.firstNameAr,
          birthDate: p.birthDate!,
          matriculeYearNumber: new Date().getUTCFullYear(),
        });
        await tx.schoolStudent.update({ where: { id: st.id }, data: { printPersonId: p.id } });
        if (photo && key) {
          await tx.schoolStudentDocument.create({
            data: {
              id: docId,
              organizationId: ctx.organizationId,
              studentId: st.id,
              category: 'PHOTO',
              displayName: 'Photo (reprise Ocall Print).jpg',
              mimeType: 'image/jpeg',
              bytes: photo.length,
              sha256: createHash('sha256').update(photo).digest('hex'),
              storageKey: key,
              createdByUserId: ctx.userId,
            },
          });
        }
        await this.students.event(tx, ctx, st.id, 'IMPORTED_FROM_PRINT', { printPersonId: p.id });
        return st;
      });
      return student.id;
    } catch (error) {
      if (key) await this.storage.delete(key).catch(() => undefined);
      // Reprise simultanée de la même fiche : la fiche créée par l'autre envoi est retrouvée.
      if (isUnique(error)) {
        const again = await this.match(ctx, p, null);
        if (again) return again.id;
      }
      throw error;
    }
  }

  private async createStaff(
    ctx: SchoolContext,
    gw: PrintGateway,
    p: PrintPersonExport,
    schoolId: string,
  ): Promise<string> {
    let created;
    try {
      created = await this.staff.create(
        ctx,
        {
          schoolId,
          lastName: p.lastName,
          firstName: p.firstName,
          lastNameAr: p.lastNameAr,
          firstNameAr: p.firstNameAr,
          category: 'OTHER',
          jobTitle: p.jobTitle ?? p.groupLabel,
        },
        p.id,
      );
    } catch (error) {
      const again = await this.match(ctx, p, null);
      if (again) return again.id;
      throw error;
    }
    if (p.hasPhoto) {
      const photo = await gw.personPhoto(this.actor(ctx), p.id);
      if (photo) await this.staff.setPhoto(ctx, created.id, photo);
    }
    return created.id;
  }
}

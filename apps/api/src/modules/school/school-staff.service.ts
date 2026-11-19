import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { Prisma } from '@ocall/school-database';
import {
  hasControlChars,
  normalizeSearch,
  SCHOOL_ROLE_LABELS,
  SCHOOL_STAFF_CATEGORIES,
  SCHOOL_STAFF_LIMITS,
  type SchoolRole,
  type SchoolStaffCategory,
  schoolStaffNumber,
} from '@ocall/shared';
import { isImageRefusal, reencodeImage } from '../../common/images/image-reencode';
import { PRINT_GATEWAY, type PrintGateway } from '../../common/integration/print-gateway';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
  privateKey,
} from '../../common/storage/storage-provider';
import type { SchoolContext } from './school-access';
import { SchoolPrismaService } from './school-prisma.service';
import { SchoolService } from './school.service';

type Tx = Prisma.TransactionClient;
type StaffRow = Prisma.SchoolStaffGetPayload<{
  include: { member: { select: { role: true; isActive: true } } };
}>;

export interface StaffInput {
  schoolId?: string;
  lastName?: string;
  firstName?: string;
  lastNameAr?: string | null;
  firstNameAr?: string | null;
  category?: SchoolStaffCategory;
  jobTitle?: string | null;
  phone?: string | null;
  memberId?: string | null;
}

const NOT_FOUND = { code: 'NOT_FOUND', message: 'Fiche introuvable.' };
/** Photo d'un badge : imprimée à 300 ppp, au moins ~200 × 240 pixels. */
const PHOTO_MIN = { width: 200, height: 240 };

const ROLE_CATEGORY: Record<SchoolRole, SchoolStaffCategory> = {
  GROUP_DIRECTOR: 'ADMINISTRATION',
  SCHOOL_DIRECTOR: 'ADMINISTRATION',
  SECRETARY: 'ADMINISTRATION',
  TEACHER: 'TEACHING',
  SUPERVISOR: 'ADMINISTRATION',
  ACCOUNTANT: 'ADMINISTRATION',
};

function text(value: unknown, label: string, max: number, required: boolean): string | null {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
    if (required)
      throw new BadRequestException({ code: 'STAFF_INVALID', message: `${label} obligatoire.` });
    return null;
  }
  if (typeof value !== 'string' || value.trim().length > max || hasControlChars(value))
    throw new BadRequestException({
      code: 'STAFF_INVALID',
      message: `${label} : ${max} caractères au plus.`,
    });
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Fiches du personnel d'Ocall School, avec ou sans compte : enseignants, administration, gardiens,
 * cuisine, entretien, transport… Elles portent la photo et le numéro imprimés sur le badge (Ocall Print).
 * Lecture et écriture limitées aux établissements du périmètre de l'utilisateur.
 */
@Injectable()
export class SchoolStaffService {
  private readonly logger = new Logger('SchoolStaff');

  constructor(
    private readonly db: SchoolPrismaService,
    private readonly school: SchoolService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Optional() @Inject(PRINT_GATEWAY) private readonly print?: PrintGateway,
  ) {}

  view(s: StaffRow) {
    return {
      id: s.id,
      schoolId: s.schoolId,
      memberId: s.memberId,
      memberRole: s.member?.role ?? null,
      lastName: s.lastName,
      firstName: s.firstName,
      lastNameAr: s.lastNameAr,
      firstNameAr: s.firstNameAr,
      category: s.category,
      jobTitle: s.jobTitle,
      staffNumber: s.staffNumber,
      phone: s.phone,
      hasPhoto: s.photoKey !== null,
      isActive: s.isActive,
      importedFromPrint: s.printPersonId !== null,
      createdAt: s.createdAt.toISOString(),
    };
  }

  private scope(ctx: SchoolContext) {
    return {
      organizationId: ctx.organizationId,
      ...(ctx.schoolIds ? { schoolId: { in: ctx.schoolIds } } : {}),
    };
  }

  private fields(input: StaffInput, partial: boolean) {
    const L = SCHOOL_STAFF_LIMITS;
    const out: Record<string, unknown> = {};
    const set = (key: keyof StaffInput, label: string, max: number, required: boolean) => {
      if (partial && input[key] === undefined) return;
      out[key] = text(input[key], label, max, required);
    };
    set('lastName', 'Nom', L.nameMax, true);
    set('firstName', 'Prénom', L.nameMax, true);
    set('lastNameAr', 'Nom en arabe', L.nameMax, false);
    set('firstNameAr', 'Prénom en arabe', L.nameMax, false);
    set('jobTitle', 'Fonction', L.jobMax, false);
    set('phone', 'Téléphone', L.phoneMax, false);
    if (!partial || input.category !== undefined) {
      if (!SCHOOL_STAFF_CATEGORIES.includes(input.category as SchoolStaffCategory))
        throw new BadRequestException({ code: 'STAFF_INVALID', message: 'Catégorie invalide.' });
      out.category = input.category;
    }
    return out;
  }

  private search(s: Record<string, unknown>) {
    return normalizeSearch(
      [s.lastName, s.firstName, s.lastNameAr, s.firstNameAr, s.jobTitle, s.staffNumber]
        .filter(Boolean)
        .join(' '),
    );
  }

  /** Numéro de personnel suivant, compteur atomique propre au client (jamais MAX + 1). */
  async nextNumber(tx: Tx, organizationId: string): Promise<string> {
    const [row] = await tx.$queryRaw<{ value: number }[]>`
      INSERT INTO "SchoolNumberCounter" ("organizationId", "counterKey", "value")
      VALUES (${organizationId}::uuid, 'STAFF', 1)
      ON CONFLICT ("organizationId", "counterKey")
      DO UPDATE SET "value" = "SchoolNumberCounter"."value" + 1
      RETURNING "value"`;
    return schoolStaffNumber(row!.value);
  }

  async list(
    ctx: SchoolContext,
    filter: { schoolId?: string; q?: string; category?: string; active?: string },
  ) {
    const q = filter.q ? normalizeSearch(filter.q) : '';
    const rows = await this.db.schoolStaff.findMany({
      where: {
        // Filtre demandé ET périmètre du membre : le `schoolId` de la requête ne remplace jamais le
        // périmètre (sinon un membre limité à A1 lirait le personnel de A2 avec `?schoolId=A2`).
        AND: [this.scope(ctx), ...(filter.schoolId ? [{ schoolId: filter.schoolId }] : [])],
        ...(SCHOOL_STAFF_CATEGORIES.includes(filter.category as SchoolStaffCategory)
          ? { category: filter.category as SchoolStaffCategory }
          : {}),
        ...(filter.active === 'false' ? { isActive: false } : { isActive: true }),
        ...(q ? { searchText: { contains: q } } : {}),
      },
      include: { member: { select: { role: true, isActive: true } } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 2000,
    });
    return rows.map((r) => this.view(r));
  }

  async find(ctx: SchoolContext, id: string): Promise<StaffRow> {
    const row = await this.db.schoolStaff.findFirst({
      where: { id, ...this.scope(ctx) },
      include: { member: { select: { role: true, isActive: true } } },
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  async get(ctx: SchoolContext, id: string) {
    return this.view(await this.find(ctx, id));
  }

  private async assertMember(tx: Tx, ctx: SchoolContext, memberId: string, schoolId: string) {
    const member = await tx.schoolMember.findFirst({
      where: {
        id: memberId,
        organizationId: ctx.organizationId,
        assignments: { some: { schoolId } },
      },
      select: { id: true },
    });
    if (!member)
      throw new BadRequestException({
        code: 'STAFF_MEMBER_INVALID',
        message: 'Ce compte n’est pas rattaché à cet établissement.',
      });
  }

  private memberTaken() {
    return new ConflictException({
      code: 'STAFF_MEMBER_LINKED',
      message: 'Ce compte a déjà une fiche du personnel.',
    });
  }

  async create(ctx: SchoolContext, input: StaffInput, printPersonId: string | null = null) {
    if (!input.schoolId)
      throw new BadRequestException({
        code: 'STAFF_INVALID',
        message: 'Établissement obligatoire.',
      });
    await this.school.assertSchool(ctx, input.schoolId);
    const data = this.fields(input, false);
    try {
      const created = await this.db.$transaction(async (tx) => {
        await this.school.guardSchools(tx, [input.schoolId!]);
        if (input.memberId) await this.assertMember(tx, ctx, input.memberId, input.schoolId!);
        const staffNumber = await this.nextNumber(tx, ctx.organizationId);
        return tx.schoolStaff.create({
          data: {
            organizationId: ctx.organizationId,
            schoolId: input.schoolId!,
            memberId: input.memberId ?? null,
            ...(data as object),
            lastName: data.lastName as string,
            firstName: data.firstName as string,
            category: data.category as SchoolStaffCategory,
            staffNumber,
            printPersonId,
            searchText: this.search({ ...data, staffNumber }),
            createdByUserId: ctx.userId,
          },
          include: { member: { select: { role: true, isActive: true } } },
        });
      });
      await this.school.log(ctx, 'school.staff_created', 'SchoolStaff', created.id, {
        schoolId: created.schoolId,
        category: created.category,
      });
      return this.view(created);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw this.memberTaken();
      throw error;
    }
  }

  async update(ctx: SchoolContext, id: string, input: StaffInput) {
    const current = await this.find(ctx, id);
    const data = this.fields(input, true);
    try {
      const updated = await this.db.$transaction(async (tx) => {
        await this.school.guardSchools(tx, [current.schoolId]);
        if (input.memberId) await this.assertMember(tx, ctx, input.memberId, current.schoolId);
        return tx.schoolStaff.update({
          where: { id },
          data: {
            ...data,
            ...(input.memberId !== undefined ? { memberId: input.memberId ?? null } : {}),
            searchText: this.search({ ...current, ...data }),
          },
          include: { member: { select: { role: true, isActive: true } } },
        });
      });
      await this.school.log(ctx, 'school.staff_updated', 'SchoolStaff', id, {
        fields: Object.keys(data),
      });
      return this.view(updated);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw this.memberTaken();
      throw error;
    }
  }

  /** Départ ou suspension : la fiche reste (historique), ses badges actifs sont révoqués. */
  async setActive(ctx: SchoolContext, id: string, active: boolean) {
    const current = await this.find(ctx, id);
    await this.db.$transaction(async (tx) => {
      await this.school.guardSchools(tx, [current.schoolId]);
      await tx.schoolStaff.update({ where: { id }, data: { isActive: active } });
    });
    await this.school.log(
      ctx,
      active ? 'school.staff_reactivated' : 'school.staff_deactivated',
      'SchoolStaff',
      id,
      {},
    );
    if (!active) await this.revokeCards(ctx, id, 'Départ ou suspension du membre du personnel');
    return this.get(ctx, id);
  }

  /**
   * Révocation des badges (au mieux) : une panne d'Ocall Print n'empêche pas l'action School ; la lecture
   * d'un badge contrôle de toute façon que la fiche est active.
   */
  async revokeCards(ctx: SchoolContext, id: string, reason: string) {
    if (!this.print?.enabled()) return;
    try {
      await this.print.revokeHolderCards(
        { organizationId: ctx.organizationId, userId: ctx.userId },
        'OCALL_SCHOOL',
        'STAFF',
        id,
        reason,
      );
    } catch (error) {
      this.logger.warn(`Révocation des badges différée : ${(error as Error).name}`);
    }
  }

  async setPhoto(ctx: SchoolContext, id: string, file: Buffer | undefined) {
    const current = await this.find(ctx, id);
    if (!file?.length)
      throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Choisissez un fichier.' });
    const photo = await reencodeImage(file, PHOTO_MIN, 'jpeg', 1200);
    if (isImageRefusal(photo))
      throw new BadRequestException({ code: 'FILE_TYPE_REFUSED', message: photo.message });
    const key = privateKey(ctx.organizationId, current.schoolId, randomUUID(), 'jpg');
    await this.storage.put(key, photo.body, photo.mimeType);
    try {
      await this.db.$transaction(async (tx) => {
        await this.school.guardSchools(tx, [current.schoolId]);
        await tx.schoolStaff.update({
          where: { id },
          data: { photoKey: key, photoSha: photo.sha256 },
        });
      });
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
    if (current.photoKey) await this.storage.delete(current.photoKey).catch(() => undefined);
    await this.school.log(ctx, 'school.staff_photo_updated', 'SchoolStaff', id, {});
    return this.get(ctx, id);
  }

  async photo(ctx: SchoolContext, id: string): Promise<Buffer | null> {
    const row = await this.find(ctx, id);
    return row.photoKey ? this.storage.get(row.photoKey) : null;
  }

  /**
   * Fiches créées depuis l'équipe (comptes School actifs de l'établissement sans fiche) : enseignants et
   * administration n'ont pas à être ressaisis. Sans effet pour un compte qui a déjà sa fiche.
   */
  async importMembers(ctx: SchoolContext, schoolId: string) {
    await this.school.assertSchool(ctx, schoolId);
    const members = await this.db.schoolMember.findMany({
      where: {
        organizationId: ctx.organizationId,
        isActive: true,
        assignments: { some: { schoolId } },
        staff: { none: {} },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        firstNameAr: true,
        lastNameAr: true,
        role: true,
      },
    });
    let created = 0;
    for (const m of members) {
      try {
        await this.create(ctx, {
          schoolId,
          memberId: m.id,
          firstName: m.firstName,
          lastName: m.lastName,
          firstNameAr: m.firstNameAr,
          lastNameAr: m.lastNameAr,
          category: ROLE_CATEGORY[m.role],
          jobTitle: SCHOOL_ROLE_LABELS[m.role],
        });
        created += 1;
      } catch (error) {
        // Fiche créée entre-temps (double clic) : rien à faire.
        if (!(error instanceof ConflictException)) throw error;
      }
    }
    return { created };
  }
}

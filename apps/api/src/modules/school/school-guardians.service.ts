import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@ocall/school-database';
import { normalizeSearch } from '@ocall/shared';
import type { SchoolContext } from './school-access';
import { SchoolPrismaService } from './school-prisma.service';
import type {
  CreateGuardianDto,
  GuardianLinkRightsDto,
  GuardiansQueryDto,
  LinkGuardianDto,
  UpdateGuardianDto,
} from './school-students.dto';
import { SchoolStudentsService } from './school-students.service';
import { SchoolService } from './school.service';

type Tx = Prisma.TransactionClient;

const NOT_FOUND = { code: 'SCHOOL_RESOURCE_NOT_FOUND', message: 'Élément introuvable.' };
const searchText = (g: { lastName: string; firstName: string; phone: string }) =>
  normalizeSearch(`${g.lastName} ${g.firstName} ${g.phone.replace(/\D/g, '')}`);

const VIEW = {
  id: true,
  schoolId: true,
  lastName: true,
  firstName: true,
  phone: true,
  email: true,
  address: true,
} satisfies Prisma.SchoolGuardianSelect;

export interface GuardianView {
  id: string;
  schoolId: string;
  lastName: string;
  firstName: string;
  phone: string;
  email: string | null;
  address: string | null;
}

/** Responsables légaux : plusieurs par élève, plusieurs enfants par responsable, droits propres au lien. */
@Injectable()
export class SchoolGuardiansService {
  constructor(
    private readonly db: SchoolPrismaService,
    private readonly school: SchoolService,
    private readonly students: SchoolStudentsService,
  ) {}

  /** Visible depuis l'établissement qui l'a créé ou depuis celui d'un de ses enfants. */
  private scope(ctx: SchoolContext): Prisma.SchoolGuardianWhereInput {
    return {
      organizationId: ctx.organizationId,
      ...(ctx.schoolIds
        ? {
            OR: [
              // L'établissement d'origine perd l'accès quand ses enfants sont ailleurs.
              { schoolId: { in: ctx.schoolIds }, links: { none: {} } },
              { links: { some: { student: { schoolId: { in: ctx.schoolIds } } } } },
            ],
          }
        : {}),
    };
  }

  /** La règle de `scope` en SQL, pour borner un verrou sur `"SchoolGuardian" g` à ce qui est visible. */
  private visibleSql(ctx: SchoolContext): Prisma.Sql {
    if (!ctx.schoolIds) return Prisma.empty;
    return Prisma.sql`AND (
      (g."schoolId" = ANY(${ctx.schoolIds}::uuid[])
        AND NOT EXISTS (SELECT 1 FROM "SchoolStudentGuardian" l WHERE l."guardianId" = g.id))
      OR EXISTS (
        SELECT 1 FROM "SchoolStudentGuardian" l JOIN "SchoolStudent" s ON s.id = l."studentId"
        WHERE l."guardianId" = g.id AND s."schoolId" = ANY(${ctx.schoolIds}::uuid[])))`;
  }

  async list(ctx: SchoolContext, q: GuardiansQueryDto) {
    if (q.schoolId) await this.school.assertSchool(ctx, q.schoolId);
    const words = q.q ? normalizeSearch(q.q).split(' ').filter(Boolean) : [];
    return this.students.snapshot((tx) =>
      tx.schoolGuardian.findMany({
        where: {
          ...this.scope(ctx),
          AND: [
            ...(q.schoolId
              ? [
                  {
                    OR: [
                      { schoolId: q.schoolId },
                      { links: { some: { student: { schoolId: q.schoolId } } } },
                    ],
                  },
                ]
              : []),
            ...words.map((word) => ({ searchText: { contains: word } })),
          ],
        },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        take: 50,
        select: {
          ...VIEW,
          links: {
            where: ctx.schoolIds ? { student: { schoolId: { in: ctx.schoolIds } } } : {},
            select: {
              relation: true,
              student: {
                select: {
                  id: true,
                  schoolId: true,
                  matricule: true,
                  lastName: true,
                  firstName: true,
                  lastNameAr: true,
                  firstNameAr: true,
                },
              },
            },
          },
        },
      }),
    );
  }

  async create(ctx: SchoolContext, dto: CreateGuardianDto) {
    await this.school.assertSchool(ctx, dto.schoolId);
    const guardian = await this.createWith(this.db, ctx, dto);
    await this.school.log(ctx, 'school.guardian_created', 'SchoolGuardian', guardian.id, {});
    return guardian;
  }

  createWith(
    db: Tx | SchoolPrismaService,
    ctx: SchoolContext,
    dto: CreateGuardianDto,
  ): Promise<GuardianView> {
    return db.schoolGuardian.create({
      data: {
        organizationId: ctx.organizationId,
        schoolId: dto.schoolId,
        lastName: dto.lastName,
        firstName: dto.firstName,
        phone: dto.phone,
        email: dto.email ?? null,
        address: dto.address ?? null,
        searchText: searchText(dto),
      },
      select: VIEW,
    });
  }

  /**
   * Responsable réutilisable par un import : accessible à l'utilisateur, même téléphone, mêmes nom et
   * prénom. Dans le doute, un nouveau responsable est créé : jamais de fusion approximative.
   */
  async findReusable(
    tx: Tx,
    ctx: SchoolContext,
    schoolId: string,
    wanted: { lastName: string; firstName: string; phone: string },
  ) {
    // Seuls les responsables visibles sont verrouillés : un responsable sorti du périmètre n'est pas attendu.
    await tx.$queryRaw`
      SELECT g.id FROM "SchoolGuardian" g
      WHERE g."organizationId" = ${ctx.organizationId}::uuid AND g."schoolId" = ${schoolId}::uuid
        AND g.phone = ${wanted.phone} ${this.visibleSql(ctx)}
      ORDER BY g.id FOR UPDATE OF g`;
    const rows = await tx.schoolGuardian.findMany({
      where: { ...this.scope(ctx), schoolId, phone: wanted.phone },
      select: { id: true, lastName: true, firstName: true },
    });
    return rows.find(
      (r) =>
        normalizeSearch(r.lastName) === normalizeSearch(wanted.lastName) &&
        normalizeSearch(r.firstName) === normalizeSearch(wanted.firstName),
    );
  }

  /**
   * Verrouille le responsable et revérifie l'accès sous verrou. Le transfert d'un enfant verrouille ses
   * responsables ; le retrait d'un lien (`unlink`) ne verrouille que l'élève : la visibilité peut donc
   * changer juste après ce contrôle, qui ne garantit que l'état lu sous verrou. Le verrou traduit la règle de visibilité
   * de `scope` dans la requête même : un responsable étranger n'est jamais verrouillé.
   */
  private async lockInScope(tx: Tx, ctx: SchoolContext, id: string) {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT g.id FROM "SchoolGuardian" g
      WHERE g.id = ${id}::uuid AND g."organizationId" = ${ctx.organizationId}::uuid ${this.visibleSql(ctx)}
      FOR UPDATE OF g`;
    if (!locked.length) throw new NotFoundException(NOT_FOUND);
    const guardian = await tx.schoolGuardian.findFirst({
      where: { ...this.scope(ctx), id },
      select: VIEW,
    });
    if (!guardian) throw new NotFoundException(NOT_FOUND);
    return guardian;
  }

  async update(ctx: SchoolContext, id: string, dto: UpdateGuardianDto) {
    const guardian = await this.db.$transaction(async (tx) => {
      const current = await this.lockInScope(tx, ctx, id);
      // Fiche visible par un enfant d'un autre établissement : sa modification exige le contrat actif de
      // l'établissement de la fiche, jamais celui de l'établissement de l'enfant.
      this.school.assertContractWritable(ctx, current.schoolId);
      return tx.schoolGuardian.update({
        where: { id },
        data: {
          ...dto,
          searchText: searchText({
            lastName: dto.lastName ?? current.lastName,
            firstName: dto.firstName ?? current.firstName,
            phone: dto.phone ?? current.phone,
          }),
        },
        select: VIEW,
      });
    });
    await this.school.log(ctx, 'school.guardian_updated', 'SchoolGuardian', id, {
      fields: Object.keys(dto),
    });
    return guardian;
  }

  async forStudent(ctx: SchoolContext, studentId: string) {
    await this.students.findStudent(ctx, studentId);
    return this.students.snapshot((tx) =>
      tx.schoolStudentGuardian.findMany({
        where: {
          organizationId: ctx.organizationId,
          studentId,
          ...this.students.linkedStudentScope(ctx),
        },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        select: {
          relation: true,
          isPrimary: true,
          isEmergency: true,
          canReceiveSms: true,
          canViewSchoolInfo: true,
          canPickUp: true,
          guardian: { select: VIEW },
        },
      }),
    );
  }

  /** Le premier responsable rattaché devient principal ; aucun droit n'est accordé implicitement. */
  async link(ctx: SchoolContext, studentId: string, dto: LinkGuardianDto) {
    await this.students.findStudent(ctx, studentId);
    await this.find(ctx, dto.guardianId);
    await this.school.unique(
      () => this.db.$transaction((tx) => this.linkInTx(tx, ctx, studentId, dto.guardianId, dto)),
      'GUARDIAN_ALREADY_LINKED',
      'Ce responsable est déjà rattaché à cet élève.',
    );
    await this.school.log(ctx, 'school.guardian_linked', 'SchoolStudent', studentId, {
      guardianId: dto.guardianId,
    });
    return this.forStudent(ctx, studentId);
  }

  async linkInTx(
    tx: Tx,
    ctx: SchoolContext,
    studentId: string,
    guardianId: string,
    rights: GuardianLinkRightsDto & { relation: LinkGuardianDto['relation'] },
  ) {
    await this.students.lockInScope(tx, ctx, studentId);
    await this.lockInScope(tx, ctx, guardianId);
    const existing = await tx.schoolStudentGuardian.count({
      where: { organizationId: ctx.organizationId, studentId },
    });
    const isPrimary = existing === 0 || rights.isPrimary === true;
    if (isPrimary) await this.clearPrimary(tx, ctx, studentId);
    await tx.schoolStudentGuardian.create({
      data: {
        organizationId: ctx.organizationId,
        studentId,
        guardianId,
        relation: rights.relation,
        isPrimary,
        isEmergency: rights.isEmergency ?? false,
        canReceiveSms: rights.canReceiveSms ?? false,
        canViewSchoolInfo: rights.canViewSchoolInfo ?? false,
        canPickUp: rights.canPickUp ?? false,
      },
    });
    await this.students.event(tx, ctx, studentId, 'GUARDIAN_LINKED', { guardianId });
  }

  async updateLink(
    ctx: SchoolContext,
    studentId: string,
    guardianId: string,
    dto: GuardianLinkRightsDto,
  ) {
    await this.students.findStudent(ctx, studentId);
    await this.db.$transaction(async (tx) => {
      await this.students.lockInScope(tx, ctx, studentId);
      if (dto.isPrimary === false) {
        throw new ConflictException({
          code: 'PRIMARY_REQUIRED',
          message: 'Désignez un autre responsable principal.',
        });
      }
      if (dto.isPrimary) await this.clearPrimary(tx, ctx, studentId);
      const { count } = await tx.schoolStudentGuardian.updateMany({
        where: { organizationId: ctx.organizationId, studentId, guardianId },
        data: dto,
      });
      if (count === 0) throw new NotFoundException(NOT_FOUND);
      await this.students.event(tx, ctx, studentId, 'GUARDIAN_RIGHTS_UPDATED', {
        guardianId,
        fields: Object.keys(dto),
      });
    });
    await this.school.log(ctx, 'school.guardian_rights_updated', 'SchoolStudent', studentId, {
      guardianId,
      fields: Object.keys(dto),
    });
    return this.forStudent(ctx, studentId);
  }

  /** Un élève inscrit garde au moins un responsable, et toujours un responsable principal. */
  async unlink(ctx: SchoolContext, studentId: string, guardianId: string) {
    await this.students.findStudent(ctx, studentId);
    await this.db.$transaction(async (tx) => {
      await this.students.lockInScope(tx, ctx, studentId);
      const student = await tx.schoolStudent.findUniqueOrThrow({
        where: { id: studentId },
        select: { status: true },
      });
      const links = await tx.schoolStudentGuardian.findMany({
        where: { organizationId: ctx.organizationId, studentId },
        orderBy: { createdAt: 'asc' },
        select: { guardianId: true, isPrimary: true },
      });
      const link = links.find((l) => l.guardianId === guardianId);
      if (!link) throw new NotFoundException(NOT_FOUND);
      if (links.length === 1 && student.status === 'ENROLLED') {
        throw new ConflictException({
          code: 'LAST_GUARDIAN',
          message: 'Un élève inscrit doit garder au moins un responsable.',
        });
      }
      await tx.schoolStudentGuardian.delete({
        where: { studentId_guardianId: { studentId, guardianId } },
      });
      const next = links.find((l) => l.guardianId !== guardianId);
      if (link.isPrimary && next) {
        await tx.schoolStudentGuardian.update({
          where: { studentId_guardianId: { studentId, guardianId: next.guardianId } },
          data: { isPrimary: true },
        });
      }
      await this.students.event(tx, ctx, studentId, 'GUARDIAN_UNLINKED', { guardianId });
    });
    await this.school.log(ctx, 'school.guardian_unlinked', 'SchoolStudent', studentId, {
      guardianId,
    });
  }

  /**
   * Préparation du portail parents : seuls les enfants dont le lien autorise la consultation. Un
   * responsable ne voit jamais un autre enfant, même lié au même client.
   */
  async authorizedStudentIds(organizationId: string, guardianId: string): Promise<string[]> {
    const links = await this.db.schoolStudentGuardian.findMany({
      where: { organizationId, guardianId, canViewSchoolInfo: true },
      select: { studentId: true },
    });
    return links.map((l) => l.studentId);
  }

  private clearPrimary(tx: Tx, ctx: SchoolContext, studentId: string) {
    return tx.schoolStudentGuardian.updateMany({
      where: { organizationId: ctx.organizationId, studentId, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  private async find(ctx: SchoolContext, id: string) {
    const guardian = await this.db.schoolGuardian.findFirst({
      where: { ...this.scope(ctx), id },
      select: VIEW,
    });
    if (!guardian) throw new NotFoundException(NOT_FOUND);
    return guardian;
  }
}

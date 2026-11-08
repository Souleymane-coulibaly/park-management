import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@ocall/school-database';
import type { SchoolContext } from './school-access';
import { type ClassScope, SchoolAssessmentService } from './school-assessment.service';
import { SchoolNotificationsService } from './school-notifications.service';
import type { PublicationDto } from './school-portal.dto';
import { SchoolPrismaService } from './school-prisma.service';
import { SchoolService } from './school.service';

const NOT_FOUND = { code: 'SCHOOL_RESOURCE_NOT_FOUND', message: 'Élément introuvable.' };

interface FrozenStudents {
  results: { students: { studentId: string }[] };
}

/** Publication visible des familles pour un élève : elle et la validation qu'elle publie sont actives. */
export interface ActivePublication {
  id: string;
  publishedAt: Date;
  periodId: string;
  period: { label: string; labelAr: string | null; position: number };
  scope: ClassScope;
  validation: {
    id: string;
    results: Prisma.JsonValue;
    policyVersion: number | null;
    validatedAt: Date;
    validatedByUserId: string;
  };
}

/**
 * Publication aux familles des résultats validés d'une classe pour une période (Sprint 6). Seuls des
 * résultats validés se publient ; la publication est liée à cette validation : si les résultats sont
 * rouverts, ils disparaissent du portail jusqu'à une nouvelle validation et une nouvelle publication.
 * Publier notifie les responsables de chaque élève de la validation.
 */
@Injectable()
export class SchoolPublicationsService {
  constructor(
    private readonly db: SchoolPrismaService,
    private readonly school: SchoolService,
    private readonly assessment: SchoolAssessmentService,
    private readonly notifications: SchoolNotificationsService,
  ) {}

  async list(ctx: SchoolContext, classId: string) {
    const scope = await this.assessment.findClass(ctx, classId);
    const rows = await this.db.schoolResultPublication.findMany({
      where: { organizationId: ctx.organizationId, classId: scope.id },
      orderBy: { publishedAt: 'desc' },
      select: {
        id: true,
        periodId: true,
        validationId: true,
        publishedAt: true,
        withdrawnAt: true,
        period: { select: { label: true, labelAr: true } },
      },
    });
    const active = await this.activeValidationIds(rows.map((r) => r.validationId));
    return rows.map(({ validationId, ...r }) => ({
      ...r,
      // Visible des familles : non retirée, et sa validation toujours active.
      visible: r.withdrawnAt === null && active.has(validationId),
    }));
  }

  async publish(ctx: SchoolContext, dto: PublicationDto) {
    const scope = await this.assessment.findClass(ctx, dto.classId);
    await this.assessment.findClassPeriod(ctx, scope, dto.periodId);
    let id: string;
    try {
      id = await this.db.$transaction(async (tx) => {
        await this.school.guardSchools(tx, [scope.schoolId]);
        // Même verrou que la validation et la réouverture : la validation lue reste active.
        await this.assessment.lockResults(tx, scope.id, dto.periodId);
        const validation = await this.assessment.activeValidation(tx, scope.id, dto.periodId);
        if (!validation) {
          throw new ConflictException({
            code: 'RESULTS_NOT_VALIDATED',
            message: 'Seuls des résultats validés peuvent être publiés aux familles.',
          });
        }
        const current = await tx.schoolResultPublication.findFirst({
          where: { classId: scope.id, periodId: dto.periodId, withdrawnAt: null },
        });
        if (current?.validationId === validation.id) {
          throw new ConflictException({
            code: 'ALREADY_PUBLISHED',
            message: 'Ces résultats sont déjà publiés.',
          });
        }
        // Publication d'une ancienne validation (résultats rouverts puis revalidés) : remplacée.
        if (current) {
          await tx.schoolResultPublication.update({
            where: { id: current.id },
            data: { withdrawnAt: new Date(), withdrawnByUserId: ctx.userId },
          });
        }
        const created = await tx.schoolResultPublication.create({
          data: {
            organizationId: ctx.organizationId,
            schoolId: scope.schoolId,
            schoolYearId: scope.schoolYearId,
            classId: scope.id,
            periodId: dto.periodId,
            validationId: validation.id,
            publishedByUserId: ctx.userId,
          },
        });
        const studentIds = (validation.results as unknown as FrozenStudents).results.students.map(
          (s) => s.studentId,
        );
        await this.notifications.notifyStudents(tx, {
          organizationId: ctx.organizationId,
          schoolId: scope.schoolId,
          kind: 'REPORT_CARD',
          resourceId: created.id,
          studentIds,
          dedupe: (studentId) => `report:${created.id}:${studentId}`,
          sms: { kind: 'REPORT_CARD' },
        });
        await this.school.recordDecision(
          tx,
          ctx,
          'school.results_published',
          'SchoolClass',
          scope.id,
          { periodId: dto.periodId, publicationId: created.id, students: studentIds.length },
        );
        return created.id;
      });
    } catch (error) {
      // Deux publications simultanées : l'index partiel n'en laisse passer qu'une.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: 'ALREADY_PUBLISHED',
          message: 'Ces résultats sont déjà publiés.',
        });
      }
      throw error;
    }
    await this.school.publishDecisions(ctx.organizationId);
    return { id };
  }

  async withdraw(ctx: SchoolContext, id: string) {
    const found = await this.db.schoolResultPublication.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { classId: true, periodId: true },
    });
    if (!found) throw new NotFoundException(NOT_FOUND);
    const scope = await this.assessment.findClass(ctx, found.classId);
    await this.db.$transaction(async (tx) => {
      const { count } = await tx.schoolResultPublication.updateMany({
        where: { id, withdrawnAt: null },
        data: { withdrawnAt: new Date(), withdrawnByUserId: ctx.userId },
      });
      if (count === 0) {
        throw new ConflictException({
          code: 'PUBLICATION_WITHDRAWN',
          message: 'Cette publication est déjà retirée.',
        });
      }
      await this.school.recordDecision(
        tx,
        ctx,
        'school.results_withdrawn',
        'SchoolClass',
        scope.id,
        {
          periodId: found.periodId,
          publicationId: id,
        },
      );
    });
    await this.school.publishDecisions(ctx.organizationId);
    return { withdrawn: true };
  }

  /**
   * Publications visibles pour un élève : non retirées, validation encore active, élève présent dans les
   * résultats figés de cette validation. Les plus récentes d'abord (par période). Lue dans la transaction
   * `db` quand elle est fournie : le détail restitué ensuite provient du même instantané.
   */
  async activeFor(
    organizationId: string,
    studentId: string,
    db: Prisma.TransactionClient = this.db,
  ): Promise<ActivePublication[]> {
    const rows = await db.schoolResultPublication.findMany({
      where: { organizationId, withdrawnAt: null },
      select: {
        id: true,
        publishedAt: true,
        periodId: true,
        validationId: true,
        period: { select: { label: true, labelAr: true, position: true } },
        class: {
          select: {
            id: true,
            name: true,
            nameAr: true,
            levelId: true,
            schoolYearId: true,
            isActive: true,
            year: { select: { schoolId: true } },
          },
        },
      },
    });
    if (rows.length === 0) return [];
    const validations = await db.schoolResultValidation.findMany({
      where: { id: { in: rows.map((r) => r.validationId) }, unlockedAt: null },
      select: {
        id: true,
        results: true,
        policyVersion: true,
        validatedAt: true,
        validatedByUserId: true,
      },
    });
    const byId = new Map(validations.map((v) => [v.id, v]));
    const result: ActivePublication[] = [];
    for (const r of rows) {
      const validation = byId.get(r.validationId);
      if (!validation) continue;
      const frozen = validation.results as unknown as FrozenStudents;
      if (!frozen.results.students.some((s) => s.studentId === studentId)) continue;
      const { year, ...cls } = r.class;
      result.push({
        id: r.id,
        publishedAt: r.publishedAt,
        periodId: r.periodId,
        period: r.period,
        scope: { ...cls, schoolId: year.schoolId },
        validation,
      });
    }
    return result.sort(
      (a, b) =>
        b.period.position - a.period.position || b.publishedAt.getTime() - a.publishedAt.getTime(),
    );
  }

  private async activeValidationIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db.schoolResultValidation.findMany({
      where: { id: { in: ids }, unlockedAt: null },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }
}

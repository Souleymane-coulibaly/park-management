import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@ocall/school-database';
import type { SchoolContext } from './school-access';

type Tx = Prisma.TransactionClient;

/** Élève « actif » (offre Ocall School Free) : inscrit ou scolarisé ; transféré, sorti, déscolarisé exclus. */
export const ACTIVE_STUDENT_STATUSES = ['REGISTERED', 'ENROLLED'] as const;

/**
 * Plafond d'élèves actifs de l'offre gratuite (socle S1 : 50 par organisation). Sans plafond (contrat
 * payant ou essai actif), aucun contrôle. Sous verrou transactionnel par organisation puis recomptage
 * dans la même transaction que l'écriture : deux inscriptions simultanées ne dépassent jamais le
 * plafond. Les élèves déjà actifs au-delà du plafond (retour au gratuit) restent consultables et
 * modifiables ; seules les nouvelles activations sont refusées. Aucune donnée n'est supprimée.
 *
 * @param reactivatedStudentId élève existant qui (re)devient actif ; aucun contrôle s'il l'est déjà.
 */
export async function assertStudentCapacity(
  tx: Tx,
  ctx: Pick<SchoolContext, 'organizationId' | 'limits'>,
  options: { adding?: number; reactivatedStudentId?: string } = {},
): Promise<void> {
  const max = ctx.limits.maxStudents;
  if (max === undefined || max === null) return;
  const adding = options.adding ?? 1;
  if (adding <= 0) return;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`school-free-students:${ctx.organizationId}`}))`;
  if (options.reactivatedStudentId) {
    const current = await tx.schoolStudent.findFirst({
      where: { organizationId: ctx.organizationId, id: options.reactivatedStudentId },
      select: { status: true },
    });
    if (current && (ACTIVE_STUDENT_STATUSES as readonly string[]).includes(current.status)) return;
  }
  const active = await tx.schoolStudent.count({
    where: { organizationId: ctx.organizationId, status: { in: [...ACTIVE_STUDENT_STATUSES] } },
  });
  if (active + adding > max) {
    throw new ConflictException({
      code: 'SCHOOL_FREE_STUDENT_LIMIT',
      message: `Offre gratuite : ${max} élèves actifs au maximum (${active} actuellement). Passez à l’offre payante pour inscrire de nouveaux élèves ; vos données sont conservées.`,
      limit: max,
      active,
    });
  }
}

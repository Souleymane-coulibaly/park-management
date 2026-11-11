import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@ocall/facture-database';
import { factureAiTextEdited } from '@ocall/shared';

/**
 * Application d'une proposition de rapport (F6A) dans la transaction qui termine les travaux : la
 * proposition doit être celle de CETTE intervention, encore en attente ; elle est marquée appliquée,
 * corrigée ou non par le technicien. Fonction autonome (sans injection), utilisée par les interventions.
 */
export async function applyFactureReportProposal(
  tx: Prisma.TransactionClient,
  ctx: { organizationId: string; userId: string },
  proposalId: string,
  interventionId: string,
  applied: { workSummary: string; recommendations: string | null },
  now: Date,
) {
  const proposal = await tx.factureAiProposal.findUnique({
    where: { organizationId_id: { organizationId: ctx.organizationId, id: proposalId } },
  });
  if (
    !proposal ||
    proposal.feature !== 'FACTURE_REPORT' ||
    proposal.targetId !== interventionId ||
    proposal.status !== 'PROPOSED'
  ) {
    throw new ConflictException({
      code: 'FACTURE_AI_PROPOSAL_INVALID',
      message: 'Cette proposition IA n’est plus applicable à cette intervention.',
    });
  }
  const output = proposal.output as { workSummary?: string; recommendations?: string | null };
  await tx.factureAiProposal.update({
    where: { organizationId_id: { organizationId: ctx.organizationId, id: proposalId } },
    data: {
      status: 'APPLIED',
      decidedByUserId: ctx.userId,
      decidedAt: now,
      edited:
        factureAiTextEdited(output.workSummary ?? null, applied.workSummary) ||
        factureAiTextEdited(output.recommendations ?? null, applied.recommendations),
    },
  });
}

/**
 * Suggestion de maintenance préventive (F6B) appliquée dans la transaction qui crée l'intervention : la
 * suggestion doit concerner l'équipement de cette intervention et être encore en attente.
 */
export async function applyFactureMaintenanceProposal(
  tx: Prisma.TransactionClient,
  ctx: { organizationId: string; userId: string },
  proposalId: string,
  target: { equipmentId: string | null; interventionId: string },
  now: Date,
) {
  const proposal = await tx.factureAiProposal.findUnique({
    where: { organizationId_id: { organizationId: ctx.organizationId, id: proposalId } },
  });
  if (
    !proposal ||
    proposal.feature !== 'FACTURE_MAINTENANCE' ||
    proposal.targetId !== target.equipmentId ||
    proposal.status !== 'PROPOSED'
  ) {
    throw new ConflictException({
      code: 'FACTURE_AI_PROPOSAL_INVALID',
      message: 'Cette suggestion de maintenance n’est plus applicable à cet équipement.',
    });
  }
  await tx.factureAiProposal.update({
    where: { organizationId_id: { organizationId: ctx.organizationId, id: proposalId } },
    data: {
      status: 'APPLIED',
      decidedByUserId: ctx.userId,
      decidedAt: now,
      resultId: target.interventionId,
    },
  });
}

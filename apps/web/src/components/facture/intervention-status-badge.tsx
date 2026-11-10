import { FACTURE_INTERVENTION_STATUS_LABELS, type FactureInterventionStatus } from '@ocall/shared';
import { Badge } from '@/components/ui/badge';

const TONES: Record<FactureInterventionStatus, 'forest' | 'savanna' | 'terracotta' | 'neutral'> = {
  PLANNED: 'neutral',
  IN_PROGRESS: 'savanna',
  COMPLETED: 'savanna',
  SIGNED: 'forest',
  INVOICED: 'forest',
  CANCELLED: 'terracotta',
};

/** Statut d'une intervention (couleur et libellé, jamais la couleur seule). */
export function InterventionStatusBadge({ status }: { status: FactureInterventionStatus }) {
  return <Badge tone={TONES[status]}>{FACTURE_INTERVENTION_STATUS_LABELS[status]}</Badge>;
}

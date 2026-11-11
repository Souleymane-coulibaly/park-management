import { FACTURE_DOCUMENT_STATUS_LABELS, type FactureDocumentStatus } from '@ocall/shared';
import { Badge } from '@/components/ui/badge';

const TONES: Record<FactureDocumentStatus, 'forest' | 'savanna' | 'terracotta' | 'neutral'> = {
  DRAFT: 'neutral',
  ISSUED: 'savanna',
  SENT: 'savanna',
  ACCEPTED: 'forest',
  REFUSED: 'terracotta',
  CANCELLED: 'terracotta',
  PARTIALLY_PAID: 'savanna',
  PAID: 'forest',
  CREDITED: 'neutral',
};

/** Statut d'un document Ocall Facture (couleur et libellé, jamais la couleur seule). */
export function DocumentStatusBadge({ status }: { status: FactureDocumentStatus }) {
  return <Badge tone={TONES[status]}>{FACTURE_DOCUMENT_STATUS_LABELS[status]}</Badge>;
}

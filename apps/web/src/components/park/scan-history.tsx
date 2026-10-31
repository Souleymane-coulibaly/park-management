import { SCAN_REFUSAL_LABELS } from '@ocall/shared';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format';
import type { TicketScanView } from '@/lib/types';

/** Liste des passages : résultat, visiteur, catégorie, point d'entrée et agent. */
export function ScanHistoryList({ scans }: { scans: TicketScanView[] }) {
  if (scans.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-muted">Aucun passage enregistré.</p>;
  }
  return (
    <ul className="divide-y divide-line/70" data-testid="scan-history">
      {scans.map((s) => (
        <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
          <span className="w-28 text-muted">{formatDateTime(s.createdAt)}</span>
          {s.result === 'ACCEPTED' ? (
            <Badge tone="forest">Accepté</Badge>
          ) : (
            <Badge tone="terracotta">
              {s.refusalReason ? SCAN_REFUSAL_LABELS[s.refusalReason] : 'Refusé'}
            </Badge>
          )}
          <span className="flex-1 truncate">
            {s.ticket ? `${s.ticket.visitorName} · ${s.ticket.categoryName}` : '—'}
          </span>
          <span className="text-muted">
            {s.entryPoint} · {s.scannedBy}
          </span>
        </li>
      ))}
    </ul>
  );
}

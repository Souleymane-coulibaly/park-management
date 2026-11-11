'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { FACTURE_MAINTENANCE_REASON_LABELS, type FactureMaintenanceReason } from '@ocall/shared';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ApiErrorAlert } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface Suggestion {
  proposalId: string;
  equipmentId: string;
  equipmentName: string;
  clientId: string;
  clientName: string;
  reasons: FactureMaintenanceReason[];
  lastServiceAt: string | null;
  dueDate: string | null;
  evidence: string[];
  title: string;
  explanation: string;
}

const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'UTC' });
const toError = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.');

/**
 * Maintenance préventive intelligente (F6B) : équipements à entretenir ou à vérifier selon leur
 * historique réel, avec une explication prudente et ses justificatifs. Une suggestion devient une
 * intervention seulement si le responsable la planifie.
 */
export function AiMaintenance() {
  const list = useApi<Suggestion[]>('/facture/ai/maintenance');
  const [fresh, setFresh] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const suggestions = fresh ?? (list.state === 'success' ? list.data : []);

  async function analyze() {
    setBusy('analyze');
    setError(null);
    try {
      setFresh(await api<Suggestion[]>('/facture/ai/maintenance', { method: 'POST' }));
    } catch (err) {
      setError(toError(err));
    } finally {
      setBusy(null);
    }
  }

  async function ignore(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api(`/facture/ai/proposals/${id}/reject`, { method: 'POST' });
      setFresh(suggestions.filter((s) => s.proposalId !== id));
    } catch (err) {
      setError(toError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Maintenance préventive"
        description="Équipements à entretenir ou à vérifier, d’après leur historique. Ce sont des recommandations, jamais des pannes annoncées."
        action={
          <Button
            variant="secondary"
            size="sm"
            loading={busy === 'analyze'}
            icon={<Sparkles className="h-4 w-4" aria-hidden />}
            data-testid="facture-ai-maintenance-analyze"
            onClick={() => void analyze()}
          >
            Analyser le parc
          </Button>
        }
      />
      <CardBody className="space-y-3">
        <ApiErrorAlert error={error} />
        {suggestions.length === 0 ? (
          <p className="text-sm text-muted">Aucune suggestion en attente.</p>
        ) : (
          <ul className="space-y-3" data-testid="facture-ai-maintenance">
            {suggestions.map((s) => (
              <li key={s.proposalId} className="rounded-xl border border-line px-4 py-3 text-sm">
                <p className="font-semibold">{s.title}</p>
                <p className="text-xs text-muted">
                  {s.equipmentName} · {s.clientName} ·{' '}
                  {s.reasons.map((r) => FACTURE_MAINTENANCE_REASON_LABELS[r]).join(' ; ')}
                </p>
                <p className="mt-1 text-charcoal-soft">{s.explanation}</p>
                <p className="mt-1 text-xs text-muted">
                  {s.lastServiceAt
                    ? `Dernier entretien : ${dateFr(s.lastServiceAt)}`
                    : 'Aucun entretien enregistré'}
                  {s.dueDate ? ` · échéance conseillée : ${dateFr(s.dueDate)}` : ''}
                  {s.evidence.length > 0 ? ` · d’après ${s.evidence.join(', ')}` : ''}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <ButtonLink
                    size="sm"
                    href={`/facture/interventions?${new URLSearchParams({
                      maintenance: s.proposalId,
                      clientId: s.clientId,
                      equipmentId: s.equipmentId,
                      title: s.title.slice(0, 160),
                    })}`}
                  >
                    Planifier
                  </ButtonLink>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy === s.proposalId}
                    onClick={() => void ignore(s.proposalId)}
                  >
                    Ignorer
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

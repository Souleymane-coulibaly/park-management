'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ApiErrorAlert } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';

interface Candidate {
  memberId: string;
  name: string;
  start: string;
  end: string;
  requestedSlot: boolean;
  skillsMatched: number;
  skillsRequired: number;
  load: number;
  conflicts: string[];
  reason: string | null;
}

interface PlanningProposal {
  proposalId: string;
  summary: string | null;
  candidates: Candidate[];
}

const slotFr = (start: string, end: string) => {
  const s = new Date(start);
  const day = s.toLocaleDateString('fr-FR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const t = (d: Date) =>
    d.toLocaleTimeString('fr-FR', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
  return `${day}, ${t(s)}–${t(new Date(end))}`;
};
const toError = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.');

/**
 * Planification intelligente (F6B) : techniciens et créneaux libres calculés par le serveur
 * (compétences, conflits, indisponibilités, urgence), classés et expliqués par l'IA. Rien n'est affecté
 * avant le choix du responsable, revérifié au moment d'affecter.
 */
export function AiPlanningAssistant({
  interventionId,
  onAssigned,
}: {
  interventionId: string;
  onAssigned: () => void;
}) {
  const [proposal, setProposal] = useState<PlanningProposal | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function suggest() {
    setBusy('suggest');
    setError(null);
    try {
      setProposal(
        await api<PlanningProposal>(`/facture/interventions/${interventionId}/ai/planning`, {
          method: 'POST',
        }),
      );
    } catch (err) {
      setError(toError(err));
    } finally {
      setBusy(null);
    }
  }

  async function assign(choice: number) {
    if (!proposal) return;
    setBusy(`assign-${choice}`);
    setError(null);
    try {
      await api(`/facture/ai/proposals/${proposal.proposalId}/assign`, {
        method: 'POST',
        body: { choice },
      });
      setProposal(null);
      onAssigned();
    } catch (err) {
      setError(toError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Planification intelligente"
        description="Techniciens disponibles et compétents, créneaux sans conflit : vous choisissez."
        action={
          <Button
            variant="secondary"
            size="sm"
            loading={busy === 'suggest'}
            icon={<Sparkles className="h-4 w-4" aria-hidden />}
            data-testid="facture-ai-planning-suggest"
            onClick={() => void suggest()}
          >
            Suggérer
          </Button>
        }
      />
      <CardBody className="space-y-3">
        <ApiErrorAlert error={error} />
        {proposal ? (
          <>
            {proposal.summary && <p className="text-sm text-charcoal-soft">{proposal.summary}</p>}
            <ol className="space-y-2" data-testid="facture-ai-planning-candidates">
              {proposal.candidates.map((c, i) => (
                <li
                  key={`${c.memberId}-${c.start}`}
                  className="rounded-xl border border-line px-4 py-3 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">
                      {c.name} · {slotFr(c.start, c.end)}
                      {c.requestedSlot ? ' (créneau demandé)' : ''}
                    </span>
                    <Button
                      size="sm"
                      loading={busy === `assign-${i}`}
                      onClick={() => void assign(i)}
                    >
                      Affecter
                    </Button>
                  </div>
                  <p className="text-xs text-muted">
                    Compétences {c.skillsMatched}/{c.skillsRequired} · {c.load} intervention(s)
                    prévue(s)
                    {c.conflicts.length > 0
                      ? ` · occupé sur le créneau demandé (${c.conflicts.join(', ')})`
                      : ''}
                  </p>
                  {c.reason && <p className="mt-1 text-charcoal-soft">{c.reason}</p>}
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="text-sm text-muted">
            Demandez une suggestion pour comparer les techniciens disponibles.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

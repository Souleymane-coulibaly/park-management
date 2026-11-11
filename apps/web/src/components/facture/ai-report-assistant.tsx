'use client';

import { useState } from 'react';
import { Mic, Sparkles, Square } from 'lucide-react';
import { TextareaField } from '@/components/facture/textarea-field';
import { Button } from '@/components/ui/button';
import { Alert, ApiErrorAlert } from '@/components/ui/states';
import { ApiError, api, apiUpload } from '@/lib/api';
import { useVoiceRecorder } from '@/lib/use-voice-recorder';

export interface AiReportProposal {
  proposalId: string;
  workSummary: string;
  recommendations: string | null;
  transcript: string | null;
}

/**
 * Rapport d'intervention intelligent (F6A) : observations saisies ou dictées → rapport proposé par l'IA,
 * qui préremplit la fin des travaux. Le technicien relit, corrige et valide lui-même ; rien n'est
 * enregistré dans l'intervention avant sa validation.
 */
export function AiReportAssistant({
  interventionId,
  onProposal,
  proposalId,
  onRejected,
}: {
  interventionId: string;
  onProposal: (p: AiReportProposal) => void;
  proposalId: string | null;
  onRejected: () => void;
}) {
  const [observations, setObservations] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const voice = useVoiceRecorder((audio) => void generate(audio));

  async function generate(audio?: Blob) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      if (observations.trim()) form.append('observations', observations.trim());
      if (audio) form.append('audio', audio, 'observations.webm');
      const proposal = await apiUpload<AiReportProposal>(
        `/facture/interventions/${interventionId}/ai/report`,
        form,
      );
      if (proposal.transcript) {
        setObservations((o) => [o, proposal.transcript].filter(Boolean).join('\n'));
      }
      onProposal(proposal);
    } catch (err) {
      setError(
        err instanceof ApiError ? err : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="space-y-3 rounded-xl border border-forest/30 bg-forest-light/20 p-4"
      data-testid="facture-ai-report"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-forest">
        <Sparkles className="h-4 w-4" aria-hidden />
        Rédiger le rapport avec l’IA
      </p>
      <TextareaField
        label="Vos observations (ou dictez-les)"
        maxLength={4000}
        rows={3}
        value={observations}
        onChange={(e) => setObservations(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          loading={busy}
          disabled={!observations.trim() || voice.recording}
          data-testid="facture-ai-report-generate"
          onClick={() => void generate()}
        >
          Proposer un rapport
        </Button>
        {voice.recording ? (
          <Button
            type="button"
            variant="danger"
            icon={<Square className="h-4 w-4" aria-hidden />}
            onClick={voice.stop}
          >
            Arrêter ({voice.seconds} s)
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            icon={<Mic className="h-4 w-4" aria-hidden />}
            onClick={() => void voice.start()}
          >
            Dicter
          </Button>
        )}
        {proposalId && (
          <Button
            type="button"
            variant="ghost"
            onClick={async () => {
              try {
                await api(`/facture/ai/proposals/${proposalId}/reject`, { method: 'POST' });
              } finally {
                onRejected();
              }
            }}
          >
            Rejeter la proposition
          </Button>
        )}
      </div>
      {voice.error && <Alert tone="info" title={voice.error} />}
      <ApiErrorAlert error={error} />
      {proposalId && (
        <p className="text-sm text-charcoal-soft" data-testid="facture-ai-report-proposed">
          Proposition de l’IA reprise ci-dessous : relisez-la et corrigez-la avant de terminer les
          travaux. Le client ne signe qu’après votre validation.
        </p>
      )}
    </div>
  );
}

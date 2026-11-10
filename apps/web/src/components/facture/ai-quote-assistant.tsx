'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { formatXof } from '@ocall/shared';
import { TextareaField } from '@/components/facture/textarea-field';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface QuoteProposal {
  proposalId: string;
  subject: string;
  lines: {
    itemId: string;
    label: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    note: string | null;
  }[];
  missing: string[];
  totalHt: number;
  totalTtc: number;
}

const toError = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.');

/**
 * Devis intelligent (F6A) : depuis la demande d'un client, l'IA propose des lignes du catalogue (prix du
 * catalogue, jamais inventés) et liste les informations manquantes. Le brouillon n'est créé que sur
 * décision du commercial, et n'est jamais émis automatiquement.
 */
export function AiQuoteAssistant() {
  const router = useRouter();
  const clients = useApi<{ id: string; name: string }[]>('/facture/clients');
  const [clientId, setClientId] = useState('');
  const [request, setRequest] = useState('');
  const [proposal, setProposal] = useState<QuoteProposal | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function propose(e: FormEvent) {
    e.preventDefault();
    setBusy('propose');
    setError(null);
    try {
      setProposal(
        await api<QuoteProposal>('/facture/ai/quote', {
          method: 'POST',
          body: { clientId, request },
        }),
      );
    } catch (err) {
      setError(toError(err));
    } finally {
      setBusy(null);
    }
  }

  async function decide(action: 'apply' | 'reject') {
    if (!proposal) return;
    setBusy(action);
    setError(null);
    try {
      if (action === 'apply') {
        const res = await api<{ documentId: string }>(
          `/facture/ai/proposals/${proposal.proposalId}/apply`,
          { method: 'POST' },
        );
        router.push(`/facture/documents/${res.documentId}`);
        return;
      }
      await api(`/facture/ai/proposals/${proposal.proposalId}/reject`, { method: 'POST' });
      setProposal(null);
    } catch (err) {
      setError(toError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Devis intelligent"
        description="Décrivez la demande du client : l’IA propose des lignes de votre catalogue, à vos prix."
      />
      <CardBody className="space-y-4">
        <form className="grid gap-4" onSubmit={propose} data-testid="facture-ai-quote">
          <SelectField
            label="Client du devis"
            required
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            options={[
              { value: '', label: 'Choisir un client' },
              ...(clients.state === 'success'
                ? clients.data.map((c) => ({ value: c.id, label: c.name }))
                : []),
            ]}
          />
          <TextareaField
            label="Demande du client"
            required
            minLength={10}
            maxLength={4000}
            value={request}
            onChange={(e) => setRequest(e.target.value)}
          />
          <div>
            <Button
              type="submit"
              variant="secondary"
              loading={busy === 'propose'}
              disabled={!clientId || request.trim().length < 10}
              icon={<Sparkles className="h-4 w-4" aria-hidden />}
            >
              Proposer un devis
            </Button>
          </div>
        </form>
        <ApiErrorAlert error={error} />
        {proposal && (
          <div className="space-y-3" data-testid="facture-ai-quote-proposal">
            <p className="font-semibold text-charcoal">{proposal.subject}</p>
            {proposal.lines.length > 0 ? (
              <ul className="divide-y divide-line/70 text-sm">
                {proposal.lines.map((l, i) => (
                  <li key={`${l.itemId}-${i}`} className="flex justify-between gap-3 py-2">
                    <span>
                      {l.quantity.toLocaleString('fr-FR')} {l.unit} · {l.label}
                      {l.note && <span className="block text-xs text-muted">{l.note}</span>}
                    </span>
                    <span className="whitespace-nowrap">{formatXof(l.unitPrice)} HT</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Aucune ligne du catalogue proposée.</p>
            )}
            <p className="text-sm">
              Total proposé :{' '}
              <span className="font-semibold">{formatXof(proposal.totalTtc)} TTC</span> (prix de
              votre catalogue)
            </p>
            {proposal.missing.length > 0 && (
              <Alert tone="info" title="Informations à compléter">
                <ul className="list-disc ps-5" data-testid="facture-ai-quote-missing">
                  {proposal.missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                loading={busy === 'apply'}
                disabled={proposal.lines.length === 0}
                data-testid="facture-ai-quote-apply"
                onClick={() => void decide('apply')}
              >
                Créer le brouillon de devis
              </Button>
              <Button
                variant="ghost"
                loading={busy === 'reject'}
                onClick={() => void decide('reject')}
              >
                Rejeter
              </Button>
            </div>
            <p className="text-xs text-muted">
              Le brouillon reste à relire et à compléter : il n’est jamais émis automatiquement.
            </p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

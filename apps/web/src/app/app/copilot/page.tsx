'use client';

import { type FormEvent, useState } from 'react';
import { CalendarRange, Info, Send, ShieldCheck } from 'lucide-react';
import { formatXof } from '@ocall/shared';
import { AiFeatureGate } from '@/components/ai/ai-availability';
import { AccessDenied } from '@/components/app/access-denied';
import { EstablishmentScope } from '@/components/app/establishment-scope';
import { useCan } from '@/components/app/session-context';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ApiErrorAlert } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import type { CopilotAnswer, CopilotResult, Establishment } from '@/lib/types';

const SUGGESTIONS = [
  'Quel est mon chiffre d’affaires aujourd’hui ?',
  'Quels sont les 5 plats les plus vendus cette semaine ?',
  'Quels produits sont proches de la rupture de stock ?',
  'Combien de visiteurs sont entrés dans mon parc hier ?',
  'Quel est mon panier moyen ce mois-ci ?',
  'Quel jour ai-je réalisé le plus de ventes ces 30 derniers jours ?',
  'Combien de commandes ont été préparées aujourd’hui ?',
];

/** Copilote analytique : questions en français, réponses en lecture seule sur les données réelles. */
export default function CopilotPage() {
  const canUse = useCan('ai.copilot');
  if (!canUse) return <AccessDenied />;
  return (
    <div>
      <PageHeader
        eyebrow="Intelligence artificielle"
        title="Copilote"
        description="Posez une question sur votre activité. Les chiffres sont calculés par Ocall Park sur vos données ; le copilote est en lecture seule."
      />
      <AiFeatureGate feature="COPILOT" fallbackHref="/app" fallbackLabel="Voir le tableau de bord">
        {() => (
          <EstablishmentScope<Establishment>
            source="/establishments"
            storageKey="ocp.copilot.establishment"
            emptyTitle="Aucun établissement disponible"
            emptyDescription="Le copilote analyse un établissement auquel vous êtes affecté."
          >
            {(e) => <Conversation establishmentId={e.id} />}
          </EstablishmentScope>
        )}
      </AiFeatureGate>
    </div>
  );
}

function Conversation({ establishmentId }: { establishmentId: string }) {
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<CopilotAnswer[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function ask(text: string) {
    const q = text.trim();
    if (q.length < 3 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await api<CopilotAnswer>('/ai/copilot/ask', {
        method: 'POST',
        body: { establishmentId, question: q },
      });
      setHistory((h) => [answer, ...h].slice(0, 20));
      setQuestion('');
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void ask(question);
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <form onSubmit={onSubmit} className="space-y-3">
          <label htmlFor="copilot-question" className="text-sm font-semibold">
            Votre question
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="copilot-question"
              className="min-h-11 flex-1 rounded-xl border border-line bg-surface px-3 text-[15px] focus:border-forest focus:outline-none"
              value={question}
              maxLength={500}
              placeholder="Ex. Quel est mon chiffre d’affaires aujourd’hui ?"
              onChange={(e) => setQuestion(e.target.value)}
            />
            <Button type="submit" loading={busy} icon={<Send className="h-4 w-4" />}>
              Demander
            </Button>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Exemples de questions">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                className="rounded-full border border-line bg-ivory px-3 py-1.5 text-left text-sm hover:border-forest"
                onClick={() => void ask(s)}
                disabled={busy}
              >
                {s}
              </button>
            ))}
          </div>
        </form>
      </Card>
      <ApiErrorAlert error={error} />
      {history.map((answer, i) => (
        <AnswerCard key={`${history.length - i}`} answer={answer} />
      ))}
    </div>
  );
}

function AnswerCard({ answer }: { answer: CopilotAnswer }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="space-y-3" data-testid="copilot-answer">
        <p className="text-sm text-muted">
          {answer.establishment.name} · « {answer.question} »
        </p>
        <p className="text-[15px] font-medium">{answer.answer}</p>
        {!answer.grounded && (
          <Alert tone="info">
            La formulation proposée par l’IA citait un chiffre absent de vos données : elle a été
            écartée. Seuls les chiffres calculés ci-dessous font foi.
          </Alert>
        )}
        {answer.rejected.length > 0 && (
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <ShieldCheck className="h-4 w-4 text-forest" aria-hidden />
            {answer.rejected.length} demande(s) refusée(s) : le copilote est en lecture seule et
            limité à cet établissement.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {answer.results.map((r, i) => (
            <ResultCard key={`${r.tool}-${i}`} result={r} />
          ))}
        </div>
      </div>
    </Card>
  );
}

const num = (v: unknown) => (typeof v === 'number' ? v : 0);

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="font-display text-xl font-bold">{value}</p>
    </div>
  );
}

/** Rendu des chiffres calculés par le serveur, par type d'analyse. */
function ResultCard({ result }: { result: CopilotResult }) {
  const d = result.data;
  return (
    <div
      className="space-y-2 rounded-xl border border-line/80 bg-ivory/60 p-4"
      data-testid="copilot-result"
    >
      <p className="font-semibold">{result.title}</p>
      {result.period && (
        <p className="flex items-center gap-1.5 text-sm text-muted">
          <CalendarRange className="h-4 w-4" aria-hidden /> {result.period.label}
        </p>
      )}
      {result.tool === 'revenue_summary' && (
        <div className="grid grid-cols-2 gap-3">
          <Figure label="Encaissé" value={formatXof(num(d.revenueXof))} />
          <Figure label="Ventes payées" value={String(num(d.paidSales))} />
          <Figure
            label="Panier moyen"
            value={d.averageBasketXof === null ? '—' : formatXof(num(d.averageBasketXof))}
          />
        </div>
      )}
      {result.tool === 'top_products' && (
        <ol className="space-y-1 text-sm">
          {(
            d.products as Array<{ rank: number; name: string; quantity: number; amountXof: number }>
          ).map((p) => (
            <li key={p.rank} className="flex justify-between gap-2">
              <span>
                {p.rank}. {p.name}
              </span>
              <span className="font-semibold">
                {p.quantity} · {formatXof(p.amountXof)}
              </span>
            </li>
          ))}
        </ol>
      )}
      {result.tool === 'low_stock' && (
        <ul className="space-y-1 text-sm">
          {(
            d.items as Array<{
              name: string;
              quantity: number;
              alertThreshold: number;
              unit: string;
            }>
          ).map((i) => (
            <li key={i.name} className="flex justify-between gap-2">
              <span>{i.name}</span>
              <span className="font-semibold text-terracotta-dark">
                {i.quantity} / seuil {i.alertThreshold}
              </span>
            </li>
          ))}
          {(d.items as unknown[]).length === 0 && num(d.evaluated) > 0 && (
            <li className="text-muted">Aucun article sous son seuil d’alerte.</li>
          )}
        </ul>
      )}
      {result.tool === 'park_entries' && <Figure label="Entrées" value={String(num(d.entries))} />}
      {result.tool === 'best_day' && d.day !== null && (
        <div className="grid grid-cols-2 gap-3">
          <Figure label="Jour" value={String(d.day)} />
          <Figure label="Encaissé" value={formatXof(num(d.revenueXof))} />
        </div>
      )}
      {result.tool === 'prepared_orders' && (
        <div className="grid grid-cols-2 gap-3">
          <Figure label="Prêtes" value={String(num(d.readyOrders))} />
          <Figure label="Servies" value={String(num(d.servedOrders))} />
        </div>
      )}
      {result.tool === 'ticket_sales' && (
        <div className="grid grid-cols-2 gap-3">
          <Figure label="Billets" value={String(num(d.tickets))} />
          <Figure label="Montant" value={formatXof(num(d.amountXof))} />
        </div>
      )}
      {result.missing.map((m) => (
        <p key={m} className="flex items-start gap-1.5 text-sm text-muted">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {m}
        </p>
      ))}
    </div>
  );
}

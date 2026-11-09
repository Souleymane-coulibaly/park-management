'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ArrowRight,
  FileText,
  GraduationCap,
  Package,
  Receipt,
  Sparkles,
  Ticket,
} from 'lucide-react';
import {
  COMMERCIAL_STATE_LABELS,
  PUBLIC_PRODUCT_STATUS_LABELS,
  SETUP_FEE_STATUS_LABELS,
  type SetupFeeStatus,
  type SuitePortalApp,
  formatXof,
  quoteSubscription,
} from '@ocall/shared';
import { LogoutButton } from '@/components/app/logout-button';
import { SuiteLogo } from '@/components/brand/suite-logo';
import { Button } from '@/components/ui/button';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

/**
 * Portail Ocall Suite (socle S1) : applications souscrites et disponibles, essais et jours restants,
 * statut, tarif et option vitrine, actions réelles (essai, demande d'activation, contrat, accès).
 * Toutes les décisions viennent du serveur (`/suite/overview`) ; aucun paiement en ligne.
 */
const APP_STYLE: Record<string, { icon: typeof Ticket; tile: string; soft: string }> = {
  OCALL_PARK: { icon: Ticket, tile: 'bg-suite-clay text-suite-ivory', soft: 'bg-suite-clay-soft' },
  OCALL_SCHOOL: {
    icon: GraduationCap,
    tile: 'bg-suite-green text-suite-ivory',
    soft: 'bg-suite-green-soft',
  },
  OCALL_FACTURE: {
    icon: Receipt,
    tile: 'bg-suite-wine text-suite-ivory',
    soft: 'bg-suite-wine-soft',
  },
  OCALL_STOCK: { icon: Package, tile: 'bg-suite-gold text-suite-ink', soft: 'bg-suite-gold-soft' },
};
const style = (code: string) => APP_STYLE[code] ?? APP_STYLE.OCALL_SCHOOL!;

export function SuitePortal({
  organizationName,
  firstName,
}: {
  organizationName: string;
  firstName: string;
}) {
  const apps = useApi<SuitePortalApp[]>('/suite/overview');
  const mine = apps.state === 'success' ? apps.data.filter((a) => a.access !== 'none') : [];
  const others = apps.state === 'success' ? apps.data.filter((a) => a.access === 'none') : [];
  return (
    <div className="min-h-screen bg-suite-ivory">
      <header className="border-b border-suite-ink/5 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <SuiteLogo />
          <LogoutButton className="text-suite-ink-soft hover:bg-suite-ivory" />
        </div>
        <div aria-hidden className="suite-frieze h-2" />
      </header>
      <main className="mx-auto max-w-5xl space-y-10 px-4 py-10 sm:px-6">
        <div>
          <p className="inline-flex rounded-full bg-suite-gold-soft px-3 py-1 text-xs font-semibold text-suite-ink">
            {organizationName}
          </p>
          <h1 className="mt-3 font-display text-3xl font-extrabold text-suite-green sm:text-4xl">
            Bonjour {firstName}
          </h1>
          <p className="mt-1 text-suite-ink-soft">Choisissez votre application.</p>
        </div>
        {apps.state === 'loading' && <LoadingState />}
        {apps.state === 'error' && <ErrorState error={apps.error} onRetry={apps.reload} />}
        {apps.state === 'success' && (
          <>
            <section aria-labelledby="mes-applications" className="space-y-4">
              <h2 id="mes-applications" className="font-display text-xl font-bold text-suite-ink">
                Mes applications
              </h2>
              {mine.length === 0 ? (
                <Alert tone="info" title="Aucune application ouverte">
                  Aucune application n’est encore ouverte pour votre organisation. Démarrez un essai
                  gratuit ou demandez une activation ci-dessous.
                </Alert>
              ) : (
                <ul className="grid gap-5 sm:grid-cols-2" data-testid="suite-apps">
                  {mine.map((app) => (
                    <li key={app.code}>
                      <AppCard app={app} onChange={apps.reload} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {others.length > 0 && (
              <section aria-labelledby="autres-applications" className="space-y-4">
                <h2
                  id="autres-applications"
                  className="font-display text-xl font-bold text-suite-ink"
                >
                  Découvrir d’autres applications
                </h2>
                <ul className="grid gap-5 sm:grid-cols-2" data-testid="suite-catalog">
                  {others.map((app) => (
                    <li key={app.code}>
                      <AppCard app={app} onChange={apps.reload} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function AppCard({ app, onChange }: { app: SuitePortalApp; onChange: () => void }) {
  const s = style(app.code);
  const Icon = s.icon;
  const [panel, setPanel] = useState<'none' | 'activation' | 'contract'>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function startTrial() {
    setBusy(true);
    setError(null);
    try {
      await api(`/suite/apps/${app.code}/trial`, { method: 'POST' });
      setNotice('Votre essai gratuit a démarré.');
      onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.'));
    } finally {
      setBusy(false);
    }
  }

  const statusLabel = app.subscription
    ? COMMERCIAL_STATE_LABELS[app.subscription.state]
    : (PUBLIC_PRODUCT_STATUS_LABELS[app.productStatus] ?? null);

  return (
    <article
      className="flex h-full flex-col overflow-hidden rounded-3xl border border-suite-ink/5 bg-white shadow-card"
      data-testid={`suite-app-${app.code}`}
    >
      <div className={`relative flex items-center gap-4 p-5 ${s.soft}`}>
        <span aria-hidden className="suite-pattern absolute inset-0 opacity-60" />
        <span
          className={`relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${s.tile}`}
        >
          <Icon className="h-6 w-6" aria-hidden />
        </span>
        <span className="relative min-w-0 flex-1">
          <span className="block font-display text-xl font-extrabold text-suite-ink">
            {app.href ? (
              <Link href={app.href} className="hover:underline">
                {app.name}
              </Link>
            ) : (
              app.name
            )}
          </span>
          <span className="block text-sm text-suite-ink-soft">{app.tagline}</span>
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 px-5 py-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {statusLabel && (
            <span className="rounded-full bg-suite-ivory px-2.5 py-1 text-xs font-semibold text-suite-ink">
              {statusLabel}
            </span>
          )}
          {app.access === 'read_only' && (
            <span className="rounded-full bg-suite-gold-soft px-2.5 py-1 text-xs font-semibold text-suite-ink">
              Consultation seule
            </span>
          )}
          {app.trial?.active && (
            <span className="rounded-full bg-suite-green-soft px-2.5 py-1 text-xs font-semibold text-suite-green">
              {app.trial.daysRemaining > 1
                ? `${app.trial.daysRemaining} jours d’essai restants`
                : 'Dernier jour d’essai'}
            </span>
          )}
        </div>
        {app.subscription && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-suite-ink-soft">
            <dt>Offre</dt>
            <dd className="text-suite-ink">
              {app.subscription.includesShowcase ? 'Avec site vitrine' : 'Sans site vitrine'}
            </dd>
            <dt>Tarif mensuel</dt>
            <dd className="text-suite-ink">{formatXof(app.subscription.monthlyPrice)}</dd>
            {app.subscription.expiresAt && (
              <>
                <dt>Renouvellement</dt>
                <dd className="text-suite-ink">{day(app.subscription.expiresAt)}</dd>
              </>
            )}
          </dl>
        )}
        {notice && (
          <p className="text-suite-green" role="status">
            {notice}
          </p>
        )}
        <ApiErrorAlert error={error} />
        {panel === 'activation' && (
          <ActivationForm
            app={app}
            onDone={(msg) => {
              setNotice(msg);
              setPanel('none');
              onChange();
            }}
          />
        )}
        {panel === 'contract' && <ContractPanel code={app.code} />}
        <div className="mt-auto flex flex-wrap gap-2 pt-2">
          {app.href && (
            <Link
              href={app.href}
              className="inline-flex items-center gap-1.5 rounded-xl bg-suite-green px-4 py-2 font-semibold text-suite-ivory hover:bg-suite-green-dark"
            >
              Ouvrir <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          )}
          {app.canStartTrial && (
            <Button size="sm" onClick={startTrial} disabled={busy}>
              <Sparkles className="h-4 w-4" aria-hidden /> Démarrer l’essai gratuit
            </Button>
          )}
          {app.canRequestActivation && app.plans.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setPanel(panel === 'activation' ? 'none' : 'activation')}
              aria-expanded={panel === 'activation'}
            >
              Demander l’activation
            </Button>
          )}
          {app.subscription && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPanel(panel === 'contract' ? 'none' : 'contract')}
              aria-expanded={panel === 'contract'}
            >
              <FileText className="h-4 w-4" aria-hidden /> Contrat
            </Button>
          )}
          {!app.href && app.slug && (
            <Link
              href={`/solutions/${app.slug}`}
              className="inline-flex items-center gap-1 px-2 py-2 font-semibold text-suite-green"
            >
              Découvrir <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}

/** Choix de l'offre et montant de souscription ; le règlement se fait hors plateforme. */
function ActivationForm({ app, onDone }: { app: SuitePortalApp; onDone: (msg: string) => void }) {
  const [planId, setPlanId] = useState(app.plans[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const plan = app.plans.find((p) => p.id === planId);
  const quote = plan ? quoteSubscription(plan, app.setupFeeStatus) : null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api(`/suite/apps/${app.code}/activation-request`, { method: 'POST', body: { planId } });
      onDone(
        'Demande d’activation envoyée. Ocall vous contacte pour le règlement, puis active votre abonnement.',
      );
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="space-y-2 rounded-2xl border border-suite-ink/10 p-3">
      <legend className="px-1 font-semibold text-suite-ink">Choisissez votre offre</legend>
      {app.plans.map((p) => (
        <label key={p.id} className="flex items-center gap-2">
          <input
            type="radio"
            name={`plan-${app.code}`}
            value={p.id}
            checked={planId === p.id}
            onChange={() => setPlanId(p.id)}
          />
          <span>
            {p.includesShowcase ? 'Avec site vitrine' : 'Sans site vitrine'} —{' '}
            {formatXof(p.monthlyPrice)} / mois
          </span>
        </label>
      ))}
      {quote && (
        <p className="text-suite-ink-soft" data-testid="activation-quote">
          {quote.setupFee > 0
            ? `Mise en service et formation : ${formatXof(quote.setupFee)} (une seule fois). `
            : 'Mise en service déjà réglée ou non due. '}
          Première échéance :{' '}
          <strong className="text-suite-ink">{formatXof(quote.firstPayment)}</strong>, puis{' '}
          {formatXof(quote.recurring)} par mois.
        </p>
      )}
      <p className="text-xs text-suite-ink-soft">
        Le règlement se fait hors plateforme ; Ocall vérifie le paiement puis active votre
        abonnement.
      </p>
      <ApiErrorAlert error={error} />
      <Button size="sm" onClick={submit} disabled={busy || !planId}>
        Envoyer la demande
      </Button>
    </fieldset>
  );
}

interface ContractView {
  state: keyof typeof COMMERCIAL_STATE_LABELS;
  plan: { name: string; includesShowcase: boolean };
  agreedMonthlyPrice: number | null;
  startedAt: string | null;
  expiresAt: string | null;
  trial: { startedAt: string; endsAt: string; daysRemaining: number } | null;
  setupFee: { status: SetupFeeStatus; amount: number } | null;
  events: { type: string; reason: string | null; createdAt: string }[];
}

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'UTC' }) : '—';

function ContractPanel({ code }: { code: string }) {
  const contract = useApi<ContractView>(`/suite/apps/${code}/contract`);
  if (contract.state === 'loading') return <LoadingState />;
  if (contract.state === 'error') return <ApiErrorAlert error={contract.error} />;
  const c = contract.data;
  return (
    <div
      className="space-y-2 rounded-2xl border border-suite-ink/10 p-3"
      data-testid="suite-contract"
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-suite-ink-soft">
        <dt>Statut</dt>
        <dd className="text-suite-ink">{COMMERCIAL_STATE_LABELS[c.state]}</dd>
        <dt>Offre</dt>
        <dd className="text-suite-ink">{c.plan.name}</dd>
        <dt>Tarif contractuel</dt>
        <dd className="text-suite-ink">
          {c.agreedMonthlyPrice !== null
            ? `${formatXof(c.agreedMonthlyPrice)} / mois`
            : 'Fixé à l’activation'}
        </dd>
        <dt>Mise en service</dt>
        <dd className="text-suite-ink">
          {c.setupFee
            ? `${formatXof(c.setupFee.amount)} — ${SETUP_FEE_STATUS_LABELS[c.setupFee.status]}`
            : 'Non facturée'}
        </dd>
        {c.trial && (
          <>
            <dt>Essai</dt>
            <dd className="text-suite-ink">
              du {day(c.trial.startedAt)} au {day(c.trial.endsAt)}
            </dd>
          </>
        )}
        <dt>Activation</dt>
        <dd className="text-suite-ink">{day(c.startedAt)}</dd>
        <dt>Échéance</dt>
        <dd className="text-suite-ink">{day(c.expiresAt)}</dd>
      </dl>
      {c.events.length > 0 && (
        <details>
          <summary className="cursor-pointer font-semibold text-suite-ink">Historique</summary>
          <ul className="mt-1 space-y-1 text-xs text-suite-ink-soft">
            {c.events.map((e, i) => (
              <li key={i}>
                {day(e.createdAt)} — {e.reason ?? e.type}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

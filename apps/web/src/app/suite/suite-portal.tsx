'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ArrowRight,
  Bell,
  CalendarClock,
  FileText,
  GraduationCap,
  Hourglass,
  LayoutGrid,
  Package,
  Receipt,
  RefreshCw,
  Repeat,
  Sparkles,
  Ticket,
} from 'lucide-react';
import {
  COMMERCIAL_STATE_LABELS,
  PUBLIC_PRODUCT_STATUS_LABELS,
  SETUP_FEE_STATUS_LABELS,
  SUITE_REQUEST_KIND_LABELS,
  SUITE_REQUEST_STATUS_LABELS,
  type SetupFeeStatus,
  type SuitePortalApp,
  type SuiteRequestKind,
  formatXof,
  quoteSubscription,
} from '@ocall/shared';
import { SuiteShell } from '@/components/suite/suite-shell';
import { Button } from '@/components/ui/button';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

/**
 * Portail Ocall Suite : synthèse (applications, prochaine échéance, demandes, notifications),
 * applications souscrites et disponibles, essais et jours restants, statut, tarif contractuel et option
 * vitrine, actions réelles (essai, activation, renouvellement, changement d'offre, contrat). Toutes les
 * décisions viennent du serveur (`/suite/overview`) ; aucun paiement en ligne.
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

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'UTC' }) : '—';
const days = (n: number) => (n === 1 ? '1 jour' : `${n} jours`);

/** Prochaine échéance : fin d'essai en cours ou échéance payante, la plus proche. */
function nextDue(apps: SuitePortalApp[]): { app: SuitePortalApp; at: string; days: number } | null {
  const now = Date.now();
  const due = apps.flatMap((a) => {
    const out: { app: SuitePortalApp; at: string; days: number }[] = [];
    if (a.trial?.active && a.subscription?.state === 'TRIAL_ACTIVE') {
      out.push({ app: a, at: a.trial.endsAt, days: a.trial.daysRemaining });
    }
    if (a.subscription?.expiresAt && Date.parse(a.subscription.expiresAt) > now) {
      out.push({ app: a, at: a.subscription.expiresAt, days: a.subscription.daysRemaining ?? 0 });
    }
    return out;
  });
  return due.sort((x, y) => Date.parse(x.at) - Date.parse(y.at))[0] ?? null;
}

export function SuitePortal({
  organizationName,
  firstName,
}: {
  organizationName: string;
  firstName: string;
}) {
  const apps = useApi<SuitePortalApp[]>('/suite/overview');
  const unread = useApi<{ unread: number }>('/suite/notifications/unread-count');
  const mine = apps.state === 'success' ? apps.data.filter((a) => a.access !== 'none') : [];
  const others = apps.state === 'success' ? apps.data.filter((a) => a.access === 'none') : [];
  // Échéance de tout abonnement, même pour une application dont l'accès est fermé (activité non ouverte).
  const due = nextDue(apps.state === 'success' ? apps.data : []);
  const pending = apps.state === 'success' ? apps.data.filter((a) => a.pendingRequest) : [];
  return (
    <SuiteShell>
      <main className="mx-auto max-w-5xl space-y-10 px-4 py-10 sm:px-6">
        <div>
          <p
            className="inline-flex rounded-full bg-suite-gold-soft px-3 py-1 text-xs font-semibold text-suite-ink"
            data-testid="suite-organization"
          >
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
            <section aria-label="Synthèse" data-testid="suite-summary">
              <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <SummaryTile
                  icon={<LayoutGrid className="h-5 w-5" aria-hidden />}
                  label="Applications ouvertes"
                  value={String(mine.length)}
                  hint={`${others.length} autre${others.length > 1 ? 's' : ''} disponible${others.length > 1 ? 's' : ''}`}
                />
                <SummaryTile
                  icon={<CalendarClock className="h-5 w-5" aria-hidden />}
                  label="Prochaine échéance"
                  value={due ? day(due.at) : '—'}
                  hint={due ? `${due.app.name} · dans ${days(due.days)}` : 'Aucune échéance proche'}
                  testId="suite-next-due"
                />
                <SummaryTile
                  icon={<Hourglass className="h-5 w-5" aria-hidden />}
                  label="Demandes en attente"
                  value={String(pending.length)}
                  hint={
                    pending.length > 0
                      ? pending
                          .map(
                            (a) => `${SUITE_REQUEST_KIND_LABELS[a.pendingRequest!.kind]} ${a.name}`,
                          )
                          .join(', ')
                      : 'Aucune demande en cours'
                  }
                />
                <SummaryTile
                  icon={<Bell className="h-5 w-5" aria-hidden />}
                  label="Notifications non lues"
                  value={unread.state === 'success' ? String(unread.data.unread) : '—'}
                  hint={
                    <Link href="/suite/notifications" className="font-semibold text-suite-green">
                      Voir les notifications
                    </Link>
                  }
                />
              </ul>
            </section>
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
    </SuiteShell>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  hint,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: React.ReactNode;
  testId?: string;
}) {
  return (
    <li
      className="min-w-0 rounded-2xl border border-suite-ink/5 bg-white p-4 shadow-card"
      data-testid={testId}
    >
      <div className="flex items-center gap-2 text-suite-ink-soft">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-suite-green-soft text-suite-green">
          {icon}
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 font-display text-2xl font-extrabold text-suite-ink">{value}</p>
      <p className="mt-1 break-words text-xs text-suite-ink-soft">{hint}</p>
    </li>
  );
}

type Panel = 'none' | 'contract' | SuiteRequestKind;

const REQUEST_ACTIONS: Record<SuiteRequestKind, { label: string; icon: typeof RefreshCw }> = {
  ACTIVATION: { label: 'Demander l’activation', icon: Sparkles },
  RENEWAL: { label: 'Demander le renouvellement', icon: RefreshCw },
  PLAN_CHANGE: { label: 'Changer d’offre', icon: Repeat },
};

function AppCard({ app, onChange }: { app: SuitePortalApp; onChange: () => void }) {
  const s = style(app.code);
  const Icon = s.icon;
  const [panel, setPanel] = useState<Panel>('none');
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
  const remaining = app.subscription?.daysRemaining ?? null;
  const toggle = (p: Panel) => setPanel(panel === p ? 'none' : p);

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
          {app.pendingRequest && (
            <span
              className="rounded-full bg-suite-gold-soft px-2.5 py-1 text-xs font-semibold text-suite-ink"
              data-testid="suite-pending-request"
            >
              {SUITE_REQUEST_KIND_LABELS[app.pendingRequest.kind]} demandé le{' '}
              {day(app.pendingRequest.createdAt)}
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
                <dt>Échéance</dt>
                <dd className="text-suite-ink">{day(app.subscription.expiresAt)}</dd>
              </>
            )}
            {remaining !== null && (
              <>
                <dt>Jours restants</dt>
                <dd
                  className={
                    remaining <= 7 ? 'font-semibold text-suite-clay-text' : 'text-suite-ink'
                  }
                  data-testid="suite-days-remaining"
                >
                  {remaining > 0 ? days(remaining) : 'Échéance dépassée'}
                </dd>
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
        {(panel === 'ACTIVATION' || panel === 'RENEWAL' || panel === 'PLAN_CHANGE') && (
          <RequestForm
            key={`${app.code}-${panel}`}
            app={app}
            kind={panel}
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
          {app.plans.length > 0 &&
            app.requestKinds.map((kind) => {
              const A = REQUEST_ACTIONS[kind];
              return (
                <Button
                  key={kind}
                  size="sm"
                  variant="secondary"
                  onClick={() => toggle(kind)}
                  aria-expanded={panel === kind}
                >
                  <A.icon className="h-4 w-4" aria-hidden /> {A.label}
                </Button>
              );
            })}
          {app.subscription && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => toggle('contract')}
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

const DONE: Record<SuiteRequestKind, string> = {
  ACTIVATION:
    'Demande d’activation envoyée. Ocall vous contacte pour le règlement, puis active votre abonnement.',
  RENEWAL:
    'Demande de renouvellement envoyée. Ocall vérifie le règlement puis prolonge votre abonnement.',
  PLAN_CHANGE: 'Demande de changement d’offre envoyée. Ocall vous recontacte pour la confirmer.',
};

/**
 * Demande d'activation (choix de l'offre), de renouvellement (offre en cours, tarif contractuel) ou de
 * changement d'offre (autre offre, tarif en vigueur). Le règlement se fait hors plateforme.
 */
function RequestForm({
  app,
  kind,
  onDone,
}: {
  app: SuitePortalApp;
  kind: SuiteRequestKind;
  onDone: (msg: string) => void;
}) {
  const currentPlan = app.subscription?.planId ?? null;
  const choices =
    kind === 'PLAN_CHANGE' ? app.plans.filter((p) => p.id !== currentPlan) : app.plans;
  const [planId, setPlanId] = useState(
    kind === 'RENEWAL' ? (currentPlan ?? '') : (choices[0]?.id ?? ''),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const plan = app.plans.find((p) => p.id === planId);
  const quote = plan && kind !== 'RENEWAL' ? quoteSubscription(plan, app.setupFeeStatus) : null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api(`/suite/apps/${app.code}/activation-request`, {
        method: 'POST',
        body: { planId, kind },
      });
      onDone(DONE[kind]);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset
      className="space-y-2 rounded-2xl border border-suite-ink/10 p-3"
      data-testid={`suite-request-${kind}`}
    >
      <legend className="px-1 font-semibold text-suite-ink">
        {kind === 'RENEWAL'
          ? 'Renouveler l’abonnement'
          : kind === 'PLAN_CHANGE'
            ? 'Choisissez la nouvelle offre'
            : 'Choisissez votre offre'}
      </legend>
      {kind === 'RENEWAL' && app.subscription ? (
        <p className="text-suite-ink-soft" data-testid="renewal-quote">
          Offre en cours :{' '}
          <strong className="text-suite-ink">
            {app.subscription.includesShowcase ? 'avec site vitrine' : 'sans site vitrine'}
          </strong>{' '}
          — tarif contractuel{' '}
          <strong className="text-suite-ink">{formatXof(app.subscription.monthlyPrice)}</strong> par
          mois, conservé au renouvellement.
        </p>
      ) : (
        choices.map((p) => (
          <label key={p.id} className="flex items-center gap-2">
            <input
              type="radio"
              name={`plan-${app.code}-${kind}`}
              value={p.id}
              checked={planId === p.id}
              onChange={() => setPlanId(p.id)}
            />
            <span>
              {p.includesShowcase ? 'Avec site vitrine' : 'Sans site vitrine'} —{' '}
              {formatXof(p.monthlyPrice)} / mois
            </span>
          </label>
        ))
      )}
      {quote && kind === 'ACTIVATION' && (
        <p className="text-suite-ink-soft" data-testid="activation-quote">
          {quote.setupFee > 0
            ? `Mise en service et formation : ${formatXof(quote.setupFee)} (une seule fois). `
            : 'Mise en service déjà réglée ou non due. '}
          Première échéance :{' '}
          <strong className="text-suite-ink">{formatXof(quote.firstPayment)}</strong>, puis{' '}
          {formatXof(quote.recurring)} par mois.
        </p>
      )}
      {quote && kind === 'PLAN_CHANGE' && (
        <p className="text-suite-ink-soft">
          Nouveau tarif : <strong className="text-suite-ink">{formatXof(quote.recurring)}</strong>{' '}
          par mois, au tarif en vigueur de cette offre.
        </p>
      )}
      <p className="text-xs text-suite-ink-soft">
        Le règlement se fait hors plateforme ; Ocall vérifie le paiement puis applique votre
        demande.
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

interface RequestView {
  id: string;
  kind: SuiteRequestKind;
  status: 'PENDING' | 'HANDLED' | 'CANCELLED';
  planName: string;
  quotedMonthly: number;
  createdAt: string;
  handledAt: string | null;
  reason: string | null;
}

function ContractPanel({ code }: { code: string }) {
  const contract = useApi<ContractView>(`/suite/apps/${code}/contract`);
  const requests = useApi<RequestView[]>(`/suite/apps/${code}/requests`);
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
      {requests.state === 'success' && requests.data.length > 0 && (
        <details data-testid="suite-requests">
          <summary className="cursor-pointer font-semibold text-suite-ink">
            Demandes ({requests.data.length})
          </summary>
          <ul className="mt-1 space-y-1 text-xs text-suite-ink-soft">
            {requests.data.map((r) => (
              <li key={r.id}>
                {day(r.createdAt)} — {SUITE_REQUEST_KIND_LABELS[r.kind]} ({r.planName},{' '}
                {formatXof(r.quotedMonthly)} / mois) :{' '}
                <span className="font-semibold text-suite-ink">
                  {SUITE_REQUEST_STATUS_LABELS[r.status]}
                </span>
                {r.reason ? ` — ${r.reason}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
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

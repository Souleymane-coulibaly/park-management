'use client';

import {
  BUSINESS_TYPE_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  type SaasStats,
  type SubscriptionStatus,
  formatXof,
} from '@ocall/shared';
import { BarChart, Section, StatTile, formatInt } from '@/components/analytics/charts';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { formatDate, formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/use-api';

const MONTHS = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

/**
 * Statistiques SaaS d'Ocall : organisations, abonnements, offres, encaissements SaaS VALIDÉS et
 * échéances. Jamais mélangées aux recettes des établissements clients.
 */
export default function SaasStatsPage() {
  const stats = useApi<SaasStats>('/platform/saas-stats');
  return (
    <>
      <PageHeader
        eyebrow="Super Admin"
        title="Statistiques SaaS"
        description="Abonnements payés directement à Ocall, hors plateforme, et validés manuellement. Les recettes des établissements clients n’apparaissent jamais ici."
      />
      {stats.state === 'loading' && <LoadingState />}
      {stats.state === 'error' && <ErrorState error={stats.error} onRetry={stats.reload} />}
      {stats.state === 'success' && <Stats data={stats.data} />}
    </>
  );
}

function Stats({ data: d }: { data: SaasStats }) {
  const s = d.subscriptions.byStatus;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Organisations clientes"
          value={d.organizations.total}
          hint={`${d.organizations.suspended} suspendue(s)`}
          testId="saas-orgs"
        />
        <StatTile
          label="Abonnements actifs"
          value={s.ACTIVE ?? 0}
          hint={
            d.subscriptions.activeButOverdue > 0
              ? `${d.subscriptions.activeButOverdue} échéance(s) dépassée(s) à vérifier`
              : 'aucune échéance dépassée'
          }
          testId="saas-active"
        />
        <StatTile
          label="Abonnements expirés"
          value={s.EXPIRED ?? 0}
          hint={`${s.PAST_DUE ?? 0} en retard de paiement`}
        />
        <StatTile label="Organisations suspendues" value={d.organizations.suspended} />
        <StatTile
          label="Encaissements SaaS validés"
          value={d.payments.validatedTotal}
          format={formatXof}
          hint={`${d.payments.validatedCount} règlement(s)`}
          testId="saas-validated"
        />
        <StatTile
          label="Validés ce mois-ci"
          value={d.payments.validatedThisMonth}
          format={formatXof}
        />
        <StatTile
          label="Règlements à vérifier"
          value={d.payments.pending.count}
          hint={formatXof(d.payments.pending.amount)}
          testId="saas-pending"
        />
        <StatTile
          label="Revenu mensuel théorique"
          value={d.theoreticalMonthlyRevenue}
          format={formatXof}
          hint="prix des offres actives — pas un encaissement"
        />
      </div>

      <Section
        title="Encaissements SaaS validés par mois"
        description="Règlements validés par le Super Admin, par mois de règlement (12 derniers mois)."
      >
        <BarChart
          label="Encaissements SaaS validés par mois"
          data={d.payments.byMonth.map((m) => ({
            key: m.month,
            label: monthLabel(m.month),
            value: m.amount,
          }))}
          format={formatXof}
        />
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Abonnements par statut">
          <ul className="space-y-2 text-sm">
            {(Object.keys(SUBSCRIPTION_STATUS_LABELS) as SubscriptionStatus[]).map((st) => (
              <li key={st} className="flex justify-between">
                <span>{SUBSCRIPTION_STATUS_LABELS[st]}</span>
                <span className="font-semibold tabular-nums">{formatInt(s[st] ?? 0)}</span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Répartition des offres">
          <Table head={['Offre', 'Métier', 'Prix mensuel', 'Abonnements', 'Actifs']}>
            {d.plans.map((p) => (
              <tr key={p.planId}>
                <Td className="font-medium">{p.name}</Td>
                <Td>{BUSINESS_TYPE_LABELS[p.businessType]}</Td>
                <Td className="tabular-nums">{formatXof(p.monthlyPrice)}</Td>
                <Td className="tabular-nums">{formatInt(p.subscriptions)}</Td>
                <Td className="tabular-nums">{formatInt(p.active)}</Td>
              </tr>
            ))}
          </Table>
        </Section>
      </div>

      <Section
        title="Renouvellements à venir"
        description="Abonnements actifs arrivant à échéance dans les 30 jours, ou déjà échus. Aucun renouvellement automatique : à traiter après réception et validation d’un règlement."
      >
        {d.renewals.length === 0 ? (
          <Alert tone="info">Aucune échéance dans les 30 prochains jours.</Alert>
        ) : (
          <Table head={['Organisation', 'Offre', 'Échéance', 'Statut', 'Dernier règlement validé']}>
            {d.renewals.map((r) => (
              <tr key={r.subscriptionId} data-testid="renewal-row">
                <Td className="font-medium">
                  {r.organization.name}
                  {r.organization.status === 'SUSPENDED' && (
                    <span className="ml-2">
                      <Badge tone="terracotta">Suspendue</Badge>
                    </span>
                  )}
                </Td>
                <Td>
                  {r.plan} · {formatXof(r.monthlyPrice)}
                </Td>
                <Td>{formatDate(r.expiresAt)}</Td>
                <Td>
                  {r.daysLeft < 0 ? (
                    <Badge tone="terracotta">Échue depuis {-r.daysLeft} j</Badge>
                  ) : (
                    <Badge tone="savanna">Dans {r.daysLeft} j</Badge>
                  )}
                </Td>
                <Td>
                  {r.lastValidatedPayment
                    ? `${formatXof(r.lastValidatedPayment.amount)} le ${formatDate(r.lastValidatedPayment.paidAt)}`
                    : 'Aucun'}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section
        title="Historique des abonnements"
        description="30 derniers événements (création, changement d’offre, changement de statut)."
      >
        {d.history.length === 0 ? (
          <p className="text-sm text-muted">Aucun événement.</p>
        ) : (
          <ul className="divide-y divide-line/70 text-sm">
            {d.history.map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{e.organization}</span> ·{' '}
                  {e.type === 'CREATED'
                    ? 'Abonnement créé'
                    : e.type === 'PLAN_CHANGED'
                      ? `Offre : ${e.fromPlan ?? '—'} → ${e.toPlan ?? '—'}`
                      : `Statut : ${e.fromStatus ? SUBSCRIPTION_STATUS_LABELS[e.fromStatus] : '—'} → ${e.toStatus ? SUBSCRIPTION_STATUS_LABELS[e.toStatus] : '—'}`}
                  {e.reason && <span className="block text-muted">{e.reason}</span>}
                </span>
                <span className="text-muted">{formatDateTime(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

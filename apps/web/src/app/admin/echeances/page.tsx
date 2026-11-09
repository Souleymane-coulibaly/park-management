'use client';

import { useState } from 'react';
import { Bell, CalendarClock, History, Inbox } from 'lucide-react';
import {
  COMMERCIAL_STATE_LABELS,
  type CommercialState,
  SUITE_REQUEST_KIND_LABELS,
  SUITE_REQUEST_KINDS,
  SUITE_REQUEST_STATUS_LABELS,
  type SuiteRequestKind,
  formatXof,
} from '@ocall/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { ApiError, api } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/use-api';

interface OrgRef {
  id: string;
  name: string;
  code: string;
}
interface ProductRef {
  code: string;
  name: string;
}
interface DueSoon {
  subscriptions: {
    id: string;
    organization: OrgRef;
    product: ProductRef;
    planName: string;
    includesShowcase: boolean;
    monthlyPrice: number;
    status: string;
    state: CommercialState;
    expiresAt: string;
    daysRemaining: number;
  }[];
  trials: {
    id: string;
    organization: OrgRef;
    product: ProductRef;
    endsAt: string;
    daysRemaining: number;
    expired: boolean;
    subscriptionStatus: string | null;
  }[];
}
interface RequestRow {
  id: string;
  kind: SuiteRequestKind;
  status: 'PENDING' | 'HANDLED' | 'CANCELLED';
  quotedSetupFee: number;
  quotedMonthly: number;
  note: string | null;
  createdAt: string;
  handledAt: string | null;
  organization: OrgRef;
  product: ProductRef;
}
interface SentNotification {
  organization: OrgRef;
  kind: string;
  productCode: string | null;
  recipients: number;
  read: number;
  createdAt: string;
}
interface JobRun {
  id: string;
  job: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  trigger: string;
  stats: Record<string, number> | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

const PRODUCTS = [
  { value: '', label: 'Toutes les applications' },
  { value: 'OCALL_PARK', label: 'Ocall Park' },
  { value: 'OCALL_SCHOOL', label: 'Ocall School' },
];

const NOTIFICATION_LABELS: Record<string, string> = {
  TRIAL_STARTED: 'Essai démarré',
  TRIAL_ENDING: 'Fin d’essai proche',
  TRIAL_EXPIRED: 'Essai terminé',
  SUBSCRIPTION_ENDING: 'Échéance proche',
  SUBSCRIPTION_EXPIRED: 'Abonnement expiré',
  REQUEST_RECEIVED: 'Demande reçue',
  REQUEST_HANDLED: 'Demande traitée',
  REQUEST_REFUSED: 'Demande refusée',
  ACTIVATION_CONFIRMED: 'Activation confirmée',
  SUSPENDED: 'Suspension',
  REACTIVATED: 'Réactivation',
  SMS_TOPUP_APPROVED: 'Recharge SMS validée',
  SMS_TOPUP_REJECTED: 'Recharge SMS refusée',
};

const toError = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.');
const days = (n: number) => (n === 1 ? '1 jour' : `${n} jours`);

/**
 * Super Admin — échéances et renouvellements (Sprint S2) : contrats et essais arrivant à échéance
 * (filtres application, horizon), demandes de renouvellement et de changement d'offre, notifications
 * émises et historique du traitement planifié des rappels (relance manuelle).
 */
export default function AdminEcheancesPage() {
  const [product, setProduct] = useState('');
  const [horizon, setHorizon] = useState('30');
  const [kind, setKind] = useState<SuiteRequestKind | ''>('RENEWAL');
  const [status, setStatus] = useState<'PENDING' | 'HANDLED' | 'CANCELLED'>('PENDING');
  const due = useApi<DueSoon>(
    `/platform/suite-notifications/due-soon?days=${horizon}${product ? `&productCode=${product}` : ''}`,
  );
  const requests = useApi<RequestRow[]>(
    `/platform/suite-commercial/activation-requests?status=${status}${kind ? `&kind=${kind}` : ''}${
      product ? `&productCode=${product}` : ''
    }`,
  );
  const sent = useApi<SentNotification[]>('/platform/suite-notifications');
  const runs = useApi<JobRun[]>('/platform/suite-notifications/job-runs');
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<ApiError | null>(null);

  async function runNow() {
    setRunning(true);
    setRunError(null);
    try {
      await api('/platform/suite-notifications/run-reminders', { method: 'POST' });
      runs.reload();
      sent.reload();
    } catch (e) {
      setRunError(toError(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Super Admin"
        title="Échéances et renouvellements"
        description="Contrats et essais à échéance, demandes des clients, rappels envoyés dans le portail Ocall Suite (J-7, J-3, J-1 et jour J)."
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:max-w-xl">
        <SelectField
          label="Application"
          value={product}
          onChange={(e) => setProduct(e.target.value)}
          options={PRODUCTS}
        />
        <SelectField
          label="Horizon"
          value={horizon}
          onChange={(e) => setHorizon(e.target.value)}
          options={[
            { value: '7', label: '7 jours' },
            { value: '30', label: '30 jours' },
            { value: '90', label: '90 jours' },
          ]}
        />
      </div>

      <Card className="mb-6">
        <CardHeader
          title="Abonnements à échéance"
          description="Tarif contractuel (historique conservé) ; les abonnements expirés depuis moins de 30 jours restent listés."
        />
        {due.state === 'loading' && <LoadingState />}
        {due.state === 'error' && <ErrorState error={due.error} onRetry={due.reload} />}
        {due.state === 'success' &&
          (due.data.subscriptions.length === 0 ? (
            <CardBody>
              <EmptyState
                icon={<CalendarClock className="h-6 w-6" aria-hidden />}
                title="Aucune échéance sur la période"
                description="Élargissez l’horizon ou changez d’application."
              />
            </CardBody>
          ) : (
            <Table head={['Organisation', 'Application', 'Offre', 'Échéance', 'État']}>
              {due.data.subscriptions.map((s) => (
                <tr key={s.id}>
                  <Td>
                    {s.organization.name}
                    <span className="ml-1 text-xs text-muted">{s.organization.code}</span>
                  </Td>
                  <Td>{s.product.name}</Td>
                  <Td>
                    {s.includesShowcase ? 'Avec vitrine' : 'Sans vitrine'}
                    <span className="block text-xs text-muted">
                      {formatXof(s.monthlyPrice)} / mois
                    </span>
                  </Td>
                  <Td>
                    {formatDate(s.expiresAt)}
                    <span className="block text-xs text-muted">
                      {s.daysRemaining > 0 ? `dans ${days(s.daysRemaining)}` : 'dépassée'}
                    </span>
                  </Td>
                  <Td>
                    <Badge
                      tone={
                        s.daysRemaining <= 0
                          ? 'terracotta'
                          : s.daysRemaining <= 7
                            ? 'savanna'
                            : 'forest'
                      }
                    >
                      {COMMERCIAL_STATE_LABELS[s.state]}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </Table>
          ))}
      </Card>

      <Card className="mb-6">
        <CardHeader
          title="Essais en cours et expirés"
          description="Essais non convertis : en cours, ou terminés depuis moins de 60 jours."
        />
        {due.state === 'success' &&
          (due.data.trials.length === 0 ? (
            <CardBody>
              <p className="text-sm text-muted">Aucun essai sur la période.</p>
            </CardBody>
          ) : (
            <Table head={['Organisation', 'Application', 'Fin d’essai', 'État']}>
              {due.data.trials.map((t) => (
                <tr key={t.id}>
                  <Td>{t.organization.name}</Td>
                  <Td>{t.product.name}</Td>
                  <Td>{formatDate(t.endsAt)}</Td>
                  <Td>
                    <Badge
                      tone={t.expired ? 'neutral' : t.daysRemaining <= 3 ? 'savanna' : 'forest'}
                    >
                      {t.expired ? 'Expiré' : `${days(t.daysRemaining)} restant(s)`}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </Table>
          ))}
      </Card>

      <Card className="mb-6">
        <CardHeader
          title="Demandes des clients"
          description="Renouvellements (tarif contractuel) et changements d’offre ; à clôturer dans Essais et activations après vérification du règlement."
        />
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-2 lg:max-w-xl">
            <SelectField
              label="Type"
              value={kind}
              onChange={(e) => setKind(e.target.value as SuiteRequestKind | '')}
              options={[
                { value: '', label: 'Tous les types' },
                ...SUITE_REQUEST_KINDS.map((k) => ({
                  value: k,
                  label: SUITE_REQUEST_KIND_LABELS[k],
                })),
              ]}
            />
            <SelectField
              label="Statut"
              value={status}
              onChange={(e) => setStatus(e.target.value as 'PENDING' | 'HANDLED' | 'CANCELLED')}
              options={(['PENDING', 'HANDLED', 'CANCELLED'] as const).map((s) => ({
                value: s,
                label: SUITE_REQUEST_STATUS_LABELS[s],
              }))}
            />
          </div>
        </CardBody>
        {requests.state === 'loading' && <LoadingState />}
        {requests.state === 'error' && (
          <ErrorState error={requests.error} onRetry={requests.reload} />
        )}
        {requests.state === 'success' &&
          (requests.data.length === 0 ? (
            <CardBody>
              <EmptyState
                icon={<Inbox className="h-6 w-6" aria-hidden />}
                title="Aucune demande"
                description="Aucune demande ne correspond à ces filtres."
              />
            </CardBody>
          ) : (
            <Table
              head={['Organisation', 'Application', 'Type', 'Montant', 'Demandée le', 'Statut']}
            >
              {requests.data.map((r) => (
                <tr key={r.id}>
                  <Td>{r.organization.name}</Td>
                  <Td>{r.product.name}</Td>
                  <Td>{SUITE_REQUEST_KIND_LABELS[r.kind]}</Td>
                  <Td>
                    {formatXof(r.quotedMonthly)} / mois
                    {r.quotedSetupFee > 0 && (
                      <span className="block text-xs text-muted">
                        + mise en service {formatXof(r.quotedSetupFee)}
                      </span>
                    )}
                  </Td>
                  <Td>{formatDate(r.createdAt)}</Td>
                  <Td>
                    {SUITE_REQUEST_STATUS_LABELS[r.status]}
                    {r.note && <span className="block text-xs text-muted">{r.note}</span>}
                  </Td>
                </tr>
              ))}
            </Table>
          ))}
      </Card>

      <Card className="mb-6">
        <CardHeader
          title="Notifications émises"
          description="Une ligne par fait notifié : destinataires et lectures (sans contenu personnel)."
        />
        {sent.state === 'loading' && <LoadingState />}
        {sent.state === 'error' && <ErrorState error={sent.error} onRetry={sent.reload} />}
        {sent.state === 'success' &&
          (sent.data.length === 0 ? (
            <CardBody>
              <EmptyState
                icon={<Bell className="h-6 w-6" aria-hidden />}
                title="Aucune notification émise"
                description="Les rappels et événements notifiés aux clients apparaissent ici."
              />
            </CardBody>
          ) : (
            <Table head={['Organisation', 'Notification', 'Destinataires', 'Lues', 'Date']}>
              {sent.data.map((n, i) => (
                <tr key={`${n.organization.id}-${i}`}>
                  <Td>{n.organization.name}</Td>
                  <Td>{NOTIFICATION_LABELS[n.kind] ?? n.kind}</Td>
                  <Td className="tabular-nums">{n.recipients}</Td>
                  <Td className="tabular-nums">{n.read}</Td>
                  <Td>{formatDateTime(n.createdAt)}</Td>
                </tr>
              ))}
            </Table>
          ))}
      </Card>

      <Card>
        <CardHeader
          title="Traitement des rappels"
          description="Exécuté chaque heure par une seule instance ; sans doublon, même relancé. Un échec est repris au passage suivant."
          action={
            <Button size="sm" variant="secondary" onClick={runNow} disabled={running}>
              <History className="h-4 w-4" aria-hidden /> Lancer maintenant
            </Button>
          }
        />
        <CardBody>
          <ApiErrorAlert error={runError} />
        </CardBody>
        {runs.state === 'loading' && <LoadingState />}
        {runs.state === 'error' && <ErrorState error={runs.error} onRetry={runs.reload} />}
        {runs.state === 'success' && runs.data.length > 0 && (
          <Table head={['Début', 'Déclenchement', 'Résultat', 'Rappels créés', 'Erreur']}>
            {runs.data.map((r) => (
              <tr key={r.id}>
                <Td>{formatDateTime(r.startedAt)}</Td>
                <Td>{r.trigger === 'manual' ? 'Manuel' : 'Planifié'}</Td>
                <Td>
                  <Badge
                    tone={
                      r.status === 'SUCCEEDED'
                        ? 'forest'
                        : r.status === 'FAILED'
                          ? 'terracotta'
                          : 'savanna'
                    }
                  >
                    {r.status === 'SUCCEEDED'
                      ? 'Réussi'
                      : r.status === 'FAILED'
                        ? 'Échec'
                        : 'En cours'}
                  </Badge>
                </Td>
                <Td className="tabular-nums">{r.stats?.created ?? 0}</Td>
                <Td>{r.error ?? '—'}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

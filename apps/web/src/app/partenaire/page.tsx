'use client';

import { useEffect, useState } from 'react';
import { Banknote, Building2, Link2, Percent, UserPlus } from 'lucide-react';
import {
  PARTNER_STATUS_LABELS,
  PROSPECT_STATUS_LABELS,
  type PartnerStatus,
  formatXof,
} from '@ocall/shared';
import { useSession } from '@/components/app/session-context';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/use-api';

interface Profile {
  code: string;
  companyName: string;
  status: PartnerStatus;
  territories: string[];
  cashCollectionEnabled: boolean;
  cashCollectionLimit: number;
}
interface Dashboard {
  prospects: Record<string, number>;
  clients: number;
  commissions: { accrued: number; validated: number; paid: number; reversed: number };
  recentPayouts: { number: string; total: number; paidAt: string }[];
}

/** Tableau de bord du partenaire : prospects, clients apportés, commissions, lien de parrainage. */
export default function PartnerHomePage() {
  const me = useSession();
  const active = me.partner?.status === 'ACTIVE';
  const profile = useApi<Profile>('/partner/profile');
  const dashboard = useApi<Dashboard>(active ? '/partner/dashboard' : null);
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);

  if (profile.state === 'loading') return <LoadingState />;
  if (profile.state === 'error')
    return <ErrorState error={profile.error} onRetry={profile.reload} />;
  const p = profile.data;
  return (
    <>
      <PageHeader
        eyebrow="Portail partenaire"
        title={p.companyName}
        description={`Statut : ${PARTNER_STATUS_LABELS[p.status]}${p.territories.length ? ` · Territoires : ${p.territories.join(', ')}` : ''}`}
      />
      {!active && (
        <Alert tone="info" title="Profil en cours de vérification">
          L’équipe Ocall vérifie votre profil. Vous pourrez enregistrer des prospects dès sa
          validation.
        </Alert>
      )}
      {active && (
        <>
          <Card className="mb-6">
            <CardHeader
              title="Votre lien de parrainage"
              description="Les demandes de démonstration envoyées depuis ce lien vous sont rattachées. L’attribution d’un client est confirmée par Ocall."
            />
            <CardBody className="space-y-2 text-sm">
              <p className="flex items-center gap-2 break-all font-mono">
                <Link2 className="h-4 w-4 shrink-0 text-forest" aria-hidden />
                {origin}/demo?ref={p.code}
              </p>
              <p className="text-muted">
                Code partenaire : <strong>{p.code}</strong>
              </p>
            </CardBody>
          </Card>
          {dashboard.state === 'loading' && <LoadingState />}
          {dashboard.state === 'error' && (
            <ErrorState error={dashboard.error} onRetry={dashboard.reload} />
          )}
          {dashboard.state === 'success' && (
            <>
              <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard
                  label="Prospects"
                  value={Object.values(dashboard.data.prospects).reduce((t, n) => t + n, 0)}
                  hint={Object.entries(dashboard.data.prospects)
                    .map(
                      ([s, n]) =>
                        `${PROSPECT_STATUS_LABELS[s as keyof typeof PROSPECT_STATUS_LABELS] ?? s} ${n}`,
                    )
                    .join(' · ')}
                  icon={<UserPlus className="h-5 w-5" />}
                />
                <KpiCard
                  label="Clients apportés"
                  value={dashboard.data.clients}
                  icon={<Building2 className="h-5 w-5" />}
                  accent="savanna"
                />
                <KpiCard
                  label="Commissions à venir"
                  value={
                    <span className="text-xl">
                      {formatXof(
                        dashboard.data.commissions.accrued + dashboard.data.commissions.validated,
                      )}
                    </span>
                  }
                  hint={`dont validées ${formatXof(dashboard.data.commissions.validated)}`}
                  icon={<Percent className="h-5 w-5" />}
                />
                <KpiCard
                  label="Commissions versées"
                  value={
                    <span className="text-xl">{formatXof(dashboard.data.commissions.paid)}</span>
                  }
                  icon={<Banknote className="h-5 w-5" />}
                  accent="savanna"
                />
              </div>
              <Card>
                <CardHeader title="Derniers versements" />
                <CardBody>
                  {dashboard.data.recentPayouts.length === 0 ? (
                    <p className="text-sm text-muted">Aucun versement pour le moment.</p>
                  ) : (
                    <ul className="divide-y divide-line/70 text-sm">
                      {dashboard.data.recentPayouts.map((v) => (
                        <li key={v.number} className="flex justify-between py-2">
                          <span>
                            {v.number} · {formatDate(v.paidAt)}
                          </span>
                          <span className="tabular-nums font-semibold">{formatXof(v.total)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>
            </>
          )}
        </>
      )}
    </>
  );
}

'use client';

import { useEffect, useState } from 'react';
import {
  Banknote,
  Building2,
  FileCheck2,
  Link2,
  Percent,
  TrendingUp,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import {
  PARTNER_STATUS_LABELS,
  PARTNER_TYPE_LABELS,
  type PartnerStatus,
  type PartnerType,
  formatXof,
} from '@ocall/shared';
import { useSession } from '@/components/app/session-context';
import { BalanceCard, type PartnerBalance } from '@/components/partner/balance-card';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/use-api';

interface Profile {
  code: string;
  type: PartnerType;
  companyName: string;
  status: PartnerStatus;
  territories: string[];
  links: { demo: string; signup: string };
}
interface Dashboard {
  kpis: {
    activeProspects: number;
    convertedProspects: number;
    clients: number;
    activeContracts: number;
    collected: number;
    commissionsEarned: number;
    commissionsPaid: number;
    payable: number;
  };
  balance: PartnerBalance;
  recentPayouts: { number: string; total: number; paidAt: string }[];
}

/**
 * Tableau de bord du partenaire (Sprint S3) : solde de primes, indicateurs réels (aucun chiffre
 * estimé), liens de recommandation, derniers règlements.
 */
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
  const k = dashboard.state === 'success' ? dashboard.data.kpis : null;
  const money = (n: number) => <span className="text-xl">{formatXof(n)}</span>;
  return (
    <>
      <PageHeader
        eyebrow={`Portail partenaire · ${PARTNER_TYPE_LABELS[p.type]}`}
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
          {dashboard.state === 'loading' && <LoadingState />}
          {dashboard.state === 'error' && (
            <ErrorState error={dashboard.error} onRetry={dashboard.reload} />
          )}
          {dashboard.state === 'success' && k && (
            <>
              <BalanceCard balance={dashboard.data.balance} />
              <div
                className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
                data-testid="partner-kpis"
              >
                <KpiCard
                  label="Prospects actifs"
                  value={k.activeProspects}
                  icon={<UserPlus className="h-5 w-5" />}
                />
                <KpiCard
                  label="Prospects convertis"
                  value={k.convertedProspects}
                  icon={<UserCheck className="h-5 w-5" />}
                  accent="savanna"
                />
                <KpiCard
                  label="Clients attribués"
                  value={k.clients}
                  icon={<Building2 className="h-5 w-5" />}
                />
                <KpiCard
                  label="Contrats actifs"
                  value={k.activeContracts}
                  icon={<FileCheck2 className="h-5 w-5" />}
                  accent="savanna"
                />
                <KpiCard
                  label="Encaissé attribué"
                  value={money(k.collected)}
                  hint="Encaissements confirmés depuis l’attribution"
                  icon={<TrendingUp className="h-5 w-5" />}
                />
                <KpiCard
                  label="Primes acquises"
                  value={money(k.commissionsEarned)}
                  icon={<Percent className="h-5 w-5" />}
                  accent="savanna"
                />
                <KpiCard
                  label="Primes réglées"
                  value={money(k.commissionsPaid)}
                  icon={<Banknote className="h-5 w-5" />}
                />
                <KpiCard
                  label="Solde payable"
                  value={money(k.payable)}
                  icon={<Banknote className="h-5 w-5" />}
                  accent="terracotta"
                />
              </div>
            </>
          )}
          <Card className="mb-6">
            <CardHeader
              title="Vos liens de recommandation"
              description="Un client inscrit ou une demande envoyée depuis ces liens vous est proposé ; l’attribution est toujours confirmée par Ocall."
            />
            <CardBody className="space-y-3 text-sm">
              {[
                { label: 'Inscription d’un client (essai gratuit)', path: p.links.signup },
                { label: 'Demande de démonstration', path: p.links.demo },
              ].map((l) => (
                <div key={l.path}>
                  <p className="text-muted">{l.label}</p>
                  <p
                    className="flex items-center gap-2 break-all font-mono"
                    data-testid="partner-link"
                  >
                    <Link2 className="h-4 w-4 shrink-0 text-forest" aria-hidden />
                    {origin}
                    {l.path}
                  </p>
                </div>
              ))}
              <p className="text-muted">
                Code commercial : <strong>{p.code}</strong>
              </p>
            </CardBody>
          </Card>
          {dashboard.state === 'success' && (
            <Card>
              <CardHeader title="Derniers règlements" />
              <CardBody>
                {dashboard.data.recentPayouts.length === 0 ? (
                  <p className="text-sm text-muted">Aucun règlement pour le moment.</p>
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
          )}
        </>
      )}
    </>
  );
}

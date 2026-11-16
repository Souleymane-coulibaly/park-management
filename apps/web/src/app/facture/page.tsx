'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AlertTriangle, Building2, Download, Users } from 'lucide-react';
import { formatXof } from '@ocall/shared';
import { FacturePage } from '@/components/facture/facture-page';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { useApi } from '@/lib/use-api';

interface Dashboard {
  /** Mois en cours (AAAA-MM) ; null pour une période choisie. */
  month: string | null;
  period: { from: string; to: string };
  invoiced: {
    count: number;
    creditNotes: number;
    netHt: number;
    netTtc: number;
    /** Dont factures de ventes en caisse Ocall Stock (déjà comptées dans Stock). */
    fromStockSales: { count: number; netHt: number; netTtc: number };
  };
  collected: { count: number; amount: number; fromStockSales: number };
  outstanding: { count: number; amount: number };
  overdue: {
    count: number;
    amount: number;
    invoices: {
      id: string;
      number: string;
      dueDate: string;
      client: string | null;
      balance: number;
      reminderCount: number;
    }[];
  };
  quotes: { count: number; amountTtc: number };
}

const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'UTC' });
const monthFr = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString('fr-FR', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  });
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

interface EstablishmentChoice {
  id: string;
  name: string;
  city: string | null;
  isActive: boolean;
}

/** Choix d'établissement émetteur d'un rapport : tous, un établissement, ou sans établissement. */
function useEstablishmentOptions() {
  const establishments = useApi<EstablishmentChoice[]>('/facture/establishments');
  const list = establishments.state === 'success' ? establishments.data : [];
  return [
    { value: '', label: 'Tous les établissements' },
    ...list.map((e) => ({
      value: e.id,
      label: `${e.name}${e.city ? ` — ${e.city}` : ''}${e.isActive ? '' : ' (désactivé)'}`,
    })),
    { value: 'none', label: 'Sans établissement' },
  ];
}

/**
 * Tableau de bord Ocall Facture : mentions légales à compléter, indicateurs du mois (facturé net des
 * avoirs, encaissé), reste à encaisser, factures en retard, devis en attente, exports comptables.
 */
export default function FactureHomePage() {
  return (
    <FacturePage
      title="Tableau de bord"
      description="Votre facturation en un coup d’œil : ce qui est facturé, encaissé et en retard."
    >
      {({ context }) => (
        <>
          <p className="text-sm text-muted" data-testid="facture-role">
            Connecté en tant que <strong>{context.roleLabel}</strong>.
          </p>
          {context.legalMissing.length > 0 ? (
            <div data-testid="facture-legal-missing">
              <Alert tone="info" title="Mentions recommandées sur vos factures">
                {context.legalMissing.join(', ')}.{' '}
                <Link href="/facture/parametres" className="font-semibold underline">
                  Compléter l’identité de l’entreprise
                </Link>
              </Alert>
            </div>
          ) : (
            <div data-testid="facture-legal-ready">
              <Alert tone="success" title="Identité légale complète">
                Les mentions recommandées sur vos factures sont renseignées.
              </Alert>
            </div>
          )}
          {context.permissions.includes('facture.documents.read') && (
            <Suspense fallback={<LoadingState />}>
              <Indicators />
            </Suspense>
          )}
          {context.permissions.includes('facture.reports.read') && <Exports />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardBody>
                <Link href="/facture/parametres" className="flex items-start gap-3">
                  <Building2 className="mt-0.5 h-5 w-5 text-forest" aria-hidden />
                  <span>
                    <span className="block font-semibold">Entreprise et mentions</span>
                    <span className="text-sm text-muted">
                      Raison sociale, NIF, régime d’imposition, TVA par défaut, logos.
                    </span>
                  </span>
                </Link>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <Link href="/facture/equipe" className="flex items-start gap-3">
                  <Users className="mt-0.5 h-5 w-5 text-forest" aria-hidden />
                  <span>
                    <span className="block font-semibold">Équipe</span>
                    <span className="text-sm text-muted">
                      Gérants, commerciaux, comptables et techniciens.
                    </span>
                  </span>
                </Link>
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </FacturePage>
  );
}

/** Indicateur chiffré : libellé et valeur en couleurs de texte ; l'alerte porte une icône. */
function Tile({
  label,
  value,
  detail,
  testId,
  alert,
}: {
  label: string;
  value: string;
  detail: string;
  testId: string;
  alert?: boolean;
}) {
  return (
    <Card>
      <CardBody>
        <p className="flex items-center gap-1.5 text-sm text-muted">
          {alert && <AlertTriangle className="h-4 w-4 text-terracotta-dark" aria-hidden />}
          {label}
        </p>
        <p className="mt-1 text-2xl font-semibold tabular-nums" data-testid={testId}>
          {value}
        </p>
        <p className="mt-1 text-xs text-muted">{detail}</p>
      </CardBody>
    </Card>
  );
}

/**
 * Indicateurs : mois en cours ou période choisie, tous les établissements émetteurs ou un seul (Ocall
 * Suite étape 5). Période et établissement repris de l'adresse (lien du tableau de bord de
 * l'organisation).
 */
function Indicators() {
  const params = useSearchParams();
  const [mode, setMode] = useState(params.get('from') && params.get('to') ? 'custom' : 'month');
  const [from, setFrom] = useState(params.get('from') ?? '');
  const [to, setTo] = useState(params.get('to') ?? '');
  const [establishmentId, setEstablishmentId] = useState(params.get('establishmentId') ?? '');
  const options = useEstablishmentOptions();
  const ready = mode === 'month' || (Boolean(from) && Boolean(to));
  const query = new URLSearchParams({
    ...(mode === 'custom' ? { from, to } : {}),
    ...(establishmentId ? { establishmentId } : {}),
  }).toString();
  const dashboard = useApi<Dashboard>(
    ready ? `/facture/dashboard${query ? `?${query}` : ''}` : null,
  );
  return (
    <section className="space-y-4" aria-label="Indicateurs de facturation">
      <div
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        data-testid="facture-dashboard-filters"
      >
        <SelectField
          label="Période"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          options={[
            { value: 'month', label: 'Mois en cours' },
            { value: 'custom', label: 'Période choisie' },
          ]}
        />
        {mode === 'custom' && (
          <>
            <InputField
              label="Du"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <InputField label="Au" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        )}
        <SelectField
          label="Établissement émetteur"
          value={establishmentId}
          onChange={(e) => setEstablishmentId(e.target.value)}
          options={options}
        />
      </div>
      {!ready && <Alert tone="info">Choisissez la date de début et la date de fin.</Alert>}
      {ready && dashboard.state === 'loading' && <LoadingState />}
      {ready && dashboard.state === 'error' && (
        <ErrorState error={dashboard.error} onRetry={dashboard.reload} />
      )}
      {ready && dashboard.state === 'success' && <IndicatorTiles d={dashboard.data} />}
    </section>
  );
}

function IndicatorTiles({ d }: { d: Dashboard }) {
  const notes = d.invoiced.creditNotes;
  const span = d.month
    ? `en ${monthFr(d.month)}`
    : `du ${dateFr(d.period.from)} au ${dateFr(d.period.to)}`;
  const stock = d.invoiced.fromStockSales;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label={`Facturé ${span} (HT)`}
          value={formatXof(d.invoiced.netHt)}
          detail={`${plural(d.invoiced.count, 'facture')}${
            notes ? `, ${plural(notes, 'avoir')} déduit${notes > 1 ? 's' : ''}` : ''
          } · ${formatXof(d.invoiced.netTtc)} TTC${
            stock.count ? ` · dont ventes Stock : ${formatXof(stock.netTtc)} TTC` : ''
          }`}
          testId="facture-kpi-invoiced"
        />
        <Tile
          label={`Encaissé ${span}`}
          value={formatXof(d.collected.amount)}
          detail={`${plural(d.collected.count, 'encaissement')}${
            d.collected.fromStockSales
              ? ` · dont ventes Stock : ${formatXof(d.collected.fromStockSales)}`
              : ''
          }`}
          testId="facture-kpi-collected"
        />
        <Tile
          label="Reste à encaisser"
          value={formatXof(d.outstanding.amount)}
          detail={`${plural(d.outstanding.count, 'facture')} ouverte${d.outstanding.count > 1 ? 's' : ''}`}
          testId="facture-kpi-outstanding"
        />
        <Tile
          label="En retard"
          value={formatXof(d.overdue.amount)}
          detail={`${plural(d.overdue.count, 'facture')} échue${d.overdue.count > 1 ? 's' : ''}`}
          testId="facture-kpi-overdue"
          alert={d.overdue.count > 0}
        />
      </div>
      <p className="text-sm text-muted">
        {d.quotes.count} devis en attente de réponse ({formatXof(d.quotes.amountTtc)} TTC).
      </p>
      {d.overdue.invoices.length > 0 && (
        <Card>
          <CardHeader
            title="Factures en retard"
            description="Les plus anciennes échéances d’abord. Ouvrez une facture pour la relancer ou enregistrer un encaissement."
          />
          <div data-testid="facture-overdue-list">
            <Table head={['Facture', 'Client', 'Échéance', 'Reste à payer', 'Relances']}>
              {d.overdue.invoices.map((i) => (
                <tr key={i.id}>
                  <Td>
                    <Link
                      href={`/facture/documents/${i.id}`}
                      className="font-semibold text-forest hover:underline"
                    >
                      {i.number}
                    </Link>
                  </Td>
                  <Td>{i.client ?? '—'}</Td>
                  <Td>{dateFr(i.dueDate)}</Td>
                  <Td>{formatXof(i.balance)}</Td>
                  <Td>{i.reminderCount}</Td>
                </tr>
              ))}
            </Table>
          </div>
        </Card>
      )}
    </>
  );
}

/** Exports comptables : période libre (un an au plus), mois en cours par défaut. */
function Exports() {
  const now = new Date();
  const [from, setFrom] = useState(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10),
  );
  const [to, setTo] = useState(now.toISOString().slice(0, 10));
  const [establishmentId, setEstablishmentId] = useState('');
  const options = useEstablishmentOptions();
  const query = new URLSearchParams({
    from,
    to,
    ...(establishmentId ? { establishmentId } : {}),
  }).toString();
  const link =
    'inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm font-medium hover:bg-ivory';
  return (
    <Card>
      <CardHeader
        title="Exports pour la comptabilité"
        description="Fichiers CSV lisibles dans Excel : avoirs en négatif, TVA détaillée par taux."
      />
      <CardBody className="flex flex-wrap items-end gap-3">
        <InputField label="Du" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <InputField label="Au" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <SelectField
          label="Établissement émetteur"
          value={establishmentId}
          onChange={(e) => setEstablishmentId(e.target.value)}
          options={options}
        />
        <a
          href={`/api/v1/facture/exports/sales?${query}`}
          className={link}
          data-testid="facture-export-sales"
        >
          <Download className="h-4 w-4" aria-hidden /> Journal des ventes
        </a>
        <a
          href={`/api/v1/facture/exports/payments?${query}`}
          className={link}
          data-testid="facture-export-payments"
        >
          <Download className="h-4 w-4" aria-hidden /> Journal des encaissements
        </a>
      </CardBody>
    </Card>
  );
}

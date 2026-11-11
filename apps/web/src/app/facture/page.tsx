'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, Building2, Download, Users } from 'lucide-react';
import { formatXof } from '@ocall/shared';
import { FacturePage } from '@/components/facture/facture-page';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { useApi } from '@/lib/use-api';

interface Dashboard {
  month: string;
  invoiced: { count: number; creditNotes: number; netHt: number; netTtc: number };
  collected: { count: number; amount: number };
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
          {context.permissions.includes('facture.documents.read') && <Indicators />}
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

function Indicators() {
  const dashboard = useApi<Dashboard>('/facture/dashboard');
  if (dashboard.state === 'loading') return <LoadingState />;
  if (dashboard.state === 'error') {
    return <ErrorState error={dashboard.error} onRetry={dashboard.reload} />;
  }
  const d = dashboard.data;
  const notes = d.invoiced.creditNotes;
  return (
    <section className="space-y-4" aria-label="Indicateurs de facturation">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label={`Facturé en ${monthFr(d.month)} (HT)`}
          value={formatXof(d.invoiced.netHt)}
          detail={`${plural(d.invoiced.count, 'facture')}${
            notes ? `, ${plural(notes, 'avoir')} déduit${notes > 1 ? 's' : ''}` : ''
          } · ${formatXof(d.invoiced.netTtc)} TTC`}
          testId="facture-kpi-invoiced"
        />
        <Tile
          label={`Encaissé en ${monthFr(d.month)}`}
          value={formatXof(d.collected.amount)}
          detail={plural(d.collected.count, 'encaissement')}
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
    </section>
  );
}

/** Exports comptables : période libre (un an au plus), mois en cours par défaut. */
function Exports() {
  const now = new Date();
  const [from, setFrom] = useState(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10),
  );
  const [to, setTo] = useState(now.toISOString().slice(0, 10));
  const query = new URLSearchParams({ from, to }).toString();
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

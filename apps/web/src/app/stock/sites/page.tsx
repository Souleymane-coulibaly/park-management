'use client';

import Link from 'next/link';
import { useState } from 'react';
import { STOCK_SITE_KIND_LABELS, STOCK_SITE_KINDS } from '@ocall/shared';
import { StockPage } from '@/components/stock/stock-page';
import type { StockSiteView } from '@/components/stock/stock-types';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { SimpleForm } from '@/components/ui/simple-form';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { useApi } from '@/lib/use-api';

/** Sites : magasins, dépôts et entrepôts. Chaque site naît avec un emplacement « Général ». */
export default function StockSitesPage() {
  return (
    <StockPage title="Sites" description="Magasins, dépôts et entrepôts, et leurs emplacements.">
      {({ canWrite }) => <Sites manage={canWrite('stock.sites.manage')} />}
    </StockPage>
  );
}

function Sites({ manage }: { manage: boolean }) {
  const [archived, setArchived] = useState(false);
  const sites = useApi<StockSiteView[]>(`/ocall-stock/sites?archived=${archived}`);
  return (
    <>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
        Afficher les sites archivés
      </label>
      {sites.state === 'loading' && <LoadingState />}
      {sites.state === 'error' && <ErrorState error={sites.error} onRetry={sites.reload} />}
      {sites.state === 'success' && (
        <Card>
          {sites.data.length === 0 ? (
            <CardBody>
              <p className="text-center text-sm text-muted">
                Aucun site : créez votre magasin ou votre entrepôt.
              </p>
            </CardBody>
          ) : (
            <div data-testid="stock-site-list">
              <Table head={['Site', 'Type', 'Ville', '']}>
                {sites.data.map((s) => (
                  <tr key={s.id}>
                    <Td>
                      <Link href={`/stock/sites/${s.id}`} className="font-semibold hover:underline">
                        {s.name}
                      </Link>
                      <span className="block font-mono text-xs text-muted">{s.code}</span>
                    </Td>
                    <Td>{STOCK_SITE_KIND_LABELS[s.kind]}</Td>
                    <Td>{s.city ?? '—'}</Td>
                    <Td className="text-right">{s.isArchived && <Badge>Archivé</Badge>}</Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Card>
      )}
      {manage && (
        <Card>
          <CardHeader
            title="Nouveau site"
            description="Le code (2 à 8 lettres ou chiffres) figure dans les QR codes des emplacements : il ne change plus."
          />
          <CardBody>
            <SimpleForm
              testId="stock-site-form"
              path="/ocall-stock/sites"
              submitLabel="Créer le site"
              fields={[
                { name: 'code', label: 'Code (ex. MAG1)', required: true },
                { name: 'name', label: 'Nom', required: true },
                {
                  name: 'kind',
                  label: 'Type',
                  type: 'select',
                  options: STOCK_SITE_KINDS.map((k) => ({
                    value: k,
                    label: STOCK_SITE_KIND_LABELS[k],
                  })),
                },
                { name: 'city', label: 'Ville (facultatif)' },
                { name: 'address', label: 'Adresse (facultatif)' },
              ]}
              onDone={() => sites.reload()}
            />
          </CardBody>
        </Card>
      )}
    </>
  );
}

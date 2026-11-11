'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Archive, Package, UserCog } from 'lucide-react';
import { ScanField, type ScanFeedback } from '@/components/scan/scan-field';
import { StockPage } from '@/components/stock/stock-page';
import {
  type StockLookup,
  type StockProductPage,
  asApiError,
} from '@/components/stock/stock-types';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { KpiCard } from '@/components/ui/kpi-card';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

/** Tableau de bord Ocall Stock (S1) : catalogue, accès rapide par scan et recherche. */
export default function StockHomePage() {
  return (
    <StockPage title="Tableau de bord" description="Votre catalogue, vos codes et vos étiquettes.">
      {({ context, canWrite }) => (
        <Home role={context.roleLabel} canCreate={canWrite('stock.catalog.manage')} />
      )}
    </StockPage>
  );
}

function Home({ role, canCreate }: { role: string; canCreate: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [feedback, setFeedback] = useState<ScanFeedback>(null);
  const active = useApi<StockProductPage>('/ocall-stock/products?pageSize=1');
  const archived = useApi<StockProductPage>('/ocall-stock/products?pageSize=1&archived=true');

  async function onScan(code: string) {
    try {
      const found = await api<StockLookup>(`/ocall-stock/lookup?code=${encodeURIComponent(code)}`);
      if (found.found) {
        setFeedback({ tone: 'ok', message: `${found.product.name} (${found.variant.sku})` });
        router.push(`/stock/articles/${found.product.id}`);
      } else {
        setFeedback({ tone: 'warn', message: `Code inconnu : ${code}` });
      }
    } catch (e) {
      setFeedback({ tone: 'error', message: asApiError(e).message });
    }
  }

  function search(event: FormEvent) {
    event.preventDefault();
    if (q.trim()) router.push(`/stock/recherche?q=${encodeURIComponent(q.trim())}`);
  }

  const total = active.state === 'success' ? active.data.total : null;
  const all = archived.state === 'success' ? archived.data.total : null;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Articles actifs"
          icon={<Package className="h-5 w-5" aria-hidden />}
          value={total === null ? '…' : String(total)}
        />
        <KpiCard
          label="Articles archivés"
          icon={<Archive className="h-5 w-5" aria-hidden />}
          value={total === null || all === null ? '…' : String(all - total)}
        />
        <KpiCard
          label="Votre rôle"
          icon={<UserCog className="h-5 w-5" aria-hidden />}
          value={role}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Retrouver un article" />
          <CardBody className="space-y-4">
            <ScanField onScan={onScan} feedback={feedback} testId="stock-home-scan" />
            <form onSubmit={search} className="flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-1">
                <InputField
                  label="Rechercher partout"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              <button type="submit" className="sr-only">
                Rechercher
              </button>
            </form>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Raccourcis" />
          <CardBody className="flex flex-wrap gap-3">
            {canCreate && <ButtonLink href="/stock/articles?nouveau=1">Nouvel article</ButtonLink>}
            <ButtonLink href="/stock/articles" variant="secondary">
              Catalogue
            </ButtonLink>
            <ButtonLink href="/stock/etiquettes" variant="secondary">
              Imprimer des étiquettes
            </ButtonLink>
            <Link
              href="/stock/categories"
              className="self-center text-sm font-medium text-forest hover:underline"
            >
              Catégories et marques
            </Link>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

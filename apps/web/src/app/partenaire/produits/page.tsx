'use client';

import Link from 'next/link';
import { formatXof } from '@ocall/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

interface SellableProduct {
  slug: string;
  name: string;
  tagline: string;
  plans: { name: string; monthlyPrice: number; setupFee: number }[];
}

/**
 * Produits commercialisables (statut actif uniquement) et ressources commerciales. Les produits
 * « bientôt disponibles » ne peuvent pas être vendus.
 */
export default function PartnerProductsPage() {
  const products = useApi<SellableProduct[]>('/partner/products');
  return (
    <>
      <PageHeader
        eyebrow="Portail partenaire"
        title="Produits et ressources"
        description="Seules les solutions disponibles peuvent être proposées. Les tarifs sont fixés par Ocall : vous ne pouvez pas les modifier."
      />
      {products.state === 'loading' && <LoadingState />}
      {products.state === 'error' && (
        <ErrorState error={products.error} onRetry={products.reload} />
      )}
      {products.state === 'success' && (
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          {products.data.map((p) => (
            <Card key={p.slug}>
              <CardHeader title={p.name} description={p.tagline} />
              <CardBody className="space-y-2 text-sm">
                {p.plans.map((pl) => (
                  <p key={pl.name} className="flex justify-between gap-2">
                    <span>{pl.name}</span>
                    <span className="tabular-nums text-muted">
                      {formatXof(pl.setupFee)} + {formatXof(pl.monthlyPrice)}/mois
                    </span>
                  </p>
                ))}
                <Link
                  href={`/solutions/${p.slug}`}
                  className="inline-block font-semibold text-forest underline"
                >
                  Page de présentation
                </Link>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
      <Card>
        <CardHeader title="Ressources commerciales" />
        <CardBody className="space-y-2 text-sm">
          <p>
            <Link href="/solutions" className="font-semibold text-forest underline">
              Catalogue Ocall Suite
            </Link>{' '}
            et{' '}
            <Link href="/tarifs" className="font-semibold text-forest underline">
              tarifs publics
            </Link>{' '}
            à partager avec vos prospects.
          </p>
          <p className="text-muted">
            Plaquettes et argumentaires : fournis par votre responsable Ocall. Les règles de
            commission figurent dans votre contrat partenaire.
          </p>
        </CardBody>
      </Card>
    </>
  );
}

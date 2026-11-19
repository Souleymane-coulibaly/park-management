'use client';

import Link from 'next/link';
import { Banknote, IdCard, Package } from 'lucide-react';
import { formatXof } from '@ocall/shared';
import type { PrintOrderSummaryView, PrintSettingsView } from '@/components/print/print-types';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { KpiCard } from '@/components/ui/kpi-card';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

export default function PrintHomePage() {
  const settings = useApi<PrintSettingsView>('/ocall-print/settings');
  const orders = useApi<PrintOrderSummaryView[]>('/ocall-print/orders');
  if (settings.state === 'loading') return <LoadingState />;
  if (settings.state === 'error')
    return <ErrorState error={settings.error} onRetry={settings.reload} />;
  const list = orders.state === 'success' ? orders.data : [];
  const open = list.filter((o) => !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status));
  const due = list
    .filter((o) => o.paymentStatus === 'UNPAID' && !['CANCELLED', 'REJECTED'].includes(o.status))
    .reduce((s, o) => s + o.totalAmount, 0);
  return (
    <>
      <PageHeader
        eyebrow="Ocall Print"
        title="Cartes et badges"
        description="Cartes scolaires et badges du personnel, imprimés par l’atelier Ocall de Bamako. Accès gratuit : seules les cartes commandées sont payées, en espèces à la livraison."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          icon={<IdCard className="h-5 w-5" aria-hidden />}
          label="Prix d’une carte"
          value={formatXof(settings.data.unitPrice)}
        />
        <KpiCard
          icon={<Package className="h-5 w-5" aria-hidden />}
          label="Commandes en cours"
          value={String(open.length)}
        />
        <KpiCard
          icon={<Banknote className="h-5 w-5" aria-hidden />}
          label="Reste à régler à la livraison"
          value={formatXof(due)}
        />
      </div>
      <Card className="mt-6">
        <CardHeader title="Comment ça marche" />
        <CardBody>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>
              <Link href="/print/modeles" className="text-forest hover:underline">
                Créez un modèle
              </Link>{' '}
              recto verso (couleurs, logo, champs).
            </li>
            <li>
              <Link href="/print/fiches" className="text-forest hover:underline">
                Ajoutez les fiches
              </Link>{' '}
              (élèves ou personnel) avec leur photo, puis créez les cartes.
            </li>
            <li>
              Commandez l’impression : prix unitaire, quantité et montant total sont affichés avant
              l’envoi.
            </li>
            <li>
              Suivez la commande jusqu’à la livraison ; réglez en espèces à la réception, contre
              reçu.
            </li>
          </ol>
          <p className="mt-4 text-xs text-muted">
            Les fichiers de production (photos, données imprimées) sont purgés{' '}
            {settings.data.retentionDays} jours après la livraison.
          </p>
        </CardBody>
      </Card>
    </>
  );
}

import type { Metadata } from 'next';
import { DemoForm } from '@/components/public/demo-form';
import { PageHeader } from '@/components/ui/page-header';
import { loadCatalog } from '@/lib/suite-catalog';

export const metadata: Metadata = {
  title: 'Demander une démonstration',
  description: 'Demandez une démonstration gratuite et sans engagement d’une solution Ocall Suite.',
  alternates: { canonical: '/demo' },
};
export const revalidate = 300;

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ produit?: string; ref?: string }>;
}) {
  const [{ produit, ref }, catalog] = await Promise.all([searchParams, loadCatalog()]);
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <PageHeader
        eyebrow="Démonstration"
        title="Demander une démonstration"
        description="Gratuite et sans engagement. Votre demande ne crée aucun abonnement : un membre de l’équipe Ocall vous recontacte."
      />
      <div className="rounded-2xl border border-line/80 bg-surface p-5 shadow-card sm:p-8">
        <DemoForm
          products={(catalog ?? []).map((p) => ({ slug: p.slug, name: p.name }))}
          initialProduct={typeof produit === 'string' ? produit.slice(0, 60) : ''}
          referral={typeof ref === 'string' && /^[A-Z0-9]{4,16}$/.test(ref) ? ref : null}
        />
      </div>
    </div>
  );
}

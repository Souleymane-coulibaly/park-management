'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { History, Store } from 'lucide-react';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { Card } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import type { PosEstablishment } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { Register } from './register';

const STORAGE_KEY = 'ocp.pos.establishment';

/** Caisse POS : choix de l'établissement (mémorisé sur l'appareil), puis caisse. */
export default function CaissePage() {
  const canSell = useCan('pos.sell');
  const establishments = useApi<PosEstablishment[]>(canSell ? '/pos/establishments' : null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (establishments.state !== 'success') return;
    const list = establishments.data;
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(STORAGE_KEY);
    } catch {
      remembered = null;
    }
    setSelected(
      (current) => current ?? list.find((e) => e.id === remembered)?.id ?? list[0]?.id ?? null,
    );
  }, [establishments]);

  function choose(id: string) {
    setSelected(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Stockage indisponible (navigation privée) : le choix vaut pour la page en cours.
    }
  }

  if (!canSell) return <AccessDenied />;
  if (establishments.state === 'loading') return <LoadingState label="Préparation de la caisse…" />;
  if (establishments.state === 'error')
    return <ErrorState error={establishments.error} onRetry={establishments.reload} />;
  if (establishments.data.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Store className="h-7 w-7" />}
          title="Aucun établissement disponible pour la caisse"
          description="La caisse fonctionne dans un établissement restaurant actif auquel vous êtes affecté. Contactez votre responsable."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {establishments.data.length > 1 ? (
          <div className="w-full max-w-xs">
            <SelectField
              label="Établissement"
              value={selected ?? ''}
              onChange={(e) => choose(e.target.value)}
              options={establishments.data.map((e) => ({ value: e.id, label: e.name }))}
            />
          </div>
        ) : (
          <h1 className="text-xl font-bold">{establishments.data[0]!.name}</h1>
        )}
        <div className="flex gap-2 text-sm font-semibold">
          <Link
            href="/app/caisse/ventes"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3 hover:border-forest"
          >
            <History className="h-4 w-4" aria-hidden /> Ventes
          </Link>
          <Link
            href="/app/caisse/sessions"
            className="inline-flex min-h-11 items-center rounded-xl border border-line bg-surface px-3 hover:border-forest"
          >
            Sessions
          </Link>
        </div>
      </div>
      {selected && <Register key={selected} establishmentId={selected} />}
    </div>
  );
}

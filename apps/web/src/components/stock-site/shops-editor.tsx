'use client';

import type { StockShowcaseShop } from '@ocall/shared';
import type { StockSiteView } from '@/components/stock/stock-types';
import { InputField } from '@/components/ui/field';
import { useApi } from '@/lib/use-api';

/**
 * Boutiques présentées sur la vitrine (S10) : page « Nos boutiques », choix de la boutique par le visiteur
 * (ses prix, sa disponibilité) et demandes adressées à cette boutique. Nom et adresse viennent du site
 * Stock. Les boutiques que le membre ne voit pas restent telles quelles.
 */
export function ShopsEditor({
  value,
  disabled,
  onChange,
}: {
  value: StockShowcaseShop[];
  disabled: boolean;
  onChange: (shops: StockShowcaseShop[]) => void;
}) {
  const sites = useApi<StockSiteView[]>('/ocall-stock/sites');
  if (sites.state !== 'success') return null;
  const active = sites.data.filter((s) => !s.isArchived);
  if (active.length === 0) return null;

  const toggle = (site: StockSiteView, on: boolean) =>
    onChange(
      on
        ? [...value, { siteId: site.id, phone: null, whatsapp: null, hours: null, mapUrl: null }]
        : value.filter((sh) => sh.siteId !== site.id),
    );
  const edit = (siteId: string, key: keyof Omit<StockShowcaseShop, 'siteId'>, v: string) =>
    onChange(value.map((sh) => (sh.siteId === siteId ? { ...sh, [key]: v || null } : sh)));

  return (
    <fieldset className="space-y-3" data-testid="stock-showcase-shops">
      <legend className="text-sm font-semibold">Boutiques présentées</legend>
      <p className="text-sm text-muted">
        Le visiteur choisit sa boutique : il voit ses prix et sa disponibilité, et sa demande lui
        arrive. Sans boutique cochée, la vitrine reste celle de l’entreprise.
      </p>
      {active.map((site) => {
        const shop = value.find((sh) => sh.siteId === site.id);
        return (
          <div key={site.id} className="rounded-xl border border-line p-3" data-site={site.code}>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-forest"
                disabled={disabled}
                checked={Boolean(shop)}
                onChange={(e) => toggle(site, e.target.checked)}
                data-testid="stock-showcase-shop-toggle"
              />
              <span>
                <strong>{site.name}</strong>
                {(site.address || site.city) && (
                  <span className="block text-muted">
                    {[site.address, site.city].filter(Boolean).join(', ')}
                  </span>
                )}
              </span>
            </label>
            {shop && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <InputField
                  label="Téléphone de la boutique (+223 …)"
                  value={shop.phone ?? ''}
                  disabled={disabled}
                  onChange={(e) => edit(site.id, 'phone', e.target.value)}
                />
                <InputField
                  label="WhatsApp de la boutique (+223 …)"
                  value={shop.whatsapp ?? ''}
                  disabled={disabled}
                  onChange={(e) => edit(site.id, 'whatsapp', e.target.value)}
                />
                <InputField
                  label="Horaires"
                  maxLength={200}
                  value={shop.hours ?? ''}
                  disabled={disabled}
                  onChange={(e) => edit(site.id, 'hours', e.target.value)}
                />
                <InputField
                  label="Lien de carte (https)"
                  maxLength={500}
                  value={shop.mapUrl ?? ''}
                  disabled={disabled}
                  onChange={(e) => edit(site.id, 'mapUrl', e.target.value)}
                />
              </div>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}

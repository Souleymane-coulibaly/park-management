import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProductCard, StockSiteShell } from '@/components/stock-site/site-shell';
import { fetchStockCatalog, stockSiteBase } from '@/lib/public-stock-site';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ categorie?: string; q?: string; page?: string }>;
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchStockCatalog(slug, {});
  if (!data) return { title: { absolute: 'Catalogue introuvable' }, robots: { index: false } };
  return {
    title: { absolute: `Catalogue — ${data.site.businessName}` },
    description: `Articles de ${data.site.businessName}${data.site.city ? ` à ${data.site.city}` : ''}.`,
    alternates: { canonical: `${data.url}/catalogue` },
    robots: { index: true, follow: true },
  };
}

/** Catalogue public d'une vitrine Stock : articles publiés, filtre par catégorie, recherche, pages. */
export default async function StockSiteCatalogPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const category = one(sp.categorie);
  const q = one(sp.q)?.trim() || undefined;
  const page = Math.max(0, Number(one(sp.page)) || 0);
  const data = await fetchStockCatalog(slug, { category, q, page });
  if (!data) notFound();
  const query = new URLSearchParams({
    ...(category ? { categorie: category } : {}),
    ...(q ? { q } : {}),
    ...(page ? { page: String(page) } : {}),
  }).toString();
  const base = await stockSiteBase(data, `/catalogue${query ? `?${query}` : ''}`);
  const link = (over: { categorie?: string | null; page?: number }) => {
    const next = new URLSearchParams();
    const c = over.categorie === undefined ? category : over.categorie;
    if (c) next.set('categorie', c);
    if (q) next.set('q', q);
    if (over.page) next.set('page', String(over.page));
    const s = next.toString();
    return `${base}/catalogue${s ? `?${s}` : ''}`;
  };
  const pages = Math.ceil(data.total / data.pageSize);

  return (
    <StockSiteShell site={data.site} base={base}>
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-10" data-testid="stock-site-catalog">
        <h1 className="font-display text-3xl font-bold">Catalogue</h1>
        <form action={`${base}/catalogue`} method="get" className="flex flex-wrap gap-2">
          {category && <input type="hidden" name="categorie" value={category} />}
          <label className="sr-only" htmlFor="catalog-q">
            Rechercher un article
          </label>
          <input
            id="catalog-q"
            name="q"
            defaultValue={q}
            maxLength={80}
            placeholder="Rechercher un article"
            className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2.5"
          />
          <button
            type="submit"
            className="rounded-xl bg-forest px-4 py-2.5 font-semibold text-white"
          >
            Rechercher
          </button>
        </form>
        {data.categories.length > 0 && (
          <nav aria-label="Catégories" className="flex flex-wrap gap-2">
            <Link
              href={link({ categorie: null })}
              aria-current={!category ? 'page' : undefined}
              className={`rounded-full border px-3 py-1 text-sm ${!category ? 'border-forest bg-forest text-white' : 'border-line bg-surface'}`}
            >
              Tout
            </Link>
            {data.categories.map((c) => (
              <Link
                key={c.id}
                href={link({ categorie: c.id })}
                aria-current={category === c.id ? 'page' : undefined}
                className={`rounded-full border px-3 py-1 text-sm ${category === c.id ? 'border-forest bg-forest text-white' : 'border-line bg-surface'}`}
              >
                {c.name}
              </Link>
            ))}
          </nav>
        )}
        {data.items.length === 0 ? (
          <p className="text-muted">Aucun article ne correspond.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {data.items.map((p) => (
              <ProductCard key={p.id} product={p} base={base} />
            ))}
          </ul>
        )}
        {pages > 1 && (
          <nav aria-label="Pages" className="flex flex-wrap items-center gap-3 text-sm">
            {page > 0 && (
              <Link href={link({ page: page - 1 })} className="font-semibold text-forest underline">
                Page précédente
              </Link>
            )}
            <span className="text-muted">
              Page {page + 1} sur {pages}
            </span>
            {page + 1 < pages && (
              <Link href={link({ page: page + 1 })} className="font-semibold text-forest underline">
                Page suivante
              </Link>
            )}
          </nav>
        )}
      </div>
    </StockSiteShell>
  );
}

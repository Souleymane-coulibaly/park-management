'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCan } from '@/components/app/session-context';

/** Onglets du restaurant, filtrés selon les permissions du membre. */
export function RestaurantNav() {
  const pathname = usePathname();
  const canSell = useCan('pos.sell');
  const seesKitchen = useCan('kitchen.view');
  const books = useCan('reservation.manage');
  const managesTables = useCan('tables.manage');
  const seesStock = useCan('stock.read');
  const seesStats = useCan('sale.read_all');
  const links = [
    canSell && { href: '/app/commandes', label: 'Commandes' },
    canSell && { href: '/app/caisse', label: 'Caisse' },
    seesKitchen && { href: '/app/cuisine', label: 'Cuisine' },
    books && { href: '/app/reservations', label: 'Réservations' },
    managesTables && { href: '/app/restaurant/tables', label: 'Salles et tables' },
    seesStock && { href: '/app/stocks', label: 'Stocks' },
    seesStats && { href: '/app/restaurant/tableau', label: 'Tableau de bord' },
  ].filter((l): l is { href: string; label: string } => !!l);
  return (
    <nav aria-label="Restaurant" className="flex flex-wrap gap-2 text-sm font-semibold">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={pathname === l.href ? 'page' : undefined}
          className={`inline-flex min-h-11 items-center rounded-xl px-3 ${pathname === l.href ? 'bg-forest text-white' : 'border border-line bg-surface hover:border-forest'}`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

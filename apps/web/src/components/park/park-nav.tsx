'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCan } from '@/components/app/session-context';

/** Onglets de la billetterie, filtrés selon les permissions du membre. */
export function ParkNav() {
  const pathname = usePathname();
  const canSell = useCan('pos.sell');
  const canManage = useCan('ticketing.manage');
  const seesStats = useCan('sale.read_all');
  const canScan = useCan('access.scan');
  const links = [
    canSell && { href: '/app/billetterie', label: 'Vente' },
    seesStats && { href: '/app/billetterie/tableau', label: 'Tableau de bord' },
    canManage && { href: '/app/billetterie/configuration', label: 'Tarifs et horaires' },
    canScan && { href: '/app/controle-acces', label: 'Contrôle des entrées' },
  ].filter((l): l is { href: string; label: string } => !!l);
  return (
    <nav aria-label="Billetterie" className="flex flex-wrap gap-2 text-sm font-semibold">
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

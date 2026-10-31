'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  BarChart3,
  History,
  LayoutDashboard,
  type LucideIcon,
  MoreHorizontal,
  ScanLine,
  Settings,
  Ticket,
  Users,
} from 'lucide-react';
import { useCan } from '@/components/app/session-context';

const MAX_VISIBLE = 5;

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Navigation du parc sur smartphone et tablette en portrait : gros boutons, filtrés selon les droits
 * du membre (l'API applique les mêmes règles). Masquée pour une organisation sans activité parc.
 */
export function ParkMobileNav({ moduleHrefs }: { moduleHrefs: string[] }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => setMoreOpen(false), [pathname]);

  const hasTicketing = moduleHrefs.includes('/app/billetterie');
  const hasGate = moduleHrefs.includes('/app/controle-acces');
  const canSell = useCan('pos.sell');
  const seesSales = useCan('sale.read_all');
  const canScan = useCan('access.scan');
  const seesStats = useCan('analytics.read');

  if (!hasTicketing && !hasGate) return null;

  const items = [
    hasTicketing &&
      seesSales && { href: '/app/billetterie/tableau', label: 'Tableau', icon: LayoutDashboard },
    hasTicketing && canSell && { href: '/app/billetterie', label: 'Billetterie', icon: Ticket },
    hasGate && canScan && { href: '/app/controle-acces', label: 'Scanner', icon: ScanLine },
    hasTicketing && seesSales && { href: '/app/parc/visiteurs', label: 'Visiteurs', icon: Users },
    hasGate && canScan && { href: '/app/parc/historique', label: 'Entrées', icon: History },
    hasTicketing &&
      seesStats &&
      moduleHrefs.includes('/app/analytics') && {
        href: '/app/analytics/parc',
        label: 'Statistiques',
        icon: BarChart3,
      },
    { href: '/app/parc/parametres', label: 'Paramètres', icon: Settings },
  ].filter((i): i is Item => !!i);

  const isParkRoute = pathname === '/app' || items.some((i) => pathname === i.href);
  if (!isParkRoute) return null;

  const overflow = items.length > MAX_VISIBLE;
  const visible = overflow ? items.slice(0, MAX_VISIBLE - 1) : items;
  const hidden = overflow ? items.slice(MAX_VISIBLE - 1) : [];

  const entry = (item: Item) => {
    const Icon = item.icon;
    const active = pathname === item.href;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={`flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-semibold ${active ? 'bg-forest text-white' : 'text-charcoal'}`}
      >
        <Icon className="h-6 w-6" aria-hidden />
        {item.label}
      </Link>
    );
  };

  return (
    <>
      {/* Réserve la hauteur de la barre : le bas des pages reste accessible. */}
      <div className="h-20 lg:hidden" aria-hidden />
      {moreOpen && (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex gap-1 border-t border-line bg-surface p-1.5 shadow-lift lg:hidden">
          {hidden.map(entry)}
        </div>
      )}
      <nav
        aria-label="Navigation du parc"
        data-testid="park-mobile-nav"
        className="fixed inset-x-0 bottom-0 z-40 flex gap-1 border-t border-line bg-surface p-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))] lg:hidden"
      >
        {visible.map(entry)}
        {overflow && (
          <button
            type="button"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((o) => !o)}
            className="flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-semibold text-charcoal"
          >
            <MoreHorizontal className="h-6 w-6" aria-hidden />
            Plus
          </button>
        )}
      </nav>
    </>
  );
}

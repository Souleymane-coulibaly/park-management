'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { Menu } from 'lucide-react';
import { ROLE_LABELS } from '@ocall/shared';
import { Logo } from '@/components/brand/logo';
import { initials } from '@/lib/format';
import type { Me } from '@/lib/types';
import { LogoutButton } from './logout-button';
import { ModuleIcon } from './module-icon';
import { SessionProvider } from './session-context';

export interface NavItem {
  key: string;
  label: string;
  href: string;
  upcoming?: boolean;
}

interface ShellProps {
  me: Me;
  nav: NavItem[];
  /** Encart en tête de la barre latérale (organisation, ou « Plateforme »). */
  context: { title: string; subtitle: string };
  homeHref: string;
  accountHref?: string;
  headerNote?: ReactNode;
  children: ReactNode;
}

function isActive(pathname: string, href: string, homeHref: string): boolean {
  return href === homeHref ? pathname === homeHref : pathname.startsWith(href);
}

function Sidebar({
  nav,
  context,
  homeHref,
  onNavigate,
}: Pick<ShellProps, 'nav' | 'context' | 'homeHref'> & { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col bg-charcoal text-ivory">
      <div className="pattern-bogolan flex h-16 items-center px-5">
        <Link href={homeHref} onClick={onNavigate} aria-label="Accueil de l’espace">
          <Logo inverted />
        </Link>
      </div>
      <div className="mx-4 mb-3 rounded-xl border border-ivory/10 bg-ivory/5 px-3.5 py-3">
        <p className="truncate text-sm font-semibold">{context.title}</p>
        <p className="text-xs text-savanna">{context.subtitle}</p>
      </div>
      <nav
        className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4"
        aria-label="Navigation de l’espace"
      >
        {nav.map((item) => {
          const active = isActive(pathname, item.href, homeHref);
          return (
            <Link
              key={item.key}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${active ? 'bg-forest font-semibold text-white' : 'text-ivory/75 hover:bg-ivory/5 hover:text-ivory'}`}
            >
              <ModuleIcon moduleKey={item.key} />
              <span className="flex-1 truncate">{item.label}</span>
              {item.upcoming && (
                <span className="rounded-full bg-savanna/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-savanna">
                  À venir
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div
        className="h-1.5 bg-[repeating-linear-gradient(90deg,#D99B38_0_16px,#C46A43_16px_32px,#176B53_32px_48px)]"
        aria-hidden
      />
    </div>
  );
}

/** Coque commune de l'espace client et de l'espace Super Admin : barre latérale, en-tête, session. */
export function AppShell({
  me,
  nav,
  context,
  homeHref,
  accountHref,
  headerNote,
  children,
}: ShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setMobileOpen(false), [pathname]);

  const identity = (
    <>
      <span className="grid h-9 w-9 place-items-center rounded-full bg-forest text-sm font-bold text-white">
        {initials(me.user.firstName, me.user.lastName)}
      </span>
      <span className="hidden text-left sm:block">
        <span className="block text-sm font-semibold leading-tight">
          {me.user.firstName} {me.user.lastName}
        </span>
        <span className="block text-xs text-muted">{me.role && ROLE_LABELS[me.role]}</span>
      </span>
    </>
  );

  return (
    <SessionProvider me={me}>
      <div className="min-h-screen lg:grid lg:grid-cols-[264px_1fr]">
        <aside className="sticky top-0 hidden h-screen lg:block">
          <Sidebar nav={nav} context={context} homeHref={homeHref} />
        </aside>

        {mobileOpen && (
          <div
            className="fixed inset-0 z-40 lg:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
          >
            <button
              type="button"
              className="absolute inset-0 bg-charcoal/60"
              onClick={() => setMobileOpen(false)}
              aria-label="Fermer le menu"
            />
            <div className="relative h-full w-72 max-w-[85vw]">
              <Sidebar
                nav={nav}
                context={context}
                homeHref={homeHref}
                onNavigate={() => setMobileOpen(false)}
              />
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-line/70 bg-ivory/90 px-4 backdrop-blur sm:px-6">
            <button
              type="button"
              className="rounded-lg p-2 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Ouvrir le menu"
            >
              <Menu className="h-6 w-6" />
            </button>
            <div className="hidden text-sm text-muted lg:block">{headerNote}</div>
            <div className="flex items-center gap-2">
              {accountHref ? (
                <Link
                  href={accountHref}
                  className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-ivory-dark/50"
                >
                  {identity}
                </Link>
              ) : (
                <span className="flex items-center gap-3 px-2 py-1.5">{identity}</span>
              )}
              <LogoutButton className="text-charcoal-soft hover:bg-ivory-dark/50" />
            </div>
          </header>
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
            {children}
          </main>
        </div>
      </div>
    </SessionProvider>
  );
}

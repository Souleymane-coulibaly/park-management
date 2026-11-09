'use client';

import Link from 'next/link';
import { type ReactNode, useEffect } from 'react';
import { Bell } from 'lucide-react';
import { LogoutButton } from '@/components/app/logout-button';
import { SuiteLogo } from '@/components/brand/suite-logo';
import { useApi } from '@/lib/use-api';

/**
 * Cadre du portail Ocall Suite (Sprint S2) : logo, cloche des notifications avec le nombre de non lues,
 * déconnexion. `unreadVersion` force le rechargement du compteur après une lecture.
 */
export function SuiteShell({
  children,
  unreadVersion = 0,
}: {
  children: ReactNode;
  unreadVersion?: number;
}) {
  const unread = useApi<{ unread: number }>('/suite/notifications/unread-count');
  const { reload } = unread;
  useEffect(() => {
    if (unreadVersion > 0) reload();
  }, [unreadVersion, reload]);
  const count = unread.state === 'success' ? unread.data.unread : 0;
  return (
    <div className="min-h-screen bg-suite-ivory">
      <header className="border-b border-suite-ink/5 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/suite" aria-label="Accueil Ocall Suite">
            <SuiteLogo />
          </Link>
          <div className="flex items-center gap-1">
            <Link
              href="/suite/notifications"
              className="relative grid h-10 w-10 place-items-center rounded-xl text-suite-ink-soft hover:bg-suite-ivory focus-visible:outline focus-visible:outline-2 focus-visible:outline-suite-green"
              aria-label={
                count > 0
                  ? `Notifications : ${count} non lue${count > 1 ? 's' : ''}`
                  : 'Notifications'
              }
              data-testid="suite-bell"
            >
              <Bell className="h-5 w-5" aria-hidden />
              {count > 0 && (
                <span
                  className="absolute -right-0.5 -top-0.5 min-w-[1.25rem] rounded-full bg-suite-clay px-1 text-center text-[11px] font-bold leading-5 text-white"
                  data-testid="suite-unread-badge"
                >
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </Link>
            <LogoutButton className="text-suite-ink-soft hover:bg-suite-ivory" />
          </div>
        </div>
        <div aria-hidden className="suite-frieze h-2" />
      </header>
      {children}
    </div>
  );
}

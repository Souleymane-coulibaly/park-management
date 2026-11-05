'use client';

import { Bell, CalendarDays, Home, LogOut, Megaphone, User, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, createContext, useContext, useEffect } from 'react';
import type { SchoolLocale } from '@ocall/shared';
import { SchoolLanguage, useSchoolText } from '@/components/school/school-language';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { api } from '@/lib/api';
import { startPwa } from '@/lib/pwa';
import type { Me } from '@/lib/types';
import { useApi } from '@/lib/use-api';

/** Enfant autorisé, tel que l'API du portail le renvoie. */
export interface PortalChild {
  id: string;
  organizationId: string;
  schoolId: string;
  matricule: string;
  lastName: string;
  firstName: string;
  lastNameAr: string | null;
  firstNameAr: string | null;
  school: {
    id: string;
    name: string;
    nameAr: string | null;
    defaultLocale: SchoolLocale;
    timezone: string;
  };
  class: { id: string; name: string; nameAr: string | null } | null;
  access: 'full' | 'read_only';
  /** Module « Mémorisation du Coran » actif dans son établissement. */
  quranAvailable: boolean;
}

/** Annonce visible des familles. */
export interface Announcement {
  id: string;
  title: string;
  body: string;
  titleAr: string | null;
  bodyAr: string | null;
  publishedAt: string;
  expiresOn: string | null;
}

const PortalContext = createContext<{ children: PortalChild[] }>({ children: [] });
export const usePortal = () => useContext(PortalContext);

const CHILD_PATH = /^\/parents\/enfants\/([0-9a-f-]{36})/;

/**
 * Portail parents (Sprint 6) : en-tête, navigation traduite, langue de l'établissement de l'enfant
 * consulté (sinon du premier enfant), sens de lecture. Installable comme application (PWA).
 */
export function ParentShell({ me, children }: { me: Me; children: ReactNode }) {
  const list = useApi<PortalChild[]>('/school/portal/children');
  const pathname = usePathname();
  useEffect(() => startPwa('/parents'), []);
  const kids = list.state === 'success' ? list.data : [];
  const childId = CHILD_PATH.exec(pathname)?.[1];
  const locale =
    kids.find((k) => k.id === childId)?.school.defaultLocale ??
    kids[0]?.school.defaultLocale ??
    'FR';
  return (
    <SchoolLanguage locale={locale} className="min-h-screen bg-ivory">
      <PortalContext.Provider value={{ children: kids }}>
        <Chrome me={me}>
          {list.state === 'loading' ? (
            <LoadingState />
          ) : list.state === 'error' ? (
            <ErrorState error={list.error} onRetry={list.reload} />
          ) : (
            children
          )}
        </Chrome>
      </PortalContext.Provider>
    </SchoolLanguage>
  );
}

function Chrome({ me, children }: { me: Me; children: ReactNode }) {
  const { t } = useSchoolText();
  const pathname = usePathname();
  const router = useRouter();
  const unread = useApi<{ unread: number }>('/school/portal/notifications?unread=true');
  const nav = [
    { href: '/parents', label: t('par.nav.home'), icon: Home, exact: true },
    { href: '/parents/enfants', label: t('par.nav.children'), icon: Users },
    { href: '/parents/annonces', label: t('par.nav.announcements'), icon: Megaphone },
    { href: '/parents/calendrier', label: t('par.nav.calendar'), icon: CalendarDays },
    { href: '/parents/notifications', label: t('par.nav.notifications'), icon: Bell },
    { href: '/parents/profil', label: t('par.nav.profile'), icon: User },
  ];
  const count = unread.state === 'success' ? unread.data.unread : 0;

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/connexion');
    router.refresh();
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col">
      <header className="flex items-center justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-forest">Ocall School</p>
          <h1 className="truncate text-lg font-bold">{t('par.title')}</h1>
          <p className="truncate text-xs text-muted">
            {me.user.firstName} {me.user.lastName}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm font-medium hover:bg-white"
        >
          <LogOut className="h-4 w-4" aria-hidden /> {t('par.logout')}
        </button>
      </header>
      <nav
        aria-label={t('par.title')}
        className="sticky top-0 z-20 mt-3 flex gap-1 overflow-x-auto border-b border-line bg-ivory/95 px-3 py-2 backdrop-blur"
        data-testid="parent-nav"
      >
        {nav.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium ${
                active ? 'bg-forest text-white' : 'text-charcoal hover:bg-white'
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
              {href === '/parents/notifications' && count > 0 && (
                <span
                  className="rounded-full bg-terracotta px-1.5 text-xs font-bold text-white"
                  data-testid="unread-badge"
                >
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <main className="flex-1 space-y-4 px-4 py-4">{children}</main>
    </div>
  );
}

/** Nom d'un enfant dans la langue de son établissement. */
export function childName(c: PortalChild, showArabic: boolean, language: 'fr' | 'ar') {
  const arabic = [c.lastNameAr, c.firstNameAr].filter(Boolean).join(' ');
  if (language === 'ar' && arabic) return arabic;
  const latin = `${c.lastName} ${c.firstName}`;
  return showArabic && arabic ? `${latin} / ${arabic}` : latin;
}

/** En-tête d'un enfant et onglets de son dossier. */
export function ChildHeader({ child }: { child: PortalChild }) {
  const { t, name, showArabic, language } = useSchoolText();
  const pathname = usePathname();
  const base = `/parents/enfants/${child.id}`;
  const tabs = [
    { href: `${base}/planning`, label: t('par.child.planning') },
    { href: `${base}/presences`, label: t('par.child.attendance') },
    { href: `${base}/resultats`, label: t('par.child.results') },
    { href: `${base}/bulletins`, label: t('par.child.reportCards') },
    { href: `${base}/finances`, label: t('par.child.finance') },
    ...(child.quranAvailable ? [{ href: `${base}/coran`, label: t('par.child.quran') }] : []),
  ];
  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-xl font-bold" data-testid="child-name">
          {childName(child, showArabic, language)}
        </h2>
        <p className="text-sm text-muted">
          {child.class ? name(child.class) : '—'} · {name(child.school)}
        </p>
      </div>
      <div className="flex gap-1 overflow-x-auto" role="tablist">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            role="tab"
            aria-selected={pathname === tab.href}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-sm ${
              pathname === tab.href
                ? 'bg-charcoal text-ivory'
                : 'border border-line bg-white text-charcoal'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Enfant d'une page /parents/enfants/[id] ; introuvable s'il n'est pas autorisé. */
export function useChild(id: string): PortalChild | null {
  return usePortal().children.find((c) => c.id === id) ?? null;
}

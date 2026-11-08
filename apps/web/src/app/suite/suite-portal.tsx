'use client';

import Link from 'next/link';
import { ArrowRight, GraduationCap, Ticket } from 'lucide-react';
import type { AuthProductApp } from '@ocall/shared';
import { LogoutButton } from '@/components/app/logout-button';
import { SuiteLogo } from '@/components/brand/suite-logo';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

/**
 * Page d'arrivée après connexion (portail Ocall Suite) : les applications ouvertes par les contrats et
 * abonnements du client. Identité Ocall Suite ; logique inchangée (accès décidé par le serveur).
 */
const APP_STYLE: Record<
  string,
  { icon: typeof Ticket; tile: string; soft: string; tagline: string }
> = {
  OCALL_PARK: {
    icon: Ticket,
    tile: 'bg-suite-clay text-suite-ivory',
    soft: 'bg-suite-clay-soft',
    tagline: 'Parcs, restaurants et activités de loisirs',
  },
  OCALL_SCHOOL: {
    icon: GraduationCap,
    tile: 'bg-suite-green text-suite-ivory',
    soft: 'bg-suite-green-soft',
    tagline: 'Gestion des établissements scolaires',
  },
};

export function SuitePortal({
  organizationName,
  firstName,
}: {
  organizationName: string;
  firstName: string;
}) {
  const apps = useApi<AuthProductApp[]>('/suite/apps');
  return (
    <div className="min-h-screen bg-suite-ivory">
      <header className="border-b border-suite-ink/5 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 sm:px-6">
          <SuiteLogo />
          <LogoutButton className="text-suite-ink-soft hover:bg-suite-ivory" />
        </div>
        <div aria-hidden className="suite-frieze h-2" />
      </header>
      <main className="mx-auto max-w-4xl space-y-8 px-4 py-10 sm:px-6">
        <div>
          <p className="inline-flex rounded-full bg-suite-gold-soft px-3 py-1 text-xs font-semibold text-suite-ink">
            {organizationName}
          </p>
          <h1 className="mt-3 font-display text-3xl font-extrabold text-suite-green sm:text-4xl">
            Bonjour {firstName}
          </h1>
          <p className="mt-1 text-suite-ink-soft">Choisissez votre application.</p>
        </div>
        {apps.state === 'loading' && <LoadingState />}
        {apps.state === 'error' && <ErrorState error={apps.error} onRetry={apps.reload} />}
        {apps.state === 'success' && apps.data.length === 0 && (
          <Alert tone="info" title="Aucune application disponible">
            Aucun produit n’est encore ouvert pour votre organisation. Contactez votre interlocuteur
            Ocall.
          </Alert>
        )}
        {apps.state === 'success' && apps.data.length > 0 && (
          <ul className="grid gap-5 sm:grid-cols-2" data-testid="suite-apps">
            {apps.data.map((app) => {
              const style = APP_STYLE[app.code] ?? APP_STYLE.OCALL_SCHOOL!;
              const Icon = style.icon;
              return (
                <li key={app.code}>
                  <Link
                    href={app.href}
                    className="group flex h-full flex-col overflow-hidden rounded-3xl border border-suite-ink/5 bg-white shadow-card transition hover:shadow-lift focus-visible:ring-2 focus-visible:ring-suite-gold motion-safe:hover:-translate-y-0.5"
                  >
                    <span className={`relative flex items-center gap-4 p-5 ${style.soft}`}>
                      <span aria-hidden className="suite-pattern absolute inset-0 opacity-60" />
                      <span
                        className={`relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${style.tile}`}
                      >
                        <Icon className="h-6 w-6" aria-hidden />
                      </span>
                      <span className="relative min-w-0 flex-1">
                        <span className="block font-display text-xl font-extrabold text-suite-ink">
                          {app.name}
                        </span>
                        <span className="block text-sm text-suite-ink-soft">{style.tagline}</span>
                      </span>
                    </span>
                    <span className="flex items-center justify-between gap-3 px-5 py-4">
                      {app.access === 'read_only' ? (
                        <span className="rounded-full bg-suite-gold-soft px-2.5 py-1 text-xs font-semibold text-suite-ink">
                          Consultation seule
                        </span>
                      ) : (
                        <span className="text-sm font-semibold text-suite-green">Ouvrir</span>
                      )}
                      <ArrowRight
                        className="h-5 w-5 text-suite-green transition-transform motion-safe:group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}

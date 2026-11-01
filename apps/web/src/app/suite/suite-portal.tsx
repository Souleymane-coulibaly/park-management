'use client';

import Link from 'next/link';
import { ArrowRight, GraduationCap, Waves } from 'lucide-react';
import type { AuthProductApp } from '@ocall/shared';
import { LogoutButton } from '@/components/app/logout-button';
import { Logo } from '@/components/brand/logo';
import { Badge } from '@/components/ui/badge';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

export function SuitePortal({
  organizationName,
  firstName,
}: {
  organizationName: string;
  firstName: string;
}) {
  const apps = useApi<AuthProductApp[]>('/suite/apps');
  return (
    <div className="min-h-screen bg-ivory">
      <header className="flex h-16 items-center justify-between border-b border-line/70 px-4 sm:px-6">
        <Logo />
        <LogoutButton className="text-charcoal-soft hover:bg-ivory-dark/50" />
      </header>
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        <div>
          <p className="text-sm text-muted">{organizationName}</p>
          <h1 className="text-3xl font-bold">Bonjour {firstName}</h1>
          <p className="mt-1 text-muted">Choisissez votre application.</p>
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
          <ul className="grid gap-4 sm:grid-cols-2" data-testid="suite-apps">
            {apps.data.map((app) => {
              const Icon = app.code === 'OCALL_PARK' ? Waves : GraduationCap;
              return (
                <li key={app.code}>
                  <Link
                    href={app.href}
                    className="flex h-full items-center gap-4 rounded-2xl border border-line bg-surface p-5 shadow-sm transition hover:border-forest"
                  >
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-forest-light text-forest">
                      <Icon className="h-6 w-6" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-display text-lg font-bold">{app.name}</span>
                      {app.access === 'read_only' && (
                        <Badge tone="savanna">Consultation seule</Badge>
                      )}
                    </span>
                    <ArrowRight className="h-5 w-5 text-muted" aria-hidden />
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

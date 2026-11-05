import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ParentShell } from '@/components/parents/parent-shell';
import { requireGuardianSession } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Portail parents — Ocall School',
  manifest: '/parents.webmanifest',
};

/**
 * Portail parents d'Ocall School (Sprint 6) : réservé aux comptes de responsable. L'API filtre chaque
 * donnée selon le lien parent-enfant ; l'interface ne fait qu'afficher.
 */
export default async function ParentLayout({ children }: { children: ReactNode }) {
  const me = await requireGuardianSession();
  return <ParentShell me={me}>{children}</ParentShell>;
}

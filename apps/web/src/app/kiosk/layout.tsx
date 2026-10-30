import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Borne de commande — Ocall Park',
  robots: { index: false, follow: false },
};

/** Tablette en mode kiosque : pas de zoom accidentel, plein écran. */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

/**
 * Borne libre-service : aucune navigation vers l'espace d'administration, aucune session d'employé.
 * À afficher en plein écran (mode kiosque du navigateur ou épinglage d'écran Android).
 */
export default function KioskLayout({ children }: { children: ReactNode }) {
  return <main className="min-h-screen select-none bg-ivory text-charcoal">{children}</main>;
}

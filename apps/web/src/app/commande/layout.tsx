import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Commander — Ocall Park',
  // Menus et suivis de commande : pages personnelles, jamais indexées.
  robots: { index: false, follow: false },
};

/** Pages publiques de commande par QR code : sans compte, pensées pour le téléphone du client. */
export default function CommandeLayout({ children }: { children: ReactNode }) {
  return <main className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-28 pt-4">{children}</main>;
}

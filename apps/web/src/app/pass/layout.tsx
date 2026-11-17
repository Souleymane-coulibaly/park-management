import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/** Page personnelle d'un titulaire de pass : jamais indexée, jamais mise en cache par un tiers. */
export const metadata: Metadata = {
  title: { absolute: 'Mon pass' },
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function PassLayout({ children }: { children: ReactNode }) {
  return children;
}

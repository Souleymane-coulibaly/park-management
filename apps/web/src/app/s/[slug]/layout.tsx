import { Noto_Naskh_Arabic } from 'next/font/google';
import type { ReactNode } from 'react';

/** Police arabe des sites d'établissements (chargée par Next.js, servie par l'application elle-même). */
const arabic = Noto_Naskh_Arabic({
  subsets: ['arabic'],
  weight: ['400', '600', '700'],
  variable: '--font-arabic',
  display: 'swap',
});

export default function SchoolSiteLayout({ children }: { children: ReactNode }) {
  return <div className={arabic.variable}>{children}</div>;
}

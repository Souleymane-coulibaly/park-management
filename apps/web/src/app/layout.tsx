import type { Metadata, Viewport } from 'next';
import { Inter, Outfit } from 'next/font/google';
import type { ReactNode } from 'react';
import { isIndexingBlocked } from '@/lib/indexing';
import './globals.css';

const body = Inter({ subsets: ['latin'], variable: '--font-body', display: 'swap' });
const display = Outfit({ subsets: ['latin'], variable: '--font-display', display: 'swap' });

export const metadata: Metadata = {
  title: {
    default: 'Ocall Park — Logiciel de gestion pour parcs et restaurants',
    template: '%s · Ocall Park',
  },
  description:
    'Ocall Park est le logiciel de gestion des parcs aquatiques, espaces de loisirs et restaurants en Afrique : établissements, équipes, rôles et abonnement en FCFA.',
  applicationName: 'Ocall Park',
  // Préproduction : balise robots en plus de l'en-tête X-Robots-Tag (voir lib/indexing.ts).
  ...(isIndexingBlocked() ? { robots: { index: false, follow: false } } : {}),
  manifest: '/manifest.webmanifest',
  icons: { apple: '/icons/apple-touch-icon.png' },
  // iPhone : installation par « Sur l'écran d'accueil », écrans de lancement par format d'appareil.
  appleWebApp: {
    capable: true,
    title: 'Ocall Park',
    statusBarStyle: 'default',
    startupImage: [
      [375, 667, 2, 750, 1334],
      [414, 896, 2, 828, 1792],
      [390, 844, 3, 1170, 2532],
      [393, 852, 3, 1179, 2556],
      [430, 932, 3, 1290, 2796],
    ].map(([w, h, ratio, pw, ph]) => ({
      url: `/icons/splash-${pw}x${ph}.png`,
      media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait)`,
    })),
  },
};

export const viewport: Viewport = {
  themeColor: '#176B53',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className={`${body.variable} ${display.variable}`}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}

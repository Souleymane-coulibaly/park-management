import type { Metadata, Viewport } from 'next';
import { Inter, Outfit } from 'next/font/google';
import type { ReactNode } from 'react';
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
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = { themeColor: '#176B53', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className={`${body.variable} ${display.variable}`}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}

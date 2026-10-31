'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Download, Share, Wifi, WifiOff } from 'lucide-react';
import { useCan } from '@/components/app/session-context';
import { Button, buttonClass } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { useConnectivity } from '@/lib/connectivity';
import { applyUpdate, promptInstall, usePwa } from '@/lib/pwa';

type InstallContext = 'unknown' | 'installed' | 'ios' | 'other';

function detectInstallContext(): InstallContext {
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return 'installed';
  // iPadOS se présente comme un Mac : l'écran tactile le distingue.
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios ? 'ios' : 'other';
}

/** Réglages de cet appareil : installation, réseau, version. Les réglages métier restent réservés. */
export default function ParametresParcPage() {
  const online = useConnectivity();
  const { canInstall, updateReady } = usePwa();
  const canManage = useCan('ticketing.manage');
  const [context, setContext] = useState<InstallContext>('unknown');
  useEffect(() => setContext(detectInstallContext()), []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Paramètres</h1>
      <Card>
        <CardBody>
          <h2 className="mb-3 font-semibold">Application sur cet appareil</h2>
          <div className="space-y-3 text-sm" data-testid="pwa-install">
            {context === 'installed' && <p>Ocall Park est installée sur cet appareil.</p>}
            {context === 'ios' && (
              <p className="flex items-start gap-2">
                <Share className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                <span>
                  Dans Safari, touchez <strong>Partager</strong>, puis{' '}
                  <strong>Sur l’écran d’accueil</strong>.
                </span>
              </p>
            )}
            {context === 'other' &&
              (canInstall ? (
                <Button
                  size="lg"
                  icon={<Download className="h-5 w-5" />}
                  onClick={() => void promptInstall()}
                >
                  Installer l’application
                </Button>
              ) : (
                <p>
                  Sur Android, ouvrez le menu de Chrome, puis touchez{' '}
                  <strong>Installer l’application</strong>.
                </p>
              ))}
            {updateReady && (
              <Button variant="secondary" onClick={applyUpdate}>
                Installer la nouvelle version
              </Button>
            )}
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <h2 className="mb-3 font-semibold">Réseau</h2>
          <p className="flex items-center gap-2 text-sm font-semibold" data-testid="network-state">
            {online ? (
              <>
                <Wifi className="h-5 w-5 text-forest" aria-hidden /> Connecté au serveur
              </>
            ) : (
              <>
                <WifiOff className="h-5 w-5 text-terracotta-dark" aria-hidden /> Ventes et entrées
                suspendues : pas de connexion
              </>
            )}
          </p>
        </CardBody>
      </Card>
      <div className="flex flex-wrap gap-2">
        {canManage && (
          <Link href="/app/billetterie/configuration" className={buttonClass('secondary')}>
            Tarifs et horaires
          </Link>
        )}
        <Link href="/app/compte" className={buttonClass('secondary')}>
          Mon compte
        </Link>
      </div>
    </div>
  );
}

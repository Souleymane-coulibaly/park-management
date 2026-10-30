'use client';

import { type FormEvent, useState } from 'react';
import { KeyRound, MonitorSmartphone, Plus, ShieldOff } from 'lucide-react';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { RestaurantNav } from '@/components/restaurant/restaurant-nav';
import { RestaurantScope } from '@/components/restaurant/restaurant-scope';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { KioskDevice, PosTerminal } from '@/lib/types';
import { useApi } from '@/lib/use-api';

const STATUS: Record<
  KioskDevice['status'],
  { label: string; tone: 'forest' | 'savanna' | 'neutral' | 'terracotta' }
> = {
  PAIRED: { label: 'Appairée', tone: 'forest' },
  AWAITING_PAIRING: { label: 'En attente d’appairage', tone: 'savanna' },
  UNPAIRED: { label: 'Non appairée', tone: 'neutral' },
  REVOKED: { label: 'Révoquée', tone: 'terracotta' },
};

/** Bornes de commande libre-service : création, appairage par code à usage unique, révocation. */
export default function BornesPage() {
  const canManage = useCan('kiosk.manage');
  if (!canManage) return <AccessDenied />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Bornes de commande</h1>
        <RestaurantNav />
      </div>
      <RestaurantScope>{(e) => <Devices establishmentId={e.id} />}</RestaurantScope>
    </div>
  );
}

function Devices({ establishmentId }: { establishmentId: string }) {
  const devices = useApi<KioskDevice[]>(`/kiosk-devices?establishmentId=${establishmentId}`);
  const terminals = useApi<PosTerminal[]>(`/pos-terminals?establishmentId=${establishmentId}`);
  const printers =
    terminals.state === 'success'
      ? terminals.data.filter((t) => t.isActive && t.printerConnection !== 'NONE')
      : [];
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState<{ name: string; code: string } | null>(null);
  const [revoking, setRevoking] = useState<KioskDevice | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function setPrinter(device: KioskDevice, terminalId: string) {
    setError(null);
    try {
      await api(`/kiosk-devices/${device.id}/printer`, {
        method: 'POST',
        body: { terminalId: terminalId || null },
      });
      devices.reload();
    } catch (e) {
      setError(e as ApiError);
    }
  }

  async function newCode(device: KioskDevice) {
    setError(null);
    try {
      const res = await api<{ pairingCode: string }>(`/kiosk-devices/${device.id}/pairing-code`, {
        method: 'POST',
      });
      setCode({ name: device.name, code: res.pairingCode });
      devices.reload();
    } catch (e) {
      setError(e as ApiError);
    }
  }

  return (
    <div className="space-y-3">
      <Alert tone="info">
        Sur la tablette, ouvrez l’adresse <strong>/kiosk</strong> (bouton ci-dessous) en plein écran
        (mode kiosque ou épinglage d’écran) et saisissez le code d’appairage. Les commandes de la
        borne arrivent dans « Commandes » comme demandes à valider : elles se règlent à la caisse et
        ne partent jamais seules en cuisine.
      </Alert>
      <a
        href="/kiosk"
        target="_blank"
        rel="noopener"
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:border-forest"
      >
        <MonitorSmartphone className="h-4 w-4" aria-hidden /> Ouvrir la borne sur cet appareil
      </a>
      <ApiErrorAlert error={error} />
      <Card>
        <CardHeader
          title="Bornes de l’établissement"
          action={
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              Nouvelle borne
            </Button>
          }
        />
        {devices.state === 'loading' && <LoadingState />}
        {devices.state === 'error' && <ErrorState error={devices.error} onRetry={devices.reload} />}
        {devices.state === 'success' && devices.data.length === 0 && (
          <EmptyState
            icon={<MonitorSmartphone className="h-7 w-7" />}
            title="Aucune borne"
            description="Créez une borne pour obtenir son code d’appairage."
          />
        )}
        {devices.state === 'success' && devices.data.length > 0 && (
          <ul className="divide-y divide-line/70">
            {devices.data.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-6"
                data-testid="kiosk-device"
              >
                <div>
                  <p className="font-semibold">{d.name}</p>
                  <p className="text-sm text-muted">
                    {d.lastSeenAt
                      ? `Dernière activité : ${formatDateTime(d.lastSeenAt)}`
                      : 'Jamais connectée'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-sm">
                    <span className="sr-only">Imprimante des tickets de {d.name}</span>
                    <select
                      aria-label={`Imprimante des tickets de ${d.name}`}
                      className="min-h-9 rounded-xl border border-line bg-surface px-2 text-sm"
                      value={d.printerTerminal?.id ?? ''}
                      onChange={(e) => setPrinter(d, e.target.value)}
                    >
                      <option value="">Sans ticket imprimé</option>
                      {printers.map((t) => (
                        <option key={t.id} value={t.id}>
                          Ticket sur : {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<KeyRound className="h-4 w-4" />}
                    onClick={() => newCode(d)}
                  >
                    Code d’appairage
                  </Button>
                  {d.status !== 'REVOKED' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<ShieldOff className="h-4 w-4" />}
                      onClick={() => setRevoking(d)}
                    >
                      Révoquer
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {creating && (
        <CreateDialog
          establishmentId={establishmentId}
          onClose={() => setCreating(false)}
          onCreated={(name, pairingCode) => {
            setCreating(false);
            setCode({ name, code: pairingCode });
            devices.reload();
          }}
        />
      )}
      {code && (
        <Dialog open onClose={() => setCode(null)} title={`Code d’appairage — ${code.name}`}>
          <div className="space-y-4 text-center">
            <p className="font-mono text-4xl font-bold tracking-[0.3em]" data-testid="pairing-code">
              {code.code}
            </p>
            <Alert tone="info">
              Valable 15 minutes, à usage unique. Il n’est plus affiché ensuite : notez-le sur la
              tablette uniquement.
            </Alert>
            <Button className="w-full" onClick={() => setCode(null)}>
              Fermer
            </Button>
          </div>
        </Dialog>
      )}
      {revoking && (
        <Dialog open onClose={() => setRevoking(null)} title={`Révoquer ${revoking.name} ?`}>
          <div className="space-y-4">
            <Alert tone="error">
              La borne cesse immédiatement de fonctionner (perte, vol, remplacement). Pour la
              réutiliser, générez un nouveau code d’appairage.
            </Alert>
            <Button
              variant="danger"
              className="w-full"
              onClick={async () => {
                setError(null);
                try {
                  await api(`/kiosk-devices/${revoking.id}/revoke`, { method: 'POST' });
                  devices.reload();
                } catch (e) {
                  setError(e as ApiError);
                }
                setRevoking(null);
              }}
            >
              Révoquer la borne
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function CreateDialog({
  establishmentId,
  onClose,
  onCreated,
}: {
  establishmentId: string;
  onClose: () => void;
  onCreated: (name: string, pairingCode: string) => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ pairingCode: string }>('/kiosk-devices', {
        method: 'POST',
        body: { establishmentId, name },
      });
      onCreated(name, res.pairingCode);
    } catch (e) {
      setError(e as ApiError);
      setLoading(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title="Nouvelle borne">
      <form onSubmit={onSubmit} className="space-y-4">
        <ApiErrorAlert error={error} />
        <InputField
          label="Nom de la borne"
          required
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Borne entrée"
        />
        <Button type="submit" className="w-full" loading={loading}>
          Créer et obtenir le code
        </Button>
      </form>
    </Dialog>
  );
}

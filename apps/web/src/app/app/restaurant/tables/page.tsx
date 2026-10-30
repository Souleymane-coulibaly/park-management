'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { LayoutGrid, Plus, Printer, QrCode, RefreshCw } from 'lucide-react';
import {
  DINING_ZONE_KINDS,
  DINING_ZONE_KIND_LABELS,
  type DiningZoneKind,
  TABLE_STATUS_LABELS,
  type TableStatus,
} from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { TicketQr } from '@/components/park/ticket-qr';
import { RestaurantNav } from '@/components/restaurant/restaurant-nav';
import { RestaurantScope } from '@/components/restaurant/restaurant-scope';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import type { DiningOverview, DiningTable, DiningZone } from '@/lib/types';
import { useApi } from '@/lib/use-api';

const STATUS_TONE: Record<TableStatus, 'forest' | 'terracotta' | 'savanna' | 'neutral'> = {
  FREE: 'forest',
  OCCUPIED: 'terracotta',
  RESERVED: 'savanna',
  OUT_OF_SERVICE: 'neutral',
};

/** Salles, zones et tables : configuration, statut en temps réel et QR codes de commande. */
export default function TablesPage() {
  const canManage = useCan('tables.manage');
  if (!canManage) return <AccessDenied />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Salles et tables</h1>
        <RestaurantNav />
      </div>
      <RestaurantScope>{(e) => <DiningConfig establishmentId={e.id} />}</RestaurantScope>
    </div>
  );
}

type QrTarget = { kind: 'table' | 'zone'; id: string; label: string; qrPath: string };

function DiningConfig({ establishmentId }: { establishmentId: string }) {
  const dining = useApi<DiningOverview>(`/restaurant/dining?establishmentId=${establishmentId}`);
  const [zoneForm, setZoneForm] = useState(false);
  const [tableForm, setTableForm] = useState<DiningTable | 'new' | null>(null);
  const [qr, setQr] = useState<QrTarget | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  if (dining.state === 'loading') return <LoadingState />;
  if (dining.state === 'error') return <ErrorState error={dining.error} onRetry={dining.reload} />;
  const { zones, tables } = dining.data;
  const zoneName = (id: string | null) => zones.find((z) => z.id === id)?.name ?? null;

  async function toggleZone(zone: DiningZone) {
    setError(null);
    try {
      await api(`/restaurant/zones/${zone.id}`, {
        method: 'PATCH',
        body: { isActive: !zone.isActive },
      });
      dining.reload();
    } catch (e) {
      setError(e as ApiError);
    }
  }

  const groups: { id: string | null; title: string }[] = [
    ...zones.map((z) => ({ id: z.id, title: z.name })),
    { id: null, title: 'Sans zone' },
  ];

  return (
    <div className="space-y-4">
      <ApiErrorAlert error={error} />
      <Alert tone="info">
        Les zones sont facultatives : un restaurant fonctionne sans zone et sans bord de piscine.
        Chaque table et chaque zone a son QR code ; le client commande sans compte, et sa demande
        doit être validée par un employé avant d’être payée ou envoyée en cuisine.
      </Alert>

      <Card>
        <CardHeader
          title="Zones"
          description="Salle, terrasse, bord de piscine ou espace personnalisé."
          action={
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setZoneForm(true)}>
              Nouvelle zone
            </Button>
          }
        />
        {zones.length === 0 ? (
          <CardBody>
            <p className="text-sm text-muted">
              Aucune zone : toutes les tables sont « sans zone ».
            </p>
          </CardBody>
        ) : (
          <ul className="divide-y divide-line/70">
            {zones.map((z) => (
              <li
                key={z.id}
                className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 sm:px-6"
              >
                <div>
                  <p className="font-semibold">{z.name}</p>
                  <p className="text-sm text-muted">
                    {DINING_ZONE_KIND_LABELS[z.kind]}
                    {!z.isActive && ' · désactivée'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<QrCode className="h-4 w-4" />}
                    onClick={() =>
                      setQr({ kind: 'zone', id: z.id, label: z.name, qrPath: z.qrPath })
                    }
                  >
                    QR de zone
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => toggleZone(z)}>
                    {z.isActive ? 'Désactiver' : 'Réactiver'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Tables"
          description="Statut en direct : libre, occupée (commande en cours), réservée, hors service."
          action={
            <Button
              size="sm"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => setTableForm('new')}
            >
              Nouvelle table
            </Button>
          }
        />
        {tables.length === 0 ? (
          <EmptyState
            icon={<LayoutGrid className="h-7 w-7" />}
            title="Aucune table"
            description="Créez vos tables pour les commandes sur place, les QR codes et les réservations."
          />
        ) : (
          <div className="space-y-5 px-5 py-5 sm:px-6">
            {groups.map((g) => {
              const inGroup = tables.filter((t) => t.zoneId === g.id);
              if (inGroup.length === 0) return null;
              return (
                <section key={g.id ?? 'none'}>
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
                    {g.title}
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {inGroup.map((t) => (
                      <div
                        key={t.id}
                        className="rounded-xl border border-line p-3"
                        data-testid="dining-table"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold">{t.name}</p>
                            <p className="text-sm text-muted">
                              {t.seats} couverts
                              {t.activeOrders > 0 && ` · ${t.activeOrders} commande(s) en cours`}
                            </p>
                          </div>
                          <Badge tone={STATUS_TONE[t.status]}>
                            {TABLE_STATUS_LABELS[t.status]}
                          </Badge>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<QrCode className="h-4 w-4" />}
                            onClick={() =>
                              setQr({
                                kind: 'table',
                                id: t.id,
                                label: [zoneName(t.zoneId), t.name].filter(Boolean).join(' · '),
                                qrPath: t.qrPath,
                              })
                            }
                          >
                            QR code
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setTableForm(t)}>
                            Modifier
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </Card>

      {zoneForm && (
        <ZoneDialog
          establishmentId={establishmentId}
          onClose={() => setZoneForm(false)}
          onSaved={() => {
            setZoneForm(false);
            dining.reload();
          }}
        />
      )}
      {tableForm && (
        <TableDialog
          establishmentId={establishmentId}
          table={tableForm === 'new' ? null : tableForm}
          zones={zones}
          onClose={() => setTableForm(null)}
          onSaved={() => {
            setTableForm(null);
            dining.reload();
          }}
        />
      )}
      {qr && (
        <QrDialog
          target={qr}
          onClose={() => setQr(null)}
          onRegenerated={(qrPath) => {
            setQr({ ...qr, qrPath });
            dining.reload();
          }}
        />
      )}
    </div>
  );
}

function ZoneDialog({
  establishmentId,
  onClose,
  onSaved,
}: {
  establishmentId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<DiningZoneKind>('ROOM');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api('/restaurant/zones', { method: 'POST', body: { establishmentId, name, kind } });
      onSaved();
    } catch (e) {
      setError(e as ApiError);
      setLoading(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title="Nouvelle zone">
      <form onSubmit={onSubmit} className="space-y-4">
        <ApiErrorAlert error={error} />
        <InputField
          label="Nom"
          required
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Terrasse"
        />
        <SelectField
          label="Type"
          value={kind}
          onChange={(e) => setKind(e.target.value as DiningZoneKind)}
          options={DINING_ZONE_KINDS.map((k) => ({ value: k, label: DINING_ZONE_KIND_LABELS[k] }))}
        />
        <Button type="submit" className="w-full" loading={loading}>
          Créer la zone
        </Button>
      </form>
    </Dialog>
  );
}

function TableDialog({
  establishmentId,
  table,
  zones,
  onClose,
  onSaved,
}: {
  establishmentId: string;
  table: DiningTable | null;
  zones: DiningZone[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(table?.name ?? '');
  const [zoneId, setZoneId] = useState(table?.zoneId ?? '');
  const [seats, setSeats] = useState(String(table?.seats ?? 4));
  const [isActive, setIsActive] = useState(table?.isActive ?? true);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (table) {
        await api(`/restaurant/tables/${table.id}`, {
          method: 'PATCH',
          body: { name, zoneId: zoneId || null, seats: Number(seats), isActive },
        });
      } else {
        await api('/restaurant/tables', {
          method: 'POST',
          body: { establishmentId, name, seats: Number(seats), ...(zoneId ? { zoneId } : {}) },
        });
      }
      onSaved();
    } catch (e) {
      setError(e as ApiError);
      setLoading(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title={table ? `Modifier ${table.name}` : 'Nouvelle table'}>
      <form onSubmit={onSubmit} className="space-y-4">
        <ApiErrorAlert error={error} />
        <InputField
          label="Nom ou numéro"
          required
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Table 4"
        />
        <SelectField
          label="Zone"
          value={zoneId}
          onChange={(e) => setZoneId(e.target.value)}
          options={[
            { value: '', label: 'Sans zone' },
            ...zones
              .filter((z) => z.isActive || z.id === zoneId)
              .map((z) => ({ value: z.id, label: z.name })),
          ]}
        />
        <InputField
          label="Couverts"
          type="number"
          min={1}
          max={100}
          required
          value={seats}
          onChange={(e) => setSeats(e.target.value)}
        />
        {table && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-forest"
              checked={!isActive}
              onChange={(e) => setIsActive(!e.target.checked)}
            />
            Hors service (aucune commande QR ni réservation)
          </label>
        )}
        <Button type="submit" className="w-full" loading={loading}>
          Enregistrer
        </Button>
      </form>
    </Dialog>
  );
}

function QrDialog({
  target,
  onClose,
  onRegenerated,
}: {
  target: QrTarget;
  onClose: () => void;
  onRegenerated: (qrPath: string) => void;
}) {
  const [origin, setOrigin] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);
  const url = `${origin}${target.qrPath}`;

  function print() {
    document.body.classList.add('printing-area');
    window.print();
    document.body.classList.remove('printing-area');
  }

  async function regenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ qrPath: string }>(
        `/restaurant/${target.kind}s/${target.id}/regenerate-qr`,
        {
          method: 'POST',
        },
      );
      setConfirming(false);
      onRegenerated(res.qrPath);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`QR code — ${target.label}`}
      description="À placer sur la table ou dans la zone"
    >
      <div className="space-y-4">
        <ApiErrorAlert error={error} />
        <div className="print-area flex flex-col items-center gap-2 rounded-2xl border border-line p-4">
          {origin && (
            <TicketQr value={url} size={220} label={`QR code de commande — ${target.label}`} />
          )}
          <p className="text-lg font-bold">{target.label}</p>
          <p className="text-sm">Scannez pour consulter le menu et commander</p>
        </div>
        <p className="break-all text-xs text-muted" data-testid="qr-url">
          {url}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={print}>
            Imprimer
          </Button>
          <Button
            variant="ghost"
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={() => setConfirming(true)}
          >
            Régénérer
          </Button>
        </div>
        {confirming && (
          <Alert tone="error" title="Régénérer le QR code ?">
            <p>L’ancien QR code (imprimé ou photographié) cessera immédiatement de fonctionner.</p>
            <Button
              variant="danger"
              size="sm"
              className="mt-2"
              loading={loading}
              onClick={regenerate}
            >
              Confirmer la régénération
            </Button>
          </Alert>
        )}
      </div>
    </Dialog>
  );
}

'use client';

import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { Lock, Unlock, Vault, WifiOff } from 'lucide-react';
import { computeCashVariance, formatXof } from '@ocall/shared';
import { useCan } from '@/components/app/session-context';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { type HardwareOutcome, runDrawerOpening } from '@/lib/hardware/jobs';
import type { useDeviceTerminal } from '@/lib/hardware/use-terminal';
import type { CashSession, PosTerminal } from '@/lib/types';
import { useApi } from '@/lib/use-api';

/**
 * Briques communes aux écrans d'encaissement (caisse restaurant et billetterie du parc) :
 * session de caisse, poste et tiroir, état du réseau. Un seul moteur de vente, une seule interface de caisse.
 */

export const toApiError = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion au serveur impossible.');

/** Saisie d'un montant entier en FCFA (clavier numérique sur tablette). */
export function AmountInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
        className="mt-1.5 block w-full rounded-xl border border-line bg-surface px-4 py-3 text-right font-display text-2xl font-bold focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/20"
        placeholder="0"
      />
    </div>
  );
}

/** Établissement choisi sur cet appareil, mémorisé localement (clé propre à chaque écran). */
export function useRememberedChoice(storageKey: string, ids: string[] | null) {
  const [selected, setSelected] = useState<string | null>(null);
  const idsKey = ids?.join(',') ?? null;

  useEffect(() => {
    if (!ids) return;
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(storageKey);
    } catch {
      remembered = null;
    }
    setSelected((current) =>
      current && ids.includes(current)
        ? current
        : (ids.find((id) => id === remembered) ?? ids[0] ?? null),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- idsKey résume la liste
  }, [idsKey, storageKey]);

  function choose(id: string) {
    setSelected(id);
    try {
      localStorage.setItem(storageKey, id);
    } catch {
      // Stockage indisponible (navigation privée) : le choix vaut pour la page en cours.
    }
  }
  return [selected, choose] as const;
}

/** Affiche l'écran d'encaissement seulement si la session de caisse est ouverte ; sinon, l'ouverture. */
export function CashSessionGate({
  establishmentId,
  children,
}: {
  establishmentId: string;
  children: (session: CashSession, reload: () => void) => ReactNode;
}) {
  const session = useApi<CashSession | null>(
    `/cash-sessions/current?establishmentId=${establishmentId}`,
  );
  if (session.state === 'loading')
    return <LoadingState label="Vérification de la session de caisse…" />;
  if (session.state === 'error')
    return <ErrorState error={session.error} onRetry={session.reload} />;
  if (!session.data)
    return <OpenSession establishmentId={establishmentId} onOpened={session.reload} />;
  return <>{children(session.data, session.reload)}</>;
}

function OpenSession({
  establishmentId,
  onOpened,
}: {
  establishmentId: string;
  onOpened: () => void;
}) {
  const [float, setFloat] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api('/cash-sessions', {
        method: 'POST',
        body: { establishmentId, openingFloat: Number(float || 0) },
      });
      onOpened();
    } catch (e) {
      setError(toApiError(e));
      setLoading(false);
    }
  }

  return (
    <Card className="pattern-kente mx-auto max-w-md">
      <form onSubmit={onSubmit} className="space-y-5 bg-surface/95 p-6">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-forest text-ivory">
            <Unlock className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h2 className="text-lg font-bold">Ouvrir la caisse</h2>
            <p className="text-sm text-muted">Comptez les espèces présentes dans le tiroir.</p>
          </div>
        </div>
        <ApiErrorAlert error={error} />
        <AmountInput
          id="opening-float"
          label="Fond de caisse (FCFA)"
          value={float}
          onChange={setFloat}
        />
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          Ouvrir la caisse
        </Button>
      </form>
    </Card>
  );
}

/** Bandeau de la session ouverte : ventes, espèces attendues, fermeture. */
export function SessionBar({
  session,
  onSessionChange,
}: {
  session: CashSession;
  onSessionChange: () => void;
}) {
  const [closing, setClosing] = useState(false);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-charcoal px-4 py-3 text-ivory">
        <div className="text-sm">
          <span className="font-semibold">Caisse ouverte</span>
          <span className="text-ivory/70">
            {' '}
            depuis {formatDateTime(session.openedAt)} · {session.salesCount} vente(s)
          </span>
          {session.unpaidCount > 0 && (
            <span className="text-savanna"> · {session.unpaidCount} non payée(s)</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm">
            Espèces attendues :{' '}
            <strong data-testid="expected-cash">{formatXof(session.expectedCash)}</strong>
          </span>
          <Button
            variant="accent"
            size="sm"
            onClick={() => setClosing(true)}
            icon={<Lock className="h-4 w-4" />}
          >
            Fermer la caisse
          </Button>
        </div>
      </div>
      {closing && (
        <CloseSessionDialog
          session={session}
          onClose={() => setClosing(false)}
          onClosed={onSessionChange}
        />
      )}
    </>
  );
}

/** Poste de caisse de l'appareil (impression, tiroir) et ouverture manuelle du tiroir. */
export function DeviceBar({ device }: { device: ReturnType<typeof useDeviceTerminal> }) {
  const canOpenDrawer = useCan('drawer.open_manual');
  const canManageHardware = useCan('hardware.manage');
  const [manualDrawer, setManualDrawer] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      {device.terminals.length > 1 ? (
        <div className="w-56">
          <SelectField
            label="Poste de caisse"
            value={device.terminal?.id ?? ''}
            onChange={(e) => device.select(e.target.value || null)}
            options={[
              { value: '', label: 'Choisir un poste…' },
              ...device.terminals.map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
        </div>
      ) : device.terminal ? (
        <span
          className="rounded-xl border border-line bg-surface px-3 py-2"
          data-testid="device-terminal"
        >
          Poste : <strong>{device.terminal.name}</strong>
        </span>
      ) : (
        !device.loading && (
          <span className="text-muted">
            Aucun poste de caisse : impression et tiroir désactivés.
            {canManageHardware && (
              <Link
                href="/app/caisse/materiel"
                className="ml-1 font-semibold text-forest underline"
              >
                Configurer le matériel
              </Link>
            )}
          </span>
        )
      )}
      {canOpenDrawer && device.terminal?.drawerEnabled && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setManualDrawer(true)}
          icon={<Vault className="h-4 w-4" />}
        >
          Ouvrir le tiroir
        </Button>
      )}
      {manualDrawer && device.terminal && (
        <ManualDrawerDialog terminal={device.terminal} onClose={() => setManualDrawer(false)} />
      )}
    </div>
  );
}

/** Hors connexion, aucune opération n'est enregistrée localement : l'écran le dit clairement. */
export function OfflineBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-xl border border-terracotta/40 bg-terracotta-light/60 px-4 py-3 text-sm font-semibold text-terracotta-dark"
    >
      <WifiOff className="h-5 w-5 shrink-0" aria-hidden /> {children}
    </div>
  );
}

function CloseSessionDialog({
  session,
  onClose,
  onClosed,
}: {
  session: CashSession;
  onClose: () => void;
  onClosed: () => void;
}) {
  const [counted, setCounted] = useState('');
  const [result, setResult] = useState<CashSession | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const amount = counted === '' ? null : Number(counted);
  const preview = amount !== null ? computeCashVariance(session.expectedCash, amount) : null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (amount === null) return;
    setLoading(true);
    setError(null);
    try {
      setResult(
        await api<CashSession>(`/cash-sessions/${session.id}/close`, {
          method: 'POST',
          body: { countedCash: amount },
        }),
      );
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    const variance = result.variance ?? 0;
    return (
      <Dialog open onClose={onClosed} title="Caisse fermée">
        <div className="space-y-4">
          <dl className="space-y-2 rounded-2xl border border-line bg-ivory/60 p-4">
            <div className="flex justify-between">
              <dt>Espèces attendues</dt>
              <dd className="font-semibold">{formatXof(result.expectedCash)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Espèces comptées</dt>
              <dd className="font-semibold">{formatXof(result.countedCash ?? 0)}</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-2 text-xl">
              <dt className="font-semibold">Écart</dt>
              <dd
                className={`font-display font-bold ${variance < 0 ? 'text-terracotta-dark' : 'text-forest'}`}
                data-testid="cash-variance"
              >
                {variance > 0 ? '+' : ''}
                {formatXof(variance)}
              </dd>
            </div>
          </dl>
          {variance !== 0 && (
            <Alert tone="info">
              L’écart est enregistré dans l’historique des sessions et le journal d’audit.
            </Alert>
          )}
          <Button className="w-full" size="lg" onClick={onClosed}>
            Terminer
          </Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Fermer la caisse"
      description="Comptez les espèces du tiroir avant de valider."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <dl className="space-y-1 rounded-xl bg-ivory/70 p-4 text-sm">
          <div className="flex justify-between">
            <dt>Fond de caisse</dt>
            <dd>{formatXof(session.openingFloat)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Encaissements en espèces</dt>
            <dd>{formatXof(session.cashSalesTotal)}</dd>
          </div>
          <div className="flex justify-between font-semibold">
            <dt>Espèces attendues</dt>
            <dd>{formatXof(session.expectedCash)}</dd>
          </div>
        </dl>
        {session.unpaidCount > 0 && (
          <Alert tone="info">
            {session.unpaidCount} vente(s) non payée(s) resteront à encaisser depuis l’historique.
          </Alert>
        )}
        <AmountInput
          id="counted-cash"
          label="Espèces comptées (FCFA)"
          value={counted}
          onChange={setCounted}
        />
        {preview !== null && (
          <p
            className={`text-right text-sm font-semibold ${preview < 0 ? 'text-terracotta-dark' : 'text-forest'}`}
          >
            Écart prévu : {preview > 0 ? '+' : ''}
            {formatXof(preview)}
          </p>
        )}
        <ApiErrorAlert error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" loading={loading} disabled={amount === null}>
            Valider la fermeture
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Ouverture manuelle du tiroir : réservée aux responsables, justification obligatoire, auditée. */
function ManualDrawerDialog({ terminal, onClose }: { terminal: PosTerminal; onClose: () => void }) {
  const [justification, setJustification] = useState('');
  const [outcome, setOutcome] = useState<HardwareOutcome | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setOutcome(
      await runDrawerOpening({ terminalId: terminal.id, reason: 'MANUAL', justification }),
    );
    setLoading(false);
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Ouvrir le tiroir-caisse"
      description={`Poste ${terminal.name} — l’ouverture est enregistrée dans le journal d’audit.`}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="drawer-justification" className="block text-sm font-medium">
            Justification
          </label>
          <textarea
            id="drawer-justification"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={3}
            maxLength={200}
            className="mt-1.5 block w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/20"
            placeholder="Ex. dépôt du fond de caisse, échange de monnaie…"
          />
        </div>
        {outcome?.status === 'SUCCEEDED' && <Alert tone="success">Tiroir ouvert.</Alert>}
        {outcome?.status === 'FAILED' && (
          <Alert tone="error" title="Ouverture impossible">
            {outcome.message}
          </Alert>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Fermer
          </Button>
          <Button
            type="submit"
            loading={loading}
            disabled={justification.trim().length < 5 || outcome?.status === 'SUCCEEDED'}
          >
            Ouvrir le tiroir
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

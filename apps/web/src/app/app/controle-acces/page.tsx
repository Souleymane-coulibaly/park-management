'use client';

import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ScanLine, XCircle } from 'lucide-react';
import { SCAN_REFUSAL_LABELS } from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { ParkEstablishmentScope } from '@/components/park/park-establishment';
import { ParkNav } from '@/components/park/park-nav';
import { OfflineBanner, toApiError } from '@/components/pos/cash-session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useOnline, useWakeLock } from '@/lib/hardware/use-terminal';
import { newRequestId } from '@/lib/request-id';
import type { ParkEstablishment, TicketScanView } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { CameraScanner } from './camera-scanner';

const ENTRY_POINT_KEY = 'ocp.gate.entryPoint';
/** Un même QR relu par la caméra dans ce délai n'est pas renvoyé (le visiteur tient encore son billet). */
const SAME_CODE_COOLDOWN_MS = 4000;

const timeFormatter = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** Contrôle des entrées : scan caméra ou saisie, validation par le serveur uniquement. */
export default function ControleAccesPage() {
  const canScan = useCan('access.scan');
  if (!canScan) return <AccessDenied />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Contrôle des entrées</h1>
        <ParkNav />
      </div>
      <ParkEstablishmentScope source="/access/establishments">
        {(park) => <Gate park={park} />}
      </ParkEstablishmentScope>
    </div>
  );
}

type Outcome = { kind: 'scan'; scan: TicketScanView } | { kind: 'error'; error: ApiError };

function Gate({ park }: { park: ParkEstablishment }) {
  const online = useOnline();
  useWakeLock(true);
  const [entryPoint, setEntryPoint] = useState('Entrée principale');
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const last = useRef<{ text: string; at: number } | null>(null);
  const history = useApi<TicketScanView[]>(`/access/scans?establishmentId=${park.id}&limit=30`);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(ENTRY_POINT_KEY);
      if (saved) setEntryPoint(saved);
    } catch {
      // Stockage indisponible : point d'entrée par défaut.
    }
  }, []);

  function saveEntryPoint(value: string) {
    setEntryPoint(value);
    try {
      localStorage.setItem(ENTRY_POINT_KEY, value);
    } catch {
      // Stockage indisponible.
    }
  }

  const submit = useCallback(
    async (qr: string) => {
      // Hors connexion, aucun billet n'est validé : la décision appartient au serveur seul.
      if (!online || busy || !qr.trim()) return;
      setBusy(true);
      try {
        const scan = await api<TicketScanView>('/access/scans', {
          method: 'POST',
          body: {
            establishmentId: park.id,
            entryPoint: entryPoint.trim() || 'Entrée',
            qr: qr.trim(),
            clientRequestId: newRequestId(),
          },
        });
        setOutcome({ kind: 'scan', scan });
        navigator.vibrate?.(scan.result === 'ACCEPTED' ? 120 : [300, 100, 300]);
        history.reload();
      } catch (e) {
        setOutcome({ kind: 'error', error: toApiError(e) });
        navigator.vibrate?.([300, 100, 300]);
      } finally {
        setBusy(false);
      }
    },
    [online, busy, park.id, entryPoint, history],
  );

  function onCamera(text: string) {
    const now = Date.now();
    if (last.current && last.current.text === text && now - last.current.at < SAME_CODE_COOLDOWN_MS)
      return;
    last.current = { text, at: now };
    void submit(text);
  }

  function onManual(event: FormEvent) {
    event.preventDefault();
    void submit(manual).then(() => setManual(''));
  }

  return (
    <>
      {!online && (
        <OfflineBanner>
          Hors connexion : validation impossible. Aucun billet ne peut être accepté sans le serveur
          — attendez le retour du réseau.
        </OfflineBanner>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <InputField
            label="Point d’entrée"
            value={entryPoint}
            onChange={(e) => saveEntryPoint(e.target.value.slice(0, 60))}
            maxLength={60}
          />
          <CameraScanner paused={busy || !online} onDetect={onCamera} />
          <form onSubmit={onManual} className="flex items-end gap-2">
            <div className="flex-1">
              <InputField
                label="Saisie manuelle du code"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="OCP1-…"
                autoComplete="off"
              />
            </div>
            <Button
              type="submit"
              loading={busy}
              disabled={!online || manual.trim() === ''}
              icon={<ScanLine className="h-4 w-4" />}
            >
              Valider
            </Button>
          </form>
        </div>
        <ScanResult outcome={outcome} />
      </div>

      <Card>
        <div className="border-b border-line/70 px-4 py-3">
          <h2 className="font-semibold">Derniers passages</h2>
        </div>
        {history.state === 'loading' && <LoadingState />}
        {history.state === 'error' && <ErrorState error={history.error} onRetry={history.reload} />}
        {history.state === 'success' &&
          (history.data.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">Aucun passage enregistré.</p>
          ) : (
            <ul className="divide-y divide-line/70" data-testid="scan-history">
              {history.data.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="w-28 text-muted">{formatDateTime(s.createdAt)}</span>
                  {s.result === 'ACCEPTED' ? (
                    <Badge tone="forest">Accepté</Badge>
                  ) : (
                    <Badge tone="terracotta">
                      {s.refusalReason ? SCAN_REFUSAL_LABELS[s.refusalReason] : 'Refusé'}
                    </Badge>
                  )}
                  <span className="flex-1 truncate">
                    {s.ticket ? `${s.ticket.visitorName} · ${s.ticket.categoryName}` : '—'}
                  </span>
                  <span className="text-muted">
                    {s.entryPoint} · {s.scannedBy}
                  </span>
                </li>
              ))}
            </ul>
          ))}
      </Card>
    </>
  );
}

/** Résultat en très grand : lisible à bout de bras, en plein soleil. */
function ScanResult({ outcome }: { outcome: Outcome | null }) {
  if (!outcome) {
    return (
      <div className="grid min-h-64 place-items-center rounded-3xl border-2 border-dashed border-line p-6 text-center text-muted">
        Présentez le QR code du billet devant la caméra.
      </div>
    );
  }
  if (outcome.kind === 'error') {
    return (
      <div
        role="status"
        className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-3xl bg-terracotta-dark p-6 text-center text-white"
        data-testid="scan-result"
        data-result="ERROR"
      >
        <XCircle className="h-20 w-20" aria-hidden />
        <p className="font-display text-3xl font-bold">Validation impossible</p>
        <p className="text-lg">{outcome.error.message}</p>
        <p className="text-sm text-white/80">Aucune entrée n’a été enregistrée.</p>
      </div>
    );
  }
  const { scan } = outcome;
  const accepted = scan.result === 'ACCEPTED';
  return (
    <div
      role="status"
      aria-live="assertive"
      className={`flex min-h-64 flex-col items-center justify-center gap-3 rounded-3xl p-6 text-center text-white ${accepted ? 'bg-forest' : 'bg-terracotta-dark'}`}
      data-testid="scan-result"
      data-result={scan.result}
    >
      {accepted ? (
        <CheckCircle2 className="h-24 w-24" aria-hidden />
      ) : (
        <XCircle className="h-24 w-24" aria-hidden />
      )}
      <p className="font-display text-4xl font-bold">
        {accepted ? 'Entrée autorisée' : 'Entrée refusée'}
      </p>
      {!accepted && scan.refusalReason && (
        <p className="text-2xl font-semibold">{SCAN_REFUSAL_LABELS[scan.refusalReason]}</p>
      )}
      {scan.ticket && (
        <p className="text-xl">
          {scan.ticket.visitorName} · {scan.ticket.categoryName}
        </p>
      )}
      {scan.refusalReason === 'ALREADY_USED' && scan.ticket?.usedAt && (
        <p className="text-lg">Entré à {timeFormatter.format(new Date(scan.ticket.usedAt))}</p>
      )}
    </div>
  );
}

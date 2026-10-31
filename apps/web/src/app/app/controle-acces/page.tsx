'use client';

import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, RotateCw, ScanLine, XCircle } from 'lucide-react';
import { SCAN_REFUSAL_LABELS } from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { ParkEstablishmentScope } from '@/components/park/park-establishment';
import { ParkNav } from '@/components/park/park-nav';
import { ScanHistoryList } from '@/components/park/scan-history';
import { OfflineBanner, toApiError } from '@/components/pos/cash-session';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useOnline, useWakeLock } from '@/lib/hardware/use-terminal';
import { newRequestId } from '@/lib/request-id';
import type { ParkEstablishment, TicketScanView } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { CameraScanner } from './camera-scanner';

const ENTRY_POINT_KEY = 'ocp.gate.entryPoint';
/** Un même QR relu par la caméra dans ce délai n'est pas renvoyé (le visiteur tient encore son billet). */
const SAME_CODE_COOLDOWN_MS = 4000;
/** Au-delà, l'agent n'attend plus : le résultat passe à l'orange et il peut vérifier à nouveau. */
const SCAN_TIMEOUT_MS = 10_000;

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

type Outcome =
  | { kind: 'scan'; scan: TicketScanView }
  | { kind: 'error'; error: ApiError; qr: string; uncertain: boolean };

/** Sans réponse exploitable (réseau, délai, 5xx), le serveur a pu enregistrer l'entrée. */
const isUncertainFailure = (error: ApiError) => error.status === 0 || error.status >= 500;

function Gate({ park }: { park: ParkEstablishment }) {
  const online = useOnline();
  useWakeLock(true);
  const [entryPoint, setEntryPoint] = useState('Entrée principale');
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const last = useRef<{ text: string; at: number } | null>(null);
  /** Billets dont le résultat n'a pas été reçu, avec leur clé d'idempotence (en mémoire uniquement). */
  const unconfirmed = useRef(new Map<string, string>());
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

  const { reload: reloadHistory } = history;
  useEffect(() => {
    if (online) reloadHistory();
  }, [online, reloadHistory]);

  const submit = useCallback(
    async (rawQr: string) => {
      const qr = rawQr.trim();
      // Hors connexion, aucun billet n'est validé : la décision appartient au serveur seul.
      if (!online || busy || !qr) return;
      setBusy(true);
      // Même billet après une réponse perdue : même clé, le serveur renvoie le résultat déjà enregistré.
      const clientRequestId = unconfirmed.current.get(qr) ?? newRequestId();
      unconfirmed.current.set(qr, clientRequestId);
      try {
        const scan = await api<TicketScanView>('/access/scans', {
          method: 'POST',
          timeoutMs: SCAN_TIMEOUT_MS,
          body: {
            establishmentId: park.id,
            entryPoint: entryPoint.trim() || 'Entrée',
            qr,
            clientRequestId,
          },
        });
        unconfirmed.current.delete(qr);
        setOutcome({ kind: 'scan', scan });
        navigator.vibrate?.(scan.result === 'ACCEPTED' ? 120 : [300, 100, 300]);
        reloadHistory();
      } catch (e) {
        const error = toApiError(e);
        const uncertain = isUncertainFailure(error);
        // Refus explicite du serveur (droits, validation) : le scan n'a pas eu lieu, la clé est libérée.
        if (!uncertain) unconfirmed.current.delete(qr);
        setOutcome({ kind: 'error', error, qr, uncertain });
        navigator.vibrate?.([300, 100, 300]);
      } finally {
        setBusy(false);
      }
    },
    [online, busy, park.id, entryPoint, reloadHistory],
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
        {/* Sur téléphone, le résultat reste visible au-dessus de la caméra. */}
        <div className="sticky top-[4.5rem] z-20 order-first self-start lg:static lg:order-last">
          <ScanResult
            outcome={outcome}
            offline={!online}
            busy={busy}
            onRetry={(qr) => void submit(qr)}
          />
        </div>
        <div className="space-y-3">
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
          <InputField
            label="Point d’entrée"
            value={entryPoint}
            onChange={(e) => saveEntryPoint(e.target.value.slice(0, 60))}
            maxLength={60}
          />
        </div>
      </div>

      <Card>
        <div className="border-b border-line/70 px-4 py-3">
          <h2 className="font-semibold">Derniers passages</h2>
        </div>
        {history.state === 'loading' && <LoadingState />}
        {history.state === 'error' && <ErrorState error={history.error} onRetry={reloadHistory} />}
        {history.state === 'success' && <ScanHistoryList scans={history.data} />}
      </Card>
    </>
  );
}

/** Résultat en très grand : lisible à bout de bras, en plein soleil. */
function ScanResult({
  outcome,
  offline,
  busy,
  onRetry,
}: {
  outcome: Outcome | null;
  offline: boolean;
  busy: boolean;
  onRetry: (qr: string) => void;
}) {
  // Orange : ni entrée ni refus. Seule une réponse du serveur peut faire entrer ou refuser un visiteur.
  if (offline || outcome?.kind === 'error') {
    const failure = outcome?.kind === 'error' ? outcome : null;
    return (
      <div
        role="status"
        aria-live="assertive"
        className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-3xl bg-savanna p-4 text-center text-charcoal lg:min-h-64 lg:gap-3 lg:p-6"
        data-testid="scan-result"
        data-result="UNCERTAIN"
      >
        <AlertTriangle className="h-12 w-12 lg:h-20 lg:w-20" aria-hidden />
        <p className="font-display text-2xl font-bold lg:text-3xl">Vérification impossible</p>
        <p className="text-base font-semibold lg:text-lg">
          {offline ? 'Réseau absent.' : failure!.error.message} Ne laissez pas entrer pour
          l’instant.
        </p>
        {failure && (
          <p className="text-sm">
            {failure.uncertain
              ? 'L’entrée a peut-être été enregistrée : vérifiez à nouveau ce billet.'
              : 'Aucune entrée n’a été enregistrée.'}
          </p>
        )}
        {failure && !offline && (
          <Button
            variant="secondary"
            size="lg"
            loading={busy}
            icon={<RotateCw className="h-5 w-5" />}
            onClick={() => onRetry(failure.qr)}
          >
            Vérifier à nouveau
          </Button>
        )}
      </div>
    );
  }
  if (!outcome) {
    return (
      <div className="hidden min-h-64 place-items-center rounded-3xl border-2 border-dashed border-line p-6 text-center text-muted lg:grid">
        Présentez le QR code du billet devant la caméra.
      </div>
    );
  }
  const { scan } = outcome;
  const accepted = scan.result === 'ACCEPTED';
  return (
    <div
      role="status"
      aria-live="assertive"
      className={`flex min-h-40 flex-col items-center justify-center gap-2 rounded-3xl p-4 text-center text-white lg:min-h-64 lg:gap-3 lg:p-6 ${accepted ? 'bg-forest' : 'bg-terracotta-dark'}`}
      data-testid="scan-result"
      data-result={scan.result}
    >
      {accepted ? (
        <CheckCircle2 className="h-14 w-14 lg:h-24 lg:w-24" aria-hidden />
      ) : (
        <XCircle className="h-14 w-14 lg:h-24 lg:w-24" aria-hidden />
      )}
      <p className="font-display text-3xl font-bold lg:text-4xl">
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

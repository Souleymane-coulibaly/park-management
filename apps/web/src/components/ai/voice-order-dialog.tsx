'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Mic, Plus, Square, Trash2 } from 'lucide-react';
import {
  AI_AUDIO_MAX_BYTES,
  ORDER_CHANNEL_LABELS,
  STAFF_ORDER_CHANNELS,
  type StaffOrderChannel,
  formatXof,
} from '@ocall/shared';
import { AiBadge } from '@/components/ai/ai-availability';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert, ApiErrorAlert } from '@/components/ui/states';
import { type ApiError, api, apiUpload } from '@/lib/api';
import type { AiStatus, DiningOverview, PosCatalogCategory, VoiceOrderDraft } from '@/lib/types';
import { useApi } from '@/lib/use-api';

const MAX_SECONDS = 60;
const ISSUE_LABELS = {
  PRODUCT_NOT_FOUND: 'Produit absent du catalogue : choisissez-le',
  QUANTITY_UNCERTAIN: 'Quantité à confirmer',
  UNCERTAIN: 'Compréhension incertaine',
} as const;

interface CartLine {
  key: number;
  heard: string | null;
  variantId: string;
  quantity: string;
  note: string;
  issues: Array<keyof typeof ISSUE_LABELS>;
}

/** Bouton « Commande vocale » : affiché seulement si la fonctionnalité est utilisable. */
export function VoiceOrderButton({
  establishmentId,
  onCreated,
}: {
  establishmentId: string;
  onCreated: (saleId: string) => void;
}) {
  const status = useApi<AiStatus>('/ai/status');
  const [open, setOpen] = useState(false);
  if (status.state !== 'success' || !status.data.features.VOICE_ORDER) return null;
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        icon={<Mic className="h-4 w-4" />}
        onClick={() => setOpen(true)}
      >
        Commande vocale
      </Button>
      {open && (
        <VoiceOrderDialog
          establishmentId={establishmentId}
          onClose={() => setOpen(false)}
          onCreated={(saleId) => {
            setOpen(false);
            onCreated(saleId);
          }}
        />
      )}
    </>
  );
}

/**
 * Enregistrement déclenché par l'employé → transcription → panier proposé, modifiable → commande
 * créée seulement à la confirmation (non payée, non envoyée en cuisine, prix calculés par le serveur).
 */
function VoiceOrderDialog({
  establishmentId,
  onClose,
  onCreated,
}: {
  establishmentId: string;
  onClose: () => void;
  onCreated: (saleId: string) => void;
}) {
  const catalog = useApi<PosCatalogCategory[]>(`/pos/catalog?establishmentId=${establishmentId}`);
  const dining = useApi<DiningOverview>(`/restaurant/dining?establishmentId=${establishmentId}`);
  const [phase, setPhase] = useState<'idle' | 'recording' | 'sending' | 'review'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [draft, setDraft] = useState<VoiceOrderDraft | null>(null);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [tableId, setTableId] = useState('');
  const [channel, setChannel] = useState<StaffOrderChannel>('DINE_IN');
  const [error, setError] = useState<ApiError | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const nextKey = useRef(1);

  // Arrêt du micro si la fenêtre est fermée pendant l'enregistrement.
  useEffect(() => () => recorder.current?.stream.getTracks().forEach((t) => t.stop()), []);
  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_SECONDS) recorder.current?.stop();
        return s + 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const variants =
    catalog.state === 'success'
      ? catalog.data.flatMap((c) =>
          c.products.flatMap((p) =>
            p.variants.map((v) => ({
              id: v.id,
              label: v.name === 'Standard' ? p.name : `${p.name} (${v.name})`,
              price: v.price,
            })),
          ),
        )
      : [];
  const tables = dining.state === 'success' ? dining.data.tables.filter((t) => t.isActive) : [];

  async function start() {
    setMicError(null);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void send(new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' }));
      };
      recorder.current = rec;
      rec.start();
      setSeconds(0);
      setPhase('recording');
    } catch {
      setMicError(
        'Micro indisponible ou refusé : autorisez le micro, ou saisissez la commande à la main.',
      );
    }
  }

  async function send(audio: Blob) {
    if (audio.size > AI_AUDIO_MAX_BYTES) {
      setPhase('idle');
      return setMicError('Enregistrement trop long : une minute au plus.');
    }
    setPhase('sending');
    try {
      const form = new FormData();
      form.append('establishmentId', establishmentId);
      form.append('audio', audio, `commande.${audio.type.includes('mp4') ? 'm4a' : 'webm'}`);
      const result = await apiUpload<VoiceOrderDraft>('/ai/voice-orders', form);
      setDraft(result);
      setLines(
        (result.proposal?.lines ?? []).map((l) => ({
          key: nextKey.current++,
          heard: l.heard,
          variantId: l.variantId ?? '',
          quantity: l.quantity === null ? '' : String(l.quantity),
          note: l.note ?? '',
          issues: l.issues,
        })),
      );
      setTableId(result.proposal?.table?.id ?? '');
      setPhase('review');
    } catch (e) {
      setError(e as ApiError);
      setPhase('idle');
    }
  }

  const update = (key: number, patch: Partial<CartLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const incomplete =
    lines.length === 0 ||
    lines.some((l) => !l.variantId || !/^\d{1,3}$/.test(l.quantity) || Number(l.quantity) < 1);
  const indicative = lines.reduce(
    (s, l) =>
      s + (variants.find((v) => v.id === l.variantId)?.price ?? 0) * (Number(l.quantity) || 0),
    0,
  );

  async function confirm() {
    if (!draft) return;
    setConfirming(true);
    setError(null);
    try {
      const result = await api<VoiceOrderDraft>(`/ai/voice-orders/${draft.id}/confirm`, {
        method: 'POST',
        body: {
          channel,
          tableId: channel === 'DINE_IN' && tableId ? tableId : null,
          lines: lines.map((l) => ({
            variantId: l.variantId,
            quantity: Number(l.quantity),
            ...(l.note.trim() ? { notes: l.note.trim() } : {}),
          })),
        },
      });
      onCreated(result.saleId!);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Commande vocale">
      <div className="space-y-4">
        {phase === 'idle' && (
          <div className="space-y-3 text-center">
            <p className="text-[15px]">
              Appuyez, dictez la commande (ex. « Deux poulets braisés et un jus de bissap pour la
              table 5 »), puis arrêtez. Rien n’est enregistré sans votre confirmation.
            </p>
            <Button size="lg" icon={<Mic className="h-5 w-5" />} onClick={start}>
              Enregistrer
            </Button>
          </div>
        )}
        {phase === 'recording' && (
          <div className="space-y-3 text-center" role="status">
            <p className="font-display text-3xl font-bold text-terracotta-dark">
              ● {seconds} s / {MAX_SECONDS} s
            </p>
            <Button
              size="lg"
              variant="danger"
              icon={<Square className="h-5 w-5" />}
              onClick={() => recorder.current?.stop()}
            >
              Arrêter
            </Button>
          </div>
        )}
        {phase === 'sending' && (
          <p className="text-center text-[15px]" role="status">
            Transcription et préparation du panier…
          </p>
        )}
        {micError && <Alert tone="error">{micError}</Alert>}
        <ApiErrorAlert error={error} />

        {phase === 'review' && draft && (
          <div className="space-y-3" data-testid="voice-review">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted">Entendu : « {draft.transcript} »</p>
              <AiBadge />
            </div>
            <ul className="space-y-2">
              {lines.map((l) => (
                <li
                  key={l.key}
                  className="space-y-2 rounded-xl border border-line p-3"
                  data-testid="voice-line"
                >
                  {l.heard && <p className="text-xs text-muted">« {l.heard} »</p>}
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="min-w-0 flex-1 space-y-1 text-sm">
                      <span className="font-medium">Produit</span>
                      <select
                        className="min-h-11 w-full rounded-xl border border-line bg-surface px-3"
                        value={l.variantId}
                        onChange={(e) => update(l.key, { variantId: e.target.value })}
                      >
                        <option value="">— Choisir —</option>
                        {variants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.label} · {formatXof(v.price)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="w-24 space-y-1 text-sm">
                      <span className="font-medium">Quantité</span>
                      <input
                        className="min-h-11 w-full rounded-xl border border-line bg-surface px-3"
                        inputMode="numeric"
                        value={l.quantity}
                        onChange={(e) => update(l.key, { quantity: e.target.value })}
                      />
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Retirer la ligne"
                      icon={<Trash2 className="h-4 w-4" />}
                      onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                    />
                  </div>
                  <input
                    className="min-h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm"
                    placeholder="Instruction (facultatif)"
                    maxLength={200}
                    value={l.note}
                    onChange={(e) => update(l.key, { note: e.target.value })}
                  />
                  {l.issues.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {l.issues.map((i) => (
                        <Badge key={i} tone="terracotta">
                          {ISSUE_LABELS[i]}
                        </Badge>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <Button
              variant="secondary"
              size="sm"
              icon={<Plus className="h-4 w-4" />}
              onClick={() =>
                setLines((ls) => [
                  ...ls,
                  {
                    key: nextKey.current++,
                    heard: null,
                    variantId: '',
                    quantity: '1',
                    note: '',
                    issues: [],
                  },
                ])
              }
            >
              Ajouter une ligne
            </Button>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="font-medium">Type</span>
                <select
                  className="min-h-11 w-full rounded-xl border border-line bg-surface px-3"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value as StaffOrderChannel)}
                >
                  {STAFF_ORDER_CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {ORDER_CHANNEL_LABELS[c]}
                    </option>
                  ))}
                </select>
              </label>
              {channel === 'DINE_IN' && (
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Table</span>
                  <select
                    className="min-h-11 w-full rounded-xl border border-line bg-surface px-3"
                    value={tableId}
                    onChange={(e) => setTableId(e.target.value)}
                  >
                    <option value="">Sans table</option>
                    {tables.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {draft.proposal?.tableNotFound && (
              <Alert tone="info">
                Table « {draft.proposal.tableHeard} » non reconnue : choisissez-la.
              </Alert>
            )}
            <p className="text-sm text-muted">
              Total indicatif : {formatXof(indicative)} (le prix est calculé par le serveur). La
              commande sera créée non payée et ne partira pas en cuisine.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                onClick={async () => {
                  await api(`/ai/voice-orders/${draft.id}/discard`, { method: 'POST' }).catch(
                    () => undefined,
                  );
                  onClose();
                }}
              >
                Abandonner
              </Button>
              <Button
                icon={<CheckCircle2 className="h-4 w-4" />}
                loading={confirming}
                disabled={incomplete}
                onClick={confirm}
              >
                Valider la commande
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

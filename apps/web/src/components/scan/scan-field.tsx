'use client';

import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { Camera, ScanLine, Volume2, VolumeX } from 'lucide-react';
import { normalizeScannedCode } from '@ocall/shared';
import { CameraBarcodeScanner } from './camera-barcode-scanner';

/** Une même lecture répétée dans ce délai est ignorée (gâchette pressée deux fois, rebond). */
export const SCAN_REPEAT_MS = 1500;
const BEEP_KEY = 'ocall.scan.beep';

export type ScanFeedback = { tone: 'ok' | 'warn' | 'error'; message: string } | null;

/**
 * Filtre anti-doublon des lectures : vrai si le code doit être traité. Partagé par le champ de scan et,
 * plus tard, la caméra et la caisse.
 */
export function createScanGate(repeatMs = SCAN_REPEAT_MS) {
  let last: { code: string; at: number } | null = null;
  return (code: string, now = Date.now()): boolean => {
    if (last && last.code === code && now - last.at < repeatMs) return false;
    last = { code, at: now };
    return true;
  };
}

function beep(tone: 'ok' | 'warn' | 'error') {
  try {
    if (localStorage.getItem(BEEP_KEY) !== 'on') return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.value = tone === 'ok' ? 1200 : 300;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (tone === 'ok' ? 0.08 : 0.25));
    osc.onended = () => void ctx.close();
  } catch {
    // Son indisponible (navigateur, réglage) : le retour visuel suffit.
  }
}

/**
 * Champ de lecture des codes : lecteurs USB ou Bluetooth en mode clavier (HID), qui « tapent » le code
 * puis Entrée, et saisie manuelle. Le champ garde le focus après chaque lecture ; un code relu aussitôt
 * est ignoré. Un lecteur 1D ne lit pas les QR codes : il faut un lecteur 2D.
 */
export function ScanField({
  label = 'Scanner ou saisir un code',
  onScan,
  feedback,
  autoFocus = true,
  testId,
}: {
  label?: string;
  /** Code nettoyé (espaces et caractères de contrôle retirés). */
  onScan: (code: string) => void | Promise<void>;
  feedback?: ScanFeedback;
  autoFocus?: boolean;
  testId?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const gate = useRef(createScanGate());
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [sound, setSound] = useState(false);
  const [camera, setCamera] = useState(false);

  useEffect(() => {
    try {
      setSound(localStorage.getItem(BEEP_KEY) === 'on');
    } catch {
      setSound(false);
    }
  }, []);

  useEffect(() => {
    if (feedback) beep(feedback.tone);
  }, [feedback]);

  async function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const raw = value;
    setValue('');
    await submit(raw);
  }

  /** Lecture commune au clavier (lecteur HID, saisie) et à la caméra. */
  async function submit(raw: string) {
    const code = normalizeScannedCode(raw);
    if (!code || busy || !gate.current(code)) return;
    setBusy(true);
    try {
      await onScan(code);
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }

  function toggleSound() {
    const next = !sound;
    setSound(next);
    try {
      localStorage.setItem(BEEP_KEY, next ? 'on' : 'off');
    } catch {
      // Préférence non mémorisée (navigation privée) : elle vaut pour la page.
    }
  }

  const tone =
    feedback?.tone === 'ok'
      ? 'border-forest bg-forest-light/40'
      : feedback?.tone === 'warn'
        ? 'border-savanna bg-savanna-light/40'
        : feedback?.tone === 'error'
          ? 'border-terracotta bg-terracotta-light/40'
          : 'border-line bg-surface';

  return (
    <div className="space-y-1.5" data-testid={testId}>
      <label htmlFor={id} className="block text-sm font-medium text-charcoal">
        {label}
      </label>
      <div className={`flex items-center gap-2 rounded-xl border-2 px-3 transition-colors ${tone}`}>
        <ScanLine className="h-5 w-5 shrink-0 text-charcoal-soft" aria-hidden />
        <input
          ref={input}
          id={id}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => void onKeyDown(e)}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          disabled={busy}
          placeholder="Code-barres, QR code ou référence, puis Entrée"
          className="min-w-0 flex-1 bg-transparent py-3 text-base outline-none"
        />
        {/* Téléphone : icônes seules (le nom reste lu par les lecteurs d'écran) ; texte à partir de 640 px. */}
        <button
          type="button"
          onClick={toggleSound}
          className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-charcoal-soft hover:bg-ivory-dark/50"
          aria-pressed={sound}
          aria-label={`Son ${sound ? 'activé' : 'coupé'}`}
        >
          {sound ? (
            <Volume2 className="h-4 w-4" aria-hidden />
          ) : (
            <VolumeX className="h-4 w-4" aria-hidden />
          )}
          <span className="hidden sm:inline">Son {sound ? 'activé' : 'coupé'}</span>
        </button>
        <button
          type="button"
          onClick={() => setCamera((v) => !v)}
          className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-charcoal-soft hover:bg-ivory-dark/50"
          aria-pressed={camera}
          aria-label={camera ? 'Fermer la caméra' : 'Caméra'}
        >
          <Camera className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">{camera ? 'Fermer la caméra' : 'Caméra'}</span>
        </button>
      </div>
      {camera && <CameraBarcodeScanner onDetect={(text) => void submit(text)} />}
      <p className="min-h-5 text-sm" role="status" aria-live="polite">
        {feedback?.message ?? ''}
      </p>
    </div>
  );
}

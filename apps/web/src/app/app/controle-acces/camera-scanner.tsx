'use client';

import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, CameraOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

type CameraState = 'idle' | 'starting' | 'running' | 'denied' | 'unavailable';

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (options: { formats: string[] }) => BarcodeDetectorLike;
  }
}

const SCAN_INTERVAL_MS = 200;

/**
 * Lecture des QR codes par la caméra arrière. Utilise le détecteur natif du navigateur (Chrome Android)
 * et, à défaut, le décodeur jsQR sur une image réduite. La caméra exige HTTPS (ou localhost).
 * `paused` suspend la lecture pendant la validation d'un billet, sans couper la caméra.
 */
export function CameraScanner({
  paused,
  onDetect,
}: {
  paused: boolean;
  onDetect: (text: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pausedRef = useRef(paused);
  const onDetectRef = useRef(onDetect);
  const [state, setState] = useState<CameraState>('idle');
  pausedRef.current = paused;
  onDetectRef.current = onDetect;

  function stop() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setState('idle');
  }

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unavailable');
      return;
    }
    setState('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setState('running');
    } catch (error) {
      setState((error as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'unavailable');
    }
  }

  useEffect(() => {
    if (state !== 'running') return;
    const detector = window.BarcodeDetector
      ? new window.BarcodeDetector({ formats: ['qr_code'] })
      : null;
    let busy = false;
    const timer = setInterval(async () => {
      const video = videoRef.current;
      if (busy || pausedRef.current || !video || video.readyState < 2) return;
      busy = true;
      try {
        let text: string | null = null;
        if (detector) {
          text = (await detector.detect(video))[0]?.rawValue ?? null;
        } else {
          // Image réduite : le décodage logiciel reste fluide sur une tablette d'entrée de gamme.
          const scale = Math.min(1, 640 / video.videoWidth);
          const width = Math.round(video.videoWidth * scale);
          const height = Math.round(video.videoHeight * scale);
          const canvas = (canvasRef.current ??= document.createElement('canvas'));
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(video, 0, 0, width, height);
            text =
              jsQR(ctx.getImageData(0, 0, width, height).data, width, height, {
                inversionAttempts: 'dontInvert',
              })?.data ?? null;
          }
        }
        if (text && !pausedRef.current) onDetectRef.current(text);
      } catch {
        // Image illisible : on réessaie à l'intervalle suivant.
      } finally {
        busy = false;
      }
    }, SCAN_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [state]);

  // Caméra libérée en quittant l'écran.
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  return (
    <div className="space-y-2">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-charcoal">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`h-full w-full object-cover ${state === 'running' ? '' : 'hidden'}`}
        />
        {state === 'running' && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-[18%] rounded-2xl border-4 border-white/80"
          />
        )}
        {state !== 'running' && (
          <div className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-ivory/80">
            {state === 'denied' &&
              'Accès à la caméra refusé : autorisez-le dans les réglages du navigateur, ou saisissez le code.'}
            {state === 'unavailable' &&
              'Caméra indisponible sur cet appareil (HTTPS requis). Utilisez la saisie manuelle.'}
            {(state === 'idle' || state === 'starting') && 'Caméra arrêtée'}
          </div>
        )}
        {state === 'running' && paused && (
          <div className="absolute inset-x-0 bottom-0 bg-charcoal/70 py-1 text-center text-xs text-ivory">
            Validation…
          </div>
        )}
      </div>
      {state === 'running' ? (
        <Button
          variant="secondary"
          className="w-full"
          onClick={stop}
          icon={<CameraOff className="h-4 w-4" />}
        >
          Arrêter la caméra
        </Button>
      ) : (
        <Button
          size="lg"
          className="w-full"
          onClick={() => void start()}
          loading={state === 'starting'}
          icon={<Camera className="h-5 w-5" />}
        >
          Activer la caméra
        </Button>
      )}
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';

type CameraState = 'starting' | 'running' | 'denied' | 'unavailable';

interface NativeDetector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
interface NativeDetectorClass {
  new (options: { formats: string[] }): NativeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

/** Symbologies lues : codes fabricants, codes internes (Code 128) et QR codes (articles, emplacements). */
const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'code_128', 'qr_code'];
const ZXING_FORMATS = ['EAN-13', 'EAN-8', 'UPC-A', 'Code128', 'QRCode'] as const;
const SCAN_INTERVAL_MS = 250;

type Decode = (video: HTMLVideoElement, canvas: HTMLCanvasElement) => Promise<string | null>;

/**
 * Décodeur : natif si le navigateur sait lire ces codes (Chrome Android), sinon zxing-wasm (iPhone, iPad),
 * dont le fichier WebAssembly est servi par le site (`/vendor/zxing_reader.wasm`), sans réseau tiers.
 */
async function createDecoder(): Promise<Decode> {
  const Native = (window as unknown as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  if (Native) {
    const supported = (await Native.getSupportedFormats?.()) ?? [];
    const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
    if (formats.length === NATIVE_FORMATS.length) {
      const detector = new Native({ formats });
      return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
    }
  }
  const zxing = await import('zxing-wasm/reader');
  zxing.prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) =>
        path.endsWith('.wasm') ? '/vendor/zxing_reader.wasm' : prefix + path,
    },
  });
  return async (video, canvas) => {
    // Image réduite : décodage fluide sur un téléphone d'entrée de gamme.
    const scale = Math.min(1, 960 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const results = await zxing.readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), {
      formats: [...ZXING_FORMATS],
      tryHarder: true,
      maxNumberOfSymbols: 1,
    });
    return results.find((r) => r.isValid)?.text ?? null;
  };
}

/**
 * Lecture des codes-barres et QR codes par la caméra arrière du téléphone ou de la tablette (HTTPS requis).
 * Chaque lecture est transmise à `onDetect` ; l'appelant filtre les lectures répétées.
 */
export function CameraBarcodeScanner({ onDetect }: { onDetect: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectRef = useRef(onDetect);
  const [state, setState] = useState<CameraState>('starting');
  onDetectRef.current = onDetect;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    const canvas = document.createElement('canvas');

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState('unavailable');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (stopped) return;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        const decode = await createDecoder();
        if (stopped) return;
        setState('running');
        let busy = false;
        timer = setInterval(async () => {
          if (busy || video.readyState < 2) return;
          busy = true;
          try {
            const text = await decode(video, canvas);
            if (text) onDetectRef.current(text);
          } catch {
            // Image illisible : nouvel essai à l'intervalle suivant.
          } finally {
            busy = false;
          }
        }, SCAN_INTERVAL_MS);
      } catch (error) {
        setState((error as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'unavailable');
      }
    })();

    // Caméra libérée en fermant le panneau ou en quittant l'écran.
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div
      className="relative aspect-[4/3] w-full max-w-md overflow-hidden rounded-2xl bg-charcoal"
      data-testid="camera-scanner"
    >
      <video
        ref={videoRef}
        playsInline
        muted
        className={`h-full w-full object-cover ${state === 'running' ? '' : 'hidden'}`}
      />
      {state === 'running' && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-[12%] inset-y-[30%] rounded-xl border-4 border-white/80"
        />
      )}
      {state !== 'running' && (
        <div
          className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-ivory/80"
          role="status"
        >
          {state === 'starting' && 'Démarrage de la caméra…'}
          {state === 'denied' &&
            'Accès à la caméra refusé : autorisez-le dans les réglages du navigateur, ou saisissez le code.'}
          {state === 'unavailable' &&
            'Caméra indisponible sur cet appareil (HTTPS requis) : saisissez le code ou utilisez un lecteur.'}
        </div>
      )}
    </div>
  );
}

'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

export interface SignaturePadHandle {
  /** Image PNG de la signature, ou null si rien n'a été tracé. */
  toBlob: () => Promise<Blob | null>;
  clear: () => void;
}

/**
 * Zone de signature au doigt ou au stylet (événements pointeur : tactile, stylet et souris). Le tracé est
 * dessiné à la résolution de l'écran ; l'image envoyée est un PNG sur fond blanc.
 */
export const SignaturePad = forwardRef<
  SignaturePadHandle,
  { onChange?: (signed: boolean) => void }
>(function SignaturePad({ onChange }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [signed, setSigned] = useState(false);

  const reset = useCallback(() => {
    const el = canvas.current;
    if (!el) return;
    const ratio = window.devicePixelRatio || 1;
    el.width = el.clientWidth * ratio;
    el.height = el.clientHeight * ratio;
    const ctx = el.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, el.width, el.height);
    ctx.lineWidth = 2.5 * ratio;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1d2a33';
    setSigned(false);
  }, []);

  useEffect(() => {
    reset();
  }, [reset]);
  useEffect(() => onChange?.(signed), [signed, onChange]);

  useImperativeHandle(ref, () => ({
    toBlob: () =>
      new Promise((resolve) => {
        if (!signed || !canvas.current) return resolve(null);
        canvas.current.toBlob((blob) => resolve(blob), 'image/png');
      }),
    clear: reset,
  }));

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = e.currentTarget.width / rect.width;
    return [(e.clientX - rect.left) * ratio, (e.clientY - rect.top) * ratio] as const;
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={canvas}
        data-testid="facture-signature-pad"
        aria-label="Zone de signature du client"
        className="h-44 w-full touch-none rounded-xl border-2 border-dashed border-line bg-white"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const ctx = e.currentTarget.getContext('2d')!;
          const [x, y] = point(e);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + 0.1, y + 0.1);
          ctx.stroke();
          drawing.current = true;
          setSigned(true);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext('2d')!;
          const [x, y] = point(e);
          ctx.lineTo(x, y);
          ctx.stroke();
        }}
        onPointerUp={() => {
          drawing.current = false;
        }}
        onPointerCancel={() => {
          drawing.current = false;
        }}
      />
      <Button type="button" variant="ghost" size="sm" onClick={reset}>
        Effacer
      </Button>
    </div>
  );
});

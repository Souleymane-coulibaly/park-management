'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/**
 * QR code d'un billet, dessiné dans le navigateur. Le contenu est le seul jeton aléatoire du billet
 * (préfixe OCP1-) : aucune donnée personnelle ni secret applicatif n'y figure.
 */
export function TicketQr({
  value,
  size = 168,
  label,
}: {
  value: string;
  size?: number;
  label: string;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { errorCorrectionLevel: 'M', margin: 1, width: size * 2 })
      .then((url) => !cancelled && setSrc(url))
      .catch(() => !cancelled && setSrc(null));
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- image générée localement (data URL)
    <img
      src={src}
      width={size}
      height={size}
      alt={label}
      className="rounded-lg bg-white p-1"
      data-qr={value}
    />
  ) : (
    <div
      style={{ width: size, height: size }}
      className="animate-pulse rounded-lg bg-ivory-dark"
      aria-label={label}
    />
  );
}

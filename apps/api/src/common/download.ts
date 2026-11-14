import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';

/**
 * En-tête `Content-Disposition` sûr pour tout nom de fichier. Un nom ASCII garde la forme simple ; sinon
 * un nom de repli ASCII plus le nom exact encodé (RFC 6266 / 5987) : Node refuse dans un en-tête tout
 * caractère au-delà de U+00FF (« ’ » d'un iPhone ou d'un Mac donnait une erreur 500).
 */
export function contentDisposition(fileName: string): string {
  const clean = fileName.replace(/[\p{Cc}"\\]/gu, '_');
  if (/^[\x20-\x7e]*$/.test(clean)) return `attachment; filename="${clean}"`;
  const ascii = clean
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_');
  const encoded = encodeURIComponent(clean).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Fichier remis au navigateur, jamais mis en cache : aucune adresse directe n'existe. */
export function download(res: Response, body: Buffer, mimeType: string, fileName: string) {
  res.set({
    'Content-Type': mimeType,
    'Content-Disposition': contentDisposition(fileName),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  return new StreamableFile(body);
}

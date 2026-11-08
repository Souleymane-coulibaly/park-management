import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';

/** Fichier remis au navigateur, jamais mis en cache : aucune adresse directe n'existe. */
export function download(res: Response, body: Buffer, mimeType: string, fileName: string) {
  res.set({
    'Content-Type': mimeType,
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  return new StreamableFile(body);
}

import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';

/** Fichier reçu par un formulaire (multer) : contenu, type déclaré et taille. */
export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/** Photo : 8 Mo au plus à l'envoi (appareil d'un téléphone) ; réencodée en JPEG, 1 600 px au plus. */
export const PHOTO_MAX_BYTES = 8_000_000;
const PHOTO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * Photo vérifiée puis réencodée en JPEG (orientation appliquée, 1 600 px au plus, fond blanc) : toutes
 * les métadonnées (EXIF, position GPS) disparaissent. Partagée par Ocall Facture (interventions, site)
 * et Ocall Parc (photo du titulaire d'un pass).
 */
export async function normalizePhoto(file: UploadedImage | undefined): Promise<Buffer> {
  if (!file || !PHOTO_TYPES.has(file.mimetype) || file.size > PHOTO_MAX_BYTES) {
    throw new BadRequestException({
      code: 'PHOTO_REFUSED',
      message: 'Photo refusée : image JPEG, PNG ou WebP de 8 Mo au plus.',
    });
  }
  try {
    return await sharp(file.buffer, { failOn: 'error', limitInputPixels: 8192 * 8192 })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new BadRequestException({
      code: 'PHOTO_REFUSED',
      message: 'Image illisible ou corrompue.',
    });
  }
}

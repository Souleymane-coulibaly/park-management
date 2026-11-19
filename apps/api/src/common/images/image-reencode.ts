import { createHash } from 'node:crypto';
import { inspectImage } from '@ocall/shared';
import sharp from 'sharp';

/**
 * Réencodage des photos et logos (Ocall Print, photos d'identité Ocall School). Type réel lu dans le
 * contenu (JPEG, PNG, WebP ; jamais SVG ni GIF), taille et dimensions bornées, puis RÉENCODAGE par Sharp,
 * orientation EXIF appliquée aux pixels : le fichier conservé ne contient plus aucune métadonnée de
 * l'original (EXIF, GPS, appareil, profil, commentaires), ni données cachées après l'image.
 */

export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const MAX_DIMENSION = 8000;

export interface ProcessedImage {
  body: Buffer;
  sha256: string;
  mimeType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
}

export type ImageRefusal = { code: string; message: string };

export async function reencodeImage(
  input: Buffer,
  min: { width: number; height: number },
  output: 'jpeg' | 'png',
  maxSide: number,
): Promise<ProcessedImage | ImageRefusal> {
  if (input.length > IMAGE_MAX_BYTES)
    return { code: 'IMAGE_TOO_LARGE', message: 'Image trop lourde (8 Mo au plus).' };
  const info = inspectImage(new Uint8Array(input));
  if (!info)
    return {
      code: 'IMAGE_TYPE_REFUSED',
      message: 'Format refusé : JPEG, PNG ou WebP uniquement.',
    };
  if (info.width > MAX_DIMENSION || info.height > MAX_DIMENSION)
    return { code: 'IMAGE_DIMENSIONS', message: 'Image trop grande (8 000 pixels au plus).' };
  try {
    let pipeline = sharp(input, {
      failOn: 'error',
      limitInputPixels: MAX_DIMENSION * MAX_DIMENSION,
    })
      .rotate()
      .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true });
    // Sans withMetadata() : Sharp n'écrit aucune métadonnée (EXIF, GPS, XMP, IPTC, ICC retirés).
    pipeline =
      output === 'jpeg'
        ? pipeline.flatten({ background: '#FFFFFF' }).jpeg({ quality: 88, mozjpeg: true })
        : pipeline.png({ compressionLevel: 9 });
    const { data, info: out } = await pipeline.toBuffer({ resolveWithObject: true });
    // Dimensions contrôlées après l'orientation : une photo tournée garde son vrai sens.
    if (out.width < min.width || out.height < min.height)
      return {
        code: 'IMAGE_DIMENSIONS',
        message: `Image trop petite : ${min.width} × ${min.height} pixels au moins.`,
      };
    return {
      body: data,
      sha256: createHash('sha256').update(data).digest('hex'),
      mimeType: output === 'jpeg' ? 'image/jpeg' : 'image/png',
      width: out.width,
      height: out.height,
    };
  } catch {
    // Fichier corrompu ou piégé (en-tête valide, contenu illisible) : refusé, jamais stocké.
    return { code: 'IMAGE_TYPE_REFUSED', message: 'Image illisible ou corrompue.' };
  }
}

export const isImageRefusal = (r: ProcessedImage | ImageRefusal): r is ImageRefusal => 'code' in r;

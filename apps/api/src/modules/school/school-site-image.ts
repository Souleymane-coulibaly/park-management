import {
  SITE_MEDIA_MAX_BYTES,
  SITE_MEDIA_MAX_DIMENSION,
  SITE_MEDIA_MIN_DIMENSION,
  inspectImage,
} from '@ocall/shared';
import sharp from 'sharp';

/** Taille de la version affichée et de la vignette (largeur ou hauteur maximale, en pixels). */
export const SCHOOL_SITE_IMAGE_FULL = 1600;
export const SCHOOL_SITE_IMAGE_THUMB = 480;

export interface ProcessedVariant {
  body: Buffer;
  width: number;
  height: number;
}

export type ImageRefusal =
  | { code: 'MEDIA_TOO_LARGE'; message: string }
  | { code: 'MEDIA_TYPE_REFUSED'; message: string }
  | { code: 'MEDIA_DIMENSIONS'; message: string };

/**
 * Image d'un site School : type réel lu dans le contenu (JPEG, PNG, WebP ; jamais SVG ni GIF), taille
 * et dimensions bornées, puis RÉENCODAGE par Sharp en WebP (orientation appliquée) : le fichier publié
 * ne contient plus aucune métadonnée de l'original (EXIF, GPS, appareil, profil, commentaires), ni
 * données cachées après l'image. Deux tailles : affichage (1600 px) et vignette (480 px).
 */
export async function processSchoolSiteImage(
  input: Buffer,
): Promise<{ full: ProcessedVariant; thumb: ProcessedVariant } | ImageRefusal> {
  if (input.length > SITE_MEDIA_MAX_BYTES) {
    return { code: 'MEDIA_TOO_LARGE', message: 'Image trop lourde (5 Mo au plus).' };
  }
  const image = inspectImage(new Uint8Array(input));
  if (!image) {
    return { code: 'MEDIA_TYPE_REFUSED', message: 'Format refusé : JPEG, PNG ou WebP uniquement.' };
  }
  if (
    image.width < SITE_MEDIA_MIN_DIMENSION ||
    image.height < SITE_MEDIA_MIN_DIMENSION ||
    image.width > SITE_MEDIA_MAX_DIMENSION ||
    image.height > SITE_MEDIA_MAX_DIMENSION
  ) {
    return {
      code: 'MEDIA_DIMENSIONS',
      message: `Dimensions refusées : entre ${SITE_MEDIA_MIN_DIMENSION} et ${SITE_MEDIA_MAX_DIMENSION} pixels.`,
    };
  }
  try {
    const variant = async (max: number): Promise<ProcessedVariant> => {
      const { data, info } = await sharp(input, {
        failOn: 'error',
        limitInputPixels: SITE_MEDIA_MAX_DIMENSION * SITE_MEDIA_MAX_DIMENSION,
      })
        // Orientation EXIF appliquée aux pixels avant la suppression des métadonnées.
        .rotate()
        .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
        // Sans withMetadata() : Sharp n'écrit aucune métadonnée (EXIF, XMP, IPTC, ICC retirés).
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
      return { body: data, width: info.width, height: info.height };
    };
    return {
      full: await variant(SCHOOL_SITE_IMAGE_FULL),
      thumb: await variant(SCHOOL_SITE_IMAGE_THUMB),
    };
  } catch {
    // Fichier corrompu ou piégé (en-tête valide, contenu illisible) : refusé, jamais stocké.
    return { code: 'MEDIA_TYPE_REFUSED', message: 'Image illisible ou corrompue.' };
  }
}

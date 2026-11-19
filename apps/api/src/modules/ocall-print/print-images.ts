import {
  IMAGE_MAX_BYTES,
  isImageRefusal,
  reencodeImage,
  type ImageRefusal,
  type ProcessedImage,
} from '../../common/images/image-reencode';

/** Images d'Ocall Print : photo du titulaire et logo du modèle, réencodées sans métadonnées. */
export const PRINT_IMAGE_MAX_BYTES = IMAGE_MAX_BYTES;
/** Une photo d'identité imprimée à 300 ppp sur 20 × 26 mm demande au moins ~240 × 300 pixels. */
export const PRINT_PHOTO_MIN = { width: 200, height: 240 };
const LOGO_MIN = 64;

export { isImageRefusal, type ImageRefusal, type ProcessedImage };

/** Photo d'identité : JPEG, 1 200 pixels au plus sur le grand côté. */
export const processPrintPhoto = (input: Buffer) =>
  reencodeImage(input, PRINT_PHOTO_MIN, 'jpeg', 1200);

/** Logo d'un modèle : PNG (transparence conservée), 800 pixels au plus. */
export const processPrintLogo = (input: Buffer) =>
  reencodeImage(input, { width: LOGO_MIN, height: LOGO_MIN }, 'png', 800);

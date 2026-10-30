/**
 * Encodeur ESC/POS indépendant du fabricant (jeu de commandes Epson standard, repris par la
 * plupart des imprimantes thermiques 58 et 80 mm du marché).
 *
 * Ne génère JAMAIS la commande d'ouverture du tiroir-caisse : celle-ci est produite uniquement
 * par le connecteur matériel, sur ordre explicite autorisé par le serveur (voir bridge-protocol).
 */
export type PaperWidth = 58 | 80;
export const PAPER_WIDTHS: readonly PaperWidth[] = [58, 80];

/** Caractères par ligne en police A : 32 en 58 mm, 48 en 80 mm. */
export function charsPerLine(paperWidth: PaperWidth): number {
  return paperWidth === 58 ? 32 : 48;
}

const ESC = 0x1b;
const GS = 0x1d;
/** Page de code PC858 (Europe de l'Ouest + €), numéro 19 dans le jeu Epson. */
const CODE_PAGE_PC858 = 19;

/** Correspondance des caractères français vers la page de code PC858. */
const PC858: Record<string, number> = {
  Ç: 0x80,
  ü: 0x81,
  é: 0x82,
  â: 0x83,
  ä: 0x84,
  à: 0x85,
  å: 0x86,
  ç: 0x87,
  ê: 0x88,
  ë: 0x89,
  è: 0x8a,
  ï: 0x8b,
  î: 0x8c,
  ì: 0x8d,
  Ä: 0x8e,
  Å: 0x8f,
  É: 0x90,
  æ: 0x91,
  Æ: 0x92,
  ô: 0x93,
  ö: 0x94,
  ò: 0x95,
  û: 0x96,
  ù: 0x97,
  ÿ: 0x98,
  Ö: 0x99,
  Ü: 0x9a,
  '£': 0x9c,
  á: 0xa0,
  í: 0xa1,
  ó: 0xa2,
  ú: 0xa3,
  ñ: 0xa4,
  Ñ: 0xa5,
  '«': 0xae,
  '»': 0xaf,
  Á: 0xb5,
  Â: 0xb6,
  À: 0xb7,
  Ê: 0xd2,
  Ë: 0xd3,
  È: 0xd4,
  '€': 0xd5,
  Í: 0xd6,
  Î: 0xd7,
  Ï: 0xd8,
  Ó: 0xe0,
  Ô: 0xe2,
  Ò: 0xe3,
  Ú: 0xe9,
  Û: 0xea,
  Ù: 0xeb,
  '°': 0xf8,
};

/** Normalise la typographie (espaces insécables, apostrophes, tirets) avant l'encodage. */
export function normalizeForPrinter(text: string): string {
  return text
    .replace(/[\u00a0\u202f\u2009]/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE');
}

/** Encode un texte en PC858 ; tout caractère non représentable devient « ? ». */
export function encodePc858(text: string): number[] {
  const bytes: number[] = [];
  for (const ch of normalizeForPrinter(text)) {
    const code = ch.charCodeAt(0);
    if (code >= 0x20 && code < 0x7f) bytes.push(code);
    else if (ch === '\n') bytes.push(0x0a);
    else bytes.push(PC858[ch] ?? 0x3f);
  }
  return bytes;
}

export type Align = 'left' | 'center' | 'right';

/** Ligne de ticket : texte et mise en forme simple, commune à l'aperçu et à l'impression. */
export interface ReceiptLine {
  text: string;
  align?: Align;
  bold?: boolean;
  /** Double hauteur et largeur (total, titre). */
  large?: boolean;
  /** QR code à imprimer (commande ESC/POS GS ( k, modèle 2), centré ; `text` sert alors d'aperçu. */
  qr?: string;
  /** Coupe du papier après cette ligne (plusieurs billets dans un même flux). */
  cut?: boolean;
}

/** Texte à gauche et montant à droite sur une même ligne. */
export function columns(left: string, right: string, width: number): string {
  const l = normalizeForPrinter(left);
  const r = normalizeForPrinter(right);
  const space = width - r.length - 1;
  if (l.length <= space) return `${l}${' '.repeat(width - l.length - r.length)}${r}`;
  return `${l.slice(0, Math.max(space, 0))} ${r}`;
}

/** Découpe un texte trop long en plusieurs lignes, sans couper les mots si possible. */
export function wrap(text: string, width: number): string[] {
  const words = normalizeForPrinter(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (word.length > width) {
      if (current) lines.push(current);
      for (let i = 0; i < word.length; i += width) lines.push(word.slice(i, i + width));
      current = '';
    } else if (!current) current = word;
    else if (current.length + 1 + word.length <= width) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

/** Taille maximale du contenu d'un QR code imprimé (le billet n'en utilise que 27 caractères). */
export const MAX_QR_LENGTH = 256;

/**
 * QR code ESC/POS (GS ( k) : modèle 2, module de 6 points, correction d'erreur M.
 * Le contenu est limité à l'ASCII imprimable : un billet ne contient qu'un préfixe et un jeton.
 */
export function qrCode(data: string): number[] {
  if (data.length === 0 || data.length > MAX_QR_LENGTH || !/^[ -~]+$/.test(data)) {
    throw new RangeError('Contenu de QR code invalide.');
  }
  const store = data.length + 3;
  return [
    GS,
    0x28,
    0x6b,
    0x04,
    0x00,
    0x31,
    0x41,
    0x32,
    0x00, // modèle 2
    GS,
    0x28,
    0x6b,
    0x03,
    0x00,
    0x31,
    0x43,
    0x06, // taille du module
    GS,
    0x28,
    0x6b,
    0x03,
    0x00,
    0x31,
    0x45,
    0x31, // correction d'erreur M
    GS,
    0x28,
    0x6b,
    store & 0xff,
    store >> 8,
    0x31,
    0x50,
    0x30,
    ...[...data].map((c) => c.charCodeAt(0)),
    GS,
    0x28,
    0x6b,
    0x03,
    0x00,
    0x31,
    0x51,
    0x30, // impression
  ];
}

/** Convertit des lignes de ticket en octets ESC/POS, avec avance papier et coupe partielle. */
export function encodeReceiptLines(lines: readonly ReceiptLine[]): Uint8Array {
  const out: number[] = [ESC, 0x40, ESC, 0x74, CODE_PAGE_PC858];
  for (const line of lines) {
    out.push(ESC, 0x61, line.qr || line.align === 'center' ? 1 : line.align === 'right' ? 2 : 0);
    if (line.qr) {
      out.push(...qrCode(line.qr), 0x0a);
    } else {
      out.push(ESC, 0x45, line.bold ? 1 : 0);
      out.push(GS, 0x21, line.large ? 0x11 : 0x00);
      out.push(...encodePc858(line.text), 0x0a);
    }
    if (line.cut) out.push(ESC, 0x45, 0, GS, 0x21, 0, ESC, 0x64, 4, GS, 0x56, 0x42, 0x00);
  }
  // Remise à zéro de la mise en forme, avance de 4 lignes puis coupe partielle (sauf si déjà coupé).
  if (!lines[lines.length - 1]?.cut) {
    out.push(ESC, 0x45, 0, GS, 0x21, 0, ESC, 0x61, 0, ESC, 0x64, 4, GS, 0x56, 0x42, 0x00);
  }
  return Uint8Array.from(out);
}

/**
 * Séquences d'ouverture de tiroir (ESC p et DLE DC4). Un flux d'impression envoyé au connecteur
 * ne doit jamais en contenir : le tiroir ne s'ouvre que par la commande dédiée.
 */
export function containsDrawerKick(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] === ESC && bytes[i + 1] === 0x70) return true;
    if (bytes[i] === 0x10 && bytes[i + 1] === 0x14) return true;
  }
  return false;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 sans dépendance (même résultat dans le navigateur, Node et les tests). */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i]!, bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
    out += b === undefined ? '=' : B64[(n >> 6) & 63]!;
    out += c === undefined ? '=' : B64[n & 63]!;
  }
  return out;
}

export function fromBase64(data: string): Uint8Array {
  const clean = data.replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]*$/.test(clean) || clean.length % 4 === 1)
    throw new Error('Base64 invalide.');
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    buffer = (buffer << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

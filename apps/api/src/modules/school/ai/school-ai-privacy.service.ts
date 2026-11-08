import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { SchoolContext } from '../school-access';
import { SchoolPrismaService } from '../school-prisma.service';

/**
 * Normalisation pour comparer des noms : accents et signes diacritiques (latins et arabes) retirés,
 * minuscules, tout ce qui n'est ni lettre ni chiffre devient une espace. L'arabe est conservé.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ًͯ-ٰٟ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
/**
 * Téléphones : international (+221 77 …), numéros locaux de 8 chiffres et plus, groupés par deux ou trois
 * (« 76 12 34 56 », « 77 123 45 67 ») ou d'un seul tenant (« 76123456 »). Un grand montant écrit ainsi
 * peut aussi être masqué : la protection des personnes prime (le copilote calcule ses chiffres lui-même).
 * Une virgule ou un point n'est un séparateur numérique que s'il est collé à un chiffre des deux côtés :
 * « 76 12 34 56, préparer… » est un téléphone suivi d'une ponctuation ; « 11,33 » est un nombre.
 * Un groupe peut être entre parenthèses (« +221 (77) 123 45 67 », « (77) 123 45 67 »).
 */
const PHONE =
  /\+\d[\d .()-]{7,}\d|(?<!\d|\d[,.])\(?\d{2,3}\)?(?:[ .-]\(?\d{2,3}\)?){2,4}(?!\d|[,.]\d)|(?<!\d|\d[,.])\d{8,}(?!\d|[,.]\d)/g;

/**
 * Copie du texte en chiffres latins, caractère pour caractère (même longueur, mêmes positions) :
 * chiffres arabes (٠-٩) et persans (۰-۹), séparateurs arabes (٫ ٬) ramenés à leurs équivalents.
 */
function latinDigits(text: string): string {
  return (
    text
      .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/\u066B/g, '.')
      .replace(/\u066C/g, ' ')
      // Espaces insécables (texte copié-collé) : des espaces ordinaires pour la détection.
      .replace(/[\u00A0\u202F\u2007]/g, ' ')
  );
}

/**
 * Masque adresses électroniques et numéros de téléphone d'un texte libre, quelle que soit l'écriture des
 * chiffres. La détection se fait sur la copie en chiffres latins ; le segment d'ORIGINE est masqué. Une
 * suite groupée n'est un téléphone qu'à partir de huit chiffres (« comparer 12 14 16 » reste intact).
 */
export function redactContacts(text: string): string {
  const withoutEmails = text.replace(EMAIL, '[adresse masquée]');
  const latin = latinDigits(withoutEmails);
  const ranges: [number, number][] = [];
  for (const m of latin.matchAll(PHONE)) {
    if (m[0].replace(/\D/g, '').length >= 8) ranges.push([m.index, m.index + m[0].length]);
  }
  let out = withoutEmails;
  for (const [start, end] of ranges.reverse()) {
    out = `${out.slice(0, start)}[téléphone masqué]${out.slice(end)}`;
  }
  return out;
}

export interface KnownPerson {
  firstName: string;
  lastName: string;
  firstNameAr?: string | null;
  lastNameAr?: string | null;
  matricule?: string | null;
}

/**
 * Vrai si un texte cite une personne connue : tous les mots de son prénom ET tous les mots de son nom
 * présents dans le texte, où qu'ils soient et dans n'importe quel ordre (« Awa Traoré », « Traoré,
 * Awa », « prénom : Awa ; nom : Traoré »), en caractères latins ou arabes ; ou son matricule. Un nom de
 * famille seul n'est pas retenu (trop courant pour distinguer une personne d'un mot du sujet).
 */
export function mentionsPerson(text: string, people: readonly KnownPerson[]): boolean {
  const normalized = normalizeForMatch(text);
  const words = new Set(normalized.split(' ').filter(Boolean));
  const haystack = ` ${normalized} `;
  const has = (name: string | null | undefined) => {
    const parts = name ? normalizeForMatch(name).split(' ').filter(Boolean) : [];
    return parts.length > 0 && parts.join('').length >= 2 && parts.every((w) => words.has(w));
  };
  for (const p of people) {
    // Toute combinaison d'un alias du prénom et d'un alias du nom, quelle que soit l'écriture
    // (« Awa ديوب », « آوا Diop ») : ce sont deux écritures de la même personne.
    const firsts = [p.firstName, p.firstNameAr];
    const lasts = [p.lastName, p.lastNameAr];
    if (firsts.some(has) && lasts.some(has)) return true;
    const m = p.matricule ? normalizeForMatch(p.matricule) : '';
    if (m.length >= 4 && haystack.includes(` ${m} `)) return true;
  }
  return false;
}

/**
 * Protection des données des élèves (Ocall School AI) : contrôle des textes libres AVANT tout appel au
 * fournisseur IA. Un texte qui cite un élève ou un responsable de l'établissement (prénom et nom, ou
 * matricule) est refusé ; adresses électroniques et téléphones sont masqués. Une consigne au modèle ne
 * suffit pas : ce qui part chez le fournisseur ne se rattrape pas.
 */
@Injectable()
export class SchoolAiPrivacyService {
  constructor(private readonly db: SchoolPrismaService) {}

  async protect(ctx: SchoolContext, schoolId: string, texts: readonly string[]): Promise<string[]> {
    const free = texts.filter((t) => t.trim());
    if (free.length) {
      const [students, guardians] = await Promise.all([
        this.db.schoolStudent.findMany({
          where: { organizationId: ctx.organizationId, schoolId },
          select: {
            firstName: true,
            lastName: true,
            firstNameAr: true,
            lastNameAr: true,
            matricule: true,
          },
        }),
        this.db.schoolGuardian.findMany({
          where: { organizationId: ctx.organizationId, schoolId },
          select: { firstName: true, lastName: true },
        }),
      ]);
      const people: KnownPerson[] = [...students, ...guardians];
      // Chaque texte, puis l'ensemble : un prénom dans un champ et le nom dans un autre partent ensemble.
      if (
        free.some((t) => mentionsPerson(t, people)) ||
        mentionsPerson(free.join(' \n '), people)
      ) {
        throw new UnprocessableEntityException({
          code: 'AI_PERSONAL_DATA',
          message:
            'Le texte cite un élève ou un responsable de l’établissement : retirez toute donnée nominative ' +
            'avant d’utiliser l’IA. Les données des élèves ne sont jamais transmises au fournisseur.',
        });
      }
    }
    return texts.map(redactContacts);
  }
}

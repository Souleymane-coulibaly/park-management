import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

/** Refus métier ; `details` (identifiants concernés, état actuel) est transmis tel quel au client. */
export const printConflict = (code: string, message: string, details?: Record<string, unknown>) =>
  new ConflictException({ code, message, ...(details ? { details } : {}) });
export const printInvalid = (code: string, message: string) =>
  new BadRequestException({ code, message });
/** Introuvable ou hors périmètre : même réponse, rien n'indique qu'une ressource existe ailleurs. */
export const printNotFound = (what = 'Élément') =>
  new NotFoundException({ code: 'PRINT_NOT_FOUND', message: `${what} introuvable.` });
export const printDisabled = () =>
  new ServiceUnavailableException({
    code: 'PRINT_DISABLED',
    message: 'Ocall Print n’est pas disponible pour le moment.',
  });

/** Violation d'unicité Prisma (index unique ou index partiel). */
export const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Identifiant bien formé : un identifiant invalide est « introuvable », jamais une erreur serveur. */
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

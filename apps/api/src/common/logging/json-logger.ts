import type { LoggerService, LogLevel } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Journaux structurés JSON (production, Sprint 11B) : une ligne par événement, lisible par
 * Railway et tout outil d'analyse. Aucun secret : les motifs sensibles sont masqués avant
 * écriture (URL de base de données, jetons, mots de passe, clés d'API, liens signés).
 */
const SENSITIVE: [RegExp, string][] = [
  // Identifiants d'une URL de connexion : postgresql://utilisateur:motdepasse@hôte
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@/]+@/gi, '$1***:***@'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ***'],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-***'],
  [
    /("?(?:password|passwordHash|secret|token|apiKey|authorization|cookie|mfaSecret)"?\s*[:=]\s*)("[^"]*"|[^\s,}]+)/gi,
    '$1"***"',
  ],
  // Liens temporaires de téléchargement : le jeton vaut autorisation.
  [/(\/files\/)[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '$1***'],
  [/(ocp_session=)[^;\s]+/gi, '$1***'],
];

export function redact(text: string): string {
  return SENSITIVE.reduce((s, [pattern, replacement]) => s.replace(pattern, replacement), text);
}

function serialize(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export class JsonLogger implements LoggerService {
  constructor(
    private readonly write: (line: string) => void = (l) => process.stdout.write(`${l}\n`),
  ) {}

  private emit(level: LogLevel, message: unknown, params: unknown[]) {
    // Convention Nest : dernier paramètre = contexte ; pour error, l'avant-dernier = trace.
    const rest = [...params];
    const context = typeof rest[rest.length - 1] === 'string' ? (rest.pop() as string) : undefined;
    const entry: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      ...(context ? { context } : {}),
      message: redact(serialize(message)),
    };
    if (rest.length > 0) entry.detail = redact(rest.map(serialize).join(' '));
    this.write(JSON.stringify(entry));
  }

  log(message: unknown, ...params: unknown[]) {
    this.emit('log', message, params);
  }
  error(message: unknown, ...params: unknown[]) {
    this.emit('error', message, params);
  }
  warn(message: unknown, ...params: unknown[]) {
    this.emit('warn', message, params);
  }
  debug(message: unknown, ...params: unknown[]) {
    this.emit('debug', message, params);
  }
  verbose(message: unknown, ...params: unknown[]) {
    this.emit('verbose', message, params);
  }
}

/**
 * Journal d'accès HTTP : méthode, chemin (sans paramètres de requête, jetons masqués), statut,
 * durée, identifiant de requête (renvoyé dans X-Request-Id pour le support). Ni corps, ni cookie.
 */
export function requestLogger(
  write: (line: string) => void = (l) => process.stdout.write(`${l}\n`),
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const started = process.hrtime.bigint();
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    res.on('finish', () => {
      const path = redact((req.originalUrl ?? req.url).split('?')[0] ?? '');
      if (path.endsWith('/health')) return;
      write(
        JSON.stringify({
          time: new Date().toISOString(),
          level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'log',
          context: 'Http',
          requestId,
          method: req.method,
          path,
          status: res.statusCode,
          durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
        }),
      );
    });
    next();
  };
}

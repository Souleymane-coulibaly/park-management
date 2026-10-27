/** Erreur d'API au format unique { statusCode, code, message, details }. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }

  /** Messages détaillés (validation, politique de mot de passe) pour l'affichage. */
  get detailMessages(): string[] {
    return Array.isArray(this.details)
      ? this.details.filter((d): d is string => typeof d === 'string')
      : [];
  }
}

/**
 * Client HTTP du navigateur. Les appels passent par /api/v1 sur le domaine du frontend
 * (proxy Next.js), le cookie de session httpOnly est donc envoyé automatiquement.
 */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data ?? {}) as { code?: string; message?: string; details?: unknown };
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/')) {
      window.location.assign('/connexion?expire=1');
    }
    throw new ApiError(
      res.status,
      err.code ?? 'ERROR',
      err.message ?? 'Une erreur est survenue.',
      err.details,
    );
  }
  return data as T;
}

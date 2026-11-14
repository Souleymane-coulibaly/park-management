import { ApiError } from './api';

/**
 * Téléchargement d'un fichier produit par l'API avec la session (PDF, CSV…) : il n'a pas d'adresse
 * publique ; il est produit à la demande puis remis au navigateur. `body` : requête POST en JSON.
 */
export async function downloadFile(
  path: string,
  fallbackName: string,
  body?: unknown,
): Promise<void> {
  const res = await fetch(`/api/v1${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    throw new ApiError(res.status, err.code ?? 'ERROR', err.message ?? 'Une erreur est survenue.');
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  // Nom exact (RFC 5987) s'il est donné, sinon le nom simple.
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  let exact: string | undefined;
  try {
    exact = encoded ? decodeURIComponent(encoded) : undefined;
  } catch {
    exact = undefined;
  }
  const match = /filename="([^"]+)"/.exec(disposition);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = exact ?? match?.[1] ?? fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

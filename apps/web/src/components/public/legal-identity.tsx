import type { ReactNode } from 'react';
import type { OcallPublicLegalIdentity } from '@ocall/shared';
import { ToComplete } from './legal-page';

/**
 * Identité légale publiable d'Ocall, saisie dans l'administration (commercialisation J2). Lue côté
 * serveur, mise en cache 5 minutes ; null si l'API est indisponible (les champs restent « à compléter »).
 */
export async function loadLegalIdentity(): Promise<OcallPublicLegalIdentity | null> {
  try {
    const res = await fetch(
      `${process.env.API_URL ?? 'http://localhost:4000'}/api/v1/public/suite/legal-identity`,
      { next: { revalidate: 300 } },
    );
    return res.ok ? ((await res.json()) as OcallPublicLegalIdentity) : null;
  } catch {
    return null;
  }
}

/** Valeurs renseignées jointes ; null si aucune ne l'est. */
export function joinLegal(values: (string | null | undefined)[], separator = ', '): string | null {
  const filled = values.map((v) => v?.trim()).filter((v): v is string => Boolean(v));
  return filled.length ? filled.join(separator) : null;
}

/** Valeur saisie par Ocall, ou mention « à compléter » : jamais de valeur inventée. */
export function LegalValue({ value, missing }: { value: string | null; missing: ReactNode }) {
  return value ? (
    <span data-testid="legal-value">{value}</span>
  ) : (
    <ToComplete>{missing}</ToComplete>
  );
}

import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Me } from './types';

export const SESSION_COOKIE = 'ocp_session';
const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/**
 * Lecture de la session côté serveur (layouts protégés) : le cookie est transmis
 * directement à l'API. Retourne null si la session est absente ou invalide.
 */
export async function getSession(): Promise<Me | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const res = await fetch(`${API_URL}/api/v1/auth/me`, {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return (await res.json()) as Me;
}

/** Exige une session de membre d'organisation ; le changement de mot de passe initial est imposé. */
export async function requireMemberSession(): Promise<Me> {
  const me = await getSession();
  if (!me) redirect('/connexion');
  if (me.user.mustChangePassword) redirect('/changer-mot-de-passe');
  if (me.user.platformRole) redirect('/admin');
  if (!me.organization) redirect('/connexion');
  return me;
}

export async function requireSuperAdminSession(): Promise<Me> {
  const me = await getSession();
  if (!me) redirect('/connexion');
  if (me.user.mustChangePassword) redirect('/changer-mot-de-passe');
  if (!me.user.platformRole) redirect('/app');
  // Second facteur obligatoire (propriétaire, administrateur délégué, facturation).
  if (me.mfa.required && !me.mfa.verified) redirect('/double-authentification');
  return me;
}

'use client';

/**
 * Ocall Suite Sprint 2C : le cookie de session est commun à tous les onglets. Après un changement
 * d'organisation, un onglet resté ouvert interrogerait l'API avec la nouvelle session dans un écran de
 * l'ancienne organisation. L'onglet qui change d'organisation le signale ; les autres onglets des espaces
 * connectés se rechargent sur le portail.
 */
const KEY = 'ocall:organization-changed';
const CHANNEL = 'ocall-organization';

/** Espaces liés à une organisation (les pages publiques ne sont pas concernées). */
const MEMBER_AREAS = ['/app', '/suite', '/school', '/facture', '/stock', '/kiosk'];

export function isMemberArea(pathname: string): boolean {
  return MEMBER_AREAS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function announceOrganizationChange(organizationId: string): void {
  const message = `${organizationId}:${Date.now()}`;
  try {
    localStorage.setItem(KEY, message);
  } catch {
    // Stockage indisponible (navigation privée) : le canal ci-dessous suffit.
  }
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage(message);
    channel.close();
  } catch {
    // Navigateur sans BroadcastChannel : l'évènement « storage » suffit.
  }
}

/** Abonnement des autres onglets ; renvoie la fonction de désabonnement. */
export function onOrganizationChange(handler: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY && e.newValue) handler();
  };
  window.addEventListener('storage', onStorage);
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = () => handler();
  } catch {
    channel = null;
  }
  return () => {
    window.removeEventListener('storage', onStorage);
    channel?.close();
  };
}

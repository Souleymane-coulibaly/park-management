'use client';

import { useSyncExternalStore } from 'react';

const PROBE_TIMEOUT_MS = 8_000;
const POLL_ONLINE_MS = 30_000;
const POLL_OFFLINE_MS = 5_000;
const FAILURES_BEFORE_OFFLINE = 2;

let online = true;
let failures = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let probing = false;
const listeners = new Set<() => void>();

function setOnline(value: boolean) {
  if (online === value) return;
  online = value;
  listeners.forEach((l) => l());
}

/** Une réponse lente isolée ne suspend pas les ventes : la coupure exige des échecs consécutifs. */
function recordProbe(ok: boolean) {
  failures = ok ? 0 : failures + 1;
  if (ok) setOnline(true);
  else if (failures >= FAILURES_BEFORE_OFFLINE) setOnline(false);
}

function schedule() {
  clearTimeout(timer);
  if (listeners.size === 0) return;
  const delay = online && failures === 0 ? POLL_ONLINE_MS : POLL_OFFLINE_MS;
  timer = setTimeout(() => void checkConnectivity(), delay);
}

/**
 * Vérifie la connexion en interrogeant réellement le serveur : `navigator.onLine` reste vrai sur un
 * Wi-Fi sans accès à Internet. Une réponse 5xx (proxy ou base indisponible) vaut coupure.
 */
export async function checkConnectivity(): Promise<void> {
  if (typeof window === 'undefined' || probing) return;
  if (!navigator.onLine) {
    setOnline(false);
    schedule();
    return;
  }
  probing = true;
  try {
    const res = await fetch('/api/v1/health', {
      cache: 'no-store',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    recordProbe(res.status < 500);
  } catch {
    recordProbe(false);
  } finally {
    probing = false;
    schedule();
  }
}

const onBrowserOffline = () => {
  setOnline(false);
  schedule();
};
const onBrowserOnline = () => void checkConnectivity();
const onVisibility = () => {
  if (document.visibilityState === 'visible') void checkConnectivity();
};

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    window.addEventListener('offline', onBrowserOffline);
    window.addEventListener('online', onBrowserOnline);
    document.addEventListener('visibilitychange', onVisibility);
    if (!navigator.onLine) online = false;
  }
  listeners.add(listener);
  if (listeners.size === 1) void checkConnectivity();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearTimeout(timer);
      window.removeEventListener('offline', onBrowserOffline);
      window.removeEventListener('online', onBrowserOnline);
      document.removeEventListener('visibilitychange', onVisibility);
    }
  };
}

/** État partagé de la connexion : une seule sonde par onglet, quel que soit le nombre d'écrans abonnés. */
export function useConnectivity(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => online,
    () => true,
  );
}

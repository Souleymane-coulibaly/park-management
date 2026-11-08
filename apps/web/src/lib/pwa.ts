'use client';

import { useSyncExternalStore } from 'react';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PwaState {
  /** Une nouvelle version attend la décision de l'utilisateur. */
  updateReady: boolean;
  /** Le navigateur propose l'installation (Android, ordinateur). */
  canInstall: boolean;
}

const SERVER_STATE: PwaState = { updateReady: false, canInstall: false };
const UPDATE_CHECK_MS = 60 * 60 * 1000;

let state = SERVER_STATE;
let started = false;
let installEvent: InstallPromptEvent | null = null;
let registration: ServiceWorkerRegistration | null = null;
let reloadOnChange = false;
const listeners = new Set<() => void>();

function patch(next: Partial<PwaState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function watchInstalling(worker: ServiceWorker | null) {
  worker?.addEventListener('statechange', () => {
    // Sans contrôleur, c'est la première installation : rien à annoncer.
    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
      patch({ updateReady: true });
    }
  });
}

/** Enregistre le Service Worker de l'espace client et écoute la proposition d'installation. */
/**
 * Démarre la PWA. `scope` : `/app` pour Ocall Park ; `/parents` pour le portail parents d'Ocall School
 * (Sprint 6), installable depuis le navigateur avec son propre manifeste.
 */
export function startPwa(scope: '/app' | '/parents' = '/app'): void {
  if (started) return;
  started = true;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installEvent = event as InstallPromptEvent;
    patch({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    patch({ canInstall: false });
  });
  if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadOnChange) window.location.reload();
  });
  void navigator.serviceWorker
    .register('/sw.js', { scope })
    .then((reg) => {
      registration = reg;
      if (reg.waiting && navigator.serviceWorker.controller) patch({ updateReady: true });
      watchInstalling(reg.installing);
      reg.addEventListener('updatefound', () => watchInstalling(reg.installing));
      setInterval(() => void reg.update().catch(() => undefined), UPDATE_CHECK_MS);
    })
    .catch(() => {
      // Sans Service Worker (navigation privée, HTTP) : l'application reste utilisable en ligne.
    });
}

/** Active la version en attente puis recharge la page ; déclenché uniquement par l'utilisateur. */
export function applyUpdate(): void {
  if (!registration?.waiting) return;
  reloadOnChange = true;
  registration.waiting.postMessage('SKIP_WAITING');
}

export async function promptInstall(): Promise<void> {
  if (!installEvent) return;
  await installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
  patch({ canInstall: false });
}

export function usePwa(): PwaState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => SERVER_STATE,
  );
}

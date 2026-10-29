'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PosTerminal } from '@/lib/types';
import { useApi } from '@/lib/use-api';

const key = (establishmentId: string) => `ocp.pos.terminal.${establishmentId}`;

/** Poste de caisse utilisé par cet appareil dans l'établissement (choix mémorisé localement). */
export function useDeviceTerminal(establishmentId: string) {
  const terminals = useApi<PosTerminal[]>(`/pos-terminals?establishmentId=${establishmentId}`);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    try {
      setSelectedId(localStorage.getItem(key(establishmentId)));
    } catch {
      setSelectedId(null);
    }
  }, [establishmentId]);

  const select = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      try {
        if (id) localStorage.setItem(key(establishmentId), id);
        else localStorage.removeItem(key(establishmentId));
      } catch {
        // Stockage indisponible : le choix vaut pour la page en cours.
      }
    },
    [establishmentId],
  );

  const active = terminals.state === 'success' ? terminals.data.filter((t) => t.isActive) : [];
  const terminal =
    active.find((t) => t.id === selectedId) ?? (active.length === 1 ? active[0]! : null);
  return {
    terminals: active,
    terminal,
    select,
    reload: terminals.reload,
    loading: terminals.state === 'loading',
  };
}

/** Rattache cet appareil à un poste depuis la page de configuration. */
export function rememberDeviceTerminal(establishmentId: string, terminalId: string): void {
  try {
    localStorage.setItem(key(establishmentId), terminalId);
  } catch {
    // Stockage indisponible.
  }
}

/** État de la connexion réseau de l'appareil (tablette en Wi-Fi ou 4G). */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** Garde l'écran de la tablette allumé pendant que la caisse est ouverte (si le navigateur le permet). */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = () => {
      navigator.wakeLock
        .request('screen')
        .then((s) => {
          if (cancelled) void s.release();
          else sentinel = s;
        })
        .catch(() => undefined);
    };
    request();
    const onVisible = () => document.visibilityState === 'visible' && request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release();
    };
  }, [enabled]);
}

'use client';

import { useEffect, useRef, useState } from 'react';

/** État de la connexion temps réel, affiché à l'écran (jamais de doute sur la fraîcheur). */
export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'unavailable';

export interface LiveEvent {
  type: string;
  saleId: string | null;
  requestId: string | null;
  at: string;
}

/** Délai avant une nouvelle tentative quand le serveur a refusé ou fermé le flux. */
const RETRY_AFTER_CLOSE_MS = 10_000;
/**
 * Le serveur envoie un battement toutes les 25 s : sans aucun message pendant 60 s, la connexion
 * est considérée comme morte (réseau mobile coupé sans fermeture visible) et elle est rouverte.
 */
const STALE_AFTER_MS = 60_000;
const WATCHDOG_EVERY_MS = 10_000;

/**
 * Abonnement à un flux SSE de l'API (/api/v1/...), authentifié par le cookie de session.
 *
 * - « ready » est émis à chaque (re)connexion : l'écran recharge alors sa liste complète, si bien
 *   qu'aucune modification faite pendant une coupure réseau n'est perdue ;
 * - perte du réseau (évènement « offline ») : l'état passe immédiatement à « reconnexion » ;
 *   retour du réseau (« online ») : le flux est rouvert sans attendre, puis resynchronisé ;
 * - une connexion silencieuse (aucun battement depuis 60 s) est rouverte ;
 * - si le serveur ferme le flux (session révoquée, redéploiement), nouvelle tentative après 10 s.
 */
export function useLiveStream(
  path: string | null,
  eventTypes: readonly string[],
  onEvent: (event: LiveEvent) => void,
): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [attempt, setAttempt] = useState(0);
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const typesKey = eventTypes.join(',');

  useEffect(() => {
    if (!path) return;
    setStatus('connecting');
    const source = new EventSource(`/api/v1${path}`, { withCredentials: true });
    let retry: ReturnType<typeof setTimeout> | undefined;
    let lastMessageAt = Date.now();
    const reconnect = () => setAttempt((a) => a + 1);
    const dispatch = (type: string) => (e: MessageEvent<string>) => {
      lastMessageAt = Date.now();
      let data: Partial<LiveEvent> = {};
      try {
        data = JSON.parse(e.data) as Partial<LiveEvent>;
      } catch {
        // Message illisible : on recharge quand même par prudence.
      }
      handler.current({
        type,
        saleId: data.saleId ?? null,
        requestId: data.requestId ?? null,
        at: data.at ?? new Date().toISOString(),
      });
    };
    source.addEventListener('ready', (e) => {
      setStatus('live');
      dispatch('ready')(e as MessageEvent<string>);
    });
    source.addEventListener('ping', () => {
      lastMessageAt = Date.now();
    });
    for (const type of typesKey.split(',').filter(Boolean)) {
      source.addEventListener(type, dispatch(type) as EventListener);
    }
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) {
        setStatus('unavailable');
        retry = setTimeout(reconnect, RETRY_AFTER_CLOSE_MS);
      } else {
        setStatus('reconnecting');
      }
    };
    const onOffline = () => setStatus('reconnecting');
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', reconnect);
    const watchdog = setInterval(() => {
      if (Date.now() - lastMessageAt > STALE_AFTER_MS) reconnect();
    }, WATCHDOG_EVERY_MS);
    return () => {
      clearTimeout(retry);
      clearInterval(watchdog);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', reconnect);
      source.close();
    };
  }, [path, typesKey, attempt]);

  return status;
}

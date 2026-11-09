'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, Bell, CheckCheck } from 'lucide-react';
import { SuiteShell } from '@/components/suite/suite-shell';
import { Button } from '@/components/ui/button';
import { ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';

interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

interface Page {
  items: NotificationItem[];
  unread: number;
  nextCursor: string | null;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Centre de notifications Ocall Suite (Sprint S2) : historique paginé, filtre « non lues », marquage
 * lu (une ou toutes), lien vers l'élément concerné. Le serveur ne renvoie que les notifications du
 * compte connecté, pour l'organisation de sa session.
 */
export function SuiteNotificationsCenter() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [bell, setBell] = useState(0);

  const toError = (e: unknown) =>
    e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion au serveur impossible.');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    api<Page>(`/suite/notifications${unreadOnly ? '?unread=true' : ''}`)
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setUnread(page.unread);
        setCursor(page.nextCursor);
        setState('ready');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadError(toError(e));
        setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [unreadOnly, version]);

  async function more() {
    if (!cursor) return;
    setBusy(true);
    try {
      const page = await api<Page>(
        `/suite/notifications?cursor=${cursor}${unreadOnly ? '&unread=true' : ''}`,
      );
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      setActionError(toError(e));
    } finally {
      setBusy(false);
    }
  }

  async function markRead(id: string) {
    setActionError(null);
    try {
      await api(`/suite/notifications/${id}/read`, { method: 'POST' });
      const now = new Date().toISOString();
      setItems((prev) =>
        unreadOnly
          ? prev.filter((n) => n.id !== id)
          : prev.map((n) => (n.id === id ? { ...n, readAt: now } : n)),
      );
      setUnread((u) => Math.max(0, u - 1));
      setBell((b) => b + 1);
    } catch (e) {
      setActionError(toError(e));
    }
  }

  async function markAll() {
    setBusy(true);
    setActionError(null);
    try {
      await api('/suite/notifications/read-all', { method: 'POST' });
      setVersion((v) => v + 1);
      setBell((b) => b + 1);
    } catch (e) {
      setActionError(toError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SuiteShell unreadVersion={bell}>
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6">
        <Link
          href="/suite"
          className="inline-flex items-center gap-1 text-sm font-semibold text-suite-green"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Retour au portail
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-extrabold text-suite-green">Notifications</h1>
            <p className="mt-1 text-suite-ink-soft" data-testid="suite-unread-count">
              {unread === 0
                ? 'Tout est lu.'
                : `${unread} notification${unread > 1 ? 's' : ''} non lue${unread > 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div
              role="group"
              aria-label="Filtrer les notifications"
              className="inline-flex rounded-xl border border-suite-ink/10 bg-white p-1"
            >
              {[
                { value: false, label: 'Toutes' },
                { value: true, label: 'Non lues' },
              ].map((f) => (
                <button
                  key={f.label}
                  type="button"
                  onClick={() => setUnreadOnly(f.value)}
                  aria-pressed={unreadOnly === f.value}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                    unreadOnly === f.value
                      ? 'bg-suite-green text-suite-ivory'
                      : 'text-suite-ink-soft hover:bg-suite-ivory'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <Button size="sm" variant="secondary" onClick={markAll} disabled={busy || unread === 0}>
              <CheckCheck className="h-4 w-4" aria-hidden /> Tout marquer comme lu
            </Button>
          </div>
        </div>
        <ApiErrorAlert error={actionError} />
        {state === 'loading' && <LoadingState />}
        {state === 'error' && loadError && (
          <ErrorState error={loadError} onRetry={() => setVersion((v) => v + 1)} />
        )}
        {state === 'ready' && items.length === 0 && (
          <div className="rounded-3xl border border-suite-ink/5 bg-white shadow-card">
            <EmptyState
              icon={<Bell className="h-7 w-7" aria-hidden />}
              title={unreadOnly ? 'Aucune notification non lue' : 'Aucune notification'}
              description="Les échéances d’essai et d’abonnement, vos demandes et les recharges SMS apparaîtront ici."
            />
          </div>
        )}
        {state === 'ready' && items.length > 0 && (
          <ul className="space-y-3" data-testid="suite-notifications">
            {items.map((n) => (
              <li
                key={n.id}
                className={`rounded-2xl border bg-white p-4 shadow-card ${
                  n.readAt ? 'border-suite-ink/5' : 'border-suite-green/40'
                }`}
                data-testid="suite-notification"
                data-unread={n.readAt ? 'false' : 'true'}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-semibold text-suite-ink">
                      {!n.readAt && (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full bg-suite-clay"
                          aria-label="Non lue"
                        />
                      )}
                      <span className="break-words">{n.title}</span>
                    </p>
                    <p className="mt-1 break-words text-sm text-suite-ink-soft">{n.body}</p>
                    <p className="mt-2 text-xs text-suite-ink-soft">{when(n.createdAt)}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {n.href && (
                      <Link
                        href={n.href}
                        className="rounded-xl px-3 py-1.5 text-sm font-semibold text-suite-green hover:bg-suite-ivory"
                      >
                        Voir
                      </Link>
                    )}
                    {!n.readAt && (
                      <Button size="sm" variant="ghost" onClick={() => markRead(n.id)}>
                        Marquer comme lu
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {state === 'ready' && cursor && (
          <div className="text-center">
            <Button size="sm" variant="secondary" onClick={more} disabled={busy}>
              Afficher plus
            </Button>
          </div>
        )}
      </main>
    </SuiteShell>
  );
}

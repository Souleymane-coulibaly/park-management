'use client';

import Link from 'next/link';
import { useState } from 'react';
import { SCHOOL_TEXT_FR, type SchoolNotificationKind, type SchoolTextKey } from '@ocall/shared';
import { usePortal } from '@/components/parents/parent-shell';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface NotificationPage {
  items: {
    id: string;
    kind: SchoolNotificationKind;
    studentId: string | null;
    params: Record<string, string>;
    readAt: string | null;
    createdAt: string;
    href: string;
  }[];
  unread: number;
  nextCursor: string | null;
}

/**
 * Texte d'une notification : variante du changement (examen déplacé ou annulé, cours rétabli…) quand elle
 * existe, sinon le texte du type.
 */
function notificationKey(kind: SchoolNotificationKind, change: string | undefined): SchoolTextKey {
  const variant = `par.notif.${kind}_${change}`;
  return change && Object.hasOwn(SCHOOL_TEXT_FR, variant)
    ? (variant as SchoolTextKey)
    : (`par.notif.${kind}` as SchoolTextKey);
}

/** Centre de notifications : non lues, lecture, historique, lien vers la page concernée. */
export default function ParentNotificationsPage() {
  const { t, date } = useSchoolText();
  const { children } = usePortal();
  const [unreadOnly, setUnreadOnly] = useState(false);
  // Pages déjà parcourues (curseurs fournis par l'API) : retour aux plus récentes possible.
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors[cursors.length - 1];
  const query = new URLSearchParams({
    ...(unreadOnly ? { unread: 'true' } : {}),
    ...(cursor ? { cursor } : {}),
  }).toString();
  const list = useApi<NotificationPage>(`/school/portal/notifications${query ? `?${query}` : ''}`);
  const [error, setError] = useState<ApiError | null>(null);
  const childFirstName = (id: string | null) =>
    children.find((c) => c.id === id)?.firstName ?? null;

  async function act(path: string) {
    setError(null);
    try {
      await api(path, { method: 'POST' });
      list.reload();
    } catch (e) {
      setError(toApiError(e));
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => {
              setUnreadOnly(e.target.checked);
              setCursors([]);
            }}
          />
          {t('par.notif.unreadOnly')}
        </label>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void act('/school/portal/notifications/read-all')}
        >
          {t('par.notif.readAll')}
        </Button>
      </div>
      <ApiErrorAlert error={error} />
      {list.state === 'loading' ? (
        <LoadingState />
      ) : list.state === 'error' ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : list.data.items.length === 0 ? (
        <Alert tone="info" title={t('par.notif.none')} />
      ) : (
        <Card>
          <ul className="divide-y divide-line/70" data-testid="notifications">
            {list.data.items.map((n) => {
              const params = { ...n.params, date: n.params.date ? date(n.params.date) : '' };
              const who = childFirstName(n.studentId);
              return (
                <li
                  key={n.id}
                  className={`flex flex-wrap items-center justify-between gap-2 p-4 text-sm ${
                    n.readAt ? '' : 'bg-savanna/10 font-medium'
                  }`}
                >
                  <div>
                    <p>
                      {who ? `${who} · ` : ''}
                      {t(notificationKey(n.kind, n.params.change), params)}
                    </p>
                    <p className="text-xs text-muted">{date(n.createdAt)}</p>
                  </div>
                  <span className="flex gap-2">
                    <Link
                      href={n.href}
                      onClick={() =>
                        !n.readAt && void act(`/school/portal/notifications/${n.id}/read`)
                      }
                      className="rounded-lg border border-line bg-white px-3 py-1.5"
                    >
                      {t('par.notif.open')}
                    </Link>
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {list.state === 'success' && (cursors.length > 0 || list.data.nextCursor) && (
        <div className="flex justify-between gap-2" data-testid="notifications-pager">
          <Button
            size="sm"
            variant="secondary"
            disabled={cursors.length === 0}
            onClick={() => setCursors((c) => c.slice(0, -1))}
          >
            {t('common.previous')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!list.data.nextCursor}
            onClick={() => {
              const next = list.data.nextCursor;
              if (next) setCursors((c) => [...c, next]);
            }}
          >
            {t('common.next')}
          </Button>
        </div>
      )}
    </>
  );
}

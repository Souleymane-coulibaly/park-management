'use client';

import Link from 'next/link';
import type { SchoolAttendanceStatus, SchoolCurrency } from '@ocall/shared';
import { type Announcement, type PortalChild, childName } from '@/components/parents/parent-shell';
import { Money } from '@/components/school/school-finance';
import { useSchoolText } from '@/components/school/school-language';
import { Card, CardBody } from '@/components/ui/card';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

interface Dashboard {
  children: (PortalChild & {
    attendance: {
      stats: { sessions: number; presenceRate: number | null };
      recent: { id: string; status: SchoolAttendanceStatus; date: string; slot: string }[];
    };
    latestResult: {
      period: string;
      periodAr: string | null;
      generalAverage: number | null;
      scale: number;
    } | null;
    reportCards: number;
    finance: { currency: SchoolCurrency | null; balance: number; overdue: number };
    quranAvailable: boolean;
  })[];
  announcements: Announcement[];
  unreadNotifications: number;
}

/** Tableau de bord des parents : un résumé par enfant, annonces récentes, notifications non lues. */
export default function ParentDashboardPage() {
  const { t, name, date, showArabic, language } = useSchoolText();
  const data = useApi<Dashboard>('/school/portal/dashboard');
  if (data.state === 'loading') return <LoadingState />;
  if (data.state === 'error') return <ErrorState error={data.error} onRetry={data.reload} />;
  const d = data.data;
  if (d.children.length === 0) return <Alert tone="info" title={t('par.noChildren')} />;
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2" data-testid="parent-children">
        {d.children.map((c) => {
          const base = `/parents/enfants/${c.id}`;
          return (
            <Card key={c.id}>
              <CardBody>
                <Link href={`${base}/presences`} className="block">
                  <h2 className="text-lg font-bold">{childName(c, showArabic, language)}</h2>
                  <p className="text-sm text-muted">
                    {c.class ? name(c.class) : '—'} · {name(c.school)}
                  </p>
                </Link>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted">{t('par.dash.presence')}</dt>
                    <dd className="font-semibold">
                      {c.attendance.stats.presenceRate === null
                        ? '—'
                        : `${(c.attendance.stats.presenceRate / 100).toLocaleString('fr-FR')} %`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">{t('par.dash.latest')}</dt>
                    <dd className="font-semibold">
                      {c.latestResult && c.latestResult.generalAverage !== null
                        ? `${c.latestResult.generalAverage.toLocaleString('fr-FR')} / ${c.latestResult.scale}`
                        : t('par.dash.noResults')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">{t('par.dash.cards')}</dt>
                    <dd className="font-semibold">
                      <Link href={`${base}/bulletins`} className="underline">
                        {c.reportCards}
                      </Link>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">{t('par.dash.balance')}</dt>
                    <dd className="font-semibold">
                      {c.finance.currency ? (
                        <Link href={`${base}/finances`} className="underline">
                          <Money value={c.finance.balance} currency={c.finance.currency} />
                        </Link>
                      ) : (
                        '—'
                      )}
                      {c.finance.currency && c.finance.overdue > 0 && (
                        <span className="block text-xs font-normal text-terracotta-dark">
                          {t('par.dash.overdue')}{' '}
                          <Money value={c.finance.overdue} currency={c.finance.currency} />
                        </span>
                      )}
                    </dd>
                  </div>
                </dl>
                <h3 className="mt-3 text-xs font-semibold text-muted">{t('par.dash.recent')}</h3>
                {c.attendance.recent.length === 0 ? (
                  <p className="text-sm text-muted">{t('par.dash.none')}</p>
                ) : (
                  <ul className="text-sm">
                    {c.attendance.recent.map((r) => (
                      <li key={r.id}>
                        {date(r.date)} · {t(`par.att.status.${r.status}`)}
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>
      <Card>
        <CardBody>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-semibold">{t('par.dash.announcements')}</h2>
            <Link href="/parents/notifications" className="text-sm underline">
              {t('par.dash.unread')} : {d.unreadNotifications}
            </Link>
          </div>
          {d.announcements.length === 0 ? (
            <p className="text-sm text-muted">{t('par.ann.none')}</p>
          ) : (
            <ul className="divide-y divide-line/70">
              {d.announcements.map((a) => (
                <li key={a.id} className="py-2">
                  <p className="font-medium">
                    {language === 'ar' && a.titleAr ? a.titleAr : a.title}
                  </p>
                  <p className="text-xs text-muted">{date(a.publishedAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}

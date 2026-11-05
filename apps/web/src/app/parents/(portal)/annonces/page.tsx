'use client';

import { useState } from 'react';
import { SCHOOL_PORTAL_ANNOUNCEMENTS_PAGE } from '@ocall/shared';
import type { Announcement } from '@/components/parents/parent-shell';
import { useSchoolText } from '@/components/school/school-language';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

/** Annonces de l'établissement visant les enfants du compte (classe, élève, responsable, école). */
export default function ParentAnnouncementsPage() {
  const { t, date, language, showArabic } = useSchoolText();
  const [page, setPage] = useState(0);
  const list = useApi<Announcement[]>(`/school/portal/announcements?page=${page}`);
  if (list.state === 'loading') return <LoadingState />;
  if (list.state === 'error') return <ErrorState error={list.error} onRetry={list.reload} />;
  if (list.data.length === 0 && page === 0) return <Alert tone="info" title={t('par.ann.none')} />;
  return (
    <div className="space-y-3" data-testid="announcements">
      {list.data.map((a) => {
        const arabic = language === 'ar' && a.titleAr;
        return (
          <Card key={a.id}>
            <CardBody>
              <h2 className="font-semibold">{arabic ? a.titleAr : a.title}</h2>
              <p className="text-xs text-muted">
                {date(a.publishedAt)}
                {a.expiresOn ? ` · ${t('par.ann.expires', { date: date(a.expiresOn) })}` : ''}
              </p>
              <p className="mt-2 whitespace-pre-line text-sm">
                {arabic && a.bodyAr ? a.bodyAr : a.body}
              </p>
              {showArabic && language !== 'ar' && a.bodyAr && (
                <p className="mt-2 whitespace-pre-line text-sm" dir="rtl" lang="ar">
                  {a.bodyAr}
                </p>
              )}
            </CardBody>
          </Card>
        );
      })}
      {(page > 0 || list.data.length === SCHOOL_PORTAL_ANNOUNCEMENTS_PAGE) && (
        <div className="flex justify-between gap-2" data-testid="announcements-pager">
          <Button
            size="sm"
            variant="secondary"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            {t('common.previous')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={list.data.length < SCHOOL_PORTAL_ANNOUNCEMENTS_PAGE}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('common.next')}
          </Button>
        </div>
      )}
    </div>
  );
}

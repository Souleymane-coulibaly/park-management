'use client';

import { useState } from 'react';
import { type SchoolEventCategory, addDays, isClosure } from '@ocall/shared';
import { usePortal } from '@/components/parents/parent-shell';
import { useSchoolText } from '@/components/school/school-language';
import { todayIn } from '@/components/school/school-planning';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

interface FamilyEvent {
  id: string;
  category: SchoolEventCategory;
  title: string;
  titleAr: string | null;
  description: string | null;
  descriptionAr: string | null;
  startsOn: string;
  endsOn: string;
  start: string | null;
  end: string | null;
}

const shiftMonth = (first: string, delta: number) => {
  const [y, m] = first.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 10);
};

/**
 * Calendrier des familles (Sprint 7) : événements publiés visibles des familles qui visent l'établissement,
 * la classe ou un groupe d'un enfant autorisé (vacances, jours fériés, réunions, sorties…).
 */
export default function ParentCalendarPage() {
  const { t, name, date } = useSchoolText();
  const { children } = usePortal();
  const [first, setFirst] = useState(
    () => `${todayIn(children[0]?.school.timezone).slice(0, 7)}-01`,
  );
  const last = addDays(shiftMonth(first, 1), -1);
  const events = useApi<FamilyEvent[]>(`/school/portal/calendar?from=${first}&to=${last}`);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => setFirst(shiftMonth(first, -1))}>
          {t('cal.prevMonth')}
        </Button>
        <span className="font-medium" data-testid="month-label">
          {date(first)} – {date(last)}
        </span>
        <Button size="sm" variant="secondary" onClick={() => setFirst(shiftMonth(first, 1))}>
          {t('cal.nextMonth')}
        </Button>
      </div>
      {events.state === 'loading' ? (
        <LoadingState />
      ) : events.state === 'error' ? (
        <ErrorState error={events.error} onRetry={events.reload} />
      ) : events.data.length === 0 ? (
        <Alert tone="info" title={t('par.cal.none')} />
      ) : (
        <div className="space-y-3" data-testid="family-events">
          {events.data.map((e) => (
            <Card key={e.id}>
              <CardBody>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-semibold">{name({ name: e.title, nameAr: e.titleAr })}</h2>
                  <Badge tone={isClosure(e.category) ? 'savanna' : 'forest'}>
                    {t(`cal.cat.${e.category}`)}
                  </Badge>
                </div>
                <p className="text-xs text-muted">
                  {date(e.startsOn)}
                  {e.endsOn !== e.startsOn ? ` → ${date(e.endsOn)}` : ''}
                  {e.start ? <span dir="ltr">{` · ${e.start}–${e.end}`}</span> : null}
                </p>
                {(e.description || e.descriptionAr) && (
                  <p className="mt-2 whitespace-pre-line text-sm">
                    {name({ name: e.description ?? '', nameAr: e.descriptionAr })}
                  </p>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

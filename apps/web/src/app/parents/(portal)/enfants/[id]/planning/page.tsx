'use client';

import { useParams } from 'next/navigation';
import { ChildHeader, useChild } from '@/components/parents/parent-shell';
import { useSchoolText } from '@/components/school/school-language';
import { type WeekView, WeekNav, WeekSchedule, useWeek } from '@/components/school/school-planning';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

/**
 * Emploi du temps de l'enfant (Sprint 7) : semaine publiée de sa classe (ses groupes seulement), cours
 * annulés, jours sans cours et examens publiés. Lecture seule ; l'API vérifie le lien parent-enfant.
 */
export default function ChildPlanningPage() {
  const { id } = useParams<{ id: string }>();
  const child = useChild(id);
  const { t } = useSchoolText();
  if (!child) return <Alert tone="info" title={t('par.noChildren')} />;
  return (
    <>
      <ChildHeader child={child} />
      <ChildWeek studentId={id} timezone={child.school.timezone} />
    </>
  );
}

function ChildWeek({ studentId, timezone }: { studentId: string; timezone: string }) {
  const { t } = useSchoolText();
  const week = useWeek(timezone);
  const view = useApi<WeekView>(
    `/school/portal/children/${studentId}/planning?date=${week.monday}`,
  );
  return (
    <>
      <WeekNav week={week} />
      {view.state === 'loading' ? (
        <LoadingState />
      ) : view.state === 'error' ? (
        <ErrorState error={view.error} onRetry={view.reload} />
      ) : view.data.days.length === 0 ? (
        <Alert tone="info" title={t('par.plan.noClass')} />
      ) : view.data.days.every((d) => d.lessons.length === 0 && d.exams.length === 0) ? (
        <>
          <Alert tone="info" title={t('par.plan.none')} />
          <WeekSchedule week={view.data} />
        </>
      ) : (
        <WeekSchedule week={view.data} />
      )}
    </>
  );
}

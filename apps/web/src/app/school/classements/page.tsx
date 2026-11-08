'use client';

import { ClassPeriodPicker, type Selection, useScore } from '@/components/school/school-assessment';
import { useSchoolText } from '@/components/school/school-language';
import { SchoolPage } from '@/components/school/school-page';
import type { ReportCardsOverview } from '@/components/school/school-report-cards';
import { StudentName } from '@/components/school/school-students';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

/** Classements (Sprint 4) : rang sur la moyenne générale, si l'établissement l'autorise. */
export default function ClassementsPage() {
  return (
    <SchoolPage title="rank.title" description="rank.desc">
      {({ school }) => (
        <ClassPeriodPicker key={school!.id} schoolId={school!.id}>
          {(selection) => (
            <Ranking key={`${selection.classId}:${selection.periodId}`} selection={selection} />
          )}
        </ClassPeriodPicker>
      )}
    </SchoolPage>
  );
}

function Ranking({ selection }: { selection: Selection }) {
  const { t, date } = useSchoolText();
  const score = useScore();
  const overview = useApi<ReportCardsOverview>(
    `/school/report-cards?classId=${selection.classId}&periodId=${selection.periodId}`,
  );
  if (overview.state === 'loading') return <LoadingState />;
  if (overview.state === 'error')
    return <ErrorState error={overview.error} onRetry={overview.reload} />;
  const { rankingEnabled, students, rules, validation, classAverage } = overview.data;
  if (!rankingEnabled) return <Alert tone="info" title={t('rank.disabled')} />;
  // Classés d'abord, par rang puis par nom ; les élèves sans moyenne à la fin.
  const sorted = [...students].sort(
    (a, b) =>
      (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) ||
      a.lastName.localeCompare(b.lastName),
  );
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={validation ? 'forest' : 'savanna'}>
          {validation
            ? t('results.validated', { date: date(validation.validatedAt) })
            : t('results.notValidated')}
        </Badge>
        <span className="text-muted">
          {t('results.classAverage')} : <span dir="ltr">{score(classAverage, rules.decimals)}</span>
        </span>
      </div>
      <Card>
        <ol className="divide-y divide-line/70" data-testid="ranking">
          {sorted.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
              data-testid="ranking-row"
            >
              <span className="w-12 text-lg font-semibold">{s.rank ?? '–'}</span>
              <span className="min-w-0 flex-1">
                <StudentName student={s} />
                {s.tied && <span className="ms-2 text-xs text-muted">{t('results.tied')}</span>}
              </span>
              {s.rank === null && <Badge tone="neutral">{t('rank.unranked')}</Badge>}
              <span className="font-semibold" dir="ltr">
                {score(s.generalAverage, rules.decimals)} / {rules.scale}
              </span>
            </li>
          ))}
        </ol>
      </Card>
    </>
  );
}

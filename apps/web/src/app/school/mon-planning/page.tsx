'use client';

import { useState } from 'react';
import { type SchoolTextKey, hasSchoolPermission } from '@ocall/shared';
import { useSchoolText } from '@/components/school/school-language';
import { SchoolPage } from '@/components/school/school-page';
import {
  type Named,
  type TeacherNames,
  type WeekView,
  WeekNav,
  WeekSchedule,
  useWeek,
} from '@/components/school/school-planning';
import { Card, CardBody } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

interface TeacherWeek extends WeekView {
  member: TeacherNames;
  changes: { id: string; action: string; createdAt: string; class: Named }[];
}

/**
 * Planning personnel (Sprint 7) : cours de la semaine dans toutes les classes, examens surveillés, fil
 * des changements publiés. La direction et le secrétariat peuvent consulter celui d'un enseignant.
 */
export default function MyPlanningPage() {
  return (
    <SchoolPage title="myp.title" description="myp.desc">
      {({ school, context }) => (
        <Planning
          key={school!.id}
          schoolId={school!.id}
          timezone={school!.timezone}
          canPick={hasSchoolPermission(context.role, 'school.teaching.read')}
        />
      )}
    </SchoolPage>
  );
}

function Planning({
  schoolId,
  timezone,
  canPick,
}: {
  schoolId: string;
  timezone: string;
  canPick: boolean;
}) {
  const { t } = useSchoolText();
  const week = useWeek(timezone);
  const teachers = useApi<TeacherNames[]>(canPick ? `/school/teachers?schoolId=${schoolId}` : null);
  const [memberId, setMember] = useState('');
  const view = useApi<TeacherWeek>(
    `/school/planning/teacher-week?date=${week.monday}${memberId ? `&memberId=${memberId}` : ''}`,
  );
  return (
    <>
      {canPick && teachers.state === 'success' && (
        <div className="max-w-xs">
          <SelectField
            label={t('myp.pickTeacher')}
            value={memberId}
            onChange={(e) => setMember(e.target.value)}
            options={[
              { value: '', label: '—' },
              ...teachers.data.map((m) => ({ value: m.id, label: `${m.lastName} ${m.firstName}` })),
            ]}
          />
        </div>
      )}
      <WeekNav week={week} />
      {view.state === 'loading' ? (
        <LoadingState />
      ) : view.state === 'error' ? (
        view.error.status === 404 && !memberId ? (
          <Alert tone="info" title={t('myp.noMember')} />
        ) : (
          <ErrorState error={view.error} onRetry={view.reload} />
        )
      ) : (
        <>
          <WeekSchedule week={view.data} showClass />
          <Changes changes={view.data.changes} />
        </>
      )}
    </>
  );
}

function Changes({ changes }: { changes: TeacherWeek['changes'] }) {
  const { t, name, date } = useSchoolText();
  return (
    <Card>
      <CardBody>
        <h2 className="mb-2 font-semibold">{t('myp.changes')}</h2>
        {changes.length === 0 ? (
          <p className="text-sm text-muted">{t('myp.noChanges')}</p>
        ) : (
          <ul className="divide-y divide-line/70 text-sm" data-testid="changes">
            {changes.map((c) => (
              <li key={c.id} className="py-2">
                {date(c.createdAt)} · {name(c.class)} · {t(`tt.event.${c.action}` as SchoolTextKey)}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

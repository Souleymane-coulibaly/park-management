'use client';

import { useSchoolText } from '@/components/school/school-language';
import { BiName, SchoolPage } from '@/components/school/school-page';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { SimpleForm } from '@/components/ui/simple-form';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

interface SubjectView {
  id: string;
  name: string;
  nameAr: string | null;
  isReligious: boolean;
  defaultCoefficient: string;
  track: { id: string; name: string; nameAr?: string | null } | null;
}

export default function MatieresPage() {
  return (
    <SchoolPage title="subjects.title" description="subjects.desc">
      {({ school, canWrite }) => (
        <Subjects
          key={school!.id}
          schoolId={school!.id}
          canManage={canWrite('school.structure.manage')}
        />
      )}
    </SchoolPage>
  );
}

function Subjects({ schoolId, canManage }: { schoolId: string; canManage: boolean }) {
  const { t, name, fields } = useSchoolText();
  const subjects = useApi<SubjectView[]>(`/school/subjects?schoolId=${schoolId}`);
  const tracks = useApi<{ id: string; name: string; nameAr?: string | null }[]>(
    `/school/tracks?schoolId=${schoolId}`,
  );
  if (subjects.state === 'loading') return <LoadingState />;
  if (subjects.state === 'error') {
    return <ErrorState error={subjects.error} onRetry={subjects.reload} />;
  }
  return (
    <>
      <Card>
        <ul className="divide-y divide-line/70 text-sm" data-testid="subject-list">
          {subjects.data.length === 0 && (
            <li className="px-4 py-6 text-center text-muted">{t('subjects.empty')}</li>
          )}
          {subjects.data.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="w-full min-w-0 font-medium sm:w-auto sm:flex-1">
                <BiName name={s.name} nameAr={s.nameAr} />
              </span>
              {s.isReligious && <Badge tone="savanna">{t('subjects.religious')}</Badge>}
              {s.track && <Badge tone="neutral">{name(s.track)}</Badge>}
              <span className="text-muted">
                {t('subjects.coefficient', { n: Number(s.defaultCoefficient) })}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      {canManage && tracks.state === 'success' && (
        <Card>
          <CardBody>
            <h2 className="mb-3 font-semibold">{t('subjects.new')}</h2>
            <SimpleForm
              testId="subject-form"
              path="/school/subjects"
              extra={{ schoolId }}
              submitLabel={t('subjects.add')}
              onDone={subjects.reload}
              fields={fields([
                { name: 'name', label: t('field.name'), required: true },
                { name: 'nameAr', label: t('field.nameAr'), rtl: true },
                {
                  name: 'trackId',
                  label: t('field.track'),
                  type: 'select',
                  options: [
                    { value: '', label: t('subjects.allTracks') },
                    ...tracks.data.map((tr) => ({ value: tr.id, label: name(tr) })),
                  ],
                },
                {
                  name: 'defaultCoefficient',
                  label: t('field.coefficient'),
                  type: 'number',
                  defaultValue: '1',
                },
                { name: 'isReligious', label: t('subjects.isReligious'), type: 'checkbox' },
              ])}
            />
          </CardBody>
        </Card>
      )}
    </>
  );
}

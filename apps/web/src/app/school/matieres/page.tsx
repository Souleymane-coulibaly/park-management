'use client';

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
  track: { id: string; name: string } | null;
}

export default function MatieresPage() {
  return (
    <SchoolPage
      title="Matières"
      description="Noms bilingues et coefficients. Les matières religieuses ne sont créées que si l’école le choisit."
    >
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
  const subjects = useApi<SubjectView[]>(`/school/subjects?schoolId=${schoolId}`);
  const tracks = useApi<{ id: string; name: string }[]>(`/school/tracks?schoolId=${schoolId}`);
  if (subjects.state === 'loading') return <LoadingState />;
  if (subjects.state === 'error') {
    return <ErrorState error={subjects.error} onRetry={subjects.reload} />;
  }
  return (
    <>
      <Card>
        <ul className="divide-y divide-line/70 text-sm" data-testid="subject-list">
          {subjects.data.length === 0 && (
            <li className="px-4 py-6 text-center text-muted">Aucune matière.</li>
          )}
          {subjects.data.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="w-full min-w-0 font-medium sm:w-auto sm:flex-1">
                <BiName name={s.name} nameAr={s.nameAr} />
              </span>
              {s.isReligious && <Badge tone="savanna">Religieuse</Badge>}
              {s.track && <Badge tone="neutral">{s.track.name}</Badge>}
              <span className="text-muted">Coefficient {Number(s.defaultCoefficient)}</span>
            </li>
          ))}
        </ul>
      </Card>
      {canManage && tracks.state === 'success' && (
        <Card>
          <CardBody>
            <h2 className="mb-3 font-semibold">Nouvelle matière</h2>
            <SimpleForm
              testId="subject-form"
              path="/school/subjects"
              extra={{ schoolId }}
              submitLabel="Ajouter la matière"
              onDone={subjects.reload}
              fields={[
                { name: 'name', label: 'Nom', required: true },
                { name: 'nameAr', label: 'Nom en arabe', rtl: true },
                {
                  name: 'trackId',
                  label: 'Parcours',
                  type: 'select',
                  options: [
                    { value: '', label: 'Tous les parcours' },
                    ...tracks.data.map((t) => ({ value: t.id, label: t.name })),
                  ],
                },
                {
                  name: 'defaultCoefficient',
                  label: 'Coefficient',
                  type: 'number',
                  defaultValue: '1',
                },
                { name: 'isReligious', label: 'Matière religieuse', type: 'checkbox' },
              ]}
            />
          </CardBody>
        </Card>
      )}
    </>
  );
}

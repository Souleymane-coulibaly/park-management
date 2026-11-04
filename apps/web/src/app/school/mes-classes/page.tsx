'use client';

import { SchoolLanguage, useSchoolText } from '@/components/school/school-language';
import { BiName, SchoolPage, type SchoolSummary } from '@/components/school/school-page';
import { AssignmentLine, type AssignmentView } from '@/components/school/school-teaching';
import { Card, CardBody } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

/**
 * Classes et matières confiées à la personne connectée ; chacune ouvre sa fiche de classe. Un enseignant
 * de plusieurs établissements voit chacun dans sa propre langue.
 */
export default function MesClassesPage() {
  return (
    <SchoolPage title="mine.title" description="mine.desc" needsSchool={false}>
      {({ context }) => <Mine schools={context.schools} />}
    </SchoolPage>
  );
}

function Mine({ schools }: { schools: SchoolSummary[] }) {
  const { t } = useSchoolText();
  const mine = useApi<AssignmentView[]>('/school/teaching/mine');
  if (mine.state === 'loading') return <LoadingState />;
  if (mine.state === 'error') return <ErrorState error={mine.error} onRetry={mine.reload} />;
  if (mine.data.length === 0) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-muted" data-testid="my-classes">
            {t('mine.empty')}
          </p>
        </CardBody>
      </Card>
    );
  }
  const bySchool = new Map<string, AssignmentView[]>();
  for (const a of mine.data) {
    bySchool.set(a.class.year.schoolId, [...(bySchool.get(a.class.year.schoolId) ?? []), a]);
  }
  return (
    <div className="space-y-4" data-testid="my-classes">
      {[...bySchool].map(([schoolId, assignments]) => {
        const school = schools.find((s) => s.id === schoolId);
        return (
          <SchoolLanguage key={schoolId} locale={school?.defaultLocale ?? 'FR'}>
            <Card>
              <CardBody>
                {school && bySchool.size > 1 && (
                  <h2 className="font-semibold">
                    <BiName name={school.name} nameAr={school.nameAr} />
                  </h2>
                )}
                <ul className="divide-y divide-line/70">
                  {assignments.map((a) => (
                    <AssignmentLine key={a.id} assignment={a} show="class" />
                  ))}
                </ul>
              </CardBody>
            </Card>
          </SchoolLanguage>
        );
      })}
    </div>
  );
}

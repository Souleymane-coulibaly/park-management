'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useSchoolText } from '@/components/school/school-language';
import { BiName, SchoolPage } from '@/components/school/school-page';
import { type NamedView, useYears } from '@/components/school/school-students';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

interface ClassRow extends NamedView {
  capacity: number | null;
  isActive: boolean;
  enrolled: number;
  level: NamedView;
  track: NamedView | null;
}

export default function ClassesPage() {
  return (
    <SchoolPage title="classes.title" description="classes.desc">
      {({ school }) => <Classes key={school!.id} schoolId={school!.id} />}
    </SchoolPage>
  );
}

function Classes({ schoolId }: { schoolId: string }) {
  const { t, name } = useSchoolText();
  const years = useYears(schoolId);
  const [chosen, setChosen] = useState('');
  const yearId =
    years.state === 'success'
      ? chosen || years.data.find((y) => y.status === 'ACTIVE')?.id || years.data[0]?.id || ''
      : '';
  const classes = useApi<ClassRow[]>(yearId ? `/school/rosters?schoolYearId=${yearId}` : null);
  if (years.state === 'loading') return <LoadingState />;
  if (years.state === 'error') return <ErrorState error={years.error} onRetry={years.reload} />;
  return (
    <>
      <div className="max-w-sm">
        <SelectField
          label={t('field.schoolYear')}
          value={yearId}
          onChange={(e) => setChosen(e.target.value)}
          options={years.data.map((y) => ({ value: y.id, label: y.label }))}
        />
      </div>
      {classes.state === 'loading' && <LoadingState />}
      {classes.state === 'error' && <ErrorState error={classes.error} onRetry={classes.reload} />}
      {classes.state === 'success' && (
        <Card>
          <ul className="divide-y divide-line/70 text-sm" data-testid="class-sheets">
            {classes.data.length === 0 && (
              <li className="px-4 py-6 text-center text-muted">{t('classes.empty')}</li>
            )}
            {classes.data.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/school/classes/${c.id}`}
                  className="flex min-h-11 flex-wrap items-center gap-3 px-4 py-3 hover:bg-ivory"
                  data-testid="class-sheet-row"
                >
                  <span className="min-w-0 flex-1 font-medium">
                    <BiName name={c.name} nameAr={c.nameAr} />
                  </span>
                  <span className="text-muted">{name(c.level)}</span>
                  {!c.isActive && <Badge tone="neutral">{t('classes.archived')}</Badge>}
                  <span className="font-medium" dir="ltr">
                    {c.enrolled}
                    {c.capacity ? ` / ${c.capacity}` : ''}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

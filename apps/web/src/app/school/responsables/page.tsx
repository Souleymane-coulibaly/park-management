'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { SchoolGuardianRelation } from '@ocall/shared';
import { useSchoolText } from '@/components/school/school-language';
import { SchoolPage, type SchoolPageApi } from '@/components/school/school-page';
import { StudentName } from '@/components/school/school-students';
import { Card, CardBody } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { SimpleForm } from '@/components/ui/simple-form';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

interface GuardianRow {
  id: string;
  lastName: string;
  firstName: string;
  phone: string;
  email: string | null;
  links: {
    relation: SchoolGuardianRelation;
    student: {
      id: string;
      schoolId: string;
      matricule: string;
      lastName: string;
      firstName: string;
      lastNameAr: string | null;
      firstNameAr: string | null;
    };
  }[];
}

export default function ResponsablesPage() {
  return (
    <SchoolPage title="guardians.title" description="guardians.desc">
      {(page) => <Guardians key={page.school!.id} page={page} schoolId={page.school!.id} />}
    </SchoolPage>
  );
}

function Guardians({ page, schoolId }: { page: SchoolPageApi; schoolId: string }) {
  const { t, labels } = useSchoolText();
  // Un responsable peut suivre des enfants de plusieurs établissements : chacun dans sa langue.
  const locales = new Map(page.context.schools.map((s) => [s.id, s.defaultLocale]));
  const [q, setQ] = useState('');
  const list = useApi<GuardianRow[]>(
    `/school/guardians?schoolId=${schoolId}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
  );
  return (
    <>
      <Card>
        <CardBody>
          <InputField
            label={t('guardians.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </CardBody>
      </Card>
      {list.state === 'loading' && <LoadingState />}
      {list.state === 'error' && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.state === 'success' && (
        <Card>
          <ul className="divide-y divide-line/70 text-sm" data-testid="guardian-list">
            {list.data.length === 0 && (
              <li className="px-4 py-6 text-center text-muted">{t('guardians.empty')}</li>
            )}
            {list.data.map((g) => (
              <li key={g.id} className="space-y-1 px-4 py-3" data-testid="guardian-row">
                <p className="font-medium" dir="auto">
                  {g.lastName} {g.firstName}
                </p>
                <p className="break-words text-muted">
                  <a href={`tel:${g.phone}`} className="text-forest" dir="ltr">
                    {g.phone}
                  </a>
                  {g.email ? ` · ${g.email}` : ''}
                </p>
                {g.links.length > 0 && (
                  <ul className="flex flex-wrap gap-x-4">
                    {g.links.map((l) => (
                      <li key={l.student.id}>
                        <Link
                          href={`/school/eleves/${l.student.id}`}
                          className="text-forest hover:underline"
                        >
                          <StudentName
                            student={l.student}
                            locale={locales.get(l.student.schoolId)}
                          />
                        </Link>{' '}
                        <span className="text-muted">({labels.guardianRelation[l.relation]})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {page.canWrite('school.guardians.manage') && (
        <Card>
          <CardBody>
            <h2 className="mb-3 font-semibold">{t('guardians.new')}</h2>
            <SimpleForm
              testId="guardian-form"
              path="/school/guardians"
              extra={{ schoolId }}
              submitLabel={t('guardians.create')}
              onDone={list.reload}
              fields={[
                { name: 'lastName', label: t('field.lastName'), required: true },
                { name: 'firstName', label: t('field.firstName'), required: true },
                { name: 'phone', label: t('field.phone'), required: true },
                { name: 'email', label: t('guardians.emailOptional'), type: 'email' },
                { name: 'address', label: t('guardians.addressOptional') },
              ]}
            />
          </CardBody>
        </Card>
      )}
    </>
  );
}

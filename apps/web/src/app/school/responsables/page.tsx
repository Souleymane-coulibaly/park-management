'use client';

import Link from 'next/link';
import { useState } from 'react';
import { SCHOOL_GUARDIAN_RELATION_LABELS, type SchoolGuardianRelation } from '@ocall/shared';
import { SchoolPage, type SchoolPageApi } from '@/components/school/school-page';
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
    student: { id: string; matricule: string; lastName: string; firstName: string };
  }[];
}

export default function ResponsablesPage() {
  return (
    <SchoolPage
      title="Responsables"
      description="Un responsable peut suivre plusieurs enfants. Les autorisations se règlent enfant par enfant, depuis la fiche élève."
    >
      {(page) => <Guardians key={page.school!.id} page={page} schoolId={page.school!.id} />}
    </SchoolPage>
  );
}

function Guardians({ page, schoolId }: { page: SchoolPageApi; schoolId: string }) {
  const [q, setQ] = useState('');
  const list = useApi<GuardianRow[]>(
    `/school/guardians?schoolId=${schoolId}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
  );
  return (
    <>
      <Card>
        <CardBody>
          <InputField
            label="Rechercher par nom ou téléphone"
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
              <li className="px-4 py-6 text-center text-muted">Aucun responsable.</li>
            )}
            {list.data.map((g) => (
              <li key={g.id} className="space-y-1 px-4 py-3" data-testid="guardian-row">
                <p className="font-medium">
                  {g.lastName} {g.firstName}
                </p>
                <p className="break-words text-muted">
                  <a href={`tel:${g.phone}`} className="text-forest">
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
                          {l.student.lastName} {l.student.firstName}
                        </Link>{' '}
                        <span className="text-muted">
                          ({SCHOOL_GUARDIAN_RELATION_LABELS[l.relation]})
                        </span>
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
            <h2 className="mb-3 font-semibold">Nouveau responsable</h2>
            <SimpleForm
              testId="guardian-form"
              path="/school/guardians"
              extra={{ schoolId }}
              submitLabel="Créer le responsable"
              onDone={list.reload}
              fields={[
                { name: 'lastName', label: 'Nom', required: true },
                { name: 'firstName', label: 'Prénom', required: true },
                { name: 'phone', label: 'Téléphone', required: true },
                { name: 'email', label: 'E-mail (facultatif)', type: 'email' },
                { name: 'address', label: 'Adresse (facultative)' },
              ]}
            />
          </CardBody>
        </Card>
      )}
    </>
  );
}

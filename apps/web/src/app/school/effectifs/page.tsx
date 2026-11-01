'use client';

import Link from 'next/link';
import { useState } from 'react';
import { hasSchoolPermission } from '@ocall/shared';
import { SchoolPage, type SchoolPageApi } from '@/components/school/school-page';
import {
  type NamedView,
  StudentName,
  type StudentRow,
  StudentStatusBadge,
  useYears,
} from '@/components/school/school-students';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { SimpleForm } from '@/components/ui/simple-form';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface RosterClass extends NamedView {
  capacity: number | null;
  enrolled: number;
  level: NamedView;
  teachers?: { member: { id: string; firstName: string; lastName: string } }[];
}

export default function EffectifsPage() {
  return (
    <SchoolPage
      title="Classes et effectifs"
      description="Listes de classe, effectifs et enseignants."
    >
      {(page) => <Rosters key={page.school!.id} page={page} schoolId={page.school!.id} />}
    </SchoolPage>
  );
}

function Rosters({ page, schoolId }: { page: SchoolPageApi; schoolId: string }) {
  const years = useYears(schoolId);
  const [chosen, setChosen] = useState('');
  const [classId, setClassId] = useState<string | null>(null);
  if (years.state === 'loading') return <LoadingState />;
  if (years.state === 'error') return <ErrorState error={years.error} onRetry={years.reload} />;
  const yearId =
    chosen || years.data.find((y) => y.status === 'ACTIVE')?.id || years.data[0]?.id || '';
  return (
    <>
      <div className="max-w-sm">
        <SelectField
          label="Année scolaire"
          value={yearId}
          onChange={(e) => {
            setChosen(e.target.value);
            setClassId(null);
          }}
          options={years.data.map((y) => ({ value: y.id, label: y.label }))}
        />
      </div>
      {yearId && (
        <Classes
          key={yearId}
          page={page}
          schoolId={schoolId}
          yearId={yearId}
          classId={classId}
          onSelect={setClassId}
        />
      )}
    </>
  );
}

function Classes({
  page,
  schoolId,
  yearId,
  classId,
  onSelect,
}: {
  page: SchoolPageApi;
  schoolId: string;
  yearId: string;
  classId: string | null;
  onSelect: (id: string) => void;
}) {
  const classes = useApi<RosterClass[]>(`/school/rosters?schoolYearId=${yearId}`);
  if (classes.state === 'loading') return <LoadingState />;
  if (classes.state === 'error') {
    return <ErrorState error={classes.error} onRetry={classes.reload} />;
  }
  const selected = classes.data.find((c) => c.id === classId);
  return (
    <>
      <Card>
        <ul className="divide-y divide-line/70 text-sm" data-testid="class-list">
          {classes.data.length === 0 && (
            <li className="px-4 py-6 text-center text-muted">Aucune classe.</li>
          )}
          {classes.data.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                data-testid="class-row"
                onClick={() => onSelect(c.id)}
                className={`flex min-h-11 w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-ivory ${
                  c.id === classId ? 'bg-ivory' : ''
                }`}
              >
                <span className="min-w-0 flex-1 font-medium">{c.name}</span>
                <span className="text-muted">{c.level.name}</span>
                <span className="font-medium">
                  {c.enrolled}
                  {c.capacity ? ` / ${c.capacity}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {selected && <Roster key={selected.id} page={page} schoolId={schoolId} cls={selected} />}
      {selected && page.canWrite('school.structure.manage') && (
        <Teachers cls={selected} onChange={classes.reload} />
      )}
    </>
  );
}

function Roster({
  page,
  schoolId,
  cls,
}: {
  page: SchoolPageApi;
  schoolId: string;
  cls: RosterClass;
}) {
  const roster = useApi<{
    students: (Omit<StudentRow, 'enrollment' | 'schoolId'> & { enrollmentId: string })[];
  }>(`/school/classes/${cls.id}/students`);
  const canExport = hasSchoolPermission(page.context.role, 'school.students.export');
  if (roster.state === 'loading') return <LoadingState />;
  if (roster.state === 'error') return <ErrorState error={roster.error} onRetry={roster.reload} />;
  return (
    <Card>
      <CardBody>
        <h2 className="font-semibold">Liste de {cls.name}</h2>
        {canExport && (
          <p className="mt-1 flex flex-wrap gap-4 text-sm">
            <a
              className="font-medium text-forest hover:underline"
              href={`/api/v1/school/exports/students?schoolId=${schoolId}&classId=${cls.id}&format=xlsx`}
            >
              Exporter en Excel
            </a>
            <a
              className="font-medium text-forest hover:underline"
              href={`/api/v1/school/exports/students?schoolId=${schoolId}&classId=${cls.id}&format=csv`}
            >
              Exporter en CSV
            </a>
          </p>
        )}
      </CardBody>
      <ul className="divide-y divide-line/70 text-sm" data-testid="roster">
        {roster.data.students.length === 0 && (
          <li className="px-4 py-6 text-center text-muted">Aucun élève dans cette classe.</li>
        )}
        {roster.data.students.map((s) => (
          <li key={s.id}>
            <Link
              href={`/school/eleves/${s.id}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-ivory"
            >
              <span className="w-full min-w-0 font-medium sm:w-auto sm:flex-1">
                <StudentName student={s} />
              </span>
              <span className="text-muted">{s.matricule}</span>
              <StudentStatusBadge status={s.status} />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Teachers({ cls, onChange }: { cls: RosterClass; onChange: () => void }) {
  const members =
    useApi<{ id: string; firstName: string; lastName: string; role: string; isActive: boolean }[]>(
      '/school/members',
    );
  const [error, setError] = useState<ApiError | null>(null);
  const available =
    members.state === 'success'
      ? members.data.filter(
          (m) =>
            m.role === 'TEACHER' && m.isActive && !cls.teachers?.some((t) => t.member.id === m.id),
        )
      : [];
  async function remove(memberId: string) {
    setError(null);
    try {
      await api(`/school/classes/${cls.id}/teachers/${memberId}`, { method: 'DELETE' });
      onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion impossible.'));
    }
  }
  return (
    <Card>
      <CardBody>
        <h2 className="mb-1 font-semibold">Enseignants de {cls.name}</h2>
        <p className="mb-3 text-sm text-muted">
          Un enseignant ne voit que les élèves des classes qui lui sont confiées.
        </p>
        <ApiErrorAlert error={error} />
        <ul className="mb-3 space-y-2 text-sm" data-testid="class-teachers">
          {cls.teachers?.length === 0 && <li className="text-muted">Aucun enseignant.</li>}
          {cls.teachers?.map((t) => (
            <li key={t.member.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {t.member.lastName} {t.member.firstName}
              </span>
              <Button variant="secondary" size="sm" onClick={() => remove(t.member.id)}>
                Retirer
              </Button>
            </li>
          ))}
        </ul>
        {available.length > 0 && (
          <SimpleForm
            key={available.length}
            testId="class-teacher-form"
            path={`/school/classes/${cls.id}/teachers`}
            submitLabel="Confier la classe"
            onDone={onChange}
            fields={[
              {
                name: 'memberId',
                label: 'Enseignant',
                type: 'select',
                options: available.map((m) => ({
                  value: m.id,
                  label: `${m.lastName} ${m.firstName}`,
                })),
              },
            ]}
          />
        )}
      </CardBody>
    </Card>
  );
}

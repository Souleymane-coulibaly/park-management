'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  SCHOOL_STUDENT_STATUSES,
  SCHOOL_STUDENT_STATUS_LABELS,
  hasSchoolPermission,
} from '@ocall/shared';
import { SchoolPage, type SchoolPageApi } from '@/components/school/school-page';
import {
  StudentName,
  type StudentRow,
  StudentStatusBadge,
  useClasses,
  useLevels,
  useYears,
} from '@/components/school/school-students';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

interface Dashboard {
  students: number;
  enrolled: number;
  pending: number;
  recent: number;
  bySchool: { id: string; name: string; count: number }[];
  byLevel: { id: string; name: string; count: number }[];
  byClass: { id: string; name: string; count: number; capacity: number | null }[];
}

interface Page {
  items: StudentRow[];
  total: number;
  page: number;
  pageSize: number;
}

export default function ElevesPage() {
  return (
    <SchoolPage
      title="Élèves"
      description="Dossiers, effectifs et recherche en français ou en arabe."
    >
      {(api) => <Students key={api.school!.id} api={api} schoolId={api.school!.id} />}
    </SchoolPage>
  );
}

function Students({ api, schoolId }: { api: SchoolPageApi; schoolId: string }) {
  const canSeeFigures = hasSchoolPermission(api.context.role, 'school.students.read_full');
  const canExport = hasSchoolPermission(api.context.role, 'school.students.export');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [schoolYearId, setYear] = useState('');
  const [levelId, setLevel] = useState('');
  const [classId, setClass] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  const years = useYears(schoolId);
  const levels = useLevels(schoolId);
  const classes = useClasses(schoolYearId || null);
  const params = new URLSearchParams({ schoolId, page: String(page), pageSize: '25' });
  if (search) params.set('q', search);
  if (status) params.set('status', status);
  if (schoolYearId) params.set('schoolYearId', schoolYearId);
  if (levelId) params.set('levelId', levelId);
  if (classId) params.set('classId', classId);
  const students = useApi<Page>(`/school/students?${params}`);

  return (
    <>
      {canSeeFigures && <Figures schoolId={schoolId} />}
      <Card>
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <InputField
              label="Rechercher"
              placeholder="Nom, اسم, matricule"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <SelectField
              label="Statut"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'Tous' },
                ...SCHOOL_STUDENT_STATUSES.map((s) => ({
                  value: s,
                  label: SCHOOL_STUDENT_STATUS_LABELS[s],
                })),
              ]}
            />
            <SelectField
              label="Année"
              value={schoolYearId}
              onChange={(e) => {
                setYear(e.target.value);
                setClass('');
                setPage(1);
              }}
              options={[
                { value: '', label: 'Toutes' },
                ...(years.state === 'success'
                  ? years.data.map((y) => ({ value: y.id, label: y.label }))
                  : []),
              ]}
            />
            <SelectField
              label="Niveau"
              value={levelId}
              onChange={(e) => {
                setLevel(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'Tous' },
                ...levels.map((l) => ({ value: l.id, label: l.name })),
              ]}
            />
            <SelectField
              label="Classe"
              value={classId}
              onChange={(e) => {
                setClass(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: schoolYearId ? 'Toutes' : 'Choisissez une année' },
                ...classes.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
          </div>
          {canExport && (
            <p className="mt-3 flex flex-wrap gap-4 text-sm">
              <a
                className="font-medium text-forest hover:underline"
                href={`/api/v1/school/exports/students?schoolId=${schoolId}&format=xlsx`}
              >
                Exporter en Excel
              </a>
              <a
                className="font-medium text-forest hover:underline"
                href={`/api/v1/school/exports/students?schoolId=${schoolId}&format=csv`}
              >
                Exporter en CSV
              </a>
            </p>
          )}
        </CardBody>
      </Card>

      {students.state === 'loading' && <LoadingState />}
      {students.state === 'error' && (
        <ErrorState error={students.error} onRetry={students.reload} />
      )}
      {students.state === 'success' && (
        <Card>
          <ul className="divide-y divide-line/70 text-sm" data-testid="student-list">
            {students.data.items.length === 0 && (
              <li className="px-4 py-6 text-center text-muted">Aucun élève.</li>
            )}
            {students.data.items.map((s) => (
              <li key={s.id} data-testid="student-row">
                <Link
                  href={`/school/eleves/${s.id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-ivory"
                >
                  <span className="w-full min-w-0 font-medium sm:w-auto sm:flex-1">
                    <StudentName student={s} />
                  </span>
                  <span className="text-muted">{s.matricule}</span>
                  <span>{s.enrollment?.class?.name ?? s.enrollment?.level.name ?? '—'}</span>
                  <StudentStatusBadge status={s.status} />
                </Link>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-3 border-t border-line/70 px-4 py-3 text-sm">
            <span className="text-muted">
              {students.data.total} élève{students.data.total > 1 ? 's' : ''}
            </span>
            <span className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Précédent
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page * students.data.pageSize >= students.data.total}
                onClick={() => setPage(page + 1)}
              >
                Suivant
              </Button>
            </span>
          </div>
        </Card>
      )}
    </>
  );
}

function Figures({ schoolId }: { schoolId: string }) {
  const dash = useApi<Dashboard>(`/school/students/dashboard?schoolId=${schoolId}`);
  if (dash.state !== 'success') return null;
  const { students, enrolled, pending, recent, byLevel, byClass } = dash.data;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="student-figures">
        <Tile label="Élèves inscrits" value={enrolled} />
        <Tile label="En attente" value={pending} />
        <Tile label="Nouvelles inscriptions (30 jours)" value={recent} />
        <Tile label="Dossiers" value={students} />
      </div>
      {(byLevel.length > 0 || byClass.length > 0) && (
        <div className="grid gap-3 md:grid-cols-2">
          <Breakdown title="Par niveau" rows={byLevel} />
          <Breakdown title="Par classe" rows={byClass} />
        </div>
      )}
    </>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardBody>
        <p className="text-2xl font-semibold">{value}</p>
        <p className="text-sm text-muted">{label}</p>
      </CardBody>
    </Card>
  );
}

function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: { id: string; name: string; count: number; capacity?: number | null }[];
}) {
  return (
    <Card>
      <CardBody>
        <h2 className="mb-2 font-semibold">{title}</h2>
        <ul className="space-y-1 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex justify-between gap-3">
              <span className="min-w-0 break-words">{r.name}</span>
              <span className="shrink-0 font-medium">
                {r.count}
                {r.capacity ? ` / ${r.capacity}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

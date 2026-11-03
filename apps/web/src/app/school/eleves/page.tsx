'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SCHOOL_STUDENT_STATUSES, hasSchoolPermission } from '@ocall/shared';
import { useSchoolText } from '@/components/school/school-language';
import { SchoolPage, type SchoolPageApi } from '@/components/school/school-page';
import {
  Pager,
  StudentName,
  type StudentRow,
  StudentStatusBadge,
  useClasses,
  useLevels,
  useYears,
} from '@/components/school/school-students';
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
  byLevel: { id: string; name: string; nameAr?: string | null; count: number }[];
  byClass: {
    id: string;
    name: string;
    nameAr?: string | null;
    count: number;
    capacity: number | null;
  }[];
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
      title="students.title"
      description={(text) => text.t(text.showArabic ? 'students.descBilingual' : 'students.desc')}
    >
      {(api) => <Students key={api.school!.id} api={api} schoolId={api.school!.id} />}
    </SchoolPage>
  );
}

function Students({ api, schoolId }: { api: SchoolPageApi; schoolId: string }) {
  const { t, labels, name, showArabic } = useSchoolText();
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
              label={t('field.search')}
              placeholder={t(
                showArabic ? 'students.searchPlaceholderBilingual' : 'students.searchPlaceholder',
              )}
              dir="auto"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <SelectField
              label={t('field.status')}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: t('common.all') },
                ...SCHOOL_STUDENT_STATUSES.map((s) => ({
                  value: s,
                  label: labels.studentStatus[s],
                })),
              ]}
            />
            <SelectField
              label={t('field.year')}
              value={schoolYearId}
              onChange={(e) => {
                setYear(e.target.value);
                setClass('');
                setPage(1);
              }}
              options={[
                { value: '', label: t('common.allFeminine') },
                ...(years.state === 'success'
                  ? years.data.map((y) => ({ value: y.id, label: y.label }))
                  : []),
              ]}
            />
            <SelectField
              label={t('field.level')}
              value={levelId}
              onChange={(e) => {
                setLevel(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: t('common.all') },
                ...levels.map((l) => ({ value: l.id, label: name(l) })),
              ]}
            />
            <SelectField
              label={t('field.class')}
              value={classId}
              onChange={(e) => {
                setClass(e.target.value);
                setPage(1);
              }}
              options={[
                {
                  value: '',
                  label: schoolYearId ? t('common.allFeminine') : t('students.pickYear'),
                },
                ...classes.map((c) => ({ value: c.id, label: name(c) })),
              ]}
            />
          </div>
          {canExport && (
            <p className="mt-3 flex flex-wrap gap-4 text-sm">
              <a
                className="font-medium text-forest hover:underline"
                href={`/api/v1/school/exports/students?schoolId=${schoolId}&format=xlsx`}
              >
                {t('common.exportExcel')}
              </a>
              <a
                className="font-medium text-forest hover:underline"
                href={`/api/v1/school/exports/students?schoolId=${schoolId}&format=csv`}
              >
                {t('common.exportCsv')}
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
              <li className="px-4 py-6 text-center text-muted">{t('students.empty')}</li>
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
                  <span className="text-muted" dir="ltr">
                    {s.matricule}
                  </span>
                  <span>
                    {s.enrollment?.class
                      ? name(s.enrollment.class)
                      : s.enrollment
                        ? name(s.enrollment.level)
                        : '—'}
                  </span>
                  <StudentStatusBadge status={s.status} />
                </Link>
              </li>
            ))}
          </ul>
          <Pager
            total={students.data.total}
            page={page}
            pageSize={students.data.pageSize}
            label={(n) => t('students.count', { n })}
            onPage={setPage}
          />
        </Card>
      )}
    </>
  );
}

function Figures({ schoolId }: { schoolId: string }) {
  const { t } = useSchoolText();
  const dash = useApi<Dashboard>(`/school/students/dashboard?schoolId=${schoolId}`);
  if (dash.state !== 'success') return null;
  const { students, enrolled, pending, recent, byLevel, byClass } = dash.data;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="student-figures">
        <Tile label={t('students.enrolled')} value={enrolled} />
        <Tile label={t('students.pending')} value={pending} />
        <Tile label={t('students.recent')} value={recent} />
        <Tile label={t('students.files')} value={students} />
      </div>
      {(byLevel.length > 0 || byClass.length > 0) && (
        <div className="grid gap-3 md:grid-cols-2">
          <Breakdown title={t('students.byLevel')} rows={byLevel} />
          <Breakdown title={t('students.byClass')} rows={byClass} />
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
  rows: {
    id: string;
    name: string;
    nameAr?: string | null;
    count: number;
    capacity?: number | null;
  }[];
}) {
  const { name } = useSchoolText();
  return (
    <Card>
      <CardBody>
        <h2 className="mb-2 font-semibold">{title}</h2>
        <ul className="space-y-1 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex justify-between gap-3">
              <span className="min-w-0 break-words">{name(r)}</span>
              <span className="shrink-0 font-medium" dir="ltr">
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

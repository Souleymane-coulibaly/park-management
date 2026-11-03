'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  SCHOOL_ENROLLMENT_STATUSES,
  SCHOOL_SEXES,
  canTransitionEnrollment,
  type SchoolEnrollmentStatus,
} from '@ocall/shared';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { SchoolPage, type SchoolPageApi } from '@/components/school/school-page';
import {
  type NamedView,
  Pager,
  StudentName,
  type StudentRow,
  useClasses,
  useLevels,
  useYears,
} from '@/components/school/school-students';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { SimpleForm } from '@/components/ui/simple-form';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface EnrollmentRow {
  id: string;
  status: SchoolEnrollmentStatus;
  kind: 'NEW' | 'RENEWAL' | 'TRANSFER_IN';
  year: { id: string; label: string };
  level: NamedView;
  class: NamedView | null;
  student: Pick<
    StudentRow,
    'id' | 'matricule' | 'lastName' | 'firstName' | 'lastNameAr' | 'firstNameAr'
  >;
}

type PickedStudent = EnrollmentRow['student'];

export default function InscriptionsPage() {
  return (
    <SchoolPage title="enroll.title" description="enroll.desc">
      {(page) => <Enrollments key={page.school!.id} page={page} schoolId={page.school!.id} />}
    </SchoolPage>
  );
}

function Enrollments({ page, schoolId }: { page: SchoolPageApi; schoolId: string }) {
  const { t, labels, name } = useSchoolText();
  const [status, setStatus] = useState<string>('PENDING');
  const [pageNumber, setPageNumber] = useState(1);
  const [error, setError] = useState<ApiError | null>(null);
  const list = useApi<{ items: EnrollmentRow[]; total: number; page: number; pageSize: number }>(
    `/school/enrollments?schoolId=${schoolId}&page=${pageNumber}${status ? `&status=${status}` : ''}`,
  );
  const canManage = page.canWrite('school.enrollments.manage');
  const canValidate = page.canWrite('school.enrollments.validate');

  async function change(id: string, to: SchoolEnrollmentStatus) {
    setError(null);
    try {
      await api(`/school/enrollments/${id}/status`, { method: 'POST', body: { status: to } });
      list.reload();
    } catch (e) {
      setError(toApiError(e));
    }
  }

  return (
    <>
      {canManage && <NewEnrollment schoolId={schoolId} onDone={list.reload} />}
      <Card>
        <CardBody>
          <div className="max-w-xs">
            <SelectField
              label={t('field.status')}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPageNumber(1);
              }}
              options={[
                { value: '', label: t('common.all') },
                ...SCHOOL_ENROLLMENT_STATUSES.map((s) => ({
                  value: s,
                  label: labels.enrollmentStatus[s],
                })),
              ]}
            />
          </div>
        </CardBody>
      </Card>
      <ApiErrorAlert error={error} />
      {list.state === 'loading' && <LoadingState />}
      {list.state === 'error' && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.state === 'success' && (
        <Card>
          <ul className="divide-y divide-line/70 text-sm" data-testid="enrollment-queue">
            {list.data.items.length === 0 && (
              <li className="px-4 py-6 text-center text-muted">{t('enroll.empty')}</li>
            )}
            {list.data.items.map((e) => (
              <li key={e.id} className="space-y-2 px-4 py-3" data-testid="enrollment-row">
                <p className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/school/eleves/${e.student.id}`}
                    className="font-medium hover:underline"
                  >
                    <StudentName student={e.student} />
                  </Link>
                  <Badge tone={e.status === 'VALIDATED' ? 'forest' : 'neutral'}>
                    {labels.enrollmentStatus[e.status]}
                  </Badge>
                </p>
                <p className="text-muted">
                  <span dir="ltr">{e.student.matricule}</span> · {e.year.label} ·{' '}
                  {e.class ? name(e.class) : name(e.level)} · {t(`enroll.kind.${e.kind}`)}
                </p>
                <div className="flex flex-wrap gap-2">
                  {canManage && canTransitionEnrollment(e.status, 'PENDING') && (
                    <Button size="sm" onClick={() => change(e.id, 'PENDING')}>
                      {t('enroll.submit')}
                    </Button>
                  )}
                  {canValidate && canTransitionEnrollment(e.status, 'VALIDATED') && (
                    <Button size="sm" onClick={() => change(e.id, 'VALIDATED')}>
                      {t('enroll.validate')}
                    </Button>
                  )}
                  {canManage &&
                    e.status !== 'VALIDATED' &&
                    canTransitionEnrollment(e.status, 'CANCELLED') && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => change(e.id, 'CANCELLED')}
                      >
                        {t('common.cancel')}
                      </Button>
                    )}
                </div>
              </li>
            ))}
          </ul>
          <Pager
            total={list.data.total}
            page={pageNumber}
            pageSize={list.data.pageSize}
            label={(n) => t('enroll.count', { n })}
            onPage={setPageNumber}
          />
        </Card>
      )}
    </>
  );
}

/** Nouvelle inscription : dossier d'abord, ou recherche d'un élève existant pour une réinscription. */
function NewEnrollment({ schoolId, onDone }: { schoolId: string; onDone: () => void }) {
  const { t, labels, fields } = useSchoolText();
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [student, setStudent] = useState<PickedStudent | null>(null);
  return (
    <Card>
      <CardBody>
        <h2 className="mb-3 font-semibold">{t('enroll.new')}</h2>
        {student ? (
          <Placement
            schoolId={schoolId}
            student={student}
            onDone={() => {
              setStudent(null);
              onDone();
            }}
          />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={mode === 'new' ? 'primary' : 'secondary'}
                onClick={() => setMode('new')}
              >
                {t('enroll.newStudent')}
              </Button>
              <Button
                size="sm"
                variant={mode === 'existing' ? 'primary' : 'secondary'}
                onClick={() => setMode('existing')}
              >
                {t('enroll.renewal')}
              </Button>
            </div>
            {mode === 'new' ? (
              <SimpleForm<PickedStudent>
                testId="new-student-form"
                path="/school/students"
                extra={{ schoolId }}
                submitLabel={t('enroll.createAndContinue')}
                onDone={setStudent}
                fields={fields([
                  { name: 'lastName', label: t('field.lastName'), required: true },
                  { name: 'firstName', label: t('field.firstName'), required: true },
                  { name: 'lastNameAr', label: t('field.lastNameAr'), rtl: true },
                  { name: 'firstNameAr', label: t('field.firstNameAr'), rtl: true },
                  {
                    name: 'birthDate',
                    label: t('field.birthDate'),
                    type: 'date',
                    required: true,
                  },
                  { name: 'birthPlace', label: t('field.birthPlace') },
                  {
                    name: 'sex',
                    label: t('field.sex'),
                    type: 'select',
                    options: [
                      { value: '', label: t('field.notSpecified') },
                      ...SCHOOL_SEXES.map((v) => ({ value: v, label: labels.sex[v] })),
                    ],
                  },
                  { name: 'address', label: t('field.address') },
                  { name: 'matricule', label: t('enroll.existingMatricule') },
                  { name: 'confirmHomonym', label: t('enroll.homonym'), type: 'checkbox' },
                ])}
              />
            ) : (
              <FindStudent schoolId={schoolId} onPick={setStudent} />
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function FindStudent({
  schoolId,
  onPick,
}: {
  schoolId: string;
  onPick: (student: StudentRow) => void;
}) {
  const { t, showArabic } = useSchoolText();
  const [q, setQ] = useState('');
  const found = useApi<{ items: StudentRow[] }>(
    q.length >= 2
      ? `/school/students?schoolId=${schoolId}&pageSize=10&q=${encodeURIComponent(q)}`
      : null,
  );
  return (
    <>
      <InputField
        label={t('enroll.findStudent')}
        placeholder={t(
          showArabic ? 'students.searchPlaceholderBilingual' : 'students.searchPlaceholder',
        )}
        dir="auto"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {q.length >= 2 && found.state === 'success' && (
        <ul className="mt-2 divide-y divide-line/70 text-sm" data-testid="student-results">
          {found.data.items.length === 0 && (
            <li className="py-2 text-muted">{t('enroll.notFound')}</li>
          )}
          {found.data.items.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="min-h-11 w-full py-2 text-start hover:bg-ivory"
                onClick={() => onPick(s)}
              >
                <StudentName student={s} />{' '}
                <span className="text-muted" dir="ltr">
                  {s.matricule}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Placement({
  schoolId,
  student,
  onDone,
}: {
  schoolId: string;
  student: PickedStudent;
  onDone: () => void;
}) {
  const { t, name } = useSchoolText();
  const years = useYears(schoolId);
  const levels = useLevels(schoolId);
  const open = years.state === 'success' ? years.data.filter((y) => y.status !== 'CLOSED') : [];
  const [yearId, setYearId] = useState('');
  const schoolYearId = yearId || open[0]?.id || '';
  const classes = useClasses(schoolYearId || null);
  const tracks = useApi<NamedView[]>(`/school/tracks?schoolId=${schoolId}`);
  if (years.state === 'loading') return <LoadingState />;
  if (open.length === 0 || levels.length === 0) {
    return (
      <Alert tone="info" title={t('enroll.prepareTitle')}>
        {t('enroll.prepare')}
      </Alert>
    );
  }
  return (
    <>
      <p className="mb-3 text-sm">
        <span className="font-medium">
          <StudentName student={student} />
        </span>{' '}
        <span className="text-muted" data-testid="placement-matricule" dir="ltr">
          {student.matricule}
        </span>
      </p>
      <div className="mb-3 max-w-sm">
        <SelectField
          label={t('field.schoolYear')}
          value={schoolYearId}
          onChange={(e) => setYearId(e.target.value)}
          options={open.map((y) => ({ value: y.id, label: y.label }))}
        />
      </div>
      <SimpleForm
        key={`${schoolYearId}-${classes.length}`}
        testId="placement-form"
        path="/school/enrollments"
        extra={{ studentId: student.id, schoolYearId, submit: true }}
        submitLabel={t('enroll.submitEnrollment')}
        onDone={onDone}
        fields={[
          {
            name: 'levelId',
            label: t('field.level'),
            type: 'select',
            options: levels.map((l) => ({
              value: l.id,
              label: `${name({ name: l.cycleName, nameAr: l.cycleNameAr })} : ${name(l)}`,
            })),
          },
          {
            name: 'classId',
            label: t('field.class'),
            type: 'select',
            options: [
              { value: '', label: t('enroll.toDefine') },
              ...classes.map((c) => ({ value: c.id, label: `${name(c)} (${name(c.level)})` })),
            ],
          },
          {
            name: 'trackId',
            label: t('field.track'),
            type: 'select',
            options: [
              { value: '', label: t('enroll.unspecified') },
              ...(tracks.state === 'success'
                ? tracks.data.map((tr) => ({ value: tr.id, label: name(tr) }))
                : []),
            ],
          },
        ]}
      />
      <p className="mt-3 text-sm text-muted">
        {t('enroll.before')}{' '}
        <Link href={`/school/eleves/${student.id}`} className="text-forest hover:underline">
          {t('enroll.sheetLink')}
        </Link>
        .
      </p>
    </>
  );
}

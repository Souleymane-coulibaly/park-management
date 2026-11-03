'use client';

import { useParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import {
  SCHOOL_DOCUMENT_CATEGORIES,
  SCHOOL_EXIT_REASONS,
  SCHOOL_GUARDIAN_RELATIONS,
  SCHOOL_SEXES,
  type SchoolTextKey,
  hasSchoolPermission,
  schoolDisplayName,
  type SchoolDocumentCategory,
  type SchoolEnrollmentStatus,
  type SchoolGuardianRelation,
  type SchoolSex,
} from '@ocall/shared';
import { SchoolLanguage, toApiError, useSchoolText } from '@/components/school/school-language';
import { SchoolPage, type SchoolPageApi } from '@/components/school/school-page';
import {
  Fact,
  type NamedView,
  StudentName,
  type StudentRow,
  StudentStatusBadge,
  useClasses,
} from '@/components/school/school-students';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { SimpleForm } from '@/components/ui/simple-form';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api, apiUpload } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface StudentFull extends StudentRow {
  birthDate?: string;
  birthPlace?: string | null;
  sex?: SchoolSex | null;
  nationality?: string | null;
  address?: string | null;
  adminNotes?: string | null;
}

const TABS = [
  { key: 'identity', permission: null },
  { key: 'schooling', permission: 'school.students.read_full' },
  { key: 'guardians', permission: 'school.guardians.read' },
  { key: 'documents', permission: 'school.documents.read' },
  { key: 'history', permission: 'school.students.read_full' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export default function FicheElevePage() {
  const { id } = useParams<{ id: string }>();
  return (
    // Sans titre de cadre : l'en-tête est rendu dans la langue de l'établissement de l'élève.
    <SchoolPage needsSchool={false}>{(page) => <Sheet id={id} page={page} />}</SchoolPage>
  );
}

function Sheet({ id, page }: { id: string; page: SchoolPageApi }) {
  const student = useApi<StudentFull>(`/school/students/${id}`);
  if (student.state === 'loading') return <LoadingState />;
  if (student.state === 'error') {
    return <ErrorState error={student.error} onRetry={student.reload} />;
  }
  // La fiche suit la langue de l'établissement de l'élève, pas celle de l'établissement choisi.
  const locale =
    page.context.schools.find((s) => s.id === student.data.schoolId)?.defaultLocale ?? 'FR';
  return (
    <SchoolLanguage locale={locale} className="space-y-4">
      <SheetContent student={student.data} page={page} reload={student.reload} />
    </SchoolLanguage>
  );
}

function SheetContent({
  student: s,
  page,
  reload,
}: {
  student: StudentFull;
  page: SchoolPageApi;
  reload: () => void;
}) {
  const { t } = useSchoolText();
  const [tab, setTab] = useState<TabKey>('identity');
  const tabs = TABS.filter(
    (tb) => !tb.permission || hasSchoolPermission(page.context.role, tb.permission),
  );
  return (
    <>
      <PageHeader eyebrow={t('common.eyebrow')} title={t('sheet.title')} />
      <Card>
        <CardBody>
          <p className="text-lg font-semibold" data-testid="student-name">
            <StudentName student={s} />
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted">
            <span data-testid="student-matricule" dir="ltr">
              {s.matricule}
            </span>
            <StudentStatusBadge status={s.status} />
          </p>
        </CardBody>
      </Card>
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            type="button"
            role="tab"
            aria-selected={tab === tb.key}
            onClick={() => setTab(tb.key)}
            className={`min-h-11 whitespace-nowrap px-3 text-sm font-medium ${
              tab === tb.key ? 'border-b-2 border-forest text-forest' : 'text-muted'
            }`}
          >
            {t(`sheet.tab.${tb.key}`)}
          </button>
        ))}
      </div>
      {tab === 'identity' && <Identity student={s} page={page} reload={reload} />}
      {tab === 'schooling' && <Schooling student={s} page={page} reload={reload} />}
      {tab === 'guardians' && <Guardians student={s} page={page} />}
      {tab === 'documents' && <Documents student={s} page={page} />}
      {tab === 'history' && <History studentId={s.id} />}
    </>
  );
}

function Identity({
  student: s,
  page,
  reload,
}: {
  student: StudentFull;
  page: SchoolPageApi;
  reload: () => void;
}) {
  const { t, labels, date, fields, showArabic } = useSchoolText();
  const [editing, setEditing] = useState(false);
  const full = s.birthDate !== undefined;
  const canEdit = page.canWrite('school.students.manage');
  return (
    <>
      <Card>
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label={t('field.lastName')}>{s.lastName}</Fact>
            <Fact label={t('field.firstName')}>{s.firstName}</Fact>
            {showArabic && (
              <>
                <Fact label={t('field.lastNameAr')}>
                  {s.lastNameAr && (
                    <span dir="rtl" lang="ar">
                      {s.lastNameAr}
                    </span>
                  )}
                </Fact>
                <Fact label={t('field.firstNameAr')}>
                  {s.firstNameAr && (
                    <span dir="rtl" lang="ar">
                      {s.firstNameAr}
                    </span>
                  )}
                </Fact>
              </>
            )}
            {full && (
              <>
                <Fact label={t('field.birthDate')}>{s.birthDate && date(s.birthDate)}</Fact>
                <Fact label={t('field.birthPlace')}>{s.birthPlace}</Fact>
                <Fact label={t('field.sex')}>{s.sex && labels.sex[s.sex]}</Fact>
                <Fact label={t('field.nationality')}>{s.nationality}</Fact>
                <Fact label={t('field.address')}>{s.address}</Fact>
                <Fact label={t('sheet.adminNotes')}>{s.adminNotes}</Fact>
              </>
            )}
          </dl>
          {canEdit && (
            <Button
              className="mt-4"
              variant="secondary"
              size="sm"
              onClick={() => setEditing(!editing)}
            >
              {editing ? t('common.close') : t('common.edit')}
            </Button>
          )}
        </CardBody>
      </Card>
      {editing && (
        <Card>
          <CardBody>
            <SimpleForm
              key={s.lastName + s.firstName}
              testId="student-edit"
              method="PATCH"
              sendEmpty
              path={`/school/students/${s.id}`}
              submitLabel={t('common.save')}
              onDone={() => {
                setEditing(false);
                reload();
              }}
              // Établissement francophone : les champs arabes ne sont ni affichés ni envoyés, donc
              // jamais effacés. Les noms arabes déjà saisis restent intacts.
              fields={fields([
                {
                  name: 'lastName',
                  label: t('field.lastName'),
                  required: true,
                  defaultValue: s.lastName,
                },
                {
                  name: 'firstName',
                  label: t('field.firstName'),
                  required: true,
                  defaultValue: s.firstName,
                },
                {
                  name: 'lastNameAr',
                  label: t('field.lastNameAr'),
                  rtl: true,
                  defaultValue: s.lastNameAr ?? '',
                },
                {
                  name: 'firstNameAr',
                  label: t('field.firstNameAr'),
                  rtl: true,
                  defaultValue: s.firstNameAr ?? '',
                },
                {
                  name: 'birthDate',
                  label: t('field.birthDate'),
                  type: 'date',
                  required: true,
                  defaultValue: s.birthDate,
                },
                {
                  name: 'birthPlace',
                  label: t('field.birthPlace'),
                  defaultValue: s.birthPlace ?? '',
                },
                {
                  name: 'sex',
                  label: t('field.sex'),
                  type: 'select',
                  defaultValue: s.sex ?? '',
                  options: [
                    { value: '', label: t('field.notSpecified') },
                    ...SCHOOL_SEXES.map((v) => ({ value: v, label: labels.sex[v] })),
                  ],
                },
                {
                  name: 'nationality',
                  label: t('field.nationality'),
                  defaultValue: s.nationality ?? '',
                },
                { name: 'address', label: t('field.address'), defaultValue: s.address ?? '' },
                {
                  name: 'adminNotes',
                  label: t('sheet.adminNotes'),
                  defaultValue: s.adminNotes ?? '',
                },
              ])}
            />
          </CardBody>
        </Card>
      )}
      {hasSchoolPermission(page.context.role, 'school.students.sensitive') && (
        <Sensitive studentId={s.id} canEdit={page.canWrite('school.students.sensitive')} />
      )}
      {page.canWrite('school.students.matricule_correct') && (
        <Card>
          <CardBody>
            <h2 className="mb-1 font-semibold">{t('sheet.fixMatricule')}</h2>
            <p className="mb-3 text-sm text-muted">{t('sheet.fixMatriculeHint')}</p>
            <SimpleForm
              testId="matricule-form"
              path={`/school/students/${s.id}/matricule`}
              submitLabel={t('sheet.fix')}
              onDone={reload}
              fields={[
                { name: 'matricule', label: t('sheet.newMatricule'), required: true },
                { name: 'reason', label: t('field.reason'), required: true },
              ]}
            />
          </CardBody>
        </Card>
      )}
    </>
  );
}

/** Rien n'est chargé, ni journalisé, tant que la direction ne demande pas l'affichage. */
function Sensitive({ studentId, canEdit }: { studentId: string; canEdit: boolean }) {
  const { t } = useSchoolText();
  const [shown, setShown] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const path = `/school/students/${studentId}/sensitive`;
  async function show() {
    setError(null);
    try {
      const res = await api<{ specialNeeds: string | null }>(path);
      setShown(res.specialNeeds);
      setDraft(res.specialNeeds ?? '');
    } catch (e) {
      setError(toApiError(e));
    }
  }
  async function save() {
    setError(null);
    try {
      await api(path, { method: 'PUT', body: { specialNeeds: draft } });
      setShown(draft || null);
    } catch (e) {
      setError(toApiError(e));
    }
  }
  return (
    <Card>
      <CardBody>
        <h2 className="mb-1 font-semibold">{t('sheet.sensitive')}</h2>
        <p className="mb-3 text-sm text-muted">{t('sheet.sensitiveHint')}</p>
        <ApiErrorAlert error={error} />
        {shown === undefined ? (
          <Button variant="secondary" size="sm" onClick={show}>
            {t('sheet.show')}
          </Button>
        ) : canEdit ? (
          <div className="space-y-2">
            <InputField
              label={t('sheet.needs')}
              dir="auto"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <Button size="sm" onClick={save}>
              {t('common.save')}
            </Button>
          </div>
        ) : (
          <p className="text-sm" dir="auto">
            {shown || t('sheet.noNeeds')}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

interface EnrollmentRow {
  id: string;
  schoolYearId: string;
  status: SchoolEnrollmentStatus;
  kind: 'NEW' | 'RENEWAL' | 'TRANSFER_IN';
  exitReason: 'TRANSFERRED' | 'LEFT' | 'DROPPED_OUT' | null;
  exitedOn: string | null;
  year: { id: string; label: string };
  level: NamedView;
  track: NamedView | null;
  class: NamedView | null;
}

function Schooling({
  student,
  page,
  reload,
}: {
  student: StudentFull;
  page: SchoolPageApi;
  reload: () => void;
}) {
  const { t, labels, name, date } = useSchoolText();
  const enrollments = useApi<EnrollmentRow[]>(`/school/students/${student.id}/enrollments`);
  if (enrollments.state === 'loading') return <LoadingState />;
  if (enrollments.state === 'error') {
    return <ErrorState error={enrollments.error} onRetry={enrollments.reload} />;
  }
  const refresh = () => {
    enrollments.reload();
    reload();
  };
  const active = enrollments.data.find((e) => e.status === 'VALIDATED');
  return (
    <>
      <Card>
        <ul className="divide-y divide-line/70 text-sm" data-testid="enrollment-list">
          {enrollments.data.length === 0 && (
            <li className="px-4 py-6 text-center text-muted">{t('sheet.noEnrollment')}</li>
          )}
          {enrollments.data.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="font-medium">{e.year.label}</span>
              <span>{e.class ? name(e.class) : name(e.level)}</span>
              {e.track && <span className="text-muted">{name(e.track)}</span>}
              <Badge tone={e.status === 'VALIDATED' ? 'forest' : 'neutral'}>
                {labels.enrollmentStatus[e.status]}
              </Badge>
              {e.exitReason && (
                <span className="text-muted">
                  {labels.exitReason[e.exitReason]}
                  {e.exitedOn ? `, ${date(e.exitedOn)}` : ''}
                </span>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {active && page.canWrite('school.enrollments.manage') && (
        <ChangeClass enrollment={active} onDone={refresh} />
      )}
      {active && page.canWrite('school.enrollments.validate') && (
        <Card>
          <CardBody>
            <h2 className="mb-3 font-semibold">{t('sheet.exitTitle')}</h2>
            <SimpleForm
              testId="exit-form"
              path={`/school/enrollments/${active.id}/exit`}
              submitLabel={t('sheet.exitSave')}
              onDone={refresh}
              fields={[
                {
                  name: 'reason',
                  label: t('field.reason'),
                  type: 'select',
                  options: SCHOOL_EXIT_REASONS.map((r) => ({
                    value: r,
                    label: labels.exitReason[r],
                  })),
                },
                { name: 'exitedOn', label: t('field.date'), type: 'date', required: true },
                { name: 'note', label: t('sheet.precision') },
              ]}
            />
          </CardBody>
        </Card>
      )}
      {page.canWrite('school.students.transfer') && page.context.schools.length > 1 && (
        <Transfer student={student} page={page} onDone={refresh} />
      )}
    </>
  );
}

function ChangeClass({ enrollment, onDone }: { enrollment: EnrollmentRow; onDone: () => void }) {
  const { t, name } = useSchoolText();
  const classes = useClasses(enrollment.schoolYearId);
  return (
    <Card>
      <CardBody>
        <h2 className="mb-3 font-semibold">{t('sheet.changeClass')}</h2>
        {classes.length > 0 && (
          <SimpleForm
            key={enrollment.class?.id}
            testId="change-class-form"
            path={`/school/enrollments/${enrollment.id}/class`}
            submitLabel={t('sheet.changeClass')}
            onDone={onDone}
            fields={[
              {
                name: 'classId',
                label: t('sheet.newClass'),
                type: 'select',
                options: classes
                  .filter((c) => c.id !== enrollment.class?.id)
                  .map((c) => ({ value: c.id, label: name(c) })),
              },
              { name: 'reason', label: t('field.reason') },
            ]}
          />
        )}
      </CardBody>
    </Card>
  );
}

/** Le dossier change d'établissement ; une nouvelle inscription y attend la validation. */
function Transfer({
  student,
  page,
  onDone,
}: {
  student: StudentFull;
  page: SchoolPageApi;
  onDone: () => void;
}) {
  const { t } = useSchoolText();
  const targets = page.context.schools.filter((s) => s.id !== student.schoolId);
  const [targetSchoolId, setTarget] = useState(targets[0]?.id ?? '');
  // Destination et ses niveaux nommés selon la langue de la destination, pas celle de l'élève.
  const targetLocale = targets.find((s) => s.id === targetSchoolId)?.defaultLocale ?? 'FR';
  const years = useApi<{ id: string; label: string; status: string }[]>(
    targetSchoolId ? `/school/years?schoolId=${targetSchoolId}` : null,
  );
  const cycles = useApi<{ levels: NamedView[] }[]>(
    targetSchoolId ? `/school/cycles?schoolId=${targetSchoolId}` : null,
  );
  if (targets.length === 0) return null;
  const openYears =
    years.state === 'success' ? years.data.filter((y) => y.status !== 'CLOSED') : [];
  const levels = cycles.state === 'success' ? cycles.data.flatMap((c) => c.levels) : [];
  return (
    <Card>
      <CardBody>
        <h2 className="mb-3 font-semibold">{t('sheet.transferTitle')}</h2>
        <div className="mb-3 max-w-sm">
          <SelectField
            label={t('sheet.targetSchool')}
            value={targetSchoolId}
            onChange={(e) => setTarget(e.target.value)}
            options={targets.map((s) => ({
              value: s.id,
              label: schoolDisplayName(s.defaultLocale, s),
            }))}
          />
        </div>
        {openYears.length === 0 || levels.length === 0 ? (
          <Alert tone="info" title={t('enroll.prepareTitle')}>
            {t('sheet.targetPrepare')}
          </Alert>
        ) : (
          <SimpleForm
            key={targetSchoolId}
            testId="transfer-form"
            path={`/school/students/${student.id}/transfer`}
            extra={{ targetSchoolId }}
            submitLabel={t('sheet.transfer')}
            onDone={onDone}
            fields={[
              {
                name: 'targetSchoolYearId',
                label: t('field.year'),
                type: 'select',
                options: openYears.map((y) => ({ value: y.id, label: y.label })),
              },
              {
                name: 'targetLevelId',
                label: t('field.level'),
                type: 'select',
                options: levels.map((l) => ({
                  value: l.id,
                  label: schoolDisplayName(targetLocale, l),
                })),
              },
              { name: 'effectiveOn', label: t('sheet.effectiveOn'), type: 'date', required: true },
              { name: 'reason', label: t('field.reason'), required: true },
            ]}
          />
        )}
      </CardBody>
    </Card>
  );
}

interface GuardianLink {
  relation: SchoolGuardianRelation;
  isPrimary: boolean;
  isEmergency: boolean;
  canReceiveSms: boolean;
  canViewSchoolInfo: boolean;
  canPickUp: boolean;
  guardian: {
    id: string;
    lastName: string;
    firstName: string;
    phone: string;
    email: string | null;
  };
}

const RIGHTS = ['isEmergency', 'canReceiveSms', 'canViewSchoolInfo', 'canPickUp'] as const;

function Guardians({ student, page }: { student: StudentFull; page: SchoolPageApi }) {
  const { t, labels } = useSchoolText();
  const links = useApi<GuardianLink[]>(`/school/students/${student.id}/guardians`);
  const [error, setError] = useState<ApiError | null>(null);
  const canManage = page.canWrite('school.guardians.manage');
  if (links.state === 'loading') return <LoadingState />;
  if (links.state === 'error') return <ErrorState error={links.error} onRetry={links.reload} />;
  const path = (id: string) => `/school/students/${student.id}/guardians/${id}`;
  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      links.reload();
    } catch (e) {
      setError(toApiError(e));
    }
  }
  return (
    <>
      <ApiErrorAlert error={error} />
      <Card>
        <ul className="divide-y divide-line/70 text-sm" data-testid="guardian-links">
          {links.data.length === 0 && (
            <li className="px-4 py-6 text-center text-muted">{t('sheet.noGuardian')}</li>
          )}
          {links.data.map((l) => (
            <li key={l.guardian.id} className="space-y-2 px-4 py-3">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-medium" dir="auto">
                  {l.guardian.lastName} {l.guardian.firstName}
                </span>
                <span className="text-muted">{labels.guardianRelation[l.relation]}</span>
                {l.isPrimary && <Badge tone="forest">{t('sheet.primary')}</Badge>}
              </p>
              <p className="text-muted">
                <a href={`tel:${l.guardian.phone}`} className="text-forest" dir="ltr">
                  {l.guardian.phone}
                </a>
                {l.guardian.email ? ` · ${l.guardian.email}` : ''}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {RIGHTS.map((right) => (
                  <label key={right} className="flex min-h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-forest"
                      checked={l[right]}
                      disabled={!canManage}
                      onChange={(e) =>
                        run(() =>
                          api(path(l.guardian.id), {
                            method: 'PATCH',
                            body: { [right]: e.target.checked },
                          }),
                        )
                      }
                    />
                    {t(`sheet.right.${right}`)}
                  </label>
                ))}
              </div>
              {canManage && (
                <div className="flex flex-wrap gap-2">
                  {!l.isPrimary && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        run(() =>
                          api(path(l.guardian.id), { method: 'PATCH', body: { isPrimary: true } }),
                        )
                      }
                    >
                      {t('sheet.makePrimary')}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => run(() => api(path(l.guardian.id), { method: 'DELETE' }))}
                  >
                    {t('sheet.detach')}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {canManage && <AttachGuardian student={student} onDone={links.reload} />}
    </>
  );
}

function AttachGuardian({ student, onDone }: { student: StudentFull; onDone: () => void }) {
  const { t, labels } = useSchoolText();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<GuardianLink['guardian'] | null>(null);
  const found = useApi<GuardianLink['guardian'][]>(
    q.length >= 2 ? `/school/guardians?q=${encodeURIComponent(q)}` : null,
  );
  return (
    <Card>
      <CardBody>
        <h2 className="mb-3 font-semibold">{t('sheet.attachTitle')}</h2>
        {picked ? (
          <>
            <p className="mb-3 text-sm">
              <span dir="auto">
                {picked.lastName} {picked.firstName}
              </span>
              , <span dir="ltr">{picked.phone}</span>
            </p>
            <SimpleForm
              key={picked.id}
              testId="link-guardian-form"
              path={`/school/students/${student.id}/guardians`}
              extra={{ guardianId: picked.id }}
              submitLabel={t('sheet.attach')}
              onDone={() => {
                setPicked(null);
                setQ('');
                onDone();
              }}
              fields={[
                {
                  name: 'relation',
                  label: t('sheet.relation'),
                  type: 'select',
                  options: SCHOOL_GUARDIAN_RELATIONS.map((r) => ({
                    value: r,
                    label: labels.guardianRelation[r],
                  })),
                },
                ...RIGHTS.map((right) => ({
                  name: right,
                  label: t(`sheet.right.${right}`),
                  type: 'checkbox' as const,
                })),
              ]}
            />
          </>
        ) : (
          <>
            <InputField
              label={t('guardians.search')}
              dir="auto"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {q.length >= 2 && found.state === 'success' && (
              <ul className="mt-2 divide-y divide-line/70 text-sm" data-testid="guardian-results">
                {found.data.length === 0 && (
                  <li className="py-2 text-muted">{t('sheet.noGuardianResult')}</li>
                )}
                {found.data.map((g) => (
                  <li key={g.id}>
                    <button
                      type="button"
                      className="min-h-11 w-full py-2 text-start hover:bg-ivory"
                      onClick={() => setPicked(g)}
                    >
                      <span dir="auto">
                        {g.lastName} {g.firstName}
                      </span>
                      , <span dir="ltr">{g.phone}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

interface DocumentRow {
  id: string;
  category: SchoolDocumentCategory;
  displayName: string;
  bytes: number;
  createdAt: string;
}

function Documents({ student, page }: { student: StudentFull; page: SchoolPageApi }) {
  const { t, labels, date } = useSchoolText();
  const documents = useApi<DocumentRow[]>(`/school/students/${student.id}/documents`);
  const [error, setError] = useState<ApiError | null>(null);
  const [category, setCategory] = useState<SchoolDocumentCategory>('BIRTH_CERTIFICATE');
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const base = `/school/students/${student.id}/documents`;
  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setSending(true);
    setError(null);
    const form = new FormData();
    form.append('category', category);
    form.append('file', file);
    try {
      await apiUpload(base, form);
      setFile(null);
      (event.target as HTMLFormElement).reset();
      documents.reload();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setSending(false);
    }
  }
  /** Le lien signé expire vite : il n'est demandé qu'au moment du téléchargement. */
  async function download(id: string) {
    setError(null);
    try {
      const { url } = await api<{ url: string }>(`${base}/${id}/link`);
      window.location.assign(url);
    } catch (e) {
      setError(toApiError(e));
    }
  }
  async function remove(id: string) {
    setError(null);
    try {
      await api(`${base}/${id}`, { method: 'DELETE' });
      documents.reload();
    } catch (e) {
      setError(toApiError(e));
    }
  }
  return (
    <>
      <ApiErrorAlert error={error} />
      {documents.state === 'loading' && <LoadingState />}
      {documents.state === 'error' && (
        <ErrorState error={documents.error} onRetry={documents.reload} />
      )}
      {documents.state === 'success' && (
        <Card>
          <ul className="divide-y divide-line/70 text-sm" data-testid="document-list">
            {documents.data.length === 0 && (
              <li className="px-4 py-6 text-center text-muted">{t('sheet.noDocument')}</li>
            )}
            {documents.data.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="w-full min-w-0 sm:w-auto sm:flex-1">
                  <span className="block font-medium">{labels.documentCategory[d.category]}</span>
                  <span className="block break-all text-muted" dir="auto">
                    {d.displayName}
                  </span>
                </span>
                <span className="text-muted">{date(d.createdAt)}</span>
                <Button variant="secondary" size="sm" onClick={() => download(d.id)}>
                  {t('sheet.download')}
                </Button>
                {page.canWrite('school.documents.delete') && (
                  <Button variant="secondary" size="sm" onClick={() => remove(d.id)}>
                    {t('sheet.delete')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {page.canWrite('school.documents.manage') && (
        <Card>
          <CardBody>
            <h2 className="mb-1 font-semibold">{t('sheet.addDocument')}</h2>
            <p className="mb-3 text-sm text-muted">{t('sheet.documentHint')}</p>
            <form
              onSubmit={upload}
              className="grid items-end gap-3 sm:grid-cols-2"
              data-testid="document-form"
            >
              <SelectField
                label={t('sheet.documentType')}
                value={category}
                onChange={(e) => setCategory(e.target.value as SchoolDocumentCategory)}
                options={SCHOOL_DOCUMENT_CATEGORIES.map((c) => ({
                  value: c,
                  label: labels.documentCategory[c],
                }))}
              />
              <label className="block text-sm font-medium">
                {t('field.file')}
                <input
                  type="file"
                  required
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="mt-1 block w-full text-sm"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <Button type="submit" loading={sending} className="sm:col-span-2 sm:w-fit">
                {t('common.add')}
              </Button>
            </form>
          </CardBody>
        </Card>
      )}
    </>
  );
}

function History({ studentId }: { studentId: string }) {
  const { t, name, date } = useSchoolText();
  const history = useApi<{
    events: { id: string; type: string; createdAt: string }[];
    assignments: {
      id: string;
      startedAt: string;
      endedAt: string | null;
      reason: string | null;
      class: NamedView;
    }[];
  }>(`/school/students/${studentId}/history`);
  if (history.state === 'loading') return <LoadingState />;
  if (history.state === 'error') {
    return <ErrorState error={history.error} onRetry={history.reload} />;
  }
  const eventLabel = (type: string) => {
    const key = `sheet.event.${type}` as SchoolTextKey;
    const label = t(key);
    // Événement ajouté côté serveur sans libellé ici : le code reste lisible plutôt que masqué.
    return label === key ? type : label;
  };
  return (
    <>
      <Card>
        <CardBody>
          <h2 className="mb-2 font-semibold">{t('sheet.assignments')}</h2>
          <ul className="space-y-1 text-sm" data-testid="assignment-history">
            {history.data.assignments.length === 0 && (
              <li className="text-muted">{t('sheet.noAssignment')}</li>
            )}
            {history.data.assignments.map((a) => (
              <li key={a.id}>
                <span className="font-medium">{name(a.class)}</span>
                {' : '}
                {date(a.startedAt)}
                {a.endedAt ? t('sheet.until', { date: date(a.endedAt) }) : t('sheet.ongoing')}
                {a.reason ? ` (${a.reason})` : ''}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <h2 className="mb-2 font-semibold">{t('sheet.events')}</h2>
          <ul className="space-y-1 text-sm" data-testid="event-history">
            {history.data.events.map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-x-3">
                <span>{eventLabel(e.type)}</span>
                <span className="text-muted">{date(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </>
  );
}

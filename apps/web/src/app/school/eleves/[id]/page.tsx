'use client';

import { useParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import {
  SCHOOL_DOCUMENT_CATEGORIES,
  SCHOOL_DOCUMENT_CATEGORY_LABELS,
  SCHOOL_ENROLLMENT_STATUS_LABELS,
  SCHOOL_EXIT_REASONS,
  SCHOOL_EXIT_REASON_LABELS,
  SCHOOL_GUARDIAN_RELATIONS,
  SCHOOL_GUARDIAN_RELATION_LABELS,
  SCHOOL_SEXES,
  SCHOOL_SEX_LABELS,
  hasSchoolPermission,
  type SchoolDocumentCategory,
  type SchoolEnrollmentStatus,
  type SchoolGuardianRelation,
  type SchoolSex,
} from '@ocall/shared';
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
import { SimpleForm } from '@/components/ui/simple-form';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api, apiUpload } from '@/lib/api';
import { formatDate } from '@/lib/format';
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
  { key: 'identity', label: 'Identité', permission: null },
  { key: 'schooling', label: 'Scolarité', permission: 'school.students.read_full' },
  { key: 'guardians', label: 'Responsables', permission: 'school.guardians.read' },
  { key: 'documents', label: 'Documents', permission: 'school.documents.read' },
  { key: 'history', label: 'Historique', permission: 'school.students.read_full' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const toError = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion impossible.');

export default function FicheElevePage() {
  const { id } = useParams<{ id: string }>();
  return (
    <SchoolPage title="Fiche élève" needsSchool={false}>
      {(page) => <Sheet id={id} page={page} />}
    </SchoolPage>
  );
}

function Sheet({ id, page }: { id: string; page: SchoolPageApi }) {
  const student = useApi<StudentFull>(`/school/students/${id}`);
  const [tab, setTab] = useState<TabKey>('identity');
  if (student.state === 'loading') return <LoadingState />;
  if (student.state === 'error') {
    return <ErrorState error={student.error} onRetry={student.reload} />;
  }
  const s = student.data;
  const tabs = TABS.filter(
    (t) => !t.permission || hasSchoolPermission(page.context.role, t.permission),
  );
  return (
    <>
      <Card>
        <CardBody>
          <p className="text-lg font-semibold" data-testid="student-name">
            <StudentName student={s} />
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted">
            <span data-testid="student-matricule">{s.matricule}</span>
            <StudentStatusBadge status={s.status} />
          </p>
        </CardBody>
      </Card>
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`min-h-11 whitespace-nowrap px-3 text-sm font-medium ${
              tab === t.key ? 'border-b-2 border-forest text-forest' : 'text-muted'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'identity' && <Identity student={s} page={page} reload={student.reload} />}
      {tab === 'schooling' && <Schooling student={s} page={page} reload={student.reload} />}
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
  const [editing, setEditing] = useState(false);
  const full = s.birthDate !== undefined;
  const canEdit = page.canWrite('school.students.manage');
  return (
    <>
      <Card>
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="Nom">{s.lastName}</Fact>
            <Fact label="Prénom">{s.firstName}</Fact>
            {full && (
              <>
                <Fact label="Date de naissance">{s.birthDate && formatDate(s.birthDate)}</Fact>
                <Fact label="Lieu de naissance">{s.birthPlace}</Fact>
                <Fact label="Sexe">{s.sex && SCHOOL_SEX_LABELS[s.sex]}</Fact>
                <Fact label="Nationalité">{s.nationality}</Fact>
                <Fact label="Adresse">{s.address}</Fact>
                <Fact label="Observations administratives">{s.adminNotes}</Fact>
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
              {editing ? 'Fermer' : 'Modifier'}
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
              submitLabel="Enregistrer"
              onDone={() => {
                setEditing(false);
                reload();
              }}
              fields={[
                { name: 'lastName', label: 'Nom', required: true, defaultValue: s.lastName },
                { name: 'firstName', label: 'Prénom', required: true, defaultValue: s.firstName },
                {
                  name: 'lastNameAr',
                  label: 'Nom en arabe',
                  rtl: true,
                  defaultValue: s.lastNameAr ?? '',
                },
                {
                  name: 'firstNameAr',
                  label: 'Prénom en arabe',
                  rtl: true,
                  defaultValue: s.firstNameAr ?? '',
                },
                {
                  name: 'birthDate',
                  label: 'Date de naissance',
                  type: 'date',
                  required: true,
                  defaultValue: s.birthDate,
                },
                {
                  name: 'birthPlace',
                  label: 'Lieu de naissance',
                  defaultValue: s.birthPlace ?? '',
                },
                {
                  name: 'sex',
                  label: 'Sexe',
                  type: 'select',
                  defaultValue: s.sex ?? '',
                  options: [
                    { value: '', label: 'Non renseigné' },
                    ...SCHOOL_SEXES.map((v) => ({ value: v, label: SCHOOL_SEX_LABELS[v] })),
                  ],
                },
                { name: 'nationality', label: 'Nationalité', defaultValue: s.nationality ?? '' },
                { name: 'address', label: 'Adresse', defaultValue: s.address ?? '' },
                {
                  name: 'adminNotes',
                  label: 'Observations administratives',
                  defaultValue: s.adminNotes ?? '',
                },
              ]}
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
            <h2 className="mb-1 font-semibold">Corriger le matricule</h2>
            <p className="mb-3 text-sm text-muted">
              Le matricule reste fixe. Une correction exige un motif et reste dans l’historique.
            </p>
            <SimpleForm
              testId="matricule-form"
              path={`/school/students/${s.id}/matricule`}
              submitLabel="Corriger"
              onDone={reload}
              fields={[
                { name: 'matricule', label: 'Nouveau matricule', required: true },
                { name: 'reason', label: 'Motif', required: true },
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
      setError(toError(e));
    }
  }
  async function save() {
    setError(null);
    try {
      await api(path, { method: 'PUT', body: { specialNeeds: draft } });
      setShown(draft || null);
    } catch (e) {
      setError(toError(e));
    }
  }
  return (
    <Card>
      <CardBody>
        <h2 className="mb-1 font-semibold">Besoins particuliers</h2>
        <p className="mb-3 text-sm text-muted">
          Strictement nécessaires à la prise en charge. Données chiffrées, consultation journalisée.
        </p>
        <ApiErrorAlert error={error} />
        {shown === undefined ? (
          <Button variant="secondary" size="sm" onClick={show}>
            Afficher
          </Button>
        ) : canEdit ? (
          <div className="space-y-2">
            <InputField label="Besoins" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <Button size="sm" onClick={save}>
              Enregistrer
            </Button>
          </div>
        ) : (
          <p className="text-sm">{shown || 'Aucun besoin particulier renseigné.'}</p>
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
            <li className="px-4 py-6 text-center text-muted">
              Aucune inscription. Utilisez la page Inscriptions.
            </li>
          )}
          {enrollments.data.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="font-medium">{e.year.label}</span>
              <span>{e.class?.name ?? e.level.name}</span>
              {e.track && <span className="text-muted">{e.track.name}</span>}
              <Badge tone={e.status === 'VALIDATED' ? 'forest' : 'neutral'}>
                {SCHOOL_ENROLLMENT_STATUS_LABELS[e.status]}
              </Badge>
              {e.exitReason && (
                <span className="text-muted">
                  {SCHOOL_EXIT_REASON_LABELS[e.exitReason]}
                  {e.exitedOn ? `, ${formatDate(e.exitedOn)}` : ''}
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
            <h2 className="mb-3 font-semibold">Départ, abandon ou transfert hors du groupe</h2>
            <SimpleForm
              testId="exit-form"
              path={`/school/enrollments/${active.id}/exit`}
              submitLabel="Enregistrer la sortie"
              onDone={refresh}
              fields={[
                {
                  name: 'reason',
                  label: 'Motif',
                  type: 'select',
                  options: SCHOOL_EXIT_REASONS.map((r) => ({
                    value: r,
                    label: SCHOOL_EXIT_REASON_LABELS[r],
                  })),
                },
                { name: 'exitedOn', label: 'Date', type: 'date', required: true },
                { name: 'note', label: 'Précision' },
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
  const classes = useClasses(enrollment.schoolYearId);
  return (
    <Card>
      <CardBody>
        <h2 className="mb-3 font-semibold">Changer de classe</h2>
        {classes.length > 0 && (
          <SimpleForm
            key={enrollment.class?.id}
            testId="change-class-form"
            path={`/school/enrollments/${enrollment.id}/class`}
            submitLabel="Changer de classe"
            onDone={onDone}
            fields={[
              {
                name: 'classId',
                label: 'Nouvelle classe',
                type: 'select',
                options: classes
                  .filter((c) => c.id !== enrollment.class?.id)
                  .map((c) => ({ value: c.id, label: c.name })),
              },
              { name: 'reason', label: 'Motif' },
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
  const targets = page.context.schools.filter((s) => s.id !== student.schoolId);
  const [targetSchoolId, setTarget] = useState(targets[0]?.id ?? '');
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
        <h2 className="mb-3 font-semibold">Transfert vers un autre établissement du groupe</h2>
        <div className="mb-3 max-w-sm">
          <SelectField
            label="Établissement d’accueil"
            value={targetSchoolId}
            onChange={(e) => setTarget(e.target.value)}
            options={targets.map((t) => ({ value: t.id, label: t.name }))}
          />
        </div>
        {openYears.length === 0 || levels.length === 0 ? (
          <Alert tone="info" title="Structure à préparer">
            Cet établissement doit avoir une année ouverte et au moins un niveau.
          </Alert>
        ) : (
          <SimpleForm
            key={targetSchoolId}
            testId="transfer-form"
            path={`/school/students/${student.id}/transfer`}
            extra={{ targetSchoolId }}
            submitLabel="Transférer l’élève"
            onDone={onDone}
            fields={[
              {
                name: 'targetSchoolYearId',
                label: 'Année',
                type: 'select',
                options: openYears.map((y) => ({ value: y.id, label: y.label })),
              },
              {
                name: 'targetLevelId',
                label: 'Niveau',
                type: 'select',
                options: levels.map((l) => ({ value: l.id, label: l.name })),
              },
              { name: 'effectiveOn', label: 'Date d’effet', type: 'date', required: true },
              { name: 'reason', label: 'Motif', required: true },
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

const RIGHTS = [
  { key: 'isEmergency', label: 'Contact d’urgence' },
  { key: 'canReceiveSms', label: 'Reçoit les SMS' },
  { key: 'canViewSchoolInfo', label: 'Consulte la scolarité' },
  { key: 'canPickUp', label: 'Peut récupérer l’enfant' },
] as const;

function Guardians({ student, page }: { student: StudentFull; page: SchoolPageApi }) {
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
      setError(toError(e));
    }
  }
  return (
    <>
      <ApiErrorAlert error={error} />
      <Card>
        <ul className="divide-y divide-line/70 text-sm" data-testid="guardian-links">
          {links.data.length === 0 && (
            <li className="px-4 py-6 text-center text-muted">Aucun responsable rattaché.</li>
          )}
          {links.data.map((l) => (
            <li key={l.guardian.id} className="space-y-2 px-4 py-3">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {l.guardian.lastName} {l.guardian.firstName}
                </span>
                <span className="text-muted">{SCHOOL_GUARDIAN_RELATION_LABELS[l.relation]}</span>
                {l.isPrimary && <Badge tone="forest">Principal</Badge>}
              </p>
              <p className="text-muted">
                <a href={`tel:${l.guardian.phone}`} className="text-forest">
                  {l.guardian.phone}
                </a>
                {l.guardian.email ? ` · ${l.guardian.email}` : ''}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {RIGHTS.map((r) => (
                  <label key={r.key} className="flex min-h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-forest"
                      checked={l[r.key]}
                      disabled={!canManage}
                      onChange={(e) =>
                        run(() =>
                          api(path(l.guardian.id), {
                            method: 'PATCH',
                            body: { [r.key]: e.target.checked },
                          }),
                        )
                      }
                    />
                    {r.label}
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
                      Rendre principal
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => run(() => api(path(l.guardian.id), { method: 'DELETE' }))}
                  >
                    Détacher
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
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<GuardianLink['guardian'] | null>(null);
  const found = useApi<GuardianLink['guardian'][]>(
    q.length >= 2 ? `/school/guardians?q=${encodeURIComponent(q)}` : null,
  );
  return (
    <Card>
      <CardBody>
        <h2 className="mb-3 font-semibold">Rattacher un responsable</h2>
        {picked ? (
          <>
            <p className="mb-3 text-sm">
              {picked.lastName} {picked.firstName}, {picked.phone}
            </p>
            <SimpleForm
              key={picked.id}
              testId="link-guardian-form"
              path={`/school/students/${student.id}/guardians`}
              extra={{ guardianId: picked.id }}
              submitLabel="Rattacher"
              onDone={() => {
                setPicked(null);
                setQ('');
                onDone();
              }}
              fields={[
                {
                  name: 'relation',
                  label: 'Lien avec l’élève',
                  type: 'select',
                  options: SCHOOL_GUARDIAN_RELATIONS.map((r) => ({
                    value: r,
                    label: SCHOOL_GUARDIAN_RELATION_LABELS[r],
                  })),
                },
                ...RIGHTS.map((r) => ({
                  name: r.key,
                  label: r.label,
                  type: 'checkbox' as const,
                })),
              ]}
            />
          </>
        ) : (
          <>
            <InputField
              label="Rechercher par nom ou téléphone"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {q.length >= 2 && found.state === 'success' && (
              <ul className="mt-2 divide-y divide-line/70 text-sm" data-testid="guardian-results">
                {found.data.length === 0 && (
                  <li className="py-2 text-muted">
                    Aucun résultat : créez-le dans la page Responsables.
                  </li>
                )}
                {found.data.map((g) => (
                  <li key={g.id}>
                    <button
                      type="button"
                      className="min-h-11 w-full py-2 text-left hover:bg-ivory"
                      onClick={() => setPicked(g)}
                    >
                      {g.lastName} {g.firstName}, {g.phone}
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
      setError(toError(e));
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
      setError(toError(e));
    }
  }
  async function remove(id: string) {
    setError(null);
    try {
      await api(`${base}/${id}`, { method: 'DELETE' });
      documents.reload();
    } catch (e) {
      setError(toError(e));
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
              <li className="px-4 py-6 text-center text-muted">Aucune pièce au dossier.</li>
            )}
            {documents.data.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="w-full min-w-0 sm:w-auto sm:flex-1">
                  <span className="block font-medium">
                    {SCHOOL_DOCUMENT_CATEGORY_LABELS[d.category]}
                  </span>
                  <span className="block break-all text-muted">{d.displayName}</span>
                </span>
                <span className="text-muted">{formatDate(d.createdAt)}</span>
                <Button variant="secondary" size="sm" onClick={() => download(d.id)}>
                  Télécharger
                </Button>
                {page.canWrite('school.documents.delete') && (
                  <Button variant="secondary" size="sm" onClick={() => remove(d.id)}>
                    Supprimer
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
            <h2 className="mb-1 font-semibold">Ajouter une pièce</h2>
            <p className="mb-3 text-sm text-muted">JPEG, PNG, WebP ou PDF, 5 Mo au plus.</p>
            <form
              onSubmit={upload}
              className="grid items-end gap-3 sm:grid-cols-2"
              data-testid="document-form"
            >
              <SelectField
                label="Type de pièce"
                value={category}
                onChange={(e) => setCategory(e.target.value as SchoolDocumentCategory)}
                options={SCHOOL_DOCUMENT_CATEGORIES.map((c) => ({
                  value: c,
                  label: SCHOOL_DOCUMENT_CATEGORY_LABELS[c],
                }))}
              />
              <label className="block text-sm font-medium">
                Fichier
                <input
                  type="file"
                  required
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="mt-1 block w-full text-sm"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <Button type="submit" loading={sending} className="sm:col-span-2 sm:w-fit">
                Ajouter
              </Button>
            </form>
          </CardBody>
        </Card>
      )}
    </>
  );
}

const EVENT_LABELS: Record<string, string> = {
  CREATED: 'Dossier créé',
  UPDATED: 'Dossier modifié',
  MATRICULE_CORRECTED: 'Matricule corrigé',
  SENSITIVE_UPDATED: 'Besoins particuliers modifiés',
  ENROLLMENT_CREATED: 'Inscription créée',
  ENROLLMENT_STATUS: 'Statut d’inscription modifié',
  ENROLLMENT_ENDED: 'Inscription terminée',
  CLASS_CHANGED: 'Changement de classe',
  TRANSFERRED: 'Transfert dans le groupe',
  GUARDIAN_LINKED: 'Responsable rattaché',
  GUARDIAN_UNLINKED: 'Responsable détaché',
  GUARDIAN_RIGHTS_UPDATED: 'Autorisations d’un responsable modifiées',
  DOCUMENT_ADDED: 'Pièce ajoutée',
  DOCUMENT_DELETED: 'Pièce supprimée',
};

function History({ studentId }: { studentId: string }) {
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
  return (
    <>
      <Card>
        <CardBody>
          <h2 className="mb-2 font-semibold">Affectations</h2>
          <ul className="space-y-1 text-sm" data-testid="assignment-history">
            {history.data.assignments.length === 0 && (
              <li className="text-muted">Aucune affectation.</li>
            )}
            {history.data.assignments.map((a) => (
              <li key={a.id}>
                <span className="font-medium">{a.class.name}</span>
                {' : '}
                {formatDate(a.startedAt)}
                {a.endedAt ? ` au ${formatDate(a.endedAt)}` : ', en cours'}
                {a.reason ? ` (${a.reason})` : ''}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <h2 className="mb-2 font-semibold">Événements du dossier</h2>
          <ul className="space-y-1 text-sm" data-testid="event-history">
            {history.data.events.map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-x-3">
                <span>{EVENT_LABELS[e.type] ?? e.type}</span>
                <span className="text-muted">{formatDate(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </>
  );
}

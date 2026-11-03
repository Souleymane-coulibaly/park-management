'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  SCHOOL_ENROLLMENT_STATUSES,
  SCHOOL_ENROLLMENT_STATUS_LABELS,
  SCHOOL_SEXES,
  SCHOOL_SEX_LABELS,
  canTransitionEnrollment,
  type SchoolEnrollmentStatus,
} from '@ocall/shared';
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
import { ApiError, api } from '@/lib/api';
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

const KIND_LABELS = { NEW: 'Nouvelle', RENEWAL: 'Réinscription', TRANSFER_IN: 'Transfert' };

export default function InscriptionsPage() {
  return (
    <SchoolPage
      title="Inscriptions"
      description="Le secrétariat prépare et soumet, la direction valide. Une réinscription garde le même dossier."
    >
      {(page) => <Enrollments key={page.school!.id} page={page} schoolId={page.school!.id} />}
    </SchoolPage>
  );
}

function Enrollments({ page, schoolId }: { page: SchoolPageApi; schoolId: string }) {
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
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion impossible.'));
    }
  }

  return (
    <>
      {canManage && <NewEnrollment schoolId={schoolId} onDone={list.reload} />}
      <Card>
        <CardBody>
          <div className="max-w-xs">
            <SelectField
              label="Statut"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPageNumber(1);
              }}
              options={[
                { value: '', label: 'Tous' },
                ...SCHOOL_ENROLLMENT_STATUSES.map((s) => ({
                  value: s,
                  label: SCHOOL_ENROLLMENT_STATUS_LABELS[s],
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
              <li className="px-4 py-6 text-center text-muted">Aucune inscription.</li>
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
                    {SCHOOL_ENROLLMENT_STATUS_LABELS[e.status]}
                  </Badge>
                </p>
                <p className="text-muted">
                  {e.student.matricule} · {e.year.label} · {e.class?.name ?? e.level.name} ·{' '}
                  {KIND_LABELS[e.kind]}
                </p>
                <div className="flex flex-wrap gap-2">
                  {canManage && canTransitionEnrollment(e.status, 'PENDING') && (
                    <Button size="sm" onClick={() => change(e.id, 'PENDING')}>
                      Soumettre
                    </Button>
                  )}
                  {canValidate && canTransitionEnrollment(e.status, 'VALIDATED') && (
                    <Button size="sm" onClick={() => change(e.id, 'VALIDATED')}>
                      Valider
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
                        Annuler
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
            label={(n) => `${n} inscription${n > 1 ? 's' : ''}`}
            onPage={setPageNumber}
          />
        </Card>
      )}
    </>
  );
}

/** Nouvelle inscription : dossier d'abord, ou recherche d'un élève existant pour une réinscription. */
function NewEnrollment({ schoolId, onDone }: { schoolId: string; onDone: () => void }) {
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [student, setStudent] = useState<Pick<
    StudentRow,
    'id' | 'matricule' | 'lastName' | 'firstName' | 'lastNameAr' | 'firstNameAr'
  > | null>(null);
  return (
    <Card>
      <CardBody>
        <h2 className="mb-3 font-semibold">Nouvelle inscription</h2>
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
                Nouvel élève
              </Button>
              <Button
                size="sm"
                variant={mode === 'existing' ? 'primary' : 'secondary'}
                onClick={() => setMode('existing')}
              >
                Réinscription
              </Button>
            </div>
            {mode === 'new' ? (
              <SimpleForm<NonNullable<typeof student>>
                testId="new-student-form"
                path="/school/students"
                extra={{ schoolId }}
                submitLabel="Créer le dossier et continuer"
                onDone={setStudent}
                fields={[
                  { name: 'lastName', label: 'Nom', required: true },
                  { name: 'firstName', label: 'Prénom', required: true },
                  { name: 'lastNameAr', label: 'Nom en arabe', rtl: true },
                  { name: 'firstNameAr', label: 'Prénom en arabe', rtl: true },
                  { name: 'birthDate', label: 'Date de naissance', type: 'date', required: true },
                  { name: 'birthPlace', label: 'Lieu de naissance' },
                  {
                    name: 'sex',
                    label: 'Sexe',
                    type: 'select',
                    options: [
                      { value: '', label: 'Non renseigné' },
                      ...SCHOOL_SEXES.map((v) => ({ value: v, label: SCHOOL_SEX_LABELS[v] })),
                    ],
                  },
                  { name: 'address', label: 'Adresse' },
                  { name: 'matricule', label: 'Matricule existant (sinon généré)' },
                  {
                    name: 'confirmHomonym',
                    label: 'Homonyme vérifié : il s’agit d’une autre personne',
                    type: 'checkbox',
                  },
                ]}
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
  const [q, setQ] = useState('');
  const found = useApi<{ items: StudentRow[] }>(
    q.length >= 2
      ? `/school/students?schoolId=${schoolId}&pageSize=10&q=${encodeURIComponent(q)}`
      : null,
  );
  return (
    <>
      <InputField
        label="Rechercher un élève"
        placeholder="Nom, اسم, matricule"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {q.length >= 2 && found.state === 'success' && (
        <ul className="mt-2 divide-y divide-line/70 text-sm" data-testid="student-results">
          {found.data.items.length === 0 && (
            <li className="py-2 text-muted">Aucun élève trouvé.</li>
          )}
          {found.data.items.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="min-h-11 w-full py-2 text-left hover:bg-ivory"
                onClick={() => onPick(s)}
              >
                <StudentName student={s} /> <span className="text-muted">{s.matricule}</span>
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
  student: Pick<
    StudentRow,
    'id' | 'matricule' | 'lastName' | 'firstName' | 'lastNameAr' | 'firstNameAr'
  >;
  onDone: () => void;
}) {
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
      <Alert tone="info" title="Structure à préparer">
        Créez d’abord une année scolaire ouverte et au moins un niveau.
      </Alert>
    );
  }
  return (
    <>
      <p className="mb-3 text-sm">
        <span className="font-medium">
          <StudentName student={student} />
        </span>{' '}
        <span className="text-muted" data-testid="placement-matricule">
          {student.matricule}
        </span>
      </p>
      <div className="mb-3 max-w-sm">
        <SelectField
          label="Année scolaire"
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
        submitLabel="Soumettre l’inscription"
        onDone={onDone}
        fields={[
          {
            name: 'levelId',
            label: 'Niveau',
            type: 'select',
            options: levels.map((l) => ({ value: l.id, label: `${l.cycleName} : ${l.name}` })),
          },
          {
            name: 'classId',
            label: 'Classe',
            type: 'select',
            options: [
              { value: '', label: 'À définir' },
              ...classes.map((c) => ({ value: c.id, label: `${c.name} (${c.level.name})` })),
            ],
          },
          {
            name: 'trackId',
            label: 'Parcours',
            type: 'select',
            options: [
              { value: '', label: 'Non précisé' },
              ...(tracks.state === 'success'
                ? tracks.data.map((t) => ({ value: t.id, label: t.name }))
                : []),
            ],
          },
        ]}
      />
      <p className="mt-3 text-sm text-muted">
        Avant validation, rattachez un responsable et ajoutez les pièces depuis la{' '}
        <Link href={`/school/eleves/${student.id}`} className="text-forest hover:underline">
          fiche de l’élève
        </Link>
        .
      </p>
    </>
  );
}

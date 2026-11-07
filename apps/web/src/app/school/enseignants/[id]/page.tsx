'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { hasSchoolPermission } from '@ocall/shared';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { SchoolPage, type SchoolPageApi } from '@/components/school/school-page';
import { Fact, type NamedView } from '@/components/school/school-students';
import {
  AssignmentLine,
  type AssignmentView,
  TeacherName,
  type TeacherNames,
} from '@/components/school/school-teaching';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { SimpleForm } from '@/components/ui/simple-form';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface TeacherDetail extends TeacherNames {
  loginId: string;
  schoolIds: string[];
  subjects: (NamedView & { schoolId: string })[];
  teaching: AssignmentView[];
}

export default function FicheEnseignantPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <SchoolPage title="teacher.title">
      {(page) =>
        hasSchoolPermission(page.context.role, 'school.teaching.read') ? (
          <Sheet key={page.school!.id} id={id} page={page} />
        ) : null
      }
    </SchoolPage>
  );
}

function Sheet({ id, page }: { id: string; page: SchoolPageApi }) {
  const { t, showArabic } = useSchoolText();
  const teacher = useApi<TeacherDetail>(`/school/teachers/${id}`);
  const [showHistory, setShowHistory] = useState(false);
  if (teacher.state === 'loading') return <LoadingState />;
  if (teacher.state === 'error') {
    return <ErrorState error={teacher.error} onRetry={teacher.reload} />;
  }
  const d = teacher.data;
  const current = d.teaching.filter((a) => !a.endedAt);
  const ended = d.teaching.filter((a) => a.endedAt);
  return (
    <>
      <Card>
        <CardBody>
          <p
            className="flex flex-wrap items-center gap-2 text-lg font-semibold"
            data-testid="teacher-name"
          >
            <TeacherName teacher={d} />
            {!d.isActive && <Badge tone="neutral">{t('common.inactive')}</Badge>}
          </p>
          <dl className="mt-3 grid gap-4 sm:grid-cols-2">
            <Fact label={t('teacher.login')}>
              <span dir="ltr">{d.loginId}</span>
            </Fact>
          </dl>
        </CardBody>
      </Card>
      {showArabic && page.canWrite('school.members.manage') && (
        <Card>
          <CardBody>
            <h2 className="mb-3 font-semibold">{t('teacher.arabicNames')}</h2>
            <SimpleForm
              key={`${d.firstNameAr}-${d.lastNameAr}`}
              testId="teacher-names-form"
              method="PATCH"
              sendEmpty
              path={`/school/members/${d.id}`}
              submitLabel={t('teacher.saveNames')}
              onDone={teacher.reload}
              fields={[
                {
                  name: 'lastNameAr',
                  label: t('field.lastNameAr'),
                  rtl: true,
                  defaultValue: d.lastNameAr ?? '',
                },
                {
                  name: 'firstNameAr',
                  label: t('field.firstNameAr'),
                  rtl: true,
                  defaultValue: d.firstNameAr ?? '',
                },
              ]}
            />
          </CardBody>
        </Card>
      )}
      <Subjects
        teacher={d}
        schoolId={page.school!.id}
        canEdit={page.canWrite('school.teaching.manage')}
        writable={(id) => page.forSchool(id).school?.contractAccess === 'full'}
        onDone={teacher.reload}
      />
      <Card>
        <CardBody>
          <h2 className="font-semibold">{t('teacher.current')}</h2>
          <ul className="divide-y divide-line/70" data-testid="teacher-current">
            {current.length === 0 && (
              <li className="py-3 text-sm text-muted">{t('teacher.none')}</li>
            )}
            {current.map((a) => (
              <AssignmentLine key={a.id} assignment={a} show="class" />
            ))}
          </ul>
          {ended.length > 0 && (
            <Button
              className="mt-2"
              variant="secondary"
              size="sm"
              onClick={() => setShowHistory(!showHistory)}
            >
              {showHistory ? t('common.hideHistory') : t('common.showHistory')}
            </Button>
          )}
          {showHistory && (
            <>
              <h3 className="mt-4 text-sm font-semibold">{t('teacher.history')}</h3>
              <ul className="divide-y divide-line/70" data-testid="teacher-history">
                {ended.map((a) => (
                  <AssignmentLine key={a.id} assignment={a} show="class" />
                ))}
              </ul>
            </>
          )}
        </CardBody>
      </Card>
    </>
  );
}

/**
 * Matières enseignables dans l'établissement affiché. Celles d'un autre établissement de l'enseignant
 * sont conservées telles quelles à l'enregistrement.
 */
function Subjects({
  teacher,
  schoolId,
  canEdit,
  writable,
  onDone,
}: {
  teacher: TeacherDetail;
  schoolId: string;
  canEdit: boolean;
  /** Établissement dont les matières peuvent être réécrites (contrat actif). */
  writable: (schoolId: string) => boolean;
  onDone: () => void;
}) {
  const { t, name } = useSchoolText();
  const subjects = useApi<(NamedView & { isActive: boolean })[]>(
    `/school/subjects?schoolId=${schoolId}`,
  );
  const [selected, setSelected] = useState(
    () => new Set(teacher.subjects.filter((s) => s.schoolId === schoolId).map((s) => s.id)),
  );
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  if (subjects.state !== 'success') return null;
  const available = subjects.data.filter((s) => s.isActive);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    // Matières des autres établissements conservées, sauf celles d'un établissement en lecture seule :
    // l'API ne les modifie pas (elles restent intactes) et refuserait de les recevoir.
    const elsewhere = teacher.subjects
      .filter((s) => s.schoolId !== schoolId && writable(s.schoolId))
      .map((s) => s.id);
    try {
      await api(`/school/teachers/${teacher.id}/subjects`, {
        method: 'PUT',
        body: { subjectIds: [...elsewhere, ...selected] },
      });
      setSaved(true);
      onDone();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardBody>
        <h2 className="mb-1 font-semibold">{t('teacher.subjects')}</h2>
        <p className="mb-3 text-sm text-muted">{t('teacher.subjectsHint')}</p>
        <ApiErrorAlert error={error} />
        {saved && <Alert tone="success" title={t('common.saved')} />}
        {available.length === 0 && <p className="text-sm text-muted">{t('teacher.noSubject')}</p>}
        <div className="grid gap-1 sm:grid-cols-2" data-testid="teacher-subjects">
          {available.map((s) => (
            <label key={s.id} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-5 w-5 accent-forest"
                disabled={!canEdit}
                checked={selected.has(s.id)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(s.id);
                  else next.delete(s.id);
                  setSelected(next);
                }}
              />
              {name(s)}
            </label>
          ))}
        </div>
        {canEdit && available.length > 0 && (
          <Button className="mt-3" loading={saving} onClick={() => void save()}>
            {t('teacher.saveSubjects')}
          </Button>
        )}
      </CardBody>
    </Card>
  );
}

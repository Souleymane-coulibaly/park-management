'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { hasSchoolPermission, type SchoolYearStatus } from '@ocall/shared';
import { SchoolLanguage, toApiError, useSchoolText } from '@/components/school/school-language';
import { BiName, SchoolPage, type SchoolPageApi } from '@/components/school/school-page';
import {
  Fact,
  type NamedView,
  StudentName,
  type StudentRow,
} from '@/components/school/school-students';
import {
  AssignmentLine,
  type AssignmentView,
  TeacherName,
  type TeacherNames,
} from '@/components/school/school-teaching';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { SimpleForm } from '@/components/ui/simple-form';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface ClassDetail extends NamedView {
  capacity: number | null;
  isActive: boolean;
  schoolId: string;
  enrolled: number;
  year: { id: string; label: string; status: SchoolYearStatus };
  level: NamedView;
  track: NamedView | null;
  groups: (NamedView & { isActive: boolean; _count: { students: number } })[];
  /** Absente (null) sans la lecture de l'équipe pédagogique. */
  teaching: AssignmentView[] | null;
  /** Accès d'avant le Sprint 3B, sans affectation : à retirer ou à remplacer par une affectation. */
  legacyAccess: TeacherNames[];
}

type RosterStudent = Pick<
  StudentRow,
  'id' | 'matricule' | 'lastName' | 'firstName' | 'lastNameAr' | 'firstNameAr'
>;

interface GroupView extends NamedView {
  isActive: boolean;
  students: { student: RosterStudent }[];
}

export default function FicheClassePage() {
  const { id } = useParams<{ id: string }>();
  return (
    // Sans titre de cadre : l'en-tête suit la langue de l'établissement de la classe.
    <SchoolPage needsSchool={false}>{(page) => <Sheet id={id} page={page} />}</SchoolPage>
  );
}

function Sheet({ id, page }: { id: string; page: SchoolPageApi }) {
  const detail = useApi<ClassDetail>(`/school/classes/${id}`);
  if (detail.state === 'loading') return <LoadingState />;
  if (detail.state === 'error') return <ErrorState error={detail.error} onRetry={detail.reload} />;
  // La fiche suit la langue de l'établissement de la classe, pas celle de l'établissement choisi.
  const locale =
    page.context.schools.find((s) => s.id === detail.data.schoolId)?.defaultLocale ?? 'FR';
  return (
    <SchoolLanguage locale={locale} className="space-y-4">
      <SheetContent cls={detail.data} page={page} reload={detail.reload} />
    </SchoolLanguage>
  );
}

function SheetContent({
  cls: c,
  page,
  reload,
}: {
  cls: ClassDetail;
  page: SchoolPageApi;
  reload: () => void;
}) {
  const { t, name } = useSchoolText();
  const roster = useApi<{ students: RosterStudent[] }>(`/school/classes/${c.id}/students`);
  const open = c.year.status !== 'CLOSED';
  const students = roster.state === 'success' ? roster.data.students : [];
  return (
    <>
      <PageHeader eyebrow={t('common.eyebrow')} title={t('class.title')} />
      <Card>
        <CardBody>
          <p
            className="flex flex-wrap items-center gap-2 text-lg font-semibold"
            data-testid="class-name"
          >
            <BiName name={c.name} nameAr={c.nameAr} />
            {!c.isActive && <Badge tone="neutral">{t('classes.archived')}</Badge>}
          </p>
          <dl className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label={t('field.schoolYear')}>{c.year.label}</Fact>
            <Fact label={t('field.level')}>{name(c.level)}</Fact>
            <Fact label={t('field.track')}>{c.track ? name(c.track) : ''}</Fact>
            <Fact label={t('field.capacity')}>
              <span dir="ltr">
                {c.enrolled} / {c.capacity ?? '∞'}
              </span>
            </Fact>
          </dl>
          {!c.isActive && <p className="mt-3 text-sm text-muted">{t('class.archivedNote')}</p>}
        </CardBody>
      </Card>
      {open && page.canWrite('school.structure.manage') && <EditClass cls={c} onDone={reload} />}
      {c.teaching && (
        <Team cls={c} teaching={c.teaching} page={page} open={open} onChange={reload} />
      )}
      <Groups
        cls={c}
        students={students}
        canManage={open && page.canWrite('school.structure.manage')}
        onChange={reload}
      />
      {roster.state === 'loading' && <LoadingState />}
      {roster.state === 'error' && <ErrorState error={roster.error} onRetry={roster.reload} />}
      {roster.state === 'success' && (
        <Card>
          <CardBody>
            <h2 className="font-semibold">{t('class.studentsCount', { n: students.length })}</h2>
          </CardBody>
          <ul className="divide-y divide-line/70 text-sm" data-testid="class-roster">
            {students.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                <span className="min-w-0 flex-1">
                  <StudentName student={s} />
                </span>
                <span className="text-muted" dir="ltr">
                  {s.matricule}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function EditClass({ cls, onDone }: { cls: ClassDetail; onDone: () => void }) {
  const { t, fields } = useSchoolText();
  const [error, setError] = useState<ApiError | null>(null);
  async function toggleArchive() {
    setError(null);
    try {
      await api(`/school/classes/${cls.id}`, {
        method: 'PATCH',
        body: { isActive: !cls.isActive },
      });
      onDone();
    } catch (e) {
      setError(toApiError(e));
    }
  }
  return (
    <Card>
      <CardBody>
        <h2 className="mb-3 font-semibold">{t('class.edit')}</h2>
        <SimpleForm
          // Remonté à chaque valeur enregistrée : un champ effacé ne revient jamais par l'état du formulaire.
          key={`${cls.name}-${cls.nameAr}-${cls.capacity}`}
          testId="class-edit-form"
          method="PATCH"
          // Vider la capacité ou le nom arabe les efface (« sans limite », aucun nom arabe).
          sendEmpty
          path={`/school/classes/${cls.id}`}
          submitLabel={t('common.save')}
          onDone={onDone}
          fields={fields([
            { name: 'name', label: t('field.class'), required: true, defaultValue: cls.name },
            {
              name: 'nameAr',
              label: t('structure.classAr'),
              rtl: true,
              defaultValue: cls.nameAr ?? '',
            },
            {
              name: 'capacity',
              label: t('field.capacity'),
              type: 'number',
              defaultValue: cls.capacity ? String(cls.capacity) : '',
            },
          ])}
        />
        <div className="mt-3 space-y-2">
          <ApiErrorAlert error={error} />
          <Button variant="secondary" size="sm" onClick={() => void toggleArchive()}>
            {cls.isActive ? t('class.archive') : t('class.unarchive')}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function Team({
  cls,
  teaching,
  page,
  open,
  onChange,
}: {
  cls: ClassDetail;
  teaching: AssignmentView[];
  page: SchoolPageApi;
  open: boolean;
  onChange: () => void;
}) {
  const { t, name } = useSchoolText();
  // Terminer reste possible sur une classe archivée ; créer et remplacer exigent une classe active.
  const canEnd = page.canWrite('school.teaching.manage');
  const canManage = open && cls.isActive && canEnd;
  const canReadHistory = hasSchoolPermission(page.context.role, 'school.teaching.read');
  const [error, setError] = useState<ApiError | null>(null);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [notice, setNotice] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const teachers = useApi<TeacherNames[]>(
    canManage ? `/school/teachers?schoolId=${cls.schoolId}&active=true` : null,
  );
  const history = useApi<AssignmentView[]>(
    showHistory ? `/school/teaching-assignments?classId=${cls.id}&history=true` : null,
  );
  const teacherOptions =
    teachers.state === 'success'
      ? teachers.data.map((m) => ({
          value: m.id,
          label: name({
            name: `${m.lastName} ${m.firstName}`,
            nameAr: [m.lastNameAr, m.firstNameAr].filter(Boolean).join(' ') || null,
          }),
        }))
      : [];

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      onChange();
    } catch (e) {
      setError(toApiError(e));
    }
  }
  const end = (id: string) =>
    run(() => api(`/school/teaching-assignments/${id}/end`, { method: 'POST', body: {} }));
  const revoke = (memberId: string) =>
    run(() => api(`/school/classes/${cls.id}/teachers/${memberId}`, { method: 'DELETE' }));

  return (
    <Card>
      <CardBody>
        <h2 className="font-semibold">{t('class.team')}</h2>
        <ApiErrorAlert error={error} />
        {notice && <Alert tone="info" title={t('class.outsideQualifications')} />}
        <ul className="divide-y divide-line/70" data-testid="class-team">
          {teaching.length === 0 && (
            <li className="py-3 text-sm text-muted">{t('class.noTeaching')}</li>
          )}
          {teaching.map((a) => (
            <AssignmentLine
              key={a.id}
              assignment={a}
              show="teacher"
              actions={
                canEnd && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" size="sm" onClick={() => void end(a.id)}>
                        {t('class.end')}
                      </Button>
                      {canManage && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setReplacing(replacing === a.id ? null : a.id)}
                        >
                          {t('class.replace')}
                        </Button>
                      )}
                    </div>
                    {replacing === a.id && (
                      <SimpleForm<AssignmentView>
                        testId="replace-form"
                        path={`/school/teaching-assignments/${a.id}/replace`}
                        submitLabel={t('class.confirmReplace')}
                        onDone={(result) => {
                          setReplacing(null);
                          setNotice(result.outsideQualifications === true);
                          onChange();
                        }}
                        fields={[
                          {
                            name: 'memberId',
                            label: t('class.replaceBy'),
                            type: 'select',
                            options: teacherOptions.filter((o) => o.value !== a.member.id),
                          },
                          { name: 'reason', label: t('class.reason') },
                        ]}
                      />
                    )}
                  </div>
                )
              }
            />
          ))}
        </ul>
        {cls.legacyAccess.length > 0 && (
          <div className="mt-3 space-y-2" data-testid="legacy-access">
            <h3 className="text-sm font-semibold">{t('class.legacyAccess')}</h3>
            <p className="text-sm text-muted">{t('class.legacyAccessHint')}</p>
            <ul className="space-y-2 text-sm">
              {cls.legacyAccess.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
                  <TeacherName teacher={m} />
                  {canEnd && (
                    <Button variant="secondary" size="sm" onClick={() => void revoke(m.id)}>
                      {t('class.revokeAccess')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {canManage && (
          <NewAssignment
            cls={cls}
            teacherOptions={teacherOptions}
            onDone={(result) => {
              setNotice(result.outsideQualifications === true);
              onChange();
            }}
          />
        )}
        {canReadHistory && (
          <Button
            className="mt-3"
            variant="secondary"
            size="sm"
            onClick={() => setShowHistory(!showHistory)}
          >
            {showHistory ? t('common.hideHistory') : t('common.showHistory')}
          </Button>
        )}
        {showHistory && history.state === 'success' && (
          <ul className="mt-2 divide-y divide-line/70" data-testid="class-team-history">
            {history.data
              .filter((a) => a.endedAt)
              .map((a) => (
                <AssignmentLine key={a.id} assignment={a} show="teacher" />
              ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/** Seules les matières actives enseignées au niveau de la classe sont proposées. */
function NewAssignment({
  cls,
  teacherOptions,
  onDone,
}: {
  cls: ClassDetail;
  teacherOptions: { value: string; label: string }[];
  onDone: (result: AssignmentView) => void;
}) {
  const { t, name } = useSchoolText();
  const subjects = useApi<(NamedView & { isActive: boolean; levels: { levelId: string }[] })[]>(
    `/school/subjects?schoolId=${cls.schoolId}`,
  );
  if (subjects.state !== 'success') return null;
  const forLevel = subjects.data.filter(
    (s) => s.isActive && s.levels.some((l) => l.levelId === cls.level.id),
  );
  const groups = cls.groups.filter((g) => g.isActive);
  return (
    <div className="mt-4 border-t border-line/70 pt-4">
      <h3 className="mb-2 text-sm font-semibold">{t('class.assignTitle')}</h3>
      {forLevel.length === 0 ? (
        <Alert tone="info">{t('class.noSubjectForLevel')}</Alert>
      ) : teacherOptions.length === 0 ? (
        <Alert tone="info">{t('class.noTeacherAvailable')}</Alert>
      ) : (
        <SimpleForm<AssignmentView>
          key={`${cls.teaching?.length}-${groups.length}`}
          testId="assignment-form"
          path="/school/teaching-assignments"
          extra={{ classId: cls.id }}
          submitLabel={t('class.assign')}
          onDone={onDone}
          fields={[
            {
              name: 'subjectId',
              label: t('class.subject'),
              type: 'select',
              options: forLevel.map((s) => ({ value: s.id, label: name(s) })),
            },
            {
              name: 'groupId',
              label: t('class.group'),
              type: 'select',
              options: [
                { value: '', label: t('class.wholeClass') },
                ...groups.map((g) => ({ value: g.id, label: name(g) })),
              ],
            },
            {
              name: 'memberId',
              label: t('class.teacher'),
              type: 'select',
              options: teacherOptions,
            },
            { name: 'isHomeroom', label: t('class.homeroom'), type: 'checkbox' },
          ]}
        />
      )}
    </div>
  );
}

function Groups({
  cls,
  students,
  canManage,
  onChange,
}: {
  cls: ClassDetail;
  students: RosterStudent[];
  canManage: boolean;
  onChange: () => void;
}) {
  const { t, fields } = useSchoolText();
  const groups = useApi<GroupView[]>(`/school/classes/${cls.id}/groups`);
  const reload = () => {
    groups.reload();
    onChange();
  };
  return (
    <Card>
      <CardBody>
        <h2 className="mb-2 font-semibold">{t('class.groups')}</h2>
        {groups.state === 'success' && (
          <ul className="space-y-3" data-testid="class-groups">
            {groups.data.length === 0 && (
              <li className="text-sm text-muted">{t('class.noGroup')}</li>
            )}
            {groups.data.map((g) => (
              <GroupCard
                key={g.id}
                group={g}
                students={students}
                canManage={canManage}
                onDone={reload}
              />
            ))}
          </ul>
        )}
        {canManage && cls.isActive && (
          <div className="mt-4 border-t border-line/70 pt-4">
            <SimpleForm
              testId="group-form"
              path={`/school/classes/${cls.id}/groups`}
              submitLabel={t('class.addGroup')}
              onDone={reload}
              fields={fields([
                { name: 'name', label: t('class.groupName'), required: true },
                { name: 'nameAr', label: t('class.groupNameAr'), rtl: true },
              ])}
            />
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function GroupCard({
  group,
  students,
  canManage,
  onDone,
}: {
  group: GroupView;
  students: RosterStudent[];
  canManage: boolean;
  onDone: () => void;
}) {
  const { t } = useSchoolText();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(() => new Set(group.students.map((s) => s.student.id)));
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api(`/school/groups/${group.id}/students`, {
        method: 'PUT',
        body: { studentIds: [...selected] },
      });
      setEditing(false);
      onDone();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <li className="rounded-xl border border-line/70 p-3" data-testid="class-group">
      <p className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          <BiName name={group.name} nameAr={group.nameAr} />
        </span>
        <span className="text-sm text-muted">
          {t('class.studentsCount', { n: group.students.length })}
        </span>
      </p>
      {!editing && group.students.length > 0 && (
        <p className="mt-1 text-sm text-muted">
          {group.students.map((s, i) => (
            <span key={s.student.id}>
              {i > 0 && ' · '}
              <StudentName student={s.student} />
            </span>
          ))}
        </p>
      )}
      {canManage && !editing && (
        <Button className="mt-2" variant="secondary" size="sm" onClick={() => setEditing(true)}>
          {t('class.groupStudents')}
        </Button>
      )}
      {editing && (
        <div className="mt-2 space-y-2">
          <ApiErrorAlert error={error} />
          <div className="grid gap-1 sm:grid-cols-2">
            {students.map((s) => (
              <label key={s.id} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-forest"
                  checked={selected.has(s.id)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(s.id);
                    else next.delete(s.id);
                    setSelected(next);
                  }}
                />
                <StudentName student={s} />
              </label>
            ))}
          </div>
          <Button size="sm" loading={saving} onClick={() => void save()}>
            {t('class.saveGroupStudents')}
          </Button>
        </div>
      )}
    </li>
  );
}

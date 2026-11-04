'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { hasSchoolPermission } from '@ocall/shared';
import { useSchoolText } from '@/components/school/school-language';
import { SchoolPage } from '@/components/school/school-page';
import type { NamedView } from '@/components/school/school-students';
import { TeacherName, type TeacherNames } from '@/components/school/school-teaching';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

interface TeacherRow extends TeacherNames {
  loginId: string;
  subjects: NamedView[];
  teaching: { class: NamedView; subject: NamedView; group: NamedView | null }[];
}

export default function EnseignantsPage() {
  return (
    <SchoolPage title="teachers.title" description="teachers.desc">
      {({ school, context }) =>
        hasSchoolPermission(context.role, 'school.teaching.read') ? (
          <Teachers key={school!.id} schoolId={school!.id} />
        ) : (
          <Unavailable />
        )
      }
    </SchoolPage>
  );
}

function Unavailable() {
  const { t } = useSchoolText();
  return (
    <Alert tone="info" title={t('teachers.unavailableTitle')}>
      {t('teachers.unavailable')}
    </Alert>
  );
}

function Teachers({ schoolId }: { schoolId: string }) {
  const { t, name } = useSchoolText();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [subjectId, setSubject] = useState('');
  const [active, setActive] = useState('true');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(q), 300);
    return () => clearTimeout(timer);
  }, [q]);
  const subjects = useApi<(NamedView & { isActive: boolean })[]>(
    `/school/subjects?schoolId=${schoolId}`,
  );
  const params = new URLSearchParams({ schoolId });
  if (search) params.set('q', search);
  if (subjectId) params.set('subjectId', subjectId);
  if (active) params.set('active', active);
  const teachers = useApi<TeacherRow[]>(`/school/teachers?${params}`);

  return (
    <>
      <Card>
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-3">
            <InputField
              label={t('teachers.search')}
              dir="auto"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <SelectField
              label={t('class.subject')}
              value={subjectId}
              onChange={(e) => setSubject(e.target.value)}
              options={[
                { value: '', label: t('teachers.allSubjects') },
                ...(subjects.state === 'success'
                  ? subjects.data
                      .filter((s) => s.isActive)
                      .map((s) => ({ value: s.id, label: name(s) }))
                  : []),
              ]}
            />
            <SelectField
              label={t('teachers.state')}
              value={active}
              onChange={(e) => setActive(e.target.value)}
              options={[
                { value: 'true', label: t('teachers.activeOnly') },
                { value: 'false', label: t('teachers.inactiveOnly') },
                { value: '', label: t('common.all') },
              ]}
            />
          </div>
          <p className="mt-3 text-sm text-muted">{t('teachers.createHint')}</p>
        </CardBody>
      </Card>
      {teachers.state === 'loading' && <LoadingState />}
      {teachers.state === 'error' && (
        <ErrorState error={teachers.error} onRetry={teachers.reload} />
      )}
      {teachers.state === 'success' && (
        <Card>
          <ul className="divide-y divide-line/70 text-sm" data-testid="teacher-list">
            {teachers.data.length === 0 && (
              <li className="px-4 py-6 text-center text-muted">{t('teachers.empty')}</li>
            )}
            {teachers.data.map((teacher) => (
              <li key={teacher.id} data-testid="teacher-row">
                <Link
                  href={`/school/enseignants/${teacher.id}`}
                  className="block space-y-1 px-4 py-3 hover:bg-ivory"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      <TeacherName teacher={teacher} />
                    </span>
                    {!teacher.isActive && <Badge tone="neutral">{t('common.inactive')}</Badge>}
                  </span>
                  <span className="block text-muted">
                    {teacher.subjects.map(name).join(' · ') || '—'}
                  </span>
                  <span className="block text-muted">
                    {t('teachers.assignments', { n: teacher.teaching.length })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

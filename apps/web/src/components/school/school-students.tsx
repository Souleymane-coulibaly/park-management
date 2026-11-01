'use client';

import type { ReactNode } from 'react';
import type { SchoolEnrollmentStatus, SchoolStudentStatus, SchoolYearStatus } from '@ocall/shared';
import { SCHOOL_STUDENT_STATUS_LABELS } from '@ocall/shared';
import { Badge } from '@/components/ui/badge';
import { useApi } from '@/lib/use-api';

export interface NamedView {
  id: string;
  name: string;
  nameAr: string | null;
}

export interface StudentRow {
  id: string;
  schoolId: string;
  matricule: string;
  lastName: string;
  firstName: string;
  lastNameAr: string | null;
  firstNameAr: string | null;
  status: SchoolStudentStatus;
  enrollment: {
    id: string;
    status: SchoolEnrollmentStatus;
    schoolYearId: string;
    level: NamedView;
    class: NamedView | null;
  } | null;
}

export interface YearOption {
  id: string;
  label: string;
  status: SchoolYearStatus;
}

export interface LevelOption extends NamedView {
  cycleName: string;
}

export interface ClassOption extends NamedView {
  level: NamedView;
}

/** Nom complet en français, et en arabe de droite à gauche quand il existe. */
export function StudentName({
  student,
}: {
  student: Pick<StudentRow, 'lastName' | 'firstName' | 'lastNameAr' | 'firstNameAr'>;
}) {
  const arabic = [student.lastNameAr, student.firstNameAr].filter(Boolean).join(' ');
  return (
    <>
      <span>
        {student.lastName} {student.firstName}
      </span>
      {arabic && (
        <span
          dir="rtl"
          lang="ar"
          data-testid="arabic-name"
          className="mx-2 inline-block text-charcoal-soft"
        >
          {arabic}
        </span>
      )}
    </>
  );
}

export function StudentStatusBadge({ status }: { status: SchoolStudentStatus }) {
  return (
    <Badge tone={status === 'ENROLLED' ? 'forest' : 'neutral'}>
      {SCHOOL_STUDENT_STATUS_LABELS[status]}
    </Badge>
  );
}

/** Années d'un établissement, la plus récente d'abord ; les années clôturées restent consultables. */
export function useYears(schoolId: string) {
  return useApi<YearOption[]>(`/school/years?schoolId=${schoolId}`);
}

/** Niveaux d'un établissement, tous cycles confondus. */
export function useLevels(schoolId: string) {
  const cycles = useApi<{ name: string; levels: NamedView[] }[]>(
    `/school/cycles?schoolId=${schoolId}`,
  );
  const levels: LevelOption[] =
    cycles.state === 'success'
      ? cycles.data.flatMap((c) => c.levels.map((l) => ({ ...l, cycleName: c.name })))
      : [];
  return levels;
}

export function useClasses(schoolYearId: string | null) {
  const classes = useApi<ClassOption[]>(
    schoolYearId ? `/school/classes?schoolYearId=${schoolYearId}` : null,
  );
  return classes.state === 'success' ? classes.data : [];
}

/** Valeur étiquetée d'une fiche. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children || '—'}</dd>
    </div>
  );
}

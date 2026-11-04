'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { SchoolYearStatus } from '@ocall/shared';
import { Badge } from '@/components/ui/badge';
import { useSchoolText } from './school-language';
import { BiName } from './school-page';
import type { NamedView } from './school-students';

export interface TeacherNames {
  id: string;
  firstName: string;
  lastName: string;
  firstNameAr: string | null;
  lastNameAr: string | null;
  isActive: boolean;
}

/** Affectation telle que l'API la restitue (Sprint 3B). */
export interface AssignmentView {
  id: string;
  isHomeroom: boolean;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  class: NamedView & {
    year: { id: string; label: string; status: SchoolYearStatus; schoolId: string };
  };
  group: NamedView | null;
  subject: NamedView;
  member: TeacherNames;
  outsideQualifications?: boolean;
}

/** Nom d'un enseignant, restitué selon la langue de l'établissement comme tout autre nom. */
export function TeacherName({ teacher }: { teacher: TeacherNames }) {
  const arabic = [teacher.lastNameAr, teacher.firstNameAr].filter(Boolean).join(' ');
  return <BiName name={`${teacher.lastName} ${teacher.firstName}`} nameAr={arabic || null} />;
}

/**
 * Une affectation : matière, classe entière ou groupe, enseignant (ou classe, selon la vue), dates. Les
 * actions éventuelles (terminer, remplacer) sont fournies par l'écran.
 */
export function AssignmentLine({
  assignment: a,
  show,
  actions,
}: {
  assignment: AssignmentView;
  /** Ce qui identifie la ligne dans cette vue : l'enseignant (fiche classe) ou la classe (fiche enseignant). */
  show: 'teacher' | 'class';
  actions?: ReactNode;
}) {
  const { t, name, date } = useSchoolText();
  return (
    <li className="space-y-1 py-3" data-testid="assignment">
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{name(a.subject)}</span>
        <span className="text-muted">· {a.group ? name(a.group) : t('class.wholeClass')}</span>
        {a.isHomeroom && <Badge tone="savanna">{t('class.homeroom')}</Badge>}
        {!a.member.isActive && show === 'teacher' && (
          <Badge tone="neutral">{t('common.inactive')}</Badge>
        )}
      </p>
      <p className="text-sm">
        {show === 'teacher' ? (
          <Link href={`/school/enseignants/${a.member.id}`} className="text-forest hover:underline">
            <TeacherName teacher={a.member} />
          </Link>
        ) : (
          <Link href={`/school/classes/${a.class.id}`} className="text-forest hover:underline">
            <BiName name={a.class.name} nameAr={a.class.nameAr} />
          </Link>
        )}
        <span className="text-muted">
          {' · '}
          {a.endedAt
            ? t('class.period', { from: date(a.startedAt), to: date(a.endedAt) })
            : t('class.since', { date: date(a.startedAt) })}
          {show === 'class' ? ` · ${a.class.year.label}` : ''}
          {a.endReason ? ` · ${a.endReason}` : ''}
        </span>
      </p>
      {actions}
    </li>
  );
}

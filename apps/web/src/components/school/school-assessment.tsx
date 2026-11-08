'use client';

import { type ReactNode, useEffect, useState } from 'react';
import type {
  ClassResults,
  QuranStatus,
  SchoolEvaluationKind,
  SchoolGradeStatus,
  SchoolGradingRules,
  SchoolPeriodKind,
} from '@ocall/shared';
import { Badge } from '@/components/ui/badge';
import { SelectField } from '@/components/ui/field';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useSchoolText } from './school-language';
import type { ClassOption, NamedView, YearOption } from './school-students';

/** Évaluations, notes, bulletins et mémorisation (Sprint 4) : éléments communs des écrans. */

export interface PeriodView {
  id: string;
  kind: SchoolPeriodKind;
  label: string;
  labelAr: string | null;
  position: number;
  startsOn: string;
  endsOn: string;
}

export interface YearWithPeriods extends YearOption {
  startsOn: string;
  endsOn: string;
  periods: PeriodView[];
}

export interface Selection {
  year: YearWithPeriods;
  classId: string;
  periodId: string;
  className: string;
  levelId: string;
}

export interface RosterStudentView {
  id: string;
  matricule: string;
  lastName: string;
  firstName: string;
  lastNameAr: string | null;
  firstNameAr: string | null;
}

export interface EvaluationView {
  id: string;
  /** Établissement de l'évaluation (droits de la saisie selon son contrat). */
  schoolId?: string;
  classId: string;
  periodId: string;
  groupId: string | null;
  kind: SchoolEvaluationKind;
  title: string;
  titleAr: string | null;
  heldOn: string;
  maxScore: number;
  coefficient: number;
  subject: NamedView;
  group: NamedView | null;
  graded?: number;
}

export interface ResultsView {
  validation: { id: string; validatedAt: string; validatedByUserId: string } | null;
  rules: SchoolGradingRules;
  subjects: (NamedView & { coefficient: number })[];
  students: (RosterStudentView & { groupIds: string[] })[];
  results: ClassResults;
  appreciations: { subjectId: string; studentId: string; text: string; textAr: string | null }[];
  /** Élèves dont l'utilisateur peut rédiger l'appréciation, par matière. */
  appreciationStudents: Record<string, string[]>;
  restricted: boolean;
}

/** Année en cours d'abord, puis la plus récente. */
function defaultYear(years: YearWithPeriods[]): YearWithPeriods | undefined {
  return years.find((y) => y.status === 'ACTIVE') ?? years[0];
}

/** Période qui contient aujourd'hui, sinon la dernière commencée, sinon la première. */
function defaultPeriod(periods: PeriodView[]): PeriodView | undefined {
  const today = new Date().toISOString().slice(0, 10);
  return (
    periods.find((p) => p.startsOn.slice(0, 10) <= today && today <= p.endsOn.slice(0, 10)) ??
    [...periods].reverse().find((p) => p.startsOn.slice(0, 10) <= today) ??
    periods[0]
  );
}

/**
 * Choix de l'année, de la classe et de la période. L'enseignant ne reçoit de l'API que ses classes.
 * `withPeriod` à faux : année et classe seulement (mémorisation).
 */
export function ClassPeriodPicker({
  schoolId,
  withPeriod = true,
  children,
}: {
  schoolId: string;
  withPeriod?: boolean;
  children: (selection: Selection) => ReactNode;
}) {
  const { t, name } = useSchoolText();
  const years = useApi<YearWithPeriods[]>(`/school/years?schoolId=${schoolId}`);
  const [yearId, setYearId] = useState('');
  const [classId, setClassId] = useState('');
  const [periodId, setPeriodId] = useState('');
  const year =
    years.state === 'success'
      ? (years.data.find((y) => y.id === yearId) ?? defaultYear(years.data))
      : undefined;
  const classes = useApi<ClassOption[]>(year ? `/school/classes?schoolYearId=${year.id}` : null);
  const classList = classes.state === 'success' ? classes.data : [];
  const cls = classList.find((c) => c.id === classId) ?? classList[0];
  const period = year
    ? (year.periods.find((p) => p.id === periodId) ?? defaultPeriod(year.periods))
    : undefined;

  useEffect(() => {
    setClassId('');
    setPeriodId('');
  }, [yearId]);

  if (years.state === 'loading') return <LoadingState />;
  if (years.state === 'error') return <ErrorState error={years.error} onRetry={years.reload} />;
  if (!year) return <Alert tone="info" title={t('pick.noYear')} />;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3" data-testid="class-period-picker">
        <SelectField
          label={t('pick.year')}
          value={year.id}
          onChange={(e) => setYearId(e.target.value)}
          options={years.data.map((y) => ({ value: y.id, label: y.label }))}
        />
        <SelectField
          label={t('pick.class')}
          value={cls?.id ?? ''}
          onChange={(e) => setClassId(e.target.value)}
          options={classList.map((c) => ({ value: c.id, label: name(c) }))}
        />
        {withPeriod && (
          <SelectField
            label={t('pick.period')}
            value={period?.id ?? ''}
            onChange={(e) => setPeriodId(e.target.value)}
            options={year.periods.map((p) => ({
              value: p.id,
              label: name({ name: p.label, nameAr: p.labelAr }),
            }))}
          />
        )}
      </div>
      {classes.state === 'loading' ? (
        <LoadingState />
      ) : !cls ? (
        <Alert tone="info" title={t('pick.noClass')} />
      ) : withPeriod && !period ? (
        <Alert tone="info" title={t('pick.noPeriod')} />
      ) : (
        children({
          year,
          classId: cls.id,
          periodId: period?.id ?? '',
          className: name(cls),
          levelId: cls.level.id,
        })
      )}
    </div>
  );
}

/** Note ou moyenne au format de la langue, décimales fixes ; tiret sans valeur. */
export function useScore() {
  const { language } = useSchoolText();
  return (value: number | null | undefined, decimals = 2) =>
    value === null || value === undefined
      ? '–'
      : value.toLocaleString(language === 'ar' ? 'ar-u-nu-latn' : 'fr-FR', {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        });
}

export function GradeStatusBadge({ status }: { status: SchoolGradeStatus | null }) {
  const { t } = useSchoolText();
  if (!status) return <Badge tone="neutral">{t('grade.NONE')}</Badge>;
  return (
    <Badge tone={status === 'SCORED' ? 'forest' : status === 'ABSENT' ? 'terracotta' : 'savanna'}>
      {t(`grade.${status}`)}
    </Badge>
  );
}

const QURAN_TONES: Record<QuranStatus, 'neutral' | 'savanna' | 'forest' | 'terracotta'> = {
  NOT_STARTED: 'neutral',
  IN_PROGRESS: 'savanna',
  MEMORIZED: 'forest',
  TO_REVIEW: 'terracotta',
};

export function QuranStatusBadge({ status }: { status: QuranStatus }) {
  const { t } = useSchoolText();
  return <Badge tone={QURAN_TONES[status]}>{t(`qstatus.${status}`)}</Badge>;
}

/**
 * Téléchargement d'un PDF de l'API avec la session : le fichier n'a pas d'adresse publique, il est
 * produit à la demande puis remis au navigateur.
 */
export async function downloadPdf(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(`/api/v1${path}`, { credentials: 'same-origin', cache: 'no-store' });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    throw new ApiError(res.status, err.code ?? 'ERROR', err.message ?? 'Une erreur est survenue.');
  }
  const blob = await res.blob();
  const match = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = match?.[1] ?? fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

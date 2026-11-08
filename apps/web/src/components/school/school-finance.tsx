'use client';

import { type ReactNode, useState } from 'react';
import {
  type SchoolChargeStatus,
  type SchoolCurrency,
  type SchoolFeeCategory,
  type SchoolPaymentMethod,
  type SchoolPlanKind,
  formatAmount,
  parseAmount,
} from '@ocall/shared';
import { Badge } from '@/components/ui/badge';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';
import { useSchoolText } from './school-language';
import type { ClassOption, NamedView, YearOption } from './school-students';

/** Gestion financière (Sprint 5) : éléments communs des écrans. */

export interface FinanceSettingsView {
  currency: SchoolCurrency;
  receiptPrefix: string;
  secretaryCanCollect: boolean;
}

export interface StudentNames {
  id: string;
  matricule: string;
  lastName: string;
  firstName: string;
  lastNameAr: string | null;
  firstNameAr: string | null;
}

export interface ChargeRow {
  id: string;
  feeId: string;
  category: SchoolFeeCategory;
  label: string;
  labelAr: string | null;
  dueOn: string;
  amount: number;
  discount: number;
  adjustment: number;
  paid: number;
  due: number;
  balance: number;
  status: SchoolChargeStatus;
  adjustments: { id: string; amount: number; reason: string; createdAt: string }[];
}

export interface FeeView {
  id: string;
  category: SchoolFeeCategory;
  name: string;
  nameAr: string | null;
  amount: number;
  currency: SchoolCurrency;
  effectiveFrom: string;
  mandatory: boolean;
  isActive: boolean;
  planKind: SchoolPlanKind;
  installments: { position: number; dueOn: string; amount: number }[];
  level: NamedView | null;
  class: NamedView | null;
  charges: number;
}

export interface PaymentRow {
  id: string;
  kind: 'PAYMENT' | 'REVERSAL';
  amount: number;
  currency: SchoolCurrency;
  method: SchoolPaymentMethod;
  reference: string | null;
  verification: 'NOT_APPLICABLE' | 'DECLARED_UNVERIFIED';
  paidAt: string;
  receiptNumber: string | null;
  status: 'CONFIRMED' | 'CANCELLED';
  cancelReason: string | null;
  student?: StudentNames;
  allocations?: { chargeId: string; amount: number }[];
}

/** Montant affiché dans la devise de l'établissement. */
export function useMoney(currency: SchoolCurrency | undefined) {
  return (minor: number | null | undefined) =>
    minor === null || minor === undefined ? '–' : formatAmount(minor, currency ?? 'XOF');
}

export function Money({ value, currency }: { value: number; currency: SchoolCurrency }) {
  return (
    <span dir="ltr" className="whitespace-nowrap tabular-nums">
      {formatAmount(value, currency)}
    </span>
  );
}

/** Saisie d'un montant : texte libre converti en unités mineures, jamais en nombre à virgule. */
export function AmountField({
  label,
  currency,
  value,
  onChange,
}: {
  label: string;
  currency: SchoolCurrency;
  value: string;
  onChange: (text: string, minor: number | null) => void;
}) {
  const { t } = useSchoolText();
  const minor = value.trim() ? parseAmount(value, currency) : null;
  return (
    <InputField
      label={`${label} (${currency})`}
      inputMode="decimal"
      dir="ltr"
      value={value}
      error={value.trim() && minor === null ? t('fin.amountInvalid') : undefined}
      onChange={(e) =>
        onChange(
          e.target.value,
          e.target.value.trim() ? parseAmount(e.target.value, currency) : null,
        )
      }
    />
  );
}

const STATUS_TONES: Record<SchoolChargeStatus, 'forest' | 'savanna' | 'terracotta' | 'neutral'> = {
  PAID: 'forest',
  PARTIAL: 'savanna',
  OVERDUE: 'terracotta',
  UPCOMING: 'neutral',
};

export function ChargeStatusBadge({ status }: { status: SchoolChargeStatus }) {
  const { t } = useSchoolText();
  return <Badge tone={STATUS_TONES[status]}>{t(`fin.status.${status}`)}</Badge>;
}

/** Réglages financiers de l'établissement (devise, préfixe des reçus). */
export function useFinanceSettings(schoolId: string | null) {
  return useApi<FinanceSettingsView>(
    schoolId ? `/school/finance/settings?schoolId=${schoolId}` : null,
  );
}

/** Choix de l'année scolaire (en cours par défaut). */
export function YearPicker({
  schoolId,
  children,
}: {
  schoolId: string;
  children: (year: YearOption) => ReactNode;
}) {
  const { t } = useSchoolText();
  const years = useApi<YearOption[]>(`/school/years?schoolId=${schoolId}`);
  const [yearId, setYearId] = useState('');
  if (years.state === 'loading') return <LoadingState />;
  if (years.state === 'error') return <ErrorState error={years.error} onRetry={years.reload} />;
  const year =
    years.data.find((y) => y.id === yearId) ??
    years.data.find((y) => y.status === 'ACTIVE') ??
    years.data[0];
  if (!year) return <Alert tone="info" title={t('pick.noYear')} />;
  return (
    <div className="space-y-4">
      <div className="max-w-xs">
        <SelectField
          label={t('pick.year')}
          value={year.id}
          onChange={(e) => setYearId(e.target.value)}
          options={years.data.map((y) => ({ value: y.id, label: y.label }))}
        />
      </div>
      {children(year)}
    </div>
  );
}

const LEAVERS = 'leavers';

/**
 * Choix d'une classe puis d'un élève de l'année. `includeLeavers` : un groupe de plus pour les élèves
 * sortis qui doivent encore une échéance dans l'établissement (situation et caisse), retrouvés par
 * recherche quand ils sont nombreux.
 */
export function StudentPicker({
  schoolYearId,
  includeLeavers = false,
  children,
}: {
  schoolYearId: string;
  includeLeavers?: boolean;
  children: (student: StudentNames) => ReactNode;
}) {
  const { t, name } = useSchoolText();
  const classes = useApi<ClassOption[]>(`/school/classes?schoolYearId=${schoolYearId}`);
  const [search, setSearch] = useState('');
  const leavers = useApi<{ items: StudentNames[]; truncated: boolean }>(
    includeLeavers
      ? `/school/finance/leavers?${new URLSearchParams({ schoolYearId, ...(search.trim() ? { q: search.trim() } : {}) }).toString()}`
      : null,
  );
  const [classId, setClassId] = useState('');
  const [studentId, setStudentId] = useState('');
  const list = classes.state === 'success' ? classes.data : [];
  const leaving = leavers.state === 'success' ? leavers.data.items : [];
  // Groupe proposé s'il existe des élèves sortis débiteurs, pendant une recherche, ou pour signaler une panne.
  const leaversOffered =
    includeLeavers && (leaving.length > 0 || search.trim() !== '' || leavers.state === 'error');
  const showLeavers = classId === LEAVERS && leaversOffered;
  const cls = showLeavers ? undefined : (list.find((c) => c.id === classId) ?? list[0]);
  const roster = useApi<{ students: StudentNames[] }>(
    cls ? `/school/classes/${cls.id}/students` : null,
  );
  const students = showLeavers ? leaving : roster.state === 'success' ? roster.data.students : [];
  const student = students.find((s) => s.id === studentId);
  const label = (s: StudentNames) => {
    const arabic = [s.lastNameAr, s.firstNameAr].filter(Boolean).join(' ');
    return name({ name: `${s.lastName} ${s.firstName}`, nameAr: arabic || null });
  };
  if (classes.state === 'loading') return <LoadingState />;
  if (classes.state === 'error')
    return <ErrorState error={classes.error} onRetry={classes.reload} />;
  if (!cls && !showLeavers && !leaversOffered) {
    return <Alert tone="info" title={t('pick.noClass')} />;
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2" data-testid="student-picker">
        <SelectField
          label={t('pick.class')}
          value={showLeavers ? LEAVERS : (cls?.id ?? '')}
          onChange={(e) => {
            setClassId(e.target.value);
            setStudentId('');
          }}
          options={[
            ...list.map((c) => ({ value: c.id, label: name(c) })),
            ...(leaversOffered ? [{ value: LEAVERS, label: t('fin.leavers') }] : []),
          ]}
        />
        <SelectField
          label={t('grades.student')}
          value={student?.id ?? ''}
          onChange={(e) => setStudentId(e.target.value)}
          options={[
            { value: '', label: t('fin.chooseStudent') },
            ...students.map((s) => ({ value: s.id, label: `${label(s)} · ${s.matricule}` })),
          ]}
        />
      </div>
      {!showLeavers && roster.state === 'error' && (
        <ErrorState error={roster.error} onRetry={roster.reload} />
      )}
      {showLeavers && (
        <div className="max-w-md space-y-2" data-testid="leavers-search">
          <InputField
            label={t('fin.leavers.search')}
            value={search}
            maxLength={80}
            onChange={(e) => {
              setSearch(e.target.value);
              setStudentId('');
            }}
          />
          {leavers.state === 'error' && (
            <ErrorState error={leavers.error} onRetry={leavers.reload} />
          )}
          {leavers.state === 'success' && leavers.data.truncated && (
            <p className="text-xs text-muted">{t('fin.leavers.refine')}</p>
          )}
        </div>
      )}
      {student ? children(student) : null}
    </div>
  );
}

'use client';

import {
  SCHOOL_BENEFIT_KINDS,
  SCHOOL_FEE_CATEGORIES,
  type SchoolBenefitKind,
  type SchoolCurrency,
  parseAmount,
} from '@ocall/shared';
import { useState } from 'react';
import {
  AmountField,
  Money,
  StudentPicker,
  type StudentNames,
  YearPicker,
  useFinanceSettings,
} from '@/components/school/school-finance';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { SchoolPage } from '@/components/school/school-page';
import { StudentName } from '@/components/school/school-students';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface BenefitRow {
  id: string;
  kind: SchoolBenefitKind;
  value: number;
  category: string | null;
  reason: string;
  status: 'ACTIVE' | 'REVOKED';
  createdAt: string;
  revokeReason: string | null;
  student: StudentNames;
  fee: { id: string; name: string; nameAr: string | null } | null;
}

/**
 * Réductions et bourses (Sprint 5) : réduction fixe ou en pourcentage, bourse, exonération, réduction
 * familiale. Chaque avantage est justifié, accordé par la direction et tracé ; il apparaît distinctement
 * des encaissements.
 */
export default function BenefitsPage() {
  return (
    <SchoolPage title="fin.benefits.title" description="fin.benefits.desc">
      {({ school, canWrite }) => (
        <YearPicker key={school!.id} schoolId={school!.id}>
          {(year) => (
            <Benefits
              key={year.id}
              schoolId={school!.id}
              yearId={year.id}
              canManage={canWrite('school.finance.benefits')}
            />
          )}
        </YearPicker>
      )}
    </SchoolPage>
  );
}

function Benefits({
  schoolId,
  yearId,
  canManage,
}: {
  schoolId: string;
  yearId: string;
  canManage: boolean;
}) {
  const { t, name, date } = useSchoolText();
  const settings = useFinanceSettings(schoolId);
  const list = useApi<BenefitRow[]>(`/school/finance/benefits?schoolYearId=${yearId}`);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const value = (b: BenefitRow) =>
    b.kind === 'EXEMPTION'
      ? '100 %'
      : b.kind === 'FIXED'
        ? null
        : `${(b.value / 100).toLocaleString('fr-FR')} %`;

  async function revoke(id: string) {
    setError(null);
    try {
      await api(`/school/finance/benefits/${id}/revoke`, { method: 'POST', body: { reason } });
      setRevoking(null);
      setReason('');
      list.reload();
    } catch (e) {
      setError(toApiError(e));
    }
  }

  // Aucune saisie ni aucun montant avant la devise réelle de l'établissement : une réduction fixe
  // n'est jamais convertie avec une devise provisoire.
  if (settings.state === 'loading' || list.state === 'loading') return <LoadingState />;
  if (settings.state === 'error') {
    return <ErrorState error={settings.error} onRetry={settings.reload} />;
  }
  if (list.state === 'error') return <ErrorState error={list.error} onRetry={list.reload} />;
  const currency = settings.data.currency;
  return (
    <>
      <ApiErrorAlert error={error} />
      <Card>
        <ul className="divide-y divide-line/70" data-testid="benefit-list">
          {list.data.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted">{t('fin.benefits.empty')}</li>
          )}
          {list.data.map((b) => (
            <li key={b.id} className="space-y-2 px-4 py-3 text-sm" data-testid="benefit">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  <StudentName student={b.student} />
                </span>
                <Badge tone="savanna">{t(`fin.benefit.${b.kind}`)}</Badge>
                <span className="font-semibold">
                  {value(b) ?? <Money value={b.value} currency={currency} />}
                </span>
                <span className="text-muted">
                  {b.fee
                    ? name(b.fee)
                    : b.category
                      ? t(`fin.cat.${b.category as 'TUITION'}`)
                      : t('fin.allFees')}
                </span>
                {b.status === 'REVOKED' && <Badge tone="terracotta">{t('fin.revoked')}</Badge>}
                {canManage && b.status === 'ACTIVE' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ms-auto"
                    onClick={() => setRevoking(revoking === b.id ? null : b.id)}
                  >
                    {t('fin.revoke')}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted">
                {date(b.createdAt)} · {b.reason}
                {b.revokeReason ? ` · ${b.revokeReason}` : ''}
              </p>
              {revoking === b.id && (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-60 flex-1">
                    <InputField
                      label={t('fin.reason')}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </div>
                  <Button
                    variant="danger"
                    disabled={reason.trim().length < 3}
                    onClick={() => void revoke(b.id)}
                  >
                    {t('fin.revoke')}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {canManage && (
        <Card>
          <CardBody>
            <h2 className="mb-3 font-semibold">{t('fin.benefits.new')}</h2>
            <StudentPicker schoolYearId={yearId}>
              {(student) => (
                <GrantForm
                  key={`${student.id}-${currency}`}
                  studentId={student.id}
                  yearId={yearId}
                  currency={currency}
                  onGranted={list.reload}
                />
              )}
            </StudentPicker>
          </CardBody>
        </Card>
      )}
    </>
  );
}

function GrantForm({
  studentId,
  yearId,
  currency,
  onGranted,
}: {
  studentId: string;
  yearId: string;
  currency: SchoolCurrency;
  onGranted: () => void;
}) {
  const { t } = useSchoolText();
  const [kind, setKind] = useState<SchoolBenefitKind>('SCHOLARSHIP');
  const [percent, setPercent] = useState('50');
  const [amountText, setAmountText] = useState('');
  const [category, setCategory] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const rate = Math.round(Number(percent.replace(',', '.')) * 100);
  // Montant dérivé du texte et de la devise courants, jamais mémorisé.
  const amount = amountText.trim() ? parseAmount(amountText, currency) : null;
  const value =
    kind === 'EXEMPTION' ? 0 : kind === 'FIXED' ? amount : Number.isFinite(rate) ? rate : null;

  async function grant() {
    setLoading(true);
    setError(null);
    try {
      await api('/school/finance/benefits', {
        method: 'POST',
        body: { studentId, schoolYearId: yearId, kind, value, category: category || null, reason },
      });
      setReason('');
      onGranted();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-3 space-y-3" data-testid="benefit-form">
      <ApiErrorAlert error={error} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField
          label={t('fin.benefitKind')}
          value={kind}
          onChange={(e) => setKind(e.target.value as SchoolBenefitKind)}
          options={SCHOOL_BENEFIT_KINDS.map((k) => ({ value: k, label: t(`fin.benefit.${k}`) }))}
        />
        {kind === 'FIXED' ? (
          <AmountField
            label={t('fin.perInstallment')}
            currency={currency}
            value={amountText}
            onChange={(v) => setAmountText(v)}
          />
        ) : kind !== 'EXEMPTION' ? (
          <InputField
            label={t('fin.percent')}
            inputMode="decimal"
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
          />
        ) : null}
        <SelectField
          label={t('fin.category')}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          options={[
            { value: '', label: t('fin.allFees') },
            ...SCHOOL_FEE_CATEGORIES.map((c) => ({ value: c, label: t(`fin.cat.${c}`) })),
          ]}
        />
        <InputField
          label={t('fin.reason')}
          value={reason}
          maxLength={300}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <Button
        loading={loading}
        disabled={value === null || reason.trim().length < 3}
        onClick={() => void grant()}
      >
        {t('fin.grant')}
      </Button>
    </div>
  );
}

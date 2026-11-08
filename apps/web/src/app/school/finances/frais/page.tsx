'use client';

import {
  SCHOOL_FEE_CATEGORIES,
  SCHOOL_PLAN_KINDS,
  type SchoolCurrency,
  type SchoolFeeCategory,
  type SchoolPlanKind,
} from '@ocall/shared';
import { useState } from 'react';
import {
  AmountField,
  type FeeView,
  Money,
  YearPicker,
  useFinanceSettings,
} from '@/components/school/school-finance';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { SchoolPage } from '@/components/school/school-page';
import type { ClassOption } from '@/components/school/school-students';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface FeeEvent {
  id: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  createdAt: string;
}

/** Catalogue des frais (Sprint 5) : tarifs par année, niveau ou classe, échéancier, historique. */
export default function FeesPage() {
  return (
    <SchoolPage title="fin.fees.title" description="fin.fees.desc">
      {({ school, canWrite }) => (
        <YearPicker key={school!.id} schoolId={school!.id}>
          {(year) => (
            <Fees
              key={year.id}
              schoolId={school!.id}
              yearId={year.id}
              canManage={canWrite('school.finance.settings') && year.status !== 'CLOSED'}
            />
          )}
        </YearPicker>
      )}
    </SchoolPage>
  );
}

function Fees({
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
  const fees = useApi<FeeView[]>(`/school/finance/fees?schoolYearId=${yearId}`);
  const [history, setHistory] = useState<string | null>(null);
  if (fees.state === 'loading' || settings.state === 'loading') return <LoadingState />;
  if (fees.state === 'error') return <ErrorState error={fees.error} onRetry={fees.reload} />;
  if (settings.state === 'error')
    return <ErrorState error={settings.error} onRetry={settings.reload} />;
  const currency = settings.data.currency;
  return (
    <>
      <Card>
        <ul className="divide-y divide-line/70" data-testid="fee-list">
          {fees.data.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted">{t('fin.fees.empty')}</li>
          )}
          {fees.data.map((f) => (
            <li key={f.id} className="space-y-2 px-4 py-3 text-sm" data-testid="fee">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{name(f)}</span>
                <Badge tone="neutral">{t(`fin.cat.${f.category}`)}</Badge>
                {!f.mandatory && <Badge tone="savanna">{t('fin.optional')}</Badge>}
                {!f.isActive && <Badge tone="terracotta">{t('common.inactive')}</Badge>}
                <span className="ms-auto font-semibold">
                  <Money value={f.amount} currency={f.currency} />
                </span>
              </div>
              <p className="text-muted">
                {t(`fin.plan.${f.planKind}`)} ·{' '}
                {t('fin.installments', { n: f.installments.length })} ·{' '}
                {f.class ? name(f.class) : f.level ? name(f.level) : t('fin.allStudents')} ·{' '}
                {t('fin.effectiveFrom', { date: date(f.effectiveFrom) })} ·{' '}
                {t('fin.billed', { n: f.charges })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setHistory(history === f.id ? null : f.id)}
                >
                  {t('grades.history')}
                </Button>
                {canManage && <FeeEdit fee={f} currency={currency} onSaved={fees.reload} />}
              </div>
              {history === f.id && <FeeHistory id={f.id} currency={currency} />}
            </li>
          ))}
        </ul>
      </Card>
      {canManage && <NewFee yearId={yearId} currency={currency} onCreated={fees.reload} />}
    </>
  );
}

function FeeHistory({ id, currency }: { id: string; currency: SchoolCurrency }) {
  const { t, date } = useSchoolText();
  const events = useApi<FeeEvent[]>(`/school/finance/fees/${id}/history`);
  if (events.state === 'loading') return <LoadingState />;
  if (events.state === 'error') return <ErrorState error={events.error} onRetry={events.reload} />;
  return (
    <ul className="space-y-1 rounded-lg bg-ivory/60 p-3 text-xs" data-testid="fee-history">
      {events.data.map((e) => (
        <li key={e.id}>
          <span className="font-medium">
            {t(`fin.event.${e.action === 'created' ? 'created' : 'updated'}`)}
          </span>
          <span className="text-muted"> · {date(e.createdAt)}</span>
          {e.before && e.before.amount !== e.after.amount && (
            <span>
              {' · '}
              <Money value={Number(e.before.amount)} currency={currency} /> →{' '}
              <Money value={Number(e.after.amount)} currency={currency} />
            </span>
          )}
          {e.before && e.before.isActive !== e.after.isActive && (
            <span> · {t(e.after.isActive ? 'fin.event.activated' : 'fin.event.deactivated')}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Modification d'un tarif : montant (pour les échéances futures), activation. */
function FeeEdit({
  fee,
  currency,
  onSaved,
}: {
  fee: FeeView;
  currency: SchoolCurrency;
  onSaved: () => void;
}) {
  const { t } = useSchoolText();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  async function save(body: Record<string, unknown>) {
    setLoading(true);
    setError(null);
    try {
      await api(`/school/finance/fees/${fee.id}`, { method: 'PATCH', body });
      setOpen(false);
      onSaved();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(!open)}>
        {t('periods.edit')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        loading={loading}
        onClick={() => void save({ isActive: !fee.isActive })}
      >
        {t(fee.isActive ? 'fin.deactivate' : 'fin.activate')}
      </Button>
      {open && (
        <div className="w-full space-y-2 rounded-lg border border-line p-3">
          <ApiErrorAlert error={error} />
          <p className="text-xs text-muted">{t('fin.amountChangeHint')}</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-48">
              <AmountField
                label={t('fin.newAmount')}
                currency={currency}
                value={text}
                onChange={(v, minor) => {
                  setText(v);
                  setAmount(minor);
                }}
              />
            </div>
            <Button
              loading={loading}
              disabled={amount === null}
              onClick={() => void save({ amount })}
            >
              {t('periods.save')}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function NewFee({
  yearId,
  currency,
  onCreated,
}: {
  yearId: string;
  currency: SchoolCurrency;
  onCreated: () => void;
}) {
  const { t, name, showArabic } = useSchoolText();
  const classes = useApi<ClassOption[]>(`/school/classes?schoolYearId=${yearId}`);
  const [category, setCategory] = useState<SchoolFeeCategory>('TUITION');
  const [label, setLabel] = useState('');
  const [labelAr, setLabelAr] = useState('');
  const [amountText, setAmountText] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [mandatory, setMandatory] = useState(true);
  const [scope, setScope] = useState('');
  const [kind, setKind] = useState<SchoolPlanKind>('MONTHLY');
  const [dueOn, setDueOn] = useState('');
  const [firstMonth, setFirstMonth] = useState('');
  const [lastMonth, setLastMonth] = useState('');
  const [dueDay, setDueDay] = useState('5');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const classList = classes.state === 'success' ? classes.data : [];
  const levels = [...new Map(classList.map((c) => [c.level.id, c.level])).values()];

  async function create() {
    setLoading(true);
    setError(null);
    const [scopeKind, scopeId] = scope.split(':');
    try {
      await api('/school/finance/fees', {
        method: 'POST',
        body: {
          schoolYearId: yearId,
          category,
          name: label,
          ...(showArabic ? { nameAr: labelAr || null } : {}),
          amount,
          effectiveFrom,
          mandatory,
          ...(scopeKind === 'level' ? { levelId: scopeId } : {}),
          ...(scopeKind === 'class' ? { classId: scopeId } : {}),
          plan:
            kind === 'ANNUAL'
              ? { kind, dueOn }
              : { kind, firstMonth, lastMonth, dueDay: Number(dueDay) },
        },
      });
      setLabel('');
      setLabelAr('');
      setAmountText('');
      setAmount(null);
      onCreated();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoading(false);
    }
  }

  const planReady = kind === 'ANNUAL' ? Boolean(dueOn) : Boolean(firstMonth && lastMonth && dueDay);
  return (
    <Card>
      <CardBody>
        <h2 className="mb-3 font-semibold">{t('fin.fees.new')}</h2>
        <div className="space-y-3" data-testid="fee-form">
          <ApiErrorAlert error={error} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SelectField
              label={t('fin.category')}
              value={category}
              onChange={(e) => setCategory(e.target.value as SchoolFeeCategory)}
              options={SCHOOL_FEE_CATEGORIES.map((c) => ({ value: c, label: t(`fin.cat.${c}`) }))}
            />
            <InputField
              label={t('fin.feeName')}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            {showArabic && (
              <InputField
                label={t('fin.feeNameAr')}
                dir="rtl"
                lang="ar"
                value={labelAr}
                onChange={(e) => setLabelAr(e.target.value)}
              />
            )}
            <AmountField
              label={t('fin.annualAmount')}
              currency={currency}
              value={amountText}
              onChange={(v, minor) => {
                setAmountText(v);
                setAmount(minor);
              }}
            />
            <InputField
              label={t('fin.effectiveFromLabel')}
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
            <SelectField
              label={t('fin.scope')}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              options={[
                { value: '', label: t('fin.allStudents') },
                ...levels.map((l) => ({ value: `level:${l.id}`, label: name(l) })),
                ...classList.map((c) => ({ value: `class:${c.id}`, label: name(c) })),
              ]}
            />
            <SelectField
              label={t('fin.planKind')}
              value={kind}
              onChange={(e) => setKind(e.target.value as SchoolPlanKind)}
              options={SCHOOL_PLAN_KINDS.filter((k) => k !== 'CUSTOM').map((k) => ({
                value: k,
                label: t(`fin.plan.${k}`),
              }))}
            />
            {kind === 'ANNUAL' ? (
              <InputField
                label={t('fin.dueOn')}
                type="date"
                value={dueOn}
                onChange={(e) => setDueOn(e.target.value)}
              />
            ) : (
              <>
                <InputField
                  label={t('fin.firstMonth')}
                  type="month"
                  value={firstMonth}
                  onChange={(e) => setFirstMonth(e.target.value)}
                />
                <InputField
                  label={t('fin.lastMonth')}
                  type="month"
                  value={lastMonth}
                  onChange={(e) => setLastMonth(e.target.value)}
                />
                <InputField
                  label={t('fin.dueDay')}
                  type="number"
                  min="1"
                  max="31"
                  value={dueDay}
                  onChange={(e) => setDueDay(e.target.value)}
                />
              </>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={mandatory}
              onChange={(e) => setMandatory(e.target.checked)}
            />
            {t('fin.mandatory')}
          </label>
          <Button
            loading={loading}
            disabled={!label || amount === null || !effectiveFrom || !planReady}
            onClick={() => void create()}
          >
            {t('fin.fees.create')}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

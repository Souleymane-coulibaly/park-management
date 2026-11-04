'use client';

import type { SchoolCurrency } from '@ocall/shared';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import {
  AmountField,
  type ChargeRow,
  ChargeStatusBadge,
  Money,
  type PaymentRow,
  type StudentNames,
} from './school-finance';
import { toApiError, useSchoolText } from './school-language';
import { StudentName } from './school-students';

export interface Situation {
  student: StudentNames;
  currency: SchoolCurrency;
  today: string;
  totals: {
    amount: number;
    discount: number;
    adjustment: number;
    due: number;
    paid: number;
    balance: number;
    overdue: number;
  };
  charges: ChargeRow[];
  benefits: { id: string; kind: string; value: number; status: string; reason: string }[];
  payments: PaymentRow[];
}

export function useSituation(studentId: string, schoolYearId: string) {
  return useApi<Situation>(`/school/finance/students/${studentId}?schoolYearId=${schoolYearId}`);
}

/** Totaux d'un élève : dû, réductions distinctes des encaissements, payé, reste, retard. */
export function SituationTotals({ s }: { s: Situation }) {
  const { t } = useSchoolText();
  const items: [string, number, boolean][] = [
    [t('fin.totalDue'), s.totals.due, false],
    [t('fin.totalDiscount'), s.totals.discount, false],
    [t('fin.totalPaid'), s.totals.paid, false],
    [t('fin.totalBalance'), s.totals.balance, true],
    [t('fin.totalOverdue'), s.totals.overdue, true],
  ];
  return (
    <div className="grid gap-2 sm:grid-cols-5" data-testid="finance-totals">
      {items.map(([label, value, strong]) => (
        <div key={label} className="rounded-xl bg-ivory/70 px-3 py-2">
          <p className="text-xs text-muted">{label}</p>
          <p className={strong ? 'text-lg font-semibold' : 'font-medium'}>
            <Money value={value} currency={s.currency} />
          </p>
        </div>
      ))}
    </div>
  );
}

/** Échéances d'un élève ; la direction peut les ajuster (motif obligatoire). */
export function SituationCharges({
  s,
  canAdjust,
  onChange,
}: {
  s: Situation;
  canAdjust: boolean;
  onChange: () => void;
}) {
  const { t, name, date } = useSchoolText();
  const [adjusting, setAdjusting] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm" data-testid="charges-table">
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            <th className="px-3 py-2 text-start font-semibold">{t('fin.charge')}</th>
            <th className="px-3 py-2 text-start font-semibold">{t('fin.dueOn')}</th>
            <th className="px-3 py-2 text-end font-semibold">{t('fin.amount')}</th>
            <th className="px-3 py-2 text-end font-semibold">{t('fin.discount')}</th>
            <th className="px-3 py-2 text-end font-semibold">{t('fin.paid')}</th>
            <th className="px-3 py-2 text-end font-semibold">{t('fin.balance')}</th>
            <th className="px-3 py-2 text-start font-semibold">{t('quranStudent.status')}</th>
            {canAdjust && <th />}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/70">
          {s.charges.length === 0 && (
            <tr>
              <td colSpan={8} className="px-3 py-4 text-center text-muted">
                {t('fin.noCharges')}
              </td>
            </tr>
          )}
          {s.charges.map((c) => (
            <tr key={c.id} data-testid="charge-row">
              <td className="px-3 py-2">
                {name({ name: c.label, nameAr: c.labelAr })}
                {c.adjustment !== 0 && (
                  <span className="block text-xs text-muted">
                    {t('fin.adjustment')} : <Money value={c.adjustment} currency={s.currency} />
                  </span>
                )}
                {adjusting === c.id && (
                  <AdjustForm
                    chargeId={c.id}
                    currency={s.currency}
                    onDone={() => {
                      setAdjusting(null);
                      onChange();
                    }}
                  />
                )}
              </td>
              <td className="px-3 py-2">{date(c.dueOn)}</td>
              <td className="px-3 py-2 text-end">
                <Money value={c.amount} currency={s.currency} />
              </td>
              <td className="px-3 py-2 text-end">
                {c.discount ? <Money value={-c.discount} currency={s.currency} /> : '–'}
              </td>
              <td className="px-3 py-2 text-end">
                <Money value={c.paid} currency={s.currency} />
              </td>
              <td className="px-3 py-2 text-end font-medium">
                <Money value={c.balance} currency={s.currency} />
              </td>
              <td className="px-3 py-2">
                <ChargeStatusBadge status={c.status} />
              </td>
              {canAdjust && (
                <td className="px-3 py-2 text-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setAdjusting(adjusting === c.id ? null : c.id)}
                  >
                    {t('fin.adjust')}
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdjustForm({
  chargeId,
  currency,
  onDone,
}: {
  chargeId: string;
  currency: SchoolCurrency;
  onDone: () => void;
}) {
  const { t } = useSchoolText();
  const [text, setText] = useState('');
  const [minor, setMinor] = useState<number | null>(null);
  const [increase, setIncrease] = useState(true);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  async function save() {
    setLoading(true);
    setError(null);
    try {
      await api(`/school/finance/charges/${chargeId}/adjust`, {
        method: 'POST',
        body: { amount: increase ? minor : -(minor ?? 0), reason },
      });
      onDone();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-line p-2" data-testid="adjust-form">
      <ApiErrorAlert error={error} />
      <div className="flex flex-wrap gap-2 text-xs">
        <label className="flex items-center gap-1">
          <input type="radio" checked={increase} onChange={() => setIncrease(true)} />{' '}
          {t('fin.increase')}
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={!increase} onChange={() => setIncrease(false)} />{' '}
          {t('fin.decrease')}
        </label>
      </div>
      <AmountField
        label={t('fin.amount')}
        currency={currency}
        value={text}
        onChange={(v, m) => {
          setText(v);
          setMinor(m);
        }}
      />
      <InputField
        label={t('fin.reason')}
        value={reason}
        maxLength={300}
        onChange={(e) => setReason(e.target.value)}
      />
      <Button
        size="sm"
        loading={loading}
        disabled={!minor || reason.trim().length < 3}
        onClick={() => void save()}
      >
        {t('fin.adjust')}
      </Button>
    </div>
  );
}

/** Paiements d'un élève : encaissements, contrepassations, statut de vérification. */
export function SituationPayments({ s }: { s: Situation }) {
  const { t, date } = useSchoolText();
  return (
    <ul className="divide-y divide-line/70 text-sm" data-testid="student-payments">
      {s.payments.length === 0 && <li className="py-3 text-muted">{t('fin.noPayments')}</li>}
      {s.payments.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
          <span className="text-muted">{date(p.paidAt)}</span>
          <span className="font-medium">
            <Money value={p.kind === 'REVERSAL' ? -p.amount : p.amount} currency={s.currency} />
          </span>
          <span>{t(`fin.method.${p.method}`)}</span>
          {p.receiptNumber && <span className="text-muted">{p.receiptNumber}</span>}
          {p.kind === 'REVERSAL' && <Badge tone="terracotta">{t('fin.reversal')}</Badge>}
          {p.status === 'CANCELLED' && <Badge tone="terracotta">{t('fin.cancelled')}</Badge>}
          {p.verification === 'DECLARED_UNVERIFIED' && (
            <Badge tone="savanna">{t('fin.unverified')}</Badge>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Situation complète d'un élève, réutilisée par la fiche financière et la caisse. */
export function StudentSituation({
  studentId,
  schoolYearId,
  canAdjust,
  children,
}: {
  studentId: string;
  schoolYearId: string;
  canAdjust: boolean;
  children?: (s: Situation, reload: () => void) => React.ReactNode;
}) {
  const { t } = useSchoolText();
  const situation = useSituation(studentId, schoolYearId);
  if (situation.state === 'loading') return <LoadingState />;
  if (situation.state === 'error')
    return <ErrorState error={situation.error} onRetry={situation.reload} />;
  const s = situation.data;
  return (
    <div className="space-y-4">
      <Card>
        <CardBody>
          <h2 className="mb-3 text-lg font-semibold">
            <StudentName student={s.student} />
          </h2>
          <SituationTotals s={s} />
        </CardBody>
      </Card>
      {children?.(s, situation.reload)}
      <Card>
        <CardBody>
          <h3 className="mb-2 font-semibold">{t('fin.charges')}</h3>
          <SituationCharges s={s} canAdjust={canAdjust} onChange={situation.reload} />
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <h3 className="mb-2 font-semibold">{t('fin.payments')}</h3>
          <SituationPayments s={s} />
        </CardBody>
      </Card>
    </div>
  );
}

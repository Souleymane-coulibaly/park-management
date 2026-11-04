'use client';

import {
  SCHOOL_FEE_CATEGORIES,
  type SchoolCurrency,
  type SchoolPaymentMethod,
} from '@ocall/shared';
import { useState } from 'react';
import { downloadPdf } from '@/components/school/school-assessment';
import { Money, YearPicker } from '@/components/school/school-finance';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { SchoolPage } from '@/components/school/school-page';
import type { ClassOption } from '@/components/school/school-students';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import type { ApiError } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface Dashboard {
  currency: SchoolCurrency;
  expected: number;
  collected: number;
  /** Encaissé entre les dates filtrées ; null sans filtre de période. */
  periodCollected: number | null;
  balance: number;
  discounts: number;
  overdueCharges: number;
  overdueAmount: number;
  studentsInArrears: number;
  collectionsByMonth: { month: string; amount: number }[];
  collectionsByMethod: { method: SchoolPaymentMethod; amount: number }[];
  byClass: {
    classId: string | null;
    className: string;
    levelName: string;
    expected: number;
    collected: number;
    periodCollected: number | null;
    balance: number;
  }[];
}

/** Tableau de bord financier (Sprint 5) : attendu, encaissé, solde, retards, répartitions. */
export default function FinanceDashboardPage() {
  return (
    <SchoolPage title="fin.dashboard.title" description="fin.dashboard.desc">
      {({ school }) => (
        <YearPicker key={school!.id} schoolId={school!.id}>
          {(year) => <FinanceDashboard key={year.id} yearId={year.id} />}
        </YearPicker>
      )}
    </SchoolPage>
  );
}

function FinanceDashboard({ yearId }: { yearId: string }) {
  const { t, name } = useSchoolText();
  const classes = useApi<ClassOption[]>(`/school/classes?schoolYearId=${yearId}`);
  const [classId, setClassId] = useState('');
  const [category, setCategory] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const query = new URLSearchParams({
    schoolYearId: yearId,
    ...(classId ? { classId } : {}),
    ...(category ? { category } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  }).toString();
  const data = useApi<Dashboard>(`/school/finance/dashboard?${query}`);

  async function exportFile(kind: 'payments' | 'unpaid', format: 'csv' | 'xlsx') {
    setError(null);
    try {
      await downloadPdf(
        `/school/finance/export?${query}&kind=${kind}&format=${format}`,
        `${kind}.${format}`,
      );
    } catch (e) {
      setError(toApiError(e));
    }
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="finance-filters">
        <SelectField
          label={t('pick.class')}
          value={classId}
          onChange={(e) => setClassId(e.target.value)}
          options={[
            { value: '', label: t('fin.allClasses') },
            ...(classes.state === 'success' ? classes.data : []).map((c) => ({
              value: c.id,
              label: name(c),
            })),
          ]}
        />
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
          label={t('fin.from')}
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <InputField
          label={t('fin.to')}
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>
      <ApiErrorAlert error={error} />
      {data.state === 'loading' ? (
        <LoadingState />
      ) : data.state === 'error' ? (
        <ErrorState error={data.error} onRetry={data.reload} />
      ) : (
        <DashboardBody d={data.data} onExport={exportFile} />
      )}
    </>
  );
}

function DashboardBody({
  d,
  onExport,
}: {
  d: Dashboard;
  onExport: (kind: 'payments' | 'unpaid', format: 'csv' | 'xlsx') => void;
}) {
  const { t } = useSchoolText();
  const kpis: [string, React.ReactNode][] = [
    [t('fin.kpi.expected'), <Money key="e" value={d.expected} currency={d.currency} />],
    [t('fin.kpi.collected'), <Money key="c" value={d.collected} currency={d.currency} />],
    [t('fin.kpi.balance'), <Money key="b" value={d.balance} currency={d.currency} />],
    [t('fin.kpi.overdue'), <Money key="o" value={d.overdueAmount} currency={d.currency} />],
    [t('fin.kpi.overdueCharges'), d.overdueCharges],
    [t('fin.kpi.studentsInArrears'), d.studentsInArrears],
    ...(d.periodCollected !== null
      ? ([
          [
            t('fin.kpi.periodCollected'),
            <Money key="p" value={d.periodCollected} currency={d.currency} />,
          ],
        ] as [string, React.ReactNode][])
      : []),
  ];
  const maxMonth = Math.max(1, ...d.collectionsByMonth.map((m) => Math.abs(m.amount)));
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3" data-testid="finance-kpis">
        {kpis.map(([label, value]) => (
          <Card key={label}>
            <CardBody>
              <p className="text-xs text-muted">{label}</p>
              <p className="mt-1 text-xl font-semibold">{value}</p>
            </CardBody>
          </Card>
        ))}
      </div>
      {d.periodCollected !== null && (
        <p className="text-xs text-muted" data-testid="period-note">
          {t('fin.periodNote')}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardBody>
            <h2 className="mb-3 font-semibold">{t('fin.byMonth')}</h2>
            <ul className="space-y-2 text-sm" data-testid="by-month">
              {d.collectionsByMonth.length === 0 && (
                <li className="text-muted">{t('fin.noPayments')}</li>
              )}
              {d.collectionsByMonth.map((m) => (
                <li key={m.month} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2">
                  <span className="text-muted" dir="ltr">
                    {m.month}
                  </span>
                  <span className="h-2 rounded-full bg-ivory-dark">
                    <span
                      className="block h-2 rounded-full bg-forest"
                      style={{ width: `${(Math.abs(m.amount) / maxMonth) * 100}%` }}
                    />
                  </span>
                  <Money value={m.amount} currency={d.currency} />
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <h2 className="mb-3 font-semibold">{t('fin.byMethod')}</h2>
            <ul className="divide-y divide-line/70 text-sm" data-testid="by-method">
              {d.collectionsByMethod.length === 0 && (
                <li className="py-2 text-muted">{t('fin.noPayments')}</li>
              )}
              {d.collectionsByMethod.map((m) => (
                <li key={m.method} className="flex justify-between gap-2 py-2">
                  <span>{t(`fin.method.${m.method}`)}</span>
                  <Money value={m.amount} currency={d.currency} />
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardBody>
          <h2 className="mb-3 font-semibold">{t('fin.byClass')}</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm" data-testid="by-class">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  <th className="px-3 py-2 text-start font-semibold">{t('pick.class')}</th>
                  <th className="px-3 py-2 text-start font-semibold">{t('fin.level')}</th>
                  <th className="px-3 py-2 text-end font-semibold">{t('fin.kpi.expected')}</th>
                  <th className="px-3 py-2 text-end font-semibold">{t('fin.kpi.collected')}</th>
                  {d.periodCollected !== null && (
                    <th className="px-3 py-2 text-end font-semibold">
                      {t('fin.kpi.periodCollected')}
                    </th>
                  )}
                  <th className="px-3 py-2 text-end font-semibold">{t('fin.kpi.balance')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {d.byClass.map((c) => (
                  <tr key={c.classId ?? 'none'}>
                    <td className="px-3 py-2">{c.className}</td>
                    <td className="px-3 py-2 text-muted">{c.levelName}</td>
                    <td className="px-3 py-2 text-end">
                      <Money value={c.expected} currency={d.currency} />
                    </td>
                    <td className="px-3 py-2 text-end">
                      <Money value={c.collected} currency={d.currency} />
                    </td>
                    {c.periodCollected !== null && (
                      <td className="px-3 py-2 text-end">
                        <Money value={c.periodCollected} currency={d.currency} />
                      </td>
                    )}
                    <td className="px-3 py-2 text-end font-medium">
                      <Money value={c.balance} currency={d.currency} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => onExport('payments', 'csv')}>
          {t('fin.exportPaymentsCsv')}
        </Button>
        <Button variant="secondary" onClick={() => onExport('payments', 'xlsx')}>
          {t('fin.exportPaymentsXlsx')}
        </Button>
        <Button variant="secondary" onClick={() => onExport('unpaid', 'xlsx')}>
          {t('fin.exportUnpaidXlsx')}
        </Button>
      </div>
    </>
  );
}

'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import type { SchoolChargeStatus, SchoolCurrency, SchoolPaymentMethod } from '@ocall/shared';
import { ChildHeader, useChild } from '@/components/parents/parent-shell';
import { downloadPdf } from '@/components/school/school-assessment';
import { ChargeStatusBadge, Money } from '@/components/school/school-finance';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import type { ApiError } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface FinanceView {
  years: { id: string; label: string }[];
  year: { id: string; label: string } | null;
  currency: SchoolCurrency;
  charges: {
    id: string;
    label: string;
    labelAr: string | null;
    dueOn: string;
    due: number;
    paid: number;
    balance: number;
    status: SchoolChargeStatus;
  }[];
  payments: {
    id: string;
    amount: number;
    method: SchoolPaymentMethod;
    paidAt: string;
    status: 'CONFIRMED' | 'CANCELLED';
    verification: string;
    receiptNumber: string | null;
  }[];
  totals: { due: number; paid: number; balance: number; overdue: number } | null;
}

/** Situation financière en lecture seule : échéances, paiements et reçus ; aucun paiement en ligne. */
export default function ChildFinancePage() {
  const { id } = useParams<{ id: string }>();
  const child = useChild(id);
  const { t, name, date } = useSchoolText();
  const [yearId, setYearId] = useState('');
  const data = useApi<FinanceView>(
    `/school/portal/children/${id}/finance${yearId ? `?schoolYearId=${yearId}` : ''}`,
  );
  const [error, setError] = useState<ApiError | null>(null);
  if (!child) return <Alert tone="info" title={t('par.noChildren')} />;

  async function receipt(paymentId: string) {
    setError(null);
    try {
      await downloadPdf(`/school/portal/children/${id}/payments/${paymentId}/receipt`, 'recu.pdf');
    } catch (e) {
      setError(toApiError(e));
    }
  }

  return (
    <>
      <ChildHeader child={child} />
      <Alert tone="info" title={t('par.fin.readOnly')} />
      <ApiErrorAlert error={error} />
      {data.state === 'loading' ? (
        <LoadingState />
      ) : data.state === 'error' ? (
        <ErrorState error={data.error} onRetry={data.reload} />
      ) : !data.data.year ? (
        <Alert tone="info" title={t('par.fin.none')} />
      ) : (
        <>
          {data.data.years.length > 1 && (
            <div className="max-w-xs">
              <SelectField
                label={t('par.fin.year')}
                value={data.data.year.id}
                onChange={(e) => setYearId(e.target.value)}
                options={data.data.years.map((y) => ({ value: y.id, label: y.label }))}
              />
            </div>
          )}
          {data.data.totals && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="finance-totals">
              {(
                [
                  ['par.fin.due', data.data.totals.due],
                  ['par.fin.paid', data.data.totals.paid],
                  ['par.fin.balance', data.data.totals.balance],
                  ['par.fin.overdue', data.data.totals.overdue],
                ] as const
              ).map(([key, value]) => (
                <Card key={key}>
                  <CardBody>
                    <p className="text-xs text-muted">{t(key)}</p>
                    <p className="text-lg font-semibold">
                      <Money value={value} currency={data.data.currency} />
                    </p>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
          <Card>
            <CardBody>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm" data-testid="charges">
                  <thead>
                    <tr className="border-b border-line text-xs text-muted">
                      <th className="px-2 py-1 text-start">{t('par.fin.dueOn')}</th>
                      <th className="px-2 py-1 text-start" />
                      <th className="px-2 py-1 text-end">{t('par.fin.due')}</th>
                      <th className="px-2 py-1 text-end">{t('par.fin.paid')}</th>
                      <th className="px-2 py-1 text-end">{t('par.fin.balance')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/70">
                    {data.data.charges.map((c) => (
                      <tr key={c.id}>
                        <td className="whitespace-nowrap px-2 py-2">{date(c.dueOn)}</td>
                        <td className="px-2 py-2">
                          {name({ name: c.label, nameAr: c.labelAr })}{' '}
                          <ChargeStatusBadge status={c.status} />
                        </td>
                        <td className="px-2 py-2 text-end">
                          <Money value={c.due} currency={data.data.currency} />
                        </td>
                        <td className="px-2 py-2 text-end">
                          <Money value={c.paid} currency={data.data.currency} />
                        </td>
                        <td className="px-2 py-2 text-end font-semibold">
                          <Money value={c.balance} currency={data.data.currency} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <h3 className="mb-2 font-semibold">{t('par.fin.payments')}</h3>
              {data.data.payments.length === 0 ? (
                <p className="text-sm text-muted">—</p>
              ) : (
                <ul className="divide-y divide-line/70 text-sm" data-testid="payments">
                  {data.data.payments.map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2"
                    >
                      <span>
                        {date(p.paidAt)} · <Money value={p.amount} currency={data.data.currency} />{' '}
                        {p.status === 'CANCELLED' && (
                          <Badge tone="terracotta">{t('par.fin.cancelled')}</Badge>
                        )}
                        {p.verification === 'DECLARED_UNVERIFIED' && (
                          <span className="block text-xs text-muted">
                            {t('par.fin.unverified')}
                          </span>
                        )}
                      </span>
                      {p.receiptNumber && (
                        <Button size="sm" variant="secondary" onClick={() => void receipt(p.id)}>
                          {t('par.fin.receipt')} {p.receiptNumber}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </>
  );
}

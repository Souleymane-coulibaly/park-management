'use client';

import { SCHOOL_PAYMENT_METHODS } from '@ocall/shared';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { downloadPdf } from './school-assessment';
import { Money, type PaymentRow } from './school-finance';
import { toApiError, useSchoolText } from './school-language';
import { StudentName } from './school-students';

/** Page de l'historique des encaissements, et curseur de la suivante. */
interface PaymentPage {
  items: PaymentRow[];
  nextCursor: string | null;
}

/** Liste filtrée et paginée des encaissements ; `receiptsOnly` : seulement ceux qui portent un reçu. */
export function Payments({
  schoolId,
  yearId,
  canCancel,
  receiptsOnly,
}: {
  schoolId: string;
  yearId: string;
  canCancel: boolean;
  receiptsOnly: boolean;
}) {
  const { t } = useSchoolText();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [method, setMethod] = useState('');
  // Version de la liste : une annulation la recrée, pages et réponses en cours comprises.
  const [version, setVersion] = useState(0);
  const query = new URLSearchParams({
    schoolId,
    schoolYearId: yearId,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(method ? { method } : {}),
    ...(receiptsOnly ? { receipts: 'true' } : {}),
  });
  const url = `/school/finance/payments?${query.toString()}`;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
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
        <SelectField
          label={t('fin.method')}
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          options={[
            { value: '', label: t('fin.allMethods') },
            ...SCHOOL_PAYMENT_METHODS.map((m) => ({ value: m, label: t(`fin.method.${m}`) })),
          ]}
        />
      </div>
      {/* Liste recréée à chaque changement de filtres ou annulation : une réponse antérieure ne
          s'y mêle jamais. */}
      <PaymentList
        key={`${url}#${version}`}
        url={url}
        canCancel={canCancel}
        onChanged={() => setVersion((v) => v + 1)}
      />
    </>
  );
}

/** Encaissements d'une combinaison de filtres, page par page. */
function PaymentList({
  url,
  canCancel,
  onChanged,
}: {
  url: string;
  canCancel: boolean;
  onChanged: () => void;
}) {
  const { t, date } = useSchoolText();
  const list = useApi<PaymentPage>(url);
  // Pages suivantes, chargées à la demande.
  const [more, setMore] = useState<PaymentPage[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  async function cancel(id: string) {
    setLoading(true);
    setError(null);
    try {
      await api(`/school/finance/payments/${id}/cancel`, { method: 'POST', body: { reason } });
      onChanged();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoading(false);
    }
  }

  async function receipt(id: string) {
    setError(null);
    try {
      await downloadPdf(`/school/finance/payments/${id}/receipt`, 'recu.pdf');
    } catch (e) {
      setError(toApiError(e));
    }
  }

  async function loadMore(cursor: string) {
    setLoadingMore(true);
    setError(null);
    try {
      const page = await api<PaymentPage>(`${url}&cursor=${cursor}`);
      setMore((pages) => [...pages, page]);
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoadingMore(false);
    }
  }

  const pages = list.state === 'success' ? [list.data, ...more] : [];
  const rows = pages.flatMap((p) => p.items);
  const nextCursor = pages.length > 0 ? pages[pages.length - 1]!.nextCursor : null;
  return (
    <>
      <ApiErrorAlert error={error} />
      {list.state === 'loading' ? (
        <LoadingState />
      ) : list.state === 'error' ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : (
        <Card>
          <ul className="divide-y divide-line/70" data-testid="payment-list">
            {rows.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-muted">{t('fin.noPayments')}</li>
            )}
            {rows.map((p) => (
              <li key={p.id} className="space-y-2 px-4 py-3 text-sm" data-testid="payment">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted">{date(p.paidAt)}</span>
                  {p.student && (
                    <span className="font-medium">
                      <StudentName student={p.student} />
                    </span>
                  )}
                  <span className="font-semibold">
                    <Money
                      value={p.kind === 'REVERSAL' ? -p.amount : p.amount}
                      currency={p.currency}
                    />
                  </span>
                  <span>{t(`fin.method.${p.method}`)}</span>
                  {p.reference && <span className="text-muted">{p.reference}</span>}
                  {p.receiptNumber && <Badge tone="neutral">{p.receiptNumber}</Badge>}
                  {p.kind === 'REVERSAL' && <Badge tone="terracotta">{t('fin.reversal')}</Badge>}
                  {p.status === 'CANCELLED' && (
                    <Badge tone="terracotta">{t('fin.cancelled')}</Badge>
                  )}
                  {p.verification === 'DECLARED_UNVERIFIED' && (
                    <Badge tone="savanna">{t('fin.unverified')}</Badge>
                  )}
                  <span className="ms-auto flex gap-2">
                    {p.kind === 'PAYMENT' && p.receiptNumber && (
                      <Button size="sm" variant="secondary" onClick={() => void receipt(p.id)}>
                        {t('fin.receipt')}
                      </Button>
                    )}
                    {canCancel && p.kind === 'PAYMENT' && p.status === 'CONFIRMED' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setCancelling(cancelling === p.id ? null : p.id)}
                      >
                        {t('fin.cancel')}
                      </Button>
                    )}
                  </span>
                </div>
                {cancelling === p.id && (
                  <div
                    className="flex flex-wrap items-end gap-2 rounded-lg border border-line p-2"
                    data-testid="cancel-form"
                  >
                    <div className="min-w-60 flex-1">
                      <InputField
                        label={t('fin.cancelReason')}
                        value={reason}
                        maxLength={300}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </div>
                    <Button
                      variant="danger"
                      loading={loading}
                      disabled={reason.trim().length < 3}
                      onClick={() => void cancel(p.id)}
                    >
                      {t('fin.confirmCancel')}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {nextCursor && (
            <div className="border-t border-line/70 p-3 text-center">
              <Button
                variant="secondary"
                loading={loadingMore}
                onClick={() => void loadMore(nextCursor)}
                data-testid="payments-more"
              >
                {t('fin.loadMore')}
              </Button>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

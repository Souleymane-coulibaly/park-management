'use client';

import {
  SCHOOL_PAYMENT_METHODS,
  type SchoolPaymentMethod,
  parseAmount,
  paymentReferenceRequired,
} from '@ocall/shared';
import { type ReactNode, useState } from 'react';
import { downloadPdf } from '@/components/school/school-assessment';
import {
  AmountField,
  Money,
  StudentPicker,
  YearPicker,
  useFinanceSettings,
} from '@/components/school/school-finance';
import { type Situation, StudentSituation } from '@/components/school/school-finance-situation';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { SchoolPage } from '@/components/school/school-page';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';

/**
 * Encaissement en caisse (Sprint 5). Chaque formulaire porte sa clé d'idempotence : un double clic ou une
 * nouvelle tentative après une coupure ne crée qu'un encaissement. Un mobile money saisi ici reste
 * « déclaré » : aucune vérification auprès de l'opérateur.
 */
export default function CashDeskPage() {
  return (
    <SchoolPage title="fin.cash.title" description="fin.cash.desc">
      {({ school, context, canWrite }) => (
        <CollectGate
          key={school!.id}
          schoolId={school!.id}
          canCollect={canWrite('school.finance.collect')}
          secretaryMay={
            context.role === 'SECRETARY' && (school!.contractAccess ?? context.access) === 'full'
          }
        >
          <YearPicker key={school!.id} schoolId={school!.id}>
            {(year) => (
              <StudentPicker key={year.id} schoolYearId={year.id} includeLeavers>
                {(student) => (
                  <StudentSituation
                    key={student.id}
                    studentId={student.id}
                    schoolYearId={year.id}
                    canAdjust={false}
                  >
                    {(s, reload) => (
                      <CashForm situation={s} schoolYearId={year.id} onPaid={reload} />
                    )}
                  </StudentSituation>
                )}
              </StudentPicker>
            )}
          </YearPicker>
        </CollectGate>
      )}
    </SchoolPage>
  );
}

/**
 * Caisse réservée à qui peut encaisser : comptabilité et direction sous contrat actif, secrétariat si la
 * direction l'a autorisé. Les autres ne voient pas de formulaire (l'API refuse de toute façon).
 */
function CollectGate({
  schoolId,
  canCollect,
  secretaryMay,
  children,
}: {
  schoolId: string;
  canCollect: boolean;
  secretaryMay: boolean;
  children: ReactNode;
}) {
  const { t } = useSchoolText();
  const settings = useFinanceSettings(secretaryMay && !canCollect ? schoolId : null);
  if (canCollect) return <>{children}</>;
  if (!secretaryMay) return <Alert tone="info" title={t('fin.cash.notAllowed')} />;
  if (settings.state === 'loading') return <LoadingState />;
  if (settings.state === 'error') {
    return <ErrorState error={settings.error} onRetry={settings.reload} />;
  }
  return settings.data.secretaryCanCollect ? (
    <>{children}</>
  ) : (
    <Alert tone="info" title={t('fin.cash.notAllowed')} />
  );
}

const newKey = () => crypto.randomUUID();

function CashForm({
  situation: s,
  schoolYearId,
  onPaid,
}: {
  situation: Situation;
  schoolYearId: string;
  onPaid: () => void;
}) {
  const { t, name } = useSchoolText();
  const [key, setKey] = useState(newKey);
  const [text, setText] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<SchoolPaymentMethod>('CASH');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [explicit, setExplicit] = useState(false);
  const [partTexts, setPartTexts] = useState<Record<string, string>>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [done, setDone] = useState<{ id: string; receiptNumber: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const open = s.charges.filter((c) => c.balance > 0);
  // Affectations dérivées des saisies : un montant renseigné mais invalide bloque l'encaissement,
  // il n'est jamais compté pour zéro ni retiré en silence.
  const parts = Object.entries(partTexts)
    .filter(([, v]) => v.trim())
    .map(([chargeId, v]) => ({ chargeId, amount: parseAmount(v, s.currency) }));
  const invalidPart = parts.some((p) => !p.amount);
  const allocated = parts.reduce((sum, p) => sum + (p.amount ?? 0), 0);
  const total = explicit ? (invalidPart ? null : allocated) : amount;
  const needsReference = paymentReferenceRequired(method);

  async function submit(confirmDuplicate = false) {
    if (!total || (explicit && invalidPart)) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ id: string; receiptNumber: string }>('/school/finance/payments', {
        method: 'POST',
        body: {
          studentId: s.student.id,
          schoolYearId,
          amount: total,
          method,
          reference: reference.trim() || null,
          note: note.trim() || null,
          idempotencyKey: key,
          confirmDuplicate,
          ...(explicit
            ? {
                allocations: parts,
              }
            : {}),
        },
      });
      setDone(res);
      setDuplicate(false);
      setKey(newKey());
      setText('');
      setAmount(null);
      setReference('');
      setNote('');
      setPartTexts({});
      onPaid();
    } catch (e) {
      const err = toApiError(e);
      if (err instanceof ApiError && err.code === 'POSSIBLE_DUPLICATE') setDuplicate(true);
      else setError(err);
    } finally {
      setLoading(false);
    }
  }

  async function receipt(id: string) {
    try {
      await downloadPdf(`/school/finance/payments/${id}/receipt`, 'recu.pdf');
    } catch (e) {
      setError(toApiError(e));
    }
  }

  return (
    <Card>
      <CardBody>
        <h2 className="mb-3 font-semibold">{t('fin.cash.new')}</h2>
        <div className="space-y-3" data-testid="cash-form">
          {done && (
            <Alert tone="success" title={t('fin.cash.done', { number: done.receiptNumber })}>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void receipt(done.id)}
                data-testid="receipt-download"
              >
                {t('fin.receipt')}
              </Button>
            </Alert>
          )}
          <ApiErrorAlert error={error} />
          {duplicate && (
            <Alert tone="error" title={t('fin.cash.duplicate')}>
              <Button
                size="sm"
                variant="danger"
                loading={loading}
                onClick={() => void submit(true)}
              >
                {t('fin.cash.confirmDuplicate')}
              </Button>
            </Alert>
          )}
          {open.length === 0 ? (
            <p className="text-sm text-muted">{t('fin.cash.nothingDue')}</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <SelectField
                  label={t('fin.method')}
                  value={method}
                  onChange={(e) => setMethod(e.target.value as SchoolPaymentMethod)}
                  options={SCHOOL_PAYMENT_METHODS.map((m) => ({
                    value: m,
                    label: t(`fin.method.${m}`),
                  }))}
                />
                <InputField
                  label={needsReference ? t('fin.referenceRequired') : t('fin.reference')}
                  value={reference}
                  maxLength={80}
                  onChange={(e) => setReference(e.target.value)}
                />
                {!explicit && (
                  <AmountField
                    label={t('fin.amount')}
                    currency={s.currency}
                    value={text}
                    onChange={(v, m) => {
                      setText(v);
                      setAmount(m);
                    }}
                  />
                )}
              </div>
              {method === 'MOBILE_MONEY' && (
                <Alert tone="info" title={t('fin.cash.mobileDeclared')} />
              )}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={explicit}
                  onChange={(e) => setExplicit(e.target.checked)}
                />
                {t('fin.cash.explicit')}
              </label>
              {explicit ? (
                <ul className="divide-y divide-line/70 text-sm" data-testid="allocation-list">
                  {open.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-end gap-3 py-2">
                      <span className="min-w-0 flex-1">
                        {name({ name: c.label, nameAr: c.labelAr })}
                        <span className="block text-xs text-muted">
                          {t('fin.balance')} : <Money value={c.balance} currency={s.currency} />
                        </span>
                      </span>
                      <div className="w-44">
                        <AmountField
                          label={t('fin.amount')}
                          currency={s.currency}
                          value={partTexts[c.id] ?? ''}
                          onChange={(v) => setPartTexts((p) => ({ ...p, [c.id]: v }))}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted">{t('fin.cash.autoHint')}</p>
              )}
              <InputField
                label={t('fin.note')}
                value={note}
                maxLength={300}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  loading={loading}
                  disabled={!total || (needsReference && !reference.trim())}
                  onClick={() => void submit(false)}
                  data-testid="cash-submit"
                >
                  {t('fin.cash.submit')}
                </Button>
                {total ? (
                  <span className="text-sm">
                    {t('fin.amount')} : <Money value={total} currency={s.currency} />
                  </span>
                ) : null}
              </div>
            </>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

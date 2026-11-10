'use client';

import { Wallet } from 'lucide-react';
import { formatXof } from '@ocall/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { formatDate } from '@/lib/format';

export interface PartnerBalance {
  accrued: number;
  pending: number;
  payable: number;
  inPayment: number;
  paid: number;
  nextPayableAt: string | null;
}

/**
 * Solde de primes du partenaire (Sprint S3) : acquises (à valider par Ocall), validées en attente de
 * leur date de règlement (fin du mois suivant l'encaissement), payables, réglées. Montants enregistrés
 * uniquement.
 */
export function BalanceCard({
  balance,
  action,
}: {
  balance: PartnerBalance;
  action?: React.ReactNode;
}) {
  const rows = [
    {
      label: 'Payable maintenant',
      value: balance.payable,
      strong: true,
      testId: 'balance-payable',
    },
    {
      label: 'Validées, réglées fin du mois suivant',
      value: balance.pending,
      testId: 'balance-pending',
    },
    {
      label: 'Acquises, en validation par Ocall',
      value: balance.accrued,
      testId: 'balance-accrued',
    },
    { label: 'En cours de règlement', value: balance.inPayment, testId: 'balance-in-payment' },
    { label: 'Déjà réglées', value: balance.paid, testId: 'balance-paid' },
  ];
  return (
    <div data-testid="partner-balance">
      <Card className="mb-6">
        <CardHeader
          title="Mon solde de primes"
          description="Primes calculées sur les montants réellement encaissés ; règlement à la fin du mois suivant l’encaissement (ex. novembre → fin décembre)."
          action={action}
        />
        <CardBody>
          <div className="flex flex-wrap items-center gap-4">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-savanna-light text-charcoal">
              <Wallet className="h-6 w-6" aria-hidden />
            </span>
            <div>
              <p className="text-sm text-muted">Payable maintenant</p>
              <p className="font-display text-3xl font-bold" data-testid="balance-payable-main">
                {formatXof(balance.payable)}
              </p>
              {balance.nextPayableAt && (
                <p className="text-xs text-muted">
                  Prochain règlement : {formatDate(balance.nextPayableAt)}
                </p>
              )}
            </div>
          </div>
          <dl className="mt-4 grid gap-2 sm:grid-cols-2">
            {rows.slice(1).map((r) => (
              <div
                key={r.label}
                className="flex justify-between gap-3 rounded-xl bg-savanna-light/40 px-3 py-2 text-sm"
              >
                <dt className="text-muted">{r.label}</dt>
                <dd className="font-semibold tabular-nums" data-testid={r.testId}>
                  {formatXof(r.value)}
                </dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>
    </div>
  );
}

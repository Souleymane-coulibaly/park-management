'use client';

import { useEffect, useState } from 'react';
import { Gift, Search, UserPlus, X } from 'lucide-react';
import { CUSTOMER_SEARCH_MIN_LENGTH, customerDisplayName, formatXof } from '@ocall/shared';
import { useCan } from '@/components/app/session-context';
import { Button } from '@/components/ui/button';
import { ApiErrorAlert } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import type { CustomerDetail, CustomerSummary, LoyaltyRule, Sale } from '@/lib/types';

const FIELD =
  'block w-full rounded-xl border border-line bg-surface px-3 py-2 text-[15px] focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/20';

/**
 * Client et fidélité d'une vente, dans la fenêtre d'encaissement. Placé dans le formulaire de
 * paiement : aucun formulaire imbriqué, seulement des boutons (type="button").
 *
 * Le serveur reste l'autorité : rattacher un client et utiliser des points renvoient la vente
 * recalculée (total après remise) ; aucun montant n'est calculé ici.
 */
export function LoyaltyPanel({ sale, onChange }: { sale: Sale; onChange: (sale: Sale) => void }) {
  const canCreate = useCan('customer.manage');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CustomerSummary[] | null>(null);
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [rules, setRules] = useState<LoyaltyRule[]>([]);
  const [points, setPoints] = useState('');
  const [creating, setCreating] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ firstName: '', phone: '', consent: false });
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const activity = sale.activity;

  useEffect(() => {
    api<LoyaltyRule[]>('/loyalty/rules')
      .then(setRules)
      .catch(() => setRules([]));
  }, []);
  useEffect(() => {
    if (!sale.customer) return setCustomer(null);
    api<CustomerDetail>(`/customers/${sale.customer.id}`)
      .then(setCustomer)
      .catch(() => setCustomer(null));
  }, [sale.customer, sale.total]);

  const rule = rules.find((r) => r.activity === activity);
  const balance = customer?.wallets.find((w) => w.activity === activity)?.balance ?? 0;
  const locked = sale.paymentStatus === 'PAID';

  async function run(action: () => Promise<Sale>) {
    setBusy(true);
    setError(null);
    try {
      onChange(await action());
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  async function search() {
    if (q.trim().length < CUSTOMER_SEARCH_MIN_LENGTH) return;
    setError(null);
    try {
      setResults(await api<CustomerSummary[]>(`/customers?q=${encodeURIComponent(q.trim())}`));
    } catch (e) {
      setError(e as ApiError);
    }
  }

  const attach = (customerId: string | null) =>
    run(() => api<Sale>(`/sales/${sale.id}/customer`, { method: 'PUT', body: { customerId } }));

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const created = await api<CustomerDetail>('/customers', {
        method: 'POST',
        body: {
          firstName: newCustomer.firstName.trim() || null,
          phone: newCustomer.phone.trim() || null,
          consent: newCustomer.consent,
        },
      });
      setCreating(false);
      onChange(
        await api<Sale>(`/sales/${sale.id}/customer`, {
          method: 'PUT',
          body: { customerId: created.id },
        }),
      );
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Client et fidélité"
      className="space-y-3 rounded-2xl border border-line p-4"
    >
      <h3 className="flex items-center gap-2 font-semibold">
        <Gift className="h-4 w-4 text-forest" aria-hidden /> Client et fidélité (facultatif)
      </h3>
      <ApiErrorAlert error={error} />
      {sale.customer ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p>
              <span className="font-semibold" data-testid="sale-customer">
                {customerDisplayName(sale.customer)}
              </span>
              {rule?.isActive && <span className="text-sm text-muted"> · {balance} points</span>}
            </p>
            {!locked && sale.loyaltyPointsRedeemed === 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={<X className="h-4 w-4" />}
                onClick={() => attach(null)}
                disabled={busy}
              >
                Retirer
              </Button>
            )}
          </div>
          {rule?.isActive &&
            !locked &&
            sale.loyaltyPointsRedeemed === 0 &&
            balance >= rule.minRedeemPoints && (
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-[140px] flex-1 text-sm">
                  Utiliser des points (minimum {rule.minRedeemPoints}, 1 point ={' '}
                  {formatXof(rule.redeemValue)})
                  <input
                    className={FIELD}
                    inputMode="numeric"
                    value={points}
                    onChange={(e) => setPoints(e.target.value.replace(/\D/g, ''))}
                  />
                </label>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy || points === ''}
                  onClick={() =>
                    run(() =>
                      api<Sale>(`/sales/${sale.id}/loyalty-redemption`, {
                        method: 'POST',
                        body: { points: Number(points) },
                      }),
                    )
                  }
                >
                  Appliquer
                </Button>
              </div>
            )}
          {sale.loyaltyPointsRedeemed > 0 && !locked && (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-forest-light px-3 py-2 text-sm">
              <span>
                {sale.loyaltyPointsRedeemed} points utilisés : −{formatXof(sale.loyaltyDiscount)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(() => api<Sale>(`/sales/${sale.id}/loyalty-redemption`, { method: 'DELETE' }))
                }
              >
                Annuler la remise
              </Button>
            </div>
          )}
          {rule?.isActive && (
            <p className="text-xs text-muted">
              Les points sont crédités après le paiement, sur le montant payé (
              {formatXof(rule.earnAmountStep)} = 1 point).
            </p>
          )}
        </div>
      ) : creating ? (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className={FIELD}
              placeholder="Prénom"
              aria-label="Prénom du client"
              value={newCustomer.firstName}
              onChange={(e) => setNewCustomer({ ...newCustomer, firstName: e.target.value })}
            />
            <input
              className={FIELD}
              placeholder="Téléphone"
              aria-label="Téléphone du client"
              inputMode="tel"
              value={newCustomer.phone}
              onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
            />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-forest"
              checked={newCustomer.consent}
              onChange={(e) => setNewCustomer({ ...newCustomer, consent: e.target.checked })}
            />
            <span>Le client accepte la conservation de sa fiche (obligatoire).</span>
          </label>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy || !newCustomer.consent}
              onClick={create}
            >
              Créer et rattacher
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>
              Annuler
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              className={FIELD}
              placeholder={`Nom ou téléphone (${CUSTOMER_SEARCH_MIN_LENGTH} caractères min.)`}
              aria-label="Rechercher un client"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void search();
                }
              }}
            />
            <Button
              type="button"
              variant="secondary"
              aria-label="Rechercher"
              icon={<Search className="h-4 w-4" />}
              onClick={search}
            />
            {canCreate && (
              <Button
                type="button"
                variant="ghost"
                aria-label="Nouveau client"
                icon={<UserPlus className="h-4 w-4" />}
                onClick={() => setCreating(true)}
              />
            )}
          </div>
          {results && results.length === 0 && (
            <p className="text-sm text-muted">Aucun client trouvé.</p>
          )}
          {results && results.length > 0 && (
            <ul className="divide-y divide-line/70 rounded-xl border border-line">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="flex w-full justify-between gap-2 px-3 py-2 text-left hover:bg-forest-light/40"
                    onClick={() => attach(c.id)}
                    disabled={busy}
                  >
                    <span>{customerDisplayName(c)}</span>
                    <span className="text-sm text-muted">{c.phone ?? ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

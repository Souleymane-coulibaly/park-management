'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Search } from 'lucide-react';
import {
  STOCK_FACTURE_ERROR_LABELS,
  STOCK_FACTURE_SYNC_LABELS,
  type StockFactureSyncStatus,
  formatStockQuantity,
  formatVatRate,
  formatXof,
} from '@ocall/shared';
import type { FactureItemView } from '@/app/facture/catalogue/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { Alert, ApiErrorAlert } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';

/** Article Ocall Stock proposé par la recherche de Facture (S5). */
interface StockCandidate {
  variantId: string;
  sku: string;
  label: string;
  unit: string;
  isStockable: boolean;
  salePrice: number;
  unitPriceHt: number;
  vatRate: number;
  vatSupported: boolean;
  /** Disponible à l'emplacement des ventes Facture ; null si inconnu (droit Stock, emplacement). */
  available: number | null;
  mirror: { id: string; name: string } | null;
  duplicate: { id: string; name: string } | null;
}

const toError = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.');

/**
 * « Articles Ocall Stock » : recherche (nom, référence, code-barres) dans Stock, prix du jour et
 * disponibilité, puis ajout. Un article Facture de même référence est proposé au rapprochement : rien n'est
 * lié sans le choix de l'utilisateur.
 */
export function StockItemPicker({ onPicked }: { onPicked: (item: FactureItemView) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<StockCandidate[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [choice, setChoice] = useState<StockCandidate | null>(null);

  async function search() {
    if (q.trim().length < 2) return;
    setBusy('search');
    setError(null);
    setChoice(null);
    try {
      setResults(
        await api<StockCandidate[]>(
          `/facture/stock/search?${new URLSearchParams({ q: q.trim() })}`,
        ),
      );
    } catch (e) {
      setError(toError(e));
    } finally {
      setBusy(null);
    }
  }

  async function use(c: StockCandidate, extra: { linkItemId?: string; distinct?: boolean } = {}) {
    setBusy(c.variantId);
    setError(null);
    try {
      const item = await api<FactureItemView>('/facture/stock/items', {
        method: 'POST',
        body: { variantId: c.variantId, ...extra },
      });
      setChoice(null);
      onPicked(item);
    } catch (e) {
      const err = toError(e);
      if (err.code === 'FACTURE_STOCK_DUPLICATE') setChoice(c);
      else setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-line p-3" data-testid="facture-stock-picker">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <div className="min-w-0 flex-1">
          <InputField
            label="Articles Ocall Stock (nom, référence, code-barres)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={80}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={busy !== null || q.trim().length < 2}>
          <Search className="h-4 w-4" aria-hidden /> Chercher
        </Button>
      </form>
      <ApiErrorAlert error={error} />
      {choice?.duplicate && (
        <Alert tone="info" title="Article Facture de même référence">
          <p>
            « {choice.duplicate.name} » porte déjà la référence {choice.sku}. Rapprochez-le de
            l’article Ocall Stock (il en reprendra le nom et le prix, en lecture seule) ou créez un
            article distinct.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              size="sm"
              onClick={() => void use(choice, { linkItemId: choice.duplicate!.id })}
              disabled={busy !== null}
            >
              Rapprocher
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void use(choice, { distinct: true })}
              disabled={busy !== null}
            >
              Créer un article distinct
            </Button>
          </div>
        </Alert>
      )}
      {results && results.length === 0 && (
        <p className="text-sm text-muted">Aucun article Ocall Stock ne correspond.</p>
      )}
      {results && results.length > 0 && (
        <ul className="divide-y divide-line" data-testid="facture-stock-results">
          {results.map((c) => (
            <li key={c.variantId} className="flex flex-wrap items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{c.label}</p>
                <p className="text-xs text-muted">
                  {[
                    c.sku,
                    `${formatXof(c.unitPriceHt)} HT (${formatXof(c.salePrice)} TTC) / ${c.unit}`,
                    `TVA ${formatVatRate(c.vatRate)}`,
                    c.isStockable
                      ? c.available === null
                        ? null
                        : `Disponible : ${formatStockQuantity(c.available)}`
                      : 'Service (non stocké)',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {!c.vatSupported && (
                  <p className="text-xs text-terracotta-dark">
                    TVA hors de la plage d’Ocall Facture (0 à 20 %).
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void use(c)}
                disabled={busy !== null || !c.vatSupported}
              >
                {busy === c.variantId ? 'Ajout…' : 'Ajouter'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Demande de mouvement transmise (ou non) à Ocall Stock pour un document émis. */
export interface StockSyncView {
  id: string;
  source: 'INVOICE' | 'INTERVENTION' | 'CREDIT_NOTE';
  status: StockFactureSyncStatus;
  lastError: string | null;
  lines: { variantId: string; quantity: number }[];
}

const SYNC_TONE: Record<StockFactureSyncStatus, 'forest' | 'savanna' | 'terracotta' | 'neutral'> = {
  PENDING: 'savanna',
  DONE: 'forest',
  FAILED: 'terracotta',
  SKIPPED: 'neutral',
};

/** État Stock d'un document : mis à jour, en cours, en échec (motif), ou non mis à jour (Stock échu). */
export function StockSyncNote({ sync, link = true }: { sync: StockSyncView; link?: boolean }) {
  const reason =
    sync.lastError && sync.lastError !== 'TRANSIENT'
      ? (STOCK_FACTURE_ERROR_LABELS[sync.lastError] ?? sync.lastError)
      : null;
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="facture-stock-sync">
      <Badge tone={SYNC_TONE[sync.status]}>{STOCK_FACTURE_SYNC_LABELS[sync.status]}</Badge>
      {sync.status === 'DONE' && sync.lines.length === 0 && (
        <span className="text-muted">
          Articles déjà sortis du stock par la vente ou l’intervention.
        </span>
      )}
      {reason && <span className="text-muted">{reason}</span>}
      {link && sync.status === 'FAILED' && (
        <Link href="/facture/stock" className="font-medium text-forest underline">
          Voir et relancer
        </Link>
      )}
    </p>
  );
}

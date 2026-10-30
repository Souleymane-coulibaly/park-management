'use client';

import { type FormEvent, useState } from 'react';
import { Boxes, Plus, Trash2 } from 'lucide-react';
import {
  STOCK_MOVEMENT_LABELS,
  STOCK_UNITS,
  STOCK_UNIT_LABELS,
  type ManualStockMovementKind,
  type StockUnit,
  formatXof,
} from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { RestaurantNav } from '@/components/restaurant/restaurant-nav';
import { RestaurantScope } from '@/components/restaurant/restaurant-scope';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { newRequestId } from '@/lib/request-id';
import type { PosCatalogCategory, Recipe, StockItem, StockMovement } from '@/lib/types';
import { useApi } from '@/lib/use-api';

const qty = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 3 });
const unit = (u: StockUnit) => STOCK_UNIT_LABELS[u];

type Tab = 'items' | 'movements' | 'recipes';

/** Stocks du restaurant : articles, mouvements, inventaires, recettes et alertes. */
export default function StocksPage() {
  const canRead = useCan('stock.read');
  if (!canRead) return <AccessDenied />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Stocks</h1>
        <RestaurantNav />
      </div>
      <RestaurantScope>{(e) => <Stocks establishmentId={e.id} />}</RestaurantScope>
    </div>
  );
}

function Stocks({ establishmentId }: { establishmentId: string }) {
  const canManage = useCan('stock.manage');
  const [tab, setTab] = useState<Tab>('items');
  const items = useApi<StockItem[]>(`/stock/items?establishmentId=${establishmentId}`);
  const tabs: { key: Tab; label: string }[] = [
    { key: 'items', label: 'Articles' },
    { key: 'movements', label: 'Mouvements' },
    ...(canManage ? [{ key: 'recipes' as const, label: 'Recettes' }] : []),
  ];
  return (
    <div className="space-y-3">
      <Alert tone="info">
        Les ingrédients d’une vente sont déduits une seule fois : à l’envoi en cuisine, ou au
        paiement si la commande n’a jamais été envoyée. Un coût d’achat inconnu reste inconnu.
      </Alert>
      <div role="tablist" aria-label="Stocks" className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`min-h-11 rounded-xl px-4 text-sm font-semibold ${tab === t.key ? 'bg-forest text-white' : 'border border-line bg-surface hover:border-forest'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {items.state === 'loading' && <LoadingState />}
      {items.state === 'error' && <ErrorState error={items.error} onRetry={items.reload} />}
      {items.state === 'success' && tab === 'items' && (
        <ItemsTab establishmentId={establishmentId} items={items.data} reload={items.reload} />
      )}
      {items.state === 'success' && tab === 'movements' && (
        <MovementsTab establishmentId={establishmentId} />
      )}
      {items.state === 'success' && tab === 'recipes' && (
        <RecipesTab
          establishmentId={establishmentId}
          items={items.data.filter((i) => i.isActive)}
        />
      )}
    </div>
  );
}

function ItemsTab({
  establishmentId,
  items,
  reload,
}: {
  establishmentId: string;
  items: StockItem[];
  reload: () => void;
}) {
  const canManage = useCan('stock.manage');
  const canMove = useCan('stock.move');
  const [editing, setEditing] = useState<StockItem | 'new' | null>(null);
  const [moving, setMoving] = useState<StockItem | null>(null);
  const alerts = items.filter((i) => i.low && i.isActive);
  return (
    <Card>
      <CardHeader
        title="Articles et ingrédients"
        description={
          alerts.length > 0
            ? `${alerts.length} article(s) sous le seuil d’alerte`
            : 'Aucune alerte de stock'
        }
        action={
          canManage && (
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
              Nouvel article
            </Button>
          )
        }
      />
      {items.length === 0 ? (
        <EmptyState
          icon={<Boxes className="h-7 w-7" />}
          title="Aucun article en stock"
          description="Créez vos ingrédients et articles, puis enregistrez les entrées."
        />
      ) : (
        <Table head={['Article', 'Quantité', 'Seuil d’alerte', 'Coût d’achat', 'État', '']}>
          {items.map((i) => (
            <tr key={i.id} data-testid="stock-item">
              <Td className="font-medium">{i.name}</Td>
              <Td>
                {qty(i.quantity)} {unit(i.unit)}
              </Td>
              <Td>
                {i.alertThreshold !== null ? `${qty(i.alertThreshold)} ${unit(i.unit)}` : '—'}
              </Td>
              <Td>
                {i.unitCost !== null ? `${formatXof(i.unitCost)} / ${unit(i.unit)}` : 'Inconnu'}
              </Td>
              <Td>
                {!i.isActive ? (
                  <Badge>Désactivé</Badge>
                ) : i.low ? (
                  <Badge tone="terracotta">Alerte</Badge>
                ) : (
                  <Badge tone="forest">OK</Badge>
                )}
              </Td>
              <Td>
                <div className="flex justify-end gap-2">
                  {canMove && i.isActive && (
                    <Button size="sm" variant="secondary" onClick={() => setMoving(i)}>
                      Mouvement
                    </Button>
                  )}
                  {canManage && (
                    <Button size="sm" variant="ghost" onClick={() => setEditing(i)}>
                      Modifier
                    </Button>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {editing && (
        <ItemDialog
          establishmentId={establishmentId}
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {moving && (
        <MovementDialog
          item={moving}
          onClose={() => setMoving(null)}
          onSaved={() => {
            setMoving(null);
            reload();
          }}
        />
      )}
    </Card>
  );
}

function ItemDialog({
  establishmentId,
  item,
  onClose,
  onSaved,
}: {
  establishmentId: string;
  item: StockItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(item?.name ?? '');
  const [unitValue, setUnit] = useState<StockUnit>(item?.unit ?? 'UNIT');
  const [threshold, setThreshold] = useState(item?.alertThreshold?.toString() ?? '');
  const [cost, setCost] = useState(item?.unitCost?.toString() ?? '');
  const [isActive, setIsActive] = useState(item?.isActive ?? true);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const common = {
      name,
      alertThreshold: threshold === '' ? null : Number(threshold),
      unitCost: cost === '' ? null : Number(cost),
    };
    try {
      if (item) {
        await api(`/stock/items/${item.id}`, { method: 'PATCH', body: { ...common, isActive } });
      } else {
        await api('/stock/items', {
          method: 'POST',
          body: { ...common, establishmentId, unit: unitValue },
        });
      }
      onSaved();
    } catch (e) {
      setError(e as ApiError);
      setLoading(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title={item ? `Modifier ${item.name}` : 'Nouvel article'}>
      <form onSubmit={onSubmit} className="space-y-4">
        <ApiErrorAlert error={error} />
        <InputField
          label="Nom"
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Poulet entier"
        />
        {!item && (
          <SelectField
            label="Unité"
            value={unitValue}
            onChange={(e) => setUnit(e.target.value as StockUnit)}
            options={STOCK_UNITS.map((u) => ({ value: u, label: STOCK_UNIT_LABELS[u] }))}
          />
        )}
        <InputField
          label="Seuil d’alerte (facultatif)"
          type="number"
          min={0}
          step="0.001"
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
        />
        <InputField
          label="Coût d’achat unitaire en FCFA (facultatif)"
          type="number"
          min={0}
          step={1}
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          hint="Laissé vide s’il est inconnu : aucun coût n’est estimé."
        />
        {item && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-forest"
              checked={!isActive}
              onChange={(e) => setIsActive(!e.target.checked)}
            />
            Désactiver l’article
          </label>
        )}
        <Button type="submit" className="w-full" loading={loading}>
          Enregistrer
        </Button>
      </form>
    </Dialog>
  );
}

function MovementDialog({
  item,
  onClose,
  onSaved,
}: {
  item: StockItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const canManage = useCan('stock.manage');
  const [kind, setKind] = useState<ManualStockMovementKind>('IN');
  const [quantity, setQuantity] = useState('');
  const [cost, setCost] = useState('');
  const [reason, setReason] = useState('');
  // Une clé par saisie : un double appui ou une reprise réseau n'enregistre pas deux mouvements.
  const [requestId] = useState(newRequestId);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const kinds: ManualStockMovementKind[] = canManage ? ['IN', 'OUT', 'ADJUSTMENT'] : ['IN', 'OUT'];
  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api('/stock/movements', {
        method: 'POST',
        body: {
          stockItemId: item.id,
          kind,
          quantity: Number(quantity),
          ...(kind === 'IN' && cost !== '' ? { unitCost: Number(cost) } : {}),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          clientRequestId: requestId,
        },
      });
      onSaved();
    } catch (e) {
      setError(e as ApiError);
      setLoading(false);
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={item.name}
      description={`En stock : ${qty(item.quantity)} ${unit(item.unit)}`}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <ApiErrorAlert error={error} />
        <SelectField
          label="Type de mouvement"
          value={kind}
          onChange={(e) => setKind(e.target.value as ManualStockMovementKind)}
          options={kinds.map((k) => ({ value: k, label: STOCK_MOVEMENT_LABELS[k] }))}
        />
        <InputField
          label={
            kind === 'ADJUSTMENT'
              ? `Quantité comptée (${unit(item.unit)})`
              : `Quantité (${unit(item.unit)})`
          }
          type="number"
          min={0}
          step="0.001"
          required
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          hint={
            kind === 'ADJUSTMENT'
              ? 'Inventaire : la quantité réellement présente ; l’écart est enregistré.'
              : undefined
          }
        />
        {kind === 'IN' && (
          <InputField
            label="Coût d’achat unitaire en FCFA (facultatif)"
            type="number"
            min={0}
            step={1}
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
        )}
        <InputField
          label="Motif"
          maxLength={200}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Livraison, perte, inventaire…"
        />
        <Button type="submit" className="w-full" loading={loading}>
          Enregistrer le mouvement
        </Button>
      </form>
    </Dialog>
  );
}

function MovementsTab({ establishmentId }: { establishmentId: string }) {
  const movements = useApi<StockMovement[]>(`/stock/movements?establishmentId=${establishmentId}`);
  if (movements.state === 'loading') return <LoadingState />;
  if (movements.state === 'error')
    return <ErrorState error={movements.error} onRetry={movements.reload} />;
  return (
    <Card>
      <CardHeader title="Historique des mouvements" description="Les 200 derniers mouvements" />
      {movements.data.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted">Aucun mouvement.</p>
        </CardBody>
      ) : (
        <Table head={['Date', 'Article', 'Type', 'Variation', 'Après', 'Motif', 'Par']}>
          {movements.data.map((m) => (
            <tr key={m.id}>
              <Td>{formatDateTime(m.createdAt)}</Td>
              <Td className="font-medium">{m.stockItem.name}</Td>
              <Td>{STOCK_MOVEMENT_LABELS[m.kind]}</Td>
              <Td className={m.quantity < 0 ? 'text-terracotta-dark' : 'text-forest'}>
                {m.quantity > 0 ? '+' : ''}
                {qty(m.quantity)} {unit(m.stockItem.unit)}
              </Td>
              <Td>{qty(m.quantityAfter)}</Td>
              <Td>
                {m.saleNumber !== null
                  ? `Vente n° ${String(m.saleNumber).padStart(6, '0')}`
                  : (m.reason ?? '—')}
              </Td>
              <Td>{m.actorName ?? '—'}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function RecipesTab({ establishmentId, items }: { establishmentId: string; items: StockItem[] }) {
  const catalog = useApi<PosCatalogCategory[]>(`/pos/catalog?establishmentId=${establishmentId}`);
  const recipes = useApi<Recipe[]>(`/stock/recipes?establishmentId=${establishmentId}`);
  const [variantId, setVariantId] = useState('');
  if (catalog.state === 'loading' || recipes.state === 'loading') return <LoadingState />;
  if (catalog.state === 'error')
    return <ErrorState error={catalog.error} onRetry={catalog.reload} />;
  if (recipes.state === 'error')
    return <ErrorState error={recipes.error} onRetry={recipes.reload} />;
  const variants = catalog.data.flatMap((c) =>
    c.products.flatMap((p) =>
      p.variants.map((v) => ({ id: v.id, label: `${p.name} (${v.name})` })),
    ),
  );
  const current = recipes.data.find((r) => r.variantId === variantId);
  return (
    <Card>
      <CardHeader
        title="Recettes"
        description="Ingrédients consommés par unité vendue, pour cet établissement"
      />
      <CardBody className="space-y-4">
        <SelectField
          label="Article vendu"
          value={variantId}
          onChange={(e) => setVariantId(e.target.value)}
          options={[
            { value: '', label: 'Choisir un article…' },
            ...variants.map((v) => ({
              value: v.id,
              label: `${v.label}${recipes.data.some((r) => r.variantId === v.id) ? ' ✓' : ''}`,
            })),
          ]}
        />
        {variantId && (
          <RecipeEditor
            key={variantId}
            establishmentId={establishmentId}
            variantId={variantId}
            items={items}
            initial={
              current?.components.map((c) => ({
                stockItemId: c.stockItemId,
                quantity: String(c.quantity),
              })) ?? []
            }
            onSaved={recipes.reload}
          />
        )}
      </CardBody>
    </Card>
  );
}

function RecipeEditor({
  establishmentId,
  variantId,
  items,
  initial,
  onSaved,
}: {
  establishmentId: string;
  variantId: string;
  items: StockItem[];
  initial: { stockItemId: string; quantity: string }[];
  onSaved: () => void;
}) {
  const [rows, setRows] = useState(initial);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  async function save() {
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      await api(`/stock/recipes/${variantId}`, {
        method: 'PUT',
        body: {
          establishmentId,
          components: rows
            .filter((r) => r.stockItemId && r.quantity !== '')
            .map((r) => ({ stockItemId: r.stockItemId, quantity: Number(r.quantity) })),
        },
      });
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="space-y-3">
      <ApiErrorAlert error={error} />
      {saved && <Alert tone="success">Recette enregistrée.</Alert>}
      {rows.length === 0 && (
        <p className="text-sm text-muted">Aucun ingrédient : la vente ne consomme pas de stock.</p>
      )}
      {rows.map((r, index) => {
        const item = items.find((i) => i.id === r.stockItemId);
        return (
          <div key={index} className="grid grid-cols-[minmax(0,1fr)_120px_auto] items-end gap-2">
            <SelectField
              label="Ingrédient"
              value={r.stockItemId}
              onChange={(e) =>
                setRows((all) =>
                  all.map((x, i) => (i === index ? { ...x, stockItemId: e.target.value } : x)),
                )
              }
              options={[
                { value: '', label: 'Choisir…' },
                ...items.map((i) => ({ value: i.id, label: i.name })),
              ]}
            />
            <InputField
              label={item ? `Quantité (${unit(item.unit)})` : 'Quantité'}
              type="number"
              min={0.001}
              step="0.001"
              value={r.quantity}
              onChange={(e) =>
                setRows((all) =>
                  all.map((x, i) => (i === index ? { ...x, quantity: e.target.value } : x)),
                )
              }
            />
            <Button
              variant="ghost"
              aria-label="Retirer l’ingrédient"
              icon={<Trash2 className="h-4 w-4" />}
              onClick={() => setRows((all) => all.filter((_, i) => i !== index))}
            />
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          icon={<Plus className="h-4 w-4" />}
          onClick={() => setRows((all) => [...all, { stockItemId: '', quantity: '' }])}
        >
          Ajouter un ingrédient
        </Button>
        <Button loading={loading} onClick={save}>
          Enregistrer la recette
        </Button>
      </div>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { FileText, Plus, Trash2 } from 'lucide-react';
import {
  FACTURE_CONVERSIONS,
  FACTURE_DOCUMENT_TYPE_LABELS,
  FACTURE_ISSUABLE_TYPES,
  FACTURE_LIVE_STATUSES,
  FACTURE_VAT_RATES,
  type FactureDocumentStatus,
  type FactureDocumentType,
  type FactureVatBucket,
  canAcceptFactureDocument,
  canCancelFactureDocument,
  computeFactureTotals,
  formatVatRate,
  formatXof,
} from '@ocall/shared';
import type { FactureItemView } from '../../catalogue/page';
import { DocumentStatusBadge } from '@/components/facture/document-status-badge';
import {
  InvoiceBilling,
  type InvoiceBillingView,
  type InvoicePayment,
} from '@/components/facture/invoice-billing';
import { FacturePage } from '@/components/facture/facture-page';
import {
  StockItemPicker,
  StockSyncNote,
  type StockSyncView,
} from '@/components/facture/stock-picker';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface LineView {
  itemId: string | null;
  reference: string | null;
  label: string;
  description: string | null;
  unit: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  vatRate: number;
  totalHt?: number;
}

interface DocumentView {
  id: string;
  type: FactureDocumentType;
  status: FactureDocumentStatus;
  number: string | null;
  issueDate: string | null;
  validUntil: string | null;
  clientId: string;
  subject: string | null;
  clientReference: string | null;
  notes: string | null;
  terms: string | null;
  vatExemptionReason: string | null;
  validityDays: number | null;
  paymentTermsDays: number | null;
  dueDate: string | null;
  amountPaid: number;
  amountCredited: number;
  balance: number | null;
  overdue: boolean;
  reminderCount: number;
  lastReminderAt: string | null;
  payments: InvoicePayment[];
  creditNotes: InvoiceBillingView['creditNotes'];
  creditedInvoice: { id: string; number: string | null } | null;
  /** Facture créée depuis une intervention (F3) : son client ne change pas. */
  intervention: { id: string; number: string } | null;
  /** S5 : facture d'une vente en caisse Ocall Stock (lignes déjà sorties du stock). */
  stockSaleNumber: string | null;
  /** S5 : avoir dont la marchandise revient en stock. */
  stockReturnGoods: boolean;
  /** S5 : demande de mouvement transmise (ou non) à Ocall Stock. */
  stockSync: StockSyncView | null;
  updatedAt: string;
  totalHt: number;
  totalVat: number;
  totalTtc: number;
  vatBreakdown: FactureVatBucket[];
  sentCount: number;
  cancelReason: string | null;
  lines: LineView[];
  client: { id: string; name: string; email: string | null };
  clientArchived: boolean;
  source: { id: string; type: FactureDocumentType; number: string | null } | null;
  derived: {
    id: string;
    type: FactureDocumentType;
    number: string | null;
    status: FactureDocumentStatus;
  }[];
}

const TEXTAREA =
  'w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/30 disabled:opacity-60';
const VAT_OPTIONS = FACTURE_VAT_RATES.map((r) => ({ value: String(r), label: formatVatRate(r) }));
const toError = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.');
const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'UTC' });

/**
 * Un document : édition du brouillon, puis émission, envoi, conversion, annulation, PDF ; pour une
 * facture émise, encaissements, avoirs et relance.
 */
export default function FactureDocumentPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <FacturePage title="Document">
      {({ canWrite }) => (
        <DocumentScreen
          id={id}
          canManage={canWrite('facture.documents.manage')}
          canBill={canWrite('facture.billing.manage')}
        />
      )}
    </FacturePage>
  );
}

function DocumentScreen({
  id,
  canManage,
  canBill,
}: {
  id: string;
  canManage: boolean;
  canBill: boolean;
}) {
  const document = useApi<DocumentView>(`/facture/documents/${id}`);
  if (document.state === 'loading') return <LoadingState />;
  if (document.state === 'error') {
    return <ErrorState error={document.error} onRetry={document.reload} />;
  }
  const doc = document.data;
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold" data-testid="facture-document-number">
          {FACTURE_DOCUMENT_TYPE_LABELS[doc.type]} {doc.number ?? '— brouillon'}
        </h2>
        <span data-testid="facture-document-status">
          <DocumentStatusBadge status={doc.status} />
        </span>
        <a
          href={`/api/v1/facture/documents/${doc.id}/pdf`}
          className="inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm font-medium hover:bg-ivory"
          data-testid="facture-document-pdf"
        >
          <FileText className="h-4 w-4" aria-hidden />
          {doc.number ? 'PDF' : 'Aperçu PDF'}
        </a>
      </div>
      {doc.stockSync && <StockSyncNote sync={doc.stockSync} />}
      {(doc.source ||
        doc.derived.length > 0 ||
        doc.creditedInvoice ||
        doc.intervention ||
        doc.stockSaleNumber) && (
        <p className="text-sm text-muted">
          {doc.stockSaleNumber && (
            <>
              Facture de la vente en caisse {doc.stockSaleNumber} (Ocall Stock) : ses articles sont
              déjà sortis du stock.{' '}
            </>
          )}
          {doc.intervention && (
            <>
              Facture de l’
              <Link
                href={`/facture/interventions/${doc.intervention.id}`}
                className="text-forest underline"
              >
                intervention {doc.intervention.number}
              </Link>
              .{' '}
            </>
          )}
          {doc.creditedInvoice && (
            <>
              Avoir sur la{' '}
              <Link
                href={`/facture/documents/${doc.creditedInvoice.id}`}
                className="text-forest underline"
              >
                facture {doc.creditedInvoice.number}
              </Link>
              .{' '}
            </>
          )}
          {doc.source && (
            <>
              Issu de{' '}
              <Link href={`/facture/documents/${doc.source.id}`} className="text-forest underline">
                {FACTURE_DOCUMENT_TYPE_LABELS[doc.source.type]} {doc.source.number}
              </Link>
              .{' '}
            </>
          )}
          {doc.derived.map((d) => (
            <span key={d.id}>
              Converti en{' '}
              <Link href={`/facture/documents/${d.id}`} className="text-forest underline">
                {FACTURE_DOCUMENT_TYPE_LABELS[d.type]} {d.number ?? '(brouillon)'}
              </Link>
              .{' '}
            </span>
          ))}
        </p>
      )}
      {doc.status === 'DRAFT' && canManage && (doc.type !== 'CREDIT_NOTE' || canBill) ? (
        <DraftEditor doc={doc} onSaved={document.reload} />
      ) : (
        <IssuedView doc={doc} canManage={canManage} canBill={canBill} onChanged={document.reload} />
      )}
    </>
  );
}

// ─── Brouillon ───

function DraftEditor({ doc, onSaved }: { doc: DocumentView; onSaved: () => void }) {
  const router = useRouter();
  const clients = useApi<{ id: string; name: string }[]>('/facture/clients');
  const items = useApi<FactureItemView[]>('/facture/items');
  const stock = useApi<{ available: boolean; writable: boolean }>('/facture/stock/status');
  const stockOn = stock.state === 'success' && stock.data.available;
  const [returnGoods, setReturnGoods] = useState(doc.stockReturnGoods);
  const [form, setForm] = useState(() => ({
    clientId: doc.clientId,
    subject: doc.subject ?? '',
    clientReference: doc.clientReference ?? '',
    validityDays: doc.validityDays,
    paymentTermsDays: doc.paymentTermsDays,
    terms: doc.terms ?? '',
    notes: doc.notes ?? '',
    vatExemptionReason: doc.vatExemptionReason ?? '',
  }));
  const [lines, setLines] = useState<LineView[]>(doc.lines);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Brouillon rechargé (après enregistrement) : on repart des données de l'API.
  useEffect(() => setLines(doc.lines), [doc.lines]);

  const totals = useMemo(() => {
    try {
      return computeFactureTotals(
        lines.map((l) => ({
          ...l,
          quantity: Number(l.quantity) || 0,
          unitPrice: Number(l.unitPrice) || 0,
        })),
      );
    } catch {
      return null;
    }
  }, [lines]);

  const update = (index: number, patch: Partial<LineView>) =>
    setLines((all) => all.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  function addFromCatalog(itemId: string) {
    const item = items.state === 'success' ? items.data.find((i) => i.id === itemId) : undefined;
    if (item) addItem(item);
  }

  function addItem(item: FactureItemView) {
    setLines((all) => [
      ...all,
      {
        itemId: item.id,
        reference: item.reference,
        label: item.name,
        description: item.description,
        unit: item.unit,
        quantity: 1,
        unitPrice: item.unitPrice,
        discountPercent: 0,
        vatRate: item.vatRate,
      },
    ]);
  }

  function addFreeLine() {
    setLines((all) => [
      ...all,
      {
        itemId: null,
        reference: null,
        label: '',
        description: null,
        unit: 'unité',
        quantity: 1,
        unitPrice: 0,
        discountPercent: 0,
        vatRate: 18,
      },
    ]);
  }

  const payload = () => ({
    clientId: form.clientId,
    subject: form.subject,
    clientReference: form.clientReference,
    terms: form.terms,
    notes: form.notes,
    vatExemptionReason: form.vatExemptionReason,
    ...(doc.type === 'QUOTE' || doc.type === 'PRO_FORMA'
      ? { validityDays: form.validityDays }
      : {}),
    ...(doc.type === 'INVOICE' ? { paymentTermsDays: form.paymentTermsDays } : {}),
    ...(doc.type === 'CREDIT_NOTE' ? { stockReturnGoods: returnGoods } : {}),
    lines: lines.map((l) => ({
      itemId: l.itemId,
      reference: l.reference ?? '',
      label: l.label,
      description: l.description ?? '',
      unit: l.unit,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      discountPercent: Number(l.discountPercent),
      vatRate: Number(l.vatRate),
    })),
  });

  async function run(action: string, work: () => Promise<void>) {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (e) {
      setError(toError(e));
    } finally {
      setBusy(null);
    }
  }

  const save = () =>
    run('save', async () => {
      await api(`/facture/documents/${doc.id}`, { method: 'PUT', body: payload() });
      setNotice('Brouillon enregistré.');
      onSaved();
    });

  const issue = () =>
    run('issue', async () => {
      await api(`/facture/documents/${doc.id}`, { method: 'PUT', body: payload() });
      await api(`/facture/documents/${doc.id}/issue`, { method: 'POST' });
      onSaved();
    });

  const remove = () =>
    run('remove', async () => {
      if (!window.confirm('Supprimer ce brouillon ?')) return;
      await api(`/facture/documents/${doc.id}`, { method: 'DELETE' });
      router.push('/facture/documents');
    });

  const field = (key: keyof typeof form) => ({
    value: (form[key] as string | null) ?? '',
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
  });
  const issuable = FACTURE_ISSUABLE_TYPES.includes(doc.type);

  return (
    <div className="space-y-6" data-testid="facture-document-editor">
      {notice && (
        <div role="status">
          <Alert tone="success" title={notice} />
        </div>
      )}
      <ApiErrorAlert error={error} />
      <Card>
        <CardHeader title="En-tête du document" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Client"
            disabled={doc.type === 'CREDIT_NOTE' || doc.intervention !== null}
            value={form.clientId}
            onChange={(e) => setForm({ ...form, clientId: e.target.value })}
            options={(clients.state === 'success'
              ? clients.data
              : [{ id: doc.clientId, name: doc.client.name }]
            ).map((c) => ({ value: c.id, label: c.name }))}
          />
          <InputField label="Titre du document (objet)" maxLength={200} {...field('subject')} />
          <InputField label="Référence du client" maxLength={80} {...field('clientReference')} />
          {doc.type === 'INVOICE' && (
            <InputField
              label="Délai de paiement (jours, 0 = à réception)"
              type="number"
              min={0}
              max={365}
              value={String(form.paymentTermsDays ?? '')}
              onChange={(e) =>
                setForm({
                  ...form,
                  paymentTermsDays: e.target.value === '' ? null : Number(e.target.value),
                })
              }
            />
          )}
          {(doc.type === 'QUOTE' || doc.type === 'PRO_FORMA') && (
            <InputField
              label="Validité (jours)"
              type="number"
              min={1}
              max={365}
              value={String(form.validityDays ?? '')}
              onChange={(e) =>
                setForm({ ...form, validityDays: e.target.value ? Number(e.target.value) : null })
              }
            />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Lignes" />
        <CardBody className="space-y-4">
          {lines.length === 0 && <p className="text-sm text-muted">Aucune ligne.</p>}
          {lines.map((l, i) => (
            <div
              key={i}
              className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-12"
              data-testid="facture-line-row"
            >
              <div className="sm:col-span-2">
                <InputField
                  label="Réf."
                  maxLength={40}
                  value={l.reference ?? ''}
                  onChange={(e) => update(i, { reference: e.target.value })}
                />
              </div>
              <div className="sm:col-span-5">
                <InputField
                  label="Désignation"
                  required
                  maxLength={200}
                  value={l.label}
                  onChange={(e) => update(i, { label: e.target.value })}
                />
              </div>
              <div className="sm:col-span-5">
                <InputField
                  label="Description (facultatif)"
                  maxLength={1000}
                  value={l.description ?? ''}
                  onChange={(e) => update(i, { description: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <InputField
                  label="Quantité"
                  type="number"
                  min={0.001}
                  step={0.001}
                  value={String(l.quantity)}
                  onChange={(e) => update(i, { quantity: e.target.value as unknown as number })}
                />
              </div>
              <div className="sm:col-span-2">
                <InputField
                  label="Unité"
                  maxLength={24}
                  value={l.unit}
                  onChange={(e) => update(i, { unit: e.target.value })}
                />
              </div>
              <div className="sm:col-span-3">
                <InputField
                  label="P.U. HT (FCFA)"
                  type="number"
                  min={0}
                  step={1}
                  value={String(l.unitPrice)}
                  onChange={(e) => update(i, { unitPrice: e.target.value as unknown as number })}
                />
              </div>
              <div className="sm:col-span-2">
                <InputField
                  label="Remise %"
                  type="number"
                  min={0}
                  max={100}
                  value={String(l.discountPercent)}
                  onChange={(e) => update(i, { discountPercent: Number(e.target.value) })}
                />
              </div>
              <div className="sm:col-span-2">
                <SelectField
                  label="TVA"
                  value={String(l.vatRate)}
                  onChange={(e) => update(i, { vatRate: Number(e.target.value) })}
                  options={VAT_OPTIONS}
                />
              </div>
              <div className="flex items-end justify-between gap-2 sm:col-span-1">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  aria-label="Retirer la ligne"
                  onClick={() => setLines((all) => all.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
              <p className="text-right text-sm font-semibold sm:col-span-12">
                {totals ? formatXof(totals.lines[i] ?? 0) : '—'} HT
              </p>
            </div>
          ))}
          <div className="flex flex-wrap items-end gap-3">
            {items.state === 'success' && items.data.length > 0 && (
              <SelectField
                label="Ajouter depuis le catalogue"
                value=""
                onChange={(e) => addFromCatalog(e.target.value)}
                options={[
                  { value: '', label: 'Choisir un article' },
                  ...items.data.map((it) => ({
                    value: it.id,
                    label: `${it.reference ? `${it.reference} — ` : ''}${it.name} (${formatXof(it.unitPrice)})`,
                  })),
                ]}
              />
            )}
            <Button
              type="button"
              variant="secondary"
              onClick={addFreeLine}
              data-testid="facture-add-line"
            >
              <Plus className="h-4 w-4" aria-hidden /> Ligne libre
            </Button>
          </div>
          {stockOn && doc.type !== 'CREDIT_NOTE' && (
            <StockItemPicker
              onPicked={(item) => {
                addItem(item);
                items.reload();
              }}
            />
          )}
        </CardBody>
      </Card>

      {stockOn && doc.type === 'INVOICE' && <StockPreview doc={doc} />}
      {stockOn && doc.type === 'CREDIT_NOTE' && (
        <Card>
          <CardBody>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={returnGoods}
                onChange={(e) => setReturnGoods(e.target.checked)}
                data-testid="facture-stock-return"
              />
              <span>
                <strong>Marchandise retournée</strong> : à l’émission de l’avoir, les articles Ocall
                Stock reviennent en stock (jamais plus que ce que la facture a sorti).
              </span>
            </label>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Conditions et mentions" />
        <CardBody className="grid gap-4">
          {lines.some((l) => Number(l.vatRate) === 0) && (
            <InputField
              label="Motif d’exonération de TVA (exigé à l’émission)"
              maxLength={300}
              {...field('vatExemptionReason')}
            />
          )}
          <div>
            <label htmlFor="facture-doc-terms" className="mb-1 block text-sm font-medium">
              Conditions
            </label>
            <textarea
              id="facture-doc-terms"
              rows={3}
              maxLength={2000}
              className={TEXTAREA}
              {...field('terms')}
            />
          </div>
          <div>
            <label htmlFor="facture-doc-notes" className="mb-1 block text-sm font-medium">
              Notes
            </label>
            <textarea
              id="facture-doc-notes"
              rows={2}
              maxLength={2000}
              className={TEXTAREA}
              {...field('notes')}
            />
          </div>
        </CardBody>
      </Card>

      <Totals
        totalHt={totals?.totalHt ?? 0}
        totalDiscount={totals?.totalDiscount ?? 0}
        vat={totals?.vat ?? []}
        totalTtc={totals?.totalTtc ?? 0}
      />

      <div className="flex flex-wrap gap-3">
        <Button onClick={() => void save()} loading={busy === 'save'} data-testid="facture-save">
          Enregistrer le brouillon
        </Button>
        {issuable && (
          <Button
            variant="secondary"
            onClick={() => {
              // Facture et avoir : définitifs une fois émis (correction par avoir seulement).
              const final =
                doc.type === 'INVOICE' || doc.type === 'CREDIT_NOTE'
                  ? window.confirm(
                      `Émettre ${doc.type === 'INVOICE' ? 'cette facture' : 'cet avoir'} ? Une fois émis, le document est définitif : il ne se modifie ni ne s’annule plus.`,
                    )
                  : true;
              if (final) void issue();
            }}
            loading={busy === 'issue'}
            data-testid="facture-issue"
          >
            Émettre (numéro définitif)
          </Button>
        )}
        {/* La facture d'une intervention ne se supprime pas (l'API le refuse aussi). */}
        {!doc.intervention && (
          <Button variant="secondary" onClick={() => void remove()} loading={busy === 'remove'}>
            Supprimer
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Document émis ───

function IssuedView({
  doc,
  canManage,
  canBill,
  onChanged,
}: {
  doc: DocumentView;
  canManage: boolean;
  canBill: boolean;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [to, setTo] = useState(doc.client.email ?? '');
  const [message, setMessage] = useState('');

  async function run(action: string, work: () => Promise<void>) {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (e) {
      setError(toError(e));
    } finally {
      setBusy(null);
    }
  }

  const post = (path: string, body?: unknown) =>
    api<{ id: string }>(`/facture/documents/${doc.id}/${path}`, { method: 'POST', body });

  const live = FACTURE_LIVE_STATUSES.includes(doc.status);
  const conversions = live ? (FACTURE_CONVERSIONS[doc.type] ?? []) : [];

  return (
    <div className="space-y-6">
      {notice && (
        <div role="status">
          <Alert tone="success" title={notice} />
        </div>
      )}
      <ApiErrorAlert error={error} />
      {doc.status === 'CANCELLED' && (
        <Alert tone="info" title="Document annulé">
          {doc.cancelReason}
        </Alert>
      )}
      <Card>
        <CardBody className="grid gap-2 text-sm sm:grid-cols-2">
          <p>
            <span className="text-muted">Client : </span>
            <strong>{doc.client.name}</strong>
          </p>
          {doc.subject && (
            <p>
              <span className="text-muted">Titre : </span>
              {doc.subject}
            </p>
          )}
          {doc.issueDate && (
            <p>
              <span className="text-muted">Émis le : </span>
              {dateFr(doc.issueDate)}
            </p>
          )}
          {doc.validUntil && (
            <p>
              <span className="text-muted">Valable jusqu’au : </span>
              {dateFr(doc.validUntil)}
            </p>
          )}
        </CardBody>
      </Card>
      {doc.type === 'INVOICE' && doc.status !== 'DRAFT' && (
        <InvoiceBilling
          invoice={doc as InvoiceBillingView}
          canBill={canBill}
          canManage={canManage}
          onChanged={onChanged}
        />
      )}
      <Card>
        <ul className="divide-y divide-line/70 text-sm">
          {doc.lines.map((l, i) => (
            <li key={i} className="flex flex-wrap justify-between gap-2 px-4 py-3">
              <span>
                {l.reference && (
                  <span className="mr-2 font-semibold text-forest">{l.reference}</span>
                )}
                {l.label} — {l.quantity} {l.unit} × {formatXof(l.unitPrice)}
                {l.discountPercent ? ` (−${l.discountPercent} %)` : ''} · TVA {l.vatRate} %
              </span>
              <strong>{formatXof(l.totalHt ?? 0)}</strong>
            </li>
          ))}
        </ul>
      </Card>
      <Totals
        label={doc.type === 'CREDIT_NOTE' ? 'Total de l’avoir' : undefined}
        totalHt={doc.totalHt}
        totalDiscount={0}
        vat={doc.vatBreakdown}
        totalTtc={doc.totalTtc}
      />

      {canManage && (
        <>
          {live && (
            <Card>
              <CardHeader
                title="Envoyer par e-mail"
                description={`PDF joint ; les réponses arrivent à l’adresse de votre entreprise.${doc.sentCount ? ` Déjà envoyé ${doc.sentCount} fois.` : ''}`}
              />
              <CardBody className="grid gap-3 sm:grid-cols-2">
                <InputField
                  label="Destinataire"
                  type="email"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
                <InputField
                  label="Message (facultatif)"
                  maxLength={2000}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <div className="sm:col-span-2">
                  <Button
                    loading={busy === 'send'}
                    data-testid="facture-send"
                    onClick={() =>
                      void run('send', async () => {
                        await post('send', {
                          ...(to ? { to } : {}),
                          ...(message ? { message } : {}),
                        });
                        setNotice('Document envoyé.');
                        onChanged();
                      })
                    }
                  >
                    Envoyer
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}
          <div className="flex flex-wrap gap-3">
            {canAcceptFactureDocument(doc) && (
              <>
                <Button
                  variant="secondary"
                  loading={busy === 'accept'}
                  onClick={() =>
                    void run('accept', async () => void (await post('accept'), onChanged()))
                  }
                >
                  Accepté par le client
                </Button>
                <Button
                  variant="secondary"
                  loading={busy === 'refuse'}
                  onClick={() =>
                    void run('refuse', async () => void (await post('refuse'), onChanged()))
                  }
                >
                  Refusé par le client
                </Button>
              </>
            )}
            {conversions.map((target) => (
              <Button
                key={target}
                variant="secondary"
                loading={busy === `convert-${target}`}
                data-testid={`facture-convert-${target}`}
                onClick={() =>
                  void run(`convert-${target}`, async () => {
                    const created = await post('convert', { type: target });
                    router.push(`/facture/documents/${created.id}`);
                  })
                }
              >
                Convertir en {FACTURE_DOCUMENT_TYPE_LABELS[target].toLowerCase()}
              </Button>
            ))}
            {doc.type !== 'CREDIT_NOTE' && (
              <Button
                variant="secondary"
                loading={busy === 'duplicate'}
                onClick={() =>
                  void run('duplicate', async () => {
                    const copy = await post('duplicate');
                    router.push(`/facture/documents/${copy.id}`);
                  })
                }
              >
                Dupliquer
              </Button>
            )}
            {canCancelFactureDocument(doc) && (
              <Button
                variant="secondary"
                loading={busy === 'cancel'}
                onClick={() =>
                  void run('cancel', async () => {
                    const reason = window.prompt(
                      'Motif de l’annulation (le numéro reste attribué) :',
                    );
                    if (!reason || reason.trim().length < 3) return;
                    await post('cancel', { reason: reason.trim() });
                    onChanged();
                  })
                }
              >
                Annuler le document
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Totals({
  label = 'Net à payer',
  totalHt,
  totalDiscount,
  vat,
  totalTtc,
}: {
  label?: string;
  totalHt: number;
  totalDiscount: number;
  vat: FactureVatBucket[];
  totalTtc: number;
}) {
  return (
    <Card>
      <CardBody>
        <dl className="ml-auto grid max-w-sm gap-1 text-sm" data-testid="facture-totals">
          {totalDiscount > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted">Remises</dt>
              <dd>− {formatXof(totalDiscount)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-muted">Total HT</dt>
            <dd>{formatXof(totalHt)}</dd>
          </div>
          {vat.map((b) => (
            <div key={b.rate} className="flex justify-between">
              <dt className="text-muted">TVA {formatVatRate(b.rate)}</dt>
              <dd>{formatXof(b.amount)}</dd>
            </div>
          ))}
          <div className="flex justify-between border-t border-line pt-2 text-base font-semibold">
            <dt>{label}</dt>
            <dd data-testid="facture-total-ttc">{formatXof(totalTtc)}</dd>
          </div>
        </dl>
      </CardBody>
    </Card>
  );
}

// ─── Ocall Stock (S5) ───

interface StockPreviewView {
  available: boolean;
  writable: boolean;
  availabilityKnown: boolean;
  shortages: number;
  lines: {
    variantId: string;
    label: string;
    quantity: number;
    available: number | null;
    short: boolean;
  }[];
}

/**
 * Avant l'émission d'une facture (selon le brouillon enregistré) : ce qui sortira du stock et ce qui manque
 * à l'emplacement des ventes Facture. Avertissement seulement : la facture s'émet, la demande en échec se
 * relance une fois le stock corrigé.
 */
function StockPreview({ doc }: { doc: DocumentView }) {
  const preview = useApi<StockPreviewView>(
    `/facture/stock/documents/${doc.id}/preview?v=${encodeURIComponent(doc.updatedAt)}`,
  );
  if (preview.state !== 'success' || preview.data.lines.length === 0) return null;
  const p = preview.data;
  return (
    <div data-testid="facture-stock-preview">
      <Alert
        tone={p.shortages > 0 || !p.writable ? 'error' : 'info'}
        title={
          !p.writable
            ? 'Ocall Stock en consultation seule : le stock ne sera pas mis à jour'
            : p.shortages > 0
              ? `Stock insuffisant pour ${p.shortages} article(s)`
              : 'À l’émission, ces articles sortiront du stock'
        }
      >
        <ul className="list-disc pl-5">
          {p.lines.map((l) => (
            <li key={l.variantId}>
              {l.label} : {l.quantity}
              {l.available !== null && ` (disponible : ${l.available})`}
            </li>
          ))}
        </ul>
        {p.shortages > 0 && (
          <p>
            La facture peut être émise ; la mise à jour du stock sera en échec jusqu’à ce que le
            stock soit corrigé dans Ocall Stock, puis relancée.
          </p>
        )}
      </Alert>
    </div>
  );
}

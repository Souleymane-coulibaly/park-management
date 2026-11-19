'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  PRINT_CARD_KIND_LABELS,
  PRINT_ORDER_CANCELLABLE,
  type PrintCardKind,
  formatXof,
} from '@ocall/shared';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, EmptyState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { ApiError, api } from '@/lib/api';
import type { PrintOrderDetailView, PrintOrderSummaryView, PrintTemplateView } from './print-types';
import {
  ItemStatusBadge,
  ORDER_EVENT_LABELS,
  OrderAmount,
  OrderStatusBadge,
  PaymentBadge,
  dateTime,
  shortDate,
} from './print-ui';

const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

/**
 * Commande d'impression (COMMUNE) : modèle, livraison, récapitulatif prix unitaire × quantité = total,
 * paiement en espèces à la livraison. Une clé d'envoi est tirée à l'ouverture : un nouvel envoi après une
 * coupure réseau ou un double clic ne crée jamais une seconde commande.
 */
export function OrderDialog({
  open,
  onClose,
  submitPath,
  extraBody,
  cardIds,
  kind,
  templates,
  unitPrice,
  defaults,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  submitPath: string;
  extraBody?: Record<string, unknown>;
  cardIds: string[];
  kind: PrintCardKind;
  templates: PrintTemplateView[];
  unitPrice: number;
  defaults: { address: string; contactName: string; contactPhone: string };
  onDone: (order: PrintOrderDetailView) => void;
}) {
  const usable = templates.filter((t) => t.kind === kind && !t.archivedAt);
  const [templateId, setTemplateId] = useState(usable[0]?.id ?? '');
  const [address, setAddress] = useState(defaults.address);
  const [contactName, setContactName] = useState(defaults.contactName);
  const [contactPhone, setContactPhone] = useState(defaults.contactPhone);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const key = useMemo(() => newKey(), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = unitPrice * cardIds.length;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const order = await api<PrintOrderDetailView>(submitPath, {
        method: 'POST',
        body: {
          ...extraBody,
          templateId,
          cardIds,
          idempotencyKey: key,
          delivery: { address, contactName, contactPhone, note: note.trim() || null },
        },
      });
      onDone(order);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Erreur réseau.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Commander l’impression"
      description={`${PRINT_CARD_KIND_LABELS[kind]} — atelier Ocall de Bamako, paiement en espèces à la livraison.`}
    >
      <div className="space-y-4" data-testid="print-order-dialog">
        {usable.length === 0 ? (
          <Alert tone="info">Créez d’abord un modèle pour ce type de carte.</Alert>
        ) : (
          <SelectField
            label="Modèle"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            options={usable.map((t) => ({
              value: t.id,
              label: `${t.name} (v${t.currentVersion})`,
            }))}
          />
        )}
        <InputField
          label="Adresse de livraison"
          required
          value={address}
          maxLength={300}
          onChange={(e) => setAddress(e.target.value)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <InputField
            label="Personne à contacter"
            required
            value={contactName}
            maxLength={120}
            onChange={(e) => setContactName(e.target.value)}
          />
          <InputField
            label="Téléphone"
            required
            value={contactPhone}
            maxLength={30}
            onChange={(e) => setContactPhone(e.target.value)}
          />
        </div>
        <InputField
          label="Commentaire (facultatif)"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="rounded-xl bg-ivory/70 px-4 py-3 text-sm" data-testid="print-order-summary">
          <p className="flex flex-wrap justify-between gap-2">
            <span>Prix unitaire</span>
            <span className="tabular-nums">{formatXof(unitPrice)}</span>
          </p>
          <p className="flex flex-wrap justify-between gap-2">
            <span>Quantité</span>
            <span className="tabular-nums">{cardIds.length}</span>
          </p>
          <p className="mt-1 flex flex-wrap justify-between gap-2 border-t border-line pt-1 font-semibold">
            <span>Montant total</span>
            <span className="tabular-nums">{formatXof(total)}</span>
          </p>
          <p className="mt-2 text-xs text-muted">
            Règlement en espèces à la livraison, contre reçu. Aucun paiement en ligne.
          </p>
        </div>
        <ApiErrorAlert error={error} />
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            onClick={() => void submit()}
            loading={busy}
            disabled={!templateId || cardIds.length === 0}
            data-testid="print-order-submit"
          >
            Envoyer la commande
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function OrdersTable({
  orders,
  hrefFor,
  showOrganization = false,
}: {
  orders: PrintOrderSummaryView[];
  hrefFor: (o: PrintOrderSummaryView) => string;
  showOrganization?: boolean;
}) {
  if (orders.length === 0)
    return (
      <EmptyState
        icon={<span aria-hidden>🪪</span>}
        title="Aucune commande"
        description="Les commandes d’impression apparaîtront ici, avec leur suivi."
      />
    );
  return (
    <Table
      head={[
        'Commande',
        ...(showOrganization ? ['Client'] : []),
        'Type',
        'Envoyée le',
        'Montant',
        'État',
        'Règlement',
      ]}
    >
      {orders.map((o) => (
        <tr key={o.id} data-testid="print-order-row">
          <Td>
            <Link href={hrefFor(o)} className="font-semibold text-forest hover:underline">
              {o.number}
            </Link>
          </Td>
          {showOrganization && <Td>{o.organizationName}</Td>}
          <Td>{PRINT_CARD_KIND_LABELS[o.kind]}</Td>
          <Td>{shortDate(o.submittedAt)}</Td>
          <Td>
            <OrderAmount
              unitPrice={o.unitPrice}
              quantity={o.quantity}
              totalAmount={o.totalAmount}
            />
          </Td>
          <Td>
            <OrderStatusBadge status={o.status} />
          </Td>
          <Td>
            <PaymentBadge status={o.paymentStatus} />
          </Td>
        </tr>
      ))}
    </Table>
  );
}

/** Suivi d'une commande (COMMUN) : étapes, montants, règlement, cartes, journal ; annulation client. */
export function OrderDetail({
  order,
  cancelPath,
  proofHref,
  onChange,
  actions,
}: {
  order: PrintOrderDetailView;
  cancelPath?: string | null;
  proofHref?: string | null;
  onChange: (o: PrintOrderDetailView) => void;
  actions?: React.ReactNode;
}) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const cancellable = PRINT_ORDER_CANCELLABLE.includes(order.status) && Boolean(cancelPath);
  const steps: [string, string | null][] = [
    ['Envoyée', order.submittedAt],
    ['Acceptée', order.acceptedAt],
    ['En production', order.productionAt],
    ['Prête', order.readyAt],
    ['Livrée', order.deliveredAt],
  ];

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      onChange(await api<PrintOrderDetailView>(cancelPath!, { method: 'POST', body: { reason } }));
      setCancelOpen(false);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Erreur réseau.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="print-order-detail">
      <Card>
        <CardHeader
          title={`Commande ${order.number}`}
          description={`${PRINT_CARD_KIND_LABELS[order.kind]} — modèle « ${order.templateName} » (version ${order.templateVersion})`}
          action={
            <div className="flex flex-wrap gap-2">
              <span data-testid="print-order-status">
                <OrderStatusBadge status={order.status} />
              </span>
              <span data-testid="print-order-payment">
                <PaymentBadge status={order.paymentStatus} />
              </span>
            </div>
          }
        />
        <CardBody className="space-y-5">
          <ol className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            {steps.map(([label, at]) => (
              <li
                key={label}
                className={`rounded-xl border px-3 py-2 ${at ? 'border-forest/30 bg-forest-light/40' : 'border-line text-muted'}`}
              >
                <p className="font-semibold">{label}</p>
                <p className="text-xs">{at ? dateTime(at) : '—'}</p>
              </li>
            ))}
          </ol>
          {(order.status === 'CANCELLED' || order.status === 'REJECTED') && order.closedReason && (
            <Alert tone="info">
              {order.status === 'CANCELLED' ? 'Annulée' : 'Refusée'} : {order.closedReason}
            </Alert>
          )}
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <div className="min-w-0">
              <dt className="text-muted">Montant</dt>
              <dd className="mt-0.5">
                <OrderAmount
                  unitPrice={order.unitPrice}
                  quantity={order.quantity}
                  totalAmount={order.totalAmount}
                />
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted">Règlement (espèces à la livraison)</dt>
              <dd className="mt-0.5">
                {order.paymentStatus === 'PAID'
                  ? `${formatXof(order.paidAmount ?? 0)} le ${shortDate(order.paidAt)} — reçu ${order.paymentReference ?? '—'}`
                  : 'À régler à la livraison'}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted">Livraison</dt>
              <dd className="mt-0.5 break-words">
                {order.delivery.address} — {order.delivery.contactName},{' '}
                {order.delivery.contactPhone}
              </dd>
            </div>
          </dl>
          {order.filesPurged && (
            <Alert tone="info">
              Fichiers de production purgés (conservation de 90 jours après la clôture) ; le suivi
              administratif est conservé.
            </Alert>
          )}
          <div className="flex flex-wrap gap-3">
            {proofHref && !order.filesPurged && (
              <a
                href={proofHref}
                className="text-sm font-semibold text-forest hover:underline"
                data-testid="print-proof-link"
              >
                Télécharger le bon à tirer (PDF)
              </a>
            )}
            {cancellable && (
              <Button variant="secondary" size="sm" onClick={() => setCancelOpen(true)}>
                Annuler la commande
              </Button>
            )}
            {actions}
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={`Cartes (${order.items.length})`} />
        <Table head={['Titulaire', 'N° de carte', 'État', 'Motif']}>
          {order.items.map((i) => (
            <tr key={i.id} data-testid="print-order-item">
              <Td>{i.holderLabel ?? <span className="text-muted">Effacé (conservation)</span>}</Td>
              <Td className="font-mono text-xs">{i.cardNumber}</Td>
              <Td>
                <ItemStatusBadge status={i.status} />
              </Td>
              <Td>{i.rejectReason ?? '—'}</Td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card>
        <CardHeader title="Journal" />
        <CardBody>
          <ul className="space-y-2 text-sm">
            {order.events.map((e, idx) => (
              <li key={idx} className="flex flex-wrap justify-between gap-2">
                <span>{ORDER_EVENT_LABELS[e.type] ?? e.type}</span>
                <span className="text-muted">{dateTime(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      <Dialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Annuler la commande"
        description="Possible tant que la production n’a pas commencé."
      >
        <div className="space-y-4">
          <InputField
            label="Motif"
            required
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
          />
          <ApiErrorAlert error={error} />
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setCancelOpen(false)}>
              Retour
            </Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={reason.trim().length < 3}
              onClick={() => void cancel()}
            >
              Annuler la commande
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

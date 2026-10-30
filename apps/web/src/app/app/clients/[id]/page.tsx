'use client';

import { type FormEvent, use, useState } from 'react';
import { ArrowLeft, Pencil, ShieldOff, Sparkles } from 'lucide-react';
import {
  LOYALTY_ACTIVITY_LABELS,
  LOYALTY_TRANSACTION_LABELS,
  customerDisplayName,
  formatSaleNumber,
  formatXof,
} from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { CustomerFormDialog } from '@/components/crm/customer-form';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { newRequestId } from '@/lib/request-id';
import type { CustomerDetail, LoyaltyActivityType } from '@/lib/types';
import { useApi } from '@/lib/use-api';

/** Fiche client : soldes Parc et Restaurant, historique (responsables), corrections, anonymisation. */
export default function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canRead = useCan('customer.read');
  const canEdit = useCan('customer.manage');
  const canErase = useCan('customer.erase');
  const canAdjust = useCan('loyalty.adjust');
  const customer = useApi<CustomerDetail>(canRead ? `/customers/${id}` : null);
  const [editing, setEditing] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [adjusting, setAdjusting] = useState(false);

  if (!canRead) return <AccessDenied />;
  if (customer.state === 'loading') return <LoadingState />;
  if (customer.state === 'error')
    return <ErrorState error={customer.error} onRetry={customer.reload} />;
  const c = customer.data;
  const anonymized = !!c.anonymizedAt;

  return (
    <div className="space-y-4">
      <ButtonLink href="/app/clients" variant="ghost" size="sm">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Clients
      </ButtonLink>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" data-testid="customer-name">
            {customerDisplayName(c)}
          </h1>
          <p className="text-muted">
            {c.phone ?? 'Sans téléphone'}
            {c.lastVisitAt && ` · dernière visite le ${formatDate(c.lastVisitAt)}`}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {anonymized && <Badge tone="terracotta">Anonymisé</Badge>}
            {c.marketingConsent && <Badge tone="savanna">Accepte les offres</Badge>}
          </div>
        </div>
        {!anonymized && (
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <Button
                variant="secondary"
                icon={<Pencil className="h-4 w-4" />}
                onClick={() => setEditing(true)}
              >
                Modifier
              </Button>
            )}
            {canAdjust && (
              <Button
                variant="secondary"
                icon={<Sparkles className="h-4 w-4" />}
                onClick={() => setAdjusting(true)}
              >
                Corriger des points
              </Button>
            )}
            {canErase && (
              <Button
                variant="ghost"
                icon={<ShieldOff className="h-4 w-4" />}
                onClick={() => setErasing(true)}
              >
                Anonymiser
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {c.wallets.map((w) => (
          <Card key={w.activity}>
            <CardBody>
              <p className="text-sm text-muted">{LOYALTY_ACTIVITY_LABELS[w.activity]}</p>
              <p className="font-display text-3xl font-bold" data-testid={`wallet-${w.activity}`}>
                {w.balance} points
              </p>
            </CardBody>
          </Card>
        ))}
      </div>
      {c.wallets.length > 1 && (
        <p className="text-sm text-muted">
          Les points Parc et Restaurant restent séparés : aucun transfert.
        </p>
      )}

      {c.visits !== undefined && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <CardBody>
              <p className="text-sm text-muted">Visites (ventes payées)</p>
              <p className="text-2xl font-bold">{c.visits}</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-sm text-muted">Dépenses cumulées</p>
              <p className="text-2xl font-bold">{formatXof(c.totalSpent ?? 0)}</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-sm text-muted">Client depuis</p>
              <p className="text-2xl font-bold">{formatDate(c.createdAt ?? null)}</p>
            </CardBody>
          </Card>
        </div>
      )}
      {c.notes && <Alert tone="info">Remarque : {c.notes}</Alert>}

      {c.purchases && (
        <Card>
          <CardHeader
            title="Historique des achats"
            description="Ventes payées, dans vos établissements"
          />
          {c.purchases.length === 0 ? (
            <CardBody>
              <p className="text-sm text-muted">Aucun achat.</p>
            </CardBody>
          ) : (
            <Table head={['Date', 'Vente', 'Activité', 'Établissement', 'Montant payé']}>
              {c.purchases.map((p) => (
                <tr key={p.id}>
                  <Td>{formatDateTime(p.createdAt)}</Td>
                  <Td>n° {formatSaleNumber(p.number)}</Td>
                  <Td>{p.activity === 'PARK' ? 'Parc' : 'Restaurant'}</Td>
                  <Td>{p.establishment.name}</Td>
                  <Td>
                    {formatXof(p.total)}
                    {p.loyaltyDiscount > 0 && (
                      <span className="text-sm text-muted">
                        {' '}
                        (remise {formatXof(p.loyaltyDiscount)})
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
      {c.loyaltyMovements && (
        <Card>
          <CardHeader title="Mouvements de points" />
          {c.loyaltyMovements.length === 0 ? (
            <CardBody>
              <p className="text-sm text-muted">Aucun mouvement.</p>
            </CardBody>
          ) : (
            <Table head={['Date', 'Programme', 'Mouvement', 'Points', 'Solde', 'Motif']}>
              {c.loyaltyMovements.map((m) => (
                <tr key={m.id}>
                  <Td>{formatDateTime(m.createdAt)}</Td>
                  <Td>{LOYALTY_ACTIVITY_LABELS[m.activity]}</Td>
                  <Td>{LOYALTY_TRANSACTION_LABELS[m.kind]}</Td>
                  <Td className={m.points < 0 ? 'text-terracotta-dark' : 'text-forest'}>
                    {m.points > 0 ? '+' : ''}
                    {m.points}
                  </Td>
                  <Td>{m.balanceAfter}</Td>
                  <Td>{m.reason ?? '—'}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {editing && (
        <CustomerFormDialog
          customer={c}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            customer.reload();
          }}
        />
      )}
      {adjusting && (
        <AdjustDialog
          customerId={c.id}
          activities={c.wallets.map((w) => w.activity)}
          onClose={() => setAdjusting(false)}
          onSaved={() => {
            setAdjusting(false);
            customer.reload();
          }}
        />
      )}
      {erasing && (
        <EraseDialog
          customerId={c.id}
          onClose={() => setErasing(false)}
          onErased={() => {
            setErasing(false);
            customer.reload();
          }}
        />
      )}
    </div>
  );
}

function AdjustDialog({
  customerId,
  activities,
  onClose,
  onSaved,
}: {
  customerId: string;
  activities: LoyaltyActivityType[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [activity, setActivity] = useState<LoyaltyActivityType>(activities[0] ?? 'RESTAURANT');
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [requestId] = useState(newRequestId);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api('/loyalty/adjustments', {
        method: 'POST',
        body: { customerId, activity, points: Number(points), reason, clientRequestId: requestId },
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
      title="Corriger des points"
      description="Correction motivée, enregistrée au journal d’audit"
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <ApiErrorAlert error={error} />
        {activities.length > 1 && (
          <SelectField
            label="Programme"
            value={activity}
            onChange={(e) => setActivity(e.target.value as LoyaltyActivityType)}
            options={activities.map((a) => ({ value: a, label: LOYALTY_ACTIVITY_LABELS[a] }))}
          />
        )}
        <InputField
          label="Points (négatif pour retirer)"
          type="number"
          step={1}
          required
          value={points}
          onChange={(e) => setPoints(e.target.value)}
        />
        <InputField
          label="Motif"
          required
          minLength={3}
          maxLength={200}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button type="submit" className="w-full" loading={loading}>
          Enregistrer la correction
        </Button>
      </form>
    </Dialog>
  );
}

function EraseDialog({
  customerId,
  onClose,
  onErased,
}: {
  customerId: string;
  onClose: () => void;
  onErased: () => void;
}) {
  const [reason, setReason] = useState('Demande du client');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api(`/customers/${customerId}/anonymize`, { method: 'POST', body: { reason } });
      onErased();
    } catch (e) {
      setError(e as ApiError);
      setLoading(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title="Anonymiser ce client ?">
      <form onSubmit={onSubmit} className="space-y-4">
        <Alert tone="error">
          Irréversible : nom, téléphone et remarques sont effacés, les points sont annulés. Les
          ventes restent pour la comptabilité, sans personne identifiable.
        </Alert>
        <ApiErrorAlert error={error} />
        <InputField
          label="Motif"
          required
          minLength={3}
          maxLength={200}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button type="submit" variant="danger" className="w-full" loading={loading}>
          Anonymiser définitivement
        </Button>
      </form>
    </Dialog>
  );
}

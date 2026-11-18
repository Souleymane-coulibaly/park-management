'use client';

import Link from 'next/link';
import { useState } from 'react';
import { IdCard, Search } from 'lucide-react';
import {
  PASS_KIND_LABELS,
  PASS_STATE_LABELS,
  type PassStatus,
  formatSaleNumber,
  formatXof,
} from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { CustomerPicker, fullName } from '@/components/crm/customer-picker';
import { ParkEstablishmentScope } from '@/components/park/park-establishment';
import { ParkNav } from '@/components/park/park-nav';
import {
  PassLinkPanel,
  PassPhotoInput,
  PassStateBadge,
  describeOfferRules,
  formatPassDay,
} from '@/components/park/pass-ui';
import { TicketQr } from '@/components/park/ticket-qr';
import {
  CashSessionGate,
  OfflineBanner,
  SessionBar,
  toApiError,
} from '@/components/pos/cash-session';
import { PaymentDialog } from '@/components/pos/payment-dialog';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useOnline } from '@/lib/hardware/use-terminal';
import { newRequestId } from '@/lib/request-id';
import type {
  CashSession,
  CustomerSummary,
  PassDetail,
  PassSummary,
  Sale,
  SellablePassOffer,
} from '@/lib/types';
import { useApi } from '@/lib/use-api';

/** Pass et abonnements : vente au guichet (caisse ouverte) et liste des titulaires. */
export default function PassPage() {
  const canSell = useCan('pos.sell');
  if (!canSell) return <AccessDenied />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Pass et abonnements</h1>
        <ParkNav />
      </div>
      <ParkEstablishmentScope source="/ticketing/establishments">
        {(park) => (
          <div className="space-y-4">
            <CashSessionGate establishmentId={park.id}>
              {(session, reload) => (
                <PassCounter establishmentId={park.id} session={session} onSessionChange={reload} />
              )}
            </CashSessionGate>
            <PassHolders />
          </div>
        )}
      </ParkEstablishmentScope>
    </div>
  );
}

function PassCounter({
  establishmentId,
  session,
  onSessionChange,
}: {
  establishmentId: string;
  session: CashSession;
  onSessionChange: () => void;
}) {
  const online = useOnline();
  const offers = useApi<{ today: string; offers: SellablePassOffer[] }>(
    `/passes/offers?establishmentId=${establishmentId}`,
  );
  const [offerId, setOfferId] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CustomerSummary | null>(null);
  const [photo, setPhoto] = useState<{ id: string; url: string } | null>(null);
  const [startDate, setStartDate] = useState('');
  const [requestId, setRequestId] = useState(newRequestId);
  const [checkout, setCheckout] = useState<{ loading: boolean; error: ApiError | null }>({
    loading: false,
    error: null,
  });
  const [paying, setPaying] = useState<{ sale: Sale; passId: string } | null>(null);
  const [sold, setSold] = useState<string | null>(null);
  const [unpaid, setUnpaid] = useState<Sale | null>(null);

  if (offers.state === 'loading') return <LoadingState label="Chargement des offres…" />;
  if (offers.state === 'error') return <ErrorState error={offers.error} onRetry={offers.reload} />;
  const { today } = offers.data;
  const offer = offers.data.offers.find((o) => o.id === offerId) ?? null;
  const start = startDate || today;
  const holderOk = !!customer && fullName(customer) !== '';
  const canCheckout =
    online && !!offer && holderOk && (!offer.photoRequired || !!photo) && !checkout.loading;

  function reset() {
    setOfferId(null);
    setCustomer(null);
    setPhoto(null);
    setStartDate('');
    setRequestId(newRequestId());
  }

  async function startCheckout() {
    if (!canCheckout || !offer || !customer) return;
    setCheckout({ loading: true, error: null });
    try {
      const res = await api<{ sale: Sale; pass: PassDetail | null }>('/passes/orders', {
        method: 'POST',
        body: {
          establishmentId,
          offerId: offer.id,
          customerId: customer.id,
          startDate: start,
          ...(photo && { photoFileId: photo.id }),
          clientRequestId: requestId,
        },
      });
      setCheckout({ loading: false, error: null });
      if (res.pass) setPaying({ sale: res.sale, passId: res.pass.id });
      reset();
    } catch (e) {
      setCheckout({ loading: false, error: toApiError(e) });
    }
  }

  return (
    <>
      <SessionBar session={session} onSessionChange={onSessionChange} />
      {!online && (
        <OfflineBanner>
          Hors connexion : la vente de pass reprend au retour du réseau.
        </OfflineBanner>
      )}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_400px]">
        <section aria-label="Offres de pass" className="min-w-0 space-y-3">
          {offers.data.offers.length === 0 ? (
            <Card>
              <EmptyState
                icon={<IdCard className="h-7 w-7" />}
                title="Aucun pass en vente dans ce parc"
                description="Un responsable crée les offres dans « Offres de pass »."
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {offers.data.offers.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setOfferId(o.id)}
                  aria-pressed={o.id === offerId}
                  className={`flex min-h-32 flex-col justify-between gap-2 rounded-2xl border p-4 text-left shadow-card transition active:scale-[0.98] ${o.id === offerId ? 'border-forest ring-2 ring-forest/30' : 'border-line bg-surface hover:border-forest'}`}
                >
                  <span>
                    <span className="block text-lg font-bold leading-tight">{o.name}</span>
                    <span className="text-xs uppercase tracking-wide text-muted">
                      {PASS_KIND_LABELS[o.kind]}
                    </span>
                  </span>
                  <span className="text-sm text-muted">{describeOfferRules(o)}</span>
                  {o.sites.length > 1 && (
                    <span className="text-xs text-muted">
                      Valable : {o.sites.map((s) => s.name).join(', ')}
                    </span>
                  )}
                  <span className="font-display text-xl font-bold text-forest">
                    {formatXof(o.price)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <aside aria-label="Titulaire" className="lg:sticky lg:top-20 lg:self-start">
          <Card className="space-y-4 p-4">
            <h2 className="font-semibold">Titulaire du pass</h2>
            <CustomerPicker value={customer} onChange={setCustomer} />
            {customer && !holderOk && (
              <Alert tone="error">La fiche client doit comporter le nom du titulaire.</Alert>
            )}
            {offer && (
              <>
                <PassPhotoInput value={photo} onChange={setPhoto} required={offer.photoRequired} />
                <InputField
                  label="Premier jour de validité"
                  type="date"
                  value={start}
                  min={today}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
              </>
            )}
            <ApiErrorAlert error={checkout.error} />
            <div className="flex items-baseline justify-between">
              <span className="font-medium">Total</span>
              <span className="font-display text-3xl font-bold" data-testid="pass-total">
                {offer ? formatXof(offer.price) : '—'}
              </span>
            </div>
            <Button
              size="lg"
              className="w-full"
              onClick={() => void startCheckout()}
              disabled={!canCheckout}
              loading={checkout.loading}
            >
              Encaisser
            </Button>
          </Card>
        </aside>
      </div>

      {paying && (
        <PaymentDialog
          sale={paying.sale}
          onClose={() => {
            setUnpaid(paying.sale);
            setPaying(null);
            onSessionChange();
          }}
          onPaid={() => {
            setSold(paying.passId);
            setPaying(null);
          }}
        />
      )}
      {sold && (
        <PassSoldDialog
          passId={sold}
          onClose={() => {
            setSold(null);
            onSessionChange();
          }}
        />
      )}
      {unpaid && (
        <Dialog open onClose={() => setUnpaid(null)} title="Vente enregistrée, non payée">
          <div className="space-y-4">
            <Alert tone="info">
              La vente n° {formatSaleNumber(unpaid.number)} ({formatXof(unpaid.total)}) est
              enregistrée. Le pass ne sera valable qu’après le paiement.
            </Alert>
            <Button className="w-full" onClick={() => setUnpaid(null)}>
              Compris
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

/** Après paiement : pass actif, QR fixe à remettre (journalier, hebdomadaire) et lien personnel. */
function PassSoldDialog({ passId, onClose }: { passId: string; onClose: () => void }) {
  const pass = useApi<PassDetail>(`/passes/${passId}`);
  return (
    <Dialog open onClose={onClose} title="Pass vendu">
      <div className="space-y-4">
        {pass.state === 'loading' && <LoadingState />}
        {pass.state === 'error' && <ErrorState error={pass.error} onRetry={pass.reload} />}
        {pass.state === 'success' && (
          <>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-semibold">{pass.data.holderName}</p>
                <p className="text-sm text-muted">
                  {pass.data.rules.offerName} · du {formatPassDay(pass.data.startDate)} au{' '}
                  {formatPassDay(pass.data.endDate)}
                </p>
              </div>
              <PassStateBadge state={pass.data.state} />
            </div>
            {pass.data.staticQr ? (
              <div className="flex justify-center">
                <TicketQr value={pass.data.staticQr} size={200} label="QR du pass" />
              </div>
            ) : (
              <Alert tone="info">
                QR dynamique : le titulaire l’affiche depuis son lien personnel (renouvelé toutes
                les 30 secondes).
              </Alert>
            )}
            <PassLinkPanel
              passId={passId}
              hasLink={pass.data.hasLink}
              canRevoke={false}
              onChanged={() => undefined}
            />
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/app/billetterie/pass/${passId}`} variant="secondary">
            Voir la fiche du pass
          </ButtonLink>
          <Button className="flex-1" onClick={onClose}>
            Nouvelle vente
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

const STATUS_FILTERS: { value: '' | PassStatus; label: string }[] = [
  { value: '', label: 'Tous' },
  { value: 'ACTIVE', label: PASS_STATE_LABELS.ACTIVE },
  { value: 'SUSPENDED', label: PASS_STATE_LABELS.SUSPENDED },
  { value: 'PENDING', label: PASS_STATE_LABELS.PENDING },
  { value: 'CANCELLED', label: PASS_STATE_LABELS.CANCELLED },
];

/** Titulaires : recherche par nom ou téléphone, état présenté au jour du parc de la vente. */
function PassHolders() {
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [status, setStatus] = useState<'' | PassStatus>('');
  const params = new URLSearchParams();
  if (submitted) params.set('q', submitted);
  if (status) params.set('status', status);
  const passes = useApi<PassSummary[]>(`/passes?${params.toString()}`);

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-2 border-b border-line/70 px-4 py-3">
        <h2 className="mr-auto font-semibold">Titulaires</h2>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(q.trim());
          }}
        >
          <InputField
            label="Nom ou téléphone"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
          />
          <SelectField
            label="État"
            value={status}
            onChange={(e) => setStatus(e.target.value as '' | PassStatus)}
            options={STATUS_FILTERS}
          />
          <Button type="submit" variant="secondary" icon={<Search className="h-4 w-4" />}>
            Rechercher
          </Button>
        </form>
      </div>
      {passes.state === 'loading' && <LoadingState />}
      {passes.state === 'error' && <ErrorState error={passes.error} onRetry={passes.reload} />}
      {passes.state === 'success' && passes.data.length === 0 && (
        <EmptyState
          icon={<IdCard className="h-7 w-7" />}
          title="Aucun pass"
          description="Aucun pass ne correspond à cette recherche."
        />
      )}
      {passes.state === 'success' && passes.data.length > 0 && (
        <ul className="divide-y divide-line/70">
          {passes.data.map((p) => (
            <li key={p.id}>
              <Link
                href={`/app/billetterie/pass/${p.id}`}
                className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm hover:bg-forest-light/30"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{p.holderName}</span>
                  <span className="block truncate text-muted">
                    {p.rules.offerName} · jusqu’au {formatPassDay(p.endDate)}
                  </span>
                </span>
                {p.pendingRenewal && <Badge tone="savanna">Renouvellement à payer</Badge>}
                <PassStateBadge state={p.state} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

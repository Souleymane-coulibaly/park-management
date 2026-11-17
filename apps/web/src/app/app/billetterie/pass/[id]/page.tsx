'use client';

import { type FormEvent, use, useState } from 'react';
import { ArrowLeft, CreditCard, Pause, Play, Printer, RefreshCw, XCircle } from 'lucide-react';
import { PASS_KIND_LABELS, SCAN_REFUSAL_LABELS, formatSaleNumber, formatXof } from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
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
import { CashSessionGate, toApiError } from '@/components/pos/cash-session';
import { PaymentDialog } from '@/components/pos/payment-dialog';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { newRequestId } from '@/lib/request-id';
import type { PassCardPrintData, PassDetail, Sale } from '@/lib/types';
import { useApi } from '@/lib/use-api';

const EVENT_LABELS: Record<string, string> = {
  SOLD: 'Vendu',
  ACTIVATED: 'Activé au paiement',
  RENEWAL_ORDERED: 'Renouvellement commandé',
  RENEWED: 'Renouvelé',
  SUSPENDED: 'Suspendu',
  REACTIVATED: 'Réactivé',
  CANCELLED: 'Annulé',
  PHOTO_UPDATED: 'Photo changée',
  LINK_ISSUED: 'Lien personnel émis',
  LINK_REVOKED: 'Lien personnel révoqué',
  CARD_ISSUED: 'Carte émise',
  CARD_REVOKED: 'Carte révoquée',
  CARD_PRINT_REQUESTED: 'Carte préparée pour impression',
};

const PERIOD_LABELS = { PENDING: 'À payer', PAID: 'Payée', CANCELLED: 'Annulée' } as const;

type ReasonAction =
  | { kind: 'suspend' }
  | { kind: 'cancel' }
  | { kind: 'replace'; cardId: string }
  | { kind: 'revoke'; cardId: string };

const REASON_TITLES: Record<ReasonAction['kind'], string> = {
  suspend: 'Suspendre le pass',
  cancel: 'Annuler le pass',
  replace: 'Remplacer la carte',
  revoke: 'Révoquer la carte',
};

/** Fiche d'un pass : titulaire, validité, périodes, passages, cartes, lien et actions. */
export default function PassDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const canSell = useCan('pos.sell');
  const canManage = useCan('pass.manage');
  const pass = useApi<PassDetail>(`/passes/${id}`);
  const [reasonAction, setReasonAction] = useState<ReasonAction | null>(null);
  const [renewing, setRenewing] = useState(false);
  const [changingPhoto, setChangingPhoto] = useState(false);
  const [printData, setPrintData] = useState<PassCardPrintData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  if (!canSell) return <AccessDenied />;

  async function run(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<unknown>(path, { method: 'POST', body });
      pass.reload();
      return res;
    } catch (e) {
      setError(toApiError(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function printCard(cardId: string) {
    const data = (await run(`/passes/${id}/cards/${cardId}/print-data`)) as PassCardPrintData;
    if (data) setPrintData(data);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ButtonLink href="/app/billetterie/pass" variant="ghost" size="sm" className="-ml-2">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Pass et abonnements
        </ButtonLink>
        <ParkNav />
      </div>
      {pass.state === 'loading' && <LoadingState />}
      {pass.state === 'error' && <ErrorState error={pass.error} onRetry={pass.reload} />}
      {pass.state === 'success' && (
        <PassView
          pass={pass.data}
          canSell={canSell}
          canManage={canManage}
          busy={busy}
          error={error}
          onReload={pass.reload}
          onRenew={() => setRenewing(true)}
          onChangePhoto={() => setChangingPhoto(true)}
          onReason={setReasonAction}
          onReactivate={() => void run(`/passes/${id}/reactivate`)}
          onIssueCard={() => void run(`/passes/${id}/cards`)}
          onPrintCard={(cardId) => void printCard(cardId)}
        />
      )}
      {reasonAction && (
        <ReasonDialog
          title={REASON_TITLES[reasonAction.kind]}
          warning={
            reasonAction.kind === 'cancel'
              ? 'Aucun remboursement automatique : un éventuel remboursement se fait à part. Les cartes et le lien personnel sont révoqués.'
              : reasonAction.kind === 'suspend'
                ? 'Le pass est refusé à l’entrée pendant la suspension. Selon l’offre, la validité est prolongée à la réactivation.'
                : undefined
          }
          onClose={() => setReasonAction(null)}
          onConfirm={async (reason) => {
            const path =
              reasonAction.kind === 'suspend'
                ? `/passes/${id}/suspend`
                : reasonAction.kind === 'cancel'
                  ? `/passes/${id}/cancel`
                  : `/passes/${id}/cards/${reasonAction.cardId}/${reasonAction.kind}`;
            const ok = await run(path, { reason });
            if (ok !== null) setReasonAction(null);
          }}
          busy={busy}
          error={error}
        />
      )}
      {renewing && pass.state === 'success' && (
        <RenewDialog
          pass={pass.data}
          onClose={() => {
            setRenewing(false);
            pass.reload();
          }}
        />
      )}
      {changingPhoto && (
        <PhotoDialog
          passId={id}
          onClose={() => setChangingPhoto(false)}
          onSaved={() => {
            setChangingPhoto(false);
            pass.reload();
          }}
        />
      )}
      {printData && <PrintDataDialog data={printData} onClose={() => setPrintData(null)} />}
    </div>
  );
}

function PassView({
  pass,
  canSell,
  canManage,
  busy,
  error,
  onReload,
  onRenew,
  onChangePhoto,
  onReason,
  onReactivate,
  onIssueCard,
  onPrintCard,
}: {
  pass: PassDetail;
  canSell: boolean;
  canManage: boolean;
  busy: boolean;
  error: ApiError | null;
  onReload: () => void;
  onRenew: () => void;
  onChangePhoto: () => void;
  onReason: (a: ReasonAction) => void;
  onReactivate: () => void;
  onIssueCard: () => void;
  onPrintCard: (cardId: string) => void;
}) {
  const { rules } = pass;
  const anonymized = pass.holderName === 'Client anonymisé';
  const live = pass.status === 'ACTIVE' || pass.status === 'SUSPENDED';
  const activeCard = pass.cards.find((c) => c.status === 'ACTIVE');
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="space-y-4 p-4">
        <div className="flex items-start gap-4">
          {pass.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- lien signé temporaire, privé
            <img
              src={pass.photoUrl}
              alt={`Photo de ${pass.holderName}`}
              className="h-28 w-28 shrink-0 rounded-2xl border border-line object-cover"
            />
          ) : (
            <div className="grid h-28 w-28 shrink-0 place-items-center rounded-2xl border-2 border-dashed border-line text-center text-xs text-muted">
              Sans photo
            </div>
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <h1 className="text-2xl font-bold" data-testid="pass-holder-name">
              {pass.holderName}
            </h1>
            {pass.phone && <p className="text-sm text-muted">{pass.phone}</p>}
            <p className="text-sm">
              {rules.offerName} · {PASS_KIND_LABELS[pass.kind]}
            </p>
            <div className="flex flex-wrap gap-2">
              <PassStateBadge state={pass.state} />
              {pass.pendingRenewal && <Badge tone="savanna">Renouvellement à payer</Badge>}
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 rounded-2xl border border-line bg-ivory/60 p-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted">Du</dt>
            <dd className="font-semibold">{formatPassDay(pass.startDate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Au</dt>
            <dd className="font-semibold" data-testid="pass-end-date">
              {formatPassDay(pass.endDate)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Entrées restantes</dt>
            <dd className="font-semibold">
              {pass.entriesLeft === null ? 'Illimitées' : pass.entriesLeft}
            </dd>
          </div>
        </dl>
        <p className="text-sm text-muted">{describeOfferRules({ kind: pass.kind, ...rules })}</p>
        {pass.status === 'SUSPENDED' && pass.suspensionReason && (
          <Alert tone="info" title="Suspendu">
            {pass.suspensionReason}
          </Alert>
        )}
        {pass.status === 'CANCELLED' && (
          <Alert tone="error" title="Annulé">
            {pass.cancelReason}
          </Alert>
        )}
        <ApiErrorAlert error={error} />
        <div className="flex flex-wrap gap-2">
          {canSell && rules.renewable && pass.status === 'ACTIVE' && !anonymized && (
            <Button onClick={onRenew} icon={<RefreshCw className="h-4 w-4" />}>
              Renouveler
            </Button>
          )}
          {canSell && pass.status !== 'CANCELLED' && !anonymized && (
            <Button variant="secondary" onClick={onChangePhoto}>
              Changer la photo
            </Button>
          )}
          {canManage &&
            pass.status === 'ACTIVE' &&
            rules.maxSuspensionDays > 0 &&
            pass.state !== 'EXPIRED' && (
              <Button
                variant="secondary"
                onClick={() => onReason({ kind: 'suspend' })}
                icon={<Pause className="h-4 w-4" />}
              >
                Suspendre
              </Button>
            )}
          {canManage && pass.status === 'SUSPENDED' && (
            <Button
              variant="secondary"
              loading={busy}
              onClick={onReactivate}
              icon={<Play className="h-4 w-4" />}
            >
              Réactiver
            </Button>
          )}
          {canManage && pass.status !== 'CANCELLED' && (
            <Button
              variant="danger"
              onClick={() => onReason({ kind: 'cancel' })}
              icon={<XCircle className="h-4 w-4" />}
            >
              Annuler le pass
            </Button>
          )}
        </div>
      </Card>

      <div className="space-y-3">
        {pass.staticQr && (
          <Card className="flex flex-col items-center gap-2 p-4">
            <h2 className="self-start font-semibold">QR du pass</h2>
            <TicketQr value={pass.staticQr} size={180} label="QR du pass" />
          </Card>
        )}
        {live && !anonymized && (
          <Card className="space-y-3 p-4">
            <h2 className="font-semibold">Lien personnel du titulaire</h2>
            <p className="text-sm text-muted">
              {rules.qrMode === 'DYNAMIC'
                ? 'Le titulaire y affiche un QR renouvelé toutes les 30 secondes.'
                : 'Le titulaire y retrouve le QR de son pass.'}
            </p>
            <PassLinkPanel
              passId={pass.id}
              hasLink={pass.hasLink}
              canRevoke={canManage}
              onChanged={onReload}
            />
          </Card>
        )}
        {canManage && (
          <Card className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">Cartes physiques</h2>
              {live && !activeCard && !anonymized && (
                <Button
                  size="sm"
                  loading={busy}
                  onClick={onIssueCard}
                  icon={<CreditCard className="h-4 w-4" />}
                >
                  Émettre une carte
                </Button>
              )}
            </div>
            {pass.cards.length === 0 ? (
              <p className="text-sm text-muted">Aucune carte.</p>
            ) : (
              <ul className="divide-y divide-line/70 text-sm">
                {pass.cards.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="font-mono font-semibold">{c.cardNumber}</span>
                    <Badge tone={c.status === 'ACTIVE' ? 'forest' : 'neutral'}>
                      {c.status === 'ACTIVE' ? 'Active' : 'Révoquée'}
                    </Badge>
                    {c.revokeReason && <span className="text-muted">{c.revokeReason}</span>}
                    {c.status === 'ACTIVE' && (
                      <span className="ml-auto flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => onPrintCard(c.id)}
                          icon={<Printer className="h-4 w-4" />}
                        >
                          Préparer l’impression
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onReason({ kind: 'replace', cardId: c.id })}
                        >
                          Remplacer
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onReason({ kind: 'revoke', cardId: c.id })}
                        >
                          Révoquer
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      <Card className="lg:col-span-2">
        <h2 className="border-b border-line/70 px-4 py-3 font-semibold">Périodes</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2">Vente</th>
                <th className="px-4 py-2">Période</th>
                <th className="px-4 py-2">Prix</th>
                <th className="px-4 py-2">Entrées</th>
                <th className="px-4 py-2">État</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {pass.periods.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2">
                    n° {formatSaleNumber(p.saleNumber)}
                    {p.isRenewal && <span className="text-muted"> · renouvellement</span>}
                  </td>
                  <td className="px-4 py-2">
                    {p.startDate
                      ? `${formatPassDay(p.startDate)} → ${formatPassDay(p.endDate)}`
                      : 'Datée au paiement'}
                    {p.extendedDays > 0 && (
                      <span className="text-muted"> (+{p.extendedDays} j)</span>
                    )}
                  </td>
                  <td className="px-4 py-2">{formatXof(p.price)}</td>
                  <td className="px-4 py-2">{p.entriesUsed}</td>
                  <td className="px-4 py-2">{PERIOD_LABELS[p.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h2 className="border-b border-line/70 px-4 py-3 font-semibold">Passages</h2>
        {pass.scans.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">Aucun passage.</p>
        ) : (
          <ul className="max-h-96 divide-y divide-line/70 overflow-y-auto text-sm">
            {pass.scans.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                <Badge tone={s.result === 'ACCEPTED' ? 'forest' : 'terracotta'}>
                  {s.result === 'ACCEPTED' ? 'Entrée' : 'Refus'}
                </Badge>
                <span>{formatDateTime(s.createdAt)}</span>
                <span className="text-muted">
                  {s.establishmentName} · {s.entryPoint}
                </span>
                {s.refusalReason && (
                  <span className="text-terracotta-dark">
                    {SCAN_REFUSAL_LABELS[s.refusalReason]}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="border-b border-line/70 px-4 py-3 font-semibold">Historique</h2>
        <ul className="max-h-96 divide-y divide-line/70 overflow-y-auto text-sm">
          {pass.events.map((e) => (
            <li key={e.id} className="px-4 py-2">
              <p className="font-medium">{EVENT_LABELS[e.type] ?? e.type}</p>
              <p className="text-muted">
                {formatDateTime(e.createdAt)}
                {e.actor && ` · ${e.actor}`}
                {e.reason && ` · ${e.reason}`}
              </p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function ReasonDialog({
  title,
  warning,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  title: string;
  warning?: string;
  busy: boolean;
  error: ApiError | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    if (reason.trim().length >= 3) onConfirm(reason.trim());
  }
  return (
    <Dialog open onClose={onClose} title={title}>
      <form onSubmit={submit} className="space-y-4">
        {warning && <Alert tone="info">{warning}</Alert>}
        <InputField
          label="Motif (obligatoire)"
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 200))}
          minLength={3}
          maxLength={200}
          required
          autoFocus
        />
        <ApiErrorAlert error={error} />
        <div className="flex gap-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
            Retour
          </Button>
          <Button
            type="submit"
            className="flex-1"
            loading={busy}
            disabled={reason.trim().length < 3}
          >
            Confirmer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Renouvellement au guichet : parc et caisse ouverte, tarif actuel, encaissement commun. */
function RenewDialog({ pass, onClose }: { pass: PassDetail; onClose: () => void }) {
  const [requestId] = useState(newRequestId);
  const [state, setState] = useState<{ loading: boolean; error: ApiError | null }>({
    loading: false,
    error: null,
  });
  const [sale, setSale] = useState<Sale | null>(null);
  const [paid, setPaid] = useState(false);

  async function order(establishmentId: string) {
    setState({ loading: true, error: null });
    try {
      const res = await api<{ sale: Sale }>(`/passes/${pass.id}/renew`, {
        method: 'POST',
        body: { establishmentId, clientRequestId: requestId },
      });
      setState({ loading: false, error: null });
      setSale(res.sale);
    } catch (e) {
      setState({ loading: false, error: toApiError(e) });
    }
  }

  if (sale && !paid) {
    return <PaymentDialog sale={sale} onClose={onClose} onPaid={() => setPaid(true)} />;
  }
  return (
    <Dialog open onClose={onClose} title="Renouveler le pass" description={pass.holderName}>
      {paid ? (
        <div className="space-y-4">
          <Alert tone="success" title="Renouvellement payé">
            La nouvelle période commence à l’échéance précédente (ou aujourd’hui si le pass avait
            expiré).
          </Alert>
          <Button className="w-full" onClick={onClose}>
            Fermer
          </Button>
        </div>
      ) : (
        <ParkEstablishmentScope source="/ticketing/establishments">
          {(park) => (
            <CashSessionGate establishmentId={park.id}>
              {() => (
                <div className="space-y-4">
                  {!pass.rules.siteIds.includes(park.id) && (
                    <Alert tone="error">Ce pass n’est pas valable dans ce parc.</Alert>
                  )}
                  <ApiErrorAlert error={state.error} />
                  <Button
                    size="lg"
                    className="w-full"
                    loading={state.loading}
                    disabled={!pass.rules.siteIds.includes(park.id)}
                    onClick={() => void order(park.id)}
                  >
                    Encaisser le renouvellement
                  </Button>
                </div>
              )}
            </CashSessionGate>
          )}
        </ParkEstablishmentScope>
      )}
    </Dialog>
  );
}

function PhotoDialog({
  passId,
  onClose,
  onSaved,
}: {
  passId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [photo, setPhoto] = useState<{ id: string; url: string } | null>(null);
  const [state, setState] = useState<{ loading: boolean; error: ApiError | null }>({
    loading: false,
    error: null,
  });
  async function save() {
    if (!photo) return;
    setState({ loading: true, error: null });
    try {
      await api(`/passes/${passId}/photo`, { method: 'PUT', body: { photoFileId: photo.id } });
      onSaved();
    } catch (e) {
      setState({ loading: false, error: toApiError(e) });
    }
  }
  return (
    <Dialog open onClose={onClose} title="Changer la photo du titulaire">
      <div className="space-y-4">
        <PassPhotoInput value={photo} onChange={setPhoto} required />
        <ApiErrorAlert error={state.error} />
        <Button className="w-full" disabled={!photo} loading={state.loading} onClick={save}>
          Enregistrer la photo
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * Données de la carte préparées pour Ocall Print (format versionné) : Ocall Parc n'imprime pas, il
 * prépare. L'aperçu permet de vérifier la carte avant l'envoi.
 */
function PrintDataDialog({ data, onClose }: { data: PassCardPrintData; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} title="Carte prête pour Ocall Print" description={data.format}>
      <div className="space-y-4">
        <div className="mx-auto flex w-full max-w-sm gap-3 rounded-2xl border border-line bg-surface p-3 shadow-card">
          {data.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- lien signé temporaire, privé
            <img
              src={data.photoUrl}
              alt={`Photo de ${data.holderName}`}
              className="h-24 w-20 rounded-lg object-cover"
            />
          ) : (
            <div className="h-24 w-20 rounded-lg bg-ivory-dark" />
          )}
          <div className="min-w-0 flex-1 text-sm">
            <p className="text-xs uppercase tracking-wide text-muted">{data.organizationName}</p>
            <p className="truncate font-bold">{data.holderName}</p>
            <p className="truncate">
              {data.offerName} · {data.kindLabel}
            </p>
            <p className="text-xs text-muted">
              {formatPassDay(data.validFrom)} → {formatPassDay(data.validUntil)}
            </p>
            <p className="font-mono text-xs">{data.cardNumber}</p>
          </div>
          <TicketQr value={data.qr} size={72} label="QR de la carte" />
        </div>
        <Alert tone="info">
          L’impression se fera depuis Ocall Print. La carte reste valable tant qu’elle n’est pas
          révoquée ; en cas de perte, révoquez-la ou remplacez-la.
        </Alert>
        <Button className="w-full" onClick={onClose}>
          Fermer
        </Button>
      </div>
    </Dialog>
  );
}

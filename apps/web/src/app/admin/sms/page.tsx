'use client';

import { useState } from 'react';
import { Inbox, MessageSquare, Wallet } from 'lucide-react';
import {
  SCHOOL_SMS_ERROR_LABELS,
  SCHOOL_SMS_LEDGER_LABELS,
  type SchoolSmsLedgerKind,
  formatXof,
} from '@ocall/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { ApiError, api } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { useCursorPages } from '@/lib/use-cursor-pages';

interface OrgRef {
  id: string;
  name: string;
  code: string;
}
interface WalletRow {
  organizationId: string;
  schoolId: string;
  schoolName: string;
  organization: OrgRef | null;
  balance: number;
  reserved: number;
  consumed: number;
  updatedAt: string;
}
interface TopUpRow {
  id: string;
  schoolId: string;
  schoolName: string;
  organization: OrgRef | null;
  creditsRequested: number;
  quotedAmountXof: number | null;
  requestNote: string | null;
  createdAt: string;
}
interface FailureRow {
  id: string;
  schoolName: string;
  organization: OrgRef | null;
  phone: string | null;
  kind: string;
  status: 'FAILED' | 'CANCELLED';
  lastError: string | null;
  attempts: number;
  createdAt: string;
}
interface TariffRow {
  id: string;
  version: number;
  creditPriceXof: number | null;
  providerCostPerSegmentXof: string | null;
  internationalCreditsPerSegment: number | null;
  note: string | null;
  createdAt: string;
}
interface LedgerPage {
  items: {
    id: string;
    kind: SchoolSmsLedgerKind;
    availableDelta: number;
    reservedDelta: number;
    balanceAfter: number;
    reason: string | null;
    createdAt: string;
  }[];
}

const toError = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.');

/**
 * Super Admin — crédits SMS Ocall School (Sprint S2) : demandes de recharge à valider après vérification
 * du règlement hors plateforme, portefeuilles des établissements, corrections motivées, erreurs d'envoi
 * et tarif versionné. Aucune donnée scolaire n'est affichée.
 */
export default function AdminSmsPage() {
  const topUps = useApi<TopUpRow[]>('/platform/school-sms/top-ups');
  const wallets = useApi<WalletRow[]>('/platform/school-sms/wallets');
  const failures = useApi<FailureRow[]>('/platform/school-sms/failures');
  const tariffs = useApi<TariffRow[]>('/platform/school-sms/tariffs');
  const [selected, setSelected] = useState<WalletRow | null>(null);
  const refresh = () => {
    topUps.reload();
    wallets.reload();
  };
  return (
    <>
      <PageHeader
        eyebrow="Super Admin"
        title="Crédits SMS School"
        description="Recharges prépayées des établissements : validation après vérification du paiement, soldes, corrections tracées et erreurs d’envoi."
      />
      <Card className="mb-6">
        <CardHeader
          title="Demandes de recharge en attente"
          description="Vérifiez le règlement hors plateforme, puis validez : le portefeuille est crédité une seule fois."
        />
        {topUps.state === 'loading' && <LoadingState />}
        {topUps.state === 'error' && <ErrorState error={topUps.error} onRetry={topUps.reload} />}
        {topUps.state === 'success' &&
          (topUps.data.length === 0 ? (
            <CardBody>
              <EmptyState
                icon={<Inbox className="h-6 w-6" aria-hidden />}
                title="Aucune demande en attente"
                description="Les demandes envoyées par les établissements apparaissent ici."
              />
            </CardBody>
          ) : (
            <Table
              head={['Établissement', 'Crédits demandés', 'Montant indicatif', 'Demandée le', '']}
            >
              {topUps.data.map((r) => (
                <TopUpRowView key={r.id} request={r} onDone={refresh} />
              ))}
            </Table>
          ))}
      </Card>

      <Card className="mb-6">
        <CardHeader
          title="Portefeuilles"
          description="Solde disponible, crédits réservés (envois en cours) et consommation par établissement."
        />
        {wallets.state === 'loading' && <LoadingState />}
        {wallets.state === 'error' && <ErrorState error={wallets.error} onRetry={wallets.reload} />}
        {wallets.state === 'success' &&
          (wallets.data.length === 0 ? (
            <CardBody>
              <EmptyState
                icon={<Wallet className="h-6 w-6" aria-hidden />}
                title="Aucun portefeuille"
                description="Un portefeuille est créé à la première recharge validée."
              />
            </CardBody>
          ) : (
            <Table
              head={['Établissement', 'Disponible', 'Réservés', 'Consommés', 'Mis à jour', '']}
            >
              {wallets.data.map((w) => (
                <tr key={w.schoolId}>
                  <Td>
                    {w.schoolName}
                    <span className="block text-xs text-muted">{w.organization?.name ?? '—'}</span>
                  </Td>
                  <Td className="tabular-nums">{w.balance}</Td>
                  <Td className="tabular-nums">{w.reserved}</Td>
                  <Td className="tabular-nums">{w.consumed}</Td>
                  <Td>{formatDate(w.updatedAt)}</Td>
                  <Td>
                    <Button size="sm" variant="ghost" onClick={() => setSelected(w)}>
                      Détail
                    </Button>
                  </Td>
                </tr>
              ))}
            </Table>
          ))}
        {selected && (
          <CardBody>
            <WalletDetail
              wallet={selected}
              onClose={() => setSelected(null)}
              onChange={wallets.reload}
            />
          </CardBody>
        )}
      </Card>

      <Card className="mb-6">
        <CardHeader
          title="Erreurs d’envoi"
          description="SMS annulés ou en échec : motif et numéro masqué, jamais le texte du message."
        />
        {failures.state === 'loading' && <LoadingState />}
        {failures.state === 'error' && (
          <ErrorState error={failures.error} onRetry={failures.reload} />
        )}
        {failures.state === 'success' &&
          (failures.data.length === 0 ? (
            <CardBody>
              <EmptyState
                icon={<MessageSquare className="h-6 w-6" aria-hidden />}
                title="Aucune erreur d’envoi"
                description="Les SMS annulés ou en échec apparaîtront ici."
              />
            </CardBody>
          ) : (
            <Table head={['Établissement', 'Numéro', 'Motif', 'Tentatives', 'Date']}>
              {failures.data.map((f) => (
                <tr key={f.id}>
                  <Td>
                    {f.schoolName}
                    <span className="block text-xs text-muted">{f.organization?.name ?? '—'}</span>
                  </Td>
                  <Td>
                    <span dir="ltr">{f.phone ?? '—'}</span>
                  </Td>
                  <Td>
                    <Badge tone={f.status === 'FAILED' ? 'terracotta' : 'neutral'}>
                      {f.status === 'FAILED' ? 'Échec' : 'Annulé'}
                    </Badge>
                    <span className="ml-1 text-xs text-muted">
                      {f.lastError ? (SCHOOL_SMS_ERROR_LABELS[f.lastError] ?? f.lastError) : ''}
                    </span>
                  </Td>
                  <Td>{f.attempts}</Td>
                  <Td>{formatDateTime(f.createdAt)}</Td>
                </tr>
              ))}
            </Table>
          ))}
      </Card>

      <Card>
        <CardHeader
          title="Tarif SMS"
          description="Versionné : chaque modification crée une nouvelle version, l’historique est conservé. Sans prix publié, les établissements voient « tarif communiqué par Ocall »."
        />
        <CardBody>
          <TariffForm onDone={tariffs.reload} />
        </CardBody>
        {tariffs.state === 'loading' && <LoadingState />}
        {tariffs.state === 'error' && <ErrorState error={tariffs.error} onRetry={tariffs.reload} />}
        {tariffs.state === 'success' && tariffs.data.length > 0 && (
          <Table
            head={[
              'Version',
              'Prix d’un crédit',
              'Coût fournisseur / segment',
              'International',
              'Date',
            ]}
          >
            {tariffs.data.map((t) => (
              <tr key={t.id}>
                <Td>
                  v{t.version}
                  {t.note && <span className="block text-xs text-muted">{t.note}</span>}
                </Td>
                <Td>{t.creditPriceXof !== null ? formatXof(t.creditPriceXof) : 'Non publié'}</Td>
                <Td>{t.providerCostPerSegmentXof ? `${t.providerCostPerSegmentXof} XOF` : '—'}</Td>
                <Td>
                  {t.internationalCreditsPerSegment !== null
                    ? `${t.internationalCreditsPerSegment} crédit(s) / segment`
                    : 'Refusé'}
                </Td>
                <Td>{formatDate(t.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

function TopUpRowView({ request, onDone }: { request: TopUpRow; onDone: () => void }) {
  const [credits, setCredits] = useState(String(request.creditsRequested));
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function decide(outcome: 'approve' | 'reject') {
    setBusy(true);
    setError(null);
    try {
      await api(`/platform/school-sms/top-ups/${request.id}/${outcome}`, {
        method: 'POST',
        body:
          outcome === 'approve'
            ? { credits: Number(credits), paymentReference: reference, note: note.trim() || null }
            : { note },
      });
      onDone();
    } catch (e) {
      setError(toError(e));
    } finally {
      setBusy(false);
    }
  }

  const amount = Number(credits);
  const canApprove =
    !busy && reference.trim().length >= 3 && Number.isInteger(amount) && amount > 0;
  const canReject = !busy && note.trim().length >= 3;
  return (
    <tr>
      <Td>
        {request.schoolName}
        <span className="block text-xs text-muted">{request.organization?.name ?? '—'}</span>
        {request.requestNote && (
          <span className="block text-xs text-muted">« {request.requestNote} »</span>
        )}
      </Td>
      <Td className="tabular-nums">{request.creditsRequested}</Td>
      <Td>
        {request.quotedAmountXof !== null ? formatXof(request.quotedAmountXof) : 'Tarif non publié'}
      </Td>
      <Td>{formatDate(request.createdAt)}</Td>
      <Td className="min-w-[16rem] space-y-2">
        <InputField
          label="Crédits accordés"
          type="number"
          min={1}
          value={credits}
          onChange={(e) => setCredits(e.target.value)}
        />
        <InputField
          label="Référence du règlement vérifié"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
        <InputField
          label="Note (motif obligatoire pour un refus)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!canApprove} onClick={() => decide('approve')}>
            Valider et créditer
          </Button>
          <Button size="sm" variant="ghost" disabled={!canReject} onClick={() => decide('reject')}>
            Refuser
          </Button>
        </div>
        <ApiErrorAlert error={error} />
      </Td>
    </tr>
  );
}

function WalletDetail({
  wallet,
  onClose,
  onChange,
}: {
  wallet: WalletRow;
  onClose: () => void;
  onChange: () => void;
}) {
  const ledger = useCursorPages<LedgerPage['items'][number]>(
    `/platform/school-sms/wallets/${wallet.schoolId}/ledger`,
  );
  const [credits, setCredits] = useState('');
  const [reason, setReason] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function adjust() {
    setBusy(true);
    setError(null);
    try {
      await api(`/platform/school-sms/wallets/${wallet.schoolId}/adjustments`, {
        method: 'POST',
        body: { credits: Number(credits), reason, idempotencyKey: key },
      });
      setCredits('');
      setReason('');
      setKey(crypto.randomUUID());
      ledger.reload();
      onChange();
    } catch (e) {
      setError(toError(e));
    } finally {
      setBusy(false);
    }
  }

  const delta = Number(credits);
  const valid = Number.isInteger(delta) && delta !== 0 && reason.trim().length >= 10;
  return (
    <div className="space-y-4 rounded-xl border border-line/80 p-4" data-testid="sms-wallet-detail">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{wallet.schoolName} — opérations du registre</h3>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Fermer
        </Button>
      </div>
      <form
        className="grid gap-2 sm:grid-cols-[10rem_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void adjust();
        }}
      >
        <InputField
          label="Correction (+/- crédits)"
          type="number"
          value={credits}
          onChange={(e) => setCredits(e.target.value)}
        />
        <InputField
          label="Justification (10 caractères au moins)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button type="submit" size="sm" disabled={busy || !valid}>
          Appliquer
        </Button>
      </form>
      <ApiErrorAlert error={error} />
      {ledger.state === 'loading' && <LoadingState />}
      {ledger.state === 'error' && ledger.error && (
        <ErrorState error={ledger.error} onRetry={ledger.reload} />
      )}
      {ledger.state === 'ready' && (
        <Table head={['Date', 'Opération', 'Disponible', 'Réservé', 'Solde après', 'Motif']}>
          {ledger.items.map((e) => (
            <tr key={e.id}>
              <Td>{formatDateTime(e.createdAt)}</Td>
              <Td>{SCHOOL_SMS_LEDGER_LABELS[e.kind]}</Td>
              <Td className="tabular-nums">
                {e.availableDelta > 0 ? `+${e.availableDelta}` : e.availableDelta}
              </Td>
              <Td className="tabular-nums">
                {e.reservedDelta > 0 ? `+${e.reservedDelta}` : e.reservedDelta}
              </Td>
              <Td className="tabular-nums">{e.balanceAfter}</Td>
              <Td>{e.reason ?? '—'}</Td>
            </tr>
          ))}
        </Table>
      )}
      {ledger.hasMore && (
        <Button
          size="sm"
          variant="secondary"
          disabled={ledger.busy}
          onClick={() => void ledger.more()}
        >
          Opérations plus anciennes
        </Button>
      )}
    </div>
  );
}

function TariffForm({ onDone }: { onDone: () => void }) {
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');
  const [international, setInternational] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api('/platform/school-sms/tariffs', {
        method: 'POST',
        body: {
          creditPriceXof: price ? Number(price) : null,
          providerCostPerSegmentXof: cost || null,
          internationalCreditsPerSegment: international ? Number(international) : null,
          note: note.trim() || null,
        },
      });
      setPrice('');
      setCost('');
      setInternational('');
      setNote('');
      onDone();
    } catch (e) {
      setError(toError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <InputField
        label="Prix d’un crédit (XOF, vide = non publié)"
        type="number"
        min={1}
        value={price}
        onChange={(e) => setPrice(e.target.value)}
      />
      <InputField
        label="Coût fournisseur / segment (XOF)"
        inputMode="decimal"
        value={cost}
        onChange={(e) => setCost(e.target.value)}
      />
      <InputField
        label="Crédits / segment à l’international (vide = refusé)"
        type="number"
        min={1}
        value={international}
        onChange={(e) => setInternational(e.target.value)}
      />
      <InputField label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button type="submit" size="sm" disabled={busy}>
        Créer une version
      </Button>
      <div className="sm:col-span-2 lg:col-span-5">
        <ApiErrorAlert error={error} />
      </div>
    </form>
  );
}

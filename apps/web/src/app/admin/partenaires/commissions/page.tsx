'use client';

import { type FormEvent, useState } from 'react';
import { Percent } from 'lucide-react';
import {
  COMMISSION_KIND_LABELS,
  COMMISSION_STATUS_LABELS,
  PARTNER_TYPES,
  PARTNER_TYPE_LABELS,
  PROPOSED_COMMISSION_PRESETS,
  type PartnerType,
  PAYOUT_STATUS_LABELS,
  type CommissionKind,
  type CommissionStatus,
  formatRateBps,
  formatXof,
} from '@ocall/shared';
import { useCanPlatform, useSession } from '@/components/app/session-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/use-api';

interface RuleRow {
  id: string;
  name: string;
  setupRateBps: number;
  monthlyRateBps: number;
  monthlyWindowMonths: number | null;
  partnerType: PartnerType | null;
  isActive: boolean;
  validatedAt: string | null;
}
interface PayoutRequestRow {
  id: string;
  amount: number;
  note: string | null;
  createdAt: string;
  partner: { id: string; code: string; companyName: string };
}
interface CommissionRow {
  id: string;
  partnerId: string;
  kind: CommissionKind;
  baseAmount: number;
  rateBps: number;
  amount: number;
  status: CommissionStatus;
  payableFrom: string | null;
  createdAt: string;
  subscriptionPaymentId: string | null;
  partner: { code: string; companyName: string };
  organization: { name: string };
  product: { name: string };
  payout: { number: string } | null;
}
interface PayoutRow {
  id: string;
  number: string;
  total: number;
  method: string;
  paidAt: string;
  status: keyof typeof PAYOUT_STATUS_LABELS;
  recordedById: string;
  partner: { id?: string; code: string; companyName: string };
  partnerId?: string;
  _count: { commissions: number };
}

/**
 * Règles, commissions et versements (Sprint 12B). Règles créées inactives, validées par le
 * propriétaire ; commissions validées par Ocall ; versements saisis puis confirmés par une autre
 * personne. Aucun versement automatique.
 */
export default function AdminCommissionsPage() {
  const me = useSession();
  const canPartners = useCanPlatform('platform.partners.manage');
  const canValidate = useCanPlatform('platform.commissions.validate');
  const canPayouts = useCanPlatform('platform.payouts.manage');
  const rules = useApi<RuleRow[]>(canPartners ? '/platform/commission-rules' : null);
  const commissions = useApi<CommissionRow[]>(canValidate ? '/platform/commissions' : null);
  const payouts = useApi<PayoutRow[]>(canPayouts ? '/platform/commission-payouts' : null);
  const requests = useApi<PayoutRequestRow[]>(
    canPayouts ? '/platform/partner-payout-requests?status=PENDING' : null,
  );
  const [selected, setSelected] = useState<string[]>([]);
  // Aucune valeur par défaut : un barème se saisit (ou se pré-remplit) puis se valide explicitement.
  const [rule, setRule] = useState({
    name: '',
    setupRate: '',
    monthlyRate: '',
    window: '',
    partnerType: '' as PartnerType | '',
  });
  const preset = (type: PartnerType) => {
    const p = PROPOSED_COMMISSION_PRESETS[type];
    setRule({
      name: p.name,
      setupRate: String(p.setupRateBps / 100),
      monthlyRate: String(p.monthlyRateBps / 100),
      window: p.monthlyWindowMonths === null ? '' : String(p.monthlyWindowMonths),
      partnerType: type,
    });
  };
  const [payout, setPayout] = useState({
    method: 'Virement',
    reference: '',
    paidAt: new Date().toISOString().slice(0, 10),
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function run(path: string, body: unknown, done: string) {
    setError(null);
    try {
      await api(path, { method: 'POST', body });
      setNotice(done);
      setSelected([]);
      rules.reload();
      commissions.reload();
      payouts.reload();
      requests.reload();
    } catch (e) {
      setError(e as ApiError);
    }
  }

  async function createRule(event: FormEvent) {
    event.preventDefault();
    await run(
      '/platform/commission-rules',
      {
        name: rule.name,
        setupRateBps: Math.round(Number(rule.setupRate) * 100),
        monthlyRateBps: Math.round(Number(rule.monthlyRate) * 100),
        // Vide : mensualités commissionnées jusqu'à la fin du contrat client.
        monthlyWindowMonths: rule.window.trim() ? Number(rule.window) : null,
        ...(rule.partnerType ? { partnerType: rule.partnerType } : {}),
      },
      'Règle créée : inactive jusqu’à la validation du propriétaire.',
    );
  }

  const rows = commissions.state === 'success' ? commissions.data : [];
  const chosen = rows.filter((c) => selected.includes(c.id));
  const partners = [...new Set(chosen.map((c) => c.partnerId))];
  const payable =
    chosen.length > 0 &&
    partners.length === 1 &&
    chosen.every((c) => c.status === 'VALIDATED' && !c.payout);
  const validatable = chosen.length > 0 && chosen.every((c) => c.status === 'ACCRUED');

  return (
    <>
      <PageHeader
        eyebrow="Super Admin"
        title="Commissions partenaires"
        description="Calculées uniquement sur les encaissements confirmés. Validez, puis enregistrez un versement : une autre personne le confirme."
      />
      {notice && (
        <div className="mb-4">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}
      <ApiErrorAlert error={error} />

      {canPartners && (
        <Card className="mb-6">
          <CardHeader
            title="Règles de commission"
            description="Taux jamais inscrits dans le code. Une règle ne s’applique qu’après validation par le propriétaire."
          />
          {rules.state === 'success' && rules.data.length > 0 && (
            <Table
              head={[
                'Règle',
                'Partenaires',
                'Setup (une fois)',
                'Mensualités',
                'Durée',
                'Statut',
                '',
              ]}
            >
              {rules.data.map((r) => (
                <tr key={r.id}>
                  <Td className="font-medium">{r.name}</Td>
                  <Td>{r.partnerType ? PARTNER_TYPE_LABELS[r.partnerType] : 'Tous'}</Td>
                  <Td>{formatRateBps(r.setupRateBps)}</Td>
                  <Td>{formatRateBps(r.monthlyRateBps)}</Td>
                  <Td>
                    {r.monthlyWindowMonths === null
                      ? 'Jusqu’à la fin du contrat'
                      : `${r.monthlyWindowMonths} mois`}
                  </Td>
                  <Td>
                    <Badge tone={r.isActive ? 'forest' : 'savanna'}>
                      {r.isActive ? `Active depuis le ${formatDate(r.validatedAt)}` : 'Inactive'}
                    </Badge>
                  </Td>
                  <Td>
                    {r.isActive ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          run(
                            `/platform/commission-rules/${r.id}/deactivate`,
                            {},
                            'Règle désactivée.',
                          )
                        }
                      >
                        Désactiver
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() =>
                          run(
                            `/platform/commission-rules/${r.id}/activate`,
                            {},
                            'Règle validée et active.',
                          )
                        }
                      >
                        Valider (propriétaire)
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
          <div className="flex flex-wrap items-center gap-2 px-5 pt-4 text-sm sm:px-6">
            <span className="text-muted">Pré-remplir avec le barème proposé (non validé) :</span>
            {PARTNER_TYPES.map((t) => (
              <Button key={t} size="sm" variant="ghost" type="button" onClick={() => preset(t)}>
                {PARTNER_TYPE_LABELS[t]}
              </Button>
            ))}
          </div>
          <form
            onSubmit={createRule}
            className="grid gap-3 px-5 py-4 sm:grid-cols-3 lg:grid-cols-6 lg:items-end sm:px-6"
          >
            <InputField
              label="Nom"
              required
              value={rule.name}
              onChange={(e) => setRule({ ...rule, name: e.target.value })}
            />
            <InputField
              label="Mise en service (%)"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={rule.setupRate}
              onChange={(e) => setRule({ ...rule, setupRate: e.target.value })}
            />
            <InputField
              label="Mensualités (%)"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={rule.monthlyRate}
              onChange={(e) => setRule({ ...rule, monthlyRate: e.target.value })}
            />
            <InputField
              label="Durée (mois, vide = fin du contrat)"
              type="number"
              min={1}
              max={120}
              value={rule.window}
              onChange={(e) => setRule({ ...rule, window: e.target.value })}
            />
            <SelectField
              label="Partenaires"
              value={rule.partnerType}
              onChange={(e) =>
                setRule({ ...rule, partnerType: e.target.value as PartnerType | '' })
              }
              options={[
                { value: '', label: 'Tous' },
                ...PARTNER_TYPES.map((t) => ({ value: t, label: PARTNER_TYPE_LABELS[t] })),
              ]}
            />
            <Button
              type="submit"
              disabled={!rule.name || rule.setupRate === '' || rule.monthlyRate === ''}
            >
              Créer la règle (inactive)
            </Button>
          </form>
        </Card>
      )}

      {canValidate && (
        <Card className="mb-6">
          <CardHeader
            title="Commissions"
            action={
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={!validatable}
                  onClick={() =>
                    run(
                      '/platform/commissions/validate',
                      { ids: selected },
                      'Commissions validées.',
                    )
                  }
                >
                  Valider la sélection
                </Button>
              </div>
            }
          />
          {commissions.state === 'loading' && <LoadingState />}
          {commissions.state === 'error' && (
            <ErrorState error={commissions.error} onRetry={commissions.reload} />
          )}
          {commissions.state === 'success' &&
            (rows.length === 0 ? (
              <EmptyState
                icon={<Percent className="h-7 w-7" />}
                title="Aucune commission"
                description="Elles naissent des encaissements confirmés des clients attribués."
              />
            ) : (
              <Table
                head={[
                  '',
                  'Partenaire',
                  'Client',
                  'Nature',
                  'Base',
                  'Taux',
                  'Montant',
                  'Règlement',
                  'Statut',
                ]}
              >
                {rows.map((c) => (
                  <tr key={c.id}>
                    <Td>
                      <input
                        type="checkbox"
                        aria-label="Sélectionner"
                        className="h-5 w-5 accent-forest"
                        checked={selected.includes(c.id)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, c.id]
                              : selected.filter((x) => x !== c.id),
                          )
                        }
                      />
                    </Td>
                    <Td className="font-medium">{c.partner.companyName}</Td>
                    <Td>
                      {c.organization.name}
                      <span className="block text-xs text-muted">
                        {c.product.name} · {formatDate(c.createdAt)}
                      </span>
                    </Td>
                    <Td>{COMMISSION_KIND_LABELS[c.kind]}</Td>
                    <Td className="tabular-nums">
                      {c.kind === 'ADJUSTMENT' ? '—' : formatXof(c.baseAmount)}
                    </Td>
                    <Td>{c.kind === 'ADJUSTMENT' ? '—' : formatRateBps(c.rateBps)}</Td>
                    <Td className="tabular-nums font-semibold">{formatXof(c.amount)}</Td>
                    <Td>{c.status === 'REVERSED' ? '—' : formatDate(c.payableFrom)}</Td>
                    <Td>
                      {COMMISSION_STATUS_LABELS[c.status]}
                      {c.payout && (
                        <span className="block text-xs text-muted">{c.payout.number}</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
            ))}
        </Card>
      )}

      {canPayouts && (
        <Card>
          <CardHeader title="Versements" />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                '/platform/commission-payouts',
                {
                  partnerId: partners[0],
                  commissionIds: selected,
                  method: payout.method,
                  reference: payout.reference || undefined,
                  paidAt: payout.paidAt,
                },
                'Versement enregistré : une autre personne doit le confirmer.',
              );
            }}
            className="grid gap-3 px-5 py-4 sm:grid-cols-4 sm:items-end sm:px-6"
          >
            <SelectField
              label="Moyen"
              value={payout.method}
              onChange={(e) => setPayout({ ...payout, method: e.target.value })}
              options={['Virement', 'Mobile money', 'Espèces', 'Chèque'].map((m) => ({
                value: m,
                label: m,
              }))}
            />
            <InputField
              label="Référence"
              value={payout.reference}
              onChange={(e) => setPayout({ ...payout, reference: e.target.value })}
            />
            <InputField
              label="Versé le"
              type="date"
              value={payout.paidAt}
              onChange={(e) => setPayout({ ...payout, paidAt: e.target.value })}
            />
            <Button type="submit" disabled={!payable}>
              Verser la sélection ({formatXof(chosen.reduce((t, c) => t + c.amount, 0))})
            </Button>
          </form>
          {payouts.state === 'success' && payouts.data.length > 0 && (
            <Table head={['Versement', 'Partenaire', 'Montant', 'Statut', '']}>
              {payouts.data.map((v) => (
                <tr key={v.id}>
                  <Td className="font-medium">
                    {v.number}
                    <span className="block text-xs text-muted">
                      {formatDate(v.paidAt)} · {v.method} · {v._count.commissions} commission(s)
                    </span>
                  </Td>
                  <Td>{v.partner.companyName}</Td>
                  <Td className="tabular-nums">{formatXof(v.total)}</Td>
                  <Td>{PAYOUT_STATUS_LABELS[v.status]}</Td>
                  <Td>
                    {v.status === 'RECORDED' && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={v.recordedById === me.user.id}
                          title={
                            v.recordedById === me.user.id
                              ? 'Confirmation par une autre personne (quatre yeux)'
                              : undefined
                          }
                          onClick={() =>
                            run(
                              `/platform/commission-payouts/${v.id}/confirm`,
                              {},
                              'Versement confirmé : commissions versées.',
                            )
                          }
                        >
                          Confirmer
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            const reason = window.prompt('Motif du rejet');
                            if (reason && reason.trim().length >= 3)
                              void run(
                                `/platform/commission-payouts/${v.id}/reject`,
                                { reason },
                                'Versement rejeté.',
                              );
                          }}
                        >
                          Rejeter
                        </Button>
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
      {canPayouts && requests.state === 'success' && (
        <Card className="mt-6">
          <CardHeader
            title="Demandes de règlement des partenaires"
            description="« Réglée » seulement avec un versement confirmé du même partenaire ; refus motivé sinon."
          />
          {requests.data.length === 0 ? (
            <p className="px-6 py-4 text-sm text-muted">Aucune demande en attente.</p>
          ) : (
            <Table head={['Partenaire', 'Montant demandé', 'Demandée le', '']}>
              {requests.data.map((r) => {
                const confirmed =
                  payouts.state === 'success'
                    ? payouts.data.filter(
                        (v) => v.status === 'CONFIRMED' && v.partner.code === r.partner.code,
                      )
                    : [];
                return (
                  <tr key={r.id}>
                    <Td className="font-medium">
                      {r.partner.companyName}
                      {r.note && <span className="block text-xs text-muted">« {r.note} »</span>}
                    </Td>
                    <Td className="tabular-nums">{formatXof(r.amount)}</Td>
                    <Td>{formatDate(r.createdAt)}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-2">
                        {confirmed.slice(0, 3).map((v) => (
                          <Button
                            key={v.id}
                            size="sm"
                            onClick={() =>
                              run(
                                `/platform/partner-payout-requests/${r.id}/decide`,
                                { outcome: 'PROCESSED', payoutId: v.id },
                                'Demande marquée réglée.',
                              )
                            }
                          >
                            Réglée par {v.number}
                          </Button>
                        ))}
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            const note = window.prompt('Motif du refus');
                            if (note && note.trim().length >= 3)
                              void run(
                                `/platform/partner-payout-requests/${r.id}/decide`,
                                { outcome: 'REJECTED', note },
                                'Demande refusée.',
                              );
                          }}
                        >
                          Refuser
                        </Button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      )}
    </>
  );
}

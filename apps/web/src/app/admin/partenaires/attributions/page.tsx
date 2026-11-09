'use client';

import { type FormEvent, useState } from 'react';
import { GitMerge } from 'lucide-react';
import {
  ATTRIBUTION_STATUS_LABELS,
  PARTNER_TYPE_LABELS,
  PROSPECT_STATUS_LABELS,
  type ProspectStatus,
} from '@ocall/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { PlatformOrganization } from '@/lib/types';
import { useApi } from '@/lib/use-api';

interface ProspectRow {
  id: string;
  companyName: string;
  phone: string;
  status: ProspectStatus;
  protectedUntil: string;
  partner: { id: string; code: string; companyName: string };
  organization: { id: string; name: string } | null;
}
type AttributionState = keyof typeof ATTRIBUTION_STATUS_LABELS | 'ENDED';
const STATUS_LABEL = (s: AttributionState) =>
  s === 'ENDED' ? 'Terminée' : ATTRIBUTION_STATUS_LABELS[s];
interface PartnerRef {
  id: string;
  code: string;
  companyName: string;
  type: 'REFERRER' | 'RESELLER';
}
const APPS = [
  { value: 'OCALL_PARK', label: 'Ocall Park' },
  { value: 'OCALL_SCHOOL', label: 'Ocall School' },
];
interface AttributionRow {
  id: string;
  status: AttributionState;
  endReason: string | null;
  product: { code: string; name: string } | null;
  source: 'PROSPECT' | 'REFERRAL' | 'ADMIN';
  createdAt: string;
  confirmedAt: string | null;
  rejectionReason: string | null;
  organization: { id: string; name: string };
  partner: { id: string; code: string; companyName: string };
  prospect: { companyName: string } | null;
}

/**
 * Prospects et attributions (Sprint 12B). Une attribution est TOUJOURS confirmée par Ocall ; une
 * seule attribution confirmée par organisation, les autres propositions sont rejetées.
 */
export default function AttributionsPage() {
  // Prospects paginés côté serveur (50 par page), avec recherche : aucun prospect inaccessible.
  const [prospectQuery, setProspectQuery] = useState({ q: '', page: 0 });
  const prospectPage = useApi<{ items: ProspectRow[]; total: number; pageSize: number }>(
    `/platform/prospects?${new URLSearchParams({
      ...(prospectQuery.q.trim() ? { q: prospectQuery.q.trim() } : {}),
      page: String(prospectQuery.page),
    }).toString()}`,
  );
  const prospects =
    prospectPage.state === 'success'
      ? { ...prospectPage, data: prospectPage.data.items }
      : prospectPage;
  const attributions = useApi<AttributionRow[]>('/platform/attributions');
  const orgs = useApi<PlatformOrganization[]>('/platform/organizations');
  const partners = useApi<PartnerRef[]>('/platform/partners');
  const [form, setForm] = useState({
    prospectId: '',
    organizationId: '',
    productCode: 'OCALL_PARK',
  });
  const [assign, setAssign] = useState({
    organizationId: '',
    partnerId: '',
    productCode: 'OCALL_PARK',
    reason: '',
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function run(path: string, body: unknown, done: string) {
    setError(null);
    try {
      await api(path, { method: 'POST', body });
      setNotice(done);
      prospectPage.reload();
      attributions.reload();
    } catch (e) {
      setError(e as ApiError);
    }
  }

  async function propose(event: FormEvent) {
    event.preventDefault();
    if (prospects.state !== 'success') return;
    const prospect = prospects.data.find((p) => p.id === form.prospectId);
    if (!prospect) return;
    await run(
      '/platform/attributions',
      {
        organizationId: form.organizationId,
        partnerId: prospect.partner.id,
        prospectId: prospect.id,
        productCode: form.productCode,
      },
      'Attribution proposée : à confirmer.',
    );
    setForm({ prospectId: '', organizationId: '', productCode: 'OCALL_PARK' });
  }

  async function assignDirect(event: FormEvent) {
    event.preventDefault();
    await run('/platform/attributions/assign', assign, 'Client attribué au partenaire (confirmé).');
    setAssign({ organizationId: '', partnerId: '', productCode: 'OCALL_PARK', reason: '' });
  }

  return (
    <>
      <PageHeader
        eyebrow="Super Admin"
        title="Prospects et attributions"
        description="Une attribution par organisation et application. Les conflits sont arbitrés ici : jamais de transfert silencieux, toute fin d’attribution est motivée et conservée."
      />
      {notice && (
        <div className="mb-4">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}
      <ApiErrorAlert error={error} />
      {orgs.state === 'success' && partners.state === 'success' && (
        <Card className="mb-6">
          <CardHeader
            title="Attribuer directement un client"
            description="Par exemple, confier un client à un revendeur agréé. L’attribution est confirmée immédiatement et journalisée."
          />
          <form
            onSubmit={assignDirect}
            className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_12rem_1fr_auto] lg:items-end sm:px-6"
            data-testid="assign-form"
          >
            <SelectField
              label="Organisation cliente"
              value={assign.organizationId}
              onChange={(e) => setAssign({ ...assign, organizationId: e.target.value })}
              options={[
                { value: '', label: 'Choisir…' },
                ...orgs.data.map((o) => ({ value: o.id, label: o.name })),
              ]}
            />
            <SelectField
              label="Partenaire"
              value={assign.partnerId}
              onChange={(e) => setAssign({ ...assign, partnerId: e.target.value })}
              options={[
                { value: '', label: 'Choisir…' },
                ...partners.data.map((p) => ({
                  value: p.id,
                  label: `${p.companyName} · ${PARTNER_TYPE_LABELS[p.type]}`,
                })),
              ]}
            />
            <SelectField
              label="Application"
              value={assign.productCode}
              onChange={(e) => setAssign({ ...assign, productCode: e.target.value })}
              options={APPS}
            />
            <InputField
              label="Motif"
              value={assign.reason}
              onChange={(e) => setAssign({ ...assign, reason: e.target.value })}
            />
            <Button
              type="submit"
              disabled={
                !assign.organizationId || !assign.partnerId || assign.reason.trim().length < 3
              }
            >
              Attribuer
            </Button>
          </form>
        </Card>
      )}
      <Card className="mb-6">
        <CardHeader title="Attributions" />
        {attributions.state === 'loading' && <LoadingState />}
        {attributions.state === 'error' && (
          <ErrorState error={attributions.error} onRetry={attributions.reload} />
        )}
        {attributions.state === 'success' &&
          (attributions.data.length === 0 ? (
            <EmptyState
              icon={<GitMerge className="h-7 w-7" />}
              title="Aucune attribution"
              description="Proposez une attribution à partir d’un prospect."
            />
          ) : (
            <Table head={['Client', 'Application', 'Partenaire', 'Origine', 'Statut', '']}>
              {attributions.data.map((a) => (
                <tr key={a.id}>
                  <Td className="font-medium">
                    {a.organization.name}
                    <span className="block text-xs text-muted">
                      proposée le {formatDate(a.createdAt)}
                    </span>
                  </Td>
                  <Td>{a.product?.name ?? 'Toutes applications'}</Td>
                  <Td>
                    {a.partner.companyName}
                    <span className="block text-xs text-muted">{a.partner.code}</span>
                  </Td>
                  <Td>
                    {a.source === 'PROSPECT'
                      ? `Prospect ${a.prospect?.companyName ?? ''}`
                      : a.source === 'REFERRAL'
                        ? 'Parrainage'
                        : 'Ocall'}
                  </Td>
                  <Td>
                    <Badge
                      tone={
                        a.status === 'CONFIRMED'
                          ? 'forest'
                          : a.status === 'PENDING'
                            ? 'savanna'
                            : 'terracotta'
                      }
                    >
                      {STATUS_LABEL(a.status)}
                    </Badge>
                    {(a.rejectionReason ?? a.endReason) && (
                      <span className="block text-xs text-muted">
                        {a.rejectionReason ?? a.endReason}
                      </span>
                    )}
                  </Td>
                  <Td>
                    {a.status === 'PENDING' && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() =>
                            run(
                              `/platform/attributions/${a.id}/confirm`,
                              {},
                              'Attribution confirmée.',
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
                                `/platform/attributions/${a.id}/reject`,
                                { reason },
                                'Attribution rejetée.',
                              );
                          }}
                        >
                          Rejeter
                        </Button>
                      </div>
                    )}
                    {a.status === 'CONFIRMED' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const reason = window.prompt(
                            'Motif de la fin d’attribution (arbitrage ; commissions acquises conservées)',
                          );
                          if (reason && reason.trim().length >= 3)
                            void run(
                              `/platform/attributions/${a.id}/end`,
                              { reason },
                              'Attribution terminée.',
                            );
                        }}
                      >
                        Mettre fin
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          ))}
      </Card>
      <Card>
        <CardHeader title="Prospects des partenaires" />
        <div className="px-5 pt-4 sm:px-6">
          <InputField
            label="Rechercher un prospect"
            placeholder="Entreprise, contact, ville"
            value={prospectQuery.q}
            onChange={(e) => setProspectQuery({ q: e.target.value, page: 0 })}
          />
        </div>
        {prospects.state === 'success' && orgs.state === 'success' && (
          <form
            onSubmit={propose}
            className="grid gap-3 px-5 pt-4 sm:grid-cols-[1fr_1fr_12rem_auto] sm:items-end sm:px-6"
          >
            <SelectField
              label="Prospect"
              value={form.prospectId}
              onChange={(e) => setForm({ ...form, prospectId: e.target.value })}
              options={[
                { value: '', label: 'Choisir…' },
                ...prospects.data
                  .filter((p) => !p.organization)
                  .map((p) => ({ value: p.id, label: `${p.companyName} · ${p.partner.code}` })),
              ]}
            />
            <SelectField
              label="Organisation cliente"
              value={form.organizationId}
              onChange={(e) => setForm({ ...form, organizationId: e.target.value })}
              options={[
                { value: '', label: 'Choisir…' },
                ...orgs.data.map((o) => ({ value: o.id, label: o.name })),
              ]}
            />
            <SelectField
              label="Application"
              value={form.productCode}
              onChange={(e) => setForm({ ...form, productCode: e.target.value })}
              options={APPS}
            />
            <Button type="submit" disabled={!form.prospectId || !form.organizationId}>
              Proposer
            </Button>
          </form>
        )}
        {prospects.state === 'loading' && <LoadingState />}
        {prospects.state === 'error' && (
          <ErrorState error={prospects.error} onRetry={prospects.reload} />
        )}
        {prospects.state === 'success' && (
          <Table head={['Prospect', 'Partenaire', 'Réservé jusqu’au', 'Statut', '']}>
            {prospects.data.map((p) => (
              <tr key={p.id}>
                <Td className="font-medium">
                  {p.companyName}
                  <span className="block text-xs text-muted">{p.phone}</span>
                </Td>
                <Td>{p.partner.companyName}</Td>
                <Td>{formatDate(p.protectedUntil)}</Td>
                <Td>
                  {PROSPECT_STATUS_LABELS[p.status]}
                  {p.organization && (
                    <span className="block text-xs text-muted">→ {p.organization.name}</span>
                  )}
                </Td>
                <Td>
                  {!p.organization && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void run(
                          `/platform/prospects/${p.id}/extend`,
                          { days: 90 },
                          'Réservation prolongée de 90 jours.',
                        )
                      }
                    >
                      Prolonger 90 j
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        {prospectPage.state === 'success' &&
          prospectPage.data.total > prospectPage.data.pageSize && (
            <div className="flex justify-between gap-2 px-5 py-3 text-sm">
              <span className="text-muted">{prospectPage.data.total} prospects</span>
              <span className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={prospectQuery.page === 0}
                  onClick={() =>
                    setProspectQuery({ ...prospectQuery, page: prospectQuery.page - 1 })
                  }
                >
                  Précédent
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={
                    (prospectQuery.page + 1) * prospectPage.data.pageSize >= prospectPage.data.total
                  }
                  onClick={() =>
                    setProspectQuery({ ...prospectQuery, page: prospectQuery.page + 1 })
                  }
                >
                  Suivant
                </Button>
              </span>
            </div>
          )}
      </Card>
    </>
  );
}

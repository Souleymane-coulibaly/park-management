'use client';

import { type FormEvent, useState } from 'react';
import { GitMerge } from 'lucide-react';
import {
  ATTRIBUTION_STATUS_LABELS,
  PROSPECT_STATUS_LABELS,
  type AttributionStatus,
  type ProspectStatus,
} from '@ocall/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
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
interface AttributionRow {
  id: string;
  status: AttributionStatus;
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
  const prospects = useApi<ProspectRow[]>('/platform/prospects');
  const attributions = useApi<AttributionRow[]>('/platform/attributions');
  const orgs = useApi<PlatformOrganization[]>('/platform/organizations');
  const [form, setForm] = useState({ prospectId: '', organizationId: '' });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function run(path: string, body: unknown, done: string) {
    setError(null);
    try {
      await api(path, { method: 'POST', body });
      setNotice(done);
      prospects.reload();
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
      },
      'Attribution proposée : à confirmer.',
    );
    setForm({ prospectId: '', organizationId: '' });
  }

  return (
    <>
      <PageHeader
        eyebrow="Super Admin"
        title="Prospects et attributions"
        description="Rattachez un client à un partenaire, puis confirmez. Les conflits sont tranchés ici : la confirmation rejette les autres propositions."
      />
      {notice && (
        <div className="mb-4">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}
      <ApiErrorAlert error={error} />
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
            <Table head={['Client', 'Partenaire', 'Origine', 'Statut', '']}>
              {attributions.data.map((a) => (
                <tr key={a.id}>
                  <Td className="font-medium">
                    {a.organization.name}
                    <span className="block text-xs text-muted">
                      proposée le {formatDate(a.createdAt)}
                    </span>
                  </Td>
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
                      {ATTRIBUTION_STATUS_LABELS[a.status]}
                    </Badge>
                    {a.rejectionReason && (
                      <span className="block text-xs text-muted">{a.rejectionReason}</span>
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
                  </Td>
                </tr>
              ))}
            </Table>
          ))}
      </Card>
      <Card>
        <CardHeader title="Prospects des partenaires" />
        {prospects.state === 'success' && orgs.state === 'success' && (
          <form
            onSubmit={propose}
            className="grid gap-3 px-5 pt-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end sm:px-6"
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
                        run(
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
      </Card>
    </>
  );
}

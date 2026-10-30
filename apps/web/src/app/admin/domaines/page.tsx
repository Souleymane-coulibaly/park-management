'use client';

import { useState } from 'react';
import { Ban, ShieldCheck } from 'lucide-react';
import { SITE_DOMAIN_STATUS_LABELS, type SiteDomainStatus } from '@ocall/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useApi } from '@/lib/use-api';

interface PlatformDomains {
  customDomainTarget: string | null;
  verifierMode: 'real' | 'simulated';
  domains: {
    id: string;
    hostname: string;
    status: SiteDomainStatus;
    verifiedAt: string | null;
    activatedAt: string | null;
    lastCheckedAt: string | null;
    lastError: string | null;
    createdAt: string;
    site: { id: string; slug: string; organization: string; establishment: string };
  }[];
}

const TONE: Record<SiteDomainStatus, 'forest' | 'savanna' | 'terracotta' | 'neutral'> = {
  PENDING: 'neutral',
  VERIFYING: 'savanna',
  VERIFIED: 'savanna',
  ACTIVE: 'forest',
  ERROR: 'terracotta',
};

/**
 * Domaines personnalisés : procédure administrative. 1) la propriété est vérifiée par le client
 * (TXT) ; 2) Ocall ajoute le domaine chez l'hébergeur ; 3) « Activer » revérifie le TXT et contrôle
 * réellement le HTTPS avant de servir le site.
 */
export default function AdminDomainsPage() {
  const [status, setStatus] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const data = useApi<PlatformDomains>(
    `/platform/site-domains${status ? `?status=${status}` : ''}`,
  );

  async function act(id: string, action: 'activate' | 'suspend') {
    const reason = action === 'suspend' ? window.prompt('Motif de la mise hors service ?') : null;
    if (action === 'suspend' && (!reason || reason.trim().length < 3)) return;
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ status: SiteDomainStatus; error?: string | null }>(
        `/platform/site-domains/${id}/${action}`,
        {
          method: 'POST',
          ...(action === 'suspend' ? { body: { reason } } : {}),
        },
      );
      setNotice(
        res.status === 'ACTIVE'
          ? 'Domaine activé : HTTPS vérifié.'
          : `Domaine non activé : ${res.error ?? 'mis hors service.'}`,
      );
      data.reload();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Super Admin"
        title="Domaines personnalisés"
        description="Ajoutez le domaine dans l’hébergeur (Railway : 20 domaines au plus par service), puis activez-le ici : la propriété (TXT) et le HTTPS sont vérifiés réellement avant toute mise en service."
      />
      {data.state === 'success' && data.data.verifierMode === 'simulated' && (
        <div className="mb-4">
          <Alert tone="info" title="Vérifications SIMULÉES">
            Environnement de test : aucune requête DNS ni HTTPS réelle n’est faite.
          </Alert>
        </div>
      )}
      {notice && (
        <div className="mb-4">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}
      <ApiErrorAlert error={error} />
      <Card>
        <CardHeader
          title="Demandes"
          description={
            data.state === 'success'
              ? `Cible CNAME communiquée aux clients : ${data.data.customDomainTarget ?? 'non configurée (SITES_CUSTOM_DOMAIN_TARGET)'}`
              : undefined
          }
          action={
            <div className="w-56">
              <SelectField
                label="Statut"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                options={[
                  { value: '', label: 'Tous' },
                  ...Object.entries(SITE_DOMAIN_STATUS_LABELS).map(([value, label]) => ({
                    value,
                    label,
                  })),
                ]}
              />
            </div>
          }
        />
        {data.state === 'loading' && <LoadingState />}
        {data.state === 'error' && <ErrorState error={data.error} onRetry={data.reload} />}
        {data.state === 'success' &&
          (data.data.domains.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck className="h-7 w-7" />}
              title="Aucun domaine"
              description="Les demandes des établissements apparaîtront ici."
            />
          ) : (
            <Table head={['Domaine', 'Site', 'Statut', 'Dernière vérification', '']}>
              {data.data.domains.map((d) => (
                <tr key={d.id} data-testid="domain-row">
                  <Td className="font-medium">{d.hostname}</Td>
                  <Td>
                    {d.site.establishment}
                    <span className="block text-xs text-muted">
                      {d.site.organization} · /e/{d.site.slug}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={TONE[d.status]}>{SITE_DOMAIN_STATUS_LABELS[d.status]}</Badge>
                    {d.lastError && (
                      <span className="block text-xs text-terracotta-dark">{d.lastError}</span>
                    )}
                  </Td>
                  <Td>{formatDateTime(d.lastCheckedAt)}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      {d.verifiedAt && d.status !== 'ACTIVE' && (
                        <Button
                          size="sm"
                          icon={<ShieldCheck className="h-4 w-4" />}
                          loading={busy === d.id}
                          onClick={() => act(d.id, 'activate')}
                        >
                          Activer
                        </Button>
                      )}
                      {d.status === 'ACTIVE' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<Ban className="h-4 w-4" />}
                          loading={busy === d.id}
                          onClick={() => act(d.id, 'suspend')}
                        >
                          Mettre hors service
                        </Button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          ))}
      </Card>
    </>
  );
}

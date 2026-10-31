'use client';

import { useState } from 'react';
import { HardDrive, Trash2 } from 'lucide-react';
import { bytesToMb } from '@ocall/shared';
import { useCanPlatform } from '@/components/app/session-context';
import { QuotaEditor } from '@/components/admin/quota-editor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { ApiError, api } from '@/lib/api';
import type { PlatformStorage } from '@/lib/types';
import { useApi } from '@/lib/use-api';

const SOURCE_LABEL = { override: 'Dérogation', plan: 'Offre', default: 'Défaut' } as const;

/**
 * Stockage par organisation : médias des sites vitrines et fichiers privés (pièces jointes du
 * support), face au quota de l'offre ou à une dérogation. Purge des fichiers en fin de conservation.
 */
export default function PlatformStoragePage() {
  const storage = useApi<PlatformStorage>('/platform/storage');
  const canManage = useCanPlatform('platform.quotas.manage');
  const [editing, setEditing] = useState<PlatformStorage['rows'][number] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [purging, setPurging] = useState(false);

  async function purge() {
    setPurging(true);
    setError(null);
    try {
      const res = await api<{ purged: number }>('/platform/storage/purge', { method: 'POST' });
      setNotice(`${res.purged} fichier(s) purgé(s).`);
      storage.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setPurging(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Ocall Suite"
        title="Stockage"
        description="Fichiers privés par défaut, servis par liens temporaires signés ; le bucket n’est jamais public."
        action={
          canManage && (
            <Button
              variant="secondary"
              icon={<Trash2 className="h-4 w-4" />}
              loading={purging}
              onClick={purge}
            >
              Purger les fichiers expirés
            </Button>
          )
        }
      />
      <div className="mb-4 space-y-3">
        {notice && <Alert tone="success">{notice}</Alert>}
        <ApiErrorAlert error={error} />
      </div>
      {storage.state === 'loading' && <LoadingState />}
      {storage.state === 'error' && <ErrorState error={storage.error} onRetry={storage.reload} />}
      {storage.state === 'success' && (
        <Card>
          <CardBody>
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
              Fournisseur :{' '}
              <strong>{storage.data.driver === 's3' ? 'compatible S3' : 'local'}</strong>
              <Badge tone={storage.data.healthy ? 'forest' : 'terracotta'}>
                {storage.data.healthy ? 'Disponible' : 'Indisponible'}
              </Badge>
              · {storage.data.totalMb} Mo utilisés · {storage.data.expiredFiles} fichier(s) en fin
              de conservation
            </p>
          </CardBody>
          {storage.data.rows.length === 0 ? (
            <EmptyState
              icon={<HardDrive className="h-7 w-7" />}
              title="Aucune organisation"
              description="Aucune organisation enregistrée."
            />
          ) : (
            <Table head={['Organisation', 'Utilisé', 'Détail', 'Quota', '']}>
              {storage.data.rows.map((r) => (
                <tr key={r.organization.id} data-testid="storage-row">
                  <Td>
                    <p className="font-semibold">{r.organization.name}</p>
                    <p className="text-xs text-muted">{r.plan ?? '—'}</p>
                  </Td>
                  <Td className="tabular-nums">
                    {r.usedMb} Mo ({r.percent} %)
                    <div className="mt-1 h-2 w-32 rounded-full bg-ivory-dark/70">
                      <div
                        className={`h-2 rounded-full ${r.percent >= 90 ? 'bg-terracotta' : 'bg-forest'}`}
                        style={{ width: `${Math.min(100, r.percent)}%` }}
                      />
                    </div>
                  </Td>
                  <Td className="text-xs text-muted">
                    Sites : {bytesToMb(r.siteMediaBytes)} Mo · privés : {bytesToMb(r.privateBytes)}{' '}
                    Mo ({r.files})
                  </Td>
                  <Td className="tabular-nums">
                    {r.quotaMb} Mo <Badge>{SOURCE_LABEL[r.quotaSource]}</Badge>
                  </Td>
                  <Td>
                    {canManage && (
                      <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>
                        Ajuster
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
      <QuotaEditor
        organization={editing?.organization ?? null}
        field="storageMb"
        label="Stockage (Mo)"
        current={editing?.quotaMb ?? 0}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          storage.reload();
        }}
      />
    </>
  );
}

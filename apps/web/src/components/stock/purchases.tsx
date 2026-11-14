'use client';

import { useState } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ApiErrorAlert } from '@/components/ui/states';
import { type ApiError, api, apiUpload } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { useApi } from '@/lib/use-api';
import { asApiError } from './stock-types';

/** Couleur du badge d'état d'une commande fournisseur. */
export const purchaseTone = (status: string) =>
  status === 'RECEIVED'
    ? ('forest' as const)
    : status === 'CANCELLED' || status === 'CLOSED'
      ? ('neutral' as const)
      : ('savanna' as const);

interface DocumentView {
  id: string;
  fileName: string;
  mimeType: string;
  bytes: number;
}

/** Documents joints (bon de livraison, facture fournisseur, photo) : PDF, JPEG, PNG. */
export function Documents({
  ownerType,
  ownerId,
  canAdd,
  canRemove,
  canOpen,
}: {
  ownerType: 'PURCHASE_ORDER' | 'RECEIPT' | 'SUPPLIER_RETURN';
  ownerId: string;
  canAdd: boolean;
  canRemove: boolean;
  /** Ouvrir un document exige de voir les prix d'achat (factures et bons fournisseurs). */
  canOpen: boolean;
}) {
  const docs = useApi<DocumentView[]>(`/ocall-stock/documents/${ownerType}/${ownerId}`);
  const [error, setError] = useState<ApiError | null>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      await apiUpload(`/ocall-stock/documents/${ownerType}/${ownerId}`, form);
      docs.reload();
    } catch (e) {
      setError(asApiError(e));
    }
  }

  return (
    <Card>
      <CardHeader
        title="Documents"
        description="Bon de livraison, facture du fournisseur, photo (PDF, JPEG, PNG, 10 Mo au plus)."
      />
      <CardBody className="space-y-3" data-testid="stock-documents">
        <ApiErrorAlert error={error} />
        {docs.state === 'success' && docs.data.length === 0 && (
          <p className="text-sm text-muted">Aucun document.</p>
        )}
        {docs.state === 'success' && (
          <ul className="space-y-1 text-sm">
            {docs.data.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3">
                {canOpen ? (
                  <button
                    type="button"
                    className="text-forest hover:underline"
                    onClick={() => void downloadFile(`/ocall-stock/documents/${d.id}`, d.fileName)}
                  >
                    {d.fileName}
                  </button>
                ) : (
                  <span>{d.fileName}</span>
                )}
                <span className="text-xs text-muted">{Math.ceil(d.bytes / 1024)} Ko</span>
                {canRemove && (
                  <button
                    type="button"
                    className="text-xs text-terracotta hover:underline"
                    onClick={async () => {
                      try {
                        await api(`/ocall-stock/documents/${d.id}`, { method: 'DELETE' });
                        docs.reload();
                      } catch (e) {
                        setError(asApiError(e));
                      }
                    }}
                  >
                    Retirer
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canAdd && (
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-forest">
            Joindre un document
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              className="sr-only"
              onChange={(e) => void upload(e.target.files?.[0])}
            />
          </label>
        )}
      </CardBody>
    </Card>
  );
}

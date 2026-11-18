'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ApiError } from '@/lib/api';
import { downloadFile } from '@/lib/download';

/**
 * Téléchargement d'un document Ocall (facture ou reçu d'abonnement) produit à la demande par l'API.
 * L'erreur éventuelle s'affiche sous le bouton.
 */
export function PdfDownloadButton({
  path,
  fileName,
  label,
  testId,
}: {
  path: string;
  fileName: string;
  label: string;
  testId?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setLoading(true);
    setError(null);
    try {
      await downloadFile(path, fileName);
    } catch (e) {
      setError((e as ApiError).message ?? 'Téléchargement impossible.');
    } finally {
      setLoading(false);
    }
  }
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant="secondary"
        icon={<Download className="h-4 w-4" />}
        loading={loading}
        onClick={() => void run()}
        data-testid={testId}
      >
        {label}
      </Button>
      {error && <span className="text-xs text-terracotta-dark">{error}</span>}
    </span>
  );
}

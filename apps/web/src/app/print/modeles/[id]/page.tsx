'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { PrintTemplateView } from '@/components/print/print-types';
import { TemplateEditor } from '@/components/print/template-editor';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

export default function PrintTemplatePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const list = useApi<PrintTemplateView[]>('/ocall-print/templates');
  const [current, setCurrent] = useState<PrintTemplateView | null>(null);
  if (list.state === 'loading') return <LoadingState />;
  if (list.state === 'error') return <ErrorState error={list.error} onRetry={list.reload} />;
  const template = current ?? list.data.find((t) => t.id === id);
  return (
    <>
      <PageHeader eyebrow="Ocall Print" title={template?.name ?? 'Modèle'} />
      {!template ? (
        <p className="text-sm text-muted">Modèle introuvable ou archivé.</p>
      ) : (
        <div className="space-y-4">
          <TemplateEditor
            key={template.id}
            basePath="/ocall-print/templates"
            template={template}
            canEdit
            onSaved={setCurrent}
          />
          <Button
            variant="ghost"
            onClick={async () => {
              await api(`/ocall-print/templates/${id}`, { method: 'DELETE' });
              router.push('/print/modeles');
            }}
          >
            Archiver ce modèle
          </Button>
        </div>
      )}
    </>
  );
}

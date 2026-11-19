'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { TemplateEditor } from '@/components/print/template-editor';
import type { PrintTemplateView } from '@/components/print/print-types';
import { SchoolCardsNav } from '@/components/school/school-cards-nav';
import { SchoolPage, type SchoolPageApi } from '@/components/school/school-page';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

function Editor({ id, page }: { id: string; page: SchoolPageApi }) {
  const router = useRouter();
  const list = useApi<PrintTemplateView[]>('/school/card-templates');
  const [current, setCurrent] = useState<PrintTemplateView | null>(null);
  if (list.state === 'loading') return <LoadingState />;
  if (list.state === 'error') return <ErrorState error={list.error} onRetry={list.reload} />;
  const template = current ?? list.data.find((t) => t.id === id);
  if (!template) return <p className="text-sm text-muted">Modèle introuvable ou archivé.</p>;
  const canEdit = page.forSchool(template.scopeId).canWrite('school.cards.manage');
  return (
    <div className="space-y-4">
      <TemplateEditor
        key={template.id}
        basePath="/school/card-templates"
        template={template}
        canEdit={canEdit}
        onSaved={setCurrent}
      />
      {canEdit && (
        <Button
          variant="ghost"
          onClick={async () => {
            await api(`/school/card-templates/${id}`, { method: 'DELETE' });
            router.push('/school/cartes/modeles');
          }}
        >
          Archiver ce modèle
        </Button>
      )}
    </div>
  );
}

export default function SchoolCardTemplatePage() {
  const { id } = useParams<{ id: string }>();
  return (
    <SchoolPage title={() => 'Modèle de carte'} needsSchool={false}>
      {(page) => (
        <div className="space-y-4">
          <SchoolCardsNav />
          <Editor id={id} page={page} />
        </div>
      )}
    </SchoolPage>
  );
}

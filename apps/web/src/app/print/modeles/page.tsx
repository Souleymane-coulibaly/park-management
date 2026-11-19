'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PRINT_CARD_KIND_LABELS } from '@ocall/shared';
import type { PrintTemplateView } from '@/components/print/print-types';
import { shortDate } from '@/components/print/print-ui';
import { NewTemplateForm } from '@/components/print/template-editor';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

export default function PrintTemplatesPage() {
  const router = useRouter();
  const templates = useApi<PrintTemplateView[]>('/ocall-print/templates');
  return (
    <>
      <PageHeader
        eyebrow="Ocall Print"
        title="Modèles de cartes"
        description="Recto verso, couleurs, logo et champs : le même moteur que pour Ocall School."
      />
      <div className="space-y-4">
        <Card>
          <CardHeader title="Nouveau modèle" />
          <CardBody>
            <NewTemplateForm
              onCreate={async (input) => {
                const t = await api<PrintTemplateView>('/ocall-print/templates', {
                  method: 'POST',
                  body: input,
                });
                router.push(`/print/modeles/${t.id}`);
              }}
            />
          </CardBody>
        </Card>
        {templates.state === 'loading' && <LoadingState />}
        {templates.state === 'error' && (
          <ErrorState error={templates.error} onRetry={templates.reload} />
        )}
        {templates.state === 'success' && (
          <Card>
            {templates.data.length === 0 ? (
              <EmptyState
                icon={<span aria-hidden>🎨</span>}
                title="Aucun modèle"
                description="Créez un modèle de carte ou de badge."
              />
            ) : (
              <Table head={['Modèle', 'Type', 'Version', 'Modifié le']}>
                {templates.data.map((t) => (
                  <tr key={t.id} data-testid="print-template-row">
                    <Td>
                      <Link
                        href={`/print/modeles/${t.id}`}
                        className="font-semibold text-forest hover:underline"
                      >
                        {t.name}
                      </Link>
                    </Td>
                    <Td>{PRINT_CARD_KIND_LABELS[t.kind]}</Td>
                    <Td>v{t.currentVersion}</Td>
                    <Td>{shortDate(t.updatedAt)}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        )}
      </div>
    </>
  );
}

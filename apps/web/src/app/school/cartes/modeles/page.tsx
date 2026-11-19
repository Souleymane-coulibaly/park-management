'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PRINT_CARD_KIND_LABELS } from '@ocall/shared';
import { NewTemplateForm } from '@/components/print/template-editor';
import type { PrintTemplateView } from '@/components/print/print-types';
import { shortDate } from '@/components/print/print-ui';
import { SchoolCardsNav } from '@/components/school/school-cards-nav';
import { SchoolPage, type SchoolPageApi } from '@/components/school/school-page';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

function Templates({ page }: { page: SchoolPageApi }) {
  const router = useRouter();
  const schoolId = page.school!.id;
  const templates = useApi<PrintTemplateView[]>(`/school/card-templates?schoolId=${schoolId}`);
  const canManage = page.canWrite('school.cards.manage');
  return (
    <div className="space-y-4">
      {canManage && (
        <Card>
          <CardHeader
            title="Nouveau modèle"
            description="Mise en page par défaut, personnalisable ensuite (recto verso, couleurs, logo, champs)."
          />
          <CardBody>
            <NewTemplateForm
              onCreate={async (input) => {
                const t = await api<PrintTemplateView>('/school/card-templates', {
                  method: 'POST',
                  body: { ...input, schoolId },
                });
                router.push(`/school/cartes/modeles/${t.id}`);
              }}
            />
          </CardBody>
        </Card>
      )}
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
              description="Créez un modèle de carte scolaire et un modèle de badge."
            />
          ) : (
            <Table head={['Modèle', 'Type', 'Version', 'Modifié le']}>
              {templates.data.map((t) => (
                <tr key={t.id} data-testid="print-template-row">
                  <Td>
                    <Link
                      href={`/school/cartes/modeles/${t.id}`}
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
  );
}

export default function SchoolCardTemplatesPage() {
  return (
    <SchoolPage
      title={() => 'Modèles de cartes'}
      description={() => 'Cartes scolaires et badges du personnel, par établissement.'}
    >
      {(page) => (
        <div className="space-y-4">
          <SchoolCardsNav />
          {page.school && <Templates key={page.school.id} page={page} />}
        </div>
      )}
    </SchoolPage>
  );
}

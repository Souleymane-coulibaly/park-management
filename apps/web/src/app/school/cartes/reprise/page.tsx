'use client';

import { useState } from 'react';
import { PRINT_CARD_KIND_LABELS, type PrintCardKind } from '@ocall/shared';
import { SchoolCardsNav } from '@/components/school/school-cards-nav';
import { SchoolPage, type SchoolPageApi } from '@/components/school/school-page';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface Candidate {
  id: string;
  kind: PrintCardKind;
  lastName: string;
  firstName: string;
  birthDate: string | null;
  hasPhoto: boolean;
  activeCardNumber: string | null;
  match: { id: string; schoolId: string; linked: boolean } | null;
}

type Outcome = { personId: string; status: 'CREATED' | 'LINKED' | 'SKIPPED'; reason?: string };

function Import({ page }: { page: SchoolPageApi }) {
  const candidates = useApi<Candidate[]>('/school/print-import');
  const [selection, setSelection] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  if (candidates.state === 'loading') return <LoadingState />;
  if (candidates.state === 'error')
    return <ErrorState error={candidates.error} onRetry={candidates.reload} />;
  const list = candidates.data;
  const count = (s: Outcome['status']) => outcomes?.filter((o) => o.status === s).length ?? 0;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setOutcomes(
        await api<Outcome[]>('/school/print-import', {
          method: 'POST',
          body: { schoolId: page.school!.id, personIds: selection },
        }),
      );
      setSelection([]);
      candidates.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Erreur réseau.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={`Fiches à reprendre dans « ${page.school?.name ?? ''} »`}
        description="Élèves et personnel saisis dans Ocall Print avant l’activation de School : repris avec leur photo, sans doublon ; leurs cartes restent valables (aucune réimpression)."
        action={
          <Button
            disabled={
              selection.length === 0 || !page.school || !page.canWrite('school.cards.manage')
            }
            loading={busy}
            data-testid="print-import-run"
            onClick={() => void run()}
          >
            Reprendre ({selection.length})
          </Button>
        }
      />
      <CardBody className="space-y-4">
        <ApiErrorAlert error={error} />
        {outcomes && (
          <Alert tone="success">
            {`${count('CREATED')} créée(s), ${count('LINKED')} rattachée(s), ${count('SKIPPED')} non reprise(s).`}
            {outcomes
              .filter((o) => o.status === 'SKIPPED' && o.reason)
              .map((o) => ` ${o.reason}`)
              .join('')}
          </Alert>
        )}
        {list.length === 0 ? (
          <EmptyState
            icon={<span aria-hidden>✅</span>}
            title="Rien à reprendre"
            description="Aucune fiche Ocall Print en attente de reprise."
          />
        ) : (
          <Table head={['', 'Nom', 'Type', 'Photo', 'Carte', 'Fiche School existante']}>
            {list.map((c) => (
              <tr key={c.id} data-testid="print-import-row">
                <Td>
                  <input
                    type="checkbox"
                    aria-label={`Reprendre ${c.lastName} ${c.firstName}`}
                    checked={selection.includes(c.id)}
                    onChange={() =>
                      setSelection((s) =>
                        s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id],
                      )
                    }
                    className="h-4 w-4 accent-forest"
                  />
                </Td>
                <Td>{`${c.lastName.toUpperCase()} ${c.firstName}`}</Td>
                <Td>{PRINT_CARD_KIND_LABELS[c.kind]}</Td>
                <Td>{c.hasPhoto ? 'Oui' : 'Non'}</Td>
                <Td className="font-mono text-xs">{c.activeCardNumber ?? '—'}</Td>
                <Td>
                  {c.match
                    ? 'Oui : rattachement sans doublon'
                    : c.kind === 'STUDENT' && !c.birthDate
                      ? 'Date de naissance manquante'
                      : 'Non : fiche créée'}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </CardBody>
    </Card>
  );
}

export default function SchoolPrintImportPage() {
  return (
    <SchoolPage
      title={() => 'Reprise des fiches Ocall Print'}
      description={() =>
        'Activation de School après un usage autonome d’Ocall Print. Réservée à la direction du groupe.'
      }
    >
      {(page) => (
        <div className="space-y-4">
          <SchoolCardsNav />
          <Import page={page} />
        </div>
      )}
    </SchoolPage>
  );
}

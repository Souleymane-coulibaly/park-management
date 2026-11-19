'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PRINT_CARD_KIND_LABELS, type PrintCardKind } from '@ocall/shared';
import { OrderDialog } from '@/components/print/print-orders';
import type {
  CardSides,
  PrintCardView,
  PrintSettingsView,
  PrintTemplateView,
} from '@/components/print/print-types';
import { CardPreview, CardStatusBadge } from '@/components/print/print-ui';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField, SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { ApiError, api, apiUpload } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface PersonView {
  id: string;
  kind: PrintCardKind;
  lastName: string;
  firstName: string;
  reference: string | null;
  groupLabel: string | null;
  jobTitle: string | null;
  birthDate: string | null;
  hasPhoto: boolean;
  card: PrintCardView | null;
}

const asError = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion au serveur impossible.');

function PersonDialog({
  kind,
  onClose,
  onDone,
}: {
  kind: PrintCardKind;
  onClose: () => void;
  onDone: () => void;
}) {
  const [f, setF] = useState({
    lastName: '',
    firstName: '',
    reference: '',
    groupLabel: '',
    jobTitle: '',
    birthDate: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Dialog
      open
      onClose={onClose}
      title={kind === 'STUDENT' ? 'Nouvel élève' : 'Nouveau membre du personnel'}
    >
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api('/ocall-print/persons', {
              method: 'POST',
              body: {
                kind,
                lastName: f.lastName,
                firstName: f.firstName,
                reference: f.reference || null,
                groupLabel: f.groupLabel || null,
                jobTitle: kind === 'STAFF' ? f.jobTitle || null : null,
                birthDate: f.birthDate || null,
              },
            });
            onDone();
          } catch (err) {
            setError(asError(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <InputField
            label="Nom"
            required
            value={f.lastName}
            maxLength={80}
            onChange={set('lastName')}
          />
          <InputField
            label="Prénom"
            required
            value={f.firstName}
            maxLength={80}
            onChange={set('firstName')}
          />
          <InputField
            label={kind === 'STUDENT' ? 'Matricule' : 'N° personnel'}
            value={f.reference}
            maxLength={40}
            onChange={set('reference')}
          />
          <InputField
            label={kind === 'STUDENT' ? 'Classe' : 'Service'}
            value={f.groupLabel}
            maxLength={60}
            onChange={set('groupLabel')}
          />
          {kind === 'STAFF' && (
            <InputField
              label="Fonction"
              value={f.jobTitle}
              maxLength={80}
              onChange={set('jobTitle')}
            />
          )}
          <InputField
            label="Date de naissance"
            type="date"
            value={f.birthDate}
            onChange={set('birthDate')}
          />
        </div>
        <ApiErrorAlert error={error} />
        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" loading={busy} data-testid="print-person-save">
            Enregistrer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function PreviewDialog({
  card,
  templates,
  onClose,
}: {
  card: PrintCardView;
  templates: PrintTemplateView[];
  onClose: () => void;
}) {
  const usable = templates.filter((t) => t.kind === card.holderKind);
  const [templateId, setTemplateId] = useState(usable[0]?.id ?? '');
  const preview = useApi<CardSides>(
    templateId ? `/ocall-print/cards/${card.id}/preview?templateId=${templateId}` : null,
  );
  return (
    <Dialog open onClose={onClose} title="Aperçu de la carte" description={`N° ${card.cardNumber}`}>
      <div className="space-y-4">
        {usable.length === 0 && (
          <Alert tone="info">Créez d’abord un modèle pour ce type de carte.</Alert>
        )}
        {usable.length > 1 && (
          <SelectField
            label="Modèle"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            options={usable.map((t) => ({ value: t.id, label: t.name }))}
          />
        )}
        {templateId && preview.state === 'loading' && <LoadingState />}
        {templateId && preview.state === 'error' && (
          <ErrorState error={preview.error} onRetry={preview.reload} />
        )}
        {templateId && preview.state === 'success' && <CardPreview sides={preview.data} compact />}
      </div>
    </Dialog>
  );
}

export default function PrintPersonsPage() {
  const router = useRouter();
  const [kind, setKind] = useState<PrintCardKind>('STUDENT');
  const [q, setQ] = useState('');
  const persons = useApi<PersonView[]>(
    `/ocall-print/persons?kind=${kind}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
  );
  const templates = useApi<PrintTemplateView[]>('/ocall-print/templates');
  const settings = useApi<PrintSettingsView>('/ocall-print/settings');
  const [creating, setCreating] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [preview, setPreview] = useState<PrintCardView | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [version, setVersion] = useState(0);
  const list = persons.state === 'success' ? persons.data : [];
  const selected = list.filter((p) => selection.includes(p.id));
  const orderable = selected
    .map((p) => p.card)
    .filter((c): c is PrintCardView =>
      Boolean(
        c && (!c.print || c.print.itemStatus === 'REJECTED' || c.print.itemStatus === 'CANCELLED'),
      ),
    );

  async function act(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      persons.reload();
      setVersion((v) => v + 1);
    } catch (e) {
      setError(asError(e));
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Ocall Print"
        title="Fiches et cartes"
        description="Élèves ou personnel, photo obligatoire pour commander. Les photos sont réencodées, sans métadonnées."
        action={
          <Button onClick={() => setCreating(true)} data-testid="print-person-new">
            Nouvelle fiche
          </Button>
        }
      />
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-56">
            <SelectField
              label="Type"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as PrintCardKind);
                setSelection([]);
              }}
              options={[
                { value: 'STUDENT', label: 'Élèves' },
                { value: 'STAFF', label: 'Personnel' },
              ]}
            />
          </div>
          <div className="w-full sm:w-64">
            <InputField label="Rechercher" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Button
            variant="secondary"
            disabled={selection.length === 0}
            data-testid="print-issue-cards"
            onClick={() =>
              void act(() =>
                api('/ocall-print/cards', { method: 'POST', body: { personIds: selection } }),
              )
            }
          >
            Créer les cartes ({selection.length})
          </Button>
          <Button
            disabled={orderable.length === 0}
            onClick={() => setOrderOpen(true)}
            data-testid="print-order-open"
          >
            Commander ({orderable.length})
          </Button>
        </div>
        <ApiErrorAlert error={error} />
        {persons.state === 'loading' && <LoadingState />}
        {persons.state === 'error' && <ErrorState error={persons.error} onRetry={persons.reload} />}
        {persons.state === 'success' && (
          <Card>
            {list.length === 0 ? (
              <EmptyState
                icon={<span aria-hidden>🪪</span>}
                title="Aucune fiche"
                description="Ajoutez une première fiche pour préparer sa carte."
              />
            ) : (
              <Table
                head={['', 'Photo', 'Nom', kind === 'STUDENT' ? 'Classe' : 'Fonction', 'Carte', '']}
              >
                {list.map((p) => (
                  <tr key={p.id} data-testid="print-person-row">
                    <Td>
                      <input
                        type="checkbox"
                        aria-label={`Sélectionner ${p.lastName}`}
                        checked={selection.includes(p.id)}
                        onChange={() =>
                          setSelection((s) =>
                            s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id],
                          )
                        }
                        className="h-4 w-4 accent-forest"
                      />
                    </Td>
                    <Td>
                      {p.hasPhoto ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/v1/ocall-print/persons/${p.id}/photo?v=${version}`}
                          alt=""
                          className="h-12 w-9 rounded object-cover"
                        />
                      ) : (
                        <span className="text-xs text-terracotta-dark">Manquante</span>
                      )}
                    </Td>
                    <Td>
                      {`${p.lastName.toUpperCase()} ${p.firstName}`}
                      {p.reference && (
                        <span className="ml-2 font-mono text-xs text-muted">{p.reference}</span>
                      )}
                    </Td>
                    <Td>{kind === 'STUDENT' ? (p.groupLabel ?? '—') : (p.jobTitle ?? '—')}</Td>
                    <Td>
                      {p.card ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <CardStatusBadge status={p.card.status} />
                          <span className="font-mono text-xs">{p.card.cardNumber}</span>
                          {p.card.print && (
                            <span className="text-xs text-muted">{p.card.print.orderNumber}</span>
                          )}
                        </span>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap justify-end gap-1">
                        <label className="relative cursor-pointer rounded-lg px-2 py-1 text-sm font-medium hover:bg-ivory-dark/60">
                          Photo
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="sr-only"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              const form = new FormData();
                              form.append('file', file);
                              void act(() =>
                                apiUpload(`/ocall-print/persons/${p.id}/photo`, form, 'PUT'),
                              );
                            }}
                          />
                        </label>
                        {p.card && templates.state === 'success' && (
                          <Button size="sm" variant="ghost" onClick={() => setPreview(p.card)}>
                            Aperçu
                          </Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        )}
      </div>
      {creating && (
        <PersonDialog
          kind={kind}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            persons.reload();
          }}
        />
      )}
      {preview && templates.state === 'success' && (
        <PreviewDialog card={preview} templates={templates.data} onClose={() => setPreview(null)} />
      )}
      {orderOpen && templates.state === 'success' && settings.state === 'success' && (
        <OrderDialog
          open
          onClose={() => setOrderOpen(false)}
          submitPath="/ocall-print/orders"
          cardIds={orderable.map((c) => c.id)}
          kind={kind}
          templates={templates.data}
          unitPrice={settings.data.unitPrice}
          defaults={{ address: '', contactName: '', contactPhone: '' }}
          onDone={(o) => router.push(`/print/commandes/${o.id}`)}
        />
      )}
      <p className="mt-4 text-xs text-muted">
        {PRINT_CARD_KIND_LABELS[kind]} : photo au moins 200 × 240 pixels.
      </p>
    </>
  );
}

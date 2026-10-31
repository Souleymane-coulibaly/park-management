'use client';

import { type FormEvent, useState } from 'react';
import Link from 'next/link';
import { LifeBuoy, Plus } from 'lucide-react';
import {
  SUPPORT_ATTACHMENTS_PER_MESSAGE,
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_CATEGORY_LABELS,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_PRIORITY_LABELS,
  SUPPORT_TICKET_STATUS_LABELS,
} from '@ocall/shared';
import { STATUS_TONE } from '@/components/support/ticket-thread';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField, SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { ApiError, apiUpload } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { Establishment, SupportTicketView } from '@/lib/types';
import { useApi } from '@/lib/use-api';

/** Demandes d'assistance à l'équipe Ocall : suivi dans l'application (aucun e-mail envoyé). */
export default function SupportPage() {
  const tickets = useApi<SupportTicketView[]>('/support/tickets');
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="Support Ocall"
        description="Une question, une panne, un souci d’abonnement ? Écrivez à l’équipe Ocall et suivez la réponse ici."
        action={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            Nouvelle demande
          </Button>
        }
      />
      <Card>
        {tickets.state === 'loading' && <LoadingState />}
        {tickets.state === 'error' && <ErrorState error={tickets.error} onRetry={tickets.reload} />}
        {tickets.state === 'success' &&
          (tickets.data.length === 0 ? (
            <EmptyState
              icon={<LifeBuoy className="h-7 w-7" />}
              title="Aucune demande"
              description="Vos demandes d’assistance apparaîtront ici."
            />
          ) : (
            <Table head={['Demande', 'Établissement', 'Statut', 'Dernier message']}>
              {tickets.data.map((t) => (
                <tr key={t.id} data-testid="support-ticket-row">
                  <Td>
                    <Link
                      href={`/app/support/${t.id}`}
                      className="font-semibold text-forest hover:underline"
                    >
                      {t.subject}
                    </Link>
                    <span className="block font-mono text-xs text-muted">{t.number}</span>
                  </Td>
                  <Td>{t.establishment?.name ?? '—'}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[t.status]}>
                      {SUPPORT_TICKET_STATUS_LABELS[t.status]}
                    </Badge>
                  </Td>
                  <Td>{formatDateTime(t.lastMessageAt)}</Td>
                </tr>
              ))}
            </Table>
          ))}
      </Card>
      <NewTicketDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          tickets.reload();
        }}
      />
    </>
  );
}

function NewTicketDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const establishments = useApi<Establishment[]>(open ? '/establishments' : null);
  const [form, setForm] = useState({
    subject: '',
    category: 'TECHNICAL',
    priority: 'NORMAL',
    establishmentId: '',
    body: '',
  });
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const data = new FormData();
    for (const [key, value] of Object.entries(form))
      if (value.trim()) data.append(key, value.trim());
    for (const f of files) data.append('files', f);
    try {
      await apiUpload('/support/tickets', data);
      setForm({
        subject: '',
        category: 'TECHNICAL',
        priority: 'NORMAL',
        establishmentId: '',
        body: '',
      });
      setFiles([]);
      onCreated();
    } catch (e) {
      setError(
        e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion au serveur impossible.'),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Nouvelle demande"
      description="Décrivez le problème : ce que vous faisiez, ce qui s’affiche, depuis quand."
    >
      <form onSubmit={submit} className="space-y-3">
        <InputField
          label="Objet"
          required
          maxLength={140}
          value={form.subject}
          onChange={(e) => setForm({ ...form, subject: e.target.value })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Catégorie"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            options={SUPPORT_TICKET_CATEGORIES.map((c) => ({
              value: c,
              label: SUPPORT_TICKET_CATEGORY_LABELS[c],
            }))}
          />
          <SelectField
            label="Urgence"
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
            options={SUPPORT_TICKET_PRIORITIES.map((p) => ({
              value: p,
              label: SUPPORT_TICKET_PRIORITY_LABELS[p],
            }))}
          />
        </div>
        {establishments.state === 'success' && establishments.data.length > 1 && (
          <SelectField
            label="Établissement concerné"
            value={form.establishmentId}
            onChange={(e) => setForm({ ...form, establishmentId: e.target.value })}
            options={[
              { value: '', label: 'Toute l’organisation' },
              ...establishments.data.map((e) => ({ value: e.id, label: e.name })),
            ]}
          />
        )}
        <label className="block text-sm font-medium">
          Description
          <textarea
            className="mt-1 block min-h-32 w-full rounded-xl border border-line px-3 py-2"
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            maxLength={5000}
            required
          />
        </label>
        <label className="block text-sm font-medium">
          Pièces jointes (photo, capture, PDF — {SUPPORT_ATTACHMENTS_PER_MESSAGE} au plus, 5 Mo
          chacune)
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="mt-1 block w-full text-sm"
            onChange={(e) =>
              setFiles(Array.from(e.target.files ?? []).slice(0, SUPPORT_ATTACHMENTS_PER_MESSAGE))
            }
          />
        </label>
        <ApiErrorAlert error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            type="submit"
            loading={saving}
            disabled={form.subject.trim().length < 4 || form.body.trim().length < 10}
          >
            Envoyer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

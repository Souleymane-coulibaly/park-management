'use client';

import { type FormEvent, useState } from 'react';
import { Lock, Paperclip, Send } from 'lucide-react';
import {
  SUPPORT_ATTACHMENTS_PER_MESSAGE,
  SUPPORT_TICKET_STATUSES,
  SUPPORT_TICKET_STATUS_LABELS,
  type SupportTicketStatus,
} from '@ocall/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/ui/field';
import { ApiErrorAlert } from '@/components/ui/states';
import { ApiError, apiUpload } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { SupportMessageView, SupportTicketView } from '@/lib/types';

export const STATUS_TONE: Record<
  SupportTicketStatus,
  'savanna' | 'forest' | 'terracotta' | 'neutral'
> = {
  OPEN: 'terracotta',
  IN_PROGRESS: 'savanna',
  WAITING_CUSTOMER: 'savanna',
  RESOLVED: 'forest',
  CLOSED: 'neutral',
};

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} Ko`;

function Message({ m, viewer }: { m: SupportMessageView; viewer: 'customer' | 'ocall' }) {
  const mine = viewer === 'ocall' ? m.fromOcall : !m.fromOcall;
  return (
    <li
      className={`rounded-2xl border px-4 py-3 ${
        m.internal
          ? 'border-savanna/60 bg-savanna-light/40'
          : mine
            ? 'border-forest/30 bg-forest-light/40'
            : 'border-line bg-surface'
      }`}
      data-testid="support-message"
    >
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="font-semibold text-charcoal">
          {m.fromOcall ? `${m.author} · Ocall` : m.author}
        </span>
        <span>{formatDateTime(m.createdAt)}</span>
        {m.internal && (
          <Badge tone="savanna">
            <Lock className="h-3 w-3" aria-hidden /> Note interne
          </Badge>
        )}
      </p>
      <p className="mt-2 whitespace-pre-wrap text-sm">{m.body}</p>
      {m.attachments.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {m.attachments.map((a) => (
            <li key={a.id}>
              {/* Lien temporaire signé : valable quelques minutes, à recharger ensuite. */}
              <a
                href={a.url}
                className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs font-medium text-forest hover:underline"
              >
                <Paperclip className="h-3 w-3" aria-hidden />
                {a.name} ({kb(a.bytes)})
              </a>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Fil d'une demande de support et formulaire de réponse (pièces jointes : images ou PDF, 5 Mo).
 * Côté Ocall : note interne possible et changement de statut avec la réponse.
 */
export function TicketThread({
  ticket,
  viewer,
  replyPath,
  onReplied,
}: {
  ticket: SupportTicketView;
  viewer: 'customer' | 'ocall';
  replyPath: string;
  onReplied: (t: SupportTicketView) => void;
}) {
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [internal, setInternal] = useState(false);
  const [status, setStatus] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const closed = viewer === 'customer' && ticket.status === 'CLOSED';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setError(null);
    const form = new FormData();
    form.append('body', body.trim());
    if (viewer === 'ocall') {
      if (internal) form.append('internal', 'true');
      if (status) form.append('status', status);
    }
    for (const f of files) form.append('files', f);
    try {
      onReplied(await apiUpload<SupportTicketView>(replyPath, form));
      setBody('');
      setFiles([]);
      setInternal(false);
      setStatus('');
    } catch (e) {
      setError(
        e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion au serveur impossible.'),
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      <ol className="space-y-3">
        {(ticket.messages ?? []).map((m) => (
          <Message key={m.id} m={m} viewer={viewer} />
        ))}
      </ol>
      {closed ? (
        <p className="text-sm text-muted">Demande fermée : créez une nouvelle demande si besoin.</p>
      ) : (
        <form onSubmit={submit} className="space-y-3 rounded-2xl border border-line p-4">
          <label className="block text-sm font-medium">
            {viewer === 'ocall' && internal
              ? 'Note interne (invisible du client)'
              : 'Votre réponse'}
            <textarea
              className="mt-1 block min-h-28 w-full rounded-xl border border-line px-3 py-2"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={5000}
              required
            />
          </label>
          <label className="block text-sm font-medium">
            Pièces jointes (images ou PDF, {SUPPORT_ATTACHMENTS_PER_MESSAGE} au plus, 5 Mo chacune)
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
          {viewer === 'ocall' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-forest"
                  checked={internal}
                  onChange={(e) => setInternal(e.target.checked)}
                />
                Note interne
              </label>
              <SelectField
                label="Statut après envoi"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                options={[
                  { value: '', label: internal ? 'Inchangé' : 'Automatique (attente du client)' },
                  ...SUPPORT_TICKET_STATUSES.map((s) => ({
                    value: s,
                    label: SUPPORT_TICKET_STATUS_LABELS[s],
                  })),
                ]}
              />
            </div>
          )}
          <ApiErrorAlert error={error} />
          <div className="flex justify-end">
            <Button
              type="submit"
              loading={sending}
              disabled={body.trim().length < 2}
              icon={<Send className="h-4 w-4" />}
            >
              Envoyer
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { Copy, Inbox } from 'lucide-react';
import {
  PARTNER_APPLICATION_STATUS_LABELS,
  PARTNER_TYPE_LABELS,
  PARTNER_TYPES,
  type PartnerApplicationStatus,
  type PartnerType,
} from '@ocall/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/use-api';

interface Application {
  id: string;
  number: string;
  type: PartnerType;
  firstName: string;
  lastName: string;
  company: string | null;
  email: string;
  phone: string;
  country: string;
  city: string;
  experience: string;
  targetSectors: string;
  motivation: string;
  status: PartnerApplicationStatus;
  decisionNote: string | null;
  createdAt: string;
  partner: { id: string; code: string; status: string } | null;
  invitation: { status: string; expiresAt: string } | null;
}
interface Page {
  items: Application[];
  total: number;
  page: number;
  pageSize: number;
}

const toError = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.');

/**
 * Super Admin — candidatures Ocall Partner (Sprint S3) : examen, approbation (vaut agrément) avec
 * invitation à usage unique à transmettre au candidat, refus motivé, réinvitation, anonymisation des
 * candidatures non retenues au-delà de la durée de conservation.
 */
export default function AdminPartnerApplicationsPage() {
  const [filters, setFilters] = useState({ status: 'PENDING', type: '', q: '', page: 0 });
  const query = new URLSearchParams({
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
    page: String(filters.page),
  }).toString();
  const list = useApi<Page>(`/platform/partner-applications?${query}`);
  const [link, setLink] = useState<{ path: string; emailSent: boolean } | null>(null);
  const [origin, setOrigin] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [purged, setPurged] = useState<number | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);

  async function purge() {
    setError(null);
    try {
      const r = await api<{ anonymized: number }>('/platform/partner-applications/purge', {
        method: 'POST',
      });
      setPurged(r.anonymized);
      list.reload();
    } catch (e) {
      setError(toError(e));
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Super Admin"
        title="Candidatures partenaires"
        description="Candidatures reçues depuis /devenir-partenaire. L’approbation vaut agrément : le candidat crée son compte avec le lien d’invitation (usage unique, 7 jours)."
        action={
          <Button size="sm" variant="secondary" onClick={() => void purge()}>
            Anonymiser les candidatures échues
          </Button>
        }
      />
      {purged !== null && (
        <div className="mb-4">
          <Alert tone="success" title={`${purged} candidature(s) anonymisée(s).`} />
        </div>
      )}
      <ApiErrorAlert error={error} />
      {link && (
        <div className="mb-4" data-testid="invitation-link">
          <Alert
            tone={link.emailSent ? 'success' : 'info'}
            title={
              link.emailSent
                ? 'Invitation envoyée par e-mail au candidat'
                : 'E-mail non envoyé : transmettez ce lien au candidat (affiché une seule fois)'
            }
          >
            {link.emailSent && (
              <p className="mt-1 text-sm">Lien de secours, affiché une seule fois :</p>
            )}
            <p className="mt-2 flex items-center gap-2 break-all font-mono text-sm">
              {origin}
              {link.path}
              <button
                type="button"
                className="shrink-0 rounded-lg p-1 hover:bg-white/50"
                aria-label="Copier le lien"
                onClick={() => void navigator.clipboard?.writeText(`${origin}${link.path}`)}
              >
                <Copy className="h-4 w-4" aria-hidden />
              </button>
            </p>
          </Alert>
        </div>
      )}
      <Card>
        <CardHeader title="Candidatures" />
        <div className="grid gap-3 border-b border-line/70 px-5 py-4 sm:grid-cols-3">
          <SelectField
            label="Statut"
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value, page: 0 })}
            options={[
              { value: '', label: 'Tous' },
              ...(['PENDING', 'APPROVED', 'REJECTED'] as const).map((s) => ({
                value: s,
                label: PARTNER_APPLICATION_STATUS_LABELS[s],
              })),
            ]}
          />
          <SelectField
            label="Type"
            value={filters.type}
            onChange={(e) => setFilters({ ...filters, type: e.target.value, page: 0 })}
            options={[
              { value: '', label: 'Tous' },
              ...PARTNER_TYPES.map((t) => ({ value: t, label: PARTNER_TYPE_LABELS[t] })),
            ]}
          />
          <InputField
            label="Rechercher"
            placeholder="Nom, entreprise, numéro"
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value, page: 0 })}
          />
        </div>
        {list.state === 'loading' && <LoadingState />}
        {list.state === 'error' && <ErrorState error={list.error} onRetry={list.reload} />}
        {list.state === 'success' &&
          (list.data.items.length === 0 ? (
            <CardBody>
              <EmptyState
                icon={<Inbox className="h-6 w-6" aria-hidden />}
                title="Aucune candidature"
                description="Les candidatures envoyées depuis la page publique apparaissent ici."
              />
            </CardBody>
          ) : (
            <ul className="divide-y divide-line/70" data-testid="partner-applications">
              {list.data.items.map((a) => (
                <ApplicationRow key={a.id} application={a} onLink={setLink} onDone={list.reload} />
              ))}
            </ul>
          ))}
        {list.state === 'success' && list.data.total > list.data.pageSize && (
          <div className="flex justify-between gap-2 px-5 py-3 text-sm">
            <span className="text-muted">{list.data.total} candidatures</span>
            <span className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={filters.page === 0}
                onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
              >
                Précédent
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={(filters.page + 1) * list.data.pageSize >= list.data.total}
                onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
              >
                Suivant
              </Button>
            </span>
          </div>
        )}
      </Card>
    </>
  );
}

function ApplicationRow({
  application: a,
  onLink,
  onDone,
}: {
  application: Application;
  onLink: (link: { path: string; emailSent: boolean }) => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function act(action: 'approve' | 'reject' | 'reinvite') {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ invitationPath?: string; emailSent?: boolean }>(
        `/platform/partner-applications/${a.id}/${action}`,
        {
          method: 'POST',
          body: action === 'reject' ? { reason: note } : action === 'approve' ? { note } : {},
        },
      );
      if (r.invitationPath) onLink({ path: r.invitationPath, emailSent: r.emailSent === true });
      onDone();
    } catch (e) {
      setError(toError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="space-y-2 px-5 py-4 text-sm" data-testid="partner-application">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">
            {a.firstName} {a.lastName}
            {a.company ? ` — ${a.company}` : ''}
          </p>
          <p className="text-muted">
            {a.number} · {PARTNER_TYPE_LABELS[a.type]} · {a.city}, {a.country} · reçue le{' '}
            {formatDate(a.createdAt)}
          </p>
          <p className="text-muted">
            {a.email} · {a.phone}
          </p>
        </div>
        <Badge
          tone={
            a.status === 'APPROVED' ? 'forest' : a.status === 'REJECTED' ? 'terracotta' : 'savanna'
          }
        >
          {PARTNER_APPLICATION_STATUS_LABELS[a.status]}
        </Badge>
      </div>
      <details>
        <summary className="cursor-pointer font-medium">Expérience, cibles, motivation</summary>
        <dl className="mt-2 space-y-2">
          <dt className="text-muted">Expérience commerciale</dt>
          <dd className="whitespace-pre-line">{a.experience}</dd>
          <dt className="text-muted">Secteurs ciblés</dt>
          <dd className="whitespace-pre-line">{a.targetSectors}</dd>
          <dt className="text-muted">Motivation</dt>
          <dd className="whitespace-pre-line">{a.motivation}</dd>
        </dl>
      </details>
      {a.status === 'PENDING' && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[14rem] flex-1">
            <InputField
              label="Note (motif obligatoire pour un refus, communiqué au candidat par e-mail)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <Button size="sm" disabled={busy} onClick={() => void act('approve')}>
            Approuver et inviter
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || note.trim().length < 3}
            onClick={() => void act('reject')}
          >
            Refuser
          </Button>
        </div>
      )}
      {a.status === 'APPROVED' && (
        <p className="flex flex-wrap items-center gap-2 text-muted">
          {a.partner
            ? `Compte créé · code ${a.partner.code}`
            : `Invitation : ${a.invitation?.status === 'PENDING' ? `valable jusqu’au ${formatDate(a.invitation.expiresAt)}` : (a.invitation?.status ?? 'aucune')}`}
          {!a.partner && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void act('reinvite')}
            >
              Nouvelle invitation
            </Button>
          )}
        </p>
      )}
      {a.status === 'REJECTED' && a.decisionNote && (
        <p className="text-muted">Motif : {a.decisionNote}</p>
      )}
      <ApiErrorAlert error={error} />
    </li>
  );
}

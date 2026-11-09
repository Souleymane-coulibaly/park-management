'use client';

import { type FormEvent, useState } from 'react';
import { History, Plus, UserPlus } from 'lucide-react';
import {
  PARTNER_SETTABLE_PROSPECT_STATUSES,
  PROSPECT_PIPELINE,
  PROSPECT_STATUS_LABELS,
  type ProspectStatus,
} from '@ocall/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField, SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/use-api';

interface ProspectRow {
  id: string;
  companyName: string;
  contactName: string;
  phone: string;
  email: string | null;
  country: string;
  city: string | null;
  status: ProspectStatus;
  notes: string | null;
  sector: string | null;
  nextFollowUpAt: string | null;
  protectedUntil: string;
  product: { slug: string; name: string } | null;
}
interface Page {
  items: ProspectRow[];
  total: number;
  page: number;
  pageSize: number;
}
interface ProspectEvent {
  type: string;
  fromStatus: ProspectStatus | null;
  toStatus: ProspectStatus | null;
  note: string | null;
  createdAt: string;
}
const EVENT_LABELS: Record<string, string> = {
  CREATED: 'Enregistré',
  STAGE_CHANGED: 'Étape modifiée',
  UPDATED: 'Mis à jour',
  DEMO_REQUESTED: 'Démonstration demandée',
  CONVERTED: 'Converti en client (Ocall)',
};

/**
 * Prospects du partenaire. Un prospect déjà suivi par un autre partenaire est refusé par le
 * serveur ; un prospect enregistré vous est réservé 90 jours (prolongeable par Ocall).
 */
export default function PartnerProspectsPage() {
  const [filters, setFilters] = useState({
    q: '',
    status: '',
    followUpDue: false,
    sort: 'createdAt',
    page: 0,
  });
  const query = new URLSearchParams({
    ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.followUpDue ? { followUpDue: 'true' } : {}),
    sort: filters.sort,
    order: filters.sort === 'companyName' || filters.sort === 'nextFollowUpAt' ? 'asc' : 'desc',
    page: String(filters.page),
  }).toString();
  const prospects = useApi<Page>(`/partner/prospects?${query}`);
  const [historyFor, setHistoryFor] = useState<ProspectRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [demoFor, setDemoFor] = useState<ProspectRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function setStatus(id: string, status: string) {
    setError(null);
    try {
      await api(`/partner/prospects/${id}`, { method: 'PATCH', body: { status } });
      prospects.reload();
    } catch (e) {
      setError(e as ApiError);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Portail partenaire"
        title="Prospects"
        description="Enregistrez vos prospects : ils vous sont réservés 90 jours. La conversion en client est confirmée par Ocall."
        action={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            Nouveau prospect
          </Button>
        }
      />
      {notice && (
        <div className="mb-4">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}
      <ApiErrorAlert error={error} />
      <Card>
        <CardHeader title="Mes prospects" />
        <div className="grid gap-3 border-b border-line/70 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <InputField
            label="Rechercher"
            placeholder="Entreprise, contact, ville, secteur"
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value, page: 0 })}
          />
          <SelectField
            label="Étape"
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value, page: 0 })}
            options={[
              { value: '', label: 'Toutes' },
              ...PROSPECT_PIPELINE.map((s) => ({ value: s, label: PROSPECT_STATUS_LABELS[s] })),
            ]}
          />
          <SelectField
            label="Trier par"
            value={filters.sort}
            onChange={(e) => setFilters({ ...filters, sort: e.target.value, page: 0 })}
            options={[
              { value: 'createdAt', label: 'Plus récents' },
              { value: 'nextFollowUpAt', label: 'Prochaine relance' },
              { value: 'updatedAt', label: 'Dernière mise à jour' },
              { value: 'companyName', label: 'Nom' },
            ]}
          />
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5 accent-forest"
              checked={filters.followUpDue}
              onChange={(e) => setFilters({ ...filters, followUpDue: e.target.checked, page: 0 })}
            />
            Relances dues
          </label>
        </div>
        {prospects.state === 'loading' && <LoadingState />}
        {prospects.state === 'error' && (
          <ErrorState error={prospects.error} onRetry={prospects.reload} />
        )}
        {prospects.state === 'success' &&
          (prospects.data.items.length === 0 ? (
            <EmptyState
              icon={<UserPlus className="h-7 w-7" />}
              title="Aucun prospect"
              description="Aucun prospect ne correspond, ou enregistrez votre premier prospect."
            />
          ) : (
            <Table head={['Entreprise', 'Contact', 'Produit', 'Prochaine relance', 'Étape', '']}>
              {prospects.data.items.map((p) => (
                <tr key={p.id}>
                  <Td className="font-medium">
                    {p.companyName}
                    <span className="block text-xs text-muted">
                      {[p.sector, p.city, p.country].filter(Boolean).join(' · ')}
                    </span>
                  </Td>
                  <Td>
                    {p.contactName}
                    <span className="block text-xs text-muted">
                      {p.phone}
                      {p.email ? ` · ${p.email}` : ''}
                    </span>
                  </Td>
                  <Td>{p.product?.name ?? '—'}</Td>
                  <Td>
                    {p.nextFollowUpAt ? formatDate(p.nextFollowUpAt) : '—'}
                    <span className="block text-xs text-muted">
                      réservé jusqu’au {formatDate(p.protectedUntil)}
                    </span>
                  </Td>
                  <Td>
                    {p.status === 'WON' ? (
                      <Badge tone="forest">{PROSPECT_STATUS_LABELS.WON}</Badge>
                    ) : (
                      <SelectField
                        label="Statut"
                        value={p.status}
                        onChange={(e) => setStatus(p.id, e.target.value)}
                        options={PARTNER_SETTABLE_PROSPECT_STATUSES.map((s) => ({
                          value: s,
                          label: PROSPECT_STATUS_LABELS[s],
                        }))}
                      />
                    )}
                  </Td>
                  <Td className="space-y-1">
                    {p.status !== 'WON' && p.status !== 'LOST' && (
                      <Button size="sm" variant="secondary" onClick={() => setDemoFor(p)}>
                        Demander une démo
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<History className="h-4 w-4" />}
                      onClick={() => setHistoryFor(p)}
                    >
                      Historique
                    </Button>
                  </Td>
                </tr>
              ))}
            </Table>
          ))}
        {prospects.state === 'success' && prospects.data.total > prospects.data.pageSize && (
          <div className="flex items-center justify-between gap-2 px-5 py-3 text-sm">
            <span className="text-muted">
              {prospects.data.total} prospects · page {prospects.data.page + 1}
            </span>
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
                disabled={(filters.page + 1) * prospects.data.pageSize >= prospects.data.total}
                onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
              >
                Suivant
              </Button>
            </span>
          </div>
        )}
      </Card>
      {historyFor && <HistoryDialog prospect={historyFor} onClose={() => setHistoryFor(null)} />}
      {creating && (
        <CreateProspectDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            setNotice('Prospect enregistré : il vous est réservé 90 jours.');
            prospects.reload();
          }}
        />
      )}
      {demoFor && (
        <DemoDialog
          prospect={demoFor}
          onClose={() => setDemoFor(null)}
          onDone={() => {
            setDemoFor(null);
            setNotice('Demande de démonstration transmise à Ocall.');
            prospects.reload();
          }}
        />
      )}
    </>
  );
}

function CreateProspectDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const products = useApi<{ slug: string; name: string }[]>('/partner/products');
  const [form, setForm] = useState({
    companyName: '',
    contactName: '',
    phone: '',
    email: '',
    country: 'Mali',
    city: '',
    product: '',
    notes: '',
    sector: '',
    nextFollowUpAt: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api('/partner/prospects', {
        method: 'POST',
        body: {
          companyName: form.companyName,
          contactName: form.contactName,
          phone: form.phone,
          country: form.country,
          ...(form.email.trim() ? { email: form.email.trim() } : {}),
          ...(form.city.trim() ? { city: form.city.trim() } : {}),
          ...(form.product ? { product: form.product } : {}),
          ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
          ...(form.sector.trim() ? { sector: form.sector.trim() } : {}),
          ...(form.nextFollowUpAt ? { nextFollowUpAt: form.nextFollowUpAt } : {}),
        },
      });
      onCreated();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Nouveau prospect"
      description="Le serveur vérifie qu’il n’est pas déjà suivi par un autre partenaire."
    >
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <InputField
            label="Entreprise"
            required
            value={form.companyName}
            onChange={(e) => setForm({ ...form, companyName: e.target.value })}
          />
          <InputField
            label="Contact"
            required
            value={form.contactName}
            onChange={(e) => setForm({ ...form, contactName: e.target.value })}
          />
          <InputField
            label="Téléphone"
            type="tel"
            required
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <InputField
            label="E-mail"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <InputField
            label="Pays"
            required
            value={form.country}
            onChange={(e) => setForm({ ...form, country: e.target.value })}
          />
          <InputField
            label="Ville"
            value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
          />
          <InputField
            label="Secteur d’activité"
            value={form.sector}
            onChange={(e) => setForm({ ...form, sector: e.target.value })}
          />
          <InputField
            label="Prochaine relance"
            type="date"
            value={form.nextFollowUpAt}
            onChange={(e) => setForm({ ...form, nextFollowUpAt: e.target.value })}
          />
        </div>
        {products.state === 'success' && (
          <SelectField
            label="Produit visé"
            value={form.product}
            onChange={(e) => setForm({ ...form, product: e.target.value })}
            options={[
              { value: '', label: 'À définir' },
              ...products.data.map((p) => ({ value: p.slug, label: p.name })),
            ]}
          />
        )}
        <InputField
          label="Notes"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
        <ApiErrorAlert error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" loading={saving}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DemoDialog({
  prospect,
  onClose,
  onDone,
}: {
  prospect: ProspectRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api(`/partner/prospects/${prospect.id}/demo`, { method: 'POST', body: { message } });
      onDone();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Démonstration — ${prospect.companyName}`}
      description="Ocall organise la démonstration et vous tient informé."
    >
      <form onSubmit={submit} className="space-y-3">
        <InputField
          label="Besoins du prospect"
          required
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <ApiErrorAlert error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" loading={saving} disabled={message.trim().length < 10}>
            Envoyer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function HistoryDialog({ prospect, onClose }: { prospect: ProspectRow; onClose: () => void }) {
  const events = useApi<ProspectEvent[]>(`/partner/prospects/${prospect.id}/history`);
  return (
    <Dialog open onClose={onClose} title={`Historique — ${prospect.companyName}`}>
      {events.state === 'loading' && <LoadingState />}
      {events.state === 'error' && <ErrorState error={events.error} onRetry={events.reload} />}
      {events.state === 'success' && (
        <ul className="space-y-2 text-sm" data-testid="prospect-history">
          {events.data.map((e, i) => (
            <li key={i} className="rounded-xl border border-line/70 px-3 py-2">
              <span className="font-semibold">{EVENT_LABELS[e.type] ?? e.type}</span>
              {e.toStatus && (
                <span className="text-muted">
                  {' '}
                  — {e.fromStatus ? `${PROSPECT_STATUS_LABELS[e.fromStatus]} → ` : ''}
                  {PROSPECT_STATUS_LABELS[e.toStatus]}
                </span>
              )}
              <span className="block text-xs text-muted">{formatDate(e.createdAt)}</span>
              {e.note && <span className="block">{e.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

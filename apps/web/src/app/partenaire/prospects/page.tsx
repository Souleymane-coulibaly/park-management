'use client';

import { type FormEvent, useState } from 'react';
import { Plus, UserPlus } from 'lucide-react';
import {
  PARTNER_SETTABLE_PROSPECT_STATUSES,
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
  protectedUntil: string;
  product: { slug: string; name: string } | null;
}

/**
 * Prospects du partenaire. Un prospect déjà suivi par un autre partenaire est refusé par le
 * serveur ; un prospect enregistré vous est réservé 90 jours (prolongeable par Ocall).
 */
export default function PartnerProspectsPage() {
  const prospects = useApi<ProspectRow[]>('/partner/prospects');
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
        {prospects.state === 'loading' && <LoadingState />}
        {prospects.state === 'error' && (
          <ErrorState error={prospects.error} onRetry={prospects.reload} />
        )}
        {prospects.state === 'success' &&
          (prospects.data.length === 0 ? (
            <EmptyState
              icon={<UserPlus className="h-7 w-7" />}
              title="Aucun prospect"
              description="Enregistrez votre premier prospect."
            />
          ) : (
            <Table head={['Entreprise', 'Contact', 'Produit', 'Réservé jusqu’au', 'Statut', '']}>
              {prospects.data.map((p) => (
                <tr key={p.id}>
                  <Td className="font-medium">
                    {p.companyName}
                    <span className="block text-xs text-muted">
                      {[p.city, p.country].filter(Boolean).join(', ')}
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
                  <Td>{formatDate(p.protectedUntil)}</Td>
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
                  <Td>
                    {p.status !== 'WON' && p.status !== 'LOST' && (
                      <Button size="sm" variant="secondary" onClick={() => setDemoFor(p)}>
                        Demander une démo
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          ))}
      </Card>
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

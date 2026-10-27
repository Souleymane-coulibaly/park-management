'use client';

import { type FormEvent, useState } from 'react';
import { Building2, MapPin, Pencil, Plus, Power } from 'lucide-react';
import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_LABELS,
  type BusinessType,
  isCompatibleBusinessType,
} from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan, useSession } from '@/components/app/session-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField, SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { ApiError, api } from '@/lib/api';
import type { Establishment } from '@/lib/types';
import { useApi } from '@/lib/use-api';

export default function EtablissementsPage() {
  const canRead = useCan('establishment.read');
  const canManage = useCan('establishment.manage');
  const list = useApi<Establishment[]>(canRead ? '/establishments' : null);
  const [editing, setEditing] = useState<Establishment | 'new' | null>(null);
  const [toggleError, setToggleError] = useState<ApiError | null>(null);

  if (!canRead) return <AccessDenied />;

  async function toggle(e: Establishment) {
    setToggleError(null);
    try {
      await api(`/establishments/${e.id}`, { method: 'PATCH', body: { isActive: !e.isActive } });
      list.reload();
    } catch (err) {
      setToggleError(err instanceof ApiError ? err : null);
    }
  }

  const addButton = canManage && (
    <Button onClick={() => setEditing('new')} icon={<Plus className="h-4 w-4" />}>
      Nouvel établissement
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Établissements"
        description="Les sites de votre organisation et leurs activités."
        action={addButton}
      />
      <div className="mb-4">
        <ApiErrorAlert error={toggleError} />
      </div>
      <Card>
        {list.state === 'loading' && <LoadingState />}
        {list.state === 'error' && <ErrorState error={list.error} onRetry={list.reload} />}
        {list.state === 'success' && list.data.length === 0 && (
          <EmptyState
            icon={<Building2 className="h-7 w-7" />}
            title="Aucun établissement"
            description="Ajoutez votre premier site pour y affecter votre équipe."
            action={addButton}
          />
        )}
        {list.state === 'success' && list.data.length > 0 && (
          <Table
            head={[
              'Établissement',
              'Activité',
              'Fuseau horaire',
              'Équipe',
              'Statut',
              canManage ? 'Actions' : '',
            ]}
          >
            {list.data.map((e) => (
              <tr key={e.id} className={e.isActive ? '' : 'opacity-60'}>
                <Td>
                  <p className="font-semibold">{e.name}</p>
                  {e.city && (
                    <p className="flex items-center gap-1 text-xs text-muted">
                      <MapPin className="h-3 w-3" aria-hidden /> {e.city}
                    </p>
                  )}
                </Td>
                <Td>{BUSINESS_TYPE_LABELS[e.businessType]}</Td>
                <Td className="text-muted">{e.timezone}</Td>
                <Td>{e._count.assignments}</Td>
                <Td>
                  {e.isActive ? <Badge tone="forest">Actif</Badge> : <Badge>Désactivé</Badge>}
                </Td>
                <Td>
                  {canManage && (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(e)}
                        icon={<Pencil className="h-4 w-4" />}
                        aria-label={`Modifier ${e.name}`}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggle(e)}
                        icon={<Power className="h-4 w-4" />}
                      >
                        {e.isActive ? 'Désactiver' : 'Réactiver'}
                      </Button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {editing && (
        <EstablishmentDialog
          establishment={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
          }}
        />
      )}
    </>
  );
}

function EstablishmentDialog({
  establishment,
  onClose,
  onSaved,
}: {
  establishment: Establishment | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const me = useSession();
  const orgType = me.organization!.businessType;
  const types = BUSINESS_TYPES.filter((t) => isCompatibleBusinessType(orgType, t));
  const [form, setForm] = useState({
    name: establishment?.name ?? '',
    businessType: (establishment?.businessType ?? orgType) as BusinessType,
    city: establishment?.city ?? '',
    address: establishment?.address ?? '',
    phone: establishment?.phone ?? '',
    timezone: establishment?.timezone ?? me.organization!.timezone,
  });
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const body = {
      ...form,
      city: form.city || undefined,
      address: form.address || undefined,
      phone: form.phone || undefined,
    };
    try {
      if (establishment)
        await api(`/establishments/${establishment.id}`, { method: 'PATCH', body });
      else await api('/establishments', { method: 'POST', body });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
      setLoading(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={establishment ? 'Modifier l’établissement' : 'Nouvel établissement'}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <ApiErrorAlert error={error} />
        <InputField label="Nom" value={form.name} onChange={set('name')} required />
        <SelectField
          label="Activité"
          value={form.businessType}
          onChange={set('businessType')}
          options={types.map((t) => ({ value: t, label: BUSINESS_TYPE_LABELS[t] }))}
          required
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <InputField label="Ville" value={form.city} onChange={set('city')} />
          <InputField label="Téléphone" type="tel" value={form.phone} onChange={set('phone')} />
        </div>
        <InputField label="Adresse" value={form.address} onChange={set('address')} />
        <InputField
          label="Fuseau horaire"
          value={form.timezone}
          onChange={set('timezone')}
          hint="Format IANA, par exemple Africa/Bamako."
          required
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" loading={loading}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

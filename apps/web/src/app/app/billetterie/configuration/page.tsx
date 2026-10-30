'use client';

import { type FormEvent, useState } from 'react';
import { CalendarX, Pencil, Plus, Ticket, Trash2 } from 'lucide-react';
import { TICKET_KINDS, TICKET_KIND_LABELS, type TicketKind, formatXof } from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { WEEKDAY_LABELS, describeOpening } from '@/components/park/opening';
import { ParkEstablishmentScope } from '@/components/park/park-establishment';
import { ParkNav } from '@/components/park/park-nav';
import { toApiError } from '@/components/pos/cash-session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { ParkEstablishment, ParkSchedule, TicketCategory } from '@/lib/types';
import { useApi } from '@/lib/use-api';

/** Configuration de la billetterie : tarifs, semaine type et dates particulières. */
export default function BilletterieConfigurationPage() {
  const canManage = useCan('ticketing.manage');
  if (!canManage) return <AccessDenied />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Tarifs et horaires du parc</h1>
        <ParkNav />
      </div>
      <ParkEstablishmentScope source="/ticketing/establishments">
        {(park) => (
          <>
            <Categories park={park} />
            <Schedule park={park} />
          </>
        )}
      </ParkEstablishmentScope>
    </div>
  );
}

// ─── Tarifs ───

function Categories({ park }: { park: ParkEstablishment }) {
  const categories = useApi<TicketCategory[]>(`/ticketing/categories?establishmentId=${park.id}`);
  const [editing, setEditing] = useState<TicketCategory | 'new' | null>(null);
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-line/70 px-4 py-3">
        <h2 className="font-semibold">Catégories de billets</h2>
        <Button size="sm" onClick={() => setEditing('new')} icon={<Plus className="h-4 w-4" />}>
          Nouvelle catégorie
        </Button>
      </div>
      {categories.state === 'loading' && <LoadingState />}
      {categories.state === 'error' && (
        <ErrorState error={categories.error} onRetry={categories.reload} />
      )}
      {categories.state === 'success' &&
        (categories.data.length === 0 ? (
          <EmptyState
            icon={<Ticket className="h-7 w-7" />}
            title="Aucun tarif"
            description="Créez au moins une catégorie (Adulte, Enfant, Famille…) pour vendre des billets."
          />
        ) : (
          <ul className="divide-y divide-line/70">
            {categories.data.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {c.name}{' '}
                    <span className="text-sm font-normal text-muted">
                      · {TICKET_KIND_LABELS[c.kind]}
                    </span>
                  </p>
                  <p className="text-sm text-muted">
                    {c.peopleIncluded > 1 ? `${c.peopleIncluded} personnes · ` : ''}
                    validité {c.validityDays} jour(s)
                    {c.availableFrom || c.availableUntil
                      ? ` · en vente ${c.availableFrom ? `du ${formatDate(c.availableFrom)}` : ''} ${c.availableUntil ? `au ${formatDate(c.availableUntil)}` : ''}`
                      : ''}
                    {c.conditions ? ` · ${c.conditions}` : ''}
                  </p>
                </div>
                <span className="font-display text-lg font-bold">{formatXof(c.price)}</span>
                {c.isActive ? <Badge tone="forest">Active</Badge> : <Badge>Désactivée</Badge>}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditing(c)}
                  icon={<Pencil className="h-4 w-4" />}
                >
                  Modifier
                </Button>
              </li>
            ))}
          </ul>
        ))}
      {editing && (
        <CategoryDialog
          park={park}
          category={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            categories.reload();
          }}
        />
      )}
    </Card>
  );
}

function CategoryDialog({
  park,
  category,
  onClose,
  onSaved,
}: {
  park: ParkEstablishment;
  category: TicketCategory | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    kind: (category?.kind ?? 'ADULT') as TicketKind,
    name: category?.name ?? '',
    price: category ? String(category.price) : '',
    peopleIncluded: String(category?.peopleIncluded ?? 1),
    validityDays: String(category?.validityDays ?? 1),
    conditions: category?.conditions ?? '',
    description: category?.description ?? '',
    availableFrom: category?.availableFrom ?? '',
    availableUntil: category?.availableUntil ?? '',
    sortOrder: String(category?.sortOrder ?? 0),
    isActive: category?.isActive ?? true,
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
      kind: form.kind,
      name: form.name,
      price: Number(form.price),
      peopleIncluded: Number(form.peopleIncluded),
      validityDays: Number(form.validityDays),
      conditions: form.conditions || (category ? null : undefined),
      description: form.description || (category ? null : undefined),
      availableFrom: form.availableFrom || (category ? null : undefined),
      availableUntil: form.availableUntil || (category ? null : undefined),
      sortOrder: Number(form.sortOrder),
    };
    try {
      if (category) {
        await api(`/ticketing/categories/${category.id}`, {
          method: 'PATCH',
          body: { ...body, isActive: form.isActive },
        });
      } else {
        await api('/ticketing/categories', {
          method: 'POST',
          body: { establishmentId: park.id, ...body },
        });
      }
      onSaved();
    } catch (e) {
      setError(toApiError(e));
      setLoading(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={category ? `Modifier « ${category.name} »` : 'Nouvelle catégorie de billet'}
      description="Un nouveau prix ne s’applique qu’aux ventes suivantes : les billets déjà émis gardent leur prix."
    >
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Type"
            value={form.kind}
            onChange={set('kind')}
            options={TICKET_KINDS.map((k) => ({ value: k, label: TICKET_KIND_LABELS[k] }))}
          />
          <InputField
            label="Nom"
            value={form.name}
            onChange={set('name')}
            required
            maxLength={60}
          />
          <InputField
            label="Prix (FCFA)"
            inputMode="numeric"
            value={form.price}
            onChange={set('price')}
            required
            pattern="[0-9]+"
          />
          <InputField
            label="Personnes incluses"
            hint="Famille de 4 = 4 billets"
            type="number"
            min={1}
            max={50}
            value={form.peopleIncluded}
            onChange={set('peopleIncluded')}
          />
          <InputField
            label="Validité (jours)"
            type="number"
            min={1}
            max={366}
            value={form.validityDays}
            onChange={set('validityDays')}
          />
          <InputField
            label="Ordre d’affichage"
            type="number"
            min={0}
            value={form.sortOrder}
            onChange={set('sortOrder')}
          />
          <InputField
            label="En vente à partir du"
            type="date"
            value={form.availableFrom}
            onChange={set('availableFrom')}
          />
          <InputField
            label="En vente jusqu’au"
            type="date"
            value={form.availableUntil}
            onChange={set('availableUntil')}
          />
        </div>
        <InputField
          label="Conditions"
          hint="Ex. moins de 12 ans"
          value={form.conditions}
          onChange={set('conditions')}
          maxLength={300}
        />
        <InputField
          label="Description"
          value={form.description}
          onChange={set('description')}
          maxLength={300}
        />
        {category && (
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              className="h-5 w-5 rounded border-line text-forest"
            />
            Catégorie active (en vente)
          </label>
        )}
        <ApiErrorAlert error={error} />
        <div className="flex justify-end gap-2">
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

// ─── Horaires ───

type DayForm = { enabled: boolean; isClosed: boolean; opensAt: string; closesAt: string };

function Schedule({ park }: { park: ParkEstablishment }) {
  const schedule = useApi<ParkSchedule>(`/ticketing/schedule?establishmentId=${park.id}`);
  if (schedule.state === 'loading') return <LoadingState />;
  if (schedule.state === 'error')
    return <ErrorState error={schedule.error} onRetry={schedule.reload} />;
  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 px-4 py-3">
          <h2 className="font-semibold">Horaires d’ouverture du parc</h2>
          <Badge tone={schedule.data.status.open ? 'forest' : 'terracotta'}>
            {describeOpening(schedule.data.status)}
          </Badge>
        </div>
        <WeeklyEditor park={park} schedule={schedule.data} onSaved={schedule.reload} />
      </Card>
      <Exceptions park={park} schedule={schedule.data} onChange={schedule.reload} />
    </>
  );
}

function WeeklyEditor({
  park,
  schedule,
  onSaved,
}: {
  park: ParkEstablishment;
  schedule: ParkSchedule;
  onSaved: () => void;
}) {
  const [days, setDays] = useState<DayForm[]>(() =>
    WEEKDAY_LABELS.map((_, weekday) => {
      const d = schedule.weekly.find((w) => w.weekday === weekday);
      return {
        enabled: !!d,
        isClosed: d?.isClosed ?? false,
        opensAt: d?.opensAt ?? '09:00',
        closesAt: d?.closesAt ?? '18:00',
      };
    }),
  );
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const configured = days.some((d) => d.enabled);
  const update = (i: number, patch: Partial<DayForm>) => {
    setSaved(false);
    setDays((all) => all.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  };

  async function save(clear = false) {
    setLoading(true);
    setError(null);
    try {
      await api('/ticketing/schedule/weekly', {
        method: 'PUT',
        body: {
          establishmentId: park.id,
          days: clear
            ? []
            : days.map((d, weekday) =>
                d.isClosed
                  ? { weekday, isClosed: true }
                  : { weekday, isClosed: false, opensAt: d.opensAt, closesAt: d.closesAt },
              ),
        },
      });
      if (clear) setDays((all) => all.map((d) => ({ ...d, enabled: false })));
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3 p-4">
      <p className="text-sm text-muted">
        Fuseau horaire : {schedule.timezone}. Ces horaires ne concernent que le parc (vente de
        billets et entrées) : le restaurant d’un établissement mixte reste ouvert.
        {!configured &&
          schedule.weekly.length === 0 &&
          ' Aucun horaire configuré : le parc est considéré ouvert en permanence.'}
      </p>
      <ul className="divide-y divide-line/70 rounded-xl border border-line">
        {days.map((d, i) => (
          <li key={i} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <span className="w-24 font-medium">{WEEKDAY_LABELS[i]}</span>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={d.isClosed}
                onChange={(e) => update(i, { isClosed: e.target.checked, enabled: true })}
                className="h-5 w-5 rounded border-line"
              />
              Fermé
            </label>
            {!d.isClosed && (
              <span className="flex items-center gap-2 text-sm">
                <input
                  type="time"
                  aria-label={`Ouverture ${WEEKDAY_LABELS[i]}`}
                  value={d.opensAt}
                  onChange={(e) => update(i, { opensAt: e.target.value, enabled: true })}
                  className="min-h-11 rounded-xl border border-line bg-surface px-2"
                />
                à
                <input
                  type="time"
                  aria-label={`Fermeture ${WEEKDAY_LABELS[i]}`}
                  value={d.closesAt}
                  onChange={(e) => update(i, { closesAt: e.target.value, enabled: true })}
                  className="min-h-11 rounded-xl border border-line bg-surface px-2"
                />
              </span>
            )}
          </li>
        ))}
      </ul>
      <ApiErrorAlert error={error} />
      {saved && <Alert tone="success">Horaires enregistrés.</Alert>}
      <div className="flex flex-wrap justify-end gap-2">
        {schedule.weekly.length > 0 && (
          <Button variant="ghost" onClick={() => void save(true)} disabled={loading}>
            Supprimer les horaires
          </Button>
        )}
        <Button onClick={() => void save()} loading={loading}>
          Enregistrer la semaine type
        </Button>
      </div>
    </div>
  );
}

function Exceptions({
  park,
  schedule,
  onChange,
}: {
  park: ParkEstablishment;
  schedule: ParkSchedule;
  onChange: () => void;
}) {
  const [form, setForm] = useState({
    date: schedule.today,
    isClosed: true,
    opensAt: '09:00',
    closesAt: '22:00',
    label: '',
  });
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api('/ticketing/schedule/exceptions', {
        method: 'POST',
        body: {
          establishmentId: park.id,
          date: form.date,
          isClosed: form.isClosed,
          ...(form.isClosed ? {} : { opensAt: form.opensAt, closesAt: form.closesAt }),
          label: form.label || undefined,
        },
      });
      setForm((f) => ({ ...f, label: '' }));
      onChange();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoading(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api(`/ticketing/schedule/exceptions/${id}`, { method: 'DELETE' });
      onChange();
    } catch (e) {
      setError(toApiError(e));
    }
  }

  return (
    <Card>
      <div className="border-b border-line/70 px-4 py-3">
        <h2 className="font-semibold">Dates particulières</h2>
        <p className="text-sm text-muted">
          Fermeture exceptionnelle, horaires spéciaux, nocturne ou évènement : prime sur la semaine
          type.
        </p>
      </div>
      <form
        onSubmit={onSubmit}
        className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto] lg:items-end"
      >
        <InputField
          label="Date"
          type="date"
          value={form.date}
          onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          required
        />
        <SelectField
          label="Type"
          value={form.isClosed ? 'closed' : 'hours'}
          onChange={(e) => setForm((f) => ({ ...f, isClosed: e.target.value === 'closed' }))}
          options={[
            { value: 'closed', label: 'Fermeture' },
            { value: 'hours', label: 'Horaires spéciaux' },
          ]}
        />
        <InputField
          label="Ouverture"
          type="time"
          value={form.opensAt}
          disabled={form.isClosed}
          onChange={(e) => setForm((f) => ({ ...f, opensAt: e.target.value }))}
        />
        <InputField
          label="Fermeture"
          type="time"
          value={form.closesAt}
          disabled={form.isClosed}
          onChange={(e) => setForm((f) => ({ ...f, closesAt: e.target.value }))}
        />
        <InputField
          label="Libellé"
          value={form.label}
          onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
          maxLength={80}
          placeholder="Ex. Nocturne"
        />
        <Button type="submit" loading={loading} icon={<Plus className="h-4 w-4" />}>
          Ajouter
        </Button>
      </form>
      <div className="px-4 pb-2">
        <ApiErrorAlert error={error} />
      </div>
      {schedule.exceptions.length === 0 ? (
        <EmptyState
          icon={<CalendarX className="h-7 w-7" />}
          title="Aucune date particulière"
          description="Le parc suit sa semaine type."
        />
      ) : (
        <ul className="divide-y divide-line/70 border-t border-line/70">
          {schedule.exceptions.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <span className="w-32 font-semibold">{formatDate(e.date)}</span>
              {e.isClosed ? (
                <Badge tone="terracotta">Fermé</Badge>
              ) : (
                <Badge tone="savanna">{`${e.opensAt ?? '00:00'}–${e.closesAt ?? '24:00'}`}</Badge>
              )}
              <span className="flex-1 text-muted">{e.label ?? ''}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void remove(e.id)}
                icon={<Trash2 className="h-4 w-4" />}
              >
                Supprimer
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

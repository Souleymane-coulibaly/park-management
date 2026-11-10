'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  type FactureInterventionStatus,
  FACTURE_ROLE_LABELS,
  type FactureRole,
} from '@ocall/shared';
import { FacturePage } from '@/components/facture/facture-page';
import { InterventionStatusBadge } from '@/components/facture/intervention-status-badge';
import { TextareaField } from '@/components/facture/textarea-field';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { CheckboxGroup, InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface InterventionRow {
  id: string;
  number: string;
  status: FactureInterventionStatus;
  title: string;
  siteAddress: string | null;
  scheduledStart: string;
  scheduledEnd: string;
  client: { id: string; name: string };
  equipment: { id: string; name: string } | null;
  technicians: { memberId: string; name: string }[];
}

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
/** Lundi de la semaine d'une date (jours en UTC : heure du Mali). */
const mondayOf = (d: Date) => {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY);
};
const timeFr = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
  });
const dayFr = (d: Date) =>
  d.toLocaleDateString('fr-FR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

/** Planning des interventions : semaine par semaine, création (planification) d'une intervention. */
export default function FactureInterventionsPage() {
  return (
    <FacturePage
      title="Interventions"
      description="Planning des techniciens, travaux réalisés, rapports signés et facturation."
    >
      {({ canWrite, context }) => {
        const all = context.permissions.includes('facture.interventions.read');
        const mine = context.permissions.includes('facture.interventions.work');
        if (!all && !mine) {
          return (
            <Alert tone="info" title="Les interventions ne sont pas accessibles à votre rôle." />
          );
        }
        return <Planning canPlan={canWrite('facture.interventions.manage')} onlyMine={!all} />;
      }}
    </FacturePage>
  );
}

function Planning({ canPlan, onlyMine }: { canPlan: boolean; onlyMine: boolean }) {
  const [monday, setMonday] = useState(() => mondayOf(new Date()));
  const sunday = new Date(monday.getTime() + 6 * DAY);
  const list = useApi<InterventionRow[]>(
    `/facture/interventions?from=${isoDay(monday)}&to=${isoDay(sunday)}`,
  );
  const days = Array.from({ length: 7 }, (_, i) => new Date(monday.getTime() + i * DAY));

  return (
    <>
      {canPlan && <NewIntervention />}
      <Card>
        <CardHeader
          title={onlyMine ? 'Mes interventions' : 'Planning de la semaine'}
          description={`Du ${dayFr(monday)} au ${dayFr(sunday)} (heure du Mali)`}
          action={
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                aria-label="Semaine précédente"
                icon={<ChevronLeft className="h-4 w-4" aria-hidden />}
                onClick={() => setMonday(new Date(monday.getTime() - 7 * DAY))}
              />
              <Button variant="secondary" size="sm" onClick={() => setMonday(mondayOf(new Date()))}>
                Cette semaine
              </Button>
              <Button
                variant="secondary"
                size="sm"
                aria-label="Semaine suivante"
                icon={<ChevronRight className="h-4 w-4" aria-hidden />}
                onClick={() => setMonday(new Date(monday.getTime() + 7 * DAY))}
              />
            </div>
          }
        />
        <CardBody>
          {list.state === 'loading' && <LoadingState />}
          {list.state === 'error' && <ErrorState error={list.error} onRetry={list.reload} />}
          {list.state === 'success' && (
            <ol className="space-y-5" data-testid="facture-planning">
              {days.map((day) => {
                const rows = list.data.filter((r) => r.scheduledStart.slice(0, 10) === isoDay(day));
                return (
                  <li key={isoDay(day)}>
                    <h3 className="text-sm font-semibold capitalize text-charcoal">{dayFr(day)}</h3>
                    {rows.length === 0 ? (
                      <p className="mt-1 text-sm text-muted">Aucune intervention.</p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {rows.map((r) => (
                          <li key={r.id}>
                            <Link
                              href={`/facture/interventions/${r.id}`}
                              className="block rounded-xl border border-line px-4 py-3 transition-colors hover:border-forest/50 hover:bg-forest-light/30"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-semibold text-forest">
                                  {timeFr(r.scheduledStart)}–{timeFr(r.scheduledEnd)} · {r.title}
                                </span>
                                <InterventionStatusBadge status={r.status} />
                              </div>
                              <p className="mt-1 text-sm text-charcoal-soft">
                                {r.client.name}
                                {r.equipment ? ` · ${r.equipment.name}` : ''}
                                {r.siteAddress ? ` · ${r.siteAddress}` : ''}
                              </p>
                              <p className="text-xs text-muted">
                                {r.number} ·{' '}
                                {r.technicians.map((t) => t.name).join(', ') || 'Aucun technicien'}
                              </p>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </CardBody>
      </Card>
    </>
  );
}

interface Option {
  id: string;
  name: string;
}
interface Technician {
  id: string;
  firstName: string;
  lastName: string;
  role: FactureRole;
}

function NewIntervention() {
  const router = useRouter();
  const clients = useApi<Option[]>('/facture/clients');
  const technicians = useApi<Technician[]>('/facture/technicians');
  const [clientId, setClientId] = useState('');
  const equipment = useApi<Option[]>(clientId ? `/facture/equipment?clientId=${clientId}` : null);
  const [form, setForm] = useState({
    title: '',
    date: isoDay(new Date()),
    start: '08:00',
    end: '10:00',
    equipmentId: '',
    siteAddress: '',
    description: '',
  });
  const [technicianIds, setTechnicianIds] = useState<string[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api<{ id: string }>('/facture/interventions', {
        method: 'POST',
        body: {
          clientId,
          equipmentId: form.equipmentId || null,
          title: form.title,
          description: form.description || null,
          siteAddress: form.siteAddress || null,
          // Heure du Mali = UTC.
          scheduledStart: `${form.date}T${form.start}:00Z`,
          scheduledEnd: `${form.date}T${form.end}:00Z`,
          technicianIds,
        },
      });
      router.push(`/facture/interventions/${created.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError ? err : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.'),
      );
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Planifier une intervention"
        description="Client, créneau et techniciens ; le lieu reprend l’adresse du client s’il est vide."
      />
      <CardBody>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={submit}
          data-testid="facture-new-intervention"
        >
          <SelectField
            label="Client"
            required
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setForm({ ...form, equipmentId: '' });
            }}
            options={[
              { value: '', label: 'Choisir un client' },
              ...(clients.state === 'success'
                ? clients.data.map((c) => ({ value: c.id, label: c.name }))
                : []),
            ]}
          />
          <SelectField
            label="Équipement"
            {...set('equipmentId')}
            disabled={!clientId}
            options={[
              { value: '', label: 'Aucun équipement précis' },
              ...(equipment.state === 'success'
                ? equipment.data.map((q) => ({ value: q.id, label: q.name }))
                : []),
            ]}
          />
          <InputField
            label="Objet de la demande"
            required
            minLength={3}
            maxLength={160}
            {...set('title')}
          />
          <InputField label="Lieu d’intervention" maxLength={240} {...set('siteAddress')} />
          <InputField label="Date" type="date" required {...set('date')} />
          <div className="grid grid-cols-2 gap-3">
            <InputField label="Début" type="time" required {...set('start')} />
            <InputField label="Fin" type="time" required {...set('end')} />
          </div>
          <div className="sm:col-span-2">
            {technicians.state === 'success' && technicians.data.length > 0 ? (
              <CheckboxGroup
                legend="Techniciens"
                options={technicians.data.map((t) => ({
                  value: t.id,
                  label: `${t.firstName} ${t.lastName} (${FACTURE_ROLE_LABELS[t.role]})`,
                }))}
                value={technicianIds}
                onChange={setTechnicianIds}
              />
            ) : (
              <p className="text-sm text-muted">
                Aucun technicien dans l’équipe : ajoutez un membre « Technicien » depuis la page
                Équipe.
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <TextareaField
              label="Description de la demande"
              maxLength={2000}
              {...set('description')}
            />
          </div>
          <div className="sm:col-span-2">
            <ApiErrorAlert error={error} />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" loading={busy} disabled={!clientId}>
              Planifier
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

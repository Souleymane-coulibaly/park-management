'use client';

import { type FormEvent, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import {
  ROLE_LABELS,
  STAFF_POSITION_KINDS,
  STAFF_POSITION_KIND_LABELS,
  type StaffPositionKind,
} from '@ocall/shared';
import { EstablishmentScope } from '@/components/app/establishment-scope';
import { useCan } from '@/components/app/session-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField, SelectField } from '@/components/ui/field';
import { ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import type { StaffAssignment, StaffMember, StaffPosition } from '@/lib/types';
import { useApi } from '@/lib/use-api';

type View = 'day' | 'week' | 'month';
const DAY_MS = 86_400_000;

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** Début et fin (exclue) de la période affichée, en heure de l'appareil. */
function period(view: View, anchor: Date): { from: Date; to: Date } {
  const d = new Date(anchor);
  d.setHours(0, 0, 0, 0);
  if (view === 'day') return { from: d, to: new Date(d.getTime() + DAY_MS) };
  if (view === 'week') {
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return { from: d, to: new Date(d.getTime() + 7 * DAY_MS) };
  }
  const from = new Date(d.getFullYear(), d.getMonth(), 1);
  return { from, to: new Date(d.getFullYear(), d.getMonth() + 1, 1) };
}

function shift(view: View, anchor: Date, direction: 1 | -1): Date {
  const d = new Date(anchor);
  if (view === 'day') d.setDate(d.getDate() + direction);
  else if (view === 'week') d.setDate(d.getDate() + 7 * direction);
  else d.setMonth(d.getMonth() + direction);
  return d;
}

function label(view: View, from: Date): string {
  if (view === 'day')
    return from.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  if (view === 'week')
    return `Semaine du ${from.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
  return from.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

/**
 * Planning du personnel : les responsables planifient (jour, semaine, mois) ; chaque employé voit
 * son propre planning. Volontairement simple : ni pointage, ni absences, ni congés, ni paie.
 */
export default function PlanningPage() {
  const canManage = useCan('planning.manage');
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Planning du personnel</h1>
      {canManage ? (
        <EstablishmentScope
          source="/establishments"
          storageKey="ocp.planning.establishment"
          emptyTitle="Aucun établissement"
          emptyDescription="Le planning se prépare par établissement."
        >
          {(e) => <TeamPlanning establishmentId={e.id} />}
        </EstablishmentScope>
      ) : (
        <MyPlanning />
      )}
    </div>
  );
}

function PeriodBar({
  view,
  setView,
  anchor,
  setAnchor,
}: {
  view: View;
  setView: (v: View) => void;
  anchor: Date;
  setAnchor: (d: Date) => void;
}) {
  const { from } = period(view, anchor);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          aria-label="Période précédente"
          icon={<ChevronLeft className="h-4 w-4" />}
          onClick={() => setAnchor(shift(view, anchor, -1))}
        />
        <p className="font-semibold capitalize" data-testid="planning-period">
          {label(view, from)}
        </p>
        <Button
          variant="secondary"
          size="sm"
          aria-label="Période suivante"
          icon={<ChevronRight className="h-4 w-4" />}
          onClick={() => setAnchor(shift(view, anchor, 1))}
        />
        <Button variant="ghost" size="sm" onClick={() => setAnchor(new Date())}>
          Aujourd’hui
        </Button>
      </div>
      <div role="tablist" aria-label="Vue" className="flex gap-1">
        {(['day', 'week', 'month'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`min-h-11 rounded-xl px-3 text-sm font-semibold ${view === v ? 'bg-forest text-white' : 'border border-line bg-surface'}`}
          >
            {v === 'day' ? 'Jour' : v === 'week' ? 'Semaine' : 'Mois'}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Créneaux regroupés par jour. */
function ByDay({
  assignments,
  from,
  to,
  onSelect,
}: {
  assignments: StaffAssignment[];
  from: Date;
  to: Date;
  onSelect?: (a: StaffAssignment) => void;
}) {
  const days: Date[] = [];
  for (let d = new Date(from); d < to; d = new Date(d.getTime() + DAY_MS)) days.push(d);
  const visibleDays = days.filter((d) =>
    assignments.some((a) => dayKey(new Date(a.startsAt)) === dayKey(d)),
  );
  if (visibleDays.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<CalendarDays className="h-7 w-7" />}
          title="Aucun créneau"
          description="Rien n’est planifié sur cette période."
        />
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      {visibleDays.map((d) => (
        <Card key={dayKey(d)}>
          <CardHeader
            title={d.toLocaleDateString('fr-FR', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          />
          <ul className="divide-y divide-line/70">
            {assignments
              .filter((a) => dayKey(new Date(a.startsAt)) === dayKey(d))
              .map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    disabled={!onSelect}
                    onClick={() => onSelect?.(a)}
                    className="flex w-full flex-wrap items-center justify-between gap-2 px-5 py-3 text-left enabled:hover:bg-forest-light/30 sm:px-6"
                    data-testid="staff-assignment"
                  >
                    <span className="font-semibold">
                      {time(a.startsAt)} – {time(a.endsAt)} · {a.employee.name}
                    </span>
                    <span className="flex items-center gap-2 text-sm">
                      <Badge tone="forest">{a.position.name}</Badge>
                      {a.notes && <span className="text-muted">{a.notes}</span>}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function TeamPlanning({ establishmentId }: { establishmentId: string }) {
  const [view, setView] = useState<View>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const { from, to } = useMemo(() => period(view, anchor), [view, anchor]);
  const assignments = useApi<StaffAssignment[]>(
    `/planning/assignments?establishmentId=${establishmentId}&from=${from.toISOString()}&to=${to.toISOString()}`,
  );
  const staff = useApi<StaffMember[]>(`/planning/staff?establishmentId=${establishmentId}`);
  const positions = useApi<StaffPosition[]>('/planning/positions');
  const [editing, setEditing] = useState<StaffAssignment | 'new' | null>(null);
  const [addingPosition, setAddingPosition] = useState(false);

  const list = assignments.state === 'success' ? assignments.data : [];
  const hours = new Map<string, number>();
  for (const a of list) {
    hours.set(
      a.employee.name,
      (hours.get(a.employee.name) ?? 0) +
        (new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 3_600_000,
    );
  }

  return (
    <div className="space-y-3">
      <PeriodBar view={view} setView={setView} anchor={anchor} setAnchor={setAnchor} />
      <div className="flex flex-wrap gap-2">
        <Button
          icon={<Plus className="h-4 w-4" />}
          onClick={() => setEditing('new')}
          disabled={staff.state !== 'success' || positions.state !== 'success'}
        >
          Nouveau créneau
        </Button>
        <Button variant="secondary" onClick={() => setAddingPosition(true)}>
          Nouveau poste
        </Button>
      </div>
      {hours.size > 0 && (
        <Card>
          <CardHeader title="Équipe sur la période" description="Heures planifiées par employé" />
          <CardBody className="flex flex-wrap gap-2">
            {[...hours.entries()].map(([name, h]) => (
              <Badge key={name} tone="neutral">
                {name} : {Math.round(h * 10) / 10} h
              </Badge>
            ))}
          </CardBody>
        </Card>
      )}
      {assignments.state === 'loading' && <LoadingState />}
      {assignments.state === 'error' && (
        <ErrorState error={assignments.error} onRetry={assignments.reload} />
      )}
      {assignments.state === 'success' && (
        <ByDay assignments={list} from={from} to={to} onSelect={(a) => setEditing(a)} />
      )}
      {editing && staff.state === 'success' && positions.state === 'success' && (
        <AssignmentDialog
          establishmentId={establishmentId}
          assignment={editing === 'new' ? null : editing}
          staff={staff.data}
          positions={positions.data.filter((p) => p.isActive)}
          defaultDay={from}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            assignments.reload();
          }}
        />
      )}
      {addingPosition && (
        <PositionDialog
          onClose={() => setAddingPosition(false)}
          onSaved={() => {
            setAddingPosition(false);
            positions.reload();
          }}
        />
      )}
    </div>
  );
}

function MyPlanning() {
  const [view, setView] = useState<View>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const { from, to } = useMemo(() => period(view, anchor), [view, anchor]);
  const mine = useApi<StaffAssignment[]>(
    `/planning/me?from=${from.toISOString()}&to=${to.toISOString()}`,
  );
  return (
    <div className="space-y-3">
      <p className="text-muted">Vos créneaux de travail, tous établissements confondus.</p>
      <PeriodBar view={view} setView={setView} anchor={anchor} setAnchor={setAnchor} />
      {mine.state === 'loading' && <LoadingState />}
      {mine.state === 'error' && <ErrorState error={mine.error} onRetry={mine.reload} />}
      {mine.state === 'success' && <ByDay assignments={mine.data} from={from} to={to} />}
    </div>
  );
}

function AssignmentDialog({
  establishmentId,
  assignment,
  staff,
  positions,
  defaultDay,
  onClose,
  onSaved,
}: {
  establishmentId: string;
  assignment: StaffAssignment | null;
  staff: StaffMember[];
  positions: StaffPosition[];
  defaultDay: Date;
  onClose: () => void;
  onSaved: () => void;
}) {
  const start = assignment ? new Date(assignment.startsAt) : defaultDay;
  const [form, setForm] = useState({
    membershipId: assignment?.employee.membershipId ?? staff[0]?.membershipId ?? '',
    positionId: assignment?.position.id ?? positions[0]?.id ?? '',
    date: dayKey(start),
    startTime: assignment ? time(assignment.startsAt) : '08:00',
    endTime: assignment ? time(assignment.endsAt) : '16:00',
    notes: assignment?.notes ?? '',
  });
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const startsAt = new Date(`${form.date}T${form.startTime}`);
    let endsAt = new Date(`${form.date}T${form.endTime}`);
    // Créneau de nuit : une fin plus tôt que le début se termine le lendemain.
    if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + DAY_MS);
    const body = {
      membershipId: form.membershipId,
      positionId: form.positionId,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      notes: form.notes.trim() || null,
    };
    try {
      if (assignment)
        await api(`/planning/assignments/${assignment.id}`, { method: 'PATCH', body });
      else
        await api('/planning/assignments', { method: 'POST', body: { ...body, establishmentId } });
      onSaved();
    } catch (e) {
      setError(e as ApiError);
      setLoading(false);
    }
  }

  async function remove() {
    if (!assignment) return;
    setLoading(true);
    try {
      await api(`/planning/assignments/${assignment.id}`, { method: 'DELETE' });
      onSaved();
    } catch (e) {
      setError(e as ApiError);
      setLoading(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={assignment ? 'Modifier le créneau' : 'Nouveau créneau'}>
      <form onSubmit={onSubmit} className="space-y-4">
        <ApiErrorAlert error={error} />
        <SelectField
          label="Employé"
          value={form.membershipId}
          onChange={(e) => set({ membershipId: e.target.value })}
          options={staff.map((s) => ({
            value: s.membershipId,
            label: `${s.name} (${ROLE_LABELS[s.role]})`,
          }))}
        />
        <SelectField
          label="Poste"
          value={form.positionId}
          onChange={(e) => set({ positionId: e.target.value })}
          options={positions.map((p) => ({ value: p.id, label: p.name }))}
        />
        <InputField
          label="Date"
          type="date"
          required
          value={form.date}
          onChange={(e) => set({ date: e.target.value })}
        />
        <div className="grid grid-cols-2 gap-3">
          <InputField
            label="Début"
            type="time"
            required
            value={form.startTime}
            onChange={(e) => set({ startTime: e.target.value })}
          />
          <InputField
            label="Fin"
            type="time"
            required
            value={form.endTime}
            onChange={(e) => set({ endTime: e.target.value })}
          />
        </div>
        <InputField
          label="Remarque"
          maxLength={200}
          value={form.notes}
          onChange={(e) => set({ notes: e.target.value })}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" className="flex-1" loading={loading}>
            Enregistrer
          </Button>
          {assignment && (
            <Button type="button" variant="danger" onClick={remove} disabled={loading}>
              Supprimer
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}

function PositionDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<StaffPositionKind>('OTHER');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api('/planning/positions', { method: 'POST', body: { name, kind } });
      onSaved();
    } catch (e) {
      setError(e as ApiError);
      setLoading(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title="Nouveau poste">
      <form onSubmit={onSubmit} className="space-y-4">
        <ApiErrorAlert error={error} />
        <InputField
          label="Nom du poste"
          required
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Bar, Plage, Vestiaire…"
        />
        <SelectField
          label="Type"
          value={kind}
          onChange={(e) => setKind(e.target.value as StaffPositionKind)}
          options={STAFF_POSITION_KINDS.map((k) => ({
            value: k,
            label: STAFF_POSITION_KIND_LABELS[k],
          }))}
        />
        <Button type="submit" className="w-full" loading={loading}>
          Créer le poste
        </Button>
      </form>
    </Dialog>
  );
}

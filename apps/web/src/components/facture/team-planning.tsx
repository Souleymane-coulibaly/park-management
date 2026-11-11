'use client';

import { type FormEvent, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { ApiErrorAlert } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface Skill {
  id: string;
  name: string;
  isArchived: boolean;
}
interface Technician {
  id: string;
  firstName: string;
  lastName: string;
}
interface Unavailability {
  id: string;
  memberId: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  member: { firstName: string; lastName: string };
}

const toError = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.');
const dateTimeFr = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    timeZone: 'UTC',
    dateStyle: 'short',
    timeStyle: 'short',
  });

/**
 * Données de la planification (F6B) : compétences de l'entreprise (liste libre), compétences de chaque
 * technicien, indisponibilités (congés, absences). Gérées par le gérant.
 */
export function TeamPlanning({
  canManageSkills,
  canManageAbsences,
}: {
  canManageSkills: boolean;
  canManageAbsences: boolean;
}) {
  const skills = useApi<Skill[]>('/facture/skills');
  const technicians = useApi<Technician[]>(canManageAbsences ? '/facture/technicians' : null);
  const memberSkills = useApi<Record<string, string[]>>('/facture/member-skills');
  const absences = useApi<Unavailability[]>(canManageAbsences ? '/facture/unavailabilities' : null);
  const [name, setName] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [absence, setAbsence] = useState({ memberId: '', from: '', to: '', reason: '' });
  // Compétences cochées : affichées tout de suite, enregistrées ensuite (rechargées en cas d'échec).
  const [pending, setPending] = useState<Record<string, string[]>>({});

  const active = skills.state === 'success' ? skills.data.filter((s) => !s.isArchived) : [];
  const run = async (key: string, action: () => Promise<unknown>, reload: () => void) => {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(toError(err));
    } finally {
      // Toujours relire l'état enregistré (succès ou échec) : l'écran reflète la base.
      reload();
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Compétences et disponibilités"
        description="Utilisées par la planification intelligente pour proposer le bon technicien au bon moment."
      />
      <CardBody className="space-y-6">
        <ApiErrorAlert error={error} />
        <div className="space-y-3" data-testid="facture-skills">
          <h3 className="text-sm font-semibold text-charcoal">Compétences de l’entreprise</h3>
          <div className="flex flex-wrap gap-2">
            {skills.state === 'success' &&
              skills.data.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1">
                  <Badge tone={s.isArchived ? 'neutral' : 'forest'}>{s.name}</Badge>
                  {canManageSkills && (
                    <button
                      type="button"
                      className="text-xs text-muted underline"
                      onClick={() =>
                        void run(
                          s.id,
                          () =>
                            api(`/facture/skills/${s.id}`, {
                              method: 'PATCH',
                              body: { isArchived: !s.isArchived },
                            }),
                          skills.reload,
                        )
                      }
                    >
                      {s.isArchived ? 'réactiver' : 'archiver'}
                    </button>
                  )}
                </span>
              ))}
          </div>
          {canManageSkills && (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void run(
                  'add',
                  async () => {
                    await api('/facture/skills', { method: 'POST', body: { name } });
                    setName('');
                  },
                  skills.reload,
                );
              }}
            >
              <InputField
                label="Nouvelle compétence"
                minLength={2}
                maxLength={60}
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Button type="submit" variant="secondary" loading={busy === 'add'}>
                Ajouter
              </Button>
            </form>
          )}
        </div>

        {canManageSkills && technicians.state === 'success' && memberSkills.state === 'success' && (
          <div className="space-y-2" data-testid="facture-member-skills">
            <h3 className="text-sm font-semibold text-charcoal">Compétences des techniciens</h3>
            {technicians.data.map((t) => {
              const own = pending[t.id] ?? memberSkills.data[t.id] ?? [];
              return (
                <div key={t.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="min-w-40 font-medium">
                    {t.firstName} {t.lastName}
                  </span>
                  {active.map((s) => (
                    <label key={s.id} className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-forest"
                        aria-label={`${s.name} — ${t.firstName} ${t.lastName}`}
                        checked={own.includes(s.id)}
                        onChange={(e) => {
                          const skillIds = e.target.checked
                            ? [...own, s.id]
                            : own.filter((id) => id !== s.id);
                          setPending((p) => ({ ...p, [t.id]: skillIds }));
                          void run(
                            `${t.id}-${s.id}`,
                            () =>
                              api(`/facture/members/${t.id}/skills`, {
                                method: 'PUT',
                                body: { skillIds },
                              }),
                            () => {
                              setPending(({ [t.id]: _done, ...rest }) => rest);
                              memberSkills.reload();
                            },
                          );
                        }}
                      />
                      {s.name}
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {canManageAbsences && technicians.state === 'success' && (
          <div className="space-y-3" data-testid="facture-unavailabilities">
            <h3 className="text-sm font-semibold text-charcoal">Indisponibilités à venir</h3>
            {absences.state === 'success' && absences.data.length > 0 ? (
              <ul className="divide-y divide-line/70 text-sm">
                {absences.data.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                    <span>
                      {a.member.firstName} {a.member.lastName} · {dateTimeFr(a.startsAt)} →{' '}
                      {dateTimeFr(a.endsAt)}
                      {a.reason ? ` · ${a.reason}` : ''}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Supprimer cette indisponibilité"
                      icon={<Trash2 className="h-4 w-4" aria-hidden />}
                      loading={busy === a.id}
                      onClick={() =>
                        void run(
                          a.id,
                          () => api(`/facture/unavailabilities/${a.id}`, { method: 'DELETE' }),
                          absences.reload,
                        )
                      }
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Aucune indisponibilité prévue.</p>
            )}
            <form
              className="grid gap-3 sm:grid-cols-4 sm:items-end"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void run(
                  'absence',
                  async () => {
                    await api('/facture/unavailabilities', {
                      method: 'POST',
                      body: {
                        memberId: absence.memberId,
                        // Journées entières, heure du Mali (UTC).
                        startsAt: `${absence.from}T00:00:00Z`,
                        endsAt: new Date(
                          new Date(`${absence.to}T00:00:00Z`).getTime() + 86_400_000,
                        ).toISOString(),
                        reason: absence.reason || null,
                      },
                    });
                    setAbsence({ memberId: '', from: '', to: '', reason: '' });
                  },
                  absences.reload,
                );
              }}
            >
              <SelectField
                label="Technicien"
                required
                value={absence.memberId}
                onChange={(e) => setAbsence({ ...absence, memberId: e.target.value })}
                options={[
                  { value: '', label: 'Choisir' },
                  ...technicians.data.map((t) => ({
                    value: t.id,
                    label: `${t.firstName} ${t.lastName}`,
                  })),
                ]}
              />
              <InputField
                label="Du"
                type="date"
                required
                value={absence.from}
                onChange={(e) => setAbsence({ ...absence, from: e.target.value })}
              />
              <InputField
                label="Au (inclus)"
                type="date"
                required
                value={absence.to}
                onChange={(e) => setAbsence({ ...absence, to: e.target.value })}
              />
              <InputField
                label="Motif"
                maxLength={160}
                value={absence.reason}
                onChange={(e) => setAbsence({ ...absence, reason: e.target.value })}
              />
              <div className="sm:col-span-4">
                <Button type="submit" variant="secondary" loading={busy === 'absence'}>
                  Ajouter l’indisponibilité
                </Button>
              </div>
            </form>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

'use client';

import { useState } from 'react';
import {
  SCHOOL_STAFF_CATEGORIES,
  SCHOOL_STAFF_CATEGORY_LABELS,
  type SchoolStaffCategory,
} from '@ocall/shared';
import { SchoolCardsNav } from '@/components/school/school-cards-nav';
import { SchoolPage, type SchoolPageApi } from '@/components/school/school-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { ApiError, api, apiUpload } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface StaffView {
  id: string;
  schoolId: string;
  memberId: string | null;
  memberRole: string | null;
  lastName: string;
  firstName: string;
  category: SchoolStaffCategory;
  jobTitle: string | null;
  staffNumber: string;
  phone: string | null;
  hasPhoto: boolean;
  isActive: boolean;
}

const asError = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion au serveur impossible.');

const CATEGORY_OPTIONS = SCHOOL_STAFF_CATEGORIES.map((c) => ({
  value: c,
  label: SCHOOL_STAFF_CATEGORY_LABELS[c],
}));

function StaffDialog({
  schoolId,
  staff,
  onClose,
  onDone,
}: {
  schoolId: string;
  staff: StaffView | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [lastName, setLastName] = useState(staff?.lastName ?? '');
  const [firstName, setFirstName] = useState(staff?.firstName ?? '');
  const [category, setCategory] = useState<SchoolStaffCategory>(staff?.category ?? 'SECURITY');
  const [jobTitle, setJobTitle] = useState(staff?.jobTitle ?? '');
  const [phone, setPhone] = useState(staff?.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  return (
    <Dialog
      open
      onClose={onClose}
      title={staff ? `Fiche ${staff.staffNumber}` : 'Nouveau membre du personnel'}
      description="Avec ou sans compte Ocall : gardiens, cuisine, entretien, transport, administration…"
    >
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const body = {
            lastName,
            firstName,
            category,
            jobTitle: jobTitle.trim() || null,
            phone: phone.trim() || null,
          };
          try {
            if (staff) await api(`/school/staff/${staff.id}`, { method: 'PATCH', body });
            else await api('/school/staff', { method: 'POST', body: { ...body, schoolId } });
            onDone();
          } catch (err) {
            setError(asError(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <InputField
            label="Nom"
            required
            value={lastName}
            maxLength={80}
            onChange={(e) => setLastName(e.target.value)}
          />
          <InputField
            label="Prénom"
            required
            value={firstName}
            maxLength={80}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>
        <SelectField
          label="Catégorie"
          value={category}
          onChange={(e) => setCategory(e.target.value as SchoolStaffCategory)}
          options={CATEGORY_OPTIONS}
        />
        <InputField
          label="Fonction affichée sur le badge"
          value={jobTitle}
          maxLength={80}
          onChange={(e) => setJobTitle(e.target.value)}
        />
        <InputField
          label="Téléphone (facultatif)"
          value={phone}
          maxLength={30}
          onChange={(e) => setPhone(e.target.value)}
        />
        <ApiErrorAlert error={error} />
        <div className="flex justify-end gap-3">
          <Button variant="ghost" type="button" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" loading={busy} data-testid="staff-save">
            Enregistrer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Staff({ page }: { page: SchoolPageApi }) {
  const schoolId = page.school!.id;
  const [active, setActive] = useState<'true' | 'false'>('true');
  const [q, setQ] = useState('');
  const staff = useApi<StaffView[]>(
    `/school/staff?schoolId=${schoolId}&active=${active}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
  );
  const [editing, setEditing] = useState<StaffView | 'new' | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const canManage = page.canWrite('school.staff.manage');
  const canCards = page.canWrite('school.cards.manage');

  async function run(work: () => Promise<string | null>) {
    setError(null);
    setNotice(null);
    try {
      setNotice(await work());
      staff.reload();
      setVersion((v) => v + 1);
    } catch (e) {
      setError(asError(e));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-64">
          <InputField label="Rechercher" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="w-full sm:w-40">
          <SelectField
            label="Fiches"
            value={active}
            onChange={(e) => setActive(e.target.value as 'true' | 'false')}
            options={[
              { value: 'true', label: 'Actives' },
              { value: 'false', label: 'Inactives' },
            ]}
          />
        </div>
        {canManage && (
          <>
            <Button onClick={() => setEditing('new')} data-testid="staff-new">
              Nouveau membre du personnel
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                void run(async () => {
                  const r = await api<{ created: number }>('/school/staff/import-members', {
                    method: 'POST',
                    body: { schoolId },
                  });
                  return `${r.created} fiche(s) créée(s) depuis l’équipe.`;
                })
              }
            >
              Créer les fiches de l’équipe
            </Button>
          </>
        )}
        {canCards && (
          <Button
            variant="secondary"
            disabled={selection.length === 0}
            data-testid="staff-badges"
            onClick={() =>
              void run(async () => {
                const cards = await api<unknown[]>('/school/cards/staff', {
                  method: 'POST',
                  body: { staffIds: selection },
                });
                setSelection([]);
                return `${cards.length} badge(s) prêt(s) : commandez-les depuis « Cartes ».`;
              })
            }
          >
            Créer les badges ({selection.length})
          </Button>
        )}
      </div>
      <ApiErrorAlert error={error} />
      {notice && <Alert tone="success">{notice}</Alert>}
      {staff.state === 'loading' && <LoadingState />}
      {staff.state === 'error' && <ErrorState error={staff.error} onRetry={staff.reload} />}
      {staff.state === 'success' && (
        <Card>
          {staff.data.length === 0 ? (
            <EmptyState
              icon={<span aria-hidden>👥</span>}
              title="Aucune fiche"
              description="Ajoutez le personnel, avec ou sans compte, pour préparer les badges."
            />
          ) : (
            <Table head={['', 'Photo', 'Nom', 'N°', 'Catégorie', 'Fonction', 'Compte', '']}>
              {staff.data.map((s) => (
                <tr key={s.id} data-testid="staff-row">
                  <Td>
                    {canCards && s.isActive && (
                      <input
                        type="checkbox"
                        aria-label={`Sélectionner ${s.lastName}`}
                        checked={selection.includes(s.id)}
                        onChange={() =>
                          setSelection((x) =>
                            x.includes(s.id) ? x.filter((y) => y !== s.id) : [...x, s.id],
                          )
                        }
                        className="h-4 w-4 accent-forest"
                      />
                    )}
                  </Td>
                  <Td>
                    {s.hasPhoto ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/v1/school/staff/${s.id}/photo?v=${version}`}
                        alt=""
                        className="h-12 w-9 rounded object-cover"
                      />
                    ) : (
                      <span className="text-xs text-terracotta-dark">Manquante</span>
                    )}
                  </Td>
                  <Td>{`${s.lastName.toUpperCase()} ${s.firstName}`}</Td>
                  <Td className="font-mono text-xs">{s.staffNumber}</Td>
                  <Td>{SCHOOL_STAFF_CATEGORY_LABELS[s.category]}</Td>
                  <Td>{s.jobTitle ?? '—'}</Td>
                  <Td>
                    {s.memberId ? (
                      <Badge tone="forest">Avec compte</Badge>
                    ) : (
                      <Badge>Sans compte</Badge>
                    )}
                  </Td>
                  <Td>
                    {canManage && (
                      <div className="flex flex-wrap justify-end gap-1">
                        <label className="relative cursor-pointer rounded-lg px-2 py-1 text-sm font-medium hover:bg-ivory-dark/60">
                          Photo
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="sr-only"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              const form = new FormData();
                              form.append('file', file);
                              void run(async () => {
                                await apiUpload(`/school/staff/${s.id}/photo`, form, 'PUT');
                                return 'Photo enregistrée (réencodée, sans métadonnées).';
                              });
                            }}
                          />
                        </label>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                          Modifier
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void run(async () => {
                              await api(`/school/staff/${s.id}/active`, {
                                method: 'POST',
                                body: { active: !s.isActive },
                              });
                              return s.isActive
                                ? 'Fiche désactivée : ses badges sont révoqués.'
                                : 'Fiche réactivée.';
                            })
                          }
                        >
                          {s.isActive ? 'Désactiver' : 'Réactiver'}
                        </Button>
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
      {editing && (
        <StaffDialog
          schoolId={schoolId}
          staff={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            staff.reload();
          }}
        />
      )}
      <Card>
        <CardBody>
          <p className="text-sm text-muted">
            Photo du badge : JPEG, PNG ou WebP, au moins 200 × 240 pixels ; elle est réencodée et
            ses métadonnées (EXIF, GPS) sont supprimées.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

export default function SchoolStaffPage() {
  return (
    <SchoolPage
      title={() => 'Personnel'}
      description={() => 'Fiches du personnel, avec ou sans compte, pour les badges Ocall Print.'}
    >
      {(page) => (
        <div className="space-y-4">
          <SchoolCardsNav />
          {page.school && <Staff key={page.school.id} page={page} />}
        </div>
      )}
    </SchoolPage>
  );
}

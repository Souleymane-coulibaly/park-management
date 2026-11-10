'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useRef, useState } from 'react';
import { Camera, FileDown, Trash2 } from 'lucide-react';
import {
  FACTURE_MAX_INTERVENTION_PHOTOS,
  FACTURE_ROLE_LABELS,
  type FactureDocumentStatus,
  type FactureInterventionStatus,
  type FactureRole,
  formatFactureMinutes,
  formatXof,
  isFactureInterventionPlanningOpen,
} from '@ocall/shared';
import { DocumentStatusBadge } from '@/components/facture/document-status-badge';
import { FacturePage } from '@/components/facture/facture-page';
import { InterventionStatusBadge } from '@/components/facture/intervention-status-badge';
import { SignaturePad, type SignaturePadHandle } from '@/components/facture/signature-pad';
import { TextareaField } from '@/components/facture/textarea-field';
import { Button, buttonClass } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { CheckboxGroup, InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api, apiUpload } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface Intervention {
  id: string;
  number: string;
  status: FactureInterventionStatus;
  title: string;
  description: string | null;
  siteAddress: string | null;
  contactName: string | null;
  contactPhone: string | null;
  scheduledStart: string;
  scheduledEnd: string;
  startedAt: string | null;
  completedAt: string | null;
  workSummary: string | null;
  recommendations: string | null;
  signerName: string | null;
  signedAt: string | null;
  reportHash: string | null;
  hasSignature: boolean;
  cancelReason: string | null;
  client: { id: string; name: string; phone: string | null };
  equipment: {
    id: string;
    name: string;
    brand: string | null;
    model: string | null;
    serialNumber: string | null;
    location: string | null;
  } | null;
  technicians: { memberId: string; name: string; role: FactureRole }[];
  timeEntries: {
    id: string;
    memberId: string;
    technician: string;
    workDate: string;
    minutes: number;
    note: string | null;
  }[];
  totalMinutes: number;
  parts: { id: string; reference: string | null; label: string; unit: string; quantity: number }[];
  photos: { id: string; caption: string | null }[];
  invoice: { id: string; number: string | null; status: FactureDocumentStatus } | null;
  can: { manage: boolean; work: boolean; invoice: boolean };
}

interface CatalogItem {
  id: string;
  kind: 'PRODUCT' | 'SERVICE';
  name: string;
  reference: string | null;
  unit: string;
  unitPrice: number;
}

const dateTimeFr = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'UTC' });
const timeOf = (iso: string) => iso.slice(11, 16);
const today = () => new Date().toISOString().slice(0, 10);
const toError = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.');

/** Intervention : planning, travaux (temps, pièces, photos), rapport, signature du client, facture. */
export default function FactureInterventionPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <FacturePage title="Intervention">
      {({ context }) => <InterventionView id={id} readOnly={context.access !== 'full'} />}
    </FacturePage>
  );
}

function InterventionView({ id, readOnly }: { id: string; readOnly: boolean }) {
  const res = useApi<Intervention>(`/facture/interventions/${id}`);
  if (res.state === 'loading') return <LoadingState />;
  if (res.state === 'error') return <ErrorState error={res.error} onRetry={res.reload} />;
  const i = res.data;
  // Lecture seule (abonnement échu) : aucune action proposée.
  const can = readOnly ? { manage: false, work: false, invoice: false } : i.can;
  const working = i.status === 'IN_PROGRESS' && can.work;
  return (
    <div className="space-y-6" data-testid="facture-intervention" data-status={i.status}>
      <Summary i={i} can={can} reload={res.reload} />
      {can.manage && isFactureInterventionPlanningOpen(i.status) && (
        <EditPlanning i={i} reload={res.reload} />
      )}
      <TimeCard i={i} working={working} canManage={can.manage} reload={res.reload} />
      <PartsCard i={i} working={working} reload={res.reload} />
      <PhotosCard i={i} working={working} reload={res.reload} />
      {working && <CompleteCard id={i.id} draft={i} reload={res.reload} />}
      {i.workSummary && i.status !== 'IN_PROGRESS' && i.status !== 'PLANNED' && (
        <ReportCard i={i} />
      )}
      {i.status === 'COMPLETED' && can.work && <SignCard id={i.id} reload={res.reload} />}
      {i.signedAt && <SignatureCard i={i} />}
      {(i.status === 'SIGNED' || i.invoice) && <InvoiceCard i={i} canInvoice={can.invoice} />}
    </div>
  );
}

/** Action d'API avec erreur affichée et rechargement de l'intervention. */
function useAction(reload: () => void) {
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      reload();
    } catch (err) {
      setError(toError(err));
    } finally {
      setBusy(null);
    }
  };
  return { error, busy, run };
}

function Summary({
  i,
  can,
  reload,
}: {
  i: Intervention;
  can: Intervention['can'];
  reload: () => void;
}) {
  const { error, busy, run } = useAction(reload);
  const rows: [string, ReactNode][] = [
    ['Client', i.client.name],
    ['Créneau', `${dateTimeFr(i.scheduledStart)} → ${timeOf(i.scheduledEnd)} (heure du Mali)`],
    ['Lieu', i.siteAddress ?? '—'],
    ['Contact', [i.contactName, i.contactPhone].filter(Boolean).join(' — ') || '—'],
    [
      'Équipement',
      i.equipment
        ? [
            i.equipment.name,
            [i.equipment.brand, i.equipment.model].filter(Boolean).join(' '),
            i.equipment.serialNumber ? `N° ${i.equipment.serialNumber}` : '',
          ]
            .filter(Boolean)
            .join(' · ')
        : '—',
    ],
    ['Techniciens', i.technicians.map((t) => t.name).join(', ') || 'Aucun'],
    ...(i.startedAt
      ? ([['Début des travaux', dateTimeFr(i.startedAt)]] as [string, string][])
      : []),
    ...(i.completedAt
      ? ([['Fin des travaux', dateTimeFr(i.completedAt)]] as [string, string][])
      : []),
    ...(i.cancelReason ? ([['Motif d’annulation', i.cancelReason]] as [string, string][]) : []),
  ];
  return (
    <Card>
      <CardHeader
        title={`${i.number} · ${i.title}`}
        description={i.description ?? undefined}
        action={<InterventionStatusBadge status={i.status} />}
      />
      <CardBody className="space-y-5">
        <dl className="grid gap-3 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
              <dd className="text-sm text-charcoal">{value}</dd>
            </div>
          ))}
        </dl>
        <ApiErrorAlert error={error} />
        <div className="flex flex-wrap gap-2">
          {i.status === 'PLANNED' && can.work && (
            <Button
              loading={busy === 'start'}
              data-testid="facture-intervention-start"
              onClick={() =>
                run('start', () => api(`/facture/interventions/${i.id}/start`, { method: 'POST' }))
              }
            >
              Démarrer l’intervention
            </Button>
          )}
          {i.status === 'COMPLETED' && can.manage && (
            <Button
              variant="secondary"
              loading={busy === 'reopen'}
              onClick={() =>
                run('reopen', () =>
                  api(`/facture/interventions/${i.id}/reopen`, { method: 'POST' }),
                )
              }
            >
              Rouvrir (avant signature)
            </Button>
          )}
          <a
            href={`/api/v1/facture/interventions/${i.id}/report`}
            className={buttonClass('secondary')}
            data-testid="facture-intervention-report"
          >
            <FileDown className="h-4 w-4" aria-hidden />
            Rapport PDF
          </a>
          {isFactureInterventionPlanningOpen(i.status) && can.manage && (
            <Button
              variant="ghost"
              loading={busy === 'cancel'}
              onClick={() => {
                const reason = window.prompt('Motif de l’annulation (3 caractères au moins) :');
                if (reason)
                  void run('cancel', () =>
                    api(`/facture/interventions/${i.id}/cancel`, {
                      method: 'POST',
                      body: { reason },
                    }),
                  );
              }}
            >
              Annuler l’intervention
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

interface Technician {
  id: string;
  firstName: string;
  lastName: string;
  role: FactureRole;
}

function EditPlanning({ i, reload }: { i: Intervention; reload: () => void }) {
  const technicians = useApi<Technician[]>('/facture/technicians');
  const { error, busy, run } = useAction(reload);
  const [form, setForm] = useState({
    title: i.title,
    date: i.scheduledStart.slice(0, 10),
    start: timeOf(i.scheduledStart),
    end: timeOf(i.scheduledEnd),
  });
  const [technicianIds, setTechnicianIds] = useState(i.technicians.map((t) => t.memberId));
  const set = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
  });
  return (
    <Card>
      <CardHeader
        title="Planning"
        description="Créneau et techniciens, jusqu’à la fin des travaux."
      />
      <CardBody>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void run('save', () =>
              api(`/facture/interventions/${i.id}`, {
                method: 'PATCH',
                body: {
                  title: form.title,
                  scheduledStart: `${form.date}T${form.start}:00Z`,
                  scheduledEnd: `${form.date}T${form.end}:00Z`,
                  technicianIds,
                },
              }),
            );
          }}
        >
          <InputField label="Objet" required minLength={3} maxLength={160} {...set('title')} />
          <InputField label="Date" type="date" required {...set('date')} />
          <InputField label="Début" type="time" required {...set('start')} />
          <InputField label="Fin" type="time" required {...set('end')} />
          {technicians.state === 'success' && (
            <div className="sm:col-span-2">
              <CheckboxGroup
                legend="Techniciens"
                options={technicians.data.map((t) => ({
                  value: t.id,
                  label: `${t.firstName} ${t.lastName} (${FACTURE_ROLE_LABELS[t.role]})`,
                }))}
                value={technicianIds}
                onChange={setTechnicianIds}
              />
            </div>
          )}
          <div className="sm:col-span-2 space-y-3">
            <ApiErrorAlert error={error} />
            <Button type="submit" variant="secondary" loading={busy === 'save'}>
              Enregistrer le planning
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function TimeCard({
  i,
  working,
  canManage,
  reload,
}: {
  i: Intervention;
  working: boolean;
  canManage: boolean;
  reload: () => void;
}) {
  const { error, busy, run } = useAction(reload);
  const [form, setForm] = useState({
    memberId: i.technicians[0]?.memberId ?? '',
    workDate: today(),
    hours: '1',
    minutes: '0',
    note: '',
  });
  const set = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
  });
  return (
    <Card>
      <CardHeader
        title="Temps passé"
        description={`Total : ${formatFactureMinutes(i.totalMinutes)}`}
      />
      <CardBody className="space-y-4">
        {i.timeEntries.length === 0 ? (
          <p className="text-sm text-muted">Aucun temps saisi.</p>
        ) : (
          <ul className="divide-y divide-line/70" data-testid="facture-time-entries">
            {i.timeEntries.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  <span className="font-semibold">{formatFactureMinutes(e.minutes)}</span> ·{' '}
                  {e.technician} · {dateFr(e.workDate)}
                  {e.note && <span className="block text-xs text-muted">{e.note}</span>}
                </span>
                {working && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Supprimer cette saisie"
                    icon={<Trash2 className="h-4 w-4" aria-hidden />}
                    loading={busy === e.id}
                    onClick={() =>
                      run(e.id, () =>
                        api(`/facture/interventions/${i.id}/time/${e.id}`, { method: 'DELETE' }),
                      )
                    }
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {working && (
          <form
            className="grid gap-3 sm:grid-cols-5"
            data-testid="facture-time-form"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void run('add', () =>
                api(`/facture/interventions/${i.id}/time`, {
                  method: 'POST',
                  body: {
                    ...(canManage ? { memberId: form.memberId } : {}),
                    workDate: form.workDate,
                    minutes: Number(form.hours) * 60 + Number(form.minutes),
                    note: form.note || null,
                  },
                }),
              );
            }}
          >
            {canManage && (
              <SelectField
                label="Technicien"
                {...set('memberId')}
                options={i.technicians.map((t) => ({ value: t.memberId, label: t.name }))}
              />
            )}
            <InputField label="Jour" type="date" max={today()} required {...set('workDate')} />
            <InputField label="Heures" type="number" min={0} max={12} required {...set('hours')} />
            <InputField
              label="Minutes"
              type="number"
              min={0}
              max={59}
              required
              {...set('minutes')}
            />
            <InputField label="Note" maxLength={300} {...set('note')} />
            <div className="sm:col-span-5 space-y-3">
              <ApiErrorAlert error={error} />
              <Button type="submit" variant="secondary" loading={busy === 'add'}>
                Ajouter le temps
              </Button>
            </div>
          </form>
        )}
        {!working && <ApiErrorAlert error={error} />}
      </CardBody>
    </Card>
  );
}

function PartsCard({
  i,
  working,
  reload,
}: {
  i: Intervention;
  working: boolean;
  reload: () => void;
}) {
  const items = useApi<CatalogItem[]>(working ? '/facture/items' : null);
  const { error, busy, run } = useAction(reload);
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('1');
  return (
    <Card>
      <CardHeader
        title="Pièces et fournitures"
        description="Articles du catalogue posés sur place."
      />
      <CardBody className="space-y-4">
        {i.parts.length === 0 ? (
          <p className="text-sm text-muted">Aucune pièce.</p>
        ) : (
          <ul className="divide-y divide-line/70" data-testid="facture-parts">
            {i.parts.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  {p.quantity.toLocaleString('fr-FR')} {p.unit} · {p.label}
                  {p.reference && <span className="text-muted"> ({p.reference})</span>}
                </span>
                {working && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Retirer cette pièce"
                    icon={<Trash2 className="h-4 w-4" aria-hidden />}
                    loading={busy === p.id}
                    onClick={() =>
                      run(p.id, () =>
                        api(`/facture/interventions/${i.id}/parts/${p.id}`, { method: 'DELETE' }),
                      )
                    }
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {working && (
          <form
            className="grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end"
            data-testid="facture-part-form"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void run('add', () =>
                api(`/facture/interventions/${i.id}/parts`, {
                  method: 'POST',
                  body: { itemId, quantity: Number(quantity.replace(',', '.')) },
                }),
              );
            }}
          >
            <SelectField
              label="Article"
              required
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
              options={[
                { value: '', label: 'Choisir un article' },
                ...(items.state === 'success'
                  ? items.data.map((it) => ({
                      value: it.id,
                      label: `${it.name}${it.reference ? ` (${it.reference})` : ''}`,
                    }))
                  : []),
              ]}
            />
            <InputField
              label="Quantité"
              inputMode="decimal"
              required
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
            <Button type="submit" variant="secondary" loading={busy === 'add'} disabled={!itemId}>
              Ajouter
            </Button>
          </form>
        )}
        <ApiErrorAlert error={error} />
      </CardBody>
    </Card>
  );
}

function PhotosCard({
  i,
  working,
  reload,
}: {
  i: Intervention;
  working: boolean;
  reload: () => void;
}) {
  const { error, busy, run } = useAction(reload);
  const input = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState('');
  const full = i.photos.length >= FACTURE_MAX_INTERVENTION_PHOTOS;
  return (
    <Card>
      <CardHeader
        title="Photos"
        description={`${i.photos.length} / ${FACTURE_MAX_INTERVENTION_PHOTOS} · avant, pendant et après les travaux.`}
      />
      <CardBody className="space-y-4">
        {i.photos.length === 0 ? (
          <p className="text-sm text-muted">Aucune photo.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="facture-photos">
            {i.photos.map((p) => (
              <li key={p.id} className="space-y-1">
                {/* eslint-disable-next-line @next/next/no-img-element -- image privée servie par l'API */}
                <img
                  src={`/api/v1/facture/interventions/${i.id}/photos/${p.id}`}
                  alt={p.caption ?? 'Photo de l’intervention'}
                  className="aspect-[4/3] w-full rounded-xl border border-line object-cover"
                />
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-xs text-muted">{p.caption ?? ''}</span>
                  {working && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Supprimer cette photo"
                      icon={<Trash2 className="h-4 w-4" aria-hidden />}
                      loading={busy === p.id}
                      onClick={() =>
                        run(p.id, () =>
                          api(`/facture/interventions/${i.id}/photos/${p.id}`, {
                            method: 'DELETE',
                          }),
                        )
                      }
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {working && !full && (
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <InputField
              label="Légende (facultative)"
              maxLength={160}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="sr-only"
              data-testid="facture-photo-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                const form = new FormData();
                form.append('file', file);
                if (caption) form.append('caption', caption);
                void run('upload', async () => {
                  await apiUpload(`/facture/interventions/${i.id}/photos`, form);
                  setCaption('');
                });
              }}
            />
            <Button
              type="button"
              variant="secondary"
              loading={busy === 'upload'}
              icon={<Camera className="h-4 w-4" aria-hidden />}
              onClick={() => input.current?.click()}
            >
              Prendre ou choisir une photo
            </Button>
          </div>
        )}
        <ApiErrorAlert error={error} />
      </CardBody>
    </Card>
  );
}

function CompleteCard({
  id,
  draft,
  reload,
}: {
  id: string;
  draft: Intervention;
  reload: () => void;
}) {
  const { error, busy, run } = useAction(reload);
  const [workSummary, setWorkSummary] = useState(draft.workSummary ?? '');
  const [recommendations, setRecommendations] = useState(draft.recommendations ?? '');
  return (
    <Card>
      <CardHeader
        title="Fin des travaux"
        description="Le rapport est figé ensuite : temps, pièces et photos ne changent plus."
      />
      <CardBody>
        <form
          className="space-y-4"
          data-testid="facture-complete-form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void run('complete', () =>
              api(`/facture/interventions/${id}/complete`, {
                method: 'POST',
                body: { workSummary, recommendations: recommendations || null },
              }),
            );
          }}
        >
          <TextareaField
            label="Travaux réalisés"
            required
            minLength={3}
            maxLength={4000}
            rows={4}
            value={workSummary}
            onChange={(e) => setWorkSummary(e.target.value)}
          />
          <TextareaField
            label="Recommandations"
            maxLength={2000}
            value={recommendations}
            onChange={(e) => setRecommendations(e.target.value)}
          />
          <ApiErrorAlert error={error} />
          <Button type="submit" loading={busy === 'complete'}>
            Terminer les travaux
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function ReportCard({ i }: { i: Intervention }) {
  return (
    <Card>
      <CardHeader title="Rapport" />
      <CardBody className="space-y-3 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Travaux réalisés</p>
          <p className="whitespace-pre-line text-charcoal">{i.workSummary}</p>
        </div>
        {i.recommendations && (
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Recommandations</p>
            <p className="whitespace-pre-line text-charcoal">{i.recommendations}</p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function SignCard({ id, reload }: { id: string; reload: () => void }) {
  const pad = useRef<SignaturePadHandle>(null);
  const { error, busy, run } = useAction(reload);
  const [signerName, setSignerName] = useState('');
  const [signed, setSigned] = useState(false);
  return (
    <Card>
      <CardHeader
        title="Signature du client"
        description="Faites relire le rapport au client puis signer à l’écran. La signature est définitive."
      />
      <CardBody>
        <form
          className="space-y-4"
          data-testid="facture-sign-form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void run('sign', async () => {
              const blob = await pad.current?.toBlob();
              if (!blob) throw new ApiError(400, 'SIGNATURE_REFUSED', 'La signature est vide.');
              const form = new FormData();
              form.append('signerName', signerName);
              form.append('file', blob, 'signature.png');
              await apiUpload(`/facture/interventions/${id}/sign`, form);
            });
          }}
        >
          <InputField
            label="Nom du signataire"
            required
            minLength={2}
            maxLength={120}
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
          />
          <SignaturePad ref={pad} onChange={setSigned} />
          <ApiErrorAlert error={error} />
          <Button type="submit" loading={busy === 'sign'} disabled={!signed}>
            Valider la signature
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function SignatureCard({ i }: { i: Intervention }) {
  return (
    <Card>
      <CardHeader title="Rapport signé" />
      <CardBody>
        <div className="grid gap-4 sm:grid-cols-2" data-testid="facture-signature">
          <div className="space-y-2 text-sm">
            <p>
              Signé par <span className="font-semibold">{i.signerName}</span> le{' '}
              {dateTimeFr(i.signedAt!)}.
            </p>
            <p className="break-all text-xs text-muted">
              Empreinte SHA-256 du rapport signé : {i.reportHash}
            </p>
          </div>
          {i.hasSignature && (
            // eslint-disable-next-line @next/next/no-img-element -- image privée servie par l'API
            <img
              src={`/api/v1/facture/interventions/${i.id}/signature`}
              alt={`Signature de ${i.signerName}`}
              className="max-h-32 rounded-xl border border-line bg-white object-contain"
            />
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function InvoiceCard({ i, canInvoice }: { i: Intervention; canInvoice: boolean }) {
  const router = useRouter();
  const items = useApi<CatalogItem[]>(canInvoice && !i.invoice ? '/facture/items' : null);
  const [laborItemId, setLaborItemId] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  if (i.invoice) {
    return (
      <Card>
        <CardHeader title="Facturation" />
        <CardBody>
          <div
            className="flex flex-wrap items-center gap-3 text-sm"
            data-testid="facture-intervention-invoice"
          >
            <Link
              href={`/facture/documents/${i.invoice.id}`}
              className="font-semibold text-forest hover:underline"
            >
              Facture {i.invoice.number ?? '(brouillon)'}
            </Link>
            <DocumentStatusBadge status={i.invoice.status} />
          </div>
        </CardBody>
      </Card>
    );
  }
  if (!canInvoice) return null;
  const services =
    items.state === 'success' ? items.data.filter((it) => it.kind === 'SERVICE') : [];
  return (
    <Card>
      <CardHeader
        title="Facturer l’intervention"
        description="Une facture brouillon reprend le temps passé et les pièces ; vérifiez-la avant de l’émettre."
      />
      <CardBody className="space-y-4">
        <SelectField
          label="Main-d’œuvre facturée à l’heure"
          hint={`Temps passé : ${formatFactureMinutes(i.totalMinutes)}`}
          value={laborItemId}
          onChange={(e) => setLaborItemId(e.target.value)}
          options={[
            { value: '', label: 'Pas de main-d’œuvre (pièces seulement)' },
            ...services.map((s) => ({
              value: s.id,
              label: `${s.name} — ${formatXof(s.unitPrice)} / ${s.unit}`,
            })),
          ]}
        />
        <ApiErrorAlert error={error} />
        <Button
          loading={busy}
          data-testid="facture-intervention-create-invoice"
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const res = await api<{ invoiceId: string }>(
                `/facture/interventions/${i.id}/invoice`,
                {
                  method: 'POST',
                  body: { laborItemId: laborItemId || null },
                },
              );
              router.push(`/facture/documents/${res.invoiceId}`);
            } catch (err) {
              setError(toError(err));
              setBusy(false);
            }
          }}
        >
          Créer la facture
        </Button>
        {i.status !== 'SIGNED' && (
          <Alert tone="info" title="Seule une intervention signée par le client se facture." />
        )}
      </CardBody>
    </Card>
  );
}

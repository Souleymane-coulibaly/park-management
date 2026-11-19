'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  PRINT_CARD_KIND_LABELS,
  PRINT_ORDER_STATUS_LABELS,
  type PrintCardKind,
} from '@ocall/shared';
import { OrderDialog } from '@/components/print/print-orders';
import type {
  CardSides,
  PrintCardView,
  PrintSettingsView,
  PrintTemplateView,
} from '@/components/print/print-types';
import { CardPreview, CardStatusBadge, shortDate } from '@/components/print/print-ui';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useSchoolText } from './school-language';
import type { SchoolPageApi } from './school-page';
import { useClasses } from './school-students';

export interface SchoolCardView extends PrintCardView {
  holder: {
    lastName: string;
    firstName: string;
    reference: string;
    detail: string | null;
    hasPhoto: boolean;
    active: boolean;
  } | null;
}

const asError = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion au serveur impossible.');

/** Aperçu d'une carte avec un modèle de son établissement (données réelles du dossier). */
export function CardPreviewDialog({
  card,
  schoolId,
  onClose,
}: {
  card: SchoolCardView | null;
  schoolId: string;
  onClose: () => void;
}) {
  const templates = useApi<PrintTemplateView[]>(`/school/card-templates?schoolId=${schoolId}`);
  const usable =
    templates.state === 'success' && card
      ? templates.data.filter((t) => t.kind === card.holderKind)
      : [];
  const [templateId, setTemplateId] = useState<string | null>(null);
  const chosen = templateId ?? usable[0]?.id ?? null;
  const preview = useApi<CardSides>(
    card && chosen ? `/school/cards/${card.id}/preview?templateId=${chosen}` : null,
  );
  return (
    <Dialog
      open={Boolean(card)}
      onClose={onClose}
      title="Aperçu de la carte"
      description={card ? `N° ${card.cardNumber}` : undefined}
    >
      <div className="space-y-4">
        {templates.state === 'loading' && <LoadingState />}
        {templates.state === 'success' && usable.length === 0 && (
          <Alert tone="info">
            Aucun modèle pour ce type de carte : créez-en un dans « Modèles ».
          </Alert>
        )}
        {usable.length > 1 && (
          <SelectField
            label="Modèle"
            value={chosen ?? ''}
            onChange={(e) => setTemplateId(e.target.value)}
            options={usable.map((t) => ({ value: t.id, label: t.name }))}
          />
        )}
        {chosen && preview.state === 'loading' && <LoadingState />}
        {chosen && preview.state === 'error' && (
          <ErrorState error={preview.error} onRetry={preview.reload} />
        )}
        {chosen && preview.state === 'success' && <CardPreview sides={preview.data} compact />}
      </div>
    </Dialog>
  );
}

/** Révocation ou remplacement d'une carte (perte, vol, erreur) : motif obligatoire, tracé. */
function ReasonDialog({
  action,
  card,
  onClose,
  onDone,
}: {
  action: 'revoke' | 'replace' | null;
  card: SchoolCardView | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  if (!card || !action) return null;
  return (
    <Dialog
      open
      onClose={onClose}
      title={action === 'revoke' ? 'Révoquer la carte' : 'Remplacer la carte'}
      description={
        action === 'revoke'
          ? 'Le QR de cette carte sera refusé.'
          : 'Une nouvelle carte (nouveau numéro, nouveau QR) remplace celle-ci, qui est révoquée.'
      }
    >
      <div className="space-y-4">
        <InputField
          label="Motif"
          required
          value={reason}
          maxLength={200}
          onChange={(e) => setReason(e.target.value)}
        />
        <ApiErrorAlert error={error} />
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            Retour
          </Button>
          <Button
            variant={action === 'revoke' ? 'danger' : 'primary'}
            loading={busy}
            disabled={reason.trim().length < 3}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await api(`/school/cards/${card.id}/${action}`, {
                  method: 'POST',
                  body: { reason },
                });
                onDone();
              } catch (e) {
                setError(asError(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Confirmer
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Onglet « Carte » de la fiche élève (langue de l'établissement de l'élève). */
export function StudentCardTab({
  student,
  page,
}: {
  student: { id: string; schoolId: string; cardPhotoDocumentId?: string | null };
  page: SchoolPageApi;
}) {
  const { t } = useSchoolText();
  const cards = useApi<SchoolCardView[]>(
    `/school/cards?schoolId=${student.schoolId}&kind=STUDENT&holderId=${student.id}`,
  );
  const docs = useApi<{ id: string; category: string; displayName: string; createdAt: string }[]>(
    `/school/students/${student.id}/documents`,
  );
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<SchoolCardView | null>(null);
  const [photoVersion, setPhotoVersion] = useState(0);
  const [selected, setSelected] = useState<string | null | undefined>(student.cardPhotoDocumentId);
  const canManage = page.canWrite('school.cards.manage');
  const photos = docs.state === 'success' ? docs.data.filter((d) => d.category === 'PHOTO') : [];
  const active =
    cards.state === 'success' ? cards.data.find((c) => c.status === 'ACTIVE') : undefined;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await api('/school/cards/students', { method: 'POST', body: { studentIds: [student.id] } });
      cards.reload();
    } catch (e) {
      setError(asError(e));
    } finally {
      setBusy(false);
    }
  }

  async function choose(documentId: string) {
    setError(null);
    try {
      await api(`/school/students/${student.id}/card-photo`, {
        method: 'PUT',
        body: { documentId },
      });
      setSelected(documentId);
      setPhotoVersion((v) => v + 1);
    } catch (e) {
      setError(asError(e));
    }
  }

  return (
    <Card>
      <CardHeader
        title={t('card.title')}
        action={
          <Link href="/school/cartes" className="text-sm font-semibold text-forest hover:underline">
            {t('card.manage')}
          </Link>
        }
      />
      <CardBody className="space-y-5" data-testid="student-card-tab">
        {cards.state === 'loading' && <LoadingState />}
        {cards.state === 'error' && <ErrorState error={cards.error} onRetry={cards.reload} />}
        {cards.state === 'success' && (
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0 space-y-3">
              {active ? (
                <dl className="grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-muted">{t('card.number')}</dt>
                    <dd className="font-mono" dir="ltr" data-testid="student-card-number">
                      {active.cardNumber}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">{t('card.validUntil')}</dt>
                    <dd dir="ltr">{shortDate(active.validUntil)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">{t('card.print')}</dt>
                    <dd>
                      {active.print ? (
                        <Link
                          href={`/school/cartes/commandes/${active.print.orderId}`}
                          className="text-forest hover:underline"
                        >
                          {active.print.orderNumber} —{' '}
                          {PRINT_ORDER_STATUS_LABELS[active.print.orderStatus]}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-muted">{t('card.none')}</p>
              )}
              <div className="flex flex-wrap gap-3">
                {!active && canManage && (
                  <Button
                    onClick={() => void create()}
                    loading={busy}
                    data-testid="student-card-create"
                  >
                    {t('card.create')}
                  </Button>
                )}
                {active && (
                  <Button variant="secondary" onClick={() => setPreview(active)}>
                    {t('card.preview')}
                  </Button>
                )}
              </div>
              <ApiErrorAlert error={error} />
            </div>
            <div className="w-32 shrink-0">
              <p className="mb-1 text-xs text-muted">{t('card.photo')}</p>
              {photos.length > 0 ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/v1/school/students/${student.id}/card-photo?v=${photoVersion}`}
                  alt={t('card.photo')}
                  className="aspect-[3/4] w-32 rounded-lg border border-line object-cover"
                />
              ) : (
                <div className="grid aspect-[3/4] w-32 place-items-center rounded-lg border border-dashed border-line text-xs text-muted">
                  —
                </div>
              )}
            </div>
          </div>
        )}
        {photos.length === 0 && docs.state === 'success' && (
          <Alert tone="info">{t('card.photo.missing')}</Alert>
        )}
        {photos.length > 1 && canManage && (
          <ul className="space-y-2 text-sm">
            {photos.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-words">{p.displayName}</span>
                {selected === p.id ? (
                  <span className="font-semibold text-forest">{t('card.photo.selected')}</span>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => void choose(p.id)}>
                    {t('card.photo.choose')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <CardPreviewDialog
        card={preview}
        schoolId={student.schoolId}
        onClose={() => setPreview(null)}
      />
    </Card>
  );
}

/** Gestion des cartes d'un établissement : liste, sélection, création par classe, commande. */
export function SchoolCardsManager({ page }: { page: SchoolPageApi }) {
  const router = useRouter();
  const school = page.school!;
  const [kind, setKind] = useState<PrintCardKind>('STUDENT');
  const [status, setStatus] = useState<'ACTIVE' | 'REVOKED'>('ACTIVE');
  const cards = useApi<SchoolCardView[]>(
    `/school/cards?schoolId=${school.id}&kind=${kind}&status=${status}`,
  );
  const templates = useApi<PrintTemplateView[]>(`/school/card-templates?schoolId=${school.id}`);
  const settings = useApi<PrintSettingsView>('/school/cards/settings');
  const [selection, setSelection] = useState<string[]>([]);
  const [preview, setPreview] = useState<SchoolCardView | null>(null);
  const [reasonFor, setReasonFor] = useState<{
    action: 'revoke' | 'replace';
    card: SchoolCardView;
  } | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const [classOpen, setClassOpen] = useState(false);
  const canManage = page.canWrite('school.cards.manage');
  const canOrder = page.canWrite('school.cards.order');

  if (settings.state === 'success' && settings.data.enabled === false)
    return <Alert tone="info">Les cartes ne sont pas disponibles pour le moment.</Alert>;

  const list = cards.state === 'success' ? cards.data : [];
  // Commandables : actives, jamais imprimées ni en cours (ou refusées/annulées par l'atelier).
  const orderable = (c: SchoolCardView) =>
    c.status === 'ACTIVE' &&
    (!c.print || c.print.itemStatus === 'REJECTED' || c.print.itemStatus === 'CANCELLED');
  const toggle = (id: string) =>
    setSelection((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-56">
          <SelectField
            label="Type"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as PrintCardKind);
              setSelection([]);
            }}
            options={[
              { value: 'STUDENT', label: 'Cartes scolaires' },
              { value: 'STAFF', label: 'Badges du personnel' },
            ]}
          />
        </div>
        <div className="w-full sm:w-44">
          <SelectField
            label="État"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as 'ACTIVE' | 'REVOKED');
              setSelection([]);
            }}
            options={[
              { value: 'ACTIVE', label: 'Actives' },
              { value: 'REVOKED', label: 'Révoquées' },
            ]}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && kind === 'STUDENT' && (
            <Button
              variant="secondary"
              onClick={() => setClassOpen(true)}
              data-testid="cards-class-open"
            >
              Créer les cartes d’une classe
            </Button>
          )}
          {canOrder && (
            <Button
              disabled={selection.length === 0}
              onClick={() => setOrderOpen(true)}
              data-testid="cards-order-open"
            >
              Commander ({selection.length})
            </Button>
          )}
        </div>
      </div>
      {cards.state === 'loading' && <LoadingState />}
      {cards.state === 'error' && <ErrorState error={cards.error} onRetry={cards.reload} />}
      {cards.state === 'success' && list.length === 0 && (
        <Card>
          <EmptyState
            icon={<span aria-hidden>🪪</span>}
            title="Aucune carte"
            description={
              kind === 'STUDENT'
                ? 'Créez les cartes depuis la fiche d’un élève inscrit ou pour toute une classe.'
                : 'Créez les badges depuis la page Personnel.'
            }
          />
        </Card>
      )}
      {list.length > 0 && (
        <Card>
          <Table head={['', 'Titulaire', 'Référence', 'Photo', 'N° de carte', 'Impression', '']}>
            {list.map((c) => (
              <tr key={c.id} data-testid="school-card-row">
                <Td>
                  {canOrder && orderable(c) && (
                    <input
                      type="checkbox"
                      aria-label={`Sélectionner ${c.holder?.lastName ?? c.cardNumber}`}
                      checked={selection.includes(c.id)}
                      onChange={() => toggle(c.id)}
                      className="h-4 w-4 accent-forest"
                    />
                  )}
                </Td>
                <Td>
                  {c.holder ? `${c.holder.lastName.toUpperCase()} ${c.holder.firstName}` : '—'}
                  {c.holder && !c.holder.active && (
                    <span className="ml-2 text-xs text-terracotta-dark">sorti ou inactif</span>
                  )}
                </Td>
                <Td className="font-mono text-xs">{c.holder?.reference ?? '—'}</Td>
                <Td>
                  {c.holder?.hasPhoto ? (
                    'Oui'
                  ) : (
                    <span className="text-terracotta-dark">Manquante</span>
                  )}
                </Td>
                <Td className="font-mono text-xs">{c.cardNumber}</Td>
                <Td>
                  {c.status === 'REVOKED' ? (
                    <CardStatusBadge status="REVOKED" />
                  ) : c.print ? (
                    <Link
                      href={`/school/cartes/commandes/${c.print.orderId}`}
                      className="text-forest hover:underline"
                    >
                      {c.print.orderNumber} — {PRINT_ORDER_STATUS_LABELS[c.print.orderStatus]}
                    </Link>
                  ) : (
                    'À commander'
                  )}
                </Td>
                <Td>
                  <div className="flex flex-wrap justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setPreview(c)}>
                      Aperçu
                    </Button>
                    {canManage && c.status === 'ACTIVE' && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setReasonFor({ action: 'replace', card: c })}
                        >
                          Remplacer
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setReasonFor({ action: 'revoke', card: c })}
                        >
                          Révoquer
                        </Button>
                      </>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      <CardPreviewDialog card={preview} schoolId={school.id} onClose={() => setPreview(null)} />
      <ReasonDialog
        action={reasonFor?.action ?? null}
        card={reasonFor?.card ?? null}
        onClose={() => setReasonFor(null)}
        onDone={() => {
          setReasonFor(null);
          cards.reload();
        }}
      />
      {classOpen && (
        <ClassCardsDialog
          schoolId={school.id}
          onClose={() => setClassOpen(false)}
          onDone={() => {
            setClassOpen(false);
            cards.reload();
          }}
        />
      )}
      {orderOpen && templates.state === 'success' && settings.state === 'success' && (
        <OrderDialog
          open
          onClose={() => setOrderOpen(false)}
          submitPath="/school/card-orders"
          extraBody={{ schoolId: school.id }}
          cardIds={selection}
          kind={kind}
          templates={templates.data}
          unitPrice={settings.data.unitPrice}
          defaults={{ address: '', contactName: '', contactPhone: '' }}
          onDone={(order) => router.push(`/school/cartes/commandes/${order.id}`)}
        />
      )}
    </div>
  );
}

function ClassCardsDialog({
  schoolId,
  onClose,
  onDone,
}: {
  schoolId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const years = useApi<{ id: string; label: string; status: string }[]>(
    `/school/years?schoolId=${schoolId}`,
  );
  const yearList = years.state === 'success' ? years.data.filter((y) => y.status !== 'CLOSED') : [];
  const [yearId, setYearId] = useState<string | null>(null);
  const year = yearId ?? yearList.find((y) => y.status === 'ACTIVE')?.id ?? yearList[0]?.id ?? null;
  const classes = useClasses(year);
  const [classId, setClassId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<number | null>(null);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Créer les cartes d’une classe"
      description="Élèves inscrits (inscription validée) ; ceux qui ont déjà une carte la gardent."
    >
      <div className="space-y-4">
        <SelectField
          label="Année scolaire"
          value={year ?? ''}
          onChange={(e) => setYearId(e.target.value)}
          options={yearList.map((y) => ({ value: y.id, label: y.label }))}
        />
        <SelectField
          label="Classe"
          value={classId}
          onChange={(e) => setClassId(e.target.value)}
          options={[
            { value: '', label: 'Toutes les classes de l’année' },
            ...classes.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <ApiErrorAlert error={error} />
        {done !== null && <Alert tone="success">{done} carte(s) prêtes.</Alert>}
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={done !== null ? onDone : onClose}>
            {done !== null ? 'Fermer' : 'Annuler'}
          </Button>
          {done === null && (
            <Button
              loading={busy}
              disabled={!year}
              data-testid="cards-class-submit"
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const res = await api<unknown[]>('/school/cards/class', {
                    method: 'POST',
                    body: { schoolYearId: year, classId: classId || null },
                  });
                  setDone(res.length);
                } catch (e) {
                  setError(asError(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Créer les cartes
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

export const kindLabel = (k: PrintCardKind) => PRINT_CARD_KIND_LABELS[k];

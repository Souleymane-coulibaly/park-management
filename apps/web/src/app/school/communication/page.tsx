'use client';

import { useState } from 'react';
import {
  SCHOOL_ANNOUNCEMENTS_PAGE,
  SCHOOL_ANNOUNCEMENT_AUDIENCES,
  SCHOOL_SMS_STATUSES,
  SMS_TOPUP_MAX_CREDITS,
  SMS_TOPUP_MIN_CREDITS,
  type SchoolAnnouncementAudience,
  type SchoolAnnouncementStatus,
  type SchoolSmsStatus,
  type SchoolTextKey,
  formatXof,
  hasSchoolPermission,
  smsTopUpQuote,
} from '@ocall/shared';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { SchoolPage, type SchoolPageApi } from '@/components/school/school-page';
import { useClasses, useYears } from '@/components/school/school-students';
import type { AssignmentView } from '@/components/school/school-teaching';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useCursorPages } from '@/lib/use-cursor-pages';

interface AnnouncementRow {
  id: string;
  title: string;
  audience: SchoolAnnouncementAudience;
  status: SchoolAnnouncementStatus;
  expiresOn: string | null;
  publishedAt: string | null;
  createdAt: string;
}

interface AnnouncementDetail extends AnnouncementRow {
  body: string;
  titleAr: string | null;
  bodyAr: string | null;
  targetIds: string[];
  events: { id: string; action: string; actor: string | null; createdAt: string }[];
}

interface SmsHistory {
  items: {
    id: string;
    phone: string;
    kind: string;
    status: SmsStatus;
    attempts: number;
    lastError: string | null;
    createdAt: string;
    creditsReserved: number;
  }[];
  nextCursor: string | null;
}
type SmsStatus = SchoolSmsStatus;

/** Communication avec les familles (Sprint 6) : annonces et, pour la direction, SMS. */
export default function CommunicationPage() {
  return (
    <SchoolPage title="com.title" description="com.desc">
      {(page) => <Communication key={page.school!.id} page={page} schoolId={page.school!.id} />}
    </SchoolPage>
  );
}

function Communication({ page, schoolId }: { page: SchoolPageApi; schoolId: string }) {
  const { t, date } = useSchoolText();
  const manages = hasSchoolPermission(page.context.role, 'school.announcements.manage');
  const canWrite = page.canWrite('school.announcements.class');
  const [status, setStatus] = useState<SchoolAnnouncementStatus | ''>('');
  const [listPage, setListPage] = useState(0);
  const list = useApi<AnnouncementRow[]>(
    `/school/announcements?schoolId=${schoolId}${status ? `&status=${status}` : ''}&page=${listPage}`,
  );
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div className="max-w-xs">
          <SelectField
            label={t('com.status')}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as SchoolAnnouncementStatus | '');
              setListPage(0);
            }}
            options={[
              { value: '', label: '—' },
              { value: 'DRAFT', label: t('com.st.DRAFT') },
              { value: 'PUBLISHED', label: t('com.st.PUBLISHED') },
              { value: 'ARCHIVED', label: t('com.st.ARCHIVED') },
            ]}
          />
        </div>
        {canWrite && (
          <Button onClick={() => setEditing('new')} data-testid="announcement-new">
            {t('com.new')}
          </Button>
        )}
      </div>
      {editing && (
        <Editor
          key={editing}
          id={editing === 'new' ? null : editing}
          schoolId={schoolId}
          manages={manages}
          teacher={page.context.role === 'TEACHER'}
          canWrite={canWrite}
          onDone={() => {
            setEditing(null);
            list.reload();
          }}
        />
      )}
      {list.state === 'loading' ? (
        <LoadingState />
      ) : list.state === 'error' ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : list.data.length === 0 && listPage === 0 ? (
        <Alert tone="info" title={t('com.none')} />
      ) : (
        <Card>
          <ul className="divide-y divide-line/70" data-testid="announcement-list">
            {list.data.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm"
              >
                <div>
                  <p className="font-medium">{a.title}</p>
                  <p className="text-xs text-muted">
                    {t(`com.aud.${a.audience}`)} · {date(a.publishedAt ?? a.createdAt)}
                  </p>
                </div>
                <span className="flex items-center gap-2">
                  <Badge
                    tone={
                      a.status === 'PUBLISHED'
                        ? 'forest'
                        : a.status === 'DRAFT'
                          ? 'savanna'
                          : 'neutral'
                    }
                  >
                    {t(`com.st.${a.status}`)}
                  </Badge>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(a.id)}>
                    {t('com.edit')}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {list.state === 'success' &&
        (listPage > 0 || list.data.length === SCHOOL_ANNOUNCEMENTS_PAGE) && (
          <div className="flex justify-between gap-2" data-testid="announcement-pager">
            <Button
              size="sm"
              variant="secondary"
              disabled={listPage === 0}
              onClick={() => setListPage((p) => p - 1)}
            >
              {t('common.previous')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={list.data.length < SCHOOL_ANNOUNCEMENTS_PAGE}
              onClick={() => setListPage((p) => p + 1)}
            >
              {t('common.next')}
            </Button>
          </div>
        )}
      {hasSchoolPermission(page.context.role, 'school.sms.manage') && (
        <Sms schoolId={schoolId} canWrite={page.canWrite('school.sms.manage')} />
      )}
    </>
  );
}

function Editor({
  id,
  schoolId,
  manages,
  teacher,
  canWrite,
  onDone,
}: {
  id: string | null;
  schoolId: string;
  manages: boolean;
  teacher: boolean;
  canWrite: boolean;
  onDone: () => void;
}) {
  const { t, date, showArabic } = useSchoolText();
  const detail = useApi<AnnouncementDetail>(id ? `/school/announcements/${id}` : null);
  if (id && detail.state === 'loading') return <LoadingState />;
  if (id && detail.state === 'error')
    return <ErrorState error={detail.error} onRetry={detail.reload} />;
  const current = id && detail.state === 'success' ? detail.data : null;
  return (
    <EditorForm
      current={current}
      schoolId={schoolId}
      manages={manages}
      teacher={teacher}
      canWrite={canWrite}
      showArabic={showArabic}
      onDone={onDone}
      history={
        current && (
          <ul
            className="mt-3 border-t border-line pt-2 text-xs text-muted"
            data-testid="announcement-history"
          >
            {current.events.map((e) => (
              <li key={e.id}>
                {date(e.createdAt)} · {t(`com.ev.${e.action as 'created'}`)}
                {e.actor ? ` · ${e.actor}` : ''}
              </li>
            ))}
          </ul>
        )
      }
    />
  );
}

function EditorForm({
  current,
  schoolId,
  manages,
  teacher,
  canWrite,
  showArabic,
  onDone,
  history,
}: {
  current: AnnouncementDetail | null;
  schoolId: string;
  manages: boolean;
  teacher: boolean;
  canWrite: boolean;
  showArabic: boolean;
  onDone: () => void;
  history: React.ReactNode;
}) {
  const { t } = useSchoolText();
  const draft = !current || current.status === 'DRAFT';
  const [title, setTitle] = useState(current?.title ?? '');
  const [body, setBody] = useState(current?.body ?? '');
  const [titleAr, setTitleAr] = useState(current?.titleAr ?? '');
  const [bodyAr, setBodyAr] = useState(current?.bodyAr ?? '');
  const [audience, setAudience] = useState<SchoolAnnouncementAudience>(
    current?.audience ?? (manages ? 'SCHOOL' : 'CLASS'),
  );
  const [targets, setTargets] = useState<string[]>(current?.targetIds ?? []);
  const [expiresOn, setExpires] = useState(current?.expiresOn ?? '');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const editable = draft && canWrite;
  const audiences = manages ? SCHOOL_ANNOUNCEMENT_AUDIENCES : (['CLASS'] as const);

  async function run(work: () => Promise<unknown>) {
    setLoading(true);
    setError(null);
    try {
      await work();
      onDone();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoading(false);
    }
  }

  const payload = () => ({
    schoolId,
    title,
    body,
    titleAr: titleAr.trim() || null,
    bodyAr: bodyAr.trim() || null,
    audience,
    targetIds: audience === 'SCHOOL' ? [] : targets,
    expiresOn: expiresOn || null,
  });

  const save = async () => {
    if (current)
      return api(`/school/announcements/${current.id}`, { method: 'PUT', body: payload() });
    return api<{ id: string }>('/school/announcements', { method: 'POST', body: payload() });
  };

  return (
    <Card>
      <CardBody>
        <div className="space-y-3" data-testid="announcement-editor">
          <ApiErrorAlert error={error} />
          <div className="grid gap-3 sm:grid-cols-2">
            <InputField
              label={t('com.titleField')}
              value={title}
              maxLength={160}
              disabled={!editable}
              onChange={(e) => setTitle(e.target.value)}
            />
            <SelectField
              label={t('com.audience')}
              value={audience}
              disabled={!editable}
              onChange={(e) => {
                setAudience(e.target.value as SchoolAnnouncementAudience);
                setTargets([]);
              }}
              options={audiences.map((a) => ({ value: a, label: t(`com.aud.${a}`) }))}
            />
          </div>
          <label className="block text-sm font-medium">
            {t('com.body')}
            <textarea
              className="mt-1 block min-h-28 w-full rounded-xl border border-line bg-white p-2 text-sm"
              value={body}
              maxLength={4000}
              disabled={!editable}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          {showArabic && (
            <div className="grid gap-3 sm:grid-cols-2" dir="rtl">
              <InputField
                label={t('com.titleAr')}
                value={titleAr}
                maxLength={160}
                disabled={!editable}
                onChange={(e) => setTitleAr(e.target.value)}
              />
              <label className="block text-sm font-medium">
                {t('com.bodyAr')}
                <textarea
                  className="mt-1 block min-h-20 w-full rounded-xl border border-line bg-white p-2 text-sm"
                  value={bodyAr}
                  maxLength={4000}
                  disabled={!editable}
                  onChange={(e) => setBodyAr(e.target.value)}
                />
              </label>
            </div>
          )}
          {audience !== 'SCHOOL' && (
            <Targets
              schoolId={schoolId}
              audience={audience}
              teacher={teacher}
              selected={targets}
              disabled={!editable}
              onChange={setTargets}
            />
          )}
          <div className="max-w-xs">
            <InputField
              label={t('com.expiresOn')}
              type="date"
              value={expiresOn}
              disabled={!editable}
              onChange={(e) => setExpires(e.target.value)}
            />
          </div>
          {canWrite && (
            <div className="flex flex-wrap gap-2">
              {draft && (
                <>
                  <Button
                    variant="secondary"
                    loading={loading}
                    disabled={title.trim().length < 3 || !body.trim()}
                    onClick={() => void run(save)}
                  >
                    {t('com.saveDraft')}
                  </Button>
                  <Button
                    loading={loading}
                    disabled={title.trim().length < 3 || !body.trim()}
                    onClick={() =>
                      void run(async () => {
                        const saved = (await save()) as { id: string } | undefined;
                        const target = current?.id ?? saved?.id;
                        if (target)
                          await api(`/school/announcements/${target}/publish`, { method: 'POST' });
                      })
                    }
                    data-testid="announcement-publish"
                  >
                    {t('com.publish')}
                  </Button>
                </>
              )}
              {current && current.status !== 'ARCHIVED' && (
                <Button
                  variant="ghost"
                  loading={loading}
                  onClick={() =>
                    void run(() =>
                      api(`/school/announcements/${current.id}/archive`, { method: 'POST' }),
                    )
                  }
                >
                  {t('com.archive')}
                </Button>
              )}
            </div>
          )}
          {history}
        </div>
      </CardBody>
    </Card>
  );
}

/** Choix des destinataires : classes de l'année en cours, ou recherche d'élèves et de responsables. */
function Targets({
  schoolId,
  audience,
  teacher,
  selected,
  disabled,
  onChange,
}: {
  schoolId: string;
  audience: Exclude<SchoolAnnouncementAudience, 'SCHOOL'>;
  teacher: boolean;
  selected: string[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
}) {
  const { t, name } = useSchoolText();
  const years = useYears(schoolId);
  const yearId =
    years.state === 'success'
      ? ((years.data.find((y) => y.status === 'ACTIVE') ?? years.data[0])?.id ?? null)
      : null;
  const classes = useClasses(audience === 'CLASS' ? yearId : null);
  const mine = useApi<AssignmentView[]>(
    teacher && audience === 'CLASS' ? '/school/teaching/mine' : null,
  );
  const own = mine.state === 'success' ? new Set(mine.data.map((a) => a.class.id)) : null;
  const [q, setQ] = useState('');
  const search = useApi<{
    items: { id: string; lastName: string; firstName: string; matricule: string }[];
  }>(
    audience === 'STUDENTS' && q.trim().length >= 2
      ? `/school/students?schoolId=${schoolId}&q=${encodeURIComponent(q)}`
      : null,
  );
  const guardians = useApi<{ id: string; lastName: string; firstName: string; phone: string }[]>(
    audience === 'GUARDIANS' && q.trim().length >= 2
      ? `/school/guardians?schoolId=${schoolId}&q=${encodeURIComponent(q)}`
      : null,
  );
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const options: { id: string; label: string }[] =
    audience === 'CLASS'
      ? classes.filter((c) => !teacher || own?.has(c.id)).map((c) => ({ id: c.id, label: name(c) }))
      : audience === 'STUDENTS'
        ? search.state === 'success'
          ? search.data.items.map((s) => ({
              id: s.id,
              label: `${s.lastName} ${s.firstName} · ${s.matricule}`,
            }))
          : []
        : guardians.state === 'success'
          ? guardians.data.map((g) => ({ id: g.id, label: `${g.lastName} ${g.firstName}` }))
          : [];
  return (
    <fieldset
      className="space-y-2 rounded-xl border border-line p-3"
      data-testid="announcement-targets"
    >
      <legend className="px-1 text-sm font-medium">
        {t('com.targets')} · {t('com.selected', { n: selected.length })}
      </legend>
      {audience !== 'CLASS' && (
        <InputField
          label={t('com.search')}
          value={q}
          disabled={disabled}
          onChange={(e) => setQ(e.target.value)}
        />
      )}
      <ul className="grid gap-1 sm:grid-cols-2">
        {options.map((o) => (
          <li key={o.id}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(o.id)}
                disabled={disabled}
                onChange={() => toggle(o.id)}
              />
              {o.label}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function Sms({ schoolId, canWrite }: { schoolId: string; canWrite: boolean }) {
  const { t, date } = useSchoolText();
  const settings = useApi<{ enabled: boolean; provider: string }>(
    `/school/sms/settings?schoolId=${schoolId}`,
  );
  // Filtre de statut (accès direct aux échecs) et pages déjà parcourues (curseurs fournis par l'API).
  const [status, setStatus] = useState<SmsStatus | ''>('');
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors[cursors.length - 1];
  const query = new URLSearchParams({
    schoolId,
    ...(status ? { status } : {}),
    ...(cursor ? { cursor } : {}),
  }).toString();
  const history = useApi<SmsHistory>(`/school/sms/messages?${query}`);
  const [error, setError] = useState<ApiError | null>(null);

  async function toggle(enabled: boolean) {
    setError(null);
    try {
      await api('/school/sms/settings', { method: 'PUT', body: { schoolId, enabled } });
      settings.reload();
    } catch (e) {
      setError(toApiError(e));
    }
  }

  return (
    <Card>
      <CardBody>
        <h2 className="mb-2 font-semibold">{t('com.sms')}</h2>
        <ApiErrorAlert error={error} />
        {settings.state === 'success' && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.data.enabled}
                disabled={!canWrite}
                onChange={(e) => void toggle(e.target.checked)}
                data-testid="sms-enabled"
              />
              {t('com.smsEnabled')}
            </label>
            {settings.data.provider === 'simulated' && (
              <Alert tone="info" title={t('com.smsSimulated')} />
            )}
          </div>
        )}
        <SmsWallet schoolId={schoolId} canWrite={canWrite} />
        <h3 className="mt-3 text-sm font-semibold">{t('com.smsHistory')}</h3>
        <div className="max-w-xs">
          <SelectField
            label={t('com.status')}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as SmsStatus | '');
              setCursors([]);
            }}
            options={[
              { value: '', label: t('common.all') },
              ...SCHOOL_SMS_STATUSES.map((s) => ({ value: s, label: t(`com.sms.${s}`) })),
            ]}
          />
        </div>
        {history.state === 'success' && history.data.items.length === 0 ? (
          <p className="text-sm text-muted">{t('com.smsNone')}</p>
        ) : history.state === 'success' ? (
          <ul className="divide-y divide-line/70 text-sm" data-testid="sms-history">
            {history.data.items.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span dir="ltr">{m.phone}</span>
                <span className="text-xs text-muted">
                  {date(m.createdAt)} · {t('com.attempts', { n: m.attempts })}
                  {m.creditsReserved > 0 ? ` · ${t('com.credits', { n: m.creditsReserved })}` : ''}
                  {m.lastError ? ` · ${smsErrorLabel(t, m.lastError)}` : ''}
                </span>
                <Badge
                  tone={
                    m.status === 'SENT'
                      ? 'forest'
                      : m.status === 'FAILED'
                        ? 'terracotta'
                        : m.status === 'CANCELLED'
                          ? 'neutral'
                          : 'savanna'
                  }
                >
                  {t(`com.sms.${m.status}`)}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
        {history.state === 'success' && (cursors.length > 0 || history.data.nextCursor) && (
          <div className="mt-2 flex justify-between gap-2" data-testid="sms-pager">
            <Button
              size="sm"
              variant="secondary"
              disabled={cursors.length === 0}
              onClick={() => setCursors((c) => c.slice(0, -1))}
            >
              {t('common.previous')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!history.data.nextCursor}
              onClick={() => {
                const next = history.data.nextCursor;
                if (next) setCursors((c) => [...c, next]);
              }}
            >
              {t('common.next')}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

type Translate = ReturnType<typeof useSchoolText>['t'];

/** Motif lisible d'une annulation ou d'un échec (code technique conservé s'il est inconnu). */
function smsErrorLabel(t: Translate, code: string): string {
  const key = `com.smsError.${code}` as SchoolTextKey;
  const label = t(key);
  return label === key ? code : label;
}

interface SmsWalletView {
  balance: number;
  reserved: number;
  consumed: number;
  included: boolean;
  tariff: {
    creditPriceXof: number | null;
    internationalAllowed: boolean;
    internationalCreditsPerSegment: number | null;
  } | null;
  pendingRequest: { id: string; creditsRequested: number; quotedAmountXof: number | null } | null;
}

interface TopUpView {
  id: string;
  creditsRequested: number;
  creditsGranted: number | null;
  quotedAmountXof: number | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  handlingNote: string | null;
  createdAt: string;
}

interface LedgerView {
  items: {
    id: string;
    kind: 'TOPUP' | 'RESERVE' | 'CAPTURE' | 'RELEASE' | 'ADJUSTMENT';
    availableDelta: number;
    balanceAfter: number;
    reason: string | null;
    createdAt: string;
  }[];
  nextCursor: string | null;
}

/**
 * Portefeuille SMS prépayé de l'établissement (Sprint S2) : solde, réservations et consommation, demande
 * de recharge (paiement hors plateforme, crédit après validation d'Ocall), demandes et opérations.
 */
function SmsWallet({ schoolId, canWrite }: { schoolId: string; canWrite: boolean }) {
  const { t, date } = useSchoolText();
  const wallet = useApi<SmsWalletView>(`/school/sms/wallet?schoolId=${schoolId}`);
  const topUps = useCursorPages<TopUpView>(`/school/sms/top-ups?schoolId=${schoolId}`);
  const ledger = useCursorPages<LedgerView['items'][number]>(
    `/school/sms/ledger?schoolId=${schoolId}`,
  );
  const [credits, setCredits] = useState(String(SMS_TOPUP_MIN_CREDITS * 10));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reloadAll = () => {
    wallet.reload();
    topUps.reload();
    ledger.reload();
  };

  async function request() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api('/school/sms/top-ups', {
        method: 'POST',
        body: { schoolId, credits: Number(credits), note: note.trim() || null },
      });
      setNotice(t('com.topUpSent'));
      setNote('');
      reloadAll();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/school/sms/top-ups/${id}/cancel`, { method: 'POST', body: { schoolId } });
      reloadAll();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setBusy(false);
    }
  }

  if (wallet.state === 'loading') return <LoadingState />;
  if (wallet.state === 'error') return <ErrorState error={wallet.error} onRetry={wallet.reload} />;
  const w = wallet.data;
  const amount = Number(credits);
  const valid =
    Number.isInteger(amount) && amount >= SMS_TOPUP_MIN_CREDITS && amount <= SMS_TOPUP_MAX_CREDITS;
  const quote = valid ? smsTopUpQuote(amount, w.tariff?.creditPriceXof ?? null) : null;

  return (
    <section
      className="mt-4 space-y-3 rounded-xl border border-line/80 p-3"
      data-testid="sms-wallet"
    >
      <h3 className="text-sm font-semibold">{t('com.wallet')}</h3>
      <dl className="grid grid-cols-3 gap-2 text-center">
        {[
          { label: t('com.walletBalance'), value: w.balance, testId: 'sms-balance' },
          { label: t('com.walletReserved'), value: w.reserved, testId: 'sms-reserved' },
          { label: t('com.walletConsumed'), value: w.consumed, testId: 'sms-consumed' },
        ].map((x) => (
          <div key={x.testId} className="min-w-0 rounded-lg bg-savanna-light/40 p-2">
            <dt className="text-xs text-muted">{x.label}</dt>
            <dd className="font-display text-xl font-bold" data-testid={x.testId}>
              {x.value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted">
        {t('com.walletUnit')}
        {w.tariff?.internationalCreditsPerSegment
          ? ` ${t('com.walletInternational', { n: w.tariff.internationalCreditsPerSegment })}`
          : ''}
      </p>
      {!w.included && <Alert tone="info" title={t('com.walletNotIncluded')} />}
      {w.included && w.balance === 0 && <Alert tone="error" title={t('com.walletEmpty')} />}
      <ApiErrorAlert error={error} />
      {notice && (
        <p className="text-sm text-forest" role="status">
          {notice}
        </p>
      )}
      {w.pendingRequest ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-savanna-light/40 p-2 text-sm"
          data-testid="sms-topup-pending"
        >
          <span>
            {t('com.topUpPending', { n: w.pendingRequest.creditsRequested })}
            {w.pendingRequest.quotedAmountXof !== null
              ? ` · ${t('com.topUpQuote', { amount: formatXof(w.pendingRequest.quotedAmountXof) })}`
              : ''}
          </span>
          {canWrite && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void cancel(w.pendingRequest!.id)}
            >
              {t('com.topUpCancel')}
            </Button>
          )}
        </div>
      ) : (
        w.included &&
        canWrite && (
          <form
            className="grid gap-2 sm:grid-cols-[10rem_1fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void request();
            }}
            data-testid="sms-topup-form"
          >
            <InputField
              label={t('com.topUpCredits')}
              type="number"
              min={SMS_TOPUP_MIN_CREDITS}
              max={SMS_TOPUP_MAX_CREDITS}
              step={1}
              value={credits}
              onChange={(e) => setCredits(e.target.value)}
              required
            />
            <InputField
              label={t('com.topUpNote')}
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button type="submit" size="sm" disabled={busy || !valid}>
              {t('com.topUp')}
            </Button>
            <p className="text-xs text-muted sm:col-span-3">
              {quote !== null
                ? t('com.topUpQuote', { amount: formatXof(quote) })
                : t('com.topUpNoPrice')}{' '}
              {t('com.topUpOffline')}
            </p>
          </form>
        )
      )}
      {topUps.state === 'ready' && topUps.items.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-semibold">{t('com.topUps')}</summary>
          <ul className="mt-1 divide-y divide-line/70 text-sm" data-testid="sms-topups">
            {topUps.items.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span>
                  {date(r.createdAt)} ·{' '}
                  {t('com.credits', { n: r.creditsGranted ?? r.creditsRequested })}
                  {r.status === 'REJECTED' && r.handlingNote ? ` · ${r.handlingNote}` : ''}
                </span>
                <Badge
                  tone={
                    r.status === 'APPROVED'
                      ? 'forest'
                      : r.status === 'REJECTED'
                        ? 'terracotta'
                        : r.status === 'PENDING'
                          ? 'savanna'
                          : 'neutral'
                  }
                >
                  {t(`com.topUp.${r.status}`)}
                </Badge>
              </li>
            ))}
          </ul>
          {topUps.hasMore && (
            <Button
              size="sm"
              variant="secondary"
              disabled={topUps.busy}
              onClick={() => void topUps.more()}
            >
              {t('common.next')}
            </Button>
          )}
        </details>
      )}
      {ledger.state === 'ready' && ledger.items.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-semibold">{t('com.ledger')}</summary>
          <ul className="mt-1 divide-y divide-line/70 text-sm" data-testid="sms-ledger">
            {ledger.items.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span>
                  {date(e.createdAt)} · {t(`com.ledger.${e.kind}`)}
                </span>
                <span className="tabular-nums" dir="ltr">
                  {e.availableDelta > 0 ? `+${e.availableDelta}` : e.availableDelta} →{' '}
                  {e.balanceAfter}
                </span>
              </li>
            ))}
          </ul>
          {ledger.hasMore && (
            <Button
              size="sm"
              variant="secondary"
              disabled={ledger.busy}
              onClick={() => void ledger.more()}
            >
              {t('common.next')}
            </Button>
          )}
        </details>
      )}
    </section>
  );
}

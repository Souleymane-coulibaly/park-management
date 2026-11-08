'use client';

import { useState } from 'react';
import {
  SCHOOL_ANNOUNCEMENTS_PAGE,
  SCHOOL_ANNOUNCEMENT_AUDIENCES,
  SCHOOL_SMS_STATUSES,
  type SchoolAnnouncementAudience,
  type SchoolAnnouncementStatus,
  type SchoolSmsStatus,
  hasSchoolPermission,
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
                  {m.lastError ? ` · ${m.lastError}` : ''}
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

'use client';

import {
  SCHOOL_AI_CONTENT_KINDS,
  SCHOOL_AI_DIFFICULTIES,
  SCHOOL_AI_LANGUAGES,
  type SchoolAiContentKind,
  type SchoolAiFeature,
} from '@ocall/shared';
import { type FormEvent, useRef, useState } from 'react';
import { downloadPdf } from '@/components/school/school-assessment';
import { YearPicker } from '@/components/school/school-finance';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { ReportTable, TrendBadge, type Trend, average } from '@/components/school/school-reports';
import type { ClassOption } from '@/components/school/school-students';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

export interface AiStatus {
  configured: boolean;
  simulated: boolean;
  enabled: boolean;
  canManage: boolean;
  features: Record<SchoolAiFeature, boolean>;
  /** Droits du rôle, indépendamment de l'activation (consultation des contenus). */
  allowed: Record<SchoolAiFeature, boolean>;
  usage: { used: number; limit: number; alert: boolean; exceeded: boolean };
}

interface Source {
  tool: string;
  title: string;
  period: { label: string; from: string; to: string } | null;
  filters: string[];
  missing: string[];
}

interface CopilotAnswer {
  conversationId: string;
  question: string;
  answer: string;
  grounded: boolean;
  sources: Source[];
  results: (Source & { data: Record<string, unknown> })[];
}

const textarea = 'mt-1 block w-full rounded-xl border border-line bg-white p-2 text-sm';

// ─── Copilote de direction ───

const SUGGESTIONS = [
  'students',
  'unpaid',
  'absences',
  'compare',
  'collections',
  'summary',
] as const;

export function AiCopilot({ schoolId, onUsed }: { schoolId: string; onUsed: () => void }) {
  const { t, date } = useSchoolText();
  const [question, setQuestion] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [exchanges, setExchanges] = useState<CopilotAnswer[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const conversations = useApi<{ id: string; title: string; updatedAt: string }[]>(
    `/school/ai/copilot/conversations?schoolId=${schoolId}`,
  );
  // Chaque requête a un numéro : seule la dernière met à jour l'écran (réponses dans le désordre,
  // navigation pendant une attente). Ouverture et création sont aussi bloquées pendant un envoi.
  const latest = useRef(0);

  async function send(text: string) {
    if (!text.trim()) return;
    const request = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api<CopilotAnswer>('/school/ai/copilot/ask', {
        method: 'POST',
        body: { schoolId, question: text, ...(conversationId ? { conversationId } : {}) },
        timeoutMs: 180_000,
      });
      if (request !== latest.current) return;
      setConversationId(res.conversationId);
      setExchanges((list) => [...list, res]);
      setQuestion('');
      conversations.reload();
    } catch (e) {
      if (request === latest.current) setError(toApiError(e));
    } finally {
      if (request === latest.current) setLoading(false);
      onUsed();
    }
  }

  async function open(id: string) {
    const request = ++latest.current;
    setError(null);
    try {
      const c = await api<{
        id: string;
        messages: {
          role: string;
          content: string;
          grounded: boolean | null;
          sources: { sources?: Source[]; results?: CopilotAnswer['results'] } | null;
        }[];
      }>(`/school/ai/copilot/conversations/${id}?schoolId=${schoolId}`);
      const pairs: CopilotAnswer[] = [];
      for (let i = 0; i + 1 < c.messages.length; i += 2) {
        const q = c.messages[i]!;
        const a = c.messages[i + 1]!;
        pairs.push({
          conversationId: c.id,
          question: q.content,
          answer: a.content,
          grounded: a.grounded ?? true,
          sources: a.sources?.sources ?? [],
          results: a.sources?.results ?? [],
        });
      }
      if (request !== latest.current) return;
      setConversationId(c.id);
      setExchanges(pairs);
    } catch (e) {
      if (request === latest.current) setError(toApiError(e));
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <Card>
        <CardBody>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-semibold">{t('ai.cop.history')}</h2>
            <Button
              size="sm"
              variant="ghost"
              disabled={loading}
              onClick={() => {
                latest.current++;
                setConversationId(null);
                setExchanges([]);
              }}
              data-testid="ai-new-conversation"
            >
              {t('ai.cop.new')}
            </Button>
          </div>
          {conversations.state === 'success' && conversations.data.length === 0 && (
            <p className="text-sm text-muted">{t('ai.cop.noHistory')}</p>
          )}
          <ul className="space-y-1 text-sm" data-testid="ai-conversations">
            {conversations.state === 'success' &&
              conversations.data.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={loading}
                    className={`w-full truncate rounded-lg px-2 py-1 text-start hover:bg-ivory-dark/60 disabled:opacity-60 ${c.id === conversationId ? 'bg-forest-light' : ''}`}
                    onClick={() => void open(c.id)}
                    title={c.title}
                  >
                    {c.title}
                    <span className="block text-xs text-muted">{date(c.updatedAt)}</span>
                  </button>
                </li>
              ))}
          </ul>
          <p className="mt-3 text-xs text-muted">{t('ai.cop.retention')}</p>
        </CardBody>
      </Card>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2" data-testid="ai-suggestions">
          {SUGGESTIONS.map((k) => (
            <Button
              key={k}
              size="sm"
              variant="secondary"
              disabled={loading}
              onClick={() => void send(t(`ai.cop.q.${k}`))}
            >
              {t(`ai.cop.q.${k}`)}
            </Button>
          ))}
        </div>
        {exchanges.map((x, i) => (
          <Card key={i}>
            <CardBody>
              <p className="text-sm font-medium" data-testid="ai-question">
                {x.question}
              </p>
              <p className="mt-2 whitespace-pre-line text-sm" data-testid="ai-answer">
                {x.answer}
              </p>
              {!x.grounded && (
                <p className="mt-2 text-xs text-terracotta-dark">{t('ai.cop.notGrounded')}</p>
              )}
              {x.sources.length > 0 && (
                <div
                  className="mt-3 space-y-1 border-t border-line/70 pt-2 text-xs text-muted"
                  data-testid="ai-sources"
                >
                  <p className="font-semibold">{t('ai.cop.sources')}</p>
                  {x.sources.map((s, j) => (
                    <p key={j}>
                      {s.title}
                      {s.period
                        ? ` · ${s.period.label} (${date(s.period.from)} → ${date(s.period.to)})`
                        : ''}
                      {s.filters.length ? ` · ${s.filters.join(', ')}` : ''}
                      {s.missing.length ? ` · ${t('ai.cop.missing')} ${s.missing.join(' ; ')}` : ''}
                    </p>
                  ))}
                </div>
              )}
              {x.results.length > 0 && (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer text-muted">{t('ai.cop.data')}</summary>
                  <pre
                    className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-ivory-dark/50 p-2"
                    dir="ltr"
                  >
                    {JSON.stringify(
                      x.results.map((r) => ({ [r.title]: r.data })),
                      null,
                      2,
                    )}
                  </pre>
                </details>
              )}
            </CardBody>
          </Card>
        ))}
        <ApiErrorAlert error={error} />
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(question);
          }}
          data-testid="ai-ask"
        >
          <label className="block text-sm font-medium">
            {t('ai.cop.question')}
            <textarea
              className={`${textarea} min-h-20`}
              value={question}
              maxLength={500}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </label>
          <Button type="submit" loading={loading} disabled={!question.trim()}>
            {t('ai.cop.ask')}
          </Button>
          <p className="text-xs text-muted">{t('ai.cop.readOnly')}</p>
          <p className="text-xs text-muted">{t('ai.cop.independent')}</p>
        </form>
      </div>
    </div>
  );
}

// ─── Assistant pédagogique ───

interface Section {
  key: string;
  heading: string;
  body: string;
}

interface Content {
  id: string;
  kind: SchoolAiContentKind;
  language: 'FR' | 'AR';
  title: string;
  topic: string;
  status: 'DRAFT' | 'VALIDATED' | 'ARCHIVED';
  sections: Section[];
  missing?: string[];
  updatedAt: string;
}

export function AiTeaching({
  schoolId,
  canGenerate,
  onUsed,
}: {
  schoolId: string;
  canGenerate: boolean;
  onUsed: () => void;
}) {
  return (
    <YearPicker schoolId={schoolId}>
      {(year) => (
        <Teaching
          key={year.id}
          schoolId={schoolId}
          yearId={year.id}
          canGenerate={canGenerate}
          onUsed={onUsed}
        />
      )}
    </YearPicker>
  );
}

function Teaching({
  schoolId,
  yearId,
  canGenerate,
  onUsed,
}: {
  schoolId: string;
  yearId: string;
  /** Faux quand l'IA est coupée : les contenus restent consultables, modifiables et exportables. */
  canGenerate: boolean;
  onUsed: () => void;
}) {
  const { t, name } = useSchoolText();
  const classes = useApi<ClassOption[]>(`/school/classes?schoolYearId=${yearId}`);
  const subjects = useApi<{ id: string; name: string; nameAr: string | null; isActive: boolean }[]>(
    `/school/subjects?schoolId=${schoolId}`,
  );
  const history = useApi<Content[]>(`/school/ai/teaching/contents?schoolId=${schoolId}`);
  const [form, setForm] = useState({
    classId: '',
    subjectId: '',
    kind: 'LESSON_SHEET',
    language: 'FR',
    difficulty: 'MEDIUM',
    topic: '',
    objectives: '',
  });
  const [doc, setDoc] = useState<Content | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  // Document affiché : une réponse tardive concernant un autre document est ignorée.
  const currentId = useRef<string | null>(null);
  const show = (d: Content) => {
    currentId.current = d.id;
    setDoc(d);
  };
  const apply = (d: Content) => {
    if (d.id === currentId.current) setDoc(d);
  };
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  async function call<T>(fn: () => Promise<T>, used = false): Promise<T | null> {
    setError(null);
    setLoading(true);
    try {
      return await fn();
    } catch (e) {
      setError(toApiError(e));
      return null;
    } finally {
      setLoading(false);
      if (used) onUsed();
    }
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    const res = await call(
      () =>
        api<Content>('/school/ai/teaching/contents', {
          method: 'POST',
          body: { schoolId, ...form },
          timeoutMs: 180_000,
        }),
      true,
    );
    if (res) {
      show(res);
      history.reload();
    }
  }

  /**
   * Après un conflit de version : relit le contenu enregistré. Brouillon : la nouvelle version est
   * reprise en gardant les saisies affichées ; validé ou archivé : le contenu enregistré s'affiche.
   */
  async function resync() {
    if (!doc) return;
    const local = doc;
    const server = await call(() => api<Content>(`/school/ai/teaching/contents/${local.id}`));
    if (!server) return;
    apply(
      server.status === 'DRAFT'
        ? { ...server, title: local.title, sections: local.sections }
        : server,
    );
  }

  // Champs verrouillés pendant une opération : aucune saisie ne peut être écrasée par la réponse.
  const editable = doc?.status === 'DRAFT' && !loading;

  /** Enregistre le brouillon affiché, dans la version relue (refus si elle a changé ailleurs). */
  const save = (d: Content) =>
    api<Content>(`/school/ai/teaching/contents/${d.id}`, {
      method: 'PUT',
      body: { title: d.title, sections: d.sections, version: d.updatedAt },
    });
  const arabic = doc?.language === 'AR';

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
      <div className="space-y-4">
        <Card>
          <CardBody>
            <h2 className="mb-3 font-semibold">{t('ai.tea.new')}</h2>
            {!canGenerate && <Alert tone="info" title={t('ai.tea.generationOff')} />}
            <form
              hidden={!canGenerate}
              className="space-y-3"
              onSubmit={(e) => void generate(e)}
              data-testid="ai-generate"
            >
              <SelectField
                label={t('pick.class')}
                required
                value={form.classId}
                onChange={set('classId')}
                options={[
                  { value: '', label: '—' },
                  ...(classes.state === 'success' ? classes.data : []).map((c) => ({
                    value: c.id,
                    label: name(c),
                  })),
                ]}
              />
              <SelectField
                label={t('ai.tea.subject')}
                required
                value={form.subjectId}
                onChange={set('subjectId')}
                options={[
                  { value: '', label: '—' },
                  ...(subjects.state === 'success'
                    ? subjects.data.filter((s) => s.isActive)
                    : []
                  ).map((s) => ({
                    value: s.id,
                    label: name(s),
                  })),
                ]}
              />
              <SelectField
                label={t('ai.tea.kind')}
                value={form.kind}
                onChange={set('kind')}
                options={SCHOOL_AI_CONTENT_KINDS.map((k) => ({
                  value: k,
                  label: t(`ai.kind.${k}`),
                }))}
              />
              <div className="grid grid-cols-2 gap-2">
                <SelectField
                  label={t('ai.tea.language')}
                  value={form.language}
                  onChange={set('language')}
                  options={SCHOOL_AI_LANGUAGES.map((l) => ({ value: l, label: t(`ai.lang.${l}`) }))}
                />
                <SelectField
                  label={t('ai.tea.difficulty')}
                  value={form.difficulty}
                  onChange={set('difficulty')}
                  options={SCHOOL_AI_DIFFICULTIES.map((d) => ({
                    value: d,
                    label: t(`ai.diff.${d}`),
                  }))}
                />
              </div>
              <InputField
                label={t('ai.tea.topic')}
                required
                maxLength={200}
                value={form.topic}
                onChange={set('topic')}
              />
              <label className="block text-sm font-medium">
                {t('ai.tea.objectives')}
                <textarea
                  className={`${textarea} min-h-20`}
                  maxLength={1000}
                  value={form.objectives}
                  onChange={set('objectives')}
                />
              </label>
              <Button
                type="submit"
                loading={loading}
                disabled={!form.classId || !form.subjectId || form.topic.trim().length < 2}
              >
                {t('ai.tea.generate')}
              </Button>
            </form>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <h2 className="mb-2 font-semibold">{t('ai.tea.history')}</h2>
            {history.state === 'loading' && <LoadingState />}
            {history.state === 'error' && (
              <ErrorState error={history.error} onRetry={history.reload} />
            )}
            {history.state === 'success' && history.data.length === 0 && (
              <p className="text-sm text-muted">{t('ai.tea.noHistory')}</p>
            )}
            <ul className="space-y-1 text-sm" data-testid="ai-contents">
              {history.state === 'success' &&
                history.data.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      // Pas de changement de document pendant une opération en cours.
                      disabled={loading}
                      className="w-full rounded-lg px-2 py-1 text-start hover:bg-ivory-dark/60 disabled:opacity-60"
                      onClick={() =>
                        void call(() => api<Content>(`/school/ai/teaching/contents/${c.id}`)).then(
                          (d) => d && show(d),
                        )
                      }
                    >
                      <span className="block truncate">{c.title}</span>
                      <span className="text-xs text-muted">
                        {t(`ai.kind.${c.kind}`)} · {t(`ai.status.${c.status}`)}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </CardBody>
        </Card>
      </div>
      <div className="space-y-3">
        <ApiErrorAlert error={error} />
        {error?.code === 'AI_DOCUMENT_CHANGED' && doc && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void resync()}
            data-testid="ai-resync"
          >
            {t('ai.tea.resync')}
          </Button>
        )}
        {!doc && <Alert tone="info" title={t('ai.tea.empty')} />}
        {doc && (
          <Card>
            <CardBody>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge
                  tone={
                    doc.status === 'VALIDATED'
                      ? 'forest'
                      : doc.status === 'DRAFT'
                        ? 'savanna'
                        : 'neutral'
                  }
                >
                  {t(`ai.status.${doc.status}`)}
                </Badge>
                <span className="text-xs text-muted">{t(`ai.kind.${doc.kind}`)}</span>
              </div>
              {doc.status === 'DRAFT' && <Alert tone="info" title={t('ai.tea.reviewFirst')} />}
              {doc.missing && doc.missing.length > 0 && (
                <p className="mt-2 text-xs text-terracotta-dark">
                  {t('ai.tea.missing', { list: doc.missing.join(', ') })}
                </p>
              )}
              <div className="mt-3 space-y-3" dir={arabic ? 'rtl' : 'ltr'} data-testid="ai-content">
                <InputField
                  label={t('ai.tea.title')}
                  value={doc.title}
                  disabled={!editable}
                  maxLength={160}
                  onChange={(e) => setDoc({ ...doc, title: e.target.value })}
                />
                {doc.sections.map((s, i) => (
                  <SectionEditor
                    key={s.key}
                    section={s}
                    editable={editable}
                    canRegenerate={canGenerate}
                    loading={loading}
                    onChange={(next) =>
                      setDoc({ ...doc, sections: doc.sections.map((x, j) => (j === i ? next : x)) })
                    }
                    onRegenerate={async (instruction) => {
                      const res = await call(async () => {
                        // Les modifications locales des autres sections sont d'abord enregistrées,
                        // puis la version enregistrée est régénérée : rien n'est perdu.
                        const saved = await save(doc);
                        apply(saved);
                        return api<Content>(
                          `/school/ai/teaching/contents/${doc.id}/sections/${s.key}/regenerate`,
                          {
                            method: 'POST',
                            body: { instruction, version: saved.updatedAt },
                            timeoutMs: 180_000,
                          },
                        );
                      }, true);
                      if (res) apply(res);
                    }}
                  />
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {doc.status === 'DRAFT' && (
                  <>
                    <Button
                      variant="secondary"
                      loading={loading}
                      onClick={() =>
                        void call(() => save(doc)).then((d) => d && (apply(d), history.reload()))
                      }
                      data-testid="ai-save"
                    >
                      {t('ai.tea.save')}
                    </Button>
                    <Button
                      loading={loading}
                      onClick={() =>
                        void call(async () => {
                          // Enregistre puis valide exactement la version enregistrée.
                          const saved = await save(doc);
                          apply(saved);
                          return api<Content>(`/school/ai/teaching/contents/${doc.id}/validate`, {
                            method: 'POST',
                            body: { version: saved.updatedAt },
                          });
                        }).then((d) => d && (apply(d), history.reload()))
                      }
                      data-testid="ai-validate"
                    >
                      {t('ai.tea.validate')}
                    </Button>
                  </>
                )}
                {doc.status === 'VALIDATED' && (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void call(() =>
                        downloadPdf(`/school/ai/teaching/contents/${doc.id}/pdf`, 'contenu.pdf'),
                      )
                    }
                    data-testid="ai-pdf"
                  >
                    {t('ai.tea.pdf')}
                  </Button>
                )}
                {doc.status !== 'ARCHIVED' && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void call(() =>
                        api<Content>(`/school/ai/teaching/contents/${doc.id}/archive`, {
                          method: 'POST',
                        }),
                      ).then((d) => d && (apply(d), history.reload()))
                    }
                  >
                    {t('ai.tea.archive')}
                  </Button>
                )}
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}

function SectionEditor({
  section,
  editable,
  canRegenerate,
  loading,
  onChange,
  onRegenerate,
}: {
  section: Section;
  editable: boolean;
  canRegenerate: boolean;
  loading: boolean;
  onChange: (s: Section) => void;
  onRegenerate: (instruction: string) => Promise<void>;
}) {
  const { t } = useSchoolText();
  const [instruction, setInstruction] = useState('');
  return (
    <div className="rounded-xl border border-line/70 p-3" data-testid={`ai-section-${section.key}`}>
      <input
        className="w-full bg-transparent font-semibold"
        value={section.heading}
        disabled={!editable}
        maxLength={120}
        aria-label={t('ai.tea.heading')}
        onChange={(e) => onChange({ ...section, heading: e.target.value })}
      />
      <textarea
        className={`${textarea} min-h-28`}
        value={section.body}
        disabled={!editable}
        maxLength={8000}
        aria-label={section.heading}
        onChange={(e) => onChange({ ...section, body: e.target.value })}
      />
      {editable && canRegenerate && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            className="min-w-0 flex-1 rounded-lg border border-line px-2 py-1 text-xs"
            placeholder={t('ai.tea.instruction')}
            value={instruction}
            maxLength={500}
            onChange={(e) => setInstruction(e.target.value)}
          />
          <Button
            size="sm"
            variant="secondary"
            loading={loading}
            onClick={() => void onRegenerate(instruction)}
          >
            {t('ai.tea.regenerate')}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Analyse scolaire ───

interface Analysis {
  computedAt: string;
  year: { label: string };
  from: string;
  to: string;
  thresholds: { passRateBelowPercent: number; absenceRateAbovePercent: number };
  periods: { id: string; label: string }[];
  results: {
    school: {
      period: string;
      average: number | null;
      scale: number | null;
      scaleMixed: boolean;
      passRatePercent: number | null;
      graded: number;
      insufficient: boolean;
    }[];
    schoolTrend: Trend | null;
    classes: {
      class: string;
      trend: Trend;
      averages: {
        period: string;
        average: number | null;
        scale: number;
        graded: number;
        insufficient: boolean;
      }[];
    }[];
    subjects: {
      subject: string;
      trend: Trend | null;
      averages: {
        period: string;
        average: number | null;
        scale: number | null;
        scaleMixed: boolean;
        graded: number;
        insufficient: boolean;
      }[];
    }[];
  };
  comparison: {
    from: string;
    to: string;
    classes: { class: string; from: number | null; to: number | null; change: number | null }[];
  } | null;
  attendance: {
    records: number;
    absenceRatePercent: number | null;
    byClass: { class: string; absenceRatePercent: number | null }[];
  };
  support: {
    scope: 'class' | 'subject';
    name: string;
    reason: 'DOWN_TREND' | 'LOW_PASS_RATE' | 'HIGH_ABSENCE';
    /** Réserve d'effectif insuffisant attachée à l'alerte. */
    insufficient: boolean;
    value: number | null;
    period: string | null;
  }[];
  insufficient: string[];
  sources: string[];
}

interface Summary {
  /** Indicateurs recalculés pour cette synthèse : ceux qu'on affiche avec elle. */
  indicators: Analysis;
  summary: {
    summary: string;
    highlights: string[];
    supportSuggestions: string[];
    limits: string[];
  };
  grounded: boolean;
}

export function AiAnalysis({ schoolId, onUsed }: { schoolId: string; onUsed: () => void }) {
  return (
    <YearPicker schoolId={schoolId}>
      {(year) => (
        <AnalysisBody key={year.id} schoolId={schoolId} yearId={year.id} onUsed={onUsed} />
      )}
    </YearPicker>
  );
}

const pctText = (v: number | null) => (v === null ? '–' : `${v.toLocaleString('fr-FR')} %`);

function AnalysisBody({
  schoolId,
  yearId,
  onUsed,
}: {
  schoolId: string;
  yearId: string;
  onUsed: () => void;
}) {
  const { t, date } = useSchoolText();
  const data = useApi<Analysis>(`/school/ai/analysis?schoolId=${schoolId}&schoolYearId=${yearId}`);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  if (data.state === 'loading') return <LoadingState />;
  if (data.state === 'error') return <ErrorState error={data.error} onRetry={data.reload} />;
  // Après une synthèse, les tableaux affichent les indicateurs de cette même réponse.
  const d = summary?.indicators ?? data.data;

  async function summarize() {
    setLoading(true);
    setError(null);
    try {
      setSummary(
        await api<Summary>('/school/ai/analysis/summary', {
          method: 'POST',
          body: { schoolId, schoolYearId: yearId },
          timeoutMs: 180_000,
        }),
      );
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoading(false);
      onUsed();
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted" data-testid="ai-analysis-computed">
        {t('ai.ana.computedAt', { at: new Date(d.computedAt).toLocaleString('fr-FR') })}
      </p>
      <p className="text-xs text-muted" data-testid="ai-analysis-scope">
        {t('ai.ana.scope', {
          year: d.year.label,
          from: date(d.from),
          to: date(d.to),
          sources: d.sources.join(', '),
        })}
      </p>
      {d.insufficient.length > 0 && (
        <Alert tone="info" title={t('ai.ana.insufficient', { list: d.insufficient.join(' ; ') })} />
      )}
      <Card>
        <CardBody>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{t('ai.ana.school')}</h2>
            <TrendBadge trend={d.results.schoolTrend} />
          </div>
          <ReportTable
            testId="ai-analysis-school"
            headers={[
              { label: t('rep.period') },
              { label: t('rep.average'), end: true },
              { label: t('rep.passRate'), end: true },
              { label: t('rep.graded'), end: true },
            ]}
            rows={d.results.school.map((p) => ({
              key: p.period,
              cells: [
                p.period,
                p.scaleMixed
                  ? t('rep.scaleMixed')
                  : p.average === null
                    ? average(null)
                    : `${average(p.average)} / ${p.scale}`,
                pctText(p.passRatePercent),
                p.graded,
              ],
            }))}
          />
        </CardBody>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardBody>
            <h2 className="mb-3 font-semibold">{t('ai.ana.classes')}</h2>
            <ReportTable
              testId="ai-analysis-classes"
              headers={[
                { label: t('pick.class') },
                ...d.periods.map((p) => ({ label: p.label, end: true })),
                { label: t('rep.trend') },
              ]}
              rows={d.results.classes.map((c) => ({
                key: c.class,
                cells: [
                  c.class,
                  // Astérisque : moyenne sur moins de 3 élèves notés (réserve, voir la note).
                  ...c.averages.map((a) =>
                    a.average === null
                      ? average(null)
                      : `${average(a.average)} / ${a.scale}${a.insufficient ? ' *' : ''}`,
                  ),
                  <TrendBadge key="t" trend={c.trend} />,
                ],
              }))}
            />
            <p className="mt-2 text-xs text-muted">{t('ai.ana.insufficientNote')}</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <h2 className="mb-3 font-semibold">{t('ai.ana.subjects')}</h2>
            <ReportTable
              testId="ai-analysis-subjects"
              headers={[
                { label: t('rep.subject') },
                ...d.periods.map((p) => ({ label: p.label, end: true })),
                { label: t('rep.trend') },
              ]}
              rows={d.results.subjects.map((s) => ({
                key: s.subject,
                cells: [
                  s.subject,
                  // Barème de chaque moyenne ; astérisque : moins de 3 élèves notés dans la matière.
                  ...s.averages.map((a) =>
                    a.scaleMixed
                      ? t('rep.scaleMixed')
                      : a.average === null
                        ? average(null)
                        : `${average(a.average)} / ${a.scale}${a.insufficient ? ' *' : ''}`,
                  ),
                  <TrendBadge key="t" trend={s.trend} />,
                ],
              }))}
            />
            {d.results.subjects.some((s) => s.averages.some((a) => a.insufficient)) && (
              <p className="mt-2 text-xs text-muted">{t('ai.ana.insufficientNote')}</p>
            )}
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardBody>
          <h2 className="mb-1 font-semibold">{t('ai.ana.support')}</h2>
          <p className="mb-3 text-xs text-muted">
            {t('ai.ana.supportNote', {
              pass: d.thresholds.passRateBelowPercent,
              absence: d.thresholds.absenceRateAbovePercent,
            })}
          </p>
          {d.support.length === 0 ? (
            <p className="text-sm text-muted">{t('ai.ana.noSupport')}</p>
          ) : (
            <ul className="space-y-1 text-sm" data-testid="ai-analysis-support">
              {d.support.map((s, i) => (
                <li key={i}>
                  <Badge tone="savanna">{t(`ai.ana.reason.${s.reason}`)}</Badge> {s.name}
                  {s.value !== null
                    ? ` · ${s.reason === 'DOWN_TREND' ? average(s.value) : pctText(s.value)}`
                    : ''}
                  {s.period ? ` · ${s.period}` : ''}
                  {s.insufficient && (
                    <>
                      {' '}
                      <Badge tone="neutral">{t('rep.insufficient')}</Badge>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{t('ai.ana.summaryTitle')}</h2>
            <Button
              size="sm"
              loading={loading}
              onClick={() => void summarize()}
              data-testid="ai-summarize"
            >
              {t('ai.ana.summarize')}
            </Button>
          </div>
          <ApiErrorAlert error={error} />
          {summary && (
            <div className="space-y-2 text-sm" data-testid="ai-summary">
              <p className="whitespace-pre-line">{summary.summary.summary}</p>
              {summary.summary.highlights.length > 0 && (
                <ul className="list-disc ps-5">
                  {summary.summary.highlights.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              )}
              {summary.summary.supportSuggestions.length > 0 && (
                <>
                  <p className="font-semibold">{t('ai.ana.suggestions')}</p>
                  <ul className="list-disc ps-5">
                    {summary.summary.supportSuggestions.map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                </>
              )}
              {summary.summary.limits.length > 0 && (
                <p className="text-xs text-muted">
                  {t('ai.ana.limits', { list: summary.summary.limits.join(' ; ') })}
                </p>
              )}
              <p className="text-xs text-muted">{t('ai.ana.noDecision')}</p>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ─── Réglages ───

interface Settings {
  enabled: boolean;
  copilotEnabled: boolean;
  teachingEnabled: boolean;
  analysisEnabled: boolean;
  monthlyCallLimit: number;
  alertPercent: number;
  conversationRetentionDays: number;
}

interface Usage {
  provider: string | null;
  costIsEstimate: boolean;
  /** Appels dont le coût n'est pas estimable : jamais présentés comme gratuits. */
  unestimatedCalls: number;
  rows: {
    feature: SchoolAiFeature;
    status: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostXof: number;
  }[];
}

export function AiSettings({ schoolId, onSaved }: { schoolId: string; onSaved: () => void }) {
  const { t } = useSchoolText();
  const settings = useApi<Settings>(`/school/ai/settings?schoolId=${schoolId}`);
  const usage = useApi<Usage>(`/school/ai/usage?schoolId=${schoolId}`);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  if (settings.state === 'loading') return <LoadingState />;
  if (settings.state === 'error')
    return <ErrorState error={settings.error} onRetry={settings.reload} />;
  const s = draft ?? settings.data;
  const toggle = (k: 'enabled' | 'copilotEnabled' | 'teachingEnabled' | 'analysisEnabled') => (
    <label key={k} className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={Boolean(s[k])}
        onChange={(e) => setDraft({ ...s, [k]: e.target.checked })}
        data-testid={`ai-setting-${k}`}
      />
      {t(`ai.set.${k}`)}
    </label>
  );

  async function save() {
    setError(null);
    setSaved(false);
    try {
      setDraft(
        await api<Settings>(`/school/ai/settings?schoolId=${schoolId}`, { method: 'PUT', body: s }),
      );
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(toApiError(e));
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardBody>
          <h2 className="mb-3 font-semibold">{t('ai.set.title')}</h2>
          <Alert tone="info" title={t('ai.set.provider')} />
          <div className="mt-3 space-y-2">
            {toggle('enabled')}
            {toggle('copilotEnabled')}
            {toggle('teachingEnabled')}
            {toggle('analysisEnabled')}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <InputField
              label={t('ai.set.limit')}
              type="number"
              min={0}
              max={100000}
              value={s.monthlyCallLimit}
              onChange={(e) => setDraft({ ...s, monthlyCallLimit: Number(e.target.value) })}
            />
            <InputField
              label={t('ai.set.retention')}
              type="number"
              min={1}
              max={365}
              value={s.conversationRetentionDays}
              onChange={(e) =>
                setDraft({ ...s, conversationRetentionDays: Number(e.target.value) })
              }
            />
          </div>
          <ApiErrorAlert error={error} />
          {saved && <p className="mt-2 text-sm text-forest">{t('ai.set.saved')}</p>}
          <Button className="mt-3" onClick={() => void save()} data-testid="ai-settings-save">
            {t('ai.set.save')}
          </Button>
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <h2 className="mb-3 font-semibold">{t('ai.set.usage')}</h2>
          {usage.state === 'success' && (
            <>
              <ReportTable
                testId="ai-usage-table"
                headers={[
                  { label: t('ai.set.feature') },
                  { label: t('ai.set.status') },
                  { label: t('ai.set.calls'), end: true },
                  { label: t('ai.set.tokens'), end: true },
                  { label: t('ai.set.cost'), end: true },
                ]}
                rows={usage.data.rows.map((r) => ({
                  key: `${r.feature}-${r.status}`,
                  cells: [
                    t(`ai.feature.${r.feature}`),
                    r.status,
                    r.calls,
                    r.inputTokens + r.outputTokens,
                    `${r.estimatedCostXof} FCFA`,
                  ],
                }))}
              />
              {usage.data.unestimatedCalls > 0 && (
                <p className="mt-2 text-xs text-terracotta-dark" data-testid="ai-unestimated">
                  {t('ai.set.unestimated', { n: usage.data.unestimatedCalls })}
                </p>
              )}
              <p className="mt-2 text-xs text-muted">{t('ai.set.costNote')}</p>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

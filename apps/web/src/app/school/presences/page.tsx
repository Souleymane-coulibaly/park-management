'use client';

import { useEffect, useRef, useState } from 'react';
import {
  SCHOOL_ATTENDANCE_BATCH,
  SCHOOL_DEFAULT_SLOT,
  type SchoolAttendanceStatus,
} from '@ocall/shared';
import { YearPicker } from '@/components/school/school-finance';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { SchoolPage } from '@/components/school/school-page';
import { StudentName, useClasses } from '@/components/school/school-students';
import type { AssignmentView } from '@/components/school/school-teaching';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface Sheet {
  session: { id: string; takenAt: string; updatedAt: string } | null;
  students: {
    id: string;
    matricule: string;
    lastName: string;
    firstName: string;
    lastNameAr: string | null;
    firstNameAr: string | null;
    /** Relevé dans cette séance, mais sorti de la classe depuis : corrigeable seulement. */
    former: boolean;
    record: {
      id: string;
      status: SchoolAttendanceStatus;
      minutesLate: number | null;
      note: string | null;
    } | null;
    justified: boolean;
  }[];
}

interface HistoryEvent {
  id: string;
  fromStatus: SchoolAttendanceStatus | null;
  toStatus: SchoolAttendanceStatus;
  fromMinutesLate: number | null;
  toMinutesLate: number | null;
  fromNote: string | null;
  toNote: string | null;
  reason: string | null;
  actor: string | null;
  createdAt: string;
}

const STATUSES: SchoolAttendanceStatus[] = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];
/** Date du jour (AAAA-MM-JJ) dans le fuseau de l'établissement, comme le contrôle de l'API. */
const todayIn = (timezone: string) => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
};

/**
 * Appel des élèves (Sprint 6) : par classe, date et séance. L'enseignant ne voit que ses classes ; toute
 * correction d'un appel déjà enregistré exige un motif et reste dans l'historique.
 */
export default function AttendancePage() {
  return (
    <SchoolPage title="att.title" description="att.desc">
      {({ school, context, canWrite }) => (
        <YearPicker key={school!.id} schoolId={school!.id}>
          {(year) => (
            <ClassPicker
              key={year.id}
              yearId={year.id}
              timezone={school!.timezone}
              teacher={context.role === 'TEACHER'}
              canTake={canWrite('school.attendance.take')}
            />
          )}
        </YearPicker>
      )}
    </SchoolPage>
  );
}

function ClassPicker({
  yearId,
  timezone,
  teacher,
  canTake,
}: {
  yearId: string;
  timezone: string;
  teacher: boolean;
  canTake: boolean;
}) {
  const { t, name } = useSchoolText();
  const all = useClasses(yearId);
  const mine = useApi<AssignmentView[]>(teacher ? '/school/teaching/mine' : null);
  const own = mine.state === 'success' ? new Set(mine.data.map((a) => a.class.id)) : null;
  const classes = teacher ? all.filter((c) => own?.has(c.id)) : all;
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(() => todayIn(timezone));
  const [slot, setSlot] = useState(SCHOOL_DEFAULT_SLOT);
  const cls = classes.find((c) => c.id === classId) ?? classes[0];
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3" data-testid="attendance-filters">
        <SelectField
          label={t('pick.class')}
          value={cls?.id ?? ''}
          onChange={(e) => setClassId(e.target.value)}
          options={classes.map((c) => ({ value: c.id, label: name(c) }))}
        />
        <InputField
          label={t('att.date')}
          type="date"
          value={date}
          max={todayIn(timezone)}
          onChange={(e) => setDate(e.target.value)}
        />
        <InputField
          label={t('att.slot')}
          value={slot}
          maxLength={20}
          onChange={(e) => setSlot(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))}
        />
      </div>
      {cls && date && slot ? (
        <SheetView
          key={`${cls.id}:${date}:${slot}`}
          classId={cls.id}
          date={date}
          slot={slot}
          canTake={canTake}
        />
      ) : (
        <Alert tone="info" title={t('pick.noClass')} />
      )}
    </>
  );
}

function SheetView({
  classId,
  date,
  slot,
  canTake,
}: {
  classId: string;
  date: string;
  slot: string;
  canTake: boolean;
}) {
  const { t, date: fmt } = useSchoolText();
  const sheet = useApi<Sheet>(
    `/school/attendance/sheet?classId=${classId}&date=${date}&slot=${encodeURIComponent(slot)}`,
  );
  const [entries, setEntries] = useState<
    Record<string, { status: SchoolAttendanceStatus; minutesLate: string }>
  >({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<{ recordId: string; events: HistoryEvent[] } | null>(null);

  // Données chargées : référence stable jusqu'au prochain rechargement (pas l'objet de useApi, recréé à
  // chaque rendu, qui effacerait la saisie en cours).
  const loaded = sheet.state === 'success' ? sheet.data : null;
  // Après l'échec d'un lot, la feuille est relue (séance créée, motif de correction affiché) sans
  // perdre les saisies : seules les lignes absentes de la saisie en cours sont initialisées.
  const keepEntries = useRef(false);
  useEffect(() => {
    if (!loaded) return;
    const keep = keepEntries.current;
    keepEntries.current = false;
    setEntries((current) =>
      Object.fromEntries(
        loaded.students.map((s) => [
          s.id,
          (keep ? current[s.id] : undefined) ?? {
            status: s.record?.status ?? 'PRESENT',
            minutesLate: s.record?.minutesLate ? String(s.record.minutesLate) : '',
          },
        ]),
      ),
    );
  }, [loaded]);

  if (sheet.state === 'loading') return <LoadingState />;
  if (sheet.state === 'error') return <ErrorState error={sheet.error} onRetry={sheet.reload} />;
  const s = sheet.data;
  if (s.students.length === 0) return <Alert tone="info" title={t('att.noStudents')} />;

  async function save() {
    setLoading(true);
    setError(null);
    setSaved(false);
    let batches = 0;
    try {
      const records = s.students.map((st) => {
        const e = entries[st.id] ?? { status: 'PRESENT', minutesLate: '' };
        return {
          studentId: st.id,
          status: e.status,
          ...(e.status === 'LATE' && e.minutesLate ? { minutesLate: Number(e.minutesLate) } : {}),
          // Note existante renvoyée telle quelle : cet écran ne l'édite pas, il ne l'efface jamais.
          ...(st.record?.note ? { note: st.record.note } : {}),
        };
      });
      // Grande classe : enregistrement par lots successifs, chacun dans la limite acceptée par l'API.
      for (let i = 0; i < records.length; i += SCHOOL_ATTENDANCE_BATCH) {
        await api('/school/attendance/sheet', {
          method: 'PUT',
          body: {
            classId,
            date,
            slot,
            reason: reason.trim() || undefined,
            records: records.slice(i, i + SCHOOL_ATTENDANCE_BATCH),
          },
        });
        batches += 1;
      }
      setSaved(true);
      setReason('');
      sheet.reload();
    } catch (e) {
      setError(toApiError(e));
      // Lots déjà validés : la feuille relue les reflète, la saisie en cours est conservée.
      if (batches > 0) {
        keepEntries.current = true;
        sheet.reload();
      }
    } finally {
      setLoading(false);
    }
  }

  async function openHistory(recordId: string) {
    try {
      setHistory({
        recordId,
        events: await api<HistoryEvent[]>(`/school/attendance/records/${recordId}/history`),
      });
    } catch (e) {
      setError(toApiError(e));
    }
  }

  return (
    <Card>
      <CardBody>
        <p className="mb-3 text-sm text-muted">
          {s.session ? t('att.taken', { date: fmt(s.session.takenAt) }) : t('att.notTaken')}
        </p>
        {saved && <Alert tone="success" title={t('att.saved')} />}
        <ApiErrorAlert error={error} />
        {canTake && (
          <Button
            size="sm"
            variant="secondary"
            className="mb-3"
            onClick={() =>
              setEntries((prev) =>
                Object.fromEntries(
                  Object.keys(prev).map((id) => [id, { status: 'PRESENT', minutesLate: '' }]),
                ),
              )
            }
          >
            {t('att.allPresent')}
          </Button>
        )}
        <ul className="divide-y divide-line/70" data-testid="attendance-sheet">
          {s.students.map((st) => {
            const entry = entries[st.id] ?? { status: 'PRESENT' as const, minutesLate: '' };
            return (
              <li key={st.id} className="space-y-2 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-40 flex-1 font-medium">
                    <StudentName student={st} />
                  </span>
                  {st.former && <Badge tone="savanna">{t('att.former')}</Badge>}
                  {st.justified && <Badge tone="neutral">{t('att.justified')}</Badge>}
                  <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={st.lastName}>
                    {STATUSES.map((status) => (
                      <button
                        key={status}
                        type="button"
                        role="radio"
                        aria-checked={entry.status === status}
                        disabled={!canTake}
                        onClick={() =>
                          setEntries((prev) => ({ ...prev, [st.id]: { ...entry, status } }))
                        }
                        className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                          entry.status === status
                            ? 'bg-forest text-white'
                            : 'border border-line bg-white text-charcoal'
                        }`}
                      >
                        {t(`par.att.status.${status}`)}
                      </button>
                    ))}
                  </div>
                  {st.record && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void openHistory(st.record!.id)}
                    >
                      {t('att.history')}
                    </Button>
                  )}
                </div>
                {entry.status === 'LATE' && (
                  <div className="max-w-40">
                    <InputField
                      label={t('att.minutesLate')}
                      inputMode="numeric"
                      value={entry.minutesLate}
                      onChange={(e) =>
                        setEntries((prev) => ({
                          ...prev,
                          [st.id]: { ...entry, minutesLate: e.target.value.replace(/\D/g, '') },
                        }))
                      }
                    />
                  </div>
                )}
                {history && st.record && history.recordId === st.record.id && (
                  <ul
                    className="rounded-lg bg-ivory/60 p-2 text-xs"
                    data-testid="attendance-history"
                  >
                    {history.events.map((e) => (
                      <li key={e.id}>
                        {fmt(e.createdAt)} ·{' '}
                        {e.fromStatus ? `${t(`par.att.status.${e.fromStatus}`)} → ` : ''}
                        {t(`par.att.status.${e.toStatus}`)}
                        {e.fromMinutesLate !== e.toMinutesLate || e.toMinutesLate !== null
                          ? ` · ${t('att.minutesLate')} : ${e.fromMinutesLate ?? '—'} → ${e.toMinutesLate ?? '—'}`
                          : ''}
                        {e.fromNote !== e.toNote
                          ? ` · « ${e.fromNote ?? '—'} » → « ${e.toNote ?? '—'} »`
                          : ''}
                        {e.reason && e.reason !== 'JUSTIFIED' ? ` · ${e.reason}` : ''}
                        {e.actor ? ` · ${e.actor}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        {canTake && (
          <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-line pt-3">
            {s.session && (
              <div className="min-w-60 flex-1">
                <InputField
                  label={t('att.reason')}
                  value={reason}
                  maxLength={300}
                  onChange={(e) => setReason(e.target.value)}
                />
                <p className="mt-1 text-xs text-muted">{t('att.reasonHint')}</p>
              </div>
            )}
            <Button loading={loading} onClick={() => void save()} data-testid="attendance-save">
              {t('att.save')}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

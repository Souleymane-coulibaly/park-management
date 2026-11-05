'use client';

import { useParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import type { SchoolAttendanceStatus, SchoolJustificationStatus } from '@ocall/shared';
import { ChildHeader, useChild } from '@/components/parents/parent-shell';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface AttendanceView {
  stats: {
    sessions: number;
    present: number;
    absent: number;
    late: number;
    excused: number;
    presenceRate: number | null;
  };
  /** Statistiques sur toute la période, liste limitée aux relevés les plus récents. */
  truncated: boolean;
  records: {
    id: string;
    status: SchoolAttendanceStatus;
    minutesLate: number | null;
    date: string;
    slot: string;
  }[];
  justifications: {
    id: string;
    fromDate: string;
    toDate: string;
    reason: string;
    status: SchoolJustificationStatus;
    reviewNote: string | null;
  }[];
}

const TONE: Record<SchoolAttendanceStatus, 'forest' | 'terracotta' | 'savanna' | 'neutral'> = {
  PRESENT: 'forest',
  ABSENT: 'terracotta',
  LATE: 'savanna',
  EXCUSED: 'neutral',
};

/** Présences et absences d'un enfant ; transmission d'un motif d'absence, soumis à validation. */
export default function ChildAttendancePage() {
  const { id } = useParams<{ id: string }>();
  const child = useChild(id);
  const { t, date } = useSchoolText();
  const data = useApi<AttendanceView>(`/school/portal/children/${id}/attendance`);
  if (!child) return <Alert tone="info" title={t('par.noChildren')} />;
  return (
    <>
      <ChildHeader child={child} />
      {data.state === 'loading' ? (
        <LoadingState />
      ) : data.state === 'error' ? (
        <ErrorState error={data.error} onRetry={data.reload} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="attendance-stats">
            {[
              [
                t('par.att.rate'),
                data.data.stats.presenceRate === null
                  ? '—'
                  : `${(data.data.stats.presenceRate / 100).toLocaleString('fr-FR')} %`,
              ],
              [t('par.att.status.ABSENT'), data.data.stats.absent],
              [t('par.att.status.LATE'), data.data.stats.late],
              [t('par.att.status.EXCUSED'), data.data.stats.excused],
            ].map(([label, value]) => (
              <Card key={String(label)}>
                <CardBody>
                  <p className="text-xs text-muted">{label}</p>
                  <p className="text-xl font-semibold">{value}</p>
                </CardBody>
              </Card>
            ))}
          </div>
          <Card>
            <CardBody>
              <h3 className="mb-2 font-semibold">{t('par.att.records')}</h3>
              {data.data.truncated && (
                <p className="mb-2 text-xs text-muted" data-testid="attendance-truncated">
                  {t('par.att.truncated', { n: data.data.records.length })}
                </p>
              )}
              {data.data.records.length === 0 ? (
                <p className="text-sm text-muted">{t('par.att.none')}</p>
              ) : (
                <ul className="divide-y divide-line/70 text-sm" data-testid="attendance-records">
                  {data.data.records.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2"
                    >
                      <span>
                        {date(r.date)} · {r.slot}
                      </span>
                      <Badge tone={TONE[r.status]}>
                        {t(`par.att.status.${r.status}`)}
                        {r.minutesLate ? ` · ${t('par.att.minutes', { n: r.minutesLate })}` : ''}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          {child.access === 'full' && <JustifyForm studentId={id} onSent={data.reload} />}
          <Card>
            <CardBody>
              <h3 className="mb-2 font-semibold">{t('par.att.justifications')}</h3>
              {data.data.justifications.length === 0 ? (
                <p className="text-sm text-muted">{t('par.att.none')}</p>
              ) : (
                <ul className="divide-y divide-line/70 text-sm">
                  {data.data.justifications.map((j) => (
                    <li key={j.id} className="space-y-1 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          {date(j.fromDate)}
                          {j.toDate !== j.fromDate ? ` → ${date(j.toDate)}` : ''}
                        </span>
                        <Badge
                          tone={
                            j.status === 'ACCEPTED'
                              ? 'forest'
                              : j.status === 'REJECTED'
                                ? 'terracotta'
                                : 'savanna'
                          }
                        >
                          {t(`par.just.${j.status}`)}
                        </Badge>
                      </div>
                      <p className="text-muted">{j.reason}</p>
                      {j.reviewNote && <p className="text-xs text-muted">{j.reviewNote}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </>
  );
}

function JustifyForm({ studentId, onSent }: { studentId: string; onSent: () => void }) {
  const { t } = useSchoolText();
  const [fromDate, setFrom] = useState('');
  const [toDate, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSent(false);
    try {
      await api(`/school/portal/children/${studentId}/justifications`, {
        method: 'POST',
        body: { fromDate, toDate: toDate || fromDate, reason },
      });
      setSent(true);
      setReason('');
      onSent();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardBody>
        <h3 className="mb-2 font-semibold">{t('par.att.justify')}</h3>
        <form className="space-y-3" onSubmit={(e) => void submit(e)} data-testid="justify-form">
          {sent && <Alert tone="success" title={t('par.att.sent')} />}
          <ApiErrorAlert error={error} />
          <div className="grid gap-3 sm:grid-cols-2">
            <InputField
              label={t('par.att.from')}
              type="date"
              required
              value={fromDate}
              onChange={(e) => setFrom(e.target.value)}
            />
            <InputField
              label={t('par.att.to')}
              type="date"
              value={toDate}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <InputField
            label={t('par.att.reason')}
            required
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button type="submit" loading={loading} disabled={!fromDate || reason.trim().length < 3}>
            {t('par.att.submit')}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

'use client';

import { type FormEvent, useState } from 'react';
import type { SchoolJustificationStatus } from '@ocall/shared';
import { StudentPicker, YearPicker } from '@/components/school/school-finance';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { SchoolPage } from '@/components/school/school-page';
import { StudentName } from '@/components/school/school-students';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface Justification {
  id: string;
  fromDate: string;
  toDate: string;
  reason: string;
  byGuardian: boolean;
  status: SchoolJustificationStatus;
  reviewNote: string | null;
  student: {
    id: string;
    matricule: string;
    lastName: string;
    firstName: string;
    lastNameAr: string | null;
    firstNameAr: string | null;
  };
}

/** Justificatifs d'absence : examen des motifs des familles, saisie par l'établissement (Sprint 6). */
export default function JustificationsPage() {
  return (
    <SchoolPage title="just.title" description="just.desc">
      {({ school, canWrite }) => (
        <Justifications
          key={school!.id}
          schoolId={school!.id}
          canReview={canWrite('school.attendance.justify')}
        />
      )}
    </SchoolPage>
  );
}

function Justifications({ schoolId, canReview }: { schoolId: string; canReview: boolean }) {
  const { t, date } = useSchoolText();
  const [status, setStatus] = useState<SchoolJustificationStatus | ''>('PENDING');
  const list = useApi<Justification[]>(
    `/school/attendance/justifications?schoolId=${schoolId}${status ? `&status=${status}` : ''}`,
  );
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<ApiError | null>(null);

  async function review(id: string, decision: 'ACCEPTED' | 'REJECTED') {
    setError(null);
    try {
      await api(`/school/attendance/justifications/${id}/review`, {
        method: 'POST',
        body: { decision, note: notes[id]?.trim() || null },
      });
      list.reload();
    } catch (e) {
      setError(toApiError(e));
    }
  }

  return (
    <>
      <div className="max-w-xs">
        <SelectField
          label={t('par.att.justifications')}
          value={status}
          onChange={(e) => setStatus(e.target.value as SchoolJustificationStatus | '')}
          options={[
            { value: 'PENDING', label: t('par.just.PENDING') },
            { value: 'ACCEPTED', label: t('par.just.ACCEPTED') },
            { value: 'REJECTED', label: t('par.just.REJECTED') },
            { value: '', label: '—' },
          ]}
        />
      </div>
      <ApiErrorAlert error={error} />
      {list.state === 'loading' ? (
        <LoadingState />
      ) : list.state === 'error' ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : list.data.length === 0 ? (
        <Alert tone="info" title={t('just.none')} />
      ) : (
        <Card>
          <ul className="divide-y divide-line/70" data-testid="justifications">
            {list.data.map((j) => (
              <li key={j.id} className="space-y-2 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    <StudentName student={j.student} />
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
                <p>
                  {date(j.fromDate)}
                  {j.toDate !== j.fromDate ? ` → ${date(j.toDate)}` : ''} ·{' '}
                  {j.byGuardian ? t('just.byGuardian') : t('just.byStaff')}
                </p>
                <p className="text-muted">{j.reason}</p>
                {j.reviewNote && <p className="text-xs text-muted">{j.reviewNote}</p>}
                {canReview && j.status === 'PENDING' && (
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-60 flex-1">
                      <InputField
                        label={t('just.note')}
                        value={notes[j.id] ?? ''}
                        maxLength={300}
                        onChange={(e) => setNotes((n) => ({ ...n, [j.id]: e.target.value }))}
                      />
                    </div>
                    <Button size="sm" onClick={() => void review(j.id, 'ACCEPTED')}>
                      {t('just.accept')}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => void review(j.id, 'REJECTED')}
                    >
                      {t('just.reject')}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {canReview && (
        <Card>
          <CardBody>
            <h2 className="mb-3 font-semibold">{t('just.new')}</h2>
            <YearPicker schoolId={schoolId}>
              {(year) => (
                <StudentPicker schoolYearId={year.id} includeLeavers>
                  {(student) => <StaffJustification studentId={student.id} onDone={list.reload} />}
                </StudentPicker>
              )}
            </YearPicker>
          </CardBody>
        </Card>
      )}
    </>
  );
}

function StaffJustification({ studentId, onDone }: { studentId: string; onDone: () => void }) {
  const { t } = useSchoolText();
  const [fromDate, setFrom] = useState('');
  const [toDate, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setDone(false);
    try {
      await api('/school/attendance/justifications', {
        method: 'POST',
        body: { studentId, fromDate, toDate: toDate || fromDate, reason },
      });
      setDone(true);
      setReason('');
      onDone();
    } catch (e) {
      setError(toApiError(e));
    }
  }

  return (
    <form className="mt-3 space-y-3" onSubmit={(e) => void submit(e)}>
      {done && <Alert tone="success" title={t('par.just.ACCEPTED')} />}
      <ApiErrorAlert error={error} />
      <div className="grid gap-3 sm:grid-cols-3">
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
        <InputField
          label={t('par.att.reason')}
          required
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={!fromDate || reason.trim().length < 3}>
        {t('just.new')}
      </Button>
    </form>
  );
}

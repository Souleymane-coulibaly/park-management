'use client';

import { useState } from 'react';
import {
  type FeeView,
  Money,
  type StudentNames,
  YearPicker,
} from '@/components/school/school-finance';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { SchoolPage } from '@/components/school/school-page';
import { StudentName } from '@/components/school/school-students';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface FeeDetail {
  fee: FeeView;
  students: (StudentNames & { billed: boolean })[];
}

/** Échéanciers (Sprint 5) : échéances d'un frais et génération par élève, jamais deux fois. */
export default function SchedulesPage() {
  return (
    <SchoolPage title="fin.schedules.title" description="fin.schedules.desc">
      {({ school, canWrite }) => (
        <YearPicker key={school!.id} schoolId={school!.id}>
          {(year) => (
            <Schedules
              key={year.id}
              yearId={year.id}
              canGenerate={canWrite('school.finance.settings') && year.status !== 'CLOSED'}
            />
          )}
        </YearPicker>
      )}
    </SchoolPage>
  );
}

function Schedules({ yearId, canGenerate }: { yearId: string; canGenerate: boolean }) {
  const { t, name } = useSchoolText();
  const fees = useApi<FeeView[]>(`/school/finance/fees?schoolYearId=${yearId}`);
  const [feeId, setFeeId] = useState('');
  if (fees.state === 'loading') return <LoadingState />;
  if (fees.state === 'error') return <ErrorState error={fees.error} onRetry={fees.reload} />;
  const active = fees.data.filter((f) => f.isActive);
  const fee = active.find((f) => f.id === feeId) ?? active[0];
  if (!fee) return <Alert tone="info" title={t('fin.fees.empty')} />;
  return (
    <>
      <div className="max-w-sm">
        <SelectField
          label={t('fin.fee')}
          value={fee.id}
          onChange={(e) => setFeeId(e.target.value)}
          options={active.map((f) => ({ value: f.id, label: name(f) }))}
        />
      </div>
      <FeeSchedule
        key={fee.id}
        feeId={fee.id}
        canGenerate={canGenerate}
        onGenerated={fees.reload}
      />
    </>
  );
}

function FeeSchedule({
  feeId,
  canGenerate,
  onGenerated,
}: {
  feeId: string;
  canGenerate: boolean;
  onGenerated: () => void;
}) {
  const { t, date } = useSchoolText();
  const detail = useApi<FeeDetail>(`/school/finance/fees/${feeId}`);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<{ created: number } | null>(null);
  const [loading, setLoading] = useState(false);
  if (detail.state === 'loading') return <LoadingState />;
  if (detail.state === 'error') return <ErrorState error={detail.error} onRetry={detail.reload} />;
  const { fee, students } = detail.data;

  async function generate() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api<{ created: number }>(`/school/finance/fees/${feeId}/generate`, {
        method: 'POST',
        body: fee.mandatory ? {} : { studentIds: [...selected] },
      });
      setResult(res);
      setSelected(new Set());
      detail.reload();
      onGenerated();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Card>
        <CardBody>
          <h2 className="mb-2 font-semibold">{t(`fin.plan.${fee.planKind}`)}</h2>
          <ul className="grid gap-1 text-sm sm:grid-cols-3" data-testid="installments">
            {fee.installments.map((i) => (
              <li
                key={i.position}
                className="flex justify-between gap-2 rounded-lg bg-ivory/60 px-3 py-1.5"
              >
                <span>
                  {i.position}. {date(i.dueOn)}
                </span>
                <Money value={i.amount} currency={fee.currency} />
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      <ApiErrorAlert error={error} />
      {result && <Alert tone="success" title={t('fin.generated', { n: result.created })} />}
      <Card>
        <CardBody>
          <p className="mb-2 text-sm text-muted">
            {fee.mandatory ? t('fin.generateAllHint') : t('fin.generateSelectHint')}
          </p>
          <ul className="divide-y divide-line/70" data-testid="fee-students">
            {students.length === 0 && (
              <li className="py-4 text-sm text-muted">{t('grades.noStudent')}</li>
            )}
            {students.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
                {!fee.mandatory && canGenerate && !s.billed && (
                  <input
                    type="checkbox"
                    aria-label={s.matricule}
                    checked={selected.has(s.id)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(s.id);
                      else next.delete(s.id);
                      setSelected(next);
                    }}
                  />
                )}
                <span className="min-w-0 flex-1">
                  <StudentName student={s} />
                  <span className="ms-2 text-xs text-muted">{s.matricule}</span>
                </span>
                <Badge tone={s.billed ? 'forest' : 'neutral'}>
                  {t(s.billed ? 'fin.billedYes' : 'fin.billedNo')}
                </Badge>
              </li>
            ))}
          </ul>
          {canGenerate && (
            <Button
              className="mt-3"
              loading={loading}
              disabled={!fee.mandatory && selected.size === 0}
              onClick={() => void generate()}
            >
              {t('fin.generate')}
            </Button>
          )}
        </CardBody>
      </Card>
    </>
  );
}

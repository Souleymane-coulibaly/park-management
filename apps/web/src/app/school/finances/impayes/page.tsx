'use client';

import { useState } from 'react';
import { downloadPdf } from '@/components/school/school-assessment';
import {
  Money,
  type StudentNames,
  YearPicker,
  useFinanceSettings,
} from '@/components/school/school-finance';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { SchoolPage } from '@/components/school/school-page';
import type { ClassOption } from '@/components/school/school-students';
import { StudentName } from '@/components/school/school-students';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import type { ApiError } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface UnpaidRow {
  student: StudentNames;
  className: string | null;
  overdue: number;
  balance: number;
  oldestDue: string | null;
  count: number;
}

/** Impayés (Sprint 5) : élèves dont une échéance est en retard, du plus gros retard au plus petit. */
export default function UnpaidPage() {
  return (
    <SchoolPage title="fin.unpaid.title" description="fin.unpaid.desc">
      {({ school }) => (
        <YearPicker key={school!.id} schoolId={school!.id}>
          {(year) => <Unpaid key={year.id} schoolId={school!.id} yearId={year.id} />}
        </YearPicker>
      )}
    </SchoolPage>
  );
}

function Unpaid({ schoolId, yearId }: { schoolId: string; yearId: string }) {
  const { t, name, date } = useSchoolText();
  const settings = useFinanceSettings(schoolId);
  const classes = useApi<ClassOption[]>(`/school/classes?schoolYearId=${yearId}`);
  const [classId, setClassId] = useState('');
  const query = `schoolYearId=${yearId}${classId ? `&classId=${classId}` : ''}`;
  const rows = useApi<UnpaidRow[]>(`/school/finance/unpaid?${query}`);
  const [error, setError] = useState<ApiError | null>(null);
  async function exportFile(format: 'csv' | 'xlsx') {
    setError(null);
    try {
      await downloadPdf(
        `/school/finance/export?${query}&kind=unpaid&format=${format}`,
        `impayes.${format}`,
      );
    } catch (e) {
      setError(toApiError(e));
    }
  }

  // Montants affichés seulement dans la devise réelle de l'établissement, jamais une devise provisoire.
  if (settings.state === 'loading') return <LoadingState />;
  if (settings.state === 'error')
    return <ErrorState error={settings.error} onRetry={settings.reload} />;
  const currency = settings.data.currency;

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56">
          <SelectField
            label={t('pick.class')}
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
            options={[
              { value: '', label: t('fin.allClasses') },
              ...(classes.state === 'success' ? classes.data : []).map((c) => ({
                value: c.id,
                label: name(c),
              })),
            ]}
          />
        </div>
        <Button variant="secondary" onClick={() => void exportFile('csv')}>
          {t('fin.exportCsv')}
        </Button>
        <Button variant="secondary" onClick={() => void exportFile('xlsx')}>
          {t('fin.exportXlsx')}
        </Button>
      </div>
      <ApiErrorAlert error={error} />
      {rows.state === 'loading' ? (
        <LoadingState />
      ) : rows.state === 'error' ? (
        <ErrorState error={rows.error} onRetry={rows.reload} />
      ) : (
        <Card>
          <ul className="divide-y divide-line/70" data-testid="unpaid-list">
            {rows.data.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-muted">{t('fin.unpaid.empty')}</li>
            )}
            {rows.data.map((r) => (
              <li
                key={r.student.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
                data-testid="unpaid-row"
              >
                <span className="min-w-0 flex-1">
                  <StudentName student={r.student} />
                  <span className="block text-xs text-muted">
                    {r.student.matricule}
                    {r.className ? ` · ${r.className}` : ''}
                    {r.oldestDue ? ` · ${t('fin.since', { date: date(r.oldestDue) })}` : ''}
                  </span>
                </span>
                <span className="text-end">
                  <span className="block font-semibold text-terracotta-dark">
                    <Money value={r.overdue} currency={currency} />
                  </span>
                  <span className="block text-xs text-muted">
                    {t('fin.totalBalance')} : <Money value={r.balance} currency={currency} />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

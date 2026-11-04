'use client';

import {
  DEFAULT_SCHOOL_GRADING_RULES,
  type SchoolAbsenceRule,
  type SchoolGradingRules,
} from '@ocall/shared';
import { useState } from 'react';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { SchoolPage } from '@/components/school/school-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface PolicyView {
  id: string;
  version: number;
  effectiveFrom: string;
  rules: SchoolGradingRules;
}

export default function NotationPage() {
  return (
    <SchoolPage title="grading.title" description="grading.desc">
      {({ school, canWrite }) => (
        <Policies
          key={school!.id}
          schoolId={school!.id}
          canManage={canWrite('school.grading.manage')}
        />
      )}
    </SchoolPage>
  );
}

function Policies({ schoolId, canManage }: { schoolId: string; canManage: boolean }) {
  const { t, date } = useSchoolText();
  const policies = useApi<PolicyView[]>(`/school/grading-policies?schoolId=${schoolId}`);
  const [scale, setScale] = useState(String(DEFAULT_SCHOOL_GRADING_RULES.scale));
  const [passMark, setPassMark] = useState(String(DEFAULT_SCHOOL_GRADING_RULES.passMark));
  const [decimals, setDecimals] = useState(String(DEFAULT_SCHOOL_GRADING_RULES.decimals));
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [ranking, setRanking] = useState('SHARED');
  const [absences, setAbsences] = useState<SchoolAbsenceRule>('EXCLUDED');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  async function save() {
    setLoading(true);
    setError(null);
    try {
      await api('/school/grading-policies', {
        method: 'POST',
        body: {
          schoolId,
          effectiveFrom,
          rules: {
            scale: Number(scale),
            passMark: Number(passMark),
            decimals: Number(decimals),
            ranking: {
              enabled: ranking !== 'DISABLED',
              ties: ranking === 'DENSE' ? 'DENSE' : 'SHARED',
              excludedSubjectIds: [],
            },
            absences,
          },
        },
      });
      policies.reload();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoading(false);
    }
  }

  if (policies.state === 'loading') return <LoadingState />;
  if (policies.state === 'error') {
    return <ErrorState error={policies.error} onRetry={policies.reload} />;
  }
  return (
    <>
      <Card>
        <ul className="divide-y divide-line/70 text-sm" data-testid="policy-list">
          {policies.data.length === 0 && (
            <li className="px-4 py-6 text-center text-muted">{t('grading.empty')}</li>
          )}
          {policies.data.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Badge tone="forest">{t('grading.version', { n: p.version })}</Badge>
              <span className="flex-1">
                {t('grading.summary', {
                  scale: p.rules.scale,
                  passMark: p.rules.passMark,
                  decimals: p.rules.decimals,
                  ranking: t(
                    p.rules.ranking.enabled ? 'grading.rankingShown' : 'grading.rankingHidden',
                  ),
                })}
              </span>
              <span className="text-muted">
                {t('grading.from', { date: date(p.effectiveFrom) })}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      {canManage && (
        <Card>
          <CardBody>
            <h2 className="mb-3 font-semibold">{t('grading.new')}</h2>
            <div className="space-y-3" data-testid="policy-form">
              <ApiErrorAlert error={error} />
              <div className="grid gap-3 sm:grid-cols-2">
                <InputField
                  label={t('grading.scale')}
                  type="number"
                  value={scale}
                  onChange={(e) => setScale(e.target.value)}
                />
                <InputField
                  label={t('grading.passMark')}
                  type="number"
                  step="any"
                  value={passMark}
                  onChange={(e) => setPassMark(e.target.value)}
                />
                <InputField
                  label={t('grading.decimals')}
                  type="number"
                  value={decimals}
                  onChange={(e) => setDecimals(e.target.value)}
                />
                <InputField
                  label={t('grading.effectiveFrom')}
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                />
                <SelectField
                  label={t('grading.ranking')}
                  value={ranking}
                  onChange={(e) => setRanking(e.target.value)}
                  options={[
                    { value: 'SHARED', label: t('grading.shared') },
                    { value: 'DENSE', label: t('grading.dense') },
                    { value: 'DISABLED', label: t('grading.disabled') },
                  ]}
                />
                <SelectField
                  label={t('grading.absences')}
                  value={absences}
                  onChange={(e) => setAbsences(e.target.value as SchoolAbsenceRule)}
                  options={[
                    { value: 'EXCLUDED', label: t('grading.absencesExcluded') },
                    { value: 'ZERO', label: t('grading.absencesZero') },
                  ]}
                />
              </div>
              <Button loading={loading} disabled={!effectiveFrom} onClick={() => void save()}>
                {t('grading.save')}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </>
  );
}

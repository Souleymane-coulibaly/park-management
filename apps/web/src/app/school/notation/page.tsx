'use client';

import { DEFAULT_SCHOOL_GRADING_RULES, type SchoolGradingRules } from '@ocall/shared';
import { useState } from 'react';
import { SchoolPage } from '@/components/school/school-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/use-api';

interface PolicyView {
  id: string;
  version: number;
  effectiveFrom: string;
  rules: SchoolGradingRules;
}

export default function NotationPage() {
  return (
    <SchoolPage
      title="Règles de notation"
      description="Chaque modification crée une nouvelle version : les anciennes restent intactes."
    >
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
  const policies = useApi<PolicyView[]>(`/school/grading-policies?schoolId=${schoolId}`);
  const [scale, setScale] = useState(String(DEFAULT_SCHOOL_GRADING_RULES.scale));
  const [passMark, setPassMark] = useState(String(DEFAULT_SCHOOL_GRADING_RULES.passMark));
  const [decimals, setDecimals] = useState(String(DEFAULT_SCHOOL_GRADING_RULES.decimals));
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [ranking, setRanking] = useState('SHARED');
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
          },
        },
      });
      policies.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion impossible.'));
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
            <li className="px-4 py-6 text-center text-muted">Aucune règle définie.</li>
          )}
          {policies.data.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Badge tone="forest">Version {p.version}</Badge>
              <span className="flex-1">
                Sur {p.rules.scale}, passage à {p.rules.passMark}, {p.rules.decimals} décimale(s),
                classement {p.rules.ranking.enabled ? 'affiché' : 'masqué'}
              </span>
              <span className="text-muted">À partir du {formatDate(p.effectiveFrom)}</span>
            </li>
          ))}
        </ul>
      </Card>
      {canManage && (
        <Card>
          <CardBody>
            <h2 className="mb-3 font-semibold">Nouvelle version</h2>
            <div className="space-y-3" data-testid="policy-form">
              <ApiErrorAlert error={error} />
              <div className="grid gap-3 sm:grid-cols-2">
                <InputField
                  label="Note maximale"
                  type="number"
                  value={scale}
                  onChange={(e) => setScale(e.target.value)}
                />
                <InputField
                  label="Moyenne de passage"
                  type="number"
                  step="any"
                  value={passMark}
                  onChange={(e) => setPassMark(e.target.value)}
                />
                <InputField
                  label="Décimales"
                  type="number"
                  value={decimals}
                  onChange={(e) => setDecimals(e.target.value)}
                />
                <InputField
                  label="Applicable à partir du"
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                />
                <SelectField
                  label="Classement"
                  value={ranking}
                  onChange={(e) => setRanking(e.target.value)}
                  options={[
                    { value: 'SHARED', label: 'Ex æquo partagés (1, 1, 3)' },
                    { value: 'DENSE', label: 'Ex æquo sans saut (1, 1, 2)' },
                    { value: 'DISABLED', label: 'Rangs non affichés' },
                  ]}
                />
              </div>
              <Button loading={loading} disabled={!effectiveFrom} onClick={() => void save()}>
                Enregistrer la version
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </>
  );
}

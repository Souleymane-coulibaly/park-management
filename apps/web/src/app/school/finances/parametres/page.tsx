'use client';

import { SCHOOL_CURRENCY_CODES, type SchoolCurrency } from '@ocall/shared';
import { useState } from 'react';
import { type FinanceSettingsView, useFinanceSettings } from '@/components/school/school-finance';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { SchoolPage } from '@/components/school/school-page';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';

/** Paramètres financiers (Sprint 5) : devise, préfixe des reçus, droit de caisse du secrétariat. */
export default function FinanceSettingsPage() {
  return (
    <SchoolPage title="fin.settings.title" description="fin.settings.desc">
      {({ school, canWrite }) => (
        <Settings
          key={school!.id}
          schoolId={school!.id}
          canManage={canWrite('school.finance.settings')}
        />
      )}
    </SchoolPage>
  );
}

function Settings({ schoolId, canManage }: { schoolId: string; canManage: boolean }) {
  const settings = useFinanceSettings(schoolId);
  if (settings.state === 'loading') return <LoadingState />;
  if (settings.state === 'error')
    return <ErrorState error={settings.error} onRetry={settings.reload} />;
  return (
    <SettingsForm
      schoolId={schoolId}
      initial={settings.data}
      canManage={canManage}
      onSaved={settings.reload}
    />
  );
}

function SettingsForm({
  schoolId,
  initial,
  canManage,
  onSaved,
}: {
  schoolId: string;
  initial: FinanceSettingsView;
  canManage: boolean;
  onSaved: () => void;
}) {
  const { t } = useSchoolText();
  const [currency, setCurrency] = useState<SchoolCurrency>(initial.currency);
  const [prefix, setPrefix] = useState(initial.receiptPrefix);
  const [secretary, setSecretary] = useState(initial.secretaryCanCollect);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  async function save() {
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      await api('/school/finance/settings', {
        method: 'PUT',
        body: {
          schoolId,
          currency,
          receiptPrefix: prefix.trim().toUpperCase(),
          secretaryCanCollect: secretary,
        },
      });
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardBody>
        <div className="space-y-4" data-testid="finance-settings">
          <ApiErrorAlert error={error} />
          {saved && <Alert tone="success" title={t('results.saved')} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label={t('fin.currency')}
              value={currency}
              disabled={!canManage}
              onChange={(e) => setCurrency(e.target.value as SchoolCurrency)}
              options={SCHOOL_CURRENCY_CODES.map((c) => ({ value: c, label: c }))}
              hint={t('fin.currencyHint')}
            />
            <InputField
              label={t('fin.receiptPrefix')}
              value={prefix}
              disabled={!canManage}
              maxLength={8}
              onChange={(e) => setPrefix(e.target.value)}
              hint={t('fin.receiptPrefixHint')}
            />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={secretary}
              disabled={!canManage}
              onChange={(e) => setSecretary(e.target.checked)}
            />
            <span>
              <span className="font-medium">{t('fin.secretaryCanCollect')}</span>
              <span className="block text-muted">{t('fin.secretaryCanCollectHint')}</span>
            </span>
          </label>
          {canManage && (
            <Button loading={loading} onClick={() => void save()}>
              {t('periods.save')}
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

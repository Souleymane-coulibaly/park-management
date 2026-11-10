'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { FACTURE_REMINDER_HOURS } from '@ocall/shared';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface NotificationSettingsView {
  enabled: boolean;
  sendConfirmation: boolean;
  reminderDayBefore: boolean;
  reminderHoursBefore: number | null;
  emailFallback: boolean;
  whatsappAvailable: boolean;
  emailAvailable: boolean;
}

type Values = Omit<NotificationSettingsView, 'whatsappAvailable' | 'emailAvailable'>;

/**
 * Notifications de rendez-vous (F4) : confirmation, report, rappels et annulation des interventions,
 * par WhatsApp (clients consentants) ou par e-mail en secours.
 */
export function NotificationSettings({ editable }: { editable: boolean }) {
  const res = useApi<NotificationSettingsView>('/facture/notification-settings');
  const [values, setValues] = useState<Values | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const data = res.state === 'success' ? res.data : null;

  useEffect(() => {
    if (!data) return;
    setValues({
      enabled: data.enabled,
      sendConfirmation: data.sendConfirmation,
      reminderDayBefore: data.reminderDayBefore,
      reminderHoursBefore: data.reminderHoursBefore,
      emailFallback: data.emailFallback,
    });
  }, [data]);

  if (res.state === 'loading' || !values) return res.state === 'error' ? null : <LoadingState />;
  if (res.state === 'error') return <ErrorState error={res.error} onRetry={res.reload} />;
  const view = res.data;

  const toggle = (key: keyof Values, label: string, testId: string) => (
    <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
      <input
        type="checkbox"
        className="h-5 w-5 accent-forest"
        data-testid={testId}
        checked={Boolean(values[key])}
        disabled={!editable}
        onChange={(e) => {
          setSaved(false);
          setValues({ ...values, [key]: e.target.checked });
        }}
      />
      {label}
    </label>
  );

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/facture/notification-settings', { method: 'PUT', body: values });
      setSaved(true);
      res.reload();
    } catch (err) {
      setError(
        err instanceof ApiError ? err : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Notifications de rendez-vous"
        description="Vos clients sont prévenus de leurs interventions : confirmation, report, rappels, annulation."
      />
      <CardBody>
        <form className="space-y-4" onSubmit={save} data-testid="facture-notification-settings">
          {!view.whatsappAvailable && (
            <Alert tone="info" title="WhatsApp n’est pas encore branché">
              Les messages partent par e-mail aux clients qui en ont un, en attendant le choix du
              fournisseur WhatsApp.
            </Alert>
          )}
          {toggle(
            'enabled',
            'Prévenir mes clients de leurs rendez-vous',
            'facture-notifications-enabled',
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {toggle(
              'sendConfirmation',
              'Confirmation dès la planification',
              'facture-notifications-confirmation',
            )}
            {toggle('reminderDayBefore', 'Rappel la veille', 'facture-notifications-day-before')}
            {toggle(
              'emailFallback',
              'E-mail en secours (client sans WhatsApp ou sans consentement)',
              'facture-notifications-email',
            )}
          </div>
          <SelectField
            label="Rappel le jour même"
            disabled={!editable}
            value={values.reminderHoursBefore === null ? '' : String(values.reminderHoursBefore)}
            onChange={(e) => {
              setSaved(false);
              setValues({
                ...values,
                reminderHoursBefore: e.target.value ? Number(e.target.value) : null,
              });
            }}
            options={[
              { value: '', label: 'Aucun' },
              ...FACTURE_REMINDER_HOURS.map((h) => ({
                value: String(h),
                label: `${h} heure${h > 1 ? 's' : ''} avant`,
              })),
            ]}
          />
          <p className="text-sm text-muted">
            WhatsApp seulement pour les clients qui l’ont accepté (fiche client). Un rendez-vous
            déplacé ou annulé remplace les rappels prévus ; aucun message n’est envoyé deux fois.
          </p>
          <ApiErrorAlert error={error} />
          {saved && <p className="text-sm font-medium text-forest">Réglages enregistrés.</p>}
          {editable && (
            <Button type="submit" loading={busy}>
              Enregistrer les notifications
            </Button>
          )}
        </form>
      </CardBody>
    </Card>
  );
}

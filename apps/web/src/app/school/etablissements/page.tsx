'use client';

import { useState } from 'react';
import {
  SCHOOL_LOCALES,
  SCHOOL_TYPES,
  SUPPORTED_COUNTRIES,
  type SchoolLocale,
} from '@ocall/shared';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { BiName, SchoolPage, type SchoolSummary } from '@/components/school/school-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { SimpleForm } from '@/components/ui/simple-form';
import { Alert, ApiErrorAlert } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';

export default function EtablissementsPage() {
  return (
    <SchoolPage title="schools.title" description="schools.desc" needsSchool={false}>
      {(page) => (
        <Schools
          schools={page.context.schools}
          canCreate={page.forSchool(null).canWrite('school.schools.manage')}
          canSetLocale={(id) => page.forSchool(id).canWrite('school.structure.manage')}
          reload={page.reloadContext}
        />
      )}
    </SchoolPage>
  );
}

function Schools({
  schools,
  canCreate,
  canSetLocale,
  reload,
}: {
  schools: SchoolSummary[];
  canCreate: boolean;
  canSetLocale: (schoolId: string) => boolean;
  reload: () => void;
}) {
  const { t, labels } = useSchoolText();
  return (
    <>
      <Card>
        <ul className="divide-y divide-line/70" data-testid="school-list">
          {schools.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted">{t('schools.empty')}</li>
          )}
          {schools.map((s) => (
            <li key={s.id} className="space-y-3 px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="w-full min-w-0 font-semibold sm:w-auto sm:flex-1">
                  <BiName name={s.name} nameAr={s.nameAr} locale={s.defaultLocale} />
                </span>
                <Badge tone="neutral">{labels.type[s.type]}</Badge>
                <span className="text-sm text-muted" data-testid="school-locale">
                  {labels.locale[s.defaultLocale]}
                </span>
              </div>
              {canSetLocale(s.id) && <LocaleSetting school={s} onDone={reload} />}
            </li>
          ))}
        </ul>
      </Card>
      {canCreate && (
        <Card>
          <CardBody>
            <h2 className="mb-3 font-semibold">{t('schools.new')}</h2>
            <SimpleForm
              testId="school-form"
              path="/school/schools"
              submitLabel={t('schools.create')}
              onDone={reload}
              // La langue du futur établissement décide du champ arabe, pas celle de l'établissement
              // affiché : le formulaire n'applique donc pas fields().
              fields={[
                { name: 'name', label: t('schools.officialName'), required: true },
                {
                  // Français proposé en premier : tout nouvel établissement est francophone par défaut.
                  name: 'defaultLocale',
                  label: t('schools.locale'),
                  type: 'select',
                  options: SCHOOL_LOCALES.map((l) => ({ value: l, label: labels.locale[l] })),
                },
                {
                  name: 'nameAr',
                  label: t('field.nameAr'),
                  rtl: true,
                  visibleWhen: { field: 'defaultLocale', values: ['AR', 'BILINGUAL'] },
                },
                {
                  name: 'type',
                  label: t('field.type'),
                  type: 'select',
                  options: SCHOOL_TYPES.map((v) => ({ value: v, label: labels.type[v] })),
                },
                {
                  name: 'countryCode',
                  label: t('field.country'),
                  type: 'select',
                  options: SUPPORTED_COUNTRIES.map((c) => ({ value: c.code, label: c.label })),
                },
                { name: 'address', label: t('field.address') },
                { name: 'phone', label: t('field.phone') },
                { name: 'email', label: t('field.email'), type: 'email' },
              ]}
            />
          </CardBody>
        </Card>
      )}
    </>
  );
}

/** Langue de l'établissement : réservée à la direction, journalisée, sans perte de données. */
function LocaleSetting({ school, onDone }: { school: SchoolSummary; onDone: () => void }) {
  const { t, labels } = useSchoolText();
  const [locale, setLocale] = useState<SchoolLocale>(school.defaultLocale);
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api(`/school/schools/${school.id}`, {
        method: 'PATCH',
        body: { defaultLocale: locale },
      });
      setSaved(true);
      onDone();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2" data-testid="locale-setting">
      <ApiErrorAlert error={error} />
      {saved && <Alert tone="success" title={t('schools.localeSaved')} />}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 sm:max-w-xs">
          <SelectField
            label={t('schools.locale')}
            value={locale}
            onChange={(e) => setLocale(e.target.value as SchoolLocale)}
            options={SCHOOL_LOCALES.map((l) => ({ value: l, label: labels.locale[l] }))}
          />
        </div>
        <Button
          variant="secondary"
          loading={saving}
          disabled={locale === school.defaultLocale}
          onClick={() => void save()}
        >
          {t('schools.localeSave')}
        </Button>
      </div>
      <p className="text-sm text-muted">{t('schools.localeHint')}</p>
    </div>
  );
}

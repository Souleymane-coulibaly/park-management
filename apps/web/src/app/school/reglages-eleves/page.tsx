'use client';

import { type FormEvent, useState } from 'react';
import {
  SCHOOL_DOCUMENT_CATEGORIES,
  SCHOOL_DOCUMENT_CATEGORY_LABELS,
  SCHOOL_MATRICULE_SCOPES,
  SCHOOL_MATRICULE_SCOPE_LABELS,
  buildMatricule,
  type SchoolCustomField,
  type SchoolDocumentCategory,
  type SchoolMatriculeScope,
} from '@ocall/shared';
import { SchoolPage } from '@/components/school/school-page';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface Settings {
  matriculeScope: SchoolMatriculeScope;
  matriculePrefix: string;
  matriculeYear: boolean;
  matriculePadding: number;
  requiredDocuments: SchoolDocumentCategory[];
  customFields: SchoolCustomField[];
}

export default function ReglagesElevesPage() {
  return (
    <SchoolPage
      title="Réglages des dossiers"
      description="Format du matricule, pièces obligatoires et champs complémentaires, par établissement."
    >
      {({ school, canWrite }) => (
        <Loader
          key={school!.id}
          schoolId={school!.id}
          canEdit={canWrite('school.students.settings')}
        />
      )}
    </SchoolPage>
  );
}

function Loader({ schoolId, canEdit }: { schoolId: string; canEdit: boolean }) {
  const settings = useApi<Settings>(`/school/student-settings?schoolId=${schoolId}`);
  if (settings.state === 'loading') return <LoadingState />;
  if (settings.state === 'error') {
    return <ErrorState error={settings.error} onRetry={settings.reload} />;
  }
  return <Form schoolId={schoolId} initial={settings.data} canEdit={canEdit} />;
}

function Form({
  schoolId,
  initial,
  canEdit,
}: {
  schoolId: string;
  initial: Settings;
  canEdit: boolean;
}) {
  const [values, setValues] = useState(initial);
  const [fieldLabel, setFieldLabel] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const year = new Date().getFullYear();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      setValues(
        await api<Settings>(`/school/student-settings?schoolId=${schoolId}`, {
          method: 'PUT',
          body: values,
        }),
      );
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion impossible.'));
    } finally {
      setLoading(false);
    }
  }

  function addField() {
    const key = fieldLabel
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^[^a-z]+/, '');
    if (!key || values.customFields.some((f) => f.key === key)) return;
    setValues({
      ...values,
      customFields: [...values.customFields, { key: key.slice(0, 40), label: fieldLabel.trim() }],
    });
    setFieldLabel('');
  }

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="student-settings">
      <ApiErrorAlert error={error} />
      {saved && <Alert tone="success" title="Réglages enregistrés." />}
      <Card>
        <CardBody>
          <h2 className="mb-1 font-semibold">Matricule</h2>
          <p className="mb-3 text-sm text-muted">
            Exemple :{' '}
            <span data-testid="matricule-example">
              {buildMatricule(
                {
                  prefix: values.matriculePrefix,
                  includeYear: values.matriculeYear,
                  padding: values.matriculePadding,
                },
                year,
                45,
              )}
            </span>
            . Un changement ne s’applique qu’aux prochains dossiers.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Unicité"
              disabled={!canEdit}
              value={values.matriculeScope}
              onChange={(e) =>
                setValues({ ...values, matriculeScope: e.target.value as SchoolMatriculeScope })
              }
              options={SCHOOL_MATRICULE_SCOPES.map((s) => ({
                value: s,
                label: SCHOOL_MATRICULE_SCOPE_LABELS[s],
              }))}
            />
            <InputField
              label="Préfixe (lettres et chiffres)"
              disabled={!canEdit}
              maxLength={10}
              value={values.matriculePrefix}
              onChange={(e) => setValues({ ...values, matriculePrefix: e.target.value })}
            />
            <InputField
              label="Nombre de chiffres"
              type="number"
              min={3}
              max={8}
              disabled={!canEdit}
              value={values.matriculePadding}
              onChange={(e) => setValues({ ...values, matriculePadding: Number(e.target.value) })}
            />
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="h-5 w-5 accent-forest"
                disabled={!canEdit}
                checked={values.matriculeYear}
                onChange={(e) => setValues({ ...values, matriculeYear: e.target.checked })}
              />
              Inclure l’année
            </label>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <h2 className="mb-3 font-semibold">Pièces exigées pour valider une inscription</h2>
          <div className="grid gap-1 sm:grid-cols-2">
            {SCHOOL_DOCUMENT_CATEGORIES.map((c) => (
              <label key={c} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-forest"
                  disabled={!canEdit}
                  checked={values.requiredDocuments.includes(c)}
                  onChange={(e) =>
                    setValues({
                      ...values,
                      requiredDocuments: e.target.checked
                        ? [...values.requiredDocuments, c]
                        : values.requiredDocuments.filter((d) => d !== c),
                    })
                  }
                />
                {SCHOOL_DOCUMENT_CATEGORY_LABELS[c]}
              </label>
            ))}
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <h2 className="mb-1 font-semibold">Champs complémentaires</h2>
          <p className="mb-3 text-sm text-muted">
            Dix au plus. Les données sensibles (religion, santé, origine…) sont refusées.
          </p>
          <ul className="mb-3 space-y-2 text-sm" data-testid="custom-fields">
            {values.customFields.length === 0 && <li className="text-muted">Aucun champ.</li>}
            {values.customFields.map((f) => (
              <li key={f.key} className="flex flex-wrap items-center justify-between gap-2">
                {f.label}
                {canEdit && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setValues({
                        ...values,
                        customFields: values.customFields.filter((x) => x.key !== f.key),
                      })
                    }
                  >
                    Retirer
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <InputField
                  label="Nouveau champ"
                  value={fieldLabel}
                  onChange={(e) => setFieldLabel(e.target.value)}
                />
              </div>
              <Button type="button" variant="secondary" onClick={addField}>
                Ajouter
              </Button>
            </div>
          )}
        </CardBody>
      </Card>
      {canEdit && (
        <Button type="submit" loading={loading}>
          Enregistrer
        </Button>
      )}
    </form>
  );
}

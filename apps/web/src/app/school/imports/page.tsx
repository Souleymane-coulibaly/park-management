'use client';

import { useState } from 'react';
import {
  SCHOOL_IMPORT_FIELDS,
  SCHOOL_IMPORT_FIELD_LABELS,
  type SchoolImportField,
  type SchoolImportMapping,
} from '@ocall/shared';
import { SchoolPage, type SchoolPageApi } from '@/components/school/school-page';
import { useYears } from '@/components/school/school-students';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, LoadingState } from '@/components/ui/states';
import { ApiError, apiUpload } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/use-api';

interface Issue {
  line: number;
  message: string;
}

interface Preview {
  format: 'CSV' | 'XLSX';
  headers: string[];
  mapping: SchoolImportMapping;
  total: number;
  valid: number;
  duplicates: Issue[];
  errors: Issue[];
  sample: {
    line: number;
    lastName: string;
    firstName: string;
    lastNameAr: string | null;
    firstNameAr: string | null;
    birthDate: string;
    matricule: string | null;
  }[];
}

interface Job {
  id: string;
  format: string;
  totalRows: number;
  createdRows: number;
  duplicateRows: number;
  errorRows: number;
  createdAt: string;
}

const FIELDS = Object.keys(SCHOOL_IMPORT_FIELDS) as SchoolImportField[];

export default function ImportsPage() {
  return (
    <SchoolPage
      title="Importer des élèves"
      description="Fichier CSV ou Excel, 1 000 lignes au plus. Rien n’est enregistré avant votre confirmation."
    >
      {(page) => <Import key={page.school!.id} page={page} schoolId={page.school!.id} />}
    </SchoolPage>
  );
}

function Import({ page, schoolId }: { page: SchoolPageApi; schoolId: string }) {
  const years = useYears(schoolId);
  const jobs = useApi<Job[]>(`/school/imports?schoolId=${schoolId}`);
  const [schoolYearId, setYear] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<SchoolImportMapping | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Job | null>(null);

  const form = (selected: File, map: SchoolImportMapping | null, skipInvalid = false) => {
    const data = new FormData();
    data.append('schoolId', schoolId);
    if (schoolYearId) data.append('schoolYearId', schoolYearId);
    if (map) data.append('mapping', JSON.stringify(map));
    if (skipInvalid) data.append('skipInvalid', 'true');
    data.append('file', selected);
    return data;
  };

  async function analyze(selected: File, map: SchoolImportMapping | null) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await apiUpload<Preview>('/school/imports/preview', form(selected, map));
      setPreview(result);
      setMapping(result.mapping);
    } catch (e) {
      setPreview(null);
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion impossible.'));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!file || !preview) return;
    setBusy(true);
    setError(null);
    try {
      const job = await apiUpload<Job>(
        '/school/imports',
        form(file, mapping, preview.errors.length > 0),
      );
      setDone(job);
      setPreview(null);
      setFile(null);
      jobs.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion impossible.'));
    } finally {
      setBusy(false);
    }
  }

  if (!page.canWrite('school.students.import')) {
    return (
      <Alert tone="info" title="Import indisponible">
        Votre rôle ou votre contrat ne permet pas d’importer des élèves.
      </Alert>
    );
  }

  return (
    <>
      <Card>
        <CardBody>
          <div className="grid items-end gap-3 sm:grid-cols-2">
            <SelectField
              label="Année des inscriptions"
              hint="Facultatif : sans année, seuls les dossiers sont créés."
              value={schoolYearId}
              onChange={(e) => setYear(e.target.value)}
              options={[
                { value: '', label: 'Aucune' },
                ...(years.state === 'success'
                  ? years.data
                      .filter((y) => y.status !== 'CLOSED')
                      .map((y) => ({ value: y.id, label: y.label }))
                  : []),
              ]}
            />
            <label className="block text-sm font-medium">
              Fichier
              <input
                type="file"
                data-testid="import-file"
                accept=".csv,.xlsx"
                className="mt-1 block w-full text-sm"
                onChange={(e) => {
                  const selected = e.target.files?.[0] ?? null;
                  setFile(selected);
                  setPreview(null);
                  setMapping(null);
                  if (selected) void analyze(selected, null);
                }}
              />
            </label>
          </div>
        </CardBody>
      </Card>

      <ApiErrorAlert error={error} />
      {busy && <LoadingState label="Traitement du fichier…" />}
      {done && (
        <div data-testid="import-done">
          <Alert tone="success" title="Import terminé">
            {done.createdRows} dossier(s) créé(s), {done.duplicateRows} doublon(s) ignoré(s),{' '}
            {done.errorRows} ligne(s) en erreur.
          </Alert>
        </div>
      )}

      {preview && file && mapping && (
        <>
          <Card>
            <CardBody>
              <h2 className="mb-1 font-semibold">Correspondance des colonnes</h2>
              <p className="mb-3 text-sm text-muted">
                Nom, Prénom et Date de naissance sont obligatoires.
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {FIELDS.map((field) => (
                  <SelectField
                    key={field}
                    label={SCHOOL_IMPORT_FIELD_LABELS[field]}
                    value={mapping[field] ?? ''}
                    onChange={(e) => {
                      const next = { ...mapping, [field]: e.target.value };
                      if (!e.target.value) delete next[field];
                      setMapping(next);
                    }}
                    options={[
                      { value: '', label: 'Ignorer' },
                      ...preview.headers.map((h) => ({ value: h, label: h })),
                    ]}
                  />
                ))}
              </div>
              <Button
                className="mt-3"
                variant="secondary"
                size="sm"
                onClick={() => analyze(file, mapping)}
              >
                Analyser de nouveau
              </Button>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <h2 className="mb-2 font-semibold">Prévisualisation</h2>
              <p className="text-sm" data-testid="import-summary">
                {preview.total} ligne(s) : {preview.valid} à importer, {preview.duplicates.length}{' '}
                doublon(s), {preview.errors.length} en erreur.
              </p>
              {preview.sample.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm">
                  {preview.sample.map((s) => (
                    <li key={s.line}>
                      {s.lastName} {s.firstName}
                      {(s.lastNameAr || s.firstNameAr) && (
                        <span dir="rtl" lang="ar" className="mx-2 inline-block">
                          {[s.lastNameAr, s.firstNameAr].filter(Boolean).join(' ')}
                        </span>
                      )}
                      <span className="text-muted"> {formatDate(s.birthDate)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {[...preview.errors, ...preview.duplicates].length > 0 && (
                <ul
                  className="mt-3 max-h-60 space-y-1 overflow-y-auto text-sm"
                  data-testid="import-issues"
                >
                  {[...preview.errors, ...preview.duplicates]
                    .sort((a, b) => a.line - b.line)
                    .map((issue, i) => (
                      <li key={`${issue.line}-${i}`}>
                        <span className="font-medium">Ligne {issue.line}</span> : {issue.message}
                      </li>
                    ))}
                </ul>
              )}
              <Button className="mt-4" disabled={preview.valid === 0 || busy} onClick={commit}>
                {preview.errors.length > 0
                  ? `Importer ${preview.valid} ligne(s) et ignorer les erreurs`
                  : `Importer ${preview.valid} ligne(s)`}
              </Button>
            </CardBody>
          </Card>
        </>
      )}

      {jobs.state === 'success' && jobs.data.length > 0 && (
        <Card>
          <CardBody>
            <h2 className="mb-2 font-semibold">Historique des imports</h2>
            <ul className="space-y-1 text-sm" data-testid="import-history">
              {jobs.data.map((j) => (
                <li key={j.id} className="flex flex-wrap justify-between gap-x-3">
                  <span>
                    {j.format} : {j.createdRows} créé(s) sur {j.totalRows}, {j.duplicateRows}{' '}
                    doublon(s), {j.errorRows} erreur(s)
                  </span>
                  <span className="text-muted">{formatDate(j.createdAt)}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </>
  );
}

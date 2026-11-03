'use client';

import { useState } from 'react';
import {
  SCHOOL_IMPORT_FIELDS,
  schoolImportIssueMessage,
  type SchoolImportField,
  type SchoolImportMapping,
} from '@ocall/shared';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { SchoolPage, type SchoolPageApi } from '@/components/school/school-page';
import { useYears } from '@/components/school/school-students';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, LoadingState } from '@/components/ui/states';
import { type ApiError, apiUpload } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface Issue {
  line: number;
  code?: string;
  field?: SchoolImportField;
  message: string;
}

interface Preview {
  format: 'CSV' | 'XLSX';
  headers: string[];
  mapping: SchoolImportMapping;
  /** Colonnes obligatoires sans correspondance : à associer avant toute analyse des lignes. */
  missing: SchoolImportField[];
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

const ALL_FIELDS = Object.keys(SCHOOL_IMPORT_FIELDS) as SchoolImportField[];
const ARABIC_FIELDS: readonly SchoolImportField[] = ['lastNameAr', 'firstNameAr'];

export default function ImportsPage() {
  return (
    <SchoolPage title="imports.title" description="imports.desc">
      {(page) => <Import key={page.school!.id} page={page} schoolId={page.school!.id} />}
    </SchoolPage>
  );
}

function Import({ page, schoolId }: { page: SchoolPageApi; schoolId: string }) {
  const { t, labels, date, join, showArabic, language } = useSchoolText();
  const years = useYears(schoolId);
  const jobs = useApi<Job[]>(`/school/imports?schoolId=${schoolId}`);
  const [schoolYearId, setYear] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<SchoolImportMapping | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Job | null>(null);
  // Établissement francophone : aucune colonne arabe proposée, ni importée.
  const fields = showArabic ? ALL_FIELDS : ALL_FIELDS.filter((f) => !ARABIC_FIELDS.includes(f));
  const keepVisible = (map: SchoolImportMapping): SchoolImportMapping =>
    showArabic
      ? map
      : Object.fromEntries(
          Object.entries(map).filter(([f]) => !ARABIC_FIELDS.includes(f as SchoolImportField)),
        );

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
      let result = await apiUpload<Preview>('/school/imports/preview', form(selected, map));
      const visible = keepVisible(result.mapping);
      // La correspondance proposée contenait une colonne arabe masquée : analyse sans elle.
      if (Object.keys(visible).length !== Object.keys(result.mapping).length) {
        result = await apiUpload<Preview>('/school/imports/preview', form(selected, visible));
      }
      setPreview(result);
      setMapping(keepVisible(result.mapping));
    } catch (e) {
      setPreview(null);
      setError(toApiError(e));
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
      setError(toApiError(e));
    } finally {
      setBusy(false);
    }
  }

  if (!page.canWrite('school.students.import')) {
    return (
      <Alert tone="info" title={t('imports.unavailableTitle')}>
        {t('imports.unavailable')}
      </Alert>
    );
  }

  return (
    <>
      <Card>
        <CardBody>
          <div className="grid items-end gap-3 sm:grid-cols-2">
            <SelectField
              label={t('imports.year')}
              hint={t('imports.yearHint')}
              value={schoolYearId}
              onChange={(e) => setYear(e.target.value)}
              options={[
                { value: '', label: t('common.noneFeminine') },
                ...(years.state === 'success'
                  ? years.data
                      .filter((y) => y.status !== 'CLOSED')
                      .map((y) => ({ value: y.id, label: y.label }))
                  : []),
              ]}
            />
            <label className="block text-sm font-medium">
              {t('field.file')}
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
      {busy && <LoadingState label={t('imports.processing')} />}
      {done && (
        <div data-testid="import-done">
          <Alert tone="success" title={t('imports.doneTitle')}>
            {t('imports.done', {
              created: done.createdRows,
              duplicates: done.duplicateRows,
              errors: done.errorRows,
            })}
          </Alert>
        </div>
      )}

      {preview && file && mapping && (
        <>
          <Card>
            <CardBody>
              <h2 className="mb-1 font-semibold">{t('imports.mapping')}</h2>
              <p className="mb-3 text-sm text-muted">{t('imports.required')}</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {fields.map((field) => (
                  <SelectField
                    key={field}
                    label={labels.importField[field]}
                    value={mapping[field] ?? ''}
                    onChange={(e) => {
                      const next = { ...mapping, [field]: e.target.value };
                      if (!e.target.value) delete next[field];
                      setMapping(next);
                    }}
                    options={[
                      { value: '', label: t('imports.ignore') },
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
                {t('imports.reanalyze')}
              </Button>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <h2 className="mb-2 font-semibold">{t('imports.preview')}</h2>
              {preview.missing.length > 0 ? (
                <div data-testid="import-missing">
                  <Alert tone="info" title={t('imports.missingTitle')}>
                    {t('imports.missing', {
                      total: preview.total,
                      fields: join(preview.missing.map((f) => labels.importField[f])),
                    })}
                  </Alert>
                </div>
              ) : (
                <p className="text-sm" data-testid="import-summary">
                  {t('imports.summary', {
                    total: preview.total,
                    valid: preview.valid,
                    duplicates: preview.duplicates.length,
                    errors: preview.errors.length,
                  })}
                </p>
              )}
              {preview.sample.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm">
                  {preview.sample.map((s) => (
                    <li key={s.line}>
                      <span dir="auto">
                        {s.lastName} {s.firstName}
                      </span>
                      {showArabic && (s.lastNameAr || s.firstNameAr) && (
                        <span dir="rtl" lang="ar" className="mx-2 inline-block">
                          {[s.lastNameAr, s.firstNameAr].filter(Boolean).join(' ')}
                        </span>
                      )}
                      <span className="text-muted"> {date(s.birthDate)}</span>
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
                        <span className="font-medium">{t('imports.line', { n: issue.line })}</span>{' '}
                        : {schoolImportIssueMessage(language, issue)}
                      </li>
                    ))}
                </ul>
              )}
              <Button className="mt-4" disabled={preview.valid === 0 || busy} onClick={commit}>
                {preview.errors.length > 0
                  ? t('imports.importSkipping', { n: preview.valid })
                  : t('imports.import', { n: preview.valid })}
              </Button>
            </CardBody>
          </Card>
        </>
      )}

      {jobs.state === 'success' && jobs.data.length > 0 && (
        <Card>
          <CardBody>
            <h2 className="mb-2 font-semibold">{t('imports.history')}</h2>
            <ul className="space-y-1 text-sm" data-testid="import-history">
              {jobs.data.map((j) => (
                <li key={j.id} className="flex flex-wrap justify-between gap-x-3">
                  <span>
                    {t('imports.job', {
                      format: j.format,
                      created: j.createdRows,
                      total: j.totalRows,
                      duplicates: j.duplicateRows,
                      errors: j.errorRows,
                    })}
                  </span>
                  <span className="text-muted">{date(j.createdAt)}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </>
  );
}

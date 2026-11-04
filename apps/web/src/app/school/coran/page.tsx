'use client';

import Link from 'next/link';
import type { QuranProgressSummary } from '@ocall/shared';
import { useState } from 'react';
import { ClassPeriodPicker } from '@/components/school/school-assessment';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { SchoolPage } from '@/components/school/school-page';
import { type NamedView, StudentName } from '@/components/school/school-students';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface QuranSettingsView {
  available: boolean;
  enabled: boolean;
  active: boolean;
  subjectId: string | null;
}

interface ClassProgressRow {
  id: string;
  matricule: string;
  lastName: string;
  firstName: string;
  lastNameAr: string | null;
  firstNameAr: string | null;
  summary: QuranProgressSummary;
  lastEvaluatedOn: string | null;
}

/**
 * Mémorisation du Coran (Sprint 4), module facultatif : activation par la direction (établissement en
 * Bilingue seulement), puis progression de chaque classe. Masqué partout ailleurs.
 */
export default function CoranPage() {
  return (
    <SchoolPage title="quran.title" description="quran.desc">
      {({ school, canWrite }) => (
        <Quran
          key={school!.id}
          schoolId={school!.id}
          canConfigure={canWrite('school.quran.settings')}
        />
      )}
    </SchoolPage>
  );
}

function Quran({ schoolId, canConfigure }: { schoolId: string; canConfigure: boolean }) {
  const { t } = useSchoolText();
  const settings = useApi<QuranSettingsView>(`/school/quran/settings?schoolId=${schoolId}`);
  if (settings.state === 'loading') return <LoadingState />;
  if (settings.state === 'error')
    return <ErrorState error={settings.error} onRetry={settings.reload} />;
  const s = settings.data;
  // Hors module actif, seule la direction (qui l'active) apprend son existence ; les autres rôles
  // reçoivent « introuvable », comme de l'API.
  if (!s.active && !canConfigure) {
    return (
      <ErrorState
        error={new ApiError(404, 'SCHOOL_RESOURCE_NOT_FOUND', 'Élément introuvable.')}
        onRetry={settings.reload}
      />
    );
  }
  if (!s.available) return <Alert tone="info" title={t('quran.unavailable')} />;
  return (
    <>
      <Alert tone="info" title={t('quran.privacy')} />
      {canConfigure && <Settings schoolId={schoolId} settings={s} onChange={settings.reload} />}
      {s.active ? (
        <ClassPeriodPicker schoolId={schoolId} withPeriod={false}>
          {(selection) => <ClassProgress key={selection.classId} classId={selection.classId} />}
        </ClassPeriodPicker>
      ) : null}
    </>
  );
}

function Settings({
  schoolId,
  settings,
  onChange,
}: {
  schoolId: string;
  settings: QuranSettingsView;
  onChange: () => void;
}) {
  const { t, name } = useSchoolText();
  const subjects = useApi<(NamedView & { isActive: boolean })[]>(
    `/school/subjects?schoolId=${schoolId}`,
  );
  const [subjectId, setSubjectId] = useState(settings.subjectId ?? '');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const options = subjects.state === 'success' ? subjects.data.filter((s) => s.isActive) : [];
  const chosen = subjectId || options[0]?.id || '';

  async function save(enabled: boolean) {
    setLoading(true);
    setError(null);
    try {
      await api('/school/quran/settings', {
        method: 'PUT',
        body: { schoolId, enabled, ...(enabled ? { subjectId: chosen } : {}) },
      });
      onChange();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardBody>
        <div className="space-y-3" data-testid="quran-settings">
          <h2 className="flex items-center gap-2 font-semibold">
            {t('quran.settings')}
            {settings.active ? (
              <Badge tone="forest">{t('quran.active')}</Badge>
            ) : (
              <Badge tone="neutral">{t('quran.inactive')}</Badge>
            )}
          </h2>
          <ApiErrorAlert error={error} />
          <div className="max-w-sm">
            <SelectField
              label={t('quran.subject')}
              value={chosen}
              onChange={(e) => setSubjectId(e.target.value)}
              options={options.map((s) => ({ value: s.id, label: name(s) }))}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button loading={loading} disabled={!chosen} onClick={() => void save(true)}>
              {t('quran.enable')}
            </Button>
            {settings.enabled && (
              <Button variant="secondary" loading={loading} onClick={() => void save(false)}>
                {t('quran.disable')}
              </Button>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function ClassProgress({ classId }: { classId: string }) {
  const { t, date } = useSchoolText();
  const rows = useApi<ClassProgressRow[]>(`/school/quran/classes/${classId}`);
  if (rows.state === 'loading') return <LoadingState />;
  if (rows.state === 'error') return <ErrorState error={rows.error} onRetry={rows.reload} />;
  return (
    <Card>
      <CardBody>
        <h2 className="mb-2 font-semibold">{t('quran.classView')}</h2>
        <ul className="divide-y divide-line/70" data-testid="quran-class">
          {rows.data.length === 0 && (
            <li className="py-4 text-sm text-muted">{t('quran.empty')}</li>
          )}
          {rows.data.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-3 py-3 text-sm"
              data-testid="quran-row"
            >
              <span className="min-w-0 flex-1">
                <StudentName student={r} />
              </span>
              <Badge tone="forest">
                {t('qstatus.MEMORIZED')} : {r.summary.counts.MEMORIZED}
              </Badge>
              <Badge tone="savanna">
                {t('qstatus.IN_PROGRESS')} : {r.summary.counts.IN_PROGRESS}
              </Badge>
              <Badge tone="terracotta">
                {t('qstatus.TO_REVIEW')} : {r.summary.counts.TO_REVIEW}
              </Badge>
              <span className="text-muted">
                {t('quran.verses', { n: r.summary.memorizedVerses, total: r.summary.totalVerses })}
              </span>
              <span className="text-muted">
                {t('quran.last')} : {r.lastEvaluatedOn ? date(r.lastEvaluatedOn) : '–'}
              </span>
              <Link
                href={`/school/coran/eleves/${r.id}`}
                className="font-medium text-forest hover:underline"
              >
                {t('quran.open')}
              </Link>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { hasSchoolPermission, type SchoolLocale, type SchoolType } from '@ocall/shared';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { BiName, SchoolPage, type SchoolSummary } from '@/components/school/school-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface Dashboard {
  schools: {
    id: string;
    name: string;
    nameAr: string | null;
    type: SchoolType;
    isActive: boolean;
    subjects: number;
    tracks: number;
    cycles: number;
    activeYear: { id: string; label: string; classes: number; periods: number } | null;
  }[];
}

/** Tableau de bord : uniquement des données réelles de la structure scolaire. */
export default function SchoolDashboardPage() {
  return (
    <SchoolPage title="dash.title" needsSchool={false}>
      {({ context }) => <Dashboard role={context.role} schools={context.schools} />}
    </SchoolPage>
  );
}

function Dashboard({
  role,
  schools,
}: {
  role: Parameters<typeof hasSchoolPermission>[0];
  schools: SchoolSummary[];
}) {
  const { labels } = useSchoolText();
  return (
    <>
      <p className="text-sm text-muted" data-testid="school-role">
        {labels.role[role]}
      </p>
      <SchoolCards locales={new Map(schools.map((s) => [s.id, s.defaultLocale]))} />
      {hasSchoolPermission(role, 'school.export') && <ExportButton />}
    </>
  );
}

/** Chaque carte suit la langue de son établissement, pas celle de l'établissement choisi. */
function SchoolCards({ locales }: { locales: Map<string, SchoolLocale> }) {
  const { t, labels } = useSchoolText();
  const dash = useApi<Dashboard>('/school/dashboard');
  if (dash.state === 'loading') return <LoadingState />;
  if (dash.state === 'error') return <ErrorState error={dash.error} onRetry={dash.reload} />;
  if (dash.data.schools.length === 0) {
    return (
      <Alert tone="info" title={t('dash.firstTitle')}>
        {t('dash.first')}
      </Alert>
    );
  }
  return (
    <ul className="grid gap-4 md:grid-cols-2" data-testid="school-cards">
      {dash.data.schools.map((s) => (
        <li key={s.id}>
          <Card>
            <CardBody>
              <p className="font-display text-lg font-bold">
                <BiName name={s.name} nameAr={s.nameAr} locale={locales.get(s.id) ?? 'FR'} />
              </p>
              <p className="text-sm text-muted">{labels.type[s.type]}</p>
              <div className="mt-3">
                {s.activeYear ? (
                  <Badge tone="forest">{t('dash.year', { label: s.activeYear.label })}</Badge>
                ) : (
                  <Badge tone="savanna">{t('dash.noYear')}</Badge>
                )}
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                <div>
                  <dt className="text-muted">{t('dash.classes')}</dt>
                  <dd className="text-xl font-bold">{s.activeYear?.classes ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-muted">{t('dash.subjects')}</dt>
                  <dd className="text-xl font-bold">{s.subjects}</dd>
                </div>
                <div>
                  <dt className="text-muted">{t('dash.tracks')}</dt>
                  <dd className="text-xl font-bold">{s.tracks}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>
        </li>
      ))}
    </ul>
  );
}

/** Export JSON, disponible aussi en consultation seule ; le serveur journalise chaque export. */
function ExportButton() {
  const { t } = useSchoolText();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function download() {
    setLoading(true);
    setError(null);
    try {
      const data = await api<unknown>('/school/export');
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'ocall-school-export.json';
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <ApiErrorAlert error={error} />
      <Button
        variant="secondary"
        loading={loading}
        icon={<Download className="h-4 w-4" />}
        onClick={() => void download()}
      >
        {t('dash.export')}
      </Button>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import {
  SCHOOL_ROLE_LABELS,
  SCHOOL_TYPE_LABELS,
  hasSchoolPermission,
  type SchoolType,
} from '@ocall/shared';
import { BiName, SchoolPage } from '@/components/school/school-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';
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
    <SchoolPage title="Tableau de bord" needsSchool={false}>
      {({ context }) => (
        <>
          <p className="text-sm text-muted" data-testid="school-role">
            {SCHOOL_ROLE_LABELS[context.role]}
          </p>
          <SchoolCards />
          {hasSchoolPermission(context.role, 'school.export') && <ExportButton />}
        </>
      )}
    </SchoolPage>
  );
}

function SchoolCards() {
  const dash = useApi<Dashboard>('/school/dashboard');
  if (dash.state === 'loading') return <LoadingState />;
  if (dash.state === 'error') return <ErrorState error={dash.error} onRetry={dash.reload} />;
  if (dash.data.schools.length === 0) {
    return (
      <Alert tone="info" title="Commencez par votre premier établissement">
        Rendez-vous dans « Établissements » pour le créer.
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
                <BiName name={s.name} nameAr={s.nameAr} />
              </p>
              <p className="text-sm text-muted">{SCHOOL_TYPE_LABELS[s.type]}</p>
              <div className="mt-3">
                {s.activeYear ? (
                  <Badge tone="forest">Année {s.activeYear.label}</Badge>
                ) : (
                  <Badge tone="savanna">Aucune année en cours</Badge>
                )}
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                <div>
                  <dt className="text-muted">Classes</dt>
                  <dd className="text-xl font-bold">{s.activeYear?.classes ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-muted">Matières</dt>
                  <dd className="text-xl font-bold">{s.subjects}</dd>
                </div>
                <div>
                  <dt className="text-muted">Parcours</dt>
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
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion impossible.'));
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
        Exporter les données
      </Button>
    </div>
  );
}

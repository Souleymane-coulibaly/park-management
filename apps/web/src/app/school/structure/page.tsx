'use client';

import { SCHOOL_LOCALES, SCHOOL_LOCALE_LABELS, type SchoolLocale } from '@ocall/shared';
import { BiName, SchoolPage } from '@/components/school/school-page';
import { Card, CardBody } from '@/components/ui/card';
import { SimpleForm } from '@/components/ui/simple-form';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

interface Named {
  id: string;
  name: string;
  nameAr: string | null;
}
interface CycleView extends Named {
  levels: Named[];
}
interface TrackView extends Named {
  locale: SchoolLocale;
}
interface ClassView extends Named {
  capacity: number | null;
  level: Named;
  track: Named | null;
}
interface YearLite {
  id: string;
  label: string;
  status: string;
}

export default function StructurePage() {
  return (
    <SchoolPage
      title="Cycles et classes"
      description="Parcours pédagogiques, cycles, niveaux et classes."
    >
      {({ school, canWrite }) => (
        <Structure
          key={school!.id}
          schoolId={school!.id}
          canManage={canWrite('school.structure.manage')}
        />
      )}
    </SchoolPage>
  );
}

function Structure({ schoolId, canManage }: { schoolId: string; canManage: boolean }) {
  const tracks = useApi<TrackView[]>(`/school/tracks?schoolId=${schoolId}`);
  const cycles = useApi<CycleView[]>(`/school/cycles?schoolId=${schoolId}`);
  const years = useApi<YearLite[]>(`/school/years?schoolId=${schoolId}`);
  const activeYear =
    years.state === 'success' ? years.data.find((y) => y.status === 'ACTIVE') : undefined;
  const classes = useApi<ClassView[]>(
    activeYear ? `/school/classes?schoolYearId=${activeYear.id}` : null,
  );

  if (tracks.state === 'loading' || cycles.state === 'loading' || years.state === 'loading') {
    return <LoadingState />;
  }
  if (tracks.state === 'error') return <ErrorState error={tracks.error} onRetry={tracks.reload} />;
  if (cycles.state === 'error') return <ErrorState error={cycles.error} onRetry={cycles.reload} />;
  if (years.state === 'error') return <ErrorState error={years.error} onRetry={years.reload} />;

  const levels = cycles.data.flatMap((c) => c.levels);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardBody>
          <h2 className="mb-2 font-semibold">Parcours pédagogiques</h2>
          <ul className="mb-4 divide-y divide-line/70 text-sm" data-testid="track-list">
            {tracks.data.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2">
                <span className="flex-1 font-medium">
                  <BiName name={t.name} nameAr={t.nameAr} />
                </span>
                <span className="text-muted">{SCHOOL_LOCALE_LABELS[t.locale]}</span>
              </li>
            ))}
          </ul>
          {canManage && (
            <SimpleForm
              testId="track-form"
              path="/school/tracks"
              extra={{ schoolId }}
              submitLabel="Ajouter le parcours"
              onDone={tracks.reload}
              fields={[
                { name: 'name', label: 'Nom', required: true },
                { name: 'nameAr', label: 'Nom en arabe', rtl: true },
                {
                  name: 'locale',
                  label: 'Langue',
                  type: 'select',
                  options: SCHOOL_LOCALES.map((l) => ({
                    value: l,
                    label: SCHOOL_LOCALE_LABELS[l],
                  })),
                },
              ]}
            />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h2 className="mb-2 font-semibold">Cycles et niveaux</h2>
          <ul className="mb-4 space-y-3 text-sm" data-testid="cycle-list">
            {cycles.data.map((c) => (
              <li key={c.id} className="rounded-xl border border-line/70 p-3">
                <p className="font-semibold">
                  <BiName name={c.name} nameAr={c.nameAr} />
                </p>
                <p className="mb-2 text-muted">
                  {c.levels.map((l) => l.name).join(', ') || 'Aucun niveau'}
                </p>
                {canManage && (
                  <SimpleForm
                    path="/school/levels"
                    extra={{ cycleId: c.id }}
                    submitLabel="Ajouter le niveau"
                    onDone={cycles.reload}
                    fields={[
                      { name: 'name', label: 'Niveau', required: true },
                      { name: 'nameAr', label: 'Niveau en arabe', rtl: true },
                    ]}
                  />
                )}
              </li>
            ))}
          </ul>
          {canManage && (
            <SimpleForm
              testId="cycle-form"
              path="/school/cycles"
              extra={{ schoolId }}
              submitLabel="Ajouter le cycle"
              onDone={cycles.reload}
              fields={[
                { name: 'name', label: 'Cycle', required: true },
                { name: 'nameAr', label: 'Cycle en arabe', rtl: true },
              ]}
            />
          )}
        </CardBody>
      </Card>

      <div className="lg:col-span-2">
        <Card>
          <CardBody>
            <h2 className="mb-2 font-semibold">
              Classes {activeYear ? `· année ${activeYear.label}` : ''}
            </h2>
            {!activeYear && (
              <Alert tone="info">Ouvrez d’abord une année scolaire pour créer des classes.</Alert>
            )}
            {activeYear && classes.state === 'error' && (
              <ErrorState error={classes.error} onRetry={classes.reload} />
            )}
            {activeYear && classes.state === 'success' && (
              <ul className="mb-4 divide-y divide-line/70 text-sm" data-testid="class-list">
                {classes.data.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="flex-1 font-medium">
                      <BiName name={c.name} nameAr={c.nameAr} />
                    </span>
                    <span className="text-muted">
                      {c.level.name}
                      {c.track ? ` · ${c.track.name}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {activeYear && canManage && levels.length > 0 && (
              <SimpleForm
                testId="class-form"
                path="/school/classes"
                extra={{ schoolYearId: activeYear.id }}
                submitLabel="Ajouter la classe"
                onDone={classes.reload}
                fields={[
                  { name: 'name', label: 'Classe', required: true },
                  { name: 'nameAr', label: 'Classe en arabe', rtl: true },
                  {
                    name: 'levelId',
                    label: 'Niveau',
                    type: 'select',
                    options: levels.map((l) => ({ value: l.id, label: l.name })),
                  },
                  {
                    name: 'trackId',
                    label: 'Parcours',
                    type: 'select',
                    options: [
                      { value: '', label: 'Aucun' },
                      ...tracks.data.map((t) => ({ value: t.id, label: t.name })),
                    ],
                  },
                  { name: 'capacity', label: 'Capacité', type: 'number' },
                ]}
              />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

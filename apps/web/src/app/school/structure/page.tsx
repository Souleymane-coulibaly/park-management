'use client';

import { SCHOOL_LOCALES, type SchoolLocale } from '@ocall/shared';
import { useSchoolText } from '@/components/school/school-language';
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
    <SchoolPage title="structure.title" description="structure.desc">
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
  const { t, labels, name, fields, join } = useSchoolText();
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
          <h2 className="mb-2 font-semibold">{t('structure.tracks')}</h2>
          <ul className="mb-4 divide-y divide-line/70 text-sm" data-testid="track-list">
            {tracks.data.map((tr) => (
              <li key={tr.id} className="flex items-center gap-3 py-2">
                <span className="flex-1 font-medium">
                  <BiName name={tr.name} nameAr={tr.nameAr} />
                </span>
                <span className="text-muted">{labels.locale[tr.locale]}</span>
              </li>
            ))}
          </ul>
          {canManage && (
            <SimpleForm
              testId="track-form"
              path="/school/tracks"
              extra={{ schoolId }}
              submitLabel={t('structure.addTrack')}
              onDone={tracks.reload}
              fields={fields([
                { name: 'name', label: t('field.name'), required: true },
                { name: 'nameAr', label: t('field.nameAr'), rtl: true },
                {
                  name: 'locale',
                  label: t('structure.language'),
                  type: 'select',
                  options: SCHOOL_LOCALES.map((l) => ({ value: l, label: labels.locale[l] })),
                },
              ])}
            />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h2 className="mb-2 font-semibold">{t('structure.cycles')}</h2>
          <ul className="mb-4 space-y-3 text-sm" data-testid="cycle-list">
            {cycles.data.map((c) => (
              <li key={c.id} className="rounded-xl border border-line/70 p-3">
                <p className="font-semibold">
                  <BiName name={c.name} nameAr={c.nameAr} />
                </p>
                <p className="mb-2 text-muted">
                  {join(c.levels.map(name)) || t('structure.noLevel')}
                </p>
                {canManage && (
                  <SimpleForm
                    path="/school/levels"
                    extra={{ cycleId: c.id }}
                    submitLabel={t('structure.addLevel')}
                    onDone={cycles.reload}
                    fields={fields([
                      { name: 'name', label: t('field.level'), required: true },
                      { name: 'nameAr', label: t('structure.levelAr'), rtl: true },
                    ])}
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
              submitLabel={t('structure.addCycle')}
              onDone={cycles.reload}
              fields={fields([
                { name: 'name', label: t('structure.cycle'), required: true },
                { name: 'nameAr', label: t('structure.cycleAr'), rtl: true },
              ])}
            />
          )}
        </CardBody>
      </Card>

      <div className="lg:col-span-2">
        <Card>
          <CardBody>
            <h2 className="mb-2 font-semibold">
              {activeYear
                ? t('structure.classesYear', { label: activeYear.label })
                : t('structure.classes')}
            </h2>
            {!activeYear && <Alert tone="info">{t('structure.openYearFirst')}</Alert>}
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
                      {name(c.level)}
                      {c.track ? ` · ${name(c.track)}` : ''}
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
                submitLabel={t('structure.addClass')}
                onDone={classes.reload}
                fields={fields([
                  { name: 'name', label: t('field.class'), required: true },
                  { name: 'nameAr', label: t('structure.classAr'), rtl: true },
                  {
                    name: 'levelId',
                    label: t('field.level'),
                    type: 'select',
                    options: levels.map((l) => ({ value: l.id, label: name(l) })),
                  },
                  {
                    name: 'trackId',
                    label: t('field.track'),
                    type: 'select',
                    options: [
                      { value: '', label: t('common.none') },
                      ...tracks.data.map((tr) => ({ value: tr.id, label: name(tr) })),
                    ],
                  },
                  { name: 'capacity', label: t('field.capacity'), type: 'number' },
                ])}
              />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

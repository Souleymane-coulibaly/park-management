'use client';

import { useState } from 'react';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { BiName, SchoolPage } from '@/components/school/school-page';
import { type LevelOption, useLevels } from '@/components/school/school-students';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { SimpleForm } from '@/components/ui/simple-form';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface Named {
  id: string;
  name: string;
  nameAr?: string | null;
}

interface SubjectView extends Named {
  isReligious: boolean;
  isActive: boolean;
  catalogKey: string | null;
  defaultCoefficient: string;
  track: Named | null;
  levels: {
    levelId: string;
    coefficient: string | null;
    weeklyHours: string | null;
    level: Named;
  }[];
}

interface CatalogEntry {
  key: string;
  name: string;
  nameAr: string;
  isReligious: boolean;
  subjectId: string | null;
  isActive: boolean;
}

export default function MatieresPage() {
  return (
    <SchoolPage title="subjects.title" description="subjects.desc">
      {({ school, canWrite }) => (
        <Subjects
          key={school!.id}
          schoolId={school!.id}
          canManage={canWrite('school.structure.manage')}
        />
      )}
    </SchoolPage>
  );
}

function Subjects({ schoolId, canManage }: { schoolId: string; canManage: boolean }) {
  const { t, name, fields } = useSchoolText();
  const subjects = useApi<SubjectView[]>(`/school/subjects?schoolId=${schoolId}`);
  const tracks = useApi<Named[]>(`/school/tracks?schoolId=${schoolId}`);
  const levels = useLevels(schoolId);
  if (subjects.state === 'loading') return <LoadingState />;
  if (subjects.state === 'error') {
    return <ErrorState error={subjects.error} onRetry={subjects.reload} />;
  }
  return (
    <>
      {canManage && <Catalog schoolId={schoolId} onChange={subjects.reload} />}
      <Card>
        <CardBody>
          <h2 className="font-semibold">{t('subjects.own')}</h2>
        </CardBody>
        <ul className="divide-y divide-line/70 text-sm" data-testid="subject-list">
          {subjects.data.length === 0 && (
            <li className="px-4 py-6 text-center text-muted">{t('subjects.empty')}</li>
          )}
          {subjects.data.map((s) => (
            <SubjectRow
              key={s.id}
              subject={s}
              levels={levels}
              canManage={canManage}
              onChange={subjects.reload}
            />
          ))}
        </ul>
      </Card>
      {canManage && tracks.state === 'success' && (
        <Card>
          <CardBody>
            <h2 className="mb-3 font-semibold">{t('subjects.new')}</h2>
            <SimpleForm
              testId="subject-form"
              path="/school/subjects"
              extra={{ schoolId }}
              submitLabel={t('subjects.add')}
              onDone={subjects.reload}
              fields={fields([
                { name: 'name', label: t('field.name'), required: true },
                { name: 'nameAr', label: t('field.nameAr'), rtl: true },
                {
                  name: 'trackId',
                  label: t('field.track'),
                  type: 'select',
                  options: [
                    { value: '', label: t('subjects.allTracks') },
                    ...tracks.data.map((tr) => ({ value: tr.id, label: name(tr) })),
                  ],
                },
                {
                  name: 'defaultCoefficient',
                  label: t('field.coefficient'),
                  type: 'number',
                  defaultValue: '1',
                },
                { name: 'isReligious', label: t('subjects.isReligious'), type: 'checkbox' },
              ])}
            />
          </CardBody>
        </Card>
      )}
    </>
  );
}

/** Catalogue commun : rien n'est activé d'office, les matières religieuses comprises. */
function Catalog({ schoolId, onChange }: { schoolId: string; onChange: () => void }) {
  const { t, name } = useSchoolText();
  const catalog = useApi<CatalogEntry[]>(`/school/subjects/catalog?schoolId=${schoolId}`);
  const [error, setError] = useState<ApiError | null>(null);
  async function activate(key: string) {
    setError(null);
    try {
      await api(`/school/subjects/catalog/${key}/activate`, { method: 'POST', body: { schoolId } });
      catalog.reload();
      onChange();
    } catch (e) {
      setError(toApiError(e));
    }
  }
  if (catalog.state !== 'success') return null;
  return (
    <Card>
      <CardBody>
        <h2 className="mb-1 font-semibold">{t('subjects.catalog')}</h2>
        <p className="mb-3 text-sm text-muted">{t('subjects.catalogHint')}</p>
        <ApiErrorAlert error={error} />
        <ul className="grid gap-2 sm:grid-cols-2" data-testid="subject-catalog">
          {catalog.data.map((entry) => (
            <li
              key={entry.key}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line/70 px-3 py-2 text-sm"
            >
              <span className="min-w-0">
                <span className="block font-medium">{name(entry)}</span>
                {entry.isReligious && (
                  <span className="block text-xs text-muted">{t('subjects.religiousHint')}</span>
                )}
              </span>
              {entry.isActive ? (
                <Badge tone="forest">{t('subjects.activated')}</Badge>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => void activate(entry.key)}>
                  {t('subjects.activate')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function SubjectRow({
  subject: s,
  levels,
  canManage,
  onChange,
}: {
  subject: SubjectView;
  levels: LevelOption[];
  canManage: boolean;
  onChange: () => void;
}) {
  const { t, name, join, fields } = useSchoolText();
  const [editing, setEditing] = useState(false);
  const [editingInfo, setEditingInfo] = useState(false);
  const [selected, setSelected] = useState(() => new Set(s.levels.map((l) => l.levelId)));
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  async function run(work: () => Promise<unknown>) {
    setSaving(true);
    setError(null);
    try {
      await work();
      setEditing(false);
      onChange();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="space-y-2 px-4 py-3" data-testid="subject-row">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-full min-w-0 font-medium sm:w-auto sm:flex-1">
          <BiName name={s.name} nameAr={s.nameAr} />
        </span>
        {!s.isActive && <Badge tone="neutral">{t('subjects.inactive')}</Badge>}
        {s.catalogKey && <Badge tone="forest">{t('subjects.fromCatalog')}</Badge>}
        {s.isReligious && <Badge tone="savanna">{t('subjects.religious')}</Badge>}
        {s.track && <Badge tone="neutral">{name(s.track)}</Badge>}
        <span className="text-muted">
          {t('subjects.coefficient', { n: Number(s.defaultCoefficient) })}
        </span>
      </div>
      <p className="text-muted">
        {t('subjects.levels')} : {join(s.levels.map((l) => name(l.level))) || t('subjects.noLevel')}
      </p>
      <ApiErrorAlert error={error} />
      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setEditingInfo(!editingInfo)}>
            {t('subjects.edit')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setEditing(!editing)}>
            {t('subjects.levels')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={saving && !editing}
            onClick={() =>
              void run(() =>
                api(`/school/subjects/${s.id}`, {
                  method: 'PATCH',
                  body: { isActive: !s.isActive },
                }),
              )
            }
          >
            {s.isActive ? t('subjects.deactivate') : t('subjects.reactivate')}
          </Button>
        </div>
      )}
      {editingInfo && (
        <SimpleForm
          testId="subject-edit-form"
          method="PATCH"
          // Copie propre à l'établissement : la modifier ne touche ni le catalogue ni les autres écoles.
          sendEmpty
          path={`/school/subjects/${s.id}`}
          submitLabel={t('subjects.save')}
          onDone={() => {
            setEditingInfo(false);
            onChange();
          }}
          fields={fields([
            { name: 'name', label: t('field.name'), required: true, defaultValue: s.name },
            { name: 'nameAr', label: t('field.nameAr'), rtl: true, defaultValue: s.nameAr ?? '' },
            {
              name: 'defaultCoefficient',
              label: t('field.coefficient'),
              type: 'number',
              required: true,
              defaultValue: String(Number(s.defaultCoefficient)),
            },
          ])}
        />
      )}
      {editing && (
        <div className="space-y-2" data-testid="subject-levels">
          <div className="grid gap-1 sm:grid-cols-3">
            {levels.map((l) => (
              <label key={l.id} className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-forest"
                  checked={selected.has(l.id)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(l.id);
                    else next.delete(l.id);
                    setSelected(next);
                  }}
                />
                {name(l)}
              </label>
            ))}
          </div>
          <Button
            size="sm"
            loading={saving}
            onClick={() =>
              void run(() =>
                api(`/school/subjects/${s.id}/levels`, {
                  method: 'PUT',
                  // Coefficient et horaire déjà définis pour un niveau conservé : inchangés.
                  body: {
                    levels: [...selected].map((levelId) => {
                      const kept = s.levels.find((l) => l.levelId === levelId);
                      return {
                        levelId,
                        coefficient: kept?.coefficient != null ? Number(kept.coefficient) : null,
                        weeklyHours: kept?.weeklyHours != null ? Number(kept.weeklyHours) : null,
                      };
                    }),
                  },
                }),
              )
            }
          >
            {t('subjects.saveLevels')}
          </Button>
        </div>
      )}
    </li>
  );
}

'use client';

import { useParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import {
  STOCK_LABEL_FORMATS,
  STOCK_LOCATION_KIND_LABELS,
  STOCK_LOCATION_KINDS,
  STOCK_SITE_KIND_LABELS,
  type StockLabelFormat,
  stockLocationNests,
} from '@ocall/shared';
import { StockPage, type StockPageProps } from '@/components/stock/stock-page';
import {
  type StockLocationView,
  type StockSiteView,
  asApiError,
} from '@/components/stock/stock-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { useApi } from '@/lib/use-api';

/** Fiche d'un site : emplacements (zone → allée → rayonnage → emplacement), QR codes, archivage. */
export default function StockSitePage() {
  return <StockPage title="Site">{(props) => <Site {...props} />}</StockPage>;
}

function Site({ canWrite }: StockPageProps) {
  const { id } = useParams<{ id: string }>();
  const site = useApi<StockSiteView>(`/ocall-stock/sites/${id}`);
  const [error, setError] = useState<ApiError | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [format, setFormat] = useState<StockLabelFormat>('50x30');
  const manageLocations = canWrite('stock.locations.manage');
  const manageSite = canWrite('stock.sites.manage');

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      site.reload();
    } catch (e) {
      setError(asApiError(e));
    }
  }

  if (site.state === 'loading') return <LoadingState />;
  if (site.state === 'error') return <ErrorState error={site.error} onRetry={site.reload} />;
  const s = site.data;
  const locations = s.locations ?? [];
  const children = (parentId: string | null) =>
    locations.filter((l) => l.parentId === parentId && l.kind !== 'DEFAULT');

  function Node({ l, depth }: { l: StockLocationView; depth: number }) {
    return (
      <li>
        <div
          className="flex flex-wrap items-center justify-between gap-2 py-1 text-sm"
          style={{ paddingLeft: depth * 16 }}
        >
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={selected.includes(l.id)}
              onChange={(e) =>
                setSelected((cur) =>
                  e.target.checked ? [...cur, l.id] : cur.filter((x) => x !== l.id),
                )
              }
              aria-label={`Sélectionner ${l.code}`}
            />
            <span className={l.isArchived ? 'text-muted line-through' : 'font-medium'}>
              {l.code}
            </span>
            <span className="text-muted">
              {l.name} · {STOCK_LOCATION_KIND_LABELS[l.kind]}
            </span>
          </label>
          <span className="flex items-center gap-2">
            {l.isArchived && <Badge>Archivé</Badge>}
            {manageLocations && l.kind !== 'DEFAULT' && (
              <button
                type="button"
                className="text-xs text-forest hover:underline"
                onClick={() =>
                  void run(() =>
                    api(`/ocall-stock/locations/${l.id}`, {
                      method: 'PATCH',
                      body: { isArchived: !l.isArchived },
                    }),
                  )
                }
              >
                {l.isArchived ? 'Réactiver' : 'Archiver'}
              </button>
            )}
          </span>
        </div>
        {children(l.id).length > 0 && (
          <ul>
            {children(l.id).map((c) => (
              <Node key={c.id} l={c} depth={depth + 1} />
            ))}
          </ul>
        )}
      </li>
    );
  }

  const general = locations.find((l) => l.kind === 'DEFAULT');

  return (
    <>
      <ApiErrorAlert error={error} />
      <Card>
        <CardHeader
          title={s.name}
          description={`${s.code} · ${STOCK_SITE_KIND_LABELS[s.kind]}${s.city ? ` · ${s.city}` : ''}`}
          action={
            manageSite ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  void run(() =>
                    api(`/ocall-stock/sites/${s.id}`, {
                      method: 'PATCH',
                      body: { isArchived: !s.isArchived },
                    }),
                  )
                }
              >
                {s.isArchived ? 'Réactiver le site' : 'Archiver le site'}
              </Button>
            ) : undefined
          }
        />
      </Card>
      <Card>
        <CardHeader
          title="Emplacements"
          description="Cochez des emplacements pour imprimer leurs QR codes."
        />
        <CardBody className="space-y-4">
          <ul data-testid="stock-location-tree">
            {general && <Node l={general} depth={0} />}
            {children(null).map((l) => (
              <Node key={l.id} l={l} depth={0} />
            ))}
          </ul>
          <div className="flex flex-wrap items-end gap-3">
            <SelectField
              label="Format"
              value={format}
              onChange={(e) => setFormat(e.target.value as StockLabelFormat)}
              options={STOCK_LABEL_FORMATS.map((f) => ({
                value: f,
                label: f.replace('x', ' × ') + ' mm',
              }))}
            />
            <Button
              variant="secondary"
              disabled={selected.length === 0 || !manageLocations}
              onClick={() =>
                void run(() =>
                  downloadFile(
                    `/ocall-stock/sites/${s.id}/location-labels.pdf`,
                    'emplacements.pdf',
                    { format, locationIds: selected },
                  ),
                )
              }
            >
              Imprimer les QR codes ({selected.length})
            </Button>
          </div>
          {manageLocations && !s.isArchived && (
            <NewLocation
              siteId={s.id}
              locations={locations}
              onDone={site.reload}
              onError={setError}
            />
          )}
        </CardBody>
      </Card>
    </>
  );
}

function NewLocation({
  siteId,
  locations,
  onDone,
  onError,
}: {
  siteId: string;
  locations: StockLocationView[];
  onDone: () => void;
  onError: (e: ApiError | null) => void;
}) {
  const [kind, setKind] = useState<(typeof STOCK_LOCATION_KINDS)[number]>('ZONE');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const parents = locations.filter(
    (l) => !l.isArchived && l.kind !== 'DEFAULT' && stockLocationNests(l.kind, kind),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    onError(null);
    try {
      await api(`/ocall-stock/sites/${siteId}/locations`, {
        method: 'POST',
        body: { kind, code, name, parentId: parentId || null },
      });
      setCode('');
      setName('');
      onDone();
    } catch (e) {
      onError(asApiError(e));
    }
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-3 border-t border-line pt-4 sm:grid-cols-4"
      data-testid="stock-location-form"
    >
      <SelectField
        label="Niveau"
        value={kind}
        onChange={(e) => {
          setKind(e.target.value as typeof kind);
          setParentId('');
        }}
        options={STOCK_LOCATION_KINDS.map((k) => ({
          value: k,
          label: STOCK_LOCATION_KIND_LABELS[k],
        }))}
      />
      <SelectField
        label="Dans"
        value={parentId}
        onChange={(e) => setParentId(e.target.value)}
        options={[
          { value: '', label: 'Le site directement' },
          ...parents.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` })),
        ]}
      />
      <InputField
        label="Code (ex. A-01-03)"
        required
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
      />
      <InputField label="Nom" required value={name} onChange={(e) => setName(e.target.value)} />
      <div className="sm:col-span-4">
        <Button type="submit" variant="secondary">
          Ajouter l’emplacement
        </Button>
      </div>
    </form>
  );
}

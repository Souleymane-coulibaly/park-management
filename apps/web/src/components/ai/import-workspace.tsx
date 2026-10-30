'use client';

import { useRef, useState } from 'react';
import { Camera, CheckCircle2, FileUp, Loader2, Sparkles, Trash2 } from 'lucide-react';
import {
  AI_IMPORT_MAX_BYTES,
  AI_IMPORT_MIME_TYPES,
  IMPORT_ISSUE_LABELS,
  type ImportIssue,
  TICKET_KINDS,
  TICKET_KIND_LABELS,
  type TicketKind,
} from '@ocall/shared';
import { AiBadge } from '@/components/ai/ai-availability';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Alert, ApiErrorAlert } from '@/components/ui/states';
import { ApiError, api, apiUpload } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { AiImport, AiImportCatalogLine, AiImportTicketLine } from '@/lib/types';
import { useApi } from '@/lib/use-api';

type Kind = 'catalog' | 'tickets';

interface DraftVariant {
  name: string;
  price: string;
}
interface DraftLine {
  index: number;
  create: boolean;
  name: string;
  category: string;
  description: string;
  variants: DraftVariant[];
  kind: TicketKind;
  peopleIncluded: string;
  conditions: string;
  issues: ImportIssue[];
  sourceText: string;
  duplicateOf: string | null;
}

const STATUS_LABEL: Record<
  AiImport['status'],
  { label: string; tone: 'forest' | 'savanna' | 'neutral' | 'terracotta' }
> = {
  ANALYZED: { label: 'À vérifier', tone: 'savanna' },
  PUBLISHED: { label: 'Publié', tone: 'forest' },
  DISCARDED: { label: 'Abandonné', tone: 'neutral' },
  FAILED: { label: 'Échec', tone: 'terracotta' },
};

const priceInput = (p: number | null) => (p === null ? '' : String(p));
const validPrice = (s: string) => /^\d{1,9}$/.test(s.trim());

function toDraft(line: AiImportCatalogLine | AiImportTicketLine, done: Set<number>): DraftLine {
  const ticket = 'kind' in line ? line : null;
  const catalog = 'variants' in line ? line : null;
  return {
    index: line.index,
    // Par défaut, un doublon potentiel est ignoré : l'utilisateur choisit de le créer.
    create: !done.has(line.index) && !line.issues.includes('DUPLICATE_EXISTING'),
    name: line.name,
    category: catalog?.category ?? 'À classer',
    description: catalog?.description ?? '',
    variants: catalog
      ? catalog.variants.map((v) => ({ name: v.name, price: priceInput(v.price) }))
      : [{ name: 'Standard', price: priceInput(ticket!.price) }],
    kind: ticket?.kind ?? 'CUSTOM',
    peopleIncluded: String(ticket?.peopleIncluded ?? 1),
    conditions: ticket?.conditions ?? '',
    issues: line.issues,
    sourceText: line.sourceText,
    duplicateOf: line.duplicateOf?.name ?? null,
  };
}

/**
 * Import IA d'une carte (restaurant) ou d'une grille tarifaire (parc) : photo ou fichier, analyse,
 * revue ligne par ligne, publication confirmée par l'utilisateur. Rien n'est remplacé ; les billets
 * importés sont créés désactivés.
 */
export function ImportWorkspace({
  kind,
  establishmentId,
}: {
  kind: Kind;
  establishmentId: string;
}) {
  const history = useApi<AiImport[]>(`/ai/imports/${kind}`);
  const [file, setFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [current, setCurrent] = useState<AiImport | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const noun = kind === 'catalog' ? 'la carte' : 'la grille tarifaire';

  function open(imp: AiImport) {
    setCurrent(imp);
    const done = new Set(imp.publication?.created.map((c) => c.index) ?? []);
    setLines((imp.result?.lines ?? []).map((l) => toDraft(l, done)));
  }

  function choose(f: File | undefined) {
    setLocalError(null);
    setError(null);
    if (!f) return;
    if (f.size > AI_IMPORT_MAX_BYTES) return setLocalError('Fichier trop lourd : 10 Mo au plus.');
    if (!(AI_IMPORT_MIME_TYPES as readonly string[]).includes(f.type)) {
      return setLocalError('Format non pris en charge : photo JPEG, PNG ou WebP, ou PDF.');
    }
    setFile(f);
  }

  async function analyze() {
    if (!file) return;
    setAnalyzing(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('establishmentId', establishmentId);
      form.append('file', file);
      open(await apiUpload<AiImport>(`/ai/imports/${kind}`, form));
      setFile(null);
      history.reload();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setAnalyzing(false);
    }
  }

  const update = (index: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l) => (l.index === index ? { ...l, ...patch } : l)));
  const toCreate = lines.filter((l) => l.create);
  const missingPrice = toCreate.some((l) => l.variants.some((v) => !validPrice(v.price)));

  async function publish() {
    if (!current) return;
    setPublishing(true);
    setError(null);
    try {
      const payload =
        kind === 'catalog'
          ? lines.map((l) => ({
              index: l.index,
              action: l.create ? 'CREATE' : 'SKIP',
              name: l.name,
              description: l.description || undefined,
              category: l.category || 'À classer',
              variants: l.variants.map((v) => ({ name: v.name, price: Number(v.price) || 0 })),
            }))
          : lines.map((l) => ({
              index: l.index,
              action: l.create ? 'CREATE' : 'SKIP',
              name: l.name,
              kind: l.kind,
              price: Number(l.variants[0]?.price) || 0,
              peopleIncluded: Number(l.peopleIncluded) || 1,
              conditions: l.conditions || undefined,
            }));
      const result = await api<AiImport>(`/ai/imports/${current.id}/publish/${kind}`, {
        method: 'POST',
        body: { lines: payload },
      });
      setCurrent(result);
      history.reload();
    } catch (e) {
      setError(e as ApiError);
      if (e instanceof ApiError && current) {
        // Les lignes créées avant une interruption sont mémorisées par le serveur : rechargement.
        api<AiImport>(`/ai/imports/${current.id}`)
          .then(open)
          .catch(() => undefined);
      }
    } finally {
      setPublishing(false);
    }
  }

  async function discard() {
    if (!current) return;
    try {
      setCurrent(await api<AiImport>(`/ai/imports/${current.id}/discard`, { method: 'POST' }));
      history.reload();
    } catch (e) {
      setError(e as ApiError);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="space-y-3">
          <p className="text-[15px]">
            Photographiez ou importez {noun} : l’IA propose les lignes, vous les vérifiez, puis vous
            publiez. Rien n’est publié ni remplacé sans votre validation. Le fichier n’est pas
            conservé.
          </p>
          <input
            ref={camera}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            aria-label="Photographier"
            onChange={(e) => choose(e.target.files?.[0])}
          />
          <input
            ref={picker}
            type="file"
            accept={AI_IMPORT_MIME_TYPES.join(',')}
            className="hidden"
            aria-label="Fichier à importer"
            data-testid="import-file"
            onChange={(e) => choose(e.target.files?.[0])}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon={<Camera className="h-4 w-4" />}
              onClick={() => camera.current?.click()}
            >
              Photographier
            </Button>
            <Button
              variant="secondary"
              icon={<FileUp className="h-4 w-4" />}
              onClick={() => picker.current?.click()}
            >
              Image ou PDF
            </Button>
            <Button
              icon={<Sparkles className="h-4 w-4" />}
              loading={analyzing}
              disabled={!file}
              onClick={analyze}
            >
              Analyser
            </Button>
          </div>
          {file && !analyzing && (
            <p className="text-sm text-muted">
              Fichier prêt : {file.name} ({Math.ceil(file.size / 1024)} Ko)
            </p>
          )}
          {analyzing && (
            <p className="flex items-center gap-2 text-sm text-muted" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Analyse en cours : cela peut
              prendre jusqu’à une minute.
            </p>
          )}
          {localError && <Alert tone="error">{localError}</Alert>}
        </div>
      </Card>
      <ApiErrorAlert error={error} />

      {current && renderReview()}

      <Card>
        <CardHeader
          title="Imports récents"
          description="Les résultats sont effacés à l’échéance de conservation."
        />
        {history.state === 'success' && history.data.length === 0 && (
          <p className="px-5 pb-5 text-sm text-muted sm:px-6">Aucun import pour l’instant.</p>
        )}
        {history.state === 'success' && history.data.length > 0 && (
          <ul className="divide-y divide-line/70">
            {history.data.map((h) => (
              <li
                key={h.id}
                className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 sm:px-6"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{h.fileName}</p>
                  <p className="text-sm text-muted">
                    {h.establishmentName} · {formatDateTime(h.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={STATUS_LABEL[h.status].tone}>{STATUS_LABEL[h.status].label}</Badge>
                  {h.status === 'ANALYZED' && !h.purgedAt && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        api<AiImport>(`/ai/imports/${h.id}`).then(open).catch(setError)
                      }
                    >
                      Reprendre
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );

  // Fonction de rendu (et non composant imbriqué) : les champs gardent le focus pendant la saisie.
  function renderReview() {
    if (!current) return null;
    if (current.status === 'PUBLISHED') {
      return (
        <Alert tone="success" title="Import publié">
          {current.publication?.created.length ?? 0} élément(s) créé(s),{' '}
          {current.publication?.skipped.length ?? 0} ignoré(s).{' '}
          {kind === 'tickets'
            ? 'Les billets sont désactivés : activez-les dans la configuration de la billetterie.'
            : 'Ils sont visibles dans le catalogue.'}
        </Alert>
      );
    }
    if (current.status === 'DISCARDED') return <Alert tone="info">Import abandonné.</Alert>;
    const result = current.result;
    if (!result) {
      return (
        <Alert tone="info">
          Résultat effacé (durée de conservation dépassée) : relancez l’analyse.
        </Alert>
      );
    }
    if (!result.readable) {
      return (
        <Alert tone="error" title="Document illisible">
          Reprenez une photo plus nette et bien cadrée, ou saisissez les lignes à la main.
          {result.warnings.map((w) => (
            <span key={w} className="block">
              {w}
            </span>
          ))}
        </Alert>
      );
    }
    return (
      <Card className="p-4 sm:p-5">
        <div className="space-y-4" data-testid="import-review">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">
              {lines.length} ligne(s) détectée(s) dans {current.fileName}
            </p>
            <AiBadge />
          </div>
          {current.publication?.error && <Alert tone="error">{current.publication.error}</Alert>}
          {result.warnings.map((w) => (
            <Alert key={w} tone="info">
              {w}
            </Alert>
          ))}
          <ul className="space-y-3">
            {lines.map((l) => (
              <li
                key={l.index}
                className={`space-y-2 rounded-xl border p-3 ${l.create ? 'border-forest/40 bg-surface' : 'border-line bg-ivory/60'}`}
                data-testid="import-line"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-forest"
                      checked={l.create}
                      onChange={(e) => update(l.index, { create: e.target.checked })}
                    />
                    {l.create ? 'À créer' : 'Ignorée'}
                  </label>
                  <div className="flex flex-wrap gap-1">
                    {l.issues.map((issue) => (
                      <Badge
                        key={issue}
                        tone={issue.startsWith('DUPLICATE') ? 'savanna' : 'terracotta'}
                      >
                        {IMPORT_ISSUE_LABELS[issue]}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <TextInput
                    label="Nom"
                    value={l.name}
                    max={kind === 'catalog' ? 80 : 60}
                    onChange={(name) => update(l.index, { name })}
                  />
                  {kind === 'catalog' ? (
                    <TextInput
                      label="Catégorie"
                      value={l.category}
                      max={60}
                      onChange={(category) => update(l.index, { category })}
                    />
                  ) : (
                    <label className="space-y-1 text-sm">
                      <span className="font-medium">Type</span>
                      <select
                        className="min-h-11 w-full rounded-xl border border-line bg-surface px-3"
                        value={l.kind}
                        onChange={(e) => update(l.index, { kind: e.target.value as TicketKind })}
                      >
                        {TICKET_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {TICKET_KIND_LABELS[k]}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {l.variants.map((v, vi) => (
                    <div key={vi} className="flex items-end gap-2">
                      {kind === 'catalog' && l.variants.length > 1 && (
                        <TextInput
                          label="Variante"
                          value={v.name}
                          max={60}
                          onChange={(name) =>
                            update(l.index, {
                              variants: l.variants.map((x, j) => (j === vi ? { ...x, name } : x)),
                            })
                          }
                        />
                      )}
                      <TextInput
                        label="Prix (FCFA)"
                        value={v.price}
                        inputMode="numeric"
                        invalid={l.create && !validPrice(v.price)}
                        onChange={(price) =>
                          update(l.index, {
                            variants: l.variants.map((x, j) => (j === vi ? { ...x, price } : x)),
                          })
                        }
                      />
                    </div>
                  ))}
                  {kind === 'tickets' && (
                    <TextInput
                      label="Personnes incluses"
                      value={l.peopleIncluded}
                      inputMode="numeric"
                      onChange={(peopleIncluded) => update(l.index, { peopleIncluded })}
                    />
                  )}
                </div>
                <p className="text-xs text-muted">
                  Lu : « {l.sourceText} »
                  {l.duplicateOf && ` · proche de « ${l.duplicateOf} » déjà existant`}
                </p>
              </li>
            ))}
          </ul>
          {missingPrice && (
            <Alert tone="error">
              Saisissez un prix pour chaque ligne à créer (aucun prix n’est deviné).
            </Alert>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={discard}>
              Abandonner
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <ButtonLink
                href={kind === 'catalog' ? '/app/catalogue' : '/app/billetterie/configuration'}
                variant="secondary"
              >
                Saisir à la main
              </ButtonLink>
              <Button
                icon={<CheckCircle2 className="h-4 w-4" />}
                loading={publishing}
                disabled={toCreate.length === 0 || missingPrice}
                onClick={publish}
              >
                Publier {toCreate.length} ligne(s)
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted">
            {kind === 'catalog'
              ? 'Les produits sont ajoutés au catalogue, avec les tarifs de cet établissement. Rien n’est remplacé.'
              : 'Les billets sont créés désactivés : ils ne se vendent qu’après activation.'}
          </p>
        </div>
      </Card>
    );
  }
}

function TextInput({
  label,
  value,
  onChange,
  max,
  inputMode,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  max?: number;
  inputMode?: 'numeric';
  invalid?: boolean;
}) {
  return (
    <label className="block flex-1 space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      <input
        className={`min-h-11 w-full rounded-xl border bg-surface px-3 ${invalid ? 'border-terracotta-dark' : 'border-line'}`}
        value={value}
        maxLength={max}
        inputMode={inputMode}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

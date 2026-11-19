'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import {
  PRINT_CARD_KIND_LABELS,
  PRINT_FIELDS_BY_KIND,
  PRINT_LAYOUT_LIMITS,
  type PrintCardKind,
  type PrintField,
  type PrintLayout,
  defaultPrintLayout,
  printFieldLabel,
} from '@ocall/shared';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api, apiUpload } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import type { CardSides, PrintTemplateView } from './print-types';
import { CardPreview } from './print-ui';

/**
 * Éditeur de modèle de carte recto verso, COMMUN à Ocall School, à l'accès autonome et aux applications
 * futures : `basePath` désigne les modèles de l'application (ex. /school/card-templates). Chaque
 * enregistrement crée une version ; les commandes déjà envoyées gardent la leur.
 */
export function TemplateEditor({
  basePath,
  template,
  canEdit,
  onSaved,
}: {
  basePath: string;
  template: PrintTemplateView;
  canEdit: boolean;
  onSaved: (t: PrintTemplateView) => void;
}) {
  const [name, setName] = useState(template.name);
  const [layout, setLayout] = useState<PrintLayout>(template.layout);
  const [linesText, setLinesText] = useState(template.layout.back.lines.join('\n'));
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const preview = useApi<CardSides>(
    `${basePath}/${template.id}/preview?v=${template.currentVersion}`,
  );
  const kind = template.kind;
  const available = PRINT_FIELDS_BY_KIND[kind];

  const set = <K extends keyof PrintLayout>(key: K, value: PrintLayout[K]) =>
    setLayout((l) => ({ ...l, [key]: value }));
  const setFront = (patch: Partial<PrintLayout['front']>) =>
    setLayout((l) => ({ ...l, front: { ...l.front, ...patch } }));
  const setBack = (patch: Partial<PrintLayout['back']>) =>
    setLayout((l) => ({ ...l, back: { ...l.back, ...patch } }));

  function toggleField(field: PrintField) {
    const fields = layout.front.fields.includes(field)
      ? layout.front.fields.filter((f) => f !== field)
      : [...layout.front.fields, field];
    setFront({ fields });
  }

  function move(field: PrintField, delta: -1 | 1) {
    const fields = [...layout.front.fields];
    const i = fields.indexOf(field);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= fields.length) return;
    [fields[i], fields[j]] = [fields[j]!, fields[i]!];
    setFront({ fields });
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const lines = linesText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const t = await api<PrintTemplateView>(`${basePath}/${template.id}`, {
        method: 'PATCH',
        body: { name, layout: { ...layout, back: { ...layout.back, lines } } },
      });
      setSaved(true);
      onSaved(t);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Erreur réseau.'));
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File | null) {
    setError(null);
    try {
      const t = file
        ? await (() => {
            const form = new FormData();
            form.append('file', file);
            return apiUpload<PrintTemplateView>(`${basePath}/${template.id}/logo`, form, 'PUT');
          })()
        : await api<PrintTemplateView>(`${basePath}/${template.id}/logo`, { method: 'DELETE' });
      onSaved(t);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Erreur réseau.'));
    }
  }

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <Card className="min-w-0">
        <CardHeader
          title={`${PRINT_CARD_KIND_LABELS[kind]} — version ${template.currentVersion}`}
          description="Recto : bandeau, photo et champs ; verso : QR sécurisé, mentions, validité."
        />
        <CardBody className="space-y-5">
          <fieldset disabled={!canEdit} className="space-y-5">
            <InputField
              label="Nom du modèle"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Orientation"
                value={layout.orientation}
                onChange={(e) => set('orientation', e.target.value as PrintLayout['orientation'])}
                options={[
                  { value: 'LANDSCAPE', label: 'Paysage (85,6 × 54 mm)' },
                  { value: 'PORTRAIT', label: 'Portrait (54 × 85,6 mm)' },
                ]}
              />
              <SelectField
                label="Position de la photo (paysage)"
                value={layout.front.photo}
                onChange={(e) => setFront({ photo: e.target.value as 'LEFT' | 'RIGHT' })}
                options={[
                  { value: 'LEFT', label: 'À gauche' },
                  { value: 'RIGHT', label: 'À droite' },
                ]}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {(
                [
                  ['primary', 'Couleur principale'],
                  ['text', 'Couleur du texte'],
                  ['background', 'Fond de la carte'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="block min-w-0 text-sm font-medium text-charcoal">
                  {label}
                  <input
                    type="color"
                    value={layout.colors[key]}
                    onChange={(e) =>
                      set('colors', { ...layout.colors, [key]: e.target.value.toUpperCase() })
                    }
                    className="mt-1.5 block h-10 w-full cursor-pointer rounded-lg border border-line bg-surface"
                  />
                </label>
              ))}
            </div>
            <InputField
              label="Titre du recto"
              value={layout.front.title}
              maxLength={PRINT_LAYOUT_LIMITS.titleMax}
              onChange={(e) => setFront({ title: e.target.value })}
            />
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <Toggle
                checked={layout.front.showLogo}
                onChange={(v) => setFront({ showLogo: v })}
                label="Logo"
              />
              <Toggle
                checked={layout.front.showIssuer}
                onChange={(v) => setFront({ showIssuer: v })}
                label="Nom de l’établissement"
              />
            </div>
            <div>
              <p className="text-sm font-medium text-charcoal">
                Champs du recto ({layout.front.fields.length}/{PRINT_LAYOUT_LIMITS.fieldsMax}), dans
                l’ordre
              </p>
              <ul className="mt-2 divide-y divide-line/70 rounded-xl border border-line">
                {available.map((field) => {
                  const on = layout.front.fields.includes(field);
                  return (
                    <li
                      key={field}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                    >
                      <Toggle
                        checked={on}
                        onChange={() => toggleField(field)}
                        label={printFieldLabel(field, kind)}
                      />
                      {on && (
                        <span className="flex shrink-0 gap-1">
                          <button
                            type="button"
                            className="rounded p-1 hover:bg-ivory-dark/60"
                            aria-label={`Monter ${printFieldLabel(field, kind)}`}
                            onClick={() => move(field, -1)}
                          >
                            <ArrowUp className="h-4 w-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="rounded p-1 hover:bg-ivory-dark/60"
                            aria-label={`Descendre ${printFieldLabel(field, kind)}`}
                            onClick={() => move(field, 1)}
                          >
                            <ArrowDown className="h-4 w-4" aria-hidden />
                          </button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
            <label className="block text-sm font-medium text-charcoal">
              Mentions du verso ({PRINT_LAYOUT_LIMITS.linesMax} lignes au plus)
              <textarea
                value={linesText}
                rows={4}
                onChange={(e) => setLinesText(e.target.value)}
                className="mt-1.5 block w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
              />
            </label>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <Toggle
                checked={layout.back.showQr}
                onChange={(v) => setBack({ showQr: v })}
                label="QR sécurisé"
              />
              <Toggle
                checked={layout.back.showValidity}
                onChange={(v) => setBack({ showValidity: v })}
                label="Date de validité"
              />
              <Toggle
                checked={layout.back.showIssuerContact}
                onChange={(v) => setBack({ showIssuerContact: v })}
                label="Contact"
              />
              <Toggle
                checked={layout.back.showCardNumber}
                onChange={(v) => setBack({ showCardNumber: v })}
                label="Numéro de carte"
              />
            </div>
          </fieldset>
          {canEdit && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-charcoal">Logo (PNG, JPEG ou WebP)</p>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  aria-label="Choisir un logo"
                  onChange={(e) => void uploadLogo(e.target.files?.[0] ?? null)}
                  className="max-w-full text-sm"
                />
                {template.hasLogo && (
                  <Button variant="ghost" size="sm" onClick={() => void uploadLogo(null)}>
                    Retirer le logo
                  </Button>
                )}
              </div>
            </div>
          )}
          <ApiErrorAlert error={error} />
          {saved && <Alert tone="success">Modèle enregistré : nouvelle version créée.</Alert>}
          {canEdit && (
            <div className="flex flex-wrap gap-3">
              <Button
                onClick={() => void save()}
                loading={saving}
                data-testid="print-template-save"
              >
                Enregistrer et prévisualiser
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  const d = defaultPrintLayout(kind);
                  setLayout(d);
                  setLinesText(d.back.lines.join('\n'));
                }}
              >
                Mise en page par défaut
              </Button>
            </div>
          )}
        </CardBody>
      </Card>
      <Card className="min-w-0">
        <CardHeader
          title="Aperçu"
          description="Rendu exact du moteur d’impression, titulaire fictif."
        />
        <CardBody>
          {preview.state === 'loading' && <LoadingState />}
          {preview.state === 'error' && (
            <ErrorState error={preview.error} onRetry={preview.reload} />
          )}
          {preview.state === 'success' && <CardPreview sides={preview.data} />}
        </CardBody>
      </Card>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <label className="inline-flex min-w-0 cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-line accent-forest"
      />
      <span className="min-w-0 break-words">{label}</span>
    </label>
  );
}

/** Création d'un modèle : nom et type, mise en page par défaut, puis édition. */
export function NewTemplateForm({
  onCreate,
  disabled,
}: {
  onCreate: (input: { name: string; kind: PrintCardKind; layout: PrintLayout }) => Promise<void>;
  disabled?: boolean;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PrintCardKind>('STUDENT');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  return (
    <form
      className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onCreate({ name, kind, layout: defaultPrintLayout(kind) });
          setName('');
        } catch (err) {
          setError(err instanceof ApiError ? err : new ApiError(0, 'NETWORK', 'Erreur réseau.'));
        } finally {
          setBusy(false);
        }
      }}
    >
      <InputField
        label="Nom du nouveau modèle"
        required
        value={name}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
      />
      <SelectField
        label="Type de carte"
        value={kind}
        onChange={(e) => setKind(e.target.value as PrintCardKind)}
        options={[
          { value: 'STUDENT', label: PRINT_CARD_KIND_LABELS.STUDENT },
          { value: 'STAFF', label: PRINT_CARD_KIND_LABELS.STAFF },
        ]}
      />
      <Button type="submit" loading={busy} disabled={disabled || name.trim().length < 2}>
        Créer
      </Button>
      <div className="sm:col-span-3">
        <ApiErrorAlert error={error} />
      </div>
    </form>
  );
}

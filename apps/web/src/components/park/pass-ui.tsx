'use client';

import { type ChangeEvent, useRef, useState } from 'react';
import { Camera, Link2, Link2Off } from 'lucide-react';
import {
  PASS_STATE_LABELS,
  type PassDurationUnit,
  type PassKind,
  type PassState,
  WEEKDAY_LABELS,
} from '@ocall/shared';
import { toApiError } from '@/components/pos/cash-session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiErrorAlert, Alert } from '@/components/ui/states';
import { type ApiError, api, apiUpload } from '@/lib/api';
import { TicketQr } from './ticket-qr';

const STATE_TONES: Record<PassState, 'forest' | 'savanna' | 'terracotta' | 'neutral'> = {
  ACTIVE: 'forest',
  UPCOMING: 'savanna',
  PENDING: 'savanna',
  SUSPENDED: 'terracotta',
  CANCELLED: 'neutral',
  EXPIRED: 'neutral',
};

export function PassStateBadge({ state }: { state: PassState }) {
  return <Badge tone={STATE_TONES[state]}>{PASS_STATE_LABELS[state]}</Badge>;
}

const dayFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Date AAAA-MM-JJ (jour du parc) affichée sans décalage de fuseau. */
export const formatPassDay = (day: string | null) =>
  day ? dayFormatter.format(new Date(`${day}T00:00:00Z`)) : '—';

export function describeDuration(unit: PassDurationUnit, value: number) {
  if (unit === 'MONTHS') return value === 1 ? '1 mois' : `${value} mois`;
  return value === 1 ? '1 jour' : `${value} jours consécutifs`;
}

/** Règles d'une offre en une ligne : durée, entrées, jours autorisés. */
export function describeOfferRules(o: {
  kind: PassKind;
  durationUnit: PassDurationUnit;
  durationValue: number;
  totalEntries: number | null;
  dailyEntries: number | null;
  allowedWeekdays: number[];
}) {
  const parts = [describeDuration(o.durationUnit, o.durationValue)];
  parts.push(
    o.dailyEntries === null
      ? 'entrées illimitées par jour'
      : `${o.dailyEntries} entrée${o.dailyEntries > 1 ? 's' : ''} par jour`,
  );
  if (o.totalEntries !== null) parts.push(`${o.totalEntries} entrées au total`);
  if (o.allowedWeekdays.length > 0 && o.allowedWeekdays.length < 7) {
    parts.push(
      [...o.allowedWeekdays]
        .sort()
        .map((d) => WEEKDAY_LABELS[d])
        .join(' '),
    );
  }
  return parts.join(' · ');
}

/**
 * Photo du titulaire : prise avec l'appareil (caméra frontale sur téléphone) ou choisie, réencodée par
 * le serveur (JPEG sans métadonnées) et stockée en privé.
 */
export function PassPhotoInput({
  value,
  onChange,
  required,
}: {
  value: { id: string; url: string } | null;
  onChange: (photo: { id: string; url: string } | null) => void;
  required: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ loading: boolean; error: ApiError | null }>({
    loading: false,
    error: null,
  });

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setState({ loading: true, error: null });
    const form = new FormData();
    form.append('file', file);
    try {
      const photo = await apiUpload<{ id: string; url: string }>('/passes/photos', form);
      onChange(photo);
      setState({ loading: false, error: null });
    } catch (e) {
      setState({ loading: false, error: toApiError(e) });
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">
        Photo du titulaire{' '}
        <span className="font-normal text-muted">
          {required ? '(obligatoire)' : '(facultative)'}
        </span>
      </p>
      <div className="flex items-center gap-3">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element -- lien signé temporaire, privé
          <img
            src={value.url}
            alt="Photo du titulaire"
            className="h-20 w-20 rounded-xl border border-line object-cover"
            data-testid="pass-photo-preview"
          />
        ) : (
          <div className="grid h-20 w-20 place-items-center rounded-xl border-2 border-dashed border-line text-muted">
            <Camera className="h-7 w-7" aria-hidden />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            loading={state.loading}
            onClick={() => input.current?.click()}
            icon={<Camera className="h-4 w-4" />}
          >
            {value ? 'Reprendre la photo' : 'Prendre la photo'}
          </Button>
          {value && (
            <Button type="button" variant="ghost" onClick={() => onChange(null)}>
              Retirer
            </Button>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="user"
          className="sr-only"
          aria-label="Photo du titulaire"
          data-testid="pass-photo-input"
          onChange={onFile}
        />
      </div>
      <ApiErrorAlert error={state.error} />
    </div>
  );
}

/**
 * Lien personnel du titulaire : le jeton n'est montré qu'une fois, à l'émission (seule son empreinte
 * est conservée). Émettre un nouveau lien remplace le précédent.
 */
export function PassLinkPanel({
  passId,
  hasLink,
  canRevoke,
  onChanged,
}: {
  passId: string;
  hasLink: boolean;
  canRevoke: boolean;
  onChanged: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [copied, setCopied] = useState(false);

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ token: string; path: string }>(`/passes/${passId}/link`, {
        method: 'POST',
      });
      setUrl(`${window.location.origin}${res.path}`);
      setCopied(false);
      onChanged();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      await api(`/passes/${passId}/link`, { method: 'DELETE' });
      setUrl(null);
      onChanged();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-3">
      <ApiErrorAlert error={error} />
      {url ? (
        <div className="space-y-3 rounded-2xl border border-line bg-ivory/60 p-3">
          <Alert tone="info">
            Lien à transmettre au titulaire maintenant : il ne sera plus affiché ensuite.
          </Alert>
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <TicketQr value={url} size={140} label="QR du lien personnel" />
            <div className="min-w-0 flex-1 space-y-2">
              <p
                className="break-all rounded-xl bg-surface p-2 font-mono text-xs"
                data-testid="pass-link-url"
              >
                {url}
              </p>
              <Button type="button" size="sm" variant="secondary" onClick={copy}>
                {copied ? 'Copié' : 'Copier le lien'}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">
          {hasLink
            ? 'Un lien personnel est actif. En émettre un nouveau désactive le précédent.'
            : 'Aucun lien personnel actif.'}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          loading={busy}
          onClick={issue}
          icon={<Link2 className="h-4 w-4" />}
        >
          {hasLink || url ? 'Nouveau lien' : 'Créer le lien personnel'}
        </Button>
        {canRevoke && (hasLink || url) && (
          <Button
            type="button"
            variant="ghost"
            loading={busy}
            onClick={revoke}
            icon={<Link2Off className="h-4 w-4" />}
          >
            Révoquer le lien
          </Button>
        )}
      </div>
    </div>
  );
}

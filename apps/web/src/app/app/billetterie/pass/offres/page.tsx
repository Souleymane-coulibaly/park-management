'use client';

import { type FormEvent, useState } from 'react';
import { IdCard, Plus } from 'lucide-react';
import {
  PASS_KINDS,
  PASS_KIND_DEFAULTS,
  PASS_KIND_LABELS,
  type PassDurationUnit,
  type PassKind,
  type PassQrMode,
  WEEKDAY_LABELS,
  formatXof,
  passPhotoRequired,
} from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { ParkNav } from '@/components/park/park-nav';
import { describeOfferRules } from '@/components/park/pass-ui';
import { toApiError } from '@/components/pos/cash-session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import type { ParkEstablishment, PassOffer } from '@/lib/types';
import { useApi } from '@/lib/use-api';

/** Offres de pass : journalier, hebdomadaire, mensuel, annuel ; parcs autorisés et tarifs par parc. */
export default function PassOffersPage() {
  const canManage = useCan('ticketing.manage');
  const offers = useApi<PassOffer[]>(canManage ? '/pass-offers' : null);
  const parks = useApi<ParkEstablishment[]>(canManage ? '/ticketing/establishments' : null);
  const [editing, setEditing] = useState<PassOffer | 'new' | null>(null);
  if (!canManage) return <AccessDenied />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Offres de pass</h1>
        <ParkNav />
      </div>
      <Alert tone="info">
        Modifier une offre ne change pas les pass déjà vendus : leurs règles sont figées à la vente.
      </Alert>
      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')} icon={<Plus className="h-4 w-4" />}>
          Nouvelle offre
        </Button>
      </div>
      {offers.state === 'loading' && <LoadingState />}
      {offers.state === 'error' && <ErrorState error={offers.error} onRetry={offers.reload} />}
      {offers.state === 'success' && offers.data.length === 0 && (
        <Card>
          <EmptyState
            icon={<IdCard className="h-7 w-7" />}
            title="Aucune offre de pass"
            description="Créez un pass journalier, hebdomadaire, mensuel ou annuel."
          />
        </Card>
      )}
      {offers.state === 'success' && offers.data.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {offers.data.map((o) => (
            <Card key={o.id} className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-bold">{o.name}</h2>
                  <p className="text-xs uppercase tracking-wide text-muted">
                    {PASS_KIND_LABELS[o.kind]}
                  </p>
                </div>
                <Badge tone={o.isActive ? 'forest' : 'neutral'}>
                  {o.isActive ? 'En vente' : 'Désactivée'}
                </Badge>
              </div>
              <p className="text-sm text-muted">{describeOfferRules(o)}</p>
              <p className="text-sm">
                QR {o.qrMode === 'DYNAMIC' ? 'dynamique' : 'fixe'} · photo{' '}
                {passPhotoRequired(o.kind, o.photoRequired) ? 'obligatoire' : 'facultative'}
                {o.renewable && ' · renouvelable'}
                {o.maxSuspensionDays > 0 && ` · suspension ${o.maxSuspensionDays} j max`}
              </p>
              <ul className="text-sm">
                {o.sites
                  .filter((s) => s.isActive)
                  .map((s) => (
                    <li key={s.establishmentId} className="flex justify-between gap-2">
                      <span className="truncate">{s.name}</span>
                      <span className="font-semibold">{formatXof(s.effectivePrice)}</span>
                    </li>
                  ))}
              </ul>
              <Button variant="secondary" size="sm" onClick={() => setEditing(o)}>
                Modifier
              </Button>
            </Card>
          ))}
        </div>
      )}
      {editing && parks.state === 'success' && (
        <OfferDialog
          offer={editing === 'new' ? null : editing}
          parks={parks.data}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            offers.reload();
          }}
        />
      )}
    </div>
  );
}

const optionalInt = (value: string): number | null => (value.trim() === '' ? null : Number(value));

function OfferDialog({
  offer,
  parks,
  onClose,
  onSaved,
}: {
  offer: PassOffer | null;
  parks: ParkEstablishment[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<PassKind>(offer?.kind ?? 'MONTHLY');
  const defaults = PASS_KIND_DEFAULTS[kind];
  const [name, setName] = useState(offer?.name ?? '');
  const [price, setPrice] = useState(offer ? String(offer.price) : '');
  const [durationUnit, setDurationUnit] = useState<PassDurationUnit>(
    offer?.durationUnit ?? defaults.durationUnit,
  );
  const [durationValue, setDurationValue] = useState(
    String(offer?.durationValue ?? defaults.durationValue),
  );
  const [totalEntries, setTotalEntries] = useState(
    String((offer ? offer.totalEntries : defaults.totalEntries) ?? ''),
  );
  const [dailyEntries, setDailyEntries] = useState(
    String((offer ? offer.dailyEntries : defaults.dailyEntries) ?? ''),
  );
  const [weekdays, setWeekdays] = useState<number[]>(offer?.allowedWeekdays ?? []);
  const [qrMode, setQrMode] = useState<PassQrMode>(offer?.qrMode ?? defaults.qrMode);
  const [photoRequired, setPhotoRequired] = useState(
    offer?.photoRequired ?? defaults.photoRequired,
  );
  const [renewable, setRenewable] = useState(offer?.renewable ?? defaults.renewable);
  const [maxSuspensionDays, setMaxSuspensionDays] = useState(String(offer?.maxSuspensionDays ?? 0));
  const [suspensionExtends, setSuspensionExtends] = useState(offer?.suspensionExtends ?? true);
  const [conditions, setConditions] = useState(offer?.conditions ?? '');
  const [saleFrom, setSaleFrom] = useState(offer?.saleFrom ?? '');
  const [saleUntil, setSaleUntil] = useState(offer?.saleUntil ?? '');
  const [isActive, setIsActive] = useState(offer?.isActive ?? true);
  const [sites, setSites] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(
      (offer?.sites.filter((s) => s.isActive) ?? []).map((s) => [
        s.establishmentId,
        s.price === null ? '' : String(s.price),
      ]),
    ),
  );
  const [state, setState] = useState<{ loading: boolean; error: ApiError | null }>({
    loading: false,
    error: null,
  });

  function changeKind(next: PassKind) {
    setKind(next);
    const d = PASS_KIND_DEFAULTS[next];
    setDurationUnit(d.durationUnit);
    setDurationValue(String(d.durationValue));
    setTotalEntries(String(d.totalEntries ?? ''));
    setDailyEntries(String(d.dailyEntries ?? ''));
    setQrMode(d.qrMode);
    setPhotoRequired(d.photoRequired);
    setRenewable(d.renewable);
  }

  const forcedPhoto = passPhotoRequired(kind, false);
  const siteIds = Object.keys(sites);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState({ loading: true, error: null });
    const body = {
      ...(offer ? { isActive } : { kind }),
      name: name.trim(),
      price: Number(price),
      durationUnit,
      durationValue: Number(durationValue),
      totalEntries: optionalInt(totalEntries),
      dailyEntries: optionalInt(dailyEntries),
      allowedWeekdays: weekdays,
      qrMode,
      photoRequired: forcedPhoto || photoRequired,
      renewable,
      maxSuspensionDays: Number(maxSuspensionDays || 0),
      suspensionExtends,
      conditions: conditions.trim(),
      saleFrom: saleFrom || null,
      saleUntil: saleUntil || null,
      sites: siteIds.map((establishmentId) => ({
        establishmentId,
        price: optionalInt(sites[establishmentId] ?? ''),
      })),
    };
    try {
      await api(offer ? `/pass-offers/${offer.id}` : '/pass-offers', {
        method: offer ? 'PATCH' : 'POST',
        body,
      });
      onSaved();
    } catch (e) {
      setState({ loading: false, error: toApiError(e) });
    }
  }

  const check = 'h-5 w-5 rounded border-line accent-forest';

  return (
    <Dialog open onClose={onClose} title={offer ? 'Modifier l’offre' : 'Nouvelle offre de pass'}>
      <form onSubmit={submit} className="space-y-4">
        {!offer && (
          <SelectField
            label="Type de pass"
            value={kind}
            onChange={(e) => changeKind(e.target.value as PassKind)}
            options={PASS_KINDS.map((k) => ({ value: k, label: PASS_KIND_LABELS[k] }))}
          />
        )}
        <InputField
          label="Nom de l’offre"
          value={name}
          onChange={(e) => setName(e.target.value)}
          minLength={2}
          maxLength={80}
          required
        />
        <InputField
          label="Prix de base (FCFA)"
          type="number"
          inputMode="numeric"
          min={0}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          required
        />
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label="Durée en"
            value={durationUnit}
            onChange={(e) => setDurationUnit(e.target.value as PassDurationUnit)}
            options={[
              { value: 'DAYS', label: 'Jours' },
              { value: 'MONTHS', label: 'Mois calendaires' },
            ]}
          />
          <InputField
            label="Durée"
            type="number"
            min={1}
            max={durationUnit === 'MONTHS' ? 24 : 366}
            value={durationValue}
            onChange={(e) => setDurationValue(e.target.value)}
            required
          />
          <InputField
            label="Entrées par jour"
            hint="Vide : illimité"
            type="number"
            min={1}
            max={100}
            value={dailyEntries}
            onChange={(e) => setDailyEntries(e.target.value)}
          />
          <InputField
            label="Entrées par période"
            hint="Vide : illimité"
            type="number"
            min={1}
            value={totalEntries}
            onChange={(e) => setTotalEntries(e.target.value)}
          />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Jours autorisés (aucun coché : tous)</legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_LABELS.map((label, day) => (
              <label
                key={label}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line px-3"
              >
                <input
                  type="checkbox"
                  className={check}
                  checked={weekdays.includes(day)}
                  onChange={(e) =>
                    setWeekdays((w) =>
                      e.target.checked ? [...w, day].sort() : w.filter((d) => d !== day),
                    )
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <SelectField
          label="QR code"
          value={qrMode}
          onChange={(e) => setQrMode(e.target.value as PassQrMode)}
          options={[
            { value: 'STATIC', label: 'Fixe (remis ou imprimé au guichet)' },
            { value: 'DYNAMIC', label: 'Dynamique (lien personnel, renouvelé toutes les 30 s)' },
          ]}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className={check}
            checked={forcedPhoto || photoRequired}
            disabled={forcedPhoto}
            onChange={(e) => setPhotoRequired(e.target.checked)}
          />
          Photo du titulaire obligatoire
          {forcedPhoto && <span className="text-muted">(toujours pour mensuel et annuel)</span>}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className={check}
            checked={renewable}
            onChange={(e) => setRenewable(e.target.checked)}
          />
          Renouvelable au guichet
        </label>
        <div className="grid grid-cols-2 items-end gap-3">
          <InputField
            label="Suspension max. (jours)"
            hint="0 : interdite"
            type="number"
            min={0}
            max={366}
            value={maxSuspensionDays}
            onChange={(e) => setMaxSuspensionDays(e.target.value)}
          />
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className={check}
              checked={suspensionExtends}
              onChange={(e) => setSuspensionExtends(e.target.checked)}
            />
            La suspension prolonge la validité
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <InputField
            label="Vente à partir du"
            type="date"
            value={saleFrom}
            onChange={(e) => setSaleFrom(e.target.value)}
          />
          <InputField
            label="Vente jusqu’au"
            type="date"
            value={saleUntil}
            onChange={(e) => setSaleUntil(e.target.value)}
          />
        </div>
        <InputField
          label="Conditions (affichées au guichet)"
          value={conditions}
          maxLength={500}
          onChange={(e) => setConditions(e.target.value)}
        />
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            Parcs où le pass est valable (quotas partagés entre ces parcs)
          </legend>
          {parks.map((p) => {
            const selected = p.id in sites;
            return (
              <div
                key={p.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-2"
              >
                <label className="flex min-h-11 flex-1 items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    className={check}
                    checked={selected}
                    onChange={(e) =>
                      setSites((s) => {
                        const next = { ...s };
                        if (e.target.checked) next[p.id] = '';
                        else delete next[p.id];
                        return next;
                      })
                    }
                  />
                  {p.name}
                </label>
                {selected && (
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    aria-label={`Tarif propre à ${p.name} (FCFA)`}
                    placeholder="Prix de base"
                    value={sites[p.id] ?? ''}
                    onChange={(e) => setSites((s) => ({ ...s, [p.id]: e.target.value }))}
                    className="min-h-11 w-36 rounded-xl border border-line bg-surface px-3 text-base"
                  />
                )}
              </div>
            );
          })}
        </fieldset>
        {offer && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className={check}
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            En vente
          </label>
        )}
        <ApiErrorAlert error={state.error} />
        <div className="flex gap-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
            Annuler
          </Button>
          <Button
            type="submit"
            className="flex-1"
            loading={state.loading}
            disabled={siteIds.length === 0}
          >
            Enregistrer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

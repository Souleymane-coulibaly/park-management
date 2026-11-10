'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { FileText, ImageUp } from 'lucide-react';
import {
  FACTURE_LOGO_LIMITS,
  FACTURE_TAX_REGIME_SUGGESTIONS,
  FACTURE_VAT_RATES,
  type FactureLogoPlacement,
  formatVatRate,
} from '@ocall/shared';
import { FacturePage } from '@/components/facture/facture-page';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { ApiError, api, apiUpload } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface SettingsView {
  legalName: string;
  tradeName: string | null;
  description: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  nif: string | null;
  rccm: string | null;
  taxRegime: string | null;
  bankDetails: string | null;
  legalFooter: string | null;
  defaultVatRate: number;
  paymentTermsDays: number;
  accentColor: string;
  quoteValidityDays: number;
  defaultTerms: string | null;
  hasLogo: boolean;
  saved: boolean;
  legalMissing: string[];
}

const TEXTAREA =
  'w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/30 disabled:opacity-60';

const toError = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', 'Une erreur est survenue.');

/**
 * Identité légale et mentions des documents (Mali) : raison sociale, adresse, NIF, RCCM, régime
 * d'imposition, TVA par défaut (liste de 0 à 20 %), délai de paiement, logo, aperçu PDF de l'en-tête.
 */
export default function FactureSettingsPage() {
  return (
    <FacturePage
      title="Entreprise et mentions"
      description="Ces informations figurent sur vos devis, factures et rapports."
    >
      {({ canWrite, reload }) => (
        <SettingsForm editable={canWrite('facture.settings.manage')} onSaved={reload} />
      )}
    </FacturePage>
  );
}

function SettingsForm({ editable, onSaved }: { editable: boolean; onSaved: () => void }) {
  const current = useApi<SettingsView>('/facture/settings');
  const [form, setForm] = useState<SettingsView | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [logoVersion, setLogoVersion] = useState(0);

  // Dépend des seules données chargées (référence stable) : jamais d'écrasement des saisies en cours.
  const loaded = current.state === 'success' ? current.data : null;
  useEffect(() => {
    if (loaded) setForm(loaded);
  }, [loaded]);

  if (current.state === 'loading' || (current.state === 'success' && !form))
    return <LoadingState />;
  if (current.state === 'error')
    return <ErrorState error={current.error} onRetry={current.reload} />;
  const f = form!;
  const set = (patch: Partial<SettingsView>) => setForm({ ...f, ...patch });
  const text = (key: keyof SettingsView) => ({
    value: (f[key] as string | null) ?? '',
    disabled: !editable,
    onChange: (e: { target: { value: string } }) => set({ [key]: e.target.value }),
  });

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await api<SettingsView>('/facture/settings', {
        method: 'PUT',
        body: {
          legalName: f.legalName,
          tradeName: f.tradeName,
          description: f.description,
          address: f.address,
          city: f.city,
          phone: f.phone,
          email: f.email,
          nif: f.nif,
          rccm: f.rccm,
          taxRegime: f.taxRegime,
          bankDetails: f.bankDetails,
          legalFooter: f.legalFooter,
          defaultVatRate: f.defaultVatRate,
          paymentTermsDays: f.paymentTermsDays,
          accentColor: f.accentColor,
          quoteValidityDays: f.quoteValidityDays,
          defaultTerms: f.defaultTerms,
        },
      });
      setForm(saved);
      setNotice('Identité de l’entreprise enregistrée.');
      onSaved();
    } catch (e) {
      setError(toError(e));
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File | undefined) {
    if (!file) return;
    setError(null);
    setNotice(null);
    const data = new FormData();
    data.append('file', file);
    try {
      await apiUpload('/facture/settings/logo', data);
      set({ hasLogo: true });
      setLogoVersion((v) => v + 1);
      setNotice('Logo enregistré.');
    } catch (e) {
      setError(toError(e));
    }
  }

  return (
    <form onSubmit={save} className="space-y-6" data-testid="facture-settings-form">
      {f.legalMissing.length > 0 && (
        <Alert tone="info" title="Mentions recommandées encore absentes (facultatives)">
          {f.legalMissing.join(', ')}.
        </Alert>
      )}
      {notice && (
        <div role="status">
          <Alert tone="success" title={notice} />
        </div>
      )}
      <ApiErrorAlert error={error} />
      <Card>
        <CardHeader title="Identité de l’entreprise" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <InputField label="Raison sociale" required maxLength={160} {...text('legalName')} />
          <InputField label="Nom commercial (facultatif)" maxLength={120} {...text('tradeName')} />
          <div className="sm:col-span-2">
            <InputField
              label="Activité ou slogan (sous le nom, facultatif)"
              placeholder="Ex. Distributeur agréé d’équipements solaires"
              maxLength={160}
              {...text('description')}
            />
          </div>
          <InputField label="Adresse (facultatif)" maxLength={240} {...text('address')} />
          <InputField label="Ville (facultatif)" maxLength={80} {...text('city')} />
          <InputField
            label="Téléphone (avec indicatif)"
            type="tel"
            placeholder="+223 70 00 00 00"
            {...text('phone')}
          />
          <InputField label="E-mail" type="email" maxLength={160} {...text('email')} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Mentions légales et fiscales"
          description="Facultatives, imprimées si renseignées. Recommandées au Mali : à faire valider par votre expert-comptable."
        />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <InputField
            label="Numéro d’identification fiscale (NIF, facultatif)"
            maxLength={40}
            {...text('nif')}
          />
          <InputField label="RCCM (facultatif)" maxLength={40} {...text('rccm')} />
          <div>
            <InputField
              label="Régime d’imposition"
              list="facture-tax-regimes"
              maxLength={120}
              {...text('taxRegime')}
            />
            <datalist id="facture-tax-regimes">
              {FACTURE_TAX_REGIME_SUGGESTIONS.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </div>
          <SelectField
            label="TVA par défaut"
            value={String(f.defaultVatRate)}
            disabled={!editable}
            onChange={(e) => set({ defaultVatRate: Number(e.target.value) })}
            options={FACTURE_VAT_RATES.map((r) => ({ value: String(r), label: formatVatRate(r) }))}
          />
          <InputField
            label="Délai de paiement (jours)"
            type="number"
            min={0}
            max={365}
            value={String(f.paymentTermsDays)}
            disabled={!editable}
            onChange={(e) => set({ paymentTermsDays: Number(e.target.value) })}
          />
          <div className="sm:col-span-2">
            <label htmlFor="facture-bank" className="mb-1 block text-sm font-medium">
              Coordonnées bancaires (pied de document)
            </label>
            <textarea
              id="facture-bank"
              rows={2}
              maxLength={400}
              className={TEXTAREA}
              {...text('bankDetails')}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="facture-footer" className="mb-1 block text-sm font-medium">
              Mentions complémentaires (pied de document)
            </label>
            <textarea
              id="facture-footer"
              rows={2}
              maxLength={600}
              className={TEXTAREA}
              {...text('legalFooter')}
            />
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Présentation des documents"
          description="Couleur des titres et tableaux, validité et conditions proposées sur les nouveaux devis."
        />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="facture-accent" className="mb-1 block text-sm font-medium">
              Couleur d’accent
            </label>
            <input
              id="facture-accent"
              type="color"
              value={f.accentColor}
              disabled={!editable}
              onChange={(e) => set({ accentColor: e.target.value })}
              className="h-10 w-20 cursor-pointer rounded-lg border border-line bg-surface disabled:opacity-60"
            />
          </div>
          <InputField
            label="Validité d’un devis (jours)"
            type="number"
            min={1}
            max={365}
            value={String(f.quoteValidityDays)}
            disabled={!editable}
            onChange={(e) => set({ quoteValidityDays: Number(e.target.value) })}
          />
          <div className="sm:col-span-2">
            <label htmlFor="facture-terms" className="mb-1 block text-sm font-medium">
              Conditions générales proposées (modifiables sur chaque document)
            </label>
            <textarea
              id="facture-terms"
              rows={3}
              maxLength={2000}
              className={TEXTAREA}
              {...text('defaultTerms')}
            />
          </div>
        </CardBody>
      </Card>
      {editable && (
        <Button type="submit" loading={saving}>
          Enregistrer
        </Button>
      )}
      <Card>
        <CardHeader title="Logo et aperçu" />
        <CardBody className="flex flex-wrap items-center gap-4">
          {f.hasLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/v1/facture/settings/logo?v=${logoVersion}`}
              alt="Logo de l’entreprise"
              className="h-16 max-w-[12rem] object-contain"
              data-testid="facture-logo"
            />
          ) : (
            <span className="text-sm text-muted">Aucun logo.</span>
          )}
          {editable && f.saved && (
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm font-medium hover:bg-ivory">
              <ImageUp className="h-4 w-4" aria-hidden />
              Choisir un logo (PNG, JPEG ou WebP, 1 Mo)
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(e) => void uploadLogo(e.target.files?.[0])}
              />
            </label>
          )}
          {f.saved ? (
            <a
              href="/api/v1/facture/settings/letterhead.pdf"
              className="inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm font-medium hover:bg-ivory"
              data-testid="facture-letterhead"
            >
              <FileText className="h-4 w-4" aria-hidden />
              Aperçu PDF de l’en-tête
            </a>
          ) : (
            <span className="text-sm text-muted">
              Enregistrez l’identité de l’entreprise pour ajouter un logo et voir l’aperçu.
            </span>
          )}
        </CardBody>
      </Card>
      {f.saved && <ExtraLogos editable={editable} hasMainLogo={f.hasLogo} />}
    </form>
  );
}

interface ExtraLogoView {
  id: string;
  placement: FactureLogoPlacement;
  label: string | null;
}

const PLACEMENTS: { value: FactureLogoPlacement; title: string; description: string }[] = [
  {
    value: 'HEADER',
    title: 'Logos de l’en-tête',
    description: `${FACTURE_LOGO_LIMITS.HEADER} au plus, logo principal compris.`,
  },
  {
    value: 'FOOTER',
    title: 'Logos du bas de page',
    description: `Certifications, marques, produits : ${FACTURE_LOGO_LIMITS.FOOTER} au plus, sur chaque page.`,
  },
  {
    value: 'STAMP',
    title: 'Cachet ou signature',
    description: 'Imprimé dans la case « Le fournisseur ».',
  },
];

/**
 * Logos imprimés sur tous les documents : en-tête (avec le logo principal), bas de page, cachet.
 */
function ExtraLogos({ editable, hasMainLogo }: { editable: boolean; hasMainLogo: boolean }) {
  const logos = useApi<ExtraLogoView[]>('/facture/settings/logos');
  const [error, setError] = useState<ApiError | null>(null);

  async function add(placement: FactureLogoPlacement, file: File | undefined) {
    if (!file) return;
    setError(null);
    const data = new FormData();
    data.append('placement', placement);
    data.append('file', file);
    try {
      await apiUpload('/facture/settings/logos', data);
      logos.reload();
    } catch (e) {
      setError(toError(e));
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api(`/facture/settings/logos/${id}`, { method: 'DELETE' });
      logos.reload();
    } catch (e) {
      setError(toError(e));
    }
  }

  const list = logos.state === 'success' ? logos.data : [];
  return (
    <Card>
      <CardHeader
        title="Logos des documents"
        description="Imprimés sur tous vos devis, factures, bons de commande et rapports."
      />
      <CardBody className="space-y-6">
        <ApiErrorAlert error={error} />
        {logos.state === 'error' && <ErrorState error={logos.error} onRetry={logos.reload} />}
        {PLACEMENTS.map((p) => {
          const own = list.filter((l) => l.placement === p.value);
          const used = own.length + (p.value === 'HEADER' && hasMainLogo ? 1 : 0);
          return (
            <section key={p.value} data-testid={`facture-logos-${p.value}`}>
              <h3 className="text-sm font-semibold">{p.title}</h3>
              <p className="mb-2 text-xs text-muted">{p.description}</p>
              <ul className="flex flex-wrap gap-3">
                {own.length === 0 && <li className="text-sm text-muted">Aucun.</li>}
                {own.map((l) => (
                  <li
                    key={l.id}
                    className="flex flex-col items-center gap-2 rounded-xl border border-line p-3"
                    data-testid="facture-extra-logo"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/v1/facture/settings/logos/${l.id}`}
                      alt={l.label ?? p.title}
                      className="h-12 max-w-[8rem] object-contain"
                    />
                    {editable && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => void remove(l.id)}
                      >
                        Retirer
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              {editable && used < FACTURE_LOGO_LIMITS[p.value] && (
                <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm font-medium hover:bg-ivory">
                  <ImageUp className="h-4 w-4" aria-hidden />
                  Ajouter (PNG, JPEG ou WebP, 1 Mo)
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    data-testid={`facture-logo-input-${p.value}`}
                    onChange={(e) => {
                      void add(p.value, e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </label>
              )}
            </section>
          );
        })}
      </CardBody>
    </Card>
  );
}

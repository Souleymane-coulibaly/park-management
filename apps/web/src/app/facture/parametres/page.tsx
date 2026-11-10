'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { FileText, ImageUp } from 'lucide-react';
import { FACTURE_TAX_REGIME_SUGGESTIONS, FACTURE_VAT_RATES, formatVatRate } from '@ocall/shared';
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
  address: string;
  city: string;
  phone: string | null;
  email: string | null;
  nif: string | null;
  rccm: string | null;
  taxRegime: string | null;
  bankDetails: string | null;
  legalFooter: string | null;
  defaultVatRate: number;
  paymentTermsDays: number;
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
        <Alert tone="info" title="Mentions à compléter avant d’émettre une facture">
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
          <InputField label="Adresse" required maxLength={240} {...text('address')} />
          <InputField label="Ville" required maxLength={80} {...text('city')} />
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
          description="Exigées sur les factures au Mali : à faire valider par votre expert-comptable."
        />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <InputField
            label="Numéro d’identification fiscale (NIF)"
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
    </form>
  );
}

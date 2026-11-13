'use client';

import { type FormEvent, useState } from 'react';
import { STOCK_VAT_RATES } from '@ocall/shared';
import { StockPage } from '@/components/stock/stock-page';
import { asApiError } from '@/components/stock/stock-types';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface SettingsView {
  storeName: string;
  defaultVatRate: number;
  internalCodePrefix: string;
  allowNegativeStock: boolean;
  maxDiscountPercent: number;
  receiptPhone: string | null;
  receiptAddress: string | null;
  receiptFooter: string | null;
  currency: string;
  saved: boolean;
}

/**
 * Réglages Ocall Stock : nom imprimé sur les étiquettes et les tickets, TVA par défaut, préfixe des codes,
 * stock négatif, plafond des remises en caisse, coordonnées et pied des tickets.
 */
export default function StockSettingsPage() {
  return (
    <StockPage
      title="Réglages"
      description="Nom du magasin, TVA proposée, codes internes, caisse et tickets."
    >
      {({ canWrite }) => <Settings manage={canWrite('stock.settings.manage')} />}
    </StockPage>
  );
}

function Settings({ manage }: { manage: boolean }) {
  const settings = useApi<SettingsView>('/ocall-stock/settings');
  if (settings.state === 'loading') return <LoadingState />;
  if (settings.state === 'error')
    return <ErrorState error={settings.error} onRetry={settings.reload} />;
  return (
    <SettingsForm
      key={String(settings.data.saved)}
      initial={settings.data}
      manage={manage}
      onSaved={settings.reload}
    />
  );
}

function SettingsForm({
  initial,
  manage,
  onSaved,
}: {
  initial: SettingsView;
  manage: boolean;
  onSaved: () => void;
}) {
  const [storeName, setStoreName] = useState(initial.storeName);
  const [vat, setVat] = useState(String(initial.defaultVatRate));
  const [prefix, setPrefix] = useState(initial.internalCodePrefix);
  const [allowNegative, setAllowNegative] = useState(initial.allowNegativeStock);
  const [maxDiscount, setMaxDiscount] = useState(String(initial.maxDiscountPercent));
  const [phone, setPhone] = useState(initial.receiptPhone ?? '');
  const [address, setAddress] = useState(initial.receiptAddress ?? '');
  const [footer, setFooter] = useState(initial.receiptFooter ?? '');
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setDone(false);
    try {
      await api('/ocall-stock/settings', {
        method: 'PUT',
        body: {
          storeName,
          defaultVatRate: Number(vat),
          internalCodePrefix: prefix,
          allowNegativeStock: allowNegative,
          maxDiscountPercent: Number(maxDiscount),
          receiptPhone: phone,
          receiptAddress: address,
          receiptFooter: footer,
        },
      });
      setDone(true);
      onSaved();
    } catch (e) {
      setError(asApiError(e));
    }
  }

  return (
    <Card>
      <CardHeader title="Magasin" description={`Devise de l’organisation : ${initial.currency}.`} />
      <CardBody>
        <form onSubmit={submit} className="space-y-4" data-testid="stock-settings-form">
          <ApiErrorAlert error={error} />
          {done && <Alert tone="success" title="Réglages enregistrés." />}
          {!initial.saved && (
            <Alert tone="info" title="Valeurs proposées">
              Enregistrez ces réglages pour les confirmer.
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <InputField
              label="Nom imprimé sur les étiquettes et les tickets"
              required
              disabled={!manage}
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
            />
            <SelectField
              label="TVA proposée"
              disabled={!manage}
              value={vat}
              onChange={(e) => setVat(e.target.value)}
              options={STOCK_VAT_RATES.map((r) => ({
                value: String(r),
                label: r === 0 ? 'Exonéré (0 %)' : `${r} %`,
              }))}
            />
            <InputField
              label="Préfixe des codes (2 à 4 lettres)"
              required
              disabled={!manage}
              value={prefix}
              hint="Exemple : OC donne les références OC-000001 et les codes internes OC00000001."
              onChange={(e) => setPrefix(e.target.value.toUpperCase())}
            />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              disabled={!manage}
              checked={allowNegative}
              onChange={(e) => setAllowNegative(e.target.checked)}
            />
            <span>
              Autoriser le stock négatif
              <span className="block text-xs text-muted">
                Une sortie au-delà du stock est alors acceptée (par exemple quand les entrées sont
                saisies en retard). Refusé par défaut.
              </span>
            </span>
          </label>
          <div className="border-t border-line pt-4">
            <p className="text-sm font-semibold">Caisse et tickets</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <InputField
                label="Remise maximale en caisse (%)"
                type="number"
                min={0}
                max={100}
                required
                disabled={!manage}
                value={maxDiscount}
                hint="Plafond par ligne pour les membres autorisés à accorder des remises ; le droit « remises sans plafond » permet de le dépasser."
                onChange={(e) => setMaxDiscount(e.target.value)}
              />
              <InputField
                label="Téléphone sur les tickets"
                disabled={!manage}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <InputField
                label="Adresse sur les tickets"
                disabled={!manage}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
              <InputField
                label="Pied de ticket"
                disabled={!manage}
                value={footer}
                hint="Par défaut : « Merci de votre visite ! »"
                onChange={(e) => setFooter(e.target.value)}
              />
            </div>
          </div>
          {manage && <Button type="submit">Enregistrer</Button>}
        </form>
      </CardBody>
    </Card>
  );
}

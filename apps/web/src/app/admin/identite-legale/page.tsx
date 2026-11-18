'use client';

import { type FormEvent, useState } from 'react';
import {
  OCALL_INVOICE_REQUIRED_FIELDS,
  OCALL_LEGAL_FIELDS,
  OCALL_LEGAL_FIELD_LABELS,
  OCALL_LEGAL_FIELD_MAX_LENGTH,
  OCALL_PRIVATE_LEGAL_FIELDS,
  type OcallLegalField,
  type OcallLegalIdentity,
} from '@ocall/shared';
import { useCanPlatform } from '@/components/app/session-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { PlatformLegalIdentityView } from '@/lib/types';
import { useApi } from '@/lib/use-api';

const GROUPS: { title: string; description: string; fields: OcallLegalField[] }[] = [
  {
    title: 'Entreprise',
    description:
      'Identité de l’éditeur, imprimée sur les factures et publiée dans les mentions légales.',
    fields: ['legalName', 'tradeName', 'legalForm', 'shareCapital', 'rccm', 'nif', 'taxRegime'],
  },
  {
    title: 'Siège et contacts',
    description: 'Publiés sur les pages Mentions légales, Contact et Confidentialité.',
    fields: ['address', 'city', 'country', 'phone', 'whatsapp', 'email', 'privacyEmail'],
  },
  {
    title: 'Site et règlements',
    description:
      'Les coordonnées bancaires figurent seulement sur les factures, jamais sur le site.',
    fields: ['publicationDirector', 'hostingProvider', 'bankDetails'],
  },
];

/**
 * Identité légale de l'éditeur Ocall (commercialisation J2). Rien n'est prérempli ni inventé : chaque
 * information est saisie par Ocall. Les mentions obligatoires conditionnent les factures définitives ;
 * une facture déjà émise garde l'identité de son émission.
 */
export default function LegalIdentityPage() {
  const view = useApi<PlatformLegalIdentityView>('/platform/legal-identity');
  const [saved, setSaved] = useState(false);
  return (
    <>
      <PageHeader
        eyebrow="Ocall Suite"
        title="Identité légale Ocall"
        description="Informations de l’éditeur pour les pages légales du site et les factures et reçus d’abonnement. Aucune valeur n’est préremplie."
      />
      {saved && (
        <div className="mb-4">
          <Alert tone="success">Identité enregistrée.</Alert>
        </div>
      )}
      {view.state === 'loading' && <LoadingState />}
      {view.state === 'error' && <ErrorState error={view.error} onRetry={view.reload} />}
      {view.state === 'success' && (
        <LegalIdentityForm
          key={view.data.updatedAt ?? 'empty'}
          view={view.data}
          onEdit={() => setSaved(false)}
          onSaved={() => {
            setSaved(true);
            view.reload();
          }}
        />
      )}
    </>
  );
}

function LegalIdentityForm({
  view,
  onEdit,
  onSaved,
}: {
  view: PlatformLegalIdentityView;
  onEdit: () => void;
  onSaved: () => void;
}) {
  const canEdit = useCanPlatform('platform.legal.manage');
  const [values, setValues] = useState<Record<OcallLegalField, string>>(
    () =>
      Object.fromEntries(OCALL_LEGAL_FIELDS.map((f) => [f, view.identity[f] ?? ''])) as Record<
        OcallLegalField,
        string
      >,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const changed = Object.fromEntries(
        OCALL_LEGAL_FIELDS.filter((f) => values[f].trim() !== (view.identity[f] ?? '')).map((f) => [
          f,
          values[f],
        ]),
      ) as Partial<OcallLegalIdentity>;
      await api('/platform/legal-identity', { method: 'PUT', body: changed });
      onSaved();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6" data-testid="legal-identity-form">
      {view.invoicesDefinitive ? (
        <Alert tone="success" title="Factures définitives">
          Les mentions obligatoires sont renseignées : chaque nouvelle facture d’abonnement est
          définitive et garde l’identité de son émission.
        </Alert>
      ) : (
        <div data-testid="legal-identity-missing">
          <Alert tone="error" title="Factures provisoires tant que l’identité est incomplète">
            À renseigner avant toute facture définitive :{' '}
            {view.missingForInvoices.map((f) => OCALL_LEGAL_FIELD_LABELS[f]).join(', ')}.
          </Alert>
        </div>
      )}
      <ApiErrorAlert error={error} />
      <div className="grid gap-6 lg:grid-cols-2">
        {GROUPS.map((group) => (
          <Card key={group.title}>
            <CardHeader title={group.title} description={group.description} />
            <CardBody>
              <div className="grid grid-cols-1 gap-3">
                {group.fields.map((f) => (
                  <InputField
                    key={f}
                    name={f}
                    label={OCALL_LEGAL_FIELD_LABELS[f]}
                    hint={
                      OCALL_INVOICE_REQUIRED_FIELDS.includes(f)
                        ? 'Obligatoire pour une facture définitive'
                        : OCALL_PRIVATE_LEGAL_FIELDS.includes(f)
                          ? 'Jamais publié sur le site'
                          : undefined
                    }
                    value={values[f]}
                    maxLength={OCALL_LEGAL_FIELD_MAX_LENGTH}
                    disabled={!canEdit}
                    onChange={(e) => {
                      onEdit();
                      setValues((v) => ({ ...v, [f]: e.target.value }));
                    }}
                  />
                ))}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {canEdit ? (
          <Button type="submit" loading={saving}>
            Enregistrer
          </Button>
        ) : (
          <Badge tone="neutral">Lecture seule : modification réservée au propriétaire</Badge>
        )}
        {view.updatedAt && (
          <span className="text-xs text-muted">
            Dernière modification le {formatDate(view.updatedAt)}
          </span>
        )}
      </div>
    </form>
  );
}

'use client';

import Link from 'next/link';
import { Building2, CheckCircle2, Users } from 'lucide-react';
import { FacturePage } from '@/components/facture/facture-page';
import { Alert } from '@/components/ui/states';
import { Card, CardBody } from '@/components/ui/card';

/**
 * Tableau de bord Ocall Facture (socle F0) : état de la configuration légale avant la facturation.
 * Clients, devis, factures et interventions arrivent aux sprints suivants.
 */
export default function FactureHomePage() {
  return (
    <FacturePage
      title="Tableau de bord"
      description="Configurez l’identité de votre entreprise : elle figure sur tous vos documents."
    >
      {({ context }) => (
        <>
          <p className="text-sm text-muted" data-testid="facture-role">
            Connecté en tant que <strong>{context.roleLabel}</strong>.
          </p>
          {context.legalMissing.length > 0 ? (
            <div data-testid="facture-legal-missing">
              <Alert tone="info" title="Mentions à compléter avant d’émettre une facture">
                {context.legalMissing.join(', ')}.{' '}
                <Link href="/facture/parametres" className="font-semibold underline">
                  Compléter l’identité de l’entreprise
                </Link>
              </Alert>
            </div>
          ) : (
            <div data-testid="facture-legal-ready">
              <Alert tone="success" title="Identité légale complète">
                Les mentions exigées pour facturer sont renseignées.
              </Alert>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardBody>
                <Link href="/facture/parametres" className="flex items-start gap-3">
                  <Building2 className="mt-0.5 h-5 w-5 text-forest" aria-hidden />
                  <span>
                    <span className="block font-semibold">Entreprise et mentions</span>
                    <span className="text-sm text-muted">
                      Raison sociale, NIF, régime d’imposition, TVA par défaut, logo.
                    </span>
                  </span>
                </Link>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <Link href="/facture/equipe" className="flex items-start gap-3">
                  <Users className="mt-0.5 h-5 w-5 text-forest" aria-hidden />
                  <span>
                    <span className="block font-semibold">Équipe</span>
                    <span className="text-sm text-muted">
                      Gérants, commerciaux, comptables et techniciens.
                    </span>
                  </span>
                </Link>
              </CardBody>
            </Card>
          </div>
          {context.settingsReady && context.legalMissing.length === 0 && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <CheckCircle2 className="h-4 w-4 text-forest" aria-hidden />
              Clients, devis, factures et interventions seront disponibles dans les prochaines
              versions.
            </p>
          )}
        </>
      )}
    </FacturePage>
  );
}

'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { FacturePermission, FactureRole, ProductAccess } from '@ocall/shared';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

export interface FactureContextView {
  organization: { id: string; name: string };
  access: ProductAccess;
  role: FactureRole;
  roleLabel: string;
  permissions: FacturePermission[];
  settingsReady: boolean;
  legalMissing: string[];
}

/**
 * Page Ocall Facture : charge le contexte décidé par l'API (droit, rôle, permissions) et l'expose à son
 * contenu. `canWrite` tient compte de la lecture seule (essai échu, abonnement suspendu ou expiré).
 */
export function FacturePage({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: (props: {
    context: FactureContextView;
    canWrite: (permission: FacturePermission) => boolean;
    reload: () => void;
  }) => ReactNode;
}) {
  const context = useApi<FactureContextView>('/facture/context');
  return (
    <>
      <PageHeader eyebrow="Ocall Facture" title={title} description={description} />
      {context.state === 'loading' && <LoadingState />}
      {context.state === 'error' &&
        (context.error.code === 'PRODUCT_NOT_ENABLED' ? (
          <Alert tone="info" title="Ocall Facture n’est pas activé pour votre organisation">
            Démarrez l’essai gratuit ou demandez l’activation depuis{' '}
            <Link href="/suite" className="font-semibold underline">
              Mes applications
            </Link>
            .
          </Alert>
        ) : (
          <ErrorState error={context.error} onRetry={context.reload} />
        ))}
      {context.state === 'success' && (
        <div className="space-y-6">
          {context.data.access === 'read_only' && (
            <Alert tone="info" title="Consultation seulement">
              Votre essai ou votre abonnement Ocall Facture est échu : vos données restent
              consultables, aucune modification n’est possible.
            </Alert>
          )}
          {children({
            context: context.data,
            canWrite: (permission) =>
              context.data.access === 'full' && context.data.permissions.includes(permission),
            reload: context.reload,
          })}
        </div>
      )}
    </>
  );
}

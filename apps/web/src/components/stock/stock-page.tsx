'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ProductAccess, StockPermission, StockRole } from '@ocall/shared';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

export interface StockContextView {
  organization: { id: string; name: string };
  currency: string;
  access: ProductAccess;
  role: StockRole;
  roleLabel: string;
  permissions: StockPermission[];
}

export interface StockPageProps {
  context: StockContextView;
  /** Vrai si le membre a la permission et que l'abonnement permet d'écrire (pas en consultation seule). */
  canWrite: (permission: StockPermission) => boolean;
  can: (permission: StockPermission) => boolean;
  reload: () => void;
}

/**
 * Page Ocall Stock : charge le contexte décidé par l'API (droit, rôle, permissions effectives) et l'expose
 * à son contenu. Les droits réels sont toujours contrôlés par l'API.
 */
export function StockPage({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: (props: StockPageProps) => ReactNode;
}) {
  const context = useApi<StockContextView>('/ocall-stock/context');
  return (
    <>
      <PageHeader eyebrow="Ocall Stock" title={title} description={description} action={action} />
      {context.state === 'loading' && <LoadingState />}
      {context.state === 'error' &&
        (context.error.code === 'PRODUCT_NOT_ENABLED' ? (
          <Alert tone="info" title="Ocall Stock n’est pas activé pour votre organisation">
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
              Votre essai ou votre abonnement Ocall Stock est échu : vos données restent
              consultables, aucune modification n’est possible.
            </Alert>
          )}
          {children({
            context: context.data,
            can: (permission) => context.data.permissions.includes(permission),
            canWrite: (permission) =>
              context.data.access === 'full' && context.data.permissions.includes(permission),
            reload: context.reload,
          })}
        </div>
      )}
    </>
  );
}

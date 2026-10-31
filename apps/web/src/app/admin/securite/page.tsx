'use client';

import { ShieldCheck } from 'lucide-react';
import { PLATFORM_ROLE_LABELS, effectivePlatformRole } from '@ocall/shared';
import { useSession } from '@/components/app/session-context';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';

/** Sécurité du compte interne connecté : rôle, permissions et état de la double authentification. */
export default function AccountSecurityPage() {
  const me = useSession();
  const role = effectivePlatformRole(me.user.platformRole);
  return (
    <>
      <PageHeader
        eyebrow="Ocall Suite"
        title="Sécurité du compte"
        description={`${me.user.firstName} ${me.user.lastName} · ${me.user.email ?? me.user.loginId}`}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Double authentification" />
          <CardBody>
            <p className="flex items-center gap-2 text-sm">
              <ShieldCheck className="h-5 w-5 text-forest" aria-hidden />
              {me.mfa.enrolled ? (
                <Badge tone="forest">Activée</Badge>
              ) : (
                <Badge tone="savanna">Non activée</Badge>
              )}
              {me.mfa.required && <span className="text-muted">obligatoire pour votre rôle</span>}
            </p>
            <p className="mt-3 text-sm text-muted">
              Téléphone perdu : utilisez un code de secours, puis demandez au propriétaire de la
              plateforme de réinitialiser votre double authentification. Le propriétaire passe par
              la procédure serveur (pnpm db:reset-mfa).
            </p>
            {!me.mfa.enrolled && (
              <div className="mt-4">
                <ButtonLink href="/double-authentification">
                  Activer la double authentification
                </ButtonLink>
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Rôle et permissions"
            description={role ? PLATFORM_ROLE_LABELS[role] : undefined}
          />
          <CardBody>
            <ul className="flex flex-wrap gap-2">
              {me.platformPermissions.map((p) => (
                <li key={p}>
                  <Badge>{p}</Badge>
                </li>
              ))}
            </ul>
            <div className="mt-4">
              <ButtonLink href="/changer-mot-de-passe" variant="secondary">
                Changer mon mot de passe
              </ButtonLink>
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

import { ShieldOff } from 'lucide-react';
import { ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';

/** Affiché lorsqu'un rôle ouvre une page qui ne lui est pas destinée (l'API refuse aussi l'accès). */
export function AccessDenied() {
  return (
    <Card>
      <EmptyState
        icon={<ShieldOff className="h-7 w-7" />}
        title="Accès refusé"
        description="Votre rôle ne permet pas d’accéder à cette page. Contactez le propriétaire de votre établissement si vous pensez qu’il s’agit d’une erreur."
        action={
          <ButtonLink href="/app" variant="secondary">
            Retour au tableau de bord
          </ButtonLink>
        }
      />
    </Card>
  );
}

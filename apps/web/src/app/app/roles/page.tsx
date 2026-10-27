'use client';

import { Check, Minus } from 'lucide-react';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan } from '@/components/app/session-context';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingState } from '@/components/ui/states';
import type { RoleMatrix } from '@/lib/types';
import { useApi } from '@/lib/use-api';

export default function RolesPage() {
  const canRead = useCan('role.read');
  const matrix = useApi<RoleMatrix>(canRead ? '/roles' : null);

  if (!canRead) return <AccessDenied />;
  return (
    <>
      <PageHeader
        title="Rôles et permissions"
        description="Chaque employé reçoit un rôle. Les permissions sont appliquées par le serveur à chaque action. L’attribution des rôles se fait depuis la page Employés."
      />
      {matrix.state === 'loading' && <LoadingState />}
      {matrix.state === 'error' && <ErrorState error={matrix.error} onRetry={matrix.reload} />}
      {matrix.state === 'success' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-line bg-ivory/60">
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted"
                  >
                    Permission
                  </th>
                  {matrix.data.roles.map((r) => (
                    <th key={r.role} scope="col" className="px-3 py-3 text-center">
                      <span className="block text-xs font-semibold">{r.label}</span>
                      {r.assignable && (
                        <span className="mt-1 inline-block">
                          <Badge tone="forest">Attribuable</Badge>
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {matrix.data.permissions.map((p) => (
                  <tr key={p.key}>
                    <th scope="row" className="px-6 py-3 text-left font-medium">
                      {p.label}
                    </th>
                    {matrix.data.roles.map((r) => (
                      <td key={r.role} className="px-3 py-3 text-center">
                        {r.permissions.includes(p.key) ? (
                          <Check className="mx-auto h-4 w-4 text-forest" aria-label="Autorisé" />
                        ) : (
                          <Minus className="mx-auto h-4 w-4 text-line" aria-label="Non autorisé" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CardBody className="border-t border-line/70 text-sm text-muted">
            Les superviseurs ne voient que les établissements auxquels ils sont affectés. Un
            administrateur ne peut ni créer ni modifier un propriétaire. L’organisation conserve
            toujours au moins un propriétaire actif.
          </CardBody>
        </Card>
      )}
    </>
  );
}

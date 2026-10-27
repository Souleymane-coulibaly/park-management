'use client';

import { type FormEvent, useState } from 'react';
import { Copy, KeyRound, Pencil, Power, UserPlus, Users } from 'lucide-react';
import {
  type MemberRole,
  ROLE_LABELS,
  assignableRoles,
  canManageRole,
  hasOrganizationWideScope,
  isRoleAvailableFor,
} from '@ocall/shared';
import { AccessDenied } from '@/components/app/access-denied';
import { useCan, useSession } from '@/components/app/session-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { CheckboxGroup, InputField, SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { ApiError, api } from '@/lib/api';
import { formatDateTime, initials } from '@/lib/format';
import type { Employee, Establishment } from '@/lib/types';
import { useApi } from '@/lib/use-api';

interface Credentials {
  name: string;
  loginId: string;
  temporaryPassword: string;
}

export default function EmployesPage() {
  const me = useSession();
  const canRead = useCan('employee.read');
  const canManage = useCan('employee.manage');
  const list = useApi<Employee[]>(canRead ? '/employees' : null);
  const establishments = useApi<Establishment[]>(canManage ? '/establishments' : null);
  const [dialog, setDialog] = useState<
    { mode: 'create' } | { mode: 'edit'; employee: Employee } | null
  >(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);

  if (!canRead) return <AccessDenied />;
  const actorRole = me.role as MemberRole;

  async function run(action: () => Promise<void>) {
    setActionError(null);
    try {
      await action();
      list.reload();
    } catch (e) {
      setActionError(e instanceof ApiError ? e : null);
    }
  }

  const resetPassword = (e: Employee) =>
    run(async () => {
      if (
        !window.confirm(
          `Réinitialiser le mot de passe de ${e.firstName} ${e.lastName} ? Ses sessions seront fermées.`,
        )
      )
        return;
      const res = await api<{ temporaryPassword: string }>(`/employees/${e.id}/reset-password`, {
        method: 'POST',
      });
      setCredentials({
        name: `${e.firstName} ${e.lastName}`,
        loginId: e.loginId,
        temporaryPassword: res.temporaryPassword,
      });
    });

  const toggle = (e: Employee) =>
    run(async () => {
      if (
        e.isActive &&
        !window.confirm(
          `Désactiver le compte de ${e.firstName} ${e.lastName} ? Ses sessions seront fermées immédiatement.`,
        )
      )
        return;
      await api(`/employees/${e.id}/${e.isActive ? 'deactivate' : 'reactivate'}`, {
        method: 'POST',
      });
    });

  const addButton = canManage && (
    // Attendre les établissements : le formulaire présélectionne le site unique et exige une affectation.
    <Button
      onClick={() => setDialog({ mode: 'create' })}
      disabled={establishments.state !== 'success'}
      icon={<UserPlus className="h-4 w-4" />}
    >
      Nouvel employé
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Employés"
        description="Comptes nominatifs, rôles et établissements autorisés."
        action={addButton}
      />
      <div className="mb-4">
        <ApiErrorAlert error={actionError} />
      </div>
      <Card>
        {list.state === 'loading' && <LoadingState />}
        {list.state === 'error' && <ErrorState error={list.error} onRetry={list.reload} />}
        {list.state === 'success' && list.data.length === 0 && (
          <EmptyState
            icon={<Users className="h-7 w-7" />}
            title="Aucun employé visible"
            description="Les employés de vos établissements apparaîtront ici."
            action={addButton}
          />
        )}
        {list.state === 'success' && list.data.length > 0 && (
          <Table
            head={[
              'Employé',
              'Identifiant',
              'Rôle',
              'Établissements',
              'Dernière connexion',
              'Statut',
              '',
            ]}
          >
            {list.data.map((e) => {
              const manageable = canManage && canManageRole(actorRole, e.role);
              const isSelf = e.userId === me.user.id;
              return (
                <tr key={e.id} className={e.isActive ? '' : 'opacity-60'}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-savanna-light text-xs font-bold text-charcoal">
                        {initials(e.firstName, e.lastName)}
                      </span>
                      <div className="min-w-0">
                        <p className="font-semibold">
                          {e.firstName} {e.lastName}{' '}
                          {isSelf && <span className="text-xs font-normal text-muted">(vous)</span>}
                        </p>
                        {e.email && <p className="truncate text-xs text-muted">{e.email}</p>}
                      </div>
                    </div>
                  </Td>
                  <Td className="font-mono text-xs">{e.loginId}</Td>
                  <Td>
                    <Badge
                      tone={
                        e.role === 'OWNER' ? 'savanna' : e.role === 'ADMIN' ? 'forest' : 'neutral'
                      }
                    >
                      {ROLE_LABELS[e.role]}
                    </Badge>
                  </Td>
                  <Td className="text-muted">
                    {hasOrganizationWideScope(e.role)
                      ? 'Tous'
                      : e.establishments.map((s) => s.name).join(', ') || '—'}
                  </Td>
                  <Td className="text-muted">
                    {e.mustChangePassword ? (
                      <Badge tone="terracotta">Mot de passe à changer</Badge>
                    ) : (
                      formatDateTime(e.lastLoginAt)
                    )}
                  </Td>
                  <Td>
                    {e.isActive ? <Badge tone="forest">Actif</Badge> : <Badge>Désactivé</Badge>}
                  </Td>
                  <Td>
                    {manageable && (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDialog({ mode: 'edit', employee: e })}
                          icon={<Pencil className="h-4 w-4" />}
                          aria-label={`Modifier ${e.firstName} ${e.lastName}`}
                        />
                        {!isSelf && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => resetPassword(e)}
                              icon={<KeyRound className="h-4 w-4" />}
                              aria-label={`Réinitialiser le mot de passe de ${e.firstName} ${e.lastName}`}
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggle(e)}
                              icon={<Power className="h-4 w-4" />}
                              aria-label={`${e.isActive ? 'Désactiver' : 'Réactiver'} ${e.firstName} ${e.lastName}`}
                            />
                          </>
                        )}
                      </div>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      {dialog && (
        <EmployeeDialog
          employee={dialog.mode === 'edit' ? dialog.employee : null}
          establishments={
            establishments.state === 'success' ? establishments.data.filter((s) => s.isActive) : []
          }
          onClose={() => setDialog(null)}
          onSaved={(created) => {
            setDialog(null);
            if (created) setCredentials(created);
            list.reload();
          }}
        />
      )}
      {credentials && (
        <CredentialsDialog credentials={credentials} onClose={() => setCredentials(null)} />
      )}
    </>
  );
}

function EmployeeDialog({
  employee,
  establishments,
  onClose,
  onSaved,
}: {
  employee: Employee | null;
  establishments: Establishment[];
  onClose: () => void;
  onSaved: (created: Credentials | null) => void;
}) {
  const me = useSession();
  const canAssignRoles = useCan('role.assign');
  const actorRole = me.role as MemberRole;
  const isSelf = employee?.userId === me.user.id;
  const roles = assignableRoles(actorRole).filter((r) =>
    isRoleAvailableFor(r, me.organization!.businessType),
  );
  const [form, setForm] = useState({
    firstName: employee?.firstName ?? '',
    lastName: employee?.lastName ?? '',
    email: employee?.email ?? '',
    role: (employee?.role ?? roles.find((r) => r === 'CASHIER') ?? roles[0]) as MemberRole,
    establishmentIds:
      employee?.establishments.map((s) => s.id) ??
      (establishments.length === 1 ? [establishments[0]!.id] : []),
  });
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const set =
    (key: 'firstName' | 'lastName' | 'email' | 'role') => (e: { target: { value: string } }) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  const needsAssignment = !hasOrganizationWideScope(form.role);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (!employee) {
        const res = await api<{ employee: Employee; temporaryPassword: string }>('/employees', {
          method: 'POST',
          body: form,
        });
        onSaved({
          name: `${res.employee.firstName} ${res.employee.lastName}`,
          loginId: res.employee.loginId,
          temporaryPassword: res.temporaryPassword,
        });
        return;
      }
      await api(`/employees/${employee.id}`, {
        method: 'PATCH',
        body: { firstName: form.firstName, lastName: form.lastName, email: form.email },
      });
      if (!isSelf && canAssignRoles && form.role !== employee.role) {
        await api(`/employees/${employee.id}/role`, { method: 'PUT', body: { role: form.role } });
      }
      const before = employee.establishments
        .map((s) => s.id)
        .sort()
        .join();
      if (form.establishmentIds.slice().sort().join() !== before) {
        await api(`/employees/${employee.id}/establishments`, {
          method: 'PUT',
          body: { establishmentIds: form.establishmentIds },
        });
      }
      onSaved(null);
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
      setLoading(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={employee ? 'Modifier l’employé' : 'Nouvel employé'}
      description={
        employee
          ? `Identifiant ${employee.loginId}`
          : 'Un identifiant personnel et un mot de passe temporaire seront générés.'
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <ApiErrorAlert error={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <InputField label="Prénom" value={form.firstName} onChange={set('firstName')} required />
          <InputField label="Nom" value={form.lastName} onChange={set('lastName')} required />
        </div>
        <InputField
          label="E-mail (facultatif)"
          type="email"
          value={form.email}
          onChange={set('email')}
          hint="Permet à l’employé de réinitialiser seul son mot de passe."
        />
        {(!employee || (canAssignRoles && !isSelf)) && (
          <SelectField
            label="Rôle"
            value={form.role}
            onChange={set('role')}
            options={roles.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
            required
          />
        )}
        {establishments.length > 0 ? (
          <CheckboxGroup
            legend="Établissements autorisés"
            hint={
              needsAssignment
                ? 'Au moins un établissement est requis pour ce rôle.'
                : 'Ce rôle a accès à toute l’organisation.'
            }
            options={establishments.map((s) => ({ value: s.id, label: s.name }))}
            value={form.establishmentIds}
            onChange={(establishmentIds) => setForm((f) => ({ ...f, establishmentIds }))}
          />
        ) : (
          <Alert tone="info">
            Créez d’abord un établissement actif pour y affecter des employés.
          </Alert>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            type="submit"
            loading={loading}
            disabled={needsAssignment && form.establishmentIds.length === 0}
          >
            {employee ? 'Enregistrer' : 'Créer le compte'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Le mot de passe temporaire n'est affiché qu'une seule fois : il n'est stocké nulle part en clair. */
function CredentialsDialog({
  credentials,
  onClose,
}: {
  credentials: Credentials;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const text = `Identifiant : ${credentials.loginId}\nMot de passe temporaire : ${credentials.temporaryPassword}`;
  return (
    <Dialog open onClose={onClose} title="Identifiants de connexion" description={credentials.name}>
      <div className="space-y-4">
        <Alert tone="info" title="À transmettre en main propre">
          Ce mot de passe ne sera plus jamais affiché. L’employé devra le changer à sa première
          connexion.
        </Alert>
        <dl className="space-y-3 rounded-xl border border-line bg-ivory/60 p-4">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Identifiant</dt>
            <dd className="font-mono text-lg font-semibold">{credentials.loginId}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Mot de passe temporaire</dt>
            <dd
              className="break-all font-mono text-lg font-semibold"
              data-testid="temporary-password"
            >
              {credentials.temporaryPassword}
            </dd>
          </div>
        </dl>
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            icon={<Copy className="h-4 w-4" />}
            onClick={async () => {
              await navigator.clipboard.writeText(text).catch(() => undefined);
              setCopied(true);
            }}
          >
            {copied ? 'Copié' : 'Copier'}
          </Button>
          <Button onClick={onClose}>J’ai transmis les identifiants</Button>
        </div>
      </div>
    </Dialog>
  );
}

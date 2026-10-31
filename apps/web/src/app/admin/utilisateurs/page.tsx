'use client';

import { type FormEvent, useState } from 'react';
import { KeyRound, Plus, Power, UserCog } from 'lucide-react';
import {
  PLATFORM_ROLE_LABELS,
  type PlatformRoleName,
  assignablePlatformRoles,
  platformRoleRequiresMfa,
} from '@ocall/shared';
import { useSession } from '@/components/app/session-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField, SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { ApiError, api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { InternalUser } from '@/lib/types';
import { useApi } from '@/lib/use-api';

/**
 * Comptes internes Ocall (propriétaire uniquement) : nominatifs, rôle unique, MFA obligatoire pour
 * les rôles sensibles. Le compte propriétaire et son propre compte ne se gèrent pas ici.
 */
export default function InternalUsersPage() {
  const me = useSession();
  const roles = assignablePlatformRoles(me.user.platformRole);
  const users = useApi<InternalUser[]>('/platform/users');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ email: string; temporaryPassword: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function act(
    u: InternalUser,
    path: string,
    body: unknown,
    message: string,
    confirm?: string,
  ) {
    if (confirm && !window.confirm(confirm)) return;
    setError(null);
    setNotice(null);
    try {
      await api(`/platform/users/${u.id}/${path}`, {
        method: path === 'role' ? 'PATCH' : 'POST',
        body,
      });
      setNotice(message);
      users.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Ocall Suite"
        title="Comptes internes"
        description="Équipe Ocall : un compte nominatif par personne, un rôle chacun. Toute modification déconnecte la personne concernée."
        action={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            Nouveau compte
          </Button>
        }
      />
      <div className="mb-4 space-y-3">
        {created && (
          <Alert
            tone="success"
            title="Compte créé — mot de passe temporaire affiché une seule fois"
          >
            <p>
              {created.email} : <code className="font-mono">{created.temporaryPassword}</code>
            </p>
            <p>À transmettre de façon sûre. Changement imposé à la première connexion.</p>
          </Alert>
        )}
        {notice && <Alert tone="success">{notice}</Alert>}
        <ApiErrorAlert error={error} />
      </div>
      <Card>
        {users.state === 'loading' && <LoadingState />}
        {users.state === 'error' && <ErrorState error={users.error} onRetry={users.reload} />}
        {users.state === 'success' &&
          (users.data.length === 0 ? (
            <EmptyState
              icon={<UserCog className="h-7 w-7" />}
              title="Aucun compte interne"
              description="Créez les comptes nominatifs de l’équipe Ocall."
            />
          ) : (
            <Table head={['Personne', 'Rôle', 'Double authentification', 'Dernière connexion', '']}>
              {users.data.map((u) => {
                const manageable = u.id !== me.user.id && u.role !== 'PLATFORM_OWNER';
                return (
                  <tr key={u.id} data-testid="internal-user-row">
                    <Td>
                      <p className="font-semibold">
                        {u.firstName} {u.lastName}
                      </p>
                      <p className="text-xs text-muted">{u.email ?? u.loginId}</p>
                      {!u.isActive && <Badge tone="terracotta">Désactivé</Badge>}
                    </Td>
                    <Td>
                      {manageable ? (
                        <div className="w-56">
                          <SelectField
                            label="Rôle"
                            value={u.role ?? ''}
                            onChange={(e) =>
                              act(u, 'role', { role: e.target.value }, 'Rôle modifié.')
                            }
                            options={roles.map((r) => ({
                              value: r,
                              label: PLATFORM_ROLE_LABELS[r],
                            }))}
                          />
                        </div>
                      ) : (
                        u.role && PLATFORM_ROLE_LABELS[u.role]
                      )}
                    </Td>
                    <Td>
                      {u.mfaEnabled ? (
                        <Badge tone="forest">Activée</Badge>
                      ) : platformRoleRequiresMfa(u.role) ? (
                        <Badge tone="savanna">À configurer (obligatoire)</Badge>
                      ) : (
                        <Badge>Non activée</Badge>
                      )}
                    </Td>
                    <Td>{formatDateTime(u.lastLoginAt)}</Td>
                    <Td>
                      {manageable && (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<Power className="h-4 w-4" />}
                            onClick={() =>
                              u.isActive
                                ? act(
                                    u,
                                    'deactivate',
                                    {},
                                    'Compte désactivé.',
                                    `Désactiver ${u.firstName} ${u.lastName} ?`,
                                  )
                                : act(u, 'reactivate', {}, 'Compte réactivé.')
                            }
                          >
                            {u.isActive ? 'Désactiver' : 'Réactiver'}
                          </Button>
                          {u.mfaEnabled && (
                            <Button
                              size="sm"
                              variant="secondary"
                              icon={<KeyRound className="h-4 w-4" />}
                              onClick={() =>
                                act(
                                  u,
                                  'reset-mfa',
                                  {},
                                  'Double authentification réinitialisée : reconfiguration à la prochaine connexion.',
                                  `Réinitialiser la double authentification de ${u.firstName} ${u.lastName} ? (téléphone perdu, identité vérifiée)`,
                                )
                              }
                            >
                              Réinitialiser la MFA
                            </Button>
                          )}
                        </div>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          ))}
      </Card>
      <CreateDialog
        open={creating}
        roles={roles}
        onClose={() => setCreating(false)}
        onCreated={(res) => {
          setCreating(false);
          setCreated(res);
          users.reload();
        }}
      />
    </>
  );
}

function CreateDialog({
  open,
  roles,
  onClose,
  onCreated,
}: {
  open: boolean;
  roles: PlatformRoleName[];
  onClose: () => void;
  onCreated: (res: { email: string; temporaryPassword: string }) => void;
}) {
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    role: 'SUPPORT_AGENT',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ user: { email: string }; temporaryPassword: string }>(
        '/platform/users',
        {
          method: 'POST',
          body: { ...form, email: form.email.trim().toLowerCase() },
        },
      );
      onCreated({ email: res.user.email, temporaryPassword: res.temporaryPassword });
      setForm({ firstName: '', lastName: '', email: '', role: 'SUPPORT_AGENT' });
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Nouveau compte interne"
      description="Compte nominatif d'un membre de l'équipe Ocall."
    >
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <InputField
            label="Prénom"
            required
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
          />
          <InputField
            label="Nom"
            required
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
          />
        </div>
        <InputField
          label="E-mail"
          type="email"
          required
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <SelectField
          label="Rôle"
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value })}
          options={roles.map((r) => ({ value: r, label: PLATFORM_ROLE_LABELS[r] }))}
        />
        {platformRoleRequiresMfa(form.role as PlatformRoleName) && (
          <p className="text-sm text-muted">
            Ce rôle impose la double authentification dès la première connexion.
          </p>
        )}
        <ApiErrorAlert error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" loading={saving}>
            Créer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

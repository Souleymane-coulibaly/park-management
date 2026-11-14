'use client';

import { useState } from 'react';
import {
  STOCK_ADJUSTABLE_PERMISSIONS,
  STOCK_PERMISSION_LABELS,
  STOCK_ROLES,
  STOCK_ROLE_LABELS,
  STOCK_SITE_ROLES,
  type StockPermission,
  type StockRole,
  stockRolePermissions,
} from '@ocall/shared';
import { StockPage } from '@/components/stock/stock-page';
import { ExistingMemberForm } from '@/components/suite/existing-member-form';
import {
  type StockMemberView,
  type StockSiteView,
  asApiError,
} from '@/components/stock/stock-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { SimpleForm } from '@/components/ui/simple-form';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

const ROLE_OPTIONS = STOCK_ROLES.map((r) => ({ value: r, label: STOCK_ROLE_LABELS[r] }));
type Choice = 'role' | 'granted' | 'revoked';

/** Équipe Ocall Stock : comptes, rôles, et ajustements de permissions par membre. */
export default function StockTeamPage() {
  return (
    <StockPage
      title="Équipe"
      description="Comptes, rôles et permissions de votre équipe Ocall Stock."
    >
      {({ can, canWrite }) =>
        can('stock.members.read') ? (
          <Team manage={canWrite('stock.members.manage')} />
        ) : (
          <Alert tone="info" title="Accès réservé">
            La liste de l’équipe est réservée aux responsables.
          </Alert>
        )
      }
    </StockPage>
  );
}

function Team({ manage }: { manage: boolean }) {
  const members = useApi<StockMemberView[]>('/ocall-stock/members');
  const [created, setCreated] = useState<{ loginId: string; temporaryPassword: string } | null>(
    null,
  );
  const [adjusting, setAdjusting] = useState<StockMemberView | null>(null);
  const [siting, setSiting] = useState<StockMemberView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function update(m: StockMemberView, body: { role?: StockRole; isActive?: boolean }) {
    setError(null);
    try {
      await api(`/ocall-stock/members/${m.id}`, { method: 'PATCH', body });
      members.reload();
    } catch (e) {
      setError(asApiError(e));
    }
  }

  return (
    <>
      <ApiErrorAlert error={error} />
      {created && (
        <Alert tone="success" title="Compte créé">
          Identifiant : <strong>{created.loginId}</strong> — mot de passe temporaire :{' '}
          <strong className="font-mono">{created.temporaryPassword}</strong>. Transmettez-les à la
          personne : elle choisira son mot de passe à la première connexion. Ce mot de passe ne sera
          plus affiché.
        </Alert>
      )}
      {members.state === 'loading' && <LoadingState />}
      {members.state === 'error' && <ErrorState error={members.error} onRetry={members.reload} />}
      {members.state === 'success' && (
        <Card>
          <CardHeader
            title="Membres"
            description="Le propriétaire de l’organisation est administrateur d’office."
          />
          {members.data.length === 0 ? (
            <CardBody>
              <p className="text-sm text-muted">Aucun membre pour l’instant.</p>
            </CardBody>
          ) : (
            <div data-testid="stock-member-list">
              <Table head={['Membre', 'Rôle', 'Ajustements', '']}>
                {members.data.map((m) => (
                  <tr key={m.id}>
                    <Td>
                      <span className="block font-semibold">
                        {m.firstName} {m.lastName}
                      </span>
                      <span className="block font-mono text-xs text-muted">{m.loginId}</span>
                    </Td>
                    <Td>
                      {manage ? (
                        <select
                          aria-label={`Rôle de ${m.firstName} ${m.lastName}`}
                          value={m.role}
                          onChange={(e) => void update(m, { role: e.target.value as StockRole })}
                          className="rounded-lg border border-line px-2 py-1 text-sm"
                        >
                          {ROLE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        STOCK_ROLE_LABELS[m.role]
                      )}
                    </Td>
                    <Td className="text-xs">
                      {m.permissions.length === 0
                        ? 'Rôle seul'
                        : m.permissions
                            .map(
                              (p) =>
                                `${p.granted ? '+' : '−'} ${STOCK_PERMISSION_LABELS[p.permission as StockPermission] ?? p.permission}`,
                            )
                            .join(', ')}
                    </Td>
                    <Td className="text-right">
                      <span className="inline-flex flex-wrap justify-end gap-2">
                        {!m.isActive && <Badge tone="terracotta">Désactivé</Badge>}
                        {manage && (
                          <>
                            <Button size="sm" variant="secondary" onClick={() => setAdjusting(m)}>
                              Permissions
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => setSiting(m)}>
                              Sites{m.siteIds.length ? ` (${m.siteIds.length})` : ''}
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void update(m, { isActive: !m.isActive })}
                            >
                              {m.isActive ? 'Désactiver' : 'Réactiver'}
                            </Button>
                          </>
                        )}
                      </span>
                    </Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Card>
      )}
      {manage && siting && (
        <MemberSites
          key={siting.id}
          member={siting}
          onClose={() => setSiting(null)}
          onSaved={() => {
            setSiting(null);
            members.reload();
          }}
        />
      )}
      {manage && adjusting && (
        <Adjustments
          key={adjusting.id}
          member={adjusting}
          onClose={() => setAdjusting(null)}
          onSaved={() => {
            setAdjusting(null);
            members.reload();
          }}
        />
      )}
      {manage && (
        <Card>
          <CardHeader
            title="Ajouter un membre de l’organisation"
            description="Une personne qui a déjà un compte (employé Park, membre d’une autre application) : pas de nouveau compte, ses autres rôles ne changent pas."
          />
          <CardBody>
            <ExistingMemberForm
              testId="stock-member-existing"
              candidatesPath="/ocall-stock/members/candidates"
              attachPath="/ocall-stock/members/existing"
              roleOptions={ROLE_OPTIONS}
              defaultRole="CASHIER"
              labels={{
                person: 'Personne',
                role: 'Rôle Stock',
                submit: 'Ajouter à l’équipe',
                empty: 'Aucun autre membre de l’organisation à ajouter.',
              }}
              onDone={members.reload}
            />
          </CardBody>
        </Card>
      )}
      {manage && (
        <Card>
          <CardHeader title="Nouveau membre" />
          <CardBody>
            <SimpleForm<{ member: { loginId: string }; temporaryPassword: string }>
              testId="stock-member-form"
              path="/ocall-stock/members"
              submitLabel="Créer le compte"
              fields={[
                { name: 'firstName', label: 'Prénom', required: true },
                { name: 'lastName', label: 'Nom', required: true },
                { name: 'email', label: 'E-mail (facultatif)', type: 'email' },
                {
                  name: 'role',
                  label: 'Rôle',
                  type: 'select',
                  options: ROLE_OPTIONS,
                  defaultValue: 'CASHIER',
                },
              ]}
              onDone={(r) => {
                setCreated({ loginId: r.member.loginId, temporaryPassword: r.temporaryPassword });
                members.reload();
              }}
            />
          </CardBody>
        </Card>
      )}
    </>
  );
}

function Adjustments({
  member,
  onClose,
  onSaved,
}: {
  member: StockMemberView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const fromRole = new Set<string>(stockRolePermissions(member.role));
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(
      STOCK_ADJUSTABLE_PERMISSIONS.map((p) => {
        const o = member.permissions.find((x) => x.permission === p);
        return [p, o ? (o.granted ? 'granted' : 'revoked') : 'role'];
      }),
    ),
  );
  const [error, setError] = useState<ApiError | null>(null);

  async function save() {
    setError(null);
    try {
      await api(`/ocall-stock/members/${member.id}/permissions`, {
        method: 'PUT',
        body: {
          overrides: Object.entries(choices)
            .filter(([, c]) => c !== 'role')
            .map(([permission, c]) => ({ permission, granted: c === 'granted' })),
        },
      });
      onSaved();
    } catch (e) {
      setError(asApiError(e));
    }
  }

  return (
    <Card>
      <CardHeader
        title={`Permissions de ${member.firstName} ${member.lastName}`}
        description={`Rôle : ${STOCK_ROLE_LABELS[member.role]}. Accordez ou retirez une permission par rapport à ce rôle.`}
      />
      <CardBody className="space-y-4">
        <ApiErrorAlert error={error} />
        <div className="space-y-2" data-testid="stock-permission-editor">
          {STOCK_ADJUSTABLE_PERMISSIONS.map((p) => (
            <div key={p} className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span>
                {STOCK_PERMISSION_LABELS[p]}{' '}
                <span className="text-xs text-muted">
                  ({fromRole.has(p) ? 'inclus dans le rôle' : 'hors rôle'})
                </span>
              </span>
              <select
                aria-label={STOCK_PERMISSION_LABELS[p]}
                value={choices[p]}
                onChange={(e) => setChoices((c) => ({ ...c, [p]: e.target.value as Choice }))}
                className="rounded-lg border border-line px-2 py-1"
              >
                <option value="role">Selon le rôle</option>
                <option value="granted">Accordée</option>
                <option value="revoked">Retirée</option>
              </select>
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          <Button onClick={() => void save()}>Enregistrer</Button>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

const SITE_ROLE_OPTIONS = STOCK_SITE_ROLES.map((r) => ({ value: r, label: STOCK_ROLE_LABELS[r] }));

/**
 * Sites d'un membre : sans aucun site coché, il agit sur tous les sites. Sur un site coché, un rôle propre
 * peut restreindre son rôle principal (jamais l'élargir).
 */
function MemberSites({
  member,
  onClose,
  onSaved,
}: {
  member: StockMemberView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const sites = useApi<StockSiteView[]>('/ocall-stock/sites');
  const [chosen, setChosen] = useState<string[]>(member.siteIds);
  const [roles, setRoles] = useState<Record<string, StockRole>>(() =>
    Object.fromEntries((member.siteRoles ?? []).map((r) => [r.siteId, r.role])),
  );
  const [error, setError] = useState<ApiError | null>(null);
  const admin = member.role === 'ADMIN';

  async function save() {
    setError(null);
    try {
      await api(`/ocall-stock/members/${member.id}/sites`, {
        method: 'PUT',
        body: {
          siteIds: chosen,
          siteRoles: admin
            ? []
            : chosen.flatMap((siteId) => (roles[siteId] ? [{ siteId, role: roles[siteId] }] : [])),
        },
      });
      onSaved();
    } catch (e) {
      setError(asApiError(e));
    }
  }

  return (
    <Card>
      <CardHeader
        title={`Sites de ${member.firstName} ${member.lastName}`}
        description={`Aucun site coché : le membre agit sur tous les sites. Sinon, seulement sur ceux cochés${admin ? '.' : ', avec son rôle principal (' + STOCK_ROLE_LABELS[member.role] + ') ou un rôle propre au site, qui ne peut que le restreindre.'}`}
      />
      <CardBody className="space-y-4">
        <ApiErrorAlert error={error} />
        {sites.state === 'success' && (
          <div className="grid gap-2 text-sm sm:grid-cols-2" data-testid="stock-member-sites">
            {sites.data.map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center gap-2"
                data-site={s.code}
                data-testid="stock-member-site"
              >
                <label className="flex min-w-0 flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={chosen.includes(s.id)}
                    onChange={(e) =>
                      setChosen((cur) =>
                        e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id),
                      )
                    }
                  />
                  <span className="truncate">
                    {s.code} · {s.name}
                  </span>
                </label>
                {!admin && chosen.includes(s.id) && (
                  <select
                    aria-label={`Rôle à ${s.name}`}
                    value={roles[s.id] ?? ''}
                    onChange={(e) =>
                      setRoles((cur) => {
                        const next = { ...cur };
                        if (e.target.value) next[s.id] = e.target.value as StockRole;
                        else delete next[s.id];
                        return next;
                      })
                    }
                    className="max-w-full rounded-lg border border-line px-2 py-1 text-sm"
                  >
                    <option value="">Rôle principal</option>
                    {SITE_ROLE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-3">
          <Button onClick={() => void save()}>Enregistrer</Button>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

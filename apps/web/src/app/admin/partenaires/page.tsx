'use client';

import { type FormEvent, useState } from 'react';
import { Handshake, Plus } from 'lucide-react';
import { PARTNER_STATUS_LABELS, type PartnerStatus, formatXof } from '@ocall/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { InputField, SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ApiErrorAlert, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, Td } from '@/components/ui/table';
import { type ApiError, api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/use-api';

interface PartnerRow {
  id: string;
  code: string;
  companyName: string;
  contactName: string;
  phone: string;
  country: string;
  territories: string[];
  status: PartnerStatus;
  cashCollectionEnabled: boolean;
  cashCollectionLimit: number;
  commissionRuleId: string | null;
  createdAt: string;
  user: { email: string | null };
  _count: { prospects: number; attributions: number };
}
interface ReportRow {
  id: string;
  clients: number;
  commissions: { accrued: number; validated: number; paid: number; reversed: number };
}
interface RuleRow {
  id: string;
  name: string;
  isActive: boolean;
}

const TONE: Record<PartnerStatus, 'savanna' | 'forest' | 'terracotta'> = {
  PENDING_VERIFICATION: 'savanna',
  ACTIVE: 'forest',
  SUSPENDED: 'terracotta',
};

/**
 * Partenaires commerciaux (Sprint 12B) : invitation, vérification, suspension, territoires,
 * règle de commission, droit et plafond d'encaissement d'espèces (désactivé par défaut).
 */
export default function AdminPartnersPage() {
  const partners = useApi<PartnerRow[]>('/platform/partners');
  const report = useApi<ReportRow[]>('/platform/partner-reports');
  const rules = useApi<RuleRow[]>('/platform/commission-rules');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PartnerRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function action(p: PartnerRow, kind: 'verify' | 'suspend' | 'reactivate') {
    const reason =
      kind === 'verify'
        ? null
        : window.prompt(kind === 'suspend' ? 'Motif de la suspension' : 'Motif de la réactivation');
    if (kind !== 'verify' && (!reason || reason.trim().length < 3)) return;
    setError(null);
    try {
      await api(`/platform/partners/${p.id}/${kind}`, {
        method: 'POST',
        body: reason ? { reason } : {},
      });
      setNotice(
        kind === 'verify'
          ? `${p.companyName} vérifié.`
          : kind === 'suspend'
            ? `${p.companyName} suspendu : sessions fermées.`
            : `${p.companyName} réactivé.`,
      );
      partners.reload();
    } catch (e) {
      setError(e as ApiError);
    }
  }

  const stats = (id: string) =>
    report.state === 'success' ? report.data.find((r) => r.id === id) : undefined;
  return (
    <>
      <PageHeader
        eyebrow="Super Admin"
        title="Partenaires commerciaux"
        description="Apporteurs d’affaires : aucun privilège d’administration. Ils ne voient que leurs prospects, leurs clients apportés (nom et montants) et leurs commissions."
        action={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            Inviter un partenaire
          </Button>
        }
      />
      {notice && (
        <div className="mb-4">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}
      <ApiErrorAlert error={error} />
      <Card>
        <CardHeader title="Partenaires" />
        {partners.state === 'loading' && <LoadingState />}
        {partners.state === 'error' && (
          <ErrorState error={partners.error} onRetry={partners.reload} />
        )}
        {partners.state === 'success' &&
          (partners.data.length === 0 ? (
            <EmptyState
              icon={<Handshake className="h-7 w-7" />}
              title="Aucun partenaire"
              description="Invitez votre premier partenaire commercial."
            />
          ) : (
            <Table head={['Partenaire', 'Activité', 'Commissions', 'Espèces', 'Statut', '']}>
              {partners.data.map((p) => {
                const s = stats(p.id);
                return (
                  <tr key={p.id}>
                    <Td className="font-medium">
                      {p.companyName}
                      <span className="block text-xs text-muted">
                        {p.code} · {p.contactName} · {p.user.email} · {p.phone}
                      </span>
                      {p.territories.length > 0 && (
                        <span className="block text-xs text-muted">{p.territories.join(', ')}</span>
                      )}
                    </Td>
                    <Td className="text-sm">
                      {p._count.prospects} prospect(s)
                      <span className="block text-xs text-muted">
                        {s?.clients ?? 0} client(s) apporté(s)
                      </span>
                    </Td>
                    <Td className="text-sm tabular-nums">
                      {formatXof((s?.commissions.accrued ?? 0) + (s?.commissions.validated ?? 0))} à
                      verser
                      <span className="block text-xs text-muted">
                        versé {formatXof(s?.commissions.paid ?? 0)}
                      </span>
                    </Td>
                    <Td className="text-sm">
                      {p.cashCollectionEnabled
                        ? `Autorisé · plafond ${formatXof(p.cashCollectionLimit)}`
                        : 'Non autorisé'}
                    </Td>
                    <Td>
                      <Badge tone={TONE[p.status]}>{PARTNER_STATUS_LABELS[p.status]}</Badge>
                      <span className="block text-xs text-muted">
                        depuis le {formatDate(p.createdAt)}
                      </span>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-2">
                        {p.status === 'PENDING_VERIFICATION' && (
                          <Button size="sm" onClick={() => action(p, 'verify')}>
                            Vérifier
                          </Button>
                        )}
                        {p.status !== 'SUSPENDED' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => action(p, 'suspend')}
                          >
                            Suspendre
                          </Button>
                        )}
                        {p.status === 'SUSPENDED' && (
                          <Button size="sm" onClick={() => action(p, 'reactivate')}>
                            Réactiver
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                          Paramètres
                        </Button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </Table>
          ))}
      </Card>
      {creating && (
        <CreatePartnerDialog
          onClose={() => setCreating(false)}
          onCreated={(msg) => {
            setCreating(false);
            setNotice(msg);
            partners.reload();
          }}
        />
      )}
      {editing && (
        <EditPartnerDialog
          partner={editing}
          rules={rules.state === 'success' ? rules.data : []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setNotice('Paramètres enregistrés.');
            partners.reload();
          }}
        />
      )}
    </>
  );
}

function CreatePartnerDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (msg: string) => void;
}) {
  const [form, setForm] = useState({
    companyName: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    country: 'Mali',
    territories: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [password, setPassword] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ temporaryPassword: string }>('/platform/partners', {
        method: 'POST',
        body: {
          ...form,
          territories: form.territories
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        },
      });
      setPassword(res.temporaryPassword);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSaving(false);
    }
  }

  if (password) {
    return (
      <Dialog
        open
        onClose={() => onCreated(`Partenaire ${form.companyName} invité : profil à vérifier.`)}
        title="Partenaire invité"
      >
        <div className="space-y-3 text-sm">
          <p>
            Transmettez ces identifiants par un canal sûr. Le mot de passe est affiché une seule
            fois et doit être changé à la première connexion ; la double authentification sera
            demandée.
          </p>
          <p>
            Identifiant : <strong>{form.email}</strong>
          </p>
          <p>
            Mot de passe temporaire : <strong className="font-mono">{password}</strong>
          </p>
          <Button
            onClick={() => onCreated(`Partenaire ${form.companyName} invité : profil à vérifier.`)}
          >
            J’ai transmis les identifiants
          </Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Inviter un partenaire"
      description="Le profil est créé « à vérifier » : le partenaire ne peut travailler qu’après votre vérification."
    >
      <form onSubmit={submit} className="space-y-3">
        <InputField
          label="Raison sociale"
          required
          value={form.companyName}
          onChange={(e) => setForm({ ...form, companyName: e.target.value })}
        />
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
          <InputField
            label="E-mail (identifiant)"
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <InputField
            label="Téléphone"
            type="tel"
            required
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <InputField
            label="Pays"
            required
            value={form.country}
            onChange={(e) => setForm({ ...form, country: e.target.value })}
          />
          <InputField
            label="Territoires"
            hint="Séparés par des virgules."
            value={form.territories}
            onChange={(e) => setForm({ ...form, territories: e.target.value })}
          />
        </div>
        <ApiErrorAlert error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" loading={saving}>
            Inviter
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function EditPartnerDialog({
  partner,
  rules,
  onClose,
  onSaved,
}: {
  partner: PartnerRow;
  rules: RuleRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    territories: partner.territories.join(', '),
    cashCollectionEnabled: partner.cashCollectionEnabled,
    cashCollectionLimit: String(partner.cashCollectionLimit),
    commissionRuleId: partner.commissionRuleId ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api(`/platform/partners/${partner.id}`, {
        method: 'PATCH',
        body: {
          territories: form.territories
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          cashCollectionEnabled: form.cashCollectionEnabled,
          cashCollectionLimit: Number(form.cashCollectionLimit || 0),
          commissionRuleId: form.commissionRuleId || null,
        },
      });
      onSaved();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Paramètres — ${partner.companyName}`}
      description="Modifications journalisées."
    >
      <form onSubmit={submit} className="space-y-3">
        <InputField
          label="Territoires"
          value={form.territories}
          onChange={(e) => setForm({ ...form, territories: e.target.value })}
        />
        <SelectField
          label="Règle de commission"
          hint="Vide : la règle générale active s’applique."
          value={form.commissionRuleId}
          onChange={(e) => setForm({ ...form, commissionRuleId: e.target.value })}
          options={[
            { value: '', label: 'Règle générale' },
            ...rules.map((r) => ({
              value: r.id,
              label: `${r.name}${r.isActive ? '' : ' (inactive)'}`,
            })),
          ]}
        />
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5 accent-forest"
            checked={form.cashCollectionEnabled}
            onChange={(e) => setForm({ ...form, cashCollectionEnabled: e.target.checked })}
          />
          Autoriser la collecte d’espèces pour le compte d’Ocall
        </label>
        <InputField
          label="Plafond des collectes non remises (FCFA)"
          type="number"
          min={0}
          value={form.cashCollectionLimit}
          onChange={(e) => setForm({ ...form, cashCollectionLimit: e.target.value })}
        />
        <ApiErrorAlert error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" loading={saving}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

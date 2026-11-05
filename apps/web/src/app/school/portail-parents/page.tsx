'use client';

import { useState } from 'react';
import { toApiError, useSchoolText } from '@/components/school/school-language';
import { SchoolPage } from '@/components/school/school-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField } from '@/components/ui/field';
import { Alert, ApiErrorAlert, ErrorState, LoadingState } from '@/components/ui/states';
import { type ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

interface GuardianRow {
  id: string;
  lastName: string;
  firstName: string;
  phone: string;
}

interface PortalStatus {
  account: { status: 'ACTIVE' | 'REVOKED'; loginId: string | null } | null;
  authorizedChildren: number;
  invitations: {
    id: string;
    createdAt: string;
    expiresAt: string;
    status: 'PENDING' | 'USED' | 'EXPIRED' | 'REVOKED';
  }[];
}

/**
 * Portail parents côté établissement (Sprint 6) : invitation d'un responsable (lien à usage unique,
 * affiché une seule fois), suivi des invitations, retrait de l'accès. Seuls les enfants dont le lien
 * autorise le suivi apparaissent au responsable.
 */
export default function PortalAdminPage() {
  return (
    <SchoolPage title="por.title" description="por.desc">
      {({ school, canWrite }) => (
        <Guardians
          key={school!.id}
          schoolId={school!.id}
          canManage={canWrite('school.portal.manage')}
        />
      )}
    </SchoolPage>
  );
}

function Guardians({ schoolId, canManage }: { schoolId: string; canManage: boolean }) {
  const { t } = useSchoolText();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const list = useApi<GuardianRow[]>(
    `/school/guardians?schoolId=${schoolId}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
  );
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <Card>
        <CardBody>
          <InputField label={t('por.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          {list.state === 'loading' ? (
            <LoadingState />
          ) : list.state === 'error' ? (
            <ErrorState error={list.error} onRetry={list.reload} />
          ) : (
            <ul className="mt-3 divide-y divide-line/70 text-sm" data-testid="portal-guardians">
              {list.data.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(g.id)}
                    className={`w-full px-2 py-2 text-start ${selected === g.id ? 'bg-ivory font-semibold' : ''}`}
                  >
                    {g.lastName} {g.firstName}
                    <span className="block text-xs text-muted" dir="ltr">
                      {g.phone}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      {selected && <PortalPanel key={selected} guardianId={selected} canManage={canManage} />}
    </div>
  );
}

function PortalPanel({ guardianId, canManage }: { guardianId: string; canManage: boolean }) {
  const { t, date } = useSchoolText();
  const status = useApi<PortalStatus>(`/school/guardians/${guardianId}/portal`);
  const [sendSms, setSendSms] = useState(false);
  const [link, setLink] = useState<{ url: string; expiresAt: string; smsQueued: boolean } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  async function run(work: () => Promise<void>) {
    setLoading(true);
    setError(null);
    try {
      await work();
      status.reload();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoading(false);
    }
  }

  const invite = () =>
    run(async () => {
      const res = await api<{ path: string; expiresAt: string; smsQueued: boolean }>(
        `/school/guardians/${guardianId}/portal/invitations`,
        { method: 'POST', body: { sendSms } },
      );
      setCopied(false);
      setLink({
        url: `${window.location.origin}${res.path}`,
        expiresAt: res.expiresAt,
        smsQueued: res.smsQueued,
      });
    });

  if (status.state === 'loading') return <LoadingState />;
  if (status.state === 'error') return <ErrorState error={status.error} onRetry={status.reload} />;
  const s = status.data;
  return (
    <Card>
      <CardBody>
        <div className="space-y-3" data-testid="portal-panel">
          <div className="flex flex-wrap items-center gap-2">
            {s.account?.status === 'ACTIVE' ? (
              <Badge tone="forest">{t('por.active')}</Badge>
            ) : s.account?.status === 'REVOKED' ? (
              <Badge tone="terracotta">{t('por.revoked')}</Badge>
            ) : (
              <Badge tone="neutral">{t('por.none')}</Badge>
            )}
            {s.account?.loginId && (
              <span className="text-sm" dir="ltr">
                {t('por.loginId', { loginId: s.account.loginId })}
              </span>
            )}
          </div>
          <p className="text-sm">{t('por.children', { n: s.authorizedChildren })}</p>
          <ApiErrorAlert error={error} />
          {link && (
            <Alert tone="success" title={t('por.link')}>
              <p className="break-all text-xs" dir="ltr" data-testid="invitation-link">
                {link.url}
              </p>
              <p className="mt-1 text-xs">{t('por.expires', { date: date(link.expiresAt) })}</p>
              {link.smsQueued && <p className="text-xs">{t('por.smsQueued')}</p>}
              <Button
                size="sm"
                variant="secondary"
                className="mt-2"
                onClick={() =>
                  void navigator.clipboard.writeText(link.url).then(() => setCopied(true))
                }
              >
                {copied ? t('por.copied') : t('por.copy')}
              </Button>
            </Alert>
          )}
          {canManage && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={sendSms}
                  onChange={(e) => setSendSms(e.target.checked)}
                />
                {t('por.sendSms')}
              </label>
              <Button loading={loading} onClick={() => void invite()} data-testid="invite">
                {t('por.invite')}
              </Button>
            </div>
          )}
          <h3 className="pt-2 text-sm font-semibold">{t('por.invitations')}</h3>
          <ul className="divide-y divide-line/70 text-sm">
            {s.invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {date(i.createdAt)} · {t(`por.inv.${i.status}`)}
                </span>
                {canManage && i.status === 'PENDING' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void run(() =>
                        api(`/school/guardians/${guardianId}/portal/invitations/${i.id}/revoke`, {
                          method: 'POST',
                        }).then(() => undefined),
                      )
                    }
                  >
                    {t('por.cancel')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {canManage && s.account?.status === 'ACTIVE' && (
            <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
              <div className="min-w-60 flex-1">
                <InputField
                  label={t('por.reason')}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              <Button
                variant="danger"
                disabled={reason.trim().length < 3}
                onClick={() =>
                  void run(() =>
                    api(`/school/guardians/${guardianId}/portal/revoke`, {
                      method: 'POST',
                      body: { reason },
                    }).then(() => setReason('')),
                  )
                }
              >
                {t('por.revokeAccess')}
              </Button>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

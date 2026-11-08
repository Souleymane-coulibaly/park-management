'use client';

import { SchoolPermission, hasSchoolPermission } from '@ocall/shared';
import { useState } from 'react';
import { useSchoolText } from '@/components/school/school-language';
import { SchoolPage } from '@/components/school/school-page';
import { ReportTable } from '@/components/school/school-reports';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { InputField, SelectField } from '@/components/ui/field';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

interface AuditPage {
  page: number;
  pageSize: number;
  total: number;
  items: {
    id: string;
    action: string;
    targetType: string;
    targetId: string | null;
    metadata: Record<string, unknown> | null;
    actor: string | null;
    createdAt: string;
  }[];
}

/** Familles d'actions proposées au filtre (préfixes des actions journalisées « school.* »). */
const FAMILIES = [
  'school.report',
  'school.finance',
  'school.payment',
  'school.student',
  'school.enrollment',
  'school.member',
  'school.results',
  'school.report_cards',
  'school.ai',
] as const;

/**
 * Historique des opérations sensibles (Sprint 8) : journal d'audit School du client, réservé à la direction
 * du groupe (il couvre tous les établissements). Métadonnées sans contenu sensible.
 */
export default function AuditHistoryPage() {
  return (
    <SchoolPage title="audit.title" description="audit.desc" needsSchool={false}>
      {({ context }) =>
        hasSchoolPermission(context.role, SchoolPermission.AUDIT_READ) ? <History /> : <Forbidden />
      }
    </SchoolPage>
  );
}

function Forbidden() {
  const { t } = useSchoolText();
  return <Alert tone="info" title={t('audit.forbidden')} />;
}

function History() {
  const { t } = useSchoolText();
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({
    page: String(page),
    ...(action ? { action } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  }).toString();
  const data = useApi<AuditPage>(`/school/reports/audit?${query}`);
  const pages =
    data.state === 'success' ? Math.max(1, Math.ceil(data.data.total / data.data.pageSize)) : 1;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3" data-testid="audit-filters">
        <SelectField
          label={t('audit.family')}
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
          options={[
            { value: '', label: t('audit.allFamilies') },
            ...FAMILIES.map((f) => ({ value: f, label: f })),
          ]}
        />
        <InputField
          label={t('rep.from')}
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(1);
          }}
        />
        <InputField
          label={t('rep.to')}
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(1);
          }}
        />
      </div>
      {data.state === 'loading' ? (
        <LoadingState />
      ) : data.state === 'error' ? (
        <ErrorState error={data.error} onRetry={data.reload} />
      ) : (
        <Card>
          <CardBody>
            <ReportTable
              testId="audit-entries"
              minWidth={640}
              headers={[
                { label: t('audit.when') },
                { label: t('audit.actor') },
                { label: t('audit.action') },
                { label: t('audit.target') },
                { label: t('audit.details') },
              ]}
              rows={data.data.items.map((i) => ({
                key: i.id,
                cells: [
                  <span key="w" dir="ltr" className="whitespace-nowrap">
                    {new Date(i.createdAt).toLocaleString('fr-FR')}
                  </span>,
                  i.actor ?? '–',
                  <code key="a" className="text-xs">
                    {i.action}
                  </code>,
                  i.targetType,
                  <span key="d" className="break-all text-xs text-muted" dir="ltr">
                    {i.metadata ? JSON.stringify(i.metadata) : ''}
                  </span>,
                ],
              }))}
            />
            <div className="mt-3 flex items-center justify-between gap-2 text-sm">
              <span className="text-muted">{t('audit.count', { n: data.data.total })}</span>
              <span className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  {t('audit.previous')}
                </Button>
                <span dir="ltr">
                  {page} / {pages}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page >= pages}
                  onClick={() => setPage(page + 1)}
                >
                  {t('audit.next')}
                </Button>
              </span>
            </div>
          </CardBody>
        </Card>
      )}
    </>
  );
}

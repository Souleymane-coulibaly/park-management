'use client';

import { type ReactNode, useEffect, useState } from 'react';
import {
  type ProductAccess,
  type SchoolLocale,
  type SchoolPermission,
  type SchoolRole,
  type SchoolType,
  hasSchoolPermission,
} from '@ocall/shared';
import { SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';

export interface SchoolSummary {
  id: string;
  name: string;
  nameAr: string | null;
  type: SchoolType;
  defaultLocale: SchoolLocale;
  isActive: boolean;
}

export interface SchoolContextView {
  role: SchoolRole;
  access: ProductAccess;
  modules: string[];
  schools: SchoolSummary[];
}

export interface SchoolPageApi {
  context: SchoolContextView;
  school: SchoolSummary | null;
  /** Permission du rôle, et contrat autorisant l'écriture. */
  canWrite: (permission: SchoolPermission) => boolean;
  reloadContext: () => void;
}

const STORAGE_KEY = 'ocp.school.current';

/** Nom bilingue : le texte arabe s'affiche de droite à gauche, quelle que soit la langue de la page. */
export function BiName({ name, nameAr }: { name: string; nameAr?: string | null }) {
  return (
    <>
      <span>{name}</span>
      {nameAr && (
        <span
          dir="rtl"
          lang="ar"
          data-testid="arabic-name"
          className="mx-2 inline-block text-charcoal-soft"
        >
          {nameAr}
        </span>
      )}
    </>
  );
}

/** Cadre commun des écrans School : contexte, bandeau de lecture seule, choix de l'établissement. */
export function SchoolPage({
  title,
  description,
  action,
  needsSchool = true,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  needsSchool?: boolean;
  children: (api: SchoolPageApi) => ReactNode;
}) {
  const context = useApi<SchoolContextView>('/school/context');
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    try {
      setSelected(localStorage.getItem(STORAGE_KEY));
    } catch {
      // Stockage indisponible : premier établissement par défaut.
    }
  }, []);

  if (context.state === 'loading') return <LoadingState />;
  if (context.state === 'error') {
    return <ErrorState error={context.error} onRetry={context.reload} />;
  }
  const { data } = context;
  const school = data.schools.find((s) => s.id === selected) ?? data.schools[0] ?? null;

  return (
    <>
      <PageHeader eyebrow="Ocall School" title={title} description={description} action={action} />
      <div className="space-y-4">
        {data.access === 'read_only' && (
          <div data-testid="school-read-only">
            <Alert tone="info" title="Consultation seule">
              Votre contrat est suspendu ou arrivé à échéance. Vos données sont conservées : vous
              pouvez les consulter et les exporter. Contactez Ocall pour le renouveler.
            </Alert>
          </div>
        )}
        {needsSchool && data.schools.length > 1 && (
          <div className="max-w-sm">
            <SelectField
              label="Établissement"
              value={school?.id ?? ''}
              onChange={(e) => {
                setSelected(e.target.value);
                try {
                  localStorage.setItem(STORAGE_KEY, e.target.value);
                } catch {
                  // Stockage indisponible : le choix vaut pour cette page.
                }
              }}
              options={data.schools.map((s) => ({ value: s.id, label: s.name }))}
            />
          </div>
        )}
        {needsSchool && !school ? (
          <Alert tone="info" title="Aucun établissement">
            Créez d’abord un établissement, ou demandez à la direction de vous y affecter.
          </Alert>
        ) : (
          children({
            context: data,
            school,
            canWrite: (permission) =>
              data.access === 'full' && hasSchoolPermission(data.role, permission),
            reloadContext: context.reload,
          })
        )}
      </div>
    </>
  );
}

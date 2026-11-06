'use client';

import { type ReactNode, useEffect, useState } from 'react';
import {
  type ProductAccess,
  type SchoolLocale,
  type SchoolPermission,
  type SchoolRole,
  type SchoolTextKey,
  type SchoolType,
  hasSchoolPermission,
  schoolDisplayName,
} from '@ocall/shared';
import { SelectField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, ErrorState, LoadingState } from '@/components/ui/states';
import { useApi } from '@/lib/use-api';
import { SchoolLanguage, type SchoolText, useSchoolText } from './school-language';

export interface SchoolSummary {
  id: string;
  name: string;
  nameAr: string | null;
  type: SchoolType;
  defaultLocale: SchoolLocale;
  isActive: boolean;
  timezone: string;
  /** Accès selon les contrats qui couvrent cet établissement (contrats multiples). */
  contractAccess?: ProductAccess;
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
  /**
   * Même interface, rapportée à l'établissement d'une ressource affichée (fiche d'élève, de classe,
   * d'évaluation, ligne d'une liste) : droits et langue selon SON contrat, pas l'établissement mémorisé.
   */
  forSchool: (schoolId: string | null | undefined) => SchoolPageApi;
}

/** Interface de page pour un établissement donné (contrats multiples : accès par établissement). */
function pageApi(
  data: SchoolContextView,
  school: SchoolSummary | null,
  reloadContext: () => void,
): SchoolPageApi {
  return {
    context: data,
    school,
    canWrite: (permission) =>
      (school?.contractAccess ?? data.access) === 'full' &&
      hasSchoolPermission(data.role, permission),
    reloadContext,
    forSchool: (schoolId) =>
      pageApi(data, data.schools.find((s) => s.id === schoolId) ?? null, reloadContext),
  };
}

/** Bandeau « lecture seule » d'un établissement (fiches sans sélecteur d'établissement). */
export function SchoolReadOnlyNotice({ page }: { page: SchoolPageApi }) {
  const text = useSchoolText();
  if ((page.school?.contractAccess ?? page.context.access) !== 'read_only') return null;
  return (
    <div data-testid="school-read-only">
      <Alert tone="info" title={text.t('frame.readOnlyTitle')}>
        {text.t('frame.readOnly')}
      </Alert>
    </div>
  );
}

const STORAGE_KEY = 'ocp.school.current';

/**
 * Nom d'un élément selon la langue de l'établissement : français seul en Français, les deux en
 * Bilingue, l'arabe en priorité en Arabe. Le texte arabe se lit toujours de droite à gauche.
 * `locale` : langue propre à l'élément, pour une liste qui réunit plusieurs établissements.
 */
export function BiName({
  name,
  nameAr,
  locale: own,
}: {
  name: string;
  nameAr?: string | null;
  locale?: SchoolLocale;
}) {
  const { locale: current } = useSchoolText();
  const locale = own ?? current;
  if (locale === 'FR' || !nameAr) return <span>{name}</span>;
  const arabic = (
    <span dir="rtl" lang="ar" data-testid="arabic-name" className="inline-block">
      {nameAr}
    </span>
  );
  if (locale === 'AR') {
    return (
      <>
        {arabic}
        <span dir="auto" className="mx-2 inline-block text-charcoal-soft">
          {name}
        </span>
      </>
    );
  }
  return (
    <>
      <span>{name}</span>
      <span
        dir="rtl"
        lang="ar"
        data-testid="arabic-name"
        className="mx-2 inline-block text-charcoal-soft"
      >
        {nameAr}
      </span>
    </>
  );
}

/** Texte traduit : une clé, ou une fonction pour un texte qui dépend de la langue. */
export type SchoolTextSource = SchoolTextKey | ((text: SchoolText) => string);

function resolve(source: SchoolTextSource | undefined, text: SchoolText) {
  if (source === undefined) return undefined;
  return typeof source === 'function' ? source(text) : text.t(source);
}

/**
 * Cadre commun des écrans School : contexte, bandeau de lecture seule, choix de l'établissement.
 * Toute la page suit la langue de l'établissement courant (français par défaut). Sans `title`, la
 * page affiche elle-même son en-tête, dans la langue qui la concerne (fiche d'un élève).
 */
export function SchoolPage({
  title,
  description,
  action,
  needsSchool = true,
  children,
}: {
  title?: SchoolTextSource;
  description?: SchoolTextSource;
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
    <SchoolLanguage locale={school?.defaultLocale ?? 'FR'}>
      <SchoolFrame
        title={title}
        description={description}
        action={action}
        needsSchool={needsSchool}
        data={data}
        school={school}
        onSelect={(id) => {
          setSelected(id);
          try {
            localStorage.setItem(STORAGE_KEY, id);
          } catch {
            // Stockage indisponible : le choix vaut pour cette page.
          }
        }}
        api={pageApi(data, school, context.reload)}
      >
        {children}
      </SchoolFrame>
    </SchoolLanguage>
  );
}

function SchoolFrame({
  title,
  description,
  action,
  needsSchool,
  data,
  school,
  onSelect,
  api,
  children,
}: {
  title?: SchoolTextSource;
  description?: SchoolTextSource;
  action?: ReactNode;
  needsSchool: boolean;
  data: SchoolContextView;
  school: SchoolSummary | null;
  onSelect: (id: string) => void;
  api: SchoolPageApi;
  children: (api: SchoolPageApi) => ReactNode;
}) {
  const text = useSchoolText();
  return (
    <>
      {title !== undefined && (
        <PageHeader
          eyebrow={text.t('common.eyebrow')}
          title={resolve(title, text)!}
          description={resolve(description, text)}
          action={action}
        />
      )}
      <div className="space-y-4">
        {/* Bandeau : contrat de l'établissement choisi (contrats multiples). Sans sélecteur, seulement
            si tout le client est en lecture seule ; les fiches affichent celui de leur établissement. */}
        {needsSchool ? (
          <SchoolReadOnlyNotice page={api} />
        ) : (
          data.access === 'read_only' && <SchoolReadOnlyNotice page={api.forSchool(null)} />
        )}
        {needsSchool && data.schools.length > 1 && (
          <div className="max-w-sm">
            <SelectField
              label={text.t('frame.school')}
              value={school?.id ?? ''}
              onChange={(e) => onSelect(e.target.value)}
              options={data.schools.map((s) => ({
                value: s.id,
                label: schoolDisplayName(s.defaultLocale, s),
              }))}
            />
          </div>
        )}
        {needsSchool && !school ? (
          <Alert tone="info" title={text.t('frame.noSchoolTitle')}>
            {text.t('frame.noSchool')}
          </Alert>
        ) : (
          children(api)
        )}
      </div>
    </>
  );
}

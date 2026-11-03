'use client';

import { type ReactNode, createContext, useContext, useMemo } from 'react';
import {
  type SchoolLabels,
  type SchoolLocale,
  type SchoolTextKey,
  type SchoolTextVars,
  type SchoolUiLanguage,
  schoolDisplayName,
  schoolErrorMessage,
  schoolLabels,
  schoolShowsArabic,
  schoolText,
  schoolUiLanguage,
} from '@ocall/shared';
import { type UiText, UiTextProvider } from '@/components/ui/ui-text';
import { ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';

/** Erreur à afficher : celle de l'API, ou une coupure réseau (traduite par son code NETWORK). */
export const toApiError = (e: unknown) =>
  e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion impossible.');

/** Langue d'un établissement, telle que les écrans School l'utilisent. */
export interface SchoolText {
  locale: SchoolLocale;
  language: SchoolUiLanguage;
  dir: 'ltr' | 'rtl';
  /** Champs arabes : jamais affichés pour un établissement en Français. */
  showArabic: boolean;
  t: (key: SchoolTextKey, vars?: SchoolTextVars) => string;
  labels: SchoolLabels;
  /** Libellé d'un élément nommé : l'arabe en priorité pour un établissement en Arabe. */
  name: (item: { name: string; nameAr?: string | null }) => string;
  date: (iso: string | null) => string;
  /** Champs d'un formulaire : les champs arabes (`rtl`) sont retirés en Français. */
  fields: <F extends { rtl?: boolean }>(list: F[]) => F[];
  /** Énumération avec la virgule de la langue (« , » ou « ، »). */
  join: (items: string[]) => string;
}

// Chiffres latins : lisibles par tous, et identiques à ceux des documents.
const arabicDate = new Intl.DateTimeFormat('ar-u-nu-latn', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export function schoolTextFor(locale: SchoolLocale): SchoolText {
  const language = schoolUiLanguage(locale);
  const showArabic = schoolShowsArabic(locale);
  return {
    locale,
    language,
    dir: language === 'ar' ? 'rtl' : 'ltr',
    showArabic,
    fields: (list) => (showArabic ? list : list.filter((f) => !f.rtl)),
    join: (items) => items.join(language === 'ar' ? '، ' : ', '),
    t: (key, vars) => schoolText(language, key, vars),
    labels: schoolLabels(language),
    name: (item) => schoolDisplayName(locale, item),
    date: (iso) => (language === 'ar' && iso ? arabicDate.format(new Date(iso)) : formatDate(iso)),
  };
}

const SchoolTextContext = createContext<SchoolText>(schoolTextFor('FR'));
export const useSchoolText = () => useContext(SchoolTextContext);

/** Applique la langue d'un établissement : textes, états communs et sens de lecture. */
export function SchoolLanguage({
  locale,
  className,
  children,
}: {
  locale: SchoolLocale;
  className?: string;
  children: ReactNode;
}) {
  const text = useMemo(() => schoolTextFor(locale), [locale]);
  const ui = useMemo<UiText>(
    () => ({
      loading: text.t('common.loading'),
      retry: text.t('common.retry'),
      accessDenied: text.t('common.accessDenied'),
      loadFailed: text.t('common.loadFailed'),
      errorMessage: (error) => schoolErrorMessage(text.language, error.code, error.message),
    }),
    [text],
  );
  return (
    <SchoolTextContext.Provider value={text}>
      <UiTextProvider value={ui}>
        <div dir={text.dir} lang={text.language} data-school-locale={locale} className={className}>
          {children}
        </div>
      </UiTextProvider>
    </SchoolTextContext.Provider>
  );
}

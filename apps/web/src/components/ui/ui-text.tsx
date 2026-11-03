'use client';

import { createContext, useContext } from 'react';
import { AlertTriangle, Loader2, RotateCw } from 'lucide-react';
import type { ApiError } from '@/lib/api';
import { Alert } from './alert';
import { Button } from './button';

/**
 * Textes des états communs (chargement, erreur). Par défaut : le français, et le message renvoyé par
 * l'API. Une application peut les remplacer pour sa langue (Ocall School en arabe, par exemple).
 */
export interface UiText {
  loading: string;
  retry: string;
  accessDenied: string;
  loadFailed: string;
  errorMessage: (error: ApiError) => string;
}

export const DEFAULT_UI_TEXT: UiText = {
  loading: 'Chargement…',
  retry: 'Réessayer',
  accessDenied: 'Accès refusé',
  loadFailed: 'Impossible de charger les données',
  errorMessage: (error) => error.message,
};

const UiTextContext = createContext<UiText>(DEFAULT_UI_TEXT);
export const UiTextProvider = UiTextContext.Provider;
export const useUiText = () => useContext(UiTextContext);

export function LoadingState({ label }: { label?: string }) {
  const text = useUiText();
  return (
    <div className="flex items-center justify-center gap-3 py-14 text-muted" role="status">
      <Loader2 className="h-5 w-5 animate-spin text-forest" aria-hidden />
      <span className="text-sm">{label ?? text.loading}</span>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  const text = useUiText();
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center" role="alert">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-terracotta-light text-terracotta-dark">
        <AlertTriangle className="h-6 w-6" aria-hidden />
      </div>
      <h3 className="text-base font-semibold">
        {error.status === 403 ? text.accessDenied : text.loadFailed}
      </h3>
      <p className="mt-1 max-w-md text-sm text-muted">{text.errorMessage(error)}</p>
      {onRetry && error.status !== 403 && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={onRetry}
          icon={<RotateCw className="h-4 w-4" />}
        >
          {text.retry}
        </Button>
      )}
    </div>
  );
}

/** Affiche une erreur d'API avec ses détails de validation éventuels. */
export function ApiErrorAlert({ error }: { error: ApiError | null }) {
  const text = useUiText();
  if (!error) return null;
  const details = error.detailMessages;
  return (
    <Alert tone="error" title={text.errorMessage(error)}>
      {details.length > 0 && (
        <ul className="list-disc space-y-0.5 ps-4">
          {details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

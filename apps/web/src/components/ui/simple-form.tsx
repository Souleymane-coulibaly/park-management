'use client';

import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { InputField, SelectField } from '@/components/ui/field';
import { ApiErrorAlert } from '@/components/ui/states';
import { ApiError, api } from '@/lib/api';

export interface SimpleField {
  name: string;
  label: string;
  type?: 'text' | 'date' | 'number' | 'email' | 'select' | 'checkbox';
  required?: boolean;
  options?: { value: string; label: string }[];
  /** Saisie en arabe : écriture de droite à gauche. */
  rtl?: boolean;
  defaultValue?: string;
}

type Values = Record<string, string | boolean>;

const initial = (fields: SimpleField[]): Values =>
  Object.fromEntries(
    fields.map((f) => [
      f.name,
      f.type === 'checkbox' ? false : (f.defaultValue ?? f.options?.[0]?.value ?? ''),
    ]),
  );

/** Formulaire court : les champs vides ne sont pas envoyés, l'erreur de l'API s'affiche sur place. */
export function SimpleForm<T>({
  fields,
  path,
  method = 'POST',
  extra,
  submitLabel,
  onDone,
  testId,
  sendEmpty = false,
}: {
  fields: SimpleField[];
  path: string;
  method?: 'POST' | 'PATCH';
  extra?: Record<string, unknown>;
  submitLabel: string;
  onDone: (result: T) => void;
  testId?: string;
  /** Modification : un champ vidé est envoyé, pour effacer la valeur enregistrée. */
  sendEmpty?: boolean;
}) {
  const [values, setValues] = useState<Values>(() => initial(fields));
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const body: Record<string, unknown> = { ...extra };
    for (const f of fields) {
      const value = values[f.name];
      if (value === undefined || (value === '' && !sendEmpty)) continue;
      body[f.name] = f.type === 'number' ? Number(value) : value;
    }
    try {
      const result = await api<T>(path, { method, body });
      setValues(initial(fields));
      onDone(result);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Connexion impossible.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" data-testid={testId}>
      <ApiErrorAlert error={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => {
          if (f.type === 'select') {
            return (
              <SelectField
                key={f.name}
                label={f.label}
                required={f.required}
                value={String(values[f.name] ?? '')}
                onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                options={f.options ?? []}
              />
            );
          }
          if (f.type === 'checkbox') {
            return (
              <label key={f.name} className="flex min-h-11 items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-forest"
                  checked={values[f.name] === true}
                  onChange={(e) => setValues({ ...values, [f.name]: e.target.checked })}
                />
                {f.label}
              </label>
            );
          }
          return (
            <InputField
              key={f.name}
              label={f.label}
              type={f.type ?? 'text'}
              required={f.required}
              dir={f.rtl ? 'rtl' : undefined}
              lang={f.rtl ? 'ar' : undefined}
              step={f.type === 'number' ? 'any' : undefined}
              value={String(values[f.name] ?? '')}
              onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
            />
          );
        })}
      </div>
      <Button type="submit" loading={loading}>
        {submitLabel}
      </Button>
    </form>
  );
}

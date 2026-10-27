'use client';

import { type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, useId } from 'react';

const CONTROL =
  'block w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[15px] text-charcoal placeholder:text-muted/70 transition-colors focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/20 disabled:bg-ivory-dark/40 aria-[invalid=true]:border-terracotta-dark';

interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}

function FieldShell({ label, hint, error, required, children }: FieldShellProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-charcoal">
        {label}
        {required && (
          <span className="ml-0.5 text-terracotta-dark" aria-hidden>
            *
          </span>
        )}
      </label>
      {children(id, describedBy)}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-terracotta-dark" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface InputFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function InputField({ label, hint, error, required, ...props }: InputFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={required}>
      {(id, describedBy) => (
        <input
          id={id}
          className={CONTROL}
          required={required}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          {...props}
        />
      )}
    </FieldShell>
  );
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string;
  error?: string;
  options: { value: string; label: string }[];
}

export function SelectField({ label, hint, error, required, options, ...props }: SelectFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={required}>
      {(id, describedBy) => (
        <select
          id={id}
          className={CONTROL}
          required={required}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          {...props}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}

/** Groupe de cases à cocher accessible (ex. établissements autorisés). */
export function CheckboxGroup({
  legend,
  hint,
  options,
  value,
  onChange,
}: {
  legend: string;
  hint?: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-charcoal">{legend}</legend>
      {hint && <p className="text-sm text-muted">{hint}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => {
          const checked = value.includes(o.value);
          return (
            <label
              key={o.value}
              className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors ${checked ? 'border-forest bg-forest-light/50' : 'border-line bg-surface hover:border-forest/40'}`}
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-forest"
                checked={checked}
                onChange={() =>
                  onChange(checked ? value.filter((v) => v !== o.value) : [...value, o.value])
                }
              />
              {o.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

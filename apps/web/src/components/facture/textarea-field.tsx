'use client';

import { type TextareaHTMLAttributes, useId } from 'react';

const TEXTAREA =
  'w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/30 disabled:opacity-60';

/** Zone de texte libellée des écrans Ocall Facture. */
export function TextareaField({
  label,
  ...props
}: { label: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-charcoal">
        {label}
        {props.required && (
          <span className="ms-0.5 text-terracotta-dark" aria-hidden>
            *
          </span>
        )}
      </label>
      <textarea id={id} rows={3} className={TEXTAREA} {...props} />
    </div>
  );
}

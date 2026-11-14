'use client';

import { SITE_DEFAULT_COLOR, isAccessibleBrandColor } from '@ocall/shared';

/**
 * Couleur principale d'une vitrine (Stock, Facture), même règle que les sites Park : boutons et bandeaux
 * à texte blanc, donc une couleur assez foncée (contraste ≥ 4,5:1). null = couleur Ocall par défaut.
 */
export function BrandColorField({
  value,
  disabled,
  onChange,
  testId,
}: {
  value: string | null | undefined;
  disabled?: boolean;
  onChange: (color: string | null) => void;
  testId?: string;
}) {
  const color = value ?? SITE_DEFAULT_COLOR;
  const readable = isAccessibleBrandColor(color);
  return (
    <div className="space-y-1.5" data-testid={testId}>
      <label className="block text-sm font-medium" htmlFor="showcase-brand-color">
        Couleur principale du site
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <input
          id="showcase-brand-color"
          type="color"
          value={color}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-14 rounded-lg border border-line"
        />
        <code className="text-sm">{value ?? `${SITE_DEFAULT_COLOR} (couleur Ocall)`}</code>
        <span
          className="rounded-full px-3 py-1 text-sm font-semibold text-white"
          style={{ background: color }}
          aria-hidden
        >
          Aperçu
        </span>
        {value && !disabled && (
          <button
            type="button"
            className="text-sm font-semibold text-forest underline"
            onClick={() => onChange(null)}
          >
            Couleur Ocall
          </button>
        )}
      </div>
      {readable ? (
        <p className="text-sm text-muted">
          Boutons, bandeaux et titres du site. Texte blanc dessus.
        </p>
      ) : (
        <p className="text-sm font-medium text-terracotta" role="alert">
          Couleur trop claire : le texte blanc des boutons ne serait pas lisible. Choisissez une
          couleur plus foncée.
        </p>
      )}
    </div>
  );
}

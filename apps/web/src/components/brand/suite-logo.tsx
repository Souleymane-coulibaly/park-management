import { Logo } from './logo';

/**
 * Logo Ocall Suite (SUITE-S01).
 *
 * Le nouveau logo validé (symbole géométrique « écosystème » vert, or et terre cuite) n'est PAS
 * encore dans le dépôt : il n'est pas reproduit approximativement ici. Dès réception des fichiers,
 * les déposer dans `public/brand/ocall-suite/` (voir le README de ce dossier) et renseigner
 * `SUITE_LOGO_FILES` : le composant les affiche alors partout (en-tête, pied de page).
 * En attendant, le logo Ocall actuel du site commercial est conservé.
 */
export const SUITE_LOGO_FILES: {
  horizontalLight: string;
  horizontalDark: string;
  compact: string;
  width: number;
  height: number;
} | null = null;

export function SuiteLogo({
  inverted = false,
  compact = false,
}: {
  inverted?: boolean;
  compact?: boolean;
}) {
  if (SUITE_LOGO_FILES) {
    const src = compact
      ? SUITE_LOGO_FILES.compact
      : inverted
        ? SUITE_LOGO_FILES.horizontalDark
        : SUITE_LOGO_FILES.horizontalLight;
    return (
      // Fichier vectoriel local : pas d'optimisation nécessaire.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt="Ocall Suite"
        width={compact ? SUITE_LOGO_FILES.height : SUITE_LOGO_FILES.width}
        height={SUITE_LOGO_FILES.height}
        className="h-9 w-auto"
      />
    );
  }
  return <Logo inverted={inverted} product="Suite" />;
}

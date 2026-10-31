/** Logo Ocall Park : un soleil-vague stylisé dans un losange, motif géométrique africain. */
export function LogoMark({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <rect x="4" y="4" width="32" height="32" rx="9" transform="rotate(45 20 20)" fill="#176B53" />
      <circle cx="20" cy="16" r="5" fill="#D99B38" />
      <path
        d="M9 24c3.5-3 7.5-3 11 0s7.5 3 11 0"
        stroke="#F6F0E5"
        strokeWidth="2.4"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M12 29c2.7-2.2 5.3-2.2 8 0s5.3 2.2 8 0"
        stroke="#C46A43"
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** `product` : nom affiché après « Ocall » (Park pour l'application, Suite pour le site commercial). */
export function Logo({
  inverted = false,
  product = 'Park',
}: {
  inverted?: boolean;
  product?: 'Park' | 'Suite';
}) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark />
      <span
        className={`font-display text-lg font-bold tracking-tight ${inverted ? 'text-ivory' : 'text-charcoal'}`}
      >
        Ocall <span className={inverted ? 'text-savanna' : 'text-forest'}>{product}</span>
      </span>
    </span>
  );
}

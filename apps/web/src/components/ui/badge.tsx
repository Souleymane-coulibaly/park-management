import type { ReactNode } from 'react';

type Tone = 'forest' | 'savanna' | 'terracotta' | 'neutral';

const TONES: Record<Tone, string> = {
  forest: 'bg-forest-light text-forest-dark ring-forest/20',
  savanna: 'bg-savanna-light text-charcoal ring-savanna/40',
  terracotta: 'bg-terracotta-light text-terracotta-dark ring-terracotta/30',
  neutral: 'bg-ivory-dark/70 text-charcoal-soft ring-line',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Badge des modules futurs : ils ne sont jamais présentés comme opérationnels. */
export function UpcomingBadge() {
  return <Badge tone="savanna">À venir</Badge>;
}

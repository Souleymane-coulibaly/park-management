import type { Config } from 'tailwindcss';

/**
 * Charte Ocall Park : les couleurs sont des design tokens CSS (globals.css),
 * exposés ici sous des noms sémantiques. Ne jamais coder une couleur en dur dans un composant.
 */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        forest: {
          DEFAULT: token('forest'),
          dark: token('forest-dark'),
          light: token('forest-light'),
        },
        savanna: { DEFAULT: token('savanna'), light: token('savanna-light') },
        terracotta: {
          DEFAULT: token('terracotta'),
          dark: token('terracotta-dark'),
          light: token('terracotta-light'),
        },
        ivory: { DEFAULT: token('ivory'), dark: token('ivory-dark') },
        charcoal: { DEFAULT: token('charcoal'), soft: token('charcoal-soft') },
        surface: token('surface'),
        line: token('line'),
        muted: token('muted'),
        /**
         * Identité Ocall Suite (SUITE-S01) : palette propre au site commercial, distincte de la charte
         * des applications Park et School (aucun composant applicatif ne l'utilise).
         */
        suite: {
          green: token('suite-green'),
          'green-dark': token('suite-green-dark'),
          'green-soft': token('suite-green-soft'),
          gold: token('suite-gold'),
          'gold-soft': token('suite-gold-soft'),
          clay: token('suite-clay'),
          'clay-text': token('suite-clay-text'),
          'clay-soft': token('suite-clay-soft'),
          wine: token('suite-wine'),
          'wine-soft': token('suite-wine-soft'),
          ivory: token('suite-ivory'),
          ink: token('suite-ink'),
          'ink-soft': token('suite-ink-soft'),
        },
      },
      fontFamily: {
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-body)', 'sans-serif'],
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.125rem' },
      boxShadow: {
        card: '0 1px 2px rgb(36 53 47 / 0.04), 0 4px 16px rgb(36 53 47 / 0.06)',
        lift: '0 12px 32px rgb(36 53 47 / 0.12)',
      },
    },
  },
  plugins: [],
};

export default config;

import { ArrowRight, Building2, Globe2, ShieldCheck, Users } from 'lucide-react';
import { BusinessCard } from '@/components/public/business-cards';
import { ButtonLink } from '@/components/ui/button';

const PILLARS = [
  {
    icon: <Building2 className="h-5 w-5" />,
    title: 'Multi-établissements',
    text: 'Gérez un ou plusieurs sites depuis un seul compte, chacun avec son fuseau horaire.',
  },
  {
    icon: <Users className="h-5 w-5" />,
    title: 'Équipes nominatives',
    text: 'Chaque employé a son identifiant personnel et un rôle adapté : caisse, cuisine, entrée, supervision.',
  },
  {
    icon: <ShieldCheck className="h-5 w-5" />,
    title: 'Sécurité et traçabilité',
    text: 'Données isolées par organisation, droits par rôle et journal de chaque action sensible.',
  },
  {
    icon: <Globe2 className="h-5 w-5" />,
    title: 'Pensé pour l’Afrique',
    text: 'Prix en FCFA, interface en français, utilisable sur tablette et mobile. Lancement au Mali.',
  },
];

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden bg-forest text-ivory">
        <div className="pattern-bogolan absolute inset-0" aria-hidden />
        <div
          className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-savanna/20 blur-3xl"
          aria-hidden
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-ivory/20 bg-ivory/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-savanna">
              Parcs · Restaurants · Loisirs
            </p>
            <h1 className="text-4xl font-bold leading-[1.1] sm:text-5xl lg:text-6xl">
              Gérez votre établissement avec <span className="text-savanna">l’élégance</span> qu’il
              mérite.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-ivory/80">
              Ocall Park réunit vos établissements, vos équipes et vos accès dans un logiciel simple
              et sécurisé, conçu pour les parcs aquatiques et les restaurants africains.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/inscription" variant="accent" size="lg">
                Créer mon organisation <ArrowRight className="h-4 w-4" />
              </ButtonLink>
              <ButtonLink
                href="/tarifs"
                variant="secondary"
                size="lg"
                className="border-ivory/30 bg-transparent text-ivory hover:bg-ivory/10"
              >
                Voir les tarifs
              </ButtonLink>
            </div>
          </div>
          <HeroArt />
        </div>
        <div
          className="h-3 bg-[repeating-linear-gradient(90deg,#D99B38_0_24px,#C46A43_24px_48px,#24352F_48px_72px)]"
          aria-hidden
        />
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mb-10 max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-terracotta-dark">
            Trois métiers
          </p>
          <h2 className="mt-2 text-3xl font-bold sm:text-4xl">
            Un logiciel qui s’adapte à votre activité
          </h2>
          <p className="mt-3 text-muted">
            Vous choisissez votre métier à l’inscription : la navigation et les modules s’adaptent.
            Vous pourrez ajouter la seconde activité plus tard, sans perdre vos données.
          </p>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          <BusinessCard type="PARK" />
          <BusinessCard type="RESTAURANT" />
          <BusinessCard type="PARK_RESTAURANT" />
        </div>
      </section>

      <section className="border-y border-line/70 bg-surface">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          {PILLARS.map((p) => (
            <div key={p.title}>
              <div className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-forest-light text-forest">
                {p.icon}
              </div>
              <h3 className="font-semibold">{p.title}</h3>
              <p className="mt-1.5 text-sm text-muted">{p.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="pattern-kente relative overflow-hidden rounded-3xl bg-savanna-light/70 px-6 py-12 text-center sm:px-12">
          <h2 className="text-3xl font-bold">Prêt à structurer votre établissement ?</h2>
          <p className="mx-auto mt-3 max-w-xl text-charcoal-soft">
            Créez votre organisation en quelques minutes, ajoutez vos établissements et invitez
            votre équipe.
          </p>
          <ButtonLink href="/inscription" size="lg" className="mt-7">
            Commencer maintenant <ArrowRight className="h-4 w-4" />
          </ButtonLink>
        </div>
      </section>
    </>
  );
}

/** Illustration géométrique : soleil, vagues et losanges inspirés des tissages ouest-africains. */
function HeroArt() {
  return (
    <div className="relative mx-auto hidden aspect-square w-full max-w-md lg:block" aria-hidden>
      <svg viewBox="0 0 400 400" className="h-full w-full">
        <defs>
          <clipPath id="disc">
            <circle cx="200" cy="200" r="170" />
          </clipPath>
        </defs>
        <circle
          cx="200"
          cy="200"
          r="170"
          fill="#F6F0E5"
          fillOpacity="0.08"
          stroke="#D99B38"
          strokeOpacity="0.5"
          strokeWidth="2"
        />
        <g clipPath="url(#disc)">
          <circle cx="200" cy="150" r="62" fill="#D99B38" />
          {[0, 1, 2, 3].map((i) => (
            <path
              key={i}
              d={`M20 ${245 + i * 30} q45 -26 90 0 t90 0 t90 0 t90 0 t90 0`}
              stroke={i % 2 ? '#C46A43' : '#F6F0E5'}
              strokeWidth="9"
              fill="none"
              strokeLinecap="round"
              opacity={1 - i * 0.15}
            />
          ))}
        </g>
        {[
          [200, 18],
          [382, 200],
          [200, 382],
          [18, 200],
        ].map(([x, y]) => (
          <rect
            key={`${x}-${y}`}
            x={x! - 12}
            y={y! - 12}
            width="24"
            height="24"
            transform={`rotate(45 ${x} ${y})`}
            fill="#C46A43"
          />
        ))}
      </svg>
    </div>
  );
}

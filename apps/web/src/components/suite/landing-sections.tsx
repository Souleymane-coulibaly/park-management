import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  Building2,
  Camera,
  Check,
  Clock,
  FileText,
  GraduationCap,
  Layers,
  type LucideIcon,
  Package,
  ShieldCheck,
  Sparkles,
  Ticket,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  type BenefitIcon,
  DEMO_HREF,
  PRODUCT_STATUS_LABEL,
  type ProductIcon,
  SUITE_AI_FEATURES,
  SUITE_BENEFITS,
  SUITE_HERO_IMAGE,
  SUITE_PORTAL_POINTS,
  SUITE_PRODUCTS,
  type SuiteProduct,
  TRIAL_DAYS,
  TRIAL_HREF,
} from '@/lib/suite-landing';
import { Reveal } from './reveal';

const BENEFIT_ICONS: Record<BenefitIcon, LucideIcon> = {
  clock: Clock,
  ai: Sparkles,
  shield: ShieldCheck,
  growth: TrendingUp,
};
const PRODUCT_ICONS: Record<ProductIcon, LucideIcon> = {
  school: GraduationCap,
  park: Ticket,
  invoice: FileText,
  stock: Package,
};
/** Pastilles d'icônes par ton (or : icône encre, jamais de texte or sur fond clair). */
const TONE_TILE = {
  green: 'bg-suite-green text-suite-ivory',
  clay: 'bg-suite-clay text-suite-ivory',
  wine: 'bg-suite-wine text-suite-ivory',
  gold: 'bg-suite-gold text-suite-ink',
} as const;
const TONE_SOFT = {
  green: 'bg-suite-green-soft',
  clay: 'bg-suite-clay-soft',
  wine: 'bg-suite-wine-soft',
  gold: 'bg-suite-gold-soft',
} as const;

/** Bouton-lien de la page d'accueil (aucun faux service : seulement des routes existantes). */
function Cta({
  href,
  children,
  variant = 'primary',
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'gold' | 'outline' | 'light';
}) {
  const styles = {
    primary: 'bg-suite-green text-suite-ivory hover:bg-suite-green-dark shadow-sm',
    gold: 'bg-suite-gold text-suite-ink hover:brightness-95 shadow-sm',
    outline: 'border-2 border-suite-green text-suite-green hover:bg-suite-green-soft',
    light: 'bg-suite-ivory text-suite-green hover:bg-white',
  }[variant];
  return (
    <Link
      href={href}
      className={`group inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition focus-visible:ring-2 focus-visible:ring-suite-gold focus-visible:ring-offset-2 motion-safe:hover:-translate-y-0.5 ${styles}`}
    >
      {children}
    </Link>
  );
}

function Frieze({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`suite-frieze h-2.5 opacity-80 ${className}`} />;
}

// ─── Hero ───

export function SuiteHero() {
  const rise = 'motion-safe:animate-[suite-rise_0.8s_cubic-bezier(0.2,0.7,0.2,1)_both]';
  return (
    <section className="relative overflow-hidden bg-suite-ivory">
      <div aria-hidden className="suite-pattern absolute inset-y-0 right-0 hidden w-1/2 lg:block" />
      <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 pb-14 pt-10 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pb-20 lg:pt-16">
        <div>
          <p
            className={`inline-flex items-center gap-2 rounded-full bg-suite-gold-soft px-3 py-1 text-xs font-semibold text-suite-ink ${rise}`}
          >
            <span aria-hidden className="h-2 w-2 rounded-full bg-suite-clay" />
            Suite de logiciels de gestion pour l’Afrique
          </p>
          <h1
            className={`mt-5 font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-suite-green sm:text-5xl lg:text-6xl ${rise}`}
            style={{ animationDelay: '80ms' }}
          >
            Gérez moins.
            <span className="block text-suite-clay">Développez plus.</span>
          </h1>
          <p
            className={`mt-5 max-w-xl text-lg text-suite-ink ${rise}`}
            style={{ animationDelay: '180ms' }}
          >
            Des logiciels intelligents pour gagner du temps, sécuriser vos activités et développer
            vos revenus.
          </p>
          <p
            className={`mt-3 max-w-xl text-suite-ink-soft ${rise}`}
            style={{ animationDelay: '240ms' }}
          >
            Éducation, restauration, loisirs et gestion commerciale : choisissez les solutions
            adaptées à votre métier.
          </p>
          <div
            className={`mt-7 flex flex-col gap-3 sm:flex-row ${rise}`}
            style={{ animationDelay: '320ms' }}
          >
            <Cta href="#logiciels">
              Découvrir nos solutions
              <ArrowRight
                className="h-4 w-4 transition-transform motion-safe:group-hover:translate-x-0.5"
                aria-hidden
              />
            </Cta>
            <Cta href={DEMO_HREF} variant="gold">
              Demander une démonstration
            </Cta>
          </div>
          <p
            className={`mt-4 text-sm text-suite-ink-soft ${rise}`}
            style={{ animationDelay: '380ms' }}
          >
            Essai gratuit de {TRIAL_DAYS} jours pour les logiciels éligibles, sans carte bancaire.{' '}
            <Link
              href={TRIAL_HREF}
              className="font-semibold text-suite-green underline-offset-2 hover:underline"
            >
              Demander mon essai
            </Link>
          </p>
        </div>
        <HeroVisual />
      </div>
      <Frieze />
    </section>
  );
}

function HeroVisual() {
  const chips: { icon: LucideIcon; title: string; text: string; tile: string; pos: string }[] = [
    {
      icon: Layers,
      title: 'Plusieurs métiers',
      text: 'Une suite de logiciels',
      tile: TONE_TILE.green,
      pos: 'left-0 top-6 sm:-left-4',
    },
    {
      icon: Sparkles,
      title: 'IA Ocall',
      text: 'Assistants intégrés',
      tile: TONE_TILE.clay,
      pos: 'right-0 top-1/3 sm:-right-4',
    },
    {
      icon: ShieldCheck,
      title: 'Données protégées',
      text: 'Accès par rôle',
      tile: TONE_TILE.wine,
      pos: 'bottom-6 left-4 sm:left-8',
    },
  ];
  return (
    <div className="relative mx-auto w-full max-w-lg lg:max-w-none">
      <div className="relative aspect-[4/3.4] overflow-hidden rounded-[2rem] border border-suite-gold/30 bg-suite-green shadow-[0_24px_60px_rgb(8_107_58/0.25)]">
        <div aria-hidden className="suite-pattern-dark absolute inset-0" />
        <div
          aria-hidden
          className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-suite-gold/25"
        />
        <div
          aria-hidden
          className="absolute -bottom-20 -left-10 h-64 w-64 rounded-full bg-suite-clay/25"
        />
        {SUITE_HERO_IMAGE ? (
          <Image
            src={SUITE_HERO_IMAGE.src}
            alt={SUITE_HERO_IMAGE.alt}
            fill
            priority
            sizes="(min-width: 1024px) 560px, 100vw"
            className="object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <div className="rounded-2xl border border-dashed border-suite-ivory/40 bg-suite-ivory/5 px-6 py-8 text-center text-suite-ivory">
              <Camera className="mx-auto h-8 w-8 text-suite-gold" aria-hidden />
              <p className="mt-3 text-sm font-semibold">Emplacement photo</p>
              <p className="mt-1 max-w-[16rem] text-xs text-suite-ivory/75">
                Photographie professionnelle sous licence à intégrer : entrepreneur ou responsable
                africain utilisant un ordinateur.
              </p>
            </div>
          </div>
        )}
      </div>
      {chips.map((c, i) => (
        <div
          key={c.title}
          className={`absolute ${c.pos} hidden items-center gap-3 rounded-2xl border border-suite-gold/20 bg-white/95 p-3 pr-4 shadow-lg backdrop-blur sm:flex motion-safe:animate-[suite-rise_0.8s_cubic-bezier(0.2,0.7,0.2,1)_both]`}
          style={{ animationDelay: `${450 + i * 120}ms` }}
        >
          <span className={`grid h-10 w-10 place-items-center rounded-xl ${c.tile}`}>
            <c.icon className="h-5 w-5" aria-hidden />
          </span>
          <span>
            <span className="block text-sm font-bold text-suite-ink">{c.title}</span>
            <span className="block text-xs text-suite-ink-soft">{c.text}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Bénéfices ───

export function SuiteBenefits() {
  return (
    <section aria-labelledby="benefices" className="bg-white">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <h2 id="benefices" className="sr-only">
          Ce qu’Ocall Suite vous apporte
        </h2>
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {SUITE_BENEFITS.map((b, i) => {
            const Icon = BENEFIT_ICONS[b.icon];
            return (
              <li key={b.title}>
                <Reveal delay={i * 90} className="h-full">
                  <div className="group h-full rounded-2xl border border-suite-ink/5 bg-suite-ivory p-5 transition motion-safe:hover:-translate-y-1 hover:shadow-lift">
                    <span
                      className={`grid h-12 w-12 place-items-center rounded-2xl ${TONE_TILE[b.tone]} transition-transform motion-safe:group-hover:scale-105`}
                    >
                      <Icon className="h-6 w-6" aria-hidden />
                    </span>
                    <h3 className="mt-4 text-lg font-bold text-suite-ink">{b.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-suite-ink-soft">{b.text}</p>
                  </div>
                </Reveal>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

// ─── Catalogue ───

function SectionTitle({
  id,
  kicker,
  title,
  text,
}: {
  id: string;
  kicker: string;
  title: string;
  text?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-semibold uppercase tracking-wider text-suite-clay-text">
        {kicker}
      </p>
      <h2 id={id} className="mt-2 font-display text-3xl font-extrabold text-suite-ink sm:text-4xl">
        {title}
      </h2>
      {text && <p className="mt-3 text-suite-ink-soft">{text}</p>}
    </div>
  );
}

function ProductCard({ p }: { p: SuiteProduct }) {
  const Icon = PRODUCT_ICONS[p.icon];
  const soon = p.status === 'soon';
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-3xl border border-suite-ink/5 bg-white shadow-card transition motion-safe:hover:-translate-y-1 hover:shadow-lift">
      <div className={`relative px-5 pb-5 pt-6 ${TONE_SOFT[p.tone]}`}>
        <div aria-hidden className="suite-pattern absolute inset-0 opacity-60" />
        <div className="relative flex items-start justify-between gap-3">
          <span
            className={`grid h-14 w-14 place-items-center rounded-2xl ${TONE_TILE[p.tone]} shadow-sm`}
          >
            <Icon className="h-7 w-7" aria-hidden />
          </span>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${soon ? 'bg-white text-suite-ink-soft' : p.status === 'available' ? 'bg-suite-green text-suite-ivory' : 'bg-suite-gold text-suite-ink'}`}
          >
            {PRODUCT_STATUS_LABEL[p.status]}
          </span>
        </div>
        <h3 className="relative mt-4 font-display text-2xl font-extrabold text-suite-ink">
          {p.name}
        </h3>
        <p className="relative mt-1 text-sm text-suite-ink-soft">{p.tagline}</p>
      </div>
      {p.image && (
        <div className="relative aspect-[16/9] border-y border-suite-ink/5 bg-suite-ivory">
          <Image
            src={p.image.src}
            alt={p.image.alt}
            fill
            sizes="(min-width: 1024px) 280px, 100vw"
            className="object-cover object-top"
            loading="lazy"
          />
        </div>
      )}
      <div className="flex flex-1 flex-col p-5">
        <ul className="space-y-2 text-sm text-suite-ink">
          {p.features.map((f) => (
            <li key={f} className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-suite-green" aria-hidden />
              {f}
            </li>
          ))}
        </ul>
        {p.ai && (
          <p className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-full bg-suite-clay-soft px-2.5 py-1 text-xs font-semibold text-suite-clay-text">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Fonctionnalités IA disponibles
          </p>
        )}
        <div className="mt-auto pt-6">
          {p.href && p.cta ? (
            <Link
              href={p.href}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-suite-green px-4 py-2.5 text-sm font-semibold text-suite-ivory transition hover:bg-suite-green-dark focus-visible:ring-2 focus-visible:ring-suite-gold focus-visible:ring-offset-2"
            >
              {p.cta}
              <span className="sr-only"> : {p.name}</span>
              <ArrowRight
                className="h-4 w-4 transition-transform motion-safe:group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          ) : (
            <p className="text-sm font-medium text-suite-ink-soft">Lancement en préparation.</p>
          )}
        </div>
      </div>
    </article>
  );
}

export function SuiteProducts() {
  return (
    <section
      id="logiciels"
      aria-labelledby="logiciels-titre"
      className="scroll-mt-20 bg-suite-ivory"
    >
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <SectionTitle
          id="logiciels-titre"
          kicker="Écosystème Ocall"
          title="Les logiciels de l’écosystème Ocall"
          text="Chaque logiciel est indépendant et répond à un métier. Les tarifs sont présentés sur la page de chaque solution."
        />
        <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {SUITE_PRODUCTS.map((p, i) => (
            <li key={p.slug}>
              <Reveal delay={i * 90} className="h-full">
                <ProductCard p={p} />
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ─── Ocall IA ───

export function SuiteAi() {
  const products = [...new Set(SUITE_AI_FEATURES.map((f) => f.product))];
  return (
    <section
      id="ia"
      aria-labelledby="ia-titre"
      className="scroll-mt-20 relative overflow-hidden bg-suite-green text-suite-ivory"
    >
      <div aria-hidden className="suite-pattern-dark absolute inset-0" />
      <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <Reveal>
          <p className="inline-flex items-center gap-2 rounded-full bg-suite-ivory/10 px-3 py-1 text-xs font-semibold text-suite-gold">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            IA Ocall
          </p>
          <h2
            id="ia-titre"
            className="mt-4 font-display text-3xl font-extrabold leading-tight sm:text-4xl"
          >
            L’intelligence artificielle qui vous aide à avancer.
          </h2>
          <p className="mt-4 text-suite-ivory/85">
            Des assistants intégrés à chaque logiciel, au service de votre gestion. Les propositions
            de l’IA restent toujours vérifiées et validées par vos équipes.
          </p>
          <p className="mt-3 text-sm text-suite-ivory/70">
            Fonctionnalités disponibles aujourd’hui dans Ocall School et Ocall Park, selon votre
            abonnement.
          </p>
        </Reveal>
        <div className="grid gap-4 sm:grid-cols-2">
          {products.map((product, pi) => (
            <Reveal key={product} delay={pi * 120}>
              <div className="h-full rounded-2xl border border-suite-ivory/15 bg-suite-ivory/[0.06] p-5 backdrop-blur-sm">
                <p className="text-sm font-bold text-suite-gold">{product}</p>
                <ul className="mt-3 space-y-3">
                  {SUITE_AI_FEATURES.filter((f) => f.product === product).map((f) => (
                    <li key={f.title}>
                      <p className="font-semibold">{f.title}</p>
                      <p className="text-sm text-suite-ivory/75">{f.text}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Portail central (vision) ───

function PortalPreview() {
  const menu: { icon: LucideIcon; label: string }[] = [
    { icon: Layers, label: 'Accueil' },
    { icon: Building2, label: 'Organisations' },
    { icon: Package, label: 'Mes logiciels' },
    { icon: FileText, label: 'Contrats' },
    { icon: Users, label: 'Utilisateurs' },
  ];
  return (
    <figure className="relative">
      <div
        role="img"
        aria-label="Aperçu conceptuel du futur portail Ocall Suite : menu latéral et tableau de bord, sans données réelles."
        className="overflow-hidden rounded-2xl border border-suite-ink/10 bg-white shadow-lift"
      >
        <div className="flex items-center gap-1.5 border-b border-suite-ink/5 bg-suite-ivory px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-suite-clay/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-suite-gold/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-suite-green/70" />
        </div>
        <div className="grid grid-cols-[8.5rem_1fr] sm:grid-cols-[10rem_1fr]">
          <div className="bg-suite-green p-3 text-suite-ivory">
            <p className="mb-3 text-xs font-bold">Ocall Suite</p>
            <ul className="space-y-1">
              {menu.map((m, i) => (
                <li
                  key={m.label}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] ${i === 0 ? 'bg-suite-gold font-semibold text-suite-ink' : 'text-suite-ivory/85'}`}
                >
                  <m.icon className="h-3.5 w-3.5" aria-hidden />
                  {m.label}
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-3 p-4" aria-hidden>
            <div className="h-3 w-2/5 rounded bg-suite-ink/15" />
            <div className="grid grid-cols-3 gap-2">
              {['bg-suite-green-soft', 'bg-suite-gold-soft', 'bg-suite-clay-soft'].map((c) => (
                <div key={c} className={`h-14 rounded-xl ${c}`} />
              ))}
            </div>
            <div className="flex h-24 items-end gap-1.5 rounded-xl bg-suite-ivory p-3">
              {[40, 55, 45, 70, 62, 80, 74].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t bg-suite-green/70"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
            <div className="space-y-1.5">
              <div className="h-2.5 w-full rounded bg-suite-ink/10" />
              <div className="h-2.5 w-4/5 rounded bg-suite-ink/10" />
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 inline-flex items-center gap-2 rounded-full bg-suite-gold-soft px-3 py-1 text-xs font-semibold text-suite-ink">
        <BarChart3 className="h-3.5 w-3.5" aria-hidden />
        Aperçu conceptuel — portail en cours de développement
      </figcaption>
    </figure>
  );
}

export function SuitePortal() {
  return (
    <section aria-labelledby="portail-titre" className="bg-white">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2">
        <Reveal className="order-2 lg:order-1">
          <PortalPreview />
        </Reveal>
        <Reveal className="order-1 lg:order-2" delay={100}>
          <p className="text-sm font-semibold uppercase tracking-wider text-suite-clay-text">
            Portail Ocall Suite
          </p>
          <h2
            id="portail-titre"
            className="mt-2 font-display text-3xl font-extrabold text-suite-ink sm:text-4xl"
          >
            Tous vos logiciels. Un seul espace de gestion.
          </h2>
          <p className="mt-4 text-suite-ink-soft">
            Notre vision : un portail central pour piloter vos organisations et vos logiciels Ocall.
            Il est en cours de construction et ouvrira progressivement.
          </p>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {SUITE_PORTAL_POINTS.map((point) => (
              <li key={point} className="flex gap-2 text-sm text-suite-ink">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-suite-green" aria-hidden />
                {point}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

// ─── Essai gratuit ───

export function SuiteTrial() {
  return (
    <section aria-labelledby="essai-titre" className="bg-suite-ivory px-4 pb-16 sm:px-6">
      <Reveal>
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-suite-wine px-6 py-12 text-suite-ivory sm:px-12">
          <div aria-hidden className="suite-pattern-dark absolute inset-0" />
          <div
            aria-hidden
            className="absolute -right-10 -top-24 h-64 w-64 rounded-full bg-suite-gold/20"
          />
          <div className="relative grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-center">
            <div>
              <h2 id="essai-titre" className="font-display text-3xl font-extrabold sm:text-4xl">
                Découvrez Ocall Suite à votre rythme.
              </h2>
              <p className="mt-4 max-w-xl text-suite-ivory/85">
                Testez nos applications éligibles pendant {TRIAL_DAYS} jours et découvrez comment
                elles peuvent simplifier votre activité.
              </p>
              <ul className="mt-5 space-y-2 text-sm text-suite-ivory/90">
                <li className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-suite-gold" aria-hidden />
                  {TRIAL_DAYS} jours par organisation et par application
                </li>
                <li className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-suite-gold" aria-hidden />
                  Aucun paiement bancaire exigé
                </li>
                <li className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-suite-gold" aria-hidden />
                  Accès activé par l’équipe Ocall après votre demande
                </li>
              </ul>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col lg:items-end">
              <Cta href={TRIAL_HREF} variant="gold">
                Essayer gratuitement
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Cta>
              <Cta href="/contact" variant="light">
                Nous contacter
              </Cta>
              <Cta href="/devenir-partenaire" variant="light">
                Devenir partenaire
              </Cta>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

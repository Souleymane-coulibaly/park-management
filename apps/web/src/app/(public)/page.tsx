import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  Cloud,
  Headphones,
  Lock,
  Smartphone,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { ButtonLink } from '@/components/ui/button';
import { type PublicProduct, loadCatalog, productIcon } from '@/lib/suite-catalog';

export const revalidate = 300;

const ADVANTAGES = [
  {
    icon: Smartphone,
    title: 'Pensé pour le mobile',
    text: 'Sur ordinateur, tablette ou téléphone, même avec une connexion 4G.',
  },
  {
    icon: Wallet,
    title: 'Prix clairs en FCFA',
    text: 'Une mise en service puis un abonnement mensuel. Aucun prélèvement automatique.',
  },
  {
    icon: Lock,
    title: 'Vos données protégées',
    text: 'Chaque entreprise ne voit que ses propres données. Accès par rôle, actions journalisées.',
  },
  {
    icon: Sparkles,
    title: 'Une IA qui aide',
    text: 'Un copilote qui répond à partir de vos chiffres, sans rien inventer ni rien modifier.',
  },
  {
    icon: Headphones,
    title: 'Un accompagnement local',
    text: 'Installation, formation des équipes et support depuis l’application.',
  },
  {
    icon: Cloud,
    title: 'Toujours à jour',
    text: 'Logiciel en ligne : pas d’installation lourde, des améliorations régulières.',
  },
];

const STEPS = [
  {
    title: 'Démonstration',
    text: 'Nous découvrons votre activité et vous montrons la solution adaptée.',
  },
  {
    title: 'Mise en service',
    text: 'Configuration de vos établissements, de vos produits et de vos équipes.',
  },
  {
    title: 'Formation et suivi',
    text: 'Vos équipes sont formées ; le support Ocall reste disponible.',
  },
];

function ProductCard({ p }: { p: PublicProduct }) {
  const Icon = productIcon(p.slug);
  const live = p.status === 'ACTIVE';
  return (
    <Link
      href={`/solutions/${p.slug}`}
      className="group flex h-full flex-col rounded-2xl border border-line/80 bg-surface p-5 shadow-card transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-forest"
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={`grid h-11 w-11 place-items-center rounded-xl ${live ? 'bg-forest text-ivory' : 'bg-savanna-light text-charcoal'}`}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${live ? 'bg-forest/10 text-forest' : 'bg-savanna-light text-charcoal'}`}
        >
          {p.statusLabel}
        </span>
      </div>
      <h3 className="mt-4 font-display text-lg font-bold">{p.name}</h3>
      <p className="mt-1 flex-1 text-sm text-muted">{p.tagline}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-forest">
        Découvrir{' '}
        <ArrowRight
          className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </span>
    </Link>
  );
}

export default async function HomePage() {
  const catalog = await loadCatalog();
  return (
    <>
      {/* ─── Hero ─── */}
      <section className="relative overflow-hidden bg-forest text-ivory">
        <div className="pattern-kente absolute inset-0 opacity-10" aria-hidden />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-savanna">
              Ocall Suite
            </p>
            <h1 className="mt-3 font-display text-4xl font-bold leading-tight sm:text-5xl">
              Les logiciels de gestion des entreprises africaines
            </h1>
            <p className="mt-5 max-w-xl text-lg text-ivory/85">
              Une suite d’applications spécialisées, simples et en ligne, pour piloter votre
              activité au quotidien : ventes, clients, équipes et chiffres.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/demo" variant="accent">
                Demander une démonstration
              </ButtonLink>
              <ButtonLink href="/solutions" variant="secondary">
                Voir nos solutions
              </ButtonLink>
            </div>
          </div>
          <ul className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-1">
            {[
              'Parcs aquatiques et loisirs',
              'Restaurants',
              'Bientôt : écoles, cliniques, RH, solaire, documents',
            ].map((t) => (
              <li
                key={t}
                className="flex items-center gap-3 rounded-xl bg-ivory/10 px-4 py-3 backdrop-blur"
              >
                <CheckCircle2 className="h-5 w-5 shrink-0 text-savanna" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ─── Proposition de valeur ─── */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="max-w-3xl">
          <h2 className="font-display text-3xl font-bold">Un métier, une application dédiée</h2>
          <p className="mt-3 text-muted">
            Chaque solution Ocall est conçue pour un métier précis, avec ses propres règles. Elles
            partagent les mêmes fondations : comptes sécurisés, abonnements en FCFA, support et
            mises à jour.
          </p>
        </div>
        {catalog ? (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {catalog.map((p) => (
              <ProductCard key={p.slug} p={p} />
            ))}
          </div>
        ) : (
          <p className="mt-8 text-sm text-muted">
            Le catalogue est momentanément indisponible.{' '}
            <Link className="underline" href="/solutions">
              Réessayer
            </Link>
          </p>
        )}
      </section>

      {/* ─── Avantages ─── */}
      <section className="bg-ivory-dark/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="font-display text-3xl font-bold">Pourquoi Ocall Suite</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ADVANTAGES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-2xl bg-surface p-5 shadow-card">
                <Icon className="h-6 w-6 text-terracotta-dark" aria-hidden />
                <h3 className="mt-3 font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-muted">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Fonctionnement ─── */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="font-display text-3xl font-bold">Comment ça marche</h2>
        <ol className="mt-8 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-2xl border border-line/80 p-5">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-savanna font-display font-bold text-charcoal">
                {i + 1}
              </span>
              <h3 className="mt-3 font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ─── Appel à l'action ─── */}
      <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <div className="rounded-3xl bg-charcoal px-6 py-10 text-ivory sm:px-10">
          <h2 className="font-display text-2xl font-bold sm:text-3xl">Parlons de votre activité</h2>
          <p className="mt-2 max-w-2xl text-ivory/80">
            Une démonstration gratuite, sans engagement, pour voir si Ocall correspond à vos
            besoins.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink href="/demo" variant="accent">
              Demander une démonstration
            </ButtonLink>
            <ButtonLink href="/tarifs" variant="secondary">
              Voir les tarifs
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}

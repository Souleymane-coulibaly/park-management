import Link from 'next/link';
import { Logo } from '@/components/brand/logo';

export function SiteFooter() {
  return (
    <footer className="pattern-bogolan bg-charcoal text-ivory/80">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[2fr_1fr_1fr]">
        <div>
          <Logo inverted />
          <p className="mt-3 max-w-sm text-sm">
            Le logiciel de gestion des parcs aquatiques, espaces de loisirs et restaurants, conçu
            pour l’Afrique de l’Ouest. Disponible d’abord au Mali.
          </p>
        </div>
        <div>
          <p className="mb-3 text-sm font-semibold text-ivory">Produit</p>
          <ul className="space-y-2 text-sm">
            <li>
              <Link href="/metiers" className="hover:text-savanna">
                Métiers
              </Link>
            </li>
            <li>
              <Link href="/fonctionnalites" className="hover:text-savanna">
                Fonctionnalités
              </Link>
            </li>
            <li>
              <Link href="/tarifs" className="hover:text-savanna">
                Tarifs
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <p className="mb-3 text-sm font-semibold text-ivory">Compte</p>
          <ul className="space-y-2 text-sm">
            <li>
              <Link href="/connexion" className="hover:text-savanna">
                Connexion
              </Link>
            </li>
            <li>
              <Link href="/inscription" className="hover:text-savanna">
                Créer une organisation
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-ivory/10 py-4 text-center text-xs text-ivory/60">
        © {new Date().getFullYear()} Ocall Park · Prix en FCFA (XOF)
      </div>
    </footer>
  );
}

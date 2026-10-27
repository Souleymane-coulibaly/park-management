import { LogoMark } from '@/components/brand/logo';
import { ButtonLink } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="pattern-kente grid min-h-screen place-items-center px-4">
      <div className="max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-card">
        <LogoMark className="mx-auto h-14 w-14" />
        <h1 className="mt-4 text-2xl font-bold">Page introuvable</h1>
        <p className="mt-2 text-muted">La page demandée n’existe pas ou a été déplacée.</p>
        <ButtonLink href="/" className="mt-6">
          Retour à l’accueil
        </ButtonLink>
      </div>
    </main>
  );
}

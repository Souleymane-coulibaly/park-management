import { permanentRedirect } from 'next/navigation';

/** Ancienne page « Fonctionnalités » d'Ocall Park : remplacée par la page produit. */
export default function FonctionnalitesPage() {
  permanentRedirect('/solutions/ocall-park');
}

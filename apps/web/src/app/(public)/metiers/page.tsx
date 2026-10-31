import { permanentRedirect } from 'next/navigation';

/** Ancienne page « Métiers » d'Ocall Park : remplacée par le catalogue Ocall Suite. */
export default function MetiersPage() {
  permanentRedirect('/solutions');
}

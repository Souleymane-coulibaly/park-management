import { redirect } from 'next/navigation';

/** La borne vit hors de l'espace d'administration : /app/kiosk renvoie vers /kiosk. */
export default function KioskShortcut() {
  redirect('/kiosk');
}

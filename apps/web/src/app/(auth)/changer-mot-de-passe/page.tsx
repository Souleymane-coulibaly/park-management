import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession, homeFor } from '@/lib/server-api';
import { ForcedPasswordChange } from './forced-password-change';

export const metadata: Metadata = { title: 'Changer votre mot de passe' };

/** Écran imposé tant que le mot de passe initial (temporaire) n'a pas été changé. */
export default async function ChangerMotDePassePage() {
  const me = await getSession();
  if (!me) redirect('/connexion');
  if (!me.user.mustChangePassword) redirect(homeFor(me));
  return (
    <ForcedPasswordChange
      firstName={me.user.firstName}
      loginId={me.user.loginId}
      destination={homeFor(me)}
    />
  );
}

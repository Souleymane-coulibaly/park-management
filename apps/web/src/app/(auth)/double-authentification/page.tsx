import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession, homeFor } from '@/lib/server-api';
import { MfaForm } from './mfa-form';

export const metadata: Metadata = { title: 'Double authentification' };

/** Second facteur des comptes internes Ocall et des partenaires : enrôlement ou vérification. */
export default async function DoubleAuthentificationPage() {
  const me = await getSession();
  if (!me) redirect('/connexion');
  if (me.accountKind === 'member') redirect('/app');
  if (me.user.mustChangePassword) redirect('/changer-mot-de-passe');
  if (me.mfa.verified) redirect(homeFor(me));
  return (
    <MfaForm
      enrolled={me.mfa.enrolled}
      account={me.user.email ?? me.user.loginId}
      home={homeFor(me)}
    />
  );
}

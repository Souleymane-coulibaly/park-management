import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SignupForm } from './signup-form';

export const metadata: Metadata = { title: 'Créer une organisation' };

export default function InscriptionPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}

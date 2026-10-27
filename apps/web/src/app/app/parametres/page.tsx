'use client';

import Link from 'next/link';
import {
  Building,
  Building2,
  ChevronRight,
  CreditCard,
  History,
  KeyRound,
  ShieldCheck,
  UserCog,
} from 'lucide-react';
import type { Permission } from '@ocall/shared';
import type { ReactNode } from 'react';
import { useSession } from '@/components/app/session-context';
import { PageHeader } from '@/components/ui/page-header';

const SECTIONS: {
  href: string;
  title: string;
  description: string;
  icon: ReactNode;
  permission?: Permission;
}[] = [
  {
    href: '/app/organisation',
    title: 'Organisation',
    description: 'Nom commercial, fuseau horaire et métier.',
    icon: <Building className="h-5 w-5" />,
    permission: 'organization.read',
  },
  {
    href: '/app/etablissements',
    title: 'Établissements',
    description: 'Vos sites, leurs activités et coordonnées.',
    icon: <Building2 className="h-5 w-5" />,
    permission: 'establishment.read',
  },
  {
    href: '/app/roles',
    title: 'Rôles et permissions',
    description: 'Ce que chaque rôle peut faire.',
    icon: <ShieldCheck className="h-5 w-5" />,
    permission: 'role.read',
  },
  {
    href: '/app/abonnement',
    title: 'Abonnement',
    description: 'Offre souscrite et statut.',
    icon: <CreditCard className="h-5 w-5" />,
    permission: 'subscription.read',
  },
  {
    href: '/app/journal',
    title: 'Journal d’audit',
    description: 'Historique des actions sensibles.',
    icon: <History className="h-5 w-5" />,
    permission: 'audit.read',
  },
  {
    href: '/app/compte',
    title: 'Mon compte',
    description: 'Profil et mot de passe.',
    icon: <UserCog className="h-5 w-5" />,
  },
];

export default function ParametresPage() {
  const me = useSession();
  const visible = SECTIONS.filter((s) => !s.permission || me.permissions.includes(s.permission));
  return (
    <>
      <PageHeader
        title="Paramètres"
        description="Configuration de votre organisation et de votre compte."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {visible.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="group flex items-center gap-4 rounded-2xl border border-line/80 bg-surface p-5 shadow-card transition-shadow hover:shadow-lift"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-forest-light text-forest">
              {s.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{s.title}</span>
              <span className="block text-sm text-muted">{s.description}</span>
            </span>
            <ChevronRight
              className="h-5 w-5 text-muted transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
        ))}
      </div>
      <p className="mt-6 flex items-center gap-2 text-sm text-muted">
        <KeyRound className="h-4 w-4" aria-hidden /> Votre identifiant personnel :{' '}
        <span className="font-mono font-semibold text-charcoal">{me.user.loginId}</span>
      </p>
    </>
  );
}

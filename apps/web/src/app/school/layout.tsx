import Link from 'next/link';
import type { ReactNode } from 'react';
import { AppShell, type NavItem } from '@/components/app/app-shell';
import { requireMemberSession } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

const NAV: NavItem[] = [
  { key: 'school-home', label: 'Tableau de bord', href: '/school' },
  { key: 'school-students', label: 'Élèves', href: '/school/eleves' },
  { key: 'school-enrollments', label: 'Inscriptions', href: '/school/inscriptions' },
  { key: 'school-guardians', label: 'Responsables', href: '/school/responsables' },
  { key: 'school-rosters', label: 'Classes et effectifs', href: '/school/effectifs' },
  { key: 'school-classes', label: 'Fiches de classe', href: '/school/classes' },
  { key: 'school-teachers', label: 'Enseignants', href: '/school/enseignants' },
  { key: 'school-mine', label: 'Mes classes', href: '/school/mes-classes' },
  { key: 'school-evaluations', label: 'Évaluations', href: '/school/evaluations' },
  { key: 'school-results', label: 'Résultats et moyennes', href: '/school/resultats' },
  { key: 'school-rankings', label: 'Classements', href: '/school/classements' },
  { key: 'school-report-cards', label: 'Bulletins scolaires', href: '/school/bulletins' },
  { key: 'school-quran', label: 'Mémorisation du Coran', href: '/school/coran' },
  { key: 'school-imports', label: 'Importer des élèves', href: '/school/imports' },
  { key: 'school-schools', label: 'Établissements', href: '/school/etablissements' },
  { key: 'school-years', label: 'Années et périodes', href: '/school/annees' },
  { key: 'school-periods', label: 'Périodes scolaires', href: '/school/periodes' },
  { key: 'school-structure', label: 'Cycles et classes', href: '/school/structure' },
  { key: 'school-subjects', label: 'Matières', href: '/school/matieres' },
  { key: 'school-grading', label: 'Règles de notation', href: '/school/notation' },
  {
    key: 'school-student-settings',
    label: 'Réglages des dossiers',
    href: '/school/reglages-eleves',
  },
  { key: 'school-team', label: 'Équipe', href: '/school/equipe' },
];

/** Application Ocall School. Le droit d'accès réel est décidé par l'API à chaque requête. */
export default async function SchoolLayout({ children }: { children: ReactNode }) {
  const me = await requireMemberSession();
  return (
    <AppShell
      me={me}
      nav={NAV}
      context={{ title: me.organization!.name, subtitle: 'Ocall School' }}
      homeHref="/school"
      accountHref="/school/compte"
      headerNote={
        <Link href="/suite" className="font-medium text-forest hover:underline">
          Mes applications
        </Link>
      }
    >
      {children}
    </AppShell>
  );
}

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
  { key: 'school-portal', label: 'Portail parents', href: '/school/portail-parents' },
  { key: 'school-attendance', label: 'Appel des élèves', href: '/school/presences' },
  {
    key: 'school-justifications',
    label: 'Justificatifs d’absence',
    href: '/school/presences/justificatifs',
  },
  { key: 'school-communication', label: 'Communication', href: '/school/communication' },
  { key: 'school-rosters', label: 'Classes et effectifs', href: '/school/effectifs' },
  { key: 'school-classes', label: 'Fiches de classe', href: '/school/classes' },
  { key: 'school-teachers', label: 'Enseignants', href: '/school/enseignants' },
  { key: 'school-mine', label: 'Mes classes', href: '/school/mes-classes' },
  { key: 'school-evaluations', label: 'Évaluations', href: '/school/evaluations' },
  { key: 'school-results', label: 'Résultats et moyennes', href: '/school/resultats' },
  { key: 'school-rankings', label: 'Classements', href: '/school/classements' },
  { key: 'school-report-cards', label: 'Bulletins scolaires', href: '/school/bulletins' },
  { key: 'school-publications', label: 'Résultats publiés', href: '/school/publications' },
  { key: 'school-quran', label: 'Mémorisation du Coran', href: '/school/coran' },
  { key: 'school-finance', label: 'Tableau de bord financier', href: '/school/finances' },
  { key: 'school-cash', label: 'Encaissement en caisse', href: '/school/finances/caisse' },
  {
    key: 'school-finance-students',
    label: 'Situation des élèves',
    href: '/school/finances/eleves',
  },
  { key: 'school-payments', label: 'Historique des paiements', href: '/school/finances/paiements' },
  { key: 'school-receipts', label: 'Reçus', href: '/school/finances/recus' },
  { key: 'school-unpaid', label: 'Impayés', href: '/school/finances/impayes' },
  { key: 'school-benefits', label: 'Réductions et bourses', href: '/school/finances/reductions' },
  { key: 'school-fees', label: 'Catalogue des frais', href: '/school/finances/frais' },
  { key: 'school-schedules', label: 'Échéanciers', href: '/school/finances/echeanciers' },
  {
    key: 'school-finance-settings',
    label: 'Paramètres financiers',
    href: '/school/finances/parametres',
  },
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

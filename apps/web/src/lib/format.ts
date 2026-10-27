const dateFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});
const dateTimeFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export const formatDate = (iso: string | null) => (iso ? dateFormatter.format(new Date(iso)) : '—');
export const formatDateTime = (iso: string | null) =>
  iso ? dateTimeFormatter.format(new Date(iso)) : '—';

/** Libellés lisibles des actions du journal d'audit. */
const ACTION_LABELS: Record<string, string> = {
  'organization.created': 'Organisation créée',
  'organization.updated': 'Organisation modifiée',
  'organization.business_type_changed': 'Métier modifié',
  'establishment.created': 'Établissement créé',
  'establishment.updated': 'Établissement modifié',
  'establishment.deactivated': 'Établissement désactivé',
  'establishment.reactivated': 'Établissement réactivé',
  'employee.created': 'Employé créé',
  'employee.updated': 'Employé modifié',
  'employee.role_changed': 'Rôle modifié',
  'employee.assignments_changed': 'Affectations modifiées',
  'employee.deactivated': 'Employé désactivé',
  'employee.reactivated': 'Employé réactivé',
  'employee.password_reset': 'Mot de passe réinitialisé',
  'auth.login': 'Connexion',
  'auth.logout': 'Déconnexion',
  'auth.password_changed': 'Mot de passe changé',
};

export const actionLabel = (action: string) => ACTION_LABELS[action] ?? action;

export function initials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

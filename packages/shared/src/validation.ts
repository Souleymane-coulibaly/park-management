/** Politique de mot de passe commune au formulaire et à l'API. */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export function passwordPolicyErrors(password: string): string[] {
  const errors: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH)
    errors.push(`Au moins ${PASSWORD_MIN_LENGTH} caractères.`);
  if (password.length > PASSWORD_MAX_LENGTH)
    errors.push(`Au plus ${PASSWORD_MAX_LENGTH} caractères.`);
  if (!/[a-z]/.test(password)) errors.push('Au moins une minuscule.');
  if (!/[A-Z]/.test(password)) errors.push('Au moins une majuscule.');
  if (!/[0-9]/.test(password)) errors.push('Au moins un chiffre.');
  return errors;
}

export const DEFAULT_COUNTRY = 'ML';
export const DEFAULT_CURRENCY = 'XOF';
export const DEFAULT_TIMEZONE = 'Africa/Bamako';

/** Pays de la zone FCFA (XOF) ciblés en premier. */
export const SUPPORTED_COUNTRIES: readonly { code: string; label: string; timezone: string }[] = [
  { code: 'ML', label: 'Mali', timezone: 'Africa/Bamako' },
  { code: 'SN', label: 'Sénégal', timezone: 'Africa/Dakar' },
  { code: 'CI', label: "Côte d'Ivoire", timezone: 'Africa/Abidjan' },
  { code: 'BF', label: 'Burkina Faso', timezone: 'Africa/Ouagadougou' },
  { code: 'NE', label: 'Niger', timezone: 'Africa/Niamey' },
  { code: 'GN', label: 'Guinée', timezone: 'Africa/Conakry' },
];

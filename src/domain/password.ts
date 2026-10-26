/**
 * Règle des mots de passe, la même que le réglage de Supabase (« Letters and digits », 8 caractères au minimum) :
 * vérifiée ici pour un message clair, et par le serveur de connexion une fois le réglage activé.
 */
export const PASSWORD_HINT = '8 caractères au minimum, avec au moins une lettre et un chiffre.';

export function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'Le mot de passe doit faire au moins 8 caractères.';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Le mot de passe doit contenir au moins une lettre (sans accent) et un chiffre.';
  return null;
}

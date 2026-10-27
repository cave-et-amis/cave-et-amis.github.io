/**
 * Lien « mot de passe oublié » reçu par e-mail. Le modèle d'e-mail (docs/INSTALLATION.md) pointe vers
 * ?auth=recovery&token_hash=… : l'application vérifie elle-même ce jeton, si bien que le lien fonctionne sur n'importe
 * quel appareil, même autre que celui où l'e-mail a été demandé (le lien standard de Supabase, en mode PKCE, ne marche
 * que dans le navigateur de la demande). Lit aussi l'erreur que Supabase renvoie pour un lien déjà utilisé ou expiré.
 */
export type RecoveryLink = { tokenHash: string | null; expired: boolean; cleanUrl: string };

export const RECOVERY_EXPIRED =
  'Ce lien n’est plus valable : un lien ne sert qu’une fois, et seul le dernier e-mail reçu fonctionne. Demandez-en un nouveau avec « Mot de passe oublié ».';

const SUPABASE_ERROR_PARAMS = ['error', 'error_code', 'error_description', 'sb'];

export function parseRecoveryLink(href: string): RecoveryLink | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  // Erreur de Supabase, dans la requête et/ou dans le fragment (#error=…), jamais une route de l'application (#/…).
  const fragment = url.hash.startsWith('#') && !url.hash.startsWith('#/') ? new URLSearchParams(url.hash.slice(1)) : null;
  const errorCode = url.searchParams.get('error_code') ?? fragment?.get('error_code') ?? null;
  const isRecovery = url.searchParams.get('auth') === 'recovery';
  if (!isRecovery && !errorCode) return null;
  const raw = isRecovery ? (url.searchParams.get('token_hash') ?? '') : '';
  for (const p of ['auth', 'token_hash', 'type', ...SUPABASE_ERROR_PARAMS]) url.searchParams.delete(p);
  const hash = url.hash.startsWith('#/') ? url.hash : '';
  const cleanUrl = url.origin + url.pathname + (url.search === '?' ? '' : url.search) + hash;
  const tokenHash = /^[A-Za-z0-9_-]{16,200}$/.test(raw) ? raw : null;
  return { tokenHash, expired: !tokenHash, cleanUrl };
}

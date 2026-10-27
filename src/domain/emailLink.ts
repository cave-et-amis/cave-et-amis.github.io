/**
 * Liens reçus par e-mail : mot de passe oublié, confirmation d'inscription, changement d'adresse. Les modèles d'e-mail
 * (docs/emails/) pointent vers ?auth=<type>&token_hash=… : l'application vérifie elle-même ce jeton, si bien que le lien
 * fonctionne sur n'importe quel appareil, même autre que celui de la demande (le lien standard de Supabase, en mode
 * PKCE, ne marche que dans le navigateur de la demande). Lit aussi l'erreur que Supabase renvoie pour un lien déjà
 * utilisé ou expiré.
 */
export type EmailLinkKind = 'recovery' | 'signup' | 'email_change';

/** `kind` null : simple erreur renvoyée par Supabase (lien de l'ancien modèle déjà utilisé ou expiré). */
export type EmailLink = { kind: EmailLinkKind | null; tokenHash: string | null; expired: boolean; cleanUrl: string };

const KINDS: EmailLinkKind[] = ['recovery', 'signup', 'email_change'];

export const RECOVERY_EXPIRED =
  'Ce lien n’est plus valable : un lien ne sert qu’une fois, et seul le dernier e-mail reçu fonctionne. Demandez-en un nouveau avec « Mot de passe oublié ».';
export const SIGNUP_EXPIRED =
  'Ce lien de confirmation n’est plus valable : un lien ne sert qu’une fois, et seul le dernier e-mail reçu fonctionne. Connectez-vous : si votre adresse n’est pas encore confirmée, vous pourrez recevoir un nouveau lien.';
export const EMAIL_CHANGE_EXPIRED =
  'Ce lien de changement d’adresse n’est plus valable : un lien ne sert qu’une fois. Refaites la demande dans Réglages › Mon profil.';

/** Message pour un lien qui n'est plus valable, selon son type. */
export function expiredMessage(kind: EmailLinkKind | null) {
  return kind === 'signup' ? SIGNUP_EXPIRED : kind === 'email_change' ? EMAIL_CHANGE_EXPIRED : RECOVERY_EXPIRED;
}

const SUPABASE_ERROR_PARAMS = ['error', 'error_code', 'error_description', 'sb'];

export function parseEmailLink(href: string): EmailLink | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  // Erreur de Supabase, dans la requête et/ou dans le fragment (#error=…), jamais une route de l'application (#/…).
  const fragment = url.hash.startsWith('#') && !url.hash.startsWith('#/') ? new URLSearchParams(url.hash.slice(1)) : null;
  const errorCode = url.searchParams.get('error_code') ?? fragment?.get('error_code') ?? null;
  const auth = url.searchParams.get('auth');
  const kind = (KINDS as string[]).includes(auth ?? '') ? (auth as EmailLinkKind) : null;
  if (!kind && !errorCode) return null;
  const raw = kind ? (url.searchParams.get('token_hash') ?? '') : '';
  for (const p of ['auth', 'token_hash', 'type', ...SUPABASE_ERROR_PARAMS]) url.searchParams.delete(p);
  const hash = url.hash.startsWith('#/') ? url.hash : '';
  const cleanUrl = url.origin + url.pathname + (url.search === '?' ? '' : url.search) + hash;
  const tokenHash = /^[A-Za-z0-9_-]{16,200}$/.test(raw) ? raw : null;
  return { kind, tokenHash, expired: !tokenHash, cleanUrl };
}

/**
 * Intégration avec l'agenda Nous : lecture du lien de connexion directe (« Voir dans Cave & Amis » depuis Nous).
 *
 *   <site>?auth=link&token_hash=…&next=#/evenements/…
 *
 * Le jeton (lien magique à usage unique) est retiré de l'adresse avant tout traitement, pour qu'il ne reste ni dans
 * l'historique ni dans un favori.
 */
export type MagicLink = { tokenHash: string; next: string | null; cleanUrl: string };

export function parseMagicLink(href: string): MagicLink | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.searchParams.get('auth') !== 'link') return null;
  const tokenHash = url.searchParams.get('token_hash') ?? '';
  const nextRaw = url.searchParams.get('next');
  for (const p of ['auth', 'token_hash', 'next', 'type']) url.searchParams.delete(p);
  // Seules les routes internes (#/…) sont acceptées comme destination.
  const next = nextRaw && /^#\/[\w\-/]{0,120}$/.test(nextRaw) ? nextRaw : null;
  const cleanUrl = url.origin + url.pathname + (url.search === '?' ? '' : url.search) + (next ?? url.hash);
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(tokenHash)) return { tokenHash: '', next, cleanUrl };
  return { tokenHash, next, cleanUrl };
}

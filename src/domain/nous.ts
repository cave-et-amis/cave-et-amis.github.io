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

/**
 * Connexion par ce lien : avant d'entrer, la personne confirme que c'est bien son compte (le lien d'un tiers ouvrirait
 * celui du tiers). Ce repère repose la question si la page est rechargée ou fermée avant la réponse ; effacé à la
 * réponse et à la déconnexion.
 */
export const LINK_PENDING_KEY = 'cave-amis-lien-a-confirmer';

export type PendingLink = { get: () => boolean; set: (on: boolean) => void };

export const pendingLink: PendingLink = {
  get() {
    try {
      return localStorage.getItem(LINK_PENDING_KEY) === '1';
    } catch {
      return false;
    }
  },
  set(on) {
    try {
      if (on) localStorage.setItem(LINK_PENDING_KEY, '1');
      else localStorage.removeItem(LINK_PENDING_KEY);
    } catch {
      /* stockage indisponible : la question est posée pour cette ouverture de page */
    }
  },
};

/**
 * Session de départ. Le lien ne sert que si personne n'est connecté ici : une session ouverte n'est jamais remplacée
 * par une autre. `confirm` : demander « Est-ce bien votre compte ? » avant d'entrer.
 */
export async function startSession<S>(
  auth: { getSession: () => Promise<S | null>; verify: (tokenHash: string) => Promise<S | null> },
  link: MagicLink | null,
  pending: PendingLink = pendingLink,
): Promise<{ session: S | null; confirm: boolean }> {
  let session = await auth.getSession();
  let viaLink = false;
  if (!session && link?.tokenHash) {
    pending.set(true);
    session = await auth.verify(link.tokenHash);
    viaLink = session !== null;
  }
  if (!session) pending.set(false);
  return { session, confirm: viaLink || (session !== null && pending.get()) };
}

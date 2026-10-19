/** Code d'invitation reçu par lien, gardé le temps de créer son compte ou de se connecter. */
const KEY = 'cave-amis-invite';

export function savePendingInvite(code: string) {
  try {
    sessionStorage.setItem(KEY, code.toUpperCase());
  } catch {
    /* navigation privée : l'invitation reste dans l'adresse */
  }
}

export function pendingInvite(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearPendingInvite() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* sans effet */
  }
}

/** Lien à partager : adresse de l'application + #/ami/CODE. */
export function inviteLink(code: string) {
  return `${window.location.origin}${window.location.pathname}#/ami/${code}`;
}

/** Code affiché par groupes de 5 pour être dicté facilement. */
export function prettyCode(code: string) {
  return code.replace(/(.{5})(?=.)/g, '$1-');
}

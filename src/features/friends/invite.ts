import type { InviteKind } from '../../domain/types';
import { dateLong } from '../../domain/format';

/**
 * Code d'invitation reçu par lien, gardé le temps de créer son compte ou de se connecter — y compris quand l'adresse
 * e-mail doit d'abord être confirmée (le lien de confirmation s'ouvre souvent dans un autre onglet) : 30 jours au plus.
 */
const KEY = 'cave-amis-invite';
const MAX_AGE = 30 * 86400_000;

/**
 * « auto » : la personne a choisi de créer son compte (ou de se connecter) depuis la vitrine du lien ; une fois connectée,
 * un lien de groupe ou d'événement est accepté pour elle et elle arrive directement dessus.
 */
export function savePendingInvite(code: string, auto = false) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ code: code.toUpperCase(), at: Date.now(), auto }));
  } catch {
    /* navigation privée : l'invitation reste dans l'adresse */
  }
}

function saved(): { code: string; auto: boolean } | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as { code?: string; at?: number; auto?: boolean };
    if (typeof s.code !== 'string' || typeof s.at !== 'number' || Date.now() - s.at > MAX_AGE) {
      localStorage.removeItem(KEY);
      return null;
    }
    return { code: s.code, auto: s.auto === true };
  } catch {
    return null;
  }
}

export function pendingInvite(): string | null {
  return saved()?.code ?? null;
}

export function pendingInviteAuto(): boolean {
  return saved()?.auto ?? false;
}

export function clearPendingInvite() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* sans effet */
  }
}

/** Les quatre sortes de liens, du plus discret au plus ouvert. */
export const INVITE_KINDS: { value: InviteKind; label: string; hint: string }[] = [
  {
    value: 'discovery',
    label: 'Découvrir l’application',
    hint: 'Vous serez en contact, sans voir la cave l’un de l’autre. Jusqu’à 10 personnes, pendant 30 jours.',
  },
  {
    value: 'friend',
    label: 'Ami, avec accès à ma cave',
    hint: 'La personne verra les bouteilles que vous partagez avec vos amis. Une seule personne, pendant 14 jours.',
  },
  {
    value: 'group',
    label: 'Rejoindre un de mes groupes',
    hint: 'La personne entre dans le groupe et voit ses bouteilles, pas votre cave. Jusqu’à 20 personnes, pendant 14 jours.',
  },
  {
    value: 'event',
    label: 'Venir à un de mes événements',
    hint: 'La personne est invitée et voit les vins prévus, pas votre cave. Jusqu’à 20 personnes, jusqu’à la date de l’événement.',
  },
];

/** « Bruno vous invite à… », d'après la page du lien (lisible sans compte). */
export function inviteHeadline(info: { kind?: InviteKind; inviter_name?: string; target_label?: string | null; target_date?: string | null }) {
  const who = info.inviter_name || 'Quelqu’un';
  switch (info.kind) {
    case 'friend':
      return `${who} vous invite à devenir amis sur Cave & Amis`;
    case 'group':
      return info.target_label ? `${who} vous invite à rejoindre le groupe « ${info.target_label} »` : `${who} vous invite à rejoindre un groupe`;
    case 'event':
      return info.target_label
        ? `${who} vous invite à « ${info.target_label} »${info.target_date ? `, le ${dateLong(info.target_date)}` : ''}`
        : `${who} vous invite à un événement`;
    default:
      return `${who} vous invite à découvrir Cave & Amis`;
  }
}

/** « 7 utilisations restantes · jusqu'au 9 novembre 2026 ». */
export function inviteValidity(i: { max_uses: number; uses?: number; expires_at: string }) {
  const left = i.max_uses - (i.uses ?? 0);
  const uses = i.max_uses === 1 ? 'Une seule utilisation' : `${left} utilisation${left > 1 ? 's' : ''} restante${left > 1 ? 's' : ''} sur ${i.max_uses}`;
  return `${uses} · jusqu’au ${dateLong(i.expires_at)}`;
}

/** Lien à partager : adresse de l'application + #/ami/CODE. */
export function inviteLink(code: string) {
  return `${window.location.origin}${window.location.pathname}#/ami/${code}`;
}

/** Code affiché par groupes de 5 pour être dicté facilement. */
export function prettyCode(code: string) {
  return code.replace(/(.{5})(?=.)/g, '$1-');
}

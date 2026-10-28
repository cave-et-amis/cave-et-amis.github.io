/**
 * Texte et lien d'une notification : les mêmes dans l'application (page Notifications) et sur l'appareil
 * (notification push envoyée par le serveur, qui importe ce fichier).
 */
import type { AppNotification } from './types.ts';

export type NotificationKind = AppNotification['kind'];

type Source = { kind: string; actor_id?: string | null; actor_name: string | null; ref_id: string | null };

export function notificationText(n: Source): { text: string; href: string } {
  const who = n.actor_name || 'Quelqu’un';
  const person = n.actor_id ? `#/amis/${n.actor_id}` : '#/amis';
  switch (n.kind) {
    case 'friend_request':
      return { text: `${who} souhaite être en contact avec vous`, href: '#/amis?onglet=invitations' };
    case 'friend_accepted':
      return { text: `${who} a accepté votre demande : vous êtes en contact`, href: person };
    case 'event_invite':
      return { text: `${who} vous invite à un événement`, href: n.ref_id ? `#/evenements/${n.ref_id}` : '#/evenements' };
    case 'group_invite':
      return { text: `${who} vous invite à rejoindre un groupe`, href: '#/amis?onglet=groupes' };
    case 'group_joined':
      return { text: `${who} a rejoint votre groupe`, href: n.ref_id ? `#/groupes/${n.ref_id}` : '#/amis?onglet=groupes' };
    case 'cellar_invite':
      return { text: `${who} vous propose de gérer sa cave à plusieurs`, href: '#/amis?onglet=invitations' };
    case 'cellar_joined':
      return { text: `${who} gère maintenant votre cave avec vous`, href: '#/reglages/caves' };
    case 'invite_joined':
      return { text: `${who} a rejoint Cave & Amis grâce à votre invitation`, href: person };
    case 'cellar_opened':
      return { text: `${who} vous a ouvert sa cave`, href: person };
    case 'cellar_access_request':
      return { text: `${who} demande à voir votre cave`, href: '#/amis?onglet=invitations' };
    // Avis de sécurité après chaque liaison (prénom du compte Nous).
    case 'nous_linked':
      return {
        text: `Votre compte est relié à ${n.actor_name ? `l’agenda Nous de ${n.actor_name}` : 'un agenda Nous'}. Ce n’est pas vous ? Déliez-le dans les Réglages.`,
        href: '#/reglages',
      };
    // Alertes de maturité (facultatives) : le nom du vin est figé dans actor_name, le vin dans ref_id.
    case 'maturity_ready':
      return { text: `${n.actor_name || 'Un vin de votre cave'} entre dans sa période de dégustation (période indicative de sa fiche)`, href: n.ref_id ? `#/cave/vin/${n.ref_id}` : '#/cave?tri=maturite' };
    case 'maturity_last':
      return { text: `${n.actor_name || 'Un vin de votre cave'} : dernière année de sa période de dégustation (période indicative de sa fiche)`, href: n.ref_id ? `#/cave/vin/${n.ref_id}` : '#/cave?tri=maturite' };
    // Plus de 3 alertes le même jour : un seul résumé (actor_name : leur nombre).
    case 'price_drop':
      return { text: `${n.actor_name || 'Le vin que vous suivez'} : prix plus bas trouvé vendredi`, href: n.ref_id ? `#/cave/vin/${n.ref_id}` : '#/cave' };
    case 'maturity_many':
      return { text: `${n.actor_name ?? 'Plusieurs'} vins de votre cave entrent dans leur période de dégustation ou la terminent cette année`, href: '#/cave?tri=maturite' };
    default:
      return { text: 'Vous avez une nouvelle notification', href: '#/notifications' };
  }
}

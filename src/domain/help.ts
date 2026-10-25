/**
 * Aide intégrée : des fiches courtes sur ce que Cave & Amis permet VRAIMENT, pas à pas, avec le chemin pour y aller et
 * les droits nécessaires. Une seule source pour l'aide de chaque page (bouton « ? »), la rubrique « Aide avec Cave &
 * Amis » de Lia et l'outil app_help de l'assistant, qui ne doit jamais décrire une fonction absente de ces fiches.
 * À tenir à jour avec l'interface (libellés exacts des boutons).
 */
import { fold } from './wine.ts';

export type HelpPage =
  | 'accueil'
  | 'cave'
  | 'vin'
  | 'amis'
  | 'invitations'
  | 'groupes'
  | 'groupe'
  | 'evenements'
  | 'evenement'
  | 'carnet'
  | 'assistant'
  | 'reglages'
  | 'notifications';

export const HELP_PAGES: Record<HelpPage, string> = {
  accueil: 'Accueil',
  cave: 'Ma cave',
  vin: 'Fiche d’un vin',
  amis: 'Amis & Groupes',
  invitations: 'Invitations',
  groupes: 'Groupes',
  groupe: 'Page d’un groupe',
  evenements: 'Événements',
  evenement: 'Page d’un événement',
  carnet: 'Mon carnet',
  assistant: 'Lia, l’assistante',
  reglages: 'Réglages',
  notifications: 'Notifications',
};

/** Ce dont dépend une fiche. */
export type HelpNeed = 'admin' | 'group_manager' | 'event_organizer' | 'assistant';
export type HelpPerms = { admin: boolean; groupManager: boolean; eventOrganizer: boolean; assistant: boolean };

export type HelpTopic = {
  id: string;
  title: string;
  /** La question telle qu'on la pose (rubrique « Aide avec Cave & Amis »). */
  question: string;
  pages: HelpPage[];
  /** Mots-clés de recherche, sans accents. */
  keywords: string;
  steps: string[];
  /** Accès direct (chemin de l'application). */
  link?: { label: string; path: string };
  needs?: HelpNeed;
  /** Explication si la personne n'y a pas droit. */
  unavailable?: string;
};

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'ajouter-bouteille',
    title: 'Ajouter une bouteille',
    question: 'Comment ajouter une bouteille ?',
    pages: ['accueil', 'cave'],
    keywords: 'ajouter bouteille vin nouveau achat acheter saisir photo photographier etiquette entree premiere',
    steps: [
      'Touchez « Ajouter » (en bas à droite sur téléphone, « Ajouter un vin » à gauche sur ordinateur).',
      '« Photographier une étiquette » : Lia lit l’étiquette et pré-remplit la fiche. Ou « Saisir un vin » pour l’écrire vous-même.',
      'Vérifiez le nom, le millésime, la couleur et le nombre de bouteilles, puis « Ajouter à ma cave ».',
      'Même vin, nouvel achat : l’application le reconnaît et ajoute un lot à la fiche existante.',
    ],
    link: { label: 'Ajouter une bouteille', path: '/cave?ajouter=1' },
  },
  {
    id: 'modifier-bouteille',
    title: 'Modifier une bouteille',
    question: 'Comment modifier les informations d’une bouteille ?',
    pages: ['cave', 'vin'],
    keywords: 'modifier corriger changer fiche bouteille nom millesime photo prix emplacement quantite stock bu boire sortie',
    steps: [
      'Ma cave › touchez le vin pour ouvrir sa fiche.',
      '« Modifier » : nom, millésime, couleur, domaine, photo, conseils.',
      'Dans « Lots », « Lot et partage » : prix d’achat, emplacement, partage, et ce que vos amis ne verront pas.',
      'Le stock : « J’en ai bu une », ou une sortie, une entrée, une correction ; une erreur s’annule avec ↶ dans l’historique.',
    ],
    link: { label: 'Ouvrir ma cave', path: '/cave' },
  },
  {
    id: 'rechercher-bouteille',
    title: 'Rechercher une bouteille',
    question: 'Comment retrouver une bouteille dans ma cave ?',
    pages: ['cave'],
    keywords: 'rechercher chercher trouver retrouver filtrer filtre trier tri bouteille couleur maturite region millesime emplacement',
    steps: [
      'Ma cave › zone de recherche : nom, domaine, appellation, cépage, millésime.',
      '« Filtres » : couleur, maturité, région, millésime, prix, cave, emplacement, favoris, bouteilles partagées.',
      '« Trier » : à boire en premier, ajout récent, millésime, quantité…',
    ],
    link: { label: 'Ouvrir ma cave', path: '/cave' },
  },
  {
    id: 'partage-bouteille',
    title: 'Partager une bouteille avec mes amis',
    question: 'Comment partager une bouteille avec mes amis ?',
    pages: ['cave', 'vin', 'amis'],
    keywords: 'partager partage bouteille ami amis visible prive proposable masquer prix quantite notes comprendre',
    steps: [
      'Chaque bouteille est privée par défaut. Fiche du vin › « Lot et partage » › « Qui peut voir ce lot ? » : Privé, Partagé avec mes amis ou Proposable pour un événement.',
      'Elle n’est visible que des personnes à qui vous avez ouvert votre cave, jamais des simples contacts.',
      'Vous pouvez masquer votre prix d’achat, la quantité exacte et vos notes.',
      'Pour un groupe : page du groupe › « Rendre visibles », ou « Mettre à disposition » une quantité.',
    ],
    link: { label: 'Ouvrir ma cave', path: '/cave' },
  },
  {
    id: 'qui-voit',
    title: 'Qui peut voir mes bouteilles ?',
    question: 'Qui peut voir mes bouteilles ?',
    pages: ['cave', 'vin', 'amis', 'reglages'],
    keywords: 'qui voit voir mes bouteilles confidentialite prive privee acces cave ouverte apercu securite',
    steps: [
      'Personne par défaut : votre cave est privée.',
      'Seules les personnes à qui vous ouvrez votre cave voient vos bouteilles partagées (ou seulement celles choisies pour elles).',
      'Réglages › Confidentialité › « Qui voit ma cave » : toutes vos relations, cave ouverte ou fermée.',
      'Fiche d’une personne › « Ce que … voit de moi » : l’aperçu exact de ce qu’elle voit.',
    ],
    link: { label: 'Ouvrir « Qui voit ma cave »', path: '/reglages/acces' },
  },
  {
    id: 'inviter-decouverte',
    title: 'Inviter quelqu’un sans lui montrer ma cave',
    question: 'Comment inviter quelqu’un sans lui montrer ma cave ?',
    pages: ['accueil', 'amis', 'invitations'],
    keywords: 'inviter invitation decouverte decouvrir sans cave lien whatsapp sms email mail qr code partager application ami contact paul',
    steps: [
      'Amis & Groupes › « Inviter quelqu’un ».',
      'Choisissez « Découvrir l’application ».',
      'Envoyez le lien : WhatsApp, SMS, e-mail, QR code ou copie.',
      'La personne découvre l’application et crée son compte : vous êtes en contact, sans qu’elle voie votre cave.',
    ],
    link: { label: 'Ouvrir les invitations', path: '/amis?onglet=invitations' },
  },
  {
    id: 'voir-ma-cave',
    title: 'Montrer ma cave, ou quelques bouteilles',
    question: 'Comment montrer ma cave, ou seulement quelques bouteilles, à quelqu’un ?',
    pages: ['amis', 'invitations', 'reglages'],
    keywords: 'ouvrir cave acces montrer selection quelques bouteilles ami date fin expiration lecture seule fermer',
    steps: [
      'Une personne en contact : Amis & Groupes › son nom › « Ce que … voit de moi » › « Ma cave » : ouverte.',
      'Choisissez « Toute ma cave partagée » ou « Une sélection », ajoutez les bouteilles, et si besoin une date de fin.',
      'Une personne sans compte : « Inviter quelqu’un » › « Voir ma cave », avec les mêmes choix.',
      'Lecture seule : la personne regarde, sans rien pouvoir modifier ; vous fermez l’accès quand vous voulez.',
    ],
    link: { label: 'Ouvrir mes amis', path: '/amis' },
  },
  {
    id: 'supprimer-invitation',
    title: 'Supprimer une invitation',
    question: 'Comment supprimer une invitation ?',
    pages: ['invitations', 'amis'],
    keywords: 'supprimer revoquer annuler invitation lien desactiver retirer',
    steps: [
      'Amis & Groupes › Invitations › « Mes invitations ».',
      'Sur le lien : « Révoquer ». Il ne fonctionne plus ; les personnes déjà entrées gardent leur place.',
      'Retirer l’accès d’une personne : sa fiche › « Fermer ma cave à … », ou « Supprimer le contact ».',
    ],
    link: { label: 'Ouvrir les invitations', path: '/amis?onglet=invitations' },
  },
  {
    id: 'devenir-amis',
    title: 'Devenir amis, demander à voir une cave',
    question: 'Comment ajouter un ami ou voir sa cave ?',
    pages: ['amis'],
    keywords: 'ami amis ajouter demande demander acces voir sa cave contact recherche trouver personne',
    steps: [
      'Amis & Groupes › « Trouver des personnes » (si la personne apparaît dans la recherche), ou un lien d’invitation.',
      'Une demande crée un contact ; cochez « Lui ouvrir ma cave » pour ouvrir aussi la vôtre.',
      'Fiche d’un contact : « Demander l’accès » pour voir sa cave ; la personne accepte ou refuse.',
    ],
    link: { label: 'Ouvrir mes amis', path: '/amis' },
  },
  {
    id: 'creer-groupe',
    title: 'Créer un groupe',
    question: 'Comment créer un groupe ?',
    pages: ['amis', 'groupes'],
    keywords: 'creer groupe nouveau famille soiree amis club',
    steps: [
      'Amis & Groupes › Groupes › « Créer un groupe ».',
      'Un nom, un emoji, une photo si vous voulez, et les personnes à inviter.',
      'Partagez ensuite des bouteilles : « Rendre visibles », ou « Mettre à disposition » une quantité.',
    ],
    link: { label: 'Ouvrir les groupes', path: '/amis?onglet=groupes' },
  },
  {
    id: 'rejoindre-groupe',
    title: 'Rejoindre un groupe',
    question: 'Comment rejoindre un groupe ?',
    pages: ['groupes', 'groupe'],
    keywords: 'rejoindre groupe entrer adherer membre invitation',
    steps: [
      'Les groupes sont privés : on y entre sur invitation.',
      'Invitation reçue : Amis & Groupes › Groupes › « Rejoindre », ou le lien reçu.',
      'Sinon, demandez à l’administrateur du groupe de vous inviter.',
    ],
    link: { label: 'Ouvrir les groupes', path: '/amis?onglet=groupes' },
  },
  {
    id: 'inviter-groupe',
    title: 'Inviter dans un groupe',
    question: 'Comment inviter quelqu’un dans un groupe ?',
    pages: ['groupes', 'groupe'],
    keywords: 'inviter groupe membre ajouter lien rejoindre',
    steps: [
      'Page du groupe › « Inviter des personnes » : vos amis et contacts.',
      'Ou « Inviter quelqu’un » › « Rejoindre un de mes groupes » : un lien pour 20 personnes, même sans compte.',
      'Les membres voient les bouteilles du groupe, jamais le reste de votre cave.',
    ],
    link: { label: 'Ouvrir les groupes', path: '/amis?onglet=groupes' },
    needs: 'group_manager',
    unavailable: 'Seuls l’administrateur et les gestionnaires d’un groupe peuvent y inviter : demandez-le à l’un d’eux.',
  },
  {
    id: 'organiser-evenement',
    title: 'Organiser une soirée ou une dégustation',
    question: 'Comment organiser une soirée dégustation ?',
    pages: ['accueil', 'evenements'],
    keywords: 'organiser creer evenement soiree degustation diner repas anniversaire inviter',
    steps: [
      'Événements › « Organiser un événement ».',
      'Le type (dîner, dégustation…), le titre, la date, le lieu, les invités parmi vos amis et contacts.',
      'Chacun propose ses bouteilles ; leur propriétaire confirme (« Je l’apporte » les réserve).',
      'Après la soirée : « Marquer l’événement comme passé », puis indiquez ce qui a été bu.',
    ],
    link: { label: 'Ouvrir les événements', path: '/evenements' },
  },
  {
    id: 'inviter-evenement',
    title: 'Inviter des participants',
    question: 'Comment inviter des participants à un événement ?',
    pages: ['evenements', 'evenement'],
    keywords: 'inviter participants invites evenement soiree lien',
    steps: [
      'Page de l’événement › « + Inviter ».',
      'Ou « Inviter quelqu’un » › « Venir à un de mes événements » : un lien, même pour une personne sans compte.',
      'Les invités voient l’événement et ses vins, pas votre cave, et répondent « Je viens », « Peut-être » ou « Je ne viens pas ».',
    ],
    link: { label: 'Ouvrir les événements', path: '/evenements' },
    needs: 'event_organizer',
    unavailable: 'Seul l’organisateur d’un événement peut y inviter : demandez-le lui, ou organisez votre propre événement.',
  },
  {
    id: 'modifier-evenement',
    title: 'Modifier un événement',
    question: 'Comment modifier un événement ?',
    pages: ['evenements', 'evenement'],
    keywords: 'modifier changer evenement date lieu titre annuler supprimer',
    steps: [
      'Page de l’événement › « Modifier » : titre, date, lieu, description.',
      '« Annuler l’événement » libère toutes les bouteilles réservées.',
    ],
    link: { label: 'Ouvrir les événements', path: '/evenements' },
    needs: 'event_organizer',
    unavailable: 'Seul l’organisateur peut modifier un événement.',
  },
  {
    id: 'repondre-evenement',
    title: 'Répondre à une invitation',
    question: 'Comment répondre à une invitation à un événement ?',
    pages: ['evenements', 'evenement'],
    keywords: 'repondre invitation evenement viens venir participer peut etre',
    steps: [
      'Événements (ou la page de l’événement) : « Je viens », « Peut-être » ou « Je ne viens pas ».',
      'Vous pouvez ensuite proposer une de vos bouteilles.',
    ],
    link: { label: 'Ouvrir les événements', path: '/evenements' },
  },
  {
    id: 'noter-degustation',
    title: 'Noter une dégustation',
    question: 'Comment noter un vin que j’ai goûté ?',
    pages: ['carnet', 'vin'],
    keywords: 'noter note degustation carnet gouter goute restaurant avis etoiles',
    steps: [
      'Mon carnet › « Noter une dégustation », ou Ajouter › « Enregistrer une dégustation ».',
      'Note sur 5, commentaire, observations guidées, plat, prix payé, photo.',
      'Votre note reste privée, sauf si vous la partagez avec un événement ou un groupe. Le stock ne change que si la bouteille vient de votre cave.',
    ],
    link: { label: 'Ouvrir mon carnet', path: '/carnet' },
  },
  {
    id: 'liste-envies',
    title: 'Ma liste d’envies',
    question: 'Comment garder une idée de vin à acheter ?',
    pages: ['carnet'],
    keywords: 'envie envies liste acheter idee gouter un jour souhait',
    steps: ['Ajouter › « Ajouter à ma liste d’envies ».', 'Mon carnet › Envies : la liste, à retirer une fois l’achat fait.'],
    link: { label: 'Ouvrir mon carnet', path: '/carnet' },
  },
  {
    id: 'lia',
    title: 'Demander conseil à Lia',
    question: 'Que peut faire Lia pour moi ?',
    pages: ['accueil', 'assistant', 'cave', 'vin', 'evenement', 'groupe'],
    keywords: 'lia assistant assistante sommelier conseil accord plat ouvrir quel vin question ia',
    steps: [
      'Touchez ✦ en haut de l’écran, ou « Demander à l’assistant » sur une fiche, un événement ou un groupe.',
      'Exemples : quel vin ouvrir avec un plat, quelles bouteilles boire bientôt, comment utiliser l’application.',
      'Lia lit vos données avec vos droits et ne modifie rien sans votre confirmation.',
    ],
    link: { label: 'Ouvrir Lia', path: '/assistant' },
    needs: 'assistant',
    unavailable: 'Lia n’est pas disponible pour le moment ; tout le reste de l’application fonctionne normalement.',
  },
  {
    id: 'visite',
    title: 'Revoir la visite guidée',
    question: 'Comment revoir la visite guidée ?',
    pages: ['reglages', 'accueil'],
    keywords: 'visite guidee tutoriel aide revoir recommencer astuces decouvrir',
    steps: [
      'Réglages › « Revoir la visite guidée ».',
      'Le bouton « ? » en haut de chaque page ouvre l’aide de cette page.',
    ],
    link: { label: 'Ouvrir les réglages', path: '/reglages' },
  },
  {
    id: 'cave-plusieurs',
    title: 'Gérer une cave à plusieurs',
    question: 'Comment gérer une cave à deux ?',
    pages: ['reglages', 'cave'],
    keywords: 'gerer cave plusieurs deux couple famille associer personne partagee',
    steps: [
      'Réglages › Caves et emplacements › « Associer une personne » (une personne en contact, avec son propre compte).',
      'Une fois l’invitation acceptée, elle ajoute, boit, corrige et range les bouteilles de cette cave, chaque mouvement à son nom.',
    ],
    link: { label: 'Ouvrir mes caves', path: '/reglages/caves' },
  },
  {
    id: 'bloquer',
    title: 'Bloquer quelqu’un',
    question: 'Comment bloquer quelqu’un ?',
    pages: ['amis'],
    keywords: 'bloquer bloque signaler empecher retirer supprimer contact',
    steps: [
      'Amis & Groupes › son nom › « Ce que … voit de moi » › « Bloquer ».',
      'Plus de relation ni d’accès ; la personne n’en est pas avertie. Débloquer : Réglages › Confidentialité.',
    ],
    link: { label: 'Ouvrir mes amis', path: '/amis' },
  },
  {
    id: 'exporter',
    title: 'Exporter mes données',
    question: 'Comment exporter ma cave ?',
    pages: ['cave', 'carnet', 'reglages'],
    keywords: 'exporter export tableur excel csv sauvegarde donnees',
    steps: ['Ma cave › « Exporter ces vins (tableur) ».', 'Mon carnet › « Exporter mon carnet (tableur) ».'],
    link: { label: 'Ouvrir ma cave', path: '/cave' },
  },
  {
    id: 'notifications',
    title: 'Les notifications',
    question: 'Comment recevoir les notifications sur mon téléphone ?',
    pages: ['notifications', 'accueil', 'reglages'],
    keywords: 'notification notifications cloche alerte prevenu demande push telephone iphone android recevoir activer essai appareil',
    steps: [
      'La cloche en haut de l’écran : demandes, invitations, personnes arrivées grâce à vos liens, caves qui vous sont ouvertes.',
      'Pour les recevoir aussi sur l’appareil, même application fermée : Réglages › « Notifications sur cet appareil » › « Activer », puis acceptez la demande du téléphone.',
      'Sur iPhone et iPad (iOS 16.4 ou plus récent) : ajoutez d’abord l’application à l’écran d’accueil (Partager › « Sur l’écran d’accueil ») et ouvrez-la depuis son icône.',
      '« Envoyer une notification d’essai » vérifie que tout fonctionne ; « Désactiver » ou « Retirer » les arrête pour un appareil.',
    ],
    link: { label: 'Ouvrir les réglages', path: '/reglages' },
  },
  {
    id: 'administration',
    title: 'Administration de l’assistant',
    question: 'Comment régler l’assistant (clé, quotas) ?',
    pages: ['reglages'],
    keywords: 'administration admin cle api modele quota budget limite reglage assistant',
    steps: ['Réglages › Administration : clé, modèle, quotas, budget, consommation.'],
    link: { label: 'Ouvrir l’administration', path: '/admin' },
    needs: 'admin',
    unavailable: 'Réservé à l’administrateur de l’application.',
  },
];

/** Questions de la rubrique « Aide avec Cave & Amis ». */
export const HELP_QUESTIONS = [
  'ajouter-bouteille',
  'partage-bouteille',
  'inviter-decouverte',
  'creer-groupe',
  'organiser-evenement',
  'supprimer-invitation',
  'modifier-bouteille',
  'qui-voit',
];

/** Chemins vers lesquels une fiche (ou Lia) peut envoyer : rien d'autre. */
export const HELP_PATHS = new Set(HELP_TOPICS.map((t) => t.link?.path).filter((p): p is string => Boolean(p)));

export function helpTopic(id: string): HelpTopic | undefined {
  return HELP_TOPICS.find((t) => t.id === id);
}

export function availability(t: HelpTopic, p: HelpPerms): { available: boolean; reason?: string } {
  const ok =
    !t.needs ||
    (t.needs === 'admin' && p.admin) ||
    (t.needs === 'group_manager' && p.groupManager) ||
    (t.needs === 'event_organizer' && p.eventOrganizer) ||
    (t.needs === 'assistant' && p.assistant);
  return ok ? { available: true } : { available: false, reason: t.unavailable };
}

/** Les fiches d'une page : celles accessibles d'abord. La fiche « Administration » n'est montrée qu'à l'administrateur. */
export function topicsForPage(page: HelpPage, p: HelpPerms): HelpTopic[] {
  return HELP_TOPICS.filter((t) => t.pages.includes(page) && (t.needs !== 'admin' || p.admin)).sort(
    (a, b) => Number(!availability(a, p).available) - Number(!availability(b, p).available),
  );
}

/** Mots trop courants pour départager les fiches (« l'application » : Cave & Amis elle-même, dans presque toute question). */
const STOP_WORDS = new Set(
  'comment pour avec dans mes mon une des les est que faire peux veux puis pas sur par plus tout tous cette cet aux son ses leur vos votre notre nous vous moi elle lui quoi quel quelle ou application appli app'.split(
    ' ',
  ),
);

const HAYSTACKS = HELP_TOPICS.map((t) => fold(`${t.title} ${t.question} ${t.keywords}`));

/**
 * Recherche simple dans les fiches (mots du titre, de la question et des mots-clés). Un mot présent dans peu de fiches
 * compte davantage : « administration » l'emporte sur « application », que beaucoup de fiches emploient.
 */
export function searchHelp(query: string, limit = 4): HelpTopic[] {
  const words = fold(query)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  if (!words.length) return [];
  const weight = (w: string) => 1 / HAYSTACKS.filter((h) => h.includes(w)).length;
  return HELP_TOPICS.map((t, i) => ({ t, score: words.filter((w) => HAYSTACKS[i].includes(w)).reduce((s, w) => s + weight(w), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.t);
}

/** La page de l'application d'après l'adresse (#/cave, #/amis?onglet=invitations…). */
export function pageOfRoute(route: string): HelpPage {
  const [path, query = ''] = route.split('?');
  const seg = path.split('/').filter(Boolean);
  const onglet = new URLSearchParams(query).get('onglet');
  switch (seg[0]) {
    case undefined:
      return 'accueil';
    case 'cave':
      return seg[1] === 'vin' ? 'vin' : 'cave';
    case 'amis':
      return onglet === 'invitations' ? 'invitations' : onglet === 'groupes' ? 'groupes' : 'amis';
    case 'ami':
      return 'invitations';
    case 'groupes':
      return seg[1] ? 'groupe' : 'groupes';
    case 'evenements':
      return seg[1] ? 'evenement' : 'evenements';
    case 'carnet':
      return 'carnet';
    case 'assistant':
      return 'assistant';
    case 'reglages':
    case 'admin':
      return 'reglages';
    case 'notifications':
      return 'notifications';
    default:
      return 'accueil';
  }
}

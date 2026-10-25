/** Traduction des erreurs techniques (base, authentification, réseau, assistant) en messages clairs. */

const DB_MESSAGES: Record<string, string> = {
  not_authenticated: 'Votre session a expiré. Reconnectez-vous.',
  forbidden: 'Vous n’avez pas les droits pour cette action.',
  not_found: 'Élément introuvable : il a peut-être été supprimé entre-temps.',
  invalid: 'Une valeur saisie n’est pas valable.',
  no_change: 'La quantité indiquée est déjà celle enregistrée.',
  request_cooldown: 'Cette personne a refusé votre demande récemment : vous pourrez en envoyer une nouvelle dans 30 jours.',
  too_many_requests: 'Vous avez envoyé beaucoup de demandes aujourd’hui. Réessayez demain.',
  request_closed: 'Cette demande n’est plus valable.',
  stock_insufficient: 'Stock insuffisant : {available}.',
  stock_reserved: 'Impossible : {reserved} (pour un événement ou mises à disposition d’un groupe). Libérez-les d’abord, ou choisissez un autre lot.',
  lot_reserved: 'Ce lot a des bouteilles réservées pour un événement ou mises à disposition d’un groupe : libérez-les avant de le supprimer.',
  over_allocation: 'Pas assez de bouteilles libres : {available}.',
  allocation_insufficient: 'Pas assez de bouteilles mises à disposition du groupe : {available}.',
  cellar_not_empty: 'Cette cave contient encore des bouteilles : déplacez-les ou supprimez-les d’abord.',
  location_mismatch: 'Cet emplacement n’appartient pas à la cave choisie.',
  already_reversed: 'Ce mouvement a déjà été annulé.',
  cannot_reverse: 'Une annulation ne peut pas être annulée : faites plutôt une correction de quantité.',
  too_many_invites: 'Vous avez déjà 20 invitations en attente : annulez-en avant d’en créer d’autres.',
  invite_invalid: 'Ce code d’invitation n’existe pas. Vérifiez qu’il a été bien recopié.',
  invite_used: 'Cette invitation a déjà servi. Demandez un nouveau lien à votre ami.',
  invite_expired: 'Cette invitation a expiré. Demandez un nouveau lien à votre ami.',
  invite_self: 'C’est votre propre invitation : envoyez-la à un ami.',
  not_friend: 'Seuls vos amis peuvent être invités.',
  group_full: 'Un groupe compte 50 personnes au plus.',
  too_many_groups: 'Vous avez déjà créé 50 groupes.',
  last_admin: 'Vous êtes le seul administrateur : nommez d’abord un autre administrateur parmi les membres.',
  not_participant: 'Vous ne participez pas à cet événement.',
  event_not_planned: 'Cet événement est terminé ou annulé : il ne peut plus être modifié.',
  event_not_done: 'L’événement doit d’abord être marqué comme passé par son organisateur.',
  event_done: 'Un événement passé ne peut pas être supprimé : il garde vos souvenirs.',
  event_in_future: 'L’événement n’a pas encore eu lieu.',
  organizer_must_attend: 'L’organisateur fait toujours partie de l’événement.',
  not_proposable: 'Cette bouteille n’est pas proposable : son propriétaire ne l’a pas ouverte aux événements.',
  owner_not_participant: 'Le propriétaire de cette bouteille ne participe pas à l’événement.',
  already_proposed: 'Cette bouteille est déjà proposée pour cet événement.',
  over_reservation: 'Pas assez de bouteilles : {available}, en tenant compte des autres réservations.',
  wine_status: 'Cette proposition a déjà été traitée.',
  lot_missing: 'Le lot de cette bouteille n’existe plus.',
  price_unverified: 'Ce relevé n’a pas pu être vérifié : il ne peut pas servir de prix de marché.',
  invalid_source: 'Le lien de la source doit commencer par http:// ou https://.',
};

const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: 'Adresse e-mail ou mot de passe incorrect.',
  user_already_exists: 'Un compte existe déjà avec cette adresse. Connectez-vous plutôt.',
  email_exists: 'Un compte existe déjà avec cette adresse. Connectez-vous plutôt.',
  weak_password: 'Le mot de passe doit contenir au moins 8 caractères.',
  email_not_confirmed: 'Confirmez d’abord votre adresse e-mail grâce au lien reçu, puis reconnectez-vous.',
  over_email_send_rate_limit: 'Trop d’e-mails envoyés récemment. Réessayez dans une heure.',
  over_request_rate_limit: 'Trop de tentatives. Patientez quelques minutes.',
  signup_disabled: 'La création de compte est désactivée sur ce serveur.',
  same_password: 'Le nouveau mot de passe doit être différent de l’ancien.',
  validation_failed: 'Adresse e-mail non valable.',
  email_address_invalid: 'Adresse e-mail non valable.',
  session_not_found: 'Votre session a expiré. Reconnectez-vous.',
  refresh_token_not_found: 'Votre session a expiré. Reconnectez-vous.',
};

/** Messages de l'assistant (renvoyés par le serveur sous forme de code). */
export const AI_MESSAGES: Record<string, string> = {
  ai_not_configured: 'L’assistant n’est pas encore configuré sur ce serveur. Toutes les autres fonctions restent disponibles.',
  ai_disabled: 'L’assistant est désactivé pour le moment. Toutes les autres fonctions restent disponibles.',
  invalid_key: 'L’assistant est indisponible (configuration du serveur à vérifier). Vous pouvez continuer à gérer vos caves et événements.',
  quota_daily: 'Vous avez atteint votre nombre de demandes à l’assistant pour aujourd’hui. Il sera de nouveau disponible demain ; le reste de l’application fonctionne normalement.',
  quota_monthly: 'Vous avez atteint votre limite mensuelle d’utilisation de l’assistant. Le reste de l’application fonctionne normalement.',
  budget_exhausted: 'L’assistant a atteint sa limite d’utilisation pour ce mois-ci. Le reste de l’application fonctionne normalement.',
  rate_limited: 'Doucement : trop de demandes en une minute. Réessayez dans un instant.',
  too_many_concurrent: 'Une demande est déjà en cours : attendez sa réponse.',
  user_blocked: 'L’accès à l’assistant n’est pas activé pour votre compte.',
  service_unavailable: 'Le service d’IA ne répond pas pour le moment. Réessayez plus tard ; rien n’a été perdu.',
  upstream_rate_limited: 'Le service d’IA est très sollicité. Réessayez dans une minute.',
  model_not_found: 'Le modèle choisi n’est pas disponible. L’administrateur doit en choisir un autre.',
  price_unknown: 'Le tarif du modèle choisi n’est pas renseigné : l’administrateur doit le compléter avant toute utilisation.',
  message_too_long: 'Votre message est trop long. Raccourcissez-le, puis réessayez.',
  image_too_large: 'La photo est trop lourde. Reprenez-la ou choisissez-en une autre.',
  image_invalid: 'Cette photo n’a pas pu être lue. Essayez une photo au format JPEG ou PNG.',
  photo_service_unavailable: 'Open Food Facts ne répond pas pour le moment. Réessayez plus tard, ou gardez votre propre photo.',
  refused: 'L’assistant n’a pas pu répondre à cette demande. Reformulez-la.',
  bad_request: 'La demande n’a pas pu être traitée par l’assistant.',
  not_authenticated: 'Votre session a expiré. Reconnectez-vous.',
  forbidden: 'Vous n’avez pas les droits pour cette action.',
  not_found: 'Élément introuvable.',
  invalid: 'Demande non valable.',
  internal: 'Une erreur inattendue est survenue côté serveur. Réessayez dans un instant.',
};

export class AppError extends Error {
  code: string;
  constructor(message: string, code = 'app') {
    super(message);
    this.code = code;
  }
}

type ErrLike = { code?: string; message?: string; details?: string | null; detail?: string; status?: number; name?: string };

function fill(template: string, details?: string | null) {
  let data: { available?: number; quantity?: number; reserved?: number } = {};
  try {
    data = details ? JSON.parse(details) : {};
  } catch {
    data = {};
  }
  const available = data.available ?? (data.quantity !== undefined ? data.quantity - (data.reserved ?? 0) : undefined);
  const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);
  const availableText =
    available === undefined
      ? 'pas assez de bouteilles disponibles'
      : available <= 0
        ? 'aucune bouteille disponible'
        : `${plural(available, 'il ne reste qu’une bouteille disponible', `il ne reste que ${available} bouteilles disponibles`)}`;
  const reservedText =
    data.reserved === undefined
      ? 'des bouteilles de ce lot sont réservées'
      : `${data.reserved} ${plural(data.reserved, 'bouteille de ce lot est réservée', 'bouteilles de ce lot sont réservées')}`;
  return template.replace('{available}', availableText).replace('{reserved}', reservedText);
}

export function toMessage(e: unknown): string {
  if (e instanceof AppError) return e.message || DB_MESSAGES[e.code] || AI_MESSAGES[e.code] || 'Une erreur est survenue.';
  const err = (e ?? {}) as ErrLike;
  const msg = err.message ?? '';
  if (err.code === 'P0001' && DB_MESSAGES[msg]) return fill(DB_MESSAGES[msg], err.details ?? err.detail);
  if (DB_MESSAGES[msg]) return fill(DB_MESSAGES[msg], err.details ?? err.detail);
  if (err.code && AUTH_MESSAGES[err.code]) return AUTH_MESSAGES[err.code];
  if (/Invalid login credentials/i.test(msg)) return AUTH_MESSAGES.invalid_credentials;
  if (/Email not confirmed/i.test(msg)) return AUTH_MESSAGES.email_not_confirmed;
  if (/already registered/i.test(msg)) return AUTH_MESSAGES.user_already_exists;
  if (/at least \d+ characters/i.test(msg)) return AUTH_MESSAGES.weak_password;
  if (err.code === '42501' || /row-level security|permission denied/i.test(msg)) return DB_MESSAGES.forbidden;
  if (err.code === '23505') return 'Cet élément existe déjà.';
  if (err.code === '23503') return 'Cet élément est lié à d’autres données : il ne peut pas être supprimé.';
  if (['23514', '23502', '22P02', '22007', '22008', '22003'].includes(err.code ?? '')) return DB_MESSAGES.invalid;
  if (/exceeded the maximum allowed size|Payload too large/i.test(msg)) return 'La photo est trop lourde (5 Mo au maximum).';
  if (/mime type/i.test(msg)) return 'Format de photo non accepté : utilisez JPEG, PNG ou WebP.';
  if (/Failed to fetch|NetworkError|Load failed|fetch failed|AuthRetryableFetchError|FunctionsFetchError/i.test(`${err.name ?? ''} ${msg}`) || err.status === 0)
    return 'Connexion impossible. Vérifiez votre réseau, puis réessayez : rien n’a été perdu.';
  return 'Une erreur inattendue est survenue. Réessayez dans un instant.';
}

/** Code métier d'une erreur (« stock_insufficient », « over_reservation »…). */
export function errorCode(e: unknown): string | undefined {
  if (e instanceof AppError) return e.code;
  const err = (e ?? {}) as ErrLike;
  return err.code === 'P0001' ? err.message : err.code;
}

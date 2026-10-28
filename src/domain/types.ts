/** Types des données telles que renvoyées par la base (voir supabase/migrations). */

export type Color = 'rouge' | 'blanc' | 'rose' | 'orange' | 'effervescent' | 'autre';
export type WineType = 'tranquille' | 'effervescent' | 'moelleux' | 'liquoreux' | 'fortifie' | 'autre';
export type AdviceSource = 'source' | 'general' | 'ai' | 'personal';
export type BottlePhotoSource = 'own' | 'off' | 'studio' | 'web';
export type Visibility = 'private' | 'friends' | 'event';
export type Storage = 'cave' | 'armoire' | 'piece' | 'autre' | 'unknown';
export type LocationKind = 'armoire' | 'casier' | 'etagere' | 'carton' | 'autre';
export type MovementKind = 'achat' | 'cadeau_recu' | 'entree' | 'consommation' | 'cadeau_offert' | 'correction' | 'annulation';

export type Profile = {
  id: string;
  display_name: string;
  currency: string;
  preferences: Preferences;
  is_admin: boolean;
  /** Apparaît dans la recherche d'amis (choix de la personne, désactivé par défaut). */
  discoverable: boolean;
  /** Affiche la section « Bouteilles partagées par mes amis » (activé par défaut). */
  show_shared_wines: boolean;
  /** Photo de profil (stockage privé), facultative : vue par ceux qui voient le prénom. */
  avatar_photo?: string | null;
  created_at: string;
};
/** Une autre personne telle que je la vois (contact, participant d'un même événement) : rien d'autre que son prénom. */
export type PersonName = { id: string; display_name: string; /** Photo de profil (stockage privé), facultative. */ avatar_photo?: string | null };

/**
 * Demande en attente, reçue (« in ») ou envoyée (« out »). open_cellar : la personne qui demande ouvre aussi sa cave
 * dès que la demande est acceptée.
 */
export type FriendRequest = { id: string; direction: 'in' | 'out'; other_id: string; other_name: string; created_at: string; open_cellar: boolean };
export type Block = { blocked_id: string; display_name: string; created_at: string };
export type AppNotification = {
  id: string;
  kind:
    | 'friend_request'
    | 'friend_accepted'
    | 'event_invite'
    | 'group_invite'
    | 'group_joined'
    | 'cellar_invite'
    | 'cellar_joined'
    | 'invite_joined'
    | 'cellar_opened'
    | 'cellar_access_request'
    /** Compte relié à un agenda Nous (actor_name : prénom du compte Nous). */
    | 'nous_linked'
    /** Alertes de maturité (actor_name : nom du vin ; ref_id : le vin). */
    | 'maturity_ready'
    | 'maturity_last'
    /** Résumé de plus de 3 alertes le même jour (actor_name : leur nombre). */
    | 'maturity_many';
  actor_id: string | null;
  actor_name: string | null;
  ref_id: string | null;
  created_at: string;
  read_at: string | null;
};
export type GroupRole = 'admin' | 'manager' | 'member';
/** Un de mes groupes (membre actif ou invité). */
export type MyGroup = {
  id: string;
  name: string;
  emoji: string;
  description: string | null;
  photo: string | null;
  my_role: GroupRole;
  my_status: 'invited' | 'active';
  members: number;
  /** Vins visibles dans la cave du groupe (lots en stock). */
  bottles: number;
  /** Bouteilles mises à disposition du groupe par l'ensemble des membres. */
  available_bottles: number;
  invited_by_name: string | null;
  created_at: string;
};
export type GroupMember = { user_id: string; display_name: string; role: GroupRole; status: 'invited' | 'active'; joined_at: string | null; invited_at: string };
/** Un de mes lots rendu visible dans un groupe, dont « allocated » bouteilles mises à sa disposition (réservées). */
export type GroupShare = { lot_id: string; group_id: string; owner_id: string; allocated: number; created_at: string };
export type GroupActivity = {
  id: string;
  group_id: string;
  actor_id: string | null;
  actor_name: string | null;
  kind:
    | 'created'
    | 'updated'
    | 'invited'
    | 'joined'
    | 'left'
    | 'removed'
    | 'role'
    | 'shared'
    | 'unshared'
    | 'allocated'
    | 'consumed'
    | 'event'
    | 'note'
    | 'wish';
  target_name: string | null;
  detail: string | null;
  created_at: string;
};
/** Envie commune d'un groupe, avec les personnes qui y participent. */
export type GroupWish = {
  id: string;
  wine_name: string;
  producer: string | null;
  vintage: number | null;
  color: Color | null;
  note: string | null;
  created_by: string | null;
  author_name: string | null;
  votes: number;
  voters: string[];
  voted: boolean;
  created_at: string;
};
/** Dégustation partagée avec un groupe (avec le nom de son auteur). */
export type GroupNote = {
  id: string;
  user_id: string;
  author_name: string;
  wine_name: string;
  producer: string | null;
  vintage: number | null;
  non_vintage: boolean;
  color: Color | null;
  region: string | null;
  appellation: string | null;
  rating: number | null;
  comment: string | null;
  dish: string | null;
  photo: string | null;
  tasted_on: string;
  event_id: string | null;
  mine: boolean;
};
/** Bouteille de la cave d'un groupe (mêmes masques que pour les amis, sauf pour les miennes), et combien sont mises à sa disposition. */
export type GroupLot = SharedLot & { mine: boolean; allocated: number };

/**
 * Cave gérée à plusieurs : une personne associée (ou invitée) à une cave. Le propriétaire reste unique ; la personne
 * associée gère les bouteilles de cette cave avec son propre compte.
 */
export type CellarLink = {
  cellar_id: string;
  cellar_name: string;
  owner_id: string;
  owner_name: string;
  user_id: string;
  user_name: string;
  status: 'invited' | 'active';
  invited_at: string;
  joined_at: string | null;
};

/** Résultat de la recherche, avec la relation actuelle (« friend » : au moins une cave ouverte ; « contact » : aucune). */
export type UserResult = { id: string; display_name: string; relation: 'friend' | 'contact' | 'requested' | 'incoming' | 'none' };

/**
 * Une personne avec qui je suis en relation, et qui voit quoi : ma cave lui est-elle ouverte (et comment), la sienne
 * m'est-elle ouverte, demandes d'accès en attente. Les nombres viennent de la même règle que la vue servie à chacun.
 */
export type Relation = {
  user_id: string;
  display_name: string;
  since: string;
  they_see_mine: boolean;
  i_see_theirs: boolean;
  /** Niveau de détail choisi pour cette personne (null si ma cave lui est fermée). */
  detail_level: DetailLevel | null;
  exceptions: number;
  /** Lots de ma cave qu'elle voit, et leurs bouteilles. */
  visible_lots: number;
  visible_bottles: number;
  /** Lots de sa cave que je vois. */
  shared_with_me: number;
  /** Sa demande pour voir ma cave / la mienne pour voir la sienne. */
  request_in: string | null;
  request_out: string | null;
  /** Accès que j'ai ouvert : toute ma cave partagée, ou une sélection ; date de fin éventuelle (passée : accès terminé). */
  scope: AccessScope | null;
  access_expires_at: string | null;
};
export type DetailLevel = 'standard' | 'restricted';
export type AccessScope = 'shared' | 'selection';

/** Ce que les autres voient de mes bouteilles, et pourquoi (aperçu « Ce que X voit de moi »). */
export type PreviewOrigin = 'friends' | 'proposable' | 'exception' | 'group' | 'event';
export type PreviewLot = {
  lot_id: string | null;
  wine_id: string | null;
  name: string;
  producer: string | null;
  vintage: number | null;
  non_vintage: boolean;
  color: Color | null;
  region: string | null;
  appellation: string | null;
  volume_ml: number;
  quantity: number | null;
  available: number | null;
  in_stock: boolean;
  purchase_price: number | null;
  currency: string | null;
  notes: string | null;
  hide_price: boolean;
  hide_quantity: boolean;
  hide_notes: boolean;
  label_photo: string | null;
  origin: PreviewOrigin;
  /** Groupe ou événement à l'origine de la visibilité. */
  origin_id: string | null;
  origin_label: string | null;
  origin_date: string | null;
};
export type CellarException = { owner_id: string; viewer_id: string; lot_id: string; mode: 'hide' | 'show'; created_at: string };

/** Ce que j'ai en commun avec une personne. */
export type RelationOverview = {
  connected: boolean;
  common_groups?: { id: string; name: string; emoji: string }[];
  common_events?: { id: string; title: string; starts_at: string; status: string }[];
  shared_cellars?: { cellar_id: string; cellar_name: string; mine: boolean; status: 'invited' | 'active' }[];
};

export type Preferences = {
  /** Alertes de maturité demandées (désactivées par défaut). */
  maturity_alerts?: boolean;
  /** Apparence choisie (par défaut : sombre). */
  theme?: 'sombre' | 'clair' | 'auto';
  /** Affiche d'emblée les champs avancés des formulaires. */
  advanced?: boolean;
  /** Visibilité proposée par défaut pour les nouveaux lots (toujours « privé » si absent). */
  default_visibility?: Visibility;
  /** Visite guidée : en cours (avec l'étape atteinte), terminée ou passée. Absente : jamais proposée. */
  tour?: TourState;
  /** Astuces de première visite déjà vues (identifiants de page). */
  tips?: string[];
  /** Date à laquelle l'information sur Lia et Anthropic a été lue (affichée une fois). */
  ai_notice?: string;
};
export type TourState = { status: 'active' | 'done' | 'skipped'; step: number };

export type Cellar = { id: string; owner_id: string; name: string; storage: Storage; notes: string | null; position: number; created_at: string };

export type Location = { id: string; cellar_id: string; owner_id: string; name: string; kind: LocationKind; position: number };

export type Wine = {
  id: string;
  owner_id: string;
  name: string;
  domaine: string | null;
  producer: string | null;
  cuvee: string | null;
  country: string | null;
  region: string | null;
  appellation: string | null;
  color: Color | null;
  wine_type: WineType | null;
  grapes: string[];
  vintage: number | null;
  non_vintage: boolean;
  label_photo: string | null;
  bottle_photo: string | null;
  drink_from: number | null;
  drink_until: number | null;
  window_source: AdviceSource | null;
  window_note: string | null;
  serve_temp_min: number | null;
  serve_temp_max: number | null;
  temp_source: AdviceSource | null;
  aeration: string | null;
  aeration_source: AdviceSource | null;
  pairings: string | null;
  pairings_source: AdviceSource | null;
  notes: string | null;
  favorite: boolean;
  /** Code-barres EAN / GTIN (8 à 14 chiffres). */
  barcode: string | null;
  /** Origine de la photo de la bouteille : la sienne, Open Food Facts, améliorée en studio, trouvée en ligne. */
  bottle_photo_source: BottlePhotoSource | null;
  /** Mention à afficher avec la photo (auteur, licence, lien). */
  bottle_photo_credit: string | null;
  /** Photo d'origine, conservée quand la photo de la bouteille est une version « studio ». Privée. */
  bottle_photo_original: string | null;
  created_at: string;
  updated_at: string;
};

export type Lot = {
  id: string;
  owner_id: string;
  wine_id: string;
  cellar_id: string;
  location_id: string | null;
  volume_ml: number;
  quantity: number;
  reserved: number;
  purchase_price: number | null;
  currency: string;
  purchase_date: string | null;
  purchase_place: string | null;
  visibility: Visibility;
  hide_price: boolean;
  hide_quantity: boolean;
  hide_notes: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Movement = {
  id: string;
  owner_id: string;
  lot_id: string;
  kind: MovementKind;
  delta: number;
  occurred_on: string;
  note: string | null;
  event_id: string | null;
  event_wine_id: string | null;
  /** Bouteille mise à disposition d'un groupe puis ouverte. */
  group_id: string | null;
  /** Personne qui a fait le mouvement (le propriétaire ou une personne associée à la cave). */
  done_by: string | null;
  reverses_id: string | null;
  created_at: string;
};

export type SharedLot = {
  lot_id: string;
  owner_id: string;
  owner_name: string;
  wine_id: string;
  name: string;
  domaine: string | null;
  producer: string | null;
  cuvee: string | null;
  country: string | null;
  region: string | null;
  appellation: string | null;
  color: Color | null;
  wine_type: WineType | null;
  grapes: string[];
  vintage: number | null;
  non_vintage: boolean;
  label_photo: string | null;
  bottle_photo: string | null;
  drink_from: number | null;
  drink_until: number | null;
  window_source: AdviceSource | null;
  serve_temp_min: number | null;
  serve_temp_max: number | null;
  aeration: string | null;
  pairings: string | null;
  volume_ml: number;
  visibility: Visibility;
  quantity: number | null;
  available: number | null;
  in_stock: boolean;
  purchase_price: number | null;
  currency: string | null;
  notes: string | null;
  hide_price: boolean;
  hide_quantity: boolean;
  hide_notes: boolean;
  updated_at: string;
};

export type Friendship = { user_a: string; user_b: string; invited_by: string | null; created_at: string };
/**
 * Lien d'invitation : « discovery » (relation seule), « friend » (relation + ma cave), « group » / « event » (relation +
 * invitation au groupe ou à l'événement target_id). Utilisable max_uses fois.
 */
export type InviteKind = 'discovery' | 'friend' | 'group' | 'event';
export type FriendInvite = {
  id: string;
  inviter_id: string;
  status: 'pending' | 'accepted' | 'declined' | 'revoked';
  created_at: string;
  expires_at: string;
  kind: InviteKind;
  target_id: string | null;
  max_uses: number;
  uses: number;
  /** Code du lien, gardé pour son auteur (absent pour les liens créés avant cette possibilité). */
  code: string | null;
  /** Destinataire indiqué à la création (« Pour Paul »). */
  note: string | null;
  /** Lien « voir ma cave » : sélection, niveau de détail, date de fin de l'accès. */
  options: InviteOptions;
};
export type InviteOptions = {
  scope?: AccessScope;
  lots?: string[];
  detail_level?: DetailLevel;
  access_expires_at?: string | null;
};
/** Qui a utilisé un de mes liens (nom masqué si la personne est bloquée). */
export type InviteRedemption = { invite_id: string; user_id: string; display_name: string | null; redeemed_at: string };

export type EventKind = 'diner' | 'degustation' | 'anniversaire' | 'soiree_theme';
export type EventStatus = 'planned' | 'cancelled' | 'done';
export type Rsvp = 'pending' | 'yes' | 'maybe' | 'no';
export type Course = 'aperitif' | 'entree' | 'plat' | 'fromage' | 'dessert' | 'autre';
export type EventWineStatus = 'proposed' | 'confirmed' | 'declined' | 'withdrawn' | 'released' | 'consumed' | 'not_consumed';

export type CaveEvent = {
  id: string;
  organizer_id: string;
  kind: EventKind;
  title: string;
  starts_at: string;
  place: string | null;
  description: string | null;
  theme: string | null;
  budget: number | null;
  status: EventStatus;
  /** Soirée d'un groupe (ses membres peuvent y être invités et y suggérer les bouteilles du groupe). */
  group_id: string | null;
  created_at: string;
  cancelled_at: string | null;
  closed_at: string | null;
};

export type Participant = { event_id: string; user_id: string; role: 'organizer' | 'guest'; rsvp: Rsvp; invited_at: string; responded_at: string | null };
export type Dish = { id: string; event_id: string; course: Course; name: string; position: number; created_by: string };

export type EventWine = {
  id: string;
  event_id: string;
  lot_id: string | null;
  owner_id: string;
  proposed_by: string | null;
  quantity: number;
  status: EventWineStatus;
  reserved_qty: number;
  /** Dont prises sur la mise à disposition du groupe (elles y reviennent si elles ne sont pas ouvertes). */
  from_group: number;
  consumed_qty: number | null;
  service_position: number | null;
  note: string | null;
  wine_name: string;
  wine_producer: string | null;
  wine_vintage: number | null;
  wine_non_vintage: boolean;
  wine_color: Color | null;
  wine_type: WineType | null;
  wine_region: string | null;
  wine_appellation: string | null;
  wine_grapes: string[];
  volume_ml: number;
  label_photo: string | null;
  created_at: string;
  decided_at: string | null;
};

export type SuggestableLot = {
  lot_id: string;
  owner_id: string;
  owner_name: string;
  name: string;
  producer: string | null;
  vintage: number | null;
  non_vintage: boolean;
  color: Color | null;
  region: string | null;
  appellation: string | null;
  volume_ml: number;
  quantity: number | null;
  available: number | null;
  in_stock: boolean;
  label_photo: string | null;
  /** Soirée d'un groupe : bouteille visible dans le groupe, dont tant mises à sa disposition (sinon null). */
  for_group: number | null;
};

export type Occasion = 'restaurant' | 'amis' | 'salon' | 'maison' | 'evenement' | 'autre';
export type PriceKind = 'verre' | 'bouteille_restaurant' | 'achat_boutique' | 'autre';

export type Tasting = {
  id: string;
  user_id: string;
  wine_id: string | null;
  lot_id: string | null;
  movement_id: string | null;
  event_id: string | null;
  event_wine_id: string | null;
  wine_name: string;
  producer: string | null;
  vintage: number | null;
  non_vintage: boolean;
  color: Color | null;
  region: string | null;
  appellation: string | null;
  grapes: string[];
  tasted_on: string;
  place: string | null;
  occasion: Occasion | null;
  rating: number | null;
  comment: string | null;
  robe: string | null;
  nez: string | null;
  bouche: string | null;
  acidite: 'faible' | 'moyenne' | 'vive' | null;
  tanins: 'aucun' | 'souples' | 'presents' | 'marques' | null;
  longueur: 'courte' | 'moyenne' | 'longue' | null;
  /** Profil gustatif facultatif, de 1 (discret) à 5 (intense) : axes du radar de « Mes goûts ». */
  fruite?: number | null;
  puissance?: number | null;
  boise?: number | null;
  mineralite?: number | null;
  dish: string | null;
  price_paid: number | null;
  price_kind: PriceKind | null;
  currency: string;
  rebuy: boolean;
  favorite: boolean;
  photo: string | null;
  share_with_event: boolean;
  /** Note partagée avec un de mes groupes. */
  group_id: string | null;
  created_at: string;
  updated_at: string;
};

export type WishItem = {
  id: string;
  user_id: string;
  wine_name: string;
  producer: string | null;
  vintage: number | null;
  color: Color | null;
  region: string | null;
  appellation: string | null;
  note: string | null;
  source_tasting_id: string | null;
  done: boolean;
  created_at: string;
};

export type PriceSource = { url: string; title?: string; seller?: string; price?: number; currency?: string; volume_ml?: number; vintage?: number | null };

export type MarketPrice = {
  id: string;
  owner_id: string;
  wine_id: string;
  volume_ml: number;
  currency: string;
  price_low: number;
  price_high: number;
  checked_at: string;
  method: 'web' | 'manual';
  sources: PriceSource[];
  note: string | null;
  check_id: string | null;
};

export type PriceCheck = {
  id: string;
  user_id: string;
  wine_id: string;
  volume_ml: number;
  status: 'verified' | 'unverified';
  currency: string | null;
  price_low: number | null;
  price_high: number | null;
  offers: PriceSource[];
  reason: string | null;
  model: string | null;
  created_at: string;
};

// ───────────── Scanner avant d'acheter ─────────────

export type ScanPhotoRole = 'front' | 'back' | 'price';

/** Fiche vérifiée d'une bouteille vue en magasin (mêmes champs que les fiches de vin, plus le degré). */
export type ScanWine = Partial<
  Pick<Wine, 'name' | 'domaine' | 'producer' | 'cuvee' | 'country' | 'region' | 'appellation' | 'color' | 'wine_type' | 'grapes' | 'vintage' | 'non_vintage'>
> & { volume_ml?: number | null; alcohol?: number | null };

export type ScanCandidate = { name: string; producer: string | null; cuvee: string | null; appellation: string | null; vintage: number | null; reason: string | null };

/** Lecture de Lia (écrite par le serveur) : jamais modifiée par l'application. */
export type ScanReading = {
  is_wine_label: boolean;
  fields: Record<string, unknown>;
  uncertain: string[];
  candidates: ScanCandidate[];
  price_tag: { price: number | null; currency: string; label: string | null; conditions: string | null };
  photo_issues: string[];
  notes: string | null;
};

export type Scan = {
  id: string;
  user_id: string;
  status: 'identified' | 'confirmed';
  photos: { path: string; role: ScanPhotoRole }[];
  barcode: string | null;
  /** Vide pour une analyse saisie à la main. */
  result: Partial<ScanReading>;
  wine: ScanWine;
  store_price: number | null;
  currency: string;
  store_name: string | null;
  price_confirmed: boolean;
  from_cache: boolean;
  created_at: string;
  updated_at: string;
  expires_at: string;
  /** Lot 3b : analyse du vin et offres du marché (null tant qu'elles n'ont pas été faites). */
  assessment: ScanAssessment | null;
  assessed_at: string | null;
  market: ScanMarket | null;
  market_checked_at: string | null;
  /** Lot 3c : budget de la personne pour cette bouteille (privé). */
  budget: number | null;
  /** Lot 3d : visite en magasin à laquelle appartient l'analyse. */
  visit_id: string | null;
};

/** Visite en magasin : plusieurs bouteilles comparées (privée). */
export type ScanVisit = { id: string; user_id: string; store_name: string | null; budget: number | null; occasion: string | null; created_at: string; updated_at: string };

export type QualityTier = 'remarquable' | 'tres_bon' | 'bon' | 'correct' | 'decevant';

/** Un élément de l'analyse : texte, origine (source citée ou estimation de Lia) et liens des sources. */
export type SourcedText = { text: string | null; origin: 'source' | 'estimation' | null; sources: string[] };

/** Analyse du vin par Lia (écrite par le serveur). */
export type ScanAssessment = {
  /** Vin analysé (wineKey) : une analyse ne sert qu'à ce vin précis. */
  key: string;
  producer: SourcedText;
  appellation: SourcedText;
  vintage: SourcedText & { rating: 'exceptionnel' | 'tres_bon' | 'bon' | 'moyen' | 'difficile' | null };
  /** Avis de dégustateurs ou de guides, uniquement avec le lien de la page qui les publie. */
  critics: { publication: string; reviewer: string | null; score: string | null; summary: string | null; url: string }[];
  /** Notes de consommateurs, uniquement si le site et le nombre d'avis sont visibles sur la page. */
  consumers: { site: string; average: number; scale: number; count: number; url: string }[];
  aromatic_profile: string | null;
  drink_window: { from: number; until: number; origin: 'source' | 'estimation'; source: string | null } | null;
  pairings: string | null;
  /** Niveau estimé par Lia à partir des sources ; null s'il n'y a pas assez de sources vérifiables. */
  quality: { tier: QualityTier; reason: string | null; sources: number } | null;
  quality_note: string | null;
  sources: { url: string; title: string; page_age: string | null }[];
  /** Pourquoi l'analyse n'a pas pu être menée (recherche désactivée, limite atteinte…). */
  reason: string | null;
  assessed_at: string;
};

export type ScanMarketOffer = {
  seller: string;
  url: string;
  title: string;
  /** Prix TTC d'une bouteille. */
  price: number;
  currency: string;
  shipping: number | null;
  min_quantity: number | null;
  country: string | null;
  page_age: string | null;
};

/** Offres comparables vérifiées, à une date donnée (écrit par le serveur). */
export type ScanMarket = {
  key: string;
  status: 'verified' | 'unverified';
  currency: string | null;
  low: number | null;
  high: number | null;
  median: number | null;
  /** Offres dans la devise retenue. */
  count: number;
  reliability: 'haute' | 'moyenne' | 'faible' | null;
  offers: ScanMarketOffer[];
  reason: string | null;
  checked_at: string;
};

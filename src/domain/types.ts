/** Types des données telles que renvoyées par la base (voir supabase/migrations). */

export type Color = 'rouge' | 'blanc' | 'rose' | 'orange' | 'effervescent' | 'autre';
export type WineType = 'tranquille' | 'effervescent' | 'moelleux' | 'liquoreux' | 'fortifie' | 'autre';
export type AdviceSource = 'source' | 'general' | 'ai' | 'personal';
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
  created_at: string;
};

export type Preferences = {
  /** Affiche d'emblée les champs avancés des formulaires. */
  advanced?: boolean;
  /** Visibilité proposée par défaut pour les nouveaux lots (toujours « privé » si absent). */
  default_visibility?: Visibility;
};

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
export type FriendInvite = { id: string; inviter_id: string; status: 'pending' | 'accepted' | 'declined' | 'revoked'; created_at: string; expires_at: string };

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
  proposed_by: string;
  quantity: number;
  status: EventWineStatus;
  reserved_qty: number;
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
  dish: string | null;
  price_paid: number | null;
  price_kind: PriceKind | null;
  currency: string;
  rebuy: boolean;
  favorite: boolean;
  photo: string | null;
  share_with_event: boolean;
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

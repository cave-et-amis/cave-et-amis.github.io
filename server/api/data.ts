/**
 * Lecture des données pour l'assistant, TOUJOURS avec le client de la personne connectée :
 * la base applique ses droits (RLS) exactement comme dans l'application. Aucun accès « service » ici.
 * Les objets renvoyés au modèle sont compacts : seulement ce qui sert à répondre.
 * Des autres personnes : leur prénom et des informations simples (vin, millésime, couleur, note sur 5, quantité visible,
 * statut, réponse) ; jamais un texte libre qu'elles ont écrit, ni le lieu, le budget ou la description de leurs événements.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Cellar, Color, Location, Lot, MarketPrice, SharedLot, SuggestableLot, Tasting, Wine } from '../../src/domain/types.ts';
import { MATURITY_LABELS, maturityOf, windowOf } from '../../src/domain/maturity.ts';
import { generalAeration, generalServingTemperature } from '../../src/domain/advice.ts';
import { ADVICE_SOURCES, colorLabel, fold, label, WINE_TYPES } from '../../src/domain/wine.ts';
import { deName } from '../../src/domain/format.ts';
import { AiFailure, sanitize } from './util.ts';

/** Profil gustatif d'une dégustation (1 à 5), transmis à Lia avec les observations. */
const PROFILE_AXES = [['fruite', 'fruité'], ['puissance', 'puissance'], ['boise', 'boisé'], ['mineralite', 'minéralité']] as const;

async function all<T>(q: () => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await q();
  if (error) throw new AiFailure('internal', sanitize(error.message));
  return (data ?? []) as T[];
}

/** Lecture par pages de 1 000 lignes (limite de l'API Supabase), jusqu'à un plafond raisonnable. */
async function paged<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, max = 5000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const rows = await all<T>(() => page(from, from + 999));
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/** Bouteilles d'un de mes lots mises à disposition d'un groupe (avec le nom du groupe). */

export type Allocation = { lot_id: string; group: string; bottles: number };

/** owner_name : propriétaire d'une cave gérée à plusieurs (absent pour les caves de la personne). */
export type CellarData = { wines: Wine[]; lots: Lot[]; cellars: (Cellar & { owner_name?: string })[]; locations: Location[]; allocations?: Allocation[] };

export async function loadCellar(sb: SupabaseClient, me?: string): Promise<CellarData> {
  const [wines, lots, cellars, locations, shares, groups, links] = await Promise.all([
    paged<Wine>((a, b) => sb.from('wines').select('*').order('name').order('id').range(a, b)),
    paged<Lot>((a, b) => sb.from('lots').select('*').order('id').range(a, b)),
    paged<Cellar>((a, b) => sb.from('cellars').select('*').order('id').range(a, b)),
    paged<Location>((a, b) => sb.from('locations').select('*').order('id').range(a, b)),
    // Mes mises à disposition (RLS : seulement les miennes) et le nom de mes groupes.
    paged<{ lot_id: string; group_id: string; allocated: number }>((a, b) => sb.from('group_shares').select('lot_id, group_id, allocated').gt('allocated', 0).range(a, b)),
    paged<{ id: string; name: string }>((a, b) => sb.from('groups').select('id, name').range(a, b)),
    // Caves gérées à plusieurs : nom de leur propriétaire.
    all<{ cellar_id: string; owner_id: string; owner_name: string }>(() => sb.rpc('my_cellar_links')),
  ]);
  const allocations = shares.map((s) => ({ lot_id: s.lot_id, group: groups.find((g) => g.id === s.group_id)?.name ?? 'un groupe', bottles: s.allocated }));
  const owners = Object.fromEntries(links.filter((l) => me && l.owner_id !== me).map((l) => [l.cellar_id, l.owner_name]));
  return { wines, lots, cellars: cellars.map((c) => ({ ...c, owner_name: owners[c.id] })), locations, allocations };
}

const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : undefined);

/** « Cave de la maison (cave de Bruno, gérée à plusieurs) » pour une cave dont la personne n'est pas propriétaire. */
function cellarName(data: CellarData, id: string) {
  const c = data.cellars.find((x) => x.id === id);
  if (!c) return undefined;
  return c.owner_name ? `${c.name} (cave ${deName(c.owner_name)}, gérée à plusieurs)` : c.name;
}

function adviceTag(source: string | null) {
  return source ? ADVICE_SOURCES[source as keyof typeof ADVICE_SOURCES] : undefined;
}

/** Vue compacte d'un vin de ma cave (stock agrégé de ses lots). */
export function compactWine(w: Wine, data: CellarData, year: number, detail = false) {
  const lots = data.lots.filter((l) => l.wine_id === w.id);
  const stock = lots.reduce((s, l) => s + l.quantity, 0);
  const reserved = lots.reduce((s, l) => s + l.reserved, 0);
  // « reserved » compte à la fois les réservations d'événements et les mises à disposition de groupes.
  const allocations = (data.allocations ?? []).filter((a) => lots.some((l) => l.id === a.lot_id));
  const forGroups = allocations.reduce((s, a) => s + a.bottles, 0);
  const storages = new Set(lots.map((l) => data.cellars.find((c) => c.id === l.cellar_id)?.storage ?? 'unknown'));
  const storage = storages.has('piece') ? 'piece' : [...storages][0];
  const win = windowOf(w);
  const temp =
    w.serve_temp_min || w.serve_temp_max
      ? { text: `${w.serve_temp_min ?? w.serve_temp_max}–${w.serve_temp_max ?? w.serve_temp_min} °C`, origin: adviceTag(w.temp_source) ?? 'Votre choix' }
      : (() => {
          const g = generalServingTemperature(w);
          return g ? { text: `${g.min}–${g.max} °C`, origin: 'Repère général' } : undefined;
        })();
  const base = {
    wine_id: w.id,
    name: w.name,
    vintage: w.vintage ?? (w.non_vintage ? 'sans millésime' : undefined),
    producer: w.domaine || w.producer || undefined,
    cuvee: w.cuvee || undefined,
    color: colorLabel(w.color) || undefined,
    type: label(WINE_TYPES, w.wine_type) || undefined,
    region: w.region || undefined,
    appellation: w.appellation || undefined,
    grapes: w.grapes?.length ? w.grapes : undefined,
    bottles_in_stock: stock,
    bottles_available: stock - reserved,
    bottles_reserved_for_events: reserved - forGroups || undefined,
    bottles_set_aside_for_groups: forGroups ? allocations.map((a) => ({ group: a.group, bottles: a.bottles })) : undefined,
    drink_window: win
      ? { from: win.from, until: win.until, origin: win.origin === 'general' ? 'Repère général très approximatif' : adviceTag(win.origin), note: w.window_note || undefined }
      : undefined,
    maturity: MATURITY_LABELS[maturityOf(win, year, storage)],
    storage_conditions: storage === 'piece' ? 'pièce à température ambiante (garde plus courte)' : storage === 'unknown' ? undefined : storage,
    serving_temperature: temp,
    favorite: w.favorite || undefined,
  };
  if (!detail) return base;
  return {
    ...base,
    country: w.country || undefined,
    aeration: w.aeration ? { text: w.aeration, origin: adviceTag(w.aeration_source) } : { text: generalAeration(w, year), origin: 'Repère général' },
    pairings: w.pairings ? { text: w.pairings, origin: adviceTag(w.pairings_source) } : undefined,
    personal_notes: clip(w.notes, 600),
    lots: lots.map((l) => ({
      lot_id: l.id,
      quantity: l.quantity,
      available: l.quantity - l.reserved,
      volume_ml: l.volume_ml,
      cellar: cellarName(data, l.cellar_id),
      location: data.locations.find((x) => x.id === l.location_id)?.name,
      purchase_price: l.purchase_price === null ? undefined : `${l.purchase_price} ${l.currency}`,
      purchase_date: l.purchase_date ?? undefined,
      sharing:
        l.visibility === 'private'
          ? 'privé'
          : l.visibility === 'friends'
            ? 'partagé avec les amis à qui la cave est ouverte'
            : 'proposable pour un événement (amis à qui la cave est ouverte)',
    })),
  };
}

export function searchWines(
  data: CellarData,
  year: number,
  q: { query?: string | null; color?: string | null; maturity?: string | null; include_empty?: boolean | null; limit?: number | null },
) {
  const words = fold(q.query ?? '')
    .split(/\s+/)
    .filter(Boolean);
  const rows = data.wines
    .map((w) => compactWine(w, data, year))
    .filter((w) => q.include_empty || w.bottles_in_stock > 0)
    .filter((w) => !q.color || fold(w.color) === fold(q.color))
    .filter((w) => !q.maturity || fold(w.maturity) === fold(MATURITY_LABELS[q.maturity as keyof typeof MATURITY_LABELS] ?? q.maturity))
    .filter((w) => {
      if (!words.length) return true;
      const hay = fold([w.name, w.producer, w.cuvee, w.region, w.appellation, w.color, w.type, String(w.vintage ?? ''), ...(w.grapes ?? [])].join(' '));
      return words.every((x) => hay.includes(x));
    });
  const limit = Math.min(Math.max(q.limit ?? 25, 1), 60);
  return { total_matching: rows.length, wines: rows.slice(0, limit) };
}

export async function wineDetails(sb: SupabaseClient, data: CellarData, wineId: string, year: number, me: string) {
  const w = data.wines.find((x) => x.id === wineId);
  if (!w) return { error: 'Vin introuvable dans la cave de la personne.' };
  const [tastings, prices] = await Promise.all([
    // Seulement le carnet de la personne : pas les notes d'un propriétaire de cave gérée à plusieurs partagées avec un événement.
    all<Tasting>(() => sb.from('tastings').select('*').eq('wine_id', wineId).eq('user_id', me).order('tasted_on', { ascending: false }).limit(5)),
    all<MarketPrice>(() => sb.from('market_prices').select('*').eq('wine_id', wineId).order('checked_at', { ascending: false }).limit(3)),
  ]);
  return {
    ...compactWine(w, data, year, true),
    my_tastings: tastings.map(compactTasting),
    market_prices_saved: prices.map((p) => ({
      range: `${p.price_low}–${p.price_high} ${p.currency}`,
      volume_ml: p.volume_ml,
      checked_on: p.checked_at.slice(0, 10),
      method: p.method === 'web' ? 'relevé de la recherche web' : 'saisi par la personne',
      sources: p.sources.map((s) => s.url),
    })),
  };
}

export function compactTasting(t: Tasting) {
  return {
    wine: t.wine_name,
    vintage: t.vintage ?? undefined,
    producer: t.producer ?? undefined,
    color: colorLabel(t.color) || undefined,
    region: t.region ?? undefined,
    appellation: t.appellation ?? undefined,
    grapes: t.grapes?.length ? t.grapes : undefined,
    date: t.tasted_on,
    occasion: t.occasion ?? undefined,
    rating_out_of_5: t.rating ?? undefined,
    comment: clip(t.comment, 300),
    observations: [t.robe && `robe : ${t.robe}`, t.nez && `nez : ${t.nez}`, t.bouche && `bouche : ${t.bouche}`, t.acidite && `acidité ${t.acidite}`, t.tanins && `tanins ${t.tanins}`, t.longueur && `longueur ${t.longueur}`, ...PROFILE_AXES.map(([k, label]) => t[k] && `${label} ${t[k]}/5`)]
      .filter(Boolean)
      .join(' ; ') || undefined,
    dish: t.dish ?? undefined,
    rebuy: t.rebuy || undefined,
  };
}

export async function listTastings(sb: SupabaseClient, userId: string, q: { query?: string | null; min_rating?: number | null; limit?: number | null }) {
  // Seulement le carnet de la personne (et non les notes que d'autres participants ont partagées avec un événement).
  const rows = await all<Tasting>(() => sb.from('tastings').select('*').eq('user_id', userId).order('tasted_on', { ascending: false }).limit(300));
  const words = fold(q.query ?? '')
    .split(/\s+/)
    .filter(Boolean);
  const filtered = rows
    .filter((t) => !q.min_rating || (t.rating ?? 0) >= q.min_rating)
    .filter((t) => !words.length || words.every((x) => fold([t.wine_name, t.producer, t.region, t.appellation, t.comment, t.color, ...(t.grapes ?? [])].join(' ')).includes(x)));
  const limit = Math.min(Math.max(q.limit ?? 30, 1), 60);
  return { total_matching: filtered.length, tastings: filtered.slice(0, limit).map(compactTasting) };
}

type GroupLotRow = SharedLot & { mine: boolean; allocated: number };
type GroupNoteRow = { author_name: string; mine: boolean; wine_name: string; vintage: number | null; color: Color | null; rating: number | null; comment: string | null; dish: string | null; tasted_on: string };
type GroupWishRow = { wine_name: string; vintage: number | null; producer: string | null; color: Color | null; note: string | null; votes: number; created_by: string | null };

/** Vie d'un groupe pour l'assistant (droits de la personne : elle doit en être membre). */
export async function groupDetails(sb: SupabaseClient, groupId: string, me: string) {
  const groups = await all<{ id: string; name: string; my_status: string }>(() => sb.rpc('my_groups'));
  const g = groups.find((x) => x.id === groupId && x.my_status === 'active');
  if (!g) return { error: 'Groupe introuvable, ou la personne n’en est pas membre.' };
  const [members, lots, notes, wishes, events] = await Promise.all([
    all<{ display_name: string; status: string }>(() => sb.rpc('group_members_list', { p_group: groupId })),
    all<GroupLotRow>(() => sb.rpc('group_lots', { p_group: groupId })),
    all<GroupNoteRow>(() => sb.rpc('group_notes', { p_group: groupId })),
    all<GroupWishRow>(() => sb.rpc('group_wishes_list', { p_group: groupId })),
    all<{ id: string; title: string; starts_at: string; status: string }>(() =>
      sb.from('events').select('id, title, starts_at, status').eq('group_id', groupId).order('starts_at', { ascending: false }).limit(10),
    ),
  ]);
  return {
    group_id: groupId,
    name: g.name,
    members: members.filter((m) => m.status === 'active').map((m) => m.display_name),
    bottles: lots.slice(0, 60).map((l) => ({
      lot_id: l.lot_id,
      owner: l.mine ? 'la personne' : l.owner_name,
      name: l.name,
      vintage: l.vintage ?? (l.non_vintage ? 'sans millésime' : undefined),
      producer: l.domaine || l.producer || undefined,
      color: colorLabel(l.color) || undefined,
      appellation: l.appellation || undefined,
      region: l.region || undefined,
      set_aside_for_the_group: l.allocated || undefined,
      visible_only: l.allocated ? undefined : true,
    })),
    // Commentaire, plat et date : seulement pour les notes de la personne.
    member_tastes: notes.slice(0, 40).map((t) => ({
      member: t.mine ? 'la personne' : t.author_name,
      wine: t.wine_name,
      vintage: t.vintage ?? undefined,
      color: colorLabel(t.color) || undefined,
      rating_out_of_5: t.rating ?? undefined,
      ...(t.mine ? { comment: clip(t.comment, 200), dish: t.dish ?? undefined, date: t.tasted_on } : {}),
    })),
    common_wishes: wishes.slice(0, 20).map((w) => ({
      wine: w.wine_name,
      vintage: w.vintage ?? undefined,
      producer: w.producer ?? undefined,
      color: colorLabel(w.color) || undefined,
      participants: w.votes,
      note: w.created_by === me ? clip(w.note, 200) : undefined,
    })),
    evenings: events.map((e) => ({ event_id: e.id, title: e.title, date: e.starts_at.slice(0, 10), status: e.status })),
  };
}

export function compactShared(s: SharedLot) {
  return {
    lot_id: s.lot_id,
    owner: s.owner_name,
    name: s.name,
    vintage: s.vintage ?? (s.non_vintage ? 'sans millésime' : undefined),
    producer: s.domaine || s.producer || undefined,
    color: colorLabel(s.color) || undefined,
    region: s.region || undefined,
    appellation: s.appellation || undefined,
    volume_ml: s.volume_ml,
    quantity: s.hide_quantity ? 'masquée par le propriétaire' : s.quantity,
    in_stock: s.in_stock,
    can_be_suggested_for_events: s.visibility === 'event',
  };
}

export async function friendsWines(sb: SupabaseClient, q: { query?: string | null; color?: string | null; limit?: number | null }) {
  const { data, error } = await sb.rpc('shared_lots', { p_owner: null });
  if (error) throw new AiFailure('internal', sanitize(error.message));
  const words = fold(q.query ?? '')
    .split(/\s+/)
    .filter(Boolean);
  const rows = ((data ?? []) as SharedLot[])
    .filter((s) => !q.color || fold(colorLabel(s.color)) === fold(q.color))
    .filter((s) => !words.length || words.every((x) => fold([s.name, s.producer, s.domaine, s.region, s.appellation, s.owner_name, String(s.vintage ?? '')].join(' ')).includes(x)));
  const limit = Math.min(Math.max(q.limit ?? 30, 1), 60);
  return { total_matching: rows.length, wines: rows.slice(0, limit).map(compactShared) };
}

/** Mes bouteilles mises à disposition d'un groupe (lot → nombre), pour sa soirée : elles sont prises en premier. */
export async function myGroupAllocations(sb: SupabaseClient, groupId: string | null) {
  if (!groupId) return new Map<string, number>();
  const rows = await all<{ lot_id: string; allocated: number }>(() => sb.from('group_shares').select('lot_id, allocated').eq('group_id', groupId).gt('allocated', 0));
  return new Map(rows.map((r) => [r.lot_id, r.allocated]));
}

export async function eventDetails(sb: SupabaseClient, eventId: string, data: CellarData, year: number, me: string) {
  const { data: ev, error } = await sb.from('events').select('*').eq('id', eventId).maybeSingle();
  if (error) throw new AiFailure('internal', sanitize(error.message));
  if (!ev) return { error: 'Événement introuvable ou la personne n’y participe pas.' };
  const groupId = (ev as { group_id: string | null }).group_id ?? null;
  const [parts, dishes, wines, people, suggestable, forGroup, groupRow] = await Promise.all([
    all<{ user_id: string; role: string; rsvp: string }>(() => sb.from('event_participants').select('*').eq('event_id', eventId)),
    all<{ course: string; name: string; position: number }>(() => sb.from('event_dishes').select('*').eq('event_id', eventId).order('position')),
    // Sans la note qui accompagne un vin proposé (texte libre).
    all<{ id: string; owner_id: string; status: string; quantity: number; wine_name: string; wine_vintage: number | null; wine_color: string | null; wine_type: string | null; wine_appellation: string | null; service_position: number | null }>(
      () => sb.from('event_wines').select('id, owner_id, status, quantity, wine_name, wine_vintage, wine_color, wine_type, wine_appellation, service_position').eq('event_id', eventId),
    ),
    // Prénoms des autres participants : la table profiles ne donne que sa propre ligne.
    all<{ id: string; display_name: string }>(() => sb.rpc('profile_names')),
    sb.rpc('event_suggestable_lots', { p_event: eventId }).then((r) => (r.data ?? []) as SuggestableLot[]),
    myGroupAllocations(sb, groupId),
    groupId ? sb.from('groups').select('name').eq('id', groupId).maybeSingle().then((r) => r.data as { name: string } | null) : Promise.resolve(null),
  ]);
  const name = (id: string) => (id === me ? 'vous' : (people.find((p) => p.id === id)?.display_name ?? 'un participant'));
  const event = ev as { title: string; kind: string; starts_at: string; place: string | null; description: string | null; theme: string | null; budget: number | null; status: string; organizer_id: string };
  // Lieu (souvent une adresse), budget et description : seulement si la personne organise l'événement.
  const organizer = event.organizer_id === me;
  return {
    event_id: eventId,
    title: event.title,
    kind: event.kind,
    starts_at: event.starts_at,
    place: organizer ? (event.place ?? undefined) : undefined,
    theme: event.theme ?? undefined,
    budget: organizer ? (event.budget ?? undefined) : undefined,
    status: event.status,
    description: organizer ? clip(event.description, 500) : undefined,
    group_evening: groupRow ? `Soirée du groupe « ${groupRow.name} » (bouteilles du groupe proposables ; celles mises à sa disposition sont prises en premier)` : undefined,
    organizer: name(event.organizer_id),
    participants: parts.map((p) => ({ name: name(p.user_id), role: p.role, answer: p.rsvp })),
    menu: dishes.map((d) => `${d.course} : ${d.name}`),
    wines_planned: wines
      .filter((w) => ['proposed', 'confirmed', 'consumed'].includes(w.status))
      .map((w) => ({
        event_wine_id: w.id,
        wine: w.wine_name,
        vintage: w.wine_vintage ?? undefined,
        color: w.wine_color ?? undefined,
        type: w.wine_type ?? undefined,
        appellation: w.wine_appellation ?? undefined,
        owner: name(w.owner_id),
        quantity: w.quantity,
        status: w.status === 'confirmed' ? 'confirmé par son propriétaire' : w.status === 'proposed' ? 'proposé, en attente du propriétaire' : 'bu',
        service_position: w.service_position ?? undefined,
      })),
    my_available_bottles:
      event.status === 'planned'
        ? data.wines
            // Seulement ses propres bouteilles : on n'apporte pas celles d'une cave gérée avec son propriétaire.
            .filter((w) => w.owner_id === me)
            .map((w) => ({
              ...compactWine(w, data, year),
              lots: data.lots
                .filter((l) => l.wine_id === w.id && l.quantity - l.reserved + (forGroup.get(l.id) ?? 0) > 0)
                .map((l) => ({
                  lot_id: l.id,
                  available: l.quantity - l.reserved + (forGroup.get(l.id) ?? 0),
                  of_which_set_aside_for_this_group: forGroup.get(l.id) || undefined,
                  volume_ml: l.volume_ml,
                })),
            }))
            .filter((w) => w.lots.length > 0)
            .slice(0, 40)
        : undefined,
    friends_bottles_open_to_suggestions:
      event.status === 'planned'
        ? suggestable.map((s) => ({
            lot_id: s.lot_id,
            owner: s.owner_name,
            name: s.name,
            vintage: s.vintage ?? (s.non_vintage ? 'sans millésime' : undefined),
            producer: s.producer ?? undefined,
            color: colorLabel(s.color) || undefined,
            region: s.region ?? undefined,
            appellation: s.appellation ?? undefined,
            volume_ml: s.volume_ml,
            quantity: s.quantity ?? 'masquée par le propriétaire',
            in_stock: s.in_stock,
            set_aside_for_the_group: s.for_group || undefined,
          }))
        : undefined,
  };
}

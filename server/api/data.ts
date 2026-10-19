/**
 * Lecture des données pour l'assistant, TOUJOURS avec le client de la personne connectée :
 * la base applique ses droits (RLS) exactement comme dans l'application. Aucun accès « service » ici.
 * Les objets renvoyés au modèle sont compacts : seulement ce qui sert à répondre.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Cellar, Location, Lot, MarketPrice, SharedLot, SuggestableLot, Tasting, Wine } from '../../src/domain/types.ts';
import { MATURITY_LABELS, maturityOf, windowOf } from '../../src/domain/maturity.ts';
import { generalAeration, generalServingTemperature } from '../../src/domain/advice.ts';
import { ADVICE_SOURCES, colorLabel, fold, label, WINE_TYPES } from '../../src/domain/wine.ts';
import { AiFailure, sanitize } from './util.ts';

async function all<T>(q: () => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await q();
  if (error) throw new AiFailure('internal', sanitize(error.message));
  return (data ?? []) as T[];
}

export type CellarData = { wines: Wine[]; lots: Lot[]; cellars: Cellar[]; locations: Location[] };

export async function loadCellar(sb: SupabaseClient): Promise<CellarData> {
  const [wines, lots, cellars, locations] = await Promise.all([
    all<Wine>(() => sb.from('wines').select('*').order('name').limit(2000)),
    all<Lot>(() => sb.from('lots').select('*').limit(4000)),
    all<Cellar>(() => sb.from('cellars').select('*')),
    all<Location>(() => sb.from('locations').select('*')),
  ]);
  return { wines, lots, cellars, locations };
}

const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : undefined);

function adviceTag(source: string | null) {
  return source ? ADVICE_SOURCES[source as keyof typeof ADVICE_SOURCES] : undefined;
}

/** Vue compacte d'un vin de ma cave (stock agrégé de ses lots). */
export function compactWine(w: Wine, data: CellarData, year: number, detail = false) {
  const lots = data.lots.filter((l) => l.wine_id === w.id);
  const stock = lots.reduce((s, l) => s + l.quantity, 0);
  const reserved = lots.reduce((s, l) => s + l.reserved, 0);
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
    bottles_reserved_for_events: reserved || undefined,
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
      cellar: data.cellars.find((c) => c.id === l.cellar_id)?.name,
      location: data.locations.find((x) => x.id === l.location_id)?.name,
      purchase_price: l.purchase_price === null ? undefined : `${l.purchase_price} ${l.currency}`,
      purchase_date: l.purchase_date ?? undefined,
      sharing: l.visibility === 'private' ? 'privé' : l.visibility === 'friends' ? 'partagé avec les amis' : 'proposable pour un événement',
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

export async function wineDetails(sb: SupabaseClient, data: CellarData, wineId: string, year: number) {
  const w = data.wines.find((x) => x.id === wineId);
  if (!w) return { error: 'Vin introuvable dans la cave de la personne.' };
  const [tastings, prices] = await Promise.all([
    all<Tasting>(() => sb.from('tastings').select('*').eq('wine_id', wineId).order('tasted_on', { ascending: false }).limit(5)),
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
    observations: [t.robe && `robe : ${t.robe}`, t.nez && `nez : ${t.nez}`, t.bouche && `bouche : ${t.bouche}`, t.acidite && `acidité ${t.acidite}`, t.tanins && `tanins ${t.tanins}`, t.longueur && `longueur ${t.longueur}`]
      .filter(Boolean)
      .join(' ; ') || undefined,
    dish: t.dish ?? undefined,
    rebuy: t.rebuy || undefined,
  };
}

export async function listTastings(sb: SupabaseClient, q: { query?: string | null; min_rating?: number | null; limit?: number | null }) {
  const rows = await all<Tasting>(() => sb.from('tastings').select('*').order('tasted_on', { ascending: false }).limit(300));
  const words = fold(q.query ?? '')
    .split(/\s+/)
    .filter(Boolean);
  const filtered = rows
    .filter((t) => !q.min_rating || (t.rating ?? 0) >= q.min_rating)
    .filter((t) => !words.length || words.every((x) => fold([t.wine_name, t.producer, t.region, t.appellation, t.comment, t.color, ...(t.grapes ?? [])].join(' ')).includes(x)));
  const limit = Math.min(Math.max(q.limit ?? 30, 1), 60);
  return { total_matching: filtered.length, tastings: filtered.slice(0, limit).map(compactTasting) };
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
    owner_notes: s.notes ?? undefined,
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

export async function eventDetails(sb: SupabaseClient, eventId: string, data: CellarData, year: number, me: string) {
  const { data: ev, error } = await sb.from('events').select('*').eq('id', eventId).maybeSingle();
  if (error) throw new AiFailure('internal', sanitize(error.message));
  if (!ev) return { error: 'Événement introuvable ou la personne n’y participe pas.' };
  const [parts, dishes, wines, profiles, suggestable] = await Promise.all([
    all<{ user_id: string; role: string; rsvp: string }>(() => sb.from('event_participants').select('*').eq('event_id', eventId)),
    all<{ course: string; name: string; position: number }>(() => sb.from('event_dishes').select('*').eq('event_id', eventId).order('position')),
    all<{ id: string; owner_id: string; status: string; quantity: number; wine_name: string; wine_vintage: number | null; wine_color: string | null; wine_type: string | null; wine_appellation: string | null; service_position: number | null; note: string | null }>(
      () => sb.from('event_wines').select('*').eq('event_id', eventId),
    ),
    all<{ id: string; display_name: string }>(() => sb.from('profiles').select('id, display_name')),
    sb.rpc('event_suggestable_lots', { p_event: eventId }).then((r) => (r.data ?? []) as SuggestableLot[]),
  ]);
  const name = (id: string) => (id === me ? 'vous' : (profiles.find((p) => p.id === id)?.display_name ?? 'un participant'));
  const event = ev as { title: string; kind: string; starts_at: string; place: string | null; description: string | null; theme: string | null; budget: number | null; status: string; organizer_id: string };
  return {
    event_id: eventId,
    title: event.title,
    kind: event.kind,
    starts_at: event.starts_at,
    place: event.place ?? undefined,
    theme: event.theme ?? undefined,
    budget: event.budget ?? undefined,
    status: event.status,
    description: clip(event.description, 500),
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
            .map((w) => compactWine(w, data, year))
            .filter((w) => w.bottles_available > 0)
            .slice(0, 40)
            .map((w) => ({
              ...w,
              lots: data.lots.filter((l) => l.wine_id === w.wine_id && l.quantity - l.reserved > 0).map((l) => ({ lot_id: l.id, available: l.quantity - l.reserved, volume_ml: l.volume_ml })),
            }))
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
          }))
        : undefined,
  };
}

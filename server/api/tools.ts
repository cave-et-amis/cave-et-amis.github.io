/**
 * Outils mis à disposition de Claude dans la conversation.
 *  - Lecture : exécutés avec le client de la personne connectée (droits RLS identiques à l'application).
 *  - Propositions (propose_*) : ne modifient RIEN. Le serveur vérifie la demande, rédige lui-même le libellé,
 *    et l'application affiche un bouton « Confirmer » ; la modification passe ensuite par les fonctions
 *    habituelles de la base, avec la personne aux commandes.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { COLORS } from '../../src/domain/wine.ts';
import { wineTitle } from '../../src/domain/wine.ts';
import type { Meter } from './claude.ts';
import { compactWine, eventDetails, friendsWines, listTastings, loadCellar, searchWines, wineDetails, type CellarData } from './data.ts';
import { lookupPrice, type PriceResult } from './price.ts';
import { AiFailure, isUuid, sanitize } from './util.ts';

export type PendingAction =
  | { id: string; type: 'consume'; label: string; lot_id: string; wine_id: string; quantity: number; note: string | null }
  | { id: string; type: 'wishlist'; label: string; item: { wine_name: string; producer: string | null; vintage: number | null; color: string | null; region: string | null; note: string | null } }
  | {
      id: string;
      type: 'wine_advice';
      label: string;
      wine_id: string;
      patch: Partial<{ drink_from: number; drink_until: number; serve_temp_min: number; serve_temp_max: number; aeration: string; pairings: string }>;
    }
  | { id: string; type: 'event_wine'; label: string; event_id: string; lot_id: string; quantity: number; own: boolean }
  | {
      id: string;
      type: 'tasting_draft';
      label: string;
      draft: { wine_name: string; vintage: number | null; wine_id: string | null; rating: number | null; comment: string | null; robe: string | null; nez: string | null; bouche: string | null };
    }
  | { id: string; type: 'save_price'; label: string; check_id: string; wine_id: string };

export type ChatSource = { title: string; url: string; note?: string };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });
const str = { type: 'string' };
const int = { type: 'integer' };
const colorEnum = { type: 'string', enum: COLORS.map((c) => c.label) };

/**
 * Outils non « strict » : l'API limite à 16 paramètres « nullable » l'ensemble des schémas stricts d'une requête,
 * et ces outils en cumulent davantage. Chaque entrée est donc revérifiée par le serveur (dispatch).
 */
function tool(name: string, description: string, properties: Record<string, unknown>): Anthropic.Messages.Tool {
  return {
    name,
    description,
    input_schema: { type: 'object', additionalProperties: false, required: Object.keys(properties), properties },
  };
}

export const CHAT_TOOLS: Anthropic.Messages.Tool[] = [
  tool('search_my_cellar', 'Cherche dans la cave de la personne (vins en stock par défaut). Filtres facultatifs : texte, couleur, maturité.', {
    query: nullable({ ...str, description: 'Mots à chercher : nom, producteur, appellation, cépage, millésime…' }),
    color: nullable(colorEnum),
    maturity: nullable({ type: 'string', enum: ['young', 'ready', 'soon', 'past', 'unknown'] }),
    include_empty: nullable({ type: 'boolean', description: 'Inclure les vins dont il ne reste aucune bouteille' }),
    limit: nullable(int),
  }),
  tool('get_wine_details', 'Fiche complète d’un vin de la cave : lots, emplacements, conseils enregistrés, dégustations, prix de marché enregistrés.', {
    wine_id: str,
  }),
  tool('list_my_tastings', 'Carnet de dégustation de la personne (vins bus, notes sur 5, commentaires, observations).', {
    query: nullable(str),
    min_rating: nullable(int),
    limit: nullable(int),
  }),
  tool('search_friends_wines', 'Bouteilles que les amis de la personne ont choisi de partager (avec les masques choisis par chaque ami).', {
    query: nullable(str),
    color: nullable(colorEnum),
    limit: nullable(int),
  }),
  tool('get_event', 'Détails d’un événement auquel la personne participe : menu, participants, vins prévus, ses bouteilles disponibles et celles de ses amis ouvertes aux suggestions.', {
    event_id: str,
  }),
  tool('lookup_market_price', 'Recherche web du prix de marché actuel d’un vin de la cave (millésime et contenance exacts), avec sources. Coûteux : seulement si la personne demande un prix.', {
    wine_id: str,
    volume_ml: nullable(int),
  }),
  tool('propose_consumption', 'Propose d’enregistrer la sortie de bouteilles bues (la personne confirmera).', {
    lot_id: str,
    quantity: int,
    note: nullable(str),
  }),
  tool('propose_wishlist_add', 'Propose d’ajouter un vin à la liste d’envies (la personne confirmera).', {
    wine_name: str,
    producer: nullable(str),
    vintage: nullable(int),
    color: nullable(colorEnum),
    region: nullable(str),
    note: nullable(str),
  }),
  tool('propose_wine_advice', 'Propose d’enregistrer sur une fiche des conseils (estimation de l’IA) : période de consommation, température, aération, accords. La personne confirmera.', {
    wine_id: str,
    drink_from: nullable(int),
    drink_until: nullable(int),
    serve_temp_min: nullable(int),
    serve_temp_max: nullable(int),
    aeration: nullable(str),
    pairings: nullable(str),
  }),
  tool('propose_event_wine', 'Propose une bouteille pour un événement : une des bouteilles de la personne (elle l’apportera) ou une bouteille proposable d’un ami participant (suggestion que l’ami confirmera).', {
    event_id: str,
    lot_id: str,
    quantity: int,
  }),
  tool('propose_tasting_note', 'Prépare une note de dégustation que la personne pourra relire, compléter et enregistrer.', {
    wine_name: str,
    vintage: nullable(int),
    wine_id: nullable(str),
    rating: nullable(int),
    comment: nullable(str),
    robe: nullable(str),
    nez: nullable(str),
    bouche: nullable(str),
  }),
];

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? sanitize(v, max) : null);
const intIn = (v: unknown, min: number, max: number) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : null);

export class ToolBox {
  private user: SupabaseClient;
  private svc: SupabaseClient;
  private meter: Meter;
  private userId: string;
  private currency: string;
  private year: number;
  private cellar: CellarData | null = null;
  readonly actions: PendingAction[] = [];
  readonly sources: ChatSource[] = [];
  readonly prices: PriceResult[] = [];
  readonly used: string[] = [];

  constructor(o: { user: SupabaseClient; svc: SupabaseClient; meter: Meter; userId: string; currency: string; year: number }) {
    this.user = o.user;
    this.svc = o.svc;
    this.meter = o.meter;
    this.userId = o.userId;
    this.currency = o.currency;
    this.year = o.year;
  }

  private async data() {
    this.cellar ??= await loadCellar(this.user, this.userId);
    return this.cellar;
  }

  private propose(action: DistributiveOmit<PendingAction, 'id'>): string {
    const full = { ...action, id: crypto.randomUUID() } as PendingAction;
    this.actions.push(full);
    return JSON.stringify({ proposed: full.label, status: 'Affiché à la personne avec un bouton de confirmation. Rien n’est encore modifié.' });
  }

  async run(name: string, input: Record<string, unknown>): Promise<{ content: string; isError?: boolean }> {
    this.used.push(name);
    try {
      return { content: await this.dispatch(name, input ?? {}) };
    } catch (e) {
      if (e instanceof AiFailure && ['budget_exhausted', 'quota_monthly', 'call_limit', 'invalid_key', 'service_unavailable'].includes(e.code)) throw e;
      return { content: JSON.stringify({ error: e instanceof AiFailure ? e.code : 'Erreur de lecture des données.' }), isError: true };
    }
  }

  private async dispatch(name: string, i: Record<string, unknown>): Promise<string> {
    switch (name) {
      case 'search_my_cellar':
        return JSON.stringify(
          searchWines(await this.data(), this.year, {
            query: text(i.query, 200),
            color: text(i.color, 40),
            maturity: text(i.maturity, 20),
            include_empty: i.include_empty === true,
            limit: intIn(i.limit, 1, 60),
          }),
        );
      case 'get_wine_details':
        if (!isUuid(i.wine_id)) return JSON.stringify({ error: 'wine_id invalide' });
        return JSON.stringify(await wineDetails(this.user, await this.data(), i.wine_id, this.year));
      case 'list_my_tastings':
        return JSON.stringify(await listTastings(this.user, this.userId, { query: text(i.query, 200), min_rating: intIn(i.min_rating, 1, 5), limit: intIn(i.limit, 1, 60) }));
      case 'search_friends_wines':
        return JSON.stringify(await friendsWines(this.user, { query: text(i.query, 200), color: text(i.color, 40), limit: intIn(i.limit, 1, 60) }));
      case 'get_event':
        if (!isUuid(i.event_id)) return JSON.stringify({ error: 'event_id invalide' });
        return JSON.stringify(await eventDetails(this.user, i.event_id, await this.data(), this.year, this.userId));
      case 'lookup_market_price':
        return this.lookup(i);
      case 'propose_consumption':
        return this.proposeConsumption(i);
      case 'propose_wishlist_add': {
        const wine_name = text(i.wine_name, 120);
        if (!wine_name) return JSON.stringify({ error: 'Nom du vin manquant' });
        const item = {
          wine_name,
          producer: text(i.producer, 120),
          vintage: intIn(i.vintage, 1800, 2100),
          color: COLORS.find((c) => c.label === i.color)?.value ?? null,
          region: text(i.region, 80),
          note: text(i.note, 300),
        };
        return this.propose({ type: 'wishlist', label: `Ajouter « ${wineTitle({ name: item.wine_name, vintage: item.vintage })} » à votre liste d’envies`, item });
      }
      case 'propose_wine_advice':
        return this.proposeAdvice(i);
      case 'propose_event_wine':
        return this.proposeEventWine(i);
      case 'propose_tasting_note': {
        const wine_name = text(i.wine_name, 120);
        if (!wine_name) return JSON.stringify({ error: 'Nom du vin manquant' });
        const data = await this.data();
        const wine = isUuid(i.wine_id) ? data.wines.find((w) => w.id === i.wine_id) : undefined;
        const draft = {
          wine_name,
          vintage: intIn(i.vintage, 1800, 2100),
          wine_id: wine?.id ?? null,
          rating: intIn(i.rating, 1, 5),
          comment: text(i.comment, 2000),
          robe: text(i.robe, 300),
          nez: text(i.nez, 500),
          bouche: text(i.bouche, 500),
        };
        return this.propose({ type: 'tasting_draft', label: `Ouvrir une note de dégustation pré-remplie pour « ${wineTitle({ name: wine_name, vintage: draft.vintage })} »`, draft });
      }
      default:
        return JSON.stringify({ error: `Outil inconnu : ${name}` });
    }
  }

  private async lookup(i: Record<string, unknown>) {
    if (!isUuid(i.wine_id)) return JSON.stringify({ error: 'wine_id invalide' });
    const data = await this.data();
    const wine = data.wines.find((w) => w.id === i.wine_id);
    if (!wine) return JSON.stringify({ error: 'Vin introuvable dans la cave de la personne.' });
    const volumes = data.lots.filter((l) => l.wine_id === wine.id).map((l) => l.volume_ml);
    const volume = intIn(i.volume_ml, 50, 30000) ?? volumes[0] ?? 750;
    const res = await lookupPrice({ svc: this.svc, meter: this.meter, userId: this.userId, currency: this.currency }, wine, volume);
    this.prices.push(res);
    for (const o of res.offers) this.sources.push({ title: o.title || o.seller || o.url, url: o.url, note: `${o.price} ${o.currency}` });
    if (res.status === 'verified' && res.check_id) {
      this.propose({ type: 'save_price', label: `Enregistrer ce relevé comme prix de marché de « ${wineTitle(wine)} »`, check_id: res.check_id, wine_id: wine.id });
    }
    return JSON.stringify(
      res.status === 'verified'
        ? {
            status: 'prix relevé en ligne',
            checked_on: res.checked_at.slice(0, 10),
            range: `${res.low}–${res.high} ${res.currency}`,
            volume_ml: res.volume_ml,
            offers: res.offers.map((o) => ({ seller: o.seller, price: o.price, currency: o.currency, url: o.url })),
            note: 'Les liens ont été vérifiés comme issus de la recherche web ; le prix peut varier, à confirmer sur le site.',
          }
        : { status: 'prix non vérifié', reason: res.reason },
    );
  }

  private async proposeConsumption(i: Record<string, unknown>) {
    const qty = intIn(i.quantity, 1, 24);
    if (!isUuid(i.lot_id) || !qty) return JSON.stringify({ error: 'lot_id ou quantité invalide' });
    const data = await this.data();
    const lot = data.lots.find((l) => l.id === i.lot_id);
    if (!lot) return JSON.stringify({ error: 'Lot introuvable dans la cave de la personne.' });
    const available = lot.quantity - lot.reserved;
    if (qty > available) return JSON.stringify({ error: `Seulement ${available} bouteille(s) disponible(s) dans ce lot.` });
    const wine = data.wines.find((w) => w.id === lot.wine_id)!;
    const loc = data.locations.find((l) => l.id === lot.location_id)?.name;
    return this.propose({
      type: 'consume',
      label: `Enregistrer la sortie de ${qty} bouteille${qty > 1 ? 's' : ''} de « ${wineTitle(wine)} »${loc ? ` (${loc})` : ''}`,
      lot_id: lot.id,
      wine_id: wine.id,
      quantity: qty,
      note: text(i.note, 200),
    });
  }

  private async proposeAdvice(i: Record<string, unknown>) {
    if (!isUuid(i.wine_id)) return JSON.stringify({ error: 'wine_id invalide' });
    const data = await this.data();
    const wine = data.wines.find((w) => w.id === i.wine_id);
    if (!wine) return JSON.stringify({ error: 'Vin introuvable dans la cave de la personne.' });
    const patch: Extract<PendingAction, { type: 'wine_advice' }>['patch'] = {};
    const from = intIn(i.drink_from, 1800, 2200);
    const until = intIn(i.drink_until, 1800, 2200);
    if (from && until && from <= until) Object.assign(patch, { drink_from: from, drink_until: until });
    const tmin = intIn(i.serve_temp_min, 0, 25);
    const tmax = intIn(i.serve_temp_max, 0, 25);
    if (tmin !== null && tmax !== null && tmin <= tmax) Object.assign(patch, { serve_temp_min: tmin, serve_temp_max: tmax });
    const aeration = text(i.aeration, 300);
    if (aeration) patch.aeration = aeration;
    const pairings = text(i.pairings, 500);
    if (pairings) patch.pairings = pairings;
    if (!Object.keys(patch).length) return JSON.stringify({ error: 'Aucun conseil valable à enregistrer.' });
    const parts = [
      patch.drink_from && `à boire de ${patch.drink_from} à ${patch.drink_until}`,
      patch.serve_temp_min !== undefined && `servir à ${patch.serve_temp_min}–${patch.serve_temp_max} °C`,
      patch.aeration && 'conseil d’aération',
      patch.pairings && 'accords mets et vins',
    ].filter(Boolean);
    return this.propose({ type: 'wine_advice', label: `Enregistrer sur « ${wineTitle(wine)} » (estimation de l’IA) : ${parts.join(', ')}`, wine_id: wine.id, patch });
  }

  private async proposeEventWine(i: Record<string, unknown>) {
    const qty = intIn(i.quantity, 1, 24);
    if (!isUuid(i.event_id) || !isUuid(i.lot_id) || !qty) return JSON.stringify({ error: 'Paramètres invalides' });
    const { data: ev } = await this.user.from('events').select('id, title, status').eq('id', i.event_id).maybeSingle();
    const event = ev as { id: string; title: string; status: string } | null;
    if (!event) return JSON.stringify({ error: 'Événement introuvable.' });
    if (event.status !== 'planned') return JSON.stringify({ error: 'Événement terminé ou annulé.' });
    const data = await this.data();
    // Seulement les bouteilles de la personne : celles d'une cave gérée avec quelqu'un d'autre restent à la personne propriétaire.
    const own = data.lots.find((l) => l.id === i.lot_id && l.owner_id === this.userId);
    if (own) {
      const available = own.quantity - own.reserved;
      if (qty > available) return JSON.stringify({ error: `Seulement ${available} bouteille(s) disponible(s).` });
      const wine = data.wines.find((w) => w.id === own.wine_id)!;
      return this.propose({
        type: 'event_wine',
        label: `Apporter ${qty} bouteille${qty > 1 ? 's' : ''} de « ${wineTitle(wine)} » à « ${event.title} » (réservée${qty > 1 ? 's' : ''} pour l’occasion)`,
        event_id: event.id,
        lot_id: own.id,
        quantity: qty,
        own: true,
      });
    }
    const { data: options } = await this.user.rpc('event_suggestable_lots', { p_event: event.id });
    const friendLot = ((options ?? []) as { lot_id: string; owner_name: string; name: string; vintage: number | null }[]).find((o) => o.lot_id === i.lot_id);
    if (!friendLot) return JSON.stringify({ error: 'Cette bouteille n’est pas proposable pour cet événement.' });
    return this.propose({
      type: 'event_wine',
      label: `Suggérer à ${friendLot.owner_name} d’apporter « ${wineTitle(friendLot)} » à « ${event.title} » (${friendLot.owner_name} devra confirmer)`,
      event_id: event.id,
      lot_id: friendLot.lot_id,
      quantity: qty,
      own: false,
    });
  }

  /** Contexte d'ouverture (fiche ou événement) : simple rappel, les détails passent par les outils. */
  async contextNote(context: { kind: 'wine' | 'event'; id: string } | null): Promise<string | null> {
    if (!context || !isUuid(context.id)) return null;
    if (context.kind === 'wine') {
      const data = await this.data();
      const w = data.wines.find((x) => x.id === context.id);
      if (!w) return null;
      return `La personne a ouvert l’assistant depuis la fiche du vin « ${wineTitle(w)} » (wine_id ${w.id}). Résumé : ${JSON.stringify(compactWine(w, data, this.year))}`;
    }
    const { data: ev } = await this.user.from('events').select('id, title, starts_at').eq('id', context.id).maybeSingle();
    if (!ev) return null;
    const e = ev as { id: string; title: string; starts_at: string };
    return `La personne a ouvert l’assistant depuis l’événement « ${sanitize(e.title, 100)} » du ${e.starts_at.slice(0, 10)} (event_id ${e.id}). Utilise get_event pour les détails.`;
  }
}

import { describe, expect, it } from 'vitest';
import { generalAeration, generalServingTemperature, suggestServiceOrder } from '../src/domain/advice.ts';
import { applyFilters, buildRows, cellarCsv, EMPTY_FILTERS } from '../src/domain/cellar.ts';
import { AppError, toMessage } from '../src/domain/errors.ts';
import { fromLocalInput, toLocalInput } from '../src/domain/format.ts';
import { maturity, maturityOf, windowOf } from '../src/domain/maturity.ts';
import { valuation } from '../src/domain/valuation.ts';
import type { Cellar, Lot, Wine } from '../src/domain/types.ts';
import { readConfig } from '../src/config.ts';
import { actualCost, callBound, priceFor } from '../server/api/costs.ts';
import { cleanLabel } from '../server/api/label.ts';
import { normUrl, summarize, validateOffers } from '../server/api/price.ts';
import { sanitize } from '../server/api/util.ts';
import { toGroups } from '../src/ui/markdown.tsx';

const wine = (w: Partial<Wine>): Wine =>
  ({
    id: crypto.randomUUID(),
    owner_id: 'o',
    name: 'Vin',
    domaine: null,
    producer: null,
    cuvee: null,
    country: null,
    region: null,
    appellation: null,
    color: 'rouge',
    wine_type: null,
    grapes: [],
    vintage: 2018,
    non_vintage: false,
    label_photo: null,
    bottle_photo: null,
    drink_from: null,
    drink_until: null,
    window_source: null,
    window_note: null,
    serve_temp_min: null,
    serve_temp_max: null,
    temp_source: null,
    aeration: null,
    aeration_source: null,
    pairings: null,
    pairings_source: null,
    notes: null,
    favorite: false,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...w,
  }) as Wine;

const lot = (l: Partial<Lot>): Lot =>
  ({ id: crypto.randomUUID(), owner_id: 'o', wine_id: 'w', cellar_id: 'c', location_id: null, volume_ml: 750, quantity: 1, reserved: 0, purchase_price: null, currency: 'EUR', purchase_date: null, purchase_place: null, visibility: 'private', hide_price: true, hide_quantity: false, hide_notes: true, notes: null, created_at: '', updated_at: '', ...l }) as Lot;

describe('maturité (toujours indicative)', () => {
  it('fenêtre de la fiche prioritaire, repère général sinon, inconnue sans millésime', () => {
    expect(maturity(wine({ drink_from: 2025, drink_until: 2030, window_source: 'source' }), 2026)).toBe('ready');
    expect(maturity(wine({ drink_from: 2025, drink_until: 2026 }), 2026)).toBe('soon');
    expect(maturity(wine({ drink_from: 2028, drink_until: 2035 }), 2026)).toBe('young');
    expect(maturity(wine({ drink_from: 2015, drink_until: 2020 }), 2026)).toBe('past');
    expect(windowOf(wine({ vintage: 2020 }))).toMatchObject({ origin: 'general', approximate: true });
    expect(maturity(wine({ vintage: null }), 2026)).toBe('unknown');
  });

  it('les styles changent le repère général (rouge léger, grand blanc, rosé)', () => {
    expect(windowOf(wine({ vintage: 2020, grapes: ['Gamay'] }))).toMatchObject({ from: 2021, until: 2027 });
    expect(windowOf(wine({ vintage: 2019, color: 'blanc', appellation: 'Meursault' }))).toMatchObject({ from: 2021, until: 2029 });
    expect(windowOf(wine({ vintage: 2024, color: 'rose' }))).toMatchObject({ from: 2024, until: 2026 });
  });

  it('une conservation à température ambiante avance l’alerte « à boire bientôt »', () => {
    const win = { from: 2020, until: 2027, origin: 'personal' as const, approximate: false };
    expect(maturityOf(win, 2026, 'cave')).toBe('ready');
    expect(maturityOf(win, 2026, 'piece')).toBe('soon');
  });
});

describe('repères de service', () => {
  it('température et aération selon le style', () => {
    expect(generalServingTemperature(wine({ color: 'effervescent' }))).toMatchObject({ min: 6, max: 8 });
    expect(generalServingTemperature(wine({ color: 'rouge', appellation: 'Morgon' }))).toMatchObject({ min: 13, max: 15 });
    expect(generalServingTemperature(wine({ color: 'rouge', appellation: 'Pauillac' }))).toMatchObject({ min: 15, max: 17 });
    expect(generalAeration(wine({ vintage: 2004, appellation: 'Pauillac' }), 2026)).toMatch(/décanter/);
    expect(generalAeration(wine({ vintage: 2022, appellation: 'Madiran' }), 2026)).toMatch(/carafage/);
  });

  it('ordre de service : effervescent, blancs, rosé, rouges légers puis structurés, vins doux', () => {
    const order = suggestServiceOrder([
      { id: 'liquoreux', color: 'blanc', wine_type: 'liquoreux', vintage: 2015 },
      { id: 'pauillac-vieux', color: 'rouge', wine_type: null, vintage: 2005, appellation: 'Pauillac' },
      { id: 'pauillac-jeune', color: 'rouge', wine_type: null, vintage: 2018, appellation: 'Pauillac' },
      { id: 'morgon', color: 'rouge', wine_type: null, vintage: 2020, appellation: 'Morgon' },
      { id: 'champagne', color: 'effervescent', wine_type: 'effervescent', vintage: null },
      { id: 'sancerre', color: 'blanc', wine_type: null, vintage: 2022, appellation: 'Sancerre' },
      { id: 'rose', color: 'rose', wine_type: null, vintage: 2024 },
    ]).map((w) => w.id);
    expect(order).toEqual(['champagne', 'sancerre', 'rose', 'morgon', 'pauillac-jeune', 'pauillac-vieux', 'liquoreux']);
  });
});

describe('valeur de la cave', () => {
  it('achat et marché séparés, prix inconnu jamais compté comme zéro, couverture indiquée', () => {
    const v = valuation(
      [
        lot({ wine_id: 'a', quantity: 6, purchase_price: 20 }),
        lot({ wine_id: 'b', quantity: 4, purchase_price: null }),
        lot({ wine_id: 'b', quantity: 2, purchase_price: 30, volume_ml: 1500 }),
        lot({ wine_id: 'c', quantity: 0, purchase_price: 100 }),
      ],
      [
        { wine_id: 'a', volume_ml: 750, currency: 'EUR', price_low: 25, price_high: 35, checked_at: '2026-01-01' },
        { wine_id: 'a', volume_ml: 750, currency: 'EUR', price_low: 30, price_high: 40, checked_at: '2026-09-01' },
        { wine_id: 'b', volume_ml: 750, currency: 'EUR', price_low: 10, price_high: 10, checked_at: '2026-09-01' },
      ],
    );
    expect(v.bottles).toBe(12);
    expect(v.purchase).toEqual({ totals: { EUR: 180 }, covered: 8 });
    // Dernier relevé pour (a, 75 cl) ; le magnum de b n'a pas de relevé à sa contenance : non estimé.
    expect(v.market.totals).toEqual({ EUR: { low: 6 * 30 + 4 * 10, high: 6 * 40 + 4 * 10 } });
    expect(v.market.covered).toBe(10);
  });
});

describe('inventaire et export', () => {
  const cellars = [{ id: 'c', name: 'Cave', storage: 'cave' } as Cellar];
  it('filtres par couleur, millésime, prix, maturité et stock', () => {
    const wines = [wine({ id: 'a', name: 'Alpha', color: 'blanc', vintage: 2022 }), wine({ id: 'b', name: 'Beta', vintage: 2010 })];
    const rows = buildRows(wines, [lot({ wine_id: 'a', quantity: 2, purchase_price: 12 }), lot({ wine_id: 'b', quantity: 0 })], cellars, 2026);
    expect(applyFilters(rows, EMPTY_FILTERS).map((r) => r.wine.id)).toEqual(['a']);
    expect(applyFilters(rows, { ...EMPTY_FILTERS, stock: 'all', vintageTo: 2015 }).map((r) => r.wine.id)).toEqual(['b']);
    expect(applyFilters(rows, { ...EMPTY_FILTERS, priceMax: 10 })).toEqual([]);
    expect(applyFilters(rows, { ...EMPTY_FILTERS, q: 'alpha 2022' })).toHaveLength(1);
  });

  it('l’export neutralise les formules de tableur', () => {
    const rows = buildRows([wine({ id: 'a', name: '=HYPERLINK("x")' })], [lot({ wine_id: 'a' })], cellars, 2026);
    expect(cellarCsv(rows, cellars, () => '')).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('coûts de l’assistant', () => {
  const opus = priceFor({ 'claude-opus-5-5': { input: 4, output: 20, cache_write: 5, cache_read: 0.2 } }, 'claude-opus-5-5')!;
  it('coût réel : jetons, cache et recherches web', () => {
    const cost = actualCost(opus, { input_tokens: 10_000, output_tokens: 1_000, cache_creation_input_tokens: 2_000, cache_read_input_tokens: 50_000, server_tool_use: { web_search_requests: 3 } }, 10);
    expect(cost).toBeCloseTo(0.04 + 0.02 + 0.01 + 0.01 + 0.03, 6);
  });
  it('enveloppe réservée toujours au-dessus du coût maximal possible hors pages web', () => {
    const bound = callBound({ price: opus, inputChars: 20_000, images: 1, maxOutputTokens: 3000, webSearches: 2, webSearchTokenAllowance: 25_000, webSearchPricePer1000: 10 });
    const worst = actualCost(opus, { input_tokens: 10_000 + 4800 + 50_000, output_tokens: 3000, server_tool_use: { web_search_requests: 2 } }, 10);
    expect(bound).toBeGreaterThanOrEqual(worst);
    expect(priceFor({}, 'claude-opus-5-5')).toBeNull();
  });
});

describe('vérification des prix et des étiquettes', () => {
  it('liens normalisés, offres inventées ou d’un autre millésime écartées', () => {
    const allowed = new Map([[normUrl('https://Caviste.example/vin/')!, 'Caviste']]);
    const offers = validateOffers(
      [
        { url: 'https://caviste.example/vin', title: '', seller: 'Caviste', price: 42, currency: 'eur', vintage: 2016, volume_ml: 750 },
        { url: 'https://caviste.example/vin#x', title: '', seller: 'Doublon', price: 41, currency: 'EUR', vintage: 2016, volume_ml: 750 },
        { url: 'https://ailleurs.example/vin', title: '', seller: 'Inventé', price: 10, currency: 'EUR', vintage: 2016, volume_ml: 750 },
        { url: 'https://caviste.example/vin', title: '', seller: 'Autre millésime', price: 50, currency: 'EUR', vintage: 2017, volume_ml: 750 },
      ],
      allowed,
      { vintage: 2016 },
      750,
    );
    expect(offers.map((o) => o.seller)).toEqual(['Caviste']);
    expect(offers[0].currency).toBe('EUR');
    expect(summarize([...offers, { url: 'https://b.example', price: 50, currency: 'EUR' }], 'EUR')).toEqual({ currency: 'EUR', low: 42, high: 50 });
    expect(normUrl('javascript:alert(1)')).toBeNull();
  });

  it('étiquette : valeurs hors limites écartées, inconnues laissées vides', () => {
    const r = cleanLabel(
      { is_wine_label: true, fields: { name: '  Château X ', vintage: 2999, color: 'violet', grapes: ['Merlot', 42], volume_ml: 750 }, uncertain: ['name', 'bogus'], advice: { drink_from: 2030, drink_until: 2020, serve_temp_min: 16, serve_temp_max: 18 } },
      2026,
    );
    expect(r.fields).toMatchObject({ name: 'Château X', vintage: null, color: null, grapes: ['Merlot'], cuvee: null });
    expect(r.uncertain).toEqual(['name']);
    expect(r.advice).toEqual({ serve_temp_min: 16, serve_temp_max: 18 });
  });

  it('les secrets sont masqués dans les journaux', () => {
    expect(sanitize('erreur sk-ant-api03-ABCdef_123 et Authorization: Bearer xyz')).toBe('erreur [clé masquée] et Authorization: [masqué]');
    expect(sanitize('sb_secret_abcdefghijklmnop')).toBe('[clé masquée]');
  });
});

describe('divers', () => {
  it('messages d’erreur traduits avec les quantités', () => {
    expect(toMessage({ code: 'P0001', message: 'over_reservation', details: '{"available":1}' })).toContain('une bouteille disponible');
    expect(toMessage({ code: 'P0001', message: 'stock_reserved', details: '{"quantity":3,"reserved":2}' })).toContain('2 bouteilles de ce lot sont réservées');
    expect(toMessage(new AppError('', 'quota_daily'))).toMatch(/aujourd’hui/);
    expect(toMessage({ message: 'Failed to fetch' })).toMatch(/Connexion impossible/);
  });

  it('configuration : refuse une clé secrète ou une clé Anthropic dans le site', () => {
    const loc = { protocol: 'https:', hostname: 'x' };
    expect(readConfig({}, { supabaseUrl: 'https://abc.supabase.co', supabaseKey: 'sb_secret_123456' }, loc).mode).toBe('missing');
    expect(readConfig({}, { supabaseUrl: 'https://abc.supabase.co', supabaseKey: 'sk-ant-api03-zzz' }, loc).mode).toBe('missing');
    expect(readConfig({}, { supabaseUrl: 'https://abc.supabase.co', supabaseKey: 'sb_publishable_abc' }, loc)).toMatchObject({ mode: 'supabase', local: false });
    expect(readConfig({ VITE_LOCAL_API: '54321' }, undefined, { protocol: 'http:', hostname: '192.168.1.40' })).toMatchObject({ url: 'http://192.168.1.40:54321', local: true });
  });

  it('heure saisie interprétée comme l’heure de Paris', () => {
    const iso = fromLocalInput('2026-07-14T20:30');
    expect(iso).toBe('2026-07-14T18:30:00.000Z');
    expect(toLocalInput(iso)).toBe('2026-07-14T20:30');
  });

  it('mise en forme des réponses : listes et paragraphes', () => {
    expect(toGroups('Bonjour\n- un\n- deux\n\nFin').map((g) => g.kind)).toEqual(['p', 'ul', 'p']);
  });
});

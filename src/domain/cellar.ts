/** Inventaire : une ligne par vin (stock agrégé de ses lots), recherche, filtres, tri, export. */
import type { Cellar, Color, GroupShare, Lot, Storage, Wine } from './types.ts';
import { MATURITY_RANK, maturityOf, windowOf, type Maturity, type WindowInfo } from './maturity.ts';
import { colorLabel, fold, label, VISIBILITIES, vintageLabel, WINE_TYPES } from './wine.ts';

export type WineRow = {
  wine: Wine;
  lots: Lot[];
  stock: number;
  /** Bouteilles bloquées : réservées pour des événements + mises à disposition de groupes. */
  reserved: number;
  /** Dont mises à disposition de groupes. */
  forGroups: number;
  available: number;
  window: WindowInfo | null;
  maturity: Maturity;
  storage: Storage | null;
  minPrice: number | null;
  maxPrice: number | null;
  shared: boolean;
};

/**
 * Détail des bouteilles bloquées d'un lot : lots.reserved compte à la fois les réservations d'événements et les
 * mises à disposition de groupes (détaillées dans group_shares). Le reste du stock est libre.
 */
export function lotSplit(lot: Lot, shares: GroupShare[]) {
  const groups = shares.filter((s) => s.lot_id === lot.id && s.allocated > 0);
  const forGroups = groups.reduce((s, g) => s + g.allocated, 0);
  return { groups, forGroups, forEvents: Math.max(lot.reserved - forGroups, 0), free: lot.quantity - lot.reserved };
}

/** « 6 en stock · dont 2 pour mes groupes · 4 libres » */
export function splitText(quantity: number, forGroups: number, forEvents: number) {
  const free = quantity - forGroups - forEvents;
  return [
    `${quantity} en stock`,
    forGroups ? `dont ${forGroups} pour mes groupes` : null,
    forEvents ? `${forEvents} réservée${forEvents > 1 ? 's' : ''} (événements)` : null,
    `${free} libre${free > 1 ? 's' : ''}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function buildRows(wines: Wine[], lots: Lot[], cellars: Cellar[], year: number, shares: GroupShare[] = []): WineRow[] {
  const byWine = new Map<string, Lot[]>();
  for (const l of lots) byWine.set(l.wine_id, [...(byWine.get(l.wine_id) ?? []), l]);
  return wines.map((wine) => {
    const ls = byWine.get(wine.id) ?? [];
    const stock = ls.reduce((s, l) => s + l.quantity, 0);
    const reserved = ls.reduce((s, l) => s + l.reserved, 0);
    const forGroups = ls.reduce((s, l) => s + lotSplit(l, shares).forGroups, 0);
    const storages = ls.filter((l) => l.quantity > 0).map((l) => cellars.find((c) => c.id === l.cellar_id)?.storage ?? 'unknown');
    const storage: Storage | null = storages.includes('piece') ? 'piece' : (storages[0] ?? null);
    const window = windowOf(wine);
    const prices = ls.filter((l) => l.quantity > 0 && l.purchase_price !== null).map((l) => Number(l.purchase_price));
    return {
      wine,
      lots: ls,
      stock,
      reserved,
      forGroups,
      available: stock - reserved,
      window,
      maturity: maturityOf(window, year, storage),
      storage,
      minPrice: prices.length ? Math.min(...prices) : null,
      maxPrice: prices.length ? Math.max(...prices) : null,
      shared: ls.some((l) => l.quantity > 0 && l.visibility !== 'private'),
    };
  });
}

export type Filters = {
  q: string;
  colors: Color[];
  region: string;
  vintageFrom: number | null;
  vintageTo: number | null;
  priceMin: number | null;
  priceMax: number | null;
  maturity: Maturity | null;
  cellarId: string | null;
  locationId: string | null;
  stock: 'in' | 'all' | 'empty';
  favorite: boolean;
  shared: boolean;
};

export const EMPTY_FILTERS: Filters = {
  q: '',
  colors: [],
  region: '',
  vintageFrom: null,
  vintageTo: null,
  priceMin: null,
  priceMax: null,
  maturity: null,
  cellarId: null,
  locationId: null,
  stock: 'in',
  favorite: false,
  shared: false,
};

export function activeFilterCount(f: Filters) {
  return (
    (f.colors.length ? 1 : 0) +
    (f.region ? 1 : 0) +
    (f.vintageFrom || f.vintageTo ? 1 : 0) +
    (f.priceMin !== null || f.priceMax !== null ? 1 : 0) +
    (f.maturity ? 1 : 0) +
    (f.cellarId ? 1 : 0) +
    (f.locationId ? 1 : 0) +
    (f.stock !== 'in' ? 1 : 0) +
    (f.favorite ? 1 : 0) +
    (f.shared ? 1 : 0)
  );
}

export function matchesText(w: Wine, q: string) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold(
    [w.name, w.domaine, w.producer, w.cuvee, w.country, w.region, w.appellation, colorLabel(w.color), label(WINE_TYPES, w.wine_type), vintageLabel(w), ...(w.grapes ?? [])].join(' '),
  );
  return words.every((x) => hay.includes(x));
}

export function applyFilters(rows: WineRow[], f: Filters): WineRow[] {
  return rows.filter((r) => {
    const w = r.wine;
    if (f.stock === 'in' && r.stock <= 0) return false;
    if (f.stock === 'empty' && r.stock > 0) return false;
    if (!matchesText(w, f.q)) return false;
    if (f.colors.length && (!w.color || !f.colors.includes(w.color))) return false;
    if (f.region && !fold([w.region, w.appellation, w.country].join(' ')).includes(fold(f.region))) return false;
    if (f.vintageFrom && (!w.vintage || w.vintage < f.vintageFrom)) return false;
    if (f.vintageTo && (!w.vintage || w.vintage > f.vintageTo)) return false;
    if (f.priceMin !== null && (r.maxPrice === null || r.maxPrice < f.priceMin)) return false;
    if (f.priceMax !== null && (r.minPrice === null || r.minPrice > f.priceMax)) return false;
    if (f.maturity && r.maturity !== f.maturity) return false;
    if (f.cellarId && !r.lots.some((l) => l.cellar_id === f.cellarId && (f.stock !== 'in' || l.quantity > 0))) return false;
    if (f.locationId && !r.lots.some((l) => l.location_id === f.locationId && (f.stock !== 'in' || l.quantity > 0))) return false;
    if (f.favorite && !w.favorite) return false;
    if (f.shared && !r.shared) return false;
    return true;
  });
}

export type Sort = 'name' | 'maturity' | 'vintage' | 'recent' | 'stock';

export function sortRows(rows: WineRow[], sort: Sort): WineRow[] {
  const byName = (a: WineRow, b: WineRow) => a.wine.name.localeCompare(b.wine.name, 'fr') || (a.wine.vintage ?? 0) - (b.wine.vintage ?? 0);
  const copy = [...rows];
  switch (sort) {
    case 'maturity':
      return copy.sort((a, b) => MATURITY_RANK[a.maturity] - MATURITY_RANK[b.maturity] || (a.window?.until ?? 9999) - (b.window?.until ?? 9999) || byName(a, b));
    case 'vintage':
      return copy.sort((a, b) => (a.wine.vintage ?? 9999) - (b.wine.vintage ?? 9999) || byName(a, b));
    case 'recent':
      return copy.sort((a, b) => b.wine.created_at.localeCompare(a.wine.created_at));
    case 'stock':
      return copy.sort((a, b) => b.stock - a.stock || byName(a, b));
    default:
      return copy.sort(byName);
  }
}

/** Vins prêts à boire ou à boire bientôt (pour l'accueil), les plus urgents d'abord. */
export function readyToDrink(rows: WineRow[], limit = 5) {
  return sortRows(
    rows.filter((r) => r.available > 0 && (r.maturity === 'past' || r.maturity === 'soon' || r.maturity === 'ready')),
    'maturity',
  ).slice(0, limit);
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Une cellule commençant par = + - @ pourrait être interprétée comme une formule par le tableur.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Export de MA cave (un lot par ligne) : seules mes propres données, au format tableur (séparateur « ; »). */
export function cellarCsv(rows: WineRow[], cellars: Cellar[], locationName: (id: string | null) => string) {
  const head = [
    'Vin', 'Domaine / producteur', 'Cuvée', 'Millésime', 'Couleur', 'Type', 'Pays', 'Région', 'Appellation', 'Cépages', 'Contenance (ml)',
    'Quantité', 'Réservées', 'Cave', 'Emplacement', 'Prix d’achat', 'Devise', 'Date d’achat', 'Lieu d’achat', 'Partage', 'À boire de', 'À boire jusqu’à', 'Notes',
  ];
  const lines = [head.map(csvCell).join(';')];
  for (const r of rows) {
    for (const l of r.lots) {
      const w = r.wine;
      lines.push(
        [
          w.name, w.domaine || w.producer, w.cuvee, vintageLabel(w), colorLabel(w.color), label(WINE_TYPES, w.wine_type), w.country, w.region, w.appellation,
          (w.grapes ?? []).join(', '), l.volume_ml, l.quantity, l.reserved, cellars.find((c) => c.id === l.cellar_id)?.name, locationName(l.location_id),
          l.purchase_price === null ? '' : String(l.purchase_price).replace('.', ','), l.currency, l.purchase_date, l.purchase_place,
          label(VISIBILITIES, l.visibility), w.drink_from, w.drink_until, [w.notes, l.notes].filter(Boolean).join(' — '),
        ]
          .map(csvCell)
          .join(';'),
      );
    }
  }
  return '﻿' + lines.join('\r\n');
}

/**
 * Disposition de la cave visuelle (vue 3D et vue liste) : chaque emplacement de la cave est une étagère, chaque bouteille
 * en stock un casier. Calculée à partir des lots, sans rien enregistrer : pas de coordonnée par bouteille, les bouteilles
 * d'une étagère sont rangées dans l'ordre (par vin, puis par lot). Une étagère peut fixer ses rangées et ses casiers par
 * rangée (`locations.rows`, `locations.slots_per_row`) ; sinon la disposition s'adapte au nombre de bouteilles.
 */
import type { WineRow } from './cellar.ts';
import type { Location, Lot } from './types.ts';

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Casiers par rangée quand l'étagère ne le précise pas. */
export const AUTO_SLOTS = 12;
export const MAX_ROWS = 20;
export const MAX_SLOTS = 48;

export type CellarBottle = {
  key: string;
  row: WineRow;
  lot: Lot;
  /** 1 à quantité du lot. */
  index: number;
  shelfId: string;
  /** Rangée (0 = en haut) et casier (0 = à gauche) dans l'étagère. */
  r: number;
  s: number;
};

export type CellarShelf = {
  id: string;
  /** null : bouteilles sans emplacement. */
  location: Location | null;
  label: string;
  name: string;
  rows: number;
  slots: number;
  bottles: CellarBottle[];
  /** Bouteilles qui ne tiennent pas dans la disposition fixée par la personne. */
  overflow: number;
};

/** Rangées et casiers d'une étagère pour n bouteilles. */
export function shelfSize(n: number, fixedRows?: number | null, fixedSlots?: number | null) {
  const slots = Math.min(MAX_SLOTS, Math.max(1, fixedSlots ?? Math.min(AUTO_SLOTS, Math.max(n, 6))));
  const rows = Math.min(MAX_ROWS, Math.max(1, fixedRows ?? Math.ceil(Math.max(n, 1) / slots)));
  return { rows, slots, capacity: rows * slots };
}

/**
 * Étagères d'une cave : ses emplacements dans l'ordre choisi, puis « Sans emplacement » s'il reste des bouteilles hors
 * de tout emplacement de cette cave. `rows` : les vins (buildRows), pour retrouver le vin et la maturité de chaque lot.
 */
export function cellarLayout(cellarId: string, locations: Location[], lots: Lot[], rows: WineRow[]): CellarShelf[] {
  const byLot = new Map<string, WineRow>();
  for (const r of rows) for (const l of r.lots) byLot.set(l.id, r);
  const places = locations
    .filter((l) => l.cellar_id === cellarId)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'fr'));
  const inCellar = lots
    .filter((l) => l.cellar_id === cellarId && l.quantity > 0 && byLot.has(l.id))
    .sort((a, b) => byLot.get(a.id)!.wine.name.localeCompare(byLot.get(b.id)!.wine.name, 'fr') || a.created_at.localeCompare(b.created_at));

  const loose = inCellar.filter((l) => !l.location_id || !places.some((p) => p.id === l.location_id));
  // Disposition automatique : toutes les étagères ont la même largeur (celle qu'il faut à la plus remplie, 12 au plus),
  // pour que la cave forme un seul meuble.
  const count = (own: Lot[]) => own.reduce((n, l) => n + l.quantity, 0);
  const groups = [...places.map((p) => inCellar.filter((l) => l.location_id === p.id)), loose];
  const autoSlots = Math.min(AUTO_SLOTS, Math.max(6, ...groups.map(count)));

  const build = (id: string, location: Location | null, label: string, name: string, own: Lot[]): CellarShelf => {
    const flat = own.flatMap((lot) => Array.from({ length: lot.quantity }, (_, i) => ({ lot, index: i + 1 })));
    const { rows: nRows, slots, capacity } = shelfSize(flat.length, location?.rows, location?.slots_per_row ?? autoSlots);
    const bottles = flat.slice(0, capacity).map(({ lot, index }, i) => ({
      key: `${lot.id}:${index}`,
      row: byLot.get(lot.id)!,
      lot,
      index,
      shelfId: id,
      r: Math.floor(i / slots),
      s: i % slots,
    }));
    return { id, location, label, name, rows: nRows, slots, bottles, overflow: Math.max(0, flat.length - capacity) };
  };

  const out = places.map((loc, i) =>
    // Repère par lettre (A, B…) devant le nom donné par la personne (« Casier du fond »…).
    build(loc.id, loc, `${i < LETTERS.length ? `${LETTERS[i]} · ` : ''}${loc.name}`, loc.name, inCellar.filter((l) => l.location_id === loc.id)),
  );
  if (loose.length) out.push(build('aucun', null, 'Sans emplacement', 'sans emplacement', loose));
  return out;
}

/** Bouteilles libres d'un lot (ni réservées pour un événement, ni mises à disposition d'un groupe) : celles qu'on peut déplacer. */
export const freeBottles = (lot: Lot) => Math.max(0, lot.quantity - lot.reserved);

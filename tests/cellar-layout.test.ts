import { describe, expect, it } from 'vitest';
import { buildRows } from '../src/domain/cellar.ts';
import { cellarLayout, freeBottles, shelfSize } from '../src/domain/cellarLayout.ts';
import type { Cellar, Location, Lot, Wine } from '../src/domain/types.ts';

const cellar = { id: 'c', owner_id: 'moi', name: 'Cave', storage: 'cave', notes: null, position: 0, created_at: '2026-01-01' } as unknown as Cellar;
let n = 0;
const wine = (name: string, color = 'rouge') => ({ id: `w${++n}`, owner_id: 'moi', name, color, vintage: 2018, grapes: [], non_vintage: false }) as unknown as Wine;
const lot = (w: Wine, quantity: number, location_id: string | null, reserved = 0) =>
  ({ id: `l${++n}`, owner_id: 'moi', wine_id: w.id, cellar_id: 'c', location_id, quantity, reserved, volume_ml: 750, created_at: `2026-01-0${n % 9}` }) as unknown as Lot;
const loc = (id: string, name: string, position: number, rows: number | null = null, slots_per_row: number | null = null) =>
  ({ id, cellar_id: 'c', owner_id: 'moi', name, kind: 'etagere', position, rows, slots_per_row }) as Location;
const layout = (wines: Wine[], lots: Lot[], locations: Location[]) => cellarLayout('c', locations, lots, buildRows(wines, lots, [cellar], 2026, []));

describe('cave visuelle : disposition des étagères', () => {
  it('taille automatique : 6 casiers au moins, 12 au plus par rangée', () => {
    expect(shelfSize(0)).toEqual({ rows: 1, slots: 6, capacity: 6 });
    expect(shelfSize(9)).toEqual({ rows: 1, slots: 9, capacity: 9 });
    expect(shelfSize(30)).toEqual({ rows: 3, slots: 12, capacity: 36 });
    expect(shelfSize(5, 2, 4)).toEqual({ rows: 2, slots: 4, capacity: 8 });
    expect(shelfSize(5, 99, 99)).toEqual({ rows: 20, slots: 48, capacity: 960 });
  });

  it('étagères dans l’ordre choisi, « Sans emplacement » à la fin, même largeur en automatique', () => {
    const a = wine('Morgon');
    const b = wine('Chablis', 'blanc');
    const lots = [lot(a, 5, 'haut'), lot(b, 2, 'bas'), lot(a, 1, null)];
    const shelves = layout([a, b], lots, [loc('bas', 'Bas', 2), loc('haut', 'Haut', 1)]);
    expect(shelves.map((s) => [s.label, s.bottles.length, s.slots])).toEqual([
      ['A · Haut', 5, 6],
      ['B · Bas', 2, 6],
      ['Sans emplacement', 1, 6],
    ]);
    expect(shelves[0].bottles.map((x) => [x.r, x.s])).toEqual([[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]]);
  });

  it('disposition fixée : rangées remplies dans l’ordre, le surplus compté à part', () => {
    const a = wine('Morgon');
    const shelves = layout([a], [lot(a, 7, 'haut')], [loc('haut', 'Haut', 1, 2, 3)]);
    expect(shelves[0].rows).toBe(2);
    expect(shelves[0].bottles.map((x) => `${x.r}${x.s}`)).toEqual(['00', '01', '02', '10', '11', '12']);
    expect(shelves[0].overflow).toBe(1);
  });

  it('bouteilles libres : ni réservées ni mises à disposition', () => {
    const a = wine('Morgon');
    expect(freeBottles(lot(a, 5, null, 2))).toBe(3);
    expect(freeBottles(lot(a, 2, null, 3))).toBe(0);
  });
});

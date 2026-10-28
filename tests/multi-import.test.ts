import { describe, expect, it } from 'vitest';
import { cleanShelf, MAX_BOTTLES } from '../server/api/shelf.ts';
import { importPlan, matchWine, vintageToCheck, type ImportRow } from '../src/domain/multiImport.ts';
import type { Wine } from '../src/domain/types.ts';

let n = 0;
const row = (p: Partial<ImportRow>): ImportRow => ({ key: `r${++n}`, name: 'Morgon', producer: null, appellation: null, region: null, color: 'rouge', vintage: 2020, non_vintage: false, uncertain: [], selected: true, ...p });
const wine = (p: Partial<Wine>) => ({ id: `w${++n}`, owner_id: 'moi', name: 'Morgon', producer: null, cuvee: null, vintage: 2020, non_vintage: false, ...p }) as Wine;

describe('import multiple : lecture de Lia', () => {
  it('écarte une bouteille sans nom, un millésime impossible, une couleur inconnue ; au plus 12 bouteilles', () => {
    const r = cleanShelf(
      {
        bottles: [
          { name: '  ', producer: 'X' },
          { name: 'Morgon', producer: '', appellation: 'Morgon', region: 'Beaujolais', color: 'violet', vintage: 3000, non_vintage: false, uncertain: ['vintage', 'nimporte'] },
          ...Array.from({ length: 20 }, () => ({ name: 'Brouilly', vintage: 2021 })),
        ],
        notes: '',
      },
      2026,
    );
    expect(r.bottles).toHaveLength(MAX_BOTTLES);
    expect(r.bottles[0]).toEqual({ name: 'Morgon', producer: null, appellation: 'Morgon', region: 'Beaujolais', color: null, vintage: null, non_vintage: false, uncertain: ['vintage'] });
    expect(r.notes).toBeNull();
    expect(cleanShelf(null)).toEqual({ bottles: [], notes: null });
  });
});

describe('import multiple : ce qui est ajouté', () => {
  it('regroupe les bouteilles identiques, ignore les décochées, reconnaît un vin déjà en cave', () => {
    const cave = [wine({ name: 'Morgon', vintage: 2020 }), wine({ name: 'Brouilly', owner_id: 'autre' })];
    const plan = importPlan([row({}), row({}), row({ name: 'Brouilly', vintage: 2021 }), row({ name: 'Chiroubles', selected: false }), row({ name: '  ' })], cave, 'moi');
    expect(plan.map((p) => [p.row.name, p.quantity, p.existing?.id ?? null])).toEqual([
      ['Morgon', 2, cave[0].id],
      ['Brouilly', 1, null],
    ]);
  });

  it('un autre millésime n’est pas le même vin ; millésime à vérifier', () => {
    expect(matchWine(row({ vintage: 2019 }), [wine({})], 'moi')).toBeNull();
    expect(vintageToCheck(row({ uncertain: ['vintage'] }))).toBe(true);
    expect(vintageToCheck(row({ vintage: null }))).toBe(true);
    expect(vintageToCheck(row({ vintage: null, non_vintage: true }))).toBe(false);
    expect(vintageToCheck(row({}))).toBe(false);
  });
});

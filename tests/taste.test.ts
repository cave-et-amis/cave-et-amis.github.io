import { describe, expect, it } from 'vitest';
import { computeVerdict } from '../src/domain/scan.ts';
import { sameWine, tasteFit } from '../src/domain/taste.ts';
import type { Lot, ScanAssessment, ScanMarket, Tasting, Wine, WishItem } from '../src/domain/types.ts';

const ME = 'moi';
const OTHER = 'autre';
let n = 0;
const wine = (o: Partial<Wine>): Wine => ({ id: `w${++n}`, owner_id: ME, name: 'Vin', producer: null, domaine: null, cuvee: null, vintage: null, favorite: false, ...o }) as Wine;
const lot = (w: Wine, quantity: number, owner = ME): Lot => ({ id: `l${++n}`, owner_id: owner, wine_id: w.id, quantity }) as Lot;
const tasting = (o: Partial<Tasting>): Tasting =>
  ({ id: `t${++n}`, user_id: ME, wine_id: null, wine_name: 'Vin', producer: null, vintage: null, color: null, region: null, appellation: null, rating: null, tasted_on: '2026-09-01', ...o }) as Tasting;

const SCANNED = { name: 'Château Labeille', producer: 'Château Labeille', appellation: 'Pauillac', region: 'Bordeaux', color: 'rouge' as const, vintage: 2016 };
const fit = (o: { wines?: Wine[]; lots?: Lot[]; tastings?: Tasting[]; wishlist?: WishItem[]; price?: number | null; budget?: number | null }) =>
  tasteFit({ wine: SCANNED, me: ME, wines: o.wines ?? [], lots: o.lots ?? [], tastings: o.tastings ?? [], wishlist: o.wishlist ?? [], price: o.price ?? null, budget: o.budget ?? null });

describe('scanner : vos goûts (lot 3c)', () => {
  it('reconnaît le même vin malgré la casse, les accents et « château »', () => {
    expect(sameWine({ name: 'CHATEAU LABEILLE', producer: 'Château Labeille' }, { name: 'Labeille', producer: null })).toBe(true);
    expect(sameWine({ name: 'Château Labeille', cuvee: 'Le Petit' }, { name: 'Château Labeille', cuvee: 'Grand vin' })).toBe(false);
    expect(sameWine({ name: 'Labeille', producer: 'Maison A' }, { name: 'Labeille', producer: 'Maison B' })).toBe(false);
  });

  it('bouteilles déjà possédées (les miennes seulement), millésime compris', () => {
    const a = wine({ name: 'Château Labeille', vintage: 2016 });
    const b = wine({ name: 'Ch. Labeille', vintage: 2018 });
    const theirs = wine({ name: 'Château Labeille', vintage: 2016, owner_id: OTHER });
    const f = fit({ wines: [a, b, theirs], lots: [lot(a, 3), lot(b, 2), lot(theirs, 12, OTHER), lot(a, 0)] });
    expect(f.owned).toEqual({ bottles: 5, sameVintage: 3, vintages: [2016, 2018] });
    expect(f.notes[0]).toBe('Vous possédez déjà 3 bouteilles de ce vin dans ce millésime (5 en tout).');
  });

  it('adéquation forte : vins semblables appréciés ; faible : plutôt mal notés ; non évaluée sans données', () => {
    const liked = [tasting({ wine_name: 'Pichon', appellation: 'Pauillac', color: 'rouge', rating: 5 }), tasting({ wine_name: 'Batailley', appellation: 'Pauillac', color: 'rouge', rating: 4 })];
    const strong = fit({ tastings: liked });
    expect(strong).toMatchObject({ points: 2, level: 'forte', similar: { liked: 2, scope: 'appellation' } });
    expect(strong.notes).toContain('Ce vin ressemble à 2 rouges de Pauillac que vous avez appréciés.');
    const bad = fit({
      tastings: [
        tasting({ wine_name: 'A', region: 'Bordeaux', color: 'rouge', rating: 2 }),
        tasting({ wine_name: 'B', region: 'Bordeaux', color: 'rouge', rating: 1 }),
        tasting({ wine_name: 'C', region: 'Bordeaux', color: 'rouge', rating: 4 }),
      ],
    });
    expect(bad).toMatchObject({ points: 0, level: 'faible', similar: { scope: 'region', liked: 1, disliked: 2 } });
    expect(fit({}).points).toBeNull();
    expect(fit({}).notes).toContain('Pas encore assez de dégustations notées pour connaître vos goûts : notez vos vins dans le carnet.');
    // Les dégustations des autres ne comptent pas.
    expect(fit({ tastings: liked.map((t) => ({ ...t, user_id: OTHER })) }).points).toBeNull();
  });

  it('déjà dégusté, dans les envies, budget dépassé avec le style le mieux noté', () => {
    const f = fit({
      tastings: [
        tasting({ wine_name: 'Château Labeille', vintage: 2015, rating: 4, tasted_on: '2026-05-01' }),
        tasting({ wine_name: 'Morgon', region: 'Beaujolais', color: 'rouge', rating: 5 }),
        tasting({ wine_name: 'Fleurie', region: 'Beaujolais', color: 'rouge', rating: 4 }),
      ],
      wishlist: [{ id: 'x', wine_name: 'Labeille', producer: null, done: false } as WishItem],
      price: 32,
      budget: 25,
    });
    expect(f.points).toBe(2);
    expect(f.notes).toEqual(
      expect.arrayContaining(['Vous l’avez déjà dégusté (2015) : noté 4/5.', 'Il figure dans votre liste d’envies.', expect.stringMatching(/dépasse votre budget de 7,00/)]),
    );
    expect(f.overBudget).toBe(7);
    expect(f.suggestion).toBe('Pour votre budget, je vous conseillerais plutôt un rouge de la région Beaujolais, le style que vous notez le mieux (2 dégustations à 4/5 ou plus).');
  });

  it('les goûts entrent dans la note sur 10, pas dans le verdict', () => {
    const assessment = { quality: { tier: 'tres_bon', reason: null, sources: 2 } } as ScanAssessment;
    const market = { status: 'verified', currency: 'EUR', low: 18, high: 22, median: 20, count: 3 } as ScanMarket;
    const base = { storePrice: 18, priceConfirmed: true, currency: 'EUR', assessment, market };
    expect(computeVerdict(base)).toMatchObject({ verdict: 'excellent', score: 7.5, fit: null });
    expect(computeVerdict({ ...base, fit: 2 })).toMatchObject({ verdict: 'excellent', score: 8 });
    expect(computeVerdict({ ...base, fit: 0 })).toMatchObject({ verdict: 'excellent', score: 6 });
  });
});

import { describe, expect, it } from 'vitest';
import { buildRows } from '../src/domain/cellar.ts';
import { dishFamily, suggestPairings } from '../src/domain/pairing.ts';
import type { Cellar, Lot, Wine } from '../src/domain/types.ts';

const cellars = [{ id: 'c', name: 'Cave', storage: 'cave' } as Cellar];
const wine = (w: Partial<Wine>): Wine => ({ id: w.name!, owner_id: 'moi', name: 'Vin', color: null, wine_type: null, vintage: null, grapes: [], pairings: null, drink_from: null, drink_until: null, ...w }) as Wine;
const lot = (wineId: string, quantity = 2, reserved = 0): Lot => ({ id: `l-${wineId}`, wine_id: wineId, owner_id: 'moi', cellar_id: 'c', quantity, reserved, volume_ml: 750 }) as Lot;

describe('accords mets et vins parmi les bouteilles disponibles (mission H)', () => {
  it('famille du plat : mots-clés, accents et casse ignorés ; plat inconnu : aucune famille', () => {
    expect(dishFamily('Magret de CANARD au miel')?.id).toBe('viande_rouge');
    expect(dishFamily('Huîtres de Marennes')?.id).toBe('mer');
    expect(dishFamily('Tarte au citron')?.id).toBe('dessert');
    expect(dishFamily('Quelque chose')).toBeNull();
    // Mots entiers, plats principaux d'abord (relecture du lot 1).
    expect(dishFamily('Plateau de fruits de mer')?.id).toBe('mer');
    expect(dishFamily('Pâtes carbonara')?.id).toBe('vegetarien');
    expect(dishFamily('Barbecue entre amis')).toBeNull();
    expect(dishFamily('Magret glacé au miel')?.id).toBe('viande_rouge');
    expect(dishFamily('Côtes de porc')?.id).toBe('viande_blanche');
  });

  it('rouge pour le magret, prêt à boire d’abord ; jamais une bouteille sans exemplaire libre', () => {
    const wines = [
      wine({ name: 'Madiran', color: 'rouge', vintage: 2015, drink_from: 2020, drink_until: 2030, window_source: 'personal' }),
      wine({ name: 'Cahors jeune', color: 'rouge', vintage: 2023, drink_from: 2029, drink_until: 2040, window_source: 'personal' }),
      wine({ name: 'Réservé', color: 'rouge' }),
      wine({ name: 'Muscadet', color: 'blanc' }),
    ];
    const rows = buildRows(wines, [lot('Madiran'), lot('Cahors jeune'), lot('Réservé', 2, 2), lot('Muscadet')], cellars, 2026);
    const { family, suggestions } = suggestPairings('magret de canard', rows);
    expect(family?.label).toBe('Viande rouge et gibier');
    expect(suggestions.map((s) => s.row.wine.name)).toEqual(['Madiran', 'Cahors jeune']);
    expect(suggestions[0].reasons).toEqual(['couleur adaptée', 'prêt à boire']);
    expect(suggestions[1].reasons).toContain('encore jeune');
  });

  it('dessert : moelleux et liquoreux d’abord ; accord déjà noté sur la fiche', () => {
    const wines = [
      wine({ name: 'Sauternes', color: 'blanc', wine_type: 'liquoreux' }),
      wine({ name: 'Chablis', color: 'blanc', wine_type: 'tranquille' }),
      wine({ name: 'Maury', color: 'rouge', wine_type: 'fortifie', pairings: 'Fondant au chocolat' }),
    ];
    const rows = buildRows(wines, wines.map((w) => lot(w.id)), cellars, 2026);
    const { suggestions } = suggestPairings('fondant au chocolat', rows);
    expect(suggestions.map((s) => s.row.wine.name)).toEqual(['Maury', 'Sauternes', 'Chablis']);
    expect(suggestions[0].reasons).toContain('accord noté sur sa fiche');
    expect(suggestPairings('plat mystère', rows).suggestions).toEqual([]);
  });

  it('huîtres : jamais un rouge sur son seul type « tranquille »', () => {
    const wines = [wine({ name: 'Bordeaux rouge', color: 'rouge', wine_type: 'tranquille' }), wine({ name: 'Muscadet', color: 'blanc', wine_type: 'tranquille' })];
    const rows = buildRows(wines, wines.map((w) => lot(w.id)), cellars, 2026);
    expect(suggestPairings('huîtres', rows).suggestions.map((s) => s.row.wine.name)).toEqual(['Muscadet']);
  });
});

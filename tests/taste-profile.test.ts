import { describe, expect, it } from 'vitest';
import { cleanPreferenceList, tasteSummary, traitKey } from '../src/domain/tasteProfile.ts';
import type { Tasting } from '../src/domain/types.ts';

let n = 0;
const t = (p: Partial<Tasting>): Tasting =>
  ({
    id: `t${++n}`,
    user_id: 'moi',
    wine_name: 'Vin',
    grapes: [],
    rating: null,
    color: null,
    region: null,
    appellation: null,
    acidite: null,
    tanins: null,
    longueur: null,
    ...p,
  }) as Tasting;

describe('mémoire des goûts : ce que l’application déduit du carnet', () => {
  it('« vous aimez » à partir de 4/5 sur au moins deux dégustations ; « moins » à 2,5/5 ou moins', () => {
    const s = tasteSummary(
      [
        t({ rating: 5, color: 'rouge', region: 'Bourgogne', grapes: ['Pinot noir'], longueur: 'longue' }),
        t({ rating: 4, color: 'rouge', region: 'Bourgogne', grapes: ['Pinot noir'], longueur: 'longue' }),
        t({ rating: 2, color: 'blanc', tanins: null, region: 'Alsace' }),
        t({ rating: 2, color: 'blanc', region: 'Alsace' }),
        t({ rating: 5, region: 'Jura' }),
      ],
      'moi',
    );
    expect(s.rated).toBe(5);
    expect(s.liked.map((x) => x.label)).toEqual(['Bourgogne', 'Finale longue', 'Pinot noir', 'Rouge']);
    expect(s.disliked.map((x) => `${x.label} ${x.average}`)).toEqual(['Alsace 2', 'Blanc 2']);
    // Une seule dégustation (Jura) : pas assez pour en tirer un goût.
    expect(s.liked.find((x) => x.label === 'Jura')).toBeUndefined();
  });

  it('seulement MES dégustations notées ; un trait écarté n’est plus retenu', () => {
    const tastings = [
      t({ rating: 5, color: 'rouge' }),
      t({ rating: 5, color: 'rouge' }),
      t({ rating: 1, color: 'rouge', user_id: 'autre' }),
      t({ rating: null, color: 'blanc' }),
      t({ rating: null, color: 'blanc' }),
    ];
    expect(tasteSummary(tastings, 'moi').liked.map((x) => x.key)).toEqual([traitKey('couleur', 'rouge')]);
    expect(tasteSummary(tastings, 'moi', [traitKey('couleur', 'rouge')]).liked).toEqual([]);
    expect(tasteSummary([], 'moi')).toEqual({ rated: 0, liked: [], disliked: [] });
  });

  it('accents et casse : la même région ne compte qu’une fois', () => {
    const s = tasteSummary([t({ rating: 4, region: 'Rhône' }), t({ rating: 5, region: 'rhone' })], 'moi');
    expect(s.liked).toHaveLength(1);
    expect(s.liked[0]).toMatchObject({ count: 2, average: 4.5 });
  });

  it('préférences saisies : nettoyées, sans doublon, 20 au plus', () => {
    expect(cleanPreferenceList(['  Pinot   noir ', 'pinot noir', '', 'Bourgogne'])).toEqual(['Pinot noir', 'Bourgogne']);
    expect(cleanPreferenceList(Array.from({ length: 30 }, (_, i) => `Goût ${i}`))).toHaveLength(20);
    expect(cleanPreferenceList(['x'.repeat(60)])[0]).toHaveLength(40);
  });
});

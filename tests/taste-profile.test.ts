import { describe, expect, it } from 'vitest';
import { cleanPreferenceList, tasteRadar, tasteSummary, traitKey } from '../src/domain/tasteProfile.ts';
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

describe('radar des goûts : cinq axes, sur les vins aimés', () => {
  it('moyenne de chaque axe sur les dégustations notées 4/5 ou plus, à partir de deux valeurs', () => {
    const r = tasteRadar(
      [
        t({ rating: 5, fruite: 4, puissance: 3, boise: 2, acidite: 'vive' }),
        t({ rating: 4, fruite: 5, puissance: 4, acidite: 'moyenne', mineralite: 3 }),
        // Pas aimé : ne compte pas. Un autre carnet non plus.
        t({ rating: 2, fruite: 1, puissance: 1, boise: 5, mineralite: 5 }),
        t({ user_id: 'autre', rating: 5, boise: 5, mineralite: 5 }),
      ],
      'moi',
    );
    expect(r.liked).toBe(2);
    expect(Object.fromEntries(r.axes.map((a) => [a.key, a.value]))).toEqual({ fruite: 4.5, puissance: 3.5, boise: null, acidite: 4, mineralite: null });
    expect(r.axes.find((a) => a.key === 'boise')?.count).toBe(1);
  });

  it('ignore une valeur hors de 1 à 5 et un carnet vide', () => {
    expect(tasteRadar([t({ rating: 5, fruite: 9 }), t({ rating: 5, fruite: 0 })], 'moi').axes[0].value).toBeNull();
    expect(tasteRadar([], 'moi')).toEqual({ liked: 0, axes: expect.any(Array) });
  });
});

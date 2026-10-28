import { describe, expect, it } from 'vitest';
import { DISCOVERIES, MONTHLY, monthlyChallenge, progress } from '../src/domain/challenges.ts';
import type { Tasting } from '../src/domain/types.ts';

let n = 0;
const t = (p: Partial<Tasting>): Tasting =>
  ({ id: `t${++n}`, user_id: 'moi', wine_name: 'Vin', grapes: [], color: null, region: null, appellation: null, tasted_on: '2026-10-05', ...p }) as Tasting;
const loire = MONTHLY.find((c) => c.id === 'loire')!;

describe('défis et découvertes', () => {
  it('un défi par mois ; seules les dégustations du mois comptent pour le défi du mois', () => {
    expect(MONTHLY).toHaveLength(12);
    const { challenge, inMonth } = monthlyChallenge(new Date(2026, 9, 28));
    expect(challenge.id).toBe('bourgogne');
    expect(inMonth(t({ tasted_on: '2026-10-01' }))).toBe(true);
    expect(inMonth(t({ tasted_on: '2026-09-30' }))).toBe(false);
  });

  it('éléments différents goûtés, par appellation ou par le nom du vin, sans doublon ni carnet d’un autre', () => {
    const p = progress(
      loire,
      [
        t({ appellation: 'Sancerre' }),
        t({ appellation: 'SANCERRE' }),
        t({ wine_name: 'Domaine X Chinon Les Picasses' }),
        t({ appellation: 'Vouvray', user_id: 'autre' }),
        // « Saumur » seul n'est pas « Saumur-Champigny ».
        t({ appellation: 'Saumur' }),
      ],
      'moi',
    );
    expect(p.done).toEqual(['Chinon', 'Sancerre']);
    expect(p.complete).toBe(false);
    expect(progress(loire, [t({ appellation: 'Muscadet' }), t({ appellation: 'Chinon' }), t({ appellation: 'Vouvray' })], 'moi').complete).toBe(true);
  });

  it('cépages et couleurs', () => {
    const cepages = DISCOVERIES.find((d) => d.id === 'cepages-oublies')!;
    expect(progress(cepages, [t({ grapes: ['Savagnin'] }), t({ grapes: ['mondeuse', 'Gamay'] })], 'moi').done).toEqual(['Mondeuse', 'Savagnin']);
    const couleurs = DISCOVERIES.find((d) => d.id === 'couleurs')!;
    expect(progress(couleurs, [t({ color: 'rose' }), t({ color: 'rouge' })], 'moi').count).toBe(2);
  });
});

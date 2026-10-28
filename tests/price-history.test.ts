import { describe, expect, it } from 'vitest';
import { median, offersVsMedian, priceHistory, variation } from '../src/domain/priceHistory.ts';
import type { MarketPrice } from '../src/domain/types.ts';

const NOW = Date.parse('2026-10-28T12:00:00Z');
const days = (n: number) => new Date(NOW - n * 86400_000).toISOString();
let n = 0;
const p = (q: Partial<MarketPrice>): MarketPrice =>
  ({ id: `p${++n}`, owner_id: 'moi', wine_id: 'v', volume_ml: 750, currency: 'EUR', price_low: 40, price_high: 50, checked_at: days(10), method: 'web', sources: [], note: null, check_id: null, ...q }) as MarketPrice;

describe('évolution du prix de marché', () => {
  it('milieu de chaque fourchette, du plus ancien au plus récent, sur la période choisie', () => {
    const prices = [p({ checked_at: days(10), price_low: 38, price_high: 40 }), p({ checked_at: days(400), price_low: 50, price_high: 50 }), p({ checked_at: days(100), price_low: 42, price_high: 46 })];
    expect(priceHistory(prices, 750, 'EUR', 'tout', NOW).map((x) => x.value)).toEqual([50, 44, 39]);
    expect(priceHistory(prices, 750, 'EUR', '1a', NOW).map((x) => x.value)).toEqual([44, 39]);
    expect(priceHistory(prices, 750, 'EUR', '6m', NOW)).toHaveLength(2);
  });

  it('ne mélange ni les contenances ni les devises', () => {
    const prices = [p({}), p({ volume_ml: 1500 }), p({ currency: 'CHF' })];
    expect(priceHistory(prices, 750, 'EUR', 'tout', NOW)).toHaveLength(1);
  });

  it('écarts en pour cent, et médiane des offres d’un relevé', () => {
    expect(variation(34.2, 38.9)).toBe(-12);
    expect(variation(45, null)).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    const r = p({
      sources: [
        { url: 'https://a.test', price: 38.9, currency: 'EUR' },
        { url: 'https://b.test', price: 41.5, currency: 'EUR' },
        { url: 'https://c.test', price: 45, currency: 'EUR' },
        { url: 'https://d.test', price: 20, currency: 'USD' },
        { url: 'https://e.test', price: 80, currency: 'EUR', volume_ml: 1500 },
      ],
    });
    expect(offersVsMedian(r).map((o) => [o.offer.url, o.delta])).toEqual([
      ['https://a.test', -6],
      ['https://b.test', 0],
      ['https://c.test', 8],
    ]);
    // Une seule offre comparable : pas d'écart.
    expect(offersVsMedian(p({ sources: [{ url: 'https://a.test', price: 10, currency: 'EUR' }] }))[0].delta).toBeNull();
  });
});

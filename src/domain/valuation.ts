/**
 * Valeur de la cave. Deux calculs séparés, jamais mélangés :
 *  - valeur d'achat du stock restant (prix d'achat personnels) ;
 *  - valeur de marché estimée (derniers relevés enregistrés, même vin, même contenance).
 * Un prix inconnu n'est jamais compté comme zéro : on indique la part de la cave couverte.
 */

type LotLike = { wine_id: string; volume_ml: number; quantity: number; purchase_price: number | null; currency: string };
type PriceLike = { wine_id: string; volume_ml: number; currency: string; price_low: number; price_high: number; checked_at: string };

export type Valuation = {
  bottles: number;
  purchase: { totals: Record<string, number>; covered: number };
  market: { totals: Record<string, { low: number; high: number }>; covered: number; oldest: string | null; newest: string | null };
};

/** Dernier relevé de marché par vin et contenance. */
export function latestPrices<P extends PriceLike>(prices: P[]): Map<string, P> {
  const map = new Map<string, P>();
  for (const p of prices) {
    const key = `${p.wine_id}:${p.volume_ml}`;
    const cur = map.get(key);
    if (!cur || cur.checked_at < p.checked_at) map.set(key, p);
  }
  return map;
}

export function valuation(lots: LotLike[], prices: PriceLike[]): Valuation {
  const latest = latestPrices(prices);
  const v: Valuation = { bottles: 0, purchase: { totals: {}, covered: 0 }, market: { totals: {}, covered: 0, oldest: null, newest: null } };
  for (const lot of lots) {
    if (lot.quantity <= 0) continue;
    v.bottles += lot.quantity;
    if (lot.purchase_price !== null && lot.purchase_price !== undefined) {
      v.purchase.totals[lot.currency] = (v.purchase.totals[lot.currency] ?? 0) + lot.quantity * Number(lot.purchase_price);
      v.purchase.covered += lot.quantity;
    }
    const m = latest.get(`${lot.wine_id}:${lot.volume_ml}`);
    if (m) {
      const t = (v.market.totals[m.currency] ??= { low: 0, high: 0 });
      t.low += lot.quantity * Number(m.price_low);
      t.high += lot.quantity * Number(m.price_high);
      v.market.covered += lot.quantity;
      if (!v.market.oldest || m.checked_at < v.market.oldest) v.market.oldest = m.checked_at;
      if (!v.market.newest || m.checked_at > v.market.newest) v.market.newest = m.checked_at;
    }
  }
  return v;
}

export function coverageText(covered: number, total: number) {
  if (total === 0) return '';
  if (covered === total) return `toutes vos ${total} bouteilles`;
  return `${covered} bouteille${covered > 1 ? 's' : ''} sur ${total}`;
}

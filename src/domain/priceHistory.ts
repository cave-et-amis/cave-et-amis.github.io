/**
 * Évolution du prix de marché d'un vin (maquette Cave & Amis 2.0, panneau 9), calculée dans l'application à partir des
 * relevés enregistrés (recherche web ou saisie), sans IA. Un relevé est une fourchette : la courbe suit son milieu.
 * On ne compare que des relevés comparables : même contenance et même devise.
 */
import type { MarketPrice, PriceSource } from './types.ts';

export type PriceRange = '6m' | '1a' | '3a' | 'tout';
export const RANGES: { value: PriceRange; label: string; days: number | null }[] = [
  { value: '6m', label: '6 mois', days: 183 },
  { value: '1a', label: '1 an', days: 365 },
  { value: '3a', label: '3 ans', days: 3 * 365 },
  { value: 'tout', label: 'Tout', days: null },
];

export type PricePoint = { at: string; value: number; low: number; high: number };

const mid = (p: Pick<MarketPrice, 'price_low' | 'price_high'>) => Math.round(((Number(p.price_low) + Number(p.price_high)) / 2) * 100) / 100;

/** Points de la courbe pour une contenance et une devise, du plus ancien au plus récent, sur la période choisie. */
export function priceHistory(prices: MarketPrice[], volume: number, currency: string, range: PriceRange, now = Date.now()): PricePoint[] {
  const days = RANGES.find((r) => r.value === range)?.days ?? null;
  const from = days === null ? -Infinity : now - days * 86400_000;
  return prices
    .filter((p) => p.volume_ml === volume && p.currency === currency && new Date(p.checked_at).getTime() >= from)
    .sort((a, b) => a.checked_at.localeCompare(b.checked_at))
    .map((p) => ({ at: p.checked_at, value: mid(p), low: Number(p.price_low), high: Number(p.price_high) }));
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Écart en pour cent (arrondi) entre un prix et une référence ; null sans référence. */
export function variation(value: number, reference: number | null): number | null {
  if (reference === null || reference <= 0) return null;
  return Math.round(((value - reference) / reference) * 100);
}

/** Offres d'un relevé avec leur écart à la médiane des offres de ce même relevé (même devise et même contenance). */
export function offersVsMedian(p: MarketPrice): { offer: PriceSource; delta: number | null }[] {
  const priced = p.sources.filter(
    (s) => typeof s.price === 'number' && (!s.currency || s.currency === p.currency) && (!s.volume_ml || s.volume_ml === p.volume_ml),
  );
  const ref = median(priced.map((s) => s.price as number));
  return priced.map((offer) => ({ offer, delta: priced.length >= 2 ? variation(offer.price as number, ref) : null }));
}

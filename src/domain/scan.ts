/**
 * Scanner avant d'acheter : règles communes à l'application et au serveur.
 *  - wineKey : identité d'un vin pour le cache et pour savoir si une analyse correspond encore à la fiche vérifiée ;
 *  - verdict : recommandation d'achat et note interne sur 10, calculées selon une méthode fixe (voir VERDICT_METHOD),
 *    à partir des seules données disponibles. Ce n'est jamais une note professionnelle.
 */
import type { QualityTier, ScanAssessment, ScanMarket, ScanWine } from './types.ts';
import { fold } from './wine.ts';

/** Durée pendant laquelle un relevé de prix est considéré comme actuel. */
export const PRICE_FRESH_HOURS = 72;

/** Même producteur, même vin et cuvée, même millésime, même contenance. */
export function wineKey(w: ScanWine): string {
  const part = (v: unknown) => fold(String(v ?? '')).replace(/[^a-z0-9]+/g, ' ').trim();
  const vintage = w.vintage ? String(w.vintage) : w.non_vintage ? 'nv' : '?';
  return [part(w.producer || w.domaine), part(w.name), part(w.cuvee), vintage, w.volume_ml ?? 750].join('|');
}

export type { QualityTier };
export const QUALITY_TIERS: QualityTier[] = ['remarquable', 'tres_bon', 'bon', 'correct', 'decevant'];
export const QUALITY_LABELS: Record<QualityTier, string> = {
  remarquable: 'Remarquable',
  tres_bon: 'Très bon',
  bon: 'Bon',
  correct: 'Correct',
  decevant: 'Décevant',
};
const QUALITY_POINTS: Record<QualityTier, number> = { remarquable: 4, tres_bon: 3, bon: 2, correct: 1, decevant: 0 };

export type Verdict = 'excellent' | 'good' | 'fair' | 'poor' | 'insufficient';
export const VERDICT_LABELS: Record<Verdict, string> = {
  excellent: 'Excellente affaire',
  good: 'Bon achat',
  fair: 'Prix correct',
  poor: 'Peu intéressant à ce prix',
  insufficient: 'Informations insuffisantes',
};

/** Points de prix (0 à 4) selon le rapport prix du magasin / prix médian des offres vérifiées. */
export function pricePoints(ratio: number): number {
  if (ratio <= 0.8) return 4;
  if (ratio <= 0.95) return 3;
  if (ratio <= 1.05) return 2;
  if (ratio <= 1.2) return 1;
  return 0;
}

export const VERDICT_METHOD = [
  'Qualité (0 à 4 points) : niveau estimé par Lia à partir de sources citées (remarquable 4, très bon 3, bon 2, correct 1, décevant 0). Sans source vérifiable, la qualité n’est pas notée.',
  'Prix (0 à 4 points) : prix du rayon confirmé comparé au prix médian des offres vérifiées du même vin (même millésime, même contenance, même devise) : jusqu’à 20 % moins cher 4, jusqu’à 5 % moins cher 3, à ±5 % 2, jusqu’à 20 % plus cher 1, au-delà 0. Il faut au moins une offre vérifiée dans la devise du magasin.',
  'Note : (qualité + prix) ramenés sur 10, arrondis au demi-point. Verdict : « Excellente affaire » si le prix rapporte 3 points et la qualité 3 (ou 4 et 2) ; sinon « Bon achat » à partir de 5 points sur 8, « Prix correct » à partir de 3, « Peu intéressant à ce prix » en dessous.',
  'Sans prix confirmé, sans qualité notée ou sans prix de marché vérifié : « Informations insuffisantes », sans note.',
];

export type VerdictResult = {
  verdict: Verdict;
  /** Estimation calculée, sur 10 ; null si les informations manquent. */
  score: number | null;
  quality: number | null;
  price: number | null;
  /** Écarts avec le marché (prix du rayon − référence), en devise et en %. */
  gap: { vsMedian: number; vsMedianPct: number; vsLow: number; vsLowPct: number } | null;
  missing: string[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeVerdict(o: {
  storePrice: number | null;
  priceConfirmed: boolean;
  currency: string;
  assessment: ScanAssessment | null;
  market: ScanMarket | null;
}): VerdictResult {
  const missing: string[] = [];
  const tier = o.assessment?.quality?.tier ?? null;
  const quality = tier ? QUALITY_POINTS[tier] : null;
  if (quality === null) missing.push(o.assessment ? 'qualité non établie par des sources vérifiables' : 'analyse du vin non faite');
  const store = o.priceConfirmed ? o.storePrice : null;
  if (store === null) missing.push('prix du rayon non confirmé');
  const m = o.market;
  const usable = m && m.status === 'verified' && m.currency === o.currency && m.median !== null && m.low !== null;
  if (!usable) missing.push(m ? 'prix de marché non vérifié' : 'prix de marché non recherché');
  let price: number | null = null;
  let gap: VerdictResult['gap'] = null;
  if (store !== null && usable) {
    const ratio = store / m!.median!;
    price = pricePoints(ratio);
    gap = {
      vsMedian: round2(store - m!.median!),
      vsMedianPct: Math.round((ratio - 1) * 100),
      vsLow: round2(store - m!.low!),
      vsLowPct: Math.round((store / m!.low! - 1) * 100),
    };
  }
  if (quality === null || price === null) return { verdict: 'insufficient', score: null, quality, price, gap, missing };
  const total = quality + price;
  const verdict: Verdict =
    (price >= 3 && quality >= 3) || (price === 4 && quality >= 2) ? 'excellent' : total >= 5 ? 'good' : total >= 3 ? 'fair' : 'poor';
  return { verdict, score: Math.round((total / 8) * 20) / 2, quality, price, gap, missing };
}

/** Médiane d'une liste de prix. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : round2((s[mid - 1] + s[mid]) / 2);
}

/** Un relevé de prix est-il encore actuel ? */
export function priceIsFresh(checkedAt: string | null | undefined, now = Date.now()) {
  return Boolean(checkedAt) && now - Date.parse(checkedAt!) < PRICE_FRESH_HOURS * 3600_000;
}

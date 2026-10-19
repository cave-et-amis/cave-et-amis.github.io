/**
 * Maturité et fenêtre de consommation. Toujours indicatif :
 *  - fenêtre de la fiche (source, estimation de l'IA ou choix personnel) quand elle existe ;
 *  - sinon un repère général très approximatif, calculé d'après la couleur, le type et le millésime.
 * Une conservation à température ambiante raccourcit l'alerte « à boire bientôt ».
 */
import type { AdviceSource, Color, Storage, WineType } from './types.ts';

export type Maturity = 'young' | 'ready' | 'soon' | 'past' | 'unknown';

export type WindowInfo = { from: number; until: number; origin: AdviceSource; approximate: boolean };

type WineLike = {
  vintage: number | null;
  non_vintage?: boolean;
  color: Color | null;
  wine_type: WineType | null;
  drink_from: number | null;
  drink_until: number | null;
  window_source?: AdviceSource | null;
};

export const MATURITY_LABELS: Record<Maturity, string> = {
  young: 'À attendre',
  ready: 'Prêt à boire',
  soon: 'À boire bientôt',
  past: 'À boire sans attendre',
  unknown: 'Maturité inconnue',
};

export const MATURITY_HINTS: Record<Maturity, string> = {
  young: 'Encore jeune : il gagnera probablement à attendre.',
  ready: 'Dans sa période conseillée de consommation.',
  soon: 'Fin de la période conseillée : à ouvrir dans l’année.',
  past: 'La période conseillée est dépassée : à ouvrir rapidement (il peut rester très bon).',
  unknown: 'Ajoutez un millésime ou une période de consommation pour obtenir un repère.',
};

/** Repère général (années après le millésime). Très approximatif : dépend de l'appellation, du producteur, de l'année. */
export function generalWindow(w: Pick<WineLike, 'vintage' | 'non_vintage' | 'color' | 'wine_type'>): { from: number; until: number } | null {
  if (!w.vintage) return null;
  const v = w.vintage;
  const type = w.wine_type;
  if (type === 'liquoreux' || type === 'moelleux') return { from: v + 4, until: v + 25 };
  if (type === 'fortifie') return { from: v + 5, until: v + 30 };
  if (type === 'effervescent' || w.color === 'effervescent') return { from: v + 3, until: v + 12 };
  switch (w.color) {
    case 'rouge':
      return { from: v + 3, until: v + 12 };
    case 'blanc':
    case 'orange':
      return { from: v + 1, until: v + 6 };
    case 'rose':
      return { from: v, until: v + 2 };
    default:
      return null;
  }
}

export function windowOf(w: WineLike): WindowInfo | null {
  if (w.drink_from || w.drink_until) {
    const from = w.drink_from ?? Math.min(w.drink_until!, w.vintage ?? w.drink_until!);
    const until = w.drink_until ?? Math.max(from + 3, from);
    return { from, until, origin: w.window_source ?? 'personal', approximate: !w.drink_from || !w.drink_until };
  }
  const g = generalWindow(w);
  return g ? { ...g, origin: 'general', approximate: true } : null;
}

export function maturityOf(win: WindowInfo | null, year: number, storage?: Storage | null): Maturity {
  if (!win) return 'unknown';
  if (year < win.from) return 'young';
  if (year > win.until) return 'past';
  const soonYears = storage === 'piece' ? 2 : 1;
  if (win.until - year < soonYears) return 'soon';
  return 'ready';
}

export function maturity(w: WineLike, year = new Date().getFullYear(), storage?: Storage | null): Maturity {
  return maturityOf(windowOf(w), year, storage);
}

/** Ordre d'urgence : à boire sans attendre, bientôt, prêt, inconnu, à attendre. */
export const MATURITY_RANK: Record<Maturity, number> = { past: 0, soon: 1, ready: 2, unknown: 3, young: 4 };

export function windowText(win: WindowInfo | null): string {
  if (!win) return '';
  return win.from === win.until ? `en ${win.from}` : `de ${win.from} à ${win.until}`;
}

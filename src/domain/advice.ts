/**
 * Repères généraux de service (température, aération, ordre de service). Ce sont des règles d'usage,
 * affichées comme telles (« Repère général ») et jamais présentées comme des certitudes.
 */
import type { Color, WineType } from './types.ts';
import { fold } from './wine.ts';

type WineLike = {
  name?: string;
  color: Color | null;
  wine_type?: WineType | null;
  grapes?: string[];
  appellation?: string | null;
  region?: string | null;
  vintage?: number | null;
};

const LIGHT_RED = /(gamay|pinot|beaujolais|morgon|fleurie|brouilly|chiroubles|juliénas|julienas|saint-amour|regnie|chenas|moulin-a-vent|bourgueil|chinon|saumur|anjou|alsace|loire|trousseau|poulsard|grolleau)/;
const RICH_WHITE = /(meursault|montrachet|corton|hermitage|condrieu|chateauneuf|chardonnay|viognier|marsanne|roussanne|pessac|graves)/;

function text(w: WineLike) {
  return fold([w.name, w.appellation, w.region, ...(w.grapes ?? [])].filter(Boolean).join(' '));
}

export function isRichWhite(w: WineLike) {
  return w.color === 'blanc' && RICH_WHITE.test(text(w));
}

export function isLightRed(w: WineLike) {
  return w.color === 'rouge' && LIGHT_RED.test(text(w));
}

/** Température de service conseillée (°C), selon la couleur et le type. */
export function generalServingTemperature(w: WineLike): { min: number; max: number; text: string } | null {
  if (w.wine_type === 'effervescent' || w.color === 'effervescent') return { min: 6, max: 8, text: 'Effervescents : bien frais, 6 à 8 °C.' };
  if (w.wine_type === 'liquoreux' || w.wine_type === 'moelleux') return { min: 8, max: 10, text: 'Vins doux : frais sans excès, 8 à 10 °C.' };
  if (w.wine_type === 'fortifie') return { min: 12, max: 16, text: 'Vins mutés : 12 à 16 °C selon le style.' };
  switch (w.color) {
    case 'blanc':
      return RICH_WHITE.test(text(w))
        ? { min: 11, max: 13, text: 'Grands blancs amples : 11 à 13 °C, trop froids ils se ferment.' }
        : { min: 8, max: 11, text: 'Blancs secs : 8 à 11 °C.' };
    case 'rose':
      return { min: 8, max: 10, text: 'Rosés : 8 à 10 °C.' };
    case 'orange':
      return { min: 12, max: 14, text: 'Vins orange : 12 à 14 °C.' };
    case 'rouge':
      return isLightRed(w)
        ? { min: 13, max: 15, text: 'Rouges légers et fruités : 13 à 15 °C, légèrement rafraîchis.' }
        : { min: 15, max: 17, text: 'Rouges structurés : 15 à 17 °C (une pièce chauffée est souvent trop chaude).' };
    default:
      return null;
  }
}

/** Conseil d'aération ou de carafage selon le style et l'âge. */
export function generalAeration(w: WineLike, year = new Date().getFullYear()): string | null {
  const age = w.vintage ? year - w.vintage : null;
  if (w.wine_type === 'effervescent' || w.color === 'effervescent') return 'Pas d’aération : ouvrir au dernier moment, bien frais.';
  if (w.color === 'rose') return 'Pas d’aération nécessaire.';
  if (w.wine_type === 'liquoreux' || w.wine_type === 'moelleux') return 'Aération inutile en général ; un jeune liquoreux peut s’ouvrir 30 minutes avant.';
  if (w.color === 'blanc' || w.color === 'orange') {
    return RICH_WHITE.test(text(w)) && age !== null && age <= 6
      ? 'Un grand blanc jeune peut gagner à 30 minutes à 1 heure en carafe.'
      : 'En général inutile : ouvrir au moment du service.';
  }
  if (w.color === 'rouge') {
    if (age === null) return 'Ouvrir 30 minutes à 1 heure avant ; carafer si le vin semble fermé ou présente un dépôt.';
    if (age > 12) return 'Vin âgé : le décanter délicatement juste avant le service pour séparer le dépôt, sans l’aérer longtemps.';
    if (isLightRed(w)) return 'Rouge léger : une simple ouverture 30 minutes avant suffit.';
    if (age <= 6) return 'Rouge jeune et structuré : un carafage de 1 à 2 heures peut assouplir les tanins.';
    return 'Ouvrir environ 1 heure avant ; carafer seulement en présence de dépôt.';
  }
  return null;
}

type ServiceWine = { id: string; color: Color | null; wine_type: WineType | null; vintage: number | null; name?: string; grapes?: string[]; appellation?: string | null; region?: string | null };

/** Rang dans l'ordre de service : effervescent sec, blancs, rosés, rouges légers, rouges, vins doux. */
export function serviceRank(w: ServiceWine): number {
  if (w.wine_type === 'liquoreux') return 7;
  if (w.wine_type === 'moelleux') return 6;
  if (w.wine_type === 'fortifie') return 8;
  if (w.wine_type === 'effervescent' || w.color === 'effervescent') return 0;
  switch (w.color) {
    case 'blanc':
      return RICH_WHITE.test(text(w)) ? 2 : 1;
    case 'orange':
      return 2;
    case 'rose':
      return 3;
    case 'rouge':
      return isLightRed(w) ? 4 : 5;
    default:
      return 5;
  }
}

/**
 * Ordre conseillé (règle générale) : du plus léger au plus puissant, du sec au doux,
 * et à style égal les plus jeunes avant les plus âgés.
 */
export function suggestServiceOrder<T extends ServiceWine>(wines: T[]): T[] {
  return [...wines].sort((a, b) => serviceRank(a) - serviceRank(b) || (b.vintage ?? 0) - (a.vintage ?? 0) || (a.name ?? '').localeCompare(b.name ?? ''));
}

export const SERVICE_ORDER_RULE =
  'Règle générale : effervescents secs, puis blancs (vifs avant amples), rosés, rouges légers, rouges structurés, et vins doux en fin de repas ; à style égal, les plus jeunes avant les plus âgés.';

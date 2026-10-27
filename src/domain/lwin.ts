/**
 * Dictionnaire des vins français LWIN (Liv-ex, licence CC BY 4.0) : conversion d'une ligne de la base vers les champs
 * d'une fiche, et recherche pendant la saisie, sans IA ni serveur. Le fichier compact est produit par
 * scripts/lwin-extract.mjs (noms adaptés : accents rétablis sur les mots courants, régions en français).
 */
import type { Color, WineType } from './types.ts';
import { fold } from './wine.ts';

/** Mention exigée par la licence (CC BY 4.0) : source, licence, et indication des modifications. */
export const LWIN_CREDIT = 'Suggestions : base LWIN de Liv-ex, sous licence CC BY 4.0, adaptée (vins français, accents et régions en français).';
export const LWIN_LICENCE_URL = 'https://creativecommons.org/licenses/by/4.0/deed.fr';

/** Fichier compact : tables partagées, puis une ligne par vin [lwin, nom, cuvée, appellation, région, couleur, type]. */
export type LwinFile = {
  source: string;
  extrait_le: string;
  appellations: string[];
  regions: string[];
  couleurs: (Color | '')[];
  types: (WineType | '')[];
  vins: [number, string, string, number, number, number, number][];
};

export type LwinWine = {
  lwin: number;
  name: string;
  cuvee: string | null;
  appellation: string | null;
  region: string | null;
  color: Color | null;
  wine_type: WineType | null;
};

/** Mots courants des noms de vins que LWIN écrit sans accents (sur des mots entiers uniquement). */
const ACCENTS: Record<string, string> = {
  chateau: 'Château', chateaux: 'Châteaux', cote: 'Côte', cotes: 'Côtes', coteaux: 'Coteaux', rhone: 'Rhône', cremant: 'Crémant',
  cuvee: 'Cuvée', reserve: 'Réserve', methode: 'Méthode', millesime: 'Millésime', medoc: 'Médoc', emilion: 'Émilion',
  leognan: 'Léognan', estephe: 'Estèphe', corbieres: 'Corbières', macon: 'Mâcon', fume: 'Fumé', sevre: 'Sèvre',
  chateauneuf: 'Châteauneuf', rotie: 'Rôtie', jurancon: 'Jurançon', freres: 'Frères', pere: 'Père', selection: 'Sélection',
  herault: 'Hérault', ardeche: 'Ardèche', vallee: 'Vallée', prieure: 'Prieuré', eglise: 'Église', etoile: 'Étoile',
  epineuil: 'Épineuil', beziers: 'Béziers', pezenas: 'Pézenas', heritage: 'Héritage', elegance: 'Élégance', cepage: 'Cépage',
  cepages: 'Cépages', generation: 'Génération', romanee: 'Romanée', aligote: 'Aligoté', batard: 'Bâtard', caractere: 'Caractère',
  echezeaux: 'Échezeaux', veran: 'Véran', fuisse: 'Fuissé', peray: 'Péray',
};

/** Régions LWIN (en anglais) → noms français. */
const REGIONS: Record<string, string> = {
  Burgundy: 'Bourgogne', Rhone: 'Vallée du Rhône', Loire: 'Vallée de la Loire', 'Sud Ouest': 'Sud-Ouest', Corsica: 'Corse',
  Savoy: 'Savoie', Savoie: 'Savoie', 'Pays d\'Oc': 'Pays d\'Oc', Languedoc: 'Languedoc', Roussillon: 'Roussillon', Provence: 'Provence',
  Bordeaux: 'Bordeaux', Champagne: 'Champagne', Alsace: 'Alsace', Beaujolais: 'Beaujolais', Jura: 'Jura', Lorraine: 'Lorraine',
  Mediterranee: 'Méditerranée', Cevennes: 'Cévennes', 'Puy de Dome': 'Puy-de-Dôme', 'Franche-Comte': 'Franche-Comté', Isere: 'Isère',
  Normandy: 'Normandie', 'Ile de France': 'Île-de-France', "Vicomte d'Aumelas": "Vicomté d'Aumelas", 'Comtes Rhodaniens': 'Comtés Rhodaniens',
  Urfe: 'Urfé',
};

const isNa = (v: unknown) => v === null || v === undefined || String(v).trim() === '' || String(v).trim() === 'NA';
const clean = (v: unknown) => (isNa(v) ? '' : String(v).replace(/\s+/g, ' ').trim());

/** Rétablit les accents des mots courants, sans toucher aux autres (noms propres inconnus). */
export function accentuate(text: string) {
  return text.replace(/[A-Za-zÀ-ÿ]+/g, (w) => {
    const fix = ACCENTS[w.toLowerCase()];
    if (!fix) return w;
    // Garde la casse d'origine du premier caractère (« cuvee » au milieu d'une phrase reste en minuscule).
    return w[0] === w[0].toLowerCase() ? fix[0].toLowerCase() + fix.slice(1) : fix;
  });
}

export function frenchRegion(region: string) {
  const r = clean(region);
  return r ? (REGIONS[r] ?? accentuate(r)) : '';
}

/** Ligne de la base LWIN (colonnes du fichier officiel) vers les champs d'une fiche ; null si elle n'est pas retenue. */
export function lwinRow(r: Record<string, unknown>): LwinWine | null {
  if (clean(r.COUNTRY) !== 'France' || clean(r.STATUS) !== 'Live') return null;
  const type = clean(r.TYPE);
  if (type !== 'Wine' && type !== 'Fortified Wine') return null;
  const colour = clean(r.COLOUR);
  const wine = clean(r.WINE);
  // Caisses d'assortiment : pas un vin à mettre en cave.
  if (colour === 'Mixed' || /\b(assortment|mixed case|case)\b/i.test(wine)) return null;
  const lwin = Number(r.LWIN);
  if (!Number.isInteger(lwin) || lwin <= 0) return null;

  const name = [clean(r.PRODUCER_TITLE), clean(r.PRODUCER_NAME)].filter(Boolean).join(' ');
  if (!name) return null;
  const site = clean(r.SITE);
  const cuvee = [site, wine].filter(Boolean).join(' ');
  const classification = clean(r.CLASSIFICATION);
  let appellation = clean(r.SUB_REGION);
  if (!appellation) {
    // Pas de sous-région : l'appellation est souvent le dernier élément du nom affiché (« …, Champagne »).
    const parts = clean(r.DISPLAY_NAME).split(',').map((p) => p.trim()).filter(Boolean);
    const last = parts.length > 1 ? parts[parts.length - 1] : '';
    // Pas la cuvée elle-même, même suivie de son classement (« Extra Brut Premier Cru »).
    if (last && last !== site && last !== name && !(wine && last.startsWith(wine))) {
      appellation = wine && last.endsWith(` ${wine}`) ? last.slice(0, -wine.length - 1).trim() : last;
    }
  }
  // Champagne : une seule appellation, que le nom affiché omet parfois.
  if (!appellation && clean(r.REGION) === 'Champagne') appellation = 'Champagne';
  if (appellation && classification && !appellation.includes(classification)) appellation = `${appellation} ${classification}`;

  const subType = clean(r.SUB_TYPE);
  const color: Color | null =
    subType === 'Sparkling' ? 'effervescent' : colour === 'Red' ? 'rouge' : colour === 'White' ? 'blanc' : colour === 'Rose' ? 'rose' : null;
  const wineType: WineType | null =
    type === 'Fortified Wine' ? 'fortifie' : subType === 'Sparkling' ? 'effervescent' : subType === 'Still' ? 'tranquille' : null;

  return {
    lwin,
    name: accentuate(name),
    cuvee: cuvee ? accentuate(cuvee) : null,
    appellation: appellation ? accentuate(appellation) : null,
    region: frenchRegion(clean(r.REGION)) || null,
    color,
    wine_type: wineType,
  };
}

/** Index de recherche : chaque vin avec son texte replié (sans accents ni majuscules). */
export type LwinIndex = { wines: LwinWine[]; keys: string[] };

export function decodeLwin(file: LwinFile): LwinIndex {
  const wines = file.vins.map(([lwin, name, cuvee, a, r, c, t]) => ({
    lwin,
    name,
    cuvee: cuvee || null,
    appellation: file.appellations[a] || null,
    region: file.regions[r] || null,
    color: (file.couleurs[c] || null) as Color | null,
    wine_type: (file.types[t] || null) as WineType | null,
  }));
  return { wines, keys: wines.map((w) => fold([w.name, w.cuvee, w.appellation].filter(Boolean).join(' ')).replace(/[-'’]/g, ' ')) };
}

/**
 * Vins dont le texte contient tous les mots tapés (dans n'importe quel ordre, sans accents) ; les noms qui commencent
 * par le premier mot d'abord, puis les plus courts. Au moins 3 caractères au total.
 */
export function searchLwin(index: LwinIndex, query: string, limit = 6): LwinWine[] {
  const words = fold(query).replace(/[-'’,]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.join('').length < 3) return [];
  const hits: { w: LwinWine; score: number }[] = [];
  for (let i = 0; i < index.keys.length; i++) {
    const key = index.keys[i];
    if (!words.every((w) => key.includes(w))) continue;
    const w = index.wines[i];
    const name = fold(w.name);
    const starts = name.startsWith(words[0]) || name.includes(` ${words[0]}`);
    hits.push({ w, score: (starts ? 0 : 1000) + key.length });
  }
  hits.sort((a, b) => a.score - b.score);
  return hits.slice(0, limit).map((h) => h.w);
}

/** Texte d'une suggestion : « Château Margaux · Margaux · Bordeaux ». */
export function lwinLabel(w: LwinWine) {
  return [w.cuvee ? `${w.name}, ${w.cuvee}` : w.name, w.appellation, w.region].filter(Boolean).join(' · ');
}

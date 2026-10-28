/**
 * Défis et découvertes (maquette Cave & Amis 2.0, panneau 10) : des idées pour goûter plus varié, pas pour boire plus.
 * Tout se calcule dans l'application à partir des dégustations de la personne, sans IA ni donnée nouvelle : une
 * dégustation (même un seul verre) compte pour l'appellation, la région, le cépage ou la couleur notés sur sa fiche.
 * Le défi du mois change chaque mois et ne compte que les dégustations du mois ; les découvertes comptent tout le carnet.
 */
import type { Tasting } from './types.ts';
import { fold } from './wine.ts';

export type ChallengeField = 'appellation' | 'region' | 'grape' | 'color';
export type Challenge = {
  id: string;
  title: string;
  hint: string;
  field: ChallengeField;
  /** Ce qu'il y a à goûter (libellés affichés). */
  items: string[];
  /** Nombre d'éléments différents à goûter pour réussir. */
  goal: number;
  image: string;
};

/** Défis du mois : un par mois de l'année (janvier = 0). */
export const MONTHLY: Challenge[] = [
  { id: 'champagne', title: 'Bulles de Champagne et d’ailleurs', hint: 'Champagne, crémants, pétillants naturels.', field: 'appellation', items: ['Champagne', 'Crémant de Loire', 'Crémant d’Alsace', 'Crémant de Bourgogne', 'Blanquette de Limoux'], goal: 3, image: 'defi-vignoble' },
  { id: 'jura', title: 'Le Jura', hint: 'Des vins à part, du vin jaune au poulsard.', field: 'appellation', items: ['Arbois', 'Côtes du Jura', 'L’Étoile', 'Château-Chalon', 'Crémant du Jura'], goal: 2, image: 'defi-vignoble' },
  { id: 'sud-ouest', title: 'Le Sud-Ouest', hint: 'Madiran, Cahors, Jurançon…', field: 'appellation', items: ['Cahors', 'Madiran', 'Jurançon', 'Gaillac', 'Fronton', 'Irouléguy'], goal: 3, image: 'defi-vignoble' },
  { id: 'loire', title: 'Vins de Loire', hint: 'Du Muscadet à Sancerre, en remontant le fleuve.', field: 'appellation', items: ['Muscadet', 'Saumur-Champigny', 'Chinon', 'Vouvray', 'Sancerre'], goal: 3, image: 'defi-vignoble' },
  { id: 'rose', title: 'Le printemps des rosés', hint: 'Provence, Tavel, Loire : le rosé a plusieurs visages.', field: 'appellation', items: ['Côtes de Provence', 'Tavel', 'Bandol', 'Rosé de Loire', 'Bordeaux clairet'], goal: 2, image: 'defi-vignoble' },
  { id: 'alsace', title: 'L’Alsace', hint: 'Riesling, gewurztraminer, pinot gris…', field: 'grape', items: ['Riesling', 'Gewurztraminer', 'Pinot gris', 'Sylvaner', 'Muscat'], goal: 3, image: 'defi-vignoble' },
  { id: 'rhone', title: 'La vallée du Rhône', hint: 'Du nord en syrah au sud en grenache.', field: 'appellation', items: ['Côte-Rôtie', 'Crozes-Hermitage', 'Saint-Joseph', 'Gigondas', 'Châteauneuf-du-Pape'], goal: 3, image: 'defi-vignoble' },
  { id: 'languedoc', title: 'Languedoc et Roussillon', hint: 'Soleil, garrigue et vins de caractère.', field: 'appellation', items: ['Pic Saint-Loup', 'Faugères', 'Saint-Chinian', 'Corbières', 'Collioure'], goal: 3, image: 'defi-vignoble' },
  { id: 'beaujolais', title: 'Les crus du Beaujolais', hint: 'Dix crus, autant de caractères.', field: 'appellation', items: ['Morgon', 'Fleurie', 'Moulin-à-Vent', 'Brouilly', 'Juliénas', 'Chiroubles'], goal: 3, image: 'defi-vignoble' },
  { id: 'bourgogne', title: 'La Bourgogne', hint: 'Pinot noir et chardonnay, village par village.', field: 'appellation', items: ['Chablis', 'Meursault', 'Gevrey-Chambertin', 'Mercurey', 'Pouilly-Fuissé'], goal: 3, image: 'defi-vignoble' },
  { id: 'bordeaux', title: 'Les deux rives de Bordeaux', hint: 'Médoc d’un côté, Libournais de l’autre.', field: 'appellation', items: ['Pauillac', 'Margaux', 'Saint-Julien', 'Saint-Émilion', 'Pomerol'], goal: 3, image: 'defi-vignoble' },
  { id: 'fetes', title: 'Les vins de fête', hint: 'Bulles, liquoreux et vins doux pour finir l’année.', field: 'appellation', items: ['Champagne', 'Sauternes', 'Banyuls', 'Jurançon', 'Muscat de Beaumes-de-Venise'], goal: 2, image: 'defi-vignoble' },
];

export const DISCOVERIES: Challenge[] = [
  { id: 'cepages-oublies', title: 'Cépages oubliés', hint: 'Des raisins rares, souvent cultivés par quelques passionnés.', field: 'grape', items: ['Mondeuse', 'Savagnin', 'Poulsard', 'Fer servadou', 'Jacquère', 'Négrette'], goal: 2, image: 'decouverte-raisin' },
  { id: 'couleurs', title: 'Toutes les couleurs', hint: 'Rouge, blanc, rosé, orange et bulles.', field: 'color', items: ['rouge', 'blanc', 'rose', 'orange', 'effervescent'], goal: 4, image: 'decouverte-raisin' },
  { id: 'tour-de-france', title: 'Tour de France des régions', hint: 'Une dégustation par grande région viticole.', field: 'region', items: ['Alsace', 'Beaujolais', 'Bordeaux', 'Bourgogne', 'Champagne', 'Jura', 'Languedoc', 'Loire', 'Provence', 'Rhône', 'Sud-Ouest'], goal: 6, image: 'decouverte-raisin' },
];

const COLOR_LABELS: Record<string, string> = { rouge: 'Rouge', blanc: 'Blanc', rose: 'Rosé', orange: 'Orange', effervescent: 'Effervescent' };
export const itemLabel = (c: Challenge, item: string) => (c.field === 'color' ? (COLOR_LABELS[item] ?? item) : item);

const words = (s: string) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();

/** Ce qu'une dégustation apporte à ce défi (élément reconnu dans sa fiche), ou null. */
function matches(c: Challenge, t: Tasting, item: string): boolean {
  const target = words(item);
  if (!target) return false;
  const has = (v: string | null | undefined) => Boolean(v) && ` ${words(v!)} `.includes(` ${target} `);
  switch (c.field) {
    case 'color':
      return t.color === item;
    case 'grape':
      return (t.grapes ?? []).some((g) => words(g) === target);
    case 'region':
      return has(t.region);
    case 'appellation':
      return has(t.appellation) || has(t.wine_name);
  }
}

export type Progress = { challenge: Challenge; done: string[]; count: number; complete: boolean };

/** Progression d'une personne : éléments différents déjà goûtés, sur les dégustations données. */
export function progress(c: Challenge, tastings: Tasting[], me: string): Progress {
  const mine = tastings.filter((t) => t.user_id === me);
  const done = c.items.filter((item) => mine.some((t) => matches(c, t, item)));
  return { challenge: c, done, count: done.length, complete: done.length >= c.goal };
}

/** Défi du mois, et ses dégustations : celles du mois en cours seulement (dates du carnet, AAAA-MM-JJ). */
export function monthlyChallenge(now = new Date()) {
  const month = now.getMonth();
  const prefix = `${now.getFullYear()}-${String(month + 1).padStart(2, '0')}`;
  return { challenge: MONTHLY[month], inMonth: (t: Tasting) => t.tasted_on.startsWith(prefix) };
}

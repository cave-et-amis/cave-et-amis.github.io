/**
 * Accords mets et vins parmi les bouteilles DISPONIBLES (mission H de Cave & Amis 2.0) : présélection par règles simples,
 * calculée dans l'application, sans IA. Lia peut ensuite affiner, sur demande, à partir de cette présélection.
 *
 * Le plat est rangé dans une famille par mots-clés (accents et casse ignorés). Chaque bouteille libre reçoit des points :
 * couleur et type adaptés à la famille, accord déjà noté sur sa fiche qui cite le plat, maturité (prête : un point de plus ;
 * encore jeune : un point de moins). Les familles et les règles sont volontairement générales : ce sont des repères
 * classiques, pas un avis de sommelier.
 */
import type { WineRow } from './cellar.ts';
import type { Color, WineType } from './types.ts';
import { fold } from './wine.ts';

export type DishFamily = {
  id: string;
  label: string;
  words: string[];
  colors: Partial<Record<Color, number>>;
  types?: Partial<Record<WineType, number>>;
  tip: string;
};

export const DISH_FAMILIES: DishFamily[] = [
  {
    id: 'dessert',
    label: 'Dessert',
    words: ['dessert', 'gateau', 'tarte', 'chocolat', 'creme brulee', 'fruit', 'sorbet', 'glace', 'macaron', 'patisserie', 'tiramisu', 'clafoutis'],
    colors: { blanc: 1, effervescent: 1 },
    types: { moelleux: 3, liquoreux: 3, fortifie: 2, effervescent: 1 },
    tip: 'Un vin au moins aussi sucré que le dessert.',
  },
  {
    id: 'mer',
    label: 'Fruits de mer',
    words: ['huitre', 'moule', 'crevette', 'langoustine', 'homard', 'saint jacques', 'coquillage', 'crabe', 'fruits de mer', 'bulot'],
    colors: { blanc: 3, effervescent: 2, rose: 1 },
    types: { tranquille: 1, effervescent: 1 },
    tip: 'Un blanc sec et vif, ou des bulles.',
  },
  {
    id: 'poisson',
    label: 'Poisson',
    words: ['poisson', 'saumon', 'cabillaud', 'bar', 'dorade', 'sole', 'thon', 'truite', 'lotte', 'colin', 'sardine', 'maquereau'],
    colors: { blanc: 3, rose: 2, effervescent: 1, rouge: 0 },
    types: { tranquille: 1 },
    tip: 'Plutôt un blanc ; un rouge léger peu tannique pour un poisson grillé.',
  },
  {
    id: 'viande_rouge',
    label: 'Viande rouge et gibier',
    words: ['boeuf', 'entrecote', 'cote de boeuf', 'steak', 'agneau', 'gibier', 'chevreuil', 'sanglier', 'magret', 'canard', 'daube', 'bourguignon', 'gigot', 'burger'],
    colors: { rouge: 3 },
    types: { tranquille: 1 },
    tip: 'Un rouge avec de la structure.',
  },
  {
    id: 'viande_blanche',
    label: 'Volaille et viande blanche',
    words: ['poulet', 'volaille', 'dinde', 'pintade', 'veau', 'porc', 'lapin', 'roti', 'blanquette', 'chapon'],
    colors: { rouge: 2, blanc: 2, rose: 1 },
    types: { tranquille: 1 },
    tip: 'Un rouge souple ou un blanc avec du corps.',
  },
  {
    id: 'fromage',
    label: 'Fromage',
    words: ['fromage', 'comte', 'chevre', 'brie', 'camembert', 'roquefort', 'raclette', 'fondue', 'tartiflette', 'beaufort', 'munster'],
    colors: { blanc: 2, rouge: 2 },
    types: { tranquille: 1, liquoreux: 1 },
    tip: 'Souvent un blanc ; un liquoreux avec un bleu.',
  },
  {
    id: 'charcuterie',
    label: 'Charcuterie et apéritif',
    words: ['charcuterie', 'saucisson', 'jambon', 'aperitif', 'apero', 'tapas', 'terrine', 'pate', 'rillettes'],
    colors: { rouge: 2, rose: 2, effervescent: 2, blanc: 1 },
    types: { effervescent: 1 },
    tip: 'Des vins simples et fruités, ou des bulles.',
  },
  {
    id: 'epice',
    label: 'Cuisine épicée',
    words: ['curry', 'epice', 'thai', 'indien', 'tajine', 'couscous', 'chili', 'piment', 'asiatique', 'wok'],
    colors: { blanc: 2, rose: 2, rouge: 1 },
    types: { moelleux: 1 },
    tip: 'Un vin fruité, peu tannique, éventuellement avec un peu de sucre.',
  },
  {
    id: 'vegetarien',
    label: 'Légumes, pâtes et risotto',
    words: ['legume', 'risotto', 'pates', 'pizza', 'champignon', 'quiche', 'salade', 'gratin', 'lasagne', 'ratatouille', 'vegetarien'],
    colors: { rouge: 2, blanc: 2, rose: 1 },
    types: { tranquille: 1 },
    tip: 'Selon la sauce : tomate et rouge léger, crème et blanc.',
  },
];

export type PairingSuggestion = { row: WineRow; score: number; reasons: string[] };

/** Famille du plat (la première dont un mot-clé apparaît), ou null si aucun ne correspond. */
export function dishFamily(dish: string): DishFamily | null {
  const text = ` ${fold(dish).replace(/[^a-z0-9]+/g, ' ')} `;
  return DISH_FAMILIES.find((f) => f.words.some((w) => text.includes(` ${w}`))) ?? null;
}

export function suggestPairings(dish: string, rows: WineRow[], limit = 5): { family: DishFamily | null; suggestions: PairingSuggestion[] } {
  const family = dishFamily(dish);
  if (!family) return { family: null, suggestions: [] };
  const dishWords = fold(dish).replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 3);
  const out: PairingSuggestion[] = [];
  for (const row of rows) {
    if (row.available <= 0) continue;
    const w = row.wine;
    const reasons: string[] = [];
    let score = 0;
    const byColor = w.color ? (family.colors[w.color] ?? 0) : 0;
    if (byColor > 0) {
      score += byColor;
      reasons.push('couleur adaptée');
    }
    const byType = w.wine_type ? (family.types?.[w.wine_type] ?? 0) : 0;
    if (byType > 0) {
      score += byType;
      if (w.wine_type !== 'tranquille') reasons.push('type adapté');
    }
    if (w.pairings && dishWords.some((d) => fold(w.pairings).includes(d))) {
      score += 2;
      reasons.push('accord noté sur sa fiche');
    }
    if (score <= 0) continue;
    if (row.maturity === 'ready' || row.maturity === 'past') {
      score += 1;
      reasons.push(row.maturity === 'past' ? 'à ouvrir sans tarder' : 'prêt à boire');
    } else if (row.maturity === 'young') {
      score -= 1;
      reasons.push('encore jeune');
    }
    out.push({ row, score, reasons });
  }
  out.sort((a, b) => b.score - a.score || a.row.wine.name.localeCompare(b.row.wine.name, 'fr'));
  return { family, suggestions: out.slice(0, limit) };
}

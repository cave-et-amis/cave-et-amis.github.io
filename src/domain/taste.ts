/**
 * Scanner, lot 3c : ce vin et vos goûts. Calculé dans l'application, à partir de VOS seules données (vos lots, votre
 * carnet, vos favoris, vos envies) : rien n'est envoyé à l'IA, rien des autres personnes n'est utilisé.
 *
 * Adéquation (0 à 2 points, intégrés à la note sur 10) :
 *  - 2 « forte » : ce vin déjà noté 4/5 ou plus, ou au moins deux vins semblables notés 4/5 ou plus ;
 *  - 1 « moyenne » : un vin semblable apprécié, ce vin dans vos envies, ou un style encore absent de votre carnet ;
 *  - 0 « faible » : vins semblables plus souvent mal notés (2/5 ou moins) qu'appréciés, ou ce vin déjà mal noté ;
 *  - non évaluée : moins de trois dégustations notées et aucun vin semblable.
 * « Semblable » : même appellation et même couleur ; à défaut, même région et même couleur.
 */
import type { Color, Lot, ScanWine, Tasting, Wine, WishItem } from './types.ts';
import { colorLabel, fold } from './wine.ts';

export type TasteFit = {
  points: 0 | 1 | 2 | null;
  level: 'forte' | 'moyenne' | 'faible' | null;
  /** Bouteilles de ce vin en stock (tous millésimes), dont celles du même millésime. */
  owned: { bottles: number; sameVintage: number; vintages: number[] };
  tasted: { rating: number | null; tasted_on: string; vintage: number | null }[];
  wished: boolean;
  similar: { liked: number; disliked: number; scope: 'appellation' | 'region' | null; label: string | null };
  favoriteProducer: boolean;
  overBudget: number | null;
  /** Phrases à afficher, dans l'ordre. */
  notes: string[];
  suggestion: string | null;
};

const norm = (s: string | null | undefined) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set(['chateau', 'domaine', 'clos', 'cuvee', 'le', 'la', 'les', 'de', 'du', 'des', 'et']);
const words = (s: string | null | undefined) => norm(s).split(' ').filter((w) => w.length > 1 && !STOP.has(w));

/** Même vin (millésime à part) : nom proche (tous les mots significatifs de l'un dans l'autre), producteur compatible. */
export function sameWine(a: { name: string; producer?: string | null; cuvee?: string | null }, b: { name: string; producer?: string | null; cuvee?: string | null }) {
  const wa = words(`${a.name} ${a.cuvee ?? ''}`);
  const wb = words(`${b.name} ${b.cuvee ?? ''}`);
  if (!wa.length || !wb.length) return false;
  const [small, big] = wa.length <= wb.length ? [wa, new Set(wb)] : [wb, new Set(wa)];
  if (!small.every((w) => big.has(w))) return false;
  const pa = norm(a.producer);
  const pb = norm(b.producer);
  return !pa || !pb || pa === pb || pa.includes(pb) || pb.includes(pa);
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

export function tasteFit(o: { wine: ScanWine; me: string; wines: Wine[]; lots: Lot[]; tastings: Tasting[]; wishlist: WishItem[]; price: number | null; budget: number | null; currency?: string }): TasteFit {
  const w = o.wine;
  const target = { name: w.name ?? '', producer: w.producer || w.domaine, cuvee: w.cuvee };
  const myWines = o.wines.filter((x) => x.owner_id === o.me);
  const matching = new Set(myWines.filter((x) => sameWine({ name: x.name, producer: x.producer || x.domaine, cuvee: x.cuvee }, target)).map((x) => x.id));
  const lots = o.lots.filter((l) => l.owner_id === o.me && l.quantity > 0 && matching.has(l.wine_id));
  const vintageOf = (id: string) => myWines.find((x) => x.id === id)?.vintage ?? null;
  const owned = {
    bottles: lots.reduce((s, l) => s + l.quantity, 0),
    sameVintage: lots.filter((l) => w.vintage && vintageOf(l.wine_id) === w.vintage).reduce((s, l) => s + l.quantity, 0),
    vintages: [...new Set(lots.map((l) => vintageOf(l.wine_id)).filter((v): v is number => v !== null))].sort(),
  };

  const mine = o.tastings.filter((t) => t.user_id === o.me);
  const rated = mine.filter((t) => t.rating !== null);
  const tasted = mine
    .filter((t) => (t.wine_id && matching.has(t.wine_id)) || sameWine({ name: t.wine_name, producer: t.producer }, target))
    .map((t) => ({ rating: t.rating, tasted_on: t.tasted_on, vintage: t.vintage }))
    .sort((a, b) => b.tasted_on.localeCompare(a.tasted_on));
  const wished = o.wishlist.some((i) => !i.done && sameWine({ name: i.wine_name, producer: i.producer }, target));

  // Vins semblables : même appellation et couleur, sinon même région et couleur (ce vin lui-même exclu).
  const others = rated.filter((t) => !sameWine({ name: t.wine_name, producer: t.producer }, target));
  const color = w.color ?? null;
  const sameColor = (t: Tasting) => !color || !t.color || t.color === color;
  let scope: TasteFit['similar']['scope'] = null;
  let pool: Tasting[] = [];
  if (w.appellation) {
    pool = others.filter((t) => norm(t.appellation) === norm(w.appellation) && sameColor(t));
    if (pool.length) scope = 'appellation';
  }
  if (!pool.length && w.region) {
    pool = others.filter((t) => norm(t.region) === norm(w.region) && sameColor(t));
    if (pool.length) scope = 'region';
  }
  const liked = pool.filter((t) => (t.rating ?? 0) >= 4).length;
  const disliked = pool.filter((t) => (t.rating ?? 5) <= 2).length;
  const styleName = scope === 'appellation' ? w.appellation! : scope === 'region' ? w.region! : null;
  const label = styleName ? `${color ? `${colorLabel(color as Color).toLowerCase()}s ` : ''}${scope === 'appellation' ? 'de ' : 'de la région '}${styleName}` : null;

  const favoriteProducer = Boolean(target.producer) && myWines.some((x) => x.favorite && norm(x.producer || x.domaine) === norm(target.producer));

  const bestTasted = tasted.find((t) => t.rating !== null)?.rating ?? null;
  let points: TasteFit['points'] = null;
  if (bestTasted !== null && bestTasted <= 2) points = 0;
  else if ((bestTasted ?? 0) >= 4 || liked >= 2) points = 2;
  else if (disliked > liked) points = 0;
  else if (liked === 1 || wished) points = 1;
  else if (rated.length >= 3) points = 1;
  const level = points === null ? null : points === 2 ? 'forte' : points === 1 ? 'moyenne' : 'faible';

  const overBudget = o.budget !== null && o.price !== null && o.price > o.budget ? Math.round((o.price - o.budget) * 100) / 100 : null;

  const notes: string[] = [];
  if (owned.bottles > 0)
    notes.push(
      owned.sameVintage > 0
        ? `Vous possédez déjà ${plural(owned.sameVintage, 'bouteille', 'bouteilles')} de ce vin dans ce millésime${owned.bottles > owned.sameVintage ? ` (${owned.bottles} en tout)` : ''}.`
        : `Vous possédez déjà ${plural(owned.bottles, 'bouteille', 'bouteilles')} de ce vin${owned.vintages.length ? ` (${owned.vintages.join(', ')})` : ''}.`,
    );
  const lastRated = tasted.find((t) => t.rating !== null);
  if (lastRated) notes.push(`Vous l’avez déjà dégusté${lastRated.vintage ? ` (${lastRated.vintage})` : ''} : noté ${lastRated.rating}/5.`);
  if (wished) notes.push('Il figure dans votre liste d’envies.');
  if (favoriteProducer) notes.push('Vous avez mis en favori un vin de ce producteur.');
  if (label && liked >= 2) notes.push(`Ce vin ressemble à ${liked} ${label} que vous avez appréciés.`);
  else if (label && liked === 1) notes.push(`Ce vin ressemble à un ${label.replace(/s /, ' ')} que vous avez apprécié.`);
  if (label && disliked > liked) notes.push(`Prudence : vous avez moins aimé ${plural(disliked, 'vin semblable', 'vins semblables')} (${label}).`);
  if (points === null) notes.push('Pas encore assez de dégustations notées pour connaître vos goûts : notez vos vins dans le carnet.');
  if (overBudget !== null) notes.push(`Ce prix dépasse votre budget de ${overBudget.toLocaleString('fr-FR', { style: 'currency', currency: o.currency ?? 'EUR' })}.`);

  // Hors budget ou loin de vos goûts : le style que vous notez le mieux.
  let suggestion: string | null = null;
  if (overBudget !== null || points === 0) {
    const counts = new Map<string, { n: number; color: Color | null; region: string }>();
    for (const t of rated.filter((t) => (t.rating ?? 0) >= 4 && t.region)) {
      const k = `${t.color ?? ''}|${norm(t.region)}`;
      const c = counts.get(k) ?? { n: 0, color: t.color, region: t.region! };
      c.n += 1;
      counts.set(k, c);
    }
    const top = [...counts.values()].sort((a, b) => b.n - a.n)[0];
    if (top && top.n >= 2) {
      const style = `${top.color ? `un ${colorLabel(top.color).toLowerCase()} ` : 'un vin '}de la région ${top.region}`;
      suggestion = `${overBudget !== null ? 'Pour votre budget, je vous conseillerais plutôt' : 'Plus proche de vos goûts :'} ${style}, le style que vous notez le mieux (${top.n} dégustations à 4/5 ou plus).`;
    }
  }

  return { points, level, owned, tasted, wished, similar: { liked, disliked, scope, label }, favoriteProducer, overBudget, notes, suggestion };
}

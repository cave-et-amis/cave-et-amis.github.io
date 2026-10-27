/**
 * Mémoire des goûts (mission C de Cave & Amis 2.0) : ce que la personne déclare, et ce que l'application déduit de SON
 * carnet. Le calcul se fait dans l'application (et à l'identique pour Lia, côté serveur), sans IA, à partir des seules
 * dégustations notées de la personne.
 *
 * Un trait (couleur, région, appellation, cépage, structure) est retenu quand il revient dans au moins deux dégustations
 * notées : « vous aimez » si leur moyenne est d'au moins 4/5, « vous aimez moins » si elle est de 2,5/5 ou moins. Les
 * traits que la personne a écartés (« ignored ») ne sont jamais retenus.
 */
import type { Color, Tasting } from './types.ts';
import { colorLabel, fold } from './wine.ts';

export type TasteProfile = {
  user_id: string;
  likes: string[];
  dislikes: string[];
  /** Traits déduits du carnet que la personne a écartés (clé `type:valeur`). */
  ignored: string[];
  budget_max: number | null;
  note: string | null;
  updated_at: string;
};

export type TraitKind = 'couleur' | 'region' | 'appellation' | 'cepage' | 'structure';
export type Trait = { key: string; kind: TraitKind; label: string; count: number; average: number };
export type TasteSummary = { rated: number; liked: Trait[]; disliked: Trait[] };

export const MIN_COUNT = 2;
export const LIKED_FROM = 4;
export const DISLIKED_UNTIL = 2.5;
/** Traits écartés au plus (contrainte de la table taste_profiles). */
export const MAX_IGNORED = 60;
const MAX_TRAITS = 8;

const KIND_LABELS: Record<TraitKind, string> = { couleur: 'Couleur', region: 'Région', appellation: 'Appellation', cepage: 'Cépage', structure: 'Structure' };
export const kindLabel = (k: TraitKind) => KIND_LABELS[k];

export const traitKey = (kind: TraitKind, value: string) => `${kind}:${fold(value).trim()}`;

const STRUCTURE: Record<string, string> = {
  'acidite:vive': 'Acidité vive',
  'acidite:faible': 'Acidité discrète',
  'tanins:souples': 'Tanins souples',
  'tanins:marques': 'Tanins marqués',
  'longueur:longue': 'Finale longue',
  'longueur:courte': 'Finale courte',
};

/** Traits d'une dégustation : couleur, région, appellation, cépages et structure notée. */
function traitsOf(t: Tasting): { kind: TraitKind; value: string; label: string }[] {
  const out: { kind: TraitKind; value: string; label: string }[] = [];
  if (t.color) out.push({ kind: 'couleur', value: t.color, label: colorLabel(t.color as Color) });
  if (t.region?.trim()) out.push({ kind: 'region', value: t.region, label: t.region.trim() });
  if (t.appellation?.trim()) out.push({ kind: 'appellation', value: t.appellation, label: t.appellation.trim() });
  for (const g of t.grapes ?? []) if (g.trim()) out.push({ kind: 'cepage', value: g, label: g.trim() });
  for (const [field, value] of [['acidite', t.acidite], ['tanins', t.tanins], ['longueur', t.longueur]] as const) {
    const label = value ? STRUCTURE[`${field}:${value}`] : undefined;
    if (label) out.push({ kind: 'structure', value: `${field} ${value}`, label });
  }
  return out;
}

export function tasteSummary(tastings: Tasting[], me: string, ignored: string[] = []): TasteSummary {
  const skip = new Set(ignored);
  const rated = tastings.filter((t) => t.user_id === me && typeof t.rating === 'number');
  const acc = new Map<string, { kind: TraitKind; label: string; sum: number; count: number }>();
  for (const t of rated) {
    for (const tr of traitsOf(t)) {
      const key = traitKey(tr.kind, tr.value);
      if (skip.has(key)) continue;
      const a = acc.get(key) ?? { kind: tr.kind, label: tr.label, sum: 0, count: 0 };
      a.sum += t.rating!;
      a.count += 1;
      acc.set(key, a);
    }
  }
  const traits = [...acc.entries()]
    .filter(([, a]) => a.count >= MIN_COUNT)
    .map(([key, a]) => ({ key, kind: a.kind, label: a.label, count: a.count, average: Math.round((a.sum / a.count) * 10) / 10 }));
  const byStrength = (x: Trait, y: Trait) => y.count - x.count || x.label.localeCompare(y.label, 'fr');
  return {
    rated: rated.length,
    liked: traits.filter((t) => t.average >= LIKED_FROM).sort((a, b) => b.average - a.average || byStrength(a, b)).slice(0, MAX_TRAITS),
    disliked: traits.filter((t) => t.average <= DISLIKED_UNTIL).sort((a, b) => a.average - b.average || byStrength(a, b)).slice(0, MAX_TRAITS),
  };
}

/** Une préférence saisie : texte court, sans doublon (casse et accents ignorés), 20 au plus. */
export function cleanPreferenceList(items: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const v = raw.replace(/\s+/g, ' ').trim().slice(0, 40);
    const k = fold(v);
    if (!v || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
    if (out.length >= 20) break;
  }
  return out;
}

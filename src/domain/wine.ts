/** Libellés et présentation des vins (partagés par l'interface et le serveur). */
import type { AdviceSource, Color, Course, EventKind, LocationKind, MovementKind, Occasion, PriceKind, Storage, Visibility, WineType } from './types.ts';

export const COLORS: { value: Color; label: string }[] = [
  { value: 'rouge', label: 'Rouge' },
  { value: 'blanc', label: 'Blanc' },
  { value: 'rose', label: 'Rosé' },
  { value: 'effervescent', label: 'Effervescent' },
  { value: 'orange', label: 'Orange' },
  { value: 'autre', label: 'Autre' },
];

export const WINE_TYPES: { value: WineType; label: string }[] = [
  { value: 'tranquille', label: 'Tranquille (sec)' },
  { value: 'effervescent', label: 'Effervescent' },
  { value: 'moelleux', label: 'Moelleux' },
  { value: 'liquoreux', label: 'Liquoreux' },
  { value: 'fortifie', label: 'Muté / fortifié' },
  { value: 'autre', label: 'Autre' },
];

export const VOLUMES: { value: number; label: string }[] = [
  { value: 375, label: 'Demi-bouteille (37,5 cl)' },
  { value: 500, label: '50 cl' },
  { value: 620, label: 'Clavelin (62 cl)' },
  { value: 750, label: 'Bouteille (75 cl)' },
  { value: 1500, label: 'Magnum (1,5 l)' },
  { value: 3000, label: 'Jéroboam / double magnum (3 l)' },
];

export const STORAGES: { value: Storage; label: string; hint: string }[] = [
  { value: 'cave', label: 'Cave naturelle', hint: 'Fraîche, sombre, température stable' },
  { value: 'armoire', label: 'Armoire à vin', hint: 'Température régulée' },
  { value: 'piece', label: 'Pièce à vivre', hint: 'Température ambiante : la garde peut être plus courte' },
  { value: 'autre', label: 'Autre', hint: '' },
  { value: 'unknown', label: 'Je ne sais pas', hint: '' },
];

export const LOCATION_KINDS: { value: LocationKind; label: string }[] = [
  { value: 'casier', label: 'Casier' },
  { value: 'etagere', label: 'Étagère' },
  { value: 'armoire', label: 'Armoire' },
  { value: 'carton', label: 'Carton / caisse' },
  { value: 'autre', label: 'Autre' },
];

export const VISIBILITIES: { value: Visibility; label: string; hint: string }[] = [
  { value: 'private', label: 'Privé', hint: 'Visible uniquement par vous' },
  { value: 'friends', label: 'Partagé avec mes amis', hint: 'Visible des personnes à qui vous ouvrez votre cave (pas des simples contacts)' },
  { value: 'event', label: 'Proposable pour un événement', hint: 'Visible des personnes à qui vous ouvrez votre cave, qui peuvent le suggérer pour un événement' },
];

export const ADVICE_SOURCES: Record<AdviceSource, string> = {
  source: 'Source',
  general: 'Repère général',
  ai: 'Estimation de l’IA',
  personal: 'Votre choix',
};

export const MOVEMENT_LABELS: Record<MovementKind, string> = {
  achat: 'Achat',
  cadeau_recu: 'Cadeau reçu',
  entree: 'Entrée en cave',
  consommation: 'Consommation',
  cadeau_offert: 'Cadeau offert',
  correction: 'Correction',
  annulation: 'Annulation',
};

export const EVENT_KINDS: { value: EventKind; label: string; icon: string }[] = [
  { value: 'diner', label: 'Dîner', icon: '🍽️' },
  { value: 'degustation', label: 'Dégustation', icon: '🍷' },
  { value: 'anniversaire', label: 'Anniversaire', icon: '🎂' },
  { value: 'soiree_theme', label: 'Soirée à thème', icon: '✨' },
];

export const COURSES: { value: Course; label: string }[] = [
  { value: 'aperitif', label: 'Apéritif' },
  { value: 'entree', label: 'Entrée' },
  { value: 'plat', label: 'Plat' },
  { value: 'fromage', label: 'Fromage' },
  { value: 'dessert', label: 'Dessert' },
  { value: 'autre', label: 'Autre' },
];

export const OCCASIONS: { value: Occasion; label: string }[] = [
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'amis', label: 'Chez des amis' },
  { value: 'maison', label: 'À la maison' },
  { value: 'salon', label: 'Salon, foire aux vins' },
  { value: 'evenement', label: 'Événement' },
  { value: 'autre', label: 'Ailleurs' },
];

export const PRICE_KINDS: { value: PriceKind; label: string }[] = [
  { value: 'verre', label: 'Au verre' },
  { value: 'bouteille_restaurant', label: 'Bouteille au restaurant' },
  { value: 'achat_boutique', label: 'Achat en boutique' },
  { value: 'autre', label: 'Autre' },
];

export const label = <T extends string>(list: { value: T; label: string }[], v: T | null | undefined) =>
  list.find((x) => x.value === v)?.label ?? '';

export function colorLabel(c: Color | null | undefined) {
  return label(COLORS, c);
}

export function volumeLabel(ml: number) {
  const known = VOLUMES.find((v) => v.value === ml);
  if (known) return known.label.replace(/ \(.*\)$/, '') === 'Bouteille' ? '75 cl' : known.label;
  return ml >= 1000 ? `${(ml / 1000).toLocaleString('fr-FR')} l` : `${(ml / 10).toLocaleString('fr-FR')} cl`;
}

export function vintageLabel(w: { vintage: number | null; non_vintage?: boolean }) {
  if (w.vintage) return String(w.vintage);
  return w.non_vintage ? 'Sans millésime' : '';
}

/** « Château Talbot 2015 » ; le producteur s'ajoute si le nom ne le contient pas déjà. */
export function wineTitle(w: { name: string; vintage: number | null; non_vintage?: boolean }) {
  const v = vintageLabel(w);
  return v && v !== 'Sans millésime' ? `${w.name} ${v}` : w.name;
}

export function wineSubtitle(w: { producer?: string | null; domaine?: string | null; appellation?: string | null; region?: string | null }) {
  return [w.domaine || w.producer, w.appellation || w.region].filter(Boolean).join(' · ');
}

/** Pastille de couleur (variable CSS) selon la couleur du vin. */
export function colorDot(c: Color | null | undefined) {
  return `var(--wine-${c ?? 'autre'})`;
}

/** Normalise un texte pour la recherche (sans accents ni majuscules). */
export function fold(s: string | null | undefined) {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

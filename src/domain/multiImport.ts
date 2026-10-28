/**
 * Import multiple : de la liste lue par Lia (une entrée par bouteille visible) aux ajouts à faire, après vérification par
 * la personne. Deux bouteilles du même vin et du même millésime forment un seul ajout de 2 bouteilles ; un vin déjà dans
 * ma cave (même nom et producteur, même millésime) reçoit des bouteilles en plus au lieu d'une nouvelle fiche.
 */
import { sameWine } from './taste.ts';
import type { Wine } from './types.ts';

export type ImportRow = {
  key: string;
  name: string;
  producer: string | null;
  appellation: string | null;
  region: string | null;
  color: string | null;
  vintage: number | null;
  non_vintage: boolean;
  uncertain: string[];
  selected: boolean;
};

export type ImportPlan = { row: ImportRow; quantity: number; existing: Wine | null }[];

/** Le vin de ma cave qui correspond à cette bouteille, s'il y en a un. */
export function matchWine(row: Pick<ImportRow, 'name' | 'producer' | 'vintage' | 'non_vintage'>, wines: Wine[], me: string): Wine | null {
  return (
    wines.find(
      (w) => w.owner_id === me && sameWine(w, row) && (w.vintage ?? null) === (row.vintage ?? null) && Boolean(w.non_vintage) === Boolean(row.non_vintage),
    ) ?? null
  );
}

/** Millésime à vérifier : signalé incertain par Lia, ou absent sans que la bouteille soit déclarée sans millésime. */
export const vintageToCheck = (row: ImportRow) => row.uncertain.includes('vintage') || (row.vintage === null && !row.non_vintage);

/** Ajouts à faire, dans l'ordre de la photo : les bouteilles cochées, regroupées par vin et millésime. */
export function importPlan(rows: ImportRow[], wines: Wine[], me: string): ImportPlan {
  const plan: ImportPlan = [];
  for (const row of rows) {
    if (!row.selected || !row.name.trim()) continue;
    const same = plan.find((p) => sameWine(p.row, row) && p.row.vintage === row.vintage && p.row.non_vintage === row.non_vintage);
    if (same) same.quantity += 1;
    else plan.push({ row, quantity: 1, existing: matchWine(row, wines, me) });
  }
  return plan;
}

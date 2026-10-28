/**
 * Import multiple (maquette Cave & Amis 2.0, panneau 7) : une seule photo de plusieurs bouteilles (une rangée, un carton
 * ouvert, une table), lue par Claude, qui renvoie une courte fiche par bouteille reconnue. La photo est déjà rangée dans le
 * dossier privé de la personne et lue avec ses droits. Rien n'est enregistré : l'application montre la liste, que la
 * personne vérifie, corrige et confirme avant tout ajout à sa cave.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { baseParams, textOf, type Meter } from './claude.ts';
import { SHELF_SYSTEM } from './prompts.ts';
import { AiFailure, sanitize } from './util.ts';

export const MAX_BOTTLES = 12;
const FIELDS = ['name', 'producer', 'appellation', 'region', 'color', 'vintage'] as const;
const COLORS = ['rouge', 'blanc', 'rose', 'orange', 'effervescent', 'autre'];

export const SHELF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['bottles', 'notes'],
  properties: {
    bottles: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [...FIELDS, 'non_vintage', 'uncertain'],
        properties: {
          name: { type: 'string' },
          producer: { type: 'string' },
          appellation: { type: 'string' },
          region: { type: 'string' },
          color: { anyOf: [{ type: 'string', enum: COLORS }, { type: 'null' }] },
          vintage: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
          non_vintage: { type: 'boolean' },
          uncertain: { type: 'array', items: { type: 'string', enum: [...FIELDS] } },
        },
      },
    },
    notes: { type: 'string' },
  },
};

export type ShelfBottle = {
  name: string;
  producer: string | null;
  appellation: string | null;
  region: string | null;
  color: string | null;
  vintage: number | null;
  non_vintage: boolean;
  uncertain: string[];
};
export type ShelfResult = { bottles: ShelfBottle[]; notes: string | null };

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? sanitize(v, max) : null);

/** Contrôle de la réponse : une bouteille sans nom lisible est écartée ; au plus MAX_BOTTLES. */
export function cleanShelf(raw: unknown, year = new Date().getFullYear()): ShelfResult {
  const r = (raw ?? {}) as { bottles?: unknown; notes?: unknown };
  const bottles: ShelfBottle[] = [];
  for (const b of Array.isArray(r.bottles) ? r.bottles : []) {
    const f = (b ?? {}) as Record<string, unknown>;
    const name = str(f.name, 120);
    if (!name) continue;
    const vintage = Number.isInteger(f.vintage) && (f.vintage as number) >= 1800 && (f.vintage as number) <= year ? (f.vintage as number) : null;
    bottles.push({
      name,
      producer: str(f.producer, 120),
      appellation: str(f.appellation, 120),
      region: str(f.region, 80),
      color: COLORS.includes(String(f.color)) ? String(f.color) : null,
      vintage,
      non_vintage: f.non_vintage === true && vintage === null,
      uncertain: Array.isArray(f.uncertain) ? [...new Set(f.uncertain.filter((u): u is string => typeof u === 'string' && (FIELDS as readonly string[]).includes(u)))] : [],
    });
    if (bottles.length >= MAX_BOTTLES) break;
  }
  return { bottles, notes: str(r.notes, 300) };
}

type ShelfImage = { data: string; media_type: 'image/jpeg' | 'image/png' | 'image/webp' };

export async function identifyShelf(o: { meter: Meter; image: ShelfImage }): Promise<ShelfResult> {
  const content: Anthropic.Messages.ContentBlockParam[] = [
    { type: 'image', source: { type: 'base64', media_type: o.image.media_type, data: o.image.data } },
    { type: 'text', text: `Liste les bouteilles de vin visibles sur cette photo (au plus ${MAX_BOTTLES}), de gauche à droite.` },
  ];
  const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
    ...baseParams(o.meter.settings, Math.min(o.meter.settings.max_output_tokens * 2, 6000)),
    system: SHELF_SYSTEM,
    messages: [{ role: 'user', content }],
  };
  params.output_config = { ...(params.output_config ?? {}), format: { type: 'json_schema', schema: SHELF_SCHEMA } };
  const res = await o.meter.call(params, { images: 1 });
  if (res.stop_reason === 'refusal') throw new AiFailure('refused');
  let parsed: unknown;
  try {
    parsed = JSON.parse(textOf(res));
  } catch {
    throw new AiFailure('bad_request', res.stop_reason === 'max_tokens' ? 'Réponse tronquée' : 'Réponse illisible');
  }
  return cleanShelf(parsed);
}

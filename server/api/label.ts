/**
 * Identification d'une étiquette : la photo (déjà rangée dans le dossier privé de la personne) est lue
 * avec ses droits, envoyée à Claude, et la réponse structurée est contrôlée champ par champ.
 * Rien n'est enregistré : l'application affiche un formulaire pré-rempli que la personne corrige et confirme.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { baseParams, textOf, type Meter } from './claude.ts';
import { LABEL_SYSTEM } from './prompts.ts';
import { AiFailure, sanitize } from './util.ts';

const FIELDS = ['name', 'domaine', 'producer', 'cuvee', 'country', 'region', 'appellation', 'color', 'wine_type', 'grapes', 'vintage', 'non_vintage', 'volume_ml'] as const;
const COLORS = ['rouge', 'blanc', 'rose', 'orange', 'effervescent', 'autre'];
const TYPES = ['tranquille', 'effervescent', 'moelleux', 'liquoreux', 'fortifie', 'autre'];

// Textes : chaîne vide si inconnu (et non null) ; l'API limite à 16 les paramètres « nullable » d'une requête.
const ns = { type: 'string' };
const ni = { anyOf: [{ type: 'integer' }, { type: 'null' }] };

export const LABEL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_wine_label', 'fields', 'uncertain', 'advice', 'notes'],
  properties: {
    is_wine_label: { type: 'boolean' },
    fields: {
      type: 'object',
      additionalProperties: false,
      required: [...FIELDS],
      properties: {
        name: ns,
        domaine: ns,
        producer: ns,
        cuvee: ns,
        country: ns,
        region: ns,
        appellation: ns,
        color: { anyOf: [{ type: 'string', enum: COLORS }, { type: 'null' }] },
        wine_type: { anyOf: [{ type: 'string', enum: TYPES }, { type: 'null' }] },
        grapes: { type: 'array', items: { type: 'string' } },
        vintage: ni,
        non_vintage: { type: 'boolean' },
        volume_ml: ni,
      },
    },
    uncertain: { type: 'array', items: { type: 'string', enum: [...FIELDS] } },
    advice: {
      type: 'object',
      additionalProperties: false,
      required: ['drink_from', 'drink_until', 'serve_temp_min', 'serve_temp_max', 'aeration', 'pairings'],
      properties: { drink_from: ni, drink_until: ni, serve_temp_min: ni, serve_temp_max: ni, aeration: ns, pairings: ns },
    },
    notes: ns,
  },
};

export type LabelResult = {
  is_wine_label: boolean;
  fields: Partial<Record<(typeof FIELDS)[number], unknown>>;
  uncertain: string[];
  advice: Partial<{ drink_from: number; drink_until: number; serve_temp_min: number; serve_temp_max: number; aeration: string; pairings: string }>;
  notes: string | null;
};

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? sanitize(v, max) : null);
const int = (v: unknown, min: number, max: number) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : null);

/** Contrôle et nettoyage de la réponse : valeurs hors limites écartées, champs inconnus vides. */
export function cleanLabel(raw: unknown, year = new Date().getFullYear()): LabelResult {
  const r = (raw ?? {}) as { is_wine_label?: unknown; fields?: Record<string, unknown>; uncertain?: unknown; advice?: Record<string, unknown>; notes?: unknown };
  const f = r.fields ?? {};
  const fields: LabelResult['fields'] = {
    name: str(f.name, 120),
    domaine: str(f.domaine, 120),
    producer: str(f.producer, 120),
    cuvee: str(f.cuvee, 120),
    country: str(f.country, 60),
    region: str(f.region, 80),
    appellation: str(f.appellation, 120),
    color: COLORS.includes(String(f.color)) ? f.color : null,
    wine_type: TYPES.includes(String(f.wine_type)) ? f.wine_type : null,
    grapes: Array.isArray(f.grapes) ? f.grapes.map((g) => str(g, 40)).filter(Boolean).slice(0, 12) : [],
    vintage: int(f.vintage, 1800, year),
    non_vintage: f.non_vintage === true && !int(f.vintage, 1800, year),
    volume_ml: int(f.volume_ml, 50, 30000),
  };
  const a = r.advice ?? {};
  const advice: LabelResult['advice'] = {};
  const from = int(a.drink_from, 1800, 2200);
  const until = int(a.drink_until, 1800, 2200);
  if (from && until && from <= until) Object.assign(advice, { drink_from: from, drink_until: until });
  const tmin = int(a.serve_temp_min, 0, 25);
  const tmax = int(a.serve_temp_max, 0, 25);
  if (tmin !== null && tmax !== null && tmin <= tmax) Object.assign(advice, { serve_temp_min: tmin, serve_temp_max: tmax });
  const aeration = str(a.aeration, 300);
  if (aeration) advice.aeration = aeration;
  const pairings = str(a.pairings, 500);
  if (pairings) advice.pairings = pairings;
  const uncertain = Array.isArray(r.uncertain) ? [...new Set(r.uncertain.filter((u): u is string => typeof u === 'string' && (FIELDS as readonly string[]).includes(u)))] : [];
  return { is_wine_label: r.is_wine_label === true, fields, uncertain, advice, notes: str(r.notes, 300) };
}

function mediaType(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45) return 'image/webp';
  return null;
}

function base64(bytes: Uint8Array) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Lit la photo avec les droits de la personne (dossier privé) et vérifie taille et format. */
export async function readPhoto(user: SupabaseClient, userId: string, path: unknown, maxBytes: number) {
  if (typeof path !== 'string' || !path.startsWith(`${userId}/`) || path.includes('..') || path.length > 300) throw new AiFailure('forbidden');
  const { data, error } = await user.storage.from('photos').download(path);
  if (error || !data) throw new AiFailure('not_found');
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new AiFailure('image_too_large');
  const type = mediaType(bytes);
  if (!type) throw new AiFailure('image_invalid');
  return { data: base64(bytes), media_type: type };
}

export async function identifyLabel(o: { meter: Meter; image: { data: string; media_type: 'image/jpeg' | 'image/png' | 'image/webp' } }): Promise<LabelResult> {
  const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
    ...baseParams(o.meter.settings, Math.min(o.meter.settings.max_output_tokens * 2, 6000)),
    system: LABEL_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: o.image.media_type, data: o.image.data } },
          { type: 'text', text: 'Identifie le vin de cette étiquette et remplis la fiche.' },
        ],
      },
    ],
  };
  params.output_config = { ...(params.output_config ?? {}), format: { type: 'json_schema', schema: LABEL_SCHEMA } };
  const res = await o.meter.call(params, { images: 1 });
  if (res.stop_reason === 'refusal') throw new AiFailure('refused');
  const text = textOf(res);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AiFailure('bad_request', res.stop_reason === 'max_tokens' ? 'Réponse tronquée' : 'Réponse illisible');
  }
  return cleanLabel(parsed);
}

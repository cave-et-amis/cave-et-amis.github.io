/**
 * « Scanner avant d'acheter » — identification en magasin (lot 3a).
 *
 * Jusqu'à trois photos (étiquette, contre-étiquette, étiquette de prix), lues avec les droits de la personne, puis par
 * Claude avec une réponse structurée contrôlée champ par champ. Une même série de photos n'est jamais renvoyée à l'IA :
 * la lecture est reprise du cache du serveur. L'analyse est enregistrée dans l'historique privé de la personne, qui
 * vérifie les champs et confirme le prix du rayon. Rien n'est ajouté à sa cave.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { baseParams, textOf, type Meter } from './claude.ts';
import { cleanLabel } from './label.ts';
import { SCAN_SYSTEM } from './prompts.ts';
import { AiFailure, sanitize } from './util.ts';

export const PHOTO_ROLES = ['front', 'back', 'price'] as const;
export type PhotoRole = (typeof PHOTO_ROLES)[number];
export type ScanPhoto = { path: string; role: PhotoRole };

const LABEL_FIELDS = ['name', 'domaine', 'producer', 'cuvee', 'country', 'region', 'appellation', 'color', 'wine_type', 'grapes', 'vintage', 'non_vintage', 'volume_ml', 'barcode'] as const;
const FIELDS = [...LABEL_FIELDS, 'alcohol'] as const;
const COLORS = ['rouge', 'blanc', 'rose', 'orange', 'effervescent', 'autre'];
const TYPES = ['tranquille', 'effervescent', 'moelleux', 'liquoreux', 'fortifie', 'autre'];
export const PHOTO_ISSUES = ['blurry', 'glare', 'cropped', 'dark', 'vintage_unreadable', 'price_unreadable', 'price_tag_mismatch', 'different_bottles'] as const;

/** Durée de validité d'une lecture en cache (mêmes photos, octet pour octet). */
export const IDENTIFY_CACHE_DAYS = 90;

// Textes : chaîne vide si inconnu (et non null) ; l'API limite à 16 les paramètres « nullable » d'une requête.
const ns = { type: 'string' };
const ni = { anyOf: [{ type: 'integer' }, { type: 'null' }] };
const nn = { anyOf: [{ type: 'number' }, { type: 'null' }] };

export const SCAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_wine_label', 'fields', 'uncertain', 'candidates', 'price_tag', 'photo_issues', 'notes'],
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
        barcode: ns,
        alcohol: nn,
      },
    },
    uncertain: { type: 'array', items: { type: 'string', enum: [...FIELDS] } },
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'producer', 'cuvee', 'appellation', 'vintage', 'reason'],
        properties: { name: ns, producer: ns, cuvee: ns, appellation: ns, vintage: ni, reason: ns },
      },
    },
    price_tag: {
      type: 'object',
      additionalProperties: false,
      required: ['price', 'currency', 'label', 'conditions'],
      properties: { price: nn, currency: ns, label: ns, conditions: ns },
    },
    photo_issues: { type: 'array', items: { type: 'string', enum: [...PHOTO_ISSUES] } },
    notes: ns,
  },
};

export type ScanCandidate = { name: string; producer: string | null; cuvee: string | null; appellation: string | null; vintage: number | null; reason: string | null };

export type ScanResult = {
  is_wine_label: boolean;
  fields: Record<string, unknown> & { alcohol: number | null };
  uncertain: string[];
  candidates: ScanCandidate[];
  price_tag: { price: number | null; currency: string; label: string | null; conditions: string | null };
  photo_issues: string[];
  notes: string | null;
};

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? sanitize(v, max) : null);

export function cleanCurrency(v: unknown): string {
  const c = String(v ?? '')
    .trim()
    .toUpperCase()
    .replace('€', 'EUR');
  return /^[A-Z]{3}$/.test(c) ? c : 'EUR';
}

export function cleanPrice(v: unknown): number | null {
  const n = typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n > 0 && n < 100_000 ? Math.round(n * 100) / 100 : null;
}

/** Contrôle et nettoyage : mêmes règles que la lecture d'étiquette, plus degré, candidats, prix du rayon et défauts. */
export function cleanScan(raw: unknown, year = new Date().getFullYear()): ScanResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const f = (r.fields ?? {}) as Record<string, unknown>;
  const label = cleanLabel({ is_wine_label: r.is_wine_label, fields: f, uncertain: r.uncertain, advice: {}, notes: r.notes }, year);
  const abv = typeof f.alcohol === 'number' && f.alcohol >= 3 && f.alcohol <= 25 ? Math.round(f.alcohol * 10) / 10 : null;
  const uncertain = [...label.uncertain];
  if (abv !== null && Array.isArray(r.uncertain) && r.uncertain.includes('alcohol')) uncertain.push('alcohol');
  const candidates: ScanCandidate[] = (Array.isArray(r.candidates) ? r.candidates : [])
    .map((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      const name = str(o.name, 120);
      if (!name) return null;
      const v = Number.isInteger(o.vintage) && (o.vintage as number) >= 1800 && (o.vintage as number) <= year ? (o.vintage as number) : null;
      return { name, producer: str(o.producer, 120), cuvee: str(o.cuvee, 120), appellation: str(o.appellation, 120), vintage: v, reason: str(o.reason, 200) };
    })
    .filter((c): c is ScanCandidate => c !== null)
    .slice(0, 4);
  const p = (r.price_tag ?? {}) as Record<string, unknown>;
  const issues = Array.isArray(r.photo_issues) ? [...new Set(r.photo_issues.filter((i): i is string => (PHOTO_ISSUES as readonly string[]).includes(String(i))))] : [];
  return {
    is_wine_label: label.is_wine_label,
    fields: { ...label.fields, alcohol: abv },
    uncertain,
    // Une seule possibilité n'est pas un choix : elle ne sert à rien.
    candidates: candidates.length >= 2 ? candidates : [],
    price_tag: { price: cleanPrice(p.price), currency: cleanCurrency(p.currency), label: str(p.label, 160), conditions: str(p.conditions, 200) },
    photo_issues: issues,
    notes: label.notes,
  };
}

/** Photos demandées : 1 à 3, rôles distincts, dont l'étiquette ou la contre-étiquette. */
export function parsePhotos(raw: unknown): ScanPhoto[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 3) throw new AiFailure('invalid');
  const out: ScanPhoto[] = [];
  for (const p of raw) {
    const o = (p ?? {}) as Record<string, unknown>;
    if (typeof o.path !== 'string' || !(PHOTO_ROLES as readonly string[]).includes(String(o.role))) throw new AiFailure('invalid');
    if (out.some((x) => x.role === o.role)) throw new AiFailure('invalid');
    out.push({ path: o.path, role: o.role as PhotoRole });
  }
  if (!out.some((p) => p.role !== 'price')) throw new AiFailure('invalid');
  return out.sort((a, b) => PHOTO_ROLES.indexOf(a.role) - PHOTO_ROLES.indexOf(b.role));
}

/** Fiche de départ proposée à la personne, d'après la lecture (vide si ce n'est pas une étiquette de vin). */
export function initialWine(result: ScanResult) {
  if (!result.is_wine_label) return {};
  const out: Record<string, unknown> = {};
  for (const k of [...LABEL_FIELDS.filter((k) => k !== 'barcode'), 'alcohol']) {
    const v = result.fields[k];
    if (v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) out[k] = v;
  }
  return out;
}

const ROLE_TEXT: Record<PhotoRole, string> = {
  front: 'Photo : étiquette (face avant).',
  back: 'Photo : contre-étiquette (dos de la bouteille).',
  price: 'Photo : étiquette de prix en rayon.',
};

type ScanImage = { role: PhotoRole; data: string; media_type: 'image/jpeg' | 'image/png' | 'image/webp' };

export async function identifyScan(o: { meter: Meter; images: ScanImage[]; hint?: string | null }): Promise<ScanResult> {
  const content: Anthropic.Messages.ContentBlockParam[] = [];
  for (const image of o.images) {
    content.push({ type: 'text', text: ROLE_TEXT[image.role] });
    content.push({ type: 'image', source: { type: 'base64', media_type: image.media_type, data: image.data } });
  }
  if (o.hint) content.push({ type: 'text', text: `hint : ${o.hint}` });
  content.push({ type: 'text', text: 'Identifie ce vin et le prix du rayon, puis remplis la fiche.' });
  const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
    ...baseParams(o.meter.settings, Math.min(o.meter.settings.max_output_tokens * 2, 6000)),
    system: SCAN_SYSTEM,
    messages: [{ role: 'user', content }],
  };
  params.output_config = { ...(params.output_config ?? {}), format: { type: 'json_schema', schema: SCAN_SCHEMA } };
  const res = await o.meter.call(params, { images: o.images.length });
  if (res.stop_reason === 'refusal') throw new AiFailure('refused');
  let parsed: unknown;
  try {
    parsed = JSON.parse(textOf(res));
  } catch {
    throw new AiFailure('bad_request', res.stop_reason === 'max_tokens' ? 'Réponse tronquée' : 'Réponse illisible');
  }
  return cleanScan(parsed);
}

/** Supprime les analyses arrivées au terme de leur conservation (et leurs photos), puis le cache périmé. */
export async function purgeExpired(svc: SupabaseClient, userId: string, now: Date) {
  const { data } = await svc.from('scans').select('id, photos').eq('user_id', userId).lt('expires_at', now.toISOString()).limit(200);
  const rows = (data ?? []) as { id: string; photos: ScanPhoto[] }[];
  if (rows.length) {
    const paths = rows.flatMap((r) => (r.photos ?? []).map((p) => p.path)).filter((p) => p.startsWith(`${userId}/`));
    if (paths.length) await svc.storage.from('photos').remove(paths);
    await svc.from('scans').delete().in('id', rows.map((r) => r.id));
  }
  await svc.from('scan_cache').delete().lt('expires_at', now.toISOString());
}

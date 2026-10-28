/**
 * Lecture de documents d'achat par Lia, pour pré-remplir un formulaire (rien n'est enregistré : la personne vérifie) :
 * - « price » : une étiquette de prix, une page de catalogue ou un écran de site, pour « Saisir un prix relevé » ;
 * - « receipt » : un ticket de caisse ou une facture, pour le prix, la date et le lieu d'achat d'un lot ;
 * - « price_list » : la liste de prix d'un vigneron ou d'un caviste, pour proposer un achat groupé.
 * Une photo à la fois, déjà rangée dans le dossier privé de la personne et lue avec ses droits ; l'application l'efface
 * juste après la lecture. Le schéma de réponse n'a AUCUN champ pour une donnée personnelle (nom, carte bancaire,
 * adresse, téléphone, numéro de client) : Lia ne peut renvoyer que des vins, des prix, une date et un nom de magasin.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { baseParams, textOf, type Meter } from './claude.ts';
import { DOCUMENT_SYSTEM } from './prompts.ts';
import { AiFailure, sanitize } from './util.ts';

export const DOCUMENT_KINDS = ['price', 'receipt', 'price_list'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const MAX_LINES = 30;
const COLORS = ['rouge', 'blanc', 'rose', 'orange', 'effervescent', 'autre'];
const CURRENCIES = ['EUR', 'CHF', 'USD', 'GBP', 'CAD'];

const nullable = (t: Record<string, unknown>) => ({ anyOf: [t, { type: 'null' }] });
const LINE = {
  type: 'object',
  additionalProperties: false,
  required: ['wine_name', 'producer', 'vintage', 'color', 'volume_ml', 'unit_price', 'quantity'],
  properties: {
    wine_name: { type: 'string' },
    producer: { type: 'string' },
    vintage: nullable({ type: 'integer' }),
    color: nullable({ type: 'string', enum: COLORS }),
    volume_ml: nullable({ type: 'integer' }),
    unit_price: nullable({ type: 'number' }),
    quantity: nullable({ type: 'integer' }),
  },
};

/** Un seul schéma pour les trois documents ; la clé « document_lines » le distingue des autres lectures. */
export const DOCUMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_readable', 'currency', 'purchase_date', 'seller', 'title', 'conditions', 'document_lines', 'uncertain', 'notes'],
  properties: {
    is_readable: { type: 'boolean' },
    currency: { type: 'string' },
    purchase_date: { type: 'string' },
    seller: { type: 'string' },
    title: { type: 'string' },
    conditions: { type: 'string' },
    document_lines: { type: 'array', items: LINE },
    uncertain: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
};

export type DocumentLine = {
  wine_name: string;
  producer: string | null;
  vintage: number | null;
  color: string | null;
  volume_ml: number | null;
  unit_price: number | null;
  quantity: number | null;
};
export type DocumentResult = {
  is_readable: boolean;
  currency: string | null;
  purchase_date: string | null;
  seller: string | null;
  title: string | null;
  conditions: string | null;
  lines: DocumentLine[];
  uncertain: string[];
  notes: string | null;
};

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? sanitize(v, max) : null);
const int = (v: unknown, min: number, max: number) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : null);
// Un numéro de carte (13 à 19 chiffres, espacés ou non) ne doit jamais ressortir, même glissé dans un texte.
const CARD = /\b(?:\d[ -]?){13,19}\b/g;
const scrub = (v: string | null) => (v ? v.replace(CARD, '…').trim() || null : null);

/** Contrôle de la réponse : bornes, couleurs et devises connues, date réelle, au plus MAX_LINES lignes avec un nom. */
export function cleanDocument(raw: unknown, today = new Date()): DocumentResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const year = today.getFullYear();
  const lines: DocumentLine[] = [];
  for (const l of Array.isArray(r.document_lines) ? r.document_lines : []) {
    const f = (l ?? {}) as Record<string, unknown>;
    const wine_name = scrub(str(f.wine_name, 120));
    if (!wine_name) continue;
    const price = typeof f.unit_price === 'number' && Number.isFinite(f.unit_price) && f.unit_price >= 0 && f.unit_price <= 100_000 ? Math.round(f.unit_price * 100) / 100 : null;
    lines.push({
      wine_name,
      producer: scrub(str(f.producer, 120)),
      vintage: int(f.vintage, 1800, year),
      color: COLORS.includes(String(f.color)) ? String(f.color) : null,
      volume_ml: int(f.volume_ml, 100, 30_000),
      unit_price: price,
      quantity: int(f.quantity, 1, 1000),
    });
    if (lines.length >= MAX_LINES) break;
  }
  const currency = typeof r.currency === 'string' && CURRENCIES.includes(r.currency.trim().toUpperCase()) ? r.currency.trim().toUpperCase() : null;
  const d = typeof r.purchase_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.purchase_date) ? r.purchase_date : null;
  // Une vraie date (le 31 février n'existe pas), ni future ni trop ancienne.
  const real = d !== null && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
  const date = real && d! <= today.toISOString().slice(0, 10) && d! >= '2000-01-01' ? d : null;
  return {
    is_readable: r.is_readable === true && lines.length > 0,
    currency,
    purchase_date: date,
    seller: scrub(str(r.seller, 120)),
    title: scrub(str(r.title, 80)),
    conditions: scrub(str(r.conditions, 300)),
    lines,
    uncertain: Array.isArray(r.uncertain) ? [...new Set(r.uncertain.filter((u): u is string => typeof u === 'string').map((u) => u.slice(0, 40)))].slice(0, 10) : [],
    notes: scrub(str(r.notes, 300)),
  };
}

const ASK: Record<DocumentKind, string> = {
  price: 'Cette photo montre une étiquette de prix, une page de catalogue ou un écran de site. Lis le ou les vins et leur prix par bouteille.',
  receipt: 'Cette photo montre un ticket de caisse ou une facture. Lis les lignes de vin (prix unitaire, quantité), la date d’achat et le nom du magasin.',
  price_list: 'Cette photo montre la liste de prix d’un vigneron ou d’un caviste. Lis chaque vin proposé avec son prix par bouteille, et propose un titre court.',
};

type DocImage = { data: string; media_type: 'image/jpeg' | 'image/png' | 'image/webp' };

export async function readDocument(o: { meter: Meter; image: DocImage; kind: DocumentKind }): Promise<DocumentResult> {
  const content: Anthropic.Messages.ContentBlockParam[] = [
    { type: 'image', source: { type: 'base64', media_type: o.image.media_type, data: o.image.data } },
    { type: 'text', text: ASK[o.kind] },
  ];
  const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
    ...baseParams(o.meter.settings, Math.min(o.meter.settings.max_output_tokens * 2, 6000)),
    system: DOCUMENT_SYSTEM,
    messages: [{ role: 'user', content }],
  };
  params.output_config = { ...(params.output_config ?? {}), format: { type: 'json_schema', schema: DOCUMENT_SCHEMA } };
  const res = await o.meter.call(params, { images: 1 });
  if (res.stop_reason === 'refusal') throw new AiFailure('refused');
  let parsed: unknown;
  try {
    parsed = JSON.parse(textOf(res));
  } catch {
    throw new AiFailure('bad_request', res.stop_reason === 'max_tokens' ? 'Réponse tronquée' : 'Réponse illisible');
  }
  return cleanDocument(parsed);
}

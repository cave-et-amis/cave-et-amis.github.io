/**
 * Prix de marché : recherche web côté Anthropic (outil serveur web_search), puis contrôle par le serveur :
 * une offre n'est retenue que si son lien figure parmi les pages réellement renvoyées par la recherche,
 * et si le millésime et la contenance correspondent. Sans offre vérifiable : « prix non vérifié ».
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PriceSource, Wine } from '../../src/domain/types.ts';
import { baseParams, webSearchTool, type Meter } from './claude.ts';
import { PRICE_SYSTEM } from './prompts.ts';
import { AiFailure, sanitize } from './util.ts';

export type PriceResult = {
  status: 'verified' | 'unverified';
  check_id: string | null;
  wine_id: string;
  volume_ml: number;
  currency: string | null;
  low: number | null;
  high: number | null;
  offers: PriceSource[];
  reason: string | null;
  checked_at: string;
};

export const REPORT_TOOL: Anthropic.Messages.Tool = {
  name: 'report_offers',
  description: 'Transmet les offres de vente retenues (liens issus de la recherche web uniquement). À appeler une seule fois, à la fin.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['offers', 'comment'],
    properties: {
      offers: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['url', 'title', 'seller', 'price', 'currency', 'vintage', 'volume_ml'],
          properties: {
            url: { type: 'string', description: 'Adresse exacte de la page trouvée par la recherche' },
            title: { type: 'string' },
            seller: { type: 'string', description: 'Nom du marchand ou du site' },
            price: { type: 'number', description: 'Prix TTC d’une bouteille, nombre seul' },
            currency: { type: 'string', description: 'Code ISO de la devise, par exemple EUR' },
            vintage: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
            volume_ml: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
          },
        },
      },
      comment: { type: 'string', description: 'Une phrase : ce qui a été trouvé ou pourquoi rien n’a été retenu' },
    },
  },
};

export function normUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    u.hash = '';
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return null;
  }
}

/** Adresses réellement renvoyées par la recherche (résultats et citations) dans une réponse. */
export function collectSearchUrls(content: Anthropic.Messages.ContentBlock[], into: Map<string, string>, ages?: Map<string, string | null>) {
  const errors: string[] = [];
  for (const block of content) {
    if (block.type === 'web_search_tool_result') {
      if (Array.isArray(block.content)) {
        for (const r of block.content) {
          const n = normUrl(r.url);
          if (n) into.set(n, r.title);
          if (n && ages) ages.set(n, r.page_age ?? null);
        }
      } else if (block.content && 'error_code' in block.content) errors.push(String(block.content.error_code));
    } else if (block.type === 'text') {
      for (const c of block.citations ?? []) {
        if (c.type === 'web_search_result_location') {
          const n = normUrl(c.url);
          if (n && !into.has(n)) into.set(n, c.title ?? '');
        }
      }
    }
  }
  return errors;
}

type RawOffer = { url: string; title: string; seller: string; price: number; currency: string; vintage: number | null; volume_ml: number | null };

/** Garde uniquement les offres vérifiables : lien issu de la recherche, prix plausible, millésime et contenance exacts. */
export function validateOffers(raw: RawOffer[], allowed: Map<string, string>, wine: { vintage: number | null }, volumeMl: number): PriceSource[] {
  const seen = new Set<string>();
  const out: PriceSource[] = [];
  for (const o of raw ?? []) {
    const n = normUrl(String(o?.url ?? ''));
    if (!n || !allowed.has(n) || seen.has(n)) continue;
    const price = Number(o.price);
    if (!Number.isFinite(price) || price <= 0 || price >= 1_000_000) continue;
    const currency = String(o.currency ?? '')
      .trim()
      .toUpperCase()
      .replace('€', 'EUR');
    if (!/^[A-Z]{3}$/.test(currency)) continue;
    if (wine.vintage && o.vintage !== wine.vintage) continue;
    if (o.volume_ml ? o.volume_ml !== volumeMl : volumeMl !== 750) continue;
    seen.add(n);
    out.push({
      url: String(o.url).trim(),
      title: sanitize(o.title || allowed.get(n) || '', 140),
      seller: sanitize(o.seller, 80),
      price: Math.round(price * 100) / 100,
      currency,
      volume_ml: volumeMl,
      vintage: wine.vintage,
    });
    if (out.length >= 10) break;
  }
  return out;
}

export function summarize(offers: PriceSource[], preferred: string) {
  const byCur = new Map<string, number[]>();
  for (const o of offers) byCur.set(o.currency!, [...(byCur.get(o.currency!) ?? []), o.price!]);
  const currency = [...byCur.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] === preferred ? -1 : b[0] === preferred ? 1 : 0))[0]?.[0];
  if (!currency) return null;
  const prices = byCur.get(currency)!;
  return { currency, low: Math.min(...prices), high: Math.max(...prices) };
}

function describeWine(w: Wine, volumeMl: number) {
  return [
    `Vin : ${w.name}`,
    w.cuvee ? `Cuvée : ${w.cuvee}` : null,
    w.domaine || w.producer ? `Producteur : ${w.domaine || w.producer}` : null,
    w.appellation ? `Appellation : ${w.appellation}` : null,
    w.region ? `Région : ${w.region}` : null,
    w.vintage ? `Millésime : ${w.vintage}` : w.non_vintage ? 'Sans millésime' : 'Millésime : inconnu',
    `Contenance : ${volumeMl} ml`,
  ]
    .filter(Boolean)
    .join('\n');
}

export type Research<T> = {
  report: T | null;
  /** Adresses réellement renvoyées par la recherche (normalisées) → titre. */
  allowed: Map<string, string>;
  /** Ancienneté des pages indiquée par la recherche, quand elle est connue. */
  ages: Map<string, string | null>;
  errors: string[];
  /** Raison d'un arrêt sans rapport (recherche désactivée côté Anthropic, limite atteinte, refus). */
  reason: string | null;
};

/**
 * Recherche web côté Anthropic puis rapport final par un outil (appelé une fois) : poursuit après « pause_turn »,
 * dans la limite des recherches réglées, et relève les adresses réellement renvoyées (seules retenues ensuite).
 */
export async function researchWithTool<T>(
  meter: Meter,
  o: { system: string; prompt: string; tool: Anthropic.Messages.Tool; maxTokens?: number; blockedDomains?: string[] },
): Promise<Research<T>> {
  const settings = meter.settings;
  const allowed = new Map<string, string>();
  const ages = new Map<string, string | null>();
  const errors: string[] = [];
  let reason: string | null = null;
  let report: T | null = null;
  const startSearches = meter.searches;
  const messages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: o.prompt }];
  try {
    for (let turn = 0; turn < 3 && !report; turn++) {
      const remaining = settings.max_web_searches - (meter.searches - startSearches);
      if (remaining <= 0 && turn > 0) break;
      const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
        ...baseParams(settings, o.maxTokens ?? Math.min(settings.max_output_tokens, 4000)),
        system: o.system,
        tools: [webSearchTool(settings.model, Math.max(remaining, 1), o.blockedDomains), o.tool],
        messages,
      };
      const msg = await meter.call(params, { webSearches: Math.max(remaining, 1) });
      errors.push(...collectSearchUrls(msg.content, allowed, ages));
      const call = msg.content.find((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use' && b.name === o.tool.name);
      if (call) {
        report = call.input as T;
        break;
      }
      if (msg.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: msg.content });
        continue;
      }
      if (msg.stop_reason === 'refusal') reason = 'La recherche n’a pas pu être menée pour ce vin.';
      break;
    }
  } catch (e) {
    const f = e as AiFailure;
    if (f instanceof AiFailure && f.code === 'web_search_unavailable') {
      reason = 'La recherche web n’est pas activée pour la clé API utilisée (réglage de l’organisation dans la console Anthropic).';
    } else if (f instanceof AiFailure && (f.code === 'call_limit' || f.code === 'budget_exhausted' || f.code === 'quota_monthly')) {
      reason = 'La limite d’utilisation de l’assistant a été atteinte avant la fin de la recherche.';
    } else throw e;
  }
  return { report, allowed, ages, errors, reason };
}

export async function lookupPrice(
  o: { svc: SupabaseClient; meter: Meter; userId: string; currency: string },
  wine: Wine,
  volumeMl: number,
): Promise<PriceResult> {
  const { svc, meter } = o;
  const settings = meter.settings;
  let status: 'verified' | 'unverified' = 'unverified';
  let reason: string | null = null;
  let offers: PriceSource[] = [];

  if (!settings.web_search_enabled || settings.max_web_searches <= 0) {
    reason = 'La recherche web est désactivée par l’administrateur : le prix ne peut pas être vérifié.';
  } else if (!wine.vintage && !wine.non_vintage) {
    reason = 'Millésime inconnu : indiquez-le sur la fiche (ou « sans millésime ») pour rechercher le prix exact.';
  } else {
    const research = await researchWithTool<{ offers: RawOffer[]; comment: string }>(meter, {
      system: PRICE_SYSTEM,
      prompt: `${describeWine(wine, volumeMl)}

Trouve des offres de vente actuelles pour ce vin exact, puis appelle report_offers.`,
      tool: REPORT_TOOL,
    });
    const report = research.report;
    reason = research.reason;
    if (report) {
      offers = validateOffers(report.offers, research.allowed, wine, volumeMl);
      if (offers.length) status = 'verified';
      else
        reason =
          report.offers?.length > 0
            ? 'Des prix ont été proposés mais aucun n’a pu être vérifié (lien absent des résultats, millésime ou contenance différents).'
            : `Aucune offre fiable trouvée. ${sanitize(report.comment, 200)}`.trim();
    } else if (!reason) {
      reason = research.errors.length
        ? `La recherche web n’a pas abouti (${research.errors.join(', ')}).`
        : 'La recherche n’a renvoyé aucune offre exploitable.';
    }
  }

  const summary = status === 'verified' ? summarize(offers, o.currency) : null;
  const { data, error } = await svc
    .from('price_checks')
    .insert({
      user_id: o.userId,
      wine_id: wine.id,
      volume_ml: volumeMl,
      status,
      currency: summary?.currency ?? null,
      price_low: summary?.low ?? null,
      price_high: summary?.high ?? null,
      offers,
      reason,
      model: settings.model,
    })
    .select('id, created_at')
    .single();
  if (error) throw new AiFailure('internal', sanitize(error.message));
  return {
    status,
    check_id: (data as { id: string }).id,
    wine_id: wine.id,
    volume_ml: volumeMl,
    currency: summary?.currency ?? null,
    low: summary?.low ?? null,
    high: summary?.high ?? null,
    offers,
    reason,
    checked_at: (data as { created_at: string }).created_at,
  };
}

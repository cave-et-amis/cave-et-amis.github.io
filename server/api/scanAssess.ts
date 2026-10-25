/**
 * « Scanner avant d'acheter » — lot 3b : analyse qualitative sourcée et offres comparables du marché.
 *
 * Deux recherches web distinctes (l'analyse d'un vin reste valable longtemps, un prix seulement quelques jours), chacune
 * terminée par un rapport structuré que le serveur contrôle : un lien n'est retenu que s'il figure parmi les pages
 * réellement renvoyées par la recherche ; un avis ou une note sans lien vérifiable est écarté ; une offre n'est retenue
 * que pour le même millésime, la même contenance, un prix TTC d'une bouteille. Sans source : « non vérifié ».
 * Vivino est exclu de la recherche (ses conditions n'autorisent pas la reprise de ses données).
 */
import type Anthropic from '@anthropic-ai/sdk';
import { median } from '../../src/domain/scan.ts';
import type { QualityTier, ScanAssessment, ScanMarket, ScanMarketOffer, ScanWine, SourcedText } from '../../src/domain/types.ts';
import type { Meter } from './claude.ts';
import { normUrl, researchWithTool, validateOffers } from './price.ts';
import { QUALITY_SYSTEM, SCAN_PRICE_SYSTEM } from './prompts.ts';
import { cleanCurrency } from './scan.ts';
import { sanitize } from './util.ts';

export const BLOCKED_DOMAINS = ['vivino.com'];
/** Validité des résultats en cache : analyse d'un vin (millésime compris) et relevé de prix. */
export const ASSESS_CACHE_DAYS = 90;
export const PRICE_CACHE_HOURS = 72;

const TIERS: QualityTier[] = ['remarquable', 'tres_bon', 'bon', 'correct', 'decevant'];
const VINTAGE_RATINGS = ['exceptionnel', 'tres_bon', 'bon', 'moyen', 'difficile'] as const;

const sourced = (description: string) => ({
  type: 'object',
  additionalProperties: false,
  required: ['text', 'source_urls'],
  properties: { text: { type: 'string', description }, source_urls: { type: 'array', items: { type: 'string' } } },
});

/** Outil non « strict » (trop de champs facultatifs) : chaque entrée est revérifiée par cleanAssessment. */
export const ASSESS_TOOL: Anthropic.Messages.Tool = {
  name: 'report_assessment',
  description: 'Transmet l’analyse du vin (liens issus de la recherche web uniquement). À appeler une seule fois, à la fin.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['producer', 'appellation', 'vintage', 'critics', 'consumers', 'aromatic_profile', 'drink_window', 'pairings', 'quality', 'quality_reason'],
    properties: {
      producer: sourced('Réputation du producteur et de la cuvée, en une ou deux phrases'),
      appellation: sourced('Caractéristiques de l’appellation, en une ou deux phrases'),
      vintage: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'rating', 'source_urls'],
        properties: {
          text: { type: 'string', description: 'Qualité et particularités du millésime dans cette région' },
          rating: { type: 'string', enum: [...VINTAGE_RATINGS, 'inconnu'] },
          source_urls: { type: 'array', items: { type: 'string' } },
        },
      },
      critics: {
        type: 'array',
        description: 'Avis de dégustateurs ou de guides reconnus pour CE millésime, lus sur une page trouvée',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['publication', 'reviewer', 'score', 'summary', 'url'],
          properties: {
            publication: { type: 'string' },
            reviewer: { type: 'string' },
            score: { type: 'string', description: 'Note telle que publiée, par exemple « 92/100 » ou « 2 étoiles » ; vide si aucune' },
            summary: { type: 'string', description: 'Reformulation courte (pas de citation)' },
            url: { type: 'string' },
          },
        },
      },
      consumers: {
        type: 'array',
        description: 'Notes de consommateurs, seulement si le site affiche la moyenne ET le nombre d’avis',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['site', 'average', 'scale', 'count', 'url'],
          properties: { site: { type: 'string' }, average: { type: 'number' }, scale: { type: 'number' }, count: { type: 'integer' }, url: { type: 'string' } },
        },
      },
      aromatic_profile: { type: 'string', description: 'Profil aromatique probable (estimation)' },
      drink_window: {
        type: 'object',
        additionalProperties: false,
        required: ['from', 'until', 'source_url'],
        properties: { from: { type: ['integer', 'null'] }, until: { type: ['integer', 'null'] }, source_url: { type: 'string', description: 'Page qui l’indique, sinon vide' } },
      },
      pairings: { type: 'string', description: 'Accords mets et vins (estimation)' },
      quality: { type: 'string', enum: [...TIERS, 'inconnu'] },
      quality_reason: { type: 'string', description: 'Une phrase : sur quoi repose ce niveau' },
    },
  },
};

export const SCAN_OFFERS_TOOL: Anthropic.Messages.Tool = {
  name: 'report_scan_offers',
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
          required: ['url', 'title', 'seller', 'country', 'price', 'currency', 'vat', 'shipping', 'min_quantity', 'vintage', 'volume_ml'],
          properties: {
            url: { type: 'string', description: 'Adresse exacte de la page trouvée par la recherche' },
            title: { type: 'string' },
            seller: { type: 'string' },
            country: { type: 'string', description: 'Pays du marchand (code à deux lettres), vide si inconnu' },
            price: { type: 'number', description: 'Prix d’UNE bouteille, nombre seul' },
            currency: { type: 'string' },
            vat: { type: 'string', enum: ['ttc', 'ht', 'inconnu'] },
            shipping: { anyOf: [{ type: 'number' }, { type: 'null' }], description: 'Frais de livraison indiqués, sinon null' },
            min_quantity: { anyOf: [{ type: 'integer' }, { type: 'null' }], description: 'Vente par carton : nombre minimal de bouteilles' },
            vintage: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
            volume_ml: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
          },
        },
      },
      comment: { type: 'string', description: 'Une phrase : ce qui a été trouvé ou pourquoi rien n’a été retenu' },
    },
  },
};

export function describeScanWine(w: ScanWine) {
  return [
    `Vin : ${w.name}`,
    w.cuvee ? `Cuvée : ${w.cuvee}` : null,
    w.domaine || w.producer ? `Producteur : ${w.domaine || w.producer}` : null,
    w.appellation ? `Appellation : ${w.appellation}` : null,
    w.region ? `Région : ${w.region}` : null,
    w.color ? `Couleur : ${w.color}` : null,
    w.vintage ? `Millésime : ${w.vintage}` : w.non_vintage ? 'Sans millésime' : 'Millésime : inconnu',
    `Contenance : ${w.volume_ml ?? 750} ml`,
  ]
    .filter(Boolean)
    .join('\n');
}

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? sanitize(v, max) : null);

/** Garde les liens qui figurent parmi les pages réellement renvoyées par la recherche (adresse d'origine conservée). */
function keepUrls(list: unknown, allowed: Map<string, string>): string[] {
  const out: string[] = [];
  for (const u of Array.isArray(list) ? list : []) {
    const n = typeof u === 'string' ? normUrl(u) : null;
    if (n && allowed.has(n) && !out.some((x) => normUrl(x) === n)) out.push(String(u).trim());
  }
  return out.slice(0, 5);
}

function section(raw: unknown, allowed: Map<string, string>, max = 400): SourcedText {
  const o = (raw ?? {}) as { text?: unknown; source_urls?: unknown };
  const text = str(o.text, max);
  const sources = text ? keepUrls(o.source_urls, allowed) : [];
  return { text, origin: text ? (sources.length ? 'source' : 'estimation') : null, sources };
}

/** Contrôle de l'analyse : liens vérifiés, avis et notes sans lien écartés, niveau de qualité seulement s'il est sourcé. */
export function cleanAssessment(raw: unknown, allowed: Map<string, string>, ages: Map<string, string | null>, key: string, now: Date): ScanAssessment {
  const r = (raw ?? {}) as Record<string, unknown>;
  const year = now.getFullYear();
  const okUrl = (u: unknown) => (typeof u === 'string' && allowed.has(normUrl(u) ?? '') ? u.trim() : null);
  const producer = section(r.producer, allowed);
  const appellation = section(r.appellation, allowed);
  const v = (r.vintage ?? {}) as Record<string, unknown>;
  const vintageText = section(v, allowed);
  const rating = (VINTAGE_RATINGS as readonly string[]).includes(String(v.rating)) && vintageText.sources.length ? (v.rating as ScanAssessment['vintage']['rating']) : null;
  const critics = (Array.isArray(r.critics) ? r.critics : [])
    .map((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      const url = okUrl(o.url);
      const publication = str(o.publication, 80);
      if (!url || !publication) return null;
      return { publication, reviewer: str(o.reviewer, 80), score: str(o.score, 30), summary: str(o.summary, 200), url };
    })
    .filter((c): c is ScanAssessment['critics'][number] => c !== null)
    .slice(0, 6);
  const consumers = (Array.isArray(r.consumers) ? r.consumers : [])
    .map((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      const url = okUrl(o.url);
      const site = str(o.site, 60);
      const average = Number(o.average);
      const scale = Number(o.scale);
      const count = Number(o.count);
      // Une note de consommateurs n'a de sens qu'avec son échelle et son nombre d'avis.
      if (!url || !site || !Number.isInteger(count) || count < 1 || !(scale > 0 && scale <= 100) || !(average >= 0 && average <= scale)) return null;
      if (BLOCKED_DOMAINS.some((d) => new URL(url).hostname.endsWith(d))) return null;
      return { site, average: Math.round(average * 10) / 10, scale, count, url };
    })
    .filter((c): c is ScanAssessment['consumers'][number] => c !== null)
    .slice(0, 4);
  const w = (r.drink_window ?? {}) as Record<string, unknown>;
  const from = Number.isInteger(w.from) ? (w.from as number) : null;
  const until = Number.isInteger(w.until) ? (w.until as number) : null;
  const windowSource = okUrl(w.source_url);
  const drink_window =
    from && until && from >= 1800 && until <= year + 80 && from <= until ? { from, until, origin: windowSource ? ('source' as const) : ('estimation' as const), source: windowSource } : null;

  const used = new Set<string>([...producer.sources, ...appellation.sources, ...vintageText.sources, ...critics.map((c) => c.url), ...consumers.map((c) => c.url)]);
  if (windowSource) used.add(windowSource);
  const sources = [...used].map((url) => {
    const n = normUrl(url)!;
    return { url, title: sanitize(allowed.get(n) ?? '', 140), page_age: ages.get(n) ?? null };
  });
  const tier = TIERS.includes(r.quality as QualityTier) ? (r.quality as QualityTier) : null;
  // Le niveau de qualité est une estimation de Lia : il n'est retenu que s'il s'appuie sur au moins une source vérifiée
  // sur le producteur, le millésime ou un avis.
  const grounded = producer.sources.length + vintageText.sources.length + critics.length + consumers.length;
  const quality = tier && grounded > 0 ? { tier, reason: str(r.quality_reason, 300), sources: sources.length } : null;
  return {
    key,
    producer,
    appellation,
    vintage: { ...vintageText, rating },
    critics,
    consumers,
    aromatic_profile: str(r.aromatic_profile, 400),
    drink_window,
    pairings: str(r.pairings, 400),
    quality,
    quality_note: quality ? null : tier ? 'Niveau proposé sans source vérifiable : il n’est pas retenu.' : 'Pas assez d’informations vérifiables pour juger la qualité.',
    sources,
    reason: null,
    assessed_at: now.toISOString(),
  };
}

export function emptyAssessment(key: string, reason: string, now: Date): ScanAssessment {
  const none: SourcedText = { text: null, origin: null, sources: [] };
  return {
    key,
    producer: none,
    appellation: none,
    vintage: { ...none, rating: null },
    critics: [],
    consumers: [],
    aromatic_profile: null,
    drink_window: null,
    pairings: null,
    quality: null,
    quality_note: 'Pas assez d’informations vérifiables pour juger la qualité.',
    sources: [],
    reason,
    assessed_at: now.toISOString(),
  };
}

export async function assessWine(meter: Meter, wine: ScanWine, key: string, now: Date): Promise<ScanAssessment> {
  const research = await researchWithTool<Record<string, unknown>>(meter, {
    system: QUALITY_SYSTEM,
    prompt: `${describeScanWine(wine)}\n\nRecherche des informations fiables sur ce vin, puis appelle report_assessment.`,
    tool: ASSESS_TOOL,
    maxTokens: Math.min(meter.settings.max_output_tokens * 2, 6000),
    blockedDomains: BLOCKED_DOMAINS,
  });
  if (!research.report) {
    return emptyAssessment(key, research.reason ?? (research.errors.length ? `La recherche web n’a pas abouti (${research.errors.join(', ')}).` : 'La recherche n’a pas abouti.'), now);
  }
  return cleanAssessment(research.report, research.allowed, research.ages, key, now);
}

type RawScanOffer = {
  url: string;
  title: string;
  seller: string;
  country: string;
  price: number;
  currency: string;
  vat: 'ttc' | 'ht' | 'inconnu';
  shipping: number | null;
  min_quantity: number | null;
  vintage: number | null;
  volume_ml: number | null;
};

/** Offres vérifiées (mêmes règles que les prix de marché, plus : jamais de prix hors taxes) puis synthèse. */
export function buildMarket(raw: RawScanOffer[], allowed: Map<string, string>, ages: Map<string, string | null>, wine: ScanWine, currency: string, key: string, now: Date, comment?: string | null): ScanMarket {
  const ttc = (raw ?? []).filter((o) => o && o.vat !== 'ht');
  const volume = wine.volume_ml ?? 750;
  const kept = validateOffers(ttc, allowed, { vintage: wine.vintage ?? null }, volume);
  const extra = new Map(ttc.map((o) => [normUrl(String(o.url ?? '')), o]));
  const offers: ScanMarketOffer[] = kept.map((k) => {
    const n = normUrl(k.url!)!;
    const o = extra.get(n);
    const shipping = typeof o?.shipping === 'number' && o.shipping >= 0 && o.shipping < 1000 ? Math.round(o.shipping * 100) / 100 : null;
    const minQ = Number.isInteger(o?.min_quantity) && (o!.min_quantity as number) > 1 && (o!.min_quantity as number) <= 120 ? (o!.min_quantity as number) : null;
    const country = typeof o?.country === 'string' && /^[A-Za-z]{2}$/.test(o.country) ? o.country.toUpperCase() : null;
    return { seller: k.seller!, url: k.url!, title: k.title ?? '', price: k.price!, currency: k.currency!, shipping, min_quantity: minQ, country, page_age: ages.get(n) ?? null };
  });
  const same = offers.filter((o) => o.currency === currency);
  const prices = same.map((o) => o.price);
  const status = same.length ? 'verified' : 'unverified';
  return {
    key,
    status,
    currency: same.length ? currency : null,
    low: prices.length ? Math.min(...prices) : null,
    high: prices.length ? Math.max(...prices) : null,
    median: median(prices),
    count: same.length,
    // Fiabilité : plusieurs offres dans la devise du magasin, une ou deux, ou seulement d'autres marchés.
    reliability: same.length >= 3 ? 'haute' : same.length ? 'moyenne' : offers.length ? 'faible' : null,
    offers,
    reason: same.length
      ? null
      : offers.length
        ? 'Offres trouvées seulement dans une autre devise : la comparaison avec le prix du magasin n’est pas fiable.'
        : raw?.length
          ? 'Des prix ont été proposés mais aucun n’a pu être vérifié (lien absent des résultats, millésime, contenance ou TTC différents).'
          : `Aucune offre fiable trouvée.${comment ? ` ${sanitize(comment, 200)}` : ''}`,
    checked_at: now.toISOString(),
  };
}

export function emptyMarket(key: string, reason: string, now: Date): ScanMarket {
  return { key, status: 'unverified', currency: null, low: null, high: null, median: null, count: 0, reliability: null, offers: [], reason, checked_at: now.toISOString() };
}

export async function searchMarket(meter: Meter, wine: ScanWine, currency: string, key: string, now: Date): Promise<ScanMarket> {
  const research = await researchWithTool<{ offers: RawScanOffer[]; comment: string }>(meter, {
    system: SCAN_PRICE_SYSTEM,
    prompt: `${describeScanWine(wine)}\n\nTrouve des offres de vente actuelles pour ce vin exact, en priorité chez des marchands français (prix TTC d’une bouteille), puis appelle report_scan_offers.`,
    tool: SCAN_OFFERS_TOOL,
    blockedDomains: BLOCKED_DOMAINS,
  });
  if (!research.report) {
    return emptyMarket(key, research.reason ?? (research.errors.length ? `La recherche web n’a pas abouti (${research.errors.join(', ')}).` : 'La recherche n’a renvoyé aucune offre exploitable.'), now);
  }
  return buildMarket(research.report.offers, research.allowed, research.ages, wine, cleanCurrency(currency), key, now, research.report.comment);
}

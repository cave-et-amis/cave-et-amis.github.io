/**
 * Coûts des appels à Claude, en dollars.
 *
 *  - `callBound` : enveloppe maximale réservée AVANT un appel. Elle borne les jetons d'entrée (estimation prudente :
 *    2 caractères par jeton, chaque image comptée au maximum du modèle), les jetons de sortie (max_tokens, réflexion
 *    comprise) et les recherches web (nombre plafonné par max_uses). Les jetons des pages lues par la recherche web ne
 *    peuvent pas être bornés exactement : une provision par recherche est réservée, c'est une estimation, pas un plafond strict.
 *  - `actualCost` : coût réel d'après l'usage renvoyé par l'API, qui remplace l'enveloppe après l'appel.
 */

export type ModelPrice = { input: number; output: number; cache_write?: number; cache_read?: number };

export type UsageLike = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
};

/** Jetons visuels maximum d'une image (modèles haute résolution : 4 784 ; on arrondit au-dessus). */
export const MAX_IMAGE_TOKENS = 4800;

export function priceFor(prices: unknown, model: string): ModelPrice | null {
  if (!prices || typeof prices !== 'object') return null;
  const p = (prices as Record<string, unknown>)[model] as Partial<ModelPrice> | undefined;
  if (!p || typeof p.input !== 'number' || typeof p.output !== 'number' || p.input < 0 || p.output < 0) return null;
  return {
    input: p.input,
    output: p.output,
    cache_write: typeof p.cache_write === 'number' ? p.cache_write : undefined,
    cache_read: typeof p.cache_read === 'number' ? p.cache_read : undefined,
  };
}

const round6 = (n: number) => Math.ceil(n * 1e6) / 1e6;

export function actualCost(price: ModelPrice, usage: UsageLike, webSearchPricePer1000: number): number {
  const cacheWrite = price.cache_write ?? price.input * 1.25;
  const cacheRead = price.cache_read ?? price.input * 0.1;
  const tokens =
    (usage.input_tokens ?? 0) * price.input +
    (usage.cache_creation_input_tokens ?? 0) * cacheWrite +
    (usage.cache_read_input_tokens ?? 0) * cacheRead +
    (usage.output_tokens ?? 0) * price.output;
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  return round6(tokens / 1e6 + (searches * webSearchPricePer1000) / 1000);
}

export function estimateInputTokens(chars: number) {
  return Math.ceil(chars / 2);
}

export function callBound(o: {
  price: ModelPrice;
  inputChars: number;
  images: number;
  maxOutputTokens: number;
  webSearches: number;
  webSearchTokenAllowance: number;
  webSearchPricePer1000: number;
}): number {
  const inputTokens = estimateInputTokens(o.inputChars) + o.images * MAX_IMAGE_TOKENS + o.webSearches * o.webSearchTokenAllowance;
  const inputPrice = Math.max(o.price.input, o.price.cache_write ?? o.price.input * 1.25);
  return round6((inputTokens * inputPrice + o.maxOutputTokens * o.price.output) / 1e6 + (o.webSearches * o.webSearchPricePer1000) / 1000);
}

/** Taille (en caractères) d'une requête, sans le contenu des images (compté à part). */
export function requestChars(params: { system?: unknown; tools?: unknown; messages: unknown }) {
  return JSON.stringify({ s: params.system, t: params.tools, m: params.messages }, (key, value) =>
    key === 'data' && typeof value === 'string' && value.length > 200 ? '' : value,
  ).length;
}

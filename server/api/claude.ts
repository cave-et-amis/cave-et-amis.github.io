/**
 * Appels à Claude avec maîtrise du budget : chaque appel réserve d'abord son enveloppe maximale dans la base
 * (contrôle atomique du budget global et des quotas, y compris pour des demandes simultanées), puis la remplace
 * par le coût réel renvoyé par l'API.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { actualCost, callBound, priceFor, requestChars, type ModelPrice } from './costs.ts';
import { AiFailure, sanitize, type ApiEnv } from './util.ts';

export type AiSettings = {
  enabled: boolean;
  model: string;
  effort: 'low' | 'medium' | 'high';
  max_output_tokens: number;
  max_input_chars: number;
  max_image_bytes: number;
  max_api_calls: number;
  history_messages: number;
  web_search_enabled: boolean;
  max_web_searches: number;
  web_search_token_allowance: number;
  web_search_price_per_1000: number;
  monthly_budget_usd: number;
  prices: Record<string, ModelPrice>;
  key_status: string;
  /** Modèle du scanner (null : celui de l'assistant). */
  scan_model?: string | null;
  scan_daily_limit?: number;
  scan_retention_days?: number;
};

export type Action = 'chat' | 'label' | 'price' | 'scan' | 'scan_quality' | 'scan_price' | 'price_alert' | 'admin_test';

/** Modèles acceptant le paramètre « effort » (documentation Anthropic, octobre 2026). */
export function supportsEffort(model: string) {
  return /^claude-(opus|sonnet|haiku|fable|mythos)-([5-9]|[1-9]\d)/.test(model) || /^claude-opus-4-[5-9]/.test(model) || /^claude-sonnet-4-6/.test(model);
}

/** Recherche web avec filtrage dynamique (web_search_20260209) : Opus 4.6+ et Sonnet 4.6+ ; sinon version de base. */
export function webSearchTool(model: string, maxUses: number, blockedDomains?: string[]) {
  const dynamic = /^claude-(opus-(5|4-[6-9])|sonnet-(5|4-6))/.test(model);
  const userLocation = { type: 'approximate' as const, country: 'FR', timezone: 'Europe/Paris' };
  // Sites exclus (conditions d'utilisation qui n'autorisent pas la reprise de leurs données).
  const blocked = blockedDomains?.length ? { blocked_domains: blockedDomains } : {};
  return dynamic
    ? { type: 'web_search_20260209' as const, name: 'web_search' as const, max_uses: maxUses, user_location: userLocation, ...blocked }
    : { type: 'web_search_20250305' as const, name: 'web_search' as const, max_uses: maxUses, user_location: userLocation, ...blocked };
}

/** Adresse officielle de l'API, seule utilisée en ligne. */
export const ANTHROPIC_API_URL = 'https://api.anthropic.com';

export function makeClient(env: ApiEnv, fetchImpl?: typeof fetch) {
  return new Anthropic({
    apiKey: env.anthropicKey,
    // Toujours explicite : sans elle, la bibliothèque lirait ANTHROPIC_BASE_URL dans l'environnement du serveur.
    baseURL: env.anthropicBaseUrl ?? ANTHROPIC_API_URL,
    // Aucune nouvelle tentative automatique : un appel relancé pourrait être facturé deux fois pour une seule enveloppe.
    maxRetries: 0,
    timeout: 90_000,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

/** Détail d'une erreur de l'API pour le journal : statut, type et message du service (jamais la requête envoyée). */
function apiDetail(e: InstanceType<typeof Anthropic.APIError>) {
  const body = (e.error ?? {}) as { error?: { type?: unknown; message?: unknown } };
  const parts = [`Erreur ${e.status ?? '?'}`, body.error?.type, body.error?.message].filter((p): p is string | number => typeof p === 'string' || typeof p === 'number');
  return sanitize(parts.join(' : '));
}

/** Erreur de l'API Anthropic → code applicatif (sans jamais recopier de secret). */
export function mapAnthropicError(e: unknown): AiFailure {
  if (e instanceof AiFailure) return e;
  if (e instanceof Anthropic.AuthenticationError) return new AiFailure('invalid_key', 'Clé API refusée (401)');
  if (e instanceof Anthropic.PermissionDeniedError) return new AiFailure('invalid_key', apiDetail(e));
  if (e instanceof Anthropic.NotFoundError) return new AiFailure('model_not_found', apiDetail(e));
  if (e instanceof Anthropic.RateLimitError) return new AiFailure('upstream_rate_limited', 'Limite de débit Anthropic (429)');
  if (e instanceof Anthropic.BadRequestError) {
    if (/web.search/i.test(e.message)) return new AiFailure('web_search_unavailable', apiDetail(e));
    return new AiFailure('bad_request', apiDetail(e));
  }
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new AiFailure('service_unavailable', 'Délai dépassé');
  if (e instanceof Anthropic.APIConnectionError) return new AiFailure('service_unavailable', 'Connexion impossible');
  if (e instanceof Anthropic.APIError) {
    if ((e.status ?? 0) >= 500) return new AiFailure('service_unavailable', `Erreur ${e.status} du service`);
    return new AiFailure('bad_request', apiDetail(e));
  }
  return new AiFailure('internal', sanitize((e as Error)?.message ?? e));
}

type CallOptions = { images?: number; webSearches?: number };

/**
 * Compteur d'une demande : une ligne ai_usage, une réservation par appel.
 * `start` réserve l'enveloppe du premier appel ; chaque appel suivant en réserve une nouvelle.
 */
export class Meter {
  private svc: SupabaseClient;
  private client: Anthropic;
  readonly settings: AiSettings;
  readonly price: ModelPrice;
  readonly userId: string | null;
  readonly action: Action;
  usageId: string | null = null;
  calls = 0;
  searches = 0;
  private prepaid = 0;
  /** Un règlement n'a pas pu être enregistré : l'enveloppe sera comptée comme dépensée. */
  private unsettled = false;
  /** Heure limite de la demande (les fonctions serveur sont interrompues au-delà d'un temps maximal). */
  private deadline: number;

  constructor(svc: SupabaseClient, client: Anthropic, settings: AiSettings, userId: string | null, action: Action, deadline = Date.now() + 140_000) {
    this.deadline = deadline;
    this.svc = svc;
    this.client = client;
    this.settings = settings;
    this.userId = userId;
    this.action = action;
    const price = priceFor(settings.prices, settings.model);
    if (!price) throw new AiFailure('price_unknown', `Tarif absent pour ${settings.model}`);
    this.price = price;
  }

  bound(params: Anthropic.Messages.MessageCreateParamsNonStreaming, o: CallOptions = {}) {
    return callBound({
      price: this.price,
      inputChars: requestChars(params),
      images: o.images ?? 0,
      maxOutputTokens: params.max_tokens,
      webSearches: o.webSearches ?? 0,
      webSearchTokenAllowance: this.settings.web_search_token_allowance,
      webSearchPricePer1000: this.settings.web_search_price_per_1000,
    });
  }

  /** Enveloppe prévisionnelle du premier appel (avant d'avoir construit la requête exacte). */
  estimate(o: { chars: number; images?: number; webSearches?: number; maxTokens?: number }) {
    return callBound({
      price: this.price,
      inputChars: o.chars,
      images: o.images ?? 0,
      maxOutputTokens: o.maxTokens ?? this.settings.max_output_tokens,
      webSearches: o.webSearches ?? 0,
      webSearchTokenAllowance: this.settings.web_search_token_allowance,
      webSearchPricePer1000: this.settings.web_search_price_per_1000,
    });
  }

  /** Ouvre la demande (contrôles de quotas et de budget) en réservant l'enveloppe du premier appel. */
  async start(firstBound: number) {
    const { data, error } = await this.svc.rpc('ai_begin', { p_user: this.userId, p_action: this.action, p_model: this.settings.model, p_amount: firstBound });
    if (error) throw new AiFailure('internal', sanitize(error.message));
    const res = data as { ok: boolean; code?: string; usage_id?: string };
    if (!res.ok) throw new AiFailure(res.code ?? 'internal');
    this.usageId = res.usage_id!;
    this.prepaid = firstBound;
  }

  private async reserve(amount: number) {
    if (this.prepaid > 0) {
      const extra = amount - this.prepaid;
      this.prepaid = 0;
      if (extra <= 0) return;
      return this.reserveMore(extra);
    }
    return this.reserveMore(amount);
  }

  private async reserveMore(amount: number) {
    const { data, error } = await this.svc.rpc('ai_reserve_more', { p_usage: this.usageId, p_amount: amount });
    if (error) throw new AiFailure('internal', sanitize(error.message));
    const res = data as { ok: boolean; code?: string };
    if (!res.ok) throw new AiFailure(res.code ?? 'internal');
  }

  /** Un appel à l'API Messages, encadré par sa réservation. */
  async call(params: Anthropic.Messages.MessageCreateParamsNonStreaming, o: CallOptions = {}): Promise<Anthropic.Messages.Message> {
    if (!this.usageId) throw new AiFailure('internal', 'Demande non ouverte');
    if (this.calls >= this.settings.max_api_calls) throw new AiFailure('call_limit');
    const remaining = this.deadline - Date.now();
    if (remaining < 25_000) throw new AiFailure('call_limit', 'Temps maximal de la demande bientôt atteint');
    const bound = this.bound(params, o);
    await this.reserve(bound);
    this.calls += 1;
    let message: Anthropic.Messages.Message;
    try {
      message = await this.client.messages.create(params, { timeout: Math.min(90_000, remaining - 5_000) });
    } catch (e) {
      // Délai dépassé : la requête a pu être traitée et facturée, on compte prudemment toute l'enveloppe.
      const timedOut = e instanceof Anthropic.APIConnectionTimeoutError;
      await this.settle(timedOut ? bound : 0, bound, null);
      throw mapAnthropicError(e);
    }
    const cost = actualCost(this.price, message.usage, this.settings.web_search_price_per_1000);
    await this.settle(cost, bound, message.usage);
    this.searches += message.usage.server_tool_use?.web_search_requests ?? 0;
    return message;
  }

  private async settle(cost: number, release: number, usage: Anthropic.Messages.Usage | null) {
    const { error } = await this.svc.rpc('ai_settle', {
      p_usage: this.usageId,
      p_cost: cost,
      p_release: release,
      p_input: usage?.input_tokens ?? 0,
      p_output: usage?.output_tokens ?? 0,
      p_cache_read: usage?.cache_read_input_tokens ?? 0,
      p_cache_write: usage?.cache_creation_input_tokens ?? 0,
      p_searches: usage?.server_tool_use?.web_search_requests ?? 0,
    });
    if (error) this.unsettled = true;
  }

  async finish(ok: boolean, error?: string) {
    if (!this.usageId) return;
    await this.svc.rpc('ai_finish', { p_usage: this.usageId, p_status: ok ? 'done' : 'failed', p_error: error ?? null, p_keep: this.unsettled });
    this.usageId = null;
  }
}

/** Paramètres communs : modèle, longueur maximale, effort (si le modèle l'accepte). */
export function baseParams(settings: AiSettings, maxTokens = settings.max_output_tokens) {
  return {
    model: settings.model,
    max_tokens: maxTokens,
    ...(supportsEffort(settings.model) ? { output_config: { effort: settings.effort } } : {}),
  };
}

export function textOf(message: Anthropic.Messages.Message) {
  return message.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

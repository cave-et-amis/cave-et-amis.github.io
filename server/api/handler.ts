/**
 * Fonction serveur « cave-api » (Supabase Edge Function). Seul endroit où la clé Anthropic est lue.
 *
 * Toutes les actions exigent une session valide. Les données sont lues avec les droits de la personne
 * connectée ; la clé « service » ne sert qu'à la comptabilité (quotas, budget, erreurs) et à l'enregistrement
 * des conversations et des relevés de prix de cette même personne.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AI_MESSAGES } from '../../src/domain/errors.ts';
import { runChat, type ChatInput } from './chat.ts';
import { makeClient, mapAnthropicError, Meter, type Action, type AiSettings, baseParams, textOf } from './claude.ts';
import { identifyLabel, readPhoto } from './label.ts';
import { lookupPrice } from './price.ts';
import { AiFailure, corsHeaders, isUuid, json, sanitize, type ApiEnv } from './util.ts';
import type { Wine } from '../../src/domain/types.ts';

export type ApiDeps = {
  /** Transport des clients Supabase (tests et serveur local). */
  fetch?: typeof fetch;
  /** Transport du client Anthropic (tests). */
  anthropicFetch?: typeof fetch;
  now?: () => Date;
};

const TECHNICAL = new Set(['invalid_key', 'service_unavailable', 'upstream_rate_limited', 'bad_request', 'internal', 'model_not_found', 'price_unknown', 'web_search_unavailable']);

export function createApiHandler(env: ApiEnv, deps: ApiDeps = {}) {
  const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, ...(deps.fetch ? { global: { fetch: deps.fetch } } : {}) };
  const svc = createClient(env.supabaseUrl, env.serviceKey, opts);
  const userClient = (token: string) =>
    createClient(env.supabaseUrl, env.publishableKey, {
      ...opts,
      global: { ...(deps.fetch ? { fetch: deps.fetch } : {}), headers: { Authorization: `Bearer ${token}` } },
    });
  const now = deps.now ?? (() => new Date());

  async function settings(): Promise<AiSettings> {
    const { data, error } = await svc.rpc('ai_config');
    if (error || !data) throw new AiFailure('internal', sanitize(error?.message ?? 'Réglages introuvables'));
    return data as AiSettings;
  }

  async function logError(userId: string | null, action: string, f: AiFailure, model?: string) {
    if (!TECHNICAL.has(f.code)) return;
    await svc.rpc('ai_log_error', { p_user: userId, p_action: action, p_code: f.code, p_detail: sanitize(f.detail ?? '', 500), p_model: model ?? null });
    if (f.code === 'invalid_key') await svc.rpc('ai_set_key_status', { p_status: 'invalid', p_models: null });
  }

  /** Prépare un compteur (contrôles : clé présente, assistant activé, tarif connu). */
  async function prepare(userId: string | null, action: Action) {
    const s = await settings();
    if (!env.anthropicKey) {
      if (s.key_status !== 'missing') await svc.rpc('ai_set_key_status', { p_status: 'missing', p_models: null });
      throw new AiFailure('ai_not_configured');
    }
    if (!s.enabled && action !== 'admin_test') throw new AiFailure('ai_disabled');
    const client = makeClient(env, deps.anthropicFetch);
    return { s, client, meter: new Meter(svc, client, s, userId, action, Date.now() + (env.deadlineMs ?? 140_000)) };
  }

  /** `estimate` null : le travail ouvre lui-même la demande (meter.start) une fois la première requête construite. */
  async function metered<T>(userId: string, action: Action, estimate: ((m: Meter) => number) | null, work: (m: Meter, s: AiSettings) => Promise<T>) {
    const { s, meter } = await prepare(userId, action);
    try {
      if (estimate) await meter.start(estimate(meter));
      const result = await work(meter, s);
      await meter.finish(true);
      if (s.key_status !== 'ok') await svc.rpc('ai_set_key_status', { p_status: 'ok', p_models: null });
      return result;
    } catch (e) {
      const f = mapAnthropicError(e);
      await meter.finish(false, f.code).catch(() => undefined);
      await logError(userId, action, f, s.model).catch(() => undefined);
      throw f;
    }
  }

  async function profileCurrency(user: SupabaseClient, userId: string) {
    const { data } = await user.from('profiles').select('currency').eq('id', userId).maybeSingle();
    return (data as { currency?: string } | null)?.currency ?? 'EUR';
  }

  async function handle(action: string, body: Record<string, unknown>, user: SupabaseClient, userId: string): Promise<Record<string, unknown>> {
    switch (action) {
      case 'status': {
        const { data, error } = await user.rpc('my_ai_status');
        if (error) throw new AiFailure('internal', sanitize(error.message));
        return { configured: Boolean(env.anthropicKey), status: data };
      }

      case 'chat': {
        const s = await settings();
        const message = String(body.message ?? '').trim();
        if (!message) throw new AiFailure('invalid');
        if (message.length > s.max_input_chars) throw new AiFailure('message_too_long');
        const currency = await profileCurrency(user, userId);
        const res = await metered(userId, 'chat', null, (meter) => runChat({ input: body as unknown as ChatInput, user, svc, meter, userId, currency, now: now() }));
        return res;
      }

      case 'identify_label': {
        const s = await settings();
        const image = await readPhoto(user, userId, body.photo_path, s.max_image_bytes);
        const result = await metered(
          userId,
          'label',
          (m) => m.estimate({ chars: 6_000, images: 1, maxTokens: Math.min(s.max_output_tokens * 2, 6000) }),
          (meter) => identifyLabel({ meter, image }),
        );
        return { result };
      }

      case 'price_lookup': {
        if (!isUuid(body.wine_id)) throw new AiFailure('invalid');
        const { data: wine } = await user.from('wines').select('*').eq('id', body.wine_id).maybeSingle();
        if (!wine) throw new AiFailure('not_found');
        const volume = Number.isInteger(body.volume_ml) && Number(body.volume_ml) >= 50 && Number(body.volume_ml) <= 30000 ? Number(body.volume_ml) : 750;
        const currency = await profileCurrency(user, userId);
        const s = await settings();
        const result = await metered(
          userId,
          'price',
          (m) => m.estimate({ chars: 6_000, webSearches: s.web_search_enabled ? s.max_web_searches : 0, maxTokens: Math.min(s.max_output_tokens, 4000) }),
          (meter) => lookupPrice({ svc, meter, userId, currency }, wine as Wine, volume),
        );
        return { result };
      }

      case 'admin_test':
        return adminTest(user, userId);

      case 'delete_account': {
        if (body.confirm !== 'SUPPRIMER') throw new AiFailure('invalid');
        // 1. Libère les réservations et supprime lots, vins et caves (sinon la cascade bute sur « cave non vide »).
        const { error } = await user.rpc('prepare_account_deletion');
        if (error) throw new AiFailure('internal', sanitize(error.message));
        // 2. Supprime le compte (profil, carnet, conversations… en cascade).
        const del = await svc.auth.admin.deleteUser(userId);
        if (del.error) throw new AiFailure('internal', sanitize(del.error.message));
        // 3. Seulement ensuite : toutes les photos du dossier de la personne, même celles qui ne sont plus reliées à rien.
        for (let i = 0; i < 20; i++) {
          const { data: files } = await svc.storage.from('photos').list(userId, { limit: 1000 });
          const names = (files ?? []).map((f) => `${userId}/${f.name}`);
          if (!names.length) break;
          await svc.storage.from('photos').remove(names);
          if (names.length < 1000) break;
        }
        return { deleted: true };
      }

      default:
        throw new AiFailure('invalid');
    }
  }

  async function adminTest(user: SupabaseClient, userId: string) {
    const { data: isAdmin } = await user.rpc('is_admin');
    if (isAdmin !== true) throw new AiFailure('forbidden');
    if (!env.anthropicKey) {
      await svc.rpc('ai_set_key_status', { p_status: 'missing', p_models: null });
      return { key_present: false, key_status: 'missing' };
    }
    const { s, client } = await prepare(userId, 'admin_test');
    let models: { id: string; display_name: string }[] = [];
    try {
      const page = await client.models.list({ limit: 100 });
      models = page.data.map((m) => ({ id: m.id, display_name: m.display_name }));
      await svc.rpc('ai_set_key_status', { p_status: 'ok', p_models: models });
    } catch (e) {
      const f = mapAnthropicError(e);
      await logError(userId, 'admin_test', f, s.model).catch(() => undefined);
      return { key_present: true, key_status: f.code === 'invalid_key' ? 'invalid' : 'unknown', error: AI_MESSAGES[f.code] ?? f.code, error_code: f.code };
    }
    const started = Date.now();
    try {
      const test = await metered(
        userId,
        'admin_test',
        (m) => m.estimate({ chars: 200, maxTokens: 400 }),
        async (meter) => {
          const res = await meter.call({ ...baseParams(s, 400), messages: [{ role: 'user', content: 'Test de connexion : réponds seulement « OK ».' }] });
          return { model: res.model, stop_reason: res.stop_reason, text: textOf(res).slice(0, 40), input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens };
        },
      );
      return { key_present: true, key_status: 'ok', models, test: { ok: true, latency_ms: Date.now() - started, ...test } };
    } catch (e) {
      const f = e instanceof AiFailure ? e : mapAnthropicError(e);
      return { key_present: true, key_status: f.code === 'invalid_key' ? 'invalid' : 'ok', models, test: { ok: false, error: AI_MESSAGES[f.code] ?? f.code, error_code: f.code } };
    }
  }

  return async function serve(req: Request): Promise<Response> {
    const cors = corsHeaders(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ ok: false, code: 'invalid', message: 'Méthode non autorisée' }, 405, cors);

    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token || token === env.publishableKey || token === env.serviceKey) {
      return json({ ok: false, code: 'not_authenticated', message: AI_MESSAGES.not_authenticated }, 401, cors);
    }
    const { data: auth, error: authErr } = await svc.auth.getUser(token);
    if (authErr || !auth?.user) return json({ ok: false, code: 'not_authenticated', message: AI_MESSAGES.not_authenticated }, 401, cors);
    const userId = auth.user.id;

    let body: Record<string, unknown>;
    try {
      const text = await req.text();
      if (text.length > 200_000) return json({ ok: false, code: 'message_too_long', message: AI_MESSAGES.message_too_long }, 413, cors);
      body = JSON.parse(text || '{}') as Record<string, unknown>;
    } catch {
      return json({ ok: false, code: 'invalid', message: AI_MESSAGES.invalid }, 400, cors);
    }
    const action = String(body.action ?? '');
    try {
      const result = await handle(action, body, userClient(token), userId);
      return json({ ok: true, ...result }, 200, cors);
    } catch (e) {
      const f = e instanceof AiFailure ? e : mapAnthropicError(e);
      if (!(e instanceof AiFailure)) await logError(userId, action, f).catch(() => undefined);
      return json({ ok: false, code: f.code, message: AI_MESSAGES[f.code] ?? AI_MESSAGES.internal }, 200, cors);
    }
  };
}

/**
 * Fonction serveur « cave-api » (Supabase Edge Function). Seul endroit où la clé Anthropic est lue.
 *
 * Toutes les actions exigent une session valide. Les données sont lues avec les droits de la personne
 * connectée ; la clé « service » ne sert qu'à la comptabilité (quotas, budget, erreurs) et à l'enregistrement
 * des conversations et des relevés de prix de cette même personne.
 * Exceptions, sans session : les requêtes signées du serveur Nous et la tâche planifiée d'envoi vers Nous (nous.ts).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AI_MESSAGES } from '../../src/domain/errors.ts';
import { runChat, type ChatInput } from './chat.ts';
import { makeClient, mapAnthropicError, Meter, type Action, type AiSettings, baseParams, textOf } from './claude.ts';
import { identifyLabel, readPhoto } from './label.ts';
import { importPhoto, offProduct, searchPhotos } from './photos.ts';
import { createNous, ECO_MAX_BODY, ecoVerify, NOUS_ACTIONS } from './nous.ts';
import { createPush } from './push.ts';

import { lookupPrice } from './price.ts';
import { IDENTIFY_CACHE_DAYS, identifyScan, initialWine, parsePhotos, purgeExpired, type ScanResult } from './scan.ts';
import { normalizeBarcode } from '../../src/domain/barcode.ts';
import { wineKey } from '../../src/domain/scan.ts';
import type { ScanAssessment, ScanMarket, ScanWine } from '../../src/domain/types.ts';
import { ASSESS_CACHE_DAYS, assessWine, emptyAssessment, emptyMarket, PRICE_CACHE_HOURS, searchMarket } from './scanAssess.ts';
import { AiFailure, corsHeaders, isUuid, json, sanitize, type ApiEnv } from './util.ts';
import type { Wine } from '../../src/domain/types.ts';

export type ApiDeps = {
  /** Transport des clients Supabase (tests et serveur local). */
  fetch?: typeof fetch;
  /** Transport du client Anthropic (tests). */
  anthropicFetch?: typeof fetch;
  /** Transport vers Open Food Facts (tests). */
  webFetch?: typeof fetch;
  /** Transport vers la fonction « cave-sync » de Nous (tests). */
  nousFetch?: typeof fetch;
  /** Transport vers les services de notifications push (tests). */
  pushFetch?: typeof fetch;
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
  const webFetch = deps.webFetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const nous = createNous(env, svc, deps.nousFetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)), now);
  const push = createPush({
    svc,
    fetch: deps.pushFetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)),
    subject: env.caveAppUrl ?? 'https://cave-et-amis.github.io',
    testOrigin: env.pushTestOrigin,
    now,
  });

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

  /** Prépare un compteur (contrôles : clé présente, assistant activé, tarif connu). `model` : autre modèle que celui de l'assistant. */
  async function prepare(userId: string | null, action: Action, model?: string | null) {
    const base = await settings();
    const s = model ? { ...base, model } : base;
    if (!env.anthropicKey) {
      if (s.key_status !== 'missing') await svc.rpc('ai_set_key_status', { p_status: 'missing', p_models: null });
      throw new AiFailure('ai_not_configured');
    }
    if (!s.enabled && action !== 'admin_test') throw new AiFailure('ai_disabled');
    const client = makeClient(env, deps.anthropicFetch);
    return { s, client, meter: new Meter(svc, client, s, userId, action, Date.now() + (env.deadlineMs ?? 140_000)) };
  }

  /** `estimate` null : le travail ouvre lui-même la demande (meter.start) une fois la première requête construite. */
  async function metered<T>(
    userId: string,
    action: Action,
    estimate: ((m: Meter) => number) | null,
    work: (m: Meter, s: AiSettings) => Promise<T>,
    model?: string | null,
  ) {
    const { s, meter } = await prepare(userId, action, model);
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
    if (NOUS_ACTIONS.has(action)) return nous.handleUser(action, body, user, userId);
    switch (action) {
      // Notifications push : clé publique du serveur, abonnement de cet appareil, notification d'essai.
      case 'push_key':
        return { public_key: (await push.keys()).publicKey };
      case 'push_subscribe':
        return push.subscribe(userId, body);
      case 'push_test':
        return push.test(userId);
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
        // Étiquette, et éventuellement contre-étiquette (2 photos au plus, toutes dans le dossier de la personne).
        const paths = Array.isArray(body.photo_paths) ? body.photo_paths : [body.photo_path];
        if (paths.length < 1 || paths.length > 2) throw new AiFailure('invalid');
        const s = await settings();
        const images: Awaited<ReturnType<typeof readPhoto>>[] = [];
        for (const p of paths) images.push(await readPhoto(user, userId, p, s.max_image_bytes));
        const result = await metered(
          userId,
          'label',
          (m) => m.estimate({ chars: 6_000, images: images.length, maxTokens: Math.min(s.max_output_tokens * 2, 6000) }),
          (meter) => identifyLabel({ meter, images }),
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

      case 'scan_identify': {
        // Scanner avant d'acheter : 1 à 3 photos (étiquette, contre-étiquette, prix du rayon), toutes dans le dossier de la personne.
        const photos = parsePhotos(body.photos);
        const typed = normalizeBarcode(body.barcode);
        // Lot 3d : l'analyse peut rejoindre une visite en magasin de la personne (lue avec ses droits).
        let visitId: string | null = null;
        if (body.visit_id !== undefined && body.visit_id !== null) {
          if (!isUuid(body.visit_id)) throw new AiFailure('invalid');
          const { data: visit } = await user.from('scan_visits').select('id').eq('id', body.visit_id).maybeSingle();
          if (!visit) throw new AiFailure('not_found');
          visitId = body.visit_id;
        }
        const s = await settings();
        await purgeExpired(svc, userId, now()).catch(() => undefined);
        const images: (Awaited<ReturnType<typeof readPhoto>> & { role: (typeof photos)[number]['role'] })[] = [];
        for (const p of photos) images.push({ ...(await readPhoto(user, userId, p.path, s.max_image_bytes)), role: p.role });
        // Mêmes photos (octet pour octet) et même code-barres : la lecture déjà faite est reprise, sans appel à l'IA.
        const key = `identify:v1:${images.map((i) => `${i.role}=${i.sha256}`).join('|')}${typed ? `:${typed}` : ''}`;
        const { data: cached } = await svc.from('scan_cache').select('value').eq('key', key).gt('expires_at', now().toISOString()).maybeSingle();
        let result = (cached as { value: ScanResult } | null)?.value ?? null;
        const fromCache = Boolean(result);
        if (!result) {
          const { data: quota } = await svc.rpc('scan_quota', { p_user: userId });
          const q = quota as { used: number; limit: number } | null;
          if (q && q.used >= q.limit) throw new AiFailure('scan_quota');
          // Indice facultatif : le produit Open Food Facts du code-barres (sans coût ; ignoré s'il ne répond pas).
          const off = typed ? await offProduct(webFetch, typed).catch(() => null) : null;
          const hint = off ? sanitize(`code-barres ${typed} — produit « ${off.product_name ?? ''} »${off.brands ? `, marque « ${Array.isArray(off.brands) ? off.brands.join(', ') : off.brands} »` : ''}`, 300) : null;
          const maxTokens = Math.min(s.max_output_tokens * 2, 6000);
          result = await metered(
            userId,
            'scan',
            (m) => m.estimate({ chars: 8_000, images: images.length, maxTokens }),
            (meter) => identifyScan({ meter, images, hint }),
            s.scan_model,
          );
          const expires = new Date(now().getTime() + IDENTIFY_CACHE_DAYS * 86_400_000).toISOString();
          await svc.from('scan_cache').upsert({ key, kind: 'identify', value: result, expires_at: expires }, { onConflict: 'key' });
        }
        const read = normalizeBarcode(result.fields.barcode);
        const { data: scan, error } = await svc
          .from('scans')
          .insert({
            user_id: userId,
            photos,
            barcode: typed ?? read,
            result,
            wine: initialWine(result),
            // Prix lu sur l'étiquette du rayon : proposé, jamais utilisé avant la confirmation de la personne.
            store_price: result.price_tag.price,
            currency: result.price_tag.currency,
            from_cache: fromCache,
            visit_id: visitId,
          })
          .select('*')
          .single();
        if (error) throw new AiFailure('internal', sanitize(error.message));
        return { scan };
      }

      case 'scan_quality':
      case 'scan_price': {
        // Lot 3b : analyse du vin, puis offres du marché, pour une analyse vérifiée par la personne (lue avec ses droits).
        if (!isUuid(body.scan_id)) throw new AiFailure('invalid');
        const { data: row } = await user.from('scans').select('id, status, wine, currency').eq('id', body.scan_id).maybeSingle();
        if (!row) throw new AiFailure('not_found');
        const scan = row as { id: string; status: string; wine: ScanWine; currency: string };
        if (scan.status !== 'confirmed' || !scan.wine?.name) throw new AiFailure('scan_unconfirmed');
        const s = await settings();
        const t = now();
        const key = wineKey(scan.wine);
        const searchOff = !s.web_search_enabled || s.max_web_searches <= 0;
        const estimate = (m: Meter) => m.estimate({ chars: 8_000, webSearches: s.max_web_searches, maxTokens: Math.min(s.max_output_tokens * 2, 6000) });
        // Cache du serveur : l'analyse d'un vin vaut 90 jours, un relevé de prix 72 heures (même vin, même devise).
        const cacheKey = action === 'scan_quality' ? `assess:v1:${key}` : `price:v1:${key}:${scan.currency}`;
        const { data: cached } = await svc.from('scan_cache').select('value').eq('key', cacheKey).gt('expires_at', t.toISOString()).maybeSingle();
        const hit = (cached as { value: ScanAssessment | ScanMarket } | null)?.value ?? null;
        const remember = async (value: ScanAssessment | ScanMarket, ms: number) => {
          await svc
            .from('scan_cache')
            .upsert({ key: cacheKey, kind: action === 'scan_quality' ? 'assess' : 'price', value, expires_at: new Date(t.getTime() + ms).toISOString() }, { onConflict: 'key' });
        };
        if (action === 'scan_quality') {
          let assessment = hit as ScanAssessment | null;
          if (!assessment) {
            if (searchOff) assessment = emptyAssessment(key, 'La recherche web est désactivée par l’administrateur : le vin ne peut pas être analysé avec des sources.', t);
            else {
              assessment = await metered(userId, 'scan_quality', estimate, (meter) => assessWine(meter, scan.wine, key, t), s.scan_model);
              if (!assessment.reason) await remember(assessment, ASSESS_CACHE_DAYS * 86_400_000);
            }
          }
          const { error } = await svc.from('scans').update({ assessment, assessed_at: t.toISOString() }).eq('id', scan.id).eq('user_id', userId);
          if (error) throw new AiFailure('internal', sanitize(error.message));
          return { assessment, from_cache: Boolean(hit) };
        }
        let market = hit as ScanMarket | null;
        if (!market) {
          if (searchOff) market = emptyMarket(key, 'La recherche web est désactivée par l’administrateur : le prix de marché ne peut pas être vérifié.', t);
          else if (!scan.wine.vintage && !scan.wine.non_vintage) market = emptyMarket(key, 'Millésime inconnu : indiquez-le (ou « sans millésime ») pour comparer le prix exact.', t);
          else {
            market = await metered(userId, 'scan_price', estimate, (meter) => searchMarket(meter, scan.wine, scan.currency, key, t), s.scan_model);
            if (market.status === 'verified') await remember(market, PRICE_CACHE_HOURS * 3_600_000);
          }
        }
        const { error } = await svc.from('scans').update({ market, market_checked_at: market.checked_at }).eq('id', scan.id).eq('user_id', userId);
        if (error) throw new AiFailure('internal', sanitize(error.message));
        return { market, from_cache: Boolean(hit) };
      }

      // Photo officielle (Open Food Facts) : sans IA, sans coût.
      case 'photo_search':
        return { candidates: await searchPhotos(webFetch, body) };

      case 'photo_import':
        return importPhoto(webFetch, user, userId, body.code);

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

  /** Requêtes sans session : venues du serveur Nous (signées) ou de la tâche planifiée (jeton du cron). */
  async function serveMachine(req: Request, cors: Record<string, string>): Promise<Response> {
    const text = await req.text();
    if (text.length > ECO_MAX_BODY) return json({ ok: false, code: 'invalid' }, 413, cors);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text || '{}') as Record<string, unknown>;
    } catch {
      return json({ ok: false, code: 'invalid' }, 400, cors);
    }
    const cron = req.headers.get('x-cron-token');
    if (cron !== null) {
      if (!(await nous.cronTokenOk(cron))) return json({ ok: false, code: 'forbidden' }, 403, cors);
      if (body.action === 'nous_flush') return json({ ok: true, ...(await nous.flush(100)) }, 200, cors);
      if (body.action === 'push_flush') return json({ ok: true, ...(await push.flush(100)) }, 200, cors);
      return json({ ok: false, code: 'forbidden' }, 403, cors);
    }
    if (!env.ecosystemSecret) return json({ ok: false, code: 'integration_disabled' }, 503, cors);
    if (!(await ecoVerify(env.ecosystemSecret, text, req.headers.get('x-eco-timestamp'), req.headers.get('x-eco-signature'), now().getTime()))) {
      return json({ ok: false, code: 'bad_signature' }, 401, cors);
    }
    try {
      return json({ ok: true, ...(await nous.handleSigned(body)) }, 200, cors);
    } catch (e) {
      const f = e instanceof AiFailure ? e : new AiFailure('internal', (e as Error).message);
      return json({ ok: false, code: f.code }, 200, cors);
    }
  }

  return async function serve(req: Request): Promise<Response> {
    const cors = corsHeaders(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ ok: false, code: 'invalid', message: 'Méthode non autorisée' }, 405, cors);
    if (req.headers.has('x-eco-signature') || req.headers.has('x-cron-token')) return serveMachine(req, cors);

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

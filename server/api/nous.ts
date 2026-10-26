/**
 * Intégration avec l'agenda Nous (Cocon) : liaison des comptes, envoi des événements, réponses venues de Nous,
 * connexion directe d'une application à l'autre. Contrat : docs/INTEGRATION-NOUS.md.
 *
 * Les échanges serveur à serveur sont signés (HMAC-SHA256, secret ECOSYSTEM_SECRET commun aux deux projets, jamais dans
 * le navigateur) et une signature ne sert qu'une fois (anti-rejeu). Sans ce secret ou sans l'adresse de Nous,
 * l'intégration est simplement désactivée.
 * La connexion directe depuis Nous (jump.token) n'est accordée que si la personne l'a activée, jamais à un administrateur.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AiFailure, isUuid, rateOk, sanitize, type ApiEnv } from './util.ts';

/** Écart maximal accepté entre l'horodatage d'une requête signée et l'heure du serveur. */
export const ECO_WINDOW_MS = 5 * 60_000;
export const ECO_MAX_BODY = 64_000;
const enc = new TextEncoder();

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

/** Comparaison à temps constant (même longueur attendue : 64 caractères hexadécimaux). */
function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** En-têtes d'une requête signée vers l'autre application. */
export async function ecoSign(secret: string, body: string, now = Date.now()) {
  const timestamp = String(now);
  return { 'x-eco-timestamp': timestamp, 'x-eco-signature': await hmacHex(secret, `${timestamp}.${body}`) };
}

/** Vérifie la signature et la fraîcheur d'une requête venue de l'autre application. */
export async function ecoVerify(secret: string, body: string, timestamp: string | null, signature: string | null, now = Date.now()) {
  if (!secret || !timestamp || !signature || !/^\d{10,16}$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(signature)) return false;
  if (Math.abs(now - Number(timestamp)) > ECO_WINDOW_MS) return false;
  return sameText(await hmacHex(secret, `${timestamp}.${body}`), signature);
}

/** Message d'une exception SQL levée par une fonction (« raise exception 'code' »), sinon null. */
function sqlCode(error: { message?: string } | null) {
  const m = error?.message ?? '';
  return /^[a-z_]{3,40}$/.test(m) ? m : null;
}

type OutboxRow = { id: number; op: 'upsert' | 'remove' | 'unlink'; user_id: string; nous_user_id: string; event_id: string | null; generation: number; attempts: number };

export function createNous(env: ApiEnv, svc: SupabaseClient, fetchImpl: typeof fetch, now: () => Date) {
  const enabled = () => Boolean(env.ecosystemSecret && env.nousFunctionUrl);
  const caveAppUrl = env.caveAppUrl ?? 'https://cave-et-amis.github.io/';
  const nousAppUrl = env.nousAppUrl ?? 'https://cocon-famille.netlify.app/';

  /** Requête signée vers la fonction « cave-sync » de Nous. */
  async function callNous(payload: Record<string, unknown>): Promise<Record<string, unknown> & { ok: boolean; code?: string }> {
    if (!enabled()) throw new AiFailure('integration_disabled');
    const body = JSON.stringify(payload);
    let res: Response;
    try {
      res = await fetchImpl(env.nousFunctionUrl!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await ecoSign(env.ecosystemSecret!, body, now().getTime())) },
        body,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new AiFailure('nous_unavailable', sanitize((e as Error).message));
    }
    const data = (await res.json().catch(() => null)) as (Record<string, unknown> & { ok: boolean; code?: string }) | null;
    if (!data || typeof data.ok !== 'boolean') throw new AiFailure('nous_unavailable', `HTTP ${res.status}`);
    return data;
  }

  async function linkOf(userId: string) {
    const { data } = await svc.from('nous_links').select('*').eq('user_id', userId).maybeSingle();
    return data as {
      user_id: string;
      nous_user_id: string;
      nous_display_name: string | null;
      sync_enabled: boolean;
      allow_jump?: boolean;
      linked_at: string;
    } | null;
  }

  async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await svc.rpc(fn, args);
    if (error) throw new AiFailure(sqlCode(error) ?? 'internal', sanitize(error.message));
    return data as T;
  }

  /** Lien magique à usage unique : seule l'empreinte du jeton est renvoyée (jamais de mot de passe). */
  async function loginTokenFor(userId: string) {
    const { data: u, error } = await svc.auth.admin.getUserById(userId);
    if (error || !u?.user?.email) throw new AiFailure('not_found');
    const { data, error: linkError } = await svc.auth.admin.generateLink({ type: 'magiclink', email: u.user.email });
    const hashed = (data as { properties?: { hashed_token?: string } } | null)?.properties?.hashed_token;
    if (linkError || !hashed) throw new AiFailure('internal', sanitize(linkError?.message ?? 'Lien de connexion indisponible'));
    return hashed;
  }

  // ───────────── Envoi des événements ─────────────

  async function sendRow(r: OutboxRow) {
    if (r.op === 'unlink') return callNous({ action: 'link.revoked', cave_user_id: r.user_id, nous_user_id: r.nous_user_id });
    const version = await rpc<number>('nous_version', {});
    const event = r.op === 'upsert' ? await rpc<Record<string, unknown> | null>('nous_event_payload', { p_event: r.event_id, p_user: r.user_id }) : null;
    if (!event) return callNous({ action: 'event.remove', cave_user_id: r.user_id, nous_user_id: r.nous_user_id, event_id: r.event_id, version });
    return callNous({
      action: 'event.upsert',
      cave_user_id: r.user_id,
      nous_user_id: r.nous_user_id,
      event_id: r.event_id,
      version,
      event: { ...event, url: `${caveAppUrl}#/evenements/${r.event_id}` },
    });
  }

  /** Traite les envois dus. Nous ne connaît plus la liaison : elle est retirée ici aussi (sans renvoyer d'annonce). */
  async function flush(limit = 50) {
    if (!enabled()) return { sent: 0, failed: 0, disabled: true };
    const rows = await rpc<OutboxRow[]>('nous_outbox_claim', { p_limit: limit });
    let sent = 0;
    let failed = 0;
    for (const r of rows ?? []) {
      try {
        const res = await sendRow(r);
        if (res.ok || (r.op === 'unlink' && res.code === 'not_linked')) {
          await svc.rpc('nous_outbox_done', { p_id: r.id, p_generation: r.generation, p_ok: true, p_error: null });
          sent++;
        } else if (res.code === 'not_linked') {
          await svc.rpc('nous_link_revoked', { p_user: r.user_id, p_nous_user: r.nous_user_id });
          await svc.rpc('nous_outbox_done', { p_id: r.id, p_generation: r.generation, p_ok: true, p_error: null });
        } else {
          await svc.rpc('nous_outbox_done', { p_id: r.id, p_generation: r.generation, p_ok: false, p_error: sanitize(res.code ?? 'refusé') });
          failed++;
        }
      } catch (e) {
        const f = e instanceof AiFailure ? e : new AiFailure('internal', (e as Error).message);
        await svc.rpc('nous_outbox_done', { p_id: r.id, p_generation: r.generation, p_ok: false, p_error: sanitize(`${f.code} ${f.detail ?? ''}`) });
        failed++;
      }
    }
    return { sent, failed };
  }

  /** Envoi immédiat demandé depuis l'application : nombre limité par personne ; au-delà, la tâche planifiée s'en charge. */
  async function nudge(userId: string, limit: number) {
    if (enabled() && !(await rateOk(svc, 'nous_flush', userId).catch(() => false))) return { sent: 0, failed: 0, later: true };
    return flush(limit);
  }

  // ───────────── Actions de la personne connectée ─────────────

  async function handleUser(action: string, body: Record<string, unknown>, user: SupabaseClient, userId: string): Promise<Record<string, unknown>> {
    switch (action) {
      case 'nous_status': {
        const link = await linkOf(userId);
        return {
          enabled: enabled(),
          app_url: nousAppUrl,
          link: link
            ? { nous_display_name: link.nous_display_name, sync_enabled: link.sync_enabled, allow_jump: link.allow_jump === true, linked_at: link.linked_at }
            : null,
        };
      }
      case 'nous_link_start': {
        if (!enabled()) throw new AiFailure('integration_disabled');
        const { data, error } = await user.rpc('nous_link_create');
        if (error) throw new AiFailure(sqlCode(error) ?? 'internal', sanitize(error.message));
        return { url: `${nousAppUrl}?cave_link=${encodeURIComponent(String(data))}` };
      }
      case 'nous_unlink': {
        const { error } = await user.rpc('nous_unlink');
        if (error) throw new AiFailure(sqlCode(error) ?? 'internal', sanitize(error.message));
        // Nous est prévenu tout de suite (sinon par la tâche planifiée).
        await nudge(userId, 20).catch(() => undefined);
        return { unlinked: true };
      }
      case 'nous_set_sync': {
        const { error } = await user.rpc('nous_set_sync', { p_enabled: body.enabled === true });
        if (error) throw new AiFailure(sqlCode(error) ?? 'internal', sanitize(error.message));
        await nudge(userId, 50).catch(() => undefined);
        return { sync_enabled: body.enabled === true };
      }
      // « Ouvrir Cave & Amis depuis Nous sans mot de passe » (refusé à un administrateur par la base).
      case 'nous_set_jump': {
        const { data, error } = await user.rpc('nous_set_allow_jump', { p_enabled: body.enabled === true });
        if (error) throw new AiFailure(sqlCode(error) ?? 'internal', sanitize(error.message));
        return { allow_jump: data === true };
      }
      // Appelé par l'application juste après une modification d'événement : l'agenda Nous est à jour sans attendre le cron.
      case 'nous_flush':
        return nudge(userId, 20);
      case 'nous_jump': {
        const link = await linkOf(userId);
        if (!link) throw new AiFailure('not_linked');
        const res = await callNous({ action: 'jump.token', cave_user_id: userId, nous_user_id: link.nous_user_id });
        if (!res.ok || typeof res.token_hash !== 'string') throw new AiFailure(res.code === 'not_linked' ? 'not_linked' : 'nous_unavailable');
        const next = typeof body.next === 'string' && /^[#/?][\w\-/#?=&%.]{0,200}$/.test(body.next) ? body.next : '';
        const q = new URLSearchParams({ auth: 'link', token_hash: res.token_hash });
        if (next) q.set('next', next);
        return { url: `${nousAppUrl}?${q.toString()}` };
      }
      default:
        throw new AiFailure('invalid');
    }
  }

  // ───────────── Requêtes signées venues de Nous ─────────────

  async function handleSigned(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const action = String(body.action ?? '');
    const pair = () => {
      if (!isUuid(body.cave_user_id) || !isUuid(body.nous_user_id)) throw new AiFailure('invalid');
      return { p_user: body.cave_user_id, p_nous_user: body.nous_user_id };
    };
    const code = () => {
      if (typeof body.code !== 'string' || !/^[A-Za-z0-9]{32}$/.test(body.code)) throw new AiFailure('invalid_code');
      return body.code;
    };
    switch (action) {
      case 'link.peek':
        return rpc<Record<string, unknown>>('nous_link_peek', { p_code: code() });
      case 'link.redeem': {
        if (!isUuid(body.nous_user_id)) throw new AiFailure('invalid');
        const name = typeof body.nous_display_name === 'string' ? body.nous_display_name.slice(0, 60) : null;
        const res = await rpc<Record<string, unknown>>('nous_link_redeem', { p_code: code(), p_nous_user: body.nous_user_id, p_nous_name: name });
        return res;
      }
      case 'link.revoked': {
        const removed = await rpc<boolean>('nous_link_revoked', pair());
        return { removed };
      }
      case 'rsvp': {
        const p = pair();
        if (!isUuid(body.event_id) || !['yes', 'maybe', 'no'].includes(String(body.rsvp))) throw new AiFailure('invalid');
        const rsvp = await rpc<string>('nous_respond', { ...p, p_event: body.event_id, p_rsvp: body.rsvp });
        return { rsvp };
      }
      case 'jump.token': {
        const p = pair();
        // Lien magique seulement si la personne a activé la connexion directe, et jamais pour un compte administrateur :
        // sinon « jump_disabled » (Nous ouvre alors simplement le site).
        await rpc<boolean>('nous_jump_check', p);
        return { token_hash: await loginTokenFor(p.p_user) };
      }
      default:
        throw new AiFailure('invalid');
    }
  }

  async function cronTokenOk(token: string) {
    const { data } = await svc.rpc('nous_cron_token_ok', { p_token: token });
    return data === true;
  }

  /**
   * Anti-rejeu, pour une requête dont la signature vient d'être vérifiée : vrai la première fois, faux si la même
   * signature a déjà été reçue (seule son empreinte SHA-256 est gardée, 10 minutes après l'horodatage).
   */
  async function firstUse(signature: string, timestamp: string) {
    const { data, error } = await svc.rpc('eco_replay_claim', {
      p_signature_sha256: hex(await crypto.subtle.digest('SHA-256', enc.encode(signature))),
      p_signed_at: new Date(Number(timestamp)).toISOString(),
    });
    if (error) throw new AiFailure('internal', sanitize(error.message));
    return data === true;
  }

  return { enabled, flush, handleUser, handleSigned, cronTokenOk, firstUse };
}

export const NOUS_ACTIONS = new Set(['nous_status', 'nous_link_start', 'nous_unlink', 'nous_set_sync', 'nous_set_jump', 'nous_flush', 'nous_jump']);

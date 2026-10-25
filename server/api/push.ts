/**
 * Notifications push : le standard Web Push, celui que met en œuvre la bibliothèque PHP minishlink/web-push, écrit ici
 * pour la fonction serveur (Deno) avec la cryptographie du navigateur (WebCrypto), sans dépendance.
 *
 * - Le serveur s'identifie auprès du service de notifications par ses clés VAPID (RFC 8292) : un jeton signé ES256.
 * - Chaque message est chiffré pour l'appareil seul (RFC 8291, contenu « aes128gcm ») : Apple, Google, Mozilla ou
 *   Microsoft le transmettent sans pouvoir le lire.
 * - Seuls les services de notifications connus sont contactés : une adresse quelconque n'est jamais appelée.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { notificationText } from '../../src/domain/notifications.ts';
import { AiFailure, sanitize } from './util.ts';

const enc = new TextEncoder();
/** Octets sur un ArrayBuffer ordinaire (ce qu'attend WebCrypto). */
type Bytes = Uint8Array<ArrayBuffer>;

export function b64u(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64u(text: string): Bytes {
  const b = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/** HKDF (RFC 5869), extraction puis expansion d'un seul bloc : toutes les longueurs utilisées ici sont ≤ 32 octets. */
const extract = (salt: Bytes, ikm: Bytes) => hmac(salt, ikm);
const expand = async (prk: Bytes, info: Bytes, length: number) => (await hmac(prk, concat(info, Uint8Array.of(1)))).slice(0, length);

/** Valeurs intermédiaires du chiffrement (comparées aux exemples de la RFC 8291 dans les tests). */
export type PushSteps = { ecdh: Bytes; prkKey: Bytes; ikm: Bytes; prk: Bytes; cek: Bytes; nonce: Bytes };

/**
 * Chiffre un message pour un appareil (RFC 8291) : clé éphémère du serveur, secret partagé ECDH avec la clé publique de
 * l'appareil, mélangé à son secret d'authentification ; contenu AES-128-GCM en un seul bloc. `salt` et `sender` ne sont
 * fournis que par les tests (valeurs de la RFC) : sinon, tirés au hasard pour chaque message.
 */
export async function encryptPush(
  plaintext: Bytes,
  uaPublic: Bytes,
  authSecret: Bytes,
  o: { salt?: Bytes; sender?: { privateKey: CryptoKey; publicRaw: Bytes }; steps?: (s: PushSteps) => void } = {},
): Promise<Bytes> {
  const salt = o.salt ?? crypto.getRandomValues(new Uint8Array(16));
  let sender = o.sender;
  if (!sender) {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    sender = { privateKey: pair.privateKey, publicRaw: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)) };
  }
  const ua = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: ua }, sender.privateKey, 256));
  const prkKey = await extract(authSecret, ecdh);
  const ikm = await expand(prkKey, concat(enc.encode('WebPush: info\0'), uaPublic, sender.publicRaw), 32);
  const prk = await extract(salt, ikm);
  const cek = await expand(prk, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await expand(prk, enc.encode('Content-Encoding: nonce\0'), 12);
  o.steps?.({ ecdh, prkKey, ikm, prk, cek, nonce });
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // Un seul enregistrement : le contenu suivi du délimiteur de fin (0x02), sans remplissage.
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, Uint8Array.of(2))));
  const header = new Uint8Array(21 + sender.publicRaw.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = sender.publicRaw.length;
  header.set(sender.publicRaw, 21);
  return concat(header, cipher);
}

export type PushKeys = { publicKey: string; privateJwk: JsonWebKey };

/** Nouvelle paire de clés VAPID (P-256) : la clé publique est donnée aux navigateurs, la privée reste au serveur. */
export async function generateVapidKeys(): Promise<PushKeys> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicKey: b64u(raw), privateJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d } };
}

/** En-tête Authorization VAPID : jeton ES256 valable 12 heures pour le service de notifications de l'abonnement. */
export async function vapidAuthorization(endpoint: string, keys: PushKeys, subject: string, now = new Date()): Promise<string> {
  const part = (o: unknown) => b64u(enc.encode(JSON.stringify(o)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(now.getTime() / 1000) + 12 * 3600, sub: subject })}`;
  const { kty, crv, x, y, d } = keys.privateJwk;
  const key = await crypto.subtle.importKey('jwk', { kty, crv, x, y, d }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // WebCrypto signe au format r‖s (64 octets) : c'est celui des jetons JWT.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned)));
  return `vapid t=${unsigned}.${b64u(signature)}, k=${keys.publicKey}`;
}

/** Services de notifications des navigateurs : Google (Chrome, Android, Edge sur Android, Samsung), Mozilla, Apple, Microsoft. */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
];

/** Adresse d'abonnement acceptable : HTTPS vers un service connu (ou le faux service des tests, si configuré). */
export function pushEndpointAllowed(endpoint: string, testOrigin?: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (testOrigin && url.origin === testOrigin) return true;
  return url.protocol === 'https:' && !url.port && !url.username && !url.password && PUSH_HOSTS.some((h) => h.test(url.hostname));
}

export type PushTarget = { id: string; endpoint: string; p256dh: string; auth: string };
export type PushMessage = { title: string; body: string; url: string; tag?: string };
type Sent = { ok: boolean; gone: boolean; status: number };

export function createPush(o: { svc: SupabaseClient; fetch: typeof fetch; subject: string; testOrigin?: string; now: () => Date }) {
  const { svc } = o;
  let cached: PushKeys | null = null;

  /** Clés VAPID du serveur : créées au premier besoin, gardées en base (lisibles par la clé secrète du serveur seule). */
  async function keys(): Promise<PushKeys> {
    if (cached) return cached;
    const read = async () => {
      const { data, error } = await svc.from('push_config').select('vapid_public, vapid_private').eq('id', 1).maybeSingle();
      if (error) throw new AiFailure('internal', sanitize(error.message));
      return data as { vapid_public: string; vapid_private: JsonWebKey } | null;
    };
    let row = await read();
    if (!row) {
      const k = await generateVapidKeys();
      // Deux premiers appels simultanés : la seconde paire est refusée, la première est relue.
      await svc.from('push_config').insert({ id: 1, vapid_public: k.publicKey, vapid_private: k.privateJwk });
      row = await read();
    }
    if (!row) throw new AiFailure('internal', 'Clés de notification introuvables');
    cached = { publicKey: row.vapid_public, privateJwk: row.vapid_private };
    return cached;
  }

  async function send(target: PushTarget, message: PushMessage): Promise<Sent> {
    if (!pushEndpointAllowed(target.endpoint, o.testOrigin)) return { ok: false, gone: true, status: 0 };
    const k = await keys();
    const body = await encryptPush(enc.encode(JSON.stringify(message)), fromB64u(target.p256dh), fromB64u(target.auth));
    try {
      const res = await o.fetch(target.endpoint, {
        method: 'POST',
        headers: {
          TTL: '86400',
          Urgency: 'normal',
          'Content-Type': 'application/octet-stream',
          'Content-Encoding': 'aes128gcm',
          Authorization: await vapidAuthorization(target.endpoint, k, o.subject, o.now()),
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      await res.arrayBuffer().catch(() => undefined);
      return { ok: res.status >= 200 && res.status < 300, gone: res.status === 404 || res.status === 410, status: res.status };
    } catch {
      return { ok: false, gone: false, status: 0 };
    }
  }

  async function targetsOf(userIds: string[]): Promise<(PushTarget & { user_id: string })[]> {
    if (!userIds.length) return [];
    const { data, error } = await svc.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', userIds);
    if (error) throw new AiFailure('internal', sanitize(error.message));
    return (data ?? []) as (PushTarget & { user_id: string })[];
  }

  /** Envoie un message à des appareils ; chaque résultat est noté (un abonnement expiré est retiré). */
  async function deliver(targets: PushTarget[], message: PushMessage) {
    const results = await Promise.all(targets.map((t) => send(t, message)));
    await Promise.all(
      targets.map((t, i) => svc.rpc('push_subscription_result', { p_id: t.id, p_ok: results[i].ok, p_gone: results[i].gone })),
    );
    return {
      sent: results.filter((r) => r.ok).length,
      gone: results.filter((r) => r.gone).length,
      failed: results.filter((r) => !r.ok && !r.gone).length,
      statuses: results.map((r) => r.status),
    };
  }

  /** Enregistre l'appareil de la personne, après vérification de l'adresse et des clés. */
  async function subscribe(userId: string, body: Record<string, unknown>) {
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : '';
    const p256dh = typeof body.p256dh === 'string' ? body.p256dh.trim() : '';
    const auth = typeof body.auth === 'string' ? body.auth.trim() : '';
    const label = typeof body.label === 'string' ? body.label.slice(0, 60) : null;
    const keyOk = () => {
      try {
        const key = fromB64u(p256dh);
        return /^[A-Za-z0-9_-]{80,100}$/.test(p256dh) && /^[A-Za-z0-9_-]{16,32}$/.test(auth) && key.length === 65 && key[0] === 4 && fromB64u(auth).length === 16;
      } catch {
        return false;
      }
    };
    if (endpoint.length < 20 || endpoint.length > 1000 || !pushEndpointAllowed(endpoint, o.testOrigin) || !keyOk()) {
      throw new AiFailure('invalid', 'Abonnement aux notifications non valable');
    }
    const { data, error } = await svc.rpc('push_subscription_save', { p_user: userId, p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth, p_label: label });
    if (error) throw new AiFailure('internal', sanitize(error.message));
    return { id: data as string };
  }

  /** Notification d'essai, tout de suite, vers tous les appareils de la personne. */
  async function test(userId: string) {
    const targets = await targetsOf([userId]);
    if (!targets.length) return { devices: 0, sent: 0, gone: 0, failed: 0 };
    const r = await deliver(targets, { title: 'Cave & Amis', body: 'Notification d’essai : elles arrivent bien sur cet appareil.', url: '#/reglages', tag: 'essai' });
    return { devices: targets.length, sent: r.sent, gone: r.gone, failed: r.failed };
  }

  /** Traite la file : chaque notification part vers les appareils de sa destinataire. */
  async function flush(limit = 100) {
    const { data, error } = await svc.rpc('push_outbox_claim', { p_limit: limit });
    if (error) throw new AiFailure('internal', sanitize(error.message));
    const rows = (data ?? []) as { id: number; user_id: string; notification_id: string; kind: string; actor_id: string | null; actor_name: string | null; ref_id: string | null }[];
    const targets = await targetsOf([...new Set(rows.map((r) => r.user_id))]);
    let sent = 0;
    let failed = 0;
    for (const r of rows) {
      const mine = targets.filter((t) => t.user_id === r.user_id);
      const { text, href } = notificationText(r);
      const res = mine.length ? await deliver(mine, { title: 'Cave & Amis', body: text, url: href, tag: r.notification_id }) : { sent: 0, gone: 0, failed: 0, statuses: [] };
      // Réussi pour au moins un appareil, ou plus aucun appareil valable : c'est fait. Sinon, nouvel essai plus tard.
      const done = res.sent > 0 || res.failed === 0;
      await svc.rpc('push_outbox_done', {
        p_id: r.id,
        p_ok: done,
        p_error: done ? (res.sent ? null : 'aucun appareil') : sanitize(`échec ${res.statuses.join(', ')}`),
      });
      if (done) sent += res.sent > 0 ? 1 : 0;
      else failed++;
    }
    return { claimed: rows.length, sent, failed };
  }

  return { keys, subscribe, test, flush };
}



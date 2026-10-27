/**
 * « Faux Supabase » : répond aux appels du client Supabase officiel (Auth, PostgREST, Storage, Functions)
 * à partir d'une base PostgreSQL locale (PGlite) qui exécute exactement les migrations de production,
 * avec les mêmes rôles et les mêmes règles RLS.
 *
 * Sert au serveur local (`npm run local`) et aux tests. Couverture volontairement limitée aux requêtes
 * qu'emploie l'application, double authentification (codes TOTP) comprise. Ce module n'est jamais inclus dans l'export
 * de production.
 */
import type { PGlite, Transaction } from '@electric-sql/pglite';
import { base32Encode, totpValid } from './totp.ts';

type Json = Record<string, unknown>;
type Aal = 'aal1' | 'aal2';
/** Méthode de connexion notée dans le jeton (« amr »), comme chez Supabase. */
type Amr = { method: string; timestamp: number };
export type Claims = {
  sub: string;
  email: string;
  exp: number;
  iat: number;
  role: 'authenticated';
  aud: 'authenticated';
  session_id: string;
  /** Ouverture de la session (propre au serveur local) : sert aux déconnexions « partout ». */
  session_start?: number;
  /** Niveau de la session : aal1 (mot de passe, lien), aal2 (code de double authentification vérifié). */
  aal: Aal;
  amr: Amr[];
};
type Who = { kind: 'anon' } | { kind: 'user'; claims: Claims } | { kind: 'service' };
/**
 * Session ouverte, gardée d'un renouvellement à l'autre comme sur Supabase : son ouverture (déconnexions « partout ») et
 * son niveau de double authentification survivent au rafraîchissement du jeton.
 */
type SessionInfo = { id: string; userId: string; start: number; aal: Aal; amr: Amr[]; factorId: string | null };

const IDENT = /^[a-z_][a-z0-9_]*$/;
const TOKEN_LIFETIME = 3600;
const CHALLENGE_LIFETIME = 300;

export type FakeSupabaseOptions = {
  /** Clé « service » acceptée comme rôle service_role (contourne RLS, comme la clé secrète de Supabase). */
  serviceKey: string;
  /** Secret de signature des liens de photos. */
  signingSecret?: string;
  /** Adresse publique de ce faux serveur (pour les liens signés). */
  publicUrl?: string;
  /** Fonctions serveur (Edge Functions) : /functions/v1/<nom>. */
  functions?: Record<string, (req: Request) => Promise<Response>>;
  /** Délai simulé (ms). */
  latency?: number;
  /**
   * Protection CAPTCHA simulée (tests) : jeton exigé comme chez Supabase (supabase/auth, verifyCaptcha), sauf pour un appel
   * avec la clé « service ». Seule sa présence est vérifiée : aucun appel à Cloudflare.
   */
  captcha?: boolean;
};

function b64url(bytes: Uint8Array) {
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const b64urlText = (text: string) => b64url(new TextEncoder().encode(text));
function unb64urlText(s: string) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
// Fin des jetons : du base64url valable (supabase-js décode les jetons pour lire leur niveau), reconnu ici seulement.
const SIGNATURE = b64urlText('local');

function respond(status: number, body?: unknown, headers: Record<string, string> = {}) {
  const text = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(status === 204 ? null : text, {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Supabase-Api-Version': '2024-01-01', ...headers },
  });
}

function authError(status: number, code: string, msg: string) {
  return respond(status, { code, error_code: code, msg, message: msg });
}

function storageError(status: number, error: string, message: string) {
  return respond(status, { statusCode: String(status), error, message });
}

// Instant d'ouverture d'une session (ms), strictement croissant : une connexion qui suit une déconnexion « partout »,
// même dans la même milliseconde, n'est jamais prise pour une session d'avant.
let lastStart = 0;
const stamp = () => (lastStart = Math.max(Date.now(), lastStart + 1));

export function makeAccessToken(
  user: { id: string; email: string },
  session: Pick<SessionInfo, 'id' | 'start' | 'aal' | 'amr'> = { id: crypto.randomUUID(), start: stamp(), aal: 'aal1', amr: [] },
) {
  const now = Math.floor(Date.now() / 1000);
  const claims: Claims = {
    sub: user.id,
    email: user.email,
    exp: now + TOKEN_LIFETIME,
    iat: now,
    role: 'authenticated',
    aud: 'authenticated',
    session_id: session.id,
    session_start: session.start,
    aal: session.aal,
    amr: session.amr,
  };
  return { token: `${b64urlText(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${b64urlText(JSON.stringify(claims))}.${SIGNATURE}`, claims };
}

function makeSession(user: Json, session: SessionInfo) {
  const { token, claims } = makeAccessToken({ id: String(user.id), email: String(user.email) }, session);
  return {
    access_token: token,
    token_type: 'bearer',
    expires_in: TOKEN_LIFETIME,
    expires_at: claims.exp,
    // Le compte, la session et son ouverture : le niveau de la session est retrouvé au rafraîchissement.
    refresh_token: `local-refresh.${b64urlText(String(user.id))}.${session.id}.${session.start}`,
    user,
  };
}

type UserRow = { id: string; email: string; raw_user_meta_data: Json | null; created_at: string; last_sign_in_at: string | null };
type FactorRow = { id: string; friendly_name: string | null; factor_type: string; status: string; created_at: Date | string; updated_at: Date | string };

/** Code de double authentification tel que Supabase le décrit (jamais sa clé). */
function factorJson(f: FactorRow) {
  return {
    id: f.id,
    ...(f.friendly_name ? { friendly_name: f.friendly_name } : {}),
    factor_type: f.factor_type,
    status: f.status,
    created_at: new Date(f.created_at).toISOString(),
    updated_at: new Date(f.updated_at).toISOString(),
  };
}

function userJson(row: UserRow, factors: FactorRow[] = []) {
  return {
    id: row.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: row.email,
    email_confirmed_at: row.created_at,
    confirmed_at: row.created_at,
    last_sign_in_at: row.last_sign_in_at ?? row.created_at,
    phone: '',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: row.raw_user_meta_data ?? {},
    identities: [],
    created_at: row.created_at,
    updated_at: row.created_at,
    is_anonymous: false,
    // Comme chez Supabase : absents tant que le compte n'a aucun code.
    ...(factors.length ? { factors: factors.map(factorJson) } : {}),
  };
}

function bearer(headers: Headers) {
  return (headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
}

function claimsFromToken(token: string): Claims | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[2] !== SIGNATURE) return null;
  try {
    const claims = JSON.parse(unb64urlText(parts[1])) as Claims;
    if (!claims.sub || claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

class HttpError extends Error {
  status: number;
  body: Json;
  constructor(status: number, body: Json) {
    super(String(body.message));
    this.status = status;
    this.body = body;
  }
}

function pgErrorResponse(e: unknown, anon: boolean) {
  if (e instanceof HttpError) return respond(e.status, e.body);
  const err = e as { code?: string; message?: string; detail?: string; hint?: string };
  const code = err.code ?? 'XX000';
  let status = 400;
  if (code === '42501') status = anon ? 401 : 403;
  else if (code === '23505' || code === '23503') status = 409;
  else if (code === 'P0002') status = 404;
  return respond(status, { code, message: err.message ?? 'Erreur', details: err.detail ?? null, hint: err.hint ?? null });
}

const q = (name: string) => {
  if (!IDENT.test(name)) throw new HttpError(400, { code: 'PGRST100', message: `Nom invalide : ${name}` });
  return `"${name}"`;
};

/** Découpe une liste PostgREST « (a,b,"c,d") ». */
function parseList(raw: string): string[] {
  const inner = raw.replace(/^\(/, '').replace(/\)$/, '');
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of inner) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur !== '' || inner.endsWith(',')) out.push(cur);
  return out;
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
const OPS: Record<string, string> = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike' };

function buildWhere(params: URLSearchParams, alias: string, values: unknown[]) {
  const clauses: string[] = [];
  for (const [key, raw] of params) {
    if (RESERVED.has(key)) continue;
    const col = `${alias}.${q(key)}`;
    let expr = raw;
    let negate = false;
    if (expr.startsWith('not.')) {
      negate = true;
      expr = expr.slice(4);
    }
    const dot = expr.indexOf('.');
    const op = expr.slice(0, dot);
    const val = expr.slice(dot + 1);
    let clause: string;
    if (op === 'is') {
      const v = val.toLowerCase();
      if (!['null', 'true', 'false'].includes(v)) throw new HttpError(400, { code: 'PGRST100', message: `is.${val}` });
      clause = `${col} is ${v}`;
    } else if (op === 'in') {
      const items = parseList(val);
      if (items.length === 0) clause = 'false';
      else {
        const ph = items.map((it) => {
          values.push(it);
          return `$${values.length}`;
        });
        clause = `${col} in (${ph.join(', ')})`;
      }
    } else if (OPS[op]) {
      values.push(op.endsWith('like') ? val.replace(/\*/g, '%') : val);
      clause = `${col} ${OPS[op]} $${values.length}`;
    } else {
      throw new HttpError(400, { code: 'PGRST100', message: `Opérateur non pris en charge : ${op}` });
    }
    clauses.push(negate ? `not (${clause})` : clause);
  }
  return clauses.length ? `where ${clauses.join(' and ')}` : '';
}

function buildSelect(params: URLSearchParams, alias: string) {
  const sel = (params.get('select') ?? '*').trim();
  if (sel === '*') return `${alias}.*`;
  return sel
    .split(',')
    .map((c) => `${alias}.${q(c.trim())}`)
    .join(', ');
}

function buildOrder(params: URLSearchParams, alias: string) {
  const order = params.get('order');
  if (!order) return '';
  const parts = order.split(',').map((p) => {
    const [col, ...mods] = p.split('.');
    let s = `${alias}.${q(col)}`;
    if (mods.includes('desc')) s += ' desc';
    if (mods.includes('nullsfirst')) s += ' nulls first';
    if (mods.includes('nullslast')) s += ' nulls last';
    return s;
  });
  return `order by ${parts.join(', ')}`;
}

function buildLimit(params: URLSearchParams) {
  let s = '';
  const limit = params.get('limit');
  const offset = params.get('offset');
  if (limit && /^\d+$/.test(limit)) s += ` limit ${limit}`;
  if (offset && /^\d+$/.test(offset)) s += ` offset ${offset}`;
  return s;
}

type FnInfo = { args: Map<string, string>; retset: boolean; returnsVoid: boolean };

async function hmac(secret: string, text: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text))));
}

export function createFakeSupabase(db: PGlite, options: FakeSupabaseOptions) {
  const fnCache = new Map<string, FnInfo>();
  const signingSecret = options.signingSecret ?? crypto.randomUUID();

  function who(headers: Headers): Who {
    const token = bearer(headers);
    if (token && token === options.serviceKey) return { kind: 'service' };
    if (!token && headers.get('apikey') === options.serviceKey) return { kind: 'service' };
    const claims = token ? claimsFromToken(token) : null;
    if (claims) return { kind: 'user', claims };
    return { kind: 'anon' };
  }

  async function fnInfo(name: string): Promise<FnInfo> {
    const hit = fnCache.get(name);
    if (hit) return hit;
    const res = await db.query<{ names: string[] | null; types: string[]; retset: boolean; rettype: string }>(
      `select p.proargnames as names, array(select format_type(t, null) from unnest(p.proargtypes) t) as types,
              p.proretset as retset, format_type(p.prorettype, null) as rettype
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = $1`,
      [name],
    );
    if (res.rows.length !== 1) throw new HttpError(404, { code: 'PGRST202', message: `Fonction introuvable : ${name}` });
    const row = res.rows[0];
    const args = new Map<string, string>();
    (row.names ?? []).forEach((n, i) => {
      if (i < row.types.length) args.set(n, row.types[i]);
    });
    const info = { args, retset: row.retset, returnsVoid: row.rettype === 'void' };
    fnCache.set(name, info);
    return info;
  }

  async function withRole<T>(w: Who, run: (tx: Transaction) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      if (w.kind === 'user') {
        await tx.query(
          `select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true), set_config('request.jwt.claim.role', 'authenticated', true)`,
          [w.claims.sub, JSON.stringify(w.claims)],
        );
        await tx.exec('set local role authenticated');
      } else if (w.kind === 'service') {
        await tx.query(`select set_config('request.jwt.claim.role', 'service_role', true)`);
        await tx.exec('set local role service_role');
      } else {
        await tx.exec('set local role anon');
      }
      return run(tx);
    });
  }

  async function bodyOf(tx: Transaction, sql: string, values: unknown[]) {
    const res = await tx.query<{ body: string | null }>(sql, values);
    return res.rows[0]?.body ?? null;
  }

  // Sessions fermées par une déconnexion (gardées en mémoire : un redémarrage du serveur local les oublie). Comme sur
  // Supabase, une session fermée ne se renouvelle plus et le service de connexion la refuse ; l'API de données accepte
  // encore le jeton d'accès déjà délivré, jusqu'à son expiration (une heure au plus).
  //   « local » : cette session ; « global » : toutes celles de la personne ouvertes jusque-là ; « others » : toutes sauf celle-ci.
  const endedSessions = new Set<string>();
  const cutoffs = new Map<string, { at: number; keep: string | null }>();
  const sessionEnded = (userId: string, s: Pick<SessionInfo, 'id' | 'start'>) => {
    const cut = cutoffs.get(userId);
    return endedSessions.has(s.id) || Boolean(cut && s.start < cut.at && s.id !== cut.keep);
  };

  const magicTokens = new Map<string, string>();
  const recoveryTokens = new Map<string, string>();
  const lastRecovery = new Map<string, string>();
  /** Changement d'adresse « sécurisé », comme chez Supabase : un jeton pour l'adresse actuelle, un pour la nouvelle. */
  const emailChanges = new Map<string, { newEmail: string; current: string; next: string; confirmed: Set<'current' | 'next'> }>();
  const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(28)), (b) => b.toString(16).padStart(2, '0')).join('');
  const findUser = async (where: string, value: string) =>
    (
      await db.query<UserRow>(
        `select id, email, raw_user_meta_data, created_at::text, last_sign_in_at::text from auth.users where ${where}`,
        [value],
      )
    ).rows[0];

  // Sessions et défis de double authentification, en mémoire comme les liens magiques. Après un redémarrage, un jeton de
  // rafraîchissement inconnu rouvre une session au niveau du seul mot de passe (aal1).
  const sessions = new Map<string, SessionInfo>();
  const challenges = new Map<string, { factorId: string; expiresAt: number }>();
  const nowSeconds = () => Math.floor(Date.now() / 1000);
  function openSession(userId: string, method: string, id: string = crypto.randomUUID(), start: number = stamp()) {
    const s: SessionInfo = { id, userId, start, aal: 'aal1', amr: [{ method, timestamp: nowSeconds() }], factorId: null };
    sessions.set(s.id, s);
    return s;
  }
  const factorsOf = async (userId: string) =>
    (
      await db.query<FactorRow>(
        `select id, friendly_name, factor_type, status, created_at, updated_at from auth.mfa_factors where user_id = $1 order by created_at, id`,
        [userId],
      )
    ).rows;
  const userOut = async (row: UserRow) => ({ ...userJson(row, await factorsOf(row.id)), new_email: emailChanges.get(row.id)?.newEmail ?? null });
  /** Code vérifié du compte (`factorId` : celui-là précisément). */
  const hasVerifiedFactor = async (userId: string, factorId: string | null = null) =>
    (
      await db.query(`select 1 from auth.mfa_factors where user_id = $1 and status = 'verified' and ($2::uuid is null or id = $2::uuid)`, [
        userId,
        factorId,
      ])
    ).rows.length > 0;

  /** Double authentification, comme chez Supabase : inscription d'un code, défi, vérification (passage en aal2), retrait. */
  async function handleFactors(path: string, url: URL, method: string, w: Who, body: Json) {
    const claims = w.kind === 'user' ? w.claims : null;
    const user = claims ? await findUser('id = $1', claims.sub) : undefined;
    if (!claims || !user) return authError(401, 'bad_jwt', 'invalid JWT');
    const strong = claims.aal === 'aal2';
    const route = /^factors(?:\/([0-9a-f-]{36})(?:\/(challenge|verify))?)?$/.exec(path);
    if (!route) return authError(404, 'not_found', `Auth : ${path} non pris en charge en local`);
    const [, factorId, action] = route;

    if (!factorId && method === 'POST') {
      if (body.factor_type !== 'totp') return authError(422, 'validation_failed', 'Seuls les codes TOTP sont simulés en local');
      const factors = await factorsOf(user.id);
      // Un nouveau code ne s'ajoute à un code actif qu'avec une session déjà vérifiée par celui-ci.
      if (factors.some((f) => f.status === 'verified') && !strong) return authError(403, 'insufficient_aal', 'AAL2 required to enroll a new factor');
      if (factors.length >= 10) return authError(422, 'too_many_enrolled_mfa_factors', 'Maximum number of enrolled factors reached, unenroll to continue');
      const name = String(body.friendly_name ?? '').trim();
      if (name && factors.some((f) => f.friendly_name === name))
        return authError(422, 'mfa_factor_name_conflict', `A factor with the friendly name "${name}" for this user already exists`);
      const secret = base32Encode(crypto.getRandomValues(new Uint8Array(20)));
      const issuer = String(body.issuer ?? '').trim() || url.host;
      const id = (
        await db.query<{ id: string }>(
          `insert into auth.mfa_factors (user_id, friendly_name, factor_type, status, secret) values ($1, $2, 'totp', 'unverified', $3) returning id`,
          [user.id, name || null, secret],
        )
      ).rows[0].id;
      const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(user.email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
      // Pas d'image de QR code : l'application le dessine elle-même à partir de l'adresse otpauth://.
      return respond(200, { id, type: 'totp', ...(name ? { friendly_name: name } : {}), totp: { qr_code: '', secret, uri } });
    }

    const factor = factorId
      ? (
          await db.query<FactorRow & { secret: string | null }>(
            `select id, friendly_name, factor_type, status, secret, created_at, updated_at from auth.mfa_factors where id = $1 and user_id = $2`,
            [factorId, user.id],
          )
        ).rows[0]
      : undefined;
    if (!factor) return authError(404, 'mfa_factor_not_found', 'Factor not found');

    if (!action && method === 'DELETE') {
      // Retirer un code actif demande une session vérifiée par un code.
      if (factor.status === 'verified' && !strong) return authError(422, 'insufficient_aal', 'AAL2 required to unenroll verified factor');
      await db.query(`delete from auth.mfa_factors where id = $1`, [factor.id]);
      return respond(200, { id: factor.id });
    }

    if (action === 'challenge' && method === 'POST') {
      for (const [k, c] of challenges) if (c.expiresAt < nowSeconds()) challenges.delete(k);
      const challenge = { id: crypto.randomUUID(), factorId: factor.id, expiresAt: nowSeconds() + CHALLENGE_LIFETIME };
      challenges.set(challenge.id, challenge);
      return respond(200, { id: challenge.id, type: 'totp', expires_at: challenge.expiresAt });
    }

    if (action === 'verify' && method === 'POST') {
      const challengeId = String(body.challenge_id ?? '');
      const challenge = challenges.get(challengeId);
      // Un défi ne sert qu'une fois, code juste ou faux.
      challenges.delete(challengeId);
      if (!challenge || challenge.factorId !== factor.id || challenge.expiresAt < nowSeconds())
        return authError(422, 'mfa_challenge_expired', 'MFA challenge has expired, verify against another challenge or create a new challenge.');
      if (!factor.secret || !(await totpValid(factor.secret, String(body.code ?? '').trim())))
        return authError(422, 'mfa_verification_failed', 'Invalid TOTP code entered');
      if (factor.status !== 'verified') {
        await db.query(`update auth.mfa_factors set status = 'verified', updated_at = now() where id = $1`, [factor.id]);
        // Comme chez Supabase : les autres activations commencées et non terminées sont retirées.
        await db.query(`delete from auth.mfa_factors where user_id = $1 and factor_type = 'totp' and status = 'unverified'`, [user.id]);
      }
      // La session en cours passe au niveau aal2 (nouveaux jetons, même session).
      const known = sessions.get(claims.session_id);
      const base = known?.userId === user.id ? known : { id: claims.session_id || crypto.randomUUID(), amr: claims.amr ?? [] };
      const s: SessionInfo = {
        id: base.id,
        userId: user.id,
        start: known?.userId === user.id ? known.start : (claims.session_start ?? stamp()),
        aal: 'aal2',
        amr: [{ method: 'totp', timestamp: nowSeconds() }, ...base.amr.filter((a) => a.method !== 'totp')],
        factorId: factor.id,
      };
      sessions.set(s.id, s);
      return respond(200, makeSession(await userOut(user), s));
    }
    return authError(404, 'not_found', `Auth : ${path} non pris en charge en local`);
  }

  async function handleAuth(path: string, url: URL, method: string, headers: Headers, body: Json) {
    // Pas de contrôle anti-robots en local : le jeton Turnstile éventuel (gotrue_meta_security.captcha_token) est accepté
    // et ignoré, comme par un projet Supabase sans protection CAPTCHA. Avec l'option `captcha` (tests), il est exigé pour
    // s'inscrire, se connecter par mot de passe ou recevoir un e-mail, sauf pour un appel du serveur avec sa clé.
    const captchaToken = String((body.gotrue_meta_security as { captcha_token?: unknown } | undefined)?.captcha_token ?? '').trim();
    delete body.gotrue_meta_security;
    const captchaRoute = ['signup', 'recover', 'otp', 'magiclink'].includes(path) || (path === 'token' && url.searchParams.get('grant_type') === 'password');
    if (options.captcha && method === 'POST' && captchaRoute && !captchaToken && who(headers).kind !== 'service') {
      return authError(400, 'captcha_failed', 'captcha protection: request disallowed (no captcha response)');
    }
    if (path === 'signup' && method === 'POST') {
      const email = String(body.email ?? '')
        .trim()
        .toLowerCase();
      const password = String(body.password ?? '');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return authError(400, 'validation_failed', 'Unable to validate email address: invalid format');
      if (password.length < 8) return authError(422, 'weak_password', 'Password should be at least 8 characters.');
      if (await findUser('email = $1', email)) return authError(422, 'user_already_exists', 'User already registered');
      const id = crypto.randomUUID();
      await db.query(
        `insert into auth.users (id, email, password_hash, raw_user_meta_data, last_sign_in_at)
         values ($1::uuid, $2, encode(sha256(convert_to($1::text || ':' || $3, 'UTF8')), 'hex'), $4, now())`,
        [id, email, password, JSON.stringify(body.data ?? {})],
      );
      return respond(200, makeSession(userJson((await findUser('id = $1', id))!), openSession(id, 'password')));
    }

    if (path === 'token' && method === 'POST') {
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const email = String(body.email ?? '')
          .trim()
          .toLowerCase();
        const res = await db.query<UserRow>(
          `update auth.users set last_sign_in_at = now()
           where email = $1 and password_hash = encode(sha256(convert_to(id::text || ':' || $2, 'UTF8')), 'hex')
           returning id, email, raw_user_meta_data, created_at::text, last_sign_in_at::text`,
          [email, String(body.password ?? '')],
        );
        if (!res.rows[0]) return authError(400, 'invalid_credentials', 'Invalid login credentials');
        // Nouvelle session au niveau du mot de passe, même si le compte a un code (il sera demandé ensuite).
        return respond(200, makeSession(await userOut(res.rows[0]), openSession(res.rows[0].id, 'password')));
      }
      if (grant === 'refresh_token') {
        // « local-refresh.<compte>.<session>.<ouverture> » (sans ouverture : jeton d'une version précédente du serveur local).
        const token = String(body.refresh_token ?? '');
        const m = /^local-refresh\.([^.]+)\.([^.]+)(?:\.(\d+))?$/.exec(token);
        const user = m ? await findUser('id::text = $1', unb64urlText(m[1])) : undefined;
        if (!m || !user) return authError(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
        const start = Number(m[3] ?? 0);
        if (sessionEnded(user.id, { id: m[2], start })) return authError(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
        let s = sessions.get(m[2]);
        // Session inconnue (serveur local redémarré) : reprise au niveau du seul mot de passe, même session.
        if (!s || s.userId !== user.id) s = openSession(user.id, 'password', m[2], start || stamp());
        else if (s.aal === 'aal2' && !(await hasVerifiedFactor(user.id, s.factorId))) {
          // Code retiré entre-temps : la session redescend au niveau du mot de passe, comme chez Supabase.
          s.aal = 'aal1';
          s.factorId = null;
          s.amr = s.amr.filter((a) => a.method !== 'totp');
        }
        return respond(200, makeSession(await userOut(user), s));
      }
      return authError(400, 'validation_failed', 'unsupported_grant_type');
    }

    // Lien magique (connexion directe depuis Nous) ou lien « mot de passe oublié » : jeton à usage unique, gardé en
    // mémoire, valable seulement pour son type.
    if (path === 'verify' && method === 'POST' && body.type === 'email_change') {
      const hash = String(body.token_hash ?? '');
      const entry = [...emailChanges].find(([, c]) => c.current === hash || c.next === hash);
      if (!entry) return authError(403, 'otp_expired', 'Email link is invalid or has expired');
      const [userId, change] = entry;
      const side = change.current === hash ? 'current' : 'next';
      if (change.confirmed.has(side)) return authError(403, 'otp_expired', 'Email link is invalid or has expired');
      change.confirmed.add(side);
      if (change.confirmed.size < 2) return respond(200, { msg: 'Confirmation link accepted. Please proceed to confirm link sent to the other email' });
      emailChanges.delete(userId);
      await db.query(`update auth.users set email = $2 where id = $1`, [userId, change.newEmail]);
      const user = (await findUser('id = $1', userId))!;
      return respond(200, makeSession(await userOut(user), openSession(userId, 'email_change')));
    }
    if (path === 'verify' && method === 'POST') {
      const hash = String(body.token_hash ?? '');
      const type = body.type === 'recovery' ? 'recovery' : 'magiclink';
      const userId = type === 'recovery' ? recoveryTokens.get(hash) : magicTokens.get(hash);
      const user = userId ? await findUser('id = $1', userId) : undefined;
      if (!user) return authError(403, 'otp_expired', 'Email link is invalid or has expired');
      (type === 'recovery' ? recoveryTokens : magicTokens).delete(hash);
      return respond(200, makeSession(await userOut(user), openSession(user.id, type)));
    }

    const w = who(headers);
    if (w.kind === 'user' && sessionEnded(w.claims.sub, { id: w.claims.session_id, start: w.claims.session_start ?? 0 })) {
      return authError(403, 'session_not_found', 'Session from session_id claim in JWT does not exist');
    }
    if (path === 'factors' || path.startsWith('factors/')) return handleFactors(path, url, method, w, body);
    if (path === 'admin/generate_link' && method === 'POST') {
      if (w.kind !== 'service') return authError(403, 'not_admin', 'User not allowed');
      const user = await findUser('email = $1', String(body.email ?? '').toLowerCase());
      if (!user) return authError(404, 'user_not_found', 'User not found');
      const hashed = Array.from(crypto.getRandomValues(new Uint8Array(28)), (b) => b.toString(16).padStart(2, '0')).join('');
      magicTokens.set(hashed, user.id);
      return respond(200, { ...userJson(user), action_link: `local://verify?token=${hashed}`, hashed_token: hashed, verification_type: 'magiclink', redirect_to: '' });
    }
    const adminUser = /^admin\/users\/([0-9a-f-]{36})$/.exec(path);
    if (adminUser) {
      if (w.kind !== 'service') return authError(403, 'not_admin', 'User not allowed');
      if (method === 'DELETE') {
        await db.query(`delete from auth.users where id = $1`, [adminUser[1]]);
        return respond(200, {});
      }
      const user = await findUser('id = $1', adminUser[1]);
      return user ? respond(200, await userOut(user)) : authError(404, 'user_not_found', 'User not found');
    }
    if (path === 'user') {
      const claims = w.kind === 'user' ? w.claims : null;
      const user = claims ? await findUser('id = $1', claims.sub) : undefined;
      if (!claims || !user) return authError(401, 'bad_jwt', 'invalid JWT');
      if (method === 'PUT') {
        if (body.password !== undefined) {
          // Comme chez Supabase : avec un code actif, changer de mot de passe demande une session vérifiée par ce code.
          if (claims.aal !== 'aal2' && (await hasVerifiedFactor(user.id)))
            return authError(401, 'insufficient_aal', 'AAL2 session is required to update email or password when MFA is enabled.');
          const password = String(body.password);
          if (password.length < 8) return authError(422, 'weak_password', 'Password should be at least 8 characters.');
          await db.query(`update auth.users set password_hash = encode(sha256(convert_to(id::text || ':' || $2, 'UTF8')), 'hex') where id = $1`, [
            user.id,
            password,
          ]);
        }
        if (typeof body.email === 'string' && body.email.trim()) {
          const newEmail = body.email.trim().toLowerCase();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail)) return authError(400, 'validation_failed', 'Unable to validate email address: invalid format');
          if (await findUser('email = $1', newEmail)) return authError(422, 'email_exists', 'A user with this email address has already been registered');
          // Une nouvelle demande remplace la précédente ; rien ne change avant les deux confirmations.
          emailChanges.set(user.id, { newEmail, current: newToken(), next: newToken(), confirmed: new Set() });
        }
        if (body.data && typeof body.data === 'object') {
          await db.query(`update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data, '{}') || $2::jsonb where id = $1`, [
            user.id,
            JSON.stringify(body.data),
          ]);
        }
        return respond(200, await userOut((await findUser('id = $1', user.id))!));
      }
      return respond(200, await userOut(user));
    }
    if (path === 'logout') {
      if (w.kind !== 'user') return authError(401, 'no_authorization', 'This endpoint requires a valid Bearer token');
      const scope = url.searchParams.get('scope') ?? 'global';
      if (scope === 'local') endedSessions.add(w.claims.session_id);
      else if (scope === 'global' || scope === 'others') cutoffs.set(w.claims.sub, { at: stamp(), keep: scope === 'others' ? w.claims.session_id : null });
      else return authError(400, 'validation_failed', 'Parameter scope must be one of global, local, others');
      if (scope !== 'others') sessions.delete(w.claims.session_id);
      return respond(204);
    }
    // Pas d'envoi d'e-mails en local : la demande est acceptée (comme Supabase, sans dire si le compte existe). Le jeton
    // du lien est gardé pour les tests (lastRecoveryToken) ; comme chez Supabase, seul le dernier demandé est valable.
    if (path === 'recover') {
      const user = await findUser('email = $1', String(body.email ?? '').trim().toLowerCase());
      if (user) {
        for (const [h, id] of recoveryTokens) if (id === user.id) recoveryTokens.delete(h);
        const hashed = Array.from(crypto.getRandomValues(new Uint8Array(28)), (b) => b.toString(16).padStart(2, '0')).join('');
        recoveryTokens.set(hashed, user.id);
        lastRecovery.set(user.email.toLowerCase(), hashed);
      }
      return respond(200, {});
    }
    return authError(404, 'not_found', `Auth : ${path} non pris en charge en local`);
  }

  async function handleRest(path: string, url: URL, method: string, headers: Headers, body: unknown) {
    const w = who(headers);
    const prefer = headers.get('Prefer') ?? '';
    const accept = headers.get('Accept') ?? '';
    const wantsObject = accept.startsWith('application/vnd.pgrst.object+json');
    const params = url.searchParams;

    const finish = (text: string | null, status = 200) => {
      if (wantsObject) {
        const rows = JSON.parse(text ?? '[]') as unknown[];
        if (rows.length !== 1) {
          return respond(406, {
            code: 'PGRST116',
            message: 'JSON object requested, multiple (or no) rows returned',
            details: `The result contains ${rows.length} rows`,
            hint: null,
          });
        }
        return respond(status, rows[0]);
      }
      return respond(status, text ?? '[]');
    };

    try {
      if (path.startsWith('rpc/')) {
        const name = path.slice(4);
        q(name);
        const info = await fnInfo(name);
        const args = (method === 'GET' ? Object.fromEntries(params) : (body ?? {})) as Json;
        const values: unknown[] = [];
        const named = Object.entries(args)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => {
            const type = info.args.get(k);
            if (!type) throw new HttpError(404, { code: 'PGRST202', message: `Paramètre inconnu ${k} pour ${name}` });
            let value: unknown;
            if (v === null) value = null;
            else if (type === 'jsonb' || type === 'json') value = JSON.stringify(v);
            else if (type.endsWith('[]') && Array.isArray(v)) value = `{${v.map((x) => `"${String(x).replace(/(["\\])/g, '\\$1')}"`).join(',')}}`;
            else value = String(v);
            values.push(value);
            return `${q(k)} => $${values.length}::${type}`;
          });
        const call = `public.${q(name)}(${named.join(', ')})`;
        const text = await withRole(w, (tx) => {
          if (info.returnsVoid) return tx.query(`select ${call}`, values).then(() => null);
          if (info.retset) return bodyOf(tx, `select coalesce(json_agg(r), '[]'::json)::text as body from ${call} r`, values);
          return bodyOf(tx, `select to_json(${call})::text as body`, values);
        });
        if (info.returnsVoid) return respond(204);
        return respond(200, text ?? 'null');
      }

      const table = `public.${q(path)}`;
      if (method === 'GET' || method === 'HEAD') {
        const values: unknown[] = [];
        const sql = `select coalesce(json_agg(_r), '[]'::json)::text as body from (
          select ${buildSelect(params, '_t')} from ${table} as _t ${buildWhere(params, '_t', values)} ${buildOrder(params, '_t')} ${buildLimit(params)}
        ) _r`;
        return finish(await withRole(w, (tx) => bodyOf(tx, sql, values)));
      }

      const returning = prefer.includes('return=representation');
      if (method === 'POST') {
        const rows = (Array.isArray(body) ? body : [body]) as Json[];
        const cols = params.get('columns')
          ? params
              .get('columns')!
              .split(',')
              .map((c) => c.replace(/"/g, ''))
          : [...new Set(rows.flatMap((r) => Object.keys(r)))];
        const colList = cols.map(q).join(', ');
        let conflict = '';
        if (prefer.includes('resolution=')) {
          const target = (params.get('on_conflict') ?? 'id').split(',').map((c) => q(c.trim()));
          const updates = cols.filter((c) => !target.includes(q(c))).map((c) => `${q(c)} = excluded.${q(c)}`);
          conflict =
            prefer.includes('resolution=ignore-duplicates') || updates.length === 0
              ? `on conflict (${target.join(', ')}) do nothing`
              : `on conflict (${target.join(', ')}) do update set ${updates.join(', ')}`;
        }
        const insert = `insert into ${table} as _t (${colList}) select ${colList} from json_populate_recordset(null::${table}, $1::json) ${conflict}`;
        const text = await withRole(w, (tx) =>
          returning
            ? bodyOf(tx, `with _w as (${insert} returning _t.*) select coalesce(json_agg(_w), '[]'::json)::text as body from _w`, [
                JSON.stringify(rows),
              ])
            : tx.query(insert, [JSON.stringify(rows)]).then(() => null),
        );
        return returning ? finish(text, 201) : respond(201);
      }

      if (method === 'PATCH') {
        const patch = (body ?? {}) as Json;
        const cols = Object.keys(patch);
        if (cols.length === 0) throw new HttpError(400, { code: 'PGRST102', message: 'Corps vide' });
        const values: unknown[] = [JSON.stringify(patch)];
        const where = buildWhere(params, '_t', values);
        const update = `update ${table} as _t set ${cols.map((c) => `${q(c)} = _x.${q(c)}`).join(', ')}
          from json_populate_record(null::${table}, $1::json) as _x ${where}`;
        const text = await withRole(w, (tx) =>
          returning
            ? bodyOf(tx, `with _w as (${update} returning _t.*) select coalesce(json_agg(_w), '[]'::json)::text as body from _w`, values)
            : tx.query(update, values).then(() => null),
        );
        return returning ? finish(text) : respond(204);
      }

      if (method === 'DELETE') {
        const values: unknown[] = [];
        const del = `delete from ${table} as _t ${buildWhere(params, '_t', values)}`;
        const text = await withRole(w, (tx) =>
          returning
            ? bodyOf(tx, `with _w as (${del} returning _t.*) select coalesce(json_agg(_w), '[]'::json)::text as body from _w`, values)
            : tx.query(del, values).then(() => null),
        );
        return returning ? finish(text) : respond(204);
      }
      return respond(405, { code: 'PGRST117', message: `Méthode ${method} non prise en charge` });
    } catch (e) {
      return pgErrorResponse(e, w.kind === 'anon');
    }
  }

  // ───────────── Stockage ─────────────

  async function signToken(bucket: string, name: string, expiresIn: number) {
    const payload = b64urlText(JSON.stringify({ b: bucket, n: name, e: Math.floor(Date.now() / 1000) + expiresIn }));
    return `${payload}.${await hmac(signingSecret, payload)}`;
  }

  async function checkToken(token: string, bucket: string, name: string) {
    const [payload, sig] = token.split('.');
    if (!payload || !sig || (await hmac(signingSecret, payload)) !== sig) return false;
    try {
      const p = JSON.parse(unb64urlText(payload)) as { b: string; n: string; e: number };
      return p.b === bucket && p.n === name && p.e * 1000 > Date.now();
    } catch {
      return false;
    }
  }

  async function canSee(w: Who, bucket: string, names: string[]): Promise<Set<string>> {
    if (w.kind === 'anon' || names.length === 0) return new Set();
    const rows = await withRole(w, (tx) =>
      tx.query<{ name: string }>(`select name from storage.objects where bucket_id = $1 and name = any($2::text[])`, [bucket, names]),
    );
    return new Set(rows.rows.map((r) => r.name));
  }

  async function serveBlob(bucket: string, name: string) {
    const res = await db.query<{ data: Uint8Array; content_type: string }>(
      `select data, content_type from storage_local.blobs where bucket_id = $1 and name = $2`,
      [bucket, name],
    );
    const row = res.rows[0];
    if (!row) return storageError(404, 'not_found', 'Object not found');
    return new Response(row.data as BodyInit, {
      status: 200,
      headers: { 'Content-Type': row.content_type, 'Cache-Control': 'private, max-age=3600' },
    });
  }

  async function handleStorage(path: string, url: URL, req: Request) {
    const w = who(req.headers);
    const method = req.method.toUpperCase();
    try {
      // Lien signé : lisible sans session, pendant sa durée de validité.
      let m = /^object\/sign\/([^/]+)\/(.+)$/.exec(path);
      if (m && method === 'GET') {
        const [bucket, name] = [m[1], decodeURIComponent(m[2])];
        if (!(await checkToken(url.searchParams.get('token') ?? '', bucket, name))) return storageError(400, 'InvalidJWT', 'Invalid or expired signature');
        return serveBlob(bucket, name);
      }
      if (m && method === 'POST') {
        const [bucket, name] = [m[1], decodeURIComponent(m[2])];
        const body = (await req.json().catch(() => ({}))) as { expiresIn?: number };
        const visible = await canSee(w, bucket, [name]);
        if (!visible.has(name)) return storageError(400, 'not_found', 'Object not found');
        const token = await signToken(bucket, name, Number(body.expiresIn ?? 3600));
        return respond(200, { signedURL: `/object/sign/${bucket}/${encodeURI(name)}?token=${token}` });
      }
      m = /^object\/sign\/([^/]+)$/.exec(path);
      if (m && method === 'POST') {
        const bucket = m[1];
        const body = (await req.json().catch(() => ({}))) as { expiresIn?: number; paths?: string[] };
        const paths = (body.paths ?? []).map(String);
        const visible = await canSee(w, bucket, paths);
        const out = [];
        for (const p of paths) {
          if (visible.has(p)) {
            const token = await signToken(bucket, p, Number(body.expiresIn ?? 3600));
            out.push({ error: null, path: p, signedURL: `/object/sign/${bucket}/${encodeURI(p)}?token=${token}` });
          } else out.push({ error: 'Either the object does not exist or you do not have access to it', path: p, signedURL: null });
        }
        return respond(200, out);
      }
      m = /^object\/list\/([^/]+)$/.exec(path);
      if (m && method === 'POST') {
        const bucket = m[1];
        const body = (await req.json().catch(() => ({}))) as { prefix?: string; limit?: number; offset?: number };
        const prefix = String(body.prefix ?? '').replace(/\/+$/, '');
        const rows = await withRole(w, (tx) =>
          tx.query<{ name: string; id: string }>(
            `select name, id from storage.objects where bucket_id = $1 and name like $2 order by name limit $3 offset $4`,
            [bucket, prefix ? `${prefix}/%` : '%', Math.min(Number(body.limit ?? 100), 1000), Number(body.offset ?? 0)],
          ),
        );
        return respond(
          200,
          rows.rows
            .map((r) => ({ ...r, name: prefix ? r.name.slice(prefix.length + 1) : r.name }))
            .filter((r) => !r.name.includes('/'))
            .map((r) => ({ name: r.name, id: r.id, metadata: {} })),
        );
      }
      m = /^object\/(?:authenticated\/)?([^/]+)\/(.+)$/.exec(path);
      if (m && method === 'GET') {
        const [bucket, name] = [m[1], decodeURIComponent(m[2])];
        const visible = await canSee(w, bucket, [name]);
        if (!visible.has(name)) return storageError(400, 'not_found', 'Object not found');
        return serveBlob(bucket, name);
      }
      if (m && (method === 'POST' || method === 'PUT')) {
        const [bucket, name] = [m[1], decodeURIComponent(m[2])];
        if (w.kind === 'anon') return storageError(403, 'Unauthorized', 'new row violates row-level security policy');
        const ct = req.headers.get('content-type') ?? '';
        let data: Uint8Array;
        let contentType = 'application/octet-stream';
        if (ct.startsWith('multipart/form-data')) {
          const form = await req.formData();
          let file: Blob | null = null;
          for (const [, v] of form.entries()) if (typeof v !== 'string') file = v as Blob;
          if (!file) return storageError(400, 'invalid_request', 'Fichier manquant');
          data = new Uint8Array(await file.arrayBuffer());
          contentType = file.type || contentType;
        } else {
          data = new Uint8Array(await req.arrayBuffer());
          contentType = ct || contentType;
        }
        const bucketRow = (
          await db.query<{ file_size_limit: number | null; allowed_mime_types: string[] | null }>(
            `select file_size_limit, allowed_mime_types from storage.buckets where id = $1`,
            [bucket],
          )
        ).rows[0];
        if (!bucketRow) return storageError(404, 'Bucket not found', 'Bucket not found');
        if (bucketRow.file_size_limit && data.byteLength > Number(bucketRow.file_size_limit))
          return storageError(413, 'Payload too large', 'The object exceeded the maximum allowed size');
        if (bucketRow.allowed_mime_types?.length && !bucketRow.allowed_mime_types.includes(contentType))
          return storageError(415, 'invalid_mime_type', `mime type ${contentType} is not supported`);
        const upsert = req.headers.get('x-upsert') === 'true' || method === 'PUT';
        const owner = w.kind === 'user' ? w.claims.sub : null;
        const id = await withRole(w, async (tx) => {
          const res = await tx.query<{ id: string }>(
            `insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ($1, $2, $3::uuid, $4, $5)
             ${upsert ? 'on conflict (bucket_id, name) do update set updated_at = now(), metadata = excluded.metadata' : ''}
             returning id`,
            [bucket, name, owner, owner, JSON.stringify({ size: data.byteLength, mimetype: contentType })],
          );
          return res.rows[0].id;
        });
        await db.query(
          `insert into storage_local.blobs (bucket_id, name, content_type, data) values ($1, $2, $3, $4)
           on conflict (bucket_id, name) do update set content_type = excluded.content_type, data = excluded.data`,
          [bucket, name, contentType, data],
        );
        return respond(200, { Id: id, Key: `${bucket}/${name}` });
      }
      m = /^object\/([^/]+)$/.exec(path);
      if (m && method === 'DELETE') {
        const bucket = m[1];
        const body = (await req.json().catch(() => ({}))) as { prefixes?: string[] };
        const names = (body.prefixes ?? []).map(String);
        const deleted = await withRole(w, (tx) =>
          tx.query<{ name: string }>(`delete from storage.objects where bucket_id = $1 and name = any($2::text[]) returning name`, [bucket, names]),
        );
        for (const r of deleted.rows) await db.query(`delete from storage_local.blobs where bucket_id = $1 and name = $2`, [bucket, r.name]);
        return respond(200, deleted.rows.map((r) => ({ name: r.name, bucket_id: bucket })));
      }
      return storageError(404, 'not_found', `Stockage : ${path} non pris en charge en local`);
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err.code === '42501' || /row-level security/i.test(err.message ?? ''))
        return storageError(403, 'Unauthorized', 'new row violates row-level security policy');
      if (err.code === '23505') return storageError(409, 'Duplicate', 'The resource already exists');
      return storageError(400, 'error', err.message ?? 'Erreur');
    }
  }

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    if (options.latency) await new Promise((r) => setTimeout(r, options.latency));
    const path = url.pathname;
    if (path.startsWith('/storage/v1/')) return handleStorage(path.slice('/storage/v1/'.length), url, req);
    if (path.startsWith('/functions/v1/')) {
      const name = path.slice('/functions/v1/'.length).split('/')[0];
      const fn = options.functions?.[name];
      if (!fn) return respond(404, { code: 'NOT_FOUND', message: `Fonction ${name} absente` });
      return fn(req);
    }
    let body: unknown = undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      const text = await req.text();
      if (text && text !== 'undefined') {
        try {
          body = JSON.parse(text);
        } catch {
          return respond(400, { code: 'PGRST102', message: 'Corps JSON invalide' });
        }
      }
    }
    if (path.startsWith('/auth/v1/')) {
      try {
        return await handleAuth(path.slice('/auth/v1/'.length), url, method, req.headers, (body ?? {}) as Json);
      } catch (e) {
        return pgErrorResponse(e, true);
      }
    }
    if (path.startsWith('/rest/v1/')) return handleRest(path.slice('/rest/v1/'.length), url, method, req.headers, body);
    return respond(404, { message: `Adresse non simulée : ${path}` });
  }

  /** Adaptateur `fetch` (pour un client Supabase branché directement, sans réseau). */
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request && !init ? input : new Request(input as RequestInfo, init);
    return handle(req);
  }) as typeof fetch;

  /** Jeton du dernier lien « mot de passe oublié » envoyé à cette adresse (l'e-mail simulé, pour les tests). */
  const lastRecoveryToken = (email: string) => lastRecovery.get(email.trim().toLowerCase()) ?? null;
  /** Jetons des deux liens du changement d'adresse en cours (les e-mails simulés, pour les tests). */
  const emailChangeTokens = (userId: string) => {
    const c = emailChanges.get(userId);
    return c ? { current: c.current, next: c.next } : null;
  };
  return { handle, fetch: fetchFn, signingSecret, lastRecoveryToken, emailChangeTokens };
}

import { describe, expect, it } from 'vitest';
import { createApiHandler } from '../../server/api/handler.ts';
import { ecoSign, ecoVerify, ECO_WINDOW_MS } from '../../server/api/nous.ts';
import { readEnv } from '../../server/api/util.ts';
import { call } from '../ai/setup.ts';
import { makeEnv, TEST_PUBLIC_KEY, TEST_SERVICE_KEY, TEST_URL } from '../helpers/env.ts';

const SECRET = 'secret-partage-de-test-0123456789abcdef';
const NOUS_URL = 'https://nous.test/functions/v1/cave-sync';
const NOUS_USER = '20000000-0000-4000-8000-000000000001';

type Sent = { action: string; [k: string]: unknown };

/** Environnement : base, faux Supabase, fonction cave-api réelle, faux serveur Nous qui vérifie les signatures. */
async function makeNousEnv(o: { secret?: string; nousReply?: (b: Sent) => Record<string, unknown> } = {}) {
  const functions: Record<string, (req: Request) => Promise<Response>> = {};
  const env = await makeEnv(functions);
  const sent: Sent[] = [];
  const nousFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe(NOUS_URL);
    const body = String(init?.body ?? '');
    const h = new Headers(init?.headers);
    const valid = await ecoVerify(SECRET, body, h.get('x-eco-timestamp'), h.get('x-eco-signature'));
    if (!valid) return new Response(JSON.stringify({ ok: false, code: 'bad_signature' }), { status: 401 });
    const parsed = JSON.parse(body) as Sent;
    sent.push(parsed);
    const reply = o.nousReply?.(parsed) ?? (parsed.action === 'jump.token' ? { ok: true, token_hash: 'jeton-nous' } : { ok: true, applied: true });
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  const handler = createApiHandler(
    {
      supabaseUrl: TEST_URL,
      publishableKey: TEST_PUBLIC_KEY,
      serviceKey: TEST_SERVICE_KEY,
      ecosystemSecret: o.secret === undefined ? SECRET : o.secret || undefined,
      nousFunctionUrl: NOUS_URL,
      nousAppUrl: 'https://cocon.test/',
      caveAppUrl: 'https://cave.test/',
    },
    { fetch: env.fake.fetch, nousFetch },
  );
  functions['cave-api'] = handler;
  /** Requête signée comme le ferait le serveur Nous. */
  async function fromNous(payload: Record<string, unknown>, opts: { secret?: string; at?: number; tamper?: boolean } = {}) {
    const body = JSON.stringify(payload);
    const headers = await ecoSign(opts.secret ?? SECRET, body, opts.at ?? Date.now());
    const res = await handler(
      new Request('http://supabase.test/functions/v1/cave-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: opts.tamper ? body.replace('"rsvp":"yes"', '"rsvp":"no"') : body,
      }),
    );
    return { status: res.status, ...((await res.json()) as Record<string, unknown> & { ok: boolean; code?: string }) } as Record<string, unknown> & {
      status: number;
      ok: boolean;
      code?: string;
    };
  }
  async function cron(token: string) {
    const res = await handler(
      new Request('http://supabase.test/functions/v1/cave-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-cron-token': token },
        body: JSON.stringify({ action: 'nous_flush' }),
      }),
    );
    return { status: res.status, ...((await res.json()) as Record<string, unknown>) };
  }
  return { ...env, handler, sent, fromNous, cron };
}

async function friendsWithEvent(env: Awaited<ReturnType<typeof makeNousEnv>>) {
  const bruno = await env.signUp('Bruno');
  const claire = await env.signUp('Claire');
  const { data: inv } = await bruno.sb.rpc('create_friend_invite');
  await claire.sb.rpc('respond_friend_invite', { p_code: (inv as { code: string }).code, p_accept: true });
  const startsAt = new Date(Date.now() + 5 * 86400_000).toISOString();
  const { data: ev, error } = await bruno.sb.rpc('create_event', {
    p: { kind: 'diner', title: 'Dîner truffes', starts_at: startsAt, place: 'Chez Bruno', budget: 50 },
    p_guests: [claire.id],
  });
  expect(error).toBeNull();
  return { bruno, claire, eventId: (ev as { id: string }).id, startsAt };
}

/** Liaison complète : code créé par Claire dans Cave & Amis, consommé par le serveur Nous. */
async function linkClaire(env: Awaited<ReturnType<typeof makeNousEnv>>, claire: { sb: Parameters<typeof call>[0] }) {
  const start = await call(claire.sb, { action: 'nous_link_start' });
  expect(start).toMatchObject({ ok: true });
  const code = new URL(String(start.url)).searchParams.get('cave_link')!;
  expect(String(start.url)).toMatch(/^https:\/\/cocon\.test\/\?cave_link=[0-9a-f]{32}$/);
  return { code, redeem: await env.fromNous({ action: 'link.redeem', code, nous_user_id: NOUS_USER, nous_display_name: 'Claire (Nous)' }) };
}

describe('signature des échanges', () => {
  it('valide, falsifiée, périmée, mauvais secret', async () => {
    const body = '{"action":"x"}';
    const h = await ecoSign(SECRET, body);
    expect(await ecoVerify(SECRET, body, h['x-eco-timestamp'], h['x-eco-signature'])).toBe(true);
    expect(await ecoVerify(SECRET, body + ' ', h['x-eco-timestamp'], h['x-eco-signature'])).toBe(false);
    expect(await ecoVerify('autre-secret-0123456789abcdef0123456789', body, h['x-eco-timestamp'], h['x-eco-signature'])).toBe(false);
    const old = await ecoSign(SECRET, body, Date.now() - ECO_WINDOW_MS - 1000);
    expect(await ecoVerify(SECRET, body, old['x-eco-timestamp'], old['x-eco-signature'])).toBe(false);
    expect(await ecoVerify(SECRET, body, null, null)).toBe(false);
    expect(await ecoVerify('', body, h['x-eco-timestamp'], h['x-eco-signature'])).toBe(false);
  });

  it('un secret trop court désactive l’intégration', () => {
    expect(readEnv((n) => ({ ECOSYSTEM_SECRET: 'court', NOUS_FUNCTION_URL: NOUS_URL })[n]).ecosystemSecret).toBeUndefined();
    expect(readEnv((n) => ({ ECOSYSTEM_SECRET: SECRET })[n]).ecosystemSecret).toBe(SECRET);
  });

  it('requêtes de Nous refusées sans signature valide ou si l’intégration est désactivée', async () => {
    const env = await makeNousEnv();
    expect(await env.fromNous({ action: 'link.peek', code: 'a'.repeat(32) }, { secret: 'mauvais-secret-0123456789abcdef0123' })).toMatchObject({ status: 401, code: 'bad_signature' });
    expect(await env.fromNous({ action: 'link.peek', code: 'a'.repeat(32) }, { at: Date.now() - 10 * 60_000 })).toMatchObject({ status: 401, code: 'bad_signature' });
    const off = await makeNousEnv({ secret: '' });
    expect(await off.fromNous({ action: 'link.peek', code: 'a'.repeat(32) })).toMatchObject({ status: 503, code: 'integration_disabled' });
    const { claire } = await friendsWithEvent(off);
    expect(await call(claire.sb, { action: 'nous_link_start' })).toMatchObject({ ok: false, code: 'integration_disabled' });
    expect(await call(claire.sb, { action: 'nous_status' })).toMatchObject({ ok: true, enabled: false, link: null });
  });
});

describe('liaison et synchronisation', () => {
  it('parcours complet : aperçu, liaison, envoi, modification, réponse depuis Nous, annulation, déliaison', async () => {
    const env = await makeNousEnv();
    const { bruno, claire, eventId } = await friendsWithEvent(env);

    // Aperçu (pré-remplissage) puis liaison.
    const start = await call(claire.sb, { action: 'nous_link_start' });
    const code = new URL(String(start.url)).searchParams.get('cave_link')!;
    const peek = await env.fromNous({ action: 'link.peek', code });
    expect(peek).toMatchObject({ ok: true, display_name: 'Claire' });
    expect(String(peek.email)).toContain('claire');
    const redeem = await env.fromNous({ action: 'link.redeem', code, nous_user_id: NOUS_USER, nous_display_name: 'Claire (Nous)' });
    expect(redeem).toMatchObject({ ok: true, cave_user_id: claire.id, display_name: 'Claire' });
    expect(await env.fromNous({ action: 'link.redeem', code, nous_user_id: NOUS_USER })).toMatchObject({ ok: false, code: 'invalid_code' });
    expect(await call(claire.sb, { action: 'nous_status' })).toMatchObject({ ok: true, enabled: true, link: { nous_display_name: 'Claire (Nous)', sync_enabled: true } });

    // L'événement à venir part vers Nous.
    expect(await call(claire.sb, { action: 'nous_flush' })).toMatchObject({ ok: true, sent: 1, failed: 0 });
    const first = env.sent.at(-1)!;
    expect(first).toMatchObject({
      action: 'event.upsert',
      cave_user_id: claire.id,
      nous_user_id: NOUS_USER,
      event_id: eventId,
      event: { kind: 'diner', title: 'Dîner truffes', status: 'planned', my_rsvp: 'pending', url: `https://cave.test/#/evenements/${eventId}` },
    });
    expect(JSON.stringify(first)).not.toContain('budget');

    // Modification de l'horaire : nouvelle version, plus grande.
    await bruno.sb.from('events').update({ title: 'Dîner truffes et champagne' }).eq('id', eventId);
    await call(bruno.sb, { action: 'nous_flush' });
    const second = env.sent.at(-1)!;
    expect(second).toMatchObject({ action: 'event.upsert', event: { title: 'Dîner truffes et champagne' } });
    expect(Number(second.version)).toBeGreaterThan(Number(first.version));

    // Réponse donnée dans Nous, puis falsifiée en route : refusée.
    expect(await env.fromNous({ action: 'rsvp', cave_user_id: claire.id, nous_user_id: NOUS_USER, event_id: eventId, rsvp: 'yes' })).toMatchObject({ ok: true, rsvp: 'yes' });
    const { data: me } = await claire.sb.from('event_participants').select('rsvp').eq('event_id', eventId).eq('user_id', claire.id).single();
    expect(me).toEqual({ rsvp: 'yes' });
    expect(await env.fromNous({ action: 'rsvp', cave_user_id: claire.id, nous_user_id: NOUS_USER, event_id: eventId, rsvp: 'yes' }, { tamper: true })).toMatchObject({ status: 401 });
    // Paire inconnue.
    expect(await env.fromNous({ action: 'rsvp', cave_user_id: bruno.id, nous_user_id: NOUS_USER, event_id: eventId, rsvp: 'maybe' })).toMatchObject({ ok: false, code: 'not_linked' });
    // La réponse revient vers Nous (statut à jour).
    await call(claire.sb, { action: 'nous_flush' });
    expect(env.sent.at(-1)).toMatchObject({ action: 'event.upsert', event: { my_rsvp: 'yes' } });

    // Annulation, puis suppression.
    await bruno.sb.rpc('cancel_event', { p_event: eventId });
    await call(bruno.sb, { action: 'nous_flush' });
    expect(env.sent.at(-1)).toMatchObject({ action: 'event.upsert', event: { status: 'cancelled' } });
    expect(await env.fromNous({ action: 'rsvp', cave_user_id: claire.id, nous_user_id: NOUS_USER, event_id: eventId, rsvp: 'no' })).toMatchObject({ ok: false, code: 'event_not_planned' });
    await bruno.sb.rpc('delete_event', { p_event: eventId });
    await call(bruno.sb, { action: 'nous_flush' });
    expect(env.sent.at(-1)).toMatchObject({ action: 'event.remove', event_id: eventId });

    // Déliaison depuis Cave & Amis : Nous est prévenu tout de suite.
    expect(await call(claire.sb, { action: 'nous_unlink' })).toMatchObject({ ok: true });
    expect(env.sent.at(-1)).toMatchObject({ action: 'link.revoked', cave_user_id: claire.id, nous_user_id: NOUS_USER });
    expect(await call(claire.sb, { action: 'nous_status' })).toMatchObject({ link: null });
  });

  it('Nous injoignable : rien n’est perdu, l’envoi repart ; liaison inconnue de Nous : retirée', async () => {
    let down = true;
    let forget = false;
    const env = await makeNousEnv({ nousReply: () => (down ? { ok: false, code: 'internal' } : forget ? { ok: false, code: 'not_linked' } : { ok: true, applied: true }) });
    const { claire } = await friendsWithEvent(env);
    await linkClaire(env, claire);
    expect(await call(claire.sb, { action: 'nous_flush' })).toMatchObject({ sent: 0, failed: 1 });
    const [row] = (await env.db.query<{ attempts: number; last_error: string }>(`select attempts, last_error from nous_outbox where sent_at is null`)).rows;
    expect(row).toMatchObject({ attempts: 1, last_error: 'internal' });
    down = false;
    await env.db.query(`update nous_outbox set next_attempt_at = now()`);
    expect(await call(claire.sb, { action: 'nous_flush' })).toMatchObject({ sent: 1, failed: 0 });

    forget = true;
    await env.db.query(`update events set title = 'Changé'`);
    await call(claire.sb, { action: 'nous_flush' });
    expect((await env.db.query(`select 1 from nous_links`)).rows).toHaveLength(0);
    // Retirée sans renvoyer d'annonce à Nous.
    expect((await env.db.query(`select 1 from nous_outbox where sent_at is null`)).rows).toHaveLength(0);
  });

  it('tâche planifiée : jeton exigé', async () => {
    const env = await makeNousEnv();
    const { claire } = await friendsWithEvent(env);
    await linkClaire(env, claire);
    expect(await env.cron('mauvais-jeton')).toMatchObject({ status: 403, ok: false });
    const token = (await env.db.query<{ t: string }>(`select cron_token as t from nous_config`)).rows[0].t;
    expect(await env.cron(token)).toMatchObject({ status: 200, ok: true, sent: 1 });
  });

  it('connexion directe dans les deux sens, seulement pour une paire liée', async () => {
    const env = await makeNousEnv();
    const { claire, eventId } = await friendsWithEvent(env);
    expect(await call(claire.sb, { action: 'nous_jump' })).toMatchObject({ ok: false, code: 'not_linked' });
    await linkClaire(env, claire);

    // Cave & Amis → Nous : l'adresse porte le jeton fourni par Nous.
    const jump = await call(claire.sb, { action: 'nous_jump', next: '#/agenda?date=2026-11-14' });
    expect(jump).toMatchObject({ ok: true });
    const u = new URL(String(jump.url));
    expect(u.origin + u.pathname).toBe('https://cocon.test/');
    expect(Object.fromEntries(u.searchParams)).toEqual({ auth: 'link', token_hash: 'jeton-nous', next: '#/agenda?date=2026-11-14' });
    // Une adresse de retour invalide est ignorée.
    const bad = await call(claire.sb, { action: 'nous_jump', next: 'https://ailleurs.test' });
    expect(new URL(String(bad.url)).searchParams.get('next')).toBeNull();

    // Nous → Cave & Amis : jeton de lien magique, utilisable une seule fois.
    expect(await env.fromNous({ action: 'jump.token', cave_user_id: claire.id, nous_user_id: '20000000-0000-4000-8000-000000000999' })).toMatchObject({ ok: false, code: 'not_linked' });
    const tok = await env.fromNous({ action: 'jump.token', cave_user_id: claire.id, nous_user_id: NOUS_USER });
    expect(tok).toMatchObject({ ok: true });
    const fresh = env.client();
    const { data, error } = await fresh.auth.verifyOtp({ type: 'magiclink', token_hash: String(tok.token_hash) });
    expect(error).toBeNull();
    expect(data.user?.id).toBe(claire.id);
    const { data: seen } = await fresh.from('events').select('id');
    expect(seen).toEqual([{ id: eventId }]);
    const again = await env.client().auth.verifyOtp({ type: 'magiclink', token_hash: String(tok.token_hash) });
    expect(again.error).not.toBeNull();
  });

  it('connexion directe refusée par Nous (« jump_disabled ») : simple échec, la liaison reste', async () => {
    let jump: Record<string, unknown> = { ok: false, code: 'jump_disabled' };
    const env = await makeNousEnv({ nousReply: (b) => (b.action === 'jump.token' ? jump : { ok: true, applied: true }) });
    const { claire } = await friendsWithEvent(env);
    await linkClaire(env, claire);
    // Pas de jeton : l'application ouvre alors simplement le site de Nous (openNous).
    const res = await call(claire.sb, { action: 'nous_jump', next: '#/agenda' });
    expect(res).toMatchObject({ ok: false, code: 'nous_unavailable' });
    expect(res.url).toBeUndefined();
    expect(env.sent.at(-1)).toMatchObject({ action: 'jump.token', cave_user_id: claire.id, nous_user_id: NOUS_USER });
    // Ni déliaison, ni annonce de déliaison à Nous, ni erreur au journal de l'administrateur.
    expect(await call(claire.sb, { action: 'nous_status' })).toMatchObject({ ok: true, link: { nous_display_name: 'Claire (Nous)' } });
    expect((await env.db.query(`select 1 from nous_outbox where op = 'unlink'`)).rows).toHaveLength(0);
    expect((await env.db.query(`select 1 from ai_errors`)).rows).toHaveLength(0);
    // Connexion directe réactivée dans Nous : elle refonctionne.
    jump = { ok: true, token_hash: 'jeton-nous' };
    expect(await call(claire.sb, { action: 'nous_jump' })).toMatchObject({ ok: true });
  });

  it('suspendre la synchronisation, puis la reprendre', async () => {
    const env = await makeNousEnv();
    const { bruno, claire, eventId } = await friendsWithEvent(env);
    await linkClaire(env, claire);
    await call(claire.sb, { action: 'nous_flush' });
    const count = env.sent.length;
    expect(await call(claire.sb, { action: 'nous_set_sync', enabled: false })).toMatchObject({ ok: true, sync_enabled: false });
    await bruno.sb.from('events').update({ place: 'Ailleurs' }).eq('id', eventId);
    await call(bruno.sb, { action: 'nous_flush' });
    expect(env.sent.length).toBe(count);
    expect(await call(claire.sb, { action: 'nous_set_sync', enabled: true })).toMatchObject({ ok: true, sync_enabled: true });
    expect(env.sent.at(-1)).toMatchObject({ action: 'event.upsert', event: { place: 'Ailleurs' } });
  });
});

describe('envoi immédiat demandé par l’application (audit, F4)', () => {
  it('20 par 10 minutes et par personne ; au-delà, la tâche planifiée prend le relais', async () => {
    const env = await makeNousEnv();
    const { bruno, claire, eventId } = await friendsWithEvent(env);
    await linkClaire(env, claire);
    for (let i = 0; i < 20; i++) expect(await call(bruno.sb, { action: 'nous_flush' })).toMatchObject({ ok: true, failed: 0 });
    const count = env.sent.length;
    await bruno.sb.from('events').update({ place: 'Ailleurs' }).eq('id', eventId);
    expect(await call(bruno.sb, { action: 'nous_flush' })).toMatchObject({ ok: true, sent: 0, failed: 0, later: true });
    expect(env.sent.length).toBe(count);
    // La tâche planifiée, elle, n'est pas limitée.
    const token = (await env.db.query<{ cron_token: string }>(`select cron_token from nous_config where id = 1`)).rows[0].cron_token;
    expect(await env.cron(token)).toMatchObject({ status: 200, ok: true, sent: 1 });
    expect(env.sent.at(-1)).toMatchObject({ action: 'event.upsert', event: { place: 'Ailleurs' } });
  });
});

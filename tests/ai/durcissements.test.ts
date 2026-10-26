import { describe, expect, it } from 'vitest';
import { ANTHROPIC_API_URL, makeClient } from '../../server/api/claude.ts';
import { MAX_BODY_BYTES } from '../../server/api/handler.ts';
import { corsHeaders, readEnv, SITE_ORIGIN, type ApiEnv } from '../../server/api/util.ts';
import { TEST_ANTHROPIC_KEY } from '../helpers/anthropicMock.ts';
import { TEST_URL } from '../helpers/env.ts';
import { call, makeAiEnv } from './setup.ts';

const URL_API = `${TEST_URL}/functions/v1/cave-api`;
const BASE: ApiEnv = { supabaseUrl: TEST_URL, publishableKey: 'p', serviceKey: 's' };
const allowed = (env: ApiEnv, origin: string) =>
  corsHeaders(env, new Request(URL_API, { method: 'OPTIONS', headers: { Origin: origin } }))['Access-Control-Allow-Origin'];

describe('CORS de cave-api (audit, F6)', () => {
  it('par défaut, seule l’origine du site ; ALLOWED_ORIGINS pour en choisir d’autres ; « * » seulement sur demande', () => {
    expect(allowed(BASE, 'https://piege.example')).toBe(SITE_ORIGIN);
    expect(allowed(BASE, SITE_ORIGIN)).toBe(SITE_ORIGIN);
    // CAVE_APP_URL (avec ou sans chemin) donne l'origine par défaut.
    expect(allowed({ ...BASE, caveAppUrl: 'https://cave.test/app/' }, 'https://cave.test')).toBe('https://cave.test');
    const listed = readEnv((n) => ({ ALLOWED_ORIGINS: 'https://a.test/, https://b.test' })[n]);
    expect(allowed(listed, 'https://b.test')).toBe('https://b.test');
    expect(allowed(listed, 'https://c.test')).toBe('https://a.test');
    // Serveur local et tests d'interface : toutes les origines, comme le reste du serveur local.
    expect(allowed({ ...BASE, allowedOrigins: ['*'] }, 'http://127.0.0.1:4319')).toBe('*');
  });

  it('les réponses de la fonction portent ces en-têtes, préparation (OPTIONS) comprise', async () => {
    const env = await makeAiEnv();
    const pre = await env.handler(new Request(URL_API, { method: 'OPTIONS', headers: { Origin: 'https://piege.example' } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe(SITE_ORIGIN);
    expect(pre.headers.get('vary')).toBe('Origin');
    const res = await env.handler(new Request(URL_API, { method: 'POST', headers: { Origin: SITE_ORIGIN }, body: '{}' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('access-control-allow-origin')).toBe(SITE_ORIGIN);
  });
});

describe('taille des requêtes (audit, F9)', () => {
  /** Corps sans fin, lu morceau par morceau : compte ce que la fonction a réellement lu. */
  function endless() {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled += 1;
        c.enqueue(new TextEncoder().encode(' '.repeat(50_000)));
        if (pulled > 400) c.close();
      },
    });
    return { stream, pulled: () => pulled };
  }

  it('refusée d’après la taille annoncée, ou dès que la lecture dépasse la limite', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    const token = (await bruno.sb.auth.getSession()).data.session!.access_token;
    const send = (body: BodyInit, headers: Record<string, string> = {}) =>
      env.handler(new Request(URL_API, { method: 'POST', headers: { Authorization: `Bearer ${token}`, ...headers }, body, duplex: 'half' } as RequestInit));

    const announced = endless();
    const a = await send(announced.stream, { 'Content-Length': String(MAX_BODY_BYTES + 1) });
    expect(a.status).toBe(413);
    expect(await a.json()).toMatchObject({ ok: false, code: 'message_too_long' });
    expect(announced.pulled()).toBeLessThanOrEqual(1);

    const streamed = endless();
    const b = await send(streamed.stream);
    expect(b.status).toBe(413);
    expect(streamed.pulled()).toBeLessThan(10);

    // Requête ordinaire : acceptée.
    expect(await (await send(JSON.stringify({ action: 'status' }))).json()).toMatchObject({ ok: true });
  });

  it('requêtes des tâches planifiées et de Nous : 64 Ko au plus, avant toute vérification', async () => {
    const env = await makeAiEnv();
    const cronToken = (await env.db.query<{ cron_token: string }>(`select cron_token from nous_config where id = 1`)).rows[0].cron_token;
    const big = JSON.stringify({ action: 'retention_purge', pad: 'x'.repeat(70_000) });
    const res = await env.handler(new Request(URL_API, { method: 'POST', headers: { 'x-cron-token': cronToken }, body: big }));
    expect(res.status).toBe(413);
  });
});

describe('journal des erreurs (audit, F9)', () => {
  it('erreur du service d’IA : statut, type et message gardés, jamais le texte saisi', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    env.anthropic.reply({ kind: 'error', status: 400, type: 'invalid_request_error', message: 'messages.0.content: texte refusé "Ma question très privée" (bruno@exemple.fr)' });
    expect(await call(bruno.sb, { action: 'chat', message: 'Ma question très privée' })).toMatchObject({ ok: false, code: 'bad_request' });
    expect((await env.db.query(`select code, detail from ai_errors`)).rows).toEqual([
      { code: 'bad_request', detail: 'Erreur 400 : invalid_request_error : messages.0.content: texte refusé "…" ([adresse])' },
    ]);
  });
});

describe('adresse de l’API Anthropic (audit, F11)', () => {
  it('ANTHROPIC_BASE_URL est ignorée en ligne : la clé ne part que vers l’adresse officielle', () => {
    const vars: Record<string, string> = { SUPABASE_URL: 'https://projet.supabase.co', ANTHROPIC_API_KEY: TEST_ANTHROPIC_KEY, ANTHROPIC_BASE_URL: 'https://piege.example' };
    const env = readEnv((n) => vars[n]);
    expect(env.anthropicBaseUrl).toBeUndefined();
    // Même si la variable est présente dans l'environnement du serveur (la bibliothèque la lirait d'elle-même).
    const before = process.env.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = 'https://piege.example';
    try {
      expect(makeClient(env).baseURL).toBe(ANTHROPIC_API_URL);
      // Tests et serveur local : adresse donnée explicitement (faux serveur Anthropic).
      expect(makeClient({ ...env, anthropicBaseUrl: 'http://127.0.0.1:54398' }).baseURL).toBe('http://127.0.0.1:54398');
    } finally {
      if (before === undefined) delete process.env.ANTHROPIC_BASE_URL;
      else process.env.ANTHROPIC_BASE_URL = before;
    }
  });
});

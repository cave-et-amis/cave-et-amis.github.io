import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readConfig } from '../src/config.ts';
import { Api } from '../src/data/api.ts';
import { loadTurnstile, TURNSTILE_SCRIPT, type Turnstile, type TurnstileHost } from '../src/data/turnstile.ts';
import { toMessage } from '../src/domain/errors.ts';
import { contentSecurityPolicy, exportConfig, type ExportConfig } from '../vite.config.ts';
import { makeEnv, TEST_PUBLIC_KEY, TEST_URL, type Env } from './helpers/env.ts';

// Aucun test ne charge Cloudflare : valeurs de test évidentes, script simulé, faux serveur Supabase.
const SITE_KEY = 'cle-de-site-de-test';
const ROOT = join(import.meta.dirname, '..');
const CLOUDFLARE = 'https://challenges.cloudflare.com';

describe('configuration : clé de site Turnstile facultative', () => {
  const loc = { protocol: 'https:', hostname: 'cave.test' };
  const runtime = { supabaseUrl: 'https://abcdefgh.supabase.co', supabaseKey: 'sb_publishable_abc' };

  it('lue dans config.js ou les variables VITE_… ; absente, vide ou valeur d’exemple : pas de contrôle', () => {
    expect(readConfig({}, runtime, loc)).toMatchObject({ mode: 'supabase', turnstileSiteKey: null });
    expect(readConfig({}, { ...runtime, turnstileSiteKey: ' ' }, loc)).toMatchObject({ turnstileSiteKey: null });
    expect(readConfig({}, { ...runtime, turnstileSiteKey: '0x4AAAAAAAxxxxxxxx' }, loc)).toMatchObject({ turnstileSiteKey: null });
    expect(readConfig({}, { ...runtime, turnstileSiteKey: ` ${SITE_KEY} ` }, loc)).toMatchObject({ turnstileSiteKey: SITE_KEY });
    expect(readConfig({ VITE_TURNSTILE_SITE_KEY: SITE_KEY }, runtime, loc)).toMatchObject({ turnstileSiteKey: SITE_KEY });
  });

  it('serveur local : jamais de contrôle anti-robots', () => {
    expect(readConfig({ VITE_LOCAL_API: '54321' }, { ...runtime, turnstileSiteKey: SITE_KEY }, loc)).toMatchObject({ local: true, turnstileSiteKey: null });
  });
});

describe('jeton anti-robots transmis à Supabase (faux serveur local)', () => {
  let env: Env;
  /** Appels de connexion envoyés (inscription, connexion, mot de passe oublié) et leur jeton. */
  const sent: [string, unknown][] = [];
  let n = 0;
  beforeAll(async () => {
    env = await makeEnv();
  });

  /** Client Supabase qui note chaque appel ; `refused` : jeton que le serveur rejette, comme Supabase avec un mauvais jeton. */
  function client(refused?: string) {
    return createClient(TEST_URL, TEST_PUBLIC_KEY, {
      global: {
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          const path = new URL(input instanceof Request ? input.url : String(input)).pathname.replace('/auth/v1/', '');
          if (init?.method === 'POST' && ['signup', 'token', 'recover'].includes(path)) {
            const token = (JSON.parse(String(init.body)) as { gotrue_meta_security?: { captcha_token?: string } }).gotrue_meta_security?.captcha_token;
            sent.push([path, token]);
            if (refused && token === refused) {
              const msg = 'captcha protection: request disallowed (invalid-input-response)';
              return new Response(JSON.stringify({ code: 'captcha_failed', error_code: 'captcha_failed', msg, message: msg }), {
                status: 400,
                headers: { 'content-type': 'application/json' },
              });
            }
          }
          return env.fake.fetch(input, init);
        }) as typeof fetch,
      },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `captcha-${++n}` },
    });
  }
  const email = () => `claire.${crypto.randomUUID().slice(0, 6)}@exemple.test`;
  /** « Mot de passe oublié » lit l'adresse de la page pour le lien envoyé. */
  async function inPage<T>(run: () => Promise<T>) {
    vi.stubGlobal('window', { location: { origin: 'https://cave.test', pathname: '/' } });
    try {
      return await run();
    } finally {
      vi.unstubAllGlobals();
    }
  }

  it('avec une clé : chaque appel transmet son propre jeton, que le serveur local accepte et ignore', async () => {
    const api = new Api(client(), { captchaSiteKey: SITE_KEY });
    const address = email();
    sent.length = 0;
    await api.signUp('Claire', address, 'motdepasse1', {}, 'jeton-inscription');
    await api.signIn(address, 'motdepasse1', 'jeton-connexion');
    await inPage(() => api.resetPassword(address, 'jeton-oubli'));
    await api.verifyPassword('motdepasse1', 'jeton-verification');
    expect(sent).toEqual([
      ['signup', 'jeton-inscription'],
      ['token', 'jeton-connexion'],
      ['recover', 'jeton-oubli'],
      ['token', 'jeton-verification'],
    ]);
  });

  it('avec une clé mais sans jeton : rien n’est envoyé, et le message l’explique', async () => {
    const api = new Api(client(), { captchaSiteKey: SITE_KEY });
    sent.length = 0;
    const pending = { code: 'captcha_pending' };
    await expect(api.signUp('Claire', email(), 'motdepasse1')).rejects.toMatchObject(pending);
    await expect(api.signIn(email(), 'motdepasse1', null)).rejects.toMatchObject(pending);
    await expect(inPage(() => api.resetPassword(email()))).rejects.toMatchObject(pending);
    await expect(api.verifyPassword('motdepasse1')).rejects.toMatchObject(pending);
    expect(sent).toEqual([]);
    expect(toMessage(await api.signIn(email(), 'motdepasse1').catch((e: unknown) => e))).toMatch(/contrôle anti-robots n’est pas terminé/);
  });

  it('sans clé : aucun jeton transmis, même si on en passe un', async () => {
    const api = new Api(client());
    const address = email();
    sent.length = 0;
    await api.signUp('Marc', address, 'motdepasse1', {}, 'jeton-inutile');
    await api.signIn(address, 'motdepasse1');
    await inPage(() => api.resetPassword(address, 'jeton-inutile'));
    await api.verifyPassword('motdepasse1');
    expect(sent).toEqual([
      ['signup', undefined],
      ['token', undefined],
      ['recover', undefined],
      ['token', undefined],
    ]);
  });

  it('jeton refusé par le serveur : message du contrôle anti-robots, jamais « mot de passe incorrect »', async () => {
    const api = new Api(client('jeton-refuse'), { captchaSiteKey: SITE_KEY });
    const address = email();
    await api.signUp('Lina', address, 'motdepasse1', {}, 'jeton-ok');
    const refused = await api.signIn(address, 'motdepasse1', 'jeton-refuse').catch((e: unknown) => e);
    expect(refused).toMatchObject({ code: 'captcha_failed' });
    expect(toMessage(refused)).toMatch(/contrôle anti-robots n’a pas été validé/);
    await expect(api.verifyPassword('motdepasse1', 'jeton-refuse')).rejects.toMatchObject({ code: 'captcha_failed' });
    await expect(api.verifyPassword('mauvais-mot-de-passe1', 'jeton-ok')).rejects.toMatchObject({ code: 'invalid_password' });
  });
});

describe('chargement du script de Cloudflare (simulé : aucun accès au réseau)', () => {
  type FakeScript = { src: string; onload: (() => void) | null; onerror: (() => void) | null; removed: boolean; remove(): void };
  function fakePage() {
    const scripts: FakeScript[] = [];
    const host: TurnstileHost = {
      document: {
        createElement: () => {
          const script: FakeScript = { src: '', onload: null, onerror: null, removed: false, remove: () => (script.removed = true) };
          scripts.push(script);
          return script;
        },
        head: { appendChild: (node) => node },
      },
    };
    return { host, scripts };
  }
  const widget: Turnstile = { render: () => 'w1', reset: () => undefined, remove: () => undefined };

  it('un seul script, à l’adresse de Cloudflare, en rendu explicite ; nouvel essai possible après un échec', async () => {
    const { host, scripts } = fakePage();
    const first = loadTurnstile(host);
    const same = loadTurnstile(host);
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
    scripts[0].onerror?.();
    await expect(first).rejects.toThrow('turnstile_unavailable');
    await expect(same).rejects.toThrow('turnstile_unavailable');
    expect(scripts[0].removed).toBe(true);

    const retry = loadTurnstile(host);
    expect(scripts).toHaveLength(2);
    host.turnstile = widget;
    scripts[1].onload?.();
    await expect(retry).resolves.toBe(widget);
    await expect(loadTurnstile(host)).resolves.toBe(widget);
    expect(scripts).toHaveLength(2);
  });

  it('délai dépassé ou script chargé sans le contrôle : échec, puis nouvel essai', async () => {
    const { host, scripts } = fakePage();
    await expect(loadTurnstile(host, 5)).rejects.toThrow('turnstile_unavailable');
    const empty = loadTurnstile(host);
    scripts[1].onload?.();
    await expect(empty).rejects.toThrow('turnstile_unavailable');
    expect(scripts.map((s) => s.removed)).toEqual([true, true]);
  });
});

describe('politique de sécurité de l’export (vite.config.ts)', () => {
  const site: ExportConfig = { supabaseUrl: 'https://abcdefgh.supabase.co', turnstileSiteKey: null };
  const sources = (csp: string, name: string) => csp.split('; ').find((d) => d.split(' ')[0] === name)?.split(' ').slice(1);

  it('sans clé : rien de Cloudflare ; la politique d’avant, à l’adresse exacte du projet près', () => {
    expect(contentSecurityPolicy(site)).toBe(
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://abcdefgh.supabase.co https://images.openfoodfacts.org; font-src 'self' data:; connect-src 'self' https://abcdefgh.supabase.co wss://abcdefgh.supabase.co; worker-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
    );
    expect(contentSecurityPolicy(site, 'meta')).not.toContain('cloudflare');
  });

  it('avec une clé : le script et le cadre de Cloudflare, rien d’autre', () => {
    const csp = contentSecurityPolicy({ ...site, turnstileSiteKey: SITE_KEY });
    expect(sources(csp, 'script-src')).toEqual(["'self'", "'wasm-unsafe-eval'", CLOUDFLARE]);
    expect(sources(csp, 'frame-src')).toEqual([CLOUDFLARE]);
    expect(csp.match(/cloudflare/g)).toHaveLength(2);
    expect(new URL(TURNSTILE_SCRIPT).origin).toBe(CLOUDFLARE);
  });

  it('Supabase : seulement l’adresse exacte du projet configuré, jamais de joker', () => {
    for (const where of ['header', 'meta'] as const) {
      const csp = contentSecurityPolicy({ ...site, supabaseUrl: 'https://abcdefgh.supabase.co/' }, where);
      expect(sources(csp, 'connect-src')).toEqual(["'self'", 'https://abcdefgh.supabase.co', 'wss://abcdefgh.supabase.co']);
      expect(sources(csp, 'img-src')).toEqual(["'self'", 'data:', 'blob:', 'https://abcdefgh.supabase.co', 'https://images.openfoodfacts.org']);
      expect(csp).not.toContain('*');
    }
    expect(sources(contentSecurityPolicy({ supabaseUrl: 'http://127.0.0.1:54321', turnstileSiteKey: null }), 'connect-src')).toEqual([
      "'self'",
      'http://127.0.0.1:54321',
      'ws://127.0.0.1:54321',
    ]);
    expect(contentSecurityPolicy({ supabaseUrl: null, turnstileSiteKey: null })).not.toContain('supabase');
    expect(() => contentSecurityPolicy({ supabaseUrl: 'abcdefgh.supabase.co', turnstileSiteKey: null })).toThrow(/non valable/);
  });

  it('balise <meta> : sans frame-ancestors (ignoré par les navigateurs dans une balise)', () => {
    expect(contentSecurityPolicy(site, 'meta')).not.toContain('frame-ancestors');
    expect(sources(contentSecurityPolicy(site), 'frame-ancestors')).toEqual(["'none'"]);
  });

  it('configuration de l’export : variables VITE_… d’abord, puis le fichier ; commentaires et valeurs d’exemple ignorés', () => {
    const file = "window.CAVE_CONFIG = {\n  supabaseUrl: 'https://abcdefgh.supabase.co',\n  // turnstileSiteKey: 'en-commentaire',\n  turnstileSiteKey: '',\n};\n";
    expect(exportConfig({}, file)).toEqual(site);
    expect(exportConfig({}, file.replace("turnstileSiteKey: ''", `turnstileSiteKey: '${SITE_KEY}'`))).toEqual({ ...site, turnstileSiteKey: SITE_KEY });
    expect(exportConfig({ VITE_TURNSTILE_SITE_KEY: SITE_KEY, VITE_SUPABASE_URL: 'https://autre.supabase.co' }, file)).toEqual({
      supabaseUrl: 'https://autre.supabase.co',
      turnstileSiteKey: SITE_KEY,
    });
    expect(exportConfig({}, readFileSync(join(ROOT, 'config.production.example.js'), 'utf8'))).toEqual({ supabaseUrl: null, turnstileSiteKey: null });
  });
});

describe('contrôle de l’export (scripts/check-dist.mjs)', () => {
  let dir: string;
  let n = 0;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'cave-check-dist-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const config = (key = '') =>
    `window.CAVE_CONFIG = {\n  supabaseUrl: 'https://abcdefgh.supabase.co',\n  supabaseKey: 'sb_publishable_test',\n  turnstileSiteKey: '${key}',\n};\n`;
  const site: ExportConfig = { supabaseUrl: 'https://abcdefgh.supabase.co', turnstileSiteKey: null };
  const built = (s: ExportConfig): [string, string] => [contentSecurityPolicy(s, 'meta'), contentSecurityPolicy(s)];

  /** Export minimal avec ces politiques, vérifié avec ce fichier de configuration (variables VITE_… écartées). */
  function check(configText: string, [meta, header]: [string | null, string]) {
    const dist = join(dir, `dist-${++n}`);
    const csp = meta === null ? '' : `\n    <meta http-equiv="Content-Security-Policy" content="${meta}" />`;
    mkdirSync(dist);
    writeFileSync(join(dist, 'index.html'), `<!doctype html>\n<html lang="fr">\n  <head>\n    <meta charset="UTF-8" />${csp}\n  </head>\n</html>\n`);
    writeFileSync(join(dist, '_headers'), `/*\n  Content-Security-Policy: ${header}\n  Referrer-Policy: no-referrer\n`);
    for (const f of ['sw.js', 'manifest.webmanifest', 'asset-manifest.json', 'icon-192.png', 'icon-512.png']) writeFileSync(join(dist, f), '');
    const configFile = join(dir, `config-${n}.js`);
    writeFileSync(configFile, configText);
    const envNoVite = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith('VITE_')));
    const res = spawnSync(process.execPath, [join(ROOT, 'scripts', 'check-dist.mjs'), dist, configFile], { encoding: 'utf8', env: envNoVite });
    return { ok: res.status === 0, out: `${res.stdout}${res.stderr}` };
  }

  it('accepte la politique construite pour la configuration, avec ou sans clé Turnstile', () => {
    const without = check(config(), built(site));
    expect(without).toMatchObject({ ok: true });
    expect(without.out).toMatch(/anti-robots \(Cloudflare Turnstile\) : non configuré/);
    const withKey = check(config(SITE_KEY), built({ ...site, turnstileSiteKey: SITE_KEY }));
    expect(withKey).toMatchObject({ ok: true });
    expect(withKey.out).toMatch(/anti-robots \(Cloudflare Turnstile\) : activé/);
  });

  it('refuse Cloudflare sans clé, et une clé sans Cloudflare dans la politique', () => {
    const extra = check(config(), built({ ...site, turnstileSiteKey: SITE_KEY }));
    expect(extra.ok).toBe(false);
    expect(extra.out).toContain(`script-src autorise ${CLOUDFLARE}`);
    expect(extra.out).toContain("frame-src n'est pas prévu");
    const missing = check(config(SITE_KEY), built(site));
    expect(missing.ok).toBe(false);
    expect(missing.out).toContain(`script-src n'autorise pas ${CLOUDFLARE}`);
    expect(missing.out).toContain(`frame-src n'autorise pas ${CLOUDFLARE}`);
  });

  it('refuse le joker *.supabase.co, un autre projet, toute autre source et une politique absente', () => {
    const [meta, header] = built(site);
    const wildcard = check(config(), [meta.replaceAll('https://abcdefgh.supabase.co', 'https://*.supabase.co'), header]);
    expect(wildcard.ok).toBe(false);
    expect(wildcard.out).toContain('connect-src autorise https://*.supabase.co');
    expect(check(config(), built({ ...site, supabaseUrl: 'https://autreprojet.supabase.co' })).ok).toBe(false);
    const script = check(config(), [meta.replace("script-src 'self'", "script-src 'self' https://cdn.exemple.test"), header]);
    expect(script.ok).toBe(false);
    expect(script.out).toContain('script-src autorise https://cdn.exemple.test');
    expect(check(config(), [meta, header.replace("; frame-ancestors 'none'", '')]).out).toContain("_headers : frame-ancestors n'autorise pas 'none'");
    expect(check(config(), [null, header]).out).toContain('Politique de sécurité absente de index.html');
  });
});

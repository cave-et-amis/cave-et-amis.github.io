import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { makeEnv, TEST_PUBLIC_KEY, TEST_SERVICE_KEY, TEST_URL } from '../helpers/env.ts';

const root = join(import.meta.dirname, '..', '..');

describe('fonction regroupée pour Supabase (supabase/functions/cave-api/index.ts)', () => {
  it('est à jour, ne contient aucune clé et répond comme la version de développement', async () => {
    const bundled = readFileSync(join(root, 'supabase', 'functions', 'cave-api', 'index.ts'), 'utf8');
    expect(bundled).not.toMatch(/sk-ant-[A-Za-z0-9]/);
    expect(bundled).toContain('npm:@anthropic-ai/sdk@');
    // Exécution dans Node : imports npm: ramenés aux paquets installés, Deno simulé.
    const dir = join(root, 'reports', 'function-check');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `index-${Date.now()}.mjs`);
    writeFileSync(file, bundled.replace(/from "npm:(@[^@"]+\/[^@"]+)@[^"]+"/g, 'from "$1"'));
    const functions: Record<string, (req: Request) => Promise<Response>> = {};
    const env = await makeEnv(functions);
    const vars: Record<string, string> = {
      SUPABASE_URL: TEST_URL,
      SUPABASE_ANON_KEY: TEST_PUBLIC_KEY,
      SUPABASE_SERVICE_ROLE_KEY: TEST_SERVICE_KEY,
    };
    let served: ((req: Request) => Promise<Response>) | null = null;
    const realFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>).Deno = {
      env: { get: (n: string) => vars[n] },
      serve: (h: (req: Request) => Promise<Response>) => {
        served = h;
      },
    };
    // Les clients Supabase de la fonction passent par le fetch global : on le branche sur le faux serveur.
    globalThis.fetch = env.fake.fetch;
    try {
      await import(pathToFileURL(file).href);
      expect(served).not.toBeNull();
      functions['cave-api'] = served!;
      const bruno = await env.signUp('Bruno');
      const { data } = await bruno.sb.functions.invoke('cave-api', { body: { action: 'status' } });
      expect(data).toMatchObject({ ok: true, configured: false });
      const { data: chat } = await bruno.sb.functions.invoke('cave-api', { body: { action: 'chat', message: 'Bonjour' } });
      expect(chat).toMatchObject({ ok: false, code: 'ai_not_configured' });
    } finally {
      globalThis.fetch = realFetch;
      delete (globalThis as Record<string, unknown>).Deno;
    }
  });
});

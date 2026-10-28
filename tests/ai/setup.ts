import type { SupabaseClient } from '@supabase/supabase-js';
import { createApiHandler } from '../../server/api/handler.ts';
import { createAnthropicMock, TEST_ANTHROPIC_KEY } from '../helpers/anthropicMock.ts';
import { makeEnv, TEST_PUBLIC_KEY, TEST_SERVICE_KEY, TEST_URL } from '../helpers/env.ts';

/**
 * Environnement complet : base, faux Supabase, fonction serveur réelle, faux Anthropic (tests uniquement).
 * `serverFetch` : enveloppe les appels de la fonction serveur au faux Supabase (pour simuler une panne).
 * `captcha` : protection CAPTCHA simulée par le faux Supabase.
 */
export async function makeAiEnv(
  o: { withKey?: boolean; webFetch?: typeof fetch; pushFetch?: typeof fetch; serverFetch?: (base: typeof fetch) => typeof fetch; captcha?: boolean; now?: () => Date } = {},
) {
  const functions: Record<string, (req: Request) => Promise<Response>> = {};
  const env = await makeEnv(functions, { captcha: o.captcha });
  const anthropic = createAnthropicMock();
  const handler = createApiHandler(
    {
      supabaseUrl: TEST_URL,
      publishableKey: TEST_PUBLIC_KEY,
      serviceKey: TEST_SERVICE_KEY,
      anthropicKey: o.withKey === false ? undefined : TEST_ANTHROPIC_KEY,
      anthropicBaseUrl: 'http://anthropic.test',
    },
    { fetch: o.serverFetch ? o.serverFetch(env.fake.fetch) : env.fake.fetch, anthropicFetch: anthropic.fetch, webFetch: o.webFetch, pushFetch: o.pushFetch, now: o.now },
  );
  functions['cave-api'] = handler;
  return { ...env, anthropic, handler };
}

export type AiEnv = Awaited<ReturnType<typeof makeAiEnv>>;

export async function call(sb: SupabaseClient, body: Record<string, unknown>) {
  const { data, error } = await sb.functions.invoke('cave-api', { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const payload = ctx ? await ctx.json().catch(() => null) : null;
    return { status: ctx?.status ?? 0, ...(payload ?? { ok: false, code: 'network' }) } as Record<string, unknown> & { ok: boolean; code?: string };
  }
  return data as Record<string, unknown> & { ok: boolean; code?: string };
}

export async function setSettings(env: AiEnv, patch: Record<string, unknown>) {
  const sets = Object.entries(patch).map(([k], i) => `${k} = $${i + 1}`);
  await env.db.query(`update ai_settings set ${sets.join(', ')} where id = 1`, Object.values(patch));
}

export async function usageRows(env: AiEnv) {
  return (await env.db.query<{ action: string; status: string; cost_usd: string; reserved_usd: string; api_calls: number; error_code: string | null }>(
    `select action, status, cost_usd, reserved_usd, api_calls, error_code from ai_usage order by created_at`,
  )).rows;
}

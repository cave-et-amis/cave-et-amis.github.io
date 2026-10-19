import { describe, expect, it } from 'vitest';
import { text, TEST_ANTHROPIC_KEY } from '../helpers/anthropicMock.ts';
import { call, makeAiEnv, setSettings, usageRows } from './setup.ts';

const ok = { kind: 'message' as const, content: [text('Réponse')] };

describe('assistant : quotas, budget et erreurs', () => {
  it('quota quotidien par personne : blocage avec un message simple', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    await setSettings(env, { default_daily_requests: 1 });
    env.anthropic.reply(ok, ok);
    expect((await call(bruno.sb, { action: 'chat', message: 'Un' })).ok).toBe(true);
    const second = await call(bruno.sb, { action: 'chat', message: 'Deux' });
    expect(second).toMatchObject({ ok: false, code: 'quota_daily' });
    expect(String(second.message)).toMatch(/aujourd’hui/);
    expect(env.anthropic.requests).toHaveLength(1);
    // Quota propre à une personne (administration) : priorité sur la valeur par défaut.
    const claire = await env.signUp('Claire');
    await env.db.query(`insert into ai_user_limits (user_id, daily_requests) values ($1, 0)`, [claire.id]);
    expect(await call(claire.sb, { action: 'chat', message: 'Un' })).toMatchObject({ ok: false, code: 'quota_daily' });
  });

  it('budget global : nouveaux appels bloqués quand la limite serait dépassée', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    await setSettings(env, { monthly_budget_usd: 0.01 });
    const res = await call(bruno.sb, { action: 'chat', message: 'Bonjour' });
    expect(res).toMatchObject({ ok: false, code: 'budget_exhausted' });
    expect(env.anthropic.requests).toHaveLength(0);
    const { data } = await bruno.sb.rpc('my_ai_status');
    expect(data).toMatchObject({ enabled: true });
  });

  it('appels simultanés : l’enveloppe réservée par une demande en cours compte dans le budget', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    const claire = await env.signUp('Claire');
    const release = env.anthropic.hold();
    env.anthropic.reply(ok, ok);
    const first = call(bruno.sb, { action: 'chat', message: 'Première' });
    // Attendre que la première demande ait réservé son enveloppe et appelé l'API.
    for (let i = 0; i < 100 && env.anthropic.requests.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    const reserved = Number((await usageRows(env))[0].reserved_usd);
    expect(reserved).toBeGreaterThan(0.01);
    // Le budget ne permet plus qu'une enveloppe à la fois.
    await setSettings(env, { monthly_budget_usd: Math.round(reserved * 1.5 * 1e4) / 1e4 });
    const second = await call(claire.sb, { action: 'chat', message: 'Seconde' });
    expect(second).toMatchObject({ ok: false, code: 'budget_exhausted' });
    release();
    expect((await first).ok).toBe(true);
    // Après coup, seul le coût réel reste compté : une nouvelle demande passe.
    const third = await call(claire.sb, { action: 'chat', message: 'Troisième' });
    expect(third.ok).toBe(true);
    const rows = await usageRows(env);
    expect(rows.every((r) => Number(r.reserved_usd) === 0)).toBe(true);
  });

  it('limite de fréquence et demandes simultanées d’une même personne', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    await setSettings(env, { max_concurrent_per_user: 1 });
    const release = env.anthropic.hold();
    env.anthropic.reply(ok, ok);
    const first = call(bruno.sb, { action: 'chat', message: 'Un' });
    for (let i = 0; i < 100 && env.anthropic.requests.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    expect(await call(bruno.sb, { action: 'chat', message: 'Deux' })).toMatchObject({ ok: false, code: 'too_many_concurrent' });
    release();
    await first;
    await setSettings(env, { rate_per_minute: 1, max_concurrent_per_user: 2 });
    expect(await call(bruno.sb, { action: 'chat', message: 'Trois' })).toMatchObject({ ok: false, code: 'rate_limited' });
  });

  it('assistant désactivé ou personne bloquée', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    await setSettings(env, { enabled: false });
    expect(await call(bruno.sb, { action: 'chat', message: 'Un' })).toMatchObject({ ok: false, code: 'ai_disabled' });
    await setSettings(env, { enabled: true });
    await env.db.query(`insert into ai_user_limits (user_id, blocked) values ($1, true)`, [bruno.id]);
    expect(await call(bruno.sb, { action: 'chat', message: 'Un' })).toMatchObject({ ok: false, code: 'user_blocked' });
  });

  it('clé invalide : erreur claire, journalisée sans secret, statut de la clé mis à jour', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    env.anthropic.reply({ kind: 'error', status: 401, type: 'authentication_error', message: `invalid x-api-key ${TEST_ANTHROPIC_KEY}` });
    const res = await call(bruno.sb, { action: 'chat', message: 'Bonjour' });
    expect(res).toMatchObject({ ok: false, code: 'invalid_key' });
    const errors = (await env.db.query<{ code: string; detail: string }>(`select code, detail from ai_errors`)).rows;
    expect(errors).toEqual([{ code: 'invalid_key', detail: 'Clé API refusée (401)' }]);
    const status = (await env.db.query<{ key_status: string }>(`select key_status from ai_settings`)).rows[0];
    expect(status.key_status).toBe('invalid');
    const usage = await usageRows(env);
    expect(usage[0]).toMatchObject({ status: 'failed', error_code: 'invalid_key' });
    expect(Number(usage[0].cost_usd)).toBe(0);
  });

  it('service indisponible : message simple, rien n’est facturé, nouvelle tentative possible', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    // Pas de nouvelle tentative automatique (un appel relancé pourrait être facturé deux fois).
    env.anthropic.reply({ kind: 'error', status: 529, type: 'overloaded_error', message: 'Overloaded' });
    expect(await call(bruno.sb, { action: 'chat', message: 'Bonjour' })).toMatchObject({ ok: false, code: 'service_unavailable' });
    env.anthropic.reply({ kind: 'network' });
    expect(await call(bruno.sb, { action: 'chat', message: 'Bonjour' })).toMatchObject({ ok: false, code: 'service_unavailable' });
    env.anthropic.reply(ok);
    expect((await call(bruno.sb, { action: 'chat', message: 'Bonjour' })).ok).toBe(true);
  });

  it('modèle sans tarif connu : aucun appel (coût impossible à borner)', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    await setSettings(env, { model: 'claude-inconnu-1' });
    expect(await call(bruno.sb, { action: 'chat', message: 'Bonjour' })).toMatchObject({ ok: false, code: 'price_unknown' });
    expect(env.anthropic.requests).toHaveLength(0);
  });

  it('administration : test de connexion réservé à l’administrateur, sans jamais afficher la clé', async () => {
    const env = await makeAiEnv();
    const admin = await env.signUp('Bruno');
    const other = await env.signUp('Claire');
    expect(await call(other.sb, { action: 'admin_test' })).toMatchObject({ ok: false, code: 'forbidden' });
    env.anthropic.reply({ kind: 'message', content: [text('OK')] });
    const res = await call(admin.sb, { action: 'admin_test' });
    expect(res).toMatchObject({ ok: true, key_present: true, key_status: 'ok', test: { ok: true, text: 'OK' } });
    expect((res.models as { id: string }[]).map((m) => m.id)).toContain('claude-opus-5-5');
    expect(JSON.stringify(res)).not.toContain(TEST_ANTHROPIC_KEY);
    const { data: overview, error } = await admin.sb.rpc('admin_ai_overview');
    expect(error).toBeNull();
    expect(JSON.stringify(overview)).not.toContain(TEST_ANTHROPIC_KEY);
    expect((overview as { settings: { available_models: unknown[] } }).settings.available_models).toHaveLength(2);
    const denied = await other.sb.rpc('admin_ai_overview');
    expect(denied.error?.message).toBe('forbidden');
    const update = await other.sb.rpc('admin_update_ai_settings', { p: { monthly_budget_usd: 1000 } });
    expect(update.error?.message).toBe('forbidden');
  });

  it('les tables de consommation ne sont pas lisibles par les utilisateurs', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    for (const t of ['ai_usage', 'ai_errors', 'ai_settings', 'ai_user_limits']) {
      const { data, error } = await bruno.sb.from(t).select('*');
      expect(error !== null || (data ?? []).length === 0).toBe(true);
    }
  });
});

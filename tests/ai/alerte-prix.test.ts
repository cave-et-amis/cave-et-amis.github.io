import { describe, expect, it } from 'vitest';
import { toolUse } from '../helpers/anthropicMock.ts';
import { TEST_URL } from '../helpers/env.ts';
import { makeAiEnv, setSettings, usageRows, type AiEnv } from './setup.ts';

// Vendredi 30 octobre 2026, 20 h à Paris (19 h UTC) ; et le jeudi précédent.
const FRIDAY = () => new Date('2026-10-30T19:00:00Z');
const THURSDAY = () => new Date('2026-10-29T19:00:00Z');

async function cron(env: AiEnv) {
  const t = (await env.db.query<{ cron_token: string }>(`select cron_token from nous_config where id = 1`)).rows[0].cron_token;
  const res = await env.handler(
    new Request(`${TEST_URL}/functions/v1/cave-api`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-token': t }, body: JSON.stringify({ action: 'price_alerts_run' }) }),
  );
  return (await res.json()) as Record<string, unknown>;
}

/** Bruno suit son Madiran 2016, relevé à 50-60 € il y a un mois. */
async function watching(env: AiEnv) {
  const bruno = await env.signUp('Bruno');
  const { data: w } = await bruno.sb.from('wines').insert({ name: 'Château Montus', vintage: 2016 }).select().single();
  await bruno.sb.rpc('create_lot', { p: { wine_id: w.id, quantity: 3 }, p_request: crypto.randomUUID() });
  await env.db.query(`insert into market_prices (owner_id, wine_id, volume_ml, currency, price_low, price_high, method, checked_at) values ($1, $2, 750, 'EUR', 50, 60, 'manual', now() - interval '30 days')`, [bruno.id, w.id]);
  const { data, error } = await bruno.sb.rpc('set_price_watch', { p_wine: w.id, p_volume: 750 });
  expect(error).toBeNull();
  expect(data).toMatchObject({ reference_price: 50, currency: 'EUR' });
  return { bruno, wineId: w.id as string };
}

const offers = (price: number) => ({
  kind: 'message' as const,
  stop_reason: 'tool_use',
  usage: { web_search_requests: 1 },
  content: [
    { type: 'server_tool_use', id: 'srv1', name: 'web_search', input: { query: 'Montus 2016' }, caller: { type: 'direct' } },
    {
      type: 'web_search_tool_result',
      tool_use_id: 'srv1',
      caller: { type: 'direct' },
      content: [{ type: 'web_search_result', url: 'https://www.caviste.example/montus-2016', title: 'Caviste', encrypted_content: 'x', page_age: null }],
    },
    toolUse('t1', 'report_offers', {
      comment: 'Une offre',
      offers: [{ url: 'https://www.caviste.example/montus-2016', title: 'Montus 2016', seller: 'Caviste', price, currency: 'EUR', vintage: 2016, volume_ml: 750 }],
    }),
  ],
});

describe('alerte de baisse de prix (vendredi soir)', () => {
  it('un autre jour : rien n’est lancé, rien n’est dépensé', async () => {
    const env = await makeAiEnv({ now: THURSDAY });
    await watching(env);
    expect(await cron(env)).toMatchObject({ ok: true, skipped: 'not_friday_evening' });
    expect(env.anthropic.requests).toHaveLength(0);
  });

  it('prix vérifié plus bas : notification, relevé ajouté à la fiche, référence abaissée ; pas de seconde alerte au même prix', async () => {
    const env = await makeAiEnv({ now: FRIDAY });
    const { bruno, wineId } = await watching(env);
    env.anthropic.reply(offers(42));
    expect(await cron(env)).toMatchObject({ ok: true, checked: 1, lower: 1, stopped: null });
    const { data: notes } = await bruno.sb.from('notifications').select('kind, actor_name, ref_id');
    expect(notes).toEqual([{ kind: 'price_drop', actor_name: 'Château Montus 2016', ref_id: wineId }]);
    const { data: watch } = await bruno.sb.from('price_watches').select('reference_price, last_status, last_low').single();
    expect(watch).toEqual({ reference_price: 42, last_status: 'lower', last_low: 42 });
    expect((await bruno.sb.from('market_prices').select('price_low, method').order('checked_at')).data).toEqual([
      { price_low: 50, method: 'manual' },
      { price_low: 42, method: 'web' },
    ]);
    expect((await usageRows(env)).map((u) => [u.action, u.status])).toEqual([['price_alert', 'done']]);
    // Une semaine plus tard, même prix : pas de nouvelle alerte.
    await env.db.query(`update price_watches set last_checked_at = now() - interval '7 days'`);
    env.anthropic.reply(offers(42));
    expect(await cron(env)).toMatchObject({ checked: 1, lower: 0 });
    expect((await bruno.sb.from('notifications').select('id')).data).toHaveLength(1);
  });

  it('plafond des alertes atteint : aucune recherche lancée, le vin est marqué « budget »', async () => {
    const env = await makeAiEnv({ now: FRIDAY });
    const { bruno } = await watching(env);
    // Moins que le coût maximal d'une vérification (environ 0,26 $) : elle n'est pas lancée.
    await setSettings(env, { price_alert_budget_usd: 0.1 });
    expect(await cron(env)).toMatchObject({ ok: true, checked: 0, stopped: 'price_alert_budget' });
    expect(env.anthropic.requests).toHaveLength(0);
    expect((await bruno.sb.from('price_watches').select('last_status').single()).data).toEqual({ last_status: 'budget' });
    expect(await usageRows(env)).toEqual([]);
  });

  it('un seul vin suivi par personne, jamais le vin d’une autre personne', async () => {
    const env = await makeAiEnv({ now: FRIDAY });
    const { bruno } = await watching(env);
    const { data: other } = await bruno.sb.from('wines').insert({ name: 'Madiran', vintage: 2018 }).select().single();
    await bruno.sb.rpc('set_price_watch', { p_wine: other.id, p_volume: 750 });
    expect((await bruno.sb.from('price_watches').select('wine_id, reference_price')).data).toEqual([{ wine_id: other.id, reference_price: null }]);
    const claire = await env.signUp('Claire');
    const { error } = await claire.sb.rpc('set_price_watch', { p_wine: other.id, p_volume: 750 });
    expect(error?.message).toMatch(/not_found/);
    await bruno.sb.rpc('set_price_watch', { p_wine: null, p_volume: null });
    expect((await bruno.sb.from('price_watches').select('*')).data).toEqual([]);
  });
});

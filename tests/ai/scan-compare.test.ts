import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { wineKey } from '../../src/domain/scan.ts';
import { text } from '../helpers/anthropicMock.ts';
import { TINY_JPEG } from '../helpers/env.ts';
import { call, makeAiEnv, setSettings } from './setup.ts';

const market = (key: string, median: number) => ({ key, status: 'verified', currency: 'EUR', low: median - 2, high: median + 2, median, count: 3, reliability: 'haute', offers: [], reason: null, checked_at: new Date().toISOString() });

const KEY = wineKey({ name: 'Château Labeille', vintage: 2016, volume_ml: 750 });

async function visitWith(env: Awaited<ReturnType<typeof makeAiEnv>>, sb: SupabaseClient) {
  const { data: v } = await sb.from('scan_visits').insert({ store_name: 'Caviste du coin', budget: 25, occasion: 'un dîner avec des amis' }).select('id').single();
  const visit = (v as { id: string }).id;
  const add = async (wine: Record<string, unknown>, price: number) => {
    const { data } = await sb.from('scans').insert({ wine, store_price: price, price_confirmed: true, status: 'confirmed', visit_id: visit }).select('id').single();
    return (data as { id: string }).id;
  };
  const a = await add({ name: 'Château Labeille', vintage: 2016, volume_ml: 750 }, 18);
  const b = await add({ name: 'Mystère sans analyse', vintage: 2020 }, 12);
  // Analyse et prix : écrits par le serveur (ici directement, comme le ferait scan_quality / scan_price).
  await env.db.query(`update scans set assessment = $2, market = $3 where id = $1`, [
    a,
    JSON.stringify({ key: KEY, quality: { tier: 'tres_bon', reason: null, sources: 2 }, vintage: { rating: 'exceptionnel' }, critics: [{ publication: 'Guide exemple', score: '2 étoiles' }], pairings: 'Agneau' }),
    JSON.stringify(market(KEY, 20)),
  ]);
  return { visit, a, b };
}

describe('scanner : comparer plusieurs bouteilles (lot 3d)', () => {
  it('visites privées ; une analyse ne peut rejoindre que sa propre visite', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    const claire = await env.signUp('Claire');
    const { visit, a } = await visitWith(env, bruno.sb);
    expect((await claire.sb.from('scan_visits').select('id')).data).toEqual([]);
    const { data: mine } = await claire.sb.from('scans').insert({ wine: { name: 'X' } }).select('id').single();
    const steal = await claire.sb.from('scans').update({ visit_id: visit }).eq('id', (mine as { id: string }).id);
    expect(steal.error?.message).toMatch(/forbidden/);
    expect((await claire.sb.from('scans').update({ visit_id: null }).eq('id', a).select('id')).data).toEqual([]);
    // Identification rattachée à la visite ; visite d'une autre personne refusée sans appel à Claude.
    const path = `${bruno.id}/face.jpg`;
    await bruno.sb.storage.from('photos').upload(path, new Blob([TINY_JPEG], { type: 'image/jpeg' }), { contentType: 'image/jpeg' });
    env.anthropic.reply({
      kind: 'message',
      content: [text(JSON.stringify({ is_wine_label: true, fields: { name: 'Autre vin', vintage: 2019 }, uncertain: [], candidates: [], price_tag: { price: 9.9, currency: 'EUR', label: '', conditions: '' }, photo_issues: [], notes: '' }))],
    });
    const res = await call(bruno.sb, { action: 'scan_identify', photos: [{ path, role: 'front' }], visit_id: visit });
    expect(res).toMatchObject({ ok: true, scan: { visit_id: visit } });
    const cpath = `${claire.id}/face.jpg`;
    await claire.sb.storage.from('photos').upload(cpath, new Blob([TINY_JPEG], { type: 'image/jpeg' }), { contentType: 'image/jpeg' });
    expect(await call(claire.sb, { action: 'scan_identify', photos: [{ path: cpath, role: 'front' }], visit_id: visit })).toMatchObject({ ok: false, code: 'not_found' });
    expect(env.anthropic.requests).toHaveLength(1);
  });

  it('Lia reçoit la visite avec les verdicts calculés ; rien de la visite d’une autre personne', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    const claire = await env.signUp('Claire');
    const { visit } = await visitWith(env, bruno.sb);
    env.anthropic.reply({ kind: 'message', content: [text('Je vous conseille le **Château Labeille 2016** : c’est le seul assez documenté.')] });
    const res = await call(bruno.sb, { action: 'chat', message: 'Laquelle pour un dîner entre amis, 25 € maximum ?', context: { kind: 'scan', id: visit } });
    expect(res.ok).toBe(true);
    const sent = JSON.stringify(env.anthropic.requests[0].body!.messages);
    expect(sent).toContain('Château Labeille 2016');
    expect(sent).toContain('Mystère sans analyse');
    expect(sent).toContain('\\"verdict\\":\\"excellent\\"');
    expect(sent).toContain('\\"verdict\\":\\"insufficient\\"');
    expect(sent).toContain('Caviste du coin');
    expect(sent).toContain('ne classe et ne recommande que les bouteilles');
    const { data: conv } = await bruno.sb.from('ai_conversations').select('context_kind, context_id').eq('id', res.conversation_id as string).single();
    expect(conv).toEqual({ context_kind: 'scan', context_id: visit });
    // Claire ne peut pas faire lire la visite de Bruno à Lia.
    env.anthropic.reply({ kind: 'message', content: [text('Je ne vois aucune comparaison.')] });
    await call(claire.sb, { action: 'chat', message: 'Laquelle ?', context: { kind: 'scan', id: visit } });
    const leaked = JSON.stringify(env.anthropic.requests[1].body!.messages);
    expect(leaked).not.toContain('Château Labeille');
    expect(leaked).not.toContain('Caviste du coin');
  });

  it('fréquence par minute : l’analyse et le prix automatiques ne bloquent pas Lia', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    await setSettings(env, { rate_per_minute: 2 });
    for (const action of ['scan_quality', 'scan_price', 'scan_quality', 'scan_price']) {
      await env.db.query(`insert into ai_usage (user_id, action, status) values ($1, $2, 'done')`, [bruno.id, action]);
    }
    env.anthropic.reply({ kind: 'message', content: [text('Bonjour')] }, { kind: 'message', content: [text('Encore')] });
    expect((await call(bruno.sb, { action: 'chat', message: 'Bonjour' })).ok).toBe(true);
    expect((await call(bruno.sb, { action: 'chat', message: 'Encore' })).ok).toBe(true);
    expect(await call(bruno.sb, { action: 'chat', message: 'Trop' })).toMatchObject({ ok: false, code: 'rate_limited' });
  });
});

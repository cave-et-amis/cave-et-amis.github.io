import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { computeVerdict, median, pricePoints, wineKey } from '../../src/domain/scan.ts';
import type { ScanAssessment, ScanMarket } from '../../src/domain/types.ts';
import { toolUse } from '../helpers/anthropicMock.ts';
import { call, makeAiEnv, setSettings, usageRows } from './setup.ts';

const WINE = { name: 'Château Labeille', producer: 'Château Labeille', appellation: 'Pauillac', region: 'Bordeaux', color: 'rouge', vintage: 2016, volume_ml: 750 };

async function confirmedScan(sb: SupabaseClient, wine: Record<string, unknown> = WINE, price = 24.9) {
  const { data, error } = await sb.from('scans').insert({ wine, store_price: price, price_confirmed: true, status: 'confirmed' }).select('id').single();
  if (error) throw error;
  return (data as { id: string }).id;
}

const searchBlock = (urls: string[]) => [
  { type: 'server_tool_use', id: 'srv1', name: 'web_search', input: { query: 'Labeille 2016' }, caller: { type: 'direct' } },
  {
    type: 'web_search_tool_result',
    tool_use_id: 'srv1',
    caller: { type: 'direct' },
    content: urls.map((url) => ({ type: 'web_search_result', url, title: `Page ${url}`, encrypted_content: 'x', page_age: '3 mai 2026' })),
  },
];

const GUIDE = 'https://guide.example/labeille-2016';
const DOMAINE = 'https://www.chateau-labeille.example/';

function assessmentReply(o: Record<string, unknown> = {}) {
  return {
    kind: 'message' as const,
    stop_reason: 'tool_use',
    usage: { web_search_requests: 2 },
    content: [
      ...searchBlock([GUIDE, DOMAINE]),
      toolUse('t1', 'report_assessment', {
        producer: { text: 'Cru classé réputé de Pauillac.', source_urls: [DOMAINE, 'https://inventee.example/x'] },
        appellation: { text: 'Appellation de rouges de garde, cabernet dominant.', source_urls: [] },
        vintage: { text: 'Millésime 2016 très réussi à Bordeaux.', rating: 'exceptionnel', source_urls: [GUIDE] },
        critics: [
          { publication: 'Guide exemple', reviewer: '', score: '2 étoiles', summary: 'Ample et frais', url: GUIDE },
          { publication: 'Revue inventée', reviewer: 'X', score: '99/100', summary: '', url: 'https://inventee.example/note' },
        ],
        consumers: [
          { site: 'Avis exemple', average: 4.2, scale: 5, count: 0, url: GUIDE },
          { site: 'Vivino', average: 4.1, scale: 5, count: 900, url: 'https://www.vivino.com/labeille' },
        ],
        aromatic_profile: 'Cassis, cèdre, tanins fins.',
        drink_window: { from: 2024, until: 2040, source_url: '' },
        pairings: 'Agneau, gibier.',
        quality: 'tres_bon',
        quality_reason: 'Producteur réputé et grand millésime.',
        ...o,
      }),
    ],
  };
}

const offer = (url: string, price: number, extra: Record<string, unknown> = {}) => ({
  url,
  title: 'Offre',
  seller: new URL(url).hostname,
  country: 'FR',
  price,
  currency: 'EUR',
  vat: 'ttc',
  shipping: null,
  min_quantity: null,
  vintage: 2016,
  volume_ml: 750,
  ...extra,
});

describe('scanner : verdict (méthode documentée)', () => {
  const market = (median: number, low = median): ScanMarket => ({
    key: 'k',
    status: 'verified',
    currency: 'EUR',
    low,
    high: median,
    median,
    count: 3,
    reliability: 'haute',
    offers: [],
    reason: null,
    checked_at: '2026-10-25T10:00:00Z',
  });
  const assess = (tier: ScanAssessment['quality'] extends infer Q ? (Q extends { tier: infer T } ? T : never) : never) =>
    ({ quality: { tier, reason: null, sources: 2 } }) as ScanAssessment;

  it('points de prix et médiane', () => {
    expect([0.75, 0.9, 1, 1.1, 1.3].map(pricePoints)).toEqual([4, 3, 2, 1, 0]);
    expect(median([30, 10, 20])).toBe(20);
    expect(median([10, 20])).toBe(15);
    expect(median([])).toBeNull();
  });

  it('cinq verdicts possibles', () => {
    const v = (tier: Parameters<typeof assess>[0], store: number, med: number) =>
      computeVerdict({ storePrice: store, priceConfirmed: true, currency: 'EUR', assessment: assess(tier), market: market(med, med - 2) });
    expect(v('tres_bon', 18, 20)).toMatchObject({ verdict: 'excellent', score: 7.5, quality: 3, price: 3 });
    expect(v('bon', 15, 20)).toMatchObject({ verdict: 'excellent', score: 7.5 });
    expect(v('tres_bon', 20, 20)).toMatchObject({ verdict: 'good', score: 6.5 });
    expect(v('correct', 21, 20)).toMatchObject({ verdict: 'fair', score: 4 });
    expect(v('correct', 23, 20)).toMatchObject({ verdict: 'poor', score: 2.5 });
    expect(v('decevant', 30, 20)).toMatchObject({ verdict: 'poor', score: 0 });
    expect(v('tres_bon', 18, 20).gap).toEqual({ vsMedian: -2, vsMedianPct: -10, vsLow: 0, vsLowPct: 0 });
  });

  it('informations insuffisantes : prix non confirmé, qualité non sourcée, marché non vérifié ou autre devise', () => {
    const base = { storePrice: 18, priceConfirmed: true, currency: 'EUR', assessment: assess('bon'), market: market(20) };
    expect(computeVerdict({ ...base, priceConfirmed: false })).toMatchObject({ verdict: 'insufficient', score: null });
    expect(computeVerdict({ ...base, assessment: { quality: null } as ScanAssessment })).toMatchObject({ verdict: 'insufficient', price: 3 });
    expect(computeVerdict({ ...base, market: { ...market(20), status: 'unverified', median: null } })).toMatchObject({ verdict: 'insufficient' });
    expect(computeVerdict({ ...base, market: { ...market(20), currency: 'USD' } }).verdict).toBe('insufficient');
    expect(computeVerdict({ ...base, market: null }).missing).toContain('prix de marché non recherché');
  });

  it('identité du vin : même producteur, cuvée, millésime et contenance', () => {
    expect(wineKey({ name: 'Château Labeille', producer: 'Château Labeille', vintage: 2016 })).toBe(wineKey({ name: 'chateau labeille', producer: 'CHÂTEAU LABEILLE', vintage: 2016, volume_ml: 750 }));
    expect(wineKey({ name: 'X', vintage: 2016 })).not.toBe(wineKey({ name: 'X', vintage: 2017 }));
    expect(wineKey({ name: 'X', vintage: 2016 })).not.toBe(wineKey({ name: 'X', vintage: 2016, volume_ml: 1500 }));
  });
});

describe('scanner : analyse qualitative sourcée', () => {
  it('ne garde que les sources réellement trouvées ; avis sans lien et notes sans nombre d’avis écartés ; Vivino exclu', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    const id = await confirmedScan(bruno.sb);
    env.anthropic.reply(assessmentReply());
    const res = await call(bruno.sb, { action: 'scan_quality', scan_id: id });
    expect(res.ok).toBe(true);
    const a = res.assessment as ScanAssessment;
    expect(a.producer).toEqual({ text: 'Cru classé réputé de Pauillac.', origin: 'source', sources: [DOMAINE] });
    expect(a.appellation.origin).toBe('estimation');
    expect(a.vintage).toMatchObject({ rating: 'exceptionnel', origin: 'source' });
    expect(a.critics.map((c) => c.publication)).toEqual(['Guide exemple']);
    expect(a.consumers).toEqual([]);
    expect(a.drink_window).toEqual({ from: 2024, until: 2040, origin: 'estimation', source: null });
    expect(a.quality).toMatchObject({ tier: 'tres_bon' });
    expect(a.sources.map((s) => s.url).sort()).toEqual([DOMAINE, GUIDE].sort());
    expect(a.sources[0].page_age).toBe('3 mai 2026');
    // Recherche : modèle du scanner, Vivino exclu.
    const sent = env.anthropic.requests[0].body!;
    expect(sent.model).toBe('claude-sonnet-5-5');
    expect((sent.tools as { name: string; blocked_domains?: string[] }[]).find((t) => t.name === 'web_search')?.blocked_domains).toEqual(['vivino.com']);
    // Enregistrée sur l'analyse ; le nombre d'analyses du jour (identifications) n'est pas touché.
    const { data } = await bruno.sb.from('scans').select('assessment, assessed_at').eq('id', id).single();
    expect((data as { assessment: ScanAssessment }).assessment.quality?.tier).toBe('tres_bon');
    expect((await usageRows(env)).map((u) => u.action)).toEqual(['scan_quality']);
    expect((await bruno.sb.rpc('my_scan_status')).data).toMatchObject({ used: 0 });
  });

  it('même vin analysé à nouveau : repris du cache, sans appel', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    const claire = await env.signUp('Claire');
    env.anthropic.reply(assessmentReply());
    expect((await call(bruno.sb, { action: 'scan_quality', scan_id: await confirmedScan(bruno.sb) })).ok).toBe(true);
    const again = await call(claire.sb, { action: 'scan_quality', scan_id: await confirmedScan(claire.sb, { ...WINE, name: 'CHATEAU LABEILLE' }) });
    expect(again).toMatchObject({ ok: true, from_cache: true, assessment: { quality: { tier: 'tres_bon' } } });
    expect(env.anthropic.requests).toHaveLength(1);
  });

  it('niveau sans aucune source vérifiable : non retenu', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    const id = await confirmedScan(bruno.sb);
    env.anthropic.reply(
      assessmentReply({
        producer: { text: 'Réputé.', source_urls: ['https://inventee.example/x'] },
        vintage: { text: 'Bon.', rating: 'bon', source_urls: [] },
        critics: [],
        consumers: [],
      }),
    );
    const a = (await call(bruno.sb, { action: 'scan_quality', scan_id: id })).assessment as ScanAssessment;
    expect(a.quality).toBeNull();
    expect(a.quality_note).toMatch(/sans source vérifiable/);
    expect(a.vintage.rating).toBeNull();
  });

  it('refus : analyse non confirmée, analyse d’une autre personne', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    const claire = await env.signUp('Claire');
    const { data } = await bruno.sb.from('scans').insert({ wine: WINE }).select('id').single();
    expect(await call(bruno.sb, { action: 'scan_quality', scan_id: (data as { id: string }).id })).toMatchObject({ ok: false, code: 'scan_unconfirmed' });
    expect(await call(claire.sb, { action: 'scan_price', scan_id: await confirmedScan(bruno.sb) })).toMatchObject({ ok: false, code: 'not_found' });
    expect(env.anthropic.requests).toHaveLength(0);
  });
});

describe('scanner : prix du marché', () => {
  it('offres vérifiées seulement (lien trouvé, même millésime et contenance, TTC), synthèse et fiabilité', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    const id = await confirmedScan(bruno.sb);
    const urls = ['https://a.example/v', 'https://b.example/v', 'https://c.example/v', 'https://d.example/v', 'https://e.example/v'];
    env.anthropic.reply({
      kind: 'message',
      stop_reason: 'tool_use',
      usage: { web_search_requests: 1 },
      content: [
        ...searchBlock(urls),
        toolUse('t1', 'report_scan_offers', {
          comment: 'ok',
          offers: [
            offer(urls[0], 22, { shipping: 9.9 }),
            offer(urls[1], 26),
            offer(urls[2], 30, { min_quantity: 6 }),
            offer(urls[3], 15, { vat: 'ht' }),
            offer(urls[4], 19, { vintage: 2017 }),
            offer('https://inventee.example/v', 10),
          ],
        }),
      ],
    });
    const res = await call(bruno.sb, { action: 'scan_price', scan_id: id });
    const m = res.market as ScanMarket;
    expect(m).toMatchObject({ status: 'verified', currency: 'EUR', low: 22, high: 30, median: 26, count: 3, reliability: 'haute' });
    expect(m.offers.map((o) => [o.price, o.shipping, o.min_quantity])).toEqual([
      [22, 9.9, null],
      [26, null, null],
      [30, null, 6],
    ]);
    expect((await usageRows(env)).map((u) => u.action)).toEqual(['scan_price']);
    const { data } = await bruno.sb.from('scans').select('market_checked_at').eq('id', id).single();
    expect(Date.parse((data as { market_checked_at: string }).market_checked_at)).toBe(Date.parse(m.checked_at));
  });

  it('aucune offre fiable : « prix non vérifié », pas mis en cache ; millésime inconnu : aucune recherche', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    const reply = { kind: 'message' as const, stop_reason: 'tool_use', content: [...searchBlock([]), toolUse('t1', 'report_scan_offers', { comment: 'Introuvable', offers: [] })] };
    env.anthropic.reply(reply, reply);
    const id = await confirmedScan(bruno.sb);
    expect((await call(bruno.sb, { action: 'scan_price', scan_id: id })).market).toMatchObject({ status: 'unverified', reason: 'Aucune offre fiable trouvée. Introuvable' });
    expect((await call(bruno.sb, { action: 'scan_price', scan_id: id })).from_cache).toBe(false);
    expect(env.anthropic.requests).toHaveLength(2);
    const nv = await confirmedScan(bruno.sb, { name: 'Sans millésime connu' });
    expect((await call(bruno.sb, { action: 'scan_price', scan_id: nv })).market).toMatchObject({ status: 'unverified', reason: expect.stringMatching(/Millésime inconnu/) });
    expect(env.anthropic.requests).toHaveLength(2);
  });

  it('recherche web désactivée : rien n’est inventé, aucun appel', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    await setSettings(env, { web_search_enabled: false });
    const id = await confirmedScan(bruno.sb);
    expect((await call(bruno.sb, { action: 'scan_quality', scan_id: id })).assessment).toMatchObject({ quality: null, reason: expect.stringMatching(/désactivée/) });
    expect((await call(bruno.sb, { action: 'scan_price', scan_id: id })).market).toMatchObject({ status: 'unverified' });
    expect(env.anthropic.requests).toHaveLength(0);
  });
});

import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { cleanScan, parsePhotos } from '../../server/api/scan.ts';
import { text } from '../helpers/anthropicMock.ts';
import { TINY_JPEG } from '../helpers/env.ts';
import { call, makeAiEnv, setSettings, usageRows, type AiEnv } from './setup.ts';

const reading = (o: Record<string, unknown> = {}) => ({
  is_wine_label: true,
  fields: {
    name: 'Château Labeille',
    domaine: '',
    producer: 'Château Labeille',
    cuvee: '',
    country: 'France',
    region: 'Bordeaux',
    appellation: 'Pauillac',
    color: 'rouge',
    wine_type: 'tranquille',
    grapes: [],
    vintage: 2016,
    non_vintage: false,
    volume_ml: 750,
    barcode: '',
    alcohol: 13.5,
  },
  uncertain: ['region'],
  candidates: [],
  price_tag: { price: 24.9, currency: '€', label: 'PAUILLAC CH LABEILLE 2016 75CL', conditions: '' },
  photo_issues: [],
  notes: '',
  ...o,
});

async function upload(_env: AiEnv, who: { sb: SupabaseClient; id: string }, name: string, bytes: Uint8Array<ArrayBuffer> = TINY_JPEG) {
  const path = `${who.id}/${name}`;
  await who.sb.storage.from('photos').upload(path, new Blob([bytes], { type: 'image/jpeg' }), { contentType: 'image/jpeg' });
  return path;
}

describe('scanner : contrôle des réponses', () => {
  it('garde les champs lisibles, le degré, le prix du rayon ; écarte le reste', () => {
    const r = cleanScan({
      ...reading(),
      fields: { ...reading().fields, vintage: 2999, alcohol: 80 },
      candidates: [{ name: 'Seul', producer: '', cuvee: '', appellation: '', vintage: null, reason: '' }],
      price_tag: { price: -3, currency: 'euros', label: '', conditions: '' },
      photo_issues: ['glare', 'n_importe_quoi', 'glare'],
    });
    expect(r.fields).toMatchObject({ name: 'Château Labeille', vintage: null, alcohol: null, domaine: null });
    // Une seule possibilité n'est pas un choix.
    expect(r.candidates).toEqual([]);
    expect(r.price_tag).toEqual({ price: null, currency: 'EUR', label: null, conditions: null });
    expect(r.photo_issues).toEqual(['glare']);
  });

  it('propose plusieurs vins au lieu de choisir', () => {
    const r = cleanScan(
      reading({
        candidates: [
          { name: 'Labeille', producer: 'Château Labeille', cuvee: 'Grand vin', appellation: 'Pauillac', vintage: 2016, reason: 'Étiquette crème' },
          { name: 'Labeille', producer: 'Château Labeille', cuvee: 'Second vin', appellation: 'Pauillac', vintage: 2016, reason: 'Même producteur' },
        ],
      }),
    );
    expect(r.candidates).toHaveLength(2);
    expect(r.candidates[1]).toMatchObject({ cuvee: 'Second vin', vintage: 2016 });
  });

  it('photos : 1 à 3, rôles distincts, au moins une étiquette', () => {
    expect(() => parsePhotos([])).toThrow();
    expect(() => parsePhotos([{ path: 'a', role: 'price' }])).toThrow();
    expect(() => parsePhotos([{ path: 'a', role: 'front' }, { path: 'b', role: 'front' }])).toThrow();
    expect(() => parsePhotos([{ path: 'a', role: 'menu' }])).toThrow();
    expect(parsePhotos([{ path: 'p', role: 'price' }, { path: 'f', role: 'front' }]).map((p) => p.role)).toEqual(['front', 'price']);
  });
});

describe('scanner : identification en magasin', () => {
  it('lit les trois photos, enregistre l’analyse dans l’historique privé, sans rien ajouter à la cave', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    const claire = await env.signUp('Claire');
    const front = await upload(env, bruno, 'face.jpg');
    const back = await upload(env, bruno, 'dos.jpg');
    const price = await upload(env, bruno, 'prix.jpg');
    env.anthropic.reply({ kind: 'message', content: [text(JSON.stringify(reading()))] });
    const res = await call(bruno.sb, {
      action: 'scan_identify',
      photos: [
        { path: price, role: 'price' },
        { path: front, role: 'front' },
        { path: back, role: 'back' },
      ],
    });
    expect(res.ok).toBe(true);
    const scan = res.scan as Record<string, unknown>;
    expect(scan).toMatchObject({ status: 'identified', store_price: 24.9, currency: 'EUR', price_confirmed: false, from_cache: false });
    expect(scan.wine).toMatchObject({ name: 'Château Labeille', vintage: 2016, alcohol: 13.5, volume_ml: 750 });
    // Modèle du scanner (Sonnet par défaut), trois images annoncées par leur rôle.
    const sent = env.anthropic.requests[0].body!;
    expect(sent.model).toBe('claude-sonnet-5-5');
    const msg = JSON.stringify(sent.messages);
    expect(msg.match(/"type":"image"/g)).toHaveLength(3);
    expect(msg).toContain('étiquette de prix en rayon');
    expect((await usageRows(env)).map((u) => u.action)).toEqual(['scan']);
    // Rien dans la cave ; l'analyse n'est visible que par Bruno.
    expect((await bruno.sb.from('wines').select('id')).data).toEqual([]);
    expect((await bruno.sb.from('scans').select('id')).data).toHaveLength(1);
    expect((await claire.sb.from('scans').select('id')).data).toEqual([]);
  });

  it('les mêmes photos ne sont pas renvoyées à l’IA : lecture reprise du cache, sans coût ni quota', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    const front = await upload(env, bruno, 'face.jpg');
    const again = await upload(env, bruno, 'face-encore.jpg');
    env.anthropic.reply({ kind: 'message', content: [text(JSON.stringify(reading()))] });
    expect((await call(bruno.sb, { action: 'scan_identify', photos: [{ path: front, role: 'front' }] })).ok).toBe(true);
    const second = await call(bruno.sb, { action: 'scan_identify', photos: [{ path: again, role: 'front' }] });
    expect(second).toMatchObject({ ok: true, scan: { from_cache: true, wine: { name: 'Château Labeille' } } });
    expect(env.anthropic.requests).toHaveLength(1);
    expect(await usageRows(env)).toHaveLength(1);
  });

  it('quota quotidien d’analyses, refus des photos d’une autre personne', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    const claire = await env.signUp('Claire');
    const other = await upload(env, claire, 'privee.jpg');
    expect(await call(bruno.sb, { action: 'scan_identify', photos: [{ path: other, role: 'front' }] })).toMatchObject({ ok: false, code: 'forbidden' });
    await setSettings(env, { scan_daily_limit: 1 });
    env.anthropic.reply({ kind: 'message', content: [text(JSON.stringify(reading()))] });
    const a = await upload(env, bruno, 'a.jpg');
    expect((await call(bruno.sb, { action: 'scan_identify', photos: [{ path: a, role: 'front' }] })).ok).toBe(true);
    // Autre photo (autres octets) : nouvelle lecture nécessaire, refusée par le quota.
    const b = await upload(env, bruno, 'b.jpg', Uint8Array.from([...TINY_JPEG, 0]));
    expect(await call(bruno.sb, { action: 'scan_identify', photos: [{ path: b, role: 'front' }] })).toMatchObject({ ok: false, code: 'scan_quota' });
    expect(env.anthropic.requests).toHaveLength(1);
  });

  it('code-barres : l’indice Open Food Facts compte dans la limite d’appels ; au-delà il est sauté, l’analyse continue (audit, F4)', async () => {
    const EAN = '4006381333931';
    const offCalls: string[] = [];
    const webFetch = (async (input: RequestInfo | URL) => {
      offCalls.push(String(input));
      return Response.json({ status: 1, product: { code: EAN, product_name: 'Château Labeille 2016', brands: 'Château Labeille', categories_tags: ['en:wines'] } });
    }) as typeof fetch;
    const env = await makeAiEnv({ webFetch });
    const bruno = await env.signUp('Bruno');
    env.anthropic.reply({ kind: 'message', content: [text(JSON.stringify(reading()))] }, { kind: 'message', content: [text(JSON.stringify(reading()))] });
    const a = await upload(env, bruno, 'a.jpg');
    expect((await call(bruno.sb, { action: 'scan_identify', photos: [{ path: a, role: 'front' }], barcode: EAN })).ok).toBe(true);
    expect(JSON.stringify(env.anthropic.requests[0].body!.messages)).toContain('hint : code-barres');
    await env.db.query(`insert into rate_hits (bucket, subject) select 'off', $1 from generate_series(1, 29)`, [bruno.id]);
    const b = await upload(env, bruno, 'b.jpg', Uint8Array.from([...TINY_JPEG, 0]));
    expect((await call(bruno.sb, { action: 'scan_identify', photos: [{ path: b, role: 'front' }], barcode: EAN })).ok).toBe(true);
    expect(JSON.stringify(env.anthropic.requests[1].body!.messages)).not.toContain('hint :');
    expect(offCalls).toHaveLength(1);
  });

  it('photo trop lourde : lecture interrompue, refusée sans appel à l’IA (audit, F9)', async () => {
    const env = await makeAiEnv();
    await setSettings(env, { max_image_bytes: 100_000 });
    const bruno = await env.signUp('Bruno');
    const bytes = new Uint8Array(150_000);
    bytes.set(TINY_JPEG);
    const heavy = await upload(env, bruno, 'lourde.jpg', bytes);
    expect(await call(bruno.sb, { action: 'scan_identify', photos: [{ path: heavy, role: 'front' }] })).toMatchObject({ ok: false, code: 'image_too_large' });
    expect(await call(bruno.sb, { action: 'identify_label', photo_path: heavy })).toMatchObject({ ok: false, code: 'image_too_large' });
    expect(env.anthropic.requests).toHaveLength(0);
  });

  it('assistant non configuré : message clair, aucune analyse créée (la saisie à la main reste possible)', async () => {
    const env = await makeAiEnv({ withKey: false });
    const bruno = await env.signUp('Bruno');
    const front = await upload(env, bruno, 'face.jpg');
    expect(await call(bruno.sb, { action: 'scan_identify', photos: [{ path: front, role: 'front' }] })).toMatchObject({ ok: false, code: 'ai_not_configured' });
    expect((await bruno.sb.from('scans').select('id')).data).toEqual([]);
    const manual = await bruno.sb
      .from('scans')
      .insert({ photos: [{ path: front, role: 'front' }], wine: { name: 'Saisi à la main' }, store_price: 9.5, price_confirmed: true, status: 'confirmed' })
      .select('*')
      .single();
    expect(manual.error).toBeNull();
    expect(manual.data).toMatchObject({ result: {}, from_cache: false });
  });

  it('les analyses arrivées à échéance sont supprimées avec leurs photos', async () => {
    const env = await makeAiEnv();
    const bruno = await env.signUp('Bruno');
    const old = await upload(env, bruno, 'ancienne.jpg');
    const { data } = await bruno.sb.from('scans').insert({ photos: [{ path: old, role: 'front' }], wine: { name: 'Ancien' } }).select('id').single();
    await env.db.query(`update scans set expires_at = now() - interval '1 day' where id = $1`, [(data as { id: string }).id]);
    env.anthropic.reply({ kind: 'message', content: [text(JSON.stringify(reading()))] });
    const front = await upload(env, bruno, 'face.jpg');
    expect((await call(bruno.sb, { action: 'scan_identify', photos: [{ path: front, role: 'front' }] })).ok).toBe(true);
    const left = (await bruno.sb.from('scans').select('wine')).data as { wine: { name: string } }[];
    expect(left.map((s) => s.wine.name)).toEqual(['Château Labeille']);
    expect((await bruno.sb.storage.from('photos').download(old)).error).not.toBeNull();
  });
});

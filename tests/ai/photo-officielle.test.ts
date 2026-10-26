import { describe, expect, it } from 'vitest';
import { normalizeBarcode } from '../../src/domain/barcode.ts';
import { cleanLabel } from '../../server/api/label.ts';
import { TINY_JPEG } from '../helpers/env.ts';
import { call, makeAiEnv } from './setup.ts';

const EAN = '4006381333931';
const IMG = (code: string) => `https://images.openfoodfacts.org/images/products/${code}/front_fr.5.400.jpg`;

/** Faux Open Food Facts : un produit par code-barres, une recherche par nom, les photos. */
function fakeOff(o: { down?: boolean } = {}) {
  const calls: string[] = [];
  const products: Record<string, Record<string, unknown>> = {
    [EAN]: { product_name: 'Château Labeille 2016', brands: 'Château Labeille', image_front_url: IMG(EAN), image_front_small_url: IMG(EAN), categories_tags: ['en:alcoholic-beverages', 'en:wines'] },
    '3017620422003': { product_name: 'Pâte à tartiner', image_front_url: IMG('3017620422003'), categories_tags: ['en:spreads'] },
    '3263070035762': { product_name: 'Little K by Kirvan Margaux 2012', image_front_url: IMG('3263070035762'), categories_tags: ['en:wines'] },
  };
  const fake = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url.href);
    if (o.down) return new Response('busy', { status: 503 });
    if (url.hostname === 'images.openfoodfacts.org') {
      if (url.pathname.endsWith('.full.jpg')) return new Response('absent', { status: 404 });
      return new Response(TINY_JPEG, { headers: { 'Content-Type': 'image/jpeg' } });
    }
    const m = /^\/api\/v2\/product\/(\d+)$/.exec(url.pathname);
    if (m) {
      const p = products[m[1]];
      return Response.json(p ? { status: 1, code: m[1], product: { code: m[1], ...p } } : { status: 0 });
    }
    if (url.hostname === 'search.openfoodfacts.org') {
      return Response.json({
        hits: [
          { code: '3263070035762', product_name: 'Little K by Kirvan Margaux 2012', brands: ['Kirvan'], image_front_url: IMG('3263070035762') },
          { code: '3430430005561', product_name: 'Château Kirwan Margaux 2012', brands: ['Château Kirwan'], image_front_small_url: IMG('3430430005561') },
          { code: '3000000000017', product_name: 'Bordeaux supérieur', image_front_url: IMG('3000000000017') },
          { code: '3000000000024', product_name: 'Château Kirwan sans photo' },
        ],
      });
    }
    return new Response('?', { status: 404 });
  }) as typeof fetch;
  return { fetch: fake, calls };
}

describe('code-barres', () => {
  it('vérifie la longueur et le chiffre de contrôle', () => {
    expect(normalizeBarcode('4006381333931')).toBe('4006381333931');
    expect(normalizeBarcode('4006 3813 33931')).toBe('4006381333931');
    expect(normalizeBarcode('73513537')).toBe('73513537');
    expect(normalizeBarcode('4006381333932')).toBeNull();
    expect(normalizeBarcode('12345')).toBeNull();
    expect(normalizeBarcode('')).toBeNull();
    expect(normalizeBarcode(null)).toBeNull();
  });

  it('lecture d’étiquette : code-barres gardé seulement s’il est valable', () => {
    const base = { is_wine_label: true, fields: { name: 'X' }, uncertain: [], advice: {}, notes: '' };
    expect(cleanLabel({ ...base, fields: { name: 'X', barcode: '4006381333931' } }).fields.barcode).toBe('4006381333931');
    expect(cleanLabel({ ...base, fields: { name: 'X', barcode: '4006381333932' } }).fields.barcode).toBeNull();
    expect(cleanLabel({ ...base, fields: { name: 'X', barcode: '' } }).fields.barcode).toBeNull();
  });
});

describe('photo officielle (Open Food Facts)', () => {
  it('propose le produit exact par code-barres, puis des vins proches par le nom', async () => {
    const off = fakeOff();
    const env = await makeAiEnv({ webFetch: off.fetch });
    const bruno = await env.signUp('Bruno');
    const exact = await call(bruno.sb, { action: 'photo_search', barcode: EAN, name: 'Château Labeille', vintage: 2016 });
    expect(exact.ok).toBe(true);
    expect((exact.candidates as { code: string; exact: boolean }[])[0]).toMatchObject({ code: EAN, exact: true });

    const byName = await call(bruno.sb, { action: 'photo_search', name: 'Château Kirwan', vintage: 2012, appellation: 'Margaux' });
    const codes = (byName.candidates as { code: string; exact: boolean }[]).map((c) => c.code);
    // Le vin dont le nom correspond passe en premier ; un vin sans rapport ou sans photo est écarté.
    expect(codes[0]).toBe('3430430005561');
    expect(codes).not.toContain('3000000000017');
    expect(codes).not.toContain('3000000000024');
    // Aucun appel à Claude.
    expect(env.anthropic.requests).toHaveLength(0);
  });

  it('ignore un code-barres qui n’est pas un vin', async () => {
    const env = await makeAiEnv({ webFetch: fakeOff().fetch });
    const bruno = await env.signUp('Bruno');
    const res = await call(bruno.sb, { action: 'photo_search', barcode: '3017620422003' });
    expect(res).toMatchObject({ ok: true, candidates: [] });
  });

  it('importe la photo dans le dossier privé de la personne, avec la mention de source', async () => {
    const off = fakeOff();
    const env = await makeAiEnv({ webFetch: off.fetch });
    const bruno = await env.signUp('Bruno');
    const res = await call(bruno.sb, { action: 'photo_import', code: EAN });
    expect(res.ok).toBe(true);
    expect(res.path).toMatch(new RegExp(`^${bruno.id}/off-${EAN}-[0-9a-f]{8}\\.jpeg$`));
    expect(res.credit).toBe(`Photo Open Food Facts (licence CC BY-SA 3.0) — https://world.openfoodfacts.org/product/${EAN}`);
    // Pleine résolution essayée d'abord, puis la version 400 px.
    expect(off.calls.some((u) => u.endsWith('.full.jpg'))).toBe(true);
    const { data } = await bruno.sb.storage.from('photos').download(res.path as string);
    expect(data?.size).toBe(TINY_JPEG.byteLength);
    // La fiche peut l'enregistrer avec son origine et son crédit.
    const { error } = await bruno.sb
      .from('wines')
      .insert({ name: 'Château Labeille', barcode: EAN, bottle_photo: res.path, bottle_photo_source: 'off', bottle_photo_credit: res.credit });
    expect(error).toBeNull();
  });

  it('refuse un code invalide, et signale un Open Food Facts indisponible', async () => {
    const env = await makeAiEnv({ webFetch: fakeOff({ down: true }).fetch });
    const bruno = await env.signUp('Bruno');
    expect(await call(bruno.sb, { action: 'photo_import', code: '../x' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await call(bruno.sb, { action: 'photo_search', barcode: EAN })).toMatchObject({ ok: false, code: 'photo_service_unavailable' });
  });

  it('nombre d’appels à Open Food Facts limité par personne : 30 par 10 minutes (audit, F4)', async () => {
    const off = fakeOff();
    const env = await makeAiEnv({ webFetch: off.fetch });
    const bruno = await env.signUp('Bruno');
    const claire = await env.signUp('Claire');
    expect((await call(bruno.sb, { action: 'photo_search', barcode: EAN })).ok).toBe(true);
    expect((await env.db.query(`select bucket from rate_hits where subject = $1`, [bruno.id])).rows).toEqual([{ bucket: 'off' }]);
    await env.db.query(`insert into rate_hits (bucket, subject) select 'off', $1 from generate_series(1, 29)`, [bruno.id]);
    const calls = off.calls.length;
    expect(await call(bruno.sb, { action: 'photo_search', barcode: EAN })).toMatchObject({ ok: false, code: 'photo_rate_limited', message: expect.stringMatching(/quelques minutes/) });
    expect(await call(bruno.sb, { action: 'photo_import', code: EAN })).toMatchObject({ ok: false, code: 'photo_rate_limited' });
    expect(off.calls).toHaveLength(calls);
    // Les autres personnes ne sont pas concernées.
    expect((await call(claire.sb, { action: 'photo_search', barcode: EAN })).ok).toBe(true);
  });

  it('photo annoncée trop lourde : ni téléchargée ni importée (audit, F9)', async () => {
    const base = fakeOff();
    const heavy = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await base.fetch(input, init);
      if (new URL(String(input)).hostname !== 'images.openfoodfacts.org' || !res.ok) return res;
      return new Response(res.body, { headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '9000000' } });
    }) as typeof fetch;
    const env = await makeAiEnv({ webFetch: heavy });
    const bruno = await env.signUp('Bruno');
    expect(await call(bruno.sb, { action: 'photo_import', code: EAN })).toMatchObject({ ok: false, code: 'photo_service_unavailable' });
    expect((await env.db.query(`select 1 from storage.objects where name like $1`, [`${bruno.id}/%`])).rows).toHaveLength(0);
  });

  it('la base refuse un code-barres ou une origine de photo non valables', async () => {
    const env = await makeAiEnv({ webFetch: fakeOff().fetch });
    const bruno = await env.signUp('Bruno');
    expect((await bruno.sb.from('wines').insert({ name: 'A', barcode: '12ab' })).error).not.toBeNull();
    expect((await bruno.sb.from('wines').insert({ name: 'B', bottle_photo_source: 'pinterest' })).error).not.toBeNull();
    // Photo d'origine (studio) : seulement dans le dossier de la personne.
    expect((await bruno.sb.from('wines').insert({ name: 'C', bottle_photo_original: 'quelqu-un/photo.jpg' })).error).not.toBeNull();
    expect((await bruno.sb.from('wines').insert({ name: 'D', bottle_photo_source: 'studio', bottle_photo_original: `${bruno.id}/origine.jpg` })).error).toBeNull();
  });
});

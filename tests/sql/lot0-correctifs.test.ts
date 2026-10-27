import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, addWine, as, asService, befriend, createDb, createUser, expectError, one, rid, type Db } from '../helpers/db.ts';

let db: Db;
let bruno: string;
let claire: string;
let marc: string;

beforeEach(async () => {
  db = await createDb();
  bruno = await createUser(db, 'Bruno');
  claire = await createUser(db, 'Claire');
  marc = await createUser(db, 'Marc');
  await befriend(db, bruno, claire);
  await befriend(db, bruno, marc);
});

const createTasting = (user: string, p: Record<string, unknown>) =>
  one(db, user, `select create_tasting($1::jsonb, null, $2)`, [JSON.stringify(p), rid()]);
async function tasting(guests: string[]) {
  const ev = await one<{ r: { id: string } }>(db, bruno, `select to_json(create_event($1::jsonb, $2::uuid[])) as r`, [
    JSON.stringify({ title: 'Dégustation', kind: 'degustation', starts_at: new Date().toISOString() }),
    `{${guests.join(',')}}`,
  ]);
  return ev.r.id;
}
const begin = (user: string, action: string) =>
  asService<{ r: { ok: boolean; code?: string } }>(db, `select ai_begin($1, $2, 'claude-sonnet-5-5', 0.01) as r`, [user, action]).then((x) => x[0].r);

describe('dégustations partagées avec un événement (audit Cave 2.0, point 7)', () => {
  it('les participants lisent la note partagée, jamais le prix payé ; les autres rien', async () => {
    const ev = await tasting([claire]);
    await createTasting(bruno, { wine_name: 'Partagée', event_id: ev, share_with_event: true, comment: 'Très belle', price_paid: 85, price_kind: 'achat_boutique' });
    await createTasting(bruno, { wine_name: 'Privée', event_id: ev, price_paid: 12 });
    await createTasting(claire, { wine_name: 'Celle de Claire', event_id: ev, price_paid: 30 });

    // Claire : la note partagée de Bruno sans son prix, la sienne en entier.
    const seen = await as<{ wine_name: string; comment: string | null; price_paid: string | null; price_kind: string | null }>(
      db,
      claire,
      `select wine_name, comment, price_paid, price_kind from event_tastings($1) order by wine_name`,
      [ev],
    );
    expect(seen).toEqual([
      { wine_name: 'Celle de Claire', comment: null, price_paid: '30.00', price_kind: null },
      { wine_name: 'Partagée', comment: 'Très belle', price_paid: null, price_kind: null },
    ]);
    // Dans la table : seulement ses propres notes.
    expect((await as<{ wine_name: string }>(db, claire, `select wine_name from tastings`)).map((t) => t.wine_name)).toEqual(['Celle de Claire']);
    // Ni les liens internes de Bruno (lot, fiche, groupe…).
    expect(await as(db, claire, `select lot_id, wine_id, movement_id, group_id, request_id from event_tastings($1) where wine_name = 'Partagée'`, [ev])).toEqual([
      { lot_id: null, wine_id: null, movement_id: null, group_id: null, request_id: null },
    ]);
    // Bruno garde son prix ; Marc, non invité, ne voit rien.
    expect(await as(db, bruno, `select price_paid from event_tastings($1) where wine_name = 'Partagée'`, [ev])).toEqual([{ price_paid: '85.00' }]);
    expect(await as(db, marc, `select * from event_tastings($1)`, [ev])).toEqual([]);
    await expectError(as(db, null, `select * from event_tastings($1)`, [ev]), /permission denied/);
  });
});

describe('historique des prix d’une cave partagée (audit Cave 2.0, point 8)', () => {
  it('la personne associée ajoute un relevé, seul le propriétaire en modifie ou en supprime', async () => {
    const cave = (await one<{ id: string }>(db, bruno, `select id from cellars where name = 'Ma cave'`)).id;
    await one(db, bruno, `select invite_to_cellar($1, $2::uuid[])`, [cave, [claire]]);
    await one(db, claire, `select respond_cellar_invite($1, true)`, [cave]);
    const { wineId } = await addWine(db, bruno, { name: 'Morgon' }, { cellar_id: cave });
    await as(db, bruno, `insert into market_prices (wine_id, price_low, price_high, method) values ($1, 18, 22, 'manual')`, [wineId]);
    await as(db, claire, `insert into market_prices (wine_id, price_low, price_high) values ($1, 20, 25)`, [wineId]);
    expect(await as(db, claire, `delete from market_prices returning id`)).toEqual([]);
    // Ni modifier le prix, ni rattacher le relevé à une de ses fiches (il quitterait l'historique de Bruno).
    const { wineId: hers } = await addWine(db, claire, { name: 'À Claire' });
    expect(await as(db, claire, `update market_prices set price_low = 1 returning id`)).toEqual([]);
    expect(await as(db, claire, `update market_prices set wine_id = $1 returning id`, [hers])).toEqual([]);
    expect((await as(db, bruno, `update market_prices set price_high = 30 where price_low = 18 returning id`)).length).toBe(1);
    expect((await as(db, bruno, `select price_low from market_prices order by price_low`)).length).toBe(2);
    expect((await as(db, bruno, `delete from market_prices returning id`)).length).toBe(2);
  });
});

describe('nombre d’analyses du scanner par jour, sous le verrou d’ai_begin (audit Cave 2.0, point 5)', () => {
  it('au-delà de la limite, la réservation est refusée ; les autres actions ne sont pas touchées', async () => {
    await asService(db, `update ai_settings set scan_daily_limit = 1 where id = 1`);
    expect(await begin(bruno, 'scan')).toMatchObject({ ok: true });
    expect(await begin(bruno, 'scan')).toEqual({ ok: false, code: 'scan_quota' });
    expect(await begin(bruno, 'scan_quality')).toMatchObject({ ok: true });
    expect(await begin(claire, 'scan')).toMatchObject({ ok: true });
  });
});

describe('cache commun du scanner (audit Cave 2.0, point 9)', () => {
  it('la mise à jour efface les analyses de vins en cache, pas les lectures d’étiquettes ni les prix', async () => {
    const later = new Date(Date.now() + 86_400_000).toISOString();
    for (const kind of ['identify', 'assess', 'price'])
      await asService(db, `insert into scan_cache (key, kind, value, expires_at) values ($1, $2, '{}', $3)`, [`k-${kind}`, kind, later]);
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '20261102000002_lot0_correctifs.sql'), 'utf8'));
    expect((await asService<{ kind: string }>(db, `select kind from scan_cache order by kind`)).map((r) => r.kind)).toEqual(['identify', 'price']);
  });
});

describe('tarifs de l’IA (audit Cave 2.0)', () => {
  it('lecture en cache de Claude Sonnet 5.5 : 0,20 $ ; un tarif réglé par l’administration reste tel quel', async () => {
    expect(await asService(db, `select prices -> 'claude-sonnet-5-5' ->> 'cache_read' as v from ai_settings`)).toEqual([{ v: '0.2' }]);
    await asService(db, `update ai_settings set prices = jsonb_set(prices, '{claude-sonnet-5-5,cache_read}', '0.15')`);
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '20261102000002_lot0_correctifs.sql'), 'utf8'));
    expect(await asService(db, `select prices -> 'claude-sonnet-5-5' ->> 'cache_read' as v from ai_settings`)).toEqual([{ v: '0.15' }]);
  });
});

describe('mise à jour et retour arrière', () => {
  it('le retour arrière rend l’état d’avant ; la mise à jour se rejoue sans danger', async () => {
    const ev = await tasting([claire]);
    await createTasting(bruno, { wine_name: 'Partagée', event_id: ev, share_with_event: true, price_paid: 85 });
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '..', 'sql', 'retour-20261102000002.sql'), 'utf8'));
    expect(await as(db, claire, `select price_paid from tastings`)).toEqual([{ price_paid: '85.00' }]);
    await asService(db, `update ai_settings set scan_daily_limit = 1 where id = 1`);
    expect(await begin(bruno, 'scan')).toMatchObject({ ok: true });
    expect(await begin(bruno, 'scan')).toMatchObject({ ok: true });

    const migration = readFileSync(join(MIGRATIONS_DIR, '20261102000002_lot0_correctifs.sql'), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    expect(await as(db, claire, `select * from tastings`)).toEqual([]);
    expect(await as(db, claire, `select price_paid from event_tastings($1)`, [ev])).toEqual([{ price_paid: null }]);
    await asService(db, `update ai_usage set status = 'done', reserved_usd = 0`);
    expect(await begin(bruno, 'scan')).toEqual({ ok: false, code: 'scan_quota' });
  });
});

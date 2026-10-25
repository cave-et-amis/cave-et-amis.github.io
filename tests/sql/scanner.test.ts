import { describe, expect, it } from 'vitest';
import { as, asService, createDb, createUser, expectError, one } from '../helpers/db.ts';

describe('scanner : droits sur les analyses', () => {
  it('chacun ne voit et ne modifie que ses analyses ; la lecture de Lia est réservée au serveur', async () => {
    const db = await createDb();
    const bruno = await createUser(db, 'Bruno');
    const claire = await createUser(db, 'Claire');
    const s = await one<{ id: string; expires_at: string; created_at: string }>(
      db,
      bruno,
      `insert into scans (photos, wine, store_price) values ($1, '{"name":"Vin"}', 12.5) returning id, expires_at, created_at`,
      [JSON.stringify([{ path: `${bruno}/a.jpg`, role: 'front' }])],
    );
    // Conservation fixée par les réglages (30 jours par défaut).
    expect(Math.round((Date.parse(s.expires_at) - Date.parse(s.created_at)) / 86_400_000)).toBe(30);
    expect(await as(db, claire, `select id from scans`)).toEqual([]);
    expect(await as(db, claire, `update scans set store_price = 1 where id = $1 returning id`, [s.id])).toEqual([]);
    expect(await as(db, claire, `delete from scans where id = $1 returning id`, [s.id])).toEqual([]);
    await expectError(as(db, bruno, `update scans set result = '{"x":1}' where id = $1`, [s.id]), /permission denied/);
    await expectError(as(db, bruno, `insert into scans (result) values ('{"x":1}')`), /permission denied/);
    await expectError(as(db, bruno, `insert into scans (user_id) values ($1)`, [claire]), /permission denied/);
    // Photo d'une autre personne, rôle inconnu, prix confirmé sans prix : refusés.
    await expectError(as(db, bruno, `insert into scans (photos) values ($1)`, [JSON.stringify([{ path: `${claire}/x.jpg`, role: 'front' }])]), /invalid/);
    await expectError(as(db, bruno, `insert into scans (photos) values ($1)`, [JSON.stringify([{ path: `${bruno}/x.jpg`, role: 'menu' }])]), /invalid/);
    await expectError(as(db, bruno, `update scans set store_price = null, price_confirmed = true where id = $1`, [s.id]), /check/);
    expect(await as(db, bruno, `update scans set price_confirmed = true, status = 'confirmed' where id = $1 returning status`, [s.id])).toEqual([
      { status: 'confirmed' },
    ]);
    // Lot 3c : budget privé, modifiable par la personne seulement, montant valable ; analyse et prix écrits par le serveur seul.
    expect(await as(db, bruno, `update scans set budget = 25 where id = $1 returning budget`, [s.id])).toEqual([{ budget: '25.00' }]);
    await expectError(as(db, bruno, `update scans set budget = -1 where id = $1`, [s.id]), /check/);
    expect(await as(db, claire, `update scans set budget = 1 where id = $1 returning id`, [s.id])).toEqual([]);
    await expectError(as(db, bruno, `update scans set assessment = '{}' where id = $1`, [s.id]), /permission denied/);
    await expectError(as(db, bruno, `update scans set market = '{}' where id = $1`, [s.id]), /permission denied/);
  });

  it('cache et quota : inaccessibles depuis l’application', async () => {
    const db = await createDb();
    const bruno = await createUser(db, 'Bruno');
    await asService(db, `insert into scan_cache (key, kind, value, expires_at) values ('k', 'identify', '{}', now() + interval '1 day')`);
    await expectError(as(db, bruno, `select * from scan_cache`), /permission denied/);
    await expectError(as(db, bruno, `select scan_quota($1)`, [bruno]), /permission denied/);
    await asService(db, `insert into ai_usage (user_id, action, model) values ($1, 'scan', 'claude-sonnet-5-5')`, [bruno]);
    expect((await one<{ s: { used: number; limit: number; retention_days: number } }>(db, bruno, `select my_scan_status() as s`)).s).toEqual({
      used: 1,
      limit: 10,
      retention_days: 30,
    });
  });
});

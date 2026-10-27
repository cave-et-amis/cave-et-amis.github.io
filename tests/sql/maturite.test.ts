import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, addWine, as, asService, createDb, createUser, expectError, one, rid, type Db } from '../helpers/db.ts';

let db: Db;
let bruno: string;
let claire: string;
let year: number;

beforeEach(async () => {
  db = await createDb();
  bruno = await createUser(db, 'Bruno');
  claire = await createUser(db, 'Claire');
  year = (await db.query<{ y: number }>(`select extract(year from today_paris())::int as y`)).rows[0].y;
});

const optIn = (who: string, on = true) => one(db, who, `select merge_preferences($1::jsonb)`, [JSON.stringify({ maturity_alerts: on })]);
const run = () => asService<{ n: number }>(db, `select maturity_alerts() as n`).then((r) => r[0].n);
const alerts = (who: string) =>
  as<{ kind: string; actor_name: string; ref_id: string }>(db, who, `select kind, actor_name, ref_id from notifications where kind like 'maturity%' order by kind, actor_name`);

describe('alertes de maturité (mission F)', () => {
  it('seulement si demandées ; période de la fiche ; une fois par an et par vin', async () => {
    const entre = await addWine(db, bruno, { name: 'Morgon', vintage: 2020, drink_from: year, drink_until: year + 6, window_source: 'personal' }, { quantity: 2 });
    const fin = await addWine(db, bruno, { name: 'Muscadet', vintage: 2019, drink_from: year - 4, drink_until: year, window_source: 'ai' }, { quantity: 1 });
    await addWine(db, bruno, { name: 'Jeune', drink_from: year + 2, drink_until: year + 9 }, { quantity: 3 });
    await addWine(db, bruno, { name: 'Sans période', vintage: 2015 }, { quantity: 3 });
    // Pas demandé : rien.
    expect(await run()).toBe(0);
    await optIn(bruno);
    expect(await run()).toBe(2);
    expect(await alerts(bruno)).toEqual([
      { kind: 'maturity_last', actor_name: 'Muscadet 2019', ref_id: fin.wineId },
      { kind: 'maturity_ready', actor_name: 'Morgon 2020', ref_id: entre.wineId },
    ]);
    // Le lendemain : pas de doublon.
    expect(await run()).toBe(0);
    // Claire, qui n'a rien demandé, n'a rien ; elle ne voit pas les alertes de Bruno.
    expect(await alerts(claire)).toEqual([]);
    // Désactivées : plus rien de nouveau.
    await optIn(bruno, false);
    await addWine(db, bruno, { name: 'Brouilly', drink_from: year, drink_until: year + 3, window_source: 'source' }, { quantity: 1 });
    expect(await run()).toBe(0);
  });

  it('aucune bouteille libre (bues, ou réservées pour un événement) : pas d’alerte', async () => {
    await optIn(bruno);
    const { lotId } = await addWine(db, bruno, { name: 'Bu', drink_from: year, drink_until: year + 2 }, { quantity: 1 });
    await one(db, bruno, `select record_movement($1, 'consommation', 1, null, null, $2)`, [lotId, rid()]);
    const reserved = await addWine(db, bruno, { name: 'Réservé', drink_from: year, drink_until: year + 2 }, { quantity: 1 });
    await asService(db, `update lots set reserved = 1 where id = $1`, [reserved.lotId]);
    expect(await run()).toBe(0);
  });

  it('notification effacée par la personne : l’alerte ne revient pas la même année ; repère général exclu', async () => {
    await optIn(bruno);
    await addWine(db, bruno, { name: 'Morgon', drink_from: year, drink_until: year + 3, window_source: 'personal' }, { quantity: 1 });
    await addWine(db, bruno, { name: 'Repère', drink_from: year, drink_until: year + 3, window_source: 'general' }, { quantity: 1 });
    expect(await run()).toBe(1);
    await as(db, bruno, `delete from notifications where kind like 'maturity%'`);
    expect(await run()).toBe(0);
    expect(await alerts(bruno)).toEqual([]);
    await expectError(as(db, bruno, `select * from maturity_alerts_sent`), /permission denied/);
  });

  it('plus de 3 nouvelles alertes le même jour : un seul résumé', async () => {
    await optIn(bruno);
    for (const name of ['A', 'B', 'C', 'D', 'E']) await addWine(db, bruno, { name, drink_from: year, drink_until: year + 3 }, { quantity: 1 });
    expect(await run()).toBe(5);
    expect(await alerts(bruno)).toEqual([{ kind: 'maturity_many', actor_name: '5', ref_id: null }]);
    expect(await run()).toBe(0);
  });

  it('réservée au serveur', async () => {
    await expectError(as(db, bruno, `select maturity_alerts()`), /permission denied/);
    await expectError(as(db, null, `select maturity_alerts()`), /permission denied/);
  });

  it('retour arrière, puis mise à jour rejouable', async () => {
    await optIn(bruno);
    await addWine(db, bruno, { name: 'Morgon', drink_from: year, drink_until: year + 3 }, { quantity: 1 });
    expect(await run()).toBe(1);
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '..', 'sql', 'retour-20261102000004.sql'), 'utf8'));
    expect(await alerts(bruno)).toEqual([]);
    await expectError(asService(db, `select maturity_alerts()`), /does not exist/);
    const migration = readFileSync(join(MIGRATIONS_DIR, '20261102000004_maturite.sql'), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    expect(await run()).toBe(1);
  });
});

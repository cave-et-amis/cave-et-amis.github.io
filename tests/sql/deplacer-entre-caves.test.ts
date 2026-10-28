import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, addWine, as, befriend, createDb, createUser, expectError, lotState, one, rid, type Db } from '../helpers/db.ts';

let db: Db;
let bruno: string;
let claire: string;
let marc: string;
let rouge: string;
let blanc: string;
let haut: string;
let frigo: string;

beforeEach(async () => {
  db = await createDb();
  bruno = await createUser(db, 'Bruno');
  claire = await createUser(db, 'Claire');
  marc = await createUser(db, 'Marc');
  await befriend(db, bruno, claire);
  rouge = (await one<{ id: string }>(db, bruno, `select id from cellars where name = 'Ma cave'`)).id;
  blanc = (await one<{ id: string }>(db, bruno, `insert into cellars (name) values ('Cave blanc') returning id`)).id;
  haut = (await one<{ id: string }>(db, bruno, `insert into locations (cellar_id, name) values ($1, 'Haut') returning id`, [rouge])).id;
  frigo = (await one<{ id: string }>(db, bruno, `insert into locations (cellar_id, name) values ($1, 'Frigo') returning id`, [blanc])).id;
});

type Moved = { lot_id: string; moved_lot_id: string; quantity: number };
const move = (who: string, lot: string, n: number, cellar: string | null, to: string | null, request = rid(), whole = false) =>
  one<{ r: Moved }>(db, who, `select move_bottles($1, $2, $3, $4, $5, $6) as r`, [lot, n, to, request, cellar, whole]).then((x) => x.r);
const movements = async () => (await db.query<{ n: number }>(`select count(*)::int as n from movements`)).rows[0].n;
const total = async (wine: string) => (await db.query<{ n: number }>(`select sum(quantity)::int as n from lots where wine_id = $1`, [wine])).rows[0].n;
const lotRow = async (id: string) => (await db.query<Record<string, unknown>>(`select * from lots where id = $1`, [id])).rows[0];

describe('déplacer vers une autre cave', () => {
  it('tout le lot : cave et emplacement changent, aucun mouvement de stock, historique avec les caves', async () => {
    const { wineId, lotId } = await addWine(db, bruno, { name: 'Chablis' }, { quantity: 3, location_id: haut });
    const before = await movements();
    expect(await move(bruno, lotId, 3, blanc, frigo)).toEqual({ lot_id: lotId, moved_lot_id: lotId, quantity: 3 });
    expect(await lotRow(lotId)).toMatchObject({ cellar_id: blanc, location_id: frigo, quantity: 3 });
    // Retour « sans emplacement » dans la première cave.
    await move(bruno, lotId, 3, rouge, null);
    expect(await lotRow(lotId)).toMatchObject({ cellar_id: rouge, location_id: null });
    expect(await movements()).toBe(before);
    expect(await total(wineId)).toBe(3);
    expect(await as(db, bruno, `select from_cellar, to_cellar, from_location, to_location from bottle_moves order by created_at`)).toEqual([
      { from_cellar: rouge, to_cellar: blanc, from_location: haut, to_location: frigo },
      { from_cellar: blanc, to_cellar: rouge, from_location: frigo, to_location: null },
    ]);
  });

  it('une partie : lot jumeau dans l’autre cave, total inchangé', async () => {
    const { wineId, lotId } = await addWine(db, bruno, { name: 'Chablis' }, { quantity: 6, location_id: haut, hide_price: true });
    const r = await move(bruno, lotId, 2, blanc, null);
    expect(r.moved_lot_id).not.toBe(lotId);
    expect(await lotRow(r.moved_lot_id)).toMatchObject({ cellar_id: blanc, location_id: null, quantity: 2, hide_price: true, owner_id: bruno });
    expect(await lotRow(lotId)).toMatchObject({ cellar_id: rouge, location_id: haut, quantity: 4 });
    expect(await total(wineId)).toBe(6);
  });

  it('même cave, même place : refus ; autre cave, même emplacement vide : accepté', async () => {
    const { lotId } = await addWine(db, bruno, { name: 'Chablis' }, { quantity: 2 });
    await expectError(move(bruno, lotId, 1, rouge, null), /same_location/);
    await expectError(move(bruno, lotId, 1, null, null), /same_location/);
    await move(bruno, lotId, 1, blanc, null);
  });

  it('refus : emplacement d’une autre cave, cave d’autrui ou inconnue', async () => {
    const { lotId } = await addWine(db, bruno, { name: 'Chablis' }, { quantity: 2, location_id: haut });
    await expectError(move(bruno, lotId, 1, blanc, haut), /location_mismatch/);
    await expectError(move(bruno, lotId, 1, rouge, frigo), /location_mismatch/);
    const chezMarc = (await one<{ id: string }>(db, marc, `select id from cellars where name = 'Ma cave'`)).id;
    await expectError(move(bruno, lotId, 1, chezMarc, null), /not_found/);
    await expectError(move(bruno, lotId, 1, rid(), null), /not_found/);
    expect(await lotRow(lotId)).toMatchObject({ cellar_id: rouge, location_id: haut, quantity: 2 });
    expect((await db.query(`select * from bottle_moves`)).rows).toEqual([]);
  });

  it('cave partagée : la personne associée range dans la cave qu’elle gère, pas dans une autre cave du propriétaire', async () => {
    const { lotId } = await addWine(db, bruno, { name: 'Chablis' }, { quantity: 4, location_id: haut });
    await one(db, bruno, `select invite_to_cellar($1, $2::uuid[])`, [rouge, [claire]]);
    await one(db, claire, `select respond_cellar_invite($1, true)`, [rouge]);
    await move(claire, lotId, 1, rouge, null);
    // Claire ne gère pas la cave « Cave blanc » de Bruno.
    await expectError(move(claire, lotId, 1, blanc, null), /not_found/);
    await one(db, bruno, `select invite_to_cellar($1, $2::uuid[])`, [blanc, [claire]]);
    await one(db, claire, `select respond_cellar_invite($1, true)`, [blanc]);
    const r = await move(claire, lotId, 1, blanc, frigo);
    expect(await lotRow(r.moved_lot_id)).toMatchObject({ owner_id: bruno, cellar_id: blanc, location_id: frigo });
  });
});

describe('lot réservé', () => {
  it('tout le lot part avec ses réservations (événement et groupe), qui restent les mêmes', async () => {
    const { wineId, lotId } = await addWine(db, bruno, { name: 'Rully' }, { quantity: 3, location_id: haut });
    const ev = await one<{ r: { id: string } }>(db, bruno, `select to_json(create_event($1::jsonb, $2::uuid[])) as r`, [
      JSON.stringify({ kind: 'diner', title: 'Dîner', starts_at: '2030-01-01T19:00:00Z' }), `{${claire}}`,
    ]);
    await one(db, bruno, `select propose_event_wine($1, $2, 1, null, true, $3)`, [ev.r.id, lotId, rid()]);
    const g = await one<{ id: string }>(db, bruno, `select (create_group('Les soirées', '🎉', null, null, $1::uuid[])).id`, [[claire]]);
    await one(db, claire, `select respond_group_invite($1, true)`, [g.id]);
    await one(db, bruno, `select allocate_to_group($1, $2, 2)`, [lotId, g.id]);
    expect(await lotState(db, lotId)).toEqual({ quantity: 3, reserved: 3 });
    // Aucune bouteille libre : une partie est refusée ; le nombre exact du lot sans « tout le lot » aussi (jamais de
    // réservées par hasard) ; « tout le lot » avec un nombre périmé aussi ; « tout le lot » explicite est accepté.
    await expectError(move(bruno, lotId, 1, rouge, null), /not_enough_free/);
    await expectError(move(bruno, lotId, 3, blanc, frigo), /not_enough_free/);
    await expectError(move(bruno, lotId, 2, blanc, frigo, rid(), true), /not_enough_free/);
    expect(await move(bruno, lotId, 3, blanc, frigo, rid(), true)).toEqual({ lot_id: lotId, moved_lot_id: lotId, quantity: 3 });
    expect(await lotRow(lotId)).toMatchObject({ cellar_id: blanc, location_id: frigo, quantity: 3, reserved: 3 });
    expect(await as(db, bruno, `select reserved_qty from event_wines where lot_id = $1`, [lotId])).toEqual([{ reserved_qty: 1 }]);
    expect(await as(db, bruno, `select allocated from group_shares where lot_id = $1`, [lotId])).toEqual([{ allocated: 2 }]);
    expect(await total(wineId)).toBe(3);
    // Site d'avant (4 paramètres) : jamais de réservées, donc ce lot ne bouge pas.
    await expectError(one(db, bruno, `select move_bottles($1, 3, null, $2)`, [lotId, rid()]), /not_enough_free/);
    expect(await lotRow(lotId)).toMatchObject({ cellar_id: blanc, location_id: frigo, reserved: 3 });
  });
});

describe('export et retour arrière', () => {
  it('export : caves de départ et d’arrivée', async () => {
    const { lotId } = await addWine(db, bruno, { name: 'Chablis', vintage: 2021 }, { quantity: 2, location_id: haut });
    await move(bruno, lotId, 1, blanc, frigo);
    const d = (await one<{ d: Record<string, unknown[]> }>(db, bruno, `select export_my_data() as d`)).d;
    expect(d.deplacements_de_bouteilles).toEqual([
      expect.objectContaining({ vin: 'Chablis 2021', bouteilles: 1, de_la_cave: 'Ma cave', de: 'Haut', vers_la_cave: 'Cave blanc', vers: 'Frigo', par_moi: true }),
    ]);
    expect(d).toHaveProperty('compte');
    expect((await one<{ d: Record<string, unknown[]> }>(db, marc, `select export_my_data() as d`)).d.deplacements_de_bouteilles).toEqual([]);
  });

  it('retour arrière : signature à 4 paramètres d’avant, historique sans les caves', async () => {
    const { lotId } = await addWine(db, bruno, { name: 'Chablis' }, { quantity: 2, location_id: haut });
    await move(bruno, lotId, 1, blanc, null);
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '..', 'sql', 'retour-20261102000011.sql'), 'utf8'));
    expect((await db.query(`select pronargs from pg_proc where proname = 'move_bottles'`)).rows).toEqual([{ pronargs: 4 }]);
    expect((await db.query(`select 1 from information_schema.columns where table_name = 'bottle_moves' and column_name in ('from_cellar', 'to_cellar')`)).rows).toEqual([]);
    // La règle d'avant : un lot réservé ne bouge pas, une autre cave est refusée.
    await expectError(one(db, bruno, `select move_bottles($1, 1, $2, $3)`, [lotId, frigo, rid()]), /location_mismatch/);
    await one(db, bruno, `select move_bottles($1, 1, null, $2)`, [lotId, rid()]);
    const d = (await one<{ d: Record<string, unknown[]> }>(db, bruno, `select export_my_data() as d`)).d;
    expect(d.deplacements_de_bouteilles).toHaveLength(2);
    expect(d.deplacements_de_bouteilles[0]).not.toHaveProperty('vers_la_cave');
  });
});

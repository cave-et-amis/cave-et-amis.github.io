import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, addWine, as, befriend, createDb, createUser, expectError, lotState, one, rid, type Db } from '../helpers/db.ts';

let db: Db;
let bruno: string;
let claire: string;
let marc: string;
let cave: string;
let haut: string;
let bas: string;

beforeEach(async () => {
  db = await createDb();
  bruno = await createUser(db, 'Bruno');
  claire = await createUser(db, 'Claire');
  marc = await createUser(db, 'Marc');
  await befriend(db, bruno, claire);
  cave = (await one<{ id: string }>(db, bruno, `select id from cellars where name = 'Ma cave'`)).id;
  haut = (await one<{ id: string }>(db, bruno, `insert into locations (cellar_id, name, kind, rows, slots_per_row) values ($1, 'Étagère du haut', 'etagere', 4, 12) returning id`, [cave])).id;
  bas = (await one<{ id: string }>(db, bruno, `insert into locations (cellar_id, name) values ($1, 'Casier du bas') returning id`, [cave])).id;
});

type Moved = { lot_id: string; moved_lot_id: string; quantity: number };
const move = (who: string, lot: string, n: number, to: string | null, request = rid()) =>
  one<{ r: Moved }>(db, who, `select move_bottles($1, $2, $3, $4) as r`, [lot, n, to, request]).then((x) => x.r);
const movements = async () => (await db.query<{ n: number }>(`select count(*)::int as n from movements`)).rows[0].n;
const total = async (wine: string) => (await db.query<{ n: number }>(`select sum(quantity)::int as n from lots where wine_id = $1`, [wine])).rows[0].n;
const lotRow = async (id: string) => (await db.query<Record<string, unknown>>(`select * from lots where id = $1`, [id])).rows[0];

describe('disposition des étagères', () => {
  it('rangées et places : vides par défaut, bornées, insérées et modifiées par l’appli', async () => {
    expect(await as(db, bruno, `select name, rows, slots_per_row from locations order by name`)).toEqual([
      { name: 'Casier du bas', rows: null, slots_per_row: null },
      { name: 'Étagère du haut', rows: 4, slots_per_row: 12 },
    ]);
    await as(db, bruno, `update locations set rows = 20, slots_per_row = 48 where id = $1`, [bas]);
    // Les deux ensemble ou aucun : une disposition à moitié remplie est refusée.
    await expectError(as(db, bruno, `update locations set rows = null where id = $1`, [haut]), /check constraint/);
    await as(db, bruno, `update locations set rows = null, slots_per_row = null where id = $1`, [haut]);
    expect(await as(db, bruno, `select rows, slots_per_row from locations where id = $1`, [bas])).toEqual([{ rows: 20, slots_per_row: 48 }]);
    await expectError(as(db, bruno, `update locations set rows = 0 where id = $1`, [bas]), /check constraint/);
    await expectError(as(db, bruno, `update locations set rows = 21 where id = $1`, [bas]), /check constraint/);
    await expectError(as(db, bruno, `update locations set slots_per_row = 0 where id = $1`, [bas]), /check constraint/);
    await expectError(as(db, bruno, `insert into locations (cellar_id, name, slots_per_row) values ($1, 'Trop large', 49)`, [cave]), /check constraint/);
    // Marc ne touche pas aux étagères de Bruno.
    expect(await as(db, marc, `update locations set rows = 3 returning id`)).toEqual([]);
  });
});

describe('déplacer des bouteilles', () => {
  it('tout le lot : seul l’emplacement change, aucun mouvement de stock', async () => {
    const { lotId } = await addWine(db, bruno, { name: 'Morgon' }, { quantity: 6, location_id: haut });
    const before = await movements();
    expect(await move(bruno, lotId, 6, bas)).toEqual({ lot_id: lotId, moved_lot_id: lotId, quantity: 6 });
    expect((await lotRow(lotId)).location_id).toBe(bas);
    expect(await move(bruno, lotId, 6, null)).toEqual({ lot_id: lotId, moved_lot_id: lotId, quantity: 6 });
    expect((await lotRow(lotId)).location_id).toBeNull();
    expect(await movements()).toBe(before);
    expect(await as(db, bruno, `select quantity, from_location, to_location, new_lot_id from bottle_moves order by created_at`)).toEqual([
      { quantity: 6, from_location: haut, to_location: bas, new_lot_id: null },
      { quantity: 6, from_location: bas, to_location: null, new_lot_id: null },
    ]);
  });

  it('une partie : lot jumeau à la nouvelle place, même achat et mêmes masques, total inchangé', async () => {
    const { wineId, lotId } = await addWine(db, bruno, { name: 'Chablis', vintage: 2019 }, {
      quantity: 6, location_id: haut, purchase_price: 18.5, currency: 'CHF', purchase_date: '2024-05-01', purchase_place: 'Caviste',
      visibility: 'friends', hide_price: false, hide_quantity: true, hide_notes: false, notes: 'Pour les fêtes', volume_ml: 1500,
    });
    const before = await movements();
    const r = await move(bruno, lotId, 2, bas);
    expect(r.lot_id).toBe(lotId);
    expect(r.quantity).toBe(2);
    expect(r.moved_lot_id).not.toBe(lotId);
    expect(await lotState(db, lotId)).toEqual({ quantity: 4, reserved: 0 });
    const twin = await lotRow(r.moved_lot_id);
    const orig = await lotRow(lotId);
    expect(twin).toMatchObject({ quantity: 2, reserved: 0, location_id: bas, owner_id: bruno, wine_id: wineId, cellar_id: cave });
    for (const k of ['volume_ml', 'purchase_price', 'currency', 'purchase_place', 'visibility', 'hide_price', 'hide_quantity', 'hide_notes', 'notes']) {
      expect(twin[k]).toEqual(orig[k]);
    }
    expect(String(twin.purchase_date)).toBe(String(orig.purchase_date));
    expect(twin).toMatchObject({ purchase_price: '18.50', currency: 'CHF', hide_price: false, hide_quantity: true, visibility: 'friends' });
    expect(await total(wineId)).toBe(6);
    expect(await movements()).toBe(before);
  });

  it('seules les bouteilles libres : jamais celles d’un événement ni celles d’un groupe', async () => {
    const { wineId, lotId } = await addWine(db, bruno, { name: 'Morgon' }, { quantity: 6, location_id: haut });
    const ev = await one<{ r: { id: string } }>(db, bruno, `select to_json(create_event($1::jsonb, $2::uuid[])) as r`, [
      JSON.stringify({ kind: 'diner', title: 'Dîner', starts_at: '2030-01-01T19:00:00Z' }), `{${claire}}`,
    ]);
    await one(db, bruno, `select propose_event_wine($1, $2, 2, null, true, $3)`, [ev.r.id, lotId, rid()]);
    const g = await one<{ id: string }>(db, bruno, `select (create_group('Les soirées', '🎉', null, null, $1::uuid[])).id`, [[claire]]);
    await one(db, claire, `select respond_group_invite($1, true)`, [g.id]);
    await one(db, bruno, `select allocate_to_group($1, $2, 3)`, [lotId, g.id]);
    expect(await lotState(db, lotId)).toEqual({ quantity: 6, reserved: 5 });
    // 1 seule bouteille libre ; « tout le lot » n'est pas possible tant que des bouteilles sont réservées.
    await expectError(move(bruno, lotId, 2, bas), /not_enough_free/);
    await expectError(move(bruno, lotId, 6, bas), /not_enough_free/);
    const r = await move(bruno, lotId, 1, bas);
    expect(r.moved_lot_id).not.toBe(lotId);
    expect(await lotState(db, lotId)).toEqual({ quantity: 5, reserved: 5 });
    expect((await lotRow(lotId)).location_id).toBe(haut);
    // Le jumeau reste visible du groupe, sans bouteille mise à disposition.
    expect(await as(db, bruno, `select allocated from group_shares where lot_id = $1`, [r.moved_lot_id])).toEqual([{ allocated: 0 }]);
    expect(await as(db, bruno, `select allocated from group_shares where lot_id = $1`, [lotId])).toEqual([{ allocated: 3 }]);
    await expectError(move(bruno, lotId, 1, bas), /not_enough_free/);
    expect(await total(wineId)).toBe(6);
  });

  it('refus : quantité nulle ou trop grande, même emplacement, autre cave, lot d’autrui ou inconnu, demande absente', async () => {
    const { lotId } = await addWine(db, bruno, { name: 'Morgon' }, { quantity: 3, location_id: haut });
    await expectError(move(bruno, lotId, 0, bas), /not_enough_free/);
    await expectError(move(bruno, lotId, -1, bas), /not_enough_free/);
    await expectError(move(bruno, lotId, 4, bas), /not_enough_free/);
    await expectError(move(bruno, lotId, 1, haut), /same_location/);
    const autre = (await one<{ id: string }>(db, bruno, `insert into cellars (name) values ('Cave du bureau') returning id`)).id;
    const ailleurs = (await one<{ id: string }>(db, bruno, `insert into locations (cellar_id, name) values ($1, 'Armoire') returning id`, [autre])).id;
    await expectError(move(bruno, lotId, 1, ailleurs), /location_mismatch/);
    await expectError(move(bruno, lotId, 1, rid()), /location_mismatch/);
    await expectError(move(marc, lotId, 1, bas), /not_found/);
    await expectError(move(claire, lotId, 1, bas), /not_found/);
    await expectError(move(bruno, rid(), 1, bas), /not_found/);
    await expectError(one(db, bruno, `select move_bottles($1, 1, $2, null)`, [lotId, bas]), /invalid/);
    await expectError(one(db, null, `select move_bottles($1, 1, $2, $3)`, [lotId, bas, rid()]), /permission denied/);
    expect(await lotState(db, lotId)).toEqual({ quantity: 3, reserved: 0 });
    expect((await lotRow(lotId)).location_id).toBe(haut);
    expect((await db.query(`select * from bottle_moves`)).rows).toEqual([]);
  });

  it('cave partagée : une personne associée range les bouteilles du propriétaire', async () => {
    const { wineId, lotId } = await addWine(db, bruno, { name: 'Morgon' }, { quantity: 4, location_id: haut, hide_price: false });
    await one(db, bruno, `select invite_to_cellar($1, $2::uuid[])`, [cave, [claire]]);
    await one(db, claire, `select respond_cellar_invite($1, true)`, [cave]);
    // Claire crée une étagère dans la cave de Bruno (elle appartient à Bruno), avec sa disposition.
    const cave3 = (await one<{ id: string }>(db, claire, `insert into locations (cellar_id, name, rows, slots_per_row) values ($1, 'Cave 3D', 2, 6) returning id`, [cave])).id;
    const r = await move(claire, lotId, 1, cave3);
    expect(await lotRow(r.moved_lot_id)).toMatchObject({ owner_id: bruno, location_id: cave3, quantity: 1, hide_price: false });
    expect(await total(wineId)).toBe(4);
    // L'historique : lu par Bruno (propriétaire) et par Claire (qui a déplacé), pas par Marc.
    expect(await as(db, bruno, `select user_id from bottle_moves`)).toEqual([{ user_id: claire }]);
    expect(await as(db, claire, `select user_id from bottle_moves`)).toEqual([{ user_id: claire }]);
    expect(await as(db, marc, `select user_id from bottle_moves`)).toEqual([]);
  });

  it('même demande rejouée : même résultat, aucun second déplacement', async () => {
    const { wineId, lotId } = await addWine(db, bruno, { name: 'Morgon' }, { quantity: 6, location_id: haut });
    const request = rid();
    const r1 = await move(bruno, lotId, 2, bas, request);
    const r2 = await move(bruno, lotId, 2, bas, request);
    expect(r2).toEqual(r1);
    expect(await lotState(db, lotId)).toEqual({ quantity: 4, reserved: 0 });
    expect((await db.query(`select id from lots where wine_id = $1`, [wineId])).rows).toHaveLength(2);
    expect((await db.query(`select * from bottle_moves`)).rows).toHaveLength(1);
    // Tout un lot, rejoué après coup : même réponse, pas d'erreur « same_location ».
    const all = rid();
    const t1 = await move(bruno, r1.moved_lot_id, 2, haut, all);
    expect(await move(bruno, r1.moved_lot_id, 2, haut, all)).toEqual(t1);
    // La clé d'une autre personne ou d'un autre lot : refusée.
    await one(db, bruno, `select invite_to_cellar($1, $2::uuid[])`, [cave, [claire]]);
    await one(db, claire, `select respond_cellar_invite($1, true)`, [cave]);
    await expectError(move(claire, lotId, 2, bas, request), /invalid/);
    await expectError(move(bruno, r1.moved_lot_id, 1, bas, request), /invalid/);
    expect(await total(wineId)).toBe(6);
  });

  it('double authentification : code activé mais session non vérifiée → refus, rien n’est lu', async () => {
    const { lotId } = await addWine(db, bruno, { name: 'Morgon' }, { quantity: 6, location_id: haut });
    await move(bruno, lotId, 2, bas);
    await db.query(`insert into auth.mfa_factors (user_id, status) values ($1, 'verified')`, [bruno]);
    // Session de niveau aal1 (mot de passe seul) : comme as(), sans revendication aal2.
    await expectError(move(bruno, lotId, 1, bas), /mfa_required/);
    expect(await as(db, bruno, `select * from bottle_moves`)).toEqual([]);
    expect(await lotState(db, lotId)).toEqual({ quantity: 4, reserved: 0 });
  });

  it('export « mes données » et suppression du compte', async () => {
    const { lotId } = await addWine(db, bruno, { name: 'Morgon', vintage: 2020 }, { quantity: 6, location_id: haut });
    await move(bruno, lotId, 2, bas);
    const d = (await one<{ d: Record<string, unknown[]> }>(db, bruno, `select export_my_data() as d`)).d;
    expect(d.deplacements_de_bouteilles).toEqual([expect.objectContaining({ vin: 'Morgon 2020', bouteilles: 2, de: 'Étagère du haut', vers: 'Casier du bas', par_moi: true })]);
    // Le reste de l'export est toujours là (migrations 7 et 8 comprises).
    expect(d).toHaveProperty('compte');
    expect(d).toHaveProperty('parts_d_achats_groupes');
    expect(d).toHaveProperty('alerte_de_prix');
    expect((await one<{ d: Record<string, unknown[]> }>(db, marc, `select export_my_data() as d`)).d.deplacements_de_bouteilles).toEqual([]);
    // Compte supprimé : son historique part avec lui.
    await one(db, bruno, `select prepare_account_deletion()`);
    await db.query(`delete from auth.users where id = $1`, [bruno]);
    expect((await db.query(`select * from bottle_moves`)).rows).toEqual([]);
  });
});

describe('retour arrière', () => {
  it('rend l’état d’avant, export compris ; les bouteilles restent où elles sont', async () => {
    const { wineId, lotId } = await addWine(db, bruno, { name: 'Morgon' }, { quantity: 6, location_id: haut });
    await move(bruno, lotId, 2, bas);
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '..', 'sql', 'retour-20261102000009.sql'), 'utf8'));
    const d = (await one<{ d: Record<string, unknown> }>(db, bruno, `select export_my_data() as d`)).d;
    expect(d).not.toHaveProperty('deplacements_de_bouteilles');
    expect(d).toHaveProperty('alerte_de_prix');
    expect(d).toHaveProperty('compte');
    expect((await db.query(`select 1 from pg_tables where tablename = 'bottle_moves'`)).rows).toEqual([]);
    expect((await db.query(`select 1 from pg_proc where proname in ('move_bottles', 'export_my_data_v3')`)).rows).toEqual([]);
    expect((await db.query(`select 1 from information_schema.columns where table_name = 'locations' and column_name in ('rows', 'slots_per_row')`)).rows).toEqual([]);
    expect(await total(wineId)).toBe(6);
    // L'appli d'avant fonctionne : emplacement créé sans les nouvelles colonnes.
    await one(db, bruno, `insert into locations (cellar_id, name) values ($1, 'Nouveau') returning id`, [cave]);
  });
});

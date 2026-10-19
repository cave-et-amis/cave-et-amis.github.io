import { beforeEach, describe, expect, it } from 'vitest';
import { addWine, as, createDb, createUser, expectError, lotState, one, rid, type Db } from '../helpers/db.ts';

let db: Db;
let bruno: string;
let claire: string;

beforeEach(async () => {
  db = await createDb();
  bruno = await createUser(db, 'Bruno');
  claire = await createUser(db, 'Claire');
});

describe('fiches de vin et lots', () => {
  it('un même vin peut avoir plusieurs lots : prix, emplacements et partages différents', async () => {
    const cellar = (await one<{ id: string }>(db, bruno, `select id from cellars`)).id;
    const casier = (await one<{ id: string }>(db, bruno, `insert into locations (cellar_id, name, kind) values ($1, 'Casier A', 'casier') returning id`, [cellar])).id;
    const { wineId, lotId } = await addWine(db, bruno, { name: 'Château Talbot', vintage: 2015, color: 'rouge' }, { quantity: 6, purchase_price: 42, location_id: casier });
    const second = await one<{ r: { id: string } }>(db, bruno, `select to_json(create_lot($1::jsonb, $2)) as r`, [
      JSON.stringify({ wine_id: wineId, quantity: 3, purchase_price: 55, visibility: 'friends' }),
      rid(),
    ]);
    const lots = await as<{ id: string; quantity: number; purchase_price: string; visibility: string }>(
      db,
      bruno,
      `select id, quantity, purchase_price, visibility from lots where wine_id = $1 order by purchase_price`,
      [wineId],
    );
    expect(lots.map((l) => [l.quantity, Number(l.purchase_price), l.visibility])).toEqual([
      [6, 42, 'private'],
      [3, 55, 'friends'],
    ]);
    expect(lots[0].id).toBe(lotId);
    expect(second.r.id).toBe(lots[1].id);
    const movements = await as<{ kind: string; delta: number }>(db, bruno, `select kind, delta from movements order by created_at`);
    expect(movements).toEqual([
      { kind: 'achat', delta: 6 },
      { kind: 'achat', delta: 3 },
    ]);
  });

  it('création de lot idempotente : un double envoi ne crée qu’un lot', async () => {
    const w = await one<{ id: string }>(db, bruno, `insert into wines (name) values ('Sancerre') returning id`);
    const req = rid();
    const p = JSON.stringify({ wine_id: w.id, quantity: 2 });
    const a = await one<{ r: { id: string } }>(db, bruno, `select to_json(create_lot($1::jsonb, $2)) as r`, [p, req]);
    const b = await one<{ r: { id: string } }>(db, bruno, `select to_json(create_lot($1::jsonb, $2)) as r`, [p, req]);
    expect(a.r.id).toBe(b.r.id);
    expect((await as(db, bruno, `select * from lots`)).length).toBe(1);
    expect((await as(db, bruno, `select * from movements`)).length).toBe(1);
  });

  it('le stock et les réservations ne se modifient pas directement', async () => {
    const { lotId } = await addWine(db, bruno, { name: 'Morgon' });
    await expectError(as(db, bruno, `update lots set quantity = 99 where id = $1`, [lotId]), /permission denied/);
    await expectError(as(db, bruno, `update lots set reserved = 0 where id = $1`, [lotId]), /permission denied/);
    await expectError(as(db, bruno, `insert into movements (owner_id, lot_id, kind, delta, request_id) values (auth.uid(), $1, 'achat', 5, gen_random_uuid())`, [lotId]), /permission denied/);
    await expectError(as(db, bruno, `insert into lots (wine_id, cellar_id) select id, (select id from cellars) from wines`), /permission denied/);
  });
});

describe('entrées, sorties, corrections', () => {
  it('consommation : jamais de stock négatif, message clair', async () => {
    const { lotId } = await addWine(db, bruno, { name: 'Chablis' }, { quantity: 2 });
    await one(db, bruno, `select record_movement($1, 'consommation', 2, null, null, $2)`, [lotId, rid()]);
    expect((await lotState(db, lotId)).quantity).toBe(0);
    await expectError(one(db, bruno, `select record_movement($1, 'consommation', 1, null, null, $2)`, [lotId, rid()]), /stock_insufficient/);
    expect((await lotState(db, lotId)).quantity).toBe(0);
  });

  it('double envoi d’une même consommation : comptée une seule fois', async () => {
    const { lotId } = await addWine(db, bruno, { name: 'Chablis' }, { quantity: 5 });
    const req = rid();
    await one(db, bruno, `select record_movement($1, 'consommation', 1, null, null, $2)`, [lotId, req]);
    await one(db, bruno, `select record_movement($1, 'consommation', 1, null, null, $2)`, [lotId, req]);
    expect((await lotState(db, lotId)).quantity).toBe(4);
  });

  it('annulation d’une consommation saisie par erreur, une seule fois', async () => {
    const { lotId } = await addWine(db, bruno, { name: 'Chablis' }, { quantity: 5 });
    const m = await one<{ r: { id: string } }>(db, bruno, `select to_json(record_movement($1, 'consommation', 2, null, null, $2)) as r`, [lotId, rid()]);
    expect((await lotState(db, lotId)).quantity).toBe(3);
    await one(db, bruno, `select reverse_movement($1, $2)`, [m.r.id, rid()]);
    expect((await lotState(db, lotId)).quantity).toBe(5);
    await expectError(one(db, bruno, `select reverse_movement($1, $2)`, [m.r.id, rid()]), /already_reversed/);
    expect((await lotState(db, lotId)).quantity).toBe(5);
    const kinds = await as<{ kind: string; delta: number }>(db, bruno, `select kind, delta from movements order by created_at`);
    expect(kinds.map((k) => `${k.kind}:${k.delta}`)).toEqual(['achat:5', 'consommation:-2', 'annulation:2']);
  });

  it('correction d’inventaire et cadeaux', async () => {
    const { lotId } = await addWine(db, bruno, { name: 'Vouvray' }, { quantity: 6, origin: 'entree' });
    await one(db, bruno, `select set_lot_quantity($1, 4, 'Recompté', $2)`, [lotId, rid()]);
    await one(db, bruno, `select record_movement($1, 'cadeau_offert', 1, null, 'Pour Paul', $2)`, [lotId, rid()]);
    await one(db, bruno, `select record_movement($1, 'cadeau_recu', 2, null, null, $2)`, [lotId, rid()]);
    expect((await lotState(db, lotId)).quantity).toBe(5);
    await expectError(one(db, bruno, `select set_lot_quantity($1, -1, null, $2)`, [lotId, rid()]), /invalid/);
    await expectError(one(db, bruno, `select set_lot_quantity($1, 5, null, $2)`, [lotId, rid()]), /no_change/);
  });

  it('personne d’autre ne peut toucher à mon stock ni lire mes lots', async () => {
    const { lotId, wineId } = await addWine(db, bruno, { name: 'Chablis', notes: 'secret' }, { quantity: 5, purchase_price: 30 });
    await expectError(one(db, claire, `select record_movement($1, 'consommation', 1, null, null, $2)`, [lotId, rid()]), /not_found/);
    await expectError(one(db, claire, `select set_lot_quantity($1, 0, null, $2)`, [lotId, rid()]), /not_found/);
    expect(await as(db, claire, `select * from lots`)).toEqual([]);
    expect(await as(db, claire, `select * from wines`)).toEqual([]);
    expect(await as(db, claire, `select * from movements`)).toEqual([]);
    expect(await as(db, claire, `update wines set name = 'x' where id = $1 returning id`, [wineId])).toEqual([]);
    expect(await as(db, claire, `delete from lots where id = $1 returning id`, [lotId])).toEqual([]);
    expect((await lotState(db, lotId)).quantity).toBe(5);
  });

  it('suppression d’une cave non vide refusée', async () => {
    await addWine(db, bruno, { name: 'Chablis' });
    await expectError(as(db, bruno, `delete from cellars`), /cellar_not_empty/);
  });

  it('les photos d’une fiche doivent être dans le dossier de son propriétaire', async () => {
    await expectError(as(db, bruno, `insert into wines (name, label_photo) values ('X', $1)`, [`${claire}/photo.jpg`]), /check constraint/);
    await as(db, bruno, `insert into wines (name, label_photo) values ('X', $1)`, [`${bruno}/photo.jpg`]);
  });
});

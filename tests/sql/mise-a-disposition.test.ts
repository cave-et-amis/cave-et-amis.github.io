import { beforeEach, describe, expect, it } from 'vitest';
import { addWine, as, befriend, createDb, createUser, expectError, lotState, one, rid, type Db } from '../helpers/db.ts';

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
});

async function group(name: string, members: string[] = [claire]) {
  const g = await one<{ id: string }>(db, bruno, `select (create_group($1, '🎉', null, null, $2::uuid[])).id`, [name, members]);
  for (const m of members) await one(db, m, `select respond_group_invite($1, true)`, [g.id]);
  return g.id;
}
const allocate = (who: string, lot: string, g: string, n: number) => one(db, who, `select allocate_to_group($1, $2, $3)`, [lot, g, n]);
const consume = (who: string, lot: string, g: string, n: number, request = rid()) =>
  one<{ r: { id: string; delta: number; group_id: string } }>(db, who, `select to_json(consume_from_group($1, $2, $3, null, 'Soirée raclette', $4)) as r`, [lot, g, n, request]);
const sortie = (who: string, lot: string, n: number) => one(db, who, `select record_movement($1, 'consommation', $2, null, null, $3)`, [lot, n, rid()]);

describe('mise à disposition d’un groupe', () => {
  it('l’exemple : 6 bouteilles, 2 pour « Les soirées » → 6 possédées, 2 réservées au groupe, 4 libres', async () => {
    const g = await group('Les soirées entre amis');
    const { lotId } = await addWine(db, bruno, { name: 'Morgon', vintage: 2020 }, { quantity: 6 });
    await allocate(bruno, lotId, g, 2);
    expect(await lotState(db, lotId)).toEqual({ quantity: 6, reserved: 2 });
    // Côté groupe : 2 bouteilles mises à disposition, visibles par Claire.
    expect(await as(db, claire, `select name, allocated from group_lots($1)`, [g])).toEqual([{ name: 'Morgon', allocated: 2 }]);
    expect((await one<{ available_bottles: number }>(db, claire, `select available_bottles from my_groups()`)).available_bottles).toBe(2);
    // Bruno ne peut plus boire que ses 4 bouteilles libres.
    await expectError(sortie(bruno, lotId, 5), /stock_reserved/);
    await sortie(bruno, lotId, 4);
    expect(await lotState(db, lotId)).toEqual({ quantity: 2, reserved: 2 });
    expect((await one<{ action: string }>(db, claire, `select kind as action from group_activity where kind = 'allocated'`)).action).toBe('allocated');
  });

  it('pas de double comptage : deux groupes, un événement, toujours ≤ stock', async () => {
    const a = await group('A');
    const b = await group('B');
    const { lotId } = await addWine(db, bruno, { name: 'Sancerre' }, { quantity: 6 });
    await allocate(bruno, lotId, a, 4);
    await expectError(allocate(bruno, lotId, b, 3), /over_allocation/);
    await allocate(bruno, lotId, b, 2);
    expect(await lotState(db, lotId)).toEqual({ quantity: 6, reserved: 6 });
    // Plus rien pour un événement : la réservation est refusée.
    const ev = await one<{ id: string }>(db, bruno, `select (create_event('{"title":"Dîner","starts_at":"2030-01-01T19:00:00Z"}'::jsonb, '{}')).id`);
    await expectError(one(db, bruno, `select propose_event_wine($1, $2, 1, null, true, $3)`, [ev.id, lotId, rid()]), /over_reservation/);
    // Reprendre 1 bouteille de B : elle redevient réservable pour le dîner.
    await allocate(bruno, lotId, b, 1);
    await one(db, bruno, `select propose_event_wine($1, $2, 1, null, true, $3)`, [ev.id, lotId, rid()]);
    expect(await lotState(db, lotId)).toEqual({ quantity: 6, reserved: 6 });
    // Et l'inverse : une bouteille réservée pour le dîner ne peut pas aussi être mise à disposition.
    await expectError(allocate(bruno, lotId, a, 5), /over_allocation/);
  });

  it('ouverture par le propriétaire : stock et mise à disposition baissent ensemble, une seule fois', async () => {
    const g = await group('Les soirées');
    const { lotId } = await addWine(db, bruno, { name: 'Morgon', vintage: 2020 }, { quantity: 6 });
    await allocate(bruno, lotId, g, 2);
    const key = rid();
    const first = await consume(bruno, lotId, g, 1, key);
    expect(first.r).toMatchObject({ delta: -1, group_id: g });
    // Double clic : même mouvement, rien de plus.
    expect((await consume(bruno, lotId, g, 1, key)).r.id).toBe(first.r.id);
    expect(await lotState(db, lotId)).toEqual({ quantity: 5, reserved: 1 });
    expect((await one<{ allocated: number }>(db, claire, `select allocated from group_lots($1)`, [g])).allocated).toBe(1);
    // Pas plus que ce qui est mis à disposition ; jamais par un autre membre.
    await expectError(consume(bruno, lotId, g, 2), /allocation_insufficient/);
    await expectError(consume(claire, lotId, g, 1), /not_found/);
    // Historique : mouvement relié au groupe, activité visible des membres.
    expect((await as<{ group_id: string; note: string }>(db, bruno, `select group_id, note from movements where kind = 'consommation'`))[0]).toEqual({
      group_id: g,
      note: 'Soirée raclette',
    });
    expect(await as(db, claire, `select actor_name, target_name, detail from group_activity where kind = 'consumed'`)).toEqual([
      { actor_name: 'Bruno', target_name: 'Morgon 2020', detail: '1' },
    ]);
  });

  it('reprendre, ne plus partager, quitter, être retiré, groupe supprimé : les bouteilles redeviennent libres', async () => {
    const g = await group('G', [claire]);
    const brunoLot = (await addWine(db, bruno, { name: 'A' }, { quantity: 6 })).lotId;
    const claireLot = (await addWine(db, claire, { name: 'B' }, { quantity: 6 })).lotId;
    await allocate(bruno, brunoLot, g, 3);
    await allocate(claire, claireLot, g, 2);
    await allocate(bruno, brunoLot, g, 0);
    expect(await lotState(db, brunoLot)).toEqual({ quantity: 6, reserved: 0 });
    await allocate(bruno, brunoLot, g, 3);
    await one(db, bruno, `select share_lot_with_group($1, $2, false)`, [brunoLot, g]);
    expect(await lotState(db, brunoLot)).toEqual({ quantity: 6, reserved: 0 });
    // Claire quitte le groupe : ses 2 bouteilles lui reviennent.
    await one(db, claire, `select leave_group($1)`, [g]);
    expect(await lotState(db, claireLot)).toEqual({ quantity: 6, reserved: 0 });
    // Retirée par l'administrateur, puis groupe supprimé : idem.
    await one(db, bruno, `select invite_to_group($1, array[$2]::uuid[])`, [g, claire]);
    await one(db, claire, `select respond_group_invite($1, true)`, [g]);
    await allocate(claire, claireLot, g, 2);
    await one(db, bruno, `select remove_member($1, $2)`, [g, claire]);
    expect(await lotState(db, claireLot)).toEqual({ quantity: 6, reserved: 0 });
    await allocate(bruno, brunoLot, g, 4);
    await one(db, bruno, `select delete_group($1)`, [g]);
    expect(await lotState(db, brunoLot)).toEqual({ quantity: 6, reserved: 0 });
  });

  it('suppression de compte avec des bouteilles mises à disposition : possible, rien ne reste réservé', async () => {
    const g = await group('G');
    const { lotId } = await addWine(db, claire, { name: 'B' }, { quantity: 3 });
    await allocate(claire, lotId, g, 2);
    await one(db, claire, `select prepare_account_deletion()`);
    await db.query(`delete from auth.users where id = $1`, [claire]);
    expect(await as(db, bruno, `select * from group_lots($1)`, [g])).toEqual([]);
  });

  it('protections : correction sous les bouteilles mises à disposition, suppression du vin, non-membre, lot d’un autre', async () => {
    const g = await group('G');
    const { lotId, wineId } = await addWine(db, bruno, { name: 'A' }, { quantity: 6 });
    await allocate(bruno, lotId, g, 3);
    await expectError(one(db, bruno, `select set_lot_quantity($1, 2, null, $2)`, [lotId, rid()]), /stock_reserved/);
    await expectError(as(db, bruno, `delete from wines where id = $1`, [wineId]), /lot_reserved/);
    await expectError(allocate(claire, lotId, g, 1), /not_found/);
    const other = await one<{ id: string }>(db, marc, `select (create_group('Autre', '🍷', null, null, null)).id`);
    await expectError(allocate(bruno, lotId, other.id, 1), /forbidden/);
    // Un membre simple voit la quantité mise à disposition même si le propriétaire masque la quantité exacte.
    await as(db, bruno, `update lots set hide_quantity = true where id = $1`, [lotId]);
    expect(await as(db, claire, `select quantity, allocated from group_lots($1)`, [g])).toEqual([{ quantity: null, allocated: 3 }]);
  });
});

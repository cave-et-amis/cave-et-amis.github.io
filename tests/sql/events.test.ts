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
  await befriend(db, bruno, marc);
});

async function createDinner(organizer: string, guests: string[], startsAt = new Date(Date.now() - 3600_000).toISOString()) {
  const ev = await one<{ r: { id: string } }>(db, organizer, `select to_json(create_event($1::jsonb, $2::uuid[])) as r`, [
    JSON.stringify({ kind: 'diner', title: 'Dîner d’automne', starts_at: startsAt, place: 'Chez Bruno' }),
    `{${guests.join(',')}}`,
  ]);
  return ev.r.id;
}

type EW = { id: string; status: string; reserved_qty: number; consumed_qty: number | null };

const propose = (user: string, event: string, lot: string, qty: number, bring: boolean, req = rid()) =>
  one<{ r: EW }>(db, user, `select to_json(propose_event_wine($1, $2, $3, null, $4, $5)) as r`, [event, lot, qty, bring, req]).then((x) => x.r);

describe('événements', () => {
  it('seuls des amis peuvent être invités ; seuls les participants voient l’événement', async () => {
    await expectError(createDinner(claire, [marc]), /not_friend/);
    const ev = await createDinner(bruno, [claire]);
    expect((await as(db, claire, `select * from events`)).length).toBe(1);
    expect(await as(db, marc, `select * from events`)).toEqual([]);
    expect(await as(db, marc, `select * from event_participants`)).toEqual([]);
    await one(db, claire, `select respond_event($1, 'yes')`, [ev]);
    const parts = await as<{ rsvp: string }>(db, bruno, `select rsvp from event_participants order by role`);
    expect(parts.map((p) => p.rsvp)).toEqual(['yes', 'yes']);
  });

  it('proposer sa bouteille et confirmer l’apporter : réservée, sans quitter le stock', async () => {
    const ev = await createDinner(bruno, [claire]);
    const { lotId } = await addWine(db, claire, { name: 'Meursault', vintage: 2019, color: 'blanc' }, { quantity: 3, purchase_price: 60 });
    const ew = await propose(claire, ev, lotId, 2, true);
    expect(ew).toMatchObject({ status: 'confirmed', reserved_qty: 2 });
    expect(await lotState(db, lotId)).toEqual({ quantity: 3, reserved: 2 });
    // Les autres participants voient la proposition (photographie du vin), pas le stock ni le prix.
    const seen = await as<Record<string, unknown>>(db, bruno, `select * from event_wines`);
    expect(seen[0]).toMatchObject({ wine_name: 'Meursault', wine_vintage: 2019, quantity: 2 });
    expect(Object.keys(seen[0])).not.toContain('purchase_price');
    expect(await as(db, bruno, `select * from lots`)).toEqual([]);
  });

  it('suggérer la bouteille « proposable » d’un ami : le propriétaire doit confirmer', async () => {
    const ev = await createDinner(bruno, [claire]);
    const { lotId: privateLot } = await addWine(db, claire, { name: 'Privée' });
    const { lotId: friendsLot } = await addWine(db, claire, { name: 'Partagée' }, { visibility: 'friends' });
    const { lotId: eventLot } = await addWine(db, claire, { name: 'Proposable' }, { visibility: 'event', quantity: 2 });
    await expectError(propose(bruno, ev, privateLot, 1, false), /not_proposable/);
    await expectError(propose(bruno, ev, friendsLot, 1, false), /not_proposable/);
    const options = await as<{ name: string }>(db, bruno, `select name from event_suggestable_lots($1)`, [ev]);
    expect(options.map((o) => o.name)).toEqual(['Proposable']);
    const sug = await propose(bruno, ev, eventLot, 1, true);
    // Même avec p_bring, une suggestion n'est jamais réservée sans le propriétaire.
    expect(sug).toMatchObject({ status: 'proposed', reserved_qty: 0 });
    expect(await lotState(db, eventLot)).toEqual({ quantity: 2, reserved: 0 });
    await expectError(one(db, bruno, `select confirm_event_wine($1, null)`, [sug.id]), /not_found/);
    const confirmed = await one<{ r: EW }>(db, claire, `select to_json(confirm_event_wine($1, null)) as r`, [sug.id]);
    expect(confirmed.r.status).toBe('confirmed');
    expect(await lotState(db, eventLot)).toEqual({ quantity: 2, reserved: 1 });
    await expectError(propose(bruno, ev, eventLot, 1, false), /already_proposed/);
  });

  it('le propriétaire peut refuser une suggestion', async () => {
    const ev = await createDinner(bruno, [claire]);
    const { lotId } = await addWine(db, claire, { name: 'Proposable' }, { visibility: 'event' });
    const sug = await propose(bruno, ev, lotId, 1, false);
    await one(db, claire, `select decline_event_wine($1)`, [sug.id]);
    expect((await one<{ status: string }>(db, bruno, `select status from event_wines`)).status).toBe('declined');
  });

  it('impossible de réserver au-delà du stock, en tenant compte des autres événements', async () => {
    const ev1 = await createDinner(bruno, [claire]);
    const ev2 = await createDinner(bruno, [claire]);
    const { lotId } = await addWine(db, claire, { name: 'Rare' }, { quantity: 3 });
    await propose(claire, ev1, lotId, 2, true);
    await expectError(propose(claire, ev2, lotId, 2, true), /over_reservation/);
    expect(await lotState(db, lotId)).toEqual({ quantity: 3, reserved: 2 });
    const ok = await propose(claire, ev2, lotId, 1, true);
    expect(ok.status).toBe('confirmed');
    expect(await lotState(db, lotId)).toEqual({ quantity: 3, reserved: 3 });
    // Les bouteilles réservées ne peuvent pas sortir du stock par ailleurs.
    await expectError(one(db, claire, `select record_movement($1, 'consommation', 1, null, null, $2)`, [lotId, rid()]), /stock_reserved/);
    await expectError(one(db, claire, `select set_lot_quantity($1, 2, null, $2)`, [lotId, rid()]), /stock_reserved/);
    await expectError(as(db, claire, `delete from lots where id = $1`, [lotId]), /lot_reserved/);
  });

  it('annuler l’événement libère toutes les réservations', async () => {
    const ev = await createDinner(bruno, [claire]);
    const { lotId: a } = await addWine(db, claire, { name: 'A' }, { quantity: 2 });
    const { lotId: b } = await addWine(db, bruno, { name: 'B' }, { quantity: 2 });
    await propose(claire, ev, a, 2, true);
    await propose(bruno, ev, b, 1, true);
    await expectError(one(db, claire, `select cancel_event($1)`, [ev]), /forbidden/);
    await one(db, bruno, `select cancel_event($1)`, [ev]);
    expect(await lotState(db, a)).toEqual({ quantity: 2, reserved: 0 });
    expect(await lotState(db, b)).toEqual({ quantity: 2, reserved: 0 });
    const statuses = await as<{ status: string }>(db, bruno, `select status from event_wines`);
    expect(statuses.every((s) => s.status === 'released')).toBe(true);
    await expectError(propose(bruno, ev, b, 1, true), /event_not_planned/);
  });

  it('se désister libère ses bouteilles', async () => {
    const ev = await createDinner(bruno, [claire]);
    const { lotId } = await addWine(db, claire, { name: 'A' }, { quantity: 2 });
    await propose(claire, ev, lotId, 2, true);
    await one(db, claire, `select respond_event($1, 'no')`, [ev]);
    expect(await lotState(db, lotId)).toEqual({ quantity: 2, reserved: 0 });
  });

  it('après l’événement : consommation confirmée une seule fois, stock mis à jour une fois', async () => {
    const ev = await createDinner(bruno, [claire]);
    const { lotId } = await addWine(db, claire, { name: 'Meursault' }, { quantity: 3 });
    const ew = await propose(claire, ev, lotId, 2, true);
    await expectError(one(db, claire, `select confirm_event_consumption($1, 1, $2)`, [ew.id, rid()]), /event_not_done/);
    await one(db, bruno, `select close_event($1)`, [ev]);
    await expectError(one(db, bruno, `select confirm_event_consumption($1, 1, $2)`, [ew.id, rid()]), /not_found/);
    await expectError(one(db, claire, `select confirm_event_consumption($1, 3, $2)`, [ew.id, rid()]), /invalid/);
    const res = await one<{ r: EW }>(db, claire, `select to_json(confirm_event_consumption($1, 1, $2)) as r`, [ew.id, rid()]);
    expect(res.r).toMatchObject({ status: 'consumed', consumed_qty: 1, reserved_qty: 0 });
    expect(await lotState(db, lotId)).toEqual({ quantity: 2, reserved: 0 });
    // Deuxième confirmation (autre appareil, double clic) : aucun effet.
    await one(db, claire, `select confirm_event_consumption($1, 2, $2)`, [ew.id, rid()]);
    expect(await lotState(db, lotId)).toEqual({ quantity: 2, reserved: 0 });
    const movs = await as<{ kind: string; delta: number; event_id: string }>(db, claire, `select kind, delta, event_id from movements where kind = 'consommation'`);
    expect(movs).toEqual([{ kind: 'consommation', delta: -1, event_id: ev }]);
  });

  it('bouteille finalement non ouverte : la réservation est simplement libérée', async () => {
    const ev = await createDinner(bruno, [claire]);
    const { lotId } = await addWine(db, claire, { name: 'Meursault' }, { quantity: 3 });
    const ew = await propose(claire, ev, lotId, 2, true);
    await one(db, bruno, `select close_event($1)`, [ev]);
    await one(db, claire, `select confirm_event_consumption($1, 0, $2)`, [ew.id, rid()]);
    expect(await lotState(db, lotId)).toEqual({ quantity: 3, reserved: 0 });
  });

  it('les souvenirs restent après la fin de l’amitié, sans accès au stock', async () => {
    const ev = await createDinner(bruno, [claire]);
    const { lotId } = await addWine(db, claire, { name: 'Souvenir' }, { quantity: 3, visibility: 'friends' });
    const ew = await propose(claire, ev, lotId, 1, true);
    await one(db, bruno, `select close_event($1)`, [ev]);
    await one(db, claire, `select confirm_event_consumption($1, 1, $2)`, [ew.id, rid()]);
    await one(db, bruno, `select remove_friend($1)`, [claire]);
    expect(await as(db, bruno, `select * from shared_lots(null)`)).toEqual([]);
    const memory = await as<{ wine_name: string; consumed_qty: number }>(db, bruno, `select wine_name, consumed_qty from event_wines`);
    expect(memory).toEqual([{ wine_name: 'Souvenir', consumed_qty: 1 }]);
    // Le nom reste lisible grâce à l'événement commun.
    expect((await as(db, bruno, `select display_name from profiles where id = $1`, [claire])).length).toBe(1);
  });

  it('ordre de service et menu', async () => {
    const ev = await createDinner(bruno, [claire]);
    const { lotId: a } = await addWine(db, bruno, { name: 'Blanc' });
    const { lotId: b } = await addWine(db, bruno, { name: 'Rouge' });
    const w1 = await propose(bruno, ev, a, 1, true);
    const w2 = await propose(bruno, ev, b, 1, true);
    await one(db, bruno, `select set_service_order($1, $2::uuid[])`, [ev, `{${w2.id},${w1.id}}`]);
    const order = await as<{ wine_name: string }>(db, claire, `select wine_name from event_wines order by service_position`);
    expect(order.map((o) => o.wine_name)).toEqual(['Rouge', 'Blanc']);
    await as(db, claire, `insert into event_dishes (event_id, course, name) values ($1, 'dessert', 'Tarte Tatin')`, [ev]);
    await expectError(as(db, marc, `insert into event_dishes (event_id, name) values ($1, 'Intrus')`, [ev]), /row-level security|not_participant/);
    expect((await as(db, bruno, `select name from event_dishes`)).length).toBe(1);
  });

  it('un événement terminé ne peut pas être supprimé (souvenirs)', async () => {
    const ev = await createDinner(bruno, [claire]);
    await one(db, bruno, `select close_event($1)`, [ev]);
    await expectError(one(db, bruno, `select delete_event($1)`, [ev]), /event_done/);
  });

  it('un événement à venir ne peut pas être clos', async () => {
    const ev = await createDinner(bruno, [claire], new Date(Date.now() + 5 * 86400_000).toISOString());
    await expectError(one(db, bruno, `select close_event($1)`, [ev]), /event_in_future/);
  });
});

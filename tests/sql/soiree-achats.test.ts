import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, addWine, as, befriend, createDb, createUser, expectError, one, rid, type Db } from '../helpers/db.ts';

let db: Db;
let bruno: string;
let claire: string;
let marc: string;
let lea: string;

beforeEach(async () => {
  db = await createDb();
  bruno = await createUser(db, 'Bruno');
  claire = await createUser(db, 'Claire');
  marc = await createUser(db, 'Marc');
  lea = await createUser(db, 'Léa');
  await befriend(db, bruno, claire);
  await befriend(db, bruno, marc);
});

async function dinner(guests: string[]) {
  const ev = await one<{ r: { id: string } }>(db, bruno, `select to_json(create_event($1::jsonb, $2::uuid[])) as r`, [
    JSON.stringify({ kind: 'degustation', title: 'Dégustation à l’aveugle', starts_at: new Date(Date.now() - 3600_000).toISOString() }),
    `{${guests.join(',')}}`,
  ]);
  return ev.r.id;
}
const bring = async (event: string, name: string) => {
  const { lotId } = await addWine(db, bruno, { name }, { quantity: 2 });
  return (await one<{ r: { id: string } }>(db, bruno, `select to_json(propose_event_wine($1, $2, 1, null, true, $3)) as r`, [event, lotId, rid()])).r.id;
};
type State = {
  live: { blind: boolean; current_wine: string | null; revealed: string[]; ended_at: string | null } | null;
  messages: { author: string; body: string; mine: boolean }[];
  votes: { event_wine_id: string; average: number | null; count: number; mine: number | null }[];
};
const state = async (who: string, ev: string) => (await one<{ s: State | null }>(db, who, `select event_live_state($1) as s`, [ev])).s;

describe('mode soirée', () => {
  it('l’organisateur lance, sert, révèle et termine ; les autres participants suivent', async () => {
    const ev = await dinner([claire, marc]);
    const w1 = await bring(ev, 'Morgon');
    const w2 = await bring(ev, 'Chablis');
    await expectError(one(db, claire, `select start_event_live($1, true)`, [ev]), /forbidden/);
    await one(db, bruno, `select start_event_live($1, true)`, [ev]);
    expect((await state(claire, ev))!.live).toMatchObject({ blind: true, current_wine: w1, revealed: [] });
    await one(db, bruno, `select event_live_serve($1, $2)`, [ev, w2]);
    await one(db, bruno, `select event_live_reveal($1, $2)`, [ev, w2]);
    await one(db, bruno, `select event_live_reveal($1, $2)`, [ev, w2]);
    expect((await state(marc, ev))!.live).toMatchObject({ current_wine: w2, revealed: [w2] });
    await expectError(one(db, claire, `select event_live_serve($1, $2)`, [ev, w1]), /forbidden/);
    // Une bouteille d'un autre événement : refusée.
    const other = await dinner([claire]);
    const foreign = await bring(other, 'Ailleurs');
    await expectError(one(db, bruno, `select event_live_serve($1, $2)`, [ev, foreign]), /not_found/);
    await one(db, bruno, `select end_event_live($1)`, [ev]);
    await expectError(one(db, claire, `select post_event_message($1, 'Trop tard')`, [ev]), /forbidden/);
  });

  it('messages et notes : participants seulement, sans les personnes bloquées', async () => {
    const ev = await dinner([claire, marc]);
    const w1 = await bring(ev, 'Morgon');
    await one(db, bruno, `select start_event_live($1, false)`, [ev]);
    await one(db, claire, `select post_event_message($1, 'Belle surprise !')`, [ev]);
    await one(db, marc, `select post_event_message($1, 'Je pense à un pinot noir ?')`, [ev]);
    await expectError(one(db, lea, `select post_event_message($1, 'Intrusion')`, [ev]), /forbidden/);
    await expectError(one(db, claire, `select post_event_message($1, '   ')`, [ev]), /check constraint/);
    expect(await state(lea, ev)).toBeNull();
    expect((await state(bruno, ev))!.messages.map((m) => `${m.author} : ${m.body}`)).toEqual(['Claire : Belle surprise !', 'Marc : Je pense à un pinot noir ?']);
    // Claire bloque Marc : elle ne voit plus ses messages, lui non plus les siens.
    await one(db, claire, `select block_user($1)`, [marc]);
    expect((await state(claire, ev))!.messages.map((m) => m.author)).toEqual(['Claire']);
    expect((await state(marc, ev))!.messages.map((m) => m.author)).toEqual(['Marc']);
    // Lecture directe des tables : seulement ses propres lignes.
    expect(await as(db, bruno, `select body from event_messages`)).toEqual([]);

    await one(db, claire, `select vote_event_wine($1, 5::smallint)`, [w1]);
    await one(db, bruno, `select vote_event_wine($1, 4::smallint)`, [w1]);
    await one(db, bruno, `select vote_event_wine($1, 3::smallint)`, [w1]);
    await expectError(one(db, lea, `select vote_event_wine($1, 5::smallint)`, [w1]), /not_found/);
    await expectError(one(db, marc, `select vote_event_wine($1, 6::smallint)`, [w1]), /check constraint/);
    expect((await state(bruno, ev))!.votes).toEqual([{ event_wine_id: w1, average: 4, count: 2, mine: 3 }]);
    await one(db, bruno, `select vote_event_wine($1, null)`, [w1]);
    expect((await state(claire, ev))!.votes[0]).toMatchObject({ count: 1, mine: 5 });
  });
});

async function group(members: string[]) {
  const id = (await one<{ id: string }>(db, bruno, `select (create_group('Les copains', '🍷', null, null, $1::uuid[])).id`, [members])).id;
  for (const m of members) await one(db, m, `select respond_group_invite($1, true)`, [id]);
  return id;
}
const createPurchase = async (who: string, g: string, budget: number | null = 500) =>
  (await one<{ r: { id: string } }>(db, who, `select to_json(create_group_purchase($1, $2::jsonb)) as r`, [g, JSON.stringify({ title: 'Bourgogne', budget })])).r.id;
const addItem = async (who: string, p: string, bottles: number, price = 30) =>
  (await one<{ r: { id: string } }>(db, who, `select to_json(add_group_purchase_item($1, $2::jsonb)) as r`, [p, JSON.stringify({ wine_name: 'Domaine du Val', vintage: 2022, unit_price: price, bottles })])).r.id;
const part = (who: string, item: string, n: number) => one(db, who, `select set_purchase_part($1, $2)`, [item, n]);
type Purchase = { status: string; items: { bottles: number; parts: { name: string; bottles: number; validated: boolean }[] }[] };
const list = async (who: string, g: string) => (await one<{ l: Purchase[] }>(db, who, `select group_purchases_list($1) as l`, [g])).l;

describe('achats groupés', () => {
  it('chacun prend sa part sans dépasser le nombre de bouteilles ; changer sa part annule sa validation', async () => {
    const g = await group([claire, marc]);
    const p = await createPurchase(claire, g);
    const item = await addItem(claire, p, 4);
    await part(bruno, item, 2);
    await part(claire, item, 1);
    await expectError(part(marc, item, 2), /purchase_full/);
    await part(marc, item, 1);
    await one(db, marc, `select validate_purchase_parts($1, true)`, [p]);
    expect((await list(bruno, g))[0].items[0].parts.map((x) => `${x.name} ${x.bottles}${x.validated ? ' ✓' : ''}`)).toEqual(['Bruno 2', 'Claire 1', 'Marc 1 ✓']);
    // Marc réduit sa part : sa validation est annulée.
    await part(marc, item, 0);
    await part(marc, item, 1);
    expect((await list(bruno, g))[0].items[0].parts.find((x) => x.name === 'Marc')!.validated).toBe(false);
    await expectError(part(bruno, item, -1), /invalid/);
  });

  it('membres seulement ; clore, rouvrir, retirer un vin selon le rôle ; quitter le groupe retire mes parts', async () => {
    const g = await group([claire, marc]);
    const p = await createPurchase(claire, g);
    const item = await addItem(claire, p, 6);
    await expectError(createPurchase(lea, g), /forbidden/);
    await expectError(part(lea, item, 1), /not_found/);
    expect(await list(lea, g)).toEqual([]);
    expect(await as(db, lea, `select * from group_purchases`)).toEqual([]);
    // Marc (simple membre) ne peut ni clore l'achat de Claire, ni retirer son vin.
    await expectError(one(db, marc, `select set_group_purchase_status($1, 'closed')`, [p]), /forbidden/);
    await expectError(one(db, marc, `select remove_group_purchase_item($1)`, [item]), /forbidden/);
    await part(marc, item, 2);
    await one(db, marc, `select leave_group($1)`, [g]);
    expect((await list(claire, g))[0].items[0].parts).toEqual([]);
    // Achat clos : plus de part ni de vin ajouté ; Bruno (administrateur) peut le rouvrir.
    await one(db, claire, `select set_group_purchase_status($1, 'closed')`, [p]);
    await expectError(part(claire, item, 1), /not_found/);
    await expectError(addItem(claire, p, 1), /not_found/);
    await one(db, bruno, `select set_group_purchase_status($1, 'open')`, [p]);
    await part(claire, item, 1);
    await one(db, bruno, `select remove_group_purchase_item($1)`, [item]);
    expect((await list(claire, g))[0].items).toEqual([]);
  });

  it('dans l’export de mes données', async () => {
    const g = await group([claire]);
    const p = await createPurchase(claire, g);
    const item = await addItem(claire, p, 3, 25);
    await part(claire, item, 2);
    const ev = await dinner([claire]);
    const w = await bring(ev, 'Morgon');
    await one(db, bruno, `select start_event_live($1, false)`, [ev]);
    await one(db, claire, `select post_event_message($1, 'Santé !')`, [ev]);
    await one(db, claire, `select vote_event_wine($1, 4::smallint)`, [w]);
    const d = (await one<{ d: Record<string, unknown[]> }>(db, claire, `select export_my_data() as d`)).d;
    expect(d.achats_groupes_proposes).toHaveLength(1);
    expect(d.parts_d_achats_groupes).toEqual([expect.objectContaining({ achat: 'Bourgogne', bouteilles: 2, prix_unitaire: 25 })]);
    expect(d.messages_de_soiree).toEqual([expect.objectContaining({ message: 'Santé !' })]);
    expect(d.notes_de_soiree).toEqual([expect.objectContaining({ vin: 'Morgon', note: 4 })]);
    // Le reste de l'export est toujours là.
    expect(d).toHaveProperty('compte');
    expect(d).toHaveProperty('degustations');
  });
});

describe('double authentification', () => {
  it('code activé mais session non vérifiée : ni soirée, ni achats, ni lecture directe', async () => {
    const g = await group([claire]);
    const p = await createPurchase(claire, g);
    await addItem(claire, p, 2);
    const ev = await dinner([claire]);
    await bring(ev, 'Morgon');
    await one(db, bruno, `select start_event_live($1, false)`, [ev]);
    await one(db, claire, `select post_event_message($1, 'Santé !')`, [ev]);
    await db.query(`insert into auth.mfa_factors (user_id, status) values ($1, 'verified')`, [claire]);
    // Session de niveau aal1 (mot de passe seul) : comme as(), sans revendication aal2.
    expect(await state(claire, ev)).toBeNull();
    expect(await list(claire, g)).toEqual([]);
    expect(await as(db, claire, `select * from group_purchases`)).toEqual([]);
    expect(await as(db, claire, `select * from event_messages`)).toEqual([]);
    await expectError(one(db, claire, `select post_event_message($1, 'Encore')`, [ev]), /mfa/);
  });
});

describe('retour arrière', () => {
  it('rend l’état d’avant, export compris', async () => {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '..', 'sql', 'retour-20261102000007.sql'), 'utf8'));
    const d = (await one<{ d: Record<string, unknown> }>(db, claire, `select export_my_data() as d`)).d;
    expect(d).toHaveProperty('compte');
    expect(d).not.toHaveProperty('parts_d_achats_groupes');
    expect((await as<{ n: number }>(db, bruno, `select count(*)::int as n from pg_tables where tablename in ('event_live', 'group_purchases')`))[0].n).toBe(0);
  });
});

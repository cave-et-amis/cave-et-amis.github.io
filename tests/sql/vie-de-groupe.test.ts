import { beforeEach, describe, expect, it } from 'vitest';
import { addWine, as, befriend, createDb, createUser, expectError, lotState, one, rid, type Db } from '../helpers/db.ts';

let db: Db;
let bruno: string;
let claire: string;
let marc: string;
let sam: string;
let g: string;

// Bruno est ami de Claire et de Marc ; Claire et Marc ne sont pas amis, mais tous trois sont dans le groupe.
beforeEach(async () => {
  db = await createDb();
  bruno = await createUser(db, 'Bruno');
  claire = await createUser(db, 'Claire');
  marc = await createUser(db, 'Marc');
  sam = await createUser(db, 'Sam');
  await befriend(db, bruno, claire);
  await befriend(db, bruno, marc);
  g = (await one<{ id: string }>(db, bruno, `select (create_group('Les soirées', '🎉', null, null, $1::uuid[])).id`, [[claire, marc]])).id;
  for (const m of [claire, marc]) await one(db, m, `select respond_group_invite($1, true)`, [g]);
});

const evening = (who: string, guests: string[], p: Record<string, unknown> = {}) =>
  one<{ id: string }>(db, who, `select (create_event($1::jsonb, $2::uuid[])).id`, [
    JSON.stringify({ title: 'Soirée raclette', starts_at: '2030-01-10T19:00:00Z', group_id: g, ...p }),
    guests,
  ]).then((r) => r.id);
const allocate = (who: string, lot: string, n: number) => one(db, who, `select allocate_to_group($1, $2, $3)`, [lot, g, n]);
const propose = (who: string, ev: string, lot: string, n: number, bring: boolean) =>
  one<{ r: { id: string; status: string; from_group: number; reserved_qty: number } }>(db, who, `select to_json(propose_event_wine($1, $2, $3, null, $4, $5)) as r`, [ev, lot, n, bring, rid()]).then((x) => x.r);
const allocated = async (lot: string) => (await db.query<{ allocated: number }>(`select allocated from group_shares where lot_id = $1 and group_id = $2`, [lot, g])).rows[0]?.allocated ?? null;
/** Le compteur unique : réservé = mises à disposition + réservations d'événements. */
async function coherent(lot: string) {
  const r = await db.query<{ reserved: number; parts: number }>(
    `select l.reserved,
            coalesce((select sum(allocated) from group_shares where lot_id = l.id), 0)
              + coalesce((select sum(reserved_qty) from event_wines where lot_id = l.id and status = 'confirmed'), 0) as parts
     from lots l where l.id = $1`,
    [lot],
  );
  expect(Number(r.rows[0].parts)).toBe(r.rows[0].reserved);
}

describe('soirées de groupe : invitations', () => {
  it('Claire invite Marc (membre du groupe, pas son ami) ; Sam, hors du groupe, ne peut pas l’être', async () => {
    const ev = await evening(claire, [marc, bruno]);
    expect(await as(db, marc, `select title, group_id from events`)).toEqual([{ title: 'Soirée raclette', group_id: g }]);
    expect(await as(db, marc, `select kind from notifications where kind = 'event_invite'`)).toHaveLength(1);
    await expectError(one(db, claire, `select invite_to_event($1, $2::uuid[])`, [ev, [sam]]), /not_friend/);
    // Sans groupe : seulement des amis.
    await expectError(evening(claire, [marc], { group_id: null }), /not_friend/);
    // Hors du groupe : pas de soirée du groupe.
    await expectError(evening(sam, []), /forbidden/);
    expect(await as(db, bruno, `select kind, actor_name, target_name from group_activity where kind = 'event'`)).toEqual([
      { kind: 'event', actor_name: 'Claire', target_name: 'Soirée raclette' },
    ]);
  });
});

describe('soirées de groupe : bouteilles mises à disposition', () => {
  it('apportée à la soirée : prise sur la mise à disposition, sans double comptage ; soirée annulée : rendue au groupe', async () => {
    const { lotId } = await addWine(db, bruno, { name: 'Morgon' }, { quantity: 6 });
    await allocate(bruno, lotId, 2);
    const ev = await evening(claire, [bruno]);
    const w = await propose(bruno, ev, lotId, 3, true);
    expect(w).toMatchObject({ status: 'confirmed', reserved_qty: 3, from_group: 2 });
    expect(await allocated(lotId)).toBe(0);
    expect(await lotState(db, lotId)).toEqual({ quantity: 6, reserved: 3 });
    await coherent(lotId);
    await one(db, claire, `select cancel_event($1)`, [ev]);
    expect(await allocated(lotId)).toBe(2);
    expect(await lotState(db, lotId)).toEqual({ quantity: 6, reserved: 2 });
    await coherent(lotId);
  });

  it('suggérée par un membre qui n’est pas ami du propriétaire, confirmée, puis ouverte en partie : le reste revient au groupe', async () => {
    const { lotId } = await addWine(db, marc, { name: 'Sancerre', vintage: 2022 }, { quantity: 4 });
    await allocate(marc, lotId, 3);
    const ev = await evening(claire, [marc], { starts_at: '2020-06-01T19:00:00Z' });
    // Les bouteilles du groupe sont proposables pour sa soirée, avec ce qui est mis à disposition.
    expect(await as(db, claire, `select name, for_group from event_suggestable_lots($1)`, [ev])).toEqual([{ name: 'Sancerre', for_group: 3 }]);
    const s = await propose(claire, ev, lotId, 2, false);
    expect(s.status).toBe('proposed');
    const c = await one<{ r: { from_group: number } }>(db, marc, `select to_json(confirm_event_wine($1, null)) as r`, [s.id]);
    expect(c.r.from_group).toBe(2);
    expect(await allocated(lotId)).toBe(1);
    await coherent(lotId);
    await one(db, claire, `select close_event($1)`, [ev]);
    const key = rid();
    await one(db, marc, `select confirm_event_consumption($1, 1, $2)`, [s.id, key]);
    await one(db, marc, `select confirm_event_consumption($1, 1, $2)`, [s.id, key]);
    // 1 ouverte (sortie du stock une fois), 1 rendue au groupe.
    expect(await lotState(db, lotId)).toEqual({ quantity: 3, reserved: 2 });
    expect(await allocated(lotId)).toBe(2);
    await coherent(lotId);
    expect(await as(db, bruno, `select actor_name, target_name, detail from group_activity where kind = 'consumed'`)).toEqual([
      { actor_name: 'Marc', target_name: 'Sancerre 2022', detail: '1' },
    ]);
  });

  it('hors du groupe ou non visible dans le groupe : non proposable ; propriétaire parti du groupe : les bouteilles redeviennent libres', async () => {
    const { lotId } = await addWine(db, marc, { name: 'Chablis' }, { quantity: 5 });
    const ev = await evening(claire, [marc]);
    await expectError(propose(claire, ev, lotId, 1, false), /not_proposable/);
    await allocate(marc, lotId, 2);
    await propose(marc, ev, lotId, 2, true);
    expect(await allocated(lotId)).toBe(0);
    await one(db, marc, `select leave_group($1)`, [g]);
    await coherent(lotId);
    // Soirée annulée : plus de mise à disposition à retrouver, les bouteilles sont libres.
    await one(db, claire, `select cancel_event($1)`, [ev]);
    expect(await lotState(db, lotId)).toEqual({ quantity: 5, reserved: 0 });
    await coherent(lotId);
  });
});

describe('notes partagées avec le groupe', () => {
  it('lisibles par les membres seulement ; signalées dans l’activité ; quitter le groupe retire le partage', async () => {
    await one(db, claire, `select create_tasting($1::jsonb, null, $2)`, [
      JSON.stringify({ wine_name: 'Morgon Côte du Py', vintage: 2020, rating: 5, comment: 'Superbe', group_id: g, photo: `${claire}/note.jpg` }),
      rid(),
    ]);
    expect(await as(db, marc, `select author_name, wine_name, rating, mine from group_notes($1)`, [g])).toEqual([
      { author_name: 'Claire', wine_name: 'Morgon Côte du Py', rating: 5, mine: false },
    ]);
    expect(await as(db, sam, `select * from group_notes($1)`, [g])).toEqual([]);
    expect((await one<{ ok: boolean }>(db, marc, `select can_read_photo($1) as ok`, [`${claire}/note.jpg`])).ok).toBe(true);
    expect((await one<{ ok: boolean }>(db, sam, `select can_read_photo($1) as ok`, [`${claire}/note.jpg`])).ok).toBe(false);
    expect(await as(db, bruno, `select actor_name, target_name, detail from group_activity where kind = 'note'`)).toEqual([
      { actor_name: 'Claire', target_name: 'Morgon Côte du Py 2020', detail: '5' },
    ]);
    // Un groupe dont on n'est pas membre : refusé.
    await expectError(one(db, sam, `select create_tasting($1::jsonb, null, $2)`, [JSON.stringify({ wine_name: 'X', group_id: g }), rid()]), /forbidden/);
    await one(db, claire, `select leave_group($1)`, [g]);
    expect(await as(db, marc, `select * from group_notes($1)`, [g])).toEqual([]);
    expect(await as(db, claire, `select group_id from tastings`)).toEqual([{ group_id: null }]);
  });
});

describe('envies communes', () => {
  it('proposer, participer, retirer ; droits et départ', async () => {
    const w = await one<{ r: { id: string } }>(db, claire, `select to_json(add_group_wish($1, $2::jsonb)) as r`, [
      g,
      JSON.stringify({ wine_name: 'Château Montus', vintage: 2016, color: 'rouge', note: 'Pour Noël, à partager' }),
    ]);
    await one(db, marc, `select vote_group_wish($1, true)`, [w.r.id]);
    await one(db, marc, `select vote_group_wish($1, true)`, [w.r.id]);
    expect(await as(db, bruno, `select wine_name, author_name, votes, voters, voted from group_wishes_list($1)`, [g])).toEqual([
      { wine_name: 'Château Montus', author_name: 'Claire', votes: 2, voters: ['Claire', 'Marc'], voted: false },
    ]);
    expect((await one<{ voted: boolean }>(db, marc, `select voted from group_wishes_list($1)`, [g])).voted).toBe(true);
    await one(db, marc, `select vote_group_wish($1, false)`, [w.r.id]);
    expect((await one<{ votes: number }>(db, bruno, `select votes from group_wishes_list($1)`, [g])).votes).toBe(1);
    // Hors du groupe : rien.
    await expectError(one(db, sam, `select vote_group_wish($1, true)`, [w.r.id]), /not_found/);
    await expectError(one(db, sam, `select add_group_wish($1, '{"wine_name":"X"}'::jsonb)`, [g]), /forbidden/);
    expect(await as(db, sam, `select * from group_wishes_list($1)`, [g])).toEqual([]);
    // Retirer : l'autrice ou un administrateur ; pas un simple membre.
    await expectError(one(db, marc, `select delete_group_wish($1)`, [w.r.id]), /forbidden/);
    // Départ : ses « je participe » sont retirés, son envie reste.
    await one(db, claire, `select leave_group($1)`, [g]);
    expect(await as(db, bruno, `select votes, author_name from group_wishes_list($1)`, [g])).toEqual([{ votes: 0, author_name: 'Claire' }]);
    await one(db, bruno, `select delete_group_wish($1)`, [w.r.id]);
    expect(await as(db, bruno, `select * from group_wishes_list($1)`, [g])).toEqual([]);
    expect(await as(db, bruno, `select kind, actor_name, target_name from group_activity where kind = 'wish'`)).toEqual([
      { kind: 'wish', actor_name: 'Claire', target_name: 'Château Montus 2016' },
    ]);
  });
});

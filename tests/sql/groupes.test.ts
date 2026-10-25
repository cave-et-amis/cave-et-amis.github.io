import { beforeEach, describe, expect, it } from 'vitest';
import { addWine, as, befriend, createDb, createUser, expectError, one, type Db } from '../helpers/db.ts';

let db: Db;
let bruno: string;
let claire: string;
let marc: string;
let sam: string;

beforeEach(async () => {
  db = await createDb();
  bruno = await createUser(db, 'Bruno');
  claire = await createUser(db, 'Claire');
  marc = await createUser(db, 'Marc');
  sam = await createUser(db, 'Sam');
});

type Member = { user_id: string; display_name: string; role: string; status: string };
type MyGroup = { id: string; name: string; emoji: string; my_role: string; my_status: string; members: number; bottles: number; invited_by_name: string | null };

async function createGroup(who: string, name = 'Les soirées entre amis', invite: string[] = []) {
  const g = await one<{ id: string }>(db, who, `select (create_group($1, '🎉', 'Nos dîners', null, $2::uuid[])).id`, [name, invite]);
  return g.id;
}
const members = (who: string, g: string) => as<Member>(db, who, `select * from group_members_list($1)`, [g]);
const myGroups = (who: string) => as<MyGroup>(db, who, `select * from my_groups()`);
const accept = (who: string, g: string) => one(db, who, `select respond_group_invite($1, true)`, [g]);
const activity = (who: string, g: string) =>
  as<{ kind: string; actor_name: string | null; target_name: string; detail: string | null }>(db, who, `select * from group_activity where group_id = $1 order by created_at`, [g]);

describe('création et invitations', () => {
  it('le créateur est administrateur ; il invite ses amis, qui sont prévenus et acceptent', async () => {
    await befriend(db, bruno, claire);
    const g = await createGroup(bruno, 'Les soirées entre amis', [claire]);
    expect(await myGroups(bruno)).toMatchObject([{ name: 'Les soirées entre amis', emoji: '🎉', my_role: 'admin', my_status: 'active', members: 1 }]);
    // Claire voit l'invitation (et qui l'a invitée), pas encore la cave ni les membres.
    expect(await myGroups(claire)).toMatchObject([{ my_status: 'invited', invited_by_name: 'Bruno' }]);
    expect(await members(claire, g)).toEqual([]);
    expect(await as(db, claire, `select * from notifications where kind = 'group_invite'`)).toMatchObject([{ actor_name: 'Bruno', ref_id: g }]);
    expect(await accept(claire, g)).toBeDefined();
    expect((await members(claire, g)).map((m) => [m.display_name, m.role])).toEqual([
      ['Bruno', 'admin'],
      ['Claire', 'member'],
    ]);
    // Bruno est prévenu ; l'activité garde la trace.
    expect(await as(db, bruno, `select actor_name from notifications where kind = 'group_joined'`)).toEqual([{ actor_name: 'Claire' }]);
    expect((await activity(claire, g)).map((a) => [a.kind, a.target_name])).toEqual([
      ['created', 'Les soirées entre amis'],
      ['invited', 'Claire'],
      ['joined', 'Claire'],
    ]);
  });

  it('seuls les amis sont invitables ; jamais une personne bloquée ; refuser retire l’invitation', async () => {
    const g = await createGroup(bruno);
    await expectError(one(db, bruno, `select invite_to_group($1, array[$2]::uuid[])`, [g, claire]), /not_friend/);
    await befriend(db, bruno, claire);
    await one(db, claire, `select block_user($1)`, [bruno]);
    await expectError(one(db, bruno, `select invite_to_group($1, array[$2]::uuid[])`, [g, claire]), /not_friend/);

    await befriend(db, bruno, marc);
    await one(db, bruno, `select invite_to_group($1, array[$2]::uuid[])`, [g, marc]);
    await one(db, marc, `select respond_group_invite($1, false)`, [g]);
    expect(await myGroups(marc)).toEqual([]);
    expect((await members(bruno, g)).map((m) => m.display_name)).toEqual(['Bruno']);
  });

  it('un membre simple n’invite pas ; un gestionnaire invite ; l’administrateur annule une invitation', async () => {
    await befriend(db, bruno, claire);
    await befriend(db, claire, marc);
    await befriend(db, bruno, sam);
    const g = await createGroup(bruno, 'Famille', [claire]);
    await accept(claire, g);
    await expectError(one(db, claire, `select invite_to_group($1, array[$2]::uuid[])`, [g, marc]), /forbidden/);
    await one(db, bruno, `select set_member_role($1, $2, 'manager')`, [g, claire]);
    await one(db, claire, `select invite_to_group($1, array[$2]::uuid[])`, [g, marc]);
    // Invitations en attente : visibles des administrateurs et gestionnaires seulement.
    expect((await members(bruno, g)).find((m) => m.display_name === 'Marc')?.status).toBe('invited');
    await one(db, bruno, `select cancel_group_invite($1, $2)`, [g, marc]);
    expect(await myGroups(marc)).toEqual([]);
    expect(await as(db, marc, `select * from notifications where kind = 'group_invite'`)).toEqual([]);
  });

  it('un non-membre ne voit rien du groupe', async () => {
    await befriend(db, bruno, claire);
    const g = await createGroup(bruno, 'Privé', [claire]);
    for (const who of [marc, claire]) {
      expect(await as(db, who, `select * from group_lots($1)`, [g])).toEqual([]);
      expect(await members(who, g)).toEqual([]);
      expect(await activity(who, g)).toEqual([]);
    }
    expect(await as(db, marc, `select * from groups`)).toEqual([]);
    // Écriture directe interdite.
    await expectError(as(db, marc, `insert into group_members (group_id, user_id, role, status) values ($1, $2, 'admin', 'active')`, [g, marc]), /permission denied/);
    await expectError(as(db, bruno, `update groups set name = 'X'`), /permission denied/);
  });
});

describe('rôles et départs', () => {
  async function familyOf3() {
    await befriend(db, bruno, claire);
    await befriend(db, bruno, marc);
    const g = await createGroup(bruno, 'Famille', [claire, marc]);
    await accept(claire, g);
    await accept(marc, g);
    return g;
  }

  it('le gestionnaire retire un membre, pas un autre gestionnaire ni l’administrateur', async () => {
    const g = await familyOf3();
    await one(db, bruno, `select set_member_role($1, $2, 'manager')`, [g, claire]);
    await expectError(one(db, claire, `select remove_member($1, $2)`, [g, bruno]), /forbidden/);
    await one(db, claire, `select remove_member($1, $2)`, [g, marc]);
    expect((await members(bruno, g)).map((m) => m.display_name)).toEqual(['Bruno', 'Claire']);
    await expectError(one(db, marc, `select set_member_role($1, $2, 'admin')`, [g, marc]), /forbidden/);
  });

  it('le dernier administrateur ne part pas sans successeur ; seul, il peut partir : le groupe disparaît', async () => {
    const g = await familyOf3();
    await expectError(one(db, bruno, `select leave_group($1)`, [g]), /last_admin/);
    await expectError(one(db, bruno, `select set_member_role($1, $2, 'member')`, [g, bruno]), /last_admin/);
    await one(db, bruno, `select set_member_role($1, $2, 'admin')`, [g, claire]);
    await one(db, bruno, `select leave_group($1)`, [g]);
    expect((await members(claire, g)).map((m) => [m.display_name, m.role])).toEqual([
      ['Claire', 'admin'],
      ['Marc', 'member'],
    ]);
    await one(db, marc, `select leave_group($1)`, [g]);
    await one(db, claire, `select leave_group($1)`, [g]);
    expect(await db.query(`select * from groups where id = $1`, [g]).then((r) => r.rows)).toEqual([]);
  });

  it('compte de l’administrateur supprimé : un autre membre est promu, le groupe continue', async () => {
    const g = await familyOf3();
    await one(db, bruno, `select set_member_role($1, $2, 'manager')`, [g, marc]);
    await db.query(`delete from auth.users where id = $1`, [bruno]);
    // Le gestionnaire passe avant le simple membre.
    expect((await members(claire, g)).map((m) => [m.display_name, m.role])).toEqual([
      ['Marc', 'admin'],
      ['Claire', 'member'],
    ]);
  });

  it('suppression du groupe par l’administrateur seulement', async () => {
    const g = await familyOf3();
    await expectError(one(db, claire, `select delete_group($1)`, [g]), /forbidden/);
    await one(db, bruno, `select delete_group($1)`, [g]);
    expect(await myGroups(claire)).toEqual([]);
  });
});

describe('partage visible dans un groupe', () => {
  it('seuls les membres voient les bouteilles partagées, avec les masques du propriétaire ; rien n’est réservé', async () => {
    await befriend(db, bruno, claire);
    const g = await createGroup(bruno, 'Les soirées entre amis', [claire]);
    await accept(claire, g);
    const shared = await addWine(db, bruno, { name: 'Morgon', vintage: 2020, notes: 'secret' }, { quantity: 6, purchase_price: 18 });
    await addWine(db, bruno, { name: 'Privé' }, { quantity: 2 });
    await one(db, bruno, `select share_lot_with_group($1, $2, true)`, [shared.lotId, g]);
    // Double clic sans effet.
    await one(db, bruno, `select share_lot_with_group($1, $2, true)`, [shared.lotId, g]);

    const forClaire = await as<{ name: string; owner_name: string; quantity: number; purchase_price: string | null; notes: string | null; mine: boolean }>(
      db,
      claire,
      `select * from group_lots($1)`,
      [g],
    );
    expect(forClaire).toMatchObject([{ name: 'Morgon', owner_name: 'Bruno', quantity: 6, purchase_price: null, notes: null, mine: false }]);
    const forBruno = await as<{ purchase_price: string; mine: boolean }>(db, bruno, `select * from group_lots($1)`, [g]);
    expect(Number(forBruno[0].purchase_price)).toBe(18);
    expect(forBruno[0].mine).toBe(true);
    expect(await as(db, marc, `select * from group_lots($1)`, [g])).toEqual([]);
    // Visible n'est pas réservé : le stock reste entièrement libre.
    expect((await db.query<{ reserved: number }>(`select reserved from lots where id = $1`, [shared.lotId])).rows[0].reserved).toBe(0);
    expect((await myGroups(claire))[0].bottles).toBe(1);
    expect((await activity(claire, g)).at(-1)).toMatchObject({ kind: 'shared', target_name: 'Morgon 2020', actor_name: 'Bruno' });

    // Photo du vin lisible par les membres, pas par les autres.
    await db.query(`update wines set label_photo = $2 where id = $1`, [shared.wineId, `${bruno}/morgon.jpg`]);
    expect((await one<{ ok: boolean }>(db, claire, `select can_read_photo($1) as ok`, [`${bruno}/morgon.jpg`])).ok).toBe(true);
    expect((await one<{ ok: boolean }>(db, marc, `select can_read_photo($1) as ok`, [`${bruno}/morgon.jpg`])).ok).toBe(false);

    await one(db, bruno, `select share_lot_with_group($1, $2, false)`, [shared.lotId, g]);
    expect(await as(db, claire, `select * from group_lots($1)`, [g])).toEqual([]);
  });

  it('on ne partage que ses propres lots, et seulement dans un groupe dont on est membre', async () => {
    await befriend(db, bruno, claire);
    const g = await createGroup(bruno, 'G', [claire]);
    const lot = await addWine(db, bruno, { name: 'Vin' });
    await expectError(one(db, claire, `select share_lot_with_group($1, $2, true)`, [lot.lotId, g]), /not_found/);
    const other = await createGroup(marc, 'Autre');
    await expectError(one(db, bruno, `select share_lot_with_group($1, $2, true)`, [lot.lotId, other]), /forbidden/);
  });

  it('quitter le groupe retire mes partages ; mes bouteilles restent à moi', async () => {
    await befriend(db, bruno, claire);
    const g = await createGroup(bruno, 'G', [claire]);
    await accept(claire, g);
    const lot = await addWine(db, claire, { name: 'Sancerre' }, { quantity: 4 });
    await one(db, claire, `select share_lot_with_group($1, $2, true)`, [lot.lotId, g]);
    expect((await as(db, bruno, `select * from group_lots($1)`, [g])).length).toBe(1);
    await one(db, claire, `select leave_group($1)`, [g]);
    expect(await as(db, bruno, `select * from group_lots($1)`, [g])).toEqual([]);
    expect((await db.query<{ quantity: number; owner_id: string }>(`select quantity, owner_id from lots where id = $1`, [lot.lotId])).rows[0]).toEqual({
      quantity: 4,
      owner_id: claire,
    });
  });

  it('photo du groupe : seulement depuis son propre dossier, lisible par les membres', async () => {
    await befriend(db, bruno, claire);
    await expectError(one(db, bruno, `select create_group('G', '🍷', null, $1, null)`, [`${claire}/vol.jpg`]), /forbidden/);
    const g = await one<{ id: string }>(db, bruno, `select (create_group('G', '🍷', null, $1, array[$2]::uuid[])).id`, [`${bruno}/groupe.jpg`, claire]);
    expect((await one<{ ok: boolean }>(db, claire, `select can_read_photo($1) as ok`, [`${bruno}/groupe.jpg`])).ok).toBe(false);
    await accept(claire, g.id);
    expect((await one<{ ok: boolean }>(db, claire, `select can_read_photo($1) as ok`, [`${bruno}/groupe.jpg`])).ok).toBe(true);
    await expectError(one(db, claire, `select update_group($1, '{"name":"Pirate"}'::jsonb)`, [g.id]), /forbidden/);
    await one(db, bruno, `select update_group($1, '{"name":"Les grandes occasions","emoji":"🍾"}'::jsonb)`, [g.id]);
    expect(await myGroups(claire)).toMatchObject([{ name: 'Les grandes occasions', emoji: '🍾' }]);
  });
});

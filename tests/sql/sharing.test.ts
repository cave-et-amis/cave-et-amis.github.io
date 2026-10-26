import { beforeEach, describe, expect, it } from 'vitest';
import { addWine, as, befriend, createDb, createUser, expectError, one, type Db } from '../helpers/db.ts';

let db: Db;
let bruno: string;
let claire: string;
let marc: string;

beforeEach(async () => {
  db = await createDb();
  bruno = await createUser(db, 'Bruno');
  claire = await createUser(db, 'Claire');
  marc = await createUser(db, 'Marc');
});

type Shared = { name: string; quantity: number | null; available: number | null; purchase_price: string | null; notes: string | null; in_stock: boolean };

describe('invitations entre amis', () => {
  it('lien d’invitation : informations visibles sans connexion, accepter crée la connexion', async () => {
    const inv = await one<{ r: { code: string } }>(db, bruno, `select create_friend_invite() as r`);
    expect(inv.r.code).toMatch(/^[A-Z2-9]{10}$/);
    const info = await one<{ r: { status: string; inviter_name: string } }>(db, null, `select friend_invite_info($1) as r`, [inv.r.code.toLowerCase()]);
    expect(info.r).toMatchObject({ status: 'pending', inviter_name: 'Bruno' });
    const res = await one<{ r: { status: string; friend_name: string } }>(db, claire, `select respond_friend_invite($1, true) as r`, [inv.r.code]);
    expect(res.r).toMatchObject({ status: 'accepted', friend_name: 'Bruno' });
    expect((await as(db, bruno, `select * from friendships`)).length).toBe(1);
    // Usage unique ; même réponse renvoyée en cas de double clic.
    await expectError(one(db, marc, `select respond_friend_invite($1, true)`, [inv.r.code]), /invite_used/);
    const again = await one<{ r: { status: string } }>(db, claire, `select respond_friend_invite($1, true) as r`, [inv.r.code]);
    expect(again.r.status).toBe('accepted');
  });

  it('refuser une invitation, s’inviter soi-même, code inconnu', async () => {
    const inv = await one<{ r: { code: string } }>(db, bruno, `select create_friend_invite() as r`);
    await expectError(one(db, bruno, `select respond_friend_invite($1, true)`, [inv.r.code]), /invite_self/);
    await one(db, claire, `select respond_friend_invite($1, false)`, [inv.r.code]);
    expect(await as(db, bruno, `select * from friendships`)).toEqual([]);
    expect((await one<{ r: { status: string } }>(db, null, `select friend_invite_info('ZZZZZZZZZZ') as r`)).r.status).toBe('invalid');
    await expectError(one(db, claire, `select respond_friend_invite('ZZZZZZZZZZ', true)`), /invite_invalid/);
  });

  it('les codes ne sont jamais stockés en clair', async () => {
    const inv = await one<{ r: { code: string } }>(db, bruno, `select create_friend_invite() as r`);
    const row = await one<{ code_hash: string }>(db, bruno, `select code_hash from friend_invites`);
    expect(row.code_hash).not.toContain(inv.r.code);
    expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('partage sélectif', () => {
  it('privé par défaut : un ami ne voit que les lots partagés, avec les masques choisis', async () => {
    await befriend(db, bruno, claire);
    await addWine(db, bruno, { name: 'Privé', notes: 'cachée' }, { quantity: 3, purchase_price: 20 });
    await addWine(db, bruno, { name: 'Partagé masqué', notes: 'note' }, { quantity: 4, purchase_price: 30, visibility: 'friends' });
    await addWine(db, bruno, { name: 'Partagé ouvert', notes: 'Superbe' }, {
      quantity: 2,
      purchase_price: 50,
      visibility: 'event',
      hide_price: false,
      hide_notes: false,
      hide_quantity: true,
    });
    const rows = await as<Shared>(db, claire, `select * from shared_lots(null) order by name`);
    expect(rows.map((r) => r.name)).toEqual(['Partagé masqué', 'Partagé ouvert']);
    const [masked, open] = rows;
    // Par défaut : prix et notes masqués, quantité visible.
    expect(masked).toMatchObject({ quantity: 4, available: 4, purchase_price: null, notes: null, in_stock: true });
    expect(open).toMatchObject({ quantity: null, available: null, notes: 'Superbe', in_stock: true });
    expect(Number(open.purchase_price)).toBe(50);
    // Aucun accès direct aux tables.
    expect(await as(db, claire, `select * from lots`)).toEqual([]);
    expect(await as(db, claire, `select * from wines`)).toEqual([]);
  });

  it('personne d’autre que les amis acceptés : un inconnu ne voit rien', async () => {
    await befriend(db, bruno, claire);
    await addWine(db, bruno, { name: 'Partagé' }, { visibility: 'friends' });
    expect(await as(db, marc, `select * from shared_lots(null)`)).toEqual([]);
    expect(await as(db, null, `select 1`)).toBeDefined();
    await expectError(as(db, null, `select * from shared_lots(null)`), /permission denied/);
  });

  it('supprimer la connexion révoque immédiatement l’accès, dans les deux sens', async () => {
    await befriend(db, bruno, claire);
    await addWine(db, bruno, { name: 'De Bruno' }, { visibility: 'friends' });
    await addWine(db, claire, { name: 'De Claire' }, { visibility: 'friends' });
    expect((await as(db, claire, `select * from shared_lots(null)`)).length).toBe(1);
    await one(db, claire, `select remove_friend($1)`, [bruno]);
    expect(await as(db, claire, `select * from shared_lots(null)`)).toEqual([]);
    expect(await as(db, bruno, `select * from shared_lots(null)`)).toEqual([]);
    // Le prénom de l'ancien ami n'est plus lisible (aucun événement commun).
    expect(await as(db, claire, `select * from profile_names() where id = $1`, [bruno])).toEqual([]);
  });

  it('les prénoms visibles : moi et mes amis ; le profil complet : moi seul', async () => {
    await befriend(db, bruno, claire);
    const names = await as<{ display_name: string }>(db, bruno, `select display_name from profile_names()`);
    expect(names.map((n) => n.display_name)).toEqual(['Bruno', 'Claire']);
    expect(await as(db, bruno, `select display_name from profiles`)).toEqual([{ display_name: 'Bruno' }]);
    await expectError(as(db, bruno, `update profiles set is_admin = true where id = auth.uid()`), /permission denied/);
  });

  it('un lot épuisé n’est plus montré aux amis', async () => {
    await befriend(db, bruno, claire);
    const { lotId } = await addWine(db, bruno, { name: 'Dernière' }, { quantity: 1, visibility: 'friends' });
    await one(db, bruno, `select record_movement($1, 'consommation', 1, null, null, gen_random_uuid())`, [lotId]);
    expect(await as(db, claire, `select * from shared_lots(null)`)).toEqual([]);
  });
});

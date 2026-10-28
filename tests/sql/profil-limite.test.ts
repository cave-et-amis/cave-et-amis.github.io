import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, as, asService, befriend, connect, createDb, createUser, expectError, one, type Db } from '../helpers/db.ts';

let db: Db;
let bruno: string; // premier compte : administrateur
let claire: string;
let marc: string;
let sam: string;
let lea: string;
let groupId: string;

// Bruno : contact de Claire et de Sam, ami de Marc. Claire et Marc dînent chez Bruno (événement commun, sans être en
// contact). Claire et Sam sont membres du groupe de Bruno, sans autre lien entre elles. Léa : aucun lien.
beforeEach(async () => {
  db = await createDb();
  bruno = await createUser(db, 'Bruno');
  claire = await createUser(db, 'Claire');
  marc = await createUser(db, 'Marc');
  sam = await createUser(db, 'Sam');
  lea = await createUser(db, 'Léa');
  await connect(db, bruno, claire);
  await befriend(db, bruno, marc);
  await connect(db, bruno, sam);
  await one(db, bruno, `select (create_event($1::jsonb, $2::uuid[])).id`, [
    JSON.stringify({ kind: 'diner', title: 'Dîner', starts_at: new Date(Date.now() + 86400_000).toISOString() }),
    `{${claire},${marc}}`,
  ]);
  groupId = (await one<{ id: string }>(db, bruno, `select (create_group('Les copains', '🍷', null, null, $1::uuid[])).id`, [[claire, sam]])).id;
  for (const who of [claire, sam]) await one(db, who, `select respond_group_invite($1, true)`, [groupId]);
});

/** Prénoms que la personne voit par la fonction dédiée (ordre alphabétique). */
const names = async (who: string) => (await as<{ display_name: string }>(db, who, `select display_name from profile_names()`)).map((r) => r.display_name);

describe('profil limité au prénom (audit, constat F8)', () => {
  it('un contact ne lit plus le rôle d’administrateur, les préférences, la devise ni la date d’inscription d’un autre', async () => {
    await as(db, bruno, `update profiles set currency = 'CHF', preferences = '{"advanced": true}' where id = auth.uid()`);
    expect(await asService(db, `select is_admin, currency from profiles where id = $1`, [bruno])).toEqual([{ is_admin: true, currency: 'CHF' }]);
    // Claire (contact) et Marc (ami) : plus rien de la ligne de Bruno.
    for (const who of [claire, marc]) {
      expect(await as(db, who, `select * from profiles where id = $1`, [bruno])).toEqual([]);
      expect(await as(db, who, `select is_admin, preferences, currency, created_at from profiles where id = $1`, [bruno])).toEqual([]);
    }
    // Participants d'un même événement : pas davantage.
    expect(await as(db, marc, `select * from profiles where id = $1`, [claire])).toEqual([]);
    expect(await as(db, claire, `select id from profiles`)).toEqual([{ id: claire }]);
    // Seuls l'identifiant et le prénom sortent, par la fonction dédiée.
    expect(await as(db, claire, `select * from profile_names() where id = $1`, [bruno])).toEqual([{ id: bruno, display_name: 'Bruno', avatar_photo: null }]);
  });

  it('il lit toujours son prénom, comme les participants d’un événement commun et les membres d’un groupe commun', async () => {
    expect(await names(claire)).toEqual(['Bruno', 'Claire', 'Marc']);
    expect(await names(marc)).toEqual(['Bruno', 'Claire', 'Marc']);
    expect(await names(bruno)).toEqual(['Bruno', 'Claire', 'Marc', 'Sam']);
    // Membres d'un même groupe sans autre lien : le prénom par les fonctions du groupe, comme avant (pas par profile_names).
    const members = await as<Record<string, unknown>>(db, sam, `select * from group_members_list($1)`, [groupId]);
    expect(members.map((m) => m.display_name)).toEqual(['Bruno', 'Claire', 'Sam']);
    expect(Object.keys(members[0]).sort()).toEqual(['display_name', 'invited_at', 'joined_at', 'role', 'status', 'user_id']);
    expect(await names(sam)).toEqual(['Bruno', 'Sam']);
  });

  it('une personne sans lien ne lit rien ; la recherche d’amis fonctionne comme avant', async () => {
    expect(await as(db, lea, `select id from profiles`)).toEqual([{ id: lea }]);
    expect(await names(lea)).toEqual(['Léa']);
    expect(await as(db, lea, `select * from profile_names() where id = $1`, [bruno])).toEqual([]);
    await expectError(as(db, null, `select * from profile_names()`), /permission denied/);
    // Claire accepte d'apparaître dans la recherche : Léa trouve son prénom, et rien d'autre.
    await as(db, claire, `update profiles set discoverable = true where id = auth.uid()`);
    expect(await as(db, lea, `select * from search_users('cla')`)).toEqual([{ id: claire, display_name: 'Claire', relation: 'none' }]);
    expect(await as(db, lea, `select * from profiles where id = $1`, [claire])).toEqual([]);
    expect(await names(lea)).toEqual(['Léa']);
    // Demande acceptée : elles sont en contact et voient leur prénom, seulement lui.
    const req = await one<{ r: { id: string } }>(db, lea, `select send_friend_request($1) as r`, [claire]);
    expect(await as(db, claire, `select other_name from my_friend_requests()`)).toEqual([{ other_name: 'Léa' }]);
    await one(db, claire, `select respond_friend_request($1, true)`, [req.r.id]);
    expect(await names(lea)).toEqual(['Claire', 'Léa']);
    expect(await as(db, lea, `select * from profiles where id = $1`, [claire])).toEqual([]);
  });

  it('chacun lit et modifie tout son profil', async () => {
    const mine = await as<Record<string, unknown>>(db, claire, `select * from profiles`);
    expect(mine).toHaveLength(1);
    expect(Object.keys(mine[0]).sort()).toEqual(['avatar_photo', 'created_at', 'currency', 'discoverable', 'display_name', 'id', 'is_admin', 'preferences', 'show_shared_wines']);
    expect(mine[0]).toMatchObject({ id: claire, display_name: 'Claire', currency: 'EUR', is_admin: false, discoverable: false, show_shared_wines: true });
    await as(
      db,
      claire,
      `update profiles set display_name = 'Claire D.', currency = 'CHF', preferences = '{"advanced": true}', discoverable = true, show_shared_wines = false
       where id = auth.uid()`,
    );
    await one(db, claire, `select merge_preferences('{"tips": ["cave"]}'::jsonb)`);
    expect(await one(db, claire, `select display_name, currency, preferences, discoverable, show_shared_wines from profiles`)).toEqual({
      display_name: 'Claire D.',
      currency: 'CHF',
      preferences: { advanced: true, tips: ['cave'] },
      discoverable: true,
      show_shared_wines: false,
    });
    // Ses contacts voient le nouveau prénom.
    expect(await as(db, bruno, `select display_name from profile_names() where id = $1`, [claire])).toEqual([{ display_name: 'Claire D.' }]);
    // Jamais le profil d'un autre, ni son propre rôle.
    expect(await as(db, claire, `update profiles set display_name = 'Pirate' where id = $1 returning id`, [bruno])).toEqual([]);
    expect(await asService(db, `select display_name from profiles where id = $1`, [bruno])).toEqual([{ display_name: 'Bruno' }]);
    await expectError(as(db, claire, `update profiles set is_admin = true where id = auth.uid()`), /permission denied/);
  });
});

describe('mise à jour et retour arrière', () => {
  it('les prénoms visibles sont exactement ceux d’avant ; le retour arrière rend l’état d’avant ; la mise à jour se rejoue', async () => {
    const everyone = [bruno, claire, marc, sam, lea];
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '..', 'sql', 'retour-20261101000003.sql'), 'utf8'));
    // Cas limites : contact retiré (Sam reste dans le groupe de Bruno), blocage entre deux participants d'un même dîner.
    await one(db, sam, `select remove_friend($1)`, [bruno]);
    await one(db, claire, `select block_user($1)`, [marc]);
    // État d'avant : la ligne entière, pour les contacts et les participants d'un même événement.
    expect(await as(db, claire, `select is_admin from profiles where id = $1`, [bruno])).toEqual([{ is_admin: true }]);
    await expectError(as(db, claire, `select * from profile_names()`), /does not exist/);
    const before = new Map<string, string[]>();
    for (const who of everyone) before.set(who, ids(await as<{ id: string }>(db, who, `select id from profiles`)));

    const migration = readFileSync(join(MIGRATIONS_DIR, '20261101000003_profil_limite.sql'), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    for (const who of everyone) {
      expect(ids(await as<{ id: string }>(db, who, `select id from profile_names()`))).toEqual(before.get(who));
      expect(await as(db, who, `select id from profiles`)).toEqual([{ id: who }]);
    }
    expect(await as(db, claire, `select is_admin from profiles where id = $1`, [bruno])).toEqual([]);
    // La règle d'avant, cas limites compris : Claire et Marc se voient toujours (dîner commun), Sam ne voit plus Bruno.
    expect(await names(claire)).toEqual(['Bruno', 'Claire', 'Marc']);
    expect(await names(sam)).toEqual(['Sam']);
  });
});

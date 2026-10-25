import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { SUPABASE_SHIM_SQL } from '../../server/local/shim.sql.ts';
import { MIGRATIONS_DIR, addWine, as, befriend, connect, createDb, createUser, expectError, one, rid, type Db } from '../helpers/db.ts';

let db: Db;
let bruno: string;
let claire: string;
let lea: string;
let marc: string;
let sam: string;

// Bruno est ami de Claire et de Léa (caves ouvertes dans les deux sens) ; Marc est un simple contact (relation sans
// cave ouverte) ; Sam ne connaît personne.
beforeEach(async () => {
  db = await createDb();
  bruno = await createUser(db, 'Bruno');
  claire = await createUser(db, 'Claire');
  lea = await createUser(db, 'Léa');
  marc = await createUser(db, 'Marc');
  sam = await createUser(db, 'Sam');
  await befriend(db, bruno, claire);
  await befriend(db, bruno, lea);
  await connect(db, bruno, marc);
});

type Seen = {
  lot_id: string;
  name: string;
  quantity: number | null;
  available: number | null;
  in_stock: boolean;
  purchase_price: string | null;
  currency: string | null;
  notes: string | null;
  hide_price: boolean;
  hide_quantity: boolean;
  hide_notes: boolean;
};
type Preview = Seen & { origin: string; origin_id: string | null; origin_label: string | null };
type Relation = {
  they_see_mine: boolean;
  i_see_theirs: boolean;
  detail_level: string | null;
  exceptions: number;
  visible_lots: number;
  visible_bottles: number;
  shared_with_me: number;
};

/** Un vin et son lot, avec une photo d'étiquette dans le dossier de son propriétaire. */
const wine = (who: string, name: string, lot: Record<string, unknown> = {}) =>
  addWine(db, who, { name, label_photo: `${who}/${name.toLowerCase()}.jpg` }, lot);
const photo = (who: string, name: string) => `${who}/${name.toLowerCase()}.jpg`;
const names = async (who: string, sql: string, params: unknown[] = []) =>
  (await as<{ name: string }>(db, who, sql, params)).map((r) => r.name).sort();
/** Ce que « who » voit des caves qui lui sont ouvertes (toutes, ou celle de owner). */
const cellarOf = (who: string, owner: string | null = null) => names(who, `select name from shared_lots($1)`, [owner]);
const canRead = async (who: string, path: string) => (await one<{ ok: boolean }>(db, who, `select can_read_photo($1) as ok`, [path])).ok;
const access = async (who: string, other: string) =>
  one<{ connected: boolean; sees: boolean }>(db, who, `select is_connected($1) as connected, can_see_cellar($1) as sees`, [other]);
const preview = (who: string, viewer: string) => as<Preview>(db, who, `select * from preview_my_cellar_as($1)`, [viewer]);
const relation = async (who: string, other: string) =>
  (await as<Relation>(db, who, `select * from my_relations() where user_id = $1`, [other]))[0];
const grant = (who: string, viewer: string) => one(db, who, `select grant_cellar_access($1)`, [viewer]);
const exception = (who: string, viewer: string, lot: string, mode: 'hide' | 'show' | null) =>
  one(db, who, `select set_cellar_exception($1, $2, $3)`, [viewer, lot, mode]);
const event = (who: string, guests: string[], p: Record<string, unknown> = {}) =>
  one<{ id: string }>(db, who, `select (create_event($1::jsonb, $2::uuid[])).id`, [
    JSON.stringify({ title: 'Dîner', starts_at: '2030-01-10T19:00:00Z', ...p }),
    guests,
  ]).then((r) => r.id);
async function group(who: string, members: string[]) {
  const g = (await one<{ id: string }>(db, who, `select (create_group('Famille', '🍷', null, null, $1::uuid[])).id`, [members])).id;
  for (const m of members) await one(db, m, `select respond_group_invite($1, true)`, [g]);
  return g;
}
const share = (who: string, lot: string, g: string) => one(db, who, `select share_lot_with_group($1, $2, true)`, [lot, g]);
const propose = (who: string, ev: string, lot: string) =>
  one(db, who, `select propose_event_wine($1, $2, 1, null, false, $3)`, [ev, lot, rid()]);
const invite = (who: string, kind: string, target: string | null = null) =>
  one<{ r: { id: string; code: string; max_uses: number } }>(db, who, `select create_invite($1, $2) as r`, [kind, target]).then((x) => x.r);
const redeem = (who: string, code: string, accept = true) =>
  one<{ r: { status: string; kind: string; target_id: string | null; friend_name: string } }>(db, who, `select respond_friend_invite($1, $2) as r`, [
    code,
    accept,
  ]).then((x) => x.r);
const info = (who: string | null, code: string) =>
  one<{ r: Record<string, unknown> }>(db, who, `select friend_invite_info($1) as r`, [code]).then((x) => x.r);
const ask = (who: string, owner: string) =>
  one<{ r: { status: string; id: string } }>(db, who, `select request_cellar_access($1) as r`, [owner]).then((x) => x.r);

describe('contacts : la relation ne donne accès à aucune bouteille', () => {
  it('1. un contact ne voit aucun lot « amis » : ni vues, ni groupe, ni photos, ni suggestions, ni compteurs', async () => {
    const morgon = await wine(bruno, 'Morgon', { visibility: 'friends' });
    const pomerol = await wine(bruno, 'Pomerol', { visibility: 'event' });
    const g = await group(bruno, [claire, marc]);
    const ev = await event(bruno, [claire, marc]);
    // Claire, amie : toute la cave partagée.
    expect(await cellarOf(claire)).toEqual(['Morgon', 'Pomerol']);
    // Marc, contact : rien, par aucun chemin.
    expect(await cellarOf(marc)).toEqual([]);
    expect(await cellarOf(marc, bruno)).toEqual([]);
    expect(await as(db, marc, `select * from group_lots($1)`, [g])).toEqual([]);
    expect(await as(db, marc, `select * from event_suggestable_lots($1)`, [ev])).toEqual([]);
    expect(await canRead(marc, photo(bruno, 'Morgon'))).toBe(false);
    expect(await canRead(claire, photo(bruno, 'Morgon'))).toBe(true);
    expect(await access(marc, bruno)).toEqual({ connected: true, sees: false });
    expect(await one(db, marc, `select can_see_lot($1) as a, can_see_lot($2) as b`, [morgon.lotId, pomerol.lotId])).toEqual({ a: false, b: false });
    expect(await relation(marc, bruno)).toMatchObject({ i_see_theirs: false, shared_with_me: 0 });
    expect(await relation(bruno, marc)).toMatchObject({ they_see_mine: false, visible_lots: 0, visible_bottles: 0 });
    expect(await as(db, marc, `select * from lots`)).toEqual([]);
    expect(await as(db, marc, `select * from wines`)).toEqual([]);
    await expectError(propose(marc, ev, pomerol.lotId), /not_proposable/);
  });

  it('2. un contact invité à un événement voit uniquement les vins proposés pour cet événement', async () => {
    const morgon = await wine(bruno, 'Morgon', { visibility: 'private' });
    await wine(bruno, 'Pomerol', { visibility: 'event' });
    const ev = await event(bruno, [marc, claire]);
    await propose(bruno, ev, morgon.lotId);
    expect(await names(marc, `select wine_name as name from event_wines where event_id = $1`, [ev])).toEqual(['Morgon']);
    expect(await canRead(marc, photo(bruno, 'Morgon'))).toBe(true);
    // Rien d'autre de la cave : ni les bouteilles « proposables », ni leurs photos.
    expect(await cellarOf(marc)).toEqual([]);
    expect(await as(db, marc, `select * from event_suggestable_lots($1)`, [ev])).toEqual([]);
    expect(await canRead(marc, photo(bruno, 'Pomerol'))).toBe(false);
    // Claire, amie, peut suggérer la bouteille « proposable ».
    expect(await names(claire, `select name from event_suggestable_lots($1)`, [ev])).toEqual(['Pomerol']);
  });

  it('3. un contact membre d’un groupe voit uniquement les bouteilles partagées dans ce groupe', async () => {
    const morgon = await wine(bruno, 'Morgon', { visibility: 'friends' });
    const pomerol = await wine(bruno, 'Pomerol', { visibility: 'friends' });
    await wine(bruno, 'Chablis', { visibility: 'friends' });
    const famille = await group(bruno, [marc]);
    const autre = await group(bruno, [claire]);
    await share(bruno, morgon.lotId, famille);
    await share(bruno, pomerol.lotId, autre);
    expect(await names(marc, `select name from group_lots($1)`, [famille])).toEqual(['Morgon']);
    expect(await as(db, marc, `select * from group_lots($1)`, [autre])).toEqual([]);
    expect(await cellarOf(marc)).toEqual([]);
    expect(await canRead(marc, photo(bruno, 'Morgon'))).toBe(true);
    expect(await canRead(marc, photo(bruno, 'Pomerol'))).toBe(false);
    expect(await canRead(marc, photo(bruno, 'Chablis'))).toBe(false);
  });
});

describe('ouvrir et fermer sa cave', () => {
  it('4. l’accès est à sens unique : Bruno ouvre sa cave à Marc, Marc ne lui ouvre pas la sienne', async () => {
    await wine(bruno, 'Morgon', { visibility: 'friends' });
    await wine(marc, 'Chinon', { visibility: 'friends' });
    await grant(bruno, marc);
    expect(await cellarOf(marc)).toEqual(['Morgon']);
    expect(await cellarOf(bruno, marc)).toEqual([]);
    expect(await access(marc, bruno)).toEqual({ connected: true, sees: true });
    expect(await access(bruno, marc)).toEqual({ connected: true, sees: false });
    expect(await relation(bruno, marc)).toMatchObject({ they_see_mine: true, i_see_theirs: false, visible_lots: 1, visible_bottles: 6 });
    expect(await relation(marc, bruno)).toMatchObject({ they_see_mine: false, i_see_theirs: true, shared_with_me: 1 });
    // Marc est prévenu une seule fois, même si Bruno rouvre sa cave.
    await grant(bruno, marc);
    expect(await as(db, marc, `select kind, actor_name from notifications where kind = 'cellar_opened'`)).toEqual([
      { kind: 'cellar_opened', actor_name: 'Bruno' },
    ]);
    // Seulement à une relation.
    await expectError(grant(bruno, sam), /not_connected/);
  });

  it('5. fermer l’accès le retire aussitôt ; la relation, les groupes et les événements restent', async () => {
    await wine(bruno, 'Morgon', { visibility: 'friends' });
    const pomerol = await wine(bruno, 'Pomerol', { visibility: 'private' });
    await grant(bruno, marc);
    const g = await group(bruno, [marc]);
    await share(bruno, pomerol.lotId, g);
    const ev = await event(bruno, [marc]);
    await propose(bruno, ev, pomerol.lotId);
    expect(await cellarOf(marc)).toEqual(['Morgon']);
    await one(db, bruno, `select revoke_cellar_access($1)`, [marc]);
    expect(await cellarOf(marc)).toEqual([]);
    expect(await access(marc, bruno)).toEqual({ connected: true, sees: false });
    expect(await names(marc, `select name from group_lots($1)`, [g])).toEqual(['Pomerol']);
    expect(await names(marc, `select wine_name as name from event_wines where event_id = $1`, [ev])).toEqual(['Pomerol']);
    // Marc reste invitable.
    await event(bruno, [marc], { title: 'Apéro' });
    expect(await names(marc, `select title as name from events`)).toEqual(['Apéro', 'Dîner']);
  });

  it('6. migration : chaque amitié existante donne l’accès dans les deux sens (aucune régression)', async () => {
    const NEW = '20261026000001_contacts_acces_cave.sql';
    const old: Db = new PGlite();
    await old.exec(SUPABASE_SHIM_SQL);
    for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql') && f < NEW).sort()) {
      await old.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
    }
    const anne = await createUser(old, 'Anne');
    const basile = await createUser(old, 'Basile');
    const chloe = await createUser(old, 'Chloé');
    const inv = await one<{ r: { code: string } }>(old, anne, `select create_friend_invite() as r`);
    await one(old, basile, `select respond_friend_invite($1, true)`, [inv.r.code]);
    await addWine(old, anne, { name: 'Morgon' }, { visibility: 'friends' });
    await addWine(old, basile, { name: 'Chinon' }, { visibility: 'friends' });
    await addWine(old, chloe, { name: 'Bandol' }, { visibility: 'friends' });
    const seen = async (who: string) => (await as<{ name: string }>(old, who, `select name from shared_lots(null)`)).map((r) => r.name);
    const before = [await seen(anne), await seen(basile), await seen(chloe)];
    expect(before).toEqual([['Chinon'], ['Morgon'], []]);
    // La mise à jour, deux fois (rejouable sans danger).
    const sql = readFileSync(join(MIGRATIONS_DIR, NEW), 'utf8');
    await old.exec(sql);
    await old.exec(sql);
    expect([await seen(anne), await seen(basile), await seen(chloe)]).toEqual(before);
    expect((await old.query(`select owner_id, viewer_id from cellar_access`)).rows).toHaveLength(2);
    // Le lien déjà utilisé : une utilisation enregistrée, rien de plus.
    expect((await old.query<{ uses: number; kind: string }>(`select uses, kind from friend_invites`)).rows).toEqual([{ uses: 1, kind: 'friend' }]);
    expect((await old.query(`select * from invite_redemptions`)).rows).toHaveLength(1);
    expect((await one<{ r: { status: string } }>(old, basile, `select friend_invite_info($1) as r`, [inv.r.code])).r.status).toBe('accepted');
    await old.close();
  });

  it('18. « Fermer ma cave à tout le monde » ne touche ni aux groupes, ni aux événements, ni aux relations', async () => {
    await wine(bruno, 'Morgon', { visibility: 'friends' });
    await wine(claire, 'Chinon', { visibility: 'friends' });
    await grant(bruno, marc);
    const g = await group(bruno, [claire, marc]);
    const ev = await event(bruno, [claire, marc]);
    expect((await one<{ n: number }>(db, bruno, `select close_my_cellar_to_everyone() as n`)).n).toBe(3);
    expect(await as(db, bruno, `select * from cellar_access`)).toEqual([]);
    for (const who of [claire, lea, marc]) expect(await cellarOf(who)).toEqual([]);
    // La cave de Claire reste ouverte à Bruno : seule la sienne est fermée.
    expect(await cellarOf(bruno)).toEqual(['Chinon']);
    expect(await as(db, bruno, `select * from friendships`)).toHaveLength(3);
    expect(await as(db, bruno, `select user_id from group_members where group_id = $1 and status = 'active'`, [g])).toHaveLength(3);
    expect(await as(db, bruno, `select user_id from event_participants where event_id = $1`, [ev])).toHaveLength(3);
  });

  it('« Retirer de mes amis » ferme les deux caves et garde la relation ; « Supprimer le contact » retire tout', async () => {
    await one(db, bruno, `select unfriend($1)`, [claire]);
    expect(await access(bruno, claire)).toEqual({ connected: true, sees: false });
    expect(await access(claire, bruno)).toEqual({ connected: true, sees: false });
    const { lotId } = await wine(bruno, 'Morgon', { visibility: 'friends' });
    await exception(bruno, lea, lotId, 'hide');
    await one(db, bruno, `select remove_friend($1)`, [lea]);
    expect(await access(bruno, lea)).toEqual({ connected: false, sees: false });
    expect(await access(lea, bruno)).toEqual({ connected: false, sees: false });
    expect((await db.query(`select * from cellar_access_exceptions where viewer_id = $1`, [lea])).rows).toEqual([]);
  });
});

describe('liens d’invitation', () => {
  it('7. lien « découvrir » : 10 utilisations au plus, expiration, révocation ; un même compte ne compte qu’une fois', async () => {
    await wine(bruno, 'Morgon', { visibility: 'friends' });
    const link = await invite(bruno, 'discovery');
    expect(link.max_uses).toBe(10);
    const people: string[] = [];
    for (let i = 0; i < 10; i += 1) people.push(await createUser(db, `Invité ${i}`));
    for (const [i, p] of people.entries()) {
      expect((await redeem(p, link.code)).status).toBe('accepted');
      // Double clic : même réponse, aucune utilisation de plus.
      if (i === 0) expect((await redeem(p, link.code)).status).toBe('accepted');
    }
    expect(await one(db, bruno, `select uses, status from friend_invites where id = $1`, [link.id])).toEqual({ uses: 10, status: 'accepted' });
    expect(await as(db, bruno, `select user_id from invite_redemptions where invite_id = $1`, [link.id])).toHaveLength(10);
    await expectError(redeem(await createUser(db, 'Onzième'), link.code), /invite_used/);
    // Une relation, rien de plus.
    expect(await access(people[3], bruno)).toEqual({ connected: true, sees: false });
    expect(await cellarOf(people[3])).toEqual([]);
    expect(await as(db, bruno, `select kind from notifications where kind = 'invite_joined' and ref_id = $1`, [link.id])).toHaveLength(10);
    // Expiration.
    const late = await invite(bruno, 'discovery');
    await db.query(`update friend_invites set expires_at = now() - interval '1 minute' where id = $1`, [late.id]);
    expect((await info(null, late.code)).status).toBe('expired');
    await expectError(redeem(sam, late.code), /invite_expired/);
    // Révocation : la personne qui l'a déjà utilisé garde sa relation, personne d'autre ne peut plus s'en servir.
    const revoked = await invite(bruno, 'discovery');
    await redeem(sam, revoked.code);
    await one(db, bruno, `select revoke_friend_invite($1)`, [revoked.id]);
    expect((await info(null, revoked.code)).status).toBe('revoked');
    await expectError(redeem(await createUser(db, 'Trop tard'), revoked.code), /invite_revoked/);
    expect((await redeem(sam, revoked.code)).status).toBe('accepted');
    expect(await access(sam, bruno)).toEqual({ connected: true, sees: false });
  });

  it('lien « ami » : la cave de l’inviteur seulement ; l’invité peut ouvrir la sienne en retour', async () => {
    await wine(bruno, 'Morgon', { visibility: 'friends' });
    const nina = await createUser(db, 'Nina');
    await wine(nina, 'Gigondas', { visibility: 'friends' });
    const link = await invite(bruno, 'friend');
    expect(link.max_uses).toBe(1);
    expect(await redeem(nina, link.code)).toMatchObject({ status: 'accepted', kind: 'friend', friend_name: 'Bruno' });
    expect(await cellarOf(nina)).toEqual(['Morgon']);
    expect(await cellarOf(bruno, nina)).toEqual([]);
    await expectError(redeem(sam, link.code), /invite_used/);
    // « Ouvrir aussi votre cave à Bruno ? »
    await grant(nina, bruno);
    expect(await cellarOf(bruno, nina)).toEqual(['Gigondas']);
    expect((await as<{ kind: string }>(db, bruno, `select kind from notifications where actor_id = $1`, [nina])).map((n) => n.kind).sort()).toEqual([
      'cellar_opened',
      'invite_joined',
    ]);
  });

  it('8. liens groupe et événement : rôles autorisés seulement, arrivée sur la cible, 50 membres au plus', async () => {
    const g = await group(bruno, [claire]);
    await expectError(invite(claire, 'group', g), /forbidden/);
    await expectError(invite(sam, 'group', g), /forbidden/);
    await one(db, bruno, `select set_member_role($1, $2, 'manager')`, [g, claire]);
    expect((await invite(claire, 'group', g)).max_uses).toBe(20);
    // Une personne sans compte s'inscrit, puis utilise le lien : membre du groupe, en relation, sans cave ouverte.
    const link = await invite(bruno, 'group', g);
    const nina = await createUser(db, 'Nina');
    expect(await redeem(nina, link.code)).toMatchObject({ status: 'accepted', kind: 'group', target_id: g });
    expect(await one(db, nina, `select status, role from group_members where group_id = $1 and user_id = $2`, [g, nina])).toEqual({
      status: 'active',
      role: 'member',
    });
    expect(await access(nina, bruno)).toEqual({ connected: true, sees: false });
    expect(await as(db, bruno, `select actor_name from notifications where kind = 'group_joined' and actor_id = $1`, [nina])).toEqual([
      { actor_name: 'Nina' },
    ]);
    expect(await as(db, nina, `select actor_name, target_name from group_activity where kind = 'joined' order by created_at`)).toEqual([
      { actor_name: 'Claire', target_name: 'Claire' },
      { actor_name: 'Nina', target_name: 'Nina' },
    ]);

    const ev = await event(bruno, [claire]);
    await expectError(invite(claire, 'event', ev), /forbidden/);
    const evLink = await invite(bruno, 'event', ev);
    const olga = await createUser(db, 'Olga');
    expect(await redeem(olga, evLink.code)).toMatchObject({ status: 'accepted', kind: 'event', target_id: ev });
    expect(await names(olga, `select title as name from events`)).toEqual(['Dîner']);
    expect(await one(db, olga, `select role, rsvp from event_participants where user_id = $1`, [olga])).toEqual({ role: 'guest', rsvp: 'pending' });
    expect(await as(db, olga, `select kind from notifications where read_at is null`)).toEqual([]);
    await redeem(olga, evLink.code);
    expect(await one(db, bruno, `select uses from friend_invites where id = $1`, [evLink.id])).toEqual({ uses: 1 });
    // Le lien d'un événement expire à sa date.
    expect(await one(db, bruno, `select expires_at = starts_at as ok from friend_invites, events where friend_invites.id = $1 and events.id = $2`, [evLink.id, ev])).toEqual({ ok: true });

    // 50 membres au plus, invitations comprises.
    const count = Number((await db.query<{ n: number }>(`select count(*)::int as n from group_members where group_id = $1`, [g])).rows[0].n);
    for (let i = count; i < 50; i += 1) {
      const u = await createUser(db, `Membre ${i}`);
      await db.query(`insert into group_members (group_id, user_id, status) values ($1, $2, 'active')`, [g, u]);
    }
    await expectError(redeem(await createUser(db, 'Cinquante et un'), link.code), /group_full/);
  });

  it('9. la page du lien, sans compte, ne montre que le prénom, le type, le titre et la date', async () => {
    await db.query(`update profiles set display_name = 'Bruno Martin' where id = $1`, [bruno]);
    const morgon = await wine(bruno, 'Morgon', { visibility: 'friends' });
    const ev = await event(bruno, [claire], { place: '12 rue des Vignes', description: 'Digicode 1234' });
    await propose(bruno, ev, morgon.lotId);
    const evLink = await invite(bruno, 'event', ev);
    const r = await info(null, evLink.code);
    expect(Object.keys(r).sort()).toEqual(['inviter_name', 'kind', 'status', 'target_date', 'target_label']);
    expect(r).toMatchObject({ inviter_name: 'Bruno', kind: 'event', status: 'pending', target_label: 'Dîner' });
    expect(new Date(r.target_date as string).toISOString()).toBe('2030-01-10T19:00:00.000Z');
    expect(JSON.stringify(r)).not.toMatch(/Martin|rue|Digicode|Claire|Morgon/);
    const g = await group(bruno, [claire]);
    expect(await info(null, (await invite(bruno, 'group', g)).code)).toEqual({
      inviter_name: 'Bruno', kind: 'group', status: 'pending', target_label: 'Famille', target_date: null,
    });
    // Lien révoqué : plus de titre.
    await one(db, bruno, `select revoke_friend_invite($1)`, [evLink.id]);
    expect(await info(null, evLink.code)).toMatchObject({ status: 'revoked', target_label: null, target_date: null });
    // Sans compte, rien d'autre n'est accessible.
    await expectError(as(db, null, `select respond_friend_invite($1, true)`, [evLink.code]), /permission denied/);
    await expectError(as(db, null, `select create_invite('discovery')`), /permission denied/);
    await expectError(as(db, null, `select * from friend_invites`), /permission denied/);
    await expectError(as(db, null, `select * from preview_my_cellar_as($1)`, [claire]), /permission denied/);
  });
});

describe('blocage et demandes d’accès', () => {
  it('10. bloquer supprime la relation, les accès dans les deux sens et les demandes ; plus aucun lien ni demande', async () => {
    const { lotId } = await wine(bruno, 'Morgon', { visibility: 'friends' });
    await exception(bruno, claire, lotId, 'hide');
    const pending = await ask(marc, bruno);
    await one(db, bruno, `select block_user($1)`, [claire]);
    await one(db, bruno, `select block_user($1)`, [marc]);
    const between = (a: string, b: string, table: string) =>
      db.query(`select * from ${table} where $1 in (owner_id, viewer_id) and $2 in (owner_id, viewer_id)`, [a, b]).then((r) => r.rows);
    expect(await between(bruno, claire, 'cellar_access')).toEqual([]);
    expect(await between(bruno, claire, 'cellar_access_exceptions')).toEqual([]);
    expect(await access(bruno, claire)).toEqual({ connected: false, sees: false });
    expect(await cellarOf(claire)).toEqual([]);
    expect((await db.query(`select status from cellar_access_requests where id = $1`, [pending.id])).rows).toEqual([{ status: 'cancelled' }]);
    // Plus rien n'est possible entre eux, dans un sens comme dans l'autre.
    await expectError(redeem(claire, (await invite(bruno, 'friend')).code), /invite_invalid/);
    await expectError(redeem(bruno, (await invite(marc, 'discovery')).code), /invite_invalid/);
    await expectError(ask(marc, bruno), /not_connected/);
    await expectError(one(db, claire, `select send_friend_request($1)`, [bruno]), /not_found/);
    await expectError(grant(bruno, claire), /not_connected/);
    await expectError(exception(bruno, claire, lotId, 'show'), /not_connected/);
    // Léa n'est pas concernée.
    expect(await cellarOf(lea)).toEqual(['Morgon']);
  });

  it('12. demandes d’accès : une seule en attente, 30 jours après un refus, 20 par jour au plus', async () => {
    await wine(bruno, 'Morgon', { visibility: 'friends' });
    const first = await ask(marc, bruno);
    expect(first.status).toBe('requested');
    expect((await ask(marc, bruno)).id).toBe(first.id);
    expect(await as(db, bruno, `select actor_name from notifications where kind = 'cellar_access_request'`)).toEqual([{ actor_name: 'Marc' }]);
    await one(db, bruno, `select respond_cellar_access_request($1, false)`, [first.id]);
    await expectError(ask(marc, bruno), /request_cooldown/);
    expect(await cellarOf(marc)).toEqual([]);
    // Un mois plus tard, une nouvelle demande est possible ; acceptée, elle ouvre la cave.
    await db.query(`update cellar_access_requests set responded_at = now() - interval '31 days' where id = $1`, [first.id]);
    const second = await ask(marc, bruno);
    expect(second.id).not.toBe(first.id);
    await one(db, bruno, `select respond_cellar_access_request($1, true)`, [second.id]);
    expect(await cellarOf(marc)).toEqual(['Morgon']);
    expect(await as(db, marc, `select actor_name from notifications where kind = 'cellar_opened'`)).toEqual([{ actor_name: 'Bruno' }]);
    expect((await ask(marc, bruno)).status).toBe('already_open');
    // Seulement entre personnes en relation.
    await expectError(ask(sam, bruno), /not_connected/);
    // Annuler sa demande retire la notification.
    const third = await ask(bruno, marc);
    await one(db, bruno, `select cancel_cellar_access_request($1)`, [third.id]);
    expect(await as(db, marc, `select * from notifications where kind = 'cellar_access_request'`)).toEqual([]);
    // 20 demandes par jour au plus.
    const others: string[] = [];
    for (let i = 0; i < 21; i += 1) {
      const u = await createUser(db, `Voisin ${i}`);
      await db.query(`insert into friendships (user_a, user_b) values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid))`, [sam, u]);
      others.push(u);
    }
    for (const u of others.slice(0, 20)) await ask(sam, u);
    await expectError(ask(sam, others[20]), /too_many_requests/);
  });

  it('demande depuis la recherche : une relation, et la cave de la personne qui demande seulement si elle l’a choisi', async () => {
    await as(db, sam, `update profiles set discoverable = true where id = $1`, [sam]);
    await as(db, marc, `update profiles set discoverable = true where id = $1`, [marc]);
    await wine(bruno, 'Morgon', { visibility: 'friends' });
    await wine(sam, 'Bandol', { visibility: 'friends' });
    const req = await one<{ r: { id: string } }>(db, bruno, `select send_friend_request($1, true) as r`, [sam]);
    expect(await as(db, sam, `select direction, open_cellar from my_friend_requests()`)).toEqual([{ direction: 'in', open_cellar: true }]);
    await one(db, sam, `select respond_friend_request($1, true)`, [req.r.id]);
    expect(await cellarOf(sam)).toEqual(['Morgon']);
    expect(await cellarOf(bruno, sam)).toEqual([]);
    // Dans la recherche : « ami » dès qu'une cave est ouverte, « contact » sinon.
    expect(await as(db, bruno, `select display_name, relation from search_users('Sam')`)).toEqual([{ display_name: 'Sam', relation: 'friend' }]);
    expect(await as(db, bruno, `select display_name, relation from search_users('Marc')`)).toEqual([{ display_name: 'Marc', relation: 'contact' }]);
  });
});

describe('ce que X voit de moi', () => {
  it('11. preview_my_cellar_as ne renvoie jamais les lots d’une autre personne', async () => {
    await wine(bruno, 'Morgon', { visibility: 'friends' });
    const chinon = await wine(claire, 'Chinon', { visibility: 'friends' });
    const g = await group(bruno, [claire, marc]);
    await share(claire, chinon.lotId, g);
    const mine = (await db.query<{ id: string }>(`select id from lots where owner_id = $1`, [bruno])).rows.map((r) => r.id);
    const rows = [...(await preview(bruno, claire)), ...(await preview(bruno, marc)), ...(await preview(bruno, lea))];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(mine).toContain(r.lot_id);
    expect((await preview(bruno, claire)).map((r) => r.name)).toEqual(['Morgon']);
    expect(await preview(bruno, marc)).toEqual([]);
    // Marc, même dans un groupe avec Claire, ne voit en aperçu que ses propres lots (aucun).
    expect(await preview(marc, claire)).toEqual([]);
    expect(await preview(bruno, bruno)).toEqual([]);
    // Les règles internes ne sont pas appelables directement.
    await expectError(as(db, marc, `select * from cellar_view($1, $2)`, [claire, bruno]), /permission denied/);
    await expectError(as(db, marc, `select * from group_view($1, $2)`, [g, claire]), /permission denied/);
    await expectError(as(db, marc, `select cellar_open_to($1, $2)`, [bruno, claire]), /permission denied/);
  });

  it('13. exception « masquer » : X ne voit plus ce lot, les autres amis le voient toujours', async () => {
    const morgon = await wine(bruno, 'Morgon', { visibility: 'event' });
    await wine(bruno, 'Pomerol', { visibility: 'friends' });
    await exception(bruno, claire, morgon.lotId, 'hide');
    expect(await cellarOf(claire)).toEqual(['Pomerol']);
    expect(await cellarOf(lea)).toEqual(['Morgon', 'Pomerol']);
    expect(await canRead(claire, photo(bruno, 'Morgon'))).toBe(false);
    expect(await canRead(lea, photo(bruno, 'Morgon'))).toBe(true);
    const ev = await event(bruno, [claire, lea]);
    expect(await as(db, claire, `select * from event_suggestable_lots($1)`, [ev])).toEqual([]);
    expect(await names(lea, `select name from event_suggestable_lots($1)`, [ev])).toEqual(['Morgon']);
    await expectError(propose(claire, ev, morgon.lotId), /not_proposable/);
    const g = await group(bruno, [claire, lea]);
    expect(await as(db, claire, `select * from group_lots($1)`, [g])).toEqual([]);
    // Compteurs.
    expect(await relation(bruno, claire)).toMatchObject({ exceptions: 1, visible_lots: 1 });
    expect(await relation(bruno, lea)).toMatchObject({ exceptions: 0, visible_lots: 2 });
    expect(await relation(claire, bruno)).toMatchObject({ shared_with_me: 1 });
    expect((await preview(bruno, claire)).map((r) => r.name)).toEqual(['Pomerol']);
    // Un partage explicite dans un groupe reste visible : l'exception ne concerne que la cave.
    await share(bruno, morgon.lotId, g);
    expect(await names(claire, `select name from group_lots($1)`, [g])).toEqual(['Morgon']);
    // Exception retirée : tout redevient comme avant.
    await exception(bruno, claire, morgon.lotId, null);
    expect(await cellarOf(claire)).toEqual(['Morgon', 'Pomerol']);
  });

  it('14. exception « montrer » : seul X voit ce lot privé, et seulement si la cave lui est ouverte', async () => {
    const yquem = await wine(bruno, 'Yquem', { visibility: 'private' });
    await exception(bruno, claire, yquem.lotId, 'show');
    await exception(bruno, marc, yquem.lotId, 'show');
    expect(await cellarOf(claire)).toEqual(['Yquem']);
    expect(await cellarOf(lea)).toEqual([]);
    expect(await cellarOf(marc)).toEqual([]);
    expect(await canRead(claire, photo(bruno, 'Yquem'))).toBe(true);
    expect(await canRead(lea, photo(bruno, 'Yquem'))).toBe(false);
    expect(await canRead(marc, photo(bruno, 'Yquem'))).toBe(false);
    expect((await preview(bruno, claire)).map((r) => [r.name, r.origin])).toEqual([['Yquem', 'exception']]);
    await grant(bruno, marc);
    expect(await cellarOf(marc)).toEqual(['Yquem']);
    await one(db, bruno, `select revoke_cellar_access($1)`, [claire]);
    expect(await cellarOf(claire)).toEqual([]);
    await expectError(exception(bruno, sam, yquem.lotId, 'show'), /not_connected/);
  });

  it('15. niveau « Restreint » : prix, quantités exactes et notes masqués pour X', async () => {
    const lot = { visibility: 'friends', hide_price: false, hide_quantity: false, hide_notes: false, purchase_price: 45, notes: 'Superbe' };
    const margaux = await wine(bruno, 'Margaux', lot);
    await one(db, bruno, `select set_cellar_detail_level($1, 'restricted')`, [claire]);
    const seen = (who: string) =>
      one<Seen>(db, who, `select quantity, available, purchase_price, notes, hide_price, hide_quantity, hide_notes from shared_lots($1)`, [bruno]);
    expect(await seen(lea)).toMatchObject({ quantity: 6, available: 6, notes: 'Superbe', hide_price: false, hide_quantity: false, hide_notes: false });
    expect(Number((await seen(lea)).purchase_price)).toBe(45);
    expect(await seen(claire)).toEqual({
      quantity: null, available: null, purchase_price: null, notes: null, hide_price: true, hide_quantity: true, hide_notes: true,
    });
    expect(await preview(bruno, claire)).toMatchObject([{ name: 'Margaux', quantity: null, purchase_price: null, notes: null }]);
    expect(await relation(bruno, claire)).toMatchObject({ detail_level: 'restricted' });
    // Un partage dans un groupe garde les réglages du lot.
    const g = await group(bruno, [claire]);
    await share(bruno, margaux.lotId, g);
    expect(await one(db, claire, `select quantity, notes from group_lots($1)`, [g])).toEqual({ quantity: 6, notes: 'Superbe' });
    // Retour au niveau standard ; seulement pour une personne à qui la cave est ouverte.
    await one(db, bruno, `select set_cellar_detail_level($1, 'standard')`, [claire]);
    expect((await seen(claire)).quantity).toBe(6);
    await expectError(one(db, bruno, `select set_cellar_detail_level($1, 'restricted')`, [marc]), /not_found/);
    await expectError(one(db, bruno, `select set_cellar_detail_level($1, 'secret')`, [claire]), /invalid/);
  });

  it('16. personne ne lit ni n’écrit les exceptions ou le niveau de détail d’un autre propriétaire', async () => {
    const { lotId } = await wine(bruno, 'Morgon', { visibility: 'friends' });
    await exception(bruno, claire, lotId, 'hide');
    await one(db, bruno, `select set_cellar_detail_level($1, 'restricted')`, [claire]);
    expect(await as(db, claire, `select * from cellar_access_exceptions`)).toEqual([]);
    expect(await as(db, claire, `select * from cellar_access where owner_id = $1`, [bruno])).toEqual([]);
    // Dans ses relations, Claire ne voit que ses propres réglages pour Bruno.
    expect(await relation(claire, bruno)).toMatchObject({ exceptions: 0, detail_level: 'standard' });
    await expectError(as(db, claire, `delete from cellar_access_exceptions`), /permission denied/);
    await expectError(as(db, claire, `update cellar_access set detail_level = 'standard'`), /permission denied/);
    await expectError(as(db, claire, `insert into cellar_access (owner_id, viewer_id) values ($1, $2)`, [lea, claire]), /permission denied/);
    await expectError(
      as(db, claire, `insert into cellar_access_exceptions (owner_id, viewer_id, lot_id, mode) values ($1, $2, $3, 'show')`, [bruno, claire, lotId]),
      /permission denied/,
    );
    await expectError(exception(claire, claire, lotId, null), /not_found/);
    await expectError(exception(claire, lea, lotId, 'show'), /not_found/);
    // Claire ne règle que sa propre cave : le niveau choisi par Bruno pour elle ne change pas.
    await one(db, claire, `select set_cellar_detail_level($1, 'standard')`, [bruno]);
    expect((await db.query(`select detail_level from cellar_access where owner_id = $1 and viewer_id = $2`, [bruno, claire])).rows).toEqual([
      { detail_level: 'restricted' },
    ]);
    expect(await cellarOf(claire)).toEqual([]);
  });

  it('17. cohérence : l’aperçu de Bruno est exactement ce que chacun lit en étant connecté', async () => {
    const morgon = await wine(bruno, 'Morgon', { visibility: 'friends', hide_price: false, purchase_price: 12 });
    await wine(bruno, 'Pomerol', { visibility: 'event', hide_quantity: true, hide_notes: false, notes: 'Pour Noël' });
    const yquem = await wine(bruno, 'Yquem', { visibility: 'private' });
    const chablis = await wine(bruno, 'Chablis', { visibility: 'friends', hide_price: false, hide_notes: false, purchase_price: 30, notes: 'Frais' });
    await wine(bruno, 'Cahors', { visibility: 'private' });
    await wine(claire, 'Chinon', { visibility: 'friends' });
    await exception(bruno, lea, yquem.lotId, 'show');
    await exception(bruno, claire, morgon.lotId, 'hide');
    await one(db, bruno, `select set_cellar_detail_level($1, 'restricted')`, [lea]);
    const g = await group(bruno, [claire, marc]);
    await share(bruno, chablis.lotId, g);
    const ev = await event(bruno, [marc, lea]);
    await propose(bruno, ev, yquem.lotId);
    const keys = ['lot_id', 'name', 'quantity', 'available', 'in_stock', 'purchase_price', 'currency', 'notes', 'hide_price', 'hide_quantity', 'hide_notes'] as const;
    const norm = (rows: Seen[]) =>
      rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k]]))).sort((a, b) => String(a.lot_id).localeCompare(String(b.lot_id)));
    for (const viewer of [claire, lea, marc, sam]) {
      const prev = await preview(bruno, viewer);
      // Ma cave.
      const cellar = await as<Seen>(db, viewer, `select * from shared_lots($1)`, [bruno]);
      expect(norm(prev.filter((r) => r.origin !== 'group' && r.origin !== 'event'))).toEqual(norm(cellar));
      // Nos groupes.
      const groups = await as<{ group_id: string }>(db, viewer, `select group_id from group_members where user_id = $1 and status = 'active'`, [viewer]);
      for (const { group_id } of groups) {
        const lots = await as<Seen & { owner_id: string }>(db, viewer, `select * from group_lots($1) where owner_id = $2`, [group_id, bruno]);
        expect(norm(prev.filter((r) => r.origin === 'group' && r.origin_id === group_id))).toEqual(norm(lots));
      }
      expect(prev.filter((r) => r.origin === 'group' && !groups.some((x) => x.group_id === r.origin_id))).toEqual([]);
      // Nos événements.
      const wines = await as<{ lot_id: string; name: string; quantity: number }>(
        db,
        viewer,
        `select lot_id, wine_name as name, quantity from event_wines
         where owner_id = $1 and status in ('proposed', 'confirmed', 'consumed', 'not_consumed')`,
        [bruno],
      );
      expect(prev.filter((r) => r.origin === 'event').map((r) => [r.lot_id, r.name, r.quantity])).toEqual(wines.map((w) => [w.lot_id, w.name, w.quantity]));
    }
    // Quelques résultats attendus, pour s'assurer que les cas sont bien couverts.
    expect((await preview(bruno, claire)).map((r) => `${r.origin}:${r.name}`).sort()).toEqual(['friends:Chablis', 'group:Chablis', 'proposable:Pomerol']);
    expect((await preview(bruno, lea)).map((r) => `${r.origin}:${r.name}`).sort()).toEqual([
      'event:Yquem', 'exception:Yquem', 'friends:Chablis', 'friends:Morgon', 'proposable:Pomerol',
    ]);
    expect((await preview(bruno, marc)).map((r) => `${r.origin}:${r.name}`).sort()).toEqual(['event:Yquem', 'group:Chablis']);
    expect(await preview(bruno, sam)).toEqual([]);
  });
});

describe('préférences', () => {
  it('la section « Bouteilles partagées par mes amis » peut être masquée, par chacun pour soi', async () => {
    expect(await one(db, claire, `select show_shared_wines from profiles where id = $1`, [claire])).toEqual({ show_shared_wines: true });
    await as(db, claire, `update profiles set show_shared_wines = false where id = $1`, [claire]);
    expect(await one(db, claire, `select show_shared_wines from profiles where id = $1`, [claire])).toEqual({ show_shared_wines: false });
    await as(db, claire, `update profiles set show_shared_wines = false where id = $1`, [bruno]);
    expect((await db.query(`select show_shared_wines from profiles where id = $1`, [bruno])).rows).toEqual([{ show_shared_wines: true }]);
  });
});

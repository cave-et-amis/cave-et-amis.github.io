import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, addWine, as, befriend, connect, createDb, createUser, expectError, one, type Db } from '../helpers/db.ts';

let db: Db;
let bruno: string;
let claire: string;
let lea: string;
let marc: string;

// Bruno est ami de Claire et de Léa (caves ouvertes dans les deux sens) ; Marc est un simple contact.
beforeEach(async () => {
  db = await createDb();
  bruno = await createUser(db, 'Bruno');
  claire = await createUser(db, 'Claire');
  lea = await createUser(db, 'Léa');
  marc = await createUser(db, 'Marc');
  await befriend(db, bruno, claire);
  await befriend(db, bruno, lea);
  await connect(db, bruno, marc);
});

const wine = (who: string, name: string, lot: Record<string, unknown> = {}) =>
  addWine(db, who, { name, label_photo: `${who}/${name.toLowerCase()}.jpg` }, lot);
const photo = (who: string, name: string) => `${who}/${name.toLowerCase()}.jpg`;
const names = async (who: string, sql: string, params: unknown[] = []) =>
  (await as<{ name: string }>(db, who, sql, params)).map((r) => r.name).sort();
const cellarOf = (who: string, owner: string | null = null) => names(who, `select name from shared_lots($1)`, [owner]);
const canRead = async (who: string, path: string) => (await one<{ ok: boolean }>(db, who, `select can_read_photo($1) as ok`, [path])).ok;
const options = (who: string, viewer: string, p: Record<string, unknown>) =>
  one<{ r: Record<string, unknown> }>(db, who, `select set_cellar_access_options($1, $2::jsonb) as r`, [viewer, JSON.stringify(p)]).then((x) => x.r);
const show = (who: string, viewer: string, lot: string) => one(db, who, `select set_cellar_exception($1, $2, 'show')`, [viewer, lot]);
const relation = async (who: string, other: string) =>
  (await as<Record<string, unknown>>(db, who, `select * from my_relations() where user_id = $1`, [other]))[0];
const invite = (who: string, kind: string, target: string | null = null, opts: Record<string, unknown> = {}) =>
  one<{ r: { id: string; code: string } }>(db, who, `select create_invite($1, $2, $3::jsonb) as r`, [kind, target, JSON.stringify(opts)]).then((x) => x.r);
const redeem = (who: string, code: string) =>
  one<{ r: { status: string; kind: string } }>(db, who, `select respond_friend_invite($1, true) as r`, [code]).then((x) => x.r);
const preview = (who: string, viewer: string) =>
  as<{ lot_id: string; name: string; origin: string; quantity: number | null; purchase_price: string | null; notes: string | null }>(
    db,
    who,
    `select * from preview_my_cellar_as($1)`,
    [viewer],
  );

describe('accès à une sélection de bouteilles', () => {
  it('seules les bouteilles choisies sont visibles : vues, photos, compteurs, aperçu ; les autres amis gardent la cave partagée', async () => {
    await wine(bruno, 'Morgon', { visibility: 'friends' });
    const pomerol = await wine(bruno, 'Pomerol', { visibility: 'friends' });
    const yquem = await wine(bruno, 'Yquem', { visibility: 'private' });
    expect(await options(bruno, claire, { scope: 'selection' })).toMatchObject({ scope: 'selection' });
    // Rien n'est encore choisi : Claire ne voit rien.
    expect(await cellarOf(claire, bruno)).toEqual([]);
    await show(bruno, claire, pomerol.lotId);
    await show(bruno, claire, yquem.lotId);
    expect(await cellarOf(claire, bruno)).toEqual(['Pomerol', 'Yquem']);
    expect(await canRead(claire, photo(bruno, 'Morgon'))).toBe(false);
    expect(await canRead(claire, photo(bruno, 'Pomerol'))).toBe(true);
    expect((await preview(bruno, claire)).map((r) => `${r.origin}:${r.name}`).sort()).toEqual(['exception:Pomerol', 'exception:Yquem']);
    expect(await relation(bruno, claire)).toMatchObject({ scope: 'selection', visible_lots: 2, they_see_mine: true });
    expect(await relation(claire, bruno)).toMatchObject({ shared_with_me: 2 });
    // Léa garde toute la cave partagée (sans la bouteille privée).
    expect(await cellarOf(lea, bruno)).toEqual(['Morgon', 'Pomerol']);
    // Retour à toute la cave partagée : la bouteille privée montrée à Claire le reste.
    await options(bruno, claire, { scope: 'shared' });
    expect(await cellarOf(claire, bruno)).toEqual(['Morgon', 'Pomerol', 'Yquem']);
  });

  it('l’aperçu reste identique à ce que la personne lit (sélection, niveau Restreint)', async () => {
    const pomerol = await wine(bruno, 'Pomerol', { visibility: 'friends', hide_price: false, hide_notes: false, purchase_price: 40, notes: 'Grand' });
    await wine(bruno, 'Morgon', { visibility: 'friends', hide_price: false, purchase_price: 12 });
    await options(bruno, claire, { scope: 'selection', detail_level: 'restricted' });
    await show(bruno, claire, pomerol.lotId);
    const seen = await as<{ lot_id: string; quantity: number | null; purchase_price: string | null; notes: string | null }>(
      db,
      claire,
      `select lot_id, quantity, purchase_price, notes from shared_lots($1)`,
      [bruno],
    );
    const prev = (await preview(bruno, claire)).map((r) => ({ lot_id: r.lot_id, quantity: r.quantity, purchase_price: r.purchase_price, notes: r.notes }));
    expect(prev).toEqual(seen);
    expect(seen).toEqual([{ lot_id: pomerol.lotId, quantity: null, purchase_price: null, notes: null }]);
  });
});

describe('accès à durée limitée', () => {
  it('arrivé à échéance, il ne montre plus rien ; rouvrir la cave le rend permanent', async () => {
    await wine(bruno, 'Morgon', { visibility: 'friends' });
    const soon = new Date(Date.now() + 3600_000).toISOString();
    expect(await options(bruno, claire, { expires_at: soon })).toMatchObject({ scope: 'shared' });
    expect(await cellarOf(claire, bruno)).toEqual(['Morgon']);
    // Une date passée est refusée.
    await expectError(options(bruno, claire, { expires_at: '2020-01-01T00:00:00Z' }), /invalid/);
    // L'échéance arrive.
    await db.query(`update cellar_access set expires_at = now() - interval '1 minute' where owner_id = $1 and viewer_id = $2`, [bruno, claire]);
    expect(await cellarOf(claire, bruno)).toEqual([]);
    expect(await one(db, claire, `select can_see_cellar($1) as s`, [bruno])).toEqual({ s: false });
    expect(await canRead(claire, photo(bruno, 'Morgon'))).toBe(false);
    const rel = await relation(bruno, claire);
    expect(rel).toMatchObject({ they_see_mine: false, visible_lots: 0 });
    expect(rel.access_expires_at).not.toBeNull();
    expect(await relation(claire, bruno)).toMatchObject({ i_see_theirs: false });
    // Bruno rouvre sa cave : sans date de fin, et Claire est prévenue.
    await one(db, bruno, `select grant_cellar_access($1)`, [claire]);
    expect(await cellarOf(claire, bruno)).toEqual(['Morgon']);
    expect(await relation(bruno, claire)).toMatchObject({ they_see_mine: true, access_expires_at: null });
    // (La première ouverture venait du lien d'invitation, qui prévient l'inverse : « a rejoint grâce à votre invitation ».)
    expect((await as(db, claire, `select 1 from notifications where kind = 'cellar_opened' and actor_id = $1`, [bruno])).length).toBe(1);
  });

  it('seul le propriétaire règle l’accès qu’il a ouvert', async () => {
    await wine(bruno, 'Morgon', { visibility: 'friends' });
    // Claire ne règle que l'accès qu'elle a ouvert, elle (à Bruno) : celui de Bruno ne change pas.
    await options(claire, bruno, { scope: 'selection' });
    expect(await cellarOf(claire, bruno)).toEqual(['Morgon']);
    await expectError(options(claire, lea, { scope: 'selection' }), /not_found/);
    await expectError(options(bruno, marc, { scope: 'selection' }), /not_found/);
    await expectError(options(bruno, claire, { scope: 'tout' }), /invalid/);
    await expectError(as(db, claire, `update cellar_access set scope = 'shared', expires_at = null`), /permission denied/);
  });
});

describe('liens d’invitation', () => {
  it('lien « voir ma cave » : sélection (seulement mes bouteilles), niveau Restreint et date de fin appliqués à l’arrivée', async () => {
    await wine(bruno, 'Morgon', { visibility: 'friends' });
    const pomerol = await wine(bruno, 'Pomerol', { visibility: 'private', hide_price: false, purchase_price: 40 });
    const chinon = await wine(claire, 'Chinon', { visibility: 'friends' });
    const until = new Date(Date.now() + 7 * 86400_000).toISOString();
    const link = await invite(bruno, 'friend', null, {
      scope: 'selection',
      lots: [pomerol.lotId, chinon.lotId, 'pas-un-identifiant'],
      detail_level: 'restricted',
      access_expires_at: until,
      note: 'Pour Nina',
    });
    // Seul le lot de Bruno est gardé.
    expect(await one(db, bruno, `select note, options -> 'lots' as lots from friend_invites where id = $1`, [link.id])).toEqual({
      note: 'Pour Nina',
      lots: [pomerol.lotId],
    });
    expect(await one<{ r: Record<string, unknown> }>(db, null, `select friend_invite_info($1) as r`, [link.code]).then((x) => x.r)).toMatchObject({
      kind: 'friend',
      selection: true,
    });
    const nina = await createUser(db, 'Nina');
    expect(await redeem(nina, link.code)).toMatchObject({ status: 'accepted', kind: 'friend' });
    expect(await cellarOf(nina, bruno)).toEqual(['Pomerol']);
    expect(await one(db, nina, `select purchase_price, quantity from shared_lots($1)`, [bruno])).toEqual({ purchase_price: null, quantity: null });
    const rel = await relation(bruno, nina);
    expect(rel).toMatchObject({ scope: 'selection', detail_level: 'restricted', visible_lots: 1 });
    expect(new Date(rel.access_expires_at as string).toISOString()).toBe(until);
    // Options non valables.
    await expectError(invite(bruno, 'friend', null, { scope: 'selection', lots: [] }), /invalid/);
    await expectError(invite(bruno, 'friend', null, { scope: 'selection', lots: 'tout' }), /invalid/);
    await expectError(invite(bruno, 'friend', null, { access_expires_at: '2020-01-01T00:00:00Z' }), /invalid/);
    await expectError(invite(bruno, 'friend', null, { detail_level: 'tout' }), /invalid/);
  });

  it('un accès déjà ouvert n’est jamais restreint par un nouveau lien', async () => {
    await wine(bruno, 'Morgon', { visibility: 'friends' });
    const pomerol = await wine(bruno, 'Pomerol', { visibility: 'friends' });
    const link = await invite(bruno, 'friend', null, { scope: 'selection', lots: [pomerol.lotId] });
    await redeem(claire, link.code);
    expect(await cellarOf(claire, bruno)).toEqual(['Morgon', 'Pomerol']);
    expect(await relation(bruno, claire)).toMatchObject({ scope: 'shared' });
  });

  it('le code d’un lien n’est lisible que par son auteur ; Mes invitations : qui a utilisé mes liens', async () => {
    const link = await invite(bruno, 'discovery', null, { note: '  Pour Paul et sa famille, avec un mot bien trop long pour tenir dans la place prévue  ' });
    const mine = await one<{ code: string; note: string }>(db, bruno, `select code, note from friend_invites where id = $1`, [link.id]);
    expect(mine.code).toBe(link.code);
    expect(mine.note.length).toBe(60);
    expect(await as(db, claire, `select code from friend_invites where id = $1`, [link.id])).toEqual([]);
    await expectError(as(db, null, `select code from friend_invites`), /permission denied/);
    const nina = await createUser(db, 'Nina');
    const omar = await createUser(db, 'Omar');
    await redeem(nina, link.code);
    await redeem(omar, link.code);
    const used = await as<{ display_name: string | null }>(db, bruno, `select display_name from my_invite_redemptions() where invite_id = $1`, [link.id]);
    expect(used.map((u) => u.display_name).sort()).toEqual(['Nina', 'Omar']);
    expect(await as(db, claire, `select * from my_invite_redemptions()`)).toEqual([]);
    // Bruno bloque Omar : son nom n'apparaît plus.
    await one(db, bruno, `select block_user($1)`, [omar]);
    const after = await as<{ display_name: string | null }>(db, bruno, `select display_name from my_invite_redemptions() where invite_id = $1`, [link.id]);
    expect(after.map((u) => u.display_name ?? '—').sort()).toEqual(['Nina', '—']);
  });

  it('compatibilité : l’appel à deux paramètres et create_friend_invite fonctionnent toujours', async () => {
    const a = await one<{ r: { code: string; kind: string } }>(db, bruno, `select create_invite('discovery', null) as r`);
    expect(a.r.kind).toBe('discovery');
    const b = await one<{ r: { code: string; kind: string } }>(db, bruno, `select create_friend_invite() as r`);
    expect(b.r.kind).toBe('friend');
    expect(await as(db, bruno, `select kind from friend_invites where code in ($1, $2)`, [a.r.code, b.r.code])).toHaveLength(2);
  });

  it('lien révoqué, expiré, ou dont l’accès a pris fin avant d’être utilisé : refusé', async () => {
    const pomerol = await wine(bruno, 'Pomerol', { visibility: 'friends' });
    const revoked = await invite(bruno, 'discovery');
    await one(db, bruno, `select revoke_friend_invite($1)`, [revoked.id]);
    await expectError(redeem(await createUser(db, 'Nina'), revoked.code), /invite_revoked/);
    const late = await invite(bruno, 'discovery');
    await db.query(`update friend_invites set expires_at = now() - interval '1 minute' where id = $1`, [late.id]);
    await expectError(redeem(await createUser(db, 'Omar'), late.code), /invite_expired/);
    const ending = await invite(bruno, 'friend', null, {
      scope: 'selection',
      lots: [pomerol.lotId],
      access_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    await db.query(`update friend_invites set options = jsonb_set(options, '{access_expires_at}', to_jsonb(now() - interval '1 minute')) where id = $1`, [ending.id]);
    const sam = await createUser(db, 'Sam');
    await expectError(redeem(sam, ending.code), /invite_expired/);
    expect(await cellarOf(sam)).toEqual([]);
  });
});

describe('retour arrière', () => {
  it('le script de retour puis la mise à jour précédente rendent une base qui fonctionne, sans accès élargi', async () => {
    await wine(bruno, 'Morgon', { visibility: 'friends' });
    const pomerol = await wine(bruno, 'Pomerol', { visibility: 'private' });
    await options(bruno, claire, { scope: 'selection' });
    await show(bruno, claire, pomerol.lotId);
    await options(bruno, lea, { expires_at: new Date(Date.now() + 3600_000).toISOString() });
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '..', 'sql', 'retour-20261026000002.sql'), 'utf8'));
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '20261026000001_contacts_acces_cave.sql'), 'utf8'));
    // Les accès limités sont fermés (jamais élargis) ; les autres relations sont intactes.
    expect(await cellarOf(claire, bruno)).toEqual([]);
    expect(await cellarOf(lea, bruno)).toEqual([]);
    expect(await cellarOf(bruno)).toEqual([]);
    expect(await one(db, bruno, `select is_connected($1) as c`, [claire])).toEqual({ c: true });
    // Les anciennes fonctions répondent.
    const link = await one<{ r: { code: string; kind: string } }>(db, bruno, `select create_invite('discovery', null) as r`);
    expect(link.r.kind).toBe('discovery');
    const rel = await relation(bruno, claire);
    expect(rel).toMatchObject({ they_see_mine: false });
    expect(rel).not.toHaveProperty('scope');
    await one(db, bruno, `select grant_cellar_access($1)`, [claire]);
    expect(await cellarOf(claire, bruno)).toEqual(['Morgon', 'Pomerol']);
  });
});

describe('mise à jour rejouée', () => {
  it('exécutée une seconde fois par erreur, elle ne change ni les accès limités, ni les liens, ni les préférences', async () => {
    await wine(bruno, 'Morgon', { visibility: 'friends' });
    const pomerol = await wine(bruno, 'Pomerol', { visibility: 'private' });
    await options(bruno, claire, { scope: 'selection' });
    await show(bruno, claire, pomerol.lotId);
    await options(bruno, lea, { expires_at: new Date(Date.now() + 3600_000).toISOString() });
    const link = await invite(bruno, 'discovery', null, { note: 'Paul' });
    await one(db, bruno, `select merge_preferences('{"tips":["cave"]}'::jsonb)`);
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '20261026000002_accueil_invitations.sql'), 'utf8'));
    expect(await cellarOf(claire, bruno)).toEqual(['Pomerol']);
    expect(await cellarOf(lea, bruno)).toEqual(['Morgon']);
    expect(await relation(bruno, lea)).toMatchObject({ scope: 'shared' });
    expect((await relation(bruno, lea)).access_expires_at).not.toBeNull();
    const mine = await as<{ code: string; note: string }>(db, bruno, `select code, note from friend_invites where id = $1`, [link.id]);
    expect(mine).toEqual([{ code: link.code, note: 'Paul' }]);
    expect(await one(db, bruno, `select preferences -> 'tips' as t from profiles where id = $1`, [bruno])).toEqual({ t: ['cave'] });
  });
});

describe('groupes', () => {
  it('un membre retiré d’un groupe n’en voit plus les bouteilles ni leurs photos', async () => {
    const morgon = await wine(bruno, 'Morgon', { visibility: 'private' });
    const g = (await one<{ id: string }>(db, bruno, `select (create_group('Famille', '🍷', null, null, $1::uuid[])).id`, [[marc]])).id;
    await one(db, marc, `select respond_group_invite($1, true)`, [g]);
    await one(db, bruno, `select share_lot_with_group($1, $2, true)`, [morgon.lotId, g]);
    expect(await names(marc, `select name from group_lots($1)`, [g])).toEqual(['Morgon']);
    expect(await canRead(marc, photo(bruno, 'Morgon'))).toBe(true);
    await one(db, bruno, `select remove_member($1, $2)`, [g, marc]);
    expect(await as(db, marc, `select * from group_lots($1)`, [g])).toEqual([]);
    expect(await canRead(marc, photo(bruno, 'Morgon'))).toBe(false);
    expect(await cellarOf(marc)).toEqual([]);
  });
});

describe('préférences (visite guidée, astuces)', () => {
  const prefs = async (who: string) => (await one<{ p: Record<string, unknown> }>(db, who, `select preferences as p from profiles where id = $1`, [who])).p;
  const merge = (who: string | null, p: unknown) =>
    one<{ r: Record<string, unknown> }>(db, who, `select merge_preferences($1::jsonb) as r`, [JSON.stringify(p)]).then((x) => x.r);

  it('fusionne sans écraser les autres réglages, seulement pour soi, et refuse le reste', async () => {
    await as(db, bruno, `update profiles set preferences = '{"default_visibility":"friends"}' where id = $1`, [bruno]);
    expect(await merge(bruno, { tour: { status: 'active', step: 3 } })).toEqual({ default_visibility: 'friends', tour: { status: 'active', step: 3 } });
    expect(await merge(bruno, { tips: ['cave'] })).toEqual({ default_visibility: 'friends', tour: { status: 'active', step: 3 }, tips: ['cave'] });
    // Chacun ne modifie que les siennes.
    await merge(claire, { tour: { status: 'done', step: 0 } });
    expect(await prefs(bruno)).toEqual({ default_visibility: 'friends', tour: { status: 'active', step: 3 }, tips: ['cave'] });
    expect(await prefs(claire)).toEqual({ tour: { status: 'done', step: 0 } });
    await expectError(merge(bruno, ['tour']), /invalid/);
    await expectError(merge(bruno, 'done'), /invalid/);
    await expectError(merge(bruno, { notes: 'x'.repeat(2100) }), /invalid/);
    await expectError(merge(null, { tour: { status: 'done', step: 0 } }), /permission denied/);
    expect(await prefs(bruno)).toEqual({ default_visibility: 'friends', tour: { status: 'active', step: 3 }, tips: ['cave'] });
  });
});

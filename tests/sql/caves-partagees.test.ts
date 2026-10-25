import { beforeEach, describe, expect, it } from 'vitest';
import { addWine, as, befriend, createDb, createUser, expectError, lotState, one, rid, type Db } from '../helpers/db.ts';

let db: Db;
let bruno: string;
let claire: string;
let marc: string;
let cave: string;
let secret: string;

beforeEach(async () => {
  db = await createDb();
  bruno = await createUser(db, 'Bruno');
  claire = await createUser(db, 'Claire');
  marc = await createUser(db, 'Marc');
  await befriend(db, bruno, claire);
  cave = (await one<{ id: string }>(db, bruno, `select id from cellars where name = 'Ma cave'`)).id;
  secret = (await one<{ id: string }>(db, bruno, `insert into cellars (name) values ('Cave du bureau') returning id`)).id;
});

const invite = (who: string, cellar: string, users: string[]) => one<{ n: number }>(db, who, `select invite_to_cellar($1, $2::uuid[]) as n`, [cellar, users]);
const respond = (who: string, cellar: string, accept = true) => one<{ r: string }>(db, who, `select respond_cellar_invite($1, $2) as r`, [cellar, accept]);
const remove = (who: string, cellar: string, user: string) => one(db, who, `select remove_cellar_member($1, $2)`, [cellar, user]);
const names = async (who: string, table: string) => (await as<{ name: string }>(db, who, `select name from ${table} order by name`)).map((r) => r.name);
async function associate() {
  await invite(bruno, cave, [claire]);
  await respond(claire, cave);
}
/** Fiche créée par une personne associée, au nom du propriétaire de la cave (comme l'appli : simple insertion, sans relire la ligne). */
async function wineFor(who: string, owner: string, name: string, id = rid()) {
  await as(db, who, `insert into wines (id, owner_id, name) values ($1, $2, $3)`, [id, owner, name]);
  return id;
}
const newLot = (who: string, p: Record<string, unknown>) => one<{ r: { id: string; owner_id: string; visibility: string } }>(db, who, `select to_json(create_lot($1::jsonb, $2)) as r`, [JSON.stringify(p), rid()]);

describe('associer une personne à sa cave', () => {
  it('invitation, acceptation : la cave apparaît chez Claire ; les autres caves de Bruno restent séparées', async () => {
    await addWine(db, bruno, { name: 'Morgon' }, { cellar_id: cave, quantity: 6 });
    await addWine(db, bruno, { name: 'Vin du bureau' }, { cellar_id: secret, quantity: 2 });
    expect((await invite(bruno, cave, [claire])).n).toBe(1);
    expect(await as(db, claire, `select actor_name, ref_id from notifications where kind = 'cellar_invite'`)).toEqual([{ actor_name: 'Bruno', ref_id: cave }]);
    // Invitée seulement : rien n'est encore visible.
    expect(await names(claire, 'wines')).toEqual([]);
    expect(await as(db, claire, `select owner_name, status from my_cellar_links()`)).toEqual([{ owner_name: 'Bruno', status: 'invited' }]);
    expect((await respond(claire, cave)).r).toBe('active');
    expect((await respond(claire, cave)).r).toBe('active');
    expect(await as(db, bruno, `select actor_name, ref_id from notifications where kind = 'cellar_joined'`)).toEqual([{ actor_name: 'Claire', ref_id: cave }]);
    // La cave de Bruno, ses bouteilles, l'historique ; jamais la cave du bureau.
    expect(await names(claire, 'cellars')).toEqual(['Ma cave', 'Ma cave']);
    expect(await names(claire, 'wines')).toEqual(['Morgon']);
    expect(await as(db, claire, `select quantity from lots`)).toEqual([{ quantity: 6 }]);
    expect(await as(db, claire, `select delta from movements`)).toEqual([{ delta: 6 }]);
    expect(await as(db, bruno, `select user_name, status from my_cellar_links()`)).toEqual([{ user_name: 'Claire', status: 'active' }]);
    // Marc, non associé, ne voit rien.
    expect(await names(marc, 'wines')).toEqual([]);
  });

  it('seulement des amis, seulement sa propre cave, 10 personnes au plus', async () => {
    await expectError(invite(bruno, cave, [marc]), /not_friend/);
    await expectError(invite(claire, cave, [marc]), /not_found/);
    const friends: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const u = await createUser(db, `Ami${i}`);
      await befriend(db, bruno, u);
      friends.push(u);
    }
    await expectError(invite(bruno, cave, friends.concat(claire)), /cellar_members_full/);
    expect((await invite(bruno, cave, friends)).n).toBe(10);
  });
});

describe('gérer à plusieurs : un seul stock, chaque action à son nom', () => {
  it('Claire ajoute une bouteille, la boit, corrige et annule : le stock est celui de Bruno', async () => {
    await associate();
    const wine = await wineFor(claire, bruno, 'Sancerre');
    // Relancer l'envoi (double clic) ne crée pas de doublon : même identifiant, refus que l'appli ignore.
    await expectError(wineFor(claire, bruno, 'Sancerre', wine), /duplicate key/);
    const lot = (await newLot(claire, { wine_id: wine, cellar_id: cave, quantity: 3, visibility: 'friends' })).r;
    // Le lot appartient à Bruno ; le partage suit le choix par défaut de Bruno (privé), pas celui de Claire.
    expect(lot).toMatchObject({ owner_id: bruno, visibility: 'private' });
    await one(db, claire, `select record_movement($1, 'consommation', 1, null, 'Apéritif', $2)`, [lot.id, rid()]);
    await one(db, claire, `select set_lot_quantity($1, 1, null, $2)`, [lot.id, rid()]);
    expect(await lotState(db, lot.id)).toEqual({ quantity: 1, reserved: 0 });
    // Bruno voit tout, au nom de Claire.
    const history = await as<{ kind: string; delta: number; owner_id: string; done_by: string }>(db, bruno, `select kind, delta, owner_id, done_by from movements order by created_at`);
    expect(history).toEqual([
      { kind: 'achat', delta: 3, owner_id: bruno, done_by: claire },
      { kind: 'consommation', delta: -1, owner_id: bruno, done_by: claire },
      { kind: 'correction', delta: -1, owner_id: bruno, done_by: claire },
    ]);
    const correction = (await one<{ id: string }>(db, bruno, `select id from movements where kind = 'correction'`)).id;
    await one(db, claire, `select reverse_movement($1, $2)`, [correction, rid()]);
    expect(await lotState(db, lot.id)).toEqual({ quantity: 2, reserved: 0 });
    // Dégustation notée par Claire, la bouteille venant de la cave partagée.
    const t = await one<{ r: { wine_id: string } }>(db, claire, `select to_json(create_tasting($1::jsonb, $2, $3)) as r`, [JSON.stringify({ wine_name: 'Sancerre' }), lot.id, rid()]);
    expect(t.r.wine_id).toBe(wine);
    expect(await lotState(db, lot.id)).toEqual({ quantity: 1, reserved: 0 });
  });

  it('Claire range et complète ; le partage, la suppression et la cave du bureau restent à Bruno', async () => {
    await associate();
    const { wineId, lotId } = await addWine(db, bruno, { name: 'Morgon' }, { cellar_id: cave, quantity: 6 });
    // Ranger : emplacement existant ou nouveau (il appartient à Bruno).
    const casier = await one<{ id: string; owner_id: string }>(db, claire, `insert into locations (cellar_id, name) values ($1, 'Casier du haut') returning id, owner_id`, [cave]);
    expect(casier.owner_id).toBe(bruno);
    await as(db, claire, `update lots set location_id = $1, purchase_price = 18, notes = 'Cadeau de Paul' where id = $2`, [casier.id, lotId]);
    await as(db, claire, `update wines set notes = 'Pour Noël', favorite = true where id = $1`, [wineId]);
    expect(await one(db, bruno, `select w.notes, w.favorite, l.purchase_price::float as price from wines w join lots l on l.wine_id = w.id`)).toEqual({
      notes: 'Pour Noël',
      favorite: true,
      price: 18,
    });
    // Le partage avec les amis et les masques : au propriétaire.
    await expectError(as(db, claire, `update lots set visibility = 'friends' where id = $1`, [lotId]), /owner_only/);
    await expectError(as(db, claire, `update lots set hide_price = false where id = $1`, [lotId]), /owner_only/);
    // Supprimer : rien n'est supprimé.
    await as(db, claire, `delete from lots where id = $1`, [lotId]);
    await as(db, claire, `delete from wines where id = $1`, [wineId]);
    await as(db, claire, `delete from cellars where id = $1`, [cave]);
    expect(await lotState(db, lotId)).toEqual({ quantity: 6, reserved: 0 });
    expect(await names(bruno, 'cellars')).toEqual(['Cave du bureau', 'Ma cave']);
    // Renommer la cave : au propriétaire.
    await as(db, claire, `update cellars set name = 'Chez nous' where id = $1`, [cave]);
    expect(await names(bruno, 'cellars')).toEqual(['Cave du bureau', 'Ma cave']);
    // La cave du bureau, ou un compte étranger : interdits.
    await expectError(newLot(claire, { wine_id: wineId, cellar_id: secret, quantity: 1 }), /forbidden/);
    await expectError(wineFor(claire, marc, 'Intrus'), /row-level security/);
    await expectError(as(db, claire, `update lots set cellar_id = $1, location_id = null where id = $2`, [secret, lotId]), /row-level security/);
    // Prix de marché relevé par Claire : il est rangé avec la fiche de Bruno.
    await as(db, claire, `insert into market_prices (wine_id, price_low, price_high) values ($1, 20, 25)`, [wineId]);
    expect(await as(db, bruno, `select owner_id from market_prices`)).toEqual([{ owner_id: bruno }]);
    // Groupes et événements : seulement le propriétaire.
    const g = await one<{ id: string }>(db, claire, `select (create_group('Les copains', '🍷', null, null, null)).id`);
    await expectError(one(db, claire, `select allocate_to_group($1, $2, 1)`, [lotId, g.id]), /not_found/);
    await expectError(one(db, claire, `select share_lot_with_group($1, $2, true)`, [lotId, g.id]), /not_found/);
  });

  it('photos : Claire dépose les siennes dans son dossier ; jamais le fichier d’un tiers', async () => {
    await associate();
    const { wineId } = await addWine(db, bruno, { name: 'Morgon', label_photo: `${bruno}/etiquette.jpg` }, { cellar_id: cave });
    await addWine(db, bruno, { name: 'Vin du bureau', label_photo: `${bruno}/bureau.jpg` }, { cellar_id: secret });
    await as(db, claire, `update wines set bottle_photo = $1 where id = $2`, [`${claire}/bouteille.jpg`, wineId]);
    await expectError(as(db, claire, `update wines set label_photo = $1 where id = $2`, [`${marc}/vole.jpg`, wineId]), /forbidden/);
    const canRead = async (who: string, path: string) => (await one<{ ok: boolean }>(db, who, `select can_read_photo($1) as ok`, [path])).ok;
    expect(await canRead(bruno, `${claire}/bouteille.jpg`)).toBe(true);
    expect(await canRead(claire, `${bruno}/etiquette.jpg`)).toBe(true);
    expect(await canRead(claire, `${bruno}/bureau.jpg`)).toBe(false);
    expect(await canRead(marc, `${claire}/bouteille.jpg`)).toBe(false);
  });
});

describe('fin d’une association', () => {
  it('retrait, départ, blocage : l’accès s’arrête, le stock et l’historique restent', async () => {
    await associate();
    const { lotId } = await addWine(db, bruno, { name: 'Morgon' }, { cellar_id: cave, quantity: 6 });
    await one(db, claire, `select record_movement($1, 'consommation', 2, null, null, $2)`, [lotId, rid()]);
    // Bruno retire Claire.
    await remove(bruno, cave, claire);
    expect(await names(claire, 'wines')).toEqual([]);
    await expectError(one(db, claire, `select record_movement($1, 'consommation', 1, null, null, $2)`, [lotId, rid()]), /not_found/);
    expect(await lotState(db, lotId)).toEqual({ quantity: 4, reserved: 0 });
    expect(await as(db, bruno, `select done_by from movements where kind = 'consommation'`)).toEqual([{ done_by: claire }]);
    // Claire part d'elle-même.
    await associate();
    await remove(claire, cave, claire);
    expect(await names(claire, 'wines')).toEqual([]);
    await expectError(remove(claire, cave, bruno), /not_found/);
    // Un blocage met fin à l'association.
    await associate();
    await one(db, claire, `select block_user($1)`, [bruno]);
    expect(await names(claire, 'wines')).toEqual([]);
    expect(await as(db, bruno, `select * from my_cellar_links()`)).toEqual([]);
    // Invitation refusée.
    await one(db, claire, `select unblock_user($1)`, [bruno]);
    await befriend(db, bruno, claire);
    await invite(bruno, cave, [claire]);
    expect((await respond(claire, cave, false)).r).toBe('declined');
    expect(await as(db, bruno, `select * from my_cellar_links()`)).toEqual([]);
  });

  it('suppression de compte : celui de Claire (ses photos sont retirées des fiches), puis celui de Bruno', async () => {
    await associate();
    const { wineId, lotId } = await addWine(db, bruno, { name: 'Morgon' }, { cellar_id: cave, quantity: 6 });
    await as(db, claire, `update wines set label_photo = $1 where id = $2`, [`${claire}/etiquette.jpg`, wineId]);
    await one(db, claire, `select record_movement($1, 'consommation', 1, null, null, $2)`, [lotId, rid()]);
    await one(db, claire, `select prepare_account_deletion()`);
    await db.query(`delete from auth.users where id = $1`, [claire]);
    expect(await one(db, bruno, `select label_photo from wines`)).toEqual({ label_photo: null });
    expect(await as(db, bruno, `select done_by from movements where kind = 'consommation'`)).toEqual([{ done_by: null }]);
    expect(await lotState(db, lotId)).toEqual({ quantity: 5, reserved: 0 });
    // Bruno supprime son compte : la cave partagée disparaît avec ce compte.
    await one(db, bruno, `select prepare_account_deletion()`);
    await db.query(`delete from auth.users where id = $1`, [bruno]);
    expect((await db.query(`select count(*)::int as n from cellar_members`)).rows).toEqual([{ n: 0 }]);
  });
});

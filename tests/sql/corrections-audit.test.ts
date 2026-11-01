import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, addWine, as, asAdmin, befriend, createDb, createUser, expectError, one, rid, type Db } from '../helpers/db.ts';

// Corrections de l'audit de sécurité du 01/11/2026 (migration 20261102000014).
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

const objects = async (who: string, sql: string, params: unknown[]) => as<{ name: string }>(db, who, sql, params);

describe('V1 : photos protégées par la double authentification', () => {
  it('code activé, session non vérifiée : ni lecture, ni ajout, ni suppression ; session vérifiée : tout va', async () => {
    const mine = `${bruno}/etiquette.jpg`;
    await db.query(`insert into storage.objects (bucket_id, name) values ('photos', $1)`, [mine]);
    // Sans code activé : comme avant.
    expect(await objects(bruno, `select name from storage.objects where name = $1`, [mine])).toEqual([{ name: mine }]);
    await db.query(`insert into auth.mfa_factors (user_id, status) values ($1, 'verified')`, [bruno]);
    // Session « mot de passe seul » (aal1).
    expect(await objects(bruno, `select name from storage.objects where name = $1`, [mine])).toEqual([]);
    expect((await one<{ ok: boolean }>(db, bruno, `select can_read_photo($1) as ok`, [mine])).ok).toBe(false);
    await expectError(as(db, bruno, `insert into storage.objects (bucket_id, name) values ('photos', $1)`, [`${bruno}/intrus.jpg`]), /row-level security/);
    expect(await objects(bruno, `delete from storage.objects where name = $1 returning name`, [mine])).toEqual([]);
    // Session vérifiée par le code (aal2).
    expect(await asAdmin(db, bruno, `select name from storage.objects where name = $1`, [mine])).toEqual([{ name: mine }]);
  });
});

describe('V3 : une personne associée ne rattache plus une photo privée du propriétaire', () => {
  it('seulement les photos de son propre dossier ; le propriétaire garde les siennes', async () => {
    const maison = (await one<{ id: string }>(db, bruno, `select id from cellars where name = 'Ma cave'`)).id;
    const { wineId } = await addWine(db, bruno, { name: 'Morgon' }, { quantity: 2 });
    await one(db, bruno, `select invite_to_cellar($1, $2::uuid[])`, [maison, [claire]]);
    await one(db, claire, `select respond_cellar_invite($1, true)`, [maison]);
    const secret = `${bruno}/photo-privee.jpg`;
    await expectError(as(db, claire, `update wines set label_photo = $1 where id = $2`, [secret, wineId]), /forbidden/);
    expect((await one<{ ok: boolean }>(db, claire, `select can_read_photo($1) as ok`, [secret])).ok).toBe(false);
    // Sa propre photo : acceptée, et lisible par le propriétaire.
    await as(db, claire, `update wines set label_photo = $1 where id = $2`, [`${claire}/etiquette.jpg`, wineId]);
    expect((await one<{ ok: boolean }>(db, bruno, `select can_read_photo($1) as ok`, [`${claire}/etiquette.jpg`])).ok).toBe(true);
    // Le propriétaire choisit toujours une photo de son dossier.
    await as(db, bruno, `update wines set label_photo = $1 where id = $2`, [secret, wineId]);
  });
});

async function dinner(guests: string[]) {
  const ev = await one<{ r: { id: string } }>(db, bruno, `select to_json(create_event($1::jsonb, $2::uuid[])) as r`, [
    JSON.stringify({ kind: 'degustation', title: 'Soirée', starts_at: new Date(Date.now() - 3600_000).toISOString() }),
    `{${guests.join(',')}}`,
  ]);
  return ev.r.id;
}
const bring = async (event: string) => {
  const { lotId } = await addWine(db, bruno, { name: 'Morgon' }, { quantity: 2 });
  return (await one<{ r: { id: string } }>(db, bruno, `select to_json(propose_event_wine($1, $2, 1, null, true, $3)) as r`, [event, lotId, rid()])).r.id;
};
type Votes = { votes: { average: number | null; count: number }[] } | null;
const state = async (who: string, ev: string) => (await one<{ s: Votes }>(db, who, `select event_live_state($1) as s`, [ev])).s;

describe('V8 : mode soirée', () => {
  it('un invité qui a répondu « non » ne voit, n’écrit et ne vote rien ; pas de vote après la fin', async () => {
    const ev = await dinner([claire, marc]);
    const w = await bring(ev);
    await one(db, marc, `select respond_event($1, 'no')`, [ev]);
    await one(db, bruno, `select start_event_live($1, false)`, [ev]);
    await expectError(one(db, marc, `select post_event_message($1, 'Je ne viens pas')`, [ev]), /forbidden/);
    await expectError(one(db, marc, `select vote_event_wine($1, 1::smallint)`, [w]), /not_found/);
    expect(await state(marc, ev)).toBeNull();
    // Claire n'a pas encore répondu : elle participe.
    await one(db, claire, `select vote_event_wine($1, 4::smallint)`, [w]);
    await one(db, bruno, `select end_event_live($1)`, [ev]);
    await expectError(one(db, claire, `select vote_event_wine($1, 5::smallint)`, [w]), /not_found/);
  });

  it('les notes d’une personne bloquée ne comptent pas dans ma moyenne', async () => {
    const ev = await dinner([claire, marc]);
    const w = await bring(ev);
    await one(db, bruno, `select start_event_live($1, false)`, [ev]);
    await one(db, claire, `select vote_event_wine($1, 5::smallint)`, [w]);
    await one(db, marc, `select vote_event_wine($1, 1::smallint)`, [w]);
    expect((await state(claire, ev))!.votes[0]).toMatchObject({ average: 3, count: 2 });
    await one(db, claire, `select block_user($1)`, [marc]);
    expect((await state(claire, ev))!.votes[0]).toMatchObject({ average: 5, count: 1 });
  });
});

async function group(members: string[]) {
  const id = (await one<{ id: string }>(db, bruno, `select (create_group('Les copains', '🍷', null, null, $1::uuid[])).id`, [members])).id;
  for (const m of members) await one(db, m, `select respond_group_invite($1, true)`, [id]);
  return id;
}
const createPurchase = async (who: string, g: string) =>
  (await one<{ r: { id: string } }>(db, who, `select to_json(create_group_purchase($1, $2::jsonb)) as r`, [g, JSON.stringify({ title: 'Bourgogne' })])).r.id;

describe('V9 : achats groupés', () => {
  it('clos par un administrateur : la personne qui l’a proposé ne le rouvre plus ; clos par elle-même : si', async () => {
    const g = await group([claire, marc]);
    const p = await createPurchase(claire, g);
    await one(db, bruno, `select set_group_purchase_status($1, 'closed')`, [p]);
    await expectError(one(db, claire, `select set_group_purchase_status($1, 'open')`, [p]), /forbidden/);
    await one(db, bruno, `select set_group_purchase_status($1, 'open')`, [p]);
    await one(db, claire, `select set_group_purchase_status($1, 'cancelled')`, [p]);
    await one(db, claire, `select set_group_purchase_status($1, 'open')`, [p]);
  });

  it('au plus 5 achats ouverts par personne', async () => {
    const g = await group([claire]);
    for (let i = 0; i < 5; i++) await createPurchase(claire, g);
    await expectError(createPurchase(claire, g), /group_purchases_full/);
    await createPurchase(bruno, g);
  });
});

describe('R3 : durées de conservation (migration 20261102000015)', () => {
  it('soirées après 12 mois, achats clos après 12 mois, déplacements après 24 mois ; l’aperçu annonce exactement la purge', async () => {
    // Une soirée ancienne et une récente, chacune avec un message et une note.
    const old = await dinner([claire]);
    const recent = await dinner([claire]);
    for (const ev of [old, recent]) {
      const w = await bring(ev);
      await one(db, bruno, `select start_event_live($1, false)`, [ev]);
      await one(db, claire, `select post_event_message($1, 'Santé !')`, [ev]);
      await one(db, claire, `select vote_event_wine($1, 4::smallint)`, [w]);
    }
    await db.query(`update events set starts_at = now() - interval '13 months' where id = $1`, [old]);
    // Achats : un clos il y a 13 mois, un clos récemment, un ouvert ancien.
    const g = await group([claire]);
    const closedOld = await createPurchase(claire, g);
    const closedRecent = await createPurchase(claire, g);
    const openOld = await createPurchase(claire, g);
    await one(db, claire, `select set_group_purchase_status($1, 'closed')`, [closedOld]);
    await one(db, claire, `select set_group_purchase_status($1, 'cancelled')`, [closedRecent]);
    await db.query(`update group_purchases set closed_at = now() - interval '13 months' where id = $1`, [closedOld]);
    await db.query(`update group_purchases set created_at = now() - interval '3 years' where id = $1`, [openOld]);
    // Déplacements : un de 25 mois, un récent.
    const cave = (await one<{ id: string }>(db, bruno, `select id from cellars where name = 'Ma cave'`)).id;
    const haut = (await one<{ id: string }>(db, bruno, `insert into locations (cellar_id, name) values ($1, 'Haut') returning id`, [cave])).id;
    const bas = (await one<{ id: string }>(db, bruno, `insert into locations (cellar_id, name) values ($1, 'Bas') returning id`, [cave])).id;
    const { lotId } = await addWine(db, bruno, { name: 'Morgon' }, { quantity: 4, location_id: haut });
    await one(db, bruno, `select move_bottles($1, 1, $2, $3)`, [lotId, bas, rid()]);
    await one(db, bruno, `select move_bottles($1, 1, $2, $3)`, [lotId, bas, rid()]);
    const moves = (await db.query<{ request_id: string }>(`select request_id from bottle_moves order by created_at`)).rows;
    await db.query(`update bottle_moves set created_at = now() - interval '25 months' where request_id = $1`, [moves[0].request_id]);

    const apercu = readFileSync(join(MIGRATIONS_DIR, '..', 'sql', 'conservation-apercu.sql'), 'utf8');
    const preview = Object.fromEntries((await db.query<{ cle: string; a_effacer: number }>(apercu)).rows.map((r) => [r.cle, r.a_effacer]));
    const { asService } = await import('../helpers/db.ts');
    const [res] = await asService<{ r: Record<string, number> }>(db, `select retention_purge() as r`);
    for (const [key, n] of Object.entries(res.r)) expect(preview[key], key).toBe(n);
    expect(res.r).toMatchObject({ event_messages: 1, event_votes: 1, group_purchases: 1, bottle_moves: 1 });
    expect((await db.query(`select 1 from event_messages`)).rows).toHaveLength(1);
    expect((await db.query<{ id: string }>(`select id from group_purchases order by created_at`)).rows.map((r) => r.id).sort()).toEqual([closedRecent, openOld].sort());
    expect((await db.query(`select 1 from bottle_moves`)).rows).toHaveLength(moves.length - 1);
  });
});

describe('retour arrière', () => {
  it('rend les règles d’avant sans erreur', async () => {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '..', 'sql', 'retour-20261102000014.sql'), 'utf8'));
    expect((await db.query(`select 1 from information_schema.columns where table_name = 'group_purchases' and column_name = 'closed_by'`)).rows).toEqual([]);
    expect((await db.query(`select 1 from pg_proc where proname = 'is_live_participant'`)).rows).toEqual([]);
    const ev = await dinner([marc]);
    await one(db, marc, `select respond_event($1, 'no')`, [ev]);
    await one(db, bruno, `select start_event_live($1, false)`, [ev]);
    await one(db, marc, `select post_event_message($1, 'Avant la correction')`, [ev]);
  });
});

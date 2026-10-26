import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, as, asService, createDb, createUser, expectError, one, type Db } from '../helpers/db.ts';

let db: Db;
let bruno: string; // premier compte : administrateur
let claire: string;
let marc: string;
const nousBruno = '10000000-0000-4000-8000-0000000000b0';
const nousClaire = '10000000-0000-4000-8000-00000000c1a1';
const nousMarc = '10000000-0000-4000-8000-0000000000aa';

beforeEach(async () => {
  db = await createDb();
  bruno = await createUser(db, 'Bruno');
  claire = await createUser(db, 'Claire');
  marc = await createUser(db, 'Marc');
});

const migration = () => readFileSync(join(MIGRATIONS_DIR, '20261101000002_liaison_nous_durcie.sql'), 'utf8');
const rollback = () => readFileSync(join(MIGRATIONS_DIR, '..', 'sql', 'retour-20261101000002.sql'), 'utf8');

/** Liaison comme le fait cave-api : code créé par la personne, consommé par le serveur. */
async function link(user: string, nousUser: string, name: string | null = 'Nous') {
  const code = (await one<{ c: string }>(db, user, `select nous_link_create() as c`)).c;
  await asService(db, `select nous_link_redeem($1, $2, $3)`, [code, nousUser, name]);
}
const allowJump = async (user: string) => (await asService<{ a: boolean }>(db, `select allow_jump as a from nous_links where user_id = $1`, [user]))[0]?.a;
const setJump = (user: string | null, enabled: boolean | null) => one<{ r: boolean }>(db, user, `select nous_set_allow_jump($1) as r`, [enabled]);
const jumpCheck = (user: string, nousUser: string) => asService<{ r: boolean }>(db, `select nous_jump_check($1, $2) as r`, [user, nousUser]);
const avis = async (user: string) =>
  (
    await db.query<{ kind: string; actor_id: string | null; actor_name: string | null }>(
      `select kind, actor_id, actor_name from notifications where user_id = $1 and kind = 'nous_linked' order by created_at, id`,
      [user],
    )
  ).rows;
const claim = (hash: string, signedAt = 'now()') => asService<{ r: boolean }>(db, `select eco_replay_claim($1, ${signedAt}) as r`, [hash]).then((r) => r[0].r);
const sha = (n: number) => n.toString(16).padStart(64, '0');

describe('connexion directe depuis Nous', () => {
  it('désactivée par défaut ; chacun ne règle que la sienne, par la fonction de la base', async () => {
    await link(claire, nousClaire);
    expect(await as(db, claire, `select allow_jump from nous_links`)).toEqual([{ allow_jump: false }]);
    await expectError(jumpCheck(claire, nousClaire), /jump_disabled/);
    await expectError(jumpCheck(claire, nousMarc), /not_linked/);

    expect(await setJump(claire, true)).toEqual({ r: true });
    expect(await jumpCheck(claire, nousClaire)).toEqual([{ r: true }]);
    // Pas de liaison : rien à régler ; le réglage de Claire ne bouge pas.
    await expectError(setJump(marc, true), /not_linked/);
    await expectError(setJump(marc, false), /not_linked/);
    expect(await allowJump(claire)).toBe(true);
    // Aucun accès direct en écriture, ni à sa liaison ni à celle d'un autre.
    await expectError(as(db, claire, `update nous_links set allow_jump = false where user_id = $1`, [claire]), /permission denied/);
    await expectError(as(db, marc, `update nous_links set allow_jump = false where user_id = $1`, [claire]), /permission denied/);
    expect(await as(db, marc, `select * from nous_links`)).toEqual([]);
    // Sans compte, valeur absente, fonctions du serveur : refusés.
    await expectError(setJump(null, true), /permission denied/);
    await expectError(setJump(claire, null), /invalid/);
    await expectError(as(db, claire, `select nous_jump_check($1, $2)`, [claire, nousClaire]), /permission denied/);
    await expectError(as(db, claire, `select nous_links_notify()`), /permission denied/);
    expect(await allowJump(claire)).toBe(true);

    expect(await setJump(claire, false)).toEqual({ r: false });
    await expectError(jumpCheck(claire, nousClaire), /jump_disabled/);
  });

  it('compte administrateur : option refusée par la base, connexion toujours refusée', async () => {
    expect(await as(db, bruno, `select is_admin from profiles where id = auth.uid()`)).toEqual([{ is_admin: true }]);
    await link(bruno, nousBruno);
    await expectError(setJump(bruno, true), /forbidden/);
    expect(await allowJump(bruno)).toBe(false);
    // Forcée dans la base (ou compte devenu administrateur après l'avoir activée) : refusée quand même.
    await asService(db, `update nous_links set allow_jump = true where user_id = $1`, [bruno]);
    await expectError(jumpCheck(bruno, nousBruno), /jump_disabled/);
    expect(await setJump(bruno, false)).toEqual({ r: false });
  });
});

describe('avis après chaque liaison', () => {
  it('une notification à chaque liaison, avec le prénom du compte Nous, reprise par la file push', async () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/claire-1';
    await asService(db, `select push_subscription_save($1, $2, $3, $4, 'Téléphone')`, [claire, endpoint, `B${'A'.repeat(86)}`, 'A'.repeat(22)]);
    await link(claire, nousClaire, '  Claire N.  ');
    expect(await avis(claire)).toEqual([{ kind: 'nous_linked', actor_id: null, actor_name: 'Claire N.' }]);
    // Lisible par Claire seule, comme ses autres notifications.
    expect(await as(db, claire, `select kind from notifications where kind = 'nous_linked'`)).toEqual([{ kind: 'nous_linked' }]);
    expect(await as(db, marc, `select kind from notifications where kind = 'nous_linked'`)).toEqual([]);
    const [row] = await asService<{ user_id: string; kind: string; actor_name: string }>(db, `select user_id, kind, actor_name from push_outbox_claim(10)`);
    expect(row).toEqual({ user_id: claire, kind: 'nous_linked', actor_name: 'Claire N.' });

    // Nouvelle liaison après une déliaison : nouvel avis. Prénom long : coupé à 40 caractères ; sans prénom : aucun.
    await one(db, claire, `select nous_unlink()`);
    await link(claire, nousMarc, 'A'.repeat(60));
    await link(marc, nousBruno, '   ');
    expect((await avis(claire)).map((a) => a.actor_name)).toEqual(['Claire N.', 'A'.repeat(40)]);
    expect(await avis(marc)).toEqual([{ kind: 'nous_linked', actor_id: null, actor_name: null }]);
    // Liaison refusée (compte Nous déjà relié à quelqu'un d'autre) : aucun avis.
    const code = (await one<{ c: string }>(db, bruno, `select nous_link_create() as c`)).c;
    await expectError(asService(db, `select nous_link_redeem($1, $2, null)`, [code, nousMarc]), /nous_already_linked/);
    expect(await avis(bruno)).toEqual([]);
  });
});

describe('anti-rejeu des requêtes signées', () => {
  it('une signature ne sert qu’une fois ; ses lignes partent 10 minutes après l’horodatage ; réservé au serveur', async () => {
    expect(await claim(sha(1))).toBe(true);
    expect(await claim(sha(1))).toBe(false);
    expect(await claim(sha(2))).toBe(true);
    await expectError(claim('pas-une-empreinte'), /invalid/);
    await expectError(asService(db, `select eco_replay_claim($1, null)`, [sha(3)]), /invalid/);

    // Horodatage de plus de 10 minutes : purgée au passage suivant (la requête est périmée depuis longtemps).
    await asService(db, `insert into eco_replay (signature_sha256, signed_at) values ($1, now() - interval '11 minutes'), ($2, now() - interval '9 minutes')`, [
      sha(4),
      sha(5),
    ]);
    expect(await claim(sha(6))).toBe(true);
    const kept = (await asService<{ h: string }>(db, `select signature_sha256 as h from eco_replay order by h`)).map((r) => r.h);
    expect(kept).toEqual([sha(1), sha(2), sha(5), sha(6)]);
    // Requête datée en avance (horloge de Nous en avance) : refusée aussi si elle revient.
    expect(await claim(sha(7), `now() + interval '4 minutes'`)).toBe(true);
    expect(await claim(sha(7))).toBe(false);

    await expectError(as(db, claire, `select * from eco_replay`), /permission denied/);
    await expectError(as(db, claire, `select eco_replay_claim($1, now())`, [sha(8)]), /permission denied/);
    await expectError(as(db, null, `select eco_replay_claim($1, now())`, [sha(8)]), /permission denied/);
    await expectError(as(db, claire, `insert into eco_replay (signature_sha256, signed_at) values ($1, now())`, [sha(8)]), /permission denied/);
  });
});

describe('mise à jour et retour arrière', () => {
  it('liaison existante avant la mise à jour : option désactivée, rien d’autre ne change', async () => {
    // État d'avant la mise à jour : retour arrière, puis sans la colonne.
    await db.exec(rollback());
    await db.exec(`alter table public.nous_links drop column allow_jump`);
    await link(claire, nousClaire, 'Claire N.');
    const before = await asService(db, `select * from nous_links`);
    await db.exec(migration());
    const after = await asService<Record<string, unknown>>(db, `select * from nous_links`);
    expect(after).toEqual([{ ...before[0], allow_jump: false }]);
    // Aucun avis pour une liaison faite avant la mise à jour.
    expect(await avis(claire)).toEqual([]);
    await expectError(jumpCheck(claire, nousClaire), /jump_disabled/);
  });

  it('le retour arrière rend l’état d’avant en gardant les choix ; la mise à jour se rejoue sans danger', async () => {
    await link(claire, nousClaire, 'Claire N.');
    await setJump(claire, true);
    expect(await claim(sha(1))).toBe(true);

    await db.exec(rollback());
    // Fonctions, table et avis retirés ; le type de notification n'est plus accepté.
    await expectError(setJump(claire, false), /does not exist/);
    await expectError(jumpCheck(claire, nousClaire), /does not exist/);
    expect((await db.query<{ t: string | null }>(`select to_regclass('public.eco_replay')::text as t`)).rows[0].t).toBeNull();
    expect(await avis(claire)).toEqual([]);
    await expectError(db.query(`insert into notifications (user_id, kind) values ($1, 'nous_linked')`, [claire]), /notifications_kind_check/);
    // Une liaison faite pendant ce temps : comme avant, sans avis.
    await link(marc, nousMarc);
    expect(await avis(marc)).toEqual([]);

    await db.exec(migration());
    await db.exec(migration());
    // Le choix de Claire est retrouvé ; la liaison de Marc reste désactivée.
    expect(await allowJump(claire)).toBe(true);
    expect(await allowJump(marc)).toBe(false);
    expect(await jumpCheck(claire, nousClaire)).toEqual([{ r: true }]);
    expect(await claim(sha(1))).toBe(true);
    expect(await claim(sha(1))).toBe(false);
    await one(db, marc, `select nous_unlink()`);
    await link(marc, nousMarc, 'Marc');
    expect(await avis(marc)).toEqual([{ kind: 'nous_linked', actor_id: null, actor_name: 'Marc' }]);
    await expectError(as(db, claire, `select * from eco_replay`), /permission denied/);
    expect(await setJump(claire, false)).toEqual({ r: false });
  });
});

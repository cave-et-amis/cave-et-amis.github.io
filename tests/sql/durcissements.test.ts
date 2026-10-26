import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, addWine, as, asService, befriend, createDb, createUser, expectError, one, type Db } from '../helpers/db.ts';

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

const count = async (from: string, params: unknown[] = []) => (await db.query<{ n: number }>(`select count(*)::int as n from ${from}`, params)).rows[0].n;
const take = (bucket: string, who: string, max = 3, seconds = 600) =>
  asService<{ ok: boolean }>(db, `select rate_take($1, $2, $3, $4) as ok`, [bucket, who, max, seconds]).then((r) => r[0].ok);
const createGroup = async (who: string, name: string, invite: string[], photo: string | null = null) =>
  (await one<{ id: string }>(db, who, `select (create_group($1, '🍷', '', $2, $3::uuid[])).id`, [name, photo, invite])).id;
const activity = async (g: string) =>
  (
    await db.query<{ kind: string; actor_name: string | null; target_name: string | null }>(
      `select kind, actor_name, target_name from group_activity where group_id = $1 order by created_at`,
      [g],
    )
  ).rows;

describe('limites de fréquence hors IA (F4)', () => {
  it('rate_take : par action et par personne, sur une fenêtre glissante ; réservée au serveur', async () => {
    expect([await take('essai', bruno), await take('essai', bruno), await take('essai', bruno)]).toEqual([true, true, true]);
    expect(await take('essai', bruno)).toBe(false);
    // Une autre personne, une autre action : comptées à part ; rien n'est compté au-delà de la limite.
    expect(await take('essai', claire)).toBe(true);
    expect(await take('autre', bruno)).toBe(true);
    expect(await count(`rate_hits where bucket = 'essai' and subject = $1`, [bruno])).toBe(3);
    // La fenêtre glisse ; les compteurs de plus d'un jour sont effacés au passage (et par la purge de chaque nuit).
    await db.query(`update rate_hits set at = at - interval '11 minutes' where subject = $1 and bucket = 'essai'`, [bruno]);
    expect(await take('essai', bruno)).toBe(true);
    await db.query(`update rate_hits set at = at - interval '2 days' where bucket = 'autre'`);
    await take('essai', claire);
    expect(await count(`rate_hits where bucket = 'autre'`)).toBe(0);
    await db.query(`update rate_hits set at = at - interval '25 hours'`);
    expect((await asService<{ n: number }>(db, `select rate_purge() as n`))[0].n).toBeGreaterThan(0);
    expect(await count(`rate_hits`)).toBe(0);
    // Paramètres contrôlés ; aucun accès depuis un compte ni sans compte.
    await expectError(asService(db, `select rate_take('essai', $1, 0, 60)`, [bruno]), /invalid/);
    await expectError(asService(db, `select rate_take('essai', $1, 5, 90000)`, [bruno]), /invalid/);
    await expectError(as(db, bruno, `select rate_take('essai', $1, 100, 60)`, [bruno]), /permission denied/);
    await expectError(as(db, null, `select rate_take('essai', 'x', 100, 60)`), /permission denied/);
    await expectError(as(db, bruno, `select * from rate_hits`), /permission denied/);
    await expectError(as(db, bruno, `select rate_purge()`), /permission denied/);
  });

  it('liens d’invitation : 30 par 24 heures et par personne, en plus des 20 liens actifs au plus', async () => {
    const create = (who = bruno) => one<{ r: { id: string; code: string } }>(db, who, `select create_invite('discovery') as r`);
    for (let i = 0; i < 30; i++) {
      const { r } = await create();
      // Révoqué aussitôt : jamais plus de 20 liens actifs, seule la nouvelle limite joue.
      await one(db, bruno, `select revoke_friend_invite($1)`, [r.id]);
    }
    await expectError(create(), /invite_rate_limited/);
    expect(await count(`friend_invites where inviter_id = $1`, [bruno])).toBe(30);
    // Une autre personne n'est pas concernée ; 24 heures plus tard, c'est de nouveau possible.
    expect((await create(claire)).r.code).toMatch(/^[A-Z2-9]{10}$/);
    await db.query(`update rate_hits set at = at - interval '25 hours' where subject = $1`, [bruno]);
    expect((await create()).r.code).toMatch(/^[A-Z2-9]{10}$/);
  });
});

describe('journal des erreurs techniques (F9)', () => {
  it('détail nettoyé et tronqué par la base, quelle que soit la version de cave-api qui l’écrit', async () => {
    const log = (action: string, detail: string | null) => asService(db, `select ai_log_error(null, $1, 'internal', $2, null)`, [action, detail]);
    await log('a1', `invalid input syntax for type uuid: "Ma question secrète" ; contact bruno@exemple.fr ; clé sk-ant-api03-abcdefghij ; ${'x'.repeat(400)}`);
    await log('a2', 'coupé : "début d’un texte saisi sans guillemet de fin');
    await log('a3', 'Erreur 400 : invalid_request_error : prompt is too long: 210000 tokens > 200000 maximum');
    await log('a4', null);
    const detail = async (action: string) => (await asService<{ detail: string | null }>(db, `select detail from ai_errors where action = $1`, [action]))[0].detail;
    const a1 = (await detail('a1'))!;
    expect(a1.startsWith('invalid input syntax for type uuid: "…" ; contact [adresse] ; clé [clé masquée] ; xxx')).toBe(true);
    expect(a1).toHaveLength(200);
    expect(a1).not.toMatch(/question|exemple\.fr|sk-ant/);
    expect(await detail('a2')).toBe('coupé : "…"');
    // Un message technique sans valeur recopiée reste lisible.
    expect(await detail('a3')).toBe('Erreur 400 : invalid_request_error : prompt is too long: 210000 tokens > 200000 maximum');
    expect(await detail('a4')).toBeNull();
    // Fonctions réservées au serveur.
    await expectError(as(db, bruno, `select ai_log_error(null, 'x', 'internal', 'y', null)`), /permission denied/);
    await expectError(as(db, bruno, `select clean_error_detail('y')`), /permission denied/);
  });
});

describe('suppression d’un compte : le prénom recopié chez les autres (R5)', () => {
  it('« Ancien membre » dans les notifications et l’activité des groupes ; vins, autres personnes et homonymes intacts', async () => {
    // Bruno et Claire : en relation. Claire rejoint le groupe de Bruno, y montre un vin, devient gestionnaire.
    await befriend(db, bruno, claire);
    const g = await createGroup(bruno, 'Les amis', [claire]);
    await one(db, claire, `select respond_group_invite($1, true)`, [g]);
    await one(db, bruno, `select set_member_role($1, $2, 'manager')`, [g, claire]);
    const { lotId } = await addWine(db, claire, { name: 'Morgon', vintage: 2020 });
    await one(db, claire, `select share_lot_with_group($1, $2, true)`, [lotId, g]);
    // Le groupe de Claire, avec sa photo : il continue sans elle.
    const gc = await createGroup(claire, 'Chez Claire', [bruno], `${claire}/groupe.jpg`);
    await one(db, bruno, `select respond_group_invite($1, true)`, [gc]);
    // Une autre Claire, sans rapport avec la première : invitée dans le groupe de Marc.
    const claire2 = await createUser(db, 'Claire');
    await befriend(db, marc, claire2);
    const gm = await createGroup(marc, 'Chez Marc', [claire2]);
    await asService(db, `select rate_take('push_test', $1, 5, 3600)`, [claire]);
    expect(await count(`notifications where user_id = $1 and actor_id = $2`, [bruno, claire])).toBeGreaterThan(0);

    await db.query(`delete from auth.users where id = $1`, [claire]);

    // Notifications reçues par Bruno de la part de Claire : le prénom est remplacé, les lignes restent.
    const notes = await as<{ kind: string; actor_name: string | null }>(db, bruno, `select kind, actor_name from notifications`);
    expect(notes.some((n) => n.kind === 'group_joined' && n.actor_name === 'Ancien membre')).toBe(true);
    expect(notes.filter((n) => n.actor_name === 'Claire')).toEqual([]);
    expect(await activity(g)).toEqual([
      { kind: 'created', actor_name: 'Bruno', target_name: 'Les amis' },
      { kind: 'invited', actor_name: 'Bruno', target_name: 'Ancien membre' },
      { kind: 'joined', actor_name: 'Ancien membre', target_name: 'Ancien membre' },
      { kind: 'role', actor_name: 'Bruno', target_name: 'Ancien membre' },
      { kind: 'shared', actor_name: 'Ancien membre', target_name: 'Morgon 2020' },
    ]);
    // Son groupe continue avec Bruno, sans la photo de son dossier ; la nouvelle administration est notée.
    expect((await db.query(`select photo from groups where id = $1`, [gc])).rows).toEqual([{ photo: null }]);
    expect((await activity(gc)).map((a) => [a.kind, a.actor_name, a.target_name])).toEqual([
      ['created', 'Ancien membre', 'Chez Claire'],
      ['invited', 'Ancien membre', 'Bruno'],
      ['joined', 'Bruno', 'Bruno'],
      ['role', null, 'Bruno'],
    ]);
    // L'autre Claire garde son prénom ; les compteurs de la personne supprimée sont effacés.
    expect((await activity(gm)).map((a) => a.target_name)).toEqual(['Chez Marc', 'Claire']);
    expect(await count(`rate_hits where subject = $1`, [claire])).toBe(0);
  });
});

describe('mise à jour et retour arrière', () => {
  it('le retour arrière rend l’état d’avant ; la mise à jour se rejoue sans danger', async () => {
    await take('essai', bruno);
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '..', 'sql', 'retour-20261101000004.sql'), 'utf8'));
    expect((await db.query<{ t: string | null }>(`select to_regclass('public.rate_hits')::text as t`)).rows[0].t).toBeNull();
    expect((await db.query(`select 1 from pg_trigger where tgname = 'friend_invites_rate'`)).rows).toHaveLength(0);
    // Comme avant : détail gardé tel quel, prénom gardé chez les autres, suppression du compte toujours complète.
    await asService(db, `select ai_log_error(null, 'avant', 'internal', $1, null)`, ['texte "saisi"']);
    expect(await asService(db, `select detail from ai_errors where action = 'avant'`)).toEqual([{ detail: 'texte "saisi"' }]);
    await befriend(db, bruno, claire);
    await addWine(db, claire, { name: 'Morgon' });
    await db.query(`delete from auth.users where id = $1`, [claire]);
    expect(await count(`wines where owner_id = $1`, [claire])).toBe(0);
    expect(await as(db, bruno, `select actor_name from notifications where kind = 'invite_joined'`)).toEqual([{ actor_name: 'Claire' }]);

    const migration = readFileSync(join(MIGRATIONS_DIR, '20261101000004_durcissements.sql'), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    expect(await take('essai', bruno)).toBe(true);
    await asService(db, `select ai_log_error(null, 'apres', 'internal', $1, null)`, ['texte "saisi"']);
    expect(await asService(db, `select detail from ai_errors where action = 'apres'`)).toEqual([{ detail: 'texte "…"' }]);
    await befriend(db, bruno, marc);
    await db.query(`delete from auth.users where id = $1`, [marc]);
    expect(await as(db, bruno, `select actor_name from notifications where kind = 'invite_joined' order by created_at`)).toEqual([
      { actor_name: 'Claire' },
      { actor_name: 'Ancien membre' },
    ]);
  });
});

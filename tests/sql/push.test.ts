import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, as, asService, createDb, createUser, expectError, one, type Db } from '../helpers/db.ts';

let db: Db;
let bruno: string;
let claire: string;
let lea: string;

beforeEach(async () => {
  db = await createDb();
  bruno = await createUser(db, 'Bruno');
  claire = await createUser(db, 'Claire');
  lea = await createUser(db, 'Léa');
  // Trouvables : les demandes de contact leur parviennent (et créent des notifications).
  await db.query(`update profiles set discoverable = true`);
});

// Clés au bon format (la base ne vérifie que le format ; le contenu est vérifié par cave-api).
const P256 = `B${'A'.repeat(86)}`;
const AUTH = 'A'.repeat(22);
let n = 0;
const endpointOf = (tag: string) => `https://fcm.googleapis.com/fcm/send/${tag}-${++n}`;
const save = async (who: string, endpoint = endpointOf(who), label = 'Téléphone') =>
  (await asService<{ id: string }>(db, `select push_subscription_save($1, $2, $3, $4, $5) as id`, [who, endpoint, P256, AUTH, label]))[0].id;
const request = (who: string, to: string) => one(db, who, `select send_friend_request($1) as r`, [to]);
const outbox = () =>
  asService<{ user_id: string; sent_at: string | null; attempts: number; last_error: string | null }>(db, `select user_id, sent_at, attempts, last_error from push_outbox order by id`);
const claim = () =>
  asService<{ id: number; user_id: string; kind: string; actor_id: string; actor_name: string; attempts: number }>(db, `select * from push_outbox_claim(50)`);
const done = (id: number, ok: boolean) => asService(db, `select push_outbox_done($1, $2, $3)`, [id, ok, ok ? null : 'échec 500']);
const devices = (who: string) => as<{ id: string; label: string; endpoint: string }>(db, who, `select * from my_push_devices()`);

describe('file d’envoi des notifications push', () => {
  it('une notification part en file seulement pour une personne qui a un appareil', async () => {
    await save(bruno);
    await request(claire, bruno);
    await request(bruno, lea);
    expect(await outbox()).toEqual([{ user_id: bruno, sent_at: null, attempts: 0, last_error: null }]);
  });

  it('prise en charge, nouvelle tentative, abandon après 5 essais ; une notification déjà lue n’est pas poussée', async () => {
    await save(bruno);
    await request(claire, bruno);
    const [row] = await claim();
    expect(row).toMatchObject({ user_id: bruno, kind: 'friend_request', actor_id: claire, actor_name: 'Claire', attempts: 0 });
    // Verrouillée une minute : un second envoi simultané ne la reprend pas.
    expect(await claim()).toEqual([]);
    await done(row.id, false);
    expect(await outbox()).toMatchObject([{ attempts: 1, sent_at: null, last_error: 'échec 500' }]);
    expect(await claim()).toEqual([]);
    await asService(db, `update push_outbox set next_attempt_at = now()`);
    const [again] = await claim();
    await done(again.id, true);
    expect((await outbox())[0].sent_at).not.toBeNull();
    expect(await claim()).toEqual([]);

    // Lue dans l'application avant l'envoi : rien n'est poussé.
    await request(lea, bruno);
    await one(db, bruno, `select mark_notifications_read()`);
    expect(await claim()).toEqual([]);
    expect((await outbox())[1]).toMatchObject({ last_error: 'déjà lue ou trop ancienne' });
    expect((await outbox())[1].sent_at).not.toBeNull();

    // Cinq échecs : abandon.
    await save(claire);
    await request(lea, claire);
    for (let i = 0; i < 5; i++) {
      await asService(db, `update push_outbox set next_attempt_at = now() where sent_at is null`);
      const [r] = await claim();
      await done(r.id, false);
    }
    await asService(db, `update push_outbox set next_attempt_at = now() where sent_at is null`);
    expect(await claim()).toEqual([]);
  });
});

describe('appareils abonnés', () => {
  it('un appareil passé à un autre compte change de propriétaire ; 10 appareils au plus par personne', async () => {
    const shared = endpointOf('tablette');
    await save(bruno, shared, 'Tablette');
    await save(claire, shared, 'Tablette');
    expect(await devices(bruno)).toEqual([]);
    expect(await devices(claire)).toMatchObject([{ label: 'Tablette', endpoint: shared }]);
    for (let i = 0; i < 12; i++) await save(lea);
    expect(await devices(lea)).toHaveLength(10);
  });

  it('résultat d’un envoi : abonnement expiré retiré, succès noté, retiré après 10 échecs', async () => {
    const gone = await save(bruno);
    const ok = await save(bruno);
    const flaky = await save(bruno);
    await asService(db, `select push_subscription_result($1, false, true)`, [gone]);
    await asService(db, `select push_subscription_result($1, true, false)`, [ok]);
    for (let i = 0; i < 9; i++) await asService(db, `select push_subscription_result($1, false, false)`, [flaky]);
    const left = await asService<{ id: string; failures: number; last_success_at: string | null }>(db, `select id, failures, last_success_at from push_subscriptions order by created_at`);
    expect(left.map((d) => d.id).sort()).toEqual([ok, flaky].sort());
    expect(left.find((d) => d.id === ok)?.last_success_at).not.toBeNull();
    await asService(db, `select push_subscription_result($1, false, false)`, [flaky]);
    expect((await devices(bruno)).map((d) => d.id)).toEqual([ok]);
  });

  it('chacun ne voit et ne retire que ses appareils ; les tables et les fonctions du serveur restent inaccessibles', async () => {
    const mine = endpointOf('bruno');
    const id = await save(bruno, mine);
    await save(claire);
    expect(await devices(claire)).toHaveLength(1);
    await one(db, claire, `select remove_push_device($1)`, [id]);
    await one(db, claire, `select remove_push_endpoint($1)`, [mine]);
    expect(await devices(bruno)).toHaveLength(1);
    for (const sql of [
      `select * from push_subscriptions`,
      `select * from push_outbox`,
      `select * from push_config`,
      `select push_subscription_save('${claire}', 'https://fcm.googleapis.com/fcm/send/x-1', '${P256}', '${AUTH}', 'x')`,
      `select * from push_outbox_claim(10)`,
      `select push_subscription_result('${id}', false, true)`,
    ]) {
      await expectError(as(db, claire, sql), /permission denied/);
    }
    await expectError(as(db, null, `select * from my_push_devices()`), /permission denied/);
    await one(db, bruno, `select remove_push_endpoint($1)`, [mine]);
    expect(await devices(bruno)).toEqual([]);
  });

  it('compte supprimé : ses appareils et ses envois en attente disparaissent', async () => {
    await save(bruno);
    await request(claire, bruno);
    await db.query(`delete from auth.users where id = $1`, [bruno]);
    expect(await asService(db, `select * from push_subscriptions`)).toEqual([]);
    expect(await outbox()).toEqual([]);
  });
});

describe('mise à jour et retour arrière', () => {
  it('le retour arrière arrête la mise en file sans rien effacer ; la mise à jour se rejoue', async () => {
    await save(bruno);
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '..', 'sql', 'retour-20261030000001.sql'), 'utf8'));
    await request(claire, bruno);
    expect(await outbox()).toEqual([]);
    expect(await devices(bruno)).toHaveLength(1);
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '20261030000001_notifications_push.sql'), 'utf8'));
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '20261030000001_notifications_push.sql'), 'utf8'));
    await request(lea, bruno);
    expect(await outbox()).toHaveLength(1);
    expect(await devices(bruno)).toHaveLength(1);
  });
});

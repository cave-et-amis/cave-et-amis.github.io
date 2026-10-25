import { beforeEach, describe, expect, it } from 'vitest';
import { addWine, as, asService, befriend, createDb, createUser, expectError, one, rid, type Db } from '../helpers/db.ts';

let db: Db;
let bruno: string;
let claire: string;
let marc: string;
const nousClaire = '10000000-0000-4000-8000-00000000c1a1';
const nousMarc = '10000000-0000-4000-8000-0000000000aa';

beforeEach(async () => {
  db = await createDb();
  bruno = await createUser(db, 'Bruno');
  claire = await createUser(db, 'Claire');
  marc = await createUser(db, 'Marc');
  await befriend(db, bruno, claire);
  await befriend(db, bruno, marc);
});

type Row = { id: number; op: string; user_id: string; nous_user_id: string; event_id: string | null; generation: number; attempts: number };

const pending = () => asService<Row & { sent_at: string | null }>(db, `select * from nous_outbox where sent_at is null order by id`);

async function link(user: string, nousUser: string) {
  const code = (await one<{ c: string }>(db, user, `select nous_link_create() as c`)).c;
  const [r] = await asService<{ r: { cave_user_id: string; display_name: string } }>(db, `select nous_link_redeem($1, $2, 'Nous') as r`, [code, nousUser]);
  return r.r;
}

async function createDinner(organizer: string, guests: string[], startsAt = new Date(Date.now() + 7 * 86400_000).toISOString()) {
  const ev = await one<{ r: { id: string } }>(db, organizer, `select to_json(create_event($1::jsonb, $2::uuid[])) as r`, [
    JSON.stringify({ kind: 'degustation', title: 'Dégustation Bourgogne', starts_at: startsAt, place: '3 rue des Vignes, Beaune', budget: 80 }),
    `{${guests.join(',')}}`,
  ]);
  return ev.r.id;
}

/** Marque tous les envois en attente comme faits (comme après un passage réussi de nous_flush). */
async function flushAll() {
  const rows = await asService<Row>(db, `select * from nous_outbox_claim(200)`);
  for (const r of rows) await asService(db, `select nous_outbox_done($1, $2, true)`, [r.id, r.generation]);
  return rows;
}

describe('intégration Nous : liaison', () => {
  it('code à usage unique, haché, 30 minutes ; une seule liaison de chaque côté', async () => {
    const code = (await one<{ c: string }>(db, claire, `select nous_link_create() as c`)).c;
    expect(code).toMatch(/^[0-9a-f]{32}$/);
    const stored = await asService<{ code_hash: string }>(db, `select code_hash from nous_link_codes`);
    expect(stored[0].code_hash).not.toBe(code);
    // Aperçu pour pré-remplir l'inscription.
    const [peek] = await asService<{ r: { display_name: string; email: string } }>(db, `select nous_link_peek($1) as r`, [code]);
    expect(peek.r.display_name).toBe('Claire');
    expect(peek.r.email).toContain('claire');
    const r = (await asService<{ r: { cave_user_id: string } }>(db, `select nous_link_redeem($1, $2, 'Claire N.') as r`, [code, nousClaire]))[0].r;
    expect(r.cave_user_id).toBe(claire);
    // Le code ne sert qu'une fois.
    await expectError(asService(db, `select nous_link_redeem($1, $2, null)`, [code, nousMarc]), /invalid_code/);
    await expectError(asService(db, `select nous_link_peek($1)`, [code]), /invalid_code/);
    // Déjà liée : plus de nouveau code.
    await expectError(one(db, claire, `select nous_link_create()`), /already_linked/);
    // Le compte Nous de Claire ne peut pas être lié à Marc.
    const codeMarc = (await one<{ c: string }>(db, marc, `select nous_link_create() as c`)).c;
    await expectError(asService(db, `select nous_link_redeem($1, $2, null)`, [codeMarc, nousClaire]), /nous_already_linked/);
  });

  it('code expiré refusé ; chacun ne voit que sa liaison ; les utilisateurs n’accèdent ni aux codes ni à la file', async () => {
    const code = (await one<{ c: string }>(db, claire, `select nous_link_create() as c`)).c;
    await asService(db, `update nous_link_codes set expires_at = now() - interval '1 minute'`);
    await expectError(asService(db, `select nous_link_redeem($1, $2, null)`, [code, nousClaire]), /invalid_code/);
    await link(claire, nousClaire);
    expect(await as(db, claire, `select user_id from nous_links`)).toEqual([{ user_id: claire }]);
    expect(await as(db, bruno, `select * from nous_links`)).toEqual([]);
    await expectError(as(db, claire, `select * from nous_link_codes`), /permission denied/);
    await expectError(as(db, claire, `select * from nous_outbox`), /permission denied/);
    await expectError(as(db, claire, `select * from nous_config`), /permission denied/);
    await expectError(as(db, claire, `select nous_link_redeem('x', $1, null)`, [nousClaire]), /permission denied/);
    await expectError(as(db, claire, `select nous_respond($1, $2, $1, 'yes')`, [claire, nousClaire]), /permission denied/);
    await expectError(as(db, claire, `insert into nous_links (user_id, nous_user_id) values ($1, $2)`, [claire, nousMarc]), /permission denied/);
  });

  it('dix codes par heure au plus', async () => {
    for (let i = 0; i < 10; i++) await one(db, marc, `select nous_link_create()`);
    await expectError(one(db, marc, `select nous_link_create()`), /too_many_attempts/);
  });
});

describe('intégration Nous : file d’envoi', () => {
  it('rien n’est mis en file pour les personnes non liées', async () => {
    await createDinner(bruno, [claire, marc]);
    expect(await pending()).toEqual([]);
  });

  it('création, modification, réponse, bouteilles, annulation : une seule ligne en attente par personne liée', async () => {
    await link(claire, nousClaire);
    const ev = await createDinner(bruno, [claire, marc]);
    let rows = await pending();
    expect(rows.map((r) => [r.op, r.user_id, r.nous_user_id, r.event_id])).toEqual([['upsert', claire, nousClaire, ev]]);
    await flushAll();
    expect(await pending()).toEqual([]);

    // Changement d'horaire et de lieu.
    await as(db, bruno, `update events set starts_at = starts_at + interval '1 hour', place = 'Chez Claire' where id = $1`, [ev]);
    rows = await pending();
    expect(rows).toHaveLength(1);
    // Une modification sans effet visible (budget) n'envoie rien de plus.
    await flushAll();
    await as(db, bruno, `update events set budget = 120 where id = $1`, [ev]);
    expect(await pending()).toEqual([]);

    // Réponse de Marc (non lié) : Claire voit la liste changer.
    await one(db, marc, `select respond_event($1, 'maybe')`, [ev]);
    expect(await pending()).toHaveLength(1);
    await flushAll();

    // Bouteille proposée.
    const { lotId } = await addWine(db, marc, { name: 'Volnay', vintage: 2017, color: 'rouge' }, { quantity: 2, purchase_price: 45 });
    await one(db, marc, `select propose_event_wine($1, $2, 1, null, true, $3)`, [ev, lotId, rid()]);
    expect(await pending()).toHaveLength(1);

    // Plusieurs changements avant l'envoi : regroupés (génération incrémentée).
    await one(db, bruno, `select cancel_event($1)`, [ev]);
    rows = await pending();
    expect(rows).toHaveLength(1);
    expect(rows[0].generation).toBeGreaterThan(1);
  });

  it('contenu : ce que la personne voit dans Cave & Amis, sans budget ni prix', async () => {
    await link(claire, nousClaire);
    const ev = await createDinner(bruno, [claire]);
    const { lotId } = await addWine(db, bruno, { name: 'Corton', producer: 'Domaine X', vintage: 2015, color: 'rouge' }, { quantity: 3, purchase_price: 90 });
    await one(db, bruno, `select propose_event_wine($1, $2, 2, null, true, $3)`, [ev, lotId, rid()]);
    const [p] = await asService<{ p: Record<string, unknown> }>(db, `select nous_event_payload($1, $2) as p`, [ev, claire]);
    expect(p.p).toMatchObject({
      kind: 'degustation',
      title: 'Dégustation Bourgogne',
      status: 'planned',
      place: '3 rue des Vignes, Beaune',
      timezone: 'Europe/Paris',
      organizer_name: 'Bruno',
      is_organizer: false,
      my_rsvp: 'pending',
    });
    const durationMin = (Date.parse(p.p.ends_at as string) - Date.parse(p.p.starts_at as string)) / 60000;
    expect(durationMin).toBe(150);
    expect(p.p.participants).toEqual([
      { name: 'Bruno', role: 'organizer', rsvp: 'yes' },
      { name: 'Claire', role: 'guest', rsvp: 'pending' },
    ]);
    expect(p.p.wines).toEqual([{ name: 'Corton', producer: 'Domaine X', vintage: 2015, color: 'rouge', quantity: 2, status: 'confirmed', owner_name: 'Bruno' }]);
    const text = JSON.stringify(p.p);
    expect(text).not.toContain('budget');
    expect(text).not.toContain('90');
    // Personne qui n'est pas participante : rien.
    const [none] = await asService<{ p: unknown }>(db, `select nous_event_payload($1, $2) as p`, [ev, marc]);
    expect(none.p).toBeNull();
  });

  it('participant retiré ou événement supprimé : « remove » ; la suppression ne laisse pas d’« upsert »', async () => {
    await link(claire, nousClaire);
    await link(marc, nousMarc);
    const ev = await createDinner(bruno, [claire, marc]);
    await flushAll();
    await one(db, bruno, `select remove_participant($1, $2)`, [ev, marc]);
    let rows = await pending();
    expect(rows.map((r) => [r.op, r.user_id]).sort()).toEqual([
      ['remove', marc],
      ['upsert', claire],
    ].sort());
    await flushAll();
    await one(db, bruno, `select delete_event($1)`, [ev]);
    rows = await pending();
    expect(rows.map((r) => [r.op, r.user_id, r.event_id])).toEqual([['remove', claire, ev]]);
  });

  it('liaison : envoi des événements récents et à venir ; suspension et reprise', async () => {
    const past = await createDinner(bruno, [claire], new Date(Date.now() - 60 * 86400_000).toISOString());
    const soon = await createDinner(bruno, [claire]);
    expect(await pending()).toEqual([]);
    await link(claire, nousClaire);
    let rows = await pending();
    expect(rows.map((r) => r.event_id)).toEqual([soon]);
    expect(rows.map((r) => r.event_id)).not.toContain(past);
    await flushAll();
    await one(db, claire, `select nous_set_sync(false)`);
    await as(db, bruno, `update events set title = 'Nouvelle date' where id = $1`, [soon]);
    expect(await pending()).toEqual([]);
    await one(db, claire, `select nous_set_sync(true)`);
    rows = await pending();
    expect(rows.map((r) => [r.op, r.event_id])).toEqual([['upsert', soon]]);
    await expectError(one(db, marc, `select nous_set_sync(true)`), /not_linked/);
  });

  it('délier : Nous est prévenu, sauf si c’est Nous qui l’annonce ; suppression du compte : idem', async () => {
    await link(claire, nousClaire);
    await createDinner(bruno, [claire]);
    await one(db, claire, `select nous_unlink()`);
    let rows = await pending();
    expect(rows.map((r) => [r.op, r.user_id, r.nous_user_id])).toEqual([['unlink', claire, nousClaire]]);
    await flushAll();

    await link(claire, nousClaire);
    await flushAll();
    const [r] = await asService<{ r: boolean }>(db, `select nous_link_revoked($1, $2) as r`, [claire, nousClaire]);
    expect(r.r).toBe(true);
    expect(await pending()).toEqual([]);
    expect((await asService<{ r: boolean }>(db, `select nous_link_revoked($1, $2) as r`, [claire, nousClaire]))[0].r).toBe(false);

    await link(marc, nousMarc);
    await flushAll();
    await db.query(`delete from auth.users where id = $1`, [marc]);
    rows = await pending();
    expect(rows.map((x) => [x.op, x.nous_user_id])).toEqual([['unlink', nousMarc]]);
  });

  it('échecs : délai croissant, abandon après 20 tentatives ; un changement pendant l’envoi le fait repartir', async () => {
    await link(claire, nousClaire);
    const ev = await createDinner(bruno, [claire]);
    const [row] = await asService<Row>(db, `select * from nous_outbox_claim(10)`);
    // Pris : plus dû pendant une minute.
    expect(await asService(db, `select * from nous_outbox_claim(10)`)).toEqual([]);
    await asService(db, `select nous_outbox_done($1, $2, false, 'réseau')`, [row.id, row.generation]);
    const [after] = await asService<{ attempts: number; due_in: number; last_error: string }>(
      db,
      `select attempts, extract(epoch from next_attempt_at - now())::int as due_in, last_error from nous_outbox where id = $1`,
      [row.id],
    );
    expect(after).toMatchObject({ attempts: 1, last_error: 'réseau' });
    expect(after.due_in).toBeGreaterThanOrEqual(55);

    // Changement arrivé pendant un envoi réussi : la ligne reste à envoyer.
    await asService(db, `update nous_outbox set next_attempt_at = now() where id = $1`, [row.id]);
    const [again] = await asService<Row>(db, `select * from nous_outbox_claim(10)`);
    await as(db, bruno, `update events set title = 'Changé' where id = $1`, [ev]);
    await asService(db, `select nous_outbox_done($1, $2, true)`, [again.id, again.generation]);
    expect(await pending()).toHaveLength(1);

    await asService(db, `update nous_outbox set attempts = 20, next_attempt_at = now()`);
    expect(await asService(db, `select * from nous_outbox_claim(10)`)).toEqual([]);
  });
});

describe('intégration Nous : réponses venues de Nous', () => {
  it('appliquées avec les règles de Cave & Amis, seulement pour une paire liée', async () => {
    await link(claire, nousClaire);
    const ev = await createDinner(bruno, [claire, marc]);
    await asService(db, `select nous_respond($1, $2, $3, 'yes')`, [claire, nousClaire, ev]);
    const parts = await as<{ rsvp: string }>(db, claire, `select rsvp from event_participants where user_id = $1`, [claire]);
    expect(parts[0].rsvp).toBe('yes');
    // Paire inconnue, personne non liée.
    await expectError(asService(db, `select nous_respond($1, $2, $3, 'no')`, [claire, nousMarc, ev]), /not_linked/);
    await expectError(asService(db, `select nous_respond($1, $2, $3, 'no')`, [marc, nousMarc, ev]), /not_linked/);
    // Événement annulé : refus.
    await one(db, bruno, `select cancel_event($1)`, [ev]);
    await expectError(asService(db, `select nous_respond($1, $2, $3, 'no')`, [claire, nousClaire, ev]), /event_not_planned/);
  });

  it('l’organisateur ne peut pas répondre « non » depuis Nous ; un non-participant non plus', async () => {
    await link(bruno, nousMarc);
    const ev = await createDinner(bruno, [claire]);
    await expectError(asService(db, `select nous_respond($1, $2, $3, 'no')`, [bruno, nousMarc, ev]), /organizer_must_attend/);
    const other = await createDinner(claire, []);
    await expectError(asService(db, `select nous_respond($1, $2, $3, 'yes')`, [bruno, nousMarc, other]), /not_participant/);
  });

  it('jeton du cron', async () => {
    const [{ t }] = await asService<{ t: string }>(db, `select cron_token as t from nous_config`);
    expect(t.length).toBeGreaterThanOrEqual(32);
    expect((await asService<{ ok: boolean }>(db, `select nous_cron_token_ok($1) as ok`, [t]))[0].ok).toBe(true);
    expect((await asService<{ ok: boolean }>(db, `select nous_cron_token_ok('mauvais') as ok`))[0].ok).toBe(false);
    expect((await asService<{ ok: boolean }>(db, `select nous_cron_token_ok(null) as ok`))[0].ok).toBe(false);
  });
});

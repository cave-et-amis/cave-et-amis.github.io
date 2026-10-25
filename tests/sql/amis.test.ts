import { beforeEach, describe, expect, it } from 'vitest';
import { as, befriend, createDb, createUser, expectError, one, type Db } from '../helpers/db.ts';

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

const visible = (id: string) => db.query(`update profiles set discoverable = true where id = $1`, [id]);
const search = (who: string, q: string) => as<{ id: string; display_name: string; relation: string }>(db, who, `select * from search_users($1)`, [q]);
const request = (who: string, to: string) => one<{ r: { status: string; id: string } }>(db, who, `select send_friend_request($1) as r`, [to]);
const notifs = (who: string) => as<{ kind: string; actor_name: string; ref_id: string; read_at: string | null }>(db, who, `select * from notifications order by created_at`);

describe('recherche d’amis', () => {
  it('invisible par défaut ; visible seulement si la personne l’a choisi ; 3 lettres minimum ; jamais soi-même', async () => {
    expect(await search(bruno, 'Claire')).toEqual([]);
    await visible(claire);
    await visible(bruno);
    expect((await search(bruno, 'clai')).map((r) => r.display_name)).toEqual(['Claire']);
    expect(await search(bruno, 'cl')).toEqual([]);
    expect(await search(bruno, 'Bruno')).toEqual([]);
    // Accents et majuscules ignorés ; caractères spéciaux sans effet.
    await db.query(`update profiles set display_name = 'Hélène' where id = $1`, [marc]);
    await visible(marc);
    expect((await search(bruno, 'HELE')).map((r) => r.display_name)).toEqual(['Hélène']);
    expect(await search(bruno, '%%%')).toEqual([]);
  });

  it('indique la relation : ami, demande envoyée, demande reçue', async () => {
    await visible(claire);
    await visible(marc);
    await befriend(db, bruno, marc);
    await request(bruno, claire);
    expect(Object.fromEntries((await search(bruno, 'mar')).concat(await search(bruno, 'cla')).map((r) => [r.display_name, r.relation]))).toMatchObject({
      Marc: 'friend',
      Claire: 'requested',
    });
    await visible(bruno);
    expect((await search(claire, 'bru'))[0].relation).toBe('incoming');
  });

  it('le profil d’un inconnu n’est pas lisible : seul le nom sort par la recherche', async () => {
    await visible(claire);
    expect(await as(db, bruno, `select * from profiles where id = $1`, [claire])).toEqual([]);
  });
});

describe('demandes d’ami', () => {
  it('envoyer, notifier, accepter : on devient amis, l’autre est prévenu', async () => {
    await visible(claire);
    const sent = await request(bruno, claire);
    expect(sent.r.status).toBe('requested');
    // Double clic : même demande.
    expect((await request(bruno, claire)).r.id).toBe(sent.r.id);
    expect(await notifs(claire)).toMatchObject([{ kind: 'friend_request', actor_name: 'Bruno', ref_id: sent.r.id }]);
    const mine = await as<{ direction: string; other_name: string }>(db, claire, `select * from my_friend_requests()`);
    expect(mine).toMatchObject([{ direction: 'in', other_name: 'Bruno' }]);
    expect((await one<{ r: { status: string } }>(db, claire, `select respond_friend_request($1, true) as r`, [sent.r.id])).r.status).toBe('accepted');
    expect((await one<{ r: { status: string } }>(db, claire, `select respond_friend_request($1, true) as r`, [sent.r.id])).r.status).toBe('accepted');
    expect((await as(db, bruno, `select * from friendships`)).length).toBe(1);
    expect(await notifs(bruno)).toMatchObject([{ kind: 'friend_accepted', actor_name: 'Claire' }]);
    // La notification reçue est marquée lue une fois la demande traitée.
    expect((await notifs(claire))[0].read_at).not.toBeNull();
    // Déjà amis.
    expect((await request(bruno, claire)).r.status).toBe('already_friends');
  });

  it('demandes croisées : la seconde vaut acceptation', async () => {
    await visible(claire);
    await visible(bruno);
    await request(bruno, claire);
    expect((await request(claire, bruno)).r.status).toBe('accepted');
    expect((await as(db, bruno, `select * from friendships`)).length).toBe(1);
  });

  it('personne non visible et jamais rencontrée : introuvable ; rencontrée lors d’un événement : possible', async () => {
    await expectError(request(claire, marc), /not_found/);
    // Claire et Marc, amis de Bruno, sont invités au même dîner.
    await befriend(db, bruno, claire);
    await befriend(db, bruno, marc);
    await one(db, bruno, `select create_event('{"title":"Dîner","starts_at":"2030-01-01T19:00:00Z"}'::jsonb, array[$1, $2]::uuid[])`, [claire, marc]);
    expect((await request(claire, marc)).r.status).toBe('requested');
  });

  it('refus : pas de nouvelle demande pendant 30 jours ; annulation ; 20 demandes par jour au plus', async () => {
    await visible(claire);
    const sent = await request(bruno, claire);
    await one(db, claire, `select respond_friend_request($1, false)`, [sent.r.id]);
    expect(await as(db, bruno, `select * from friendships`)).toEqual([]);
    await expectError(request(bruno, claire), /request_cooldown/);

    await visible(marc);
    const toMarc = await request(bruno, marc);
    await one(db, bruno, `select cancel_friend_request($1)`, [toMarc.r.id]);
    expect(await notifs(marc)).toEqual([]);
    expect(await as(db, marc, `select * from my_friend_requests()`)).toEqual([]);

    // Quota : 18 demandes de plus (2 déjà faites aujourd'hui), la 21e est refusée.
    for (let i = 0; i < 19; i++) {
      const u = await createUser(db, `Ami${i}`);
      await visible(u);
      if (i < 18) await request(bruno, u);
      else await expectError(request(bruno, u), /too_many_requests/);
    }
  });

  it('seul le destinataire répond ; seul l’auteur annule', async () => {
    await visible(claire);
    const sent = await request(bruno, claire);
    await expectError(one(db, marc, `select respond_friend_request($1, true)`, [sent.r.id]), /not_found/);
    await expectError(one(db, bruno, `select respond_friend_request($1, true)`, [sent.r.id]), /not_found/);
    await one(db, marc, `select cancel_friend_request($1)`, [sent.r.id]);
    expect((await as(db, claire, `select * from my_friend_requests()`)).length).toBe(1);
  });
});

describe('blocage', () => {
  it('supprime l’amitié et les demandes ; invisible dans la recherche ; plus de demande ni d’invitation possible', async () => {
    await befriend(db, bruno, claire);
    await visible(bruno);
    await one(db, claire, `select block_user($1)`, [bruno]);
    expect(await as(db, bruno, `select * from friendships`)).toEqual([]);
    expect(await search(claire, 'bru')).toEqual([]);
    await visible(claire);
    expect(await search(bruno, 'cla')).toEqual([]);
    // Le blocage n'est pas révélé : « introuvable ».
    await expectError(request(bruno, claire), /not_found/);
    const inv = await one<{ r: { code: string } }>(db, bruno, `select create_friend_invite() as r`);
    await expectError(one(db, claire, `select respond_friend_invite($1, true)`, [inv.r.code]), /invite_invalid/);
    expect(await as<{ display_name: string }>(db, claire, `select * from my_blocks()`)).toMatchObject([{ display_name: 'Bruno' }]);
    // Bruno ne voit pas qu'il est bloqué.
    expect(await as(db, bruno, `select * from blocks`)).toEqual([]);
    // Débloquer : de nouveau trouvable.
    await one(db, claire, `select unblock_user($1)`, [bruno]);
    expect((await search(claire, 'bru')).length).toBe(1);
  });

  it('une demande en attente est annulée et sa notification effacée', async () => {
    await visible(claire);
    await request(bruno, claire);
    await one(db, claire, `select block_user($1)`, [bruno]);
    expect(await notifs(claire)).toEqual([]);
    expect(await as(db, claire, `select * from my_friend_requests()`)).toEqual([]);
  });
});

describe('notifications', () => {
  it('invitation à un événement ; tout marquer comme lu ; chacun ne voit que les siennes', async () => {
    await befriend(db, bruno, claire);
    await one(db, bruno, `select create_event('{"title":"Dîner","starts_at":"2030-01-01T19:00:00Z"}'::jsonb, array[$1]::uuid[])`, [claire]);
    expect(await notifs(claire)).toMatchObject([{ kind: 'event_invite', actor_name: 'Bruno' }]);
    // Bruno a seulement été prévenu que Claire avait accepté son lien d'invitation.
    expect((await notifs(bruno)).map((n) => n.kind)).toEqual(['friend_accepted']);
    expect(await as(db, marc, `select * from notifications`)).toEqual([]);
    await one(db, claire, `select mark_notifications_read()`);
    expect((await notifs(claire))[0].read_at).not.toBeNull();
  });

  it('le navigateur ne peut ni créer ni modifier le contenu d’une notification', async () => {
    await expectError(as(db, bruno, `insert into notifications (user_id, kind) values ($1, 'friend_request')`, [claire]), /permission denied/);
    await visible(claire);
    await request(bruno, claire);
    await expectError(as(db, claire, `update notifications set kind = 'event_invite'`), /permission denied/);
    await expectError(as(db, bruno, `select notify($1, 'friend_request', $2, null)`, [claire, bruno]), /permission denied/);
  });
});

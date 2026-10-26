import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, addWine, as, asService, befriend, createDb, createUser, expectError, one, type Db } from '../helpers/db.ts';

let db: Db;
let bruno: string; // premier compte : administrateur
let claire: string;

beforeEach(async () => {
  db = await createDb();
  bruno = await createUser(db, 'Bruno');
  claire = await createUser(db, 'Claire');
});

const publish = (kind: string, o: { title?: string; content?: string; summary?: string; required?: boolean; who?: string } = {}) =>
  one<{ id: string }>(db, o.who ?? bruno, `select admin_legal_publish($1, $2, $3, $4, $5) as id`, [
    kind,
    o.title ?? `Titre ${kind}`,
    o.content ?? `Texte ${kind}`,
    o.summary ?? '',
    o.required ?? false,
  ]).then((r) => r.id);
const pending = (who: string) =>
  as<{ kind: string; version: number; mode: string }>(db, who, `select kind, version, mode from legal_pending() order by kind`);
const accept = (who: string, doc: string, action = 'acceptation', context = 'connexion') =>
  one(db, who, `select legal_accept($1, $2, $3)`, [doc, action, context]);
const count = async (from: string, params: unknown[] = []) => (await asService<{ n: number }>(db, `select count(*)::int as n from ${from}`, params))[0].n;
/** Session avec des informations de jeton choisies (niveau de double authentification). */
const withClaims = (who: string, claims: Record<string, unknown>, sql: string, params: unknown[] = []) =>
  db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)`, [who, JSON.stringify({ sub: who, ...claims })]);
    await tx.exec('set local role authenticated');
    return (await tx.query(sql, params)).rows;
  });

describe('documents légaux (modèle commun avec Cocon)', () => {
  it('publication : administrateur seulement, sans emplacement à compléter, numérotée, empreinte calculée, jamais modifiable', async () => {
    await expectError(publish('cgu', { who: claire }), /forbidden/);
    await expectError(publish('mentions', { content: 'Éditeur : [À COMPLÉTER : nom]' }), /legal_placeholders/);
    await expectError(publish('mentions', { content: 'Option [À VALIDER : anonymat]' }), /legal_placeholders/);
    await expectError(publish('confidentialite', { required: true }), /legal_invalid/);
    await expectError(publish('autre'), /legal_invalid/);

    const v1 = await publish('cgu', { content: 'Conditions — version 1', required: false });
    const v2 = await publish('cgu', { content: 'Conditions — version 2', summary: 'Précisions' });
    const docs = await asService<{ id: string; version: number; requires_acceptance: boolean; content_sha256: string; published_by: string }>(
      db,
      `select id, version, requires_acceptance, content_sha256, published_by from legal_documents order by version`,
    );
    // Les premières conditions sont toujours à accepter, même si la case n'était pas cochée.
    expect(docs.map((d) => [d.id, d.version, d.requires_acceptance])).toEqual([
      [v1, 1, true],
      [v2, 2, false],
    ]);
    expect(docs[0].content_sha256).toBe(createHash('sha256').update('Conditions — version 1', 'utf8').digest('hex'));
    expect(docs[0].published_by).toBe(bruno);

    // Lisibles sans compte : dernière version de chaque document.
    expect(await as(db, null, `select kind, version, title from legal_current()`)).toEqual([{ kind: 'cgu', version: 2, title: 'Titre cgu' }]);
    // Aucun accès direct aux tables, et un document publié ne change plus.
    await expectError(as(db, claire, `select * from legal_documents`), /permission denied/);
    await expectError(as(db, claire, `select * from legal_acceptances`), /permission denied/);
    await expectError(as(db, null, `select admin_legal_stats()`), /permission denied/);
    await expectError(asService(db, `update legal_documents set content = 'autre' where id = $1`, [v1]), /legal_immutable/);
    await expectError(asService(db, `delete from legal_documents where id = $1`, [v1]), /legal_immutable/);
  });

  it('double authentification : dès qu’elle est activée, la publication demande une session vérifiée par le code', async () => {
    await db.query(`insert into auth.mfa_factors (user_id, status) values ($1, 'unverified')`, [bruno]);
    expect(await publish('cookies')).toBeTruthy();
    await db.query(`insert into auth.mfa_factors (user_id, status) values ($1, 'verified')`, [bruno]);
    await expectError(publish('cookies'), /mfa_required/);
    await expectError(withClaims(bruno, { aal: 'aal1' }, `select admin_legal_publish('cookies', 'Cookies', 'Texte', '', false)`), /mfa_required/);
    const rows = await withClaims(bruno, { aal: 'aal2' }, `select admin_legal_publish('cookies', 'Cookies', 'Texte 2', '', false) as id`);
    expect(rows).toHaveLength(1);
    expect(await count(`legal_documents where kind = 'cookies'`)).toBe(2);
  });

  it('comptes existants : conditions à accepter, politique à lire ; le silence ne vaut pas acceptation', async () => {
    const cgu1 = await publish('cgu');
    const pol1 = await publish('confidentialite');
    expect(await pending(claire)).toEqual([
      { kind: 'cgu', version: 1, mode: 'acceptation' },
      { kind: 'confidentialite', version: 1, mode: 'information' },
    ]);
    // Avoir lu n'est pas accepter.
    await accept(claire, cgu1, 'prise_de_connaissance');
    expect((await pending(claire))[0]).toMatchObject({ kind: 'cgu', mode: 'acceptation' });
    await accept(claire, cgu1, 'acceptation');
    await accept(claire, cgu1, 'acceptation');
    expect(await count(`legal_acceptances where user_id = $1 and action = 'acceptation'`, [claire])).toBe(1);
    // La politique s'informe, elle ne s'accepte pas.
    await expectError(accept(claire, pol1, 'acceptation'), /invalid/);
    await expectError(accept(claire, pol1, 'prise_de_connaissance', 'ailleurs'), /invalid/);
    await accept(claire, pol1, 'prise_de_connaissance');
    expect(await pending(claire)).toEqual([]);

    // Changement mineur : simple information ; changement important : nouvelle acceptation.
    const cgu2 = await publish('cgu');
    expect(await pending(claire)).toEqual([{ kind: 'cgu', version: 2, mode: 'information' }]);
    await accept(claire, cgu2, 'prise_de_connaissance');
    expect(await pending(claire)).toEqual([]);
    await publish('cgu', { required: true });
    expect(await pending(claire)).toEqual([{ kind: 'cgu', version: 3, mode: 'acceptation' }]);
    // Bruno n'a rien accepté : la version 3 (la dernière qui l'exige) suffit, pas besoin des précédentes.
    expect(await pending(bruno)).toEqual([
      { kind: 'cgu', version: 3, mode: 'acceptation' },
      { kind: 'confidentialite', version: 1, mode: 'information' },
    ]);
    await expectError(as(db, null, `select * from legal_pending()`), /permission denied/);

    const history = await one<{ h: { acceptances: { kind: string; version: number; action: string; context: string }[] } }>(
      db,
      claire,
      `select my_legal_history() as h`,
    );
    expect(history.h.acceptances.map((a) => [a.kind, a.version, a.action])).toEqual([
      ['cgu', 2, 'prise_de_connaissance'],
      ['confidentialite', 1, 'prise_de_connaissance'],
      ['cgu', 1, 'acceptation'],
      ['cgu', 1, 'prise_de_connaissance'],
    ]);
    const stats = await as<{ kind: string; version: number; acceptances: number; acknowledgments: number }>(
      db,
      bruno,
      `select kind, version, acceptances, acknowledgments from admin_legal_stats() where kind = 'cgu' order by version`,
    );
    expect(stats).toEqual([
      { kind: 'cgu', version: 1, acceptances: 1, acknowledgments: 1 },
      { kind: 'cgu', version: 2, acceptances: 0, acknowledgments: 1 },
      { kind: 'cgu', version: 3, acceptances: 0, acknowledgments: 0 },
    ]);
    await expectError(as(db, claire, `select * from admin_legal_stats()`), /forbidden/);
  });

  it('inscription : la version des conditions acceptée et la politique présentée sont notées avec le compte', async () => {
    await publish('cgu');
    await publish('confidentialite');
    const lea = '00000000-0000-4000-8000-0000000000aa';
    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'lea@exemple.test', $2)`, [
      lea,
      JSON.stringify({ display_name: 'Léa', cgu_version: '1', confidentialite_version: '1' }),
    ]);
    expect(await asService(db, `select version, context, action from legal_acceptances where user_id = $1 order by id`, [lea])).toEqual([
      { version: 1, context: 'inscription', action: 'acceptation' },
      { version: 1, context: 'inscription', action: 'prise_de_connaissance' },
    ]);
    expect(await pending(lea)).toEqual([]);
    // Une version inconnue n'est jamais notée : la fenêtre s'ouvrira à la connexion.
    const tom = '00000000-0000-4000-8000-0000000000ab';
    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'tom@exemple.test', $2)`, [
      tom,
      JSON.stringify({ display_name: 'Tom', cgu_version: '9', confidentialite_version: 'x' }),
    ]);
    expect(await count(`legal_acceptances where user_id = $1`, [tom])).toBe(0);
    expect((await pending(tom)).map((p) => p.mode)).toEqual(['acceptation', 'information']);
    expect(await as(db, tom, `select display_name from profiles where id = auth.uid()`)).toEqual([{ display_name: 'Tom' }]);
  });

  it('preuves en ajout seul, gardées 5 ans après la suppression du compte, puis effacées', async () => {
    const cgu = await publish('cgu');
    await accept(claire, cgu);
    await one(db, claire, `select consent_set('recherche_amis', true, 'reglages')`);
    await expectError(as(db, claire, `update legal_acceptances set context = 'reglages'`), /permission denied/);
    await expectError(asService(db, `update legal_acceptances set context = 'reglages' where user_id = $1`, [claire]), /legal_immutable/);
    await expectError(asService(db, `delete from legal_acceptances where user_id = $1`, [claire]), /legal_immutable/);
    await expectError(asService(db, `delete from user_consents where user_id = $1`, [claire]), /legal_immutable/);

    await db.query(`delete from auth.users where id = $1`, [claire]);
    expect(await count(`profiles where id = $1`, [claire])).toBe(0);
    expect(await asService(db, `select action, (account_deleted_at is not null) as marked from legal_acceptances where user_id = $1`, [claire])).toEqual([
      { action: 'acceptation', marked: true },
    ]);
    expect(await count(`user_consents where user_id = $1 and account_deleted_at is not null`, [claire])).toBe(1);
    // La date de suppression ne se pose qu'une fois.
    await expectError(asService(db, `update legal_acceptances set account_deleted_at = now() - interval '9 years' where user_id = $1`, [claire]), /legal_immutable/);

    // 5 ans plus tard : effacées. Un compte disparu autrement est rattrapé (le délai commence).
    const old = '00000000-0000-4000-8000-0000000000ee';
    const ghost = '00000000-0000-4000-8000-0000000000ef';
    await db.query(
      `insert into legal_acceptances (user_id, document_id, version, context, action, account_deleted_at)
       values ($1, $3, 1, 'connexion', 'acceptation', now() - interval '5 years 1 day'),
              ($2, $3, 1, 'connexion', 'acceptation', null)`,
      [old, ghost, cgu],
    );
    await db.query(`insert into user_consents (user_id, purpose, granted, account_deleted_at) values ($1, 'recherche_amis', true, now() - interval '6 years')`, [old]);
    const res = await asService<{ r: Record<string, number> }>(db, `select retention_purge() as r`);
    expect(res[0].r).toMatchObject({ legal_acceptances: 1, user_consents: 1 });
    expect(await count(`legal_acceptances where user_id = $1`, [old])).toBe(0);
    expect(await count(`legal_acceptances where user_id = $1 and account_deleted_at is not null`, [claire])).toBe(1);
    expect(await count(`legal_acceptances where user_id = $1 and account_deleted_at is not null`, [ghost])).toBe(1);
  });

  it('consentements : recherche d’amis et agenda Nous, jamais donnés d’avance, avec historique', async () => {
    const current = async () => (await one<{ h: { current: Record<string, boolean> } }>(db, claire, `select my_legal_history() as h`)).h.current;
    expect(await current()).toEqual({});
    // Réglage de l'application (mise à jour du profil) puis fonction commune.
    await as(db, claire, `update profiles set discoverable = true where id = auth.uid()`);
    await one(db, claire, `select consent_set('recherche_amis', false, 'reglages')`);
    expect(await as(db, claire, `select discoverable from profiles where id = auth.uid()`)).toEqual([{ discoverable: false }]);
    await one(db, claire, `select consent_set('recherche_amis', false, 'reglages')`);
    expect(await asService(db, `select purpose, granted, context from user_consents where user_id = $1 order by id`, [claire])).toEqual([
      { purpose: 'recherche_amis', granted: true, context: 'reglages' },
      { purpose: 'recherche_amis', granted: false, context: 'reglages' },
    ]);
    await expectError(one(db, claire, `select consent_set('liaison_nous', true, 'reglages')`), /invalid/);
    await expectError(one(db, claire, `select consent_set('recherche_amis', true, 'ailleurs')`), /invalid/);
    await expectError(as(db, null, `select consent_set('recherche_amis', true, 'reglages')`), /permission denied/);

    // Agenda Nous : la liaison et la déliaison sont notées.
    await asService(db, `insert into nous_links (user_id, nous_user_id, nous_display_name) values ($1, gen_random_uuid(), 'Claire')`, [claire]);
    await asService(db, `delete from nous_links where user_id = $1`, [claire]);
    expect(await current()).toEqual({ recherche_amis: false, liaison_nous: false });
    // Suppression du compte relié : pas de nouvelle ligne, tout part dans le délai de 5 ans.
    await asService(db, `insert into nous_links (user_id, nous_user_id, nous_display_name) values ($1, gen_random_uuid(), 'Claire')`, [claire]);
    const before = await count(`user_consents where user_id = $1`, [claire]);
    await db.query(`delete from auth.users where id = $1`, [claire]);
    expect(await count(`user_consents where user_id = $1`, [claire])).toBe(before);
    expect(await count(`user_consents where user_id = $1 and account_deleted_at is null`, [claire])).toBe(0);
  });
});

describe('export complet de ses données', () => {
  it('mes données, rien de secret, rien de privé chez les autres', async () => {
    await befriend(db, bruno, claire);
    await addWine(db, claire, { name: 'Morgon Côte du Py', notes: 'Pour les 40 ans' });
    await addWine(db, bruno, { name: 'Pomerol secret de Bruno' });
    const inv = await one<{ r: { id: string } }>(db, claire, `select create_invite('discovery') as r`);
    await db.query(`update friend_invites set note = 'Pour Léa' where id = $1`, [inv.r.id]);
    const conv = await asService<{ id: string }>(db, `insert into ai_conversations (user_id, title) values ($1, 'Accord') returning id`, [claire]);
    await asService(db, `insert into ai_messages (conversation_id, user_id, role, content) values ($1, $2, 'user', 'Quel vin avec un gigot ?')`, [conv[0].id, claire]);
    await db.query(`insert into storage.objects (bucket_id, name) values ('photos', $1), ('photos', $2)`, [`${claire}/etiquette.jpg`, `${bruno}/autre.jpg`]);
    await one(db, claire, `select consent_set('recherche_amis', true, 'reglages')`);
    await asService(db, `insert into nous_links (user_id, nous_user_id, nous_display_name) values ($1, gen_random_uuid(), 'Claire (Nous)')`, [claire]);

    const ex = (await one<{ e: Record<string, unknown> }>(db, claire, `select export_my_data() as e`)).e as Record<string, any>;
    expect(ex.format).toBe('cave-export-v1');
    expect(ex.compte.email).toMatch(/^claire\.\d+@exemple\.test$/);
    expect(ex.compte.profil.display_name).toBe('Claire');
    expect(ex.vins.map((w: { name: string }) => w.name)).toEqual(['Morgon Côte du Py']);
    expect(ex.lots).toHaveLength(1);
    expect(ex.contacts).toEqual([expect.objectContaining({ prenom: 'Bruno' })]);
    expect(ex.liens_d_invitation).toEqual([expect.objectContaining({ note: 'Pour Léa', kind: 'discovery' })]);
    expect(ex.liens_d_invitation[0]).not.toHaveProperty('code');
    expect(ex.liens_d_invitation[0]).not.toHaveProperty('code_hash');
    expect(ex.assistant.conversations[0].messages).toEqual([expect.objectContaining({ role: 'user', texte: 'Quel vin avec un gigot ?' })]);
    expect(ex.photos).toEqual([`${claire}/etiquette.jpg`]);
    expect(ex.documents_et_consentements.current).toEqual({ recherche_amis: true, liaison_nous: true });
    // Liaison avec Nous : ses réglages, sans les identifiants techniques.
    expect(ex.agenda_nous).toMatchObject({ nous_display_name: 'Claire (Nous)', sync_enabled: true, allow_jump: false });
    expect(ex.agenda_nous).not.toHaveProperty('nous_user_id');
    const text = JSON.stringify(ex);
    expect(text).not.toContain('Pomerol secret de Bruno');
    expect(text).not.toContain(`${bruno}/autre.jpg`);
    await expectError(as(db, null, `select export_my_data()`), /permission denied/);
  });
});

describe('durées de conservation (validées le 26/10/2026)', () => {
  it('seules les données qui ont dépassé leur durée sont effacées', async () => {
    const { wineId } = await addWine(db, claire, { name: 'Chablis' });
    const ago = (interval: string) => `now() - interval '${interval}'`;
    // Conversations : 12 mois après le dernier message.
    await db.query(
      `insert into ai_conversations (user_id, title, created_at, updated_at) values
         ($1, 'ancienne', ${ago('14 months')}, ${ago('13 months')}),
         ($1, 'récente', ${ago('14 months')}, ${ago('11 months')})`,
      [claire],
    );
    // Journaux de l'IA : usage 13 mois, erreurs 3 mois.
    await db.query(
      `insert into ai_usage (user_id, action, model, status, created_at) values
         ($1, 'chat', 'm', 'done', ${ago('14 months')}), ($1, 'chat', 'm', 'done', ${ago('12 months')})`,
      [claire],
    );
    await db.query(`insert into ai_errors (user_id, action, code, created_at) values ($1, 'chat', 'x', ${ago('4 months')}), ($1, 'chat', 'x', ${ago('2 months')})`, [claire]);
    // Relevés de prix : 24 mois.
    await db.query(
      `insert into price_checks (user_id, wine_id, volume_ml, status, created_at) values
         ($1, $2, 750, 'unverified', ${ago('25 months')}), ($1, $2, 750, 'unverified', ${ago('23 months')})`,
      [claire, wineId],
    );
    // Invitations : expirées ou révoquées depuis plus de 90 jours.
    for (const [status, expires] of [
      ['pending', ago('91 days')],
      ['pending', ago('89 days')],
      ['revoked', 'now() + interval \'10 days\''],
    ] as const) {
      const r = await one<{ r: { id: string } }>(db, claire, `select create_invite('discovery') as r`);
      await db.query(`update friend_invites set status = $2, expires_at = ${expires}, created_at = ${ago('100 days')} where id = $1`, [r.r.id, status]);
    }
    // Demandes refusées : 6 mois.
    await db.query(
      `insert into friend_requests (from_id, to_id, status, created_at, responded_at) values
         ($1, $2, 'declined', ${ago('8 months')}, ${ago('7 months')}), ($2, $1, 'declined', ${ago('6 months')}, ${ago('5 months')})`,
      [claire, bruno],
    );
    await db.query(
      `insert into cellar_access_requests (from_id, to_id, status, created_at, responded_at) values ($1, $2, 'declined', ${ago('8 months')}, ${ago('7 months')})`,
      [claire, bruno],
    );
    // Visites de magasin vides : 30 jours.
    await db.query(`insert into scan_visits (user_id, store_name, created_at) values ($1, 'Cave A', ${ago('31 days')}), ($1, 'Cave B', ${ago('29 days')})`, [claire]);
    // Appareils de notification : 90 jours d'échec.
    await db.query(
      `insert into push_subscriptions (user_id, endpoint, p256dh, auth, label, created_at, last_success_at, failures) values
         ($1, 'https://fcm.googleapis.com/fcm/send/vieux', $2, $3, 'Ancien', ${ago('200 days')}, ${ago('91 days')}, 3),
         ($1, 'https://fcm.googleapis.com/fcm/send/actif', $2, $3, 'Actif', ${ago('200 days')}, ${ago('100 days')}, 0)`,
      [claire, `B${'a'.repeat(86)}`, 'a'.repeat(22)],
    );

    // Aperçu en lecture seule (supabase/sql/conservation-apercu.sql), comme dans le SQL Editor.
    const apercu = readFileSync(join(MIGRATIONS_DIR, '..', 'sql', 'conservation-apercu.sql'), 'utf8');
    const preview = Object.fromEntries((await db.query<{ cle: string; a_effacer: number }>(apercu)).rows.map((r) => [r.cle, r.a_effacer]));

    await expectError(as(db, claire, `select retention_purge()`), /permission denied/);
    const res = await asService<{ r: Record<string, number> }>(db, `select retention_purge() as r`);
    // L'aperçu n'avait rien effacé, et annonçait exactement ce que la purge efface.
    for (const [key, n] of Object.entries(res[0].r)) expect(preview[key], key).toBe(n);
    expect(res[0].r).toMatchObject({
      conversations: 1,
      ai_usage: 1,
      ai_errors: 1,
      price_checks: 1,
      invites: 2,
      friend_requests: 1,
      access_requests: 1,
      scan_visits: 1,
      push_devices: 1,
    });
    expect(await as(db, claire, `select title from ai_conversations`)).toEqual([{ title: 'récente' }]);
    expect(await count(`ai_usage where user_id = $1`, [claire])).toBe(1);
    expect(await count(`ai_errors where user_id = $1`, [claire])).toBe(1);
    expect(await count(`price_checks where user_id = $1`, [claire])).toBe(1);
    expect(await count(`friend_invites where inviter_id = $1`, [claire])).toBe(1);
    expect((await db.query(`select 1 from friend_requests`)).rows).toHaveLength(1);
    expect((await db.query(`select 1 from cellar_access_requests`)).rows).toHaveLength(0);
    expect(await as(db, claire, `select store_name from scan_visits`)).toEqual([{ store_name: 'Cave B' }]);
    expect((await db.query(`select label from push_subscriptions`)).rows).toEqual([{ label: 'Actif' }]);
  });

  it('photos qui ne servent plus : seulement les fichiers de plus de 30 jours que rien ne cite', async () => {
    const path = (n: string) => `${claire}/${n}.jpg`;
    await addWine(db, claire, { name: 'Chablis', label_photo: path('etiquette') });
    await asService(db, `insert into scans (user_id, photos) values ($1, $2)`, [claire, JSON.stringify([{ path: path('rayon'), role: 'price' }])]);
    await db.query(
      `insert into storage.objects (bucket_id, name, created_at) values
         ('photos', $1, now() - interval '40 days'), ('photos', $2, now() - interval '40 days'),
         ('photos', $3, now() - interval '40 days'), ('photos', $4, now() - interval '2 days')`,
      [path('etiquette'), path('rayon'), path('oubliee'), path('en-cours')],
    );
    const names = (await asService<{ name: string }>(db, `select name from retention_orphan_photos(100) order by name`)).map((r) => r.name);
    expect(names).toEqual([path('oubliee')]);
    await expectError(as(db, claire, `select * from retention_orphan_photos(10)`), /permission denied/);
  });
});

describe('mise à jour et retour arrière', () => {
  it('le retour arrière rend l’état d’avant ; la mise à jour se rejoue sans danger', async () => {
    await publish('cgu');
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '..', 'sql', 'retour-20261101000001.sql'), 'utf8'));
    expect((await db.query<{ t: string | null }>(`select to_regclass('public.legal_documents')::text as t`)).rows[0].t).toBeNull();
    const marc = await createUser(db, 'Marc');
    expect(await as(db, marc, `select name from cellars`)).toEqual([{ name: 'Ma cave' }]);
    await as(db, marc, `update profiles set discoverable = true where id = auth.uid()`);

    const migration = readFileSync(join(MIGRATIONS_DIR, '20261101000001_documents_legaux.sql'), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    expect(await as(db, null, `select * from legal_current()`)).toEqual([]);
    const lea = await createUser(db, 'Léa');
    expect(await as(db, lea, `select name from cellars`)).toEqual([{ name: 'Ma cave' }]);
  });
});

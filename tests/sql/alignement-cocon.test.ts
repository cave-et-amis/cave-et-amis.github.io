import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, addWine, as, asAdmin, asService, befriend, createDb, createUser, expectError, one, type Db } from '../helpers/db.ts';

let db: Db;
let bruno: string; // premier compte : administrateur
let claire: string;

beforeEach(async () => {
  db = await createDb();
  bruno = await createUser(db, 'Bruno');
  claire = await createUser(db, 'Claire');
});

/** Session d'un niveau choisi, comme le jeton de Supabase (aal1 : mot de passe seul ; aal2 : code vérifié). */
const at = (who: string, aal: 'aal1' | 'aal2', sql: string, params: unknown[] = []) =>
  db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)`, [who, JSON.stringify({ sub: who, aal })]);
    await tx.exec('set local role authenticated');
    return (await tx.query(sql, params)).rows;
  });

const journal = () => asService<{ action: string; actor_id: string | null; target_id: string | null; details: Record<string, unknown> }>(
  db,
  `select action, actor_id, target_id, details from admin_audit_log order by id`,
);

describe('double authentification pour tous (comme Cocon)', () => {
  it('avec un code activé, rien n’est lisible ni modifiable tant que la session n’est pas vérifiée', async () => {
    const { wineId } = await addWine(db, claire, { name: 'Chablis' });
    // Sans code : rien ne change.
    expect(await as(db, claire, `select name from wines`)).toEqual([{ name: 'Chablis' }]);
    await db.query(`insert into auth.mfa_factors (user_id, status) values ($1, 'verified')`, [claire]);
    // Tables : rien de visible, aucune écriture.
    expect(await at(claire, 'aal1', `select name from wines`)).toEqual([]);
    await expectError(at(claire, 'aal1', `insert into cellars (name) values ('Seconde cave')`), /row-level security/);
    // Fonctions du serveur : refusées aussi.
    await expectError(at(claire, 'aal1', `select export_my_data()`), /mfa_required/);
    await expectError(at(claire, 'aal1', `select legal_pending()`), /mfa_required/);
    // Session vérifiée par le code : tout revient.
    expect(await at(claire, 'aal2', `select id from wines`)).toEqual([{ id: wineId }]);
    expect(await at(claire, 'aal2', `select export_my_data() is not null as ok`)).toEqual([{ ok: true }]);
    // Une autre personne sans code n'est pas concernée.
    expect(await as(db, bruno, `select count(*)::int as n from cellars`)).toEqual([{ n: 1 }]);
  });

  it('chaque table protégée par les règles d’accès porte la règle du code', async () => {
    const missing = await asService<{ name: string }>(
      db,
      `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
         and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = c.relname || '_mfa_ok')`,
    );
    expect(missing).toEqual([]);
  });
});

describe('journal des actions de l’administrateur', () => {
  it('publication, réglages de l’assistant et limites d’un compte sont notés ; rien d’autre', async () => {
    await asAdmin(db, bruno, `select admin_legal_publish('mentions', 'Mentions légales', 'Texte', 'Première version', false)`);
    await asAdmin(db, bruno, `select admin_update_ai_settings('{"alert_pct": 70}'::jsonb)`);
    await asAdmin(db, bruno, `select admin_set_user_limits($1, 5, 2, false, false)`, [claire]);
    await asAdmin(db, bruno, `select admin_set_user_limits($1, null, null, false, true)`, [claire]);
    // Une écriture du serveur (état de la clé), sans compte connecté, n'est pas notée.
    await asService(db, `update ai_settings set key_status = 'ok' where id = 1`);
    const rows = await journal();
    expect(rows.map((r) => [r.action, r.actor_id, r.target_id])).toEqual([
      ['publication_document', bruno, null],
      ['reglages_assistant', bruno, null],
      ['limites_compte', bruno, claire],
      ['limites_compte', bruno, claire],
    ]);
    expect(rows[0].details).toMatchObject({ document: 'mentions', version: 1, titre: 'Mentions légales', acceptation_demandee: false });
    // Jamais le texte du document.
    expect(JSON.stringify(rows[0].details)).not.toContain('Texte');
    expect(rows[1].details).toEqual({ alert_pct: { avant: expect.anything(), apres: 70 } });
    expect(rows[2].details).toEqual({ par_jour: 5, par_mois_usd: 2, bloque: false });
    expect(rows[3].details).toEqual({ reinitialisees: true });
  });

  it('inaltérable, lisible par l’administrateur seul (avec le code), effacé après 12 mois', async () => {
    await asAdmin(db, bruno, `select admin_legal_publish('cookies', 'Cookies', 'Texte', '', false)`);
    await expectError(asService(db, `update admin_audit_log set action = 'limites_compte'`), /audit_immutable/);
    await expectError(asService(db, `delete from admin_audit_log`), /audit_immutable/);
    await expectError(as(db, bruno, `select * from admin_audit_log`), /permission denied/);
    await expectError(as(db, claire, `select * from admin_audit_journal(10)`), /forbidden/);
    await expectError(at(bruno, 'aal2', `select * from admin_audit_journal(10)`), /admin_mfa_required/);
    expect(await asAdmin(db, bruno, `select action, details ->> 'document' as document from admin_audit_journal(10)`)).toEqual([
      { action: 'publication_document', document: 'cookies' },
    ]);

    // 12 mois : la purge seule peut effacer, et l'aperçu l'annonce.
    await db.exec(`alter table admin_audit_log disable trigger admin_audit_no_change`);
    await db.query(`update admin_audit_log set at = now() - interval '13 months'`);
    await db.exec(`alter table admin_audit_log enable trigger admin_audit_no_change`);
    await asAdmin(db, bruno, `select admin_legal_publish('cookies', 'Cookies', 'Texte 2', '', false)`);
    const apercu = readFileSync(join(MIGRATIONS_DIR, '..', 'sql', 'conservation-apercu.sql'), 'utf8');
    const preview = Object.fromEntries((await db.query<{ cle: string; a_effacer: number }>(apercu)).rows.map((r) => [r.cle, r.a_effacer]));
    expect(preview.admin_audit).toBe(1);
    const [res] = await asService<{ r: Record<string, number> }>(db, `select retention_purge() as r`);
    expect(res.r.admin_audit).toBe(1);
    expect((await journal()).map((r) => r.details.version)).toEqual([2]);
  });
});

describe('agenda Nous : participants et vins seulement jusqu’à 30 jours après l’événement', () => {
  it('au-delà, l’envoi garde l’événement mais plus les participants ni les vins', async () => {
    await befriend(db, bruno, claire);
    const startsAt = new Date(Date.now() + 7 * 86400_000).toISOString();
    const ev = (
      await one<{ r: { id: string } }>(db, bruno, `select to_json(create_event($1::jsonb, $2::uuid[])) as r`, [
        JSON.stringify({ kind: 'diner', title: 'Dîner', starts_at: startsAt, place: 'Chez Bruno' }),
        `{${claire}}`,
      ])
    ).r.id;
    const payload = async () => (await asService<{ p: Record<string, unknown> }>(db, `select nous_event_payload($1, $2) as p`, [ev, claire]))[0].p;
    expect(((await payload()).participants as unknown[]).length).toBe(2);

    // Fin il y a 29 jours : encore envoyés.
    await db.query(`update events set starts_at = now() - interval '29 days' - interval '3 hours' where id = $1`, [ev]);
    expect(((await payload()).participants as unknown[]).length).toBe(2);
    // Fin il y a 31 jours : plus envoyés ; le reste de l'événement, si.
    await db.query(`update events set starts_at = now() - interval '31 days' - interval '3 hours' where id = $1`, [ev]);
    const p = await payload();
    expect(p).toMatchObject({ title: 'Dîner', place: 'Chez Bruno', organizer_name: 'Bruno', participants: [], wines: [] });
  });
});

describe('liens d’invitation annulés', () => {
  it('la date d’annulation est notée', async () => {
    const r = await one<{ r: { id: string } }>(db, claire, `select create_invite('discovery') as r`);
    await as(db, claire, `select revoke_friend_invite($1)`, [r.r.id]);
    const [row] = await asService<{ status: string; recent: boolean }>(
      db,
      `select status, revoked_at > now() - interval '1 minute' as recent from friend_invites where id = $1`,
      [r.r.id],
    );
    expect(row).toEqual({ status: 'revoked', recent: true });
  });
});

describe('mise à jour et retour arrière', () => {
  it('le retour arrière rend l’état d’avant sans rien effacer ; la mise à jour se rejoue sans danger', async () => {
    await asAdmin(db, bruno, `select admin_legal_publish('cookies', 'Cookies', 'Texte', '', false)`);
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '..', 'sql', 'retour-20261102000001.sql'), 'utf8'));
    // Administration de nouveau ouverte sans code, comme avant ; journal gardé.
    await as(db, bruno, `select admin_ai_overview()`);
    expect((await journal()).length).toBe(1);
    // Une personne avec un code relit ses données avec le seul mot de passe, comme avant.
    await addWine(db, claire, { name: 'Chablis' });
    await db.query(`insert into auth.mfa_factors (user_id, status) values ($1, 'verified')`, [claire]);
    expect(await at(claire, 'aal1', `select name from wines`)).toEqual([{ name: 'Chablis' }]);

    const migration = readFileSync(join(MIGRATIONS_DIR, '20261102000001_alignement_cocon.sql'), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    expect(await at(claire, 'aal1', `select name from wines`)).toEqual([]);
    await expectError(as(db, bruno, `select admin_ai_overview()`), /admin_mfa_required/);
    expect((await journal()).length).toBe(1);
  });
});

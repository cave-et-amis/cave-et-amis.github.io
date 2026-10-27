import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../helpers/db.ts';

// Garde-fous valables pour toute migration, présente ou future (lot 0 de Cave & Amis 2.0) : une nouvelle table ou
// fonction mal protégée fait échouer ce fichier avant toute mise en ligne.
let db: Db;
beforeAll(async () => {
  db = await createDb();
});

const names = async (sql: string) => (await db.query<{ name: string }>(sql)).rows.map((r) => r.name);

describe('garde-fous de la base', () => {
  it('toute table du schéma public a ses règles d’accès (RLS) activées', async () => {
    expect(await names(`select tablename as name from pg_tables where schemaname = 'public' and not rowsecurity order by 1`)).toEqual([]);
  });

  it('aucune table n’est lisible ni modifiable sans connexion', async () => {
    expect(
      await names(`
        select distinct table_name as name from information_schema.role_table_grants
        where table_schema = 'public' and grantee in ('anon', 'PUBLIC') order by 1`),
    ).toEqual([]);
  });

  it('sans connexion : seulement les deux fonctions prévues (aperçu d’une invitation, documents légaux en vigueur)', async () => {
    expect(
      await names(`
        select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute') order by 1`),
    ).toEqual(['friend_invite_info', 'legal_current']);
  });

  it('une fonction à droits élevés ouverte aux comptes identifie l’appelant (auth.uid ou require_user)', async () => {
    // Exceptions relues le 27/10/2026 : elles délèguent ce contrôle (require_admin, is_event_organizer,
    // is_event_participant, group_role, create_invite) ou ne lisent que des textes publics (legal_current).
    expect(
      await names(`
        select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute')
          and p.prosrc not like '%auth.uid()%' and p.prosrc not like '%require_user()%'
        order by 1`),
    ).toEqual([
      'admin_ai_overview',
      'admin_set_user_limits',
      'create_friend_invite',
      'event_suggestable_lots',
      'group_members_list',
      'is_friend',
      'is_group_member',
      'legal_current',
      'set_service_order',
    ]);
  });

  it('toute fonction à droits élevés fixe son chemin de recherche', async () => {
    expect(
      await names(`
        select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef
          and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
        order by 1`),
    ).toEqual([]);
  });
});

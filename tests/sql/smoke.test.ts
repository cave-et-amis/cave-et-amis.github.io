import { describe, expect, it } from 'vitest';
import { createDb, createUser, one, as } from '../helpers/db.ts';

describe('installation de la base', () => {
  it('applique la migration et crée profil, première cave et premier administrateur', async () => {
    const db = await createDb();
    const bruno = await createUser(db, 'Bruno');
    const claire = await createUser(db, 'Claire');
    const me = await one<{ display_name: string; is_admin: boolean }>(db, bruno, `select display_name, is_admin from profiles where id = auth.uid()`);
    expect(me).toEqual({ display_name: 'Bruno', is_admin: true });
    const other = await one<{ is_admin: boolean }>(db, claire, `select is_admin from profiles where id = auth.uid()`);
    expect(other.is_admin).toBe(false);
    const cellars = await as<{ name: string }>(db, bruno, `select name from cellars`);
    expect(cellars.map((c) => c.name)).toEqual(['Ma cave']);
  });

  it('toutes les tables publiques sont protégées par RLS et rien n’est accessible sans connexion', async () => {
    const db = await createDb();
    const res = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(res.rows).toEqual([]);
    const grants = await db.query<{ table_name: string }>(
      `select distinct table_name from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'`,
    );
    expect(grants.rows).toEqual([]);
  });
});

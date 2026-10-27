import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, as, befriend, createDb, createUser, expectError, type Db } from '../helpers/db.ts';

let db: Db;
let bruno: string;
let claire: string;

beforeEach(async () => {
  db = await createDb();
  bruno = await createUser(db, 'Bruno');
  claire = await createUser(db, 'Claire');
  await befriend(db, bruno, claire);
});

describe('profil de goûts (mission C)', () => {
  it('chacun lit, corrige et efface le sien ; un ami ne voit rien', async () => {
    await as(db, bruno, `insert into taste_profiles (likes, dislikes, budget_max, note) values ('{Pinot noir,Bourgogne}', '{Boisé marqué}', 30, 'Pas de bulles')`);
    expect(await as(db, bruno, `select likes, dislikes, budget_max::text as b from taste_profiles`)).toEqual([
      { likes: ['Pinot noir', 'Bourgogne'], dislikes: ['Boisé marqué'], b: '30.00' },
    ]);
    // Claire, amie de Bruno : rien à lire, rien à modifier ni effacer, et pas de profil au nom de Bruno.
    expect(await as(db, claire, `select * from taste_profiles`)).toEqual([]);
    expect(await as(db, claire, `update taste_profiles set note = 'x' returning user_id`)).toEqual([]);
    expect(await as(db, claire, `delete from taste_profiles returning user_id`)).toEqual([]);
    await expectError(as(db, claire, `insert into taste_profiles (user_id, likes) values ($1, '{Intrus}')`, [bruno]), /row-level security/);
    await expectError(as(db, null, `select * from taste_profiles`), /permission denied/);
    // Corriger : écarter un trait déduit ; l'identifiant n'est pas modifiable.
    await as(db, bruno, `update taste_profiles set ignored = '{couleur:rouge}'`);
    await expectError(as(db, bruno, `update taste_profiles set user_id = $1`, [claire]), /permission denied/);
    // Effacer.
    expect((await as(db, bruno, `delete from taste_profiles returning user_id`)).length).toBe(1);
    expect(await as(db, bruno, `select * from taste_profiles`)).toEqual([]);
  });

  it('bornes : 20 préférences au plus, budget positif, note courte', async () => {
    const many = `{${Array.from({ length: 21 }, (_, i) => `g${i}`).join(',')}}`;
    await expectError(as(db, bruno, `insert into taste_profiles (likes) values ($1)`, [many]), /check constraint/);
    await expectError(as(db, bruno, `insert into taste_profiles (budget_max) values (-5)`), /check constraint/);
    await expectError(as(db, bruno, `insert into taste_profiles (note) values ($1)`, ['x'.repeat(501)]), /check constraint/);
  });

  it('supprimé avec le compte', async () => {
    await as(db, bruno, `insert into taste_profiles (likes) values ('{Pinot noir}')`);
    await db.query(`delete from auth.users where id = $1`, [bruno]);
    expect((await db.query(`select count(*)::int as n from taste_profiles`)).rows).toEqual([{ n: 0 }]);
  });

  it('retour arrière, puis mise à jour rejouable', async () => {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '..', 'sql', 'retour-20261102000003.sql'), 'utf8'));
    expect((await db.query<{ t: string | null }>(`select to_regclass('public.taste_profiles')::text as t`)).rows[0].t).toBeNull();
    const migration = readFileSync(join(MIGRATIONS_DIR, '20261102000003_gouts.sql'), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    await as(db, bruno, `insert into taste_profiles (likes) values ('{Syrah}')`);
    expect(await as(db, claire, `select * from taste_profiles`)).toEqual([]);
  });
});

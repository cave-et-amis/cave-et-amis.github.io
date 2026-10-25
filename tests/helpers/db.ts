import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SUPABASE_SHIM_SQL } from '../../server/local/shim.sql.ts';

export const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'supabase', 'migrations');

/** Base neuve : environnement Supabase minimal puis toutes les migrations, dans l'ordre. */
export async function createDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM_SQL);
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

export type Db = PGlite;

let counter = 0;
/** Crée un compte (comme l'inscription : profil et première cave créés par la base). */
export async function createUser(db: Db, name: string) {
  counter += 1;
  const id = `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    id,
    `${name.toLowerCase()}.${counter}@exemple.test`,
    JSON.stringify({ display_name: name }),
  ]);
  return id;
}

/** Exécute une requête en tant qu'utilisateur connecté (RLS active), comme PostgREST. */
export async function as<T = Record<string, unknown>>(db: Db, userId: string | null, sql: string, params: unknown[] = []) {
  return db.transaction(async (tx) => {
    if (userId) await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await tx.exec(userId ? 'set local role authenticated' : 'set local role anon');
    const res = await tx.query<T>(sql, params);
    return res.rows;
  });
}

export async function one<T = Record<string, unknown>>(db: Db, userId: string | null, sql: string, params: unknown[] = []) {
  const rows = await as<T>(db, userId, sql, params);
  return rows[0];
}

/** En tant que serveur (clé secrète : contourne RLS). */
export async function asService<T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []) {
  return db.transaction(async (tx) => {
    await tx.exec('set local role service_role');
    const res = await tx.query<T>(sql, params);
    return res.rows;
  });
}

export async function expectError(promise: Promise<unknown>, pattern: RegExp) {
  try {
    await promise;
  } catch (e) {
    const message = (e as Error).message;
    if (!pattern.test(message)) throw new Error(`Erreur inattendue : ${message}`);
    return;
  }
  throw new Error(`Une erreur ${pattern} était attendue`);
}

export const rid = () => crypto.randomUUID();

/** Crée un vin et un lot (avec son mouvement d'entrée) pour un utilisateur. */
export async function addWine(
  db: Db,
  user: string,
  wine: Record<string, unknown>,
  lot: Record<string, unknown> = {},
): Promise<{ wineId: string; lotId: string }> {
  const cols = Object.keys(wine);
  const w = await one<{ id: string }>(
    db,
    user,
    `insert into wines (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
    Object.values(wine),
  );
  const l = await one<{ r: { id: string } }>(db, user, `select to_json(create_lot($1::jsonb, $2)) as r`, [
    JSON.stringify({ wine_id: w.id, quantity: 6, ...lot }),
    rid(),
  ]);
  return { wineId: w.id, lotId: l.r.id };
}

/** Deux amis : la relation et les deux caves ouvertes l'une à l'autre (comme les amitiés d'avant les contacts). */
export async function befriend(db: Db, a: string, b: string) {
  const inv = await one<{ r: { code: string } }>(db, a, `select create_friend_invite() as r`);
  await one(db, b, `select respond_friend_invite($1, true) as r`, [inv.r.code]);
  await one(db, b, `select grant_cellar_access($1)`, [a]);
}

/** Deux contacts : la relation seule, aucune cave ouverte. */
export async function connect(db: Db, a: string, b: string) {
  const inv = await one<{ r: { code: string } }>(db, a, `select create_invite('discovery') as r`);
  await one(db, b, `select respond_friend_invite($1, true) as r`, [inv.r.code]);
}

export async function lotState(db: Db, lotId: string) {
  return (await db.query<{ quantity: number; reserved: number }>(`select quantity, reserved from lots where id = $1`, [lotId])).rows[0];
}

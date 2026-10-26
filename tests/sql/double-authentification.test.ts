import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, as, createDb, createUser, expectError, type Db } from '../helpers/db.ts';

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

/** Les fonctions d'administration de l'assistant, appelées comme le ferait l'application. */
const adminCalls = (who: string, aal: 'aal1' | 'aal2') => [
  () => at(who, aal, `select admin_ai_overview() as o`),
  () => at(who, aal, `select admin_update_ai_settings('{"alert_pct": 70}'::jsonb) as s`),
  () => at(who, aal, `select admin_set_user_limits($1, 5, 2, false, false)`, [claire]),
];

const addFactor = (status: 'verified' | 'unverified') => db.query(`insert into auth.mfa_factors (user_id, status) values ($1, $2)`, [bruno, status]);

describe('double authentification de l’administrateur', () => {
  it('sans code activé, rien ne change ; un code commencé mais pas vérifié ne compte pas', async () => {
    for (const call of adminCalls(bruno, 'aal1')) await call();
    await addFactor('unverified');
    for (const call of adminCalls(bruno, 'aal1')) await call();
    expect((await db.query(`select alert_pct from ai_settings where id = 1`)).rows).toEqual([{ alert_pct: 70 }]);
    for (const call of adminCalls(claire, 'aal2')) await expectError(call(), /forbidden/);
  });

  it('code activé : chaque fonction d’administration demande une session vérifiée par le code', async () => {
    await addFactor('verified');
    for (const call of adminCalls(bruno, 'aal1')) await expectError(call(), /mfa_required/);
    // Session d'avant la mise à jour de Supabase, sans niveau : refusée aussi.
    await expectError(as(db, bruno, `select admin_ai_overview()`), /mfa_required/);
    for (const call of adminCalls(bruno, 'aal2')) await call();
    expect((await db.query(`select daily_requests from ai_user_limits where user_id = $1`, [claire])).rows).toEqual([{ daily_requests: 5 }]);
    // Une autre personne n'y gagne rien, même avec un code.
    for (const call of adminCalls(claire, 'aal2')) await expectError(call(), /forbidden/);
    // La règle elle-même n'est pas appelable par les comptes.
    await expectError(at(bruno, 'aal2', `select require_admin()`), /permission denied/);
    await expectError(at(bruno, 'aal2', `select admin_strong_session()`), /permission denied/);
  });
});

describe('mise à jour et retour arrière', () => {
  it('le retour arrière rend l’état d’avant ; la mise à jour se rejoue sans danger', async () => {
    await addFactor('verified');
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '..', 'sql', 'retour-20261101000005.sql'), 'utf8'));
    for (const call of adminCalls(bruno, 'aal1')) await call();
    // La publication des documents légaux garde son exigence (mise à jour précédente).
    await expectError(at(bruno, 'aal1', `select admin_legal_publish('cookies', 'Cookies', 'Texte', '', false)`), /mfa_required/);
    await expectError(at(bruno, 'aal2', `select require_admin()`), /permission denied/);

    const migration = readFileSync(join(MIGRATIONS_DIR, '20261101000005_double_authentification.sql'), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    for (const call of adminCalls(bruno, 'aal1')) await expectError(call(), /mfa_required/);
    for (const call of adminCalls(bruno, 'aal2')) await call();
  });
});

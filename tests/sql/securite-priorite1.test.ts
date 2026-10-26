import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, addWine, as, asService, befriend, createDb, createUser, expectError, one, rid, type Db } from '../helpers/db.ts';

let db: Db;
let bruno: string;
let claire: string;
let marc: string;

beforeEach(async () => {
  db = await createDb();
  bruno = await createUser(db, 'Bruno');
  claire = await createUser(db, 'Claire');
  marc = await createUser(db, 'Marc');
  await befriend(db, bruno, claire);
});

const dinner = async (organizer: string, guests: string[]) =>
  (
    await one<{ r: { id: string } }>(db, organizer, `select to_json(create_event($1::jsonb, $2::uuid[])) as r`, [
      JSON.stringify({ kind: 'diner', title: 'Dîner', starts_at: new Date(Date.now() + 86400_000).toISOString() }),
      `{${guests.join(',')}}`,
    ])
  ).r.id;
const tasting = (user: string, p: Record<string, unknown>) =>
  one<{ r: { id: string } }>(db, user, `select to_json(create_tasting($1::jsonb, null, $2)) as r`, [JSON.stringify(p), rid()]).then((x) => x.r.id);
const count = async (from: string, params: unknown[] = []) => (await asService<{ n: number }>(db, `select count(*)::int as n from ${from}`, params))[0].n;
const mine = async (who: string) => ({
  cellars: await count(`cellars where owner_id = $1`, [who]),
  wines: await count(`wines where owner_id = $1`, [who]),
  lots: await count(`lots where owner_id = $1`, [who]),
  profile: await count(`profiles where id = $1`, [who]),
});

describe('suppression d’un événement et d’un compte (audit, priorité 1)', () => {
  it('supprimer un événement : la note qu’un invité lui avait partagée redevient privée chez lui', async () => {
    const ev = await dinner(bruno, [claire]);
    const note = await tasting(claire, { wine_name: 'Morgon', event_id: ev, share_with_event: true });
    await one(db, bruno, `select delete_event($1)`, [ev]);
    expect(await count(`events where id = $1`, [ev])).toBe(0);
    expect(await as(db, claire, `select wine_name, share_with_event, event_id from tastings where id = $1`, [note])).toEqual([
      { wine_name: 'Morgon', share_with_event: false, event_id: null },
    ]);
  });

  it('compte d’un organisateur dont un invité a partagé une note : la suppression réussit et est complète', async () => {
    await addWine(db, bruno, { name: 'Pomerol' });
    const ev = await dinner(bruno, [claire]);
    await tasting(claire, { wine_name: 'Morgon', event_id: ev, share_with_event: true });
    // L'ancienne étape préalable ne supprime plus rien à elle seule.
    await one(db, bruno, `select prepare_account_deletion()`);
    expect(await mine(bruno)).toMatchObject({ wines: 1, lots: 1, profile: 1 });
    await db.query(`delete from auth.users where id = $1`, [bruno]);
    expect(await mine(bruno)).toEqual({ cellars: 0, wines: 0, lots: 0, profile: 0 });
    expect(await count(`events where id = $1`, [ev])).toBe(0);
    expect(await count(`tastings where user_id = $1`, [claire])).toBe(1);
  });

  it('tout ou rien : si la suppression échoue plus loin, rien n’est effacé (caves comprises)', async () => {
    await addWine(db, bruno, { name: 'Pomerol' });
    await tasting(bruno, { wine_name: 'Note de Bruno' });
    const before = await mine(bruno);
    // Une panne quelconque plus loin dans la suppression en cascade (simulée sur ses notes de dégustation).
    await db.exec(`
      create function public.panne_simulee() returns trigger language plpgsql as $$ begin raise exception 'panne simulée'; end $$;
      create trigger panne_simulee before delete on public.tastings for each row execute function public.panne_simulee();`);
    await expect(db.query(`delete from auth.users where id = $1`, [bruno])).rejects.toThrow(/panne simulée/);
    expect(await mine(bruno)).toEqual(before);
    await db.exec(`drop trigger panne_simulee on public.tastings; drop function public.panne_simulee();`);
    await db.query(`delete from auth.users where id = $1`, [bruno]);
    expect(await mine(bruno)).toEqual({ cellars: 0, wines: 0, lots: 0, profile: 0 });
  });
});

describe('blocages (audit, priorité 1)', () => {
  it('is_blocked_between n’est plus appelable par un compte ; le blocage reste appliqué et invisible', async () => {
    await one(db, claire, `select block_user($1)`, [marc]);
    await expectError(one(db, marc, `select is_blocked_between($1, $2) as b`, [claire, marc]), /permission denied/);
    await expectError(one(db, claire, `select is_blocked_between($1, $2) as b`, [claire, marc]), /permission denied/);
    await db.query(`update profiles set discoverable = true`);
    await expectError(one(db, marc, `select send_friend_request($1)`, [claire]), /not_found/);
    expect(await as(db, marc, `select * from blocks`)).toEqual([]);
  });
});

describe('mise à jour et retour arrière', () => {
  it('le retour arrière rend l’état d’avant ; la mise à jour se rejoue sans danger', async () => {
    const migration = readFileSync(join(MIGRATIONS_DIR, '20261031000001_securite_priorite1.sql'), 'utf8');
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '..', 'sql', 'retour-20261031000001.sql'), 'utf8'));
    expect(await one(db, claire, `select is_blocked_between($1, $2) as b`, [claire, marc])).toEqual({ b: false });
    await addWine(db, bruno, { name: 'Pomerol' });
    await one(db, bruno, `select prepare_account_deletion()`);
    expect(await mine(bruno)).toMatchObject({ wines: 0, lots: 0, profile: 1 });
    await db.exec(migration);
    await db.exec(migration);
    await expectError(one(db, claire, `select is_blocked_between($1, $2) as b`, [claire, marc]), /permission denied/);
    await addWine(db, claire, { name: 'Morgon' });
    await db.query(`delete from auth.users where id = $1`, [claire]);
    expect(await mine(claire)).toEqual({ cellars: 0, wines: 0, lots: 0, profile: 0 });
  });
});

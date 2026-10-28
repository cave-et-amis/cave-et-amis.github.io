import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, as, createDb, createUser, expectError, one, rid, type Db } from '../helpers/db.ts';

let db: Db;
let bruno: string;
let claire: string;

beforeEach(async () => {
  db = await createDb();
  bruno = await createUser(db, 'Bruno');
  claire = await createUser(db, 'Claire');
});

const createTasting = (user: string, p: Record<string, unknown>) =>
  one<{ r: Record<string, unknown> }>(db, user, `select to_json(create_tasting($1::jsonb, null, $2)) as r`, [JSON.stringify(p), rid()]).then((x) => x.r);

describe('profil gustatif d’une dégustation', () => {
  it('quatre repères facultatifs de 1 à 5, à la création comme à la modification', async () => {
    const t = await createTasting(bruno, { wine_name: 'Morgon', rating: 5, fruite: 4, puissance: 3, boise: 1, mineralite: 5 });
    expect(t).toMatchObject({ fruite: 4, puissance: 3, boise: 1, mineralite: 5 });
    const vide = await createTasting(bruno, { wine_name: 'Chablis' });
    expect(vide).toMatchObject({ fruite: null, puissance: null, boise: null, mineralite: null });
    await as(db, bruno, `update tastings set fruite = 2, boise = null where id = $1`, [t.id]);
    expect(await as(db, bruno, `select fruite, boise from tastings where id = $1`, [t.id])).toEqual([{ fruite: 2, boise: null }]);
  });

  it('hors de 1 à 5 : refusé ; la fiche d’un autre : intouchable', async () => {
    await expectError(createTasting(bruno, { wine_name: 'Morgon', fruite: 6 }), /check constraint/);
    await expectError(createTasting(bruno, { wine_name: 'Morgon', puissance: 0 }), /check constraint/);
    const t = await createTasting(bruno, { wine_name: 'Morgon' });
    await expectError(as(db, bruno, `update tastings set mineralite = 9 where id = $1`, [t.id]), /check constraint/);
    expect(await as(db, claire, `update tastings set fruite = 3 where id = $1 returning id`, [t.id])).toEqual([]);
    expect(await as(db, claire, `select * from tastings where id = $1`, [t.id])).toEqual([]);
  });

  it('dans l’export de mes données', async () => {
    await createTasting(bruno, { wine_name: 'Morgon', fruite: 4 });
    const d = (await one<{ d: Record<string, unknown> }>(db, bruno, `select export_my_data() as d`)).d;
    expect(JSON.stringify(d)).toContain('"fruite":4');
  });
});

describe('mise à jour et retour arrière', () => {
  it('le retour arrière rend l’état d’avant ; la mise à jour se rejoue sans danger', async () => {
    const up = readFileSync(join(MIGRATIONS_DIR, '20261102000006_profil_gustatif.sql'), 'utf8');
    await db.exec(up);
    await createTasting(bruno, { wine_name: 'Morgon', fruite: 4 });
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '..', 'sql', 'retour-20261102000006.sql'), 'utf8'));
    const avant = await createTasting(bruno, { wine_name: 'Chablis', fruite: 4 });
    expect(avant).not.toHaveProperty('fruite');
    expect(avant).toMatchObject({ wine_name: 'Chablis' });
    await db.exec(up);
    expect(await createTasting(bruno, { wine_name: 'Saumur', fruite: 3 })).toMatchObject({ fruite: 3 });
  });
});

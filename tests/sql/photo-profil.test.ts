import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, as, asService, befriend, connect, createDb, createUser, expectError, one, type Db } from '../helpers/db.ts';

let db: Db;
let bruno: string;
let claire: string;
let marc: string;
let sam: string;
let lea: string;
let groupId: string;

// Bruno : contact de Claire, ami de Marc. Marc dîne chez Bruno avec Claire (événement commun, sans être en contact
// avec elle). Sam est membre du groupe de Bruno, sans autre lien avec Claire. Léa : aucun lien.
beforeEach(async () => {
  db = await createDb();
  bruno = await createUser(db, 'Bruno');
  claire = await createUser(db, 'Claire');
  marc = await createUser(db, 'Marc');
  sam = await createUser(db, 'Sam');
  lea = await createUser(db, 'Léa');
  await connect(db, bruno, claire);
  await befriend(db, bruno, marc);
  await connect(db, bruno, sam);
  await one(db, bruno, `select (create_event($1::jsonb, $2::uuid[])).id`, [
    JSON.stringify({ kind: 'diner', title: 'Dîner', starts_at: new Date(Date.now() + 86400_000).toISOString() }),
    `{${claire},${marc}}`,
  ]);
  groupId = (await one<{ id: string }>(db, bruno, `select (create_group('Les copains', '🍷', null, null, $1::uuid[])).id`, [[claire, sam]])).id;
  for (const who of [claire, sam]) await one(db, who, `select respond_group_invite($1, true)`, [groupId]);
});

const avatar = (who: string, name = 'avatar-a1b2c3d4') => `${who}/${name}.jpg`;
const canRead = async (who: string | null, path: string) => (await one<{ ok: boolean }>(db, who, `select can_read_photo($1) as ok`, [path])).ok;

describe('photo de profil', () => {
  it('chacun choisit, change ou retire la sienne ; jamais une photo d’un autre ni une autre photo à soi', async () => {
    await as(db, claire, `update profiles set avatar_photo = $1 where id = auth.uid()`, [avatar(claire)]);
    expect(await as(db, claire, `select avatar_photo from profiles`)).toEqual([{ avatar_photo: avatar(claire) }]);
    // Le dossier d'un autre, une photo de vin, un nom piégé : refusés.
    await expectError(as(db, claire, `update profiles set avatar_photo = $1 where id = auth.uid()`, [avatar(bruno)]), /check constraint/);
    await expectError(as(db, claire, `update profiles set avatar_photo = $1 where id = auth.uid()`, [`${claire}/etiquette.jpg`]), /check constraint/);
    await expectError(as(db, claire, `update profiles set avatar_photo = $1 where id = auth.uid()`, [`${claire}/avatar-x/../${bruno}/a.jpg`]), /check constraint/);
    // Seulement un JPEG au nom en minuscules, sans saut de ligne.
    for (const bad of [`${claire}/avatar-A1B2C3D4.jpg`, `${claire}/avatar-a1b2c3d4.png`, `${claire}/avatar-a1b2c3d4.jpg
`]) {
      await expectError(as(db, claire, `update profiles set avatar_photo = $1 where id = auth.uid()`, [bad]), /check constraint/);
    }
    // Le profil d'un autre : aucune ligne touchée.
    expect(await as(db, claire, `update profiles set avatar_photo = null where id = $1 returning id`, [bruno])).toEqual([]);
    await as(db, claire, `update profiles set avatar_photo = null where id = auth.uid()`);
    expect(await as(db, claire, `select avatar_photo from profiles`)).toEqual([{ avatar_photo: null }]);
  });

  it('visible exactement de ceux qui voient le prénom : contacts et participants d’un même événement', async () => {
    await as(db, claire, `update profiles set avatar_photo = $1 where id = auth.uid()`, [avatar(claire)]);
    // Bruno (contact) et Marc (même dîner) : prénom et photo, et la photo se lit.
    for (const who of [bruno, marc]) {
      expect(await as(db, who, `select avatar_photo from profile_names() where id = $1`, [claire])).toEqual([{ avatar_photo: avatar(claire) }]);
      expect(await canRead(who, avatar(claire))).toBe(true);
    }
    // Sam (même groupe seulement) et Léa (aucun lien) : ni prénom par profile_names, ni photo.
    for (const who of [sam, lea]) {
      expect(await as(db, who, `select * from profile_names() where id = $1`, [claire])).toEqual([]);
      expect(await canRead(who, avatar(claire))).toBe(false);
    }
    // Une autre photo du dossier de Claire ne devient pas lisible pour autant ; ni l'ancienne photo de profil.
    expect(await canRead(bruno, `${claire}/avatar-ancienne1.jpg`)).toBe(false);
    await as(db, claire, `update profiles set avatar_photo = $1 where id = auth.uid()`, [`${claire}/avatar-nouvelle1.jpg`]);
    expect(await canRead(bruno, avatar(claire))).toBe(false);
    // Le lien rompu : plus de photo.
    await as(db, claire, `update profiles set avatar_photo = null where id = auth.uid()`);
    expect(await canRead(marc, `${claire}/avatar-nouvelle1.jpg`)).toBe(false);
    await expectError(canRead(null, avatar(claire)), /permission denied/);
  });

  it('jamais pour une personne bloquée, même participante d’un même événement', async () => {
    await as(db, claire, `update profiles set avatar_photo = $1 where id = auth.uid()`, [avatar(claire)]);
    expect(await canRead(marc, avatar(claire))).toBe(true);
    await one(db, claire, `select block_user($1)`, [marc]);
    // Marc garde le prénom de Claire (dîner commun), plus la photo ; dans un sens comme dans l'autre.
    expect(await as(db, marc, `select display_name, avatar_photo from profile_names() where id = $1`, [claire])).toEqual([{ display_name: 'Claire', avatar_photo: null }]);
    expect(await canRead(marc, avatar(claire))).toBe(false);
    await as(db, marc, `update profiles set avatar_photo = $1 where id = auth.uid()`, [avatar(marc)]);
    expect(await canRead(claire, avatar(marc))).toBe(false);
    // Claire voit toujours la sienne ; Bruno (contact) aussi.
    expect(await as(db, claire, `select avatar_photo from profile_names() where id = auth.uid()`)).toEqual([{ avatar_photo: avatar(claire) }]);
    expect(await canRead(bruno, avatar(claire))).toBe(true);
  });

  it('dans l’export de mes données ; l’ancienne photo part avec les photos inutiles, pas la photo en cours', async () => {
    await as(db, claire, `update profiles set avatar_photo = $1 where id = auth.uid()`, [avatar(claire, 'avatar-en-cours1')]);
    await db.query(
      `insert into storage.objects (bucket_id, name, created_at) values ('photos', $1, now() - interval '40 days'), ('photos', $2, now() - interval '40 days')`,
      [avatar(claire, 'avatar-en-cours1'), avatar(claire, 'avatar-ancienne1')],
    );
    const names = (await asService<{ name: string }>(db, `select name from retention_orphan_photos(100)`)).map((r) => r.name);
    expect(names).toEqual([avatar(claire, 'avatar-ancienne1')]);
    const exported = (await one<{ d: { compte: { profil: { avatar_photo: string } }; photos: string[] } }>(db, claire, `select export_my_data() as d`)).d;
    expect(exported.compte.profil.avatar_photo).toBe(avatar(claire, 'avatar-en-cours1'));
    expect(exported.photos).toContain(avatar(claire, 'avatar-en-cours1'));
  });
});

describe('mise à jour et retour arrière', () => {
  it('le retour arrière rend l’état d’avant ; la mise à jour se rejoue sans danger', async () => {
    const up = readFileSync(join(MIGRATIONS_DIR, '20261102000005_photo_profil.sql'), 'utf8');
    await db.exec(up);
    await as(db, claire, `update profiles set avatar_photo = $1 where id = auth.uid()`, [avatar(claire)]);
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '..', 'sql', 'retour-20261102000005.sql'), 'utf8'));
    expect(await as(db, bruno, `select * from profile_names() where id = $1`, [claire])).toEqual([{ id: claire, display_name: 'Claire' }]);
    await db.exec(up);
    expect(await as(db, bruno, `select * from profile_names() where id = $1`, [claire])).toEqual([{ id: claire, display_name: 'Claire', avatar_photo: null }]);
    expect(await canRead(bruno, avatar(claire))).toBe(false);
  });

  it('après le retour arrière, la règle de lecture des photos est celle d’avant', async () => {
    await as(db, claire, `update profiles set avatar_photo = $1 where id = auth.uid()`, [avatar(claire)]);
    expect(await canRead(bruno, avatar(claire))).toBe(true);
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '..', 'sql', 'retour-20261102000005.sql'), 'utf8'));
    expect(await canRead(bruno, avatar(claire))).toBe(false);
    expect(await canRead(claire, avatar(claire))).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { TEST_URL, TINY_JPEG } from '../helpers/env.ts';
import { call, makeAiEnv, type AiEnv } from './setup.ts';

/** Appel d'une tâche planifiée (en ligne : pg_cron et pg_net, avec le jeton de la base). */
async function cron(env: AiEnv, action: string, token?: string) {
  const t = token ?? (await env.db.query<{ cron_token: string }>(`select cron_token from nous_config where id = 1`)).rows[0].cron_token;
  const res = await env.handler(
    new Request(`${TEST_URL}/functions/v1/cave-api`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-token': t }, body: JSON.stringify({ action }) }),
  );
  return { status: res.status, ...((await res.json()) as Record<string, unknown>) };
}

async function setup() {
  const env = await makeAiEnv();
  const claire = await env.signUp('Claire');
  const upload = async (name: string) => {
    const path = `${claire.id}/${name}.jpg`;
    const { error } = await claire.sb.storage.from('photos').upload(path, new Blob([TINY_JPEG], { type: 'image/jpeg' }));
    if (error) throw error;
    return path;
  };
  const files = async () => (await env.db.query<{ name: string }>(`select name from storage.objects where bucket_id = 'photos' order by name`)).rows.map((r) => r.name);
  const blobs = async () => (await env.db.query<{ n: number }>(`select count(*)::int as n from storage_local.blobs`)).rows[0].n;
  return { env, claire, upload, files, blobs };
}

describe('durées de conservation : tâches planifiées de cave-api', () => {
  it('chaque nuit : les analyses du scanner échues partent avec leurs photos, les autres restent', async () => {
    const { env, claire, upload, files, blobs } = await setup();
    const old = await upload('rayon-ancien');
    const recent = await upload('rayon-recent');
    await env.db.query(`insert into scans (user_id, photos) values ($1, $2), ($1, $3)`, [
      claire.id,
      JSON.stringify([{ path: old, role: 'front' }]),
      JSON.stringify([{ path: recent, role: 'front' }]),
    ]);
    await env.db.query(`update scans set expires_at = now() - interval '1 day' where photos -> 0 ->> 'path' = $1`, [old]);

    const res = await cron(env, 'retention_purge');
    expect(res).toMatchObject({ status: 200, ok: true, scans: 1, conversations: 0, invites: 0 });
    expect(await files()).toEqual([recent]);
    expect(await blobs()).toBe(1);
    expect((await env.db.query(`select photos -> 0 ->> 'path' as p from scans`)).rows).toEqual([{ p: recent }]);
    // Rien à faire : la purge suivante ne touche plus rien.
    expect(await cron(env, 'retention_purge')).toMatchObject({ ok: true, scans: 0 });
  });

  it('chaque mois : seules les photos anciennes que rien ne cite sont supprimées', async () => {
    const { env, claire, upload, files } = await setup();
    const label = await upload('etiquette');
    const lost = await upload('oubliee');
    const fresh = await upload('en-cours');
    await env.db.query(`insert into wines (owner_id, name, label_photo) values ($1, 'Chablis', $2)`, [claire.id, label]);
    await env.db.query(`update storage.objects set created_at = now() - interval '40 days' where name in ($1, $2)`, [label, lost]);

    expect(await cron(env, 'photos_purge')).toMatchObject({ status: 200, ok: true, photos: 1 });
    expect(await files()).toEqual([fresh, label].sort());
  });

  it('sans le jeton des tâches planifiées, ou depuis une session, rien n’est purgé', async () => {
    const { env, claire, upload, files } = await setup();
    const lost = await upload('oubliee');
    await env.db.query(`update storage.objects set created_at = now() - interval '40 days'`);
    expect(await cron(env, 'photos_purge', 'x'.repeat(64))).toMatchObject({ status: 403, code: 'forbidden' });
    expect(await cron(env, 'retention_purge', 'x'.repeat(64))).toMatchObject({ status: 403, code: 'forbidden' });
    expect(await call(claire.sb, { action: 'photos_purge' })).toMatchObject({ ok: false });
    expect(await call(claire.sb, { action: 'retention_purge' })).toMatchObject({ ok: false });
    expect(await files()).toEqual([lost]);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { makeEnv, TINY_JPEG, type Env } from '../helpers/env.ts';

let env: Env;

beforeEach(async () => {
  env = await makeEnv();
});

async function friends(a: Env['signUp'] extends (...x: never[]) => Promise<infer R> ? R : never, b: typeof a) {
  const { data } = await a.sb.rpc('create_friend_invite');
  const { error } = await b.sb.rpc('respond_friend_invite', { p_code: (data as { code: string }).code, p_accept: true });
  if (error) throw error;
}

describe('photos privées', () => {
  it('une photo n’est lisible que par son propriétaire, puis par les amis seulement si le vin est partagé', async () => {
    const bruno = await env.signUp('Bruno');
    const claire = await env.signUp('Claire');
    const marc = await env.signUp('Marc');
    await friends(bruno, claire);
    const path = `${bruno.id}/etiquette.jpg`;
    const up = await bruno.sb.storage.from('photos').upload(path, new Blob([TINY_JPEG], { type: 'image/jpeg' }), { contentType: 'image/jpeg' });
    expect(up.error).toBeNull();

    // Écrire dans le dossier d'un autre est refusé.
    const intrus = await claire.sb.storage.from('photos').upload(`${bruno.id}/piege.jpg`, new Blob([TINY_JPEG], { type: 'image/jpeg' }));
    expect(intrus.error).not.toBeNull();

    // Propriétaire : lecture directe et lien signé.
    expect((await bruno.sb.storage.from('photos').download(path)).error).toBeNull();
    const signed = await bruno.sb.storage.from('photos').createSignedUrl(path, 60);
    expect(signed.data?.signedUrl).toContain('/object/sign/photos/');

    // Vin privé : ni l'ami, ni l'inconnu.
    const { data: wine } = await bruno.sb.from('wines').insert({ name: 'Talbot', label_photo: path }).select().single();
    const { data: lot, error: lotErr } = await bruno.sb.rpc('create_lot', { p: { wine_id: wine.id, quantity: 2 }, p_request: crypto.randomUUID() });
    expect(lotErr).toBeNull();
    expect((await claire.sb.storage.from('photos').download(path)).error).not.toBeNull();
    expect((await claire.sb.storage.from('photos').createSignedUrl(path, 60)).error).not.toBeNull();

    // Partagé avec les amis : l'ami peut voir l'étiquette, l'inconnu toujours pas.
    const upd = await bruno.sb.from('lots').update({ visibility: 'friends' }).eq('id', (lot as { id: string }).id);
    expect(upd.error).toBeNull();
    expect((await claire.sb.storage.from('photos').download(path)).error).toBeNull();
    expect((await marc.sb.storage.from('photos').download(path)).error).not.toBeNull();

    // Fin de l'amitié : accès retiré.
    await claire.sb.rpc('remove_friend', { p_friend: bruno.id });
    expect((await claire.sb.storage.from('photos').download(path)).error).not.toBeNull();

    // Sans session : rien.
    expect((await env.client().storage.from('photos').download(path)).error).not.toBeNull();
  });

  it('refuse les fichiers qui ne sont pas des images', async () => {
    const bruno = await env.signUp('Bruno');
    const res = await bruno.sb.storage
      .from('photos')
      .upload(`${bruno.id}/page.html`, new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), { contentType: 'text/html' });
    expect(res.error).not.toBeNull();
  });
});

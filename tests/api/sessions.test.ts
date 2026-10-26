import { describe, expect, it } from 'vitest';
import { Api } from '../../src/data/api.ts';
import { makeEnv, type Env } from '../helpers/env.ts';

/** Un second appareil connecté au même compte. */
async function secondDevice(env: Env, who: { email: string; password: string }) {
  const sb = env.client();
  const { error } = await sb.auth.signInWithPassword({ email: who.email, password: who.password });
  expect(error).toBeNull();
  return sb;
}

const stillOpen = async (sb: ReturnType<Env['client']>) => (await sb.auth.getUser()).data.user !== null;

describe('déconnexion (serveur local, comme Supabase)', () => {
  it('« partout » : toutes les sessions de la personne se ferment et ne se renouvellent plus ; celles des autres restent', async () => {
    const env = await makeEnv();
    const sam = await env.signUp('Sam');
    const lea = await env.signUp('Lea');
    const phone = await secondDevice(env, sam);
    const refresh = (await phone.auth.getSession()).data.session!.refresh_token;

    expect((await sam.sb.auth.signOut({ scope: 'global' })).error).toBeNull();
    // L'autre appareil : refusé par le service de connexion, sa session est retirée ; son jeton de renouvellement ne sert plus.
    expect(await stillOpen(phone)).toBe(false);
    expect((await phone.auth.getSession()).data.session).toBeNull();
    expect((await env.client().auth.refreshSession({ refresh_token: refresh })).error?.code).toBe('refresh_token_not_found');
    expect(await stillOpen(lea.sb)).toBe(true);
    // Une nouvelle connexion fonctionne aussitôt.
    expect(await stillOpen(await secondDevice(env, sam))).toBe(true);
  });

  it('« cet appareil » seulement : les autres sessions de la personne restent ouvertes', async () => {
    const env = await makeEnv();
    const sam = await env.signUp('Sam');
    const phone = await secondDevice(env, sam);
    const refresh = (await sam.sb.auth.getSession()).data.session!.refresh_token;
    await sam.sb.auth.signOut({ scope: 'local' });
    expect((await env.client().auth.refreshSession({ refresh_token: refresh })).error).not.toBeNull();
    expect(await stillOpen(phone)).toBe(true);
    // Le renouvellement garde la même session.
    const renewed = env.client();
    const { data } = await renewed.auth.refreshSession({ refresh_token: (await phone.auth.getSession()).data.session!.refresh_token });
    expect(data.session).not.toBeNull();
    await phone.auth.signOut({ scope: 'local' });
    expect(await stillOpen(renewed)).toBe(false);
  });
});

describe('« Déconnecter tous mes appareils »', () => {
  it('retire tous mes appareils des notifications, ferme toutes mes sessions ; rien ne change pour les autres', async () => {
    const env = await makeEnv();
    const sam = await env.signUp('Sam');
    const lea = await env.signUp('Lea');
    const phone = await secondDevice(env, sam);
    let n = 0;
    const device = (user: string) =>
      env.service().rpc('push_subscription_save', {
        p_user: user,
        p_endpoint: `https://fcm.googleapis.com/fcm/send/appareil-${++n}`,
        p_p256dh: `B${'A'.repeat(86)}`,
        p_auth: 'A'.repeat(22),
        p_label: 'Téléphone',
      });
    for (const user of [sam.id, sam.id, lea.id]) expect((await device(user)).error).toBeNull();

    await new Api(sam.sb).signOutEverywhere();
    const { data: left } = await env.service().from('push_subscriptions').select('user_id');
    expect(left).toEqual([{ user_id: lea.id }]);
    expect((await sam.sb.auth.getSession()).data.session).toBeNull();
    // L'autre appareil : sa session est retirée dès qu'il vérifie auprès du serveur (ouverture, retour sur l'application).
    await new Api(phone).checkSession();
    expect((await phone.auth.getSession()).data.session).toBeNull();
    expect(await stillOpen(lea.sb)).toBe(true);
  });
});

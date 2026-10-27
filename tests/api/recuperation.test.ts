import { describe, expect, it } from 'vitest';
import { Api } from '../../src/data/api.ts';
import { parseRecoveryLink, RECOVERY_EXPIRED } from '../../src/domain/recovery.ts';
import { makeEnv } from '../helpers/env.ts';

describe('lien « mot de passe oublié » : lecture de l’adresse', () => {
  it('jeton retiré de l’adresse, route de l’application gardée', () => {
    expect(parseRecoveryLink(`https://cave.test/?auth=recovery&token_hash=${'a1'.repeat(28)}#/cave`)).toEqual({
      tokenHash: 'a1'.repeat(28),
      expired: false,
      cleanUrl: 'https://cave.test/#/cave',
    });
  });

  it('erreur renvoyée par Supabase (lien déjà utilisé ou expiré), dans la requête et le fragment : signalée, puis effacée', () => {
    const href =
      'https://cave.test/?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid#error=access_denied&error_code=otp_expired&sb=';
    expect(parseRecoveryLink(href)).toEqual({ tokenHash: null, expired: true, cleanUrl: 'https://cave.test/' });
    expect(parseRecoveryLink('https://cave.test/?auth=recovery&token_hash=<script>')).toMatchObject({ tokenHash: null, expired: true });
    expect(RECOVERY_EXPIRED).toMatch(/seul le dernier e-mail/);
  });

  it('les autres adresses ne sont pas touchées (lien de Nous, invitation)', () => {
    expect(parseRecoveryLink('https://cave.test/?auth=link&token_hash=abcdefabcdefabcdef#/agenda')).toBeNull();
    expect(parseRecoveryLink('https://cave.test/#/ami/ABC123')).toBeNull();
  });
});

describe('lien « mot de passe oublié » : sur un autre appareil que celui de la demande', () => {
  it('le jeton ouvre une session de récupération, une seule fois ; seul le dernier e-mail est valable ; nouveau mot de passe', async () => {
    const env = await makeEnv();
    const claire = await env.signUp('Claire', 'ancien-mot-2026');
    // Demande depuis un appareil…
    await env.client().auth.resetPasswordForEmail(claire.email);
    const first = env.fake.lastRecoveryToken(claire.email)!;
    await env.client().auth.resetPasswordForEmail(claire.email);
    const last = env.fake.lastRecoveryToken(claire.email)!;
    expect(first).not.toBe(last);

    // … lien ouvert sur un autre (aucune donnée partagée entre les deux clients).
    const phone = new Api(env.client());
    expect(await phone.verifyRecovery(first)).toBeNull();
    const session = await phone.verifyRecovery(last);
    expect(session?.user.email).toBe(claire.email);
    expect(await new Api(env.client()).verifyRecovery(last)).toBeNull();

    await phone.updatePassword('nouveau-mot-2026');
    await expect(new Api(env.client()).signIn(claire.email, 'nouveau-mot-2026')).resolves.toBeUndefined();
    await expect(new Api(env.client()).signIn(claire.email, 'ancien-mot-2026')).rejects.toBeTruthy();
  });

  it('adresse inconnue : même réponse, aucun lien', async () => {
    const env = await makeEnv();
    await expect(env.client().auth.resetPasswordForEmail('personne@exemple.test')).resolves.toMatchObject({ error: null });
    expect(env.fake.lastRecoveryToken('personne@exemple.test')).toBeNull();
  });
});

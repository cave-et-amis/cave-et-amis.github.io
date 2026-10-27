import { describe, expect, it } from 'vitest';
import { Api } from '../../src/data/api.ts';
import { EMAIL_CHANGE_EXPIRED, expiredMessage, parseEmailLink, RECOVERY_EXPIRED, SIGNUP_EXPIRED } from '../../src/domain/emailLink.ts';
import { makeEnv } from '../helpers/env.ts';

describe('liens reçus par e-mail : lecture de l’adresse', () => {
  it('mot de passe oublié, inscription, changement d’adresse : jeton retiré, route de l’application gardée', () => {
    const h = 'a1'.repeat(28);
    expect(parseEmailLink(`https://cave.test/?auth=recovery&token_hash=${h}#/cave`)).toEqual({
      kind: 'recovery',
      tokenHash: h,
      expired: false,
      cleanUrl: 'https://cave.test/#/cave',
    });
    expect(parseEmailLink(`https://cave.test/?auth=signup&token_hash=${h}`)).toMatchObject({ kind: 'signup', tokenHash: h, cleanUrl: 'https://cave.test/' });
    expect(parseEmailLink(`https://cave.test/?auth=email_change&token_hash=${h}`)).toMatchObject({ kind: 'email_change', tokenHash: h });
  });

  it('erreur renvoyée par Supabase (lien déjà utilisé ou expiré), dans la requête et le fragment : signalée, puis effacée', () => {
    const href =
      'https://cave.test/?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid#error=access_denied&error_code=otp_expired&sb=';
    expect(parseEmailLink(href)).toEqual({ kind: null, tokenHash: null, expired: true, cleanUrl: 'https://cave.test/' });
    expect(parseEmailLink('https://cave.test/?auth=recovery&token_hash=<script>')).toMatchObject({ tokenHash: null, expired: true });
    expect(RECOVERY_EXPIRED).toMatch(/seul le dernier e-mail/);
    expect(expiredMessage(null)).toBe(RECOVERY_EXPIRED);
    expect(expiredMessage('signup')).toBe(SIGNUP_EXPIRED);
    expect(expiredMessage('email_change')).toBe(EMAIL_CHANGE_EXPIRED);
  });

  it('les autres adresses ne sont pas touchées (lien de Nous, invitation, type inconnu)', () => {
    expect(parseEmailLink('https://cave.test/?auth=link&token_hash=abcdefabcdefabcdef#/agenda')).toBeNull();
    expect(parseEmailLink('https://cave.test/?auth=invite&token_hash=abcdefabcdefabcdef')).toBeNull();
    expect(parseEmailLink('https://cave.test/#/ami/ABC123')).toBeNull();
  });
});

describe('changement d’adresse e-mail : les deux liens sont exigés, sur n’importe quel appareil', () => {
  it('rien ne change après un seul lien ; au second, nouvelle adresse et session ; liens à usage unique', async () => {
    const env = await makeEnv();
    const claire = await env.signUp('Claire', 'mot-de-passe-2026');
    const app = new Api(claire.sb);
    await app.changeEmail('claire.nouvelle@exemple.test');
    expect(await app.pendingEmail()).toBe('claire.nouvelle@exemple.test');
    const tokens = env.fake.emailChangeTokens(claire.id)!;

    // Lien de l'adresse actuelle, ouvert sur un autre appareil : accepté, mais rien ne change encore.
    expect(await new Api(env.client()).verifyEmailChange(tokens.current)).toEqual({ result: 'other' });
    expect(await new Api(env.client()).verifyEmailChange(tokens.current)).toEqual({ result: 'expired' });
    await expect(new Api(env.client()).signIn(claire.email, 'mot-de-passe-2026')).resolves.toBeUndefined();

    // Lien de la nouvelle adresse : changement fait, session ouverte avec la nouvelle adresse.
    const done = await new Api(env.client()).verifyEmailChange(tokens.next);
    expect(done).toMatchObject({ result: 'done' });
    expect(done.result === 'done' && done.session.user.email).toBe('claire.nouvelle@exemple.test');
    await expect(new Api(env.client()).signIn('claire.nouvelle@exemple.test', 'mot-de-passe-2026')).resolves.toBeUndefined();
    await expect(new Api(env.client()).signIn(claire.email, 'mot-de-passe-2026')).rejects.toBeTruthy();
    expect(await new Api(env.client()).verifyEmailChange(tokens.next)).toEqual({ result: 'expired' });
  });

  it('adresse déjà prise par un autre compte : refusée, rien n’est demandé', async () => {
    const env = await makeEnv();
    const claire = await env.signUp('Claire');
    const bruno = await env.signUp('Bruno');
    await expect(new Api(claire.sb).changeEmail(bruno.email)).rejects.toBeTruthy();
    expect(env.fake.emailChangeTokens(claire.id)).toBeNull();
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

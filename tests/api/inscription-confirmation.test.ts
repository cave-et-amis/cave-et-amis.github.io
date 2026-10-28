import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { Api } from '../../src/data/api.ts';
import { maskEmail, resendWaitSeconds } from '../../src/domain/emailLink.ts';
import { toMessage } from '../../src/domain/errors.ts';
import { makeEnv, TEST_PUBLIC_KEY, TEST_URL } from '../helpers/env.ts';

// Comme en ligne (« Confirm email » activé) pour les adresses en @confirmation.test.
const confirmEnv = () => makeEnv({}, { confirmEmail: (e) => e.endsWith('@confirmation.test') });
const PASSWORD = 'motdepasse2026';

describe('inscription avec confirmation de l’adresse par e-mail', () => {
  it('inscription réussie : pas de session, un lien part, la connexion attend la confirmation', async () => {
    const env = await confirmEnv();
    const api = new Api(env.client());
    expect(await api.signUp('Lucie', 'lucie@confirmation.test', PASSWORD)).toEqual({ needsConfirmation: true });
    expect(await api.getSession()).toBeNull();
    expect(await env.fake.lastSignupToken('lucie@confirmation.test')).toMatch(/^[0-9a-f]{56}$/);
    const refused = await api.signIn('lucie@confirmation.test', PASSWORD).catch((e: unknown) => e);
    expect(toMessage(refused)).toMatch(/Confirmez d’abord votre adresse/);
  });

  it('confirmation réussie : le lien ouvre la session (sur un autre appareil aussi), une seule fois', async () => {
    const env = await confirmEnv();
    await new Api(env.client()).signUp('Lucie', 'lucie@confirmation.test', PASSWORD);
    const token = (await env.fake.lastSignupToken('lucie@confirmation.test'))!;
    const session = await new Api(env.client()).verifySignup(token);
    expect(session?.user.email).toBe('lucie@confirmation.test');
    expect(session?.user.user_metadata.display_name).toBe('Lucie');
    expect(await new Api(env.client()).verifySignup(token)).toBeNull();
    await expect(new Api(env.client()).signIn('lucie@confirmation.test', PASSWORD)).resolves.toBeUndefined();
  });

  it('lien expiré ou invalide : refusé sans rien ouvrir', async () => {
    const env = await confirmEnv();
    expect(await new Api(env.client()).verifySignup('ab'.repeat(28))).toBeNull();
  });

  it('renvoi : refusé avant le délai (secondes lues), accepté après ; seul le dernier lien fonctionne', async () => {
    const env = await confirmEnv();
    const api = new Api(env.client());
    await api.signUp('Lucie', 'lucie@confirmation.test', PASSWORD);
    const first = (await env.fake.lastSignupToken('lucie@confirmation.test'))!;

    const tooSoon = await api.resendConfirmation('lucie@confirmation.test').catch((e: unknown) => e);
    expect(resendWaitSeconds(tooSoon)).toBeGreaterThan(50);
    expect(await env.fake.lastSignupToken('lucie@confirmation.test')).toBe(first);

    await env.fake.ageSignupMail('lucie@confirmation.test');
    await expect(api.resendConfirmation('lucie@confirmation.test')).resolves.toBeUndefined();
    const second = (await env.fake.lastSignupToken('lucie@confirmation.test'))!;
    expect(second).not.toBe(first);
    expect(await new Api(env.client()).verifySignup(first)).toBeNull();
    expect(await new Api(env.client()).verifySignup(second)).not.toBeNull();
  });

  it('adresse déjà inscrite : même réponse qu’une inscription neuve, sans e-mail ni indice', async () => {
    const env = await confirmEnv();
    await new Api(env.client()).signUp('Lucie', 'lucie@confirmation.test', PASSWORD);
    const token = (await env.fake.lastSignupToken('lucie@confirmation.test'))!;
    await new Api(env.client()).verifySignup(token);

    // Compte confirmé : aucune erreur, aucun lien, aucun accès.
    const again = new Api(env.client());
    expect(await again.signUp('Autre', 'lucie@confirmation.test', 'autre-mdp-2026')).toEqual({ needsConfirmation: true });
    expect(await env.fake.lastSignupToken('lucie@confirmation.test')).toBeNull();
    await expect(new Api(env.client()).signIn('lucie@confirmation.test', 'autre-mdp-2026')).rejects.toBeTruthy();

    // Renvoi pour une adresse confirmée ou inconnue : même réponse qu'une adresse en attente.
    await expect(again.resendConfirmation('lucie@confirmation.test')).resolves.toBeUndefined();
    await expect(again.resendConfirmation('personne@confirmation.test')).resolves.toBeUndefined();
  });

  it('erreur réseau : inscription refusée avec un message clair ; lien non essayé, signalé à part', async () => {
    const offline = createClient(TEST_URL, TEST_PUBLIC_KEY, {
      global: { fetch: () => Promise.reject(new TypeError('Failed to fetch')) },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'hors-ligne' },
    });
    const api = new Api(offline);
    const err = await api.signUp('Lucie', 'lucie@confirmation.test', PASSWORD).catch((e: unknown) => e);
    expect(toMessage(err)).toMatch(/Connexion impossible/);
    await expect(api.verifySignup('ab'.repeat(28))).rejects.toBeTruthy();
  });
});

describe('page « e-mail envoyé » : adresse masquée', () => {
  it('début et fin du nom, domaine entier', () => {
    expect(maskEmail('bruno.oliveira@gmail.com')).toBe('br•••••a@gmail.com');
    expect(maskEmail(' lucie@exemple.fr ')).toBe('lu•••••e@exemple.fr');
    expect(maskEmail('anne@exemple.fr')).toBe('a•••@exemple.fr');
    expect(maskEmail('al@exemple.fr')).toBe('a•@exemple.fr');
    expect(maskEmail('sans-arobase')).toBe('sans-arobase');
  });

  it('délai lu dans le refus de Supabase, rien pour une autre erreur', () => {
    expect(resendWaitSeconds({ message: 'For security purposes, you can only request this after 42 seconds.' })).toBe(42);
    expect(resendWaitSeconds({ message: 'Email rate limit exceeded' })).toBeNull();
    expect(resendWaitSeconds(null)).toBeNull();
  });
});

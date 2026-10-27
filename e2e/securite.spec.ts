/**
 * Sécurité côté site (audit, points F1 et F5), sur téléphone : affichée dans le cadre d'un autre site, l'application ne
 * démarre pas ; « Déconnecter tous mes appareils » ferme aussi la session d'un autre téléphone. La connexion par un lien
 * venu de Nous (F2) et les liens de Lia (F3) sont vérifiés par Vitest (tests/nous-links.test.ts, tests/external-links.test.ts,
 * tests/api/sessions.test.ts). Fichier nommé pour passer avant vos-donnees.spec.ts (conditions publiées ensuite).
 */
import { expect, test, type Browser, type BrowserContext } from '@playwright/test';
import { goto, signIn, signUp } from './helpers';

test.describe.configure({ mode: 'serial' });

let contexts: BrowserContext[] = [];

async function newPhone(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  contexts.push(ctx);
  return ctx.newPage();
}

test.afterAll(async () => {
  for (const c of contexts) await c.close();
  contexts = [];
});

test('dans le cadre d’un autre site, l’application ne démarre pas et propose de s’ouvrir dans son propre onglet', async ({ page, baseURL }) => {
  await page.setContent(`<iframe title="Site piégé" src="${baseURL}/#/reglages" style="width: 360px; height: 640px"></iframe>`);
  const frame = page.frameLocator('iframe[title="Site piégé"]');
  await expect(frame.getByText('Par sécurité, Cave & Amis ne s’ouvre pas à l’intérieur d’un autre site.')).toBeVisible();
  const link = frame.getByRole('link', { name: 'Ouvrir Cave & Amis dans son propre onglet' });
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('href', `${baseURL}/#/reglages`);
  await expect(frame.getByLabel('Adresse e-mail')).toHaveCount(0);
});

test('lien « mot de passe oublié » déjà utilisé ou expiré : expliqué, avec le formulaire pour en redemander un', async ({ browser, baseURL }) => {
  const phone = await newPhone(browser);
  // Adresse renvoyée par Supabase pour un lien périmé ; puis un lien de l'application dont le jeton n'existe pas.
  await phone.goto(`${baseURL}/?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired#error=access_denied&error_code=otp_expired&sb=`);
  await expect(phone.getByRole('heading', { name: 'Mot de passe oublié' })).toBeVisible();
  await expect(phone.getByText(/Ce lien n’est plus valable/)).toBeVisible();
  await expect(phone).not.toHaveURL(/error_code|otp_expired/);
  await phone.goto(`${baseURL}/?auth=recovery&token_hash=${'0f'.repeat(28)}`);
  await expect(phone.getByText(/Ce lien n’est plus valable/)).toBeVisible();
  await expect(phone).not.toHaveURL(/token_hash/);
});

test('déconnecter tous mes appareils : cet appareil puis un autre téléphone sont déconnectés', async ({ browser }) => {
  const phone = await newPhone(browser);
  await signUp(phone, 'Sacha');
  await expect(phone.getByRole('heading', { name: 'Bonjour Sacha' })).toBeVisible();
  const other = await newPhone(browser);
  await signIn(other, 'Sacha');

  await phone.evaluate(() => localStorage.setItem('cave.scan.budget', '25'));
  await goto(phone, '/reglages');
  await phone.getByRole('button', { name: 'Déconnecter tous mes appareils' }).click();
  const dialog = phone.getByRole('alertdialog', { name: 'Déconnecter tous vos appareils ?' });
  await expect(dialog).toContainText('plus aucun appareil ne reçoit vos notifications');
  await dialog.getByRole('button', { name: 'Tout déconnecter' }).click();
  await expect(phone.getByRole('button', { name: 'Se connecter' }).last()).toBeVisible();
  expect(await phone.evaluate(() => localStorage.getItem('cave.scan.budget'))).toBeNull();

  // L'autre téléphone : sa session est refusée dès qu'on revient sur l'application.
  await other.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(other.getByRole('button', { name: 'Se connecter' }).last()).toBeVisible();
  // Le mot de passe reste le même : on se reconnecte normalement.
  await signIn(other, 'Sacha');
});

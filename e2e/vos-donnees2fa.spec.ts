/**
 * Double authentification de l'administrateur, sur téléphone : Bruno l'active dans Réglages (QR code et clé à recopier ;
 * le code est calculé ici à partir de la clé affichée, comme le ferait son application d'authentification), publie un
 * document avec la session vérifiée par le code, se déconnecte ; à la connexion suivante, le code est demandé, même après
 * un rechargement de la page ; mauvais code refusé ; « Se déconnecter » depuis l'écran du code ; puis il la désactive.
 *
 * Fichier nommé pour passer après vos-donnees.spec.ts (Playwright range les fichiers par ordre alphabétique ; avec un
 * tiret, « vos-donnees-2fa » passerait avant). Il finit sans double authentification : desktop.spec.ts se connecte
 * ensuite comme Bruno avec son seul mot de passe.
 */
import { createHmac } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { email, goto, PASSWORD, shot, signIn, toast } from './helpers';

test.describe.configure({ mode: 'serial' });

/** Serveur local des tests d'interface (playwright.config.ts). */
const API = 'http://127.0.0.1:54399';

let ctx: BrowserContext;
let bruno: Page;
// Clé lue à l'écran pendant l'activation (valeur de test, propre à cette série).
let secret = '';

/** Code à 6 chiffres d'une application d'authentification (RFC 6238 : HMAC-SHA1, pas de 30 s). */
function totp(key: string, at = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...key.replace(/\s/g, '').toUpperCase()].map((c) => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('');
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac('sha1', Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)))).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** Un code faux à coup sûr : aucun de ceux valables autour de maintenant. */
function wrongCode(key: string) {
  const valid = new Set([-2, -1, 0, 1, 2].map((k) => totp(key, Date.now() + k * 30_000)));
  let n = 0;
  while (valid.has(String(n).padStart(6, '0'))) n += 1;
  return String(n).padStart(6, '0');
}

/** Connexion par mot de passe, sans attendre l'accueil : l'écran du code peut venir avant. */
async function logIn() {
  await bruno.goto('/');
  await bruno.getByLabel('Adresse e-mail').fill(email('Bruno'));
  await bruno.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await bruno.getByRole('button', { name: 'Se connecter' }).last().click();
}

async function logOut() {
  await goto(bruno, '/reglages');
  await bruno.getByRole('button', { name: 'Se déconnecter' }).first().click();
  await bruno.getByRole('alertdialog', { name: 'Se déconnecter ?' }).getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(bruno.getByRole('button', { name: 'Se connecter' }).last()).toBeVisible();
}

const section = () => bruno.getByRole('region', { name: 'Double authentification', exact: true });
const codeScreen = () => bruno.getByRole('heading', { name: 'Code de double authentification' });

/**
 * Filet de sécurité, si le parcours s'est arrêté en route : le code est retiré par l'API du serveur local, pour que les
 * parcours suivants puissent se connecter avec le seul mot de passe.
 */
async function removeLeftoverFactor() {
  if (!secret) return;
  const headers = { apikey: 'local-publishable-key', 'Content-Type': 'application/json' };
  const as = (token: string) => ({ ...headers, Authorization: `Bearer ${token}` });
  const login = await (
    await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers, body: JSON.stringify({ email: email('Bruno'), password: PASSWORD }) })
  ).json();
  const factor = (login.user?.factors ?? []).find((f: { status: string }) => f.status === 'verified');
  if (!factor) return;
  const challenge = await (await fetch(`${API}/auth/v1/factors/${factor.id}/challenge`, { method: 'POST', headers: as(login.access_token), body: '{}' })).json();
  const verified = await (
    await fetch(`${API}/auth/v1/factors/${factor.id}/verify`, {
      method: 'POST',
      headers: as(login.access_token),
      body: JSON.stringify({ challenge_id: challenge.id, code: totp(secret) }),
    })
  ).json();
  await fetch(`${API}/auth/v1/factors/${factor.id}`, { method: 'DELETE', headers: as(verified.access_token) });
}

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  bruno = await ctx.newPage();
});

test.afterAll(async () => {
  await ctx.close();
  await removeLeftoverFactor();
});

test('Bruno active la double authentification : QR code, clé à recopier, code vérifié', async () => {
  await signIn(bruno, 'Bruno');
  await goto(bruno, '/reglages');
  await expect(section()).toContainText('Désactivée');
  await section().getByRole('button', { name: 'Activer la double authentification' }).click();
  const sheet = bruno.getByRole('dialog', { name: 'Activer la double authentification' });
  await expect(sheet.getByRole('img', { name: /QR code de la double authentification/ })).toBeVisible();
  secret = (await sheet.getByLabel('Clé à recopier dans l’application d’authentification').innerText()).replace(/\s/g, '');
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);

  // Code faux : refusé, la fenêtre reste ouverte.
  await sheet.getByLabel('Code à 6 chiffres').fill(wrongCode(secret));
  await sheet.getByRole('button', { name: 'Activer', exact: true }).click();
  await expect(sheet.getByText(/^Code incorrect/)).toBeVisible();

  await sheet.getByLabel('Code à 6 chiffres').fill(totp(secret));
  await sheet.getByRole('button', { name: 'Activer', exact: true }).click();
  await toast(bruno, 'Double authentification activée');
  await expect(sheet).toBeHidden();
  await expect(section()).toContainText('Activée depuis le');
});

test('avec la session vérifiée par le code, l’administration s’ouvre et la publication passe', async () => {
  await goto(bruno, '/admin');
  await expect(bruno.getByRole('button', { name: 'Tester la connexion' })).toBeVisible();
  const row = bruno.locator('.row', { hasText: 'Mentions légales' });
  await expect(row).toContainText(/Version \d+|Pas encore publié/);
  const before = Number(/Version (\d+)/.exec(await row.innerText())?.[1] ?? 0);
  await row.getByRole('button', { name: 'Nouvelle version' }).click();
  const sheet = bruno.getByRole('dialog', { name: 'Mentions légales : nouvelle version' });
  await sheet.getByLabel(/Texte \(Markdown/).fill('## Éditeur\n\nMentions légales de test, publiées avec la double authentification.');
  await sheet.getByRole('button', { name: 'Publier' }).click();
  await bruno.getByRole('alertdialog', { name: 'Publier ce document ?' }).getByRole('button', { name: 'Publier' }).click();
  await toast(bruno, 'Document publié');
  await expect(row).toContainText(`Version ${before + 1}`);
});

test('connexion suivante : code demandé, même après rechargement ; « Se déconnecter » ; mauvais code refusé, bon code accepté', async () => {
  await logOut();
  await logIn();
  await expect(codeScreen()).toBeVisible();
  await expect(bruno.getByRole('heading', { name: 'Bonjour Bruno' })).toHaveCount(0);
  await shot(bruno, '15-code-double-authentification');
  // Session reprise au lancement : le code est toujours demandé.
  await bruno.reload();
  await expect(codeScreen()).toBeVisible();

  await bruno.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(bruno.getByRole('button', { name: 'Se connecter' }).last()).toBeVisible();
  await logIn();
  await expect(codeScreen()).toBeVisible();

  await bruno.getByLabel('Code à 6 chiffres').fill(wrongCode(secret));
  await bruno.getByRole('button', { name: 'Valider' }).click();
  await expect(bruno.getByText(/^Code incorrect/)).toBeVisible();
  await expect(codeScreen()).toBeVisible();
  await bruno.getByLabel('Code à 6 chiffres').fill(totp(secret));
  await bruno.getByRole('button', { name: 'Valider' }).click();
  await expect(bruno.getByRole('heading', { name: 'Bonjour Bruno' })).toBeVisible();
  // Session vérifiée par le code, reprise au lancement : rien à saisir.
  await bruno.reload();
  await expect(bruno.getByRole('heading', { name: 'Bonjour Bruno' })).toBeVisible();
  await expect(codeScreen()).toHaveCount(0);
});

test('Bruno désactive la double authentification ; le mot de passe seul suffit de nouveau', async () => {
  await goto(bruno, '/reglages');
  await section().getByRole('button', { name: 'Désactiver la double authentification' }).click();
  await bruno.getByRole('alertdialog', { name: 'Désactiver la double authentification ?' }).getByRole('button', { name: 'Désactiver' }).click();
  await toast(bruno, 'Double authentification désactivée');
  await expect(section()).toContainText('Désactivée');
  await logOut();
  await signIn(bruno, 'Bruno');
  await expect(codeScreen()).toHaveCount(0);
});

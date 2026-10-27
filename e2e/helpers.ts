import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';

/** Identifiant de la série de tests (fixé par playwright.config.ts, commun à tous les fichiers). */
export const RUN = process.env.E2E_RUN ?? 'local';
export const PASSWORD = 'motdepasse-e2e-2026';
export const email = (name: string) => `${name.toLowerCase()}.${RUN}@exemple.test`;

/** Fabrique dans le navigateur une vraie photo JPEG d'étiquette (600 × 800). */
export async function labelPhoto(page: Page) {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 600;
    c.height = 800;
    const g = c.getContext('2d')!;
    g.fillStyle = '#f4ead2';
    g.fillRect(0, 0, 600, 800);
    g.fillStyle = '#5e1426';
    g.font = 'bold 48px serif';
    g.fillText('Château Labeille', 80, 300);
    g.font = '36px serif';
    g.fillText('Pauillac 2016', 160, 380);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}

/**
 * L'accueil « Bienvenue sur Cave & Amis ! » s'ouvre une fois pour chaque compte : les parcours qui ne le testent pas le
 * referment (« Commencer directement ») dès qu'il apparaît, avant chaque action ou vérification.
 */
const skipping = new WeakSet<Page>();
export async function skipWelcome(page: Page) {
  if (skipping.has(page)) return;
  skipping.add(page);
  await page.addLocatorHandler(page.getByRole('dialog', { name: 'Bienvenue sur Cave & Amis ! 🍷' }), async (dialog) => {
    await dialog.getByRole('button', { name: 'Commencer directement' }).click();
  });
}

/** Case de l'inscription (âge minimum, et conditions d'utilisation quand elles sont publiées), jamais cochée d'avance. */
export async function confirmAge(page: Page) {
  const box = page.getByRole('checkbox', { name: /J’ai 18 ans ou plus/ });
  await expect(box).not.toBeChecked();
  await box.check();
}

/** Création de compte ; « welcome » : garder l'accueil et la visite guidée (parcours qui les testent). */
export async function signUp(page: Page, name: string, path = '/', { welcome = false } = {}) {
  if (!welcome) await skipWelcome(page);
  await page.goto(path);
  // Lien d'invitation : la vitrine d'abord, puis la création de compte.
  if (path.includes('#/ami/')) await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await page.getByRole('button', { name: 'Créer un compte' }).click();
  await page.getByLabel('Votre prénom').fill(name);
  await page.getByLabel('Adresse e-mail').fill(email(name));
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await confirmAge(page);
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
}

export async function signIn(page: Page, name: string) {
  await skipWelcome(page);
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill(email(name));
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).last().click();
  const hello = page.getByRole('heading', { name: `Bonjour ${name}` });
  await answerCode(page, hello);
  await expect(hello).toBeVisible();
}

/** Code à 6 chiffres d'une application d'authentification (RFC 6238 : HMAC-SHA1, pas de 30 s). */
export function totp(key: string, at = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...key.replace(/\s/g, '').toUpperCase()].map((c) => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('');
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac('sha1', Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)))).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/**
 * Clé de la double authentification de Bruno, obligatoire pour administrer : lue à l'écran à son activation (parcours),
 * gardée le temps de la série pour que les fichiers suivants calculent son code, comme son application le ferait.
 */
const ADMIN_KEY_FILE = join(process.cwd(), '.local', `e2e-cle-administrateur-${RUN}.txt`);
export function saveAdminKey(key: string) {
  mkdirSync(dirname(ADMIN_KEY_FILE), { recursive: true });
  writeFileSync(ADMIN_KEY_FILE, key);
}
export function adminKey() {
  return existsSync(ADMIN_KEY_FILE) ? readFileSync(ADMIN_KEY_FILE, 'utf8').trim() : '';
}

/** Après « Se connecter » : si l'écran du code apparaît (au lieu de `next`), saisit le code de l'administrateur. */
export async function answerCode(page: Page, next: Locator) {
  const code = page.getByRole('heading', { name: 'Code de double authentification' });
  await expect(code.or(next).first()).toBeVisible();
  if (!(await code.isVisible())) return;
  await page.getByLabel('Code à 6 chiffres').fill(totp(adminKey()));
  await page.getByRole('button', { name: 'Valider' }).click();
}

/** Réglages › « Activer la double authentification » : QR code, clé lue à l'écran, premier code. Renvoie la clé. */
export async function enableCode(page: Page) {
  await goto(page, '/reglages');
  const section = page.getByRole('region', { name: 'Double authentification', exact: true });
  await section.getByRole('button', { name: 'Activer la double authentification' }).click();
  const sheet = page.getByRole('dialog', { name: 'Activer la double authentification' });
  await expect(sheet.getByRole('img', { name: /QR code de la double authentification/ })).toBeVisible();
  const key = (await sheet.getByLabel('Clé à recopier dans l’application d’authentification').innerText()).replace(/\s/g, '');
  expect(key).toMatch(/^[A-Z2-7]{32}$/);
  await sheet.getByLabel('Code à 6 chiffres').fill(totp(key));
  await sheet.getByRole('button', { name: 'Activer', exact: true }).click();
  await toast(page, 'Double authentification activée');
  await expect(sheet).toBeHidden();
  await expect(section).toContainText('Activée depuis le');
  return key;
}

/**
 * Crée un lien avec Amis & Groupes › « Inviter quelqu'un » et renvoie son code. « kind » : libellé du type de lien ;
 * « target » : groupe ou événement visé (libellé de la liste).
 */
export async function inviteCode(page: Page, kind = 'Voir ma cave', target?: string | RegExp) {
  await goto(page, '/amis');
  await page.getByRole('button', { name: 'Inviter quelqu’un', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Inviter quelqu’un' });
  await sheet.getByRole('radio', { name: kind }).check();
  if (target) {
    const select = sheet.getByRole('combobox', { name: /Groupe|Événement/ });
    const value = await select.locator('option', { hasText: target }).getAttribute('value');
    await select.selectOption(value!);
  }
  await sheet.getByRole('button', { name: /^Créer le lien/ }).click();
  const ready = page.getByRole('dialog', { name: 'Votre invitation est prête' });
  const code = (await ready.locator('.kbd-code').innerText()).replace(/-/g, '');
  await ready.getByRole('button', { name: 'Fermer' }).click();
  return code;
}

export async function toast(page: Page, text: string | RegExp) {
  await expect(page.locator('.toast').filter({ hasText: text }).first()).toBeVisible();
}

export async function goto(page: Page, hash: string) {
  await page.evaluate((h) => (window.location.hash = h), hash);
}

/** Valeur d'une tuile de la fiche du vin (« en stock », « disponibles », « réservée »…). */
export async function tile(page: Page, label: RegExp) {
  const t = page.locator('.tile').filter({ has: page.locator('.label', { hasText: label }) }).first();
  return Number(await t.locator('.value').innerText());
}

export async function shot(page: Page, name: string) {
  await page.screenshot({ path: `reports/screens/${name}.png`, fullPage: false });
}

/** Fabrique dans le navigateur une photo JPEG de bouteille entière sur un fond de cuisine (600 × 900). */
export async function bottlePhoto(page: Page) {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 600;
    c.height = 900;
    const g = c.getContext('2d')!;
    const bg = g.createLinearGradient(0, 0, 600, 900);
    bg.addColorStop(0, '#b9a58c');
    bg.addColorStop(1, '#6f5a45');
    g.fillStyle = bg;
    g.fillRect(0, 0, 600, 900);
    g.fillStyle = '#8b7355';
    g.fillRect(0, 720, 600, 180);
    // Bouteille : goulot, épaules, corps.
    g.fillStyle = '#1f2a1c';
    g.fillRect(272, 90, 56, 170);
    g.beginPath();
    g.moveTo(272, 250);
    g.quadraticCurveTo(200, 300, 200, 380);
    g.lineTo(200, 800);
    g.quadraticCurveTo(200, 830, 230, 830);
    g.lineTo(370, 830);
    g.quadraticCurveTo(400, 830, 400, 800);
    g.lineTo(400, 380);
    g.quadraticCurveTo(400, 300, 328, 250);
    g.closePath();
    g.fill();
    g.fillStyle = '#7a1b2c';
    g.fillRect(268, 80, 64, 40);
    // Étiquette.
    g.fillStyle = '#f4ead2';
    g.fillRect(215, 480, 170, 210);
    g.fillStyle = '#5e1426';
    g.font = 'bold 26px serif';
    g.fillText('Château', 250, 560);
    g.fillText('Studio', 258, 600);
    g.font = '20px serif';
    g.fillText('2019', 278, 650);
    return c.toDataURL('image/jpeg', 0.92).split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}

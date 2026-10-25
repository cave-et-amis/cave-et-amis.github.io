import { expect, type Page } from '@playwright/test';

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

export async function signUp(page: Page, name: string, path = '/') {
  await page.goto(path);
  // Lien d'invitation : la vitrine d'abord, puis la création de compte.
  if (path.includes('#/ami/')) await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await page.getByRole('button', { name: 'Créer un compte' }).click();
  await page.getByLabel('Votre prénom').fill(name);
  await page.getByLabel('Adresse e-mail').fill(email(name));
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
}

export async function signIn(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill(email(name));
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).last().click();
  await expect(page.getByRole('heading', { name: `Bonjour ${name}` })).toBeVisible();
}

/**
 * Crée un lien d'invitation depuis Amis & Groupes › Invitations et renvoie son code. « kind » : libellé du type de lien ;
 * « target » : groupe ou événement visé (libellé de la liste).
 */
export async function inviteCode(page: Page, kind = 'Ami, avec accès à ma cave', target?: string | RegExp) {
  await goto(page, '/amis?onglet=invitations');
  await page.getByRole('radio', { name: kind }).check();
  if (target) {
    const select = page.getByRole('combobox', { name: /Groupe|Événement/ });
    const value = await select.locator('option', { hasText: target }).getAttribute('value');
    await select.selectOption(value!);
  }
  await page.getByRole('button', { name: /^Créer le lien/ }).click();
  const code = (await page.locator('.kbd-code').innerText()).replace(/-/g, '');
  await page.getByRole('dialog').getByRole('button', { name: 'Fermer' }).click();
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

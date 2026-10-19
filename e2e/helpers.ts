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

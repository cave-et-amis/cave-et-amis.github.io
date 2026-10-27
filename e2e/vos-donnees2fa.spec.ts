/**
 * Double authentification, sur téléphone. Bruno l'a activée dans le parcours (obligatoire pour administrer) : avec la
 * session vérifiée par le code, il publie un document ; à la connexion suivante, le code est demandé, même après un
 * rechargement ; mauvais code refusé ; « Se déconnecter » depuis l'écran du code. S'il la désactive, l'administration se
 * ferme jusqu'à ce qu'il la réactive. Claire, simple compte, peut aussi l'activer, puis la retirer.
 *
 * Fichier nommé pour passer après vos-donnees.spec.ts (Playwright range les fichiers par ordre alphabétique ; avec un
 * tiret, « vos-donnees-2fa » passerait avant). Il finit avec la double authentification de Bruno active, et sa clé
 * gardée pour desktop.spec.ts (saveAdminKey).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { adminKey, email, enableCode, goto, PASSWORD, saveAdminKey, shot, signIn, toast, totp } from './helpers';

test.describe.configure({ mode: 'serial' });

let ctx: BrowserContext;
let bruno: Page;

/** Un code faux à coup sûr : aucun de ceux valables autour de maintenant. */
function wrongCode(key: string) {
  const valid = new Set([-2, -1, 0, 1, 2].map((k) => totp(key, Date.now() + k * 30_000)));
  let n = 0;
  while (valid.has(String(n).padStart(6, '0'))) n += 1;
  return String(n).padStart(6, '0');
}

/** Connexion par mot de passe, sans attendre l'accueil : l'écran du code peut venir avant. */
async function logIn(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill(email(name));
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).last().click();
}

async function logOut(page: Page) {
  await goto(page, '/reglages');
  await page.getByRole('button', { name: 'Se déconnecter' }).first().click();
  await page.getByRole('alertdialog', { name: 'Se déconnecter ?' }).getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page.getByRole('button', { name: 'Se connecter' }).last()).toBeVisible();
}

const section = (page: Page) => page.getByRole('region', { name: 'Double authentification', exact: true });
const codeScreen = (page: Page) => page.getByRole('heading', { name: 'Code de double authentification' });

async function disable(page: Page) {
  await goto(page, '/reglages');
  await section(page).getByRole('button', { name: 'Désactiver la double authentification' }).click();
  await page.getByRole('alertdialog', { name: 'Désactiver la double authentification ?' }).getByRole('button', { name: 'Désactiver' }).click();
  await toast(page, 'Double authentification désactivée');
  await expect(section(page)).toContainText('Désactivée');
}

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  bruno = await ctx.newPage();
});

test.afterAll(async () => {
  await ctx.close();
});

test('avec la session vérifiée par le code, l’administration s’ouvre et la publication passe', async () => {
  expect(adminKey()).toMatch(/^[A-Z2-7]{32}$/);
  await signIn(bruno, 'Bruno');
  await goto(bruno, '/reglages');
  await expect(section(bruno)).toContainText('Activée depuis le');
  await expect(section(bruno)).toContainText('Obligatoire pour l’administration');
  await goto(bruno, '/admin');
  await expect(bruno.getByRole('button', { name: 'Tester la connexion' })).toBeVisible();
  const row = bruno.getByRole('region', { name: 'Documents légaux' }).locator('.row', { hasText: 'Mentions légales' });
  await expect(row).toContainText(/Version \d+|Pas encore publié/);
  const before = Number(/Version (\d+)/.exec(await row.innerText())?.[1] ?? 0);
  await row.getByRole('button', { name: 'Nouvelle version' }).click();
  const sheet = bruno.getByRole('dialog', { name: 'Mentions légales : nouvelle version' });
  await sheet.getByLabel(/Texte \(Markdown/).fill('## Éditeur\n\nMentions légales de test, publiées avec la double authentification.');
  await sheet.getByRole('button', { name: 'Publier' }).click();
  await bruno.getByRole('alertdialog', { name: 'Publier ce document ?' }).getByRole('button', { name: 'Publier' }).click();
  await toast(bruno, 'Document publié');
  await expect(row).toContainText(`Version ${before + 1}`);
  // La publication est notée dans le journal de l'administration.
  await bruno.reload();
  await expect(bruno.getByRole('region', { name: 'Journal de l’administration' })).toContainText(`Publication : Mentions légales, version ${before + 1}`);
});

test('connexion suivante : code demandé, même après rechargement ; « Se déconnecter » ; mauvais code refusé, bon code accepté', async () => {
  const key = adminKey();
  await logOut(bruno);
  await logIn(bruno, 'Bruno');
  await expect(codeScreen(bruno)).toBeVisible();
  await expect(bruno.getByRole('heading', { name: 'Bonjour Bruno' })).toHaveCount(0);
  await shot(bruno, '15-code-double-authentification');
  // Session reprise au lancement : le code est toujours demandé.
  await bruno.reload();
  await expect(codeScreen(bruno)).toBeVisible();

  await bruno.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(bruno.getByRole('button', { name: 'Se connecter' }).last()).toBeVisible();
  await logIn(bruno, 'Bruno');
  await expect(codeScreen(bruno)).toBeVisible();

  await bruno.getByLabel('Code à 6 chiffres').fill(wrongCode(key));
  await bruno.getByRole('button', { name: 'Valider' }).click();
  await expect(bruno.getByText(/^Code incorrect/)).toBeVisible();
  await expect(codeScreen(bruno)).toBeVisible();
  await bruno.getByLabel('Code à 6 chiffres').fill(totp(key));
  await bruno.getByRole('button', { name: 'Valider' }).click();
  await expect(bruno.getByRole('heading', { name: 'Bonjour Bruno' })).toBeVisible();
  // Session vérifiée par le code, reprise au lancement : rien à saisir.
  await bruno.reload();
  await expect(bruno.getByRole('heading', { name: 'Bonjour Bruno' })).toBeVisible();
  await expect(codeScreen(bruno)).toHaveCount(0);
});

test('Bruno désactive la double authentification : l’administration se ferme jusqu’à sa réactivation', async () => {
  await disable(bruno);
  await logOut(bruno);
  await signIn(bruno, 'Bruno');
  await expect(codeScreen(bruno)).toHaveCount(0);
  await goto(bruno, '/admin');
  await expect(bruno.getByText(/L’administration demande la double authentification/).first()).toBeVisible();
  await expect(bruno.getByRole('button', { name: 'Tester la connexion' })).toHaveCount(0);
  // Réactivée (nouvelle clé) : l'administration rouvre, sans se reconnecter.
  saveAdminKey(await enableCode(bruno));
  await goto(bruno, '/admin');
  await expect(bruno.getByRole('button', { name: 'Tester la connexion' })).toBeVisible();
});

test('Claire, simple compte, peut aussi activer la double authentification, puis la retirer', async ({ browser }) => {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  const claire = await c.newPage();
  try {
    await signIn(claire, 'Claire');
    await goto(claire, '/reglages');
    await expect(section(claire)).toContainText('Désactivée');
    await expect(section(claire)).not.toContainText('Obligatoire pour l’administration');
    const key = await enableCode(claire);
    await logOut(claire);
    await logIn(claire, 'Claire');
    await expect(codeScreen(claire)).toBeVisible();
    await claire.getByLabel('Code à 6 chiffres').fill(totp(key));
    await claire.getByRole('button', { name: 'Valider' }).click();
    await expect(claire.getByRole('heading', { name: 'Bonjour Claire' })).toBeVisible();
    await disable(claire);
  } finally {
    await c.close();
  }
});

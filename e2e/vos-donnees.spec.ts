/**
 * Vos données (priorité 2 de l'audit), sur téléphone : documents lisibles sans compte ; l'administrateur publie (un
 * projet à compléter est refusé, un texte complet est publié) ; fenêtre des conditions pour un compte existant : refus
 * (rien n'est supprimé, export et suppression restent possibles) puis acceptation ; nouvelle politique à lire ;
 * inscription avec la case jamais cochée d'avance et version notée ; « Confidentialité et mes données » : historique,
 * choix, archive ZIP de toutes ses données ; information sur Lia et Anthropic ; la déconnexion efface le confort local.
 * Fichier nommé pour passer en dernier sur téléphone : publier des conditions concerne tous les comptes de la série.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { email, goto, PASSWORD, signIn, signUp, toast } from './helpers';

test.describe.configure({ mode: 'serial' });

let contexts: BrowserContext[] = [];

async function newPhone(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR', timezoneId: 'Europe/Paris', acceptDownloads: true });
  contexts.push(ctx);
  return ctx.newPage();
}

test.afterAll(async () => {
  for (const c of contexts) await c.close();
  contexts = [];
});

/** Connexion sans attendre l'accueil : la fenêtre des conditions peut s'ouvrir avant. */
async function logIn(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('Adresse e-mail').fill(email(name));
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).last().click();
}

/** Lit une archive ZIP sans compression (celle de l'export) : nom → contenu. */
function unzip(buf: Buffer) {
  const end = buf.length - 22;
  expect(buf.readUInt32LE(end)).toBe(0x06054b50);
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const size = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const start = local + 30 + buf.readUInt16LE(local + 26);
    files.set(name, buf.subarray(start, start + size));
    at += 46 + nameLength;
  }
  return files;
}

async function publish(page: Page, title: string, text: string) {
  await page.locator('.row', { hasText: title }).getByRole('button', { name: 'Nouvelle version' }).click();
  const sheet = page.getByRole('dialog', { name: `${title} : nouvelle version` });
  await sheet.getByLabel(/Texte \(Markdown/).fill(text);
  await sheet.getByRole('button', { name: 'Publier' }).click();
  await page.getByRole('alertdialog', { name: 'Publier ce document ?' }).getByRole('button', { name: 'Publier' }).click();
  await toast(page, 'Document publié');
  await expect(page.locator('.row', { hasText: title })).toContainText('Version 1');
}

test('documents : lisibles sans compte, publiés par l’administrateur, jamais avec un emplacement à compléter', async ({ browser }) => {
  const visitor = await newPhone(browser);
  await visitor.goto('/#/legal/cgu');
  await expect(visitor.getByRole('heading', { name: 'Conditions d’utilisation' })).toBeVisible();
  await expect(visitor.getByText('Document pas encore publié')).toBeVisible();
  await expect(visitor.getByRole('link', { name: 'Politique de confidentialité' })).toBeVisible();

  const bruno = await newPhone(browser);
  await signIn(bruno, 'Bruno');
  await goto(bruno, '/admin');
  await expect(bruno.getByRole('heading', { name: 'Documents légaux' })).toBeVisible();
  // Le projet de docs/legal se charge sans emplacement ; un texte qui en contient un ne se publie pas.
  await bruno.locator('.row', { hasText: 'Mentions légales' }).getByRole('button', { name: 'Nouvelle version' }).click();
  const sheet = bruno.getByRole('dialog', { name: 'Mentions légales : nouvelle version' });
  await sheet.getByRole('button', { name: 'Charger le projet (docs/legal)' }).click();
  const text = sheet.getByLabel(/Texte \(Markdown/);
  await expect(text).toHaveValue(/Hébergement du site/);
  await expect(text).not.toHaveValue(/\[À (COMPLÉTER|VALIDER)/);
  await text.fill('## Éditeur\n\nClause de test. [À VALIDER : point de test]');
  await expect(sheet.getByText(/emplacements? à compléter ou à faire valider/)).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Publier' })).toBeDisabled();
  await sheet.getByRole('button', { name: 'Fermer' }).click();

  await publish(bruno, 'Mentions légales', '## Éditeur\n\nTexte de test des mentions légales.');
  await publish(bruno, 'Politique de confidentialité', '## Vos données\n\nTexte de test de la politique.\n\n- Conversations : 12 mois.');
  await publish(bruno, 'Conditions d’utilisation', '## Objet\n\nConditions de test de Cave & Amis.\n\n## Âge minimum\n\nRéservé aux personnes de 18 ans et plus.');
  await expect(bruno.locator('.row', { hasText: 'Conditions d’utilisation' })).toContainText('0 acceptation');

  await visitor.reload();
  await expect(visitor.getByText('Conditions de test de Cave & Amis.')).toBeVisible();
  await expect(visitor.getByText(/Version 1 du/)).toBeVisible();
});

test('compte existant : conditions à accepter ; refuser ne supprime rien ; la politique s’informe sans accord', async ({ browser }) => {
  const claire = await newPhone(browser);
  await logIn(claire, 'Claire');
  await expect(claire.getByRole('heading', { name: 'Conditions d’utilisation' })).toBeVisible();
  await expect(claire.getByText('Conditions de test de Cave & Amis.')).toBeVisible();
  const box = claire.getByRole('checkbox', { name: 'J’ai 18 ans ou plus et j’accepte les conditions d’utilisation' });
  await expect(box).not.toBeChecked();
  await expect(claire.getByRole('button', { name: 'Accepter et continuer' })).toBeDisabled();

  await claire.getByRole('button', { name: 'Refuser' }).click();
  await expect(claire.getByRole('heading', { name: 'Conditions refusées' })).toBeVisible();
  await expect(claire.getByText(/Rien n’est supprimé/)).toBeVisible();
  await expect(claire.getByRole('button', { name: 'Télécharger toutes mes données' })).toBeVisible();
  await expect(claire.getByRole('button', { name: 'Supprimer mon compte' })).toBeVisible();
  // Le silence ne vaut pas acceptation : à la connexion suivante, la fenêtre revient.
  await claire.reload();
  await expect(claire.getByRole('heading', { name: 'Conditions d’utilisation' })).toBeVisible();

  await box.check();
  await claire.getByRole('button', { name: 'Accepter et continuer' }).click();
  await expect(claire.getByRole('heading', { name: 'Bonjour Claire' })).toBeVisible();
  // Nouvelle politique : un simple bandeau, « J'ai lu » le retire.
  await expect(claire.getByText(/La politique de confidentialité a été mise à jour/)).toBeVisible();
  await claire.getByRole('button', { name: 'Lire', exact: true }).click();
  await expect(claire.getByText('Texte de test de la politique.')).toBeVisible();
  await claire.getByRole('button', { name: 'J’ai lu' }).click();
  await expect(claire.getByText(/La politique de confidentialité a été mise à jour/)).toHaveCount(0);

  await goto(claire, '/reglages/confidentialite');
  await expect(claire.getByText(/Conditions d’utilisation, version 1 : acceptées le .* \(à la connexion\)/)).toBeVisible();
  await expect(claire.getByText(/Politique de confidentialité, version 1 : lue le .* \(à la connexion\)/)).toBeVisible();
});

test('inscription : case jamais cochée d’avance, version notée ; mes données : choix, historique, archive complète', async ({ browser }) => {
  const lou = await newPhone(browser);
  await signUp(lou, 'Lou');
  await expect(lou.getByRole('heading', { name: 'Bonjour Lou' })).toBeVisible();
  await expect(lou.getByRole('heading', { name: 'Conditions d’utilisation' })).toHaveCount(0);
  await goto(lou, '/reglages/confidentialite');
  await expect(lou.getByText(/Conditions d’utilisation, version 1 : acceptées le .* \(à l’inscription\)/)).toBeVisible();

  // Un choix, et sa trace.
  await lou.getByRole('checkbox', { name: /Apparaître dans la recherche d’amis/ }).check();
  await toast(lou, 'Vous apparaissez dans la recherche');
  await lou.reload();
  await expect(lou.getByText(/Apparaître dans la recherche d’amis : oui, le/)).toBeVisible();

  // Toutes mes données, dans une archive.
  const [download] = await Promise.all([lou.waitForEvent('download'), lou.getByRole('button', { name: 'Télécharger toutes mes données' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^cave-et-amis-mes-donnees-\d{4}-\d{2}-\d{2}\.zip$/);
  const files = unzip(readFileSync((await download.path())!));
  expect([...files.keys()].slice(0, 2)).toEqual(['LISEZMOI.txt', 'donnees.json']);
  const data = JSON.parse(files.get('donnees.json')!.toString('utf8'));
  expect(data.format).toBe('cave-export-v1');
  expect(data.compte.email).toBe(email('Lou'));
  expect(data.caves.map((c: { name: string }) => c.name)).toEqual(['Ma cave']);
  expect(data.documents_et_consentements.current).toEqual({ recherche_amis: true });
  expect(JSON.stringify(data)).not.toContain(PASSWORD);
});

test('Lia : information sur Anthropic une seule fois ; la déconnexion efface le confort de l’appareil', async ({ browser }) => {
  const lou = await newPhone(browser);
  await signIn(lou, 'Lou');
  await goto(lou, '/assistant');
  await expect(lou.getByText('Comment fonctionne Lia.')).toBeVisible();
  await expect(lou.getByText(/l’intelligence artificielle de la société Anthropic/)).toBeVisible();
  await lou.getByRole('button', { name: 'J’ai compris' }).click();
  await expect(lou.getByText('Comment fonctionne Lia.')).toHaveCount(0);
  await lou.reload();
  await expect(lou.getByRole('heading', { name: 'Votre sommelier personnel' }).or(lou.getByText('Votre sommelier personnel'))).toBeVisible();
  await expect(lou.getByText('Comment fonctionne Lia.')).toHaveCount(0);

  await lou.evaluate(() => {
    localStorage.setItem('cave.scan.budget', '25');
    localStorage.setItem('cave-amis-actions', '{"x":"done"}');
  });
  await goto(lou, '/reglages');
  await lou.getByRole('button', { name: 'Se déconnecter' }).click();
  await lou.getByRole('alertdialog', { name: 'Se déconnecter ?' }).getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(lou.getByRole('button', { name: 'Se connecter' }).last()).toBeVisible();
  expect(await lou.evaluate(() => [localStorage.getItem('cave.scan.budget'), localStorage.getItem('cave-amis-actions')])).toEqual([null, null]);
});

test('l’administrateur accepte à son tour les conditions qu’il a publiées', async ({ browser }) => {
  const bruno = await newPhone(browser);
  await logIn(bruno, 'Bruno');
  await expect(bruno.getByRole('heading', { name: 'Conditions d’utilisation' })).toBeVisible();
  await bruno.getByRole('checkbox', { name: /J’ai 18 ans ou plus/ }).check();
  await bruno.getByRole('button', { name: 'Accepter et continuer' }).click();
  await expect(bruno.getByRole('heading', { name: 'Bonjour Bruno' })).toBeVisible();
  await bruno.getByRole('button', { name: 'Lire', exact: true }).click();
  await bruno.getByRole('button', { name: 'J’ai lu' }).click();
  await expect(bruno.getByText(/La politique de confidentialité a été mise à jour/)).toHaveCount(0);
  await goto(bruno, '/admin');
  await expect(bruno.locator('.row', { hasText: 'Conditions d’utilisation' })).toContainText('acceptations');
});

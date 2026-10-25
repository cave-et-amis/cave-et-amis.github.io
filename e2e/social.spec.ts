/**
 * Groupes, sur téléphone : création, invitation d'un ami, partage « visible » d'une bouteille, adhésion,
 * mise à disposition de bouteilles (compteurs, ouverture par la propriétaire, historique), rôles, activité,
 * départ (les bouteilles restent à leur propriétaire et redeviennent libres).
 * Fichier nommé pour passer APRÈS parcours.spec.ts (ordre alphabétique) : le premier compte créé de la série
 * devient administrateur, et ce doit être Bruno.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { goto, shot, signUp, tile, toast } from './helpers';

test.describe.configure({ mode: 'serial' });

let alice: Page;
let paul: Page;
let winePath = '';
let groupPath = '';
let contexts: BrowserContext[] = [];

async function newPhone(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  contexts.push(ctx);
  return ctx.newPage();
}

test.beforeAll(async ({ browser }) => {
  alice = await newPhone(browser);
  paul = await newPhone(browser);
});

test.afterAll(async () => {
  for (const c of contexts) await c.close();
  contexts = [];
});

test('Alice et Paul deviennent amis ; Alice crée un groupe, l’invite et y partage une bouteille', async () => {
  await signUp(alice, 'Alice');
  await expect(alice.getByRole('heading', { name: 'Bonjour Alice' })).toBeVisible();
  await goto(alice, '/amis?onglet=invitations');
  await alice.getByRole('button', { name: 'Créer un lien d’invitation' }).click();
  const code = (await alice.locator('.kbd-code').innerText()).replace(/-/g, '');
  await alice.getByRole('dialog').getByRole('button', { name: 'Fermer' }).click();
  await signUp(paul, 'Paul', `/#/ami/${code}`);
  await paul.getByRole('button', { name: 'Accepter' }).click();
  await expect(paul.getByText('Vous êtes maintenant amis avec Alice')).toBeVisible();

  // Une bouteille dans la cave d'Alice.
  await goto(alice, '/');
  await alice.getByRole('button', { name: /Saisir un vin/ }).first().click();
  await alice.getByLabel('Nom du vin').fill('Morgon Côte du Py');
  await alice.getByLabel('Millésime', { exact: true }).fill('2020');
  await alice.getByRole('textbox', { name: 'Nombre de bouteilles', exact: true }).fill('6');
  await alice.getByRole('button', { name: 'Ajouter à ma cave' }).click();
  await toast(alice, 'Vin ajouté à votre cave');
  await expect(alice).toHaveURL(/#\/cave\/vin\//);
  winePath = new URL(alice.url()).hash.slice(1);

  // Création du groupe avec Paul invité.
  await alice.reload();
  await goto(alice, '/amis?onglet=groupes');
  await alice.getByRole('button', { name: 'Créer un groupe' }).click();
  const form = alice.getByRole('dialog', { name: 'Nouveau groupe' });
  await form.getByLabel('Nom du groupe').fill('Les soirées entre amis');
  await form.getByRole('button', { name: 'Emoji 🎉' }).click();
  await form.getByLabel('Paul').check();
  await form.getByRole('button', { name: 'Créer le groupe' }).click();
  await toast(alice, 'Groupe créé, 1 invitation envoyée');
  await expect(alice.getByRole('heading', { name: 'Les soirées entre amis' })).toBeVisible();
  groupPath = new URL(alice.url()).hash.slice(1);

  // Partage visible : la bouteille reste à Alice.
  await alice.getByRole('button', { name: 'Rendre visibles' }).click();
  await alice.getByRole('dialog').getByLabel('Morgon Côte du Py 2020').check();
  await toast(alice, '« Morgon Côte du Py 2020 » est visible dans le groupe');
  await alice.getByRole('dialog').getByRole('button', { name: 'Fermer' }).click();
  await expect(alice.locator('.row').filter({ hasText: 'Morgon Côte du Py' })).toContainText('Chez vous');
});

test('Paul rejoint le groupe et voit la bouteille d’Alice ; il n’a pas les droits d’administrateur', async () => {
  await paul.reload();
  await expect(paul.getByRole('link', { name: 'Amis & Groupes (1 en attente)' })).toBeVisible();
  await goto(paul, '/amis?onglet=groupes');
  const invitation = paul.locator('.row').filter({ hasText: 'Les soirées entre amis' });
  await expect(invitation).toContainText('Invitation de Alice');
  await invitation.getByRole('button', { name: 'Rejoindre' }).click();
  await toast(paul, 'Bienvenue dans « Les soirées entre amis »');
  await expect(paul.getByRole('heading', { name: 'Les soirées entre amis' })).toBeVisible();
  await expect(paul.locator('.row').filter({ hasText: 'Morgon Côte du Py' })).toContainText('Chez Alice');
  await shot(paul, '07-groupe-cave');
  await expect(paul.getByRole('button', { name: 'Inviter des amis' })).toHaveCount(0);
  await expect(paul.getByRole('button', { name: 'Modifier' })).toHaveCount(0);
  await paul.getByRole('button', { name: 'Membres' }).click();
  await expect(paul.locator('.row').filter({ hasText: 'Alice' })).toContainText('Administrateur');
  await expect(paul.locator('.row').filter({ hasText: 'Paul' })).toContainText('Membre');
});

test('Alice met 2 bouteilles à disposition ; Paul les voit ; Alice en ouvre une, une seule fois, avec l’historique', async () => {
  // Fiche du vin : 6 en stock, 2 mises à disposition du groupe, 4 libres.
  await goto(alice, winePath);
  await alice.reload();
  expect(await tile(alice, /en stock/)).toBe(6);
  expect(await tile(alice, /pour mes groupes/)).toBe(0);
  await alice.getByRole('button', { name: 'Mettre à disposition d’un groupe' }).click();
  const sheet = alice.getByRole('dialog', { name: 'Mettre à disposition d’un groupe' });
  await sheet.getByRole('button', { name: 'Augmenter : Bouteilles mises à disposition' }).click();
  await sheet.getByRole('button', { name: 'Augmenter : Bouteilles mises à disposition' }).click();
  await expect(sheet.getByText('Après : 6 en stock · dont 2 pour mes groupes · 4 libres')).toBeVisible();
  await sheet.getByRole('button', { name: 'Enregistrer' }).click();
  await toast(alice, '2 bouteilles à disposition de « Les soirées entre amis »');
  await expect.poll(() => tile(alice, /pour mes groupes/)).toBe(2);
  expect(await tile(alice, /en stock/)).toBe(6);
  expect(await tile(alice, /disponible/)).toBe(4);
  await expect(alice.getByText('6 en stock · dont 2 pour mes groupes · 4 libres')).toBeVisible();
  await expect(alice.getByRole('button', { name: /Les soirées entre amis · 2 à disposition/ })).toBeVisible();
  await shot(alice, '09-fiche-mise-a-disposition');

  // Paul voit les 2 bouteilles disponibles pour le groupe, sans pouvoir les ouvrir ni les modifier.
  await paul.reload();
  const forPaul = paul.locator('.row').filter({ hasText: 'Morgon Côte du Py' });
  await expect(forPaul).toContainText('2 disponibles pour le groupe');
  await expect(paul.getByText(/2 bouteilles à disposition/)).toBeVisible();
  await expect(forPaul.getByRole('button')).toHaveCount(0);
  await paul.getByRole('button', { name: 'Disponibles pour le groupe' }).click();
  await expect(forPaul).toBeVisible();
  await shot(paul, '10-groupe-disponibles');

  // Alice en ouvre une depuis la cave du groupe : la mise à disposition et le stock baissent ensemble.
  await goto(alice, groupPath);
  await alice.getByRole('button', { name: 'J’en ai ouvert une : Morgon Côte du Py' }).click();
  const out = alice.getByRole('dialog', { name: 'Sortie de cave' });
  await expect(out.getByLabel('Bouteille prise sur')).toHaveValue(/.+/);
  await out.getByLabel('Note (facultatif)').fill('Soirée raclette');
  await out.getByRole('button', { name: 'Enregistrer' }).dblclick();
  await toast(alice, 'Sortie enregistrée : 1 bouteille de « Les soirées entre amis »');
  await expect(alice.locator('.row').filter({ hasText: 'Morgon Côte du Py' })).toContainText('1 disponible pour le groupe');
  await alice.getByRole('button', { name: 'Activité' }).click();
  await expect(alice.getByText('Alice a mis 2 bouteilles de « Morgon Côte du Py 2020 » à disposition')).toBeVisible();
  await expect(alice.getByText('Alice a ouvert 1 bouteille de « Morgon Côte du Py 2020 »')).toBeVisible();

  // Double clic : une seule sortie. Fiche : 5 en stock, 1 pour le groupe, 4 libres ; historique relié au groupe.
  await goto(alice, winePath);
  await expect.poll(() => tile(alice, /en stock/)).toBe(5);
  expect(await tile(alice, /pour mes groupes/)).toBe(1);
  expect(await tile(alice, /disponible/)).toBe(4);
  await expect(alice.locator('.tl')).toHaveCount(2);
  await expect(alice.locator('.tl').first()).toContainText('Mise à disposition de Les soirées entre amis · Soirée raclette');
});

test('Alice nomme Paul gestionnaire ; l’activité garde la trace ; Paul quitte le groupe', async () => {
  await goto(alice, groupPath);
  await alice.reload();
  await alice.getByRole('button', { name: 'Membres' }).click();
  await alice.getByLabel('Rôle de Paul').selectOption('manager');
  await toast(alice, 'Paul est maintenant gestionnaire');
  await alice.getByRole('button', { name: 'Activité' }).click();
  await expect(alice.getByText('Paul a rejoint le groupe')).toBeVisible();
  await expect(alice.getByText('Alice a rendu visible « Morgon Côte du Py 2020 »')).toBeVisible();
  await shot(alice, '08-groupe-activite');

  await paul.reload();
  await paul.getByRole('button', { name: 'Membres' }).click();
  await paul.getByRole('button', { name: 'Quitter le groupe' }).click();
  await paul.getByRole('alertdialog').getByRole('button', { name: 'Quitter le groupe' }).click();
  await toast(paul, 'Vous avez quitté le groupe');

  await alice.reload();
  await alice.getByRole('button', { name: 'Membres' }).click();
  await expect(alice.locator('.row').filter({ hasText: 'Paul' })).toHaveCount(0);
  await alice.getByRole('button', { name: 'Cave' }).click();
  await expect(alice.locator('.row').filter({ hasText: 'Morgon Côte du Py' })).toBeVisible();

  // Alice reprend sa bouteille mise à disposition : elle redevient libre.
  await alice.getByRole('button', { name: 'Mettre à disposition : Morgon Côte du Py' }).click();
  const sheet = alice.getByRole('dialog', { name: 'Mettre à disposition de « Les soirées entre amis »' });
  await sheet.getByRole('button', { name: 'Diminuer : Bouteilles mises à disposition' }).click();
  await sheet.getByRole('button', { name: 'Tout reprendre' }).click();
  await toast(alice, 'Bouteilles reprises : elles sont de nouveau libres');
  await expect(alice.locator('.row').filter({ hasText: 'Morgon Côte du Py' })).toContainText('Visible');
  await goto(alice, winePath);
  await expect.poll(() => tile(alice, /disponible/)).toBe(5);
  expect(await tile(alice, /pour mes groupes/)).toBe(0);
});

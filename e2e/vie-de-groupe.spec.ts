/**
 * Vie de groupe, sur téléphone : soirée du groupe (membres invités, bouteille du groupe suggérée puis confirmée par sa
 * propriétaire, prise sur la mise à disposition), envie commune avec « je participe », note partagée avec le groupe,
 * activité. Fichier nommé pour passer après parcours.spec.ts (le premier compte créé devient administrateur).
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { goto, inviteCode, shot, signUp, tile, toast } from './helpers';

test.describe.configure({ mode: 'serial' });

let lucie: Page;
let hugo: Page;
let contexts: BrowserContext[] = [];
let winePath = '';
let groupPath = '';
let eventPath = '';

async function newPhone(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  contexts.push(ctx);
  return ctx.newPage();
}

test.beforeAll(async ({ browser }) => {
  lucie = await newPhone(browser);
  hugo = await newPhone(browser);
});

test.afterAll(async () => {
  for (const c of contexts) await c.close();
  contexts = [];
});

const hash = (p: Page) => new URL(p.url()).hash.slice(1);
/** Recharge et attend que l'application soit prête (barre d'onglets affichée) avant de changer de page. */
async function reload(p: Page) {
  await p.reload();
  await expect(p.getByRole('link', { name: /Amis & Groupes/ })).toBeVisible();
}

test('Lucie et Hugo forment « Les épicuriens » ; Lucie met 2 bouteilles à disposition et organise une soirée du groupe', async () => {
  await signUp(lucie, 'Lucie');
  await expect(lucie.getByRole('heading', { name: 'Bonjour Lucie' })).toBeVisible();
  const code = await inviteCode(lucie);
  await signUp(hugo, 'Hugo', `/#/ami/${code}`);
  await hugo.getByRole('button', { name: 'Accepter' }).click();
  await expect(hugo.getByRole('heading', { name: 'Lucie vous a ouvert sa cave' })).toBeVisible();
  await hugo.getByRole('button', { name: 'Continuer' }).click();

  // Un vin de Lucie : 3 bouteilles.
  await goto(lucie, '/');
  await lucie.getByRole('button', { name: /Saisir un vin/ }).first().click();
  await lucie.getByLabel('Nom du vin').fill('Saint-Joseph');
  await lucie.getByLabel('Millésime', { exact: true }).fill('2019');
  await lucie.getByRole('textbox', { name: 'Nombre de bouteilles', exact: true }).fill('3');
  await lucie.getByRole('button', { name: 'Ajouter à ma cave' }).click();
  await toast(lucie, 'Vin ajouté à votre cave');
  await expect(lucie).toHaveURL(/#\/cave\/vin\//);
  winePath = hash(lucie);

  // Le groupe, Hugo y entre.
  await reload(lucie);
  await goto(lucie, '/amis?onglet=groupes');
  await lucie.getByRole('button', { name: 'Créer un groupe' }).click();
  const form = lucie.getByRole('dialog', { name: 'Nouveau groupe' });
  await form.getByLabel('Nom du groupe').fill('Les épicuriens');
  await form.getByLabel('Hugo').check();
  await form.getByRole('button', { name: 'Créer le groupe' }).click();
  await toast(lucie, 'Groupe créé, 1 invitation envoyée');
  await expect(lucie.getByRole('heading', { name: 'Les épicuriens' })).toBeVisible();
  groupPath = hash(lucie);
  await reload(hugo);
  await goto(hugo, '/amis?onglet=groupes');
  await hugo.locator('.row').filter({ hasText: 'Les épicuriens' }).getByRole('button', { name: 'Rejoindre' }).click();
  await toast(hugo, 'Bienvenue dans « Les épicuriens »');

  // 2 bouteilles mises à disposition du groupe.
  await goto(lucie, winePath);
  await reload(lucie);
  await lucie.getByRole('button', { name: 'Mettre à disposition d’un groupe' }).click();
  const alloc = lucie.getByRole('dialog', { name: 'Mettre à disposition d’un groupe' });
  await alloc.getByRole('button', { name: 'Augmenter : Bouteilles mises à disposition' }).click();
  await alloc.getByRole('button', { name: 'Augmenter : Bouteilles mises à disposition' }).click();
  await alloc.getByRole('button', { name: 'Enregistrer' }).click();
  await toast(lucie, '2 bouteilles à disposition de « Les épicuriens »');

  // Soirée du groupe : Hugo (membre) est invité d'office.
  await goto(lucie, groupPath);
  await lucie.getByRole('button', { name: 'Soirées', exact: true }).click();
  await lucie.getByRole('button', { name: 'Nouvelle soirée' }).click();
  const ev = lucie.getByRole('dialog', { name: 'Nouvelle soirée « Les épicuriens »' });
  await ev.getByLabel('Titre').fill('Soirée fromages');
  await expect(ev.getByLabel('Hugo')).toBeChecked();
  await ev.getByRole('button', { name: 'Créer' }).click();
  await toast(lucie, 'Soirée créée');
  await expect(lucie).toHaveURL(/#\/evenements\//);
  eventPath = hash(lucie);
  await expect(lucie.getByRole('link', { name: /Soirée du groupe « Les épicuriens »/ })).toBeVisible();
});

test('Hugo suggère la bouteille du groupe ; Lucie confirme : elle est prise sur la mise à disposition', async () => {
  await goto(hugo, eventPath);
  await reload(hugo);
  await hugo.getByRole('button', { name: 'Suggérer une bouteille du groupe' }).click();
  const sheet = hugo.getByRole('dialog', { name: 'Suggérer une bouteille du groupe ou d’un ami' });
  const option = sheet.locator('label.row').filter({ hasText: 'Saint-Joseph' });
  await expect(option).toContainText('2 à disposition du groupe');
  await option.click();
  await sheet.getByRole('button', { name: 'Augmenter : Nombre de bouteilles' }).click();
  await sheet.getByRole('button', { name: 'Suggérer' }).click();
  await toast(hugo, 'Suggestion envoyée à Lucie');

  await goto(lucie, eventPath);
  await reload(lucie);
  await lucie.getByRole('button', { name: 'Je l’apporte' }).click();
  const confirm = lucie.getByRole('dialog', { name: 'Confirmer que vous l’apportez' });
  await expect(confirm).toContainText('dont 2 mises à disposition du groupe');
  await confirm.getByRole('button', { name: 'Confirmer et réserver' }).click();
  await toast(lucie, 'Bouteille confirmée et réservée');
  await expect(lucie.getByText('2 prises sur la mise à disposition du groupe')).toBeVisible();
  await shot(lucie, '12-soiree-de-groupe');

  // Fiche du vin : rien n'est compté deux fois.
  await goto(lucie, winePath);
  await expect.poll(() => tile(lucie, /réservée/)).toBe(2);
  expect(await tile(lucie, /en stock/)).toBe(3);
  expect(await tile(lucie, /disponible/)).toBe(1);
  expect(await tile(lucie, /pour mes groupes/)).toBe(0);
});

test('envie commune et note partagée : Hugo propose, Lucie participe et partage sa note ; l’activité garde la trace', async () => {
  await goto(hugo, groupPath);
  await reload(hugo);
  await hugo.getByRole('button', { name: 'Envies', exact: true }).click();
  await hugo.getByRole('button', { name: 'Proposer une envie' }).click();
  const wish = hugo.getByRole('dialog', { name: 'Envie commune « Les épicuriens »' });
  await wish.getByLabel('Vin').fill('Château Montus');
  await wish.getByRole('button', { name: 'Proposer' }).click();
  await toast(hugo, 'Envie proposée au groupe');
  await expect(hugo.locator('.row').filter({ hasText: 'Château Montus' })).toContainText('1 participe');

  await goto(lucie, groupPath);
  await reload(lucie);
  await lucie.getByRole('button', { name: 'Envies', exact: true }).click();
  await lucie.getByRole('button', { name: 'Je participe : Château Montus' }).click();
  await expect(lucie.locator('.row').filter({ hasText: 'Château Montus' })).toContainText('2 participent');
  await shot(lucie, '13-envies-communes');

  // Note partagée avec le groupe, depuis l'onglet Notes.
  await lucie.getByRole('button', { name: 'Notes', exact: true }).click();
  await lucie.getByRole('button', { name: 'Noter un vin pour le groupe' }).click();
  const note = lucie.getByRole('dialog', { name: 'Nouvelle dégustation' });
  await note.getByLabel('Vin', { exact: true }).fill('Saint-Joseph');
  await note.getByRole('button', { name: '5 sur 5' }).click();
  await expect(note.getByLabel('Partager avec un groupe')).not.toHaveValue('');
  await note.getByRole('button', { name: 'Enregistrer' }).click();
  await toast(lucie, 'Dégustation enregistrée');

  await reload(hugo);
  await hugo.getByRole('button', { name: 'Notes', exact: true }).click();
  await expect(hugo.locator('.row').filter({ hasText: 'Saint-Joseph' })).toContainText('Lucie');
  await hugo.getByRole('button', { name: 'Activité', exact: true }).click();
  await expect(hugo.getByText('Lucie organise « Soirée fromages »')).toBeVisible();
  await expect(hugo.getByText('Hugo propose une envie commune : « Château Montus »')).toBeVisible();
  await expect(hugo.getByText('Lucie a partagé une note sur « Saint-Joseph » (5/5)')).toBeVisible();
});

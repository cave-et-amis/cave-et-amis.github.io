/**
 * Lot 1 de Cave & Amis 2.0 : thème, mémoire des goûts, accords mets et vins, alertes de maturité facultatives.
 * Compte créé ici : le fichier ne dépend pas des autres parcours.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { bottlePhoto, goto, signUp, toast } from './helpers';

test.describe.configure({ mode: 'serial' });
let page: Page;

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  page = await ctx.newPage();
  await signUp(page, 'Gaspard');
  await expect(page.getByRole('heading', { name: 'Bonjour Gaspard' })).toBeVisible();
});
test.afterAll(async () => page.context().close());

test('thème « Clair-Obscur » par défaut ; le thème clair choisi est gardé par le compte', async () => {
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sombre');
  await goto(page, '/reglages');
  await page.getByRole('group', { name: 'Apparence' }).getByRole('button', { name: 'Clair' }).click();
  await toast(page, 'Préférence enregistrée');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'clair');
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Navigation principale' }).first()).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'clair');
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} : ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
  await page.getByRole('group', { name: 'Apparence' }).getByRole('button', { name: 'Sombre' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sombre');
});

test('alertes de maturité : désactivées par défaut, activables', async () => {
  await goto(page, '/reglages');
  const box = page.getByRole('checkbox', { name: /M’alerter quand un vin de ma cave entre dans sa période/ });
  await expect(box).not.toBeChecked();
  await box.click();
  await toast(page, 'Préférence enregistrée');
  await page.reload();
  await expect(page.getByRole('checkbox', { name: /M’alerter quand un vin de ma cave entre dans sa période/ })).toBeChecked();
});

test('mes goûts : déclarer, retrouver, effacer', async () => {
  await goto(page, '/carnet');
  await page.getByRole('link', { name: /Mes goûts/ }).click();
  await expect(page.getByRole('heading', { name: 'Ce que votre carnet dit de vos goûts' })).toBeVisible();
  await expect(page.getByText('Pas encore assez de dégustations notées')).toBeVisible();
  await page.getByLabel('J’aime (séparez par des virgules)').fill('pinot noir, Bourgogne, pinot noir');
  await page.getByLabel('J’aime moins').fill('boisé marqué');
  await page.getByLabel(/Budget habituel/).fill('25');
  await page.getByRole('button', { name: 'Enregistrer mes préférences' }).click();
  await toast(page, 'Profil enregistré');
  await page.reload();
  await expect(page.getByLabel('J’aime (séparez par des virgules)')).toHaveValue('pinot noir, Bourgogne');
  await expect(page.getByLabel(/Budget habituel/)).toHaveValue('25');
  await page.getByRole('button', { name: 'Effacer mon profil de goûts' }).click();
  // Thème sombre par défaut, fenêtre de confirmation ouverte (bouton rouge) : aucun défaut d'accessibilité grave.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sombre');
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} : ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
  await page.getByRole('alertdialog').getByRole('button', { name: 'Effacer' }).click();
  await toast(page, 'Profil effacé');
  await expect(page.getByLabel('J’aime (séparez par des virgules)')).toHaveValue('');
});

test('que boire avec… : famille du plat, présélection sans IA, question préparée pour Lia', async () => {
  // Le raccourci est rangé dans Explorer (« Accords mets-vins »).
  await goto(page, '/explorer');
  await page.getByRole('button', { name: /Accords mets-vins/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Que boire avec…' });
  await sheet.getByLabel('Votre plat').fill('magret de canard');
  await expect(sheet.getByText(/Viande rouge et gibier : Un rouge avec de la structure\./)).toBeVisible();
  await expect(sheet.getByText('Aucune bouteille libre ne s’y prête vraiment')).toBeVisible();
  await sheet.getByRole('button', { name: 'Demander à Lia' }).click();
  await expect(page.getByRole('textbox').last()).toHaveValue('Quel vin de ma cave ouvrir avec magret de canard ?');
});

test('explorer et statistiques : recherche dans le dictionnaire, ajout prérempli, carnet rangé dans Statistiques', async () => {
  await goto(page, '/explorer');
  await page.getByLabel('Rechercher un vin').fill('chateau siran');
  await page.getByRole('button', { name: /Ajouter Château Siran à ma cave/ }).first().click();
  await expect(page.getByLabel('Nom du vin')).toHaveValue('Château Siran');
  await page.getByRole('button', { name: 'Ajouter à ma cave' }).click();
  await toast(page, /ajouté/i);
  await goto(page, '/cave');
  await page.getByRole('link', { name: 'Mon carnet' }).click();
  await expect(page.getByRole('button', { name: 'Mon carnet', pressed: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ma cave', pressed: false }).click();
  await expect(page.getByRole('heading', { name: 'Par région' })).toBeVisible();
  await expect(page.getByText('Bordeaux', { exact: true })).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} : ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
});

test('photo de profil : ajoutée, recadrée en carré, affichée partout, retirée', async () => {
  await goto(page, '/reglages');
  await page.getByLabel('Choisir une photo de profil').setInputFiles({ name: 'moi.jpg', mimeType: 'image/jpeg', buffer: await bottlePhoto(page) });
  await toast(page, 'Photo de profil enregistrée');
  // La photo remplace l'initiale, dans les Réglages comme dans la barre du haut.
  const topbar = page.getByRole('button', { name: 'Réglages et compte de Gaspard' });
  await expect(topbar.locator('img')).toBeVisible();
  const size = await page.locator('.avatar.lg img').evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
  expect(size[0]).toBe(size[1]);
  await page.getByRole('button', { name: 'Retirer' }).click();
  await toast(page, 'Photo de profil retirée');
  await expect(topbar.locator('img')).toHaveCount(0);
  await expect(topbar).toHaveText('G');
});

test('import multiple : une photo, la liste à vérifier, les bouteilles identiques regroupées', async () => {
  await goto(page, '/cave/import');
  await page.getByLabel('Choisir une photo des bouteilles').setInputFiles({ name: 'rangee.jpg', mimeType: 'image/jpeg', buffer: await bottlePhoto(page) });
  await expect(page.getByRole('heading', { name: '3 bouteilles reconnues' })).toBeVisible();
  await expect(page.getByText('Une bouteille de dos, illisible.')).toBeVisible();
  await expect(page.getByText('Millésime à vérifier')).toBeVisible();
  // Deux bouteilles identiques : un seul vin, deux bouteilles ; la troisième, corrigée puis décochée.
  await page.getByLabel('Millésime de la bouteille 3').fill('2018');
  await expect(page.getByText('Millésime à vérifier')).toHaveCount(0);
  await page.getByLabel('Ajouter la bouteille 3').uncheck();
  await page.getByRole('button', { name: 'Vérifier et ajouter les 2' }).click();
  await toast(page, '2 bouteilles ajoutées à votre cave');
  await expect(page.getByText('Château Labeille').first()).toBeVisible();
  // Une seconde photo : le vin est reconnu dans la cave.
  await goto(page, '/cave/import');
  await page.getByLabel('Choisir une photo des bouteilles').setInputFiles({ name: 'rangee.jpg', mimeType: 'image/jpeg', buffer: await bottlePhoto(page) });
  await expect(page.getByText('Déjà en cave · +1').first()).toBeVisible();
  // Fin de l'animation d'apparition avant de mesurer les contrastes (comme vue-accessibilite.spec.ts).
  await page.waitForTimeout(400);
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} : ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
});

test('cave en 2D : une pastille par bouteille, rangée par emplacement, aperçu du vin', async () => {
  await goto(page, '/cave');
  await page.getByRole('link', { name: 'Vue 2D' }).click();
  // Les 2 bouteilles importées plus haut, sans emplacement.
  const map = page.getByRole('region', { name: /Plan de la cave : \d+ bouteilles?/ });
  await expect(map.getByText('Sans emplacement')).toBeVisible();
  await map.getByRole('button', { name: /Château Labeille 2016, Sans emplacement, bouteille 1 sur 2/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Château Labeille 2016' });
  await expect(sheet.getByText('sans emplacement')).toBeVisible();
  await sheet.getByRole('button', { name: 'Fermer' }).click();
  await page.getByRole('button', { name: 'Ajouter une étagère' }).click();
  await page.getByLabel('Nom de l’étagère').fill('Casier du haut');
  await page.getByRole('button', { name: 'Ajouter l’étagère' }).click();
  await toast(page, 'Étagère « Casier du haut » ajoutée');
  await expect(map.getByText(/A · Casier du haut/)).toBeVisible();
  await page.waitForTimeout(400);
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} : ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
});

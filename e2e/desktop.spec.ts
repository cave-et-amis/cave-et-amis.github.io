/** Sur ordinateur : navigation latérale, mise en page large, aucun débordement horizontal. */
import { expect, test } from '@playwright/test';
import { bottlePhoto, goto, shot, signIn, toast } from './helpers';

test('mise en page ordinateur', async ({ page }) => {
  await signIn(page, 'Bruno');
  const nav = page.getByRole('navigation', { name: 'Navigation principale' }).first();
  await expect(nav.getByRole('link', { name: 'Ma cave' })).toBeVisible();
  await expect(page.locator('.tabbar')).toBeHidden();
  await shot(page, '10-ordinateur-accueil');
  for (const hash of ['/cave', '/amis', '/evenements', '/carnet', '/assistant', '/reglages', '/admin']) {
    await goto(page, hash);
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `débordement horizontal sur ${hash}`).toBeLessThanOrEqual(0);
  }
  await goto(page, '/cave');
  await shot(page, '11-ordinateur-cave');
});

test('studio photo : détourage dans le navigateur, avant / après, original conservé', async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, 'Bruno');
  await page.getByRole('button', { name: /Saisir un vin/ }).first().click();
  await page.getByLabel('Nom du vin').fill('Château Studio');
  await page.getByText('Plus de détails (facultatif)').click();
  const field = page.locator('.field').filter({ has: page.getByText('Photo de la bouteille', { exact: true }) });
  await field.locator('input[type=file]').setInputFiles({ name: 'bouteille.jpg', mimeType: 'image/jpeg', buffer: await bottlePhoto(page) });
  await page.getByRole('button', { name: 'Mettre en valeur la photo (studio)' }).click();
  await expect(page.getByText('Première utilisation : téléchargement d’un module de 46 Mo')).toBeVisible();
  await page.getByRole('button', { name: 'Lancer le studio' }).click();
  // Téléchargement du module (servi par le site) puis détourage, sous la politique de sécurité de l'export.
  await expect(page.getByRole('button', { name: 'Utiliser cette version' })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole('img', { name: /Version améliorée : Studio fond blanc/ })).toBeVisible();
  await page.getByRole('button', { name: 'Noir premium' }).click();
  await expect(page.getByRole('img', { name: /Version améliorée : Noir premium/ })).toBeVisible();
  await shot(page, '12-studio-avant-apres');
  await page.getByRole('button', { name: 'Utiliser cette version' }).click();
  await expect(page.getByRole('button', { name: 'Mettre en valeur la photo (studio)' })).toBeVisible();
  await page.getByRole('button', { name: 'Ajouter à ma cave' }).click();
  await toast(page, 'Vin ajouté');
  await expect(page.getByRole('img', { name: /Château Studio/ }).first()).toBeVisible();
});

test('visite guidée et aide sur ordinateur : la carte se place près de l’élément éclairé, sans le cacher', async ({ page }) => {
  await signIn(page, 'Bruno');
  await goto(page, '/reglages');
  await page.getByRole('button', { name: 'Revoir la visite guidée' }).click();
  const first = page.getByRole('dialog', { name: 'Votre tableau de bord', exact: true });
  await expect(first).toContainText('Étape 1 sur');
  await first.getByRole('button', { name: 'Suivant' }).click();
  const card = page.getByRole('dialog', { name: 'Votre cave', exact: true });
  await expect(card).toBeVisible();
  // Sur ordinateur, c'est le lien « Ma cave » de la barre latérale qui est éclairé.
  const link = (await page.getByRole('navigation', { name: 'Navigation principale' }).first().locator('[data-tour="nav-cave"]').boundingBox())!;
  await expect
    .poll(async () => {
      const spot = (await page.locator('.tour-spot').boundingBox())!;
      return spot.x <= link.x && spot.y <= link.y && spot.x + spot.width >= link.x + link.width && spot.y + spot.height >= link.y + link.height;
    })
    .toBe(true);
  const box = (await card.boundingBox())!;
  expect(box.x < link.x + link.width && link.x < box.x + box.width && box.y < link.y + link.height && link.y < box.y + box.height).toBe(false);
  expect(box.y).toBeGreaterThan(link.y);
  await shot(page, '13-ordinateur-visite');
  await card.getByRole('button', { name: 'Passer' }).click();
  await expect(page.locator('.tour-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Aide de cette page' }).click();
  await expect(page.getByRole('dialog', { name: 'Aide · Accueil' })).toBeVisible();
  await shot(page, '14-ordinateur-aide');
});

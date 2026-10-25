/**
 * Scanner avant d'acheter, sur téléphone : trois photos, lecture par Lia (faux Anthropic), choix entre deux cuvées,
 * prix du rayon confirmé, historique, envie, ajout à la cave par le formulaire habituel, suppression de l'historique.
 */
import { expect, test, type Page } from '@playwright/test';
import { goto, labelPhoto, shot, signUp, toast } from './helpers';

/** Étiquette de prix jaune « 24,90 € » (JPEG fabriqué dans le navigateur). */
async function priceTagPhoto(page: Page) {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 200;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffd500';
    g.fillRect(0, 0, 400, 200);
    g.fillStyle = '#000';
    g.font = 'bold 60px sans-serif';
    g.fillText('24,90 €', 60, 120);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}

test('scanner : identifier en magasin, confirmer le prix, garder l’historique', async ({ page }) => {
  await signUp(page, 'Scanneur');
  await expect(page.getByRole('heading', { name: 'Bonjour Scanneur' })).toBeVisible();
  await page.getByRole('button', { name: /Scanner avant d’acheter/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Scanner avant d’acheter', level: 2 })).toBeVisible();

  const analyse = page.getByRole('button', { name: 'Analyser' });
  await expect(analyse).toBeDisabled();
  const camera = page.locator('input[type=file][capture]');
  const gallery = page.locator('input[type=file]:not([capture])');
  const photo = await labelPhoto(page);
  // Étiquette : appareil photo.
  await page.getByRole('button', { name: 'Photographier' }).first().click();
  await camera.setInputFiles({ name: 'face.jpg', mimeType: 'image/jpeg', buffer: photo });
  await expect(page.getByAltText('Étiquette photographiée')).toBeVisible();
  // La même image pour la contre-étiquette est refusée.
  await page.getByRole('button', { name: 'Choisir une photo existante : Contre-étiquette' }).click();
  await gallery.setInputFiles({ name: 'dos.jpg', mimeType: 'image/jpeg', buffer: photo });
  await toast(page, /déjà utilisée pour « Étiquette »/);
  await expect(page.getByAltText('Contre-étiquette photographiée')).toHaveCount(0);
  // Étiquette de prix : galerie.
  await page.getByRole('button', { name: 'Choisir une photo existante : Étiquette de prix' }).click();
  await gallery.setInputFiles({ name: 'prix.jpg', mimeType: 'image/jpeg', buffer: await priceTagPhoto(page) });
  await expect(page.getByAltText('Étiquette de prix photographiée')).toBeVisible();
  await shot(page, '20-scanner-capture');
  await analyse.click();

  // Lia hésite entre deux cuvées : la personne choisit.
  await expect(page.getByText('Plusieurs vins sont possibles : lequel avez-vous en main ?')).toBeVisible();
  await expect(page.getByText(/Un reflet gêne la lecture/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmer le vin et le prix' })).toBeDisabled();
  // Millésime incertain surligné, jusqu'au choix de la personne.
  const vintage = page.getByRole('textbox', { name: 'Millésime' });
  await expect(vintage).toHaveClass(/uncertain/);
  await page.getByRole('button', { name: /Le Petit Labeille/ }).click();
  await expect(page.getByLabel('Cuvée')).toHaveValue('Le Petit Labeille');
  await expect(vintage).toHaveValue('2016');
  // Prix lu sur l'étiquette du rayon, à confirmer ; la condition de promotion est signalée à part.
  const price = page.getByLabel(/Prix d’une bouteille/);
  await expect(price).toHaveValue('24,9');
  await expect(page.getByText(/Conditions lues : 2 achetées/)).toBeVisible();
  await shot(page, '21-scanner-verification');
  await price.fill('23,50');
  await page.getByLabel('Magasin (facultatif)').fill('Caviste du coin');
  await page.getByRole('button', { name: 'Confirmer le vin et le prix' }).click();

  await expect(page.getByRole('heading', { name: /Château Labeille 2016/ })).toBeVisible();

  // Lot 3b : analyse du vin puis prix du marché, verdict calculé (prix 13 % sous la médiane, qualité « très bon »).
  await expect(page.getByRole('heading', { name: 'Excellente affaire' })).toBeVisible();
  await expect(page.getByText('Estimation Lia : 7,5/10')).toBeVisible();
  await expect(page.getByText(/−13 % par rapport à la médiane de 3 offres vérifiées/)).toBeVisible();
  const prices = page.locator('.scan-prices');
  await expect(prices).toContainText('Prix le plus bas vérifié');
  await expect(prices).toContainText('25 €');
  await expect(prices).toContainText(/Haute/);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, '22b-scanner-verdict-haut');
  await page.getByText('Analyse détaillée').click();
  await expect(page.getByText(/Guide exemple : 2 étoiles/)).toBeVisible();
  // La note inventée (lien absent de la recherche) n'apparaît pas.
  await expect(page.getByText('Note inventée')).toHaveCount(0);
  await expect(page.getByText(/Aucune note de consommateurs/)).toBeVisible();
  await shot(page, '23-scanner-verdict');
  await expect(page.getByText('23,50 €').first()).toBeVisible();
  await expect(page.getByText(/Le Petit Labeille · Château Labeille/)).toBeVisible();
  await shot(page, '22-scanner-resume');

  // Aucune bouteille ajoutée automatiquement.
  await goto(page, '/cave');
  await expect(page.getByRole('heading', { name: 'Ma cave' })).toBeVisible();
  await expect(page.getByText('Château Labeille')).toHaveCount(0);

  // Historique, puis envie et ajout à la cave par le formulaire habituel (prix et magasin pré-remplis).
  await goto(page, '/scanner/historique');
  await expect(page.getByText(/Caviste du coin/)).toBeVisible();
  await page.getByRole('link', { name: /Château Labeille 2016/ }).click();
  await page.getByRole('button', { name: 'Ajouter à mes envies' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click();
  await toast(page, 'Ajouté à votre liste d’envies');
  await page.getByRole('button', { name: 'Ajouter à ma cave' }).click();
  const form = page.getByRole('dialog', { name: 'Vérifier et ajouter' });
  await expect(form.getByLabel('Nom du vin')).toHaveValue('Château Labeille');
  await expect(form.getByLabel(/Prix d’achat/)).toHaveValue('23,5');
  await form.getByRole('button', { name: 'Ajouter à ma cave' }).click();
  await toast(page, 'Vin ajouté');

  // Suppression de tout l'historique.
  await goto(page, '/scanner/historique');
  await page.getByRole('button', { name: 'Supprimer tout l’historique' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Tout supprimer' }).click();
  await toast(page, 'Historique supprimé');
  await expect(page.getByText('Aucune analyse pour l’instant')).toBeVisible();
});

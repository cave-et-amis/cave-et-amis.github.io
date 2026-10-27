/**
 * Accessibilité automatique (axe-core, règles WCAG 2.1 A et AA) sur les écrans principaux, au format téléphone.
 * Seuls les défauts « graves » et « critiques » font échouer le test ; les autres sont listés dans le rapport.
 * Compte créé ici : le fichier ne dépend pas des autres parcours.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { goto, signUp } from './helpers';

const SCREENS = ['/', '/cave', '/amis', '/evenements', '/carnet', '/assistant', '/scanner', '/reglages', '/reglages/confidentialite'];

test('écrans principaux : aucun défaut d’accessibilité grave', async ({ page }, info) => {
  test.setTimeout(180_000);
  await signUp(page, 'Ada');
  await expect(page.getByRole('heading', { name: 'Bonjour Ada' })).toBeVisible();
  const serious: string[] = [];
  const minor: string[] = [];
  for (const hash of SCREENS) {
    await goto(page, hash);
    await page.waitForTimeout(400);
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    for (const v of violations) {
      const line = `${hash} : ${v.id} (${v.impact}) — ${v.nodes.length} élément(s) : ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join(' | ')}`;
      (v.impact === 'serious' || v.impact === 'critical' ? serious : minor).push(line);
    }
  }
  await info.attach('accessibilite.txt', { body: [...serious, '', ...minor].join('\n'), contentType: 'text/plain' });
  expect(serious, serious.join('\n')).toEqual([]);
});

test('clavier : « Aller au contenu » ; hors ligne : bandeau, écrans déjà ouverts toujours lisibles', async ({ page, context }) => {
  await signUp(page, 'Odile');
  await expect(page.getByRole('heading', { name: 'Bonjour Odile' })).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Aller au contenu' });
  await expect(skip).toBeFocused();
  await skip.press('Enter');
  await expect(page.locator('#contenu')).toBeFocused();
  expect(page.url()).not.toContain('contenu');

  await goto(page, '/carnet');
  await expect(page.getByRole('tablist', { name: 'Sections du carnet' })).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText('Pas de connexion internet')).toBeVisible();
  await goto(page, '/');
  await expect(page.getByRole('heading', { name: 'Bonjour Odile' })).toBeVisible();
  await goto(page, '/carnet');
  await expect(page.getByRole('tablist', { name: 'Sections du carnet' })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText('Pas de connexion internet')).toBeHidden();
});

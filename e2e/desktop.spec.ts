/** Sur ordinateur : navigation latérale, mise en page large, aucun débordement horizontal. */
import { expect, test } from '@playwright/test';
import { goto, shot, signIn } from './helpers';

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

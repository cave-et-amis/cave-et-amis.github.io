/**
 * Barre du bas « meniscus » dans l'application réelle (téléphone et tablette) : chaque onglet ouvre le bon écran,
 * l'adresse et le bouton retour suivent, la connexion et la cave se chargent, aucune erreur dans la console, et la barre
 * est bien dessinée à 320, 390 et 768 px (goutte centrée sur son onglet, creux loin des angles, pas de débordement).
 */
import { expect, test, type Page } from '@playwright/test';
import { signIn, signUp } from './helpers';

test.describe.configure({ mode: 'serial' });
let page: Page;
const errors: string[] = [];

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await signUp(page, 'Mathis');
  await expect(page.getByRole('heading', { name: 'Bonjour Mathis' })).toBeVisible();
  const skip = page.getByRole('button', { name: 'Commencer directement' });
  if (await skip.isVisible().catch(() => false)) await skip.click();
});
test.afterAll(async () => page.context().close());

const bar = () => page.locator('meniscus-tabbar');
const tab = (id: string) => page.locator(`meniscus-tabbar button.tab[data-id="${id}"]`);
const activeId = () => bar().evaluate((el) => (el as HTMLElement & { activeId: string }).activeId);
const settled = () =>
  page.waitForFunction(() => {
    const n = document.querySelector('meniscus-tabbar') as (HTMLElement & { _raf: number; _x: number; _target: number }) | null;
    return n !== null && n._raf === 0 && Math.abs(n._x - n._target) < 0.01;
  });

/** Géométrie de la barre : goutte sur l'onglet actif, creux loin des angles, rien hors de l'écran. */
async function geometry() {
  return bar().evaluate((el) => {
    const nav = el as HTMLElement & { activeIndex: number };
    const root = nav.shadowRoot!;
    const bead = root.querySelector('.bead')!.getBoundingClientRect();
    const tabs = [...root.querySelectorAll('button.tab')].map((t) => t.getBoundingClientRect());
    const active = tabs[nav.activeIndex];
    const lines = (root.querySelector('path')!.getAttribute('d')!.match(/L(-?[\d.]+)/g) ?? []).map((s) => Number(s.slice(1)));
    const host = nav.getBoundingClientRect();
    return {
      beadOffset: Math.abs(bead.left + bead.width / 2 - (active.left + active.width / 2)),
      notchLeft: lines[0],
      notchRight: host.width - lines[1],
      inside: host.left >= 0 && host.right <= window.innerWidth,
      tabsInside: tabs.every((t) => t.left >= 0 && t.right <= window.innerWidth),
      minSpacing: Math.min(...tabs.slice(1).map((t, i) => t.left - tabs[i].left)),
      tabHeight: Math.min(...tabs.map((t) => t.height)),
      beadColor: getComputedStyle(root.querySelector('.bead')!).backgroundColor,
      images: [...root.querySelectorAll('img.pic')].filter((i) => (i as HTMLImageElement).naturalWidth > 0).length,
    };
  });
}

test('chaque onglet ouvre son écran ; l’adresse et le bouton retour suivent', async () => {
  await settled();
  expect(await activeId()).toBe('accueil');
  for (const [id, hash, heading] of [
    ['cave', '#/cave', 'Ma cave'],
    ['lia', '#/assistant', 'Assistant'],
    ['evenements', '#/evenements', 'Événements'],
    ['amis', '#/amis', 'Amis & Groupes'],
    ['accueil', '#/', 'Cave & Amis'],
  ] as const) {
    await tab(id).click();
    await settled();
    await expect(page).toHaveURL(new RegExp(`${hash.replace('/', '\\/')}$`));
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    expect(await activeId()).toBe(id);
  }
  // Bouton retour du navigateur : l'écran ET l'onglet reviennent.
  await page.goBack();
  await expect(page).toHaveURL(/#\/amis$/);
  await settled();
  expect(await activeId()).toBe('amis');
  // Lien direct (adresse tapée) : l'onglet suit sans rien déclencher d'autre.
  await page.evaluate(() => (location.hash = '/evenements'));
  await settled();
  expect(await activeId()).toBe('evenements');
  // Sous-page : toucher l'onglet actif (la goutte, posée dessus) revient à son écran.
  await page.evaluate(() => (location.hash = '/cave/plan'));
  await settled();
  expect(await activeId()).toBe('cave');
  await page.locator('meniscus-tabbar .bead').click();
  await expect(page).toHaveURL(/#\/cave$/);
  // Page hors des onglets (Réglages) : la goutte reste où elle est.
  await page.evaluate(() => (location.hash = '/reglages'));
  await expect(page.getByRole('heading', { level: 1, name: 'Réglages' })).toBeVisible();
  expect(await activeId()).toBe('cave');
});

test('clavier, lecteurs d’écran et icônes 3D de l’application', async () => {
  await page.evaluate(() => (location.hash = '/'));
  await settled();
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(5);
  await expect(page.getByRole('tab', { name: 'Accueil' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Accueil' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/#\/cave$/);
  await page.keyboard.press('End');
  await expect(page).toHaveURL(/#\/amis$/);
  // Les cinq icônes 3D (boutons) et celle de la goutte sont chargées.
  const g = await geometry();
  expect(g.images).toBe(6);
});

test('glisser la goutte : l’écran change au lâcher seulement', async () => {
  await page.evaluate(() => (location.hash = '/'));
  await settled();
  const from = (await page.locator('meniscus-tabbar .bead').boundingBox())!;
  const to = (await tab('evenements').boundingBox())!;
  const y = from.y + from.height / 2;
  await page.mouse.move(from.x + from.width / 2, y);
  await page.mouse.down();
  for (let k = 1; k <= 15; k++) await page.mouse.move(from.x + from.width / 2 + ((to.x + to.width / 2 - from.x - from.width / 2) * k) / 15, y);
  // Pendant le glisser, on reste sur l'accueil.
  await expect(page).toHaveURL(/#\/$/);
  await page.mouse.up();
  await expect(page).toHaveURL(/#\/evenements$/);
});

test('connexion et cave : rien de cassé ; masquée sur le scanner', async () => {
  await page.evaluate(() => (location.hash = '/cave'));
  await expect(page.getByRole('heading', { level: 1, name: 'Ma cave' })).toBeVisible();
  await page.evaluate(() => (location.hash = '/scanner'));
  await expect(bar()).toHaveCount(0);
  await page.evaluate(() => (location.hash = '/'));
  await expect(bar()).toHaveCount(1);
  // Reconnexion : la barre revient, sur l'accueil.
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await signIn(page, 'Mathis');
  await expect(bar()).toBeVisible();
});

for (const [w, h] of [
  [320, 568],
  [390, 844],
  [768, 1024],
] as const) {
  test(`rendu à ${w} px : goutte centrée, creux loin des angles, cibles de 44 px, pas de fondu`, async () => {
    await page.setViewportSize({ width: w, height: h });
    await page.reload();
    await expect(bar()).toBeVisible();
    // Dès le chargement, la goutte a sa couleur (pas de fondu depuis le transparent).
    expect((await geometry()).beadColor).toBe('rgb(224, 176, 137)');
    await settled();
    const g = await geometry();
    expect(g.beadOffset).toBeLessThan(1.5);
    expect(g.notchLeft).toBeGreaterThanOrEqual(18);
    expect(g.notchRight).toBeGreaterThanOrEqual(18);
    expect(g.inside && g.tabsInside).toBe(true);
    expect(g.minSpacing).toBeGreaterThanOrEqual(44);
    expect(g.tabHeight).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `reports/screens/60-barre-${w}.png` });
  });
}

test('aucune erreur dans la console', async () => {
  expect(errors).toEqual([]);
});

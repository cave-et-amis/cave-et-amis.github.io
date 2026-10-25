/**
 * Notifications push, sur téléphone. Le navigateur de test n'a pas de vrai service de notifications : l'appareil est
 * simulé, et son abonnement pointe vers un faux service (e2e/mock-push.ts) qui déchiffre ce qu'il reçoit et vérifie la
 * signature du serveur. Activation, essai, vraie notification (lien d'invitation utilisé), désactivation ; iPhone sans
 * installation sur l'écran d'accueil. Fichier nommé pour passer après parcours.spec.ts.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { goto, inviteCode, shot, signUp, toast } from './helpers';

test.describe.configure({ mode: 'serial' });

const PUSH = 'http://127.0.0.1:54397';
let nora: Page;
let contexts: BrowserContext[] = [];

type Received = { title: string; body: string; url: string; vapid: boolean; encoding: string };
const received = async (name: string) => (await (await fetch(`${PUSH}/messages/${name}`)).json()) as Received[];

async function newPhone(browser: Browser, o: { userAgent?: string } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR', timezoneId: 'Europe/Paris', ...o });
  contexts.push(ctx);
  return ctx;
}

/** Appareil simulé : autorisation accordée, et un « service worker » dont l'abonnement pointe vers le faux service. */
async function simulatedDevice(ctx: BrowserContext, name: string) {
  const device = (await (await fetch(`${PUSH}/device/${name}`)).json()) as { endpoint: string; p256dh: string; auth: string };
  await ctx.grantPermissions(['notifications']);
  await ctx.addInitScript((dev) => {
    const KEY = 'test-abonnement-push';
    let current: unknown = null;
    const make = (key: ArrayBuffer) => ({
      endpoint: dev.endpoint,
      options: { applicationServerKey: key },
      toJSON: () => ({ endpoint: dev.endpoint, keys: { p256dh: dev.p256dh, auth: dev.auth } }),
      unsubscribe: async () => {
        localStorage.removeItem(KEY);
        current = null;
        return true;
      },
    });
    const saved = localStorage.getItem(KEY);
    if (saved) current = make(Uint8Array.from(JSON.parse(saved) as number[]).buffer);
    const registration = {
      pushManager: {
        getSubscription: async () => current,
        subscribe: async (o: { applicationServerKey: Uint8Array }) => {
          const key = new Uint8Array(o.applicationServerKey);
          localStorage.setItem(KEY, JSON.stringify([...key]));
          current = make(key.buffer);
          return current;
        },
      },
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration: async () => registration, register: async () => registration, ready: Promise.resolve(registration), addEventListener: () => undefined },
    });
  }, device);
}

test.afterAll(async () => {
  for (const c of contexts) await c.close();
  contexts = [];
});

test('activer sur cet appareil : la notification d’essai arrive chiffrée, signée, lisible par l’appareil seul', async ({ browser }) => {
  const ctx = await newPhone(browser);
  await simulatedDevice(ctx, 'nora');
  nora = await ctx.newPage();
  await signUp(nora, 'Nora');
  await expect(nora.getByRole('heading', { name: 'Bonjour Nora' })).toBeVisible();
  // Le service worker du site sait afficher une notification et ouvrir le bon écran.
  const sw = await (await nora.request.get('/sw.js')).text();
  expect(sw).toContain("addEventListener('push'");
  expect(sw).toContain("addEventListener('notificationclick'");

  await goto(nora, '/reglages');
  const card = nora.getByRole('region', { name: 'Notifications sur cet appareil' });
  await card.getByRole('button', { name: 'Activer les notifications sur cet appareil' }).click();
  await toast(nora, 'Notifications activées sur cet appareil');
  await expect(card.getByText('Activées sur cet appareil.')).toBeVisible();
  await expect(card.getByText(/\(cet appareil\)/)).toBeVisible();
  await card.getByRole('button', { name: 'Envoyer une notification d’essai' }).click();
  await toast(nora, 'Notification d’essai envoyée (1 appareil).');
  await expect.poll(async () => (await received('nora')).length).toBe(1);
  const [essai] = await received('nora');
  expect(essai).toMatchObject({ title: 'Cave & Amis', url: '#/reglages', vapid: true, encoding: 'aes128gcm' });
  expect(essai.body).toContain('essai');
  // Capture sans les messages de confirmation (ils disparaissent seuls).
  await expect(nora.locator('.toast')).toHaveCount(0, { timeout: 10_000 });
  await card.scrollIntoViewIfNeeded();
  await shot(nora, '30-notifications-push');
});

test('une vraie notification : une personne utilise mon lien d’invitation, mon appareil est prévenu', async ({ browser }) => {
  const code = await inviteCode(nora, 'Découvrir l’application');
  const sami = await (await newPhone(browser)).newPage();
  await signUp(sami, 'Sami', `/#/ami/${code}`);
  await sami.getByRole('button', { name: 'Accepter' }).click();
  await expect(sami.getByRole('heading', { name: 'Vous êtes en contact avec Nora' })).toBeVisible();
  await expect
    .poll(async () => (await received('nora')).map((m) => m.body), { timeout: 20_000 })
    .toContain('Sami a rejoint Cave & Amis grâce à votre invitation');
  const message = (await received('nora')).find((m) => m.body.startsWith('Sami'))!;
  expect(message).toMatchObject({ title: 'Cave & Amis', vapid: true });
  expect(message.url).toMatch(/^#\/amis\/[0-9a-f-]{36}$/);
});

test('page Notifications : rien à proposer une fois activées ; désactiver sur cet appareil arrête les envois', async () => {
  await nora.reload();
  await goto(nora, '/notifications');
  await expect(nora.getByText('Sami a rejoint Cave & Amis grâce à votre invitation')).toBeVisible();
  await expect(nora.getByText('Recevez-les aussi sur cet appareil')).toHaveCount(0);

  await goto(nora, '/reglages');
  const card = nora.getByRole('region', { name: 'Notifications sur cet appareil' });
  await card.getByRole('button', { name: 'Désactiver sur cet appareil' }).click();
  await toast(nora, 'Notifications désactivées sur cet appareil');
  await expect(card.getByRole('button', { name: 'Activer les notifications sur cet appareil' })).toBeVisible();
  await expect(card.getByText(/\(cet appareil\)/)).toHaveCount(0);
  await goto(nora, '/notifications');
  await expect(nora.getByRole('button', { name: 'Activer les notifications' })).toBeVisible();
});

test('iPhone sans installation sur l’écran d’accueil : l’application explique comment faire', async ({ browser }) => {
  const iphone = await (
    await newPhone(browser, {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    })
  ).newPage();
  await signUp(iphone, 'Iris');
  await goto(iphone, '/reglages');
  const card = iphone.getByRole('region', { name: 'Notifications sur cet appareil' });
  await expect(card.getByText(/ajoutez d’abord Cave & Amis à l’écran d’accueil/)).toBeVisible();
  await expect(card.getByRole('button', { name: /Activer/ })).toHaveCount(0);
  await goto(iphone, '/notifications');
  await expect(iphone.getByText(/Pour recevoir ces notifications sur votre iPhone/)).toBeVisible();
  await shot(iphone, '31-notifications-iphone');
});

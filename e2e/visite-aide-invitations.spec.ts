/**
 * Accueil et prise en main, sur téléphone : bienvenue d'un nouveau compte, visite guidée (suivant, précédent,
 * progression, interruption puis reprise), astuces de première visite, aide « ? » de la page, réglages ; Lia comme
 * guide (réponse d'après l'aide, accès direct, fonction réservée refusée) ; « Inviter quelqu'un » (QR code, WhatsApp,
 * SMS, e-mail), « Mes invitations » (partager, révoquer), lien révoqué ; lien « voir ma cave » limité à une sélection,
 * de la page du lien à l'inscription ; lien de groupe accepté par une personne déjà inscrite ; présentation de
 * l'application sans compte.
 * Fichier nommé pour passer après parcours.spec.ts (le premier compte créé de la série devient administrateur).
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { email, goto, inviteCode, PASSWORD, shot, signUp, skipWelcome, toast } from './helpers';

test.describe.configure({ mode: 'serial' });

let ines: Page;
let theo: Page;
let zoe: Page;
let contexts: BrowserContext[] = [];

async function newPhone(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  contexts.push(ctx);
  return ctx.newPage();
}

test.beforeAll(async ({ browser }) => {
  ines = await newPhone(browser);
  theo = await newPhone(browser);
  zoe = await newPhone(browser);
});

test.afterAll(async () => {
  for (const c of contexts) await c.close();
  contexts = [];
});

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const contains = (outer: Box, inner: Box) =>
  outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height;
/** Attend l'enregistrement dans le profil des préférences (visite, astuces) dont l'envoi contient « part ». */
const prefsSaved = (p: Page, part: string) =>
  p.waitForResponse((r) => r.url().includes('/rpc/merge_preferences') && r.ok() && (r.request().postData() ?? '').includes(part));
const step = (p: Page, title: string) => p.getByRole('dialog', { name: title, exact: true });
/** Capture d'écran sans message de confirmation par-dessus (ils disparaissent seuls). */
async function snap(p: Page, name: string) {
  await expect(p.locator('.toast')).toHaveCount(0, { timeout: 10_000 });
  await shot(p, name);
}

test('nouveau compte : bienvenue, visite guidée (suivant, précédent, progression), interruption puis reprise', async () => {
  await signUp(ines, 'Ines', '/', { welcome: true });
  const welcome = ines.getByRole('dialog', { name: 'Bienvenue sur Cave & Amis ! 🍷' });
  await expect(welcome).toBeVisible();
  await expect(welcome.getByRole('button', { name: 'Commencer directement' })).toBeVisible();
  // Fin de l'animation d'ouverture avant la capture.
  await ines.waitForTimeout(600);
  await snap(ines, '20-bienvenue');
  await welcome.getByRole('button', { name: 'Découvrir l’application' }).click();

  const first = step(ines, 'Votre tableau de bord');
  await expect(first).toContainText(/Étape 1 sur \d+/);
  const total = Number(/Étape 1 sur (\d+)/.exec(await first.innerText())![1]);
  await first.getByRole('button', { name: 'Suivant' }).click();
  const cave = step(ines, 'Votre cave');
  await expect(cave).toContainText(`Étape 2 sur ${total}`);
  // La zone éclairée entoure le vrai lien « Ma cave » de la barre du bas ; la carte ne le cache pas.
  const link = (await ines.locator('.tabbar [data-tour="nav-cave"]').boundingBox())!;
  await expect.poll(async () => contains((await ines.locator('.tour-spot').boundingBox())!, link)).toBe(true);
  expect(overlaps((await cave.boundingBox())!, link)).toBe(false);
  await snap(ines, '21-visite-guidee');
  await cave.getByRole('button', { name: 'Précédent' }).click();
  await expect(step(ines, 'Votre tableau de bord')).toContainText(`Étape 1 sur ${total}`);
  // Au clavier aussi : le bouton principal a le focus, flèche droite = Suivant.
  await expect(step(ines, 'Votre tableau de bord').getByRole('button', { name: 'Suivant' })).toBeFocused();
  await ines.keyboard.press('ArrowRight');
  await expect(step(ines, 'Votre cave')).toBeVisible();
  const saved = prefsSaved(ines, '"step":2');
  await step(ines, 'Votre cave').getByRole('button', { name: 'Suivant' }).click();
  await expect(step(ines, 'Ajouter une bouteille')).toContainText(`Étape 3 sur ${total}`);
  await saved;

  // Interruption (application rechargée) : la visite se reprend là où elle s'était arrêtée.
  await ines.reload();
  await expect(ines.getByText('Reprendre la visite guidée ?')).toBeVisible();
  await expect(ines.getByText(`Vous vous étiez arrêté à l’étape 3 sur ${total}.`)).toBeVisible();
  await ines.getByRole('button', { name: 'Reprendre' }).click();
  await expect(step(ines, 'Ajouter une bouteille')).toBeVisible();

  // Jusqu'au bout : chaque étape va sur la bonne page.
  const pages: Record<string, RegExp> = { 'Inviter quelqu’un': /#\/amis$/, 'Créer ou rejoindre un groupe': /onglet=groupes/, 'Organiser un événement': /#\/evenements$/ };
  for (let n = 3; n < total; n += 1) {
    const card = ines.locator('.tour-card');
    await expect(card).toContainText(`Étape ${n} sur ${total}`);
    await card.getByRole('button', { name: 'Suivant' }).click();
    await expect(card).toContainText(`Étape ${n + 1} sur ${total}`);
    const title = await card.getByRole('heading').innerText();
    if (pages[title]) await expect(ines).toHaveURL(pages[title]);
  }
  await expect(step(ines, 'L’aide, à tout moment')).toBeVisible();
  await ines.locator('.tour-card').getByRole('button', { name: 'Terminer' }).click();
  await toast(ines, 'Visite terminée');
  await expect(ines.locator('.tour-card')).toHaveCount(0);
  await expect(ines).toHaveURL(/#\/$/);

  // Plus jamais imposée ensuite.
  await ines.reload();
  await expect(ines.getByRole('heading', { name: 'Bonjour Ines' })).toBeVisible();
  await expect(ines.getByRole('dialog', { name: 'Bienvenue sur Cave & Amis ! 🍷' })).toHaveCount(0);
  await expect(ines.getByText('Reprendre la visite guidée ?')).toHaveCount(0);
});

test('astuce de première visite, aide « ? » de la page avec accès direct, réglages : revoir la visite et les astuces', async () => {
  // Cave vide : la page guide déjà (« Votre cave est vide ») ; l'astuce vient avec les premières bouteilles.
  await goto(ines, '/cave');
  await expect(ines.getByText('Votre cave est vide')).toBeVisible();
  await expect(ines.getByRole('complementary', { name: 'Astuce : Votre cave' })).toHaveCount(0);
  for (const name of ['Château Sélection', 'Domaine Caché']) {
    await goto(ines, '/');
    await ines.getByRole('button', { name: /Saisir un vin/ }).first().click();
    await ines.getByLabel('Nom du vin').fill(name);
    await ines.getByRole('button', { name: 'Ajouter à ma cave' }).click();
    await expect(ines).toHaveURL(/#\/cave\/vin\//);
  }
  await goto(ines, '/cave');
  const tip = ines.getByRole('complementary', { name: 'Astuce : Votre cave' });
  await expect(tip).toBeVisible();
  const saved = prefsSaved(ines, '"tips"');
  await tip.getByRole('button', { name: 'J’ai compris' }).click();
  await saved;
  await expect(tip).toHaveCount(0);
  await ines.reload();
  await expect(ines.getByRole('button', { name: 'Aide de cette page' })).toBeVisible();
  await expect(ines.getByRole('complementary', { name: 'Astuce : Votre cave' })).toHaveCount(0);

  // L'aide de la page : ses fiches, la recherche, et un accès direct au bon écran.
  await ines.getByRole('button', { name: 'Aide de cette page' }).click();
  const help = ines.getByRole('dialog', { name: 'Aide · Ma cave' });
  await help.getByRole('searchbox', { name: 'Chercher dans l’aide' }).fill('qr code');
  await expect(help.getByText('Comment inviter quelqu’un sans lui montrer ma cave ?')).toBeVisible();
  await help.getByRole('searchbox', { name: 'Chercher dans l’aide' }).fill('');
  await help.getByText('Comment ajouter une bouteille ?').click();
  await expect(help.getByText('Photographier une étiquette', { exact: false }).first()).toBeVisible();
  await snap(ines, '22-aide-de-la-page');
  await help.getByRole('button', { name: 'Ajouter une bouteille' }).click();
  const add = ines.getByRole('dialog', { name: 'Ajouter' });
  await expect(add).toBeVisible();
  await expect(ines).toHaveURL(/#\/cave$/);
  await add.getByRole('button', { name: 'Fermer' }).click();

  // Réglages : réafficher les astuces, revoir la visite (Échap = Passer).
  await goto(ines, '/reglages');
  await ines.getByRole('button', { name: 'Réafficher les astuces' }).click();
  await toast(ines, 'Les astuces réapparaîtront');
  await ines.getByRole('button', { name: 'Revoir la visite guidée' }).click();
  await expect(step(ines, 'Votre tableau de bord')).toContainText('Étape 1 sur');
  await expect(step(ines, 'Votre tableau de bord').getByRole('button', { name: 'Suivant' })).toBeFocused();
  await ines.keyboard.press('Escape');
  await expect(ines.locator('.tour-card')).toHaveCount(0);
  await goto(ines, '/cave');
  await expect(ines.getByRole('complementary', { name: 'Astuce : Votre cave' })).toBeVisible();
});

test('Lia : rubrique « Aide avec Cave & Amis », réponse d’après l’aide avec accès direct, fonction réservée refusée', async () => {
  await goto(ines, '/assistant');
  const rubric = ines.getByRole('region', { name: 'Aide avec Cave & Amis' });
  await rubric.getByText('Comment inviter quelqu’un sans lui montrer ma cave ?').click();
  await expect(rubric.getByText('Choisissez « Découvrir l’application ».')).toBeVisible();
  await expect(rubric.getByRole('button', { name: 'Ouvrir les invitations' })).toBeVisible();

  // Question libre : Lia répond d'après la fiche d'aide et propose le bon écran ; rien n'est fait à la place de la personne.
  await ines.getByLabel('Votre question à l’assistant').fill('Comment inviter Paul sans lui montrer mes bouteilles ?');
  await ines.getByRole('button', { name: 'Envoyer' }).click();
  await expect(ines.locator('.bubble.assistant').last()).toContainText('Inviter quelqu’un sans lui montrer ma cave');
  await expect(ines.locator('.bubble.assistant').last()).toContainText('Choisissez « Découvrir l’application ».');
  const open = ines.locator('.action-card').last().getByRole('button', { name: 'Ouvrir les invitations' });
  await expect(open).toBeVisible();
  await snap(ines, '23-lia-aide');
  await open.click();
  await expect(ines).toHaveURL(/#\/amis\?onglet=invitations$/);

  // Fonction réservée à l'administrateur : Lia le dit, et ne propose aucun accès.
  await goto(ines, '/assistant');
  await ines.getByLabel('Votre question à l’assistant').fill('Comment accéder à l’administration de l’application ?');
  await ines.getByRole('button', { name: 'Envoyer' }).click();
  await expect(ines.locator('.bubble.assistant').last()).toContainText('Réservé à l’administrateur de l’application.');
  await expect(ines.locator('.action-card')).toHaveCount(0);
});

test('inviter quelqu’un : QR code, WhatsApp, SMS, e-mail ; Mes invitations : partager, révoquer ; lien révoqué refusé', async () => {
  await goto(ines, '/');
  await ines.getByRole('button', { name: /^Inviter quelqu’un/ }).click();
  const sheet = ines.getByRole('dialog', { name: 'Inviter quelqu’un' });
  await expect(sheet.getByRole('radio', { name: /Découvrir l’application/ })).toBeChecked();
  await sheet.getByLabel('Pour qui ? (facultatif)').fill('Paul');
  await sheet.getByRole('button', { name: 'Créer le lien' }).click();
  const ready = ines.getByRole('dialog', { name: 'Votre invitation est prête' });
  await expect(ready.getByRole('img', { name: /QR code de l’invitation/ })).toBeVisible();
  const code = (await ready.locator('.kbd-code').innerText()).replace(/-/g, '');
  expect(code).toMatch(/^[A-Z2-9]{10}$/);
  const whatsapp = (await ready.getByRole('link', { name: 'WhatsApp' }).getAttribute('href'))!;
  expect(whatsapp.startsWith('https://wa.me/?text=')).toBe(true);
  expect(decodeURIComponent(whatsapp)).toContain(`#/ami/${code}`);
  expect(decodeURIComponent((await ready.getByRole('link', { name: 'SMS' }).getAttribute('href'))!)).toContain(`#/ami/${code}`);
  expect(await ready.getByRole('link', { name: 'E-mail' }).getAttribute('href')).toMatch(/^mailto:\?subject=/);
  await snap(ines, '24-invitation-prete');
  await ready.getByRole('button', { name: 'Fermer' }).click();

  await goto(ines, '/amis?onglet=invitations');
  const mine = ines.getByRole('region', { name: 'Mes invitations' });
  await expect(mine.getByText('Découvrir l’application — Paul')).toBeVisible();
  await expect(mine.getByText('Actif', { exact: true })).toBeVisible();
  // Partager à nouveau : le même lien.
  await mine.getByRole('button', { name: 'Partager le lien Découvrir l’application (Paul)' }).click();
  const again = ines.getByRole('dialog', { name: 'Partager l’invitation' });
  expect((await again.locator('.kbd-code').innerText()).replace(/-/g, '')).toBe(code);
  await again.getByRole('button', { name: 'Fermer' }).click();
  await mine.getByRole('button', { name: 'Révoquer le lien Découvrir l’application (Paul)' }).click();
  await ines.getByRole('alertdialog', { name: 'Révoquer ce lien ?' }).getByRole('button', { name: 'Révoquer' }).click();
  await toast(ines, 'Lien révoqué');
  await expect(mine.getByText('Découvrir l’application — Paul')).toHaveCount(0);
  await mine.getByRole('button', { name: 'Toutes' }).click();
  await expect(mine.getByText('Découvrir l’application — Paul')).toBeVisible();
  await expect(mine.getByText('Révoqué', { exact: true })).toBeVisible();
  await snap(ines, '25-mes-invitations');

  // Théo, sans compte, ouvre le lien révoqué : il n'est plus valable, et la page ne dit rien de plus.
  await theo.goto(`/#/ami/${code}`);
  await expect(theo.getByText('Ce lien d’invitation n’est plus valable')).toBeVisible();
  await expect(theo.getByText('Ines')).toHaveCount(0);
});

test('lien « voir ma cave » limité à une sélection : sans compte, découvrir l’application, s’inscrire, ne voir que la bouteille choisie', async () => {
  await goto(ines, '/amis');
  await ines.getByRole('button', { name: 'Inviter quelqu’un', exact: true }).click();
  const sheet = ines.getByRole('dialog', { name: 'Inviter quelqu’un' });
  await sheet.getByRole('radio', { name: /Voir ma cave/ }).check();
  await sheet.getByRole('group', { name: 'Ce que la personne verra' }).getByRole('button', { name: 'Une sélection' }).click();
  // Une sélection vide ne crée pas de lien.
  await expect(sheet.getByRole('button', { name: 'Créer le lien' })).toBeDisabled();
  await sheet.getByRole('checkbox', { name: /Château Sélection/ }).check();
  const until = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
  await sheet.getByLabel('Accès jusqu’au (facultatif)').fill(until);
  await sheet.getByLabel('Pour qui ? (facultatif)').fill('Théo');
  await snap(ines, '26-invitation-selection');
  await sheet.getByRole('button', { name: 'Créer le lien' }).click();
  const ready = ines.getByRole('dialog', { name: 'Votre invitation est prête' });
  const code = (await ready.locator('.kbd-code').innerText()).replace(/-/g, '');
  await ready.getByRole('button', { name: 'Fermer' }).click();

  // La page du lien, sans compte : qui invite et à quoi, rien de la cave.
  await theo.goto(`/#/ami/${code}`);
  await expect(theo.getByRole('heading', { name: 'Ines vous invite à voir sa cave sur Cave & Amis' })).toBeVisible();
  await expect(theo.getByText('Cette personne vous montre une sélection de bouteilles de sa cave, en lecture seule.', { exact: false })).toBeVisible();
  await expect(theo.getByText('Château Sélection')).toHaveCount(0);
  await theo.getByRole('button', { name: 'Découvrir l’application' }).click();
  await expect(theo).toHaveURL(/#\/decouvrir\?code=/);
  await expect(theo.getByRole('heading', { name: 'Organisez votre cave' })).toBeVisible();
  for (const title of ['Votre cave reste à vous', 'Partagez avec vos amis', 'Préparez vos événements', 'Lia, votre sommelière']) {
    await theo.getByRole('button', { name: 'Suivant' }).click();
    await expect(theo.getByRole('heading', { name: title })).toBeVisible();
  }
  // L'invitation est gardée pendant l'inscription.
  await skipWelcome(theo);
  await theo.getByRole('button', { name: 'Créer mon compte' }).click();
  await theo.getByLabel('Votre prénom').fill('Theo');
  await theo.getByLabel('Adresse e-mail').fill(email('Theo'));
  await theo.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await theo.getByRole('button', { name: 'Créer mon compte' }).click();
  await expect(theo.getByRole('heading', { name: 'Ines vous invite à voir sa cave sur Cave & Amis' })).toBeVisible();
  await theo.getByRole('button', { name: 'Accepter' }).click();
  await expect(theo.getByRole('heading', { name: 'Ines vous montre une sélection de sa cave' })).toBeVisible();
  // Sa propre cave reste fermée : la case n'est pas cochée d'office.
  await expect(theo.getByRole('checkbox', { name: /Ouvrir aussi votre cave à Ines/ })).not.toBeChecked();
  await theo.getByRole('button', { name: 'Continuer' }).click();
  await expect(theo).toHaveURL(/#\/amis\//);
  await expect(theo.getByText('Château Sélection').first()).toBeVisible();
  await expect(theo.getByText('Domaine Caché')).toHaveCount(0);
  await snap(theo, '27-invite-selection');

  // Côté Inès (application rouverte : données à jour) : qui a utilisé le lien, ce que voit Théo.
  await ines.reload();
  await expect(ines.getByRole('button', { name: 'Aide de cette page' })).toBeVisible();
  await goto(ines, '/amis?onglet=invitations');
  const mine = ines.getByRole('region', { name: 'Mes invitations' });
  await mine.getByRole('button', { name: 'Toutes' }).click();
  await expect(mine.getByText('A rejoint : Theo')).toBeVisible();
  await expect(mine.getByText(/sélection de 1 bouteille · accès jusqu’au/)).toBeVisible();
  await mine.getByRole('button', { name: 'Gérer l’accès de Theo' }).click();
  await expect(ines.getByRole('heading', { name: 'Ce que Theo peut voir' })).toBeVisible();
  await expect(ines.getByRole('group', { name: 'Ce que Theo peut voir' }).getByRole('button', { name: 'Une sélection' })).toHaveAttribute('aria-pressed', 'true');
  await snap(ines, '28-acces-selection');
});

test('lien de groupe : une personne déjà inscrite l’accepte et arrive dans le groupe, sans voir la cave', async () => {
  await goto(ines, '/amis?onglet=groupes');
  await ines.getByRole('button', { name: 'Créer un groupe' }).click();
  const form = ines.getByRole('dialog', { name: 'Nouveau groupe' });
  await form.getByLabel('Nom du groupe').fill('Les amis du vendredi');
  await form.getByRole('button', { name: 'Créer le groupe' }).click();
  await expect(ines.getByRole('heading', { name: 'Les amis du vendredi' })).toBeVisible();
  const code = await inviteCode(ines, 'Rejoindre un de mes groupes', 'Les amis du vendredi');

  await theo.goto(`/#/ami/${code}`);
  await expect(theo.getByRole('heading', { name: 'Ines vous invite à rejoindre le groupe « Les amis du vendredi »' })).toBeVisible();
  await expect(theo.getByText('Vous entrerez dans le groupe', { exact: false })).toBeVisible();
  await theo.getByRole('button', { name: 'Accepter' }).click();
  await expect(theo).toHaveURL(/#\/groupes\//);
  await expect(theo.getByRole('heading', { name: 'Les amis du vendredi' })).toBeVisible();
  await expect(theo.getByText('Domaine Caché')).toHaveCount(0);

  // Côté Inès (application rouverte) : le lien reste actif (plusieurs personnes), Théo l'a utilisé.
  await ines.reload();
  await expect(ines.getByRole('button', { name: 'Aide de cette page' })).toBeVisible();
  await goto(ines, '/amis?onglet=invitations');
  const row = ines.getByRole('region', { name: 'Mes invitations' }).locator('.row').filter({ hasText: 'Rejoindre un de mes groupes : « Les amis du vendredi »' });
  await expect(row).toContainText('A rejoint : Theo');
  await expect(row).toContainText('Actif');
});

test('visiteur sans compte : présentation de l’application depuis l’écran de connexion, puis création de compte', async () => {
  await zoe.goto('/');
  await zoe.getByRole('button', { name: 'Découvrir l’application sans compte' }).click();
  await expect(zoe).toHaveURL(/#\/decouvrir$/);
  const show = zoe.getByRole('region', { name: 'Découvrir Cave & Amis' });
  await expect(show.getByRole('heading', { name: 'Organisez votre cave' })).toBeVisible();
  await show.getByRole('button', { name: 'Écran 5 : Lia, votre sommelière' }).click();
  await expect(show.getByRole('heading', { name: 'Lia, votre sommelière' })).toBeVisible();
  await snap(zoe, '29-decouvrir-sans-compte');
  await show.getByRole('button', { name: 'Précédent' }).click();
  await expect(show.getByRole('heading', { name: 'Préparez vos événements' })).toBeVisible();
  await show.getByRole('button', { name: 'Suivant' }).click();
  await zoe.getByRole('button', { name: 'Créer mon compte' }).click();
  await expect(zoe.getByLabel('Votre prénom')).toBeVisible();
  await expect(zoe).toHaveURL(/#\/$/);
});

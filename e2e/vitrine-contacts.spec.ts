/**
 * Inviter sans ouvrir sa cave, sur téléphone : vitrine d'un lien d'événement → inscription → arrivée sur l'événement ;
 * un contact ne voit aucune bouteille ; ouvrir puis fermer sa cave ; section « Bouteilles partagées » masquée ; « Ce que
 * X voit de moi » → masquer une bouteille → l'ami ne la voit plus ; demande d'accès ; « Qui voit ma cave ».
 * Fichier nommé pour passer après parcours.spec.ts (le premier compte créé devient administrateur).
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { email, goto, inviteCode, PASSWORD, shot, signUp, skipWelcome, toast } from './helpers';

test.describe.configure({ mode: 'serial' });

let nadia: Page;
let omar: Page;
let contexts: BrowserContext[] = [];

async function newPhone(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  contexts.push(ctx);
  return ctx.newPage();
}

test.beforeAll(async ({ browser }) => {
  nadia = await newPhone(browser);
  omar = await newPhone(browser);
});

test.afterAll(async () => {
  for (const c of contexts) await c.close();
  contexts = [];
});

/** Recharge et attend que l'application soit prête (barre d'onglets affichée) avant de changer de page. */
async function reload(p: Page) {
  await p.reload();
  await expect(p.getByRole('link', { name: /Amis & Groupes/ })).toBeVisible();
}

test('vitrine d’un lien d’événement : inscription, puis arrivée directe sur l’événement, sans voir la cave', async () => {
  await signUp(nadia, 'Nadia');
  await expect(nadia.getByRole('heading', { name: 'Bonjour Nadia' })).toBeVisible();
  await goto(nadia, '/evenements');
  await nadia.getByRole('button', { name: 'Organiser un événement' }).click();
  await nadia.getByLabel('Titre').fill('Apéro des voisins');
  await nadia.getByRole('button', { name: 'Créer' }).click();
  await toast(nadia, 'Événement créé');
  const code = await inviteCode(nadia, 'Venir à un de mes événements', /Apéro des voisins/);

  // Omar n'a pas de compte : la vitrine dit qui l'invite et à quoi, sans rien d'autre.
  await omar.goto(`/#/ami/${code}`);
  await expect(omar.getByRole('heading', { name: /Nadia vous invite à « Apéro des voisins »/ })).toBeVisible();
  await expect(omar.getByText('Organisez votre cave')).toBeVisible();
  await expect(omar.getByRole('button', { name: 'Me connecter' })).toBeVisible();
  await shot(omar, '12-vitrine-invitation');
  await skipWelcome(omar);
  await omar.getByRole('button', { name: 'Créer mon compte' }).click();
  await omar.getByLabel('Votre prénom').fill('Omar');
  await omar.getByLabel('Adresse e-mail').fill(email('Omar'));
  await omar.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await omar.getByRole('button', { name: 'Créer mon compte' }).click();

  // Arrivée directe sur l'événement, invitation acceptée.
  await expect(omar.getByRole('heading', { name: 'Apéro des voisins' })).toBeVisible();
  await expect(omar).toHaveURL(/#\/evenements\//);
  await expect(omar.getByRole('button', { name: 'Je viens' })).toBeVisible();

  // Nadia est un simple contact : aucune bouteille, aucune section partagée.
  await goto(omar, '/amis');
  await expect(omar.getByRole('heading', { name: 'Mes contacts' })).toBeVisible();
  await expect(omar.getByRole('link', { name: 'Nadia' })).toBeVisible();
  await expect(omar.getByRole('heading', { name: 'Bouteilles partagées par mes amis' })).toHaveCount(0);
});

test('ouvrir sa cave à un contact, masquer la section partagée, masquer une bouteille pour lui, fermer sa cave', async () => {
  // Nadia : une bouteille partagée avec ses amis.
  await goto(nadia, '/reglages');
  await nadia.getByLabel('Partage proposé pour les nouvelles bouteilles').selectOption('friends');
  await toast(nadia, 'Préférence enregistrée');
  await goto(nadia, '/');
  await nadia.getByRole('button', { name: /Saisir un vin/ }).first().click();
  await nadia.getByLabel('Nom du vin').fill('Gigondas');
  await nadia.getByLabel('Millésime', { exact: true }).fill('2020');
  await nadia.getByRole('textbox', { name: 'Nombre de bouteilles', exact: true }).fill('4');
  await nadia.getByRole('button', { name: 'Ajouter à ma cave' }).click();
  await toast(nadia, 'Vin ajouté');

  // Omar ne la voit pas tant que la cave est fermée.
  await reload(omar);
  await goto(omar, '/amis');
  await expect(omar.getByText('Gigondas')).toHaveCount(0);

  // Nadia ouvre sa cave à Omar.
  await reload(nadia);
  await goto(nadia, '/amis');
  await nadia.getByRole('button', { name: 'Ouvrir ma cave à Omar' }).click();
  await toast(nadia, 'Votre cave est ouverte à Omar');

  await reload(omar);
  await goto(omar, '/amis');
  const friend = omar.locator('a.row').filter({ hasText: 'Nadia' });
  await expect(friend).toContainText('1 vin partagé avec vous');
  await expect(friend).toContainText('Je vois sa cave');
  await expect(omar.locator('.row').filter({ hasText: 'Gigondas' })).toBeVisible();
  await shot(omar, '13-amis-et-contacts');

  // Section « Bouteilles partagées par mes amis » masquée, puis réaffichée dans Réglages › Affichage.
  await omar.getByRole('button', { name: 'Masquer cette section' }).click();
  await toast(omar, 'Section masquée');
  await expect(omar.getByText('Gigondas')).toHaveCount(0);
  await expect(omar.getByText('Section « Bouteilles partagées par mes amis » masquée.')).toBeVisible();
  await goto(omar, '/reglages');
  const pref = omar.getByLabel('Afficher « Bouteilles partagées par mes amis »');
  await expect(pref).not.toBeChecked();
  await pref.check();
  await toast(omar, 'Préférence enregistrée');
  await goto(omar, '/amis');
  await expect(omar.locator('.row').filter({ hasText: 'Gigondas' })).toBeVisible();

  // « Ce que Omar voit de moi » : l'aperçu montre la bouteille ; Nadia la masque pour Omar seulement.
  await goto(nadia, '/amis');
  await nadia.locator('a.row').filter({ hasText: 'Omar' }).click();
  await nadia.getByRole('button', { name: 'Ce que Omar voit de moi' }).click();
  await expect(nadia.getByText('Aperçu : voici ce que Omar voit')).toBeVisible();
  await expect(nadia.getByText('1 vin · 4 bouteilles')).toBeVisible();
  await shot(nadia, '14-ce-que-omar-voit');
  await nadia.getByRole('button', { name: 'Masquer Gigondas pour Omar' }).click();
  await toast(nadia, 'Gigondas est masquée pour Omar');
  await expect(nadia.getByText('Masquée pour Omar', { exact: true })).toBeVisible();

  await reload(omar);
  await goto(omar, '/amis');
  await expect(omar.getByText('Gigondas')).toHaveCount(0);
  // Jamais « 0 vin partagé ».
  await expect(omar.locator('a.row').filter({ hasText: 'Nadia' })).not.toContainText('vin partagé');

  // Nadia ferme sa cave : Omar redevient un simple contact, sans perdre l'événement.
  await nadia.getByRole('button', { name: 'Fermer ma cave à Omar' }).click();
  await nadia.getByRole('alertdialog').getByRole('button', { name: 'Fermer ma cave' }).click();
  await toast(nadia, 'Votre cave est fermée à Omar');
  await reload(omar);
  await goto(omar, '/amis');
  await expect(omar.getByRole('heading', { name: 'Mes contacts' })).toBeVisible();
  await omar.getByRole('link', { name: 'Nadia' }).click();
  await expect(omar.getByRole('heading', { name: 'Nadia ne vous a pas ouvert sa cave' })).toBeVisible();
  await omar.getByRole('button', { name: 'Demander l’accès' }).click();
  await toast(omar, 'Demande envoyée à Nadia');
  await goto(omar, '/evenements');
  await expect(omar.getByText('Apéro des voisins')).toBeVisible();
});

test('demande d’accès acceptée ; « Qui voit ma cave » ; fermer sa cave à tout le monde', async () => {
  await reload(nadia);
  await expect(nadia.getByRole('link', { name: 'Amis & Groupes (1 en attente)' })).toBeVisible();
  await goto(nadia, '/amis?onglet=invitations');
  await expect(nadia.getByRole('heading', { name: 'Demandes à voir ma cave' })).toBeVisible();
  await nadia.getByRole('button', { name: 'Ouvrir ma cave à Omar' }).click();
  await toast(nadia, 'Votre cave est ouverte à Omar');

  await goto(nadia, '/reglages/acces');
  const row = nadia.locator('.row').filter({ hasText: 'Omar' });
  await expect(row).toContainText('Voit 0 vin (0 bouteille) · 1 exception');
  await shot(nadia, '15-qui-voit-ma-cave');
  await nadia.getByRole('button', { name: 'Fermer ma cave à tout le monde' }).click();
  await nadia.getByRole('alertdialog').getByRole('button', { name: 'Fermer à tout le monde' }).click();
  await toast(nadia, 'Votre cave est fermée à tout le monde');
  await expect(row).toContainText('Cave fermée');

  // La relation et l'événement restent.
  await reload(omar);
  await goto(omar, '/amis');
  await expect(omar.getByRole('link', { name: 'Nadia' })).toBeVisible();
  await goto(omar, '/evenements');
  await expect(omar.getByText('Apéro des voisins')).toBeVisible();
});

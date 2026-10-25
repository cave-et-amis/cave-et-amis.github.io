/**
 * Parcours principal de bout en bout, sur téléphone : comptes, cave, photo d'étiquette, prix sourcé, partage avec un ami,
 * événement (suggestion, confirmation, réservation, annulation), consommation après l'événement, carnet, assistant,
 * administration et quotas, révocation d'un ami.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { goto, labelPhoto, shot, signIn, signUp, tile, toast } from './helpers';

test.describe.configure({ mode: 'serial' });

let bruno: Page;
let claire: Page;
let brunoCtx: BrowserContext;
let claireCtx: BrowserContext;

async function newPhone(browser: Browser) {
  return browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
}

test.beforeAll(async ({ browser }) => {
  brunoCtx = await newPhone(browser);
  claireCtx = await newPhone(browser);
  bruno = await brunoCtx.newPage();
  claire = await claireCtx.newPage();
});

test.afterAll(async () => {
  await brunoCtx.close();
  await claireCtx.close();
});

test('création de compte, ajout manuel, plusieurs lots du même vin, reconnexion', async () => {
  await signUp(bruno, 'Bruno');
  await expect(bruno.getByRole('heading', { name: 'Bonjour Bruno' })).toBeVisible();
  await expect(bruno.getByText('Commencez votre cave')).toBeVisible();
  await shot(bruno, '01-accueil-vide');

  await bruno.getByRole('button', { name: /Saisir un vin/ }).first().click();
  await bruno.getByLabel('Nom du vin').fill('Château Test');
  await bruno.getByLabel('Millésime', { exact: true }).fill('2018');
  await bruno.getByRole('group', { name: 'Couleur' }).getByRole('button', { name: 'Rouge' }).click();
  await bruno.getByRole('textbox', { name: 'Nombre de bouteilles', exact: true }).fill('6');
  await bruno.getByLabel('Prix d’achat par bouteille (facultatif)').fill('25');
  await shot(bruno, '02-ajout-manuel');
  await bruno.getByRole('button', { name: 'Ajouter à ma cave' }).click();
  await toast(bruno, 'Vin ajouté');
  await expect(bruno).toHaveURL(/#\/cave\/vin\//);
  expect(await tile(bruno, /en stock/)).toBe(6);

  // Second lot du même vin : autre prix, proposable pour les événements, prix masqué par défaut.
  await bruno.getByRole('button', { name: 'Ajouter des bouteilles' }).click();
  await bruno.getByRole('textbox', { name: 'Nombre de bouteilles', exact: true }).fill('3');
  await bruno.getByLabel('Prix d’achat / bouteille').fill('30');
  await bruno.getByLabel(/Proposable pour un événement/).check();
  await bruno.getByRole('button', { name: 'Enregistrer' }).click();
  await toast(bruno, 'Bouteilles ajoutées');
  await expect.poll(() => tile(bruno, /en stock/)).toBe(9);
  expect(await tile(bruno, /^lots?$/)).toBe(2);
  await shot(bruno, '03-fiche-vin');

  // Même vin saisi à nouveau : l'application propose d'ajouter un lot à la fiche existante (pas de doublon).
  await goto(bruno, '/');
  await bruno.getByRole('button', { name: /Saisir un vin/ }).first().click();
  await bruno.getByLabel('Nom du vin').fill('château test');
  await bruno.getByLabel('Millésime', { exact: true }).fill('2018');
  await expect(bruno.getByText(/est déjà dans votre cave/)).toBeVisible();
  await bruno.getByRole('button', { name: 'Annuler' }).click();

  // Déconnexion puis reconnexion : les données sont toujours là.
  await goto(bruno, '/reglages');
  await bruno.getByRole('button', { name: 'Se déconnecter' }).first().click();
  await bruno.getByRole('alertdialog').getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(bruno.getByRole('button', { name: 'Créer un compte' })).toBeVisible();
  await signIn(bruno, 'Bruno');
  await goto(bruno, '/cave');
  await expect(bruno.locator('.row').filter({ hasText: 'Château Test' })).toContainText('9');
});

test('photo d’étiquette identifiée par l’assistant, vérifiée puis corrigée', async () => {
  await goto(bruno, '/');
  await bruno.getByRole('button', { name: /Photographier une étiquette/ }).first().click();
  await expect(bruno.getByRole('dialog', { name: 'Photographier une étiquette' })).toBeVisible();
  await bruno.locator('input[type=file]').first().setInputFiles({ name: 'etiquette.jpg', mimeType: 'image/jpeg', buffer: await labelPhoto(bruno) });
  // Étape 2 (facultative) : la contre-étiquette, lue avec l'étiquette.
  await expect(bruno.getByText('Étape 2 sur 2 (facultatif) : la contre-étiquette.')).toBeVisible();
  await expect(bruno.getByRole('button', { name: 'Passer : lire seulement l’étiquette' })).toBeVisible();
  await shot(bruno, '04a-contre-etiquette');
  await bruno.locator('input[type=file]').first().setInputFiles({ name: 'contre-etiquette.jpg', mimeType: 'image/jpeg', buffer: await labelPhoto(bruno) });
  await expect(bruno.getByRole('dialog', { name: 'Vérifier et ajouter' })).toBeVisible();
  await expect(bruno.getByLabel('Nom du vin')).toHaveValue('Château Labeille');
  await expect(bruno.getByLabel('Millésime', { exact: true })).toHaveClass(/uncertain/);
  await expect(bruno.getByText('À vérifier : information incertaine sur la photo')).toBeVisible();
  await shot(bruno, '04-etiquette-a-verifier');
  await bruno.getByLabel('Nom du vin').fill('Château Labeille Réserve');
  await bruno.getByRole('button', { name: 'Ajouter à ma cave' }).click();
  await toast(bruno, 'Vin ajouté');
  await expect(bruno.getByRole('heading', { name: 'Château Labeille Réserve' })).toBeVisible();
  await expect(bruno.locator('.advice-item').first()).toContainText('Estimation IA');
  await expect(bruno.locator('.wine-photo img')).toBeVisible();
});

test('prix de marché : seules les offres issues de la recherche sont retenues, avec date et source', async () => {
  await bruno.getByRole('button', { name: 'Rechercher le prix actuel' }).click();
  await bruno.getByRole('button', { name: 'Lancer la recherche' }).click();
  const dialog = bruno.getByRole('dialog', { name: 'Prix de marché actuel' });
  await expect(dialog.getByText(/61,5/).first()).toBeVisible();
  await expect(dialog.getByRole('link', { name: /Caviste exemple/ })).toBeVisible();
  await expect(dialog.getByText('Inventée')).toHaveCount(0);
  await expect(dialog.getByText(/consulté le/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Enregistrer ce relevé' }).click();
  await toast(bruno, 'Prix de marché enregistré');
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await expect(bruno.getByText(/relevé par la recherche web/)).toBeVisible();
});

let inviteCode = '';

test('invitation d’un ami par lien : accepter, puis partage sélectif', async () => {
  await goto(bruno, '/amis');
  await bruno.getByRole('button', { name: 'Créer un lien d’invitation' }).click();
  inviteCode = (await bruno.locator('.kbd-code').innerText()).replace(/-/g, '');
  expect(inviteCode).toMatch(/^[A-Z2-9]{10}$/);
  await bruno.getByRole('dialog').getByRole('button', { name: 'Fermer' }).click();

  await signUp(claire, 'Claire', `/#/ami/${inviteCode}`);
  await expect(claire.getByRole('heading', { name: /Bruno vous invite/ })).toBeVisible();
  await claire.getByRole('button', { name: 'Accepter' }).click();
  await expect(claire.getByText('Vous êtes maintenant amis avec Bruno')).toBeVisible();

  // Claire voit le lot « proposable » de Bruno, sans son prix ; jamais le vin privé.
  await goto(claire, '/amis');
  const shared = claire.locator('.row').filter({ hasText: 'Château Test' });
  await expect(shared).toBeVisible();
  await expect(shared).toContainText('3');
  await expect(shared).not.toContainText('30');
  await expect(claire.getByText('Château Labeille')).toHaveCount(0);
  await shot(claire, '05-cave-partagee');
});

test('événement : suggestion d’un ami, confirmation par le propriétaire, réservation, annulation', async () => {
  // Claire vient d'accepter l'invitation sur son téléphone : Bruno rouvre l'application.
  await bruno.reload();
  await goto(bruno, '/evenements');
  await bruno.getByRole('button', { name: 'Organiser un événement' }).click();
  await bruno.getByLabel('Titre').fill('Dîner test');
  await bruno.getByLabel(/Claire/).check();
  await bruno.getByRole('button', { name: 'Créer' }).click();
  await toast(bruno, 'Événement créé');
  await expect(bruno.getByRole('heading', { name: 'Dîner test' })).toBeVisible();
  const eventUrl = bruno.url();

  // Claire répond et suggère la bouteille proposable de Bruno.
  await claire.goto(eventUrl.replace(/^.*#/, '/#'));
  await claire.getByRole('button', { name: 'Je viens' }).click();
  await toast(claire, 'Réponse enregistrée');
  await claire.getByRole('button', { name: 'Suggérer une bouteille d’un ami' }).click();
  await claire.getByRole('dialog').getByText('Château Test').click();
  await claire.getByRole('dialog').getByRole('textbox', { name: 'Nombre de bouteilles', exact: true }).fill('2');
  await claire.getByRole('dialog').getByRole('button', { name: 'Suggérer' }).click();
  await toast(claire, /Suggestion envoyée/);
  await expect(claire.getByText('En attente de Bruno')).toBeVisible();

  // Une seconde suggestion du même lot est refusée (pas de doublon).
  await claire.getByRole('button', { name: 'Suggérer une bouteille d’un ami' }).click();
  await claire.getByRole('dialog').getByText('Château Test').click();
  await claire.getByRole('dialog').getByRole('button', { name: 'Suggérer' }).click();
  await toast(claire, 'déjà proposée');
  await claire.getByRole('dialog').getByRole('button', { name: 'Fermer' }).click();

  // Bruno confirme : 2 bouteilles réservées, toujours dans son stock.
  await bruno.reload();
  await bruno.getByRole('button', { name: 'Je l’apporte' }).click();
  await expect(bruno.getByText('Disponibles dans ce lot : 3')).toBeVisible();
  await bruno.getByRole('button', { name: 'Confirmer et réserver' }).click();
  await toast(bruno, 'Bouteille confirmée et réservée');
  await expect(bruno.getByText('Confirmée, réservée')).toBeVisible();
  await shot(bruno, '06-evenement');

  await goto(bruno, '/cave');
  await bruno.locator('.row').filter({ hasText: 'Château Test' }).click();
  expect(await tile(bruno, /en stock/)).toBe(9);
  expect(await tile(bruno, /réservée/)).toBe(2);
  expect(await tile(bruno, /disponible/)).toBe(7);

  // Annulation : les réservations sont libérées.
  await bruno.goto(eventUrl.replace(/^.*#/, '/#'));
  await bruno.getByRole('button', { name: 'Annuler l’événement' }).click();
  await bruno.getByRole('alertdialog').getByRole('button', { name: 'Annuler l’événement' }).click();
  await toast(bruno, 'réservations libérées');
  await goto(bruno, '/cave');
  await bruno.locator('.row').filter({ hasText: 'Château Test' }).click();
  expect(await tile(bruno, /réservée/)).toBe(0);
  expect(await tile(bruno, /disponible/)).toBe(9);
});

test('après l’événement : consommation confirmée une seule fois, souvenirs partagés', async () => {
  await goto(bruno, '/evenements');
  await bruno.getByRole('button', { name: 'Organiser un événement' }).click();
  await bruno.getByLabel('Titre').fill('Dégustation passée');
  const past = new Date(Date.now() - 2 * 3600_000);
  const local = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .format(past)
    .replace(' ', 'T');
  await bruno.getByLabel('Date et heure').fill(local);
  await bruno.getByLabel(/Claire/).check();
  await bruno.getByRole('button', { name: 'Créer' }).click();
  await toast(bruno, 'Événement créé');
  const eventUrl = bruno.url();

  await bruno.getByRole('button', { name: 'Proposer une de mes bouteilles' }).click();
  const dialog = bruno.getByRole('dialog');
  const lotValue = await dialog.locator('option', { hasText: 'Château Test 2018 — 6 dispo' }).getAttribute('value');
  await dialog.getByRole('combobox').selectOption(lotValue!);
  await dialog.getByRole('button', { name: 'Je l’apporte' }).click();
  await toast(bruno, 'réservée');

  await bruno.getByRole('button', { name: 'Marquer l’événement comme passé' }).click();
  await bruno.getByRole('alertdialog').getByRole('button', { name: 'Oui, c’est passé' }).click();
  await toast(bruno, 'passé');
  await bruno.getByRole('button', { name: 'Indiquer ce qui a été bu' }).click();
  await bruno.getByRole('dialog').getByRole('button', { name: 'Confirmer' }).click();
  await toast(bruno, 'Stock mis à jour');
  await expect(bruno.getByText('Bue : 1')).toBeVisible();
  await expect(bruno.getByRole('button', { name: 'Indiquer ce qui a été bu' })).toHaveCount(0);

  // Souvenir partagé avec les participants.
  await bruno.getByRole('button', { name: 'Noter un vin de la soirée' }).click();
  const form = bruno.getByRole('dialog', { name: 'Nouvelle dégustation' });
  await form.getByLabel('Vin de la soirée').selectOption({ index: 1 });
  await form.getByRole('button', { name: '5 sur 5' }).click();
  await form.getByLabel('Commentaire').fill('Superbe avec le fromage');
  await form.getByLabel(/Partager cette note/).check();
  await form.getByRole('button', { name: 'Enregistrer' }).click();
  await toast(bruno, 'Dégustation enregistrée');

  await claire.goto(eventUrl.replace(/^.*#/, '/#'));
  await expect(claire.getByText('Superbe avec le fromage')).toBeVisible();

  // Le stock n'a baissé qu'une fois.
  await goto(bruno, '/cave');
  await bruno.locator('.row').filter({ hasText: 'Château Test' }).click();
  expect(await tile(bruno, /en stock/)).toBe(8);
  await bruno.reload();
  expect(await tile(bruno, /en stock/)).toBe(8);
});

test('dégustation au restaurant : le stock ne change pas', async () => {
  await goto(bruno, '/carnet');
  await bruno.getByRole('button', { name: 'Noter une dégustation' }).click();
  const form = bruno.getByRole('dialog', { name: 'Nouvelle dégustation' });
  await form.getByLabel('Vin', { exact: true }).fill('Pouilly-Fumé');
  await form.getByRole('button', { name: '4 sur 5' }).click();
  await form.getByRole('group', { name: 'Occasion' }).getByRole('button', { name: 'Restaurant' }).click();
  await form.getByRole('button', { name: 'Enregistrer' }).click();
  await toast(bruno, 'Dégustation enregistrée');
  await expect(bruno.getByRole('heading', { name: /Pouilly-Fumé/ })).toBeVisible();
  await goto(bruno, '/');
  await expect(bruno.locator('.hero')).toContainText('bouteilles en cave');
  await goto(bruno, '/cave');
  await expect(bruno.locator('.row').filter({ hasText: 'Château Test' })).toContainText('8');
});

test('assistant : réponse fondée sur la cave, action confirmée par la personne', async () => {
  await goto(bruno, '/assistant');
  await bruno.getByRole('button', { name: 'Quel vin de ma cave ouvrir avec un magret de canard ?' }).click();
  await expect(bruno.locator('.bubble.assistant').last()).toContainText('D’après votre cave');
  await shot(bruno, '07-assistant');

  await bruno.getByLabel('Votre question à l’assistant').fill('J’ai bu une bouteille hier, propose la sortie');
  await bruno.getByRole('button', { name: 'Envoyer' }).click();
  const card = bruno.locator('.action-card').last();
  await expect(card).toContainText('Enregistrer la sortie de 1 bouteille');
  // Rien n'est fait avant la confirmation.
  await goto(bruno, '/');
  const before = await tile(bruno, /bouteilles en stock/);
  await bruno.goBack();
  await bruno.locator('.action-card').last().getByRole('button', { name: 'Confirmer' }).click();
  await toast(bruno, 'Sortie enregistrée');
  await expect(bruno.locator('.action-card').last()).toContainText('Fait');
  await goto(bruno, '/');
  await expect.poll(() => tile(bruno, /bouteilles en stock/)).toBe(before - 1);
});

test('administration : test de connexion sans afficher la clé, quota atteint, fonctions manuelles intactes', async () => {
  await goto(bruno, '/admin');
  await bruno.getByRole('button', { name: 'Tester la connexion' }).click();
  await expect(bruno.getByText(/Connexion réussie/)).toBeVisible();
  expect(await bruno.content()).not.toContain('sk-ant');
  await shot(bruno, '08-administration');

  await bruno.getByLabel('Demandes par jour et par personne').fill('0');
  await bruno.getByRole('button', { name: 'Enregistrer les réglages' }).click();
  await toast(bruno, 'Réglages enregistrés');

  await goto(claire, '/assistant');
  await claire.reload();
  await expect(claire.getByText(/nombre de demandes à l’assistant pour aujourd’hui/).first()).toBeVisible();
  // Le reste fonctionne : Claire ajoute un vin à sa cave.
  await goto(claire, '/');
  await claire.getByRole('button', { name: /Saisir un vin/ }).first().click();
  await claire.getByLabel('Nom du vin').fill('Vin de Claire');
  await claire.getByRole('button', { name: 'Ajouter à ma cave' }).click();
  await toast(claire, 'Vin ajouté');

  await goto(bruno, '/admin');
  await bruno.getByLabel('Demandes par jour et par personne').fill('30');
  await bruno.getByRole('button', { name: 'Enregistrer les réglages' }).click();
  await toast(bruno, 'Réglages enregistrés');
});

test('supprimer la connexion retire immédiatement l’accès à la cave partagée', async () => {
  await goto(bruno, '/amis');
  await bruno.getByRole('button', { name: 'Supprimer la connexion avec Claire' }).click();
  await bruno.getByRole('alertdialog').getByRole('button', { name: 'Supprimer la connexion' }).click();
  await toast(bruno, 'Connexion supprimée');
  await claire.reload();
  await goto(claire, '/amis');
  await expect(claire.getByText('Pas encore d’amis connectés')).toBeVisible();
  await expect(claire.getByText('Château Test')).toHaveCount(0);
});

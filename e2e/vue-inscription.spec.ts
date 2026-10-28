import { expect, test, type Page } from '@playwright/test';
import { confirmAge, PASSWORD, RUN } from './helpers';

// Fichier nommé « vue-… » pour passer après parcours.spec.ts : le premier compte créé devient administrateur.
// Le serveur local de test (--confirm-email-test) demande la confirmation de l'adresse pour les @confirmation.test,
// comme Supabase en ligne, et donne le jeton du dernier lien « envoyé ».
const API = 'http://127.0.0.1:54399';
const address = (name: string) => `${name.toLowerCase()}.${RUN}@confirmation.test`;
const signupToken = async (page: Page, mail: string) =>
  ((await (await page.request.get(`${API}/__test/signup-token?email=${encodeURIComponent(mail)}`)).json()) as { token: string | null }).token;
const ageSignupMail = (page: Page, mail: string) => page.request.get(`${API}/__test/age-signup?email=${encodeURIComponent(mail)}`);

async function fillSignup(page: Page, name: string, mail: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Créer un compte' }).click();
  await page.getByLabel('Votre prénom').fill(name);
  await page.getByLabel('Adresse e-mail').fill(mail);
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await confirmAge(page);
}

test.describe('inscription : page de confirmation de l’adresse', () => {
  test('inscription réussie sur téléphone : page dédiée, adresse masquée, renvoi avec délai, retour à la connexion', async ({ page }) => {
    await page.clock.install();
    const mail = address('Lucie');
    await fillSignup(page, 'Lucie', mail);
    await page.getByRole('button', { name: 'Créer mon compte' }).click();

    // Le formulaire laisse place à la page de confirmation.
    await expect(page.getByRole('heading', { level: 1, name: 'Bienvenue sur Cave & Amis ! 🍷' })).toBeVisible();
    await expect(page.getByLabel('Votre prénom')).toHaveCount(0);
    await expect(page.getByText('Merci pour votre inscription !')).toBeVisible();
    await expect(page.getByText('Un e-mail de confirmation vient de vous être envoyé.', { exact: false })).toBeVisible();
    await expect(page.getByText(`lu•••••${RUN.slice(-1)}@confirmation.test`)).toBeVisible();
    await expect(page.getByText(mail)).toHaveCount(0);
    await expect(page.getByText('consultez vos courriers indésirables (spams)', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: /Renvoyer l’e-mail de confirmation \(\d+ s\)/ })).toBeDisabled();
    expect(await signupToken(page, mail)).toBeTruthy();
    await page.screenshot({ path: 'reports/screens/50-inscription-email-envoye.png' });

    // Délai de l'appareil écoulé, mais le serveur refuse encore : son délai est repris.
    await page.clock.fastForward(61_000);
    const resend = page.getByRole('button', { name: 'Renvoyer l’e-mail de confirmation', exact: true });
    await expect(resend).toBeEnabled();
    await resend.click();
    await expect(page.getByText(/Par sécurité, patientez \d+ s avant d’en demander un autre/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Renvoyer l’e-mail de confirmation \(\d+ s\)/ })).toBeDisabled();

    // Délai écoulé des deux côtés : nouvel envoi, l'ancien lien ne sert plus.
    const first = await signupToken(page, mail);
    await ageSignupMail(page, mail);
    await page.clock.fastForward(61_000);
    await page.getByRole('button', { name: 'Renvoyer l’e-mail de confirmation', exact: true }).click();
    await expect(page.getByText('Nouvel e-mail demandé', { exact: false })).toBeVisible();
    expect(await signupToken(page, mail)).not.toBe(first);
    await expect(page.getByRole('button', { name: /Renvoyer l’e-mail de confirmation \(\d+ s\)/ })).toBeDisabled();
    await page.screenshot({ path: 'reports/screens/51-inscription-renvoi.png' });

    // Retour à la connexion : tant que l'adresse n'est pas confirmée, la connexion l'explique et propose un nouveau lien.
    await page.getByRole('button', { name: 'Retour à la connexion' }).click();
    await page.getByLabel('Adresse e-mail').fill(mail);
    await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Se connecter' }).last().click();
    await expect(page.getByText('Confirmez d’abord votre adresse e-mail', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Recevoir un nouveau lien de confirmation' })).toBeVisible();
  });

  test('confirmation réussie : le lien connecte et souhaite la bienvenue ; rouvert, il est expliqué comme expiré', async ({ page }) => {
    const mail = address('Hugo');
    await fillSignup(page, 'Hugo', mail);
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await expect(page.getByText('Merci pour votre inscription !')).toBeVisible();
    const token = await signupToken(page, mail);

    await page.goto(`/?auth=signup&token_hash=${token}`);
    await expect(page.getByText('Adresse e-mail confirmée. Bienvenue sur Cave & Amis, Hugo ! 🍷')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Bienvenue sur Cave & Amis ! 🍷' })).toBeVisible();
    await page.screenshot({ path: 'reports/screens/52-inscription-confirmee.png' });
    expect(page.url()).not.toContain('token_hash');

    // Même lien, sur un autre appareil : déjà utilisé.
    const other = await page.context().browser()!.newPage({ baseURL: new URL(page.url()).origin, viewport: { width: 390, height: 844 } });
    await other.goto(`/?auth=signup&token_hash=${token}`);
    await expect(other.getByText('Ce lien de confirmation n’est plus valable', { exact: false })).toBeVisible();
    await other.screenshot({ path: 'reports/screens/53-inscription-lien-expire.png' });
    await other.close();
  });

  test('adresse déjà inscrite : même page, sans dire que le compte existe', async ({ page }) => {
    const mail = address('Nina');
    await fillSignup(page, 'Nina', mail);
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await page.goto(`/?auth=signup&token_hash=${await signupToken(page, mail)}`);
    await expect(page.getByText('Adresse e-mail confirmée', { exact: false })).toBeVisible();

    const visitor = await page.context().browser()!.newPage({ baseURL: new URL(page.url()).origin, viewport: { width: 390, height: 844 } });
    await fillSignup(visitor, 'Quelqu’un', mail);
    await visitor.getByRole('button', { name: 'Créer mon compte' }).click();
    await expect(visitor.getByText('Merci pour votre inscription !')).toBeVisible();
    await expect(visitor.getByText('Si un compte existe déjà avec cette adresse, aucun nouvel e-mail n’est envoyé', { exact: false })).toBeVisible();
    await expect(visitor.getByText(/existe déjà\. Connectez-vous plutôt/)).toHaveCount(0);
    await visitor.close();
  });

  test('erreur réseau à l’inscription : message clair, le formulaire reste rempli', async ({ page }) => {
    const mail = address('Omar');
    await fillSignup(page, 'Omar', mail);
    await page.route('**/auth/v1/signup**', (route) => route.abort('internetdisconnected'));
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Connexion impossible' })).toBeVisible();
    await expect(page.getByLabel('Adresse e-mail')).toHaveValue(mail);
    await expect(page.getByText('Merci pour votre inscription !')).toHaveCount(0);
    await page.unroute('**/auth/v1/signup**');
    // Réseau revenu : la même saisie aboutit.
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await expect(page.getByText('Merci pour votre inscription !')).toBeVisible();
  });
});

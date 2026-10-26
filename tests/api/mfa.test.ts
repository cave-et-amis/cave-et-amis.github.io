import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { base32Decode, base32Encode, totpCode, totpValid } from '../../server/local/totp.ts';
import { Api } from '../../src/data/api.ts';
import { toMessage } from '../../src/domain/errors.ts';
import { qrModules } from '../../src/ui/QrCode.tsx';
import { makeEnv, type Env } from '../helpers/env.ts';
import { totp, wrongTotp } from '../helpers/totp.ts';

let env: Env;

beforeEach(async () => {
  env = await makeEnv();
});

/** Compte connecté et son Api, avec le client à part qui vérifie le mot de passe, comme dans l'application. */
async function account(name: string) {
  const a = await env.signUp(name);
  return { ...a, api: new Api(a.sb, () => env.client()) };
}
type Account = Awaited<ReturnType<typeof account>>;

/** Nouvelle connexion par le mot de passe seul (autre appareil, ou après une déconnexion). */
async function signIn(a: Account) {
  const sb = env.client();
  const { error } = await sb.auth.signInWithPassword({ email: a.email, password: a.password });
  if (error) throw error;
  return { sb, api: new Api(sb, () => env.client()) };
}

/** Activation comme dans Réglages : nouveau code, puis premier code à 6 chiffres. */
async function activate(a: Account) {
  const e = await a.api.mfaEnroll();
  await a.api.mfaVerify(e.id, totp(e.secret));
  return e;
}

const token = async (sb: SupabaseClient) => (await sb.auth.getSession()).data.session!.access_token;
/** Contenu du jeton en cours : niveau (aal) et méthodes de connexion (amr). */
const claims = async (sb: SupabaseClient) => JSON.parse(Buffer.from((await token(sb)).split('.')[1], 'base64url').toString('utf8'));
/** Niveau tel que supabase-js le calcule d'après la session gardée. */
const level = async (sb: SupabaseClient) => (await sb.auth.mfa.getAuthenticatorAssuranceLevel()).data;
const factorRows = async (userId: string) =>
  (await env.db.query(`select id, status from auth.mfa_factors where user_id = $1 order by created_at`, [userId])).rows;

/** Code de l'erreur attendue : serveur de connexion, Api, ou message de la base (P0001). */
async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return err.code === 'P0001' ? err.message : err.code;
  }
  throw new Error('Une erreur était attendue');
}
const authCode = async (p: Promise<{ error: { code?: string } | null }>) => (await p).error?.code;

/** Lit le QR code que dessine l'application (src/ui/QrCode.tsx), comme l'appareil photo d'un téléphone. */
async function readQr(text: string) {
  const wasm = readFileSync(createRequire(import.meta.url).resolve('zxing-wasm/reader/zxing_reader.wasm'));
  prepareZXingModule({ overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer } });
  const { size, path } = qrModules(text);
  const dark = new Set([...path.matchAll(/M(\d+),(\d+)/g)].map((m) => `${m[1]},${m[2]}`));
  // Marge blanche de 4 cases, 4 pixels par case.
  const width = (size + 8) * 4;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let y = 0; y < width; y++)
    for (let x = 0; x < width; x++) if (dark.has(`${Math.floor(x / 4) - 4},${Math.floor(y / 4) - 4}`)) data.set([0, 0, 0], (y * width + x) * 4);
  const found = await readBarcodes({ data, width, height: width, colorSpace: 'srgb' } as unknown as ImageData, { formats: ['QRCode'] });
  return found.map((f) => f.text);
}

describe('codes TOTP du serveur local (RFC 6238)', () => {
  it('mêmes codes que les exemples de la RFC, clés base32, tolérance d’un pas de 30 secondes', async () => {
    // Clé des exemples de la RFC 6238 (annexe B), codes ramenés à 6 chiffres.
    const rfc = base32Encode(new TextEncoder().encode('12345678901234567890'));
    expect(rfc).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode('gezd gnbv-gy3t qojq GEZDGNBVGY3TQOJQ')).toEqual(new TextEncoder().encode('12345678901234567890'));
    const examples: [number, string][] = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
      [20000000000, '353130'],
    ];
    for (const [t, code] of examples) {
      expect(await totpCode(rfc, t)).toBe(code);
      expect(totp(rfc, t * 1000)).toBe(code);
    }
    const t = 1_800_000_000;
    for (const shift of [-30, 0, 30]) expect(await totpValid(rfc, totp(rfc, (t + shift) * 1000), t)).toBe(true);
    for (const shift of [-90, 90]) expect(await totpValid(rfc, totp(rfc, (t + shift) * 1000), t)).toBe(false);
    expect(await totpValid(rfc, '12345', t)).toBe(false);
  });
});

describe('double authentification de l’administrateur', () => {
  it('activation : clé, adresse otpauth:// et QR code de l’application ; mauvais code refusé ; premier code juste : session aal2', async () => {
    const bruno = await account('Bruno'); // premier compte : administrateur
    expect(await bruno.api.mfaFactor()).toBeNull();
    const first = await bruno.api.mfaEnroll();
    expect(first.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(first.uri).toBe(
      `otpauth://totp/Cave%20%26%20Amis:${encodeURIComponent(bruno.email)}?secret=${first.secret}&issuer=Cave%20%26%20Amis&algorithm=SHA1&digits=6&period=30`,
    );
    // Le QR code affiché contient exactement cette adresse.
    expect(await readQr(first.uri)).toEqual([first.uri]);
    // Pas encore active : ni demandée à la connexion, ni exigée par la base.
    expect(await bruno.api.mfaFactor()).toBeNull();
    expect(await bruno.api.mfaRequired(await token(bruno.sb))).toBe(false);
    // Activation recommencée : celle qui n'a pas été finie est retirée.
    const e = await bruno.api.mfaEnroll();
    expect(e.secret).not.toBe(first.secret);
    expect(await factorRows(bruno.id)).toEqual([{ id: e.id, status: 'unverified' }]);

    const wrong = await bruno.api.mfaVerify(e.id, wrongTotp(e.secret)).catch((x: unknown) => x);
    expect((wrong as { code?: string }).code).toBe('mfa_verification_failed');
    expect(toMessage(wrong)).toMatch(/^Code incorrect/);
    expect(await level(bruno.sb)).toMatchObject({ currentLevel: 'aal1', nextLevel: 'aal1' });

    await bruno.api.mfaVerify(e.id, totp(e.secret));
    expect(await level(bruno.sb)).toMatchObject({ currentLevel: 'aal2', nextLevel: 'aal2' });
    expect(await claims(bruno.sb)).toMatchObject({ aal: 'aal2', amr: [{ method: 'totp' }, { method: 'password' }] });
    expect(await bruno.api.mfaFactor()).toMatchObject({ id: e.id });
    expect(await factorRows(bruno.id)).toEqual([{ id: e.id, status: 'verified' }]);
    expect(await bruno.api.mfaRequired(await token(bruno.sb))).toBe(false);
    // Le jeton rafraîchi garde son niveau.
    await bruno.sb.auth.refreshSession();
    expect(await claims(bruno.sb)).toMatchObject({ aal: 'aal2' });
  });

  it('connexion : le mot de passe seul (aal1) ne suffit plus, même pour une session reprise ; code faux, incomplet ou défi réutilisé refusés', async () => {
    const bruno = await account('Bruno');
    const e = await activate(bruno);
    const phone = await signIn(bruno);
    expect(await level(phone.sb)).toMatchObject({ currentLevel: 'aal1', nextLevel: 'aal2' });
    expect(await claims(phone.sb)).toMatchObject({ aal: 'aal1', amr: [{ method: 'password' }] });
    expect(await phone.api.mfaRequired(await token(phone.sb))).toBe(true);

    // Session reprise au lancement (jetons gardés par l'appareil), puis rafraîchie : le code reste demandé.
    const { data } = await phone.sb.auth.getSession();
    const resumed = env.client();
    await resumed.auth.setSession({ access_token: data.session!.access_token, refresh_token: data.session!.refresh_token });
    expect(await new Api(resumed).mfaRequired(await token(resumed))).toBe(true);
    await resumed.auth.refreshSession();
    expect(await claims(resumed)).toMatchObject({ aal: 'aal1' });
    expect(await new Api(resumed).mfaRequired(await token(resumed))).toBe(true);

    expect(await failure(phone.api.mfaSignIn(wrongTotp(e.secret)))).toBe('mfa_verification_failed');
    expect(await failure(phone.api.mfaSignIn('12345'))).toBe('mfa_verification_failed');
    // Un défi ne sert qu'une fois, même après un code faux.
    const { data: challenge } = await phone.sb.auth.mfa.challenge({ factorId: e.id });
    expect(await authCode(phone.sb.auth.mfa.verify({ factorId: e.id, challengeId: challenge!.id, code: wrongTotp(e.secret) }))).toBe('mfa_verification_failed');
    expect(await authCode(phone.sb.auth.mfa.verify({ factorId: e.id, challengeId: challenge!.id, code: totp(e.secret) }))).toBe('mfa_challenge_expired');
    expect(await phone.api.mfaRequired(await token(phone.sb))).toBe(true);

    await phone.api.mfaSignIn(totp(e.secret));
    expect(await phone.api.mfaRequired(await token(phone.sb))).toBe(false);
    expect(await claims(phone.sb)).toMatchObject({ aal: 'aal2', amr: [{ method: 'totp' }, { method: 'password' }] });
  });

  it('code activé depuis un autre appareil : relu sur le serveur, il est demandé ici aussi', async () => {
    const bruno = await account('Bruno');
    const tablet = await signIn(bruno);
    await activate(bruno);
    // La session gardée par la tablette ne connaît pas encore le code ; le serveur, si.
    expect(await tablet.api.mfaRequired()).toBe(false);
    expect(await tablet.api.mfaRequired(await token(tablet.sb))).toBe(true);
  });

  it('documents légaux et administration : refusés avec le seul mot de passe (mfa_required), acceptés après le code', async () => {
    const bruno = await account('Bruno');
    const e = await activate(bruno);
    const phone = await signIn(bruno);
    const publish = (api: Api) => api.adminLegalPublish('mentions', 'Mentions légales', '## Éditeur\n\nTexte de test.', '', false);
    expect(await failure(publish(phone.api))).toBe('mfa_required');
    expect(await failure(phone.api.adminOverview())).toBe('mfa_required');
    expect(await failure(phone.api.adminUpdateSettings({ alert_pct: 70 }))).toBe('mfa_required');
    expect(toMessage(await publish(phone.api).catch((x: unknown) => x))).toMatch(/code de double authentification/);

    await phone.api.mfaSignIn(totp(e.secret));
    expect(await publish(phone.api)).toMatch(/^[0-9a-f-]{36}$/);
    expect((await phone.api.adminOverview()).users).toHaveLength(1);
    // La session de l'activation est déjà vérifiée par le code.
    expect(await publish(bruno.api)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('retrait : refusé sans le code et pour un autre compte ; ensuite, le mot de passe suffit de nouveau', async () => {
    const bruno = await account('Bruno');
    const claire = await account('Claire');
    const e = await activate(bruno);
    const phone = await signIn(bruno);
    expect(await failure(phone.api.mfaUnenroll(e.id))).toBe('insufficient_aal');
    // Pas de second code ajouté avec le seul mot de passe.
    expect(await failure(phone.api.mfaEnroll())).toBe('insufficient_aal');
    // Le code de Bruno n'existe pas pour Claire.
    expect(await failure(claire.api.mfaUnenroll(e.id))).toBe('mfa_factor_not_found');
    expect(await failure(claire.api.mfaVerify(e.id, totp(e.secret)))).toBe('mfa_factor_not_found');
    expect(await factorRows(bruno.id)).toEqual([{ id: e.id, status: 'verified' }]);

    await bruno.api.mfaUnenroll(e.id);
    expect(await bruno.api.mfaFactor()).toBeNull();
    expect(await factorRows(bruno.id)).toEqual([]);
    const later = await signIn(bruno);
    expect(await level(later.sb)).toMatchObject({ currentLevel: 'aal1', nextLevel: 'aal1' });
    expect(await later.api.mfaRequired(await token(later.sb))).toBe(false);
    expect(await later.api.adminLegalPublish('cookies', 'Cookies', 'Texte de test.', '', false)).toMatch(/^[0-9a-f-]{36}$/);
    // La session vérifiée par le code retiré redescend au niveau du mot de passe à son rafraîchissement.
    await bruno.sb.auth.refreshSession();
    expect(await claims(bruno.sb)).toMatchObject({ aal: 'aal1' });
  });

  it('changer de mot de passe : le mot de passe actuel est vérifié à part, la session vérifiée par le code reste', async () => {
    const bruno = await account('Bruno');
    await activate(bruno);
    await bruno.api.verifyPassword(bruno.password);
    expect(await claims(bruno.sb)).toMatchObject({ aal: 'aal2' });
    await bruno.api.updatePassword('nouveau-mot-de-passe-2026', bruno.password);
    expect(await failure(bruno.api.verifyPassword(bruno.password))).toBe('invalid_password');
    // Vérification par-dessus la session (sans client à part) : session redescendue en aal1, changement refusé.
    const direct = new Api(bruno.sb);
    await direct.verifyPassword('nouveau-mot-de-passe-2026');
    expect(await claims(bruno.sb)).toMatchObject({ aal: 'aal1' });
    expect(await failure(direct.updatePassword('encore-un-autre-2026', 'nouveau-mot-de-passe-2026'))).toBe('insufficient_aal');
  });
});

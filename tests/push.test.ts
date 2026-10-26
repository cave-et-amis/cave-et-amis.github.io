import { describe, expect, it } from 'vitest';
import { b64u, encryptPush, fromB64u, generateVapidKeys, pushEndpointAllowed, vapidAuthorization, type PushSteps } from '../server/api/push.ts';
import { notificationText } from '../src/domain/notifications.ts';
import { decryptPush, makeDevice, verifyVapid } from './helpers/push.ts';

/** Exemple de la RFC 8291 (section 5 et annexe A), valeurs en base64url. */
const RFC = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  ecdh: 'kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs',
  prkKey: 'Snr3JMxaHVDXHWJn5wdC52WjpCtd2EIEGBykDcZW32k',
  ikm: 'S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg',
  prk: '09_eUZGrsvxChDCGRCdkLiDXrReGOEVeSCdCcPBSJSc',
  cek: 'oIhVW04MRdy2XN9CiKLxTg',
  nonce: '4h_95klXJ5E_qnoN',
  message:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

/** Clé privée ECDH P-256 à partir de sa clé publique « brute » (65 octets) et de son scalaire. */
function ecdhPrivate(publicB64: string, privateB64: string) {
  const pub = fromB64u(publicB64);
  return crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: privateB64 }, { name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveBits',
  ]);
}

describe('chiffrement Web Push (RFC 8291)', () => {
  it('reproduit octet pour octet l’exemple de la RFC, étapes intermédiaires comprises', async () => {
    let steps: PushSteps | null = null;
    const body = await encryptPush(fromB64u(RFC.plaintext), fromB64u(RFC.uaPublic), fromB64u(RFC.auth), {
      salt: fromB64u(RFC.salt),
      sender: { privateKey: await ecdhPrivate(RFC.asPublic, RFC.asPrivate), publicRaw: fromB64u(RFC.asPublic) },
      steps: (s) => (steps = s),
    });
    const s = steps as unknown as PushSteps;
    expect(b64u(s.ecdh)).toBe(RFC.ecdh);
    expect(b64u(s.prkKey)).toBe(RFC.prkKey);
    expect(b64u(s.ikm)).toBe(RFC.ikm);
    expect(b64u(s.prk)).toBe(RFC.prk);
    expect(b64u(s.cek)).toBe(RFC.cek);
    expect(b64u(s.nonce)).toBe(RFC.nonce);
    expect(b64u(body)).toBe(RFC.message);
  });

  it('un message chiffré pour un appareil ne se lit qu’avec ses clés ; deux envois ne se ressemblent pas', async () => {
    const device = await makeDevice('https://fcm.googleapis.com/fcm/send/essai');
    const other = await makeDevice('https://fcm.googleapis.com/fcm/send/autre');
    const text = JSON.stringify({ title: 'Cave & Amis', body: 'Claire vous a ouvert sa cave', url: '#/amis' });
    const a = await encryptPush(new TextEncoder().encode(text), fromB64u(device.p256dh), fromB64u(device.auth));
    const b = await encryptPush(new TextEncoder().encode(text), fromB64u(device.p256dh), fromB64u(device.auth));
    expect(await device.decrypt(a)).toBe(text);
    expect(await device.decrypt(b)).toBe(text);
    expect(b64u(a)).not.toBe(b64u(b));
    await expect(other.decrypt(a)).rejects.toThrow();
    // Le déchiffrement de test est lui-même vérifié sur l'exemple de la RFC.
    const uaPrivate = await ecdhPrivate(RFC.uaPublic, RFC.uaPrivate);
    expect(await decryptPush(fromB64u(RFC.message), uaPrivate, fromB64u(RFC.uaPublic), fromB64u(RFC.auth))).toBe('When I grow up, I want to be a watermelon');
  });
});

describe('identification du serveur (VAPID, RFC 8292)', () => {
  it('jeton ES256 signé par la clé du serveur, pour le service de l’abonnement, valable moins de 24 heures', async () => {
    const keys = await generateVapidKeys();
    expect(keys.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
    const now = new Date('2026-10-25T18:00:00Z');
    const header = await vapidAuthorization('https://web.push.apple.com/QGuQyavXutnMH8/abc', keys, 'https://cave-et-amis.github.io', now);
    const v = await verifyVapid(header);
    expect(v.valid).toBe(true);
    expect(v.publicKey).toBe(keys.publicKey);
    expect(v.header).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(v.claims.aud).toBe('https://web.push.apple.com');
    expect(v.claims.sub).toBe('https://cave-et-amis.github.io');
    const t = now.getTime() / 1000;
    expect(v.claims.exp).toBeGreaterThan(t);
    expect(v.claims.exp).toBeLessThanOrEqual(t + 24 * 3600);
    // Signé par une autre clé : refusé.
    const other = await generateVapidKeys();
    const forged = header.replace(/k=.*$/, `k=${other.publicKey}`);
    expect((await verifyVapid(forged)).valid).toBe(false);
  });

  it('seuls les services de notifications connus sont contactés', () => {
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://web.push.apple.com/QGuQyavXutnMH8',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
    ]) {
      expect(pushEndpointAllowed(ok), ok).toBe(true);
    }
    for (const ko of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com.exemple.test/x',
      'https://exemple.test/fcm.googleapis.com',
      'https://fcm.googleapis.com:8443/x',
      'https://moi@fcm.googleapis.com/x',
      'http://127.0.0.1:54397/push/a',
      'https://169.254.169.254/latest',
      'pas une adresse',
    ]) {
      expect(pushEndpointAllowed(ko), ko).toBe(false);
    }
    expect(pushEndpointAllowed('http://127.0.0.1:54397/push/a', 'http://127.0.0.1:54397')).toBe(true);
    expect(pushEndpointAllowed('http://127.0.0.1:54398/push/a', 'http://127.0.0.1:54397')).toBe(false);
  });
});

describe('texte des notifications', () => {
  it('chaque type a son texte et un lien interne ; un type inconnu reste lisible', () => {
    const kinds = [
      'friend_request',
      'friend_accepted',
      'event_invite',
      'group_invite',
      'group_joined',
      'cellar_invite',
      'cellar_joined',
      'invite_joined',
      'cellar_opened',
      'cellar_access_request',
      'nous_linked',
    ];
    for (const kind of kinds) {
      const t = notificationText({ kind, actor_id: '00000000-0000-0000-0000-000000000001', actor_name: 'Claire', ref_id: '00000000-0000-0000-0000-000000000002' });
      expect(t.text, kind).toContain('Claire');
      expect(t.href, kind).toMatch(/^#\/[a-z]/);
    }
    expect(notificationText({ kind: 'friend_request', actor_name: null, ref_id: null }).text).toBe('Quelqu’un souhaite être en contact avec vous');
    // Avis de liaison : le prénom vient du compte Nous ; sans prénom, la phrase reste juste.
    expect(notificationText({ kind: 'nous_linked', actor_name: 'Claire', ref_id: null })).toEqual({
      text: 'Votre compte est relié à l’agenda Nous de Claire. Ce n’est pas vous ? Déliez-le dans les Réglages.',
      href: '#/reglages',
    });
    expect(notificationText({ kind: 'nous_linked', actor_name: null, ref_id: null }).text).toBe(
      'Votre compte est relié à un agenda Nous. Ce n’est pas vous ? Déliez-le dans les Réglages.',
    );
    expect(notificationText({ kind: 'nouveau_type', actor_name: 'Claire', ref_id: null })).toEqual({ text: 'Vous avez une nouvelle notification', href: '#/notifications' });
  });
});

/**
 * Côté appareil (tests uniquement) : paire de clés et secret d'un abonnement, déchiffrement d'un message Web Push
 * (RFC 8291), écrit indépendamment du code du serveur pour le vérifier.
 */
const enc = new TextEncoder();
type Bytes = Uint8Array<ArrayBuffer>;

export const b64u = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
export const fromB64u = (text: string): Bytes => new Uint8Array(Buffer.from(text, 'base64url'));

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/** Un appareil abonné : ses clés (la privée ne quitte jamais l'appareil) et l'abonnement à donner au serveur. */
export async function makeDevice(endpoint: string) {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    endpoint,
    p256dh: b64u(publicRaw),
    auth: b64u(auth),
    decrypt: (body: Uint8Array) => decryptPush(body, pair.privateKey, publicRaw, auth),
  };
}

/** Déchiffre un message « aes128gcm » reçu par l'appareil ; renvoie le texte. */
export async function decryptPush(body: Uint8Array, uaPrivate: CryptoKey, uaPublic: Bytes, authSecret: Bytes): Promise<string> {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const as = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: as }, uaPrivate, 256));
  const keyInfo = new Uint8Array([...enc.encode('WebPush: info\0'), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cipher));
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end--;
  if (plain[end] !== 2) throw new Error('Délimiteur de fin absent');
  return new TextDecoder().decode(plain.slice(0, end));
}

/** Vérifie la signature du jeton VAPID avec la clé publique annoncée ; renvoie ses informations. */
export async function verifyVapid(authorization: string) {
  const m = /^vapid t=([^,]+), k=([A-Za-z0-9_-]+)$/.exec(authorization);
  if (!m) throw new Error(`En-tête VAPID inattendu : ${authorization}`);
  const [header, claims, signature] = m[1].split('.');
  const key = await crypto.subtle.importKey('raw', fromB64u(m[2]), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, fromB64u(signature), enc.encode(`${header}.${claims}`));
  return {
    valid,
    publicKey: m[2],
    header: JSON.parse(Buffer.from(header, 'base64url').toString()) as { typ: string; alg: string },
    claims: JSON.parse(Buffer.from(claims, 'base64url').toString()) as { aud: string; exp: number; sub: string },
  };
}

/** Faux service de notifications (Apple, Google…) : enregistre chaque envoi et répond le code choisi. */
export function createPushService(status: (url: string) => number = () => 201) {
  const received: { url: string; headers: Record<string, string>; body: Uint8Array }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    received.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()), body: new Uint8Array(init?.body as Uint8Array) });
    return new Response(null, { status: status(url) });
  }) as typeof globalThis.fetch;
  return { fetch, received };
}

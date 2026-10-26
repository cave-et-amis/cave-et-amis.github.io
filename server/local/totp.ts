/**
 * Codes de double authentification (TOTP, RFC 6238 : HMAC-SHA1, pas de 30 secondes, 6 chiffres) du serveur local, comme
 * ceux des applications d'authentification. Clés en base32 (RFC 4648, sans « = »), comme celles de Supabase.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP = 30;

export function base32Encode(bytes: Uint8Array) {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = ((value << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Espaces, tirets et minuscules acceptés (clé recopiée à la main). */
export function base32Decode(text: string) {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Clé base32 invalide');
    value = ((value << 5) | i) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/** Code valable pendant le pas de 30 secondes qui contient `unixSeconds`. */
export async function totpCode(secret: string, unixSeconds = Date.now() / 1000) {
  const counter = Math.floor(unixSeconds / TOTP_STEP);
  const message = new Uint8Array(8);
  new DataView(message.buffer).setBigUint64(0, BigInt(counter));
  const key = await crypto.subtle.importKey('raw', base32Decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
  const offset = mac[mac.length - 1] & 15;
  const bin = ((mac[offset] & 127) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

/** Tolérance d'un pas avant ou après (horloge du téléphone un peu décalée), comme Supabase. */
export async function totpValid(secret: string, code: string, unixSeconds = Date.now() / 1000) {
  if (!/^\d{6}$/.test(code)) return false;
  let ok = false;
  for (const shift of [-1, 0, 1]) if ((await totpCode(secret, unixSeconds + shift * TOTP_STEP)) === code) ok = true;
  return ok;
}

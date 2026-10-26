import { createHmac } from 'node:crypto';

/**
 * Code TOTP calculé par les tests comme par une application d'authentification (RFC 6238 : HMAC-SHA1, pas de 30 s,
 * 6 chiffres), sans le code du serveur local. `at` : instant en millisecondes.
 */
export function totp(secret: string, at = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret.replace(/\s/g, '').toUpperCase()].map((c) => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac('sha1', key).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** Un code faux à coup sûr : aucun de ceux valables autour de maintenant (deux pas avant et après). */
export function wrongTotp(secret: string, at = Date.now()) {
  const valid = new Set([-2, -1, 0, 1, 2].map((k) => totp(secret, at + k * 30_000)));
  let n = 0;
  while (valid.has(String(n).padStart(6, '0'))) n += 1;
  return String(n).padStart(6, '0');
}

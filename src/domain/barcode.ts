/** Codes-barres des bouteilles (EAN-8, UPC-A, EAN-13, GTIN-14) : chiffres seuls, chiffre de contrôle vérifié. */

/** Chiffres du code-barres s'il est valable (longueur et chiffre de contrôle), sinon null. */
export function normalizeBarcode(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const digits = String(raw).replace(/[\s-]/g, '');
  if (!/^\d+$/.test(digits) || ![8, 12, 13, 14].includes(digits.length)) return null;
  // Chiffre de contrôle GS1 : en partant de la droite (hors contrôle), poids 3 puis 1 en alternance.
  let sum = 0;
  for (let i = digits.length - 2, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += Number(digits[i]) * w;
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]) ? digits : null;
}

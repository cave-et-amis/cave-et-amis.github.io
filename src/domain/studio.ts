/**
 * Studio photo : calculs purs (sans navigateur) sur le masque de la bouteille et ses pixels.
 * Les pixels de la bouteille restent ceux de la photo : seules la luminosité, le contraste et la netteté sont
 * ajustés, uniformément sur les trois couleurs (teintes conservées). L'étiquette n'est jamais redessinée.
 */

export type StudioStyle = 'studio' | 'noir' | 'cave' | 'market';

export const STUDIO_STYLES: { id: StudioStyle; label: string; hint: string }[] = [
  { id: 'studio', label: 'Studio fond blanc', hint: 'Fond blanc, ombre douce et reflet' },
  { id: 'noir', label: 'Noir premium', hint: 'Fond noir et halo lumineux' },
  { id: 'cave', label: 'Ambiance cave', hint: 'Fond chaud et sombre, lumières floues' },
  { id: 'market', label: 'Catalogue carré', hint: 'Carré, fond blanc, pour une boutique en ligne' },
];

/**
 * Opacité (0–255) tirée du masque : en dessous de 48, c'est du fond (sinon des points du décor ressortent sur les
 * fonds sombres) ; au-dessus de 200, la bouteille ; entre les deux, une transition douce pour les bords.
 */
export function alphaFromMask(m: number) {
  return Math.max(0, Math.min(255, Math.round(((m - 48) * 255) / (200 - 48))));
}

/**
 * Ne garde que la forme principale (la bouteille) : les îlots détachés, que le modèle repère parfois à tort dans le
 * décor, sont effacés. Les pixels de bord (opacité faible) sont gardés seulement s'ils touchent la forme principale.
 */
export function keepMainShape(alpha: Uint8Array, w: number, h: number) {
  const label = new Int32Array(w * h);
  const stack: number[] = [];
  let best = 0;
  let bestSize = 0;
  let next = 0;
  for (let start = 0; start < alpha.length; start++) {
    if (alpha[start] <= 64 || label[start]) continue;
    next++;
    let size = 0;
    label[start] = next;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j >= 0 && j < alpha.length && !label[j] && alpha[j] > 64) {
          label[j] = next;
          stack.push(j);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = next;
    }
  }
  for (let i = 0; i < alpha.length; i++) {
    if (!alpha[i] || label[i] === best) continue;
    if (label[i]) {
      alpha[i] = 0;
      continue;
    }
    // Bord doux : gardé s'il touche la bouteille.
    const x = i % w;
    const near = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w].some((j) => j >= 0 && j < alpha.length && label[j] === best);
    if (!near) alpha[i] = 0;
  }
}

/** Rectangle englobant la bouteille (opacité > seuil), ou null si elle couvre moins de 1 % de l'image. */
export function maskBounds(alpha: ArrayLike<number>, w: number, h: number, threshold = 128) {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] > threshold) {
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (count < w * h * 0.01) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, count };
}

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Corrections douces sur les pixels de la bouteille (RGBA, opacité déjà posée) : niveaux de luminance
 * (0,5 % et 99,5 % ramenés vers le noir et le blanc, appliqués à moitié), puis netteté légère.
 */
export function enhanceBottle(d: Uint8ClampedArray, w: number, h: number) {
  const hist = new Uint32Array(256);
  let count = 0;
  for (let p = 0; p < d.length; p += 4) {
    if (d[p + 3] > 128) {
      hist[Math.round(luma(d[p], d[p + 1], d[p + 2]))]++;
      count++;
    }
  }
  if (!count) return;
  const pct = (q: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) if ((acc += hist[v]) >= count * q) return v;
    return 255;
  };
  const lo = pct(0.005);
  const hi = Math.max(lo + 1, pct(0.995));
  for (let p = 0; p < d.length; p += 4) {
    if (d[p + 3] === 0) continue;
    const l = luma(d[p], d[p + 1], d[p + 2]);
    if (l <= 0) continue;
    const stretched = Math.max(0, Math.min(255, ((l - lo) * 255) / (hi - lo)));
    // Éclaircissement plafonné pour qu'aucune couleur ne sature : la teinte (rapport entre couleurs) reste exacte.
    const k = Math.min((l + (stretched - l) * 0.5) / l, 255 / Math.max(d[p], d[p + 1], d[p + 2], 1));
    d[p] = d[p] * k;
    d[p + 1] = d[p + 1] * k;
    d[p + 2] = d[p + 2] * k;
  }
  sharpen(d, w, h, 0.35);
}

/** Netteté légère (masque flou en croix), sur les couleurs des pixels visibles seulement. */
export function sharpen(d: Uint8ClampedArray, w: number, h: number, amount: number) {
  const src = new Uint8ClampedArray(d);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = (y * w + x) * 4;
      if (src[p + 3] < 8) continue;
      for (let c = 0; c < 3; c++) {
        const blur = (src[p - 4 + c] + src[p + 4 + c] + src[p - w * 4 + c] + src[p + w * 4 + c] + src[p + c] * 4) / 8;
        d[p + c] = src[p + c] + (src[p + c] - blur) * amount;
      }
    }
  }
}

/** Place de la bouteille dans l'image finale (1200 × 1500, ou 1200 × 1200 pour le catalogue). */
export function layout(style: StudioStyle, bottle: { w: number; h: number }) {
  const square = style === 'market';
  const W = 1200;
  const H = square ? 1200 : 1500;
  const k = Math.min((H * (square ? 0.8 : 0.74)) / bottle.h, (W * 0.8) / bottle.w);
  const bw = bottle.w * k;
  const bh = bottle.h * k;
  const base = H * (square ? 0.9 : 0.85);
  return { W, H, bw, bh, bx: (W - bw) / 2, by: base - bh, base };
}

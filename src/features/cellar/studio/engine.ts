/**
 * Moteur du studio photo, chargé seulement quand on s'en sert (import dynamique).
 *  - Détourage : ISNet (projet DIS, Apache-2.0, version distribuée par rembg, MIT), compressé en 8 bits (46 Mo),
 *    exécuté dans le navigateur (onnxruntime-web, sans carte graphique). Rien n'est envoyé en ligne.
 *  - Le modèle est gardé dans le cache du navigateur (« cave-modeles ») : téléchargé une seule fois.
 *  - Mise en scène calculée : la bouteille garde ses pixels d'origine, seuls le fond, l'ombre et le reflet sont créés.
 */
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { alphaFromMask, enhanceBottle, keepMainShape, layout, maskBounds, type StudioStyle } from '../../../domain/studio';

export const MODEL_MB = 46;
const MODEL_URL = 'models/isnet-uint8.onnx';
const CACHE = 'cave-modeles-1';
const INPUT = 1024;
const MAX_SIDE = 1600;

ort.env.wasm.wasmPaths = { wasm: wasmUrl };
// Un seul fil de calcul : le partage de mémoire entre fils exige un isolement que GitHub Pages ne fournit pas.
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

/** Le modèle est-il déjà dans le cache du navigateur ? */
export async function modelCached() {
  try {
    return Boolean(await (await caches.open(CACHE)).match(new URL(MODEL_URL, document.baseURI).href));
  } catch {
    return false;
  }
}

async function modelBytes(onProgress: (ratio: number) => void): Promise<ArrayBuffer> {
  const url = new URL(MODEL_URL, document.baseURI).href;
  let cache: Cache | null = null;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) return hit.arrayBuffer();
  } catch {
    cache = null;
  }
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error('model_download');
  const total = Number(res.headers.get('Content-Length')) || MODEL_MB * 1024 * 1024;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.byteLength;
    onProgress(Math.min(1, loaded / total));
  }
  const bytes = new Uint8Array(loaded);
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.byteLength;
  }
  await cache?.put(url, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } })).catch(() => undefined);
  return bytes.buffer;
}

let session: Promise<ort.InferenceSession> | null = null;
function loadSession(onProgress: (ratio: number) => void) {
  if (!session) {
    session = modelBytes(onProgress).then((b) => ort.InferenceSession.create(new Uint8Array(b), { executionProviders: ['wasm'] }));
    session.catch(() => (session = null));
  }
  return session;
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!;

/** Bouteille détourée, recadrée et corrigée (fond transparent). */
export async function extractBottle(photo: Blob, onProgress: (ratio: number) => void): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(photo, { imageOrientation: 'from-image' });
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const src = canvas(bmp.width * k, bmp.height * k);
  ctx2d(src).drawImage(bmp, 0, 0, src.width, src.height);
  bmp.close?.();

  const sess = await loadSession(onProgress);
  // Entrée du modèle : 1024 × 1024, valeurs centrées (pixel / 255 − 0,5), canaux séparés.
  const small = canvas(INPUT, INPUT);
  ctx2d(small).drawImage(src, 0, 0, INPUT, INPUT);
  const px = ctx2d(small).getImageData(0, 0, INPUT, INPUT).data;
  const plane = INPUT * INPUT;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    input[i] = px[i * 4] / 255 - 0.5;
    input[plane + i] = px[i * 4 + 1] / 255 - 0.5;
    input[2 * plane + i] = px[i * 4 + 2] / 255 - 0.5;
  }
  const out = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, INPUT, INPUT]) });
  const pred = out[sess.outputNames[0]].data as Float32Array;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < plane; i++) {
    if (pred[i] < min) min = pred[i];
    if (pred[i] > max) max = pred[i];
  }
  // Masque 1024 × 1024 en niveaux de gris, agrandi à la taille de la photo (lissage du navigateur).
  const maskSmall = canvas(INPUT, INPUT);
  const mImg = ctx2d(maskSmall).createImageData(INPUT, INPUT);
  for (let i = 0; i < plane; i++) {
    const v = ((pred[i] - min) / (max - min || 1)) * 255;
    mImg.data[i * 4] = mImg.data[i * 4 + 1] = mImg.data[i * 4 + 2] = v;
    mImg.data[i * 4 + 3] = 255;
  }
  ctx2d(maskSmall).putImageData(mImg, 0, 0);
  const maskFull = canvas(src.width, src.height);
  ctx2d(maskFull).drawImage(maskSmall, 0, 0, src.width, src.height);
  const m = ctx2d(maskFull).getImageData(0, 0, src.width, src.height).data;

  const img = ctx2d(src).getImageData(0, 0, src.width, src.height);
  const alpha = new Uint8Array(src.width * src.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = alphaFromMask(m[i * 4]);
  keepMainShape(alpha, src.width, src.height);
  for (let i = 0; i < alpha.length; i++) img.data[i * 4 + 3] = alpha[i];
  const box = maskBounds(alpha, src.width, src.height);
  if (!box) throw new Error('no_bottle');
  enhanceBottle(img.data, src.width, src.height);
  ctx2d(src).putImageData(img, 0, 0);
  const pad = 2;
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  const out2 = canvas(Math.min(src.width - x, box.w + pad * 2), Math.min(src.height - y, box.h + pad * 2));
  ctx2d(out2).drawImage(src, x, y, out2.width, out2.height, 0, 0, out2.width, out2.height);
  return out2;
}

// ───────────── Mises en scène ─────────────

function silhouette(bottle: HTMLCanvasElement, color: string) {
  const c = canvas(bottle.width, bottle.height);
  const x = ctx2d(c);
  x.drawImage(bottle, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

function reflection(bottle: HTMLCanvasElement, bw: number, bh: number, strength: number) {
  const c = canvas(bw, bh * 0.35);
  const x = ctx2d(c);
  x.save();
  x.translate(0, bh);
  x.scale(1, -1);
  x.drawImage(bottle, 0, 0, bw, bh);
  x.restore();
  x.globalCompositeOperation = 'destination-in';
  const g = x.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, `rgba(0,0,0,${strength})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

const canvasBlur = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;

/** Halo flou derrière la bouteille ; sans filtre « blur » (anciens Safari) : lueur ovale en dégradé. */
function halo(x: CanvasRenderingContext2D, bottle: HTMLCanvasElement, l: ReturnType<typeof layout>, color: string) {
  x.save();
  if (canvasBlur) {
    x.filter = 'blur(46px)';
    x.drawImage(silhouette(bottle, color), l.bx - l.bw * 0.08, l.by - l.bh * 0.04, l.bw * 1.16, l.bh * 1.06);
  } else {
    x.translate(l.W / 2, l.by + l.bh / 2);
    x.scale(Math.max(0.2, l.bw / l.bh) * 1.4, 1);
    const g = x.createRadialGradient(0, 0, 0, 0, 0, l.bh * 0.62);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(-l.bh, -l.bh, l.bh * 2, l.bh * 2);
  }
  x.restore();
}

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function compose(bottle: HTMLCanvasElement, style: StudioStyle): HTMLCanvasElement {
  const l = layout(style, { w: bottle.width, h: bottle.height });
  const out = canvas(l.W, l.H);
  const x = ctx2d(out);
  const shadow = (alpha: number) => {
    x.save();
    x.translate(l.W / 2, l.base);
    x.scale(1, 0.14);
    const g = x.createRadialGradient(0, 0, 0, 0, 0, (l.bw * 0.95) / 2);
    g.addColorStop(0, `rgba(0,0,0,${alpha})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(-l.W / 2, -l.bw, l.W, l.bw * 2);
    x.restore();
  };

  if (style === 'studio' || style === 'market') {
    const g = x.createLinearGradient(0, 0, 0, l.H);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, style === 'market' ? '#ffffff' : '#eeeeee');
    x.fillStyle = g;
    x.fillRect(0, 0, l.W, l.H);
    if (style === 'studio') x.drawImage(reflection(bottle, l.bw, l.bh, 0.16), l.bx, l.base);
    shadow(style === 'market' ? 0.18 : 0.32);
  } else if (style === 'noir') {
    const g = x.createRadialGradient(l.W / 2, l.by + l.bh * 0.45, 20, l.W / 2, l.by + l.bh * 0.45, l.H * 0.75);
    g.addColorStop(0, '#3b3b3b');
    g.addColorStop(0.45, '#121212');
    g.addColorStop(1, '#000000');
    x.fillStyle = g;
    x.fillRect(0, 0, l.W, l.H);
    halo(x, bottle, l, 'rgba(255,236,214,0.30)');
    x.drawImage(reflection(bottle, l.bw, l.bh, 0.28), l.bx, l.base);
  } else {
    const g = x.createLinearGradient(0, 0, 0, l.H);
    g.addColorStop(0, '#2c1a12');
    g.addColorStop(0.7, '#170d09');
    g.addColorStop(1, '#0d0705');
    x.fillStyle = g;
    x.fillRect(0, 0, l.W, l.H);
    const rnd = seeded(7);
    for (let i = 0; i < 26; i++) {
      const cx = rnd() * l.W;
      const cy = rnd() * l.base * 0.9;
      const r = 50 + rnd() * 90;
      const color = `${200 + Math.round(rnd() * 55)},${120 + Math.round(rnd() * 60)},${50 + Math.round(rnd() * 40)}`;
      const glow = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      glow.addColorStop(0, `rgba(${color},${0.1 + rnd() * 0.12})`);
      glow.addColorStop(1, `rgba(${color},0)`);
      x.fillStyle = glow;
      x.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    const floor = x.createLinearGradient(0, l.base - 20, 0, l.H);
    floor.addColorStop(0, '#3a2416');
    floor.addColorStop(1, '#140b07');
    x.fillStyle = floor;
    x.fillRect(0, l.base - 6, l.W, l.H - l.base + 6);
    halo(x, bottle, l, 'rgba(255,190,120,0.22)');
    shadow(0.6);
    x.drawImage(reflection(bottle, l.bw, l.bh, 0.14), l.bx, l.base);
  }
  x.drawImage(bottle, l.bx, l.by, l.bw, l.bh);
  return out;
}

export function toWebp(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('image_invalid'))), 'image/webp', 0.88));
}

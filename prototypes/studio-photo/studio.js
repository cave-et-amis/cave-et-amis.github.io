// Prototype « studio photo » : détourage de la bouteille dans le navigateur (BiRefNet-lite, MIT), corrections douces,
// puis mise en scène calculée. Les pixels de la bouteille sont ceux de la photo d'origine : rien n'est redessiné,
// l'étiquette ne peut donc pas être modifiée.
import { AutoModel, AutoProcessor, RawImage, pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

// BiRefNet-lite (MIT) dépasse la mémoire du navigateur sur ce PC ; ISNet compressé (44 Mo) est essayé par défaut.
// ?modele=birefnet dans l'adresse pour réessayer BiRefNet-lite.
const ENGINE = new URLSearchParams(location.search).get('modele') === 'birefnet' ? 'birefnet' : 'isnet';
const MODEL = 'onnx-community/BiRefNet_lite-ONNX';
const ISNET = 'onnx-community/ISNet-ONNX';
const MAX_SIDE = 1600;
const STYLES = [
  { id: 'studio', label: 'Studio fond blanc' },
  { id: 'noir', label: 'Noir premium' },
  { id: 'cave', label: 'Ambiance cave' },
  { id: 'market', label: 'Marketplace (carré)' },
];

const status = document.getElementById('status');
const list = document.getElementById('list');
const say = (text, error = false) => {
  status.textContent = text;
  status.className = error ? 'error' : '';
};

// ───────────── Modèle de détourage ─────────────
let modelPromise;
function loadModel() {
  if (!modelPromise) {
    const progress = (p) => {
      if (p.status === 'progress' && p.total) say(`Téléchargement du modèle (une seule fois) : ${Math.round((p.loaded / p.total) * 100)} % de ${p.file}`);
    };
    // Calcul classique (WASM) : la carte graphique (WebGPU) échoue sur ce modèle avec des GPU aux limites modestes.
    modelPromise = (async () => {
      const t0 = performance.now();
      if (ENGINE === 'isnet') {
        const segmenter = await pipeline('background-removal', ISNET, { dtype: 'uint8', device: 'wasm', progress_callback: progress });
        say(`Modèle ISNet prêt (${Math.round((performance.now() - t0) / 1000)} s).`);
        return { segmenter };
      }
      const model = await AutoModel.from_pretrained(MODEL, { dtype: 'fp16', device: 'wasm', progress_callback: progress });
      const processor = await AutoProcessor.from_pretrained(MODEL);
      say(`Modèle prêt (${Math.round((performance.now() - t0) / 1000)} s).`);
      return { model, processor };
    })();
    modelPromise.catch(() => (modelPromise = undefined));
  }
  return modelPromise;
}

// ───────────── Outils image ─────────────
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

async function fileToCanvas(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = canvas(bmp.width * k, bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

/** Masque de la bouteille (0–255), à la taille de l'image. */
async function bottleMask(src) {
  const { model, processor, segmenter } = await loadModel();
  const blob = await new Promise((r) => src.toBlob(r, 'image/png'));
  const image = await RawImage.fromBlob(blob);
  if (segmenter) {
    // Image détourée (RGBA) : on en garde le canal alpha comme masque.
    const [cut] = await segmenter(image);
    const rgba = cut.width === src.width && cut.height === src.height ? cut : await cut.resize(src.width, src.height);
    const alpha = new Uint8Array(src.width * src.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = rgba.data[i * rgba.channels + (rgba.channels - 1)];
    return alpha;
  }
  const { pixel_values } = await processor(image);
  const { output_image } = await model({ input_image: pixel_values });
  const mask = await RawImage.fromTensor(output_image[0].sigmoid().mul(255).to('uint8')).resize(src.width, src.height);
  return mask.data; // un canal
}

/** Bouteille détourée et recadrée, avec corrections douces (niveaux sur la luminance : teintes conservées, netteté légère). */
function cutout(src, mask) {
  const w = src.width;
  const h = src.height;
  const ctx = src.getContext('2d');
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  const lum = new Uint32Array(256);
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = Math.max(0, Math.min(255, (mask[i] - 16) * 1.08));
      d[i * 4 + 3] = a;
      if (a > 128) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        lum[Math.round(0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2])] += 1;
        count += 1;
      }
    }
  }
  if (count < w * h * 0.01) throw new Error('Bouteille non trouvée sur la photo.');

  // Niveaux : 0,5 % et 99,5 % de la luminance de la bouteille ramenés vers 0 et 255, appliqués à moitié.
  const pct = (p) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) if ((acc += lum[v]) >= count * p) return v;
    return 255;
  };
  const lo = pct(0.005);
  const hi = Math.max(lo + 1, pct(0.995));
  const level = (v) => {
    const s = Math.max(0, Math.min(255, ((v - lo) * 255) / (hi - lo)));
    return v + (s - v) * 0.5;
  };
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    const l = 0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2];
    if (l <= 0) continue;
    const k = level(l) / l;
    d[p] = Math.min(255, d[p] * k);
    d[p + 1] = Math.min(255, d[p + 1] * k);
    d[p + 2] = Math.min(255, d[p + 2] * k);
  }
  sharpen(d, w, h, 0.35);
  ctx.putImageData(img, 0, 0);

  const pad = 2;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
  const out = canvas(maxX - minX + 1, maxY - minY + 1);
  out.getContext('2d').drawImage(src, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** Netteté légère (masque flou 3×3), sur les couleurs seulement. */
function sharpen(d, w, h, amount) {
  const copy = new Uint8ClampedArray(d);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = (y * w + x) * 4;
      if (copy[p + 3] < 8) continue;
      for (let c = 0; c < 3; c++) {
        const blur =
          (copy[p - 4 + c] + copy[p + 4 + c] + copy[p - w * 4 + c] + copy[p + w * 4 + c] + copy[p + c] * 4) / 8;
        d[p + c] = copy[p + c] + (copy[p + c] - blur) * amount;
      }
    }
  }
}

// ───────────── Mises en scène ─────────────
function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Silhouette colorée de la bouteille (pour halo et ombre). */
function silhouette(bottle, color) {
  const c = canvas(bottle.width, bottle.height);
  const x = c.getContext('2d');
  x.drawImage(bottle, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

/** Reflet au sol : bouteille retournée, qui s'efface vers le bas. */
function reflection(bottle, bw, bh, strength) {
  const c = canvas(bw, bh * 0.35);
  const x = c.getContext('2d');
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

function compose(bottle, style) {
  const square = style === 'market';
  const W = 1200;
  const H = square ? 1200 : 1500;
  const out = canvas(W, H);
  const x = out.getContext('2d');
  const k = Math.min((H * (square ? 0.8 : 0.74)) / bottle.height, (W * 0.8) / bottle.width);
  const bw = bottle.width * k;
  const bh = bottle.height * k;
  const bx = (W - bw) / 2;
  const base = H * (square ? 0.9 : 0.85);
  const by = base - bh;

  const shadow = (alpha, spread = 0.95) => {
    const g = x.createRadialGradient(W / 2, base, 0, W / 2, base, (bw * spread) / 2);
    g.addColorStop(0, `rgba(0,0,0,${alpha})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.save();
    x.translate(W / 2, base);
    x.scale(1, 0.14);
    x.translate(-W / 2, -base);
    x.fillStyle = g;
    x.fillRect(0, base - bw, W, bw * 2);
    x.restore();
  };
  const halo = (color, blur) => {
    x.save();
    x.filter = `blur(${blur}px)`;
    x.drawImage(silhouette(bottle, color), bx - bw * 0.08, by - bh * 0.04, bw * 1.16, bh * 1.06);
    x.restore();
  };

  if (style === 'studio' || style === 'market') {
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, style === 'market' ? '#ffffff' : '#eeeeee');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    if (style === 'studio') x.drawImage(reflection(bottle, bw, bh, 0.16), bx, base);
    shadow(style === 'market' ? 0.18 : 0.32);
  } else if (style === 'noir') {
    const g = x.createRadialGradient(W / 2, by + bh * 0.45, 20, W / 2, by + bh * 0.45, H * 0.75);
    g.addColorStop(0, '#3b3b3b');
    g.addColorStop(0.45, '#121212');
    g.addColorStop(1, '#000000');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    halo('rgba(255,236,214,0.32)', 46);
    x.drawImage(reflection(bottle, bw, bh, 0.28), bx, base);
  } else if (style === 'cave') {
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#2c1a12');
    g.addColorStop(0.7, '#170d09');
    g.addColorStop(1, '#0d0705');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    const rnd = mulberry(7);
    x.save();
    x.filter = 'blur(22px)';
    for (let i = 0; i < 26; i++) {
      const r = 30 + rnd() * 70;
      x.fillStyle = `rgba(${200 + rnd() * 55},${120 + rnd() * 60},${50 + rnd() * 40},${0.08 + rnd() * 0.12})`;
      x.beginPath();
      x.arc(rnd() * W, rnd() * base * 0.9, r, 0, Math.PI * 2);
      x.fill();
    }
    x.restore();
    const floor = x.createLinearGradient(0, base - 20, 0, H);
    floor.addColorStop(0, '#3a2416');
    floor.addColorStop(1, '#140b07');
    x.fillStyle = floor;
    x.fillRect(0, base - 6, W, H - base + 6);
    halo('rgba(255,190,120,0.22)', 40);
    shadow(0.6);
    x.drawImage(reflection(bottle, bw, bh, 0.14), bx, base);
  }
  x.drawImage(bottle, bx, by, bw, bh);
  return out;
}

// ───────────── Interface ─────────────
async function process(file) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<div class="pair"><figure><img alt="Photo d'origine"><figcaption>Original : ${file.name}</figcaption></figure>
    <figure><div class="result"></div><figcaption class="info">Détourage en cours…</figcaption></figure></div>
    <div class="styles"></div>`;
  list.prepend(card);
  card.querySelector('img').src = URL.createObjectURL(file);
  const info = card.querySelector('.info');
  try {
    const src = await fileToCanvas(file);
    const t0 = performance.now();
    const mask = await bottleMask(src);
    const t1 = performance.now();
    const bottle = cutout(src, mask);
    const holder = card.querySelector('.result');
    const buttons = card.querySelector('.styles');
    const show = (style) => {
      const t = performance.now();
      const out = compose(bottle, style.id);
      holder.replaceChildren(out);
      info.textContent = `${style.label} — détourage ${Math.round((t1 - t0) / 100) / 10} s, mise en scène ${Math.round(performance.now() - t)} ms, ${out.width}×${out.height}`;
      buttons.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === style.id)));
      out.toBlob(
        (blob) => {
          const a = buttons.querySelector('a.dl');
          a.href = URL.createObjectURL(blob);
          a.download = `${file.name.replace(/\.[^.]+$/, '')}-${style.id}.webp`;
          a.textContent = `Télécharger (WebP, ${Math.round(blob.size / 1024)} Ko)`;
        },
        'image/webp',
        0.9,
      );
    };
    for (const style of STYLES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.id = style.id;
      b.textContent = style.label;
      b.onclick = () => show(style);
      buttons.append(b);
    }
    const dl = document.createElement('a');
    dl.className = 'dl';
    buttons.append(dl);
    show(STYLES[0]);
  } catch (e) {
    info.textContent = `Échec : ${e?.message ?? String(e)}`;
    info.className = 'error';
  }
}

document.getElementById('files').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  for (const f of files) await process(f);
  say(`${files.length} photo(s) traitée(s).`);
});
say('Choisissez une photo pour commencer.');

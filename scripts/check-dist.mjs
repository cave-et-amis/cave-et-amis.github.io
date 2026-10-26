// Après `vite build` : place la configuration publique de production, puis vérifie l'export.
//  - config.production.js (s'il existe) devient dist/config.js ;
//  - aucun secret, dans TOUS les fichiers texte (.js, .mjs, .map, .svg, .html, .json…) : clé secrète Supabase
//    (sb_secret_… / jeton service_role), clé Anthropic (sk-ant-…), clé privée (PEM ou JWK), jeton GitHub ;
//  - aucun code local ou de test (faux Supabase, PGlite, faux Anthropic), aucun appel direct à l'API Anthropic.
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2] ?? 'dist';
const root = join(import.meta.dirname, '..');
const prodConfig = join(root, 'config.production.js');
if (existsSync(prodConfig)) {
  copyFileSync(prodConfig, join(dist, 'config.js'));
  console.log('config.production.js → dist/config.js');
}

// Fichiers binaires (images, polices, moteurs WebAssembly, modèles) : tous les autres sont lus comme du texte.
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|eot|wasm|onnx|ort|mp3|mp4|webm|ogg|pdf|zip|gz|br)$/i;

const problems = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else check(p, name);
  }
}

/** Clé privée au format JWK (membre « d » d'une clé EC, RSA ou OKP), écrite en JSON ou en JavaScript. */
function privateJwk(text) {
  for (const [object] of text.matchAll(/\{[^{}]{0,4000}\}/g)) {
    if (/\bkty["']?\s*:\s*["'](?:EC|RSA|OKP)["']/.test(object) && /(?:^|[{,\s])["']?d["']?\s*:\s*["'][A-Za-z0-9_-]{32,}["']/.test(object)) return true;
  }
  return false;
}

function check(path, name) {
  // Seuls .wasm admis, chargés à la demande : le moteur du studio photo (onnxruntime-web) et le lecteur de
  // codes-barres du scanner (zxing-wasm, pour les navigateurs sans lecteur intégré, comme sur iPhone).
  const studioEngine = /^ort-wasm-simd-threaded-[A-Za-z0-9_-]+\.wasm$/.test(name) || /^zxing_reader-[A-Za-z0-9_-]+\.wasm$/.test(name);
  if (/pglite|\.data$/i.test(name) || (/\.wasm$/i.test(name) && !studioEngine)) problems.push(`Fichier local ou de test inclus : ${name}`);
  if (BINARY.test(name)) return;
  const text = readFileSync(path, 'utf8');
  if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(text)) problems.push(`Clé secrète Supabase dans ${name}`);
  if (/sk-ant-[A-Za-z0-9_-]{8,}/.test(text)) problems.push(`Clé Anthropic dans ${name}`);
  for (const jwt of text.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g) ?? []) {
    try {
      const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
      if (payload.role === 'service_role') problems.push(`Jeton service_role dans ${name}`);
    } catch {
      /* pas un jeton */
    }
  }
  if (/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/.test(text)) problems.push(`Clé privée (PEM) dans ${name}`);
  if (privateJwk(text)) problems.push(`Clé privée (JWK) dans ${name}`);
  if (/\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/.test(text)) problems.push(`Jeton GitHub dans ${name}`);
  if (/createFakeSupabase|storage_local\.blobs|demo-cave-2026|mock-anthropic/.test(text)) problems.push(`Code local ou de test dans ${name}`);
  if (/api\.anthropic\.com|anthropic-version/.test(text)) problems.push(`Appel direct à l'API Anthropic dans ${name} (doit passer par le serveur)`);
}

walk(dist);
for (const required of ['index.html', 'config.js', 'sw.js', 'manifest.webmanifest', '_headers', 'asset-manifest.json', 'icon-192.png', 'icon-512.png']) {
  if (!existsSync(join(dist, required))) problems.push(`Fichier manquant : ${required}`);
}
const config = existsSync(join(dist, 'config.js')) ? readFileSync(join(dist, 'config.js'), 'utf8') : '';
const configured = /supabaseUrl:\s*'https:\/\/[^']+'/.test(config) && /supabaseKey:\s*'[^']+'/.test(config) && !/xxxxxxxx/.test(config);

if (problems.length) {
  console.error('Export refusé :\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(`Export vérifié (${dist}) : aucun secret, aucun code local ou de test.`);
console.log(
  configured
    ? 'Configuration Supabase présente dans config.js.'
    : 'À FAIRE avant la mise en ligne : renseigner l’adresse Supabase et la clé publique (config.production.js), voir docs/INSTALLATION.md.',
);

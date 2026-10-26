// Après `vite build` : place la configuration publique de production, puis vérifie l'export.
// Usage : node scripts/check-dist.mjs [dossier, dist par défaut] [configuration, config.production.js par défaut]
//  - config.production.js (s'il existe) devient dist/config.js ;
//  - aucun secret, dans TOUS les fichiers texte (.js, .mjs, .map, .svg, .html, .json…) : clé secrète Supabase
//    (sb_secret_… / jeton service_role), clé Anthropic (sk-ant-…), clé privée (PEM ou JWK), jeton GitHub ;
//  - aucun code local ou de test (faux Supabase, PGlite, faux Anthropic), aucun appel direct à l'API Anthropic ;
//  - politique de sécurité (CSP) de index.html et de _headers exactement celle prévue pour cette configuration.
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const dist = process.argv[2] ?? 'dist';
const root = join(import.meta.dirname, '..');
const prodConfig = process.argv[3] ? resolve(process.argv[3]) : join(root, 'config.production.js');
if (existsSync(prodConfig)) {
  copyFileSync(prodConfig, join(dist, 'config.js'));
  console.log(`${basename(prodConfig)} → ${join(dist, 'config.js')}`);
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
const read = (name) => (existsSync(join(dist, name)) ? readFileSync(join(dist, name), 'utf8') : '');
const config = read('config.js');
const configured = /supabaseUrl:\s*'https:\/\/[^']+'/.test(config) && /supabaseKey:\s*'[^']+'/.test(config) && !/xxxxxxxx/.test(config);

// ───────────── Politique de sécurité (CSP) ─────────────
// Configuration lue comme le site la lit (variables VITE_… d'abord, puis config.js) ; une valeur d'exemple compte comme absente.
function setting(variable, field) {
  const fromFile = new RegExp(`\\b${field}\\s*:\\s*(['"])(.*?)\\1`).exec(config.replace(/^\s*\/\/.*$/gm, ''))?.[2] ?? '';
  const value = (process.env[variable] || fromFile).trim();
  return value && !/xxxxxxxx/.test(value) ? value : null;
}
const supabaseUrl = setting('VITE_SUPABASE_URL', 'supabaseUrl');
const turnstile = Boolean(setting('VITE_TURNSTILE_SITE_KEY', 'turnstileSiteKey'));
const project = supabaseUrl && URL.canParse(supabaseUrl) ? new URL(supabaseUrl) : null;
if (supabaseUrl && !project) problems.push(`Adresse Supabase non valable dans config.js : ${supabaseUrl}`);

// Seules sources permises : le site lui-même, le projet Supabase configuré (jamais un joker), les vignettes d'Open Food
// Facts et, si sa clé est renseignée, le contrôle anti-robots de Cloudflare (script et cadre). Tout le reste est refusé.
const supabase = project ? [project.origin] : [];
const realtime = project ? [`${project.protocol === 'https:' ? 'wss' : 'ws'}://${project.host}`] : [];
const cloudflare = turnstile ? ['https://challenges.cloudflare.com'] : [];
const expected = new Map(
  [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", "'wasm-unsafe-eval'", ...cloudflare]],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', ...supabase, 'https://images.openfoodfacts.org']],
    ['font-src', ["'self'", 'data:']],
    ['connect-src', ["'self'", ...supabase, ...realtime]],
    ['frame-src', cloudflare],
    ['worker-src', ["'self'"]],
    ['manifest-src', ["'self'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['object-src', ["'none'"]],
  ].filter(([, sources]) => sources.length),
);

/** Écarts entre une politique et celle attendue ; frame-ancestors n'est exigé que dans _headers (ignoré dans une <meta>). */
function cspProblems(file, policy) {
  if (!policy) return [`Politique de sécurité absente de ${file}`];
  const header = file === '_headers';
  const want = new Map(expected);
  if (header) want.set('frame-ancestors', ["'none'"]);
  const found = new Map();
  const out = [];
  for (const part of policy.split(';').map((p) => p.trim()).filter(Boolean)) {
    const [name, ...sources] = part.split(/\s+/);
    if (found.has(name)) out.push(`${name} en double`);
    found.set(name, sources);
  }
  for (const [name, sources] of found) {
    if (name === 'frame-ancestors' && !header) continue;
    const allowed = want.get(name);
    if (!allowed) out.push(`${name} n'est pas prévu`);
    else if (sources.some((s) => !allowed.includes(s))) out.push(`${name} autorise ${sources.filter((s) => !allowed.includes(s)).join(' ')}`);
  }
  for (const [name, sources] of want) {
    const missing = sources.filter((s) => !(found.get(name) ?? []).includes(s));
    if (missing.length) out.push(`${name} n'autorise pas ${missing.join(' ')}`);
  }
  return out.map((p) => `Politique de sécurité de ${file} : ${p}`);
}
const cspIssues = [
  ...cspProblems('index.html', /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(read('index.html'))?.[1]),
  ...cspProblems('_headers', /^\s*Content-Security-Policy:\s*(.*)$/m.exec(read('_headers'))?.[1]),
];
if (cspIssues.length) {
  const want = `Supabase ${project?.origin ?? 'non configuré'}, contrôle anti-robots ${turnstile ? 'activé' : 'désactivé'}`;
  problems.push(
    ...cspIssues,
    `(Attendu d'après config.js et les variables VITE_… : ${want}. La politique est construite par vite.config.ts : relancez « npm run build » après tout changement de configuration.)`,
  );
}

if (problems.length) {
  console.error('Export refusé :\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(`Export vérifié (${dist}) : aucun secret, aucun code local ou de test, politique de sécurité conforme.`);
console.log(
  configured
    ? 'Configuration Supabase présente dans config.js.'
    : 'À FAIRE avant la mise en ligne : renseigner l’adresse Supabase et la clé publique (config.production.js), puis refaire l’export ; voir docs/INSTALLATION.md.',
);
console.log(turnstile ? 'Contrôle anti-robots (Cloudflare Turnstile) : activé.' : 'Contrôle anti-robots (Cloudflare Turnstile) : non configuré.');

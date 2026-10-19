// Après `vite build` : place la configuration publique de production, puis vérifie l'export.
//  - config.production.js (s'il existe) devient dist/config.js ;
//  - aucun secret : clé secrète Supabase (sb_secret_… / jeton service_role), clé Anthropic (sk-ant-…) ;
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

const problems = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else check(p, name);
  }
}
function check(path, name) {
  if (/pglite|\.wasm$|\.data$/i.test(name)) problems.push(`Fichier local ou de test inclus : ${name}`);
  if (!/\.(js|html|css|json|webmanifest|txt)$/.test(name) && name !== '_headers') return;
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
  if (/createFakeSupabase|storage_local\.blobs|demo-cave-2026|mock-anthropic/.test(text)) problems.push(`Code local ou de test dans ${name}`);
  if (/api\.anthropic\.com|anthropic-version/.test(text)) problems.push(`Appel direct à l'API Anthropic dans ${name} (doit passer par le serveur)`);
}

walk(dist);
for (const required of ['index.html', 'config.js', 'sw.js', 'manifest.webmanifest', '_headers', 'asset-manifest.json', 'icon-192.png', 'icon-512.png']) {
  if (!existsSync(join(dist, required))) problems.push(`Fichier manquant : ${required}`);
}
const config = readFileSync(join(dist, 'config.js'), 'utf8');
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

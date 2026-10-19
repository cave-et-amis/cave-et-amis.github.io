// Regroupe la fonction serveur (server/api, + règles partagées de src/domain) en UN fichier Deno :
// supabase/functions/cave-api/index.ts — déployable avec la CLI Supabase ou en le collant dans le tableau de bord.
// Les deux bibliothèques externes sont importées depuis npm avec une version figée.
import { build } from 'vite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const versions = {
  '@anthropic-ai/sdk': pkg.devDependencies['@anthropic-ai/sdk'],
  '@supabase/supabase-js': pkg.dependencies['@supabase/supabase-js'],
};
const outDir = join(root, 'reports', 'function-build');

await build({
  configFile: false,
  root,
  logLevel: 'warn',
  build: {
    lib: { entry: join(root, 'server', 'api', 'deno.ts'), formats: ['es'], fileName: () => 'index.js' },
    outDir,
    emptyOutDir: true,
    minify: false,
    target: 'es2022',
    rollupOptions: { external: Object.keys(versions) },
  },
});

let code = readFileSync(join(outDir, 'index.js'), 'utf8');
for (const [name, version] of Object.entries(versions)) {
  code = code.replaceAll(`from "${name}"`, `from "npm:${name}@${version}"`).replaceAll(`from '${name}'`, `from "npm:${name}@${version}"`);
}
if (/from\s+["'](?!npm:|\.)/.test(code)) throw new Error('Import non résolu dans la fonction regroupée');
if (/sk-ant-[A-Za-z0-9]/.test(code)) throw new Error('Une clé Anthropic apparaît dans le code : export refusé');

const header = `// Cave & Amis — fonction serveur « cave-api » (Supabase Edge Function, Deno).
// FICHIER GÉNÉRÉ par « npm run build:function » à partir de server/api : ne pas modifier à la main.
// Secret requis (Supabase › Edge Functions › Secrets) : ANTHROPIC_API_KEY. Jamais de clé dans ce fichier.
// Déploiement sans vérification JWT par la passerelle (la fonction vérifie elle-même la session) :
//   npx supabase functions deploy cave-api --no-verify-jwt --project-ref <référence>
// @ts-nocheck
`;
const dir = join(root, 'supabase', 'functions', 'cave-api');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'index.ts'), header + code);
console.log(`supabase/functions/cave-api/index.ts (${Math.round(code.length / 1024)} Ko) — ${Object.entries(versions).map(([n, v]) => `${n}@${v}`).join(', ')}`);

// Tests d'interface : l'export de production est relié au serveur local de test (config.js public, aucune clé secrète).
// La politique de sécurité de l'export n'autorise que Supabase : on y ajoute l'adresse du serveur local de test.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, port] = process.argv.slice(2);
writeFileSync(
  join(dir, 'config.js'),
  `window.CAVE_CONFIG = { supabaseUrl: 'http://127.0.0.1:${port}', supabaseKey: 'local-publishable-key', local: true };\n`,
);
const index = join(dir, 'index.html');
const local = `http://127.0.0.1:${port}`;
writeFileSync(index, readFileSync(index, 'utf8').replace(/(img-src [^;]*|connect-src [^;]*)/g, `$1 ${local}`));
console.log(`config.js de test → serveur local ${port}`);

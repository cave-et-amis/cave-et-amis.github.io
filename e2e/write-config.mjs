// Tests d'interface : l'export de production est relié au serveur local de test (config.js public, aucune clé secrète).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, port] = process.argv.slice(2);
writeFileSync(
  join(dir, 'config.js'),
  `window.CAVE_CONFIG = { supabaseUrl: 'http://127.0.0.1:${port}', supabaseKey: 'local-publishable-key', local: true };\n`,
);
console.log(`config.js de test → serveur local ${port}`);

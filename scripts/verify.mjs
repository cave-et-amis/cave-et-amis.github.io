// Vérification complète : fonction serveur regroupée, types, tests (règles, base, serveur de l'assistant),
// export de production et contrôle des secrets, tests d'interface (téléphone et ordinateur).
// Résultat dans reports/verification.json.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const steps = [
  ['Fonction serveur regroupée pour Supabase (supabase/functions/cave-api)', 'npm run build:function'],
  ['Vérification des types (TypeScript)', 'npx tsc --noEmit -p tsconfig.json'],
  ['Tests : règles, base de données et droits, serveur de l’assistant (Vitest + PGlite)', 'npx vitest run'],
  ['Export de production et contrôle des secrets', 'npm run build'],
  ['Tests d’interface sur l’export de production : téléphone et ordinateur (Playwright, Edge)', 'npx playwright test'],
];

const results = [];
let ok = true;
for (const [label, command] of steps) {
  const started = Date.now();
  console.log(`\n▶ ${label}\n  ${command}`);
  const run = spawnSync(command, { cwd: root, shell: true, stdio: 'inherit' });
  const passed = run.status === 0;
  results.push({ label, command, passed, seconds: Math.round((Date.now() - started) / 1000) });
  if (!passed) {
    ok = false;
    break;
  }
}
mkdirSync(join(root, 'reports'), { recursive: true });
writeFileSync(join(root, 'reports', 'verification.json'), JSON.stringify({ date: new Date().toISOString(), ok, results }, null, 2));
console.log(`\n${ok ? '✔ Tout est vérifié.' : '✘ Échec : voir ci-dessus.'} Rapport : reports/verification.json`);
process.exit(ok ? 0 : 1);

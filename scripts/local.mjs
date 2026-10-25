// npm run local [-- --demo] [-- --reset] : serveur local tout-en-un (base, comptes, photos, assistant) + interface.
// Ouvrez ensuite http://localhost:5173 ; depuis un téléphone sur le même Wi-Fi : l'adresse « Network » affichée par Vite.
// L'assistant appelle réellement Claude si ANTHROPIC_API_KEY est définie dans l'environnement de ce poste.
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const port = process.env.LOCAL_API_PORT ?? '54321';
const extra = process.argv.slice(2);

const children = [
  spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/local/main.ts', '--port', port, ...extra], { cwd: root, stdio: 'inherit' }),
  // Même Node que ce script (pas de npx) : fonctionne même si Node n'est pas dans le PATH.
  spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host'], { cwd: root, stdio: 'inherit', env: { ...process.env, VITE_LOCAL_API: port } }),
];

const stop = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const c of children) c.on('exit', (code) => code && code !== 0 && stop());

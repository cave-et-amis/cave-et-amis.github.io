/**
 * Serveur local « tout-en-un » (npm run local) : remplace Supabase sur ce poste pour essayer et tester
 * l'application de bout en bout, sans compte en ligne.
 *  - vraie base PostgreSQL (PGlite) enregistrée dans .local/, avec les migrations de production ;
 *  - comptes, API de données, stockage des photos, fonction serveur « cave-api » (la même que celle déployée) ;
 *  - l'assistant appelle réellement Claude si la variable d'environnement ANTHROPIC_API_KEY est définie
 *    sur ce poste ; sinon il s'affiche « non configuré » (aucune réponse simulée).
 *
 * Options : --demo (comptes et données de démonstration, clairement marqués), --reset (repart de zéro),
 *           --data <dossier> (emplacement de la base), --port <port>.
 */
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createApiHandler } from '../api/handler.ts';
import { createFakeSupabase } from './fakeSupabase.ts';
import { SUPABASE_SHIM_SQL } from './shim.sql.ts';
import { seedDemo } from './seed.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const root = join(import.meta.dirname, '..', '..');
const PORT = Number(option('port', process.env.LOCAL_API_PORT ?? '54321'));
const dataDir = join(root, option('data', '.local/pgdata'));
export const LOCAL_PUBLISHABLE_KEY = 'local-publishable-key';
const serviceKey = `local-service-${crypto.randomUUID()}`;

const migrationsDir = join(root, 'supabase', 'migrations');
const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(migrationsDir, f), 'utf8'));

function schemaVersion() {
  let h = 5381;
  for (const sql of [SUPABASE_SHIM_SQL, ...migrations]) for (let i = 0; i < sql.length; i++) h = ((h << 5) + h + sql.charCodeAt(i)) >>> 0;
  return String(h);
}

async function open() {
  if (flag('reset') && existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  let db = await PGlite.create(dataDir);
  const installed = (await db.query<{ ok: boolean }>(`select to_regclass('auth.local_meta') is not null as ok`)).rows[0]?.ok;
  if (installed) {
    const version = (await db.query<{ version: string }>(`select version from auth.local_meta`)).rows[0]?.version;
    if (version === schemaVersion()) return { db, fresh: false };
    // Schéma modifié : l'ancienne base locale est mise de côté, une nouvelle est créée.
    await db.close();
    const backup = `${dataDir}-ancienne-${Date.now()}`;
    renameSync(dataDir, backup);
    console.log(`Schéma modifié : ancienne base locale déplacée dans ${backup}`);
    mkdirSync(dataDir, { recursive: true });
    db = await PGlite.create(dataDir);
  }
  await db.exec(SUPABASE_SHIM_SQL);
  for (const sql of migrations) await db.exec(sql);
  await db.exec(`create table auth.local_meta (version text not null)`);
  await db.query(`insert into auth.local_meta values ($1)`, [schemaVersion()]);
  return { db, fresh: true };
}

const { db, fresh } = await open();
if (fresh && flag('demo')) {
  await seedDemo(db);
  console.log('Données de DÉMONSTRATION ajoutées (comptes « … (démo) », mot de passe : demo-cave-2026).');
}

const functions: Record<string, (req: Request) => Promise<Response>> = {};
const fake = createFakeSupabase(db, { serviceKey, functions });
functions['cave-api'] = createApiHandler(
  {
    supabaseUrl: `http://127.0.0.1:${PORT}`,
    publishableKey: LOCAL_PUBLISHABLE_KEY,
    serviceKey,
    anthropicKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
    anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL?.trim() || undefined,
  },
  { fetch: fake.fetch },
);

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-upsert, prefer, accept-profile, content-profile, range, x-supabase-api-version, cache-control',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
  'Access-Control-Expose-Headers': 'content-range, x-supabase-api-version',
  'Access-Control-Max-Age': '86400',
};

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const request = new Request(`http://127.0.0.1:${PORT}${req.url}`, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
    });
    const response = await fake.handle(request);
    const out: Record<string, string> = { ...CORS };
    response.headers.forEach((v, k) => (out[k] = v));
    res.writeHead(response.status, out);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    console.error(e);
    res.writeHead(500, { ...CORS, 'Content-Type': 'application/json' }).end(JSON.stringify({ message: 'Erreur du serveur local' }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Serveur local Cave & Amis : http://127.0.0.1:${PORT} (base : ${dataDir})`);
  console.log(
    process.env.ANTHROPIC_API_KEY
      ? 'Assistant : clé ANTHROPIC_API_KEY trouvée dans l’environnement de ce poste (elle reste côté serveur).'
      : 'Assistant : non configuré (définissez ANTHROPIC_API_KEY dans l’environnement de ce poste pour l’essayer en local).',
  );
});

const stop = async () => {
  server.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

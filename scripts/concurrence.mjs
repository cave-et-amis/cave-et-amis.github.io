// Test de concurrence RÉEL (PGlite n'a qu'une connexion) : un vrai PostgreSQL dans Docker, deux sessions en même temps.
// Lance : node scripts/concurrence.mjs   (Docker Desktop démarré ; gratuit, tout reste sur ce poste).
//
// Scénarios : deux personnes prennent en même temps les dernières bouteilles
//  1. d'un achat groupé (set_purchase_part) ;
//  2. d'un lot, pour deux événements (propose_event_wine avec « je l'apporte »).
// La première passe, la seconde attend le verrou puis est refusée : jamais plus que prévu. Témoin : la même prise de part
// SANS verrou dépasse le total, ce qui prouve que le test détecte bien le problème.
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SUPABASE_SHIM_SQL } from '../server/local/shim.sql.ts';

const NAME = 'cave-concurrence';
const IMAGE = 'postgres:17-alpine';
const MIGRATIONS = join(import.meta.dirname, '..', 'supabase', 'migrations');

const docker = (args, input) => spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
/** Exécute du SQL (superutilisateur) et renvoie la sortie brute, sans en-têtes. */
function sql(text) {
  const r = docker(['exec', '-i', NAME, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A'], text);
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return r.stdout.trim();
}
/** Une session en tant que personne connectée, lancée en arrière-plan ; résout avec sa sortie et ses erreurs. */
function session(user, body) {
  return new Promise((resolve) => {
    const p = spawn('docker', ['exec', '-i', NAME, 'psql', '-U', 'postgres', '-d', 'postgres', '-q', '-t', '-A']);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', () => resolve(out));
    p.stdin.end(`begin;\nselect set_config('request.jwt.claim.sub', '${user}', true);\nset local role authenticated;\n${body}\ncommit;\n`);
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, text) => {
  console.log(`${ok ? 'OK ' : 'ÉCHEC'}  ${text}`);
  if (!ok) failures += 1;
};

async function main() {
  docker(['rm', '-f', NAME]);
  const run = docker(['run', '-d', '--rm', '--name', NAME, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', IMAGE]);
  if (run.status !== 0) throw new Error(`Docker : ${run.stderr}`);
  for (let i = 0; i < 60 && docker(['exec', NAME, 'pg_isready', '-U', 'postgres']).status !== 0; i++) await wait(500);
  await wait(1000);

  // Environnement Supabase minimal, puis toutes les migrations, dans l'ordre (comme les tests PGlite).
  sql(SUPABASE_SHIM_SQL);
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) sql(readFileSync(join(MIGRATIONS, f), 'utf8'));
  console.log('Base prête : PostgreSQL', sql('show server_version'), '· migrations appliquées');

  const [a, b] = ['00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b'];
  sql(`insert into auth.users (id, email, raw_user_meta_data) values
        ('${a}', 'a@exemple.test', '{"display_name":"Alice"}'), ('${b}', 'b@exemple.test', '{"display_name":"Bruno"}');`);
  const as = (user, q) => sql(`begin; select set_config('request.jwt.claim.sub', '${user}', true); set local role authenticated; ${q} commit;`).split('\n').pop();

  // Alice et Bruno sont en contact (invitation acceptée), condition pour être dans le même groupe.
  const code = as(a, `select (create_friend_invite()) ->> 'code';`);
  as(b, `select respond_friend_invite('${code}', true);`);

  // ── 1. Achat groupé : 3 bouteilles, chacun en veut 2, en même temps. ──
  const group = as(a, `select (create_group('Concurrence', '🍷', null, null, array['${b}']::uuid[])).id;`);
  as(b, `select respond_group_invite('${group}', true);`);
  const purchase = as(a, `select (create_group_purchase('${group}', '{"title":"Caisse"}'::jsonb)).id;`);
  const item = as(a, `select (add_group_purchase_item('${purchase}', '{"wine_name":"Rare","unit_price":20,"bottles":3}'::jsonb)).id;`);
  const first = session(a, `select set_purchase_part('${item}', 2);\nselect pg_sleep(2);`);
  await wait(600);
  const t0 = Date.now();
  const second = await session(b, `select set_purchase_part('${item}', 2);`);
  const waited = Date.now() - t0;
  await first;
  check(/purchase_full/.test(second), `achat groupé : la seconde part est refusée (« ${second.match(/ERROR:\s*(\w+)/)?.[1] ?? second.trim()} »)`);
  check(waited > 900, `achat groupé : la seconde session a attendu le verrou (${waited} ms)`);
  check(sql(`select sum(bottles) from group_purchase_parts where item_id = '${item}'`) === '2', 'achat groupé : 2 bouteilles prises sur 3, jamais plus');

  // Témoin : la même fonction sans verrou laisse passer les deux parts (4 sur 3).
  sql(`create function public.part_sans_verrou(p_item uuid, p_bottles int) returns void language plpgsql security definer set search_path = public as $$
       declare v_item group_purchase_items; v_others int;
       begin
         select * into v_item from group_purchase_items where id = p_item;
         select coalesce(sum(bottles), 0) into v_others from group_purchase_parts where item_id = p_item and user_id <> auth.uid();
         perform pg_sleep(1);
         if v_others + p_bottles > v_item.bottles then raise exception 'purchase_full'; end if;
         insert into group_purchase_parts (item_id, user_id, bottles) values (p_item, auth.uid(), p_bottles)
         on conflict (item_id, user_id) do update set bottles = excluded.bottles;
       end $$;
       grant execute on function public.part_sans_verrou(uuid, int) to authenticated;`);
  const item2 = as(a, `select (add_group_purchase_item('${purchase}', '{"wine_name":"Témoin","unit_price":20,"bottles":3}'::jsonb)).id;`);
  await Promise.all([session(a, `select part_sans_verrou('${item2}', 2);`), session(b, `select part_sans_verrou('${item2}', 2);`)]);
  check(sql(`select sum(bottles) from group_purchase_parts where item_id = '${item2}'`) === '4', 'témoin sans verrou : 4 bouteilles sur 3 (le test voit bien le problème)');

  // ── 2. Réservations : 3 bouteilles d'un lot, deux événements en veulent 2 chacun, en même temps. ──
  const wine = as(a, `insert into wines (name) values ('Dernières bouteilles') returning id;`);
  const lot = as(a, `select (create_lot(jsonb_build_object('wine_id', '${wine}'::uuid, 'quantity', 3), gen_random_uuid())).id;`);
  const ev = () => as(a, `select (create_event('{"kind":"diner","title":"Dîner","starts_at":"2030-01-01T19:00:00Z"}'::jsonb, '{}'::uuid[])).id;`);
  const [e1, e2] = [ev(), ev()];
  const r1 = session(a, `select propose_event_wine('${e1}', '${lot}', 2, null, true, gen_random_uuid());\nselect pg_sleep(2);`);
  await wait(600);
  const r2 = await session(a, `select propose_event_wine('${e2}', '${lot}', 2, null, true, gen_random_uuid());`);
  await r1;
  check(/over_reservation/.test(r2), `réservations : la seconde est refusée (« ${r2.match(/ERROR:\s*(\w+)/)?.[1] ?? r2.trim()} »)`);
  check(sql(`select reserved from lots where id = '${lot}'`) === '2', 'réservations : 2 bouteilles réservées sur 3, jamais plus');
}

main()
  .catch((e) => {
    console.error(e.message);
    failures += 1;
  })
  .finally(() => {
    docker(['rm', '-f', NAME]);
    console.log(failures ? `${failures} échec(s)` : 'Tous les scénarios de concurrence sont tenus.');
    process.exit(failures ? 1 : 0);
  });

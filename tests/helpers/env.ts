import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createFakeSupabase } from '../../server/local/fakeSupabase.ts';
import { createDb } from './db.ts';

export const TEST_URL = 'http://supabase.test';
export const TEST_PUBLIC_KEY = 'local-publishable-key';
export const TEST_SERVICE_KEY = 'local-service-key-tests';

/** Base PostgreSQL neuve + clients Supabase officiels branchés sur le faux serveur (aucun réseau). */
export async function makeEnv(functions: Record<string, (req: Request) => Promise<Response>> = {}) {
  const db = await createDb();
  const fake = createFakeSupabase(db, { serviceKey: TEST_SERVICE_KEY, functions });
  let n = 0;
  const client = (): SupabaseClient =>
    createClient(TEST_URL, TEST_PUBLIC_KEY, {
      global: { fetch: fake.fetch },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `t${++n}` },
    });
  const service = (): SupabaseClient =>
    createClient(TEST_URL, TEST_SERVICE_KEY, {
      global: { fetch: fake.fetch },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  /** Crée un compte et renvoie un client connecté. */
  async function signUp(name: string, password = 'motdepasse-test') {
    const sb = client();
    const email = `${name.toLowerCase()}.${crypto.randomUUID().slice(0, 6)}@exemple.test`;
    const { data, error } = await sb.auth.signUp({ email, password, options: { data: { display_name: name } } });
    if (error) throw error;
    return { sb, id: data.user!.id, email, password };
  }
  return { db, fake, client, service, signUp };
}

export type Env = Awaited<ReturnType<typeof makeEnv>>;

/** Petite image JPEG valide (1×1 pixel). */
export const TINY_JPEG = Uint8Array.from(
  atob(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  ),
  (c) => c.charCodeAt(0),
);

/**
 * Configuration publique. Seules l'adresse du projet Supabase et sa clé PUBLIQUE (publishable / anon)
 * peuvent apparaître ici : elles sont visibles dans le navigateur par nature. La clé Anthropic n'est
 * JAMAIS côté navigateur : elle reste dans les secrets de la fonction serveur.
 */
export type AppConfig = { mode: 'supabase'; url: string; key: string; local: boolean } | { mode: 'missing'; problem: string };

type RuntimeConfig = { supabaseUrl?: string; supabaseKey?: string; local?: boolean };

const LOCAL_KEY = 'local-publishable-key';

/**
 * Ordre de lecture :
 *  1. serveur local (`npm run local`, variable VITE_LOCAL_API = port) : même machine ou téléphone sur le même Wi-Fi ;
 *  2. variables de compilation VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY ;
 *  3. config.js chargé par la page (modifiable après l'export, sans recompiler).
 */
export function readConfig(
  env: Record<string, string | boolean | undefined> = import.meta.env,
  runtime: RuntimeConfig | undefined = typeof window !== 'undefined' ? (window as { CAVE_CONFIG?: RuntimeConfig }).CAVE_CONFIG : undefined,
  location: { protocol: string; hostname: string } | undefined = typeof window !== 'undefined' ? window.location : undefined,
): AppConfig {
  const localPort = String(env.VITE_LOCAL_API ?? '').trim();
  if (localPort && location) {
    return { mode: 'supabase', url: `${location.protocol}//${location.hostname}:${localPort}`, key: LOCAL_KEY, local: true };
  }
  const url = String(env.VITE_SUPABASE_URL || runtime?.supabaseUrl || '')
    .trim()
    .replace(/\/+$/, '');
  const key = String(env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || runtime?.supabaseKey || '').trim();
  if (!url || !key || /xxxxxxxx/.test(url + key)) {
    return {
      mode: 'missing',
      problem: 'L’adresse du projet Supabase et sa clé publique ne sont pas encore renseignées dans le fichier config.js du site.',
    };
  }
  const isLocalUrl = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url);
  if (!/^https:\/\/[^/]+$/.test(url) && !isLocalUrl) {
    return { mode: 'missing', problem: 'L’adresse Supabase doit commencer par https:// et ne contenir aucun chemin.' };
  }
  if (isSecretKey(key)) {
    return { mode: 'missing', problem: 'La clé fournie est une clé SECRÈTE : utilisez la clé publique (publishable ou anon).' };
  }
  if (/^sk-ant-/.test(key)) {
    return { mode: 'missing', problem: 'Une clé Anthropic ne doit jamais être placée dans le site : elle se configure dans les secrets du serveur.' };
  }
  return { mode: 'supabase', url, key, local: Boolean(runtime?.local) || isLocalUrl };
}

/** Détecte une clé serveur collée par erreur (sb_secret_… ou jeton de rôle service_role). */
export function isSecretKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string };
      return payload.role === 'service_role';
    } catch {
      return false;
    }
  }
  return false;
}

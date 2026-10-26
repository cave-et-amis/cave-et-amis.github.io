/**
 * Configuration publique. Seules l'adresse du projet Supabase, sa clé PUBLIQUE (publishable / anon) et la clé de SITE
 * Cloudflare Turnstile peuvent apparaître ici : elles sont visibles dans le navigateur par nature. La clé Anthropic et la
 * clé secrète Turnstile ne sont JAMAIS côté navigateur (secrets de la fonction serveur, réglages de Supabase).
 */
export type AppConfig =
  | { mode: 'supabase'; url: string; key: string; local: boolean; turnstileSiteKey: string | null }
  | { mode: 'missing'; problem: string };

type RuntimeConfig = { supabaseUrl?: string; supabaseKey?: string; turnstileSiteKey?: string; local?: boolean };

const LOCAL_KEY = 'local-publishable-key';

/**
 * Ordre de lecture :
 *  1. serveur local (`npm run local`, variable VITE_LOCAL_API = port) : même machine ou téléphone sur le même Wi-Fi,
 *     sans contrôle anti-robots ;
 *  2. variables de compilation VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY / VITE_TURNSTILE_SITE_KEY ;
 *  3. config.js chargé par la page. La clé publique s'y change sans recompiler ; pas l'adresse Supabase ni l'ajout d'une
 *     clé Turnstile, que la politique de sécurité de la page fixe à l'export.
 */
export function readConfig(
  env: Record<string, string | boolean | undefined> = import.meta.env,
  runtime: RuntimeConfig | undefined = typeof window !== 'undefined' ? (window as { CAVE_CONFIG?: RuntimeConfig }).CAVE_CONFIG : undefined,
  location: { protocol: string; hostname: string } | undefined = typeof window !== 'undefined' ? window.location : undefined,
): AppConfig {
  const localPort = String(env.VITE_LOCAL_API ?? '').trim();
  if (localPort && location) {
    return { mode: 'supabase', url: `${location.protocol}//${location.hostname}:${localPort}`, key: LOCAL_KEY, local: true, turnstileSiteKey: null };
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
  // Facultative : sans clé de site, aucun contrôle anti-robots (rien n'est chargé depuis Cloudflare).
  const turnstile = String(env.VITE_TURNSTILE_SITE_KEY || runtime?.turnstileSiteKey || '').trim();
  const turnstileSiteKey = turnstile && !/xxxxxxxx/.test(turnstile) ? turnstile : null;
  return { mode: 'supabase', url, key, local: Boolean(runtime?.local) || isLocalUrl, turnstileSiteKey };
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

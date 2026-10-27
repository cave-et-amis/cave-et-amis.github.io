import { existsSync, readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Liste des fichiers compilés, lue par le service worker pour l'ouverture hors ligne de l'interface. */
function assetManifest(): Plugin {
  return {
    name: 'cave-asset-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        // Le moteur du studio photo (.wasm, .mjs) et le dictionnaire des vins (lwin-fr) ne sont pas préchargés : ils ne
        // sont téléchargés que si l'on s'en sert.
        .filter((f) => f.startsWith('assets/') && !/\.(wasm|mjs)$/.test(f) && !/^assets\/lwin-fr-/.test(f))
        .sort();
      this.emitFile({ type: 'asset', fileName: 'asset-manifest.json', source: JSON.stringify({ files }) });
    },
  };
}

/** Contrôle anti-robots Cloudflare Turnstile : origine de son script et de son cadre. */
const TURNSTILE = 'https://challenges.cloudflare.com';

/** Ce que la politique de sécurité doit autoriser, connu à l'export. */
export type ExportConfig = { supabaseUrl: string | null; turnstileSiteKey: string | null };

/**
 * Configuration lue comme le site la lit : variables VITE_… d'abord, sinon le fichier publié (config.production.js, copié
 * en config.js à l'export ; à défaut public/config.js). Une valeur d'exemple (xxxxxxxx) compte comme absente.
 */
export function exportConfig(env: Record<string, unknown>, configJs: string): ExportConfig {
  const text = configJs.replace(/^\s*\/\/.*$/gm, '');
  const read = (variable: string, field: string) => {
    const value = String(env[variable] || new RegExp(`\\b${field}\\s*:\\s*(['"])(.*?)\\1`).exec(text)?.[2] || '').trim();
    return value && !/xxxxxxxx/.test(value) ? value : null;
  };
  return { supabaseUrl: read('VITE_SUPABASE_URL', 'supabaseUrl'), turnstileSiteKey: read('VITE_TURNSTILE_SITE_KEY', 'turnstileSiteKey') };
}

/**
 * Politique de sécurité du contenu (CSP) : Supabase limité au projet configuré (aucun joker) ; Cloudflare Turnstile
 * (script-src et frame-src, comme le demande Cloudflare) seulement si sa clé est configurée, sinon rien de Cloudflare.
 * `meta` : sans frame-ancestors, ignoré dans une balise <meta>.
 */
export function contentSecurityPolicy({ supabaseUrl, turnstileSiteKey }: ExportConfig, where: 'header' | 'meta' = 'header'): string {
  const project = supabaseUrl ? URL.parse(supabaseUrl) : null;
  if (supabaseUrl && !/^https?:$/.test(project?.protocol ?? '')) throw new Error(`Adresse Supabase non valable dans la configuration : ${supabaseUrl}`);
  const supabase = project ? [project.origin] : [];
  const realtime = project ? [`${project.protocol === 'https:' ? 'wss' : 'ws'}://${project.host}`] : [];
  const turnstile = turnstileSiteKey ? [TURNSTILE] : [];
  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", "'wasm-unsafe-eval'", ...turnstile]],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', ...supabase, 'https://images.openfoodfacts.org']],
    ['font-src', ["'self'", 'data:']],
    ['connect-src', ["'self'", ...supabase, ...realtime]],
    ['frame-src', turnstile],
    ['worker-src', ["'self'"]],
    ['manifest-src', ["'self'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', where === 'header' ? ["'none'"] : []],
    ['object-src', ["'none'"]],
  ];
  return directives
    .filter(([, sources]) => sources.length)
    .map(([name, sources]) => [name, ...sources].join(' '))
    .join('; ');
}

/**
 * Politique de sécurité (CSP) construite à l'export d'après la configuration, puis recopiée dans une balise <meta> de
 * index.html (GitHub Pages ne lit pas _headers) et dans dist/_headers (Netlify, Cloudflare Pages). Pas en développement :
 * Vite y injecte du script.
 */
function securityPolicy(): Plugin {
  let site: ExportConfig = { supabaseUrl: null, turnstileSiteKey: null };
  return {
    name: 'cave-csp',
    apply: 'build',
    configResolved(config) {
      const file = ['config.production.js', 'public/config.js'].map((f) => new URL(`./${f}`, import.meta.url)).find((f) => existsSync(f));
      site = exportConfig(config.env, file ? readFileSync(file, 'utf8') : '');
    },
    transformIndexHtml(html) {
      const csp = contentSecurityPolicy(site, 'meta');
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);
    },
    generateBundle() {
      const headers = readFileSync(new URL('./public/_headers', import.meta.url), 'utf8');
      const line = /^(\s*Content-Security-Policy:).*$/m;
      if (!line.test(headers)) throw new Error('Ligne Content-Security-Policy absente de public/_headers');
      this.emitFile({ type: 'asset', fileName: '_headers', source: headers.replace(line, (_all, start: string) => `${start} ${contentSecurityPolicy(site)}`) });
    },
  };
}

// base relative : le dossier exporté fonctionne à la racine d'un domaine comme dans un sous-dossier.
export default defineConfig({
  base: './',
  plugins: [react(), assetManifest(), securityPolicy()],
  server: { port: 5173 },
  // Moteur du studio photo préparé dès le démarrage (sinon Vite recharge la page à sa première utilisation).
  optimizeDeps: { include: ['onnxruntime-web/wasm'] },
  preview: { port: 4173 },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});

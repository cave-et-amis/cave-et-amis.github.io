import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Liste des fichiers compilés, lue par le service worker pour l'ouverture hors ligne de l'interface. */
function assetManifest(): Plugin {
  return {
    name: 'cave-asset-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => f.startsWith('assets/'))
        .sort();
      this.emitFile({ type: 'asset', fileName: 'asset-manifest.json', source: JSON.stringify({ files }) });
    },
  };
}

/**
 * Politique de sécurité (CSP) recopiée de public/_headers dans une balise <meta> de l'export : GitHub Pages ne lit pas
 * _headers. frame-ancestors est retiré (ignoré dans une balise <meta>). Pas en développement : Vite y injecte du script.
 */
function metaCsp(): Plugin {
  return {
    name: 'cave-meta-csp',
    apply: 'build',
    transformIndexHtml(html) {
      const headers = readFileSync(new URL('./public/_headers', import.meta.url), 'utf8');
      const csp = /Content-Security-Policy:\s*(.+)/.exec(headers)?.[1]
        .split(';')
        .map((d) => d.trim())
        .filter((d) => d && !d.startsWith('frame-ancestors'))
        .join('; ');
      if (!csp) throw new Error('Content-Security-Policy absente de public/_headers');
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);
    },
  };
}

// base relative : le dossier exporté fonctionne à la racine d'un domaine comme dans un sous-dossier.
export default defineConfig({
  base: './',
  plugins: [react(), assetManifest(), metaCsp()],
  server: { port: 5173 },
  preview: { port: 4173 },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});

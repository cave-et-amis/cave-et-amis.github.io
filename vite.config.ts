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

// base relative : le dossier exporté fonctionne à la racine d'un domaine comme dans un sous-dossier.
export default defineConfig({
  base: './',
  plugins: [react(), assetManifest()],
  server: { port: 5173 },
  preview: { port: 4173 },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});

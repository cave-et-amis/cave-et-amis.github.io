import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import '@fontsource-variable/fraunces';
import '@fontsource-variable/source-sans-3';
import './styles.css';
import { App, ConfigProblem } from './App';
import { readConfig } from './config';
import { Api } from './data/api';

const root = createRoot(document.getElementById('root')!);

function boot() {
  const config = readConfig();
  if (config.mode === 'missing') {
    root.render(<ConfigProblem problem={config.problem} />);
    return;
  }
  const api = new Api(
    createClient(config.url, config.key, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: config.local ? 'cave-amis-local-auth' : 'cave-amis-auth',
      },
    }),
  );
  root.render(<App api={api} local={config.local} />);
}

try {
  boot();
} catch (e) {
  console.error(e);
  root.render(<ConfigProblem problem="L’application n’a pas pu démarrer. Rechargez la page ; si le problème continue, videz le cache du navigateur." />);
}

// Installation sur l'écran d'accueil et ouverture rapide de l'interface (version en ligne uniquement).
if (import.meta.env.PROD && 'serviceWorker' in navigator && window.location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}

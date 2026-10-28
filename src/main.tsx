import { createRoot } from 'react-dom/client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import '@fontsource-variable/playfair-display';
import '@fontsource-variable/inter';
import './styles.css';
import { App, ConfigProblem, Framed } from './App';
import { readConfig } from './config';
import { Api } from './data/api';
import { MotionProvider } from './ui/motion';
import { applyTheme, DEFAULT_THEME, rememberedTheme } from './ui/theme';

// Dès le premier affichage : le dernier thème noté sur cet appareil (déjà posé par theme-boot.js), sinon le thème par
// défaut ; celui du compte s'applique une fois la personne connectée.
applyTheme(rememberedTheme() ?? DEFAULT_THEME);
const root = createRoot(document.getElementById('root')!);

function boot() {
  const config = readConfig();
  if (config.mode === 'missing') {
    root.render(<ConfigProblem problem={config.problem} />);
    return;
  }
  // Vérification du mot de passe actuel (changement de mot de passe) : client créé une fois, qui ne garde aucune session.
  let checker: SupabaseClient | null = null;
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
    {
      captchaSiteKey: config.turnstileSiteKey,
      checker: () =>
        (checker ??= createClient(config.url, config.key, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'cave-amis-verification' },
        })),
    },
  );
  root.render(
    <MotionProvider>
      <App api={api} local={config.local} />
    </MotionProvider>,
  );
}

/**
 * Page affichée dans le cadre (iframe) d'un autre site : l'application ne démarre pas, pour qu'on ne puisse pas faire
 * cliquer la personne à son insu sur ses propres boutons (« clickjacking » ; GitHub Pages ne permet pas l'en-tête qui
 * l'interdirait). Un lien l'ouvre dans son propre onglet.
 */
function inFrame() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

if (inFrame()) {
  root.render(<Framed href={window.location.href} />);
} else {
  try {
    boot();
  } catch (e) {
    console.error(e);
    root.render(<ConfigProblem problem="L’application n’a pas pu démarrer. Rechargez la page ; si le problème continue, videz le cache du navigateur." />);
  }

  // Notification push touchée alors que l'application était ouverte : le service worker demande d'aller sur le bon écran.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | null;
      if (data?.type === 'cave-open' && typeof data.url === 'string' && /^#\/[\w\-/?=&%.]*$/.test(data.url)) window.location.hash = data.url.slice(1);
    });
  }

  // Installation sur l'écran d'accueil et ouverture rapide de l'interface (version en ligne uniquement).
  if (import.meta.env.PROD && 'serviceWorker' in navigator && window.location.protocol === 'https:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => undefined);
    });
  }
}

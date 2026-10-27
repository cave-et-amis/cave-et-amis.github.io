/**
 * Pages chargées à la demande : leur code n'est téléchargé qu'à la première visite, ce qui allège l'ouverture de
 * l'application sur un téléphone.
 *
 * Après une mise en ligne, un onglet resté ouvert peut réclamer un fichier de l'ancienne version, qui n'existe plus :
 * la page est alors rechargée une fois (au plus une fois par minute), ce qui charge la nouvelle version.
 */
import { lazy, type ComponentType } from 'react';

const RELOADED_AT = 'cave-chunk-reload';

function reloadOnce(error: unknown): Promise<never> {
  try {
    const last = Number(sessionStorage.getItem(RELOADED_AT) ?? 0);
    if (Date.now() - last > 60_000) {
      sessionStorage.setItem(RELOADED_AT, String(Date.now()));
      location.reload();
      return new Promise<never>(() => {});
    }
  } catch {
    // Stockage indisponible (navigation privée) : on laisse l'erreur s'afficher.
  }
  return Promise.reject(error);
}

/** `lazyPage(() => import('./X'), 'X')` : composant exporté sous son nom, chargé à la première utilisation. */
export function lazyPage<M extends Record<K, ComponentType<any>>, K extends keyof M & string>(load: () => Promise<M>, name: K) {
  return lazy<M[K]>(() => load().then((m) => ({ default: m[name] }), reloadOnce));
}

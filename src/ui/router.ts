/**
 * Navigation par fragment d'URL (#/cave, #/evenements/…) : fonctionne sur n'importe quel hébergement statique.
 * Les fenêtres (Sheet) s'inscrivent dans l'historique : le bouton « retour » du téléphone les ferme
 * au lieu de quitter la page.
 */
import { useEffect, useState } from 'react';

export function currentPath(): string {
  const h = window.location.hash.replace(/^#/, '');
  return h.startsWith('/') ? h : '/';
}

/** Paramètres après « ? » dans le fragment (ex. #/cave?filtre=pret). */
export function routeQuery(route: string = currentPath()): URLSearchParams {
  const i = route.indexOf('?');
  return new URLSearchParams(i >= 0 ? route.slice(i + 1) : '');
}

export function useRoute(): string {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const on = () => setPath(currentPath());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return path;
}

type Entry = { close: () => void; viaPop: boolean; viaNav: boolean };
const stack: Entry[] = [];
let ignorePops = 0;
let afterIgnoredPop: (() => void) | null = null;
let settledQueue: (() => void)[] = [];

function flushSettled() {
  if (ignorePops > 0) return;
  const queue = settledQueue;
  settledQueue = [];
  for (const fn of queue) fn();
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (ignorePops > 0) {
      ignorePops -= 1;
      const next = afterIgnoredPop;
      afterIgnoredPop = null;
      next?.();
      flushSettled();
      return;
    }
    const top = stack.pop();
    if (top) {
      top.viaPop = true;
      top.close();
    }
  });
}

/** Inscrit une fenêtre ouverte ; renvoie la fonction à appeler à sa fermeture. */
export function registerSheet(close: () => void): () => void {
  const entry: Entry = { close, viaPop: false, viaNav: false };
  let pushed = false;
  let removed = false;
  stack.push(entry);
  // Si une fenêtre vient de se fermer, son retour arrière n'est peut-être pas encore traité : on attend.
  whenHistorySettled(() => {
    if (removed) return;
    history.pushState({ sheet: true }, '');
    pushed = true;
  });
  return () => {
    removed = true;
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    if (pushed && !entry.viaPop && !entry.viaNav) {
      ignorePops += 1;
      history.back();
    }
  };
}

/** Exécute `fn` une fois l'historique stabilisé (après la fermeture d'une fenêtre), pour en ouvrir une autre sans conflit. */
export function whenHistorySettled(fn: () => void): void {
  if (ignorePops === 0) fn();
  else settledQueue.push(fn);
}

/** Va vers une page de l'application (en fermant proprement les fenêtres ouvertes). */
export function go(path: string, opts: { replace?: boolean } = {}): void {
  const target = `#${path}`;
  if (stack.length > 0) {
    const n = stack.length;
    for (const e of stack) e.viaNav = true;
    stack.length = 0;
    const replace = () => window.location.replace(target);
    if (n === 1) replace();
    else {
      ignorePops += 1;
      afterIgnoredPop = replace;
      history.go(-(n - 1));
    }
    return;
  }
  if (opts.replace) window.location.replace(target);
  else window.location.hash = path;
}

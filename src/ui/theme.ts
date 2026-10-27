/**
 * Apparence : « sombre » (maquette Cave & Amis 2.0 : cadre sombre, cartes claires ; par défaut), « clair » (crème et
 * bordeaux) ou « auto » (comme le téléphone, qui choisit l'un des deux). Le choix est gardé dans les préférences du compte
 * (aucun stockage sur l'appareil) ; avant la connexion, le thème par défaut s'applique.
 */
export type Theme = 'sombre' | 'clair' | 'auto';
export const DEFAULT_THEME: Theme = 'sombre';
export const THEMES: { value: Theme; label: string }[] = [
  { value: 'sombre', label: 'Sombre' },
  { value: 'clair', label: 'Clair' },
  { value: 'auto', label: 'Comme le téléphone' },
];

const BAR = { sombre: '#0c0b0c', clair: '#f8f3ea' } as const;

export function isTheme(v: unknown): v is Theme {
  return v === 'sombre' || v === 'clair' || v === 'auto';
}

let unwatch: (() => void) | null = null;

/** Applique le thème à la page et à la barre du navigateur ; « auto » suit le téléphone, y compris s'il change. */
export function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  unwatch?.();
  unwatch = null;
  const set = () => {
    const dark = theme === 'sombre' || (theme === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'sombre' : 'clair';
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) meta.content = dark ? BAR.sombre : BAR.clair;
  };
  set();
  if (theme === 'auto' && window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', set);
    unwatch = () => mq.removeEventListener('change', set);
  }
}

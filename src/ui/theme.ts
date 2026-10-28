/**
 * Apparence, au choix dans les Réglages (et le bouton soleil/lune de la barre du haut) :
 * - « sombre » : Clair-obscur, la maquette Cave & Amis 2.0 (cadre sombre, cartes claires) ; par défaut. La valeur garde
 *   son ancien nom pour les comptes qui l'ont déjà choisie ;
 * - « clair » : crème et bordeaux ;
 * - « nuit » : le vrai mode sombre (cadre ET cartes sombres) ;
 * - « auto » : comme l'appareil, clair ou nuit, y compris s'il change en cours de route.
 * Le choix est gardé dans les préférences du compte (il suit d'un appareil à l'autre). Le dernier thème affiché est aussi
 * noté sur l'appareil (cave.theme), pour que l'appli s'ouvre directement avec, sans éclair (public/theme-boot.js).
 */
export type Theme = 'sombre' | 'clair' | 'nuit' | 'auto';
export const DEFAULT_THEME: Theme = 'sombre';
export const THEMES: { value: Theme; label: string }[] = [
  { value: 'clair', label: 'Clair' },
  { value: 'nuit', label: 'Sombre' },
  { value: 'auto', label: 'Automatique' },
  { value: 'sombre', label: 'Clair-obscur' },
];
export const THEME_KEY = 'cave.theme';

const BAR = { sombre: '#0c0b0c', clair: '#f8f3ea' } as const;

export function isTheme(v: unknown): v is Theme {
  return v === 'sombre' || v === 'clair' || v === 'nuit' || v === 'auto';
}

const systemDark = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches);

/** Thème réellement affiché : « auto » devient « clair » ou « nuit » selon l'appareil. */
export function resolveTheme(theme: Theme, prefersDark = systemDark()): Exclude<Theme, 'auto'> {
  return theme === 'auto' ? (prefersDark ? 'nuit' : 'clair') : theme;
}

/** Le bouton soleil/lune : d'un thème sombre vers le clair ; du clair vers le dernier thème sombre choisi (sinon « nuit »). */
export function toggledTheme(current: Theme, lastDark: Theme | null, prefersDark = systemDark()): Theme {
  if (resolveTheme(current, prefersDark) !== 'clair') return 'clair';
  return lastDark === 'sombre' || lastDark === 'nuit' ? lastDark : 'nuit';
}

/** Le dernier thème noté sur cet appareil (null : rien de noté, ou stockage indisponible). */
export function rememberedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return isTheme(v) ? v : null;
  } catch {
    return null;
  }
}

let unwatch: (() => void) | null = null;
let fade: ReturnType<typeof setTimeout> | null = null;

/**
 * Applique le thème à la page et à la barre du navigateur. `remember` : le noter sur l'appareil (choix de la personne ou
 * préférence du compte) ; `animate` : fondu léger des couleurs (supprimé si l'appareil demande moins d'animations).
 */
export function applyTheme(theme: Theme, opts: { remember?: boolean; animate?: boolean } = {}) {
  if (typeof document === 'undefined') return;
  unwatch?.();
  unwatch = null;
  const root = document.documentElement;
  if (opts.animate) {
    root.classList.add('theme-switching');
    if (fade) clearTimeout(fade);
    fade = setTimeout(() => root.classList.remove('theme-switching'), 350);
  }
  const set = () => {
    const shown = resolveTheme(theme);
    const dark = shown !== 'clair';
    root.dataset.theme = dark ? 'sombre' : 'clair';
    if (shown === 'nuit') root.dataset.nuit = '';
    else delete root.dataset.nuit;
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) meta.content = dark ? BAR.sombre : BAR.clair;
  };
  set();
  if (opts.remember) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // stockage indisponible (navigation privée) : le thème du compte s'applique après la connexion
    }
  }
  if (theme === 'auto' && window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', set);
    unwatch = () => mq.removeEventListener('change', set);
  }
}

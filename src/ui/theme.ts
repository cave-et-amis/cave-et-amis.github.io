/**
 * Apparence : « sombre » (Clair-Obscur, par défaut), « clair » (crème et bordeaux) ou « auto » (comme le téléphone).
 * Le choix est gardé dans les préférences du compte (aucun stockage sur l'appareil) ; avant la connexion, le thème
 * par défaut s'applique.
 */
export type Theme = 'sombre' | 'clair' | 'auto';
export const DEFAULT_THEME: Theme = 'sombre';
export const THEMES: { value: Theme; label: string }[] = [
  { value: 'sombre', label: 'Sombre' },
  { value: 'clair', label: 'Clair' },
  { value: 'auto', label: 'Comme le téléphone' },
];

const BAR = { sombre: '#120a0b', clair: '#f8f3ea' } as const;

export function isTheme(v: unknown): v is Theme {
  return v === 'sombre' || v === 'clair' || v === 'auto';
}

/** Applique le thème à la page et à la barre du navigateur (couleur d'interface du téléphone). */
export function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  const dark = theme === 'sombre' || (theme === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) meta.content = dark ? BAR.sombre : BAR.clair;
}

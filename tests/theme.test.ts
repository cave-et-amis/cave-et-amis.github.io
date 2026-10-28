import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, isTheme, resolveTheme, THEMES, toggledTheme } from '../src/ui/theme.ts';

describe('thèmes', () => {
  it('quatre choix ; Clair-obscur (valeur « sombre ») reste le défaut', () => {
    expect(THEMES.map((t) => [t.value, t.label])).toEqual([
      ['clair', 'Clair'],
      ['nuit', 'Sombre'],
      ['auto', 'Automatique'],
      ['sombre', 'Clair-obscur'],
    ]);
    expect(DEFAULT_THEME).toBe('sombre');
    expect(['sombre', 'clair', 'nuit', 'auto'].every(isTheme)).toBe(true);
    expect(isTheme('noir')).toBe(false);
    expect(isTheme(null)).toBe(false);
  });

  it('automatique : clair ou vrai sombre selon l’appareil ; les autres restent tels quels', () => {
    expect(resolveTheme('auto', true)).toBe('nuit');
    expect(resolveTheme('auto', false)).toBe('clair');
    expect(resolveTheme('sombre', false)).toBe('sombre');
    expect(resolveTheme('nuit', false)).toBe('nuit');
    expect(resolveTheme('clair', true)).toBe('clair');
  });

  it('soleil/lune : d’un thème sombre vers le clair, du clair vers le dernier sombre choisi', () => {
    expect(toggledTheme('nuit', null, false)).toBe('clair');
    expect(toggledTheme('sombre', null, false)).toBe('clair');
    expect(toggledTheme('auto', null, true)).toBe('clair');
    expect(toggledTheme('clair', 'sombre', false)).toBe('sombre');
    expect(toggledTheme('clair', 'nuit', false)).toBe('nuit');
    expect(toggledTheme('clair', null, false)).toBe('nuit');
    expect(toggledTheme('auto', null, false)).toBe('nuit');
  });
});

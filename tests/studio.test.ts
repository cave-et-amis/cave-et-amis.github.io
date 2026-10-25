import { describe, expect, it } from 'vitest';
import { alphaFromMask, enhanceBottle, keepMainShape, layout, maskBounds, STUDIO_STYLES } from '../src/domain/studio.ts';

describe('studio photo : calculs', () => {
  it('opacité : bruit de fond retiré, bouteille opaque', () => {
    expect(alphaFromMask(0)).toBe(0);
    expect(alphaFromMask(10)).toBe(0);
    expect(alphaFromMask(255)).toBe(255);
    expect(alphaFromMask(128)).toBeGreaterThan(100);
  });

  it('cadre de la bouteille, ou rien si elle est introuvable', () => {
    const w = 20;
    const h = 20;
    const a = new Uint8Array(w * h);
    for (let y = 5; y < 15; y++) for (let x = 8; x < 12; x++) a[y * w + x] = 255;
    expect(maskBounds(a, w, h)).toMatchObject({ x: 8, y: 5, w: 4, h: 10, count: 40 });
    expect(maskBounds(new Uint8Array(w * h), w, h)).toBeNull();
  });

  it('ne garde que la bouteille : îlots détachés effacés, bord doux conservé', () => {
    const w = 12;
    const h = 12;
    const a = new Uint8Array(w * h);
    for (let y = 2; y < 10; y++) for (let x = 4; x < 8; x++) a[y * w + x] = 255; // bouteille
    a[2 * w + 3] = 40; // bord doux collé à la bouteille
    a[0 * w + 10] = 200; // îlot isolé
    a[11 * w + 0] = 30; // poussière isolée
    keepMainShape(a, w, h);
    expect(a[5 * w + 5]).toBe(255);
    expect(a[2 * w + 3]).toBe(40);
    expect(a[0 * w + 10]).toBe(0);
    expect(a[11 * w + 0]).toBe(0);
  });

  it('corrections : teinte conservée, pixels transparents intacts', () => {
    // 3 × 1 : un pixel sombre, un pixel clair, un pixel de fond transparent.
    const d = new Uint8ClampedArray([60, 30, 30, 255, 200, 100, 100, 255, 12, 34, 56, 0]);
    enhanceBottle(d, 3, 1);
    expect([...d.slice(8)]).toEqual([12, 34, 56, 0]);
    // Rapport rouge / vert identique à l'arrondi près (5 %) : la couleur n'est pas changée, seule la luminosité.
    expect(Math.abs(d[0] / d[1] - 2)).toBeLessThan(0.1);
    expect(Math.abs(d[4] / d[5] - 2)).toBeLessThan(0.1);
    // Contraste renforcé : le sombre plus sombre, le clair plus clair.
    expect(d[0]).toBeLessThan(60);
    expect(d[4]).toBeGreaterThan(200);
  });

  it('mise en page : bouteille centrée, entière, format carré pour le catalogue', () => {
    for (const s of STUDIO_STYLES) {
      const l = layout(s.id, { w: 300, h: 900 });
      expect(l.W).toBe(1200);
      expect(l.H).toBe(s.id === 'market' ? 1200 : 1500);
      expect(l.bx).toBeCloseTo((l.W - l.bw) / 2);
      expect(l.by).toBeGreaterThan(0);
      expect(l.by + l.bh).toBeLessThanOrEqual(l.H);
      expect(l.bw / l.bh).toBeCloseTo(300 / 900);
    }
  });
});

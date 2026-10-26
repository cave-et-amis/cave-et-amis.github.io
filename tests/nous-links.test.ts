import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseMagicLink } from '../src/domain/nous.ts';
import { openNous } from '../src/features/settings/NousSection.tsx';

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c';

describe('lien de connexion directe venu de Nous', () => {
  it('lit le jeton et la destination, puis les retire de l’adresse', () => {
    const l = parseMagicLink(`https://cave.test/?auth=link&token_hash=${TOKEN}&next=%23%2Fevenements%2F123`);
    expect(l).toEqual({ tokenHash: TOKEN, next: '#/evenements/123', cleanUrl: 'https://cave.test/#/evenements/123' });
  });

  it('garde les autres paramètres et la route actuelle si aucune destination', () => {
    const l = parseMagicLink(`https://cave.test/app/?x=1&auth=link&token_hash=${TOKEN}#/cave`);
    expect(l).toEqual({ tokenHash: TOKEN, next: null, cleanUrl: 'https://cave.test/app/?x=1#/cave' });
  });

  it('destination externe ou jeton invalide : ignorés (mais retirés de l’adresse)', () => {
    expect(parseMagicLink(`https://cave.test/?auth=link&token_hash=${TOKEN}&next=https://ailleurs.test`)?.next).toBeNull();
    expect(parseMagicLink(`https://cave.test/?auth=link&token_hash=<script>`)).toEqual({ tokenHash: '', next: null, cleanUrl: 'https://cave.test/' });
  });

  it('adresse ordinaire : rien à faire', () => {
    expect(parseMagicLink('https://cave.test/#/evenements')).toBeNull();
    expect(parseMagicLink('https://cave.test/?auth=reset&code=x')).toBeNull();
    expect(parseMagicLink('pas une adresse')).toBeNull();
  });
});

describe('ouvrir l’agenda Nous depuis Cave & Amis', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('avec un jeton : connexion directe ; sans jeton (« jump_disabled », Nous injoignable…) : le site de Nous, sans erreur', async () => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    const ai = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, url: 'https://cocon.test/?auth=link&token_hash=x' })
      .mockResolvedValueOnce({ ok: false, code: 'nous_unavailable', message: 'L’agenda Nous ne répond pas pour le moment.' });
    const api = { ai } as unknown as Parameters<typeof openNous>[0];
    await openNous(api, '#/agenda');
    await openNous(api, '#/agenda');
    expect(ai).toHaveBeenCalledWith('nous_jump', { next: '#/agenda' });
    expect(assign.mock.calls).toEqual([['https://cocon.test/?auth=link&token_hash=x'], ['https://cocon-famille.netlify.app/']]);
  });
});

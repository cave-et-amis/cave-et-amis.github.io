import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Session } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../src/data/api.ts';
import { clearDeviceData } from '../src/data/deviceData.ts';
import { parseMagicLink, pendingLink, startSession } from '../src/domain/nous.ts';
import { LinkAccountScreen } from '../src/features/auth/AuthScreen.tsx';
import { openNous } from '../src/features/settings/NousSection.tsx';

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c';

describe('connexion par un lien venu de Nous : « Est-ce bien votre compte ? » avant d’entrer', () => {
  afterEach(() => vi.unstubAllGlobals());
  const link = parseMagicLink(`https://cave.test/?auth=link&token_hash=${TOKEN}#/evenements`);

  /** `stored` : session déjà ouverte sur cet appareil ; le lien ouvre le compte de Claire. */
  function setup(stored: string | null, marked = false) {
    let marker = marked;
    const pending = { get: () => marker, set: (on: boolean) => void (marker = on) };
    const verify = vi.fn(async (hash: string) => (hash === TOKEN ? 'session de Claire' : null));
    return { auth: { getSession: async () => stored, verify }, verify, pending, marked: () => marker };
  }

  it('personne n’est connecté ici : le lien connecte, la question est posée et retenue', async () => {
    const t = setup(null);
    expect(await startSession(t.auth, link, t.pending)).toEqual({ session: 'session de Claire', confirm: true });
    expect(t.verify).toHaveBeenCalledWith(TOKEN);
    expect(t.marked()).toBe(true);
  });

  it('une session est déjà ouverte : le lien est ignoré, rien n’est demandé', async () => {
    const t = setup('session de Bruno');
    expect(await startSession(t.auth, link, t.pending)).toEqual({ session: 'session de Bruno', confirm: false });
    expect(t.verify).not.toHaveBeenCalled();
  });

  it('page rechargée ou rouverte avant la réponse : la question revient', async () => {
    const t = setup('session de Claire', true);
    expect(await startSession(t.auth, null, t.pending)).toEqual({ session: 'session de Claire', confirm: true });
  });

  it('lien déjà utilisé ou invalide, session fermée entre-temps : personne n’est connecté, aucun repère ne reste', async () => {
    const used = setup(null);
    used.verify.mockResolvedValueOnce(null);
    expect(await startSession(used.auth, link, used.pending)).toEqual({ session: null, confirm: false });
    expect(used.marked()).toBe(false);
    const bad = setup(null);
    expect(await startSession(bad.auth, parseMagicLink('https://cave.test/?auth=link&token_hash=<script>'), bad.pending)).toEqual({ session: null, confirm: false });
    expect(bad.verify).not.toHaveBeenCalled();
    const gone = setup(null, true);
    await startSession(gone.auth, null, gone.pending);
    expect(gone.marked()).toBe(false);
  });

  it('stockage indisponible : la question est posée quand même pour ce lien', async () => {
    const t = setup(null);
    expect(await startSession(t.auth, link, { get: () => false, set: () => undefined })).toEqual({ session: 'session de Claire', confirm: true });
  });

  it('la question montre le prénom et l’adresse du compte ouvert, avec les deux réponses', () => {
    const screen = (meta: Record<string, string>) =>
      renderToStaticMarkup(
        createElement(LinkAccountScreen, {
          api: { displayName: async () => null } as unknown as Api,
          session: { user: { id: 'u1', email: 'ines@exemple.test', user_metadata: meta } } as unknown as Session,
          onContinue: () => undefined,
        }),
      ).replace(/<!-- -->/g, '');
    const html = screen({ display_name: 'Inès' });
    expect(html).toContain('Vous êtes connecté au compte d’Inès (ines@exemple.test).');
    expect(html).toContain('>Continuer</button>');
    expect(html).toContain('>Ce n’est pas mon compte</button>');
    expect(screen({})).toContain('Vous êtes connecté au compte ines@exemple.test.');
  });

  it('le repère est gardé sur l’appareil, et effacé à la déconnexion avec le reste du confort', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    pendingLink.set(true);
    expect(pendingLink.get()).toBe(true);
    await clearDeviceData();
    expect(pendingLink.get()).toBe(false);
  });
});

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

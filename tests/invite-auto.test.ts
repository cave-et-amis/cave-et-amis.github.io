import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_MAX_AGE, clearPendingInvite, pendingInvite, pendingInviteAuto, savePendingInvite } from '../src/features/friends/invite.ts';

// Audit du 01/11/2026, V7 : sur un appareil partagé, l'acceptation automatique d'un lien ne vaut qu'une heure.
describe('invitation gardée sur l’appareil', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('acceptation automatique pendant une heure ; ensuite le code reste proposé, sans acceptation automatique', () => {
    savePendingInvite('abcde12345', true);
    expect(pendingInviteAuto()).toBe(true);
    vi.advanceTimersByTime(AUTO_MAX_AGE + 1000);
    expect(pendingInviteAuto()).toBe(false);
    expect(pendingInvite()).toBe('ABCDE12345');
    vi.advanceTimersByTime(30 * 86400_000);
    expect(pendingInvite()).toBeNull();
    clearPendingInvite();
  });
});

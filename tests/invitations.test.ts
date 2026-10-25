import { describe, expect, it } from 'vitest';
import { endOfDay, localDay } from '../src/domain/format.ts';
import { inviteStatus, shareLinks, shareMessage } from '../src/features/friends/invite.ts';
import { qrModules } from '../src/ui/QrCode.tsx';

/** Cases noires « colonne,ligne » d'un QR code. */
const darkCells = (path: string) => new Set([...path.matchAll(/M(\d+),(\d+)/g)].map((m) => `${m[1]},${m[2]}`));

describe('QR code des liens d’invitation', () => {
  it('a la structure d’un QR code lisible : taille normalisée, trois repères, lignes de synchronisation', () => {
    const link = 'https://cave-et-amis.github.io/#/ami/ABCDE23456';
    const { size, path } = qrModules(link);
    expect(size).toBeGreaterThanOrEqual(21);
    expect((size - 17) % 4).toBe(0);
    const dark = darkCells(path);
    // Repères des trois coins : anneau noir, anneau blanc, carré noir de 3 × 3.
    for (const [c0, r0] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
      for (let r = 0; r < 7; r += 1) {
        for (let c = 0; c < 7; c += 1) expect(dark.has(`${c0 + c},${r0 + r}`)).toBe(Math.max(Math.abs(r - 3), Math.abs(c - 3)) !== 2);
      }
    }
    for (let i = 8; i < size - 8; i += 1) {
      expect(dark.has(`${i},6`)).toBe(i % 2 === 0);
      expect(dark.has(`6,${i}`)).toBe(i % 2 === 0);
    }
    // Même lien, même dessin ; un lien plus long ne rapetisse pas le code.
    expect(qrModules(link).path).toBe(path);
    expect(qrModules(`${link}?${'x'.repeat(120)}`).size).toBeGreaterThan(size);
  });
});

describe('partage et suivi des liens', () => {
  it('message prêt à envoyer : WhatsApp, SMS et e-mail portent le même texte, avec le lien', () => {
    const link = 'https://cave-et-amis.github.io/#/ami/ABCDE23456';
    const message = shareMessage('discovery', null, link);
    expect(message).toContain(link);
    expect(message).not.toMatch(/ma cave/);
    const links = shareLinks(message);
    expect(links.whatsapp.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(links.whatsapp.split('text=')[1])).toBe(message);
    expect(decodeURIComponent(links.sms.split('body=')[1])).toBe(message);
    expect(links.email.startsWith('mailto:?subject=')).toBe(true);
    expect(decodeURIComponent(links.email.split('body=')[1])).toBe(message);
    expect(shareMessage('group', 'Les Bourguignons', link)).toContain('« Les Bourguignons »');
    expect(shareMessage('friend', null, link)).toContain('Je t’ouvre ma cave');
  });

  it('statut d’un lien : actif, utilisé, expiré, révoqué, refusé', () => {
    const now = Date.parse('2026-10-25T12:00:00Z');
    const base = { status: 'pending', uses: 0, max_uses: 10, expires_at: '2026-11-01T00:00:00Z' };
    expect(inviteStatus(base, now)).toBe('active');
    expect(inviteStatus({ ...base, uses: 10 }, now)).toBe('used');
    expect(inviteStatus({ ...base, status: 'accepted', max_uses: 1, uses: 1 }, now)).toBe('used');
    expect(inviteStatus({ ...base, expires_at: '2026-10-25T11:59:00Z' }, now)).toBe('expired');
    expect(inviteStatus({ ...base, status: 'revoked' }, now)).toBe('revoked');
    expect(inviteStatus({ ...base, status: 'declined', max_uses: 1 }, now)).toBe('declined');
  });

  it('une date de fin d’accès vaut jusqu’au soir de ce jour-là, et se relit comme le même jour', () => {
    const end = new Date(endOfDay('2026-11-09'));
    expect([end.getFullYear(), end.getMonth(), end.getDate(), end.getHours(), end.getMinutes()]).toEqual([2026, 10, 9, 23, 59]);
    expect(localDay(end)).toBe('2026-11-09');
    expect(localDay(new Date(2026, 0, 5, 0, 30))).toBe('2026-01-05');
  });
});

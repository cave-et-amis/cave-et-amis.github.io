import { describe, expect, it } from 'vitest';
import { cleanDocument } from '../../server/api/documents.ts';
import { Api } from '../../src/data/api.ts';
import { TINY_JPEG } from '../helpers/env.ts';
import { makeDevice } from '../helpers/push.ts';
import { totp } from '../helpers/totp.ts';
import { call, makeAiEnv, usageRows } from './setup.ts';

// Corrections de l'audit de sécurité du 01/11/2026, côté cave-api.

describe('V2 : cave-api exige la session vérifiée par le code quand il est activé', () => {
  it('mot de passe seul : refus de tout (sauf la clé publique du push), rien n’est compté ; avec le code : accepté', async () => {
    const env = await makeAiEnv();
    const a = await env.signUp('Bruno');
    const api = new Api(a.sb, { checker: () => env.client() });
    const path = await api.uploadPhoto(a.id, new Blob([TINY_JPEG], { type: 'image/jpeg' }));
    const e = await api.mfaEnroll();
    await api.mfaVerify(e.id, totp(e.secret));
    const sb = env.client();
    const { error } = await sb.auth.signInWithPassword({ email: a.email, password: a.password });
    expect(error).toBeNull();
    const phone = await makeDevice('https://fcm.googleapis.com/fcm/send/appareil-intrus');
    for (const body of [
      { action: 'push_subscribe', endpoint: phone.endpoint, p256dh: phone.p256dh, auth: phone.auth, label: 'Intrus' },
      { action: 'chat', message: 'Bonjour' },
      { action: 'identify_label', photo_path: path },
      { action: 'read_document', kind: 'receipt', photo_path: path },
      { action: 'status' },
      { action: 'nous_status' },
    ]) {
      expect(await call(sb, body)).toMatchObject({ ok: false, code: 'mfa_required' });
    }
    expect(await usageRows(env)).toEqual([]);
    expect((await env.db.query(`select 1 from push_subscriptions`)).rows).toEqual([]);
    expect(await call(sb, { action: 'push_key' })).toMatchObject({ ok: true });
    // La même personne avec sa session vérifiée (aal2).
    expect(await call(a.sb, { action: 'push_subscribe', endpoint: phone.endpoint, p256dh: phone.p256dh, auth: phone.auth, label: 'iPhone' })).toMatchObject({ ok: true });
  }, 60_000);
});

describe('V5 : documents d’achat', () => {
  it('ni e-mail, ni téléphone, ni IBAN, ni long numéro, dans aucun champ ; prix et millésimes gardés', () => {
    const r = cleanDocument(
      {
        is_readable: true,
        currency: 'EUR',
        uncertain: ['4970 1234 5678 9012', 'prix', 'jean@x.fr'],
        notes: 'Tél 06 12 34 56 78, +33 6 12 34 56 78, jean.dupont@exemple.fr, client 12345678',
        seller: 'FR76 3000 6000 0112 3456 7890 189',
        conditions: 'Carte 4970.1234.5678.9012',
        document_lines: [{ wine_name: 'Chablis 2021', producer: 'Domaine 0612345678', vintage: 2021, unit_price: 24.9 }],
      },
      new Date('2026-11-01T12:00:00Z'),
    );
    const all = JSON.stringify(r);
    expect(all).not.toMatch(/@/);
    expect(all).not.toMatch(/\d(?:[ .-]?\d){7,}/);
    expect(all).not.toMatch(/FR76/);
    expect(r.uncertain).toEqual(['prix']);
    expect(r.lines[0]).toMatchObject({ wine_name: 'Chablis 2021', vintage: 2021, unit_price: 24.9 });
  });

  it('la photo est effacée par le serveur après la lecture, même en cas d’échec', async () => {
    const env = await makeAiEnv();
    const a = await env.signUp('Bruno');
    const api = new Api(a.sb, { checker: () => env.client() });
    const path = await api.uploadPhoto(a.id, new Blob([TINY_JPEG], { type: 'image/jpeg' }));
    await call(a.sb, { action: 'read_document', kind: 'receipt', photo_path: path });
    expect((await env.db.query(`select 1 from storage.objects where name = $1`, [path])).rows).toEqual([]);
  }, 60_000);
});

describe('V11 : chemin de photo strict', () => {
  it('chemin encodé, sous-dossier ou dossier d’autrui : refusés', async () => {
    const env = await makeAiEnv();
    const a = await env.signUp('Bruno');
    const b = await env.signUp('Claire');
    for (const p of [`${a.id}/%2e%2e/${b.id}/x.jpg`, `${a.id}/sous/x.jpg`, `${a.id}/..\\x.jpg`, `${b.id}/x.jpg`, `${a.id}/`]) {
      expect(await call(a.sb, { action: 'identify_label', photo_path: p })).toMatchObject({ ok: false, code: 'forbidden' });
    }
  }, 60_000);
});

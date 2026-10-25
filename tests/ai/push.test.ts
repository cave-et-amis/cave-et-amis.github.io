import { describe, expect, it } from 'vitest';
import { TEST_URL } from '../helpers/env.ts';
import { createPushService, makeDevice, verifyVapid } from '../helpers/push.ts';
import { call, makeAiEnv, type AiEnv } from './setup.ts';

/** Appel de la tâche planifiée (en ligne : pg_net et pg_cron, avec le jeton de la base). */
async function cron(env: AiEnv, action: string, token?: string) {
  const t = token ?? (await env.db.query<{ cron_token: string }>(`select cron_token from nous_config where id = 1`)).rows[0].cron_token;
  const res = await env.handler(
    new Request(`${TEST_URL}/functions/v1/cave-api`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-token': t }, body: JSON.stringify({ action }) }),
  );
  return { status: res.status, ...((await res.json()) as Record<string, unknown>) };
}

async function setup(status?: (url: string) => number) {
  const service = createPushService(status);
  const env = await makeAiEnv({ pushFetch: service.fetch });
  const bruno = await env.signUp('Bruno');
  const claire = await env.signUp('Claire');
  await env.db.query(`update profiles set discoverable = true`);
  return { env, service, bruno, claire };
}

const subscribe = async (sb: Parameters<typeof call>[0], device: Awaited<ReturnType<typeof makeDevice>>, label = 'iPhone') =>
  call(sb, { action: 'push_subscribe', endpoint: device.endpoint, p256dh: device.p256dh, auth: device.auth, label });

describe('notifications push : serveur', () => {
  it('clés du serveur créées une seule fois ; la clé privée n’est jamais renvoyée', async () => {
    const { env, bruno, claire } = await setup();
    const a = await call(bruno.sb, { action: 'push_key' });
    const b = await call(claire.sb, { action: 'push_key' });
    expect(a.public_key).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(b.public_key).toBe(a.public_key);
    expect(JSON.stringify(a)).not.toContain('"d"');
    expect((await env.db.query(`select count(*)::int as n from push_config`)).rows).toEqual([{ n: 1 }]);
    // Sans session : refusé.
    expect((await call(env.client(), { action: 'push_key' })).code).toBe('not_authenticated');
  });

  it('abonnement vérifié : service de notifications connu et clés valables seulement', async () => {
    const { bruno } = await setup();
    const phone = await makeDevice('https://web.push.apple.com/QGuQyavXutnMH8abc');
    expect(await subscribe(bruno.sb, phone)).toMatchObject({ ok: true });
    for (const bad of [
      { ...phone, endpoint: 'https://exemple.test/push/abc' },
      { ...phone, endpoint: 'http://fcm.googleapis.com/fcm/send/abc' },
      { ...phone, p256dh: 'pas-une-cle' },
      { ...phone, auth: 'AAAA' },
    ]) {
      expect((await subscribe(bruno.sb, bad)).code).toBe('invalid');
    }
    const { data } = await bruno.sb.rpc('my_push_devices');
    expect(data).toMatchObject([{ label: 'iPhone', endpoint: phone.endpoint }]);
  });

  it('notification d’essai : chiffrée pour l’appareil, signée par le serveur, lisible par l’appareil seul', async () => {
    const { service, bruno } = await setup();
    const phone = await makeDevice('https://fcm.googleapis.com/fcm/send/telephone-de-bruno');
    await subscribe(bruno.sb, phone, 'Android');
    const key = (await call(bruno.sb, { action: 'push_key' })).public_key;
    expect(await call(bruno.sb, { action: 'push_test' })).toMatchObject({ ok: true, devices: 1, sent: 1 });
    expect(service.received).toHaveLength(1);
    const [m] = service.received;
    expect(m.url).toBe(phone.endpoint);
    expect(m.headers).toMatchObject({ 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '86400' });
    const vapid = await verifyVapid(m.headers.authorization);
    expect(vapid).toMatchObject({ valid: true, publicKey: key, claims: { aud: 'https://fcm.googleapis.com', sub: 'https://cave-et-amis.github.io' } });
    expect(JSON.parse(await phone.decrypt(m.body))).toMatchObject({ title: 'Cave & Amis', url: '#/reglages', tag: 'essai' });
    expect(new TextDecoder().decode(m.body)).not.toContain('essai');
    const { data } = await bruno.sb.rpc('my_push_devices');
    expect((data as { last_success_at: string | null }[])[0].last_success_at).not.toBeNull();
  });

  it('une demande de contact arrive sur les appareils de la personne, avec le bon texte et le bon écran', async () => {
    const { env, service, bruno, claire } = await setup();
    const phone = await makeDevice('https://fcm.googleapis.com/fcm/send/bruno-1');
    const laptop = await makeDevice('https://updates.push.services.mozilla.com/wpush/v2/bruno-2');
    await subscribe(bruno.sb, phone, 'Android');
    await subscribe(bruno.sb, laptop, 'Ordinateur');
    await claire.sb.rpc('send_friend_request', { p_to: bruno.id });
    expect(await cron(env, 'push_flush')).toMatchObject({ status: 200, ok: true, claimed: 1, sent: 1, failed: 0 });
    expect(service.received.map((r) => r.url).sort()).toEqual([phone.endpoint, laptop.endpoint].sort());
    for (const r of service.received) {
      const device = r.url === phone.endpoint ? phone : laptop;
      expect(JSON.parse(await device.decrypt(r.body))).toMatchObject({ title: 'Cave & Amis', body: 'Claire souhaite être en contact avec vous', url: '#/amis?onglet=invitations' });
    }
    // Rien de plus à envoyer ; Claire, sans appareil, ne reçoit rien quand Bruno répond.
    expect(await cron(env, 'push_flush')).toMatchObject({ claimed: 0 });
    const { data: req } = await bruno.sb.rpc('my_friend_requests');
    const accepted = await bruno.sb.rpc('respond_friend_request', { p_id: (req as { id: string }[])[0].id, p_accept: true });
    expect(accepted.error).toBeNull();
    expect((await env.db.query(`select kind from notifications where user_id = $1`, [claire.id])).rows).toEqual([{ kind: 'friend_accepted' }]);
    expect(await cron(env, 'push_flush')).toMatchObject({ claimed: 0 });
    expect(service.received).toHaveLength(2);
  });

  it('abonnement expiré (410) : l’appareil est retiré ; service en panne (500) : nouvel essai plus tard', async () => {
    const { env, bruno, claire } = await setup((url) => (url.endsWith('expire') ? 410 : 500));
    await subscribe(bruno.sb, await makeDevice('https://fcm.googleapis.com/fcm/send/expire'));
    await subscribe(bruno.sb, await makeDevice('https://fcm.googleapis.com/fcm/send/en-panne'));
    await claire.sb.rpc('send_friend_request', { p_to: bruno.id });
    expect(await cron(env, 'push_flush')).toMatchObject({ claimed: 1, sent: 0, failed: 1 });
    const { data } = await bruno.sb.rpc('my_push_devices');
    expect((data as { endpoint: string }[]).map((d) => d.endpoint)).toEqual(['https://fcm.googleapis.com/fcm/send/en-panne']);
    const [row] = (await env.db.query<{ attempts: number; due_later: boolean }>(`select attempts, next_attempt_at > now() as due_later from push_outbox`)).rows;
    expect(row).toEqual({ attempts: 1, due_later: true });
  });

  it('tâche planifiée : jeton exigé, actions limitées', async () => {
    const { env } = await setup();
    expect(await cron(env, 'push_flush', 'x'.repeat(64))).toMatchObject({ status: 403, code: 'forbidden' });
    expect(await cron(env, 'push_test')).toMatchObject({ status: 403, code: 'forbidden' });
    expect(await cron(env, 'push_flush')).toMatchObject({ status: 200, ok: true, claimed: 0 });
  });
});

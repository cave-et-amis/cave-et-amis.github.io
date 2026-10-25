// FAUX service de notifications push pour les tests d'interface UNIQUEMENT (jamais utilisé par l'application réelle).
// Il joue le rôle d'Apple ou de Google : chaque « appareil » de test a ses clés ; les messages reçus sont déchiffrés avec
// elles et la signature VAPID du serveur est vérifiée, ce qui contrôle toute la chaîne d'envoi.
import { createServer } from 'node:http';
import { makeDevice, verifyVapid } from '../tests/helpers/push.ts';

const PORT = Number(process.argv[2] ?? 54397);
const ORIGIN = `http://127.0.0.1:${PORT}`;
type Device = Awaited<ReturnType<typeof makeDevice>>;
const devices = new Map<string, Device>();
const messages = new Map<string, unknown[]>();

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify(body));
  };
  const url = new URL(req.url ?? '/', ORIGIN);
  const name = url.pathname.split('/')[2] ?? '';
  if (req.method === 'GET' && url.pathname === '/health') return send(200, { ok: true });
  // Un appareil de test : son adresse et ses clés publiques (à donner à l'application).
  if (req.method === 'GET' && url.pathname.startsWith('/device/')) {
    if (!devices.has(name)) devices.set(name, await makeDevice(`${ORIGIN}/push/${name}`));
    const d = devices.get(name)!;
    return send(200, { endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth });
  }
  if (req.method === 'GET' && url.pathname.startsWith('/messages/')) return send(200, messages.get(name) ?? []);
  // Envoi du serveur vers l'appareil.
  if (req.method === 'POST' && url.pathname.startsWith('/push/')) {
    const d = devices.get(name);
    if (!d) return send(410, { error: 'abonnement inconnu' });
    try {
      const vapid = await verifyVapid(String(req.headers.authorization ?? ''));
      const content = JSON.parse(await d.decrypt(new Uint8Array(Buffer.concat(chunks))));
      const list = messages.get(name) ?? [];
      list.push({ ...content, vapid: vapid.valid && vapid.claims.aud === ORIGIN, encoding: req.headers['content-encoding'], ttl: req.headers.ttl });
      messages.set(name, list);
      return send(201, {});
    } catch (e) {
      return send(400, { error: String(e) });
    }
  }
  send(404, { error: 'introuvable' });
}).listen(PORT, '127.0.0.1', () => console.log(`Faux service de notifications (tests) sur ${ORIGIN}`));

/* Cave & Amis — service worker : installation sur l'écran d'accueil et ouverture rapide de l'interface.
   Seuls les fichiers de l'application sont mis en cache, jamais les données : les appels à Supabase
   (autre origine) passent toujours directement par le réseau. */
const VERSION = 'cave-amis-v1';
const SHELL = ['./', './index.html', './config.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './apple-touch-icon.png',
  // Images de l'interface (cave en fond, logo, bouteille par défaut, Lia) : environ 95 Ko, disponibles hors ligne.
  './img/fond-cave-flou.webp', './img/logo-cave.webp', './img/bouteille-generique.webp', './img/lia-avatar.webp'];

async function cacheBuild() {
  try {
    const res = await fetch('./asset-manifest.json', { cache: 'no-store' });
    if (!res.ok) return;
    const { files } = await res.json();
    const cache = await caches.open(VERSION);
    await Promise.all(
      files.map(async (f) => {
        const url = new URL(f, self.registration.scope).href;
        if (!(await cache.match(url))) await cache.add(url).catch(() => undefined);
      }),
    );
  } catch (e) {
    /* hors ligne : nouvel essai à la prochaine ouverture */
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      await cache.addAll(SHELL).catch(() => undefined);
      await cacheBuild();
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      // Le modèle du studio photo (cave-modeles, 46 Mo) est gardé d'une version à l'autre.
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && !k.startsWith('cave-modeles')).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Fichiers versionnés : cache d'abord.
  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }
  // Page et configuration : réseau d'abord (mises à jour immédiates), cache si hors ligne.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && (req.mode === 'navigate' || SHELL.some((s) => url.pathname.endsWith(s.replace('./', '/'))))) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req.mode === 'navigate' ? './index.html' : req, copy));
          if (req.mode === 'navigate') event.waitUntil(cacheBuild());
        }
        return res;
      })
      .catch(() => caches.match(req.mode === 'navigate' ? './index.html' : req).then((hit) => hit || Response.error())),
  );
});

// Notifications push : le serveur envoie un message chiffré pour cet appareil ; le navigateur le déchiffre et le remet
// ici. Chaque message s'affiche (obligatoire sur iPhone) ; le toucher ouvre l'écran concerné.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const url = typeof data.url === 'string' && data.url.startsWith('#/') ? data.url : '#/notifications';
  event.waitUntil(
    self.registration.showNotification(typeof data.title === 'string' ? data.title : 'Cave & Amis', {
      body: typeof data.body === 'string' ? data.body : '',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: typeof data.tag === 'string' ? data.tag : undefined,
      lang: 'fr',
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '#/notifications';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((c) => c.url.startsWith(self.registration.scope));
      if (open) {
        // Application déjà ouverte : elle va d'elle-même sur l'écran (voir main.tsx).
        open.postMessage({ type: 'cave-open', url });
        await open.focus();
        return;
      }
      await self.clients.openWindow(new URL(url, self.registration.scope).href);
    })(),
  );
});

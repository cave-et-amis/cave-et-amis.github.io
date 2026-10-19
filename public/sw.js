/* Cave & Amis — service worker : installation sur l'écran d'accueil et ouverture rapide de l'interface.
   Seuls les fichiers de l'application sont mis en cache, jamais les données : les appels à Supabase
   (autre origine) passent toujours directement par le réseau. */
const VERSION = 'cave-amis-v1';
const SHELL = ['./', './index.html', './config.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './apple-touch-icon.png'];

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
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
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

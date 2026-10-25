/** État partagé de l'application connectée : données, personne connectée, actions avec gestion des erreurs. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Api, Snapshot } from './api';
import type { Cellar, CellarLink, Location, Lot, Profile, Wine } from '../domain/types';
import { errorCode, toMessage } from '../domain/errors';
import { deName } from '../domain/format';
import { useToast } from '../ui/kit';

type RunOptions = { success?: string; undo?: { label?: string; run: () => Promise<unknown> }; silent?: boolean; reload?: boolean };

export type StoreValue = {
  api: Api;
  local: boolean;
  userId: string;
  email: string;
  snapshot: Snapshot;
  me: Profile;
  /** Amis acceptés (profils). */
  friends: Profile[];
  profileName: (id: string | null | undefined) => string;
  wine: (id: string | null | undefined) => Wine | undefined;
  lotsOf: (wineId: string) => Lot[];
  cellar: (id: string | null | undefined) => Cellar | undefined;
  location: (id: string | null | undefined) => Location | undefined;
  /** Nom d'une cave ; pour une cave gérée avec son propriétaire : « Ma cave (cave de Bruno) ». */
  cellarLabel: (c: Cellar | null | undefined) => string;
  /** Personnes associées à une cave (et invitations en attente). */
  cellarPeople: (cellarId: string) => CellarLink[];
  reload: () => Promise<void>;
  /** Exécute une action : message de réussite, erreur traduite, rechargement des données. */
  run: <T>(fn: () => Promise<T>, opts?: RunOptions) => Promise<{ ok: true; value: T } | { ok: false; message: string; code?: string }>;
  online: boolean;
};

const StoreContext = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const s = useContext(StoreContext);
  if (!s) throw new Error('useStore hors du StoreProvider');
  return s;
}

export function StoreProvider({
  api,
  local,
  userId,
  email,
  snapshot,
  reload,
  children,
}: {
  api: Api;
  local: boolean;
  userId: string;
  email: string;
  snapshot: Snapshot;
  reload: () => Promise<void>;
  children: ReactNode;
}) {
  const toast = useToast();
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);

  const friends = useMemo(() => {
    const ids = new Set(snapshot.friendships.map((f) => (f.user_a === userId ? f.user_b : f.user_a)));
    return snapshot.profiles.filter((p) => ids.has(p.id));
  }, [snapshot.friendships, snapshot.profiles, userId]);

  const profileName = useCallback(
    (id: string | null | undefined) => {
      if (!id) return 'Quelqu’un';
      if (id === userId) return 'Vous';
      // Les personnes d'une cave partagée sont nommées même si elles ne sont (plus) dans mes amis.
      const link = snapshot.cellarLinks.find((l) => l.user_id === id || l.owner_id === id);
      return (
        snapshot.profiles.find((p) => p.id === id)?.display_name ??
        (link ? (link.user_id === id ? link.user_name : link.owner_name) : undefined) ??
        'Un ancien contact'
      );
    },
    [snapshot.profiles, snapshot.cellarLinks, userId],
  );

  const lotsByWine = useMemo(() => {
    const m = new Map<string, Lot[]>();
    for (const l of snapshot.lots) m.set(l.wine_id, [...(m.get(l.wine_id) ?? []), l]);
    return m;
  }, [snapshot.lots]);

  const value: StoreValue = {
    api,
    local,
    userId,
    email,
    snapshot,
    me: snapshot.me,
    friends,
    profileName,
    wine: (id) => snapshot.wines.find((w) => w.id === id),
    lotsOf: (wineId) => lotsByWine.get(wineId) ?? [],
    cellar: (id) => snapshot.cellars.find((c) => c.id === id),
    location: (id) => snapshot.locations.find((l) => l.id === id),
    cellarLabel: (c) => (!c ? '' : c.owner_id === userId ? c.name : `${c.name} (cave ${deName(profileName(c.owner_id))})`),
    cellarPeople: (cellarId) => snapshot.cellarLinks.filter((l) => l.cellar_id === cellarId),
    reload,
    run: useCallback<StoreValue['run']>(
      async (fn, opts = {}) => {
        try {
          const value = await fn();
          // L'action a réussi : un échec de rechargement (réseau) ne doit pas la faire passer pour ratée.
          if (opts.reload !== false) await reload().catch(() => undefined);
          if (opts.success) {
            const undo = opts.undo;
            toast(
              opts.success,
              undo
                ? {
                    action: {
                      label: undo.label ?? 'Annuler',
                      onClick: () =>
                        void undo
                          .run()
                          .then(reload)
                          .then(() => toast('C’est annulé.'))
                          .catch((e) => toast(toMessage(e), { tone: 'error' })),
                    },
                  }
                : undefined,
            );
          }
          return { ok: true as const, value };
        } catch (e) {
          const code = errorCode(e);
          const message = toMessage(e);
          await reload().catch(() => undefined);
          if (!opts.silent) toast(message, { tone: 'error' });
          return { ok: false as const, message, code };
        }
      },
      [reload, toast],
    ),
    online,
  };

  // Mises à jour : retour sur l'application, réseau, toutes les deux minutes si visible.
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void reloadRef.current().catch(() => undefined), 300);
    };
    const onVisible = () => document.visibilityState === 'visible' && soon();
    // Changement d'écran : données rafraîchies si elles datent de plus de 10 secondes (réponses des amis, invitations…).
    let last = Date.now();
    const onRoute = () => {
      if (Date.now() - last > 10_000) {
        last = Date.now();
        soon();
      }
    };
    window.addEventListener('hashchange', onRoute);
    const onOnline = () => {
      setOnline(true);
      soon();
    };
    const onOffline = () => setOnline(false);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const poll = setInterval(() => document.visibilityState === 'visible' && soon(), 120_000);
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('hashchange', onRoute);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

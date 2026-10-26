import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Api, Snapshot } from './data/api';
import { StoreProvider } from './data/store';
import { toMessage } from './domain/errors';
import { isLegalKind, type LegalPending } from './domain/legal';
import { parseMagicLink } from './domain/nous';
import { AuthScreen, DiscoverScreen, NewPasswordScreen, Showcase } from './features/auth/AuthScreen';
import { allowAutoAccept, clearPendingInvite, pendingInvite, pendingInviteAuto, savePendingInvite } from './features/friends/invite';
import { LegalProvider, loadPending, TermsGate } from './features/legal/LegalGate';
import { LegalScreen } from './features/legal/LegalViews';
import { Shell } from './ui/Shell';
import { Button, ConfirmProvider, ToastProvider } from './ui/kit';
import { go, routeQuery, useRoute } from './ui/router';

export function App({ api, local }: { api: Api; local: boolean }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <Root api={api} local={local} />
      </ConfirmProvider>
    </ToastProvider>
  );
}

export function Loading({ text = 'Chargement…' }: { text?: string }) {
  return (
    <div className="loading-screen" role="status">
      <div>
        <span className="spinner" aria-hidden />
        {text}
      </div>
    </div>
  );
}

export function ConfigProblem({ problem }: { problem: string }) {
  return (
    <main className="auth">
      <div className="auth-card">
        <div className="brand">
          <img src="./icon.svg" alt="" />
          <h1>Cave &amp; Amis</h1>
        </div>
        <div className="card stack">
          <h2 className="title-font" style={{ fontSize: '1.2rem' }}>
            Configuration à compléter
          </h2>
          <p>{problem}</p>
          <p className="small muted">Voir le guide de mise en ligne (docs/INSTALLATION.md).</p>
        </div>
      </div>
    </main>
  );
}

function Root({ api, local }: { api: Api; local: boolean }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [recovery, setRecovery] = useState(false);
  // Lien d'invitation ouvert sans être connecté : la vitrine d'abord, puis la création de compte ou la connexion.
  const [authMode, setAuthMode] = useState<'signup' | 'login' | null>(null);
  const route = useRoute();
  const invite = /^\/ami\/([A-Za-z0-9-]{6,24})/.exec(route)?.[1] ?? null;

  useEffect(() => {
    if (invite) savePendingInvite(invite);
  }, [invite]);

  useEffect(() => {
    let alive = true;
    // Arrivée depuis l'agenda Nous (« Voir dans Cave & Amis ») : jeton retiré de l'adresse, puis connexion directe —
    // seulement si personne n'est connecté ici (on ne remplace jamais une session ouverte par une autre).
    const link = parseMagicLink(window.location.href);
    if (link) window.history.replaceState(window.history.state, '', link.cleanUrl);
    void (async () => {
      let s = await api.getSession();
      if (!s && link?.tokenHash) {
        const { data, error } = await api.sb.auth.verifyOtp({ type: 'magiclink', token_hash: link.tokenHash });
        if (!error) s = data.session;
      }
      if (alive) setSession(s);
    })();
    const { data } = api.sb.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setSession(s);
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, [api]);

  if (session === undefined) return <Loading />;
  if (session && recovery)
    return (
      <NewPasswordScreen
        api={api}
        onDone={() => {
          setRecovery(false);
          go('/', { replace: true });
        }}
      />
    );
  if (!session) {
    // Documents légaux : lisibles avant l'inscription.
    const legal = /^\/legal\/([a-z]+)/.exec(route)?.[1];
    if (isLegalKind(legal)) return <LegalScreen api={api} kind={legal} />;
    // « Découvrir l'application » sans compte : en visiteur, ou depuis la page d'un lien d'invitation (code gardé).
    if (route.startsWith('/decouvrir')) {
      const code = /^[A-Za-z0-9-]{6,24}$/.exec(routeQuery(route).get('code') ?? '')?.[0] ?? null;
      return (
        <DiscoverScreen
          onChoose={(mode) => {
            setAuthMode(mode);
            if (code) {
              savePendingInvite(code, true);
              go(`/ami/${code}`, { replace: true });
            } else go('/', { replace: true });
          }}
          onBack={code ? () => go(`/ami/${code}`, { replace: true }) : undefined}
        />
      );
    }
    if (invite && !authMode) {
      return (
        <Showcase
          api={api}
          code={invite}
          onDiscover={() => go(`/decouvrir?code=${invite}`)}
          onChoose={(mode) => {
            savePendingInvite(invite, true);
            setAuthMode(mode);
          }}
        />
      );
    }
    return <AuthScreen key={authMode ?? 'auth'} api={api} local={local} inviteCode={invite ?? pendingInvite()} initialMode={authMode ?? undefined} />;
  }
  return <SignedIn key={session.user.id} api={api} local={local} session={session} />;
}

function SignedIn({ api, local, session }: { api: Api; local: boolean; session: Session }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Documents à accepter ou à lire (null : pas encore vérifié).
  const [pending, setPending] = useState<LegalPending[] | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const refreshLegal = useCallback(async () => setPending(await loadPending(api)), [api]);

  const reload = useCallback(async () => {
    if (inflight.current) {
      again.current = true;
      return inflight.current;
    }
    const work = (async () => {
      do {
        again.current = false;
        const snap = await api.load(session.user.id);
        setSnapshot(snap);
        setError(null);
      } while (again.current);
    })();
    inflight.current = work;
    try {
      await work;
    } finally {
      inflight.current = null;
    }
  }, [api, session.user.id]);

  const start = useCallback(async () => {
    try {
      await Promise.all([reload(), refreshLegal()]);
      // Lien d'invitation ouvert avant la connexion : on y revient (venant de la vitrine, un lien de groupe ou
      // d'événement est accepté aussitôt, et l'on arrive directement dessus).
      const code = pendingInvite();
      if (code) {
        const auto = pendingInviteAuto();
        clearPendingInvite();
        if (auto) allowAutoAccept(code);
        if (auto || !window.location.hash.startsWith('#/ami/')) go(`/ami/${code}`, { replace: true });
      }
    } catch (e) {
      setError(toMessage(e));
    }
  }, [reload, refreshLegal]);

  useEffect(() => {
    void start();
  }, [start]);

  if (!snapshot || pending === null) {
    if (!error) return <Loading text="Ouverture de votre cave…" />;
    return (
      <main className="auth">
        <div className="auth-card">
          <div className="card stack">
            <p className="strong">Impossible de charger vos données</p>
            <p className="muted">{error}</p>
            <Button onClick={() => void start()}>Réessayer</Button>
            <Button variant="ghost" onClick={() => void api.signOut()}>
              Se déconnecter
            </Button>
          </div>
        </div>
      </main>
    );
  }

  // Conditions d'utilisation à accepter : rien d'autre tant qu'elles ne le sont pas (sauf export, suppression, déconnexion).
  const terms = pending.find((p) => p.mode === 'acceptation');
  return (
    <StoreProvider api={api} local={local} userId={session.user.id} email={session.user.email ?? ''} snapshot={snapshot} reload={reload}>
      <LegalProvider value={{ pending, refresh: refreshLegal }}>{terms ? <TermsGate item={terms} /> : <Shell />}</LegalProvider>
    </StoreProvider>
  );
}

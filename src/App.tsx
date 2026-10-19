import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Api, Snapshot } from './data/api';
import { StoreProvider } from './data/store';
import { toMessage } from './domain/errors';
import { AuthScreen, NewPasswordScreen } from './features/auth/AuthScreen';
import { clearPendingInvite, pendingInvite, savePendingInvite } from './features/friends/invite';
import { Shell } from './ui/Shell';
import { Button, ConfirmProvider, ToastProvider } from './ui/kit';
import { go, useRoute } from './ui/router';

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
  const route = useRoute();
  const invite = /^\/ami\/([A-Za-z0-9-]{6,24})/.exec(route)?.[1] ?? null;

  useEffect(() => {
    if (invite) savePendingInvite(invite);
  }, [invite]);

  useEffect(() => {
    let alive = true;
    void api.getSession().then((s) => alive && setSession(s));
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
  if (!session) return <AuthScreen api={api} local={local} inviteCode={invite ?? pendingInvite()} />;
  return <SignedIn key={session.user.id} api={api} local={local} session={session} />;
}

function SignedIn({ api, local, session }: { api: Api; local: boolean; session: Session }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const again = useRef(false);

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
      await reload();
      // Lien d'invitation ouvert avant la connexion : on y revient.
      const code = pendingInvite();
      if (code) {
        clearPendingInvite();
        if (!window.location.hash.startsWith('#/ami/')) go(`/ami/${code}`, { replace: true });
      }
    } catch (e) {
      setError(toMessage(e));
    }
  }, [reload]);

  useEffect(() => {
    void start();
  }, [start]);

  if (!snapshot) {
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

  return (
    <StoreProvider api={api} local={local} userId={session.user.id} email={session.user.email ?? ''} snapshot={snapshot} reload={reload}>
      <Shell />
    </StoreProvider>
  );
}

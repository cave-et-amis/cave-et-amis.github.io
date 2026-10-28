import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Api, Snapshot } from './data/api';
import { StoreProvider } from './data/store';
import { toMessage } from './domain/errors';
import { isLegalKind, type LegalPending } from './domain/legal';
import { parseMagicLink, pendingLink, startSession } from './domain/nous';
import { expiredMessage, parseEmailLink, SIGNUP_NETWORK } from './domain/emailLink';
import { AuthScreen, DiscoverScreen, LinkAccountScreen, NewPasswordScreen, Showcase } from './features/auth/AuthScreen';
import { MfaGate } from './features/auth/MfaGate';
import { allowAutoAccept, clearPendingInvite, pendingInvite, pendingInviteAuto, savePendingInvite } from './features/friends/invite';
import { LegalProvider, loadPending, TermsGate } from './features/legal/LegalGate';
import { LegalScreen } from './features/legal/LegalViews';
import { Shell } from './ui/Shell';
import { Button, ConfirmProvider, ToastProvider, useToast } from './ui/kit';
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

/** Page affichée dans le cadre (iframe) d'un autre site : l'application n'y démarre pas (voir main.tsx). */
export function Framed({ href }: { href: string }) {
  return (
    <main className="auth">
      <div className="auth-card">
        <div className="brand">
          <img src="./icon.svg" alt="" />
          <h1>Cave &amp; Amis</h1>
        </div>
        <div className="card stack">
          <p>Par sécurité, Cave &amp; Amis ne s’ouvre pas à l’intérieur d’un autre site.</p>
          <a className="btn btn-primary btn-block" href={href} target="_blank" rel="noopener noreferrer">
            Ouvrir Cave &amp; Amis dans son propre onglet
          </a>
        </div>
      </div>
    </main>
  );
}

function Root({ api, local }: { api: Api; local: boolean }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [recovery, setRecovery] = useState(false);
  // Lien reçu par e-mail déjà utilisé ou expiré : expliqué sur l'écran de connexion, au bon formulaire.
  const [linkError, setLinkError] = useState<{ text: string; mode: 'login' | 'forgot' } | null>(null);
  const toast = useToast();
  // Connexion par un lien venu de Nous : « Est-ce bien votre compte ? » avant d'entrer.
  const [confirmLink, setConfirmLink] = useState(false);
  // Lien d'invitation ouvert sans être connecté : la vitrine d'abord, puis la création de compte ou la connexion.
  const [authMode, setAuthMode] = useState<'signup' | 'login' | null>(null);
  const route = useRoute();
  const invite = /^\/ami\/([A-Za-z0-9-]{6,24})/.exec(route)?.[1] ?? null;

  useEffect(() => {
    if (invite) savePendingInvite(invite);
  }, [invite]);

  useEffect(() => {
    let alive = true;
    let started = false;
    // Arrivée depuis l'agenda Nous (« Voir dans Cave & Amis ») : jeton retiré de l'adresse, puis connexion par le lien —
    // seulement si personne n'est connecté ici (on ne remplace jamais une session ouverte par une autre).
    // Lien reçu par e-mail (mot de passe oublié, confirmation d'inscription, changement d'adresse) : jeton retiré de
    // l'adresse, puis vérifié ici (fonctionne sur tout appareil).
    const mail = parseEmailLink(window.location.href);
    if (mail) window.history.replaceState(window.history.state, '', mail.cleanUrl);
    const link = parseMagicLink(window.location.href);
    if (link) window.history.replaceState(window.history.state, '', link.cleanUrl);
    void (async () => {
      // Lien plus valable (jeton absent, refusé, ou erreur renvoyée par Supabase) : expliqué ensuite.
      let failed = Boolean(mail && !mail.tokenHash);
      if (mail?.tokenHash && mail.kind === 'recovery') {
        const s = await api.verifyRecovery(mail.tokenHash).catch(() => null);
        if (!alive) return;
        if (s) {
          started = true;
          setRecovery(true);
          setSession(s);
          return;
        }
        failed = true;
      } else if (mail?.tokenHash && mail.kind === 'signup') {
        // Réseau coupé : le lien n'a pas été essayé, il reste valable ; ce n'est pas un lien expiré.
        const s = await api.verifySignup(mail.tokenHash).catch(() => 'network' as const);
        if (!alive) return;
        if (s === 'network') setLinkError({ text: SIGNUP_NETWORK, mode: 'login' });
        else if (s) {
          started = true;
          setSession(s);
          const name = (s.user.user_metadata as { display_name?: string } | undefined)?.display_name?.trim();
          toast(`Adresse e-mail confirmée. Bienvenue sur Cave & Amis${name ? `, ${name}` : ''} ! 🍷`);
          return;
        } else failed = true;
      } else if (mail?.tokenHash && mail.kind === 'email_change') {
        const r = await api.verifyEmailChange(mail.tokenHash).catch(() => ({ result: 'expired' as const }));
        if (!alive) return;
        if (r.result === 'done') {
          started = true;
          setSession(r.session);
          toast(`Adresse e-mail changée : ${r.session.user.email ?? ''}`);
          return;
        }
        if (r.result === 'other') toast('Premier lien accepté : ouvrez aussi celui envoyé à votre autre adresse pour terminer le changement.', { tone: 'info' });
        else failed = true;
      }
      if (mail && failed) {
        const text = expiredMessage(mail.kind);
        setLinkError({ text, mode: mail.kind === 'recovery' || mail.kind === null ? 'forgot' : 'login' });
        // Connecté sur cet appareil : l'écran de connexion n'apparaît pas, le message passe en bandeau.
        if (mail.kind === 'email_change') toast(text, { tone: 'error' });
      }
      const start = await startSession({ getSession: () => api.getSession(), verify: (h) => api.verifyLink(h) }, link).catch(() => ({ session: null, confirm: false }));
      if (!alive) return;
      started = true;
      setConfirmLink(start.confirm);
      setSession(start.session);
    })();
    const { data } = api.sb.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SIGNED_OUT') {
        setConfirmLink(false);
        pendingLink.set(false);
      }
      // Pendant le démarrage (connexion par lien en cours), rien n'est montré avant la question. Après, une session
      // ouverte par un lien dans un autre onglet pose aussi la question ici.
      if (!started) return;
      if (s && pendingLink.get()) setConfirmLink(true);
      setSession(s);
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, [api]);

  // Session fermée depuis un autre appareil (« Déconnecter tous mes appareils ») : vérifiée à l'ouverture et à chaque
  // retour sur l'application ; supabase-js retire alors la session de cet appareil.
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    const check = () => {
      if (document.visibilityState === 'visible') api.checkSession().catch(() => undefined);
    };
    check();
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, [api, userId]);

  if (session === undefined) return <Loading />;
  // Ouvert par un lien venu de Nous : « Est-ce bien votre compte ? », avant même le code de double authentification.
  if (session && confirmLink)
    return (
      <LinkAccountScreen
        api={api}
        session={session}
        onContinue={() => {
          pendingLink.set(false);
          setConfirmLink(false);
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
    return (
      <AuthScreen
        key={authMode ?? 'auth'}
        api={api}
        local={local}
        inviteCode={invite ?? pendingInvite()}
        initialMode={linkError?.mode ?? authMode ?? undefined}
        notice={linkError?.text}
      />
    );
  }
  // Double authentification activée : le code d'abord, avant même un nouveau mot de passe (le serveur exige alors une
  // session vérifiée par le code pour le changer).
  return (
    <MfaGate key={session.user.id} api={api} session={session} fallback={<Loading text="Ouverture de votre cave…" />}>
      {recovery ? (
        <NewPasswordScreen
          api={api}
          onDone={() => {
            setRecovery(false);
            go('/', { replace: true });
          }}
        />
      ) : (
        <SignedIn api={api} local={local} session={session} />
      )}
    </MfaGate>
  );
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

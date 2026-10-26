import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { CalendarHeart, Eye, EyeOff, Users, Wine } from 'lucide-react';
import type { Api } from '../../data/api';
import { AppError, toMessage } from '../../domain/errors';
import { deName } from '../../domain/format';
import { MIN_AGE, type LegalDoc } from '../../domain/legal';
import { pendingLink } from '../../domain/nous';
import { PASSWORD_HINT, passwordProblem } from '../../domain/password';
import { Button, Check, Field, InlineLoading, Notice, Segmented } from '../../ui/kit';
import { go } from '../../ui/router';
import { inviteHeadline } from '../friends/invite';
import { LegalLinks, LegalSheet, useLegalDocs } from '../legal/LegalViews';
import { useCaptcha } from './Captcha';
import { Discover } from './Discover';

type Mode = 'login' | 'signup' | 'forgot';
type InviteInfo = Awaited<ReturnType<Api['inviteInfo']>>;

function Brand() {
  return (
    <div className="brand">
      <img src="./icon.svg" alt="" />
      <h1>Cave &amp; Amis</h1>
      <p>Votre cave, vos amis, la bonne bouteille au bon moment.</p>
    </div>
  );
}

function PasswordInput({ id, value, onChange, autoComplete }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input
        id={id}
        className="input"
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        minLength={8}
        required
        style={{ paddingRight: 52 }}
      />
      <button
        type="button"
        className="icon-btn"
        style={{ position: 'absolute', right: 2, top: 2 }}
        aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
        onClick={() => setShow((s) => !s)}
      >
        {show ? <EyeOff /> : <Eye />}
      </button>
    </div>
  );
}

/** Les trois idées de l'application, pour une personne invitée qui ne la connaît pas. */
const SHOWCASE: { icon: ReactNode; title: string; text: string }[] = [
  { icon: <Wine />, title: 'Organisez votre cave', text: 'Chaque bouteille avec son emplacement, le bon moment pour l’ouvrir et vos notes. Tout est privé par défaut.' },
  { icon: <Users />, title: 'Partagez avec vos amis', text: 'Vous choisissez à qui vous ouvrez votre cave, et quelles bouteilles vous montrez. Invitez par un simple lien.' },
  { icon: <CalendarHeart />, title: 'Préparez vos événements', text: 'Dîners et dégustations : invitez, prévoyez les vins ensemble, et demandez conseil à Lia, la sommelière de l’application.' },
];

const SHOWCASE_DETAIL: Record<string, string> = {
  discovery: 'Vous serez en contact, sans voir la cave l’un de l’autre : chacun peut ouvrir la sienne plus tard, s’il le souhaite.',
  friend: 'Cette personne vous ouvre sa cave : vous verrez les bouteilles partagées avec ses amis, en lecture seule. La vôtre reste privée tant que vous ne l’ouvrez pas.',
  selection: 'Cette personne vous montre une sélection de bouteilles de sa cave, en lecture seule. La vôtre reste privée tant que vous ne l’ouvrez pas.',
  group: 'Votre compte créé, vous arrivez directement dans le groupe. Votre cave reste privée.',
  event: 'Votre compte créé, vous arrivez directement sur l’événement pour répondre et voir les vins prévus. Votre cave reste privée.',
};

/**
 * Page d'accueil d'un lien d'invitation (#/ami/CODE) pour une personne non connectée : qui invite et à quoi, ce qu'est
 * l'application, puis « Découvrir l'application », « Créer mon compte » ou « Me connecter ». Rien de privé n'y figure :
 * seulement le prénom de la personne qui invite, et le nom du groupe ou le titre et la date de l'événement.
 */
export function Showcase({ api, code, onChoose, onDiscover }: { api: Api; code: string; onChoose: (mode: 'signup' | 'login') => void; onDiscover: () => void }) {
  const [info, setInfo] = useState<InviteInfo | null>(null);
  useEffect(() => {
    let alive = true;
    void api
      .inviteInfo(code)
      .then((r) => alive && setInfo(r))
      .catch(() => alive && setInfo({ status: 'invalid' }));
    return () => {
      alive = false;
    };
  }, [api, code]);
  return (
    <main className="auth">
      <div className="auth-card">
        <div className="brand">
          <img src="./icon.svg" alt="" />
          <h1>🍷 Bienvenue dans Cave &amp; Amis !</h1>
          <p>Découvrez une application conviviale pour organiser vos bouteilles, retrouver vos amis et partager de bons moments autour de dégustations et de repas.</p>
        </div>
        <section className="card stack center" aria-live="polite">
          {info === null ? (
            <InlineLoading />
          ) : info.status === 'pending' ? (
            <>
              <h2 className="title-font" style={{ fontSize: '1.3rem' }}>
                {inviteHeadline(info)}
              </h2>
              <p className="muted">{SHOWCASE_DETAIL[info.kind === 'friend' && info.selection ? 'selection' : (info.kind ?? 'discovery')]}</p>
            </>
          ) : (
            <Notice tone="warn">Ce lien d’invitation n’est plus valable. Vous pouvez tout de même créer votre compte, puis demander un nouveau lien.</Notice>
          )}
        </section>
        <div className="showcase-cards">
          {SHOWCASE.map((c) => (
            <div key={c.title} className="card showcase-card">
              <span className="notification-icon" aria-hidden>
                {c.icon}
              </span>
              <div>
                <h3>{c.title}</h3>
                <p className="small muted">{c.text}</p>
              </div>
            </div>
          ))}
        </div>
        <Button variant="secondary" block onClick={onDiscover}>
          Découvrir l’application
        </Button>
        <Button size="lg" block onClick={() => onChoose('signup')}>
          Créer mon compte
        </Button>
        <Button variant="ghost" block onClick={() => onChoose('login')}>
          Me connecter
        </Button>
        <p className="small faint center">Gratuit. Vos caves et vos notes sont privées par défaut : vous choisissez ce que vous partagez.</p>
      </div>
    </main>
  );
}

/** « Découvrir l'application » sans compte (visiteur, ou personne invitée avant de s'inscrire). */
export function DiscoverScreen({ onChoose, onBack }: { onChoose: (mode: 'signup' | 'login') => void; onBack?: () => void }) {
  return (
    <main className="auth">
      <div className="auth-card">
        <Brand />
        <Discover
          actions={
            <>
              <Button size="lg" block onClick={() => onChoose('signup')}>
                Créer mon compte
              </Button>
              <Button variant="secondary" block onClick={() => onChoose('login')}>
                Me connecter
              </Button>
            </>
          }
        />
        {onBack && (
          <Button variant="ghost" block onClick={onBack}>
            Revenir à l’invitation
          </Button>
        )}
      </div>
    </main>
  );
}

export function AuthScreen({ api, local, inviteCode, initialMode }: { api: Api; local: boolean; inviteCode: string | null; initialMode?: 'signup' | 'login' }) {
  const [mode, setMode] = useState<Mode>(initialMode ?? (inviteCode ? 'signup' : 'login'));
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<InviteInfo | null>(null);
  // Inscription : âge minimum et conditions d'utilisation (case jamais cochée d'avance), versions notées avec le compte.
  const legal = useLegalDocs(api);
  const cgu = legal.byKind('cgu');
  const policy = legal.byKind('confidentialite');
  const [accepted, setAccepted] = useState(false);
  const [reading, setReading] = useState<LegalDoc | null>(null);
  // Contrôle anti-robots, si une clé Turnstile est configurée : un jeton par essai, pour les trois formulaires.
  const captcha = useCaptcha(api.captchaSiteKey);

  useEffect(() => {
    if (!inviteCode) return;
    void api
      .inviteInfo(inviteCode)
      .then((r) => r.status === 'pending' && setInvitation(r))
      .catch(() => undefined);
  }, [api, inviteCode]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === 'login') await api.signIn(email, password, captcha.take());
      else if (mode === 'signup') {
        if (!name.trim()) throw new Error('name');
        const problem = passwordProblem(password);
        if (problem) throw new AppError(problem, 'weak_password');
        if (!accepted) throw new Error('terms');
        const { needsConfirmation } = await api.signUp(
          name,
          email,
          password,
          { cgu_version: cgu?.version, confidentialite_version: policy?.version },
          captcha.take(),
        );
        if (needsConfirmation) setInfo('Compte créé. Ouvrez le lien reçu par e-mail pour confirmer votre adresse, puis connectez-vous.');
      } else {
        await api.resetPassword(email, captcha.take());
        setInfo('Si un compte existe avec cette adresse, un e-mail vient de partir avec un lien pour choisir un nouveau mot de passe.');
      }
    } catch (err) {
      const m = (err as Error).message;
      setError(
        m === 'name'
          ? 'Indiquez votre prénom : il sera visible par vos amis.'
          : m === 'terms'
            ? cgu
              ? `Cochez la case : l’application est réservée aux personnes de ${MIN_AGE} ans ou plus qui acceptent les conditions d’utilisation.`
              : `Cochez la case : l’application est réservée aux personnes de ${MIN_AGE} ans ou plus.`
            : toMessage(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <div className="auth-card">
        <Brand />
        {invitation && (
          <Notice tone="gold">
            <strong>{inviteHeadline(invitation)}.</strong> {mode === 'login' ? 'Connectez-vous' : 'Créez votre compte'} pour répondre à l’invitation.
          </Notice>
        )}
        <div className="card stack">
          {mode !== 'forgot' && (
            <Segmented<Mode>
              label="Connexion ou création de compte"
              value={mode}
              onChange={(m) => {
                setMode(m);
                setError(null);
                setInfo(null);
              }}
              options={[
                { value: 'login', label: 'Se connecter' },
                { value: 'signup', label: 'Créer un compte' },
              ]}
            />
          )}
          {mode === 'forgot' && <h2 className="title-font" style={{ fontSize: '1.25rem' }}>Mot de passe oublié</h2>}
          <form className="form" onSubmit={submit} noValidate={false}>
            {mode === 'signup' && (
              <Field label="Votre prénom" htmlFor="name" hint="Visible par vos amis et les participants de vos événements.">
                <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" maxLength={40} required />
              </Field>
            )}
            <Field label="Adresse e-mail" htmlFor="email">
              <input id="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            </Field>
            {mode !== 'forgot' && (
              <Field label="Mot de passe" htmlFor="password" hint={mode === 'signup' ? PASSWORD_HINT : undefined}>
                <PasswordInput id="password" value={password} onChange={setPassword} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
              </Field>
            )}
            {mode === 'signup' && (
              <div className="stack-sm">
                <Check
                  checked={accepted}
                  onChange={setAccepted}
                  label={cgu ? `J’ai ${MIN_AGE} ans ou plus et j’accepte les conditions d’utilisation` : `J’ai ${MIN_AGE} ans ou plus`}
                />
                {(cgu || policy) && (
                  <p className="small muted">
                    {cgu && (
                      <>
                        <button type="button" className="link-btn" onClick={() => setReading(cgu)}>
                          Lire les conditions d’utilisation
                        </button>
                        {policy ? ' · ' : ''}
                      </>
                    )}
                    {policy && (
                      <>
                        Vos données sont traitées comme indiqué dans la{' '}
                        <button type="button" className="link-btn" onClick={() => setReading(policy)}>
                          politique de confidentialité
                        </button>
                        .
                      </>
                    )}
                  </p>
                )}
              </div>
            )}
            {captcha.view}
            {error && (
              <p className="field error" role="alert" style={{ color: 'var(--danger)', fontWeight: 650 }}>
                {error}
              </p>
            )}
            {info && <Notice tone="success">{info}</Notice>}
            <Button type="submit" size="lg" block loading={busy}>
              {mode === 'login' ? 'Se connecter' : mode === 'signup' ? 'Créer mon compte' : 'Recevoir le lien'}
            </Button>
          </form>
          {mode === 'login' && (
            <Button variant="ghost" onClick={() => setMode('forgot')}>
              Mot de passe oublié ?
            </Button>
          )}
          {mode === 'forgot' && (
            <Button variant="ghost" onClick={() => setMode('login')}>
              Revenir à la connexion
            </Button>
          )}
        </div>
        {local && (
          <Notice tone="gold">
            Serveur local de test : rien n’est en ligne. Avec <code>npm run local -- --demo</code>, des comptes de démonstration sont créés
            (identifiants dans le README et le terminal du serveur local).
          </Notice>
        )}
        <Button variant="ghost" onClick={() => go('/decouvrir')}>
          Découvrir l’application sans compte
        </Button>
        <p className="small faint center">Vos caves et vos notes sont privées par défaut : vous choisissez ce que vous partagez.</p>
        <LegalLinks />
      </div>
      {reading && <LegalSheet doc={reading} onClose={() => setReading(null)} />}
    </main>
  );
}

export function NewPasswordScreen({ api, onDone }: { api: Api; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="auth">
      <div className="auth-card">
        <Brand />
        <form
          className="card form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const problem = passwordProblem(password);
              if (problem) throw new AppError(problem, 'weak_password');
              await api.updatePassword(password);
              onDone();
            } catch (err) {
              setError(toMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <h2 className="title-font" style={{ fontSize: '1.25rem' }}>
            Choisissez un nouveau mot de passe
          </h2>
          <Field label="Nouveau mot de passe" htmlFor="np" hint={PASSWORD_HINT} error={error}>
            <PasswordInput id="np" value={password} onChange={setPassword} autoComplete="new-password" />
          </Field>
          <Button type="submit" block size="lg" loading={busy}>
            Enregistrer
          </Button>
        </form>
      </div>
    </main>
  );
}

/**
 * Connexion par un lien venu de l'agenda Nous : avant d'entrer, la personne vérifie que c'est bien son compte (un lien
 * transmis par quelqu'un d'autre ouvre le compte de cette personne). « Ce n'est pas mon compte » déconnecte aussitôt.
 */
export function LinkAccountScreen({ api, session, onContinue }: { api: Api; session: Session; onContinue: () => void }) {
  const meta = session.user.user_metadata as { display_name?: string } | undefined;
  const [name, setName] = useState(meta?.display_name?.trim() || null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    api.displayName(session.user.id).then(
      (n) => {
        if (alive && n) setName(n);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [api, session.user.id]);
  const email = session.user.email ?? '';
  return (
    <main className="auth">
      <div className="auth-card">
        <Brand />
        <div className="card stack">
          <h2 className="title-font" style={{ fontSize: '1.25rem' }}>
            Est-ce bien votre compte ?
          </h2>
          <p>Vous êtes connecté au compte {name ? `${deName(name)} (${email})` : email}.</p>
          <p className="small muted">Ce lien de connexion vient de l’agenda Nous. S’il vous a été transmis par quelqu’un d’autre, choisissez « Ce n’est pas mon compte ».</p>
          <Button block size="lg" disabled={busy} onClick={onContinue}>
            Continuer
          </Button>
          <Button
            block
            variant="secondary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await api.signOut();
              // Session restée ouverte (réseau) : la question reste posée.
              if (await api.getSession()) {
                pendingLink.set(true);
                setBusy(false);
              }
            }}
          >
            Ce n’est pas mon compte
          </Button>
        </div>
      </div>
    </main>
  );
}

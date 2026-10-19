import { useEffect, useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { Api } from '../../data/api';
import { toMessage } from '../../domain/errors';
import { Button, Field, Notice, Segmented } from '../../ui/kit';

type Mode = 'login' | 'signup' | 'forgot';

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

export function AuthScreen({ api, local, inviteCode }: { api: Api; local: boolean; inviteCode: string | null }) {
  const [mode, setMode] = useState<Mode>(inviteCode ? 'signup' : 'login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [inviter, setInviter] = useState<string | null>(null);

  useEffect(() => {
    if (!inviteCode) return;
    void api
      .inviteInfo(inviteCode)
      .then((r) => r.status === 'pending' && setInviter(r.inviter_name ?? null))
      .catch(() => undefined);
  }, [api, inviteCode]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === 'login') await api.signIn(email, password);
      else if (mode === 'signup') {
        if (!name.trim()) throw new Error('name');
        const { needsConfirmation } = await api.signUp(name, email, password);
        if (needsConfirmation) setInfo('Compte créé. Ouvrez le lien reçu par e-mail pour confirmer votre adresse, puis connectez-vous.');
      } else {
        await api.resetPassword(email);
        setInfo('Si un compte existe avec cette adresse, un e-mail vient de partir avec un lien pour choisir un nouveau mot de passe.');
      }
    } catch (err) {
      setError((err as Error).message === 'name' ? 'Indiquez votre prénom : il sera visible par vos amis.' : toMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <div className="auth-card">
        <Brand />
        {inviter && (
          <Notice tone="gold">
            <strong>{inviter}</strong> vous invite à rejoindre ses amis. {mode === 'login' ? 'Connectez-vous' : 'Créez votre compte'} pour répondre à
            l’invitation.
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
              <Field label="Mot de passe" htmlFor="password" hint={mode === 'signup' ? '8 caractères au minimum.' : undefined}>
                <PasswordInput id="password" value={password} onChange={setPassword} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
              </Field>
            )}
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
            Serveur local de test. Avec <code>npm run local -- --demo</code>, des comptes de démonstration existent : alex@demo.local, camille@demo.local,
            sam@demo.local (mot de passe : demo-cave-2026).
          </Notice>
        )}
        <p className="small faint center">Vos caves et vos notes sont privées par défaut : vous choisissez ce que vous partagez.</p>
      </div>
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
          <Field label="Nouveau mot de passe" htmlFor="np" hint="8 caractères au minimum." error={error}>
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

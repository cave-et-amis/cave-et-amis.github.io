/**
 * Double authentification à la connexion : un compte qui a activé un code (application d'authentification) et dont la
 * session n'est passée que par le mot de passe (niveau aal1) saisit son code à 6 chiffres avant d'entrer, y compris pour
 * une session reprise au lancement. Ce qui l'exige vraiment (administration, documents légaux) est vérifié par la base.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { LogOut } from 'lucide-react';
import type { Api } from '../../data/api';
import { toMessage } from '../../domain/errors';
import { Button, Field } from '../../ui/kit';

export function MfaGate({ api, session, fallback, children }: { api: Api; session: Session; fallback: ReactNode; children: ReactNode }) {
  // null : première vérification en cours (un rafraîchissement du jeton ne fait rien clignoter).
  const [required, setRequired] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void api
      .mfaRequired(session.access_token)
      // Niveau illisible : l'application s'ouvre, la base refusant toujours ce qui exige le code.
      .catch(() => false)
      .then((r) => alive && setRequired(r));
    return () => {
      alive = false;
    };
  }, [api, session.access_token]);
  if (required === null) return <>{fallback}</>;
  if (required) return <MfaCodeScreen api={api} />;
  return <>{children}</>;
}

function MfaCodeScreen({ api }: { api: Api }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Code juste : la session passe au niveau aal2 et l'application s'ouvre d'elle-même.
      await api.mfaSignIn(code);
    } catch (err) {
      setError(toMessage(err));
      setCode('');
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <div className="auth-card">
        <div className="brand">
          <img src="./icon.svg" alt="" />
          <h1>Code de double authentification</h1>
        </div>
        <form className="card form" onSubmit={submit}>
          <p className="small">
            Votre compte est protégé par une double authentification. Ouvrez votre application d’authentification (par exemple Google Authenticator ou
            Microsoft Authenticator) et saisissez le code à 6 chiffres affiché pour Cave &amp; Amis.
          </p>
          <Field label="Code à 6 chiffres" htmlFor="mfa-code" error={error}>
            <input
              id="mfa-code"
              className="input otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              autoFocus
            />
          </Field>
          <Button type="submit" size="lg" block loading={busy} disabled={code.length !== 6}>
            Valider
          </Button>
        </form>
        <Button variant="ghost" icon={<LogOut />} onClick={() => void api.signOut()}>
          Se déconnecter
        </Button>
        <p className="small faint center">
          Téléphone perdu ou changé : la double authentification se retire depuis le tableau de bord Supabase (voir le guide de sécurité, docs/SECURITE.md).
        </p>
      </div>
    </main>
  );
}

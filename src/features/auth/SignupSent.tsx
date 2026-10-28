import { useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import type { Api } from '../../data/api';
import { toMessage } from '../../domain/errors';
import { maskEmail, RESEND_COOLDOWN_SECONDS, resendWaitSeconds } from '../../domain/emailLink';
import { Button, Notice } from '../../ui/kit';
import { LegalLinks } from '../legal/LegalViews';
import { useCaptcha } from './Captcha';

/** Compte à rebours en secondes ; `start(n)` le relance. */
export function useCooldown(initial: number) {
  const [until, setUntil] = useState(() => Date.now() + initial * 1000);
  const [now, setNow] = useState(() => Date.now());
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  useEffect(() => {
    if (left <= 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [left]);
  return {
    left,
    start: (seconds: number) => {
      setNow(Date.now());
      setUntil(Date.now() + seconds * 1000);
    },
  };
}

/**
 * Après « Créer mon compte », quand Supabase demande de confirmer l'adresse : l'inscription est enregistrée et le lien
 * est parti. Supabase répond de la même façon pour une adresse déjà inscrite (sans rien envoyer) : la page le dit à
 * tout le monde, sans jamais révéler si l'adresse a un compte. Le renvoi attend 60 s entre deux demandes, comme le
 * serveur, qui reste seul juge.
 */
export function SignupSent({ api, email, onBack }: { api: Api; email: string; onBack: () => void }) {
  const cooldown = useCooldown(RESEND_COOLDOWN_SECONDS);
  const captcha = useCaptcha(api.captchaSiteKey);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  async function resend() {
    setBusy(true);
    setFeedback(null);
    try {
      await api.resendConfirmation(email, captcha.take());
      cooldown.start(RESEND_COOLDOWN_SECONDS);
      setFeedback({ tone: 'success', text: 'Nouvel e-mail demandé : il arrive en général en moins d’une minute. Seul le lien du dernier e-mail reçu fonctionne.' });
    } catch (err) {
      const wait = resendWaitSeconds(err);
      if (wait) {
        cooldown.start(wait);
        setFeedback({ tone: 'danger', text: `Un e-mail vient déjà de partir. Par sécurité, patientez ${wait} s avant d’en demander un autre.` });
      } else setFeedback({ tone: 'danger', text: toMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <div className="auth-card">
        <div className="brand">
          <span className="mail-emblem" aria-hidden>
            <Mail />
          </span>
          <h1>Bienvenue sur Cave &amp; Amis ! 🍷</h1>
        </div>
        <section className="card stack" aria-labelledby="sent-title">
          <h2 id="sent-title" className="title-font" style={{ fontSize: '1.25rem' }}>
            Merci pour votre inscription !
          </h2>
          <p>Un e-mail de confirmation vient de vous être envoyé. Pour activer votre compte, cliquez sur le lien présent dans cet e-mail.</p>
          <p className="sent-to">
            <span className="small muted">Adresse utilisée</span>
            <strong>{maskEmail(email)}</strong>
          </p>
          <ol className="sent-steps">
            <li>Vérifiez votre boîte de réception.</li>
            <li>Si vous ne trouvez pas le message, consultez vos courriers indésirables (spams).</li>
            <li>Cliquez sur le lien reçu pour confirmer votre adresse e-mail.</li>
          </ol>
          <p className="small muted">
            Le lien fonctionne une seule fois, sur n’importe quel appareil. Si un compte existe déjà avec cette adresse, aucun nouvel e-mail n’est
            envoyé : connectez-vous, ou choisissez « Mot de passe oublié ».
          </p>
          {captcha.view}
          <div aria-live="polite">{feedback && <Notice tone={feedback.tone}>{feedback.text}</Notice>}</div>
          <Button variant="secondary" block loading={busy} disabled={cooldown.left > 0} onClick={resend}>
            {cooldown.left > 0 ? `Renvoyer l’e-mail de confirmation (${cooldown.left} s)` : 'Renvoyer l’e-mail de confirmation'}
          </Button>
          <Button variant="ghost" block onClick={onBack}>
            Retour à la connexion
          </Button>
        </section>
        <LegalLinks />
      </div>
    </main>
  );
}

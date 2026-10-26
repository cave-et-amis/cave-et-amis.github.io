/**
 * Réglages › Double authentification (administrateur) : en plus du mot de passe, un code à 6 chiffres donné par une
 * application d'authentification (TOTP, gratuit chez Supabase) est demandé à chaque connexion ; la base l'exige aussi pour
 * l'administration et la publication des documents légaux. Le QR code est dessiné ici, à partir de l'adresse otpauth://
 * (rien n'est envoyé à un autre service) ; la clé peut aussi être recopiée à la main.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, ShieldCheck, ShieldOff } from 'lucide-react';
import type { MfaEnrollment, MfaFactor } from '../../data/api';
import { useStore } from '../../data/store';
import { toMessage } from '../../domain/errors';
import { dateLong } from '../../domain/format';
import { QrCode } from '../../ui/QrCode';
import { Button, copyText, Field, InlineLoading, Notice, Sheet, useConfirm, useToast } from '../../ui/kit';

/** Clé en groupes de 4 caractères, plus facile à recopier. */
const keyGroups = (secret: string) => secret.replace(/(.{4})(?=.)/g, '$1 ');

export function MfaSection() {
  const { api, run } = useStore();
  const confirm = useConfirm();
  // undefined : vérification en cours ; null : désactivée.
  const [factor, setFactor] = useState<MfaFactor | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setFactor(await api.mfaFactor());
      setError(null);
    } catch (e) {
      setError(toMessage(e));
    }
  }, [api]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function disable(f: MfaFactor) {
    const ok = await confirm({
      title: 'Désactiver la double authentification ?',
      message: 'Le code ne sera plus demandé : le mot de passe seul protégera de nouveau le compte administrateur.',
      confirmLabel: 'Désactiver',
      danger: true,
    });
    if (!ok) return;
    const res = await run(() => api.mfaUnenroll(f.id), { success: 'Double authentification désactivée', reload: false });
    if (res.ok) await refresh();
  }

  return (
    <section className="card stack-sm" aria-labelledby="h-mfa">
      <div className="inline">
        <ShieldCheck aria-hidden style={{ color: 'var(--primary)' }} />
        <h2 id="h-mfa" className="section">
          Double authentification
        </h2>
      </div>
      <p className="small">
        Protège le compte administrateur : en plus du mot de passe, un code à 6 chiffres, donné par une application gratuite sur votre téléphone, est demandé à
        chaque connexion. Il est aussi exigé pour l’administration et la publication des documents légaux.
      </p>
      {error && <Notice tone="warn">{error}</Notice>}
      {factor === undefined ? (
        !error && <span className="muted small">Vérification…</span>
      ) : factor ? (
        <>
          <p className="small strong">Activée depuis le {dateLong(factor.updated_at)}.</p>
          <Button variant="secondary" icon={<ShieldOff />} onClick={() => void disable(factor)}>
            Désactiver la double authentification
          </Button>
        </>
      ) : (
        <>
          <p className="small strong">Désactivée.</p>
          <Button icon={<ShieldCheck />} onClick={() => setEnrolling(true)}>
            Activer la double authentification
          </Button>
        </>
      )}
      {enrolling && (
        <EnrollSheet
          onClose={() => setEnrolling(false)}
          onDone={async () => {
            setEnrolling(false);
            await refresh();
          }}
        />
      )}
    </section>
  );
}

/** Activation : QR code ou clé à recopier, puis premier code ; fermée avant la fin, l'activation commencée est retirée. */
function EnrollSheet({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const { api } = useStore();
  const toast = useToast();
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.mfaEnroll().then(
      (e) => {
        pending.current = e.id;
        if (alive) setEnrollment(e);
        else void api.mfaUnenroll(e.id).catch(() => undefined);
      },
      (e) => alive && setFailure(toMessage(e)),
    );
    return () => {
      alive = false;
      if (pending.current) void api.mfaUnenroll(pending.current).catch(() => undefined);
    };
  }, [api]);

  async function activate() {
    if (!enrollment) return;
    setBusy(true);
    setCodeError(null);
    try {
      await api.mfaVerify(enrollment.id, code);
      // Code actif : il ne doit plus être retiré à la fermeture.
      pending.current = null;
      toast('Double authentification activée');
      await onDone();
    } catch (e) {
      setCodeError(toMessage(e));
      setCode('');
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Activer la double authentification"
      footer={
        <Button loading={busy} disabled={!enrollment || code.length !== 6} onClick={() => void activate()}>
          Activer
        </Button>
      }
    >
      {failure ? (
        <Notice tone="danger">{failure}</Notice>
      ) : !enrollment ? (
        <InlineLoading />
      ) : (
        <div className="form">
          <ol className="help-steps">
            <li>Installez sur votre téléphone une application d’authentification gratuite, par exemple Google Authenticator ou Microsoft Authenticator.</li>
            <li>Dans cette application, ajoutez un compte, puis scannez ce QR code.</li>
          </ol>
          <QrCode text={enrollment.uri} label="QR code de la double authentification, à scanner avec l’application d’authentification" />
          <p className="small muted">
            Impossible de scanner (application sur ce même téléphone, par exemple) ? Choisissez « Saisir une clé » dans l’application et recopiez cette clé :
          </p>
          <div className="kbd-code mfa-key" aria-label="Clé à recopier dans l’application d’authentification">
            {keyGroups(enrollment.secret)}
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={<Copy />}
            onClick={async () => toast((await copyText(enrollment.secret)) ? 'Clé copiée' : 'Copie impossible : recopiez la clé à la main', { tone: 'info' })}
          >
            Copier la clé
          </Button>
          <ol className="help-steps" start={3}>
            <li>Saisissez le code à 6 chiffres que l’application affiche pour Cave &amp; Amis.</li>
          </ol>
          <Field label="Code à 6 chiffres" htmlFor="mfa-enroll-code" error={codeError}>
            <input
              id="mfa-enroll-code"
              className="input otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </Field>
          <Notice tone="warn">
            Gardez ce téléphone : sans lui, vous ne pourrez plus vous connecter. La double authentification se retire alors depuis le tableau de bord Supabase
            (voir le guide de sécurité, docs/SECURITE.md).
          </Notice>
        </div>
      )}
    </Sheet>
  );
}

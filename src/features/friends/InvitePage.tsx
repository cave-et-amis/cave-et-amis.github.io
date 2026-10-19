/** Réponse à une invitation reçue par lien (ou code saisi) : accepter ou refuser. */
import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { useStore } from '../../data/store';
import { toMessage } from '../../domain/errors';
import { Button, EmptyState, Field, InlineLoading, Notice } from '../../ui/kit';
import { go } from '../../ui/router';
import { clearPendingInvite } from './invite';

type Info = Awaited<ReturnType<ReturnType<typeof useStore>['api']['inviteInfo']>>;

export function InvitePage({ code: initial }: { code: string }) {
  const { api, run } = useStore();
  const [code, setCode] = useState(initial);
  const [typed, setTyped] = useState('');
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    clearPendingInvite();
    if (!code) return;
    let alive = true;
    setInfo(null);
    void api
      .inviteInfo(code)
      .then((r) => alive && setInfo(r))
      .catch((e) => alive && setError(toMessage(e)));
    return () => {
      alive = false;
    };
  }, [api, code]);

  if (!code) {
    return (
      <form
        className="card form"
        onSubmit={(e) => {
          e.preventDefault();
          setCode(typed.replace(/[^A-Za-z0-9]/g, '').toUpperCase());
        }}
      >
        <h2 className="section">J’ai reçu un code</h2>
        <Field label="Code d’invitation" htmlFor="inv-code" hint="10 caractères, avec ou sans tirets.">
          <input id="inv-code" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" autoComplete="off" />
        </Field>
        <Button type="submit">Continuer</Button>
      </form>
    );
  }
  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!info) return <InlineLoading />;
  if (done) {
    return (
      <EmptyState icon="🥂" title={done} action={<Button onClick={() => go('/amis', { replace: true })}>Voir mes amis</Button>}>
        Choisissez maintenant, bouteille par bouteille, ce que vous partagez avec vos amis (fiche du vin › Lot et partage).
      </EmptyState>
    );
  }
  if (info.is_self) {
    return (
      <EmptyState icon="✉️" title="C’est votre propre invitation" action={<Button onClick={() => go('/amis')}>Retour</Button>}>
        Envoyez ce lien à l’ami que vous souhaitez inviter.
      </EmptyState>
    );
  }
  if (info.status !== 'pending') {
    const text = {
      invalid: 'Ce code n’existe pas : vérifiez qu’il a été bien recopié.',
      expired: 'Cette invitation a expiré. Demandez un nouveau lien.',
      accepted: 'Cette invitation a déjà été utilisée.',
      declined: 'Cette invitation a été refusée.',
      revoked: 'Cette invitation a été annulée par son auteur.',
    }[info.status];
    return (
      <EmptyState icon="⌛" title="Invitation non valable" action={<Button onClick={() => go('/amis')}>Aller à mes amis</Button>}>
        {text}
      </EmptyState>
    );
  }
  return (
    <section className="card stack center">
      <div style={{ fontSize: '2.4rem' }} aria-hidden>
        🍷
      </div>
      <h2 className="section">{info.inviter_name} vous invite à devenir amis</h2>
      <p className="muted">
        Vous pourrez voir les bouteilles que chacun choisit de partager et organiser des dîners ensemble. Rien de votre cave n’est partagé sans votre accord.
      </p>
      {info.already_friends && <Notice tone="info">Vous êtes déjà amis.</Notice>}
      <Button
        size="lg"
        icon={<Check />}
        onClick={async () => {
          const res = await run(() => api.respondInvite(code, true));
          if (res.ok) setDone(`Vous êtes maintenant amis avec ${res.value.friend_name}`);
        }}
      >
        Accepter
      </Button>
      <Button
        variant="secondary"
        icon={<X />}
        onClick={async () => {
          const res = await run(() => api.respondInvite(code, false), { success: 'Invitation refusée' });
          if (res.ok) go('/', { replace: true });
        }}
      >
        Refuser
      </Button>
    </section>
  );
}

/**
 * Réponse à une invitation reçue par lien (ou code saisi) : accepter ou refuser. Selon le lien : une relation seule, la
 * cave de la personne qui invite, un groupe ou un événement. Venant de la vitrine (« auto »), un lien de groupe ou
 * d'événement est accepté aussitôt et l'on arrive directement dessus.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { useStore } from '../../data/store';
import { toMessage } from '../../domain/errors';
import { Button, Check as CheckBox, EmptyState, Field, InlineLoading, Notice } from '../../ui/kit';
import { go } from '../../ui/router';
import { autoAcceptAllowed, clearPendingInvite, forgetAutoAccept, inviteHeadline } from './invite';

type Info = Awaited<ReturnType<ReturnType<typeof useStore>['api']['inviteInfo']>>;
type Accepted = Awaited<ReturnType<ReturnType<typeof useStore>['api']['respondInvite']>>;

const DETAIL: Record<string, string> = {
  discovery: 'Vous serez en contact : vous pourrez vous inviter à des événements et à des groupes. Aucune cave n’est ouverte ; chacun pourra ouvrir la sienne plus tard.',
  friend: 'Cette personne vous ouvre sa cave : vous verrez les bouteilles partagées avec ses amis, en lecture seule. Votre cave reste privée tant que vous ne l’ouvrez pas.',
  selection: 'Cette personne vous montre une sélection de bouteilles de sa cave, en lecture seule. Votre cave reste privée tant que vous ne l’ouvrez pas.',
  group: 'Vous entrerez dans le groupe : vous verrez ses bouteilles, ses soirées et ses envies. Votre cave reste privée.',
  event: 'Vous serez invité à l’événement, avec ses vins prévus. Votre cave reste privée.',
};

export function InvitePage({ code: initial }: { code: string }) {
  const { api, run, relation } = useStore();
  const [code, setCode] = useState(initial);
  // Venant de la vitrine sur cet appareil seulement (jamais par l'adresse).
  const auto = autoAcceptAllowed(code);
  const [typed, setTyped] = useState('');
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Accepted | null>(null);
  const [openMine, setOpenMine] = useState(false);
  const [busy, setBusy] = useState(false);
  const autoTried = useRef(false);

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

  async function accept() {
    setBusy(true);
    const res = await run(() => api.respondInvite(code, true));
    setBusy(false);
    if (!res.ok) return;
    // Groupe ou événement : on y va directement.
    if (res.value.kind === 'group' && res.value.target_id) go(`/groupes/${res.value.target_id}`, { replace: true });
    else if (res.value.kind === 'event' && res.value.target_id) go(`/evenements/${res.value.target_id}`, { replace: true });
    else setDone(res.value);
  }

  useEffect(() => {
    if (!auto || autoTried.current || info?.status !== 'pending' || info.is_self) return;
    if (info.kind !== 'group' && info.kind !== 'event') return;
    autoTried.current = true;
    forgetAutoAccept(code);
    void accept();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, info]);

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
    const name = done.friend_name;
    // Lien « ami » : la cave de la personne qui invite m'est ouverte ; je peux ouvrir la mienne en retour (non coché).
    const offerMine = done.kind === 'friend' && !relation(done.friend_id)?.they_see_mine;
    const selection = done.kind === 'friend' && info.selection === true;
    return (
      <section className="card stack center">
        <div style={{ fontSize: '2.4rem' }} aria-hidden>
          🥂
        </div>
        <h2 className="section">
          {selection ? `${name} vous montre une sélection de sa cave` : done.kind === 'friend' ? `${name} vous a ouvert sa cave` : `Vous êtes en contact avec ${name}`}
        </h2>
        <p className="muted">
          {selection
            ? 'Vous voyez maintenant les bouteilles choisies pour vous, en lecture seule. Votre cave, elle, reste privée.'
            : done.kind === 'friend'
            ? 'Vous voyez maintenant les bouteilles partagées avec ses amis, en lecture seule. Votre cave, elle, reste privée.'
            : 'Vous pouvez vous inviter à des événements et à des groupes. Aucune cave n’est ouverte.'}
        </p>
        {offerMine && (
          <div style={{ textAlign: 'left' }}>
            <CheckBox
              checked={openMine}
              onChange={setOpenMine}
              label={`Ouvrir aussi votre cave à ${name} ?`}
              hint={`${name} verra les bouteilles que vous partagez avec vos amis (jamais vos bouteilles privées). Vous pourrez la refermer à tout moment.`}
            />
          </div>
        )}
        <Button
          size="lg"
          loading={busy}
          onClick={async () => {
            if (offerMine && openMine) {
              setBusy(true);
              const res = await run(() => api.grantCellarAccess(done.friend_id), { success: `Votre cave est ouverte à ${name}` });
              setBusy(false);
              if (!res.ok) return;
            }
            go(`/amis/${done.friend_id}`, { replace: true });
          }}
        >
          Continuer
        </Button>
      </section>
    );
  }
  if (info.is_self) {
    return (
      <EmptyState icon="✉️" title="C’est votre propre invitation" action={<Button onClick={() => go('/amis')}>Retour</Button>}>
        Envoyez ce lien à la personne que vous souhaitez inviter.
      </EmptyState>
    );
  }
  if (info.status !== 'pending') {
    const text = {
      invalid: 'Ce code n’existe pas : vérifiez qu’il a été bien recopié.',
      expired: 'Cette invitation a expiré. Demandez un nouveau lien.',
      accepted: 'Vous avez déjà accepté cette invitation.',
      used: 'Cette invitation a déjà servi. Demandez un nouveau lien.',
      declined: 'Vous avez refusé cette invitation.',
      revoked: 'Cette invitation a été annulée par son auteur.',
    }[info.status];
    return (
      <EmptyState icon="⌛" title={info.status === 'accepted' ? 'Invitation déjà acceptée' : 'Invitation non valable'} action={<Button onClick={() => go('/amis')}>Aller à mes amis</Button>}>
        {text}
      </EmptyState>
    );
  }
  if (auto && busy) return <InlineLoading text="Vous rejoignez l’invitation…" />;
  return (
    <section className="card stack center">
      <div style={{ fontSize: '2.4rem' }} aria-hidden>
        🍷
      </div>
      <h2 className="section">{inviteHeadline(info)}</h2>
      <p className="muted">{DETAIL[info.kind === 'friend' && info.selection ? 'selection' : (info.kind ?? 'discovery')]}</p>
      {info.already_friends && (info.kind === 'discovery' || !info.kind) && <Notice tone="info">Vous êtes déjà en contact.</Notice>}
      <Button size="lg" icon={<Check />} loading={busy} onClick={() => void accept()}>
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

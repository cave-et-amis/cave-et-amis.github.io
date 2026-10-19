import { useEffect, useMemo, useState } from 'react';
import { Copy, Search, Share2, UserMinus, UserPlus } from 'lucide-react';
import type { SharedLot } from '../../domain/types';
import { useStore } from '../../data/store';
import { dateLong } from '../../domain/format';
import { fold, vintageLabel } from '../../domain/wine';
import { Avatar, Button, copyText, EmptyState, InlineLoading, Notice, Sheet, useConfirm, useToast } from '../../ui/kit';
import { go } from '../../ui/router';
import { inviteLink, prettyCode } from './invite';
import { SharedItem } from './SharedItem';

export function FriendsPage() {
  const { snapshot, friends, api, run, userId } = useStore();
  const confirm = useConfirm();
  const [invite, setInvite] = useState<{ code: string; expires_at: string } | null>(null);
  const [shared, setShared] = useState<SharedLot[] | null>(null);
  const [q, setQ] = useState('');
  const friendKey = friends.map((f) => f.id).join(',');

  useEffect(() => {
    let alive = true;
    void api
      .sharedLots(null)
      .then((rows) => alive && setShared(rows))
      .catch(() => alive && setShared([]));
    return () => {
      alive = false;
    };
  }, [api, friendKey]);

  const pending = snapshot.invites.filter((i) => i.inviter_id === userId && i.status === 'pending' && new Date(i.expires_at) > new Date());
  const filtered = useMemo(() => {
    const words = fold(q).split(/\s+/).filter(Boolean);
    return (shared ?? []).filter((s) => words.every((w) => fold([s.name, s.producer, s.domaine, s.region, s.appellation, s.owner_name, vintageLabel(s)].join(' ')).includes(w)));
  }, [shared, q]);
  const countFor = (id: string) => (shared ?? []).filter((s) => s.owner_id === id).length;

  async function createInvite() {
    const res = await run(() => api.createInvite(), { reload: true });
    if (res.ok) setInvite({ code: res.value.code, expires_at: res.value.expires_at });
  }

  return (
    <>
      <section className="card stack">
        <div className="inline">
          <UserPlus aria-hidden style={{ color: 'var(--primary)' }} />
          <h2 className="section">Inviter un ami</h2>
        </div>
        <p className="muted small">
          Envoyez-lui un lien (SMS, WhatsApp, e-mail). Une fois l’invitation acceptée, il ne verra que les bouteilles que vous choisissez de partager.
        </p>
        <Button icon={<Share2 />} onClick={() => void createInvite()}>
          Créer un lien d’invitation
        </Button>
        <Button variant="ghost" onClick={() => go('/ami')}>
          J’ai reçu un code
        </Button>
        {pending.length > 0 && (
          <p className="small faint">
            {pending.length} invitation{pending.length > 1 ? 's' : ''} en attente de réponse.{' '}
            <button
              type="button"
              className="btn-ghost"
              style={{ border: 0, background: 'none', color: 'var(--primary)', cursor: 'pointer', fontWeight: 700, padding: 0 }}
              onClick={async () => {
                if (!(await confirm({ title: 'Annuler les invitations en attente ?', message: 'Les liens déjà envoyés ne fonctionneront plus.', confirmLabel: 'Annuler les invitations' }))) return;
                await run(async () => {
                  for (const i of pending) await api.revokeInvite(i.id);
                }, { success: 'Invitations annulées' });
              }}
            >
              Les annuler
            </button>
          </p>
        )}
      </section>

      <section aria-labelledby="h-friends">
        <div className="section-title">
          <h2 id="h-friends">Mes amis</h2>
          <span className="small muted">{friends.length}</span>
        </div>
        {friends.length === 0 ? (
          <EmptyState icon="🤝" title="Pas encore d’amis connectés">
            Créez un lien d’invitation ci-dessus. Vous pouvez aussi recevoir celui d’un ami : ouvrez-le simplement.
          </EmptyState>
        ) : (
          <div className="list">
            {friends.map((f) => (
              <div key={f.id} className="row static">
                <Avatar name={f.display_name} seed={f.id} />
                <a className="row-main" href={`#/amis/${f.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <span className="row-title">{f.display_name}</span>
                  <span className="row-sub">{shared === null ? '…' : `${countFor(f.id)} vin${countFor(f.id) > 1 ? 's' : ''} partagé${countFor(f.id) > 1 ? 's' : ''} avec vous`}</span>
                </a>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Supprimer la connexion avec ${f.display_name}`}
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Supprimer ${f.display_name} de vos amis ?`,
                      message: 'Vous ne verrez plus ses bouteilles partagées, et il ne verra plus les vôtres. Les souvenirs de vos événements communs sont conservés.',
                      confirmLabel: 'Supprimer la connexion',
                      danger: true,
                    });
                    if (ok) await run(() => api.removeFriend(f.id), { success: 'Connexion supprimée' });
                  }}
                >
                  <UserMinus />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {friends.length > 0 && (
        <section aria-labelledby="h-shared">
          <div className="section-title">
            <h2 id="h-shared">Bouteilles partagées par mes amis</h2>
          </div>
          <div className="search" style={{ marginBottom: 10 }}>
            <Search aria-hidden />
            <input className="input" type="search" placeholder="Chercher un vin, un ami, une région…" aria-label="Chercher dans les caves partagées" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {shared === null ? (
            <InlineLoading />
          ) : filtered.length === 0 ? (
            <EmptyState icon="🔒" title={shared.length ? 'Aucun vin ne correspond' : 'Rien de partagé pour l’instant'}>
              {shared.length ? 'Essayez d’autres mots.' : 'Vos amis n’ont encore partagé aucune bouteille avec vous. Chaque bouteille est privée tant que son propriétaire ne la partage pas.'}
            </EmptyState>
          ) : (
            <div className="list">
              {filtered.slice(0, 100).map((s) => (
                <SharedItem key={s.lot_id} lot={s} showOwner />
              ))}
            </div>
          )}
        </section>
      )}

      <Sheet open={invite !== null} onClose={() => setInvite(null)} title="Lien d’invitation">
        {invite && <InviteShare code={invite.code} expires={invite.expires_at} />}
      </Sheet>
    </>
  );
}

function InviteShare({ code, expires }: { code: string; expires: string }) {
  const toast = useToast();
  const link = inviteLink(code);
  const text = `Je t’invite sur Cave & Amis pour partager nos bouteilles et organiser nos dîners : ${link}`;
  return (
    <div className="stack">
      <p className="muted">Envoyez ce lien à votre ami. Il pourra accepter ou refuser. Valable jusqu’au {dateLong(expires)}, une seule fois.</p>
      <div className="kbd-code" aria-label="Code d’invitation">
        {prettyCode(code)}
      </div>
      <p className="small faint center">Le code peut aussi être dicté : votre ami le saisit dans Amis › « J’ai reçu un code ».</p>
      {typeof navigator.share === 'function' && (
        <Button icon={<Share2 />} onClick={() => void navigator.share({ title: 'Cave & Amis', text }).catch(() => undefined)}>
          Partager le lien
        </Button>
      )}
      <Button
        variant="secondary"
        icon={<Copy />}
        onClick={async () => toast((await copyText(link)) ? 'Lien copié' : 'Copie impossible : sélectionnez le code à la main', { tone: 'info' })}
      >
        Copier le lien
      </Button>
      <Notice tone="info">Ce code n’est montré qu’une fois. S’il se perd, créez simplement un nouveau lien.</Notice>
    </div>
  );
}

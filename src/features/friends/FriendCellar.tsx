import { useEffect, useMemo, useState } from 'react';
import { Ban, Plus, Search, UserMinus, Users } from 'lucide-react';
import type { SharedLot } from '../../domain/types';
import { useStore } from '../../data/store';
import { COLORS, fold, vintageLabel } from '../../domain/wine';
import type { Color } from '../../domain/types';
import { Avatar, Button, EmptyState, InlineLoading, Notice, Sheet, useConfirm, useToast } from '../../ui/kit';
import { go } from '../../ui/router';
import { SharedItem } from './SharedItem';
import { GroupAvatar } from '../groups/common';
import { GroupFormSheet } from '../groups/GroupFormSheet';

export function FriendCellar({ friendId }: { friendId: string }) {
  const { friends, api, run } = useStore();
  const confirm = useConfirm();
  const [inviting, setInviting] = useState<'list' | 'new' | null>(null);
  const friend = friends.find((f) => f.id === friendId);
  const [rows, setRows] = useState<SharedLot[] | null>(null);
  const [q, setQ] = useState('');
  const [color, setColor] = useState<Color | null>(null);

  useEffect(() => {
    let alive = true;
    if (!friend) return;
    void api
      .sharedLots(friendId)
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [api, friendId, friend]);

  const shown = useMemo(() => {
    const words = fold(q).split(/\s+/).filter(Boolean);
    return (rows ?? []).filter(
      (s) => (!color || s.color === color) && words.every((w) => fold([s.name, s.producer, s.domaine, s.region, s.appellation, vintageLabel(s), ...(s.grapes ?? [])].join(' ')).includes(w)),
    );
  }, [rows, q, color]);

  if (!friend) {
    return (
      <EmptyState icon="🔒" title="Cave non accessible" action={<Button onClick={() => go('/amis')}>Revenir à mes amis</Button>}>
        Vous n’êtes pas (ou plus) connecté avec cette personne.
      </EmptyState>
    );
  }

  return (
    <>
      <div className="inline">
        <Avatar name={friend.display_name} seed={friend.id} />
        <div>
          <h2 className="section">{friend.display_name}</h2>
          <p className="small muted">Les bouteilles que {friend.display_name} a choisi de partager avec vous.</p>
        </div>
      </div>
      <Button variant="secondary" icon={<Users />} onClick={() => setInviting('list')}>
        Inviter dans un groupe
      </Button>
      <Notice tone="info">Une bouteille visible n’est pas forcément disponible : pour un dîner, suggérez-la depuis l’événement, son propriétaire confirmera.</Notice>
      <div className="search">
        <Search aria-hidden />
        <input className="input" type="search" aria-label={`Chercher dans la cave de ${friend.display_name}`} placeholder="Chercher…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="subtabs" role="group" aria-label="Couleur">
        {COLORS.filter((c) => c.value !== 'autre').map((c) => (
          <button key={c.value} type="button" aria-pressed={color === c.value} onClick={() => setColor(color === c.value ? null : c.value)}>
            {c.label}
          </button>
        ))}
      </div>
      {rows === null ? (
        <InlineLoading />
      ) : shown.length === 0 ? (
        <EmptyState icon="🍷" title={rows.length ? 'Aucun vin ne correspond' : 'Rien de partagé pour l’instant'}>
          {rows.length ? 'Essayez d’autres mots.' : `${friend.display_name} n’a encore partagé aucune bouteille avec vous.`}
        </EmptyState>
      ) : (
        <div className="list">
          {shown.map((s) => (
            <SharedItem key={s.lot_id} lot={s} />
          ))}
        </div>
      )}
      <section className="card soft stack-sm" aria-label={`Relation avec ${friend.display_name}`}>
        <Button
          variant="ghost"
          icon={<UserMinus />}
          aria-label={`Supprimer la connexion avec ${friend.display_name}`}
          onClick={async () => {
            const ok = await confirm({
              title: `Supprimer ${friend.display_name} de vos amis ?`,
              message: 'Vous ne verrez plus ses bouteilles partagées, et il ne verra plus les vôtres. Les souvenirs de vos événements communs sont conservés.',
              confirmLabel: 'Supprimer la connexion',
              danger: true,
            });
            if (ok && (await run(() => api.removeFriend(friend.id), { success: 'Connexion supprimée' })).ok) go('/amis');
          }}
        >
          Retirer de mes amis
        </Button>
        <Button
          variant="danger-ghost"
          icon={<Ban />}
          onClick={async () => {
            const ok = await confirm({
              title: `Bloquer ${friend.display_name} ?`,
              message: `Vous ne serez plus amis. ${friend.display_name} ne pourra plus vous trouver, vous envoyer de demande ni vous inviter. Il n’en est pas averti. Vous pourrez le débloquer dans Réglages › Confidentialité.`,
              confirmLabel: 'Bloquer',
              danger: true,
            });
            if (ok && (await run(() => api.blockUser(friend.id), { success: `${friend.display_name} est bloqué` })).ok) go('/amis');
          }}
        >
          Bloquer
        </Button>
      </section>
      {inviting === 'list' && <InviteToGroupSheet friendId={friend.id} friendName={friend.display_name} onNewGroup={() => setInviting('new')} onClose={() => setInviting(null)} />}
      {inviting === 'new' && <GroupFormSheet preselect={[friend.id]} onClose={() => setInviting(null)} />}
    </>
  );
}

/** « Inviter dans ma cave » : les groupes où je peux inviter, ou un nouveau groupe avec cet ami. */
function InviteToGroupSheet({ friendId, friendName, onNewGroup, onClose }: { friendId: string; friendName: string; onNewGroup: () => void; onClose: () => void }) {
  const { snapshot, api, run } = useStore();
  const toast = useToast();
  const groups = snapshot.groups.filter((g) => g.my_status === 'active' && (g.my_role === 'admin' || g.my_role === 'manager'));
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Sheet open onClose={onClose} title={`Inviter ${friendName}`}>
      <div className="stack-sm">
        <p className="small muted">{friendName} pourra voir la cave du groupe et les bouteilles que ses membres y rendent visibles. Il accepte ou refuse l’invitation.</p>
        {groups.length > 0 && (
          <div className="list">
            {groups.map((g) => (
              <div key={g.id} className="row static">
                <GroupAvatar group={g} />
                <span className="row-main">
                  <span className="row-title">{g.name}</span>
                  <span className="row-sub">
                    {g.members} membre{g.members > 1 ? 's' : ''}
                  </span>
                </span>
                <Button
                  size="sm"
                  loading={busy === g.id}
                  onClick={async () => {
                    setBusy(g.id);
                    const res = await run(() => api.inviteToGroup(g.id, [friendId]));
                    setBusy(null);
                    if (res.ok) toast(res.value > 0 ? `Invitation envoyée à ${friendName}` : `${friendName} est déjà membre ou invité`, { tone: res.value > 0 ? undefined : 'info' });
                  }}
                >
                  Inviter
                </Button>
              </div>
            ))}
          </div>
        )}
        <Button variant={groups.length ? 'ghost' : 'primary'} icon={<Plus />} onClick={onNewGroup}>
          Créer un groupe avec {friendName}
        </Button>
      </div>
    </Sheet>
  );
}

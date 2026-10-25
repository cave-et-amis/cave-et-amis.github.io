/**
 * Page d'un groupe : sa cave (bouteilles rendues visibles par les membres), ses membres et rôles, son activité.
 * Les bouteilles restent à leurs propriétaires : le groupe ne fait que les voir.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LogOut, Pencil, Search, Share2, UserPlus } from 'lucide-react';
import { useStore } from '../../data/store';
import { dateShort } from '../../domain/format';
import type { Color, GroupActivity, GroupLot, GroupMember, GroupRole, MyGroup } from '../../domain/types';
import { COLORS, fold, vintageLabel } from '../../domain/wine';
import { Avatar, Button, Check, EmptyState, InlineLoading, Segmented, Sheet, useConfirm } from '../../ui/kit';
import { go } from '../../ui/router';
import { SharedItem } from '../friends/SharedItem';
import { GroupAvatar, ROLE_LABELS } from './common';
import { GroupFormSheet } from './GroupFormSheet';

type Tab = 'cave' | 'membres' | 'activite';

export function GroupPage({ id }: { id: string }) {
  const { snapshot, api, run } = useStore();
  const group = snapshot.groups.find((g) => g.id === id);
  const [tab, setTab] = useState<Tab>('cave');
  const [members, setMembers] = useState<GroupMember[] | null>(null);
  const [lots, setLots] = useState<GroupLot[] | null>(null);
  const [activity, setActivity] = useState<GroupActivity[] | null>(null);
  const [version, setVersion] = useState(0);
  const [sheet, setSheet] = useState<'edit' | 'invite' | 'share' | null>(null);
  const active = group?.my_status === 'active';
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    void Promise.all([api.groupMembers(id), api.groupLots(id), api.groupActivity(id)])
      .then(([m, l, a]) => {
        if (!alive) return;
        setMembers(m);
        setLots(l);
        setActivity(a);
      })
      .catch(() => alive && (setMembers([]), setLots([]), setActivity([])));
    return () => {
      alive = false;
    };
    // Les données du groupe suivent aussi les rechargements généraux (retour sur l'application, toutes les 2 minutes).
  }, [api, id, active, version, snapshot]);

  if (!group) {
    return (
      <EmptyState icon="🔒" title="Groupe introuvable" action={<Button onClick={() => go('/amis?onglet=groupes')}>Voir mes groupes</Button>}>
        Vous n’êtes pas (ou plus) membre de ce groupe.
      </EmptyState>
    );
  }

  if (!active) {
    return (
      <section className="card stack">
        <div className="group-head">
          <GroupAvatar group={group} size={56} />
          <div>
            <h2 className="section">{group.name}</h2>
            <p className="small muted">{group.invited_by_name ? `${group.invited_by_name} vous invite à rejoindre ce groupe.` : 'Vous êtes invité à rejoindre ce groupe.'}</p>
          </div>
        </div>
        {group.description && <p>{group.description}</p>}
        <Button onClick={() => void run(() => api.respondGroupInvite(group.id, true), { success: `Bienvenue dans « ${group.name} »` })}>Rejoindre le groupe</Button>
        <Button variant="ghost" onClick={async () => (await run(() => api.respondGroupInvite(group.id, false), { success: 'Invitation refusée' })).ok && go('/amis?onglet=groupes')}>
          Refuser
        </Button>
      </section>
    );
  }

  const canInvite = group.my_role === 'admin' || group.my_role === 'manager';
  return (
    <>
      <section className="stack-sm">
        <div className="group-head">
          <GroupAvatar group={group} size={64} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 className="section">{group.name}</h2>
            <p className="small muted">
              {group.members} membre{group.members > 1 ? 's' : ''} · {group.bottles} vin{group.bottles > 1 ? 's' : ''} dans la cave · vous êtes {ROLE_LABELS[group.my_role].toLowerCase()}
            </p>
          </div>
        </div>
        {group.description && <p>{group.description}</p>}
        <div className="inline">
          {canInvite && (
            <Button size="sm" icon={<UserPlus />} onClick={() => setSheet('invite')}>
              Inviter des amis
            </Button>
          )}
          {group.my_role === 'admin' && (
            <Button size="sm" variant="secondary" icon={<Pencil />} onClick={() => setSheet('edit')}>
              Modifier
            </Button>
          )}
        </div>
      </section>

      <Segmented<Tab>
        label="Sections du groupe"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'cave', label: 'Cave' },
          { value: 'membres', label: 'Membres' },
          { value: 'activite', label: 'Activité' },
        ]}
      />
      {tab === 'cave' && <GroupCellar lots={lots} onShare={() => setSheet('share')} />}
      {tab === 'membres' && <GroupMembers group={group} members={members} onChange={refresh} />}
      {tab === 'activite' && <GroupActivityList activity={activity} />}

      {sheet === 'edit' && <GroupFormSheet group={group} onClose={() => setSheet(null)} />}
      {sheet === 'invite' && members && <InviteSheet group={group} members={members} onClose={() => (setSheet(null), refresh())} />}
      {sheet === 'share' && <ShareSheet group={group} onClose={() => (setSheet(null), refresh())} />}
    </>
  );
}

function GroupCellar({ lots, onShare }: { lots: GroupLot[] | null; onShare: () => void }) {
  const [q, setQ] = useState('');
  const [color, setColor] = useState<Color | null>(null);
  const [owner, setOwner] = useState('');
  const owners = useMemo(() => [...new Map((lots ?? []).map((l) => [l.owner_id, l.mine ? 'Moi' : l.owner_name])).entries()], [lots]);
  const shown = useMemo(() => {
    const words = fold(q).split(/\s+/).filter(Boolean);
    return (lots ?? []).filter(
      (s) =>
        (!color || s.color === color) &&
        (!owner || s.owner_id === owner) &&
        words.every((w) => fold([s.name, s.producer, s.domaine, s.region, s.appellation, s.owner_name, vintageLabel(s), ...(s.grapes ?? [])].join(' ')).includes(w)),
    );
  }, [lots, q, color, owner]);

  return (
    <section className="stack-sm" aria-label="Cave du groupe">
      <p className="small muted">
        Les bouteilles que les membres ont rendues visibles dans ce groupe. Elles restent à leur propriétaire : rien n’est réservé ni transféré.
      </p>
      <Button variant="secondary" icon={<Share2 />} onClick={onShare}>
        Partager mes bouteilles avec ce groupe
      </Button>
      <div className="search">
        <Search aria-hidden />
        <input className="input" type="search" aria-label="Chercher dans la cave du groupe" placeholder="Chercher un vin, une région…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="subtabs" role="group" aria-label="Couleur">
        {COLORS.filter((c) => c.value !== 'autre').map((c) => (
          <button key={c.value} type="button" aria-pressed={color === c.value} onClick={() => setColor(color === c.value ? null : c.value)}>
            {c.label}
          </button>
        ))}
      </div>
      {owners.length > 1 && (
        <select className="input" aria-label="Propriétaire" value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">Tous les propriétaires</option>
          {owners.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      )}
      {lots === null ? (
        <InlineLoading />
      ) : shown.length === 0 ? (
        <EmptyState icon="🍷" title={lots.length ? 'Aucun vin ne correspond' : 'La cave du groupe est vide'}>
          {lots.length ? 'Essayez d’autres filtres.' : 'Partagez quelques bouteilles de votre cave : elles apparaîtront ici pour tous les membres.'}
        </EmptyState>
      ) : (
        <div className="list">
          {shown.map((s) => (
            <SharedItem key={s.lot_id} lot={s.mine ? { ...s, owner_name: 'vous' } : s} showOwner />
          ))}
        </div>
      )}
    </section>
  );
}

function GroupMembers({ group, members, onChange }: { group: MyGroup; members: GroupMember[] | null; onChange: () => void }) {
  const { api, run, userId } = useStore();
  const confirm = useConfirm();
  if (members === null) return <InlineLoading />;
  const active = members.filter((m) => m.status === 'active');
  const invited = members.filter((m) => m.status === 'invited');
  const isAdmin = group.my_role === 'admin';
  const canRemove = (m: GroupMember) => m.user_id !== userId && (isAdmin || (group.my_role === 'manager' && m.role === 'member'));

  return (
    <section className="stack-sm" aria-label="Membres du groupe">
      <div className="list">
        {active.map((m) => (
          <div key={m.user_id} className="row static">
            <Avatar name={m.display_name} seed={m.user_id} />
            <span className="row-main">
              <span className="row-title">
                {m.display_name}
                {m.user_id === userId && <span className="muted"> (vous)</span>}
              </span>
              <span className="row-sub">{m.joined_at ? `Membre depuis le ${dateShort(m.joined_at)}` : ''}</span>
            </span>
            {isAdmin && m.user_id !== userId ? (
              <select
                className="input"
                style={{ width: 'auto' }}
                aria-label={`Rôle de ${m.display_name}`}
                value={m.role}
                onChange={async (e) => {
                  const role = e.target.value as GroupRole;
                  if ((await run(() => api.setMemberRole(group.id, m.user_id, role), { success: `${m.display_name} est maintenant ${ROLE_LABELS[role].toLowerCase()}` })).ok) onChange();
                }}
              >
                {(['admin', 'manager', 'member'] as GroupRole[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            ) : (
              <span className={`pill ${m.role === 'member' ? '' : 'primary'}`}>{ROLE_LABELS[m.role]}</span>
            )}
            {canRemove(m) && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Retirer ${m.display_name} du groupe`}
                onClick={async () => {
                  const ok = await confirm({
                    title: `Retirer ${m.display_name} du groupe ?`,
                    message: 'Ses bouteilles ne seront plus visibles dans le groupe ; elles restent dans sa cave.',
                    confirmLabel: 'Retirer',
                    danger: true,
                  });
                  if (ok && (await run(() => api.removeMember(group.id, m.user_id), { success: `${m.display_name} a été retiré du groupe` })).ok) onChange();
                }}
              >
                Retirer
              </Button>
            )}
          </div>
        ))}
      </div>
      {invited.length > 0 && (
        <>
          <p className="strong small">Invitations en attente</p>
          <div className="list">
            {invited.map((m) => (
              <div key={m.user_id} className="row static">
                <Avatar name={m.display_name} seed={m.user_id} />
                <span className="row-main">
                  <span className="row-title">{m.display_name}</span>
                  <span className="row-sub">Invité le {dateShort(m.invited_at)}</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => (await run(() => api.cancelGroupInvite(group.id, m.user_id), { success: 'Invitation annulée' })).ok && onChange()}
                >
                  Annuler l’invitation
                </Button>
              </div>
            ))}
          </div>
        </>
      )}
      <Button
        variant="danger-ghost"
        icon={<LogOut />}
        onClick={async () => {
          const ok = await confirm({
            title: `Quitter « ${group.name} » ?`,
            message: 'Vos bouteilles ne seront plus visibles dans le groupe ; elles restent toutes dans votre cave. Vous pourrez être réinvité.',
            confirmLabel: 'Quitter le groupe',
            danger: true,
          });
          if (ok && (await run(() => api.leaveGroup(group.id), { success: 'Vous avez quitté le groupe' })).ok) go('/amis?onglet=groupes', { replace: true });
        }}
      >
        Quitter le groupe
      </Button>
    </section>
  );
}

function activityText(a: GroupActivity) {
  const who = a.actor_name ?? 'Quelqu’un';
  const target = a.target_name ?? '';
  switch (a.kind) {
    case 'created':
      return `${who} a créé le groupe`;
    case 'updated':
      return `${who} a modifié le groupe`;
    case 'invited':
      return `${who} a invité ${target}`;
    case 'joined':
      return `${target} a rejoint le groupe`;
    case 'left':
      return `${target} a quitté le groupe`;
    case 'removed':
      return `${who} a retiré ${target} du groupe`;
    case 'role':
      return `${target} est maintenant ${(ROLE_LABELS[a.detail as GroupRole] ?? a.detail ?? '').toLowerCase()}${a.actor_name ? ` (par ${a.actor_name})` : ''}`;
    case 'shared':
      return `${who} a rendu visible « ${target} »`;
    case 'unshared':
      return `${who} a retiré « ${target} » de la cave du groupe`;
  }
}

function GroupActivityList({ activity }: { activity: GroupActivity[] | null }) {
  if (activity === null) return <InlineLoading />;
  if (activity.length === 0) return <EmptyState icon="🕰️" title="Pas encore d’activité" />;
  return (
    <div className="list" aria-label="Activité du groupe">
      {activity.map((a) => (
        <div key={a.id} className="row static">
          <span className="row-main">
            <span className="row-title" style={{ whiteSpace: 'normal' }}>
              {activityText(a)}
            </span>
            <span className="row-sub">{dateShort(a.created_at)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Inviter des amis qui ne sont pas encore membres ni invités. */
function InviteSheet({ group, members, onClose }: { group: MyGroup; members: GroupMember[]; onClose: () => void }) {
  const { friends, api, run } = useStore();
  const already = new Set(members.map((m) => m.user_id));
  const candidates = friends.filter((f) => !already.has(f.id));
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Inviter des amis"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            loading={busy}
            disabled={chosen.size === 0}
            onClick={async () => {
              setBusy(true);
              const res = await run(() => api.inviteToGroup(group.id, [...chosen]), {
                success: `${chosen.size} invitation${chosen.size > 1 ? 's' : ''} envoyée${chosen.size > 1 ? 's' : ''}`,
              });
              setBusy(false);
              if (res.ok) onClose();
            }}
          >
            Inviter
          </Button>
        </>
      }
    >
      {candidates.length === 0 ? (
        <EmptyState icon="🤝" title="Tous vos amis sont déjà dans le groupe">
          Pour inviter quelqu’un d’autre, ajoutez-le d’abord comme ami (Amis & Groupes › Amis).
        </EmptyState>
      ) : (
        <div className="stack-sm">
          <p className="small muted">Vos amis recevront une invitation à rejoindre « {group.name} ».</p>
          {candidates.map((f) => (
            <Check
              key={f.id}
              checked={chosen.has(f.id)}
              onChange={(v) => setChosen((s) => (v ? new Set(s).add(f.id) : new Set([...s].filter((x) => x !== f.id))))}
              label={f.display_name}
            />
          ))}
        </div>
      )}
    </Sheet>
  );
}

/** Mes lots en stock, à rendre visibles (ou non) dans ce groupe. */
function ShareSheet({ group, onClose }: { group: MyGroup; onClose: () => void }) {
  const { snapshot, api, run, wine } = useStore();
  // Cochée ou décochée aussitôt ; revient en arrière seulement si l'enregistrement échoue.
  const [shared, setShared] = useState(() => new Set(snapshot.groupShares.filter((s) => s.group_id === group.id).map((s) => s.lot_id)));
  const lots = snapshot.lots.filter((l) => l.quantity > 0);
  const [busy, setBusy] = useState<string | null>(null);
  const toggle = (lot: string, on: boolean) => setShared((s) => (on ? new Set(s).add(lot) : new Set([...s].filter((x) => x !== lot))));
  return (
    <Sheet open onClose={onClose} title={`Partager avec « ${group.name} »`}>
      <div className="stack-sm">
        <p className="small muted">
          Les membres verront ces bouteilles, avec les mêmes masques que pour vos amis (prix, quantité exacte, notes). Elles restent à vous et rien n’est réservé.
        </p>
        {lots.length === 0 ? (
          <EmptyState icon="🍷" title="Aucune bouteille en stock" />
        ) : (
          lots.map((l) => {
            const w = wine(l.wine_id);
            const title = [w?.name ?? 'Vin', w ? vintageLabel(w) : null].filter(Boolean).join(' ');
            return (
              <Check
                key={l.id}
                checked={shared.has(l.id)}
                onChange={async (v) => {
                  if (busy) return;
                  setBusy(l.id);
                  toggle(l.id, v);
                  const res = await run(() => api.shareLotWithGroup(l.id, group.id, v), { success: v ? `« ${title} » est visible dans le groupe` : `« ${title} » est retiré du groupe` });
                  if (!res.ok) toggle(l.id, !v);
                  setBusy(null);
                }}
                label={title}
                hint={`${l.quantity} bouteille${l.quantity > 1 ? 's' : ''}`}
              />
            );
          })
        )}
      </div>
    </Sheet>
  );
}

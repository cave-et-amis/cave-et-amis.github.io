/** Onglet « Groupes » : invitations reçues, mes groupes, création d'un groupe. */
import { useState } from 'react';
import { Check as CheckIcon, Plus, X } from 'lucide-react';
import { useStore } from '../../data/store';
import { Button, EmptyState } from '../../ui/kit';
import { go } from '../../ui/router';
import { GroupAvatar, ROLE_LABELS } from './common';
import { GroupFormSheet } from './GroupFormSheet';

export function GroupsTab() {
  const { snapshot, api, run } = useStore();
  const [creating, setCreating] = useState(false);
  const invited = snapshot.groups.filter((g) => g.my_status === 'invited');
  const mine = snapshot.groups.filter((g) => g.my_status === 'active');

  return (
    <>
      {invited.length > 0 && (
        <section aria-labelledby="h-group-invites">
          <div className="section-title">
            <h2 id="h-group-invites">Invitations à des groupes</h2>
            <span className="small muted">{invited.length}</span>
          </div>
          <div className="list">
            {invited.map((g) => (
              <div key={g.id} className="row static">
                <GroupAvatar group={g} />
                <span className="row-main">
                  <span className="row-title">{g.name}</span>
                  <span className="row-sub">
                    {g.invited_by_name ? `Invitation de ${g.invited_by_name}` : 'Invitation'} · {g.members} membre{g.members > 1 ? 's' : ''}
                  </span>
                </span>
                <span className="inline">
                  <Button
                    size="sm"
                    icon={<CheckIcon />}
                    onClick={async () => {
                      const res = await run(() => api.respondGroupInvite(g.id, true), { success: `Bienvenue dans « ${g.name} »` });
                      if (res.ok) go(`/groupes/${g.id}`);
                    }}
                  >
                    Rejoindre
                  </Button>
                  <Button size="sm" variant="ghost" icon={<X />} onClick={() => void run(() => api.respondGroupInvite(g.id, false), { success: 'Invitation refusée' })}>
                    Refuser
                  </Button>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="h-groups">
        <div className="section-title">
          <h2 id="h-groups">Mes groupes</h2>
          <span className="small muted">{mine.length}</span>
        </div>
        <Button icon={<Plus />} onClick={() => setCreating(true)}>
          Créer un groupe
        </Button>
        {mine.length === 0 ? (
          <EmptyState icon="🍷" title="Aucun groupe pour l’instant">
            Créez un groupe (la famille, les soirées entre amis, les grandes occasions…), invitez-y vos amis et rendez-y visibles les bouteilles de votre
            choix. Elles restent les vôtres.
          </EmptyState>
        ) : (
          <div className="list" style={{ marginTop: 10 }}>
            {mine.map((g) => (
              <a key={g.id} className="row" href={`#/groupes/${g.id}`}>
                <GroupAvatar group={g} />
                <span className="row-main">
                  <span className="row-title">{g.name}</span>
                  <span className="row-sub">
                    {g.members} membre{g.members > 1 ? 's' : ''} · {g.bottles} vin{g.bottles > 1 ? 's' : ''} dans la cave
                    {g.available_bottles > 0 ? ` · ${g.available_bottles} bouteille${g.available_bottles > 1 ? 's' : ''} à disposition` : ''} · {ROLE_LABELS[g.my_role]}
                  </span>
                </span>
              </a>
            ))}
          </div>
        )}
      </section>
      {creating && <GroupFormSheet onClose={() => setCreating(false)} />}
    </>
  );
}

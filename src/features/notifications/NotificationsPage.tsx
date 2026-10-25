/**
 * Notifications : demandes (contact, accès à ma cave), invitations (événement, groupe, cave à gérer à plusieurs), lien
 * d'invitation utilisé, cave ouverte. Marquées lues à l'ouverture.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { Bell, CalendarHeart, CalendarPlus, Eye, KeyRound, Sparkles, UserCheck, UserPlus, Users, Wine } from 'lucide-react';
import type { AppNotification } from '../../domain/types';
import { useStore } from '../../data/store';
import { dateShort } from '../../domain/format';
import { Button, EmptyState } from '../../ui/kit';
import { go } from '../../ui/router';

function describe(n: AppNotification): { text: string; href: string; icon: ReactNode } {
  const who = n.actor_name ?? 'Quelqu’un';
  const person = n.actor_id ? `#/amis/${n.actor_id}` : '#/amis';
  switch (n.kind) {
    case 'friend_request':
      return { text: `${who} souhaite être en contact avec vous`, href: '#/amis?onglet=invitations', icon: <UserPlus /> };
    case 'friend_accepted':
      return { text: `${who} a accepté votre demande : vous êtes en contact`, href: person, icon: <UserCheck /> };
    case 'event_invite':
      return { text: `${who} vous invite à un événement`, href: n.ref_id ? `#/evenements/${n.ref_id}` : '#/evenements', icon: <CalendarHeart /> };
    case 'group_invite':
      return { text: `${who} vous invite à rejoindre un groupe`, href: '#/amis?onglet=groupes', icon: <Users /> };
    case 'group_joined':
      return { text: `${who} a rejoint votre groupe`, href: n.ref_id ? `#/groupes/${n.ref_id}` : '#/amis?onglet=groupes', icon: <Users /> };
    case 'cellar_invite':
      return { text: `${who} vous propose de gérer sa cave à plusieurs`, href: '#/amis?onglet=invitations', icon: <Wine /> };
    case 'cellar_joined':
      return { text: `${who} gère maintenant votre cave avec vous`, href: '#/reglages/caves', icon: <Wine /> };
    case 'invite_joined':
      return { text: `${who} a rejoint Cave & Amis grâce à votre invitation`, href: person, icon: <Sparkles /> };
    case 'cellar_opened':
      return { text: `${who} vous a ouvert sa cave`, href: person, icon: <KeyRound /> };
    case 'cellar_access_request':
      return { text: `${who} demande à voir votre cave`, href: '#/amis?onglet=invitations', icon: <Eye /> };
  }
}

export function NotificationsPage() {
  const { snapshot, api, run, relation } = useStore();
  const unread = snapshot.notifications.some((n) => !n.read_at);
  const marked = useRef(false);

  // Ouverture de la page : tout est marqué lu (le surlignage reste visible jusqu'au prochain affichage).
  useEffect(() => {
    if (unread && !marked.current) {
      marked.current = true;
      void run(() => api.markNotificationsRead(), { silent: true });
    }
  }, [unread, api, run]);

  if (snapshot.notifications.length === 0) {
    return (
      <EmptyState icon="🔔" title="Aucune notification">
        Vous serez prévenu ici des demandes, des invitations à un événement, à un groupe ou à gérer une cave à plusieurs, et des caves qui vous sont ouvertes.
      </EmptyState>
    );
  }
  return (
    <div className="list">
      {snapshot.notifications.map((n) => {
        const d = describe(n);
        // Lien d'invitation utilisé : raccourcis vers la suite (inviter, ouvrir ma cave).
        if (n.kind === 'invite_joined' && n.actor_id) {
          const id = n.actor_id;
          const rel = relation(id);
          return (
            <div key={n.id} className={`row static notification${n.read_at ? '' : ' unread'}`} style={{ alignItems: 'flex-start' }}>
              <span className="notification-icon" aria-hidden>
                {d.icon}
              </span>
              <span className="row-main">
                <a className="row-title" href={d.href} style={{ whiteSpace: 'normal' }}>
                  {d.text}
                </a>
                <span className="row-sub">{dateShort(n.created_at)}</span>
                {rel && (
                  <span className="inline" style={{ marginTop: 8 }}>
                    <Button size="sm" variant="secondary" icon={<CalendarPlus />} onClick={() => go(`/amis/${id}?action=evenement`)}>
                      Inviter à un événement
                    </Button>
                    <Button size="sm" variant="secondary" icon={<Users />} onClick={() => go(`/amis/${id}?action=groupe`)}>
                      Inviter dans un groupe
                    </Button>
                    {!rel.they_see_mine && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<KeyRound />}
                        onClick={() => void run(() => api.grantCellarAccess(id), { success: `Votre cave est ouverte à ${n.actor_name ?? 'cette personne'}` })}
                      >
                        Ouvrir ma cave
                      </Button>
                    )}
                  </span>
                )}
              </span>
              {!n.read_at && <span className="pill primary">Nouveau</span>}
            </div>
          );
        }
        return (
          <a key={n.id} className={`row notification${n.read_at ? '' : ' unread'}`} href={d.href}>
            <span className="notification-icon" aria-hidden>
              {d.icon ?? <Bell />}
            </span>
            <span className="row-main">
              <span className="row-title">{d.text}</span>
              <span className="row-sub">{dateShort(n.created_at)}</span>
            </span>
            {!n.read_at && <span className="pill primary">Nouveau</span>}
          </a>
        );
      })}
    </div>
  );
}

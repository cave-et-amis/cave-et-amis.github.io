/** Notifications : demandes d'ami, demandes acceptées, invitations à un événement. Marquées lues à l'ouverture. */
import { useEffect, useRef, type ReactNode } from 'react';
import { Bell, CalendarHeart, UserCheck, UserPlus } from 'lucide-react';
import type { AppNotification } from '../../domain/types';
import { useStore } from '../../data/store';
import { dateShort } from '../../domain/format';
import { EmptyState } from '../../ui/kit';

function describe(n: AppNotification): { text: string; href: string; icon: ReactNode } {
  const who = n.actor_name ?? 'Quelqu’un';
  switch (n.kind) {
    case 'friend_request':
      return { text: `${who} vous demande en ami`, href: '#/amis?onglet=invitations', icon: <UserPlus /> };
    case 'friend_accepted':
      return { text: `${who} a accepté votre invitation : vous êtes amis`, href: n.actor_id ? `#/amis/${n.actor_id}` : '#/amis', icon: <UserCheck /> };
    case 'event_invite':
      return { text: `${who} vous invite à un événement`, href: n.ref_id ? `#/evenements/${n.ref_id}` : '#/evenements', icon: <CalendarHeart /> };
  }
}

export function NotificationsPage() {
  const { snapshot, api, run } = useStore();
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
        Vous serez prévenu ici des demandes d’ami et des invitations à un événement.
      </EmptyState>
    );
  }
  return (
    <div className="list">
      {snapshot.notifications.map((n) => {
        const d = describe(n);
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

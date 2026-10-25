import { useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { useStore } from '../../data/store';
import { eventDate, relativeDays } from '../../domain/format';
import type { CaveEvent } from '../../domain/types';
import { EVENT_KINDS, label } from '../../domain/wine';
import { Button, EmptyState, Segmented } from '../../ui/kit';
import { routeQuery } from '../../ui/router';
import { useActions } from '../../ui/Shell';
import { FirstTip } from '../tour/Tour';
import { EventFormSheet } from './EventForm';

const RSVP_LABELS = { pending: 'À répondre', yes: 'Je viens', maybe: 'Peut-être', no: 'Je ne viens pas' } as const;

export function EventsPage() {
  const { snapshot, userId, profileName } = useStore();
  const [creating, setCreating] = useState(routeQuery().get('nouveau') === '1');
  const [view, setView] = useState<'upcoming' | 'past'>('upcoming');
  const mine = snapshot.participants.filter((p) => p.user_id === userId);
  const events = snapshot.events.filter((e) => mine.some((p) => p.event_id === e.id));
  const isPast = (e: CaveEvent) => e.status !== 'planned' || new Date(e.starts_at).getTime() < Date.now() - 12 * 3600_000;
  const upcoming = events.filter((e) => !isPast(e)).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = events.filter(isPast).sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  const list = view === 'upcoming' ? upcoming : past;
  const actions = useActions();

  return (
    <>
      <FirstTip id="evenements" title="Vos événements" onHelp={actions.help}>
        Un dîner, une dégustation : invitez des amis ou des contacts, prévoyez le menu et choisissez les vins ensemble. Chaque propriétaire confirme
        ses bouteilles.
      </FirstTip>
      <Button icon={<CalendarPlus />} onClick={() => setCreating(true)} data-tour="organiser">
        Organiser un événement
      </Button>
      <Segmented
        label="Période"
        value={view}
        onChange={setView}
        options={[
          { value: 'upcoming', label: `À venir (${upcoming.length})` },
          { value: 'past', label: `Historique (${past.length})` },
        ]}
      />
      {list.length === 0 ? (
        <EmptyState icon={view === 'upcoming' ? '🥂' : '📖'} title={view === 'upcoming' ? 'Aucun événement à venir' : 'Pas encore de souvenirs'}>
          {view === 'upcoming'
            ? 'Dîner, dégustation, anniversaire ou soirée à thème : créez l’événement, invitez vos amis, et choisissez ensemble les bouteilles.'
            : 'Les événements passés et leurs vins dégustés apparaîtront ici.'}
        </EmptyState>
      ) : (
        <div className="list">
          {list.map((e) => {
            const rsvp = mine.find((p) => p.event_id === e.id)?.rsvp ?? 'pending';
            return (
              <a key={e.id} className="row" href={`#/evenements/${e.id}`}>
                <span className="bottle-thumb" aria-hidden style={{ fontSize: '1.4rem', background: 'var(--gold-soft)' }}>
                  {EVENT_KINDS.find((k) => k.value === e.kind)?.icon}
                </span>
                <span className="row-main">
                  <span className="row-title">{e.title}</span>
                  <span className="row-sub">
                    {eventDate(e.starts_at)}
                    {e.place ? ` · ${e.place}` : ''}
                  </span>
                  <span className="inline" style={{ gap: 6, marginTop: 2 }}>
                    <span className="pill">{label(EVENT_KINDS, e.kind)}</span>
                    {e.status === 'cancelled' && <span className="pill danger">Annulé</span>}
                    {e.status === 'done' && <span className="pill">Passé</span>}
                    {e.status === 'planned' && e.organizer_id !== userId && <span className={`pill ${rsvp === 'pending' ? 'primary' : ''}`}>{RSVP_LABELS[rsvp]}</span>}
                    {e.organizer_id === userId ? <span className="pill gold">Vous organisez</span> : <span className="small faint">par {profileName(e.organizer_id)}</span>}
                  </span>
                </span>
                {e.status === 'planned' && !isPast(e) && <span className="small muted">{relativeDays(e.starts_at)}</span>}
              </a>
            );
          })}
        </div>
      )}
      {creating && <EventFormSheet onClose={() => setCreating(false)} />}
    </>
  );
}

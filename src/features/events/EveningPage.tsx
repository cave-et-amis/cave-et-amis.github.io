/**
 * Mode soirée (maquette Cave & Amis 2.0, panneau 4) : pendant un événement, l'organisateur sert les bouteilles une à une
 * (à l'aveugle s'il le souhaite) et les révèle ; chacun suit la bouteille servie, échange de courts messages et note les
 * vins. L'état est relu toutes les 8 secondes tant que la page est visible. Le masquage « à l'aveugle » est un jeu.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { BookOpen, Eye, Send, SkipForward, Square } from 'lucide-react';
import type { EventDetail } from '../../data/api';
import { useStore } from '../../data/store';
import { serviceRank } from '../../domain/advice';
import type { EventLiveState, EventWine } from '../../domain/types';
import { Button, Check, EmptyState, InlineLoading, Notice, Segmented, StarsView, useConfirm } from '../../ui/kit';
import { useActions } from '../../ui/Shell';
import { go } from '../../ui/router';

type Tab = 'fil' | 'votes' | 'souvenirs';
const POLL_MS = 8_000;

const wineName = (w: EventWine) => `${w.wine_name}${w.wine_vintage ? ` ${w.wine_vintage}` : ''}`;

/** Durée écoulée, en heures:minutes:secondes. */
function elapsed(since: string, now: number) {
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
}

function RatingPicker({ value, onChange, label }: { value: number | null; onChange: (v: number | null) => void; label: string }) {
  return (
    <div className="rating-picker" role="group" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" aria-pressed={value === n} aria-label={`${n} sur 5`} onClick={() => onChange(value === n ? null : n)}>
          {n <= (value ?? 0) ? '★' : '☆'}
        </button>
      ))}
    </div>
  );
}

export function EveningPage({ id }: { id: string }) {
  const { snapshot, api, run, userId, profileName } = useStore();
  const actions = useActions();
  const confirm = useConfirm();
  const event = snapshot.events.find((e) => e.id === id);
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [state, setState] = useState<EventLiveState | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('fil');
  const [blind, setBlind] = useState(true);
  const [draft, setDraft] = useState('');
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => {
    if (!event) return;
    const [d, s] = await Promise.all([api.eventDetail(event.id, event.status === 'planned'), api.eventLiveState(event.id)]);
    setDetail(d);
    setState(s);
  }, [api, event]);

  useEffect(() => {
    void refresh().catch(() => setState(null));
    const t = setInterval(() => document.visibilityState === 'visible' && void refresh().catch(() => undefined), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const wines = useMemo(() => {
    const active = (detail?.wines ?? []).filter((w) => w.status === 'confirmed' || w.status === 'consumed' || w.status === 'not_consumed');
    const rank = (w: EventWine) => serviceRank({ id: w.id, color: w.wine_color, wine_type: w.wine_type, vintage: w.wine_vintage });
    return active.sort((a, b) => (a.service_position ?? 999) - (b.service_position ?? 999) || rank(a) - rank(b));
  }, [detail]);

  if (!event) return <EmptyState icon="🔒" title="Événement introuvable" action={<Button onClick={() => go('/evenements')}>Mes événements</Button>} />;
  if (state === undefined || !detail) return <InlineLoading />;
  if (state === null) return <Notice tone="warn">Seuls les participants de l’événement peuvent suivre la soirée.</Notice>;

  const organizer = event.organizer_id === userId;
  const live = state.live;
  const running = Boolean(live && !live.ended_at);
  const index = live?.current_wine ? wines.findIndex((w) => w.id === live.current_wine) : -1;
  const current = index >= 0 ? wines[index] : null;
  const hidden = (w: EventWine) => Boolean(live?.blind) && !live!.revealed.includes(w.id);
  const label = (w: EventWine) => (hidden(w) ? `Bouteille mystère n° ${wines.indexOf(w) + 1}` : wineName(w));
  const vote = (w: EventWine) => state.votes.find((v) => v.event_wine_id === w.id);
  const act = async (fn: () => Promise<void>, success?: string) => {
    await run(fn, { success, reload: false });
    await refresh().catch(() => undefined);
  };

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    await act(() => api.postEventMessage(event!.id, body));
  }

  return (
    <div className="stack">
      <section className="card stack-sm evening-head">
        <div className="between">
          <h2 className="title-font" style={{ margin: 0, fontSize: '1.5rem' }}>
            {event.title}
          </h2>
          {running ? <span className="pill success">En cours</span> : live ? <span className="pill">Terminée</span> : null}
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {new Date(event.starts_at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} · {detail.participants.filter((p) => p.rsvp !== 'no').length}{' '}
          participants{live?.blind ? ' · à l’aveugle' : ''}
        </p>
      </section>

      {!live &&
        (organizer ? (
          <section className="card stack-sm">
            <p style={{ margin: 0 }}>
              Lancez la soirée quand les invités sont là : vous servirez les {wines.length} bouteille{wines.length > 1 ? 's' : ''} confirmée{wines.length > 1 ? 's' : ''} une à une.
            </p>
            {wines.length === 0 && <Notice tone="warn">Aucune bouteille confirmée pour l’instant : confirmez-en au moins une sur la page de l’événement.</Notice>}
            <Check checked={blind} onChange={setBlind} label="À l’aveugle" hint="Le nom de chaque bouteille reste caché jusqu’à ce que vous la révéliez." />
            <Button disabled={wines.length === 0} onClick={() => void act(() => api.startEventLive(event.id, blind), 'Soirée lancée')}>
              Lancer la soirée
            </Button>
          </section>
        ) : (
          <EmptyState icon="🕯️" title="La soirée n’a pas commencé">
            L’organisateur la lancera le moment venu ; cette page se met à jour toute seule.
          </EmptyState>
        ))}

      {live && current && (
        <section className="evening-bottle" aria-label="Bouteille servie">
          <img src="/img/bouteille-generique.webp" alt="" />
          <div className="stack-sm">
            <span className="small">
              Bouteille {index + 1} sur {wines.length}
            </span>
            <strong className="evening-wine">{label(current)}</strong>
            {!hidden(current) && current.wine_appellation && <span className="small">{current.wine_appellation}</span>}
            {running && (
              <span className="evening-timer" aria-label="Temps écoulé depuis le service">
                {elapsed(live.current_since, now)}
              </span>
            )}
            {organizer && running && (
              <span className="inline">
                {hidden(current) && (
                  <Button icon={<Eye />} onClick={() => void act(() => api.revealEventWine(event.id, current.id))}>
                    Révéler
                  </Button>
                )}
                {index < wines.length - 1 && (
                  <Button variant="secondary" icon={<SkipForward />} onClick={() => void act(() => api.serveEventWine(event.id, wines[index + 1].id))}>
                    Passer
                  </Button>
                )}
              </span>
            )}
          </div>
        </section>
      )}

      {live && (
        <>
          <Segmented<Tab>
            label="Pendant la soirée"
            options={[
              { value: 'fil', label: 'Messages' },
              { value: 'votes', label: 'Votes' },
              { value: 'souvenirs', label: 'Souvenirs' },
            ]}
            value={tab}
            onChange={setTab}
          />
          {tab === 'fil' && (
            <section className="card stack-sm" aria-label="Messages de la soirée">
              {state.messages.length === 0 && <p className="small muted">Pas encore de message. Une impression, une idée de cépage ?</p>}
              <ul className="evening-messages">
                {state.messages.map((m) => (
                  <li key={m.id} className={m.mine ? 'mine' : ''}>
                    <span className="strong">{m.author}</span> <span className="small faint">{new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                    <br />
                    {m.body}
                  </li>
                ))}
              </ul>
              {running && (
                <form className="evening-send" onSubmit={(e) => void send(e)}>
                  <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={280} placeholder="Écrire un message…" aria-label="Votre message" />
                  <button type="submit" className="icon-btn" aria-label="Envoyer" disabled={!draft.trim()}>
                    <Send />
                  </button>
                </form>
              )}
            </section>
          )}
          {tab === 'votes' && (
            <section className="card stack-sm" aria-label="Votes">
              {wines.map((w) => {
                const v = vote(w);
                return (
                  <div key={w.id} className="between evening-vote">
                    <span>
                      <span className="strong">{label(w)}</span>
                      <br />
                      <span className="small muted">{v?.count ? `${String(v.average).replace('.', ',')}/5 · ${v.count} vote${v.count > 1 ? 's' : ''}` : 'Pas encore de vote'}</span>
                    </span>
                    <RatingPicker label={`Ma note : ${label(w)}`} value={v?.mine ?? null} onChange={(r) => void act(() => api.voteEventWine(w.id, r))} />
                  </div>
                );
              })}
            </section>
          )}
          {tab === 'souvenirs' && (
            <section className="card stack-sm" aria-label="Souvenirs">
              {detail.tastings.length === 0 ? (
                <p className="small muted">Les notes de dégustation partagées avec l’événement apparaîtront ici.</p>
              ) : (
                detail.tastings.map((t) => (
                  <div key={t.id} className="between">
                    <span>
                      <span className="strong">{t.wine_name}</span>
                      <br />
                      <span className="small muted">
                        {profileName(t.user_id)}
                        {t.comment ? ` : « ${t.comment} »` : ''}
                      </span>
                    </span>
                    <StarsView value={t.rating} />
                  </div>
                ))
              )}
              <Button
                variant="secondary"
                icon={<BookOpen />}
                onClick={() => actions.newTasting({ event_id: event.id, occasion: 'evenement', place: event.place ?? undefined, tasted_on: event.starts_at.slice(0, 10), eventWines: wines })}
              >
                Noter un vin de la soirée
              </Button>
            </section>
          )}
          {organizer && running && (
            <Button
              variant="ghost"
              icon={<Square />}
              onClick={async () => {
                if (await confirm({ title: 'Terminer la soirée ?', message: 'Messages et votes restent visibles ; on ne peut plus en ajouter.', confirmLabel: 'Terminer' }))
                  await act(() => api.endEventLive(event.id), 'Soirée terminée');
              }}
            >
              Terminer la soirée
            </Button>
          )}
        </>
      )}
      <Button variant="ghost" onClick={() => go(`/evenements/${event.id}`)}>
        Page de l’événement
      </Button>
    </div>
  );
}

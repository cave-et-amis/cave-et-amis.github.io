import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, BookOpen, CalendarCheck, CalendarX, Check, Pencil, Plus, Sparkles, Trash2, UserPlus, Wine as WineIcon, X } from 'lucide-react';
import type { EventDetail } from '../../data/api';
import { newId } from '../../data/api';
import { useStore } from '../../data/store';
import { serviceRank, SERVICE_ORDER_RULE, suggestServiceOrder } from '../../domain/advice';
import { buildRows } from '../../domain/cellar';
import { currentYear, eventDate, money, todayIso } from '../../domain/format';
import type { Course, EventWine, Rsvp, SuggestableLot } from '../../domain/types';
import { COURSES, EVENT_KINDS, label, vintageLabel, volumeLabel } from '../../domain/wine';
import { useActions } from '../../ui/Shell';
import { Avatar, Button, Check as CheckBox, EmptyState, Field, InlineLoading, Notice, Segmented, Sheet, StarsView, useConfirm } from '../../ui/kit';
import { go } from '../../ui/router';
import { Stepper } from '../cellar/fields';
import { NousEventLink } from '../settings/NousSection';
import { EventFormSheet } from './EventForm';

const RSVP: { value: Exclude<Rsvp, 'pending'>; label: string }[] = [
  { value: 'yes', label: 'Je viens' },
  { value: 'maybe', label: 'Peut-être' },
  { value: 'no', label: 'Je ne viens pas' },
];
const RSVP_TEXT: Record<Rsvp, string> = { pending: 'pas encore répondu', yes: 'vient', maybe: 'peut-être', no: 'ne vient pas' };

const wineName = (w: EventWine) => `${w.wine_name}${w.wine_vintage ? ` ${w.wine_vintage}` : w.wine_non_vintage ? ' (sans millésime)' : ''}`;

export function EventPage({ id }: { id: string }) {
  const store = useStore();
  const { snapshot, api, run, userId, profileName, friends, reload } = store;
  const actions = useActions();
  const confirm = useConfirm();
  const event = snapshot.events.find((e) => e.id === id);
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [sheet, setSheet] = useState<'edit' | 'invite' | 'propose' | 'suggest' | 'dish' | null>(null);
  const [confirming, setConfirming] = useState<EventWine | null>(null);
  const [consuming, setConsuming] = useState<EventWine | null>(null);
  const planned = event?.status === 'planned';
  // Invitation toute récente : l'événement n'est peut-être pas encore dans les données chargées.
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (!event && !checked) void reload().finally(() => setChecked(true));
  }, [event, checked, reload]);

  const refresh = useCallback(async () => {
    if (!event) return;
    setDetail(await api.eventDetail(event.id, event.status === 'planned'));
  }, [api, event]);

  useEffect(() => {
    void refresh().catch(() => setDetail({ participants: [], dishes: [], wines: [], suggestable: [], tastings: [] }));
  }, [refresh, snapshot]);

  // Rafraîchissement régulier tant que la page est ouverte (réponses et confirmations des autres participants).
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && void refresh().catch(() => undefined), 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  const act = async <T,>(fn: () => Promise<T>, success?: string) => {
    const res = await run(fn, { success });
    await refresh().catch(() => undefined);
    return res;
  };

  if (!event) {
    if (!checked) return <InlineLoading />;
    return (
      <EmptyState icon="🔒" title="Événement introuvable" action={<Button onClick={() => go('/evenements')}>Mes événements</Button>}>
        Il a peut-être été supprimé, ou vous n’y participez plus.
      </EmptyState>
    );
  }
  if (!detail) return <InlineLoading />;

  const organizer = event.organizer_id === userId;
  const me = detail.participants.find((p) => p.user_id === userId);
  const attending = me && me.rsvp !== 'no';
  const active = detail.wines.filter((w) => w.status === 'confirmed' || w.status === 'consumed' || w.status === 'not_consumed');
  const service = [...active].sort((a, b) => (a.service_position ?? 999) - (b.service_position ?? 999) || serviceRank({ id: a.id, color: a.wine_color, wine_type: a.wine_type, vintage: a.wine_vintage }) - serviceRank({ id: b.id, color: b.wine_color, wine_type: b.wine_type, vintage: b.wine_vintage }));
  const proposed = detail.wines.filter((w) => w.status === 'proposed');
  const closed = detail.wines.filter((w) => ['declined', 'withdrawn', 'released'].includes(w.status));
  const myToConsume = detail.wines.filter((w) => w.owner_id === userId && w.status === 'confirmed');
  const canClose = planned && organizer && event.starts_at.slice(0, 10) <= todayIso() && new Date(event.starts_at).getTime() <= Date.now() + 18 * 3600_000;
  const uninvited = friends.filter((f) => !detail.participants.some((p) => p.user_id === f.id));
  const tastings = detail.tastings;

  async function move(index: number, delta: number) {
    const order = service.map((w) => w.id);
    const j = index + delta;
    if (j < 0 || j >= order.length) return;
    [order[index], order[j]] = [order[j], order[index]];
    await act(() => api.setServiceOrder(event!.id, order));
  }

  return (
    <>
      <section className="card stack-sm">
        <div className="between">
          <span className="pill gold">
            {EVENT_KINDS.find((k) => k.value === event.kind)?.icon} {label(EVENT_KINDS, event.kind)}
          </span>
          {event.status === 'cancelled' && <span className="pill danger">Annulé</span>}
          {event.status === 'done' && <span className="pill">Passé</span>}
        </div>
        <h2 className="title-font" style={{ fontSize: '1.5rem' }}>
          {event.title}
        </h2>
        <p className="muted">
          {eventDate(event.starts_at)}
          {event.place ? ` · ${event.place}` : ''}
        </p>
        <p className="small">{organizer ? 'Vous organisez cet événement.' : `Organisé par ${profileName(event.organizer_id)}.`}</p>
        {(event.theme || event.budget !== null) && (
          <p className="small muted">
            {event.theme ? `Thème : ${event.theme}` : ''}
            {event.theme && event.budget !== null ? ' · ' : ''}
            {event.budget !== null ? `Budget : ${money(event.budget)}` : ''}
          </p>
        )}
        {event.description && <p style={{ whiteSpace: 'pre-wrap' }}>{event.description}</p>}
        {me && event.status !== 'done' && <NousEventLink startsAt={event.starts_at} />}
        {organizer && planned && (
          <div className="inline">
            <Button size="sm" variant="secondary" icon={<Pencil />} onClick={() => setSheet('edit')}>
              Modifier
            </Button>
            <Button size="sm" variant="gold" icon={<Sparkles />} onClick={() => go(`/assistant?evenement=${event.id}&q=${encodeURIComponent('Propose des vins pour notre événement à partir des bouteilles que les participants acceptent de partager, et l’ordre de service.')}`)}>
              Conseils de l’assistant
            </Button>
          </div>
        )}
      </section>

      {planned && me && !organizer && (
        <section className="card stack-sm" aria-labelledby="h-rsvp">
          <h2 id="h-rsvp" className="section">
            Votre réponse
          </h2>
          <Segmented<Rsvp>
            label="Votre réponse"
            value={me.rsvp}
            onChange={async (r) => {
              if (r === 'no' && detail.wines.some((w) => w.owner_id === userId && w.status === 'confirmed')) {
                if (!(await confirm({ title: 'Vous ne venez pas ?', message: 'Vos bouteilles réservées pour cet événement seront libérées.', confirmLabel: 'Confirmer' }))) return;
              }
              await act(() => api.respondEvent(event.id, r), 'Réponse enregistrée');
            }}
            options={RSVP}
          />
        </section>
      )}

      <section aria-labelledby="h-people">
        <div className="section-title">
          <h2 id="h-people">Participants</h2>
          {organizer && planned && uninvited.length > 0 && (
            <button type="button" className="link" style={{ border: 0, background: 'none', color: 'var(--primary)', cursor: 'pointer' }} onClick={() => setSheet('invite')}>
              + Inviter
            </button>
          )}
        </div>
        <div className="list">
          {detail.participants
            .sort((a, b) => (a.role === 'organizer' ? -1 : b.role === 'organizer' ? 1 : 0))
            .map((p) => (
              <div key={p.user_id} className="row static">
                <Avatar name={p.user_id === userId ? store.me.display_name : profileName(p.user_id)} seed={p.user_id} size="sm" />
                <span className="row-main">
                  <span className="row-title">{profileName(p.user_id)}</span>
                  <span className="row-sub">{p.role === 'organizer' ? 'Organisateur' : RSVP_TEXT[p.rsvp]}</span>
                </span>
                {organizer && planned && p.role !== 'organizer' && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Retirer ${profileName(p.user_id)} de l’événement`}
                    onClick={async () => {
                      if (await confirm({ title: `Retirer ${profileName(p.user_id)} ?`, message: 'Ses bouteilles réservées seront libérées.', confirmLabel: 'Retirer', danger: true }))
                        await act(() => api.removeParticipant(event.id, p.user_id), 'Participant retiré');
                    }}
                  >
                    <X />
                  </button>
                )}
              </div>
            ))}
        </div>
      </section>

      <section aria-labelledby="h-menu">
        <div className="section-title">
          <h2 id="h-menu">Menu</h2>
          {planned && attending && (
            <button type="button" className="link" style={{ border: 0, background: 'none', color: 'var(--primary)', cursor: 'pointer' }} onClick={() => setSheet('dish')}>
              + Ajouter un plat
            </button>
          )}
        </div>
        {detail.dishes.length === 0 ? (
          <p className="muted small">Aucun plat indiqué. Le menu aide à choisir les bons vins.</p>
        ) : (
          <div className="list">
            {[...detail.dishes]
              .sort((a, b) => COURSES.findIndex((c) => c.value === a.course) - COURSES.findIndex((c) => c.value === b.course) || a.position - b.position)
              .map((d) => (
                <div key={d.id} className="row static" style={{ minHeight: 52 }}>
                  <span className="pill">{label(COURSES, d.course)}</span>
                  <span className="row-main">{d.name}</span>
                  {planned && (d.created_by === userId || organizer) && (
                    <button type="button" className="icon-btn" aria-label={`Retirer ${d.name}`} onClick={() => void act(() => api.deleteDish(d.id))}>
                      <Trash2 />
                    </button>
                  )}
                </div>
              ))}
          </div>
        )}
      </section>

      <section aria-labelledby="h-wines">
        <div className="section-title">
          <h2 id="h-wines">{event.status === 'done' ? 'Vins de la soirée' : 'Vins prévus'}</h2>
        </div>
        {service.length === 0 ? (
          <p className="muted small">Aucune bouteille confirmée pour l’instant.</p>
        ) : (
          <div className="list">
            {service.map((w, i) => (
              <div key={w.id} className="row static" style={{ alignItems: 'flex-start' }}>
                <span className="qty" style={{ minWidth: 26, color: 'var(--gold-ink)' }} aria-label={`Position ${i + 1}`}>
                  {i + 1}
                </span>
                <span className="row-main">
                  <span className="row-title" style={{ whiteSpace: 'normal' }}>
                    <span className="dot" style={{ display: 'inline-block', background: `var(--wine-${w.wine_color ?? 'autre'})`, width: 10, height: 10, marginRight: 6 }} aria-hidden />
                    {wineName(w)}
                  </span>
                  <span className="row-sub" style={{ whiteSpace: 'normal' }}>
                    {w.quantity} × {volumeLabel(w.volume_ml)} · apportée par {profileName(w.owner_id)}
                    {w.wine_appellation ? ` · ${w.wine_appellation}` : ''}
                  </span>
                  {w.note && <span className="small muted">« {w.note} »</span>}
                  <span className="inline" style={{ gap: 6, marginTop: 4 }}>
                    {w.status === 'confirmed' && <span className="pill success">Confirmée{event.status === 'planned' ? ', réservée' : ''}</span>}
                    {w.status === 'consumed' && <span className="pill">Bue : {w.consumed_qty}</span>}
                    {w.status === 'not_consumed' && <span className="pill">Non ouverte</span>}
                  </span>
                  {event.status === 'done' && w.owner_id === userId && w.status === 'confirmed' && (
                    <Button size="sm" style={{ marginTop: 8 }} icon={<CalendarCheck />} onClick={() => setConsuming(w)}>
                      Indiquer ce qui a été bu
                    </Button>
                  )}
                  {planned && w.owner_id === userId && (
                    <Button
                      size="sm"
                      variant="danger-ghost"
                      style={{ marginTop: 6, alignSelf: 'flex-start' }}
                      onClick={async () => {
                        if (await confirm({ title: 'Ne plus apporter cette bouteille ?', message: 'La réservation sera libérée.', confirmLabel: 'Retirer' }))
                          await act(() => api.withdrawEventWine(w.id), 'Bouteille retirée, réservation libérée');
                      }}
                    >
                      Ne plus l’apporter
                    </Button>
                  )}
                </span>
                {organizer && planned && service.length > 1 && (
                  <span className="stack-sm">
                    <button type="button" className="icon-btn" aria-label={`Monter ${w.wine_name}`} disabled={i === 0} onClick={() => void move(i, -1)}>
                      <ArrowUp />
                    </button>
                    <button type="button" className="icon-btn" aria-label={`Descendre ${w.wine_name}`} disabled={i === service.length - 1} onClick={() => void move(i, 1)}>
                      <ArrowDown />
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        {organizer && planned && service.length > 1 && (
          <div className="card soft stack-sm" style={{ marginTop: 10 }}>
            <span className="small">
              <span className="origin general">Repère général</span> {SERVICE_ORDER_RULE}
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void act(
                  () =>
                    api.setServiceOrder(
                      event.id,
                      suggestServiceOrder(service.map((w) => ({ id: w.id, color: w.wine_color, wine_type: w.wine_type, vintage: w.wine_vintage, name: w.wine_name, grapes: w.wine_grapes, appellation: w.wine_appellation, region: w.wine_region }))).map((w) => w.id),
                    ),
                  'Ordre de service appliqué',
                )
              }
            >
              Appliquer l’ordre conseillé
            </Button>
          </div>
        )}

        {proposed.length > 0 && (
          <>
            <h3 className="strong" style={{ margin: '16px 0 8px' }}>
              En attente de confirmation
            </h3>
            <div className="list">
              {proposed.map((w) => (
                <div key={w.id} className="row static" style={{ alignItems: 'flex-start' }}>
                  <WineIcon aria-hidden style={{ color: `var(--wine-${w.wine_color ?? 'autre'})`, flex: 'none' }} />
                  <span className="row-main">
                    <span className="row-title" style={{ whiteSpace: 'normal' }}>
                      {wineName(w)}
                    </span>
                    <span className="row-sub" style={{ whiteSpace: 'normal' }}>
                      {w.quantity} bouteille{w.quantity > 1 ? 's' : ''} de {profileName(w.owner_id)}
                      {w.proposed_by !== w.owner_id ? ` · suggérée par ${profileName(w.proposed_by)}` : ''}
                    </span>
                    {w.note && <span className="small muted">« {w.note} »</span>}
                    {w.owner_id === userId ? (
                      <span className="inline" style={{ marginTop: 8 }}>
                        <Button size="sm" icon={<Check />} onClick={() => setConfirming(w)}>
                          Je l’apporte
                        </Button>
                        <Button size="sm" variant="secondary" icon={<X />} onClick={() => void act(() => api.declineEventWine(w.id), 'Suggestion refusée')}>
                          Refuser
                        </Button>
                      </span>
                    ) : (
                      <span className="small faint">En attente de {profileName(w.owner_id)}</span>
                    )}
                    {w.proposed_by === userId && w.owner_id !== userId && (
                      <Button size="sm" variant="ghost" style={{ alignSelf: 'flex-start' }} onClick={() => void act(() => api.withdrawEventWine(w.id), 'Suggestion retirée')}>
                        Retirer ma suggestion
                      </Button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {planned && attending && (
          <div className="grid-2-always" style={{ marginTop: 12 }}>
            <Button variant="secondary" icon={<Plus />} onClick={() => setSheet('propose')}>
              Proposer une de mes bouteilles
            </Button>
            <Button variant="secondary" icon={<UserPlus />} onClick={() => setSheet('suggest')} disabled={detail.suggestable.length === 0}>
              Suggérer une bouteille d’un ami
            </Button>
          </div>
        )}
        {planned && attending && detail.suggestable.length === 0 && (
          <p className="small faint" style={{ marginTop: 6 }}>
            Aucune bouteille « proposable » chez vos amis participants pour l’instant.
          </p>
        )}
        {closed.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary className="small muted" style={{ cursor: 'pointer', minHeight: 40 }}>
              {closed.length} proposition(s) refusée(s), retirée(s) ou libérée(s)
            </summary>
            <ul className="small muted">
              {closed.map((w) => (
                <li key={w.id}>
                  {wineName(w)} — {profileName(w.owner_id)} ({w.status === 'declined' ? 'refusée' : w.status === 'withdrawn' ? 'retirée' : 'libérée'})
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {event.status === 'done' && (
        <section aria-labelledby="h-memories">
          <div className="section-title">
            <h2 id="h-memories">Souvenirs de dégustation</h2>
          </div>
          {myToConsume.length > 0 && (
            <Notice tone="gold">Indiquez combien de vos bouteilles ont été ouvertes : votre stock sera mis à jour une seule fois.</Notice>
          )}
          {tastings.length === 0 ? (
            <p className="muted small">Aucune note partagée pour l’instant.</p>
          ) : (
            <div className="list">
              {tastings.map((t) => (
                <a key={t.id} className="row" href={t.user_id === userId ? `#/carnet/degustation/${t.id}` : undefined} style={t.user_id === userId ? undefined : { cursor: 'default' }}>
                  <span className="row-main">
                    <span className="row-title">
                      {t.wine_name}
                      {t.vintage ? ` ${t.vintage}` : ''}
                    </span>
                    <span className="row-sub" style={{ whiteSpace: 'normal' }}>
                      {profileName(t.user_id)}
                      {t.comment ? ` : « ${t.comment} »` : ''}
                    </span>
                  </span>
                  <StarsView value={t.rating} />
                </a>
              ))}
            </div>
          )}
          <Button
            variant="secondary"
            icon={<BookOpen />}
            style={{ marginTop: 10 }}
            onClick={() =>
              actions.newTasting({
                event_id: event.id,
                occasion: 'evenement',
                place: event.place ?? undefined,
                tasted_on: event.starts_at.slice(0, 10),
                eventWines: active.filter((w) => w.status !== 'not_consumed'),
              })
            }
          >
            Noter un vin de la soirée
          </Button>
        </section>
      )}

      {organizer && (
        <section className="card soft stack-sm">
          {canClose && (
            <Button
              icon={<CalendarCheck />}
              onClick={async () => {
                if (await confirm({ title: 'L’événement a eu lieu ?', message: 'Les suggestions non confirmées seront closes. Chacun indiquera ensuite les bouteilles réellement ouvertes.', confirmLabel: 'Oui, c’est passé' }))
                  await act(() => api.closeEvent(event.id), 'Événement marqué comme passé');
              }}
            >
              Marquer l’événement comme passé
            </Button>
          )}
          {planned && (
            <Button
              variant="secondary"
              icon={<CalendarX />}
              onClick={async () => {
                if (await confirm({ title: 'Annuler l’événement ?', message: 'Toutes les bouteilles réservées seront libérées. Les participants verront l’annulation.', confirmLabel: 'Annuler l’événement', danger: true }))
                  await act(() => api.cancelEvent(event.id), 'Événement annulé, réservations libérées');
              }}
            >
              Annuler l’événement
            </Button>
          )}
          {event.status !== 'done' && (
            <Button
              variant="danger-ghost"
              icon={<Trash2 />}
              onClick={async () => {
                if (!(await confirm({ title: 'Supprimer l’événement ?', message: 'Il disparaîtra pour tous les participants ; les réservations seront libérées.', confirmLabel: 'Supprimer', danger: true }))) return;
                const res = await run(() => api.deleteEvent(event.id), { success: 'Événement supprimé' });
                if (res.ok) go('/evenements', { replace: true });
              }}
            >
              Supprimer
            </Button>
          )}
        </section>
      )}

      {sheet === 'edit' && <EventFormSheet event={event} onClose={() => setSheet(null)} />}
      {sheet === 'invite' && (
        <InviteSheet
          friends={uninvited}
          onClose={() => setSheet(null)}
          onInvite={async (ids) => {
            const res = await act(() => api.inviteToEvent(event.id, ids), 'Invitations envoyées');
            if (res.ok) setSheet(null);
          }}
        />
      )}
      {sheet === 'dish' && (
        <DishSheet
          onClose={() => setSheet(null)}
          onAdd={async (course, name) => {
            const res = await act(() => api.addDish({ event_id: event.id, course, name, position: detail.dishes.length + 1 }), 'Plat ajouté');
            if (res.ok) setSheet(null);
          }}
        />
      )}
      {sheet === 'propose' && <ProposeSheet eventId={event.id} onDone={() => void refresh()} onClose={() => setSheet(null)} />}
      {sheet === 'suggest' && <SuggestSheet eventId={event.id} options={detail.suggestable} onDone={() => void refresh()} onClose={() => setSheet(null)} />}
      {confirming && (
        <ConfirmWineSheet
          wine={confirming}
          onClose={() => setConfirming(null)}
          onConfirm={async (qty) => {
            const res = await act(() => api.confirmEventWine(confirming.id, qty), 'Bouteille confirmée et réservée');
            if (res.ok) setConfirming(null);
          }}
        />
      )}
      {consuming && <ConsumeSheet wine={consuming} onClose={() => setConsuming(null)} onDone={() => void refresh()} />}
    </>
  );
}

function InviteSheet({ friends, onClose, onInvite }: { friends: { id: string; display_name: string }[]; onClose: () => void; onInvite: (ids: string[]) => Promise<void> }) {
  const [ids, setIds] = useState<string[]>([]);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Inviter des amis"
      footer={
        <Button disabled={!ids.length} onClick={() => void onInvite(ids)}>
          Inviter {ids.length ? `(${ids.length})` : ''}
        </Button>
      }
    >
      {friends.map((f) => (
        <CheckBox
          key={f.id}
          checked={ids.includes(f.id)}
          onChange={(v) => setIds((x) => (v ? [...x, f.id] : x.filter((y) => y !== f.id)))}
          label={
            <span className="inline">
              <Avatar name={f.display_name} seed={f.id} size="sm" /> {f.display_name}
            </span>
          }
        />
      ))}
    </Sheet>
  );
}

function DishSheet({ onClose, onAdd }: { onClose: () => void; onAdd: (course: Course, name: string) => Promise<void> }) {
  const [course, setCourse] = useState<Course>('plat');
  const [name, setName] = useState('');
  return (
    <Sheet
      open
      onClose={onClose}
      title="Ajouter un plat"
      footer={
        <Button disabled={!name.trim()} onClick={() => void onAdd(course, name.trim())}>
          Ajouter
        </Button>
      }
    >
      <div className="form">
        <Field label="Service">
          <select className="input" value={course} onChange={(e) => setCourse(e.target.value as Course)}>
            {COURSES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Plat" htmlFor="dish-name">
          <input id="dish-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Magret de canard…" data-autofocus />
        </Field>
      </div>
    </Sheet>
  );
}

function ProposeSheet({ eventId, onClose, onDone }: { eventId: string; onClose: () => void; onDone: () => void }) {
  const { snapshot, api, run, location } = useStore();
  const rows = useMemo(() => buildRows(snapshot.wines, snapshot.lots, snapshot.cellars, currentYear()).filter((r) => r.available > 0), [snapshot]);
  const [lotId, setLotId] = useState<string>('');
  const [qty, setQty] = useState(1);
  const [bring, setBring] = useState(true);
  const [note, setNote] = useState('');
  const [request] = useState(newId);
  const lot = snapshot.lots.find((l) => l.id === lotId);
  const max = lot ? lot.quantity - lot.reserved : 1;
  return (
    <Sheet
      open
      onClose={onClose}
      title="Proposer une de mes bouteilles"
      footer={
        <Button
          disabled={!lot}
          onClick={async () => {
            const res = await run(() => api.proposeEventWine(eventId, lotId, qty, note.trim() || null, bring, request), {
              success: bring ? 'Bouteille confirmée et réservée pour l’événement' : 'Bouteille proposée',
            });
            if (res.ok) {
              onDone();
              onClose();
            }
          }}
        >
          {bring ? 'Je l’apporte' : 'Proposer'}
        </Button>
      }
    >
      {rows.length === 0 ? (
        <EmptyState icon="🍾" title="Aucune bouteille disponible">
          Toutes vos bouteilles sont déjà réservées, ou votre cave est vide.
        </EmptyState>
      ) : (
        <div className="form">
          <Field label="Bouteille">
            <select className="input" value={lotId} onChange={(e) => (setLotId(e.target.value), setQty(1))}>
              <option value="">Choisir…</option>
              {rows.flatMap((r) =>
                r.lots
                  .filter((l) => l.quantity - l.reserved > 0)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {r.wine.name} {vintageLabel(r.wine)} — {l.quantity - l.reserved} dispo. ({volumeLabel(l.volume_ml)}
                      {l.location_id ? `, ${location(l.location_id)?.name}` : ''})
                    </option>
                  )),
              )}
            </select>
          </Field>
          {lot && (
            <Field label="Nombre de bouteilles">
              <Stepper value={qty} onChange={setQty} min={1} max={max} label="Nombre de bouteilles" />
            </Field>
          )}
          <CheckBox checked={bring} onChange={setBring} label="Je confirme l’apporter" hint="Elle sera réservée pour l’événement (elle reste dans votre stock jusqu’à ce que vous indiquiez qu’elle a été bue)." />
          <Field label="Message (facultatif)" htmlFor="pr-note">
            <input id="pr-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Pour le fromage, à carafer…" />
          </Field>
        </div>
      )}
    </Sheet>
  );
}

function SuggestSheet({ eventId, options, onClose, onDone }: { eventId: string; options: SuggestableLot[]; onClose: () => void; onDone: () => void }) {
  const { api, run } = useStore();
  const [lotId, setLotId] = useState('');
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const [request] = useState(newId);
  const chosen = options.find((o) => o.lot_id === lotId);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Suggérer une bouteille d’un ami"
      footer={
        <Button
          disabled={!chosen}
          onClick={async () => {
            const res = await run(() => api.proposeEventWine(eventId, lotId, qty, note.trim() || null, false, request), { success: `Suggestion envoyée à ${chosen!.owner_name}` });
            if (res.ok) {
              onDone();
              onClose();
            }
          }}
        >
          Suggérer
        </Button>
      }
    >
      <div className="form">
        <Notice tone="info">Le propriétaire devra confirmer qu’il l’apporte : la bouteille n’est pas réservée avant sa confirmation.</Notice>
        <div className="list" style={{ boxShadow: 'none' }}>
          {options.map((o) => (
            <label key={o.lot_id} className="row" style={{ cursor: 'pointer' }}>
              <input type="radio" name="sug" checked={lotId === o.lot_id} onChange={() => setLotId(o.lot_id)} style={{ width: 20, height: 20, accentColor: 'var(--primary)' }} />
              <span className="row-main">
                <span className="row-title" style={{ whiteSpace: 'normal' }}>
                  {o.name} {vintageLabel(o)}
                </span>
                <span className="row-sub">
                  {o.owner_name} · {o.quantity !== null ? `${o.available ?? o.quantity} disponible(s)` : o.in_stock ? 'en stock' : 'déjà réservée'}
                </span>
              </span>
            </label>
          ))}
        </div>
        {chosen && (
          <Field label="Nombre de bouteilles">
            <Stepper value={qty} onChange={setQty} min={1} max={chosen.available ?? 6} label="Nombre de bouteilles" />
          </Field>
        )}
        <Field label="Message (facultatif)" htmlFor="sg-note">
          <input id="sg-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Parfait avec le plat principal !" />
        </Field>
      </div>
    </Sheet>
  );
}

function ConfirmWineSheet({ wine, onClose, onConfirm }: { wine: EventWine; onClose: () => void; onConfirm: (qty: number) => Promise<void> }) {
  const { snapshot } = useStore();
  const lot = snapshot.lots.find((l) => l.id === wine.lot_id);
  const available = lot ? lot.quantity - lot.reserved : 0;
  const [qty, setQty] = useState(Math.min(wine.quantity, Math.max(available, 1)));
  return (
    <Sheet
      open
      onClose={onClose}
      title="Confirmer que vous l’apportez"
      footer={
        <Button disabled={available < 1} onClick={() => void onConfirm(qty)}>
          Confirmer et réserver
        </Button>
      }
    >
      <div className="form">
        <p>
          <strong>{wineName(wine)}</strong> — {wine.quantity} bouteille(s) demandée(s).
        </p>
        <p className="muted small">Disponibles dans ce lot : {available} (en tenant compte de vos autres réservations).</p>
        {available < 1 ? (
          <Notice tone="warn">Plus aucune bouteille disponible dans ce lot : refusez la suggestion ou libérez une autre réservation.</Notice>
        ) : (
          <Field label="Nombre de bouteilles apportées">
            <Stepper value={qty} onChange={setQty} min={1} max={available} label="Nombre de bouteilles" />
          </Field>
        )}
      </div>
    </Sheet>
  );
}

function ConsumeSheet({ wine, onClose, onDone }: { wine: EventWine; onClose: () => void; onDone: () => void }) {
  const { api, run } = useStore();
  const [qty, setQty] = useState(wine.reserved_qty);
  const [request] = useState(newId);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Bouteilles réellement ouvertes"
      footer={
        <Button
          onClick={async () => {
            const res = await run(() => api.confirmConsumption(wine.id, qty, request), {
              success: qty > 0 ? `Stock mis à jour : ${qty} bouteille(s) sortie(s)` : 'Réservation libérée, stock inchangé',
            });
            if (res.ok) {
              onDone();
              onClose();
            }
          }}
        >
          Confirmer
        </Button>
      }
    >
      <div className="form">
        <p>
          <strong>{wineName(wine)}</strong> — {wine.reserved_qty} bouteille(s) réservée(s).
        </p>
        <Field label="Combien ont été ouvertes ?">
          <Stepper value={qty} onChange={setQty} min={0} max={wine.reserved_qty} label="Bouteilles ouvertes" />
        </Field>
        <p className="small muted">Les bouteilles ouvertes sortent de votre stock (une seule fois) ; les autres redeviennent disponibles.</p>
      </div>
    </Sheet>
  );
}

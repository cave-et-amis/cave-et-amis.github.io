/**
 * Fiche d'une personne en relation : « Sa cave » (ce qu'elle me montre, si elle m'a ouvert sa cave) et « Ce que X voit
 * de moi » (aperçu exact de ce que je lui montre, exceptions, niveau de détail, ouvrir ou fermer ma cave, actions).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Ban, CalendarPlus, Eye, EyeOff, KeyRound, Lock, Plus, Search, UserMinus, UserX, Users } from 'lucide-react';
import type { AccessScope, CellarException, Color, DetailLevel, PreviewLot, Relation, RelationOverview, SharedLot } from '../../domain/types';
import { useStore } from '../../data/store';
import { usePhotoUrl } from '../../data/photos';
import { dateLong, dateShort, deName, endOfDay, localDay, money } from '../../domain/format';
import { COLORS, fold, vintageLabel, wineSubtitle, wineTitle } from '../../domain/wine';
import { Avatar, Button, Check, EmptyState, Field, InlineLoading, Notice, Pill, Segmented, Sheet, Thumb, useConfirm, useToast } from '../../ui/kit';
import { go, routeQuery, useRoute } from '../../ui/router';
import { SharedItem } from './SharedItem';
import { AccessBadges } from './FriendsPage';
import { GroupAvatar } from '../groups/common';
import { GroupFormSheet } from '../groups/GroupFormSheet';
import { EventFormSheet } from '../events/EventForm';

type Tab = 'sa-cave' | 'moi';
type Inviting = 'group' | 'new-group' | 'event' | 'new-event' | null;

export function FriendCellar({ friendId }: { friendId: string }) {
  const { friends, relation } = useStore();
  const route = useRoute();
  const query = routeQuery(route);
  const person = friends.find((f) => f.id === friendId);
  const rel = relation(friendId);
  const [tab, setTab] = useState<Tab>(query.get('onglet') === 'moi' ? 'moi' : 'sa-cave');
  const action = query.get('action');
  const [inviting, setInviting] = useState<Inviting>(action === 'groupe' ? 'group' : action === 'evenement' ? 'event' : null);

  if (!person || !rel) {
    return (
      <EmptyState icon="🔒" title="Personne introuvable" action={<Button onClick={() => go('/amis')}>Revenir à mes amis</Button>}>
        Vous n’êtes pas (ou plus) en relation avec cette personne.
      </EmptyState>
    );
  }
  const name = person.display_name;

  return (
    <>
      <div className="inline" style={{ alignItems: 'flex-start' }}>
        <Avatar name={name} seed={person.id} />
        <div>
          <h2 className="section">{name}</h2>
          <p className="small muted">
            {rel.they_see_mine || rel.i_see_theirs ? 'Ami' : 'Contact'} depuis le {dateLong(rel.since)}
          </p>
          <AccessBadges relation={rel} />
        </div>
      </div>
      <div className="inline">
        <Button size="sm" variant="secondary" icon={<Users />} onClick={() => setInviting('group')}>
          Inviter dans un groupe
        </Button>
        <Button size="sm" variant="secondary" icon={<CalendarPlus />} onClick={() => setInviting('event')}>
          Inviter à un événement
        </Button>
      </div>
      <Segmented<Tab>
        label="Sections"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'sa-cave', label: 'Sa cave' },
          { value: 'moi', label: `Ce que ${name} voit de moi` },
        ]}
      />
      {tab === 'sa-cave' ? <TheirCellar rel={rel} name={name} /> : <WhatTheySee rel={rel} name={name} />}
      {inviting === 'group' && <InviteToGroupSheet friendId={person.id} friendName={name} onNewGroup={() => setInviting('new-group')} onClose={() => setInviting(null)} />}
      {inviting === 'new-group' && <GroupFormSheet preselect={[person.id]} onClose={() => setInviting(null)} />}
      {inviting === 'event' && <InviteToEventSheet friendId={person.id} friendName={name} onNewEvent={() => setInviting('new-event')} onClose={() => setInviting(null)} />}
      {inviting === 'new-event' && <EventFormSheet preselect={[person.id]} onClose={() => setInviting(null)} />}
    </>
  );
}

/** Onglet « Sa cave » : jamais rien sans accès ; sinon les bouteilles qu'elle partage avec ses amis. */
function TheirCellar({ rel, name }: { rel: Relation; name: string }) {
  const { api, run } = useStore();
  const [rows, setRows] = useState<SharedLot[] | null>(null);
  const [q, setQ] = useState('');
  const [color, setColor] = useState<Color | null>(null);

  useEffect(() => {
    let alive = true;
    if (!rel.i_see_theirs) return;
    void api
      .sharedLots(rel.user_id)
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [api, rel.user_id, rel.i_see_theirs]);

  const shown = useMemo(() => {
    const words = fold(q).split(/\s+/).filter(Boolean);
    return (rows ?? []).filter(
      (s) => (!color || s.color === color) && words.every((w) => fold([s.name, s.producer, s.domaine, s.region, s.appellation, vintageLabel(s), ...(s.grapes ?? [])].join(' ')).includes(w)),
    );
  }, [rows, q, color]);

  if (!rel.i_see_theirs) {
    return (
      <EmptyState
        icon="🔒"
        title={`${name} ne vous a pas ouvert sa cave`}
        action={
          rel.request_out ? (
            <Button variant="ghost" onClick={() => void run(() => api.cancelAccessRequest(rel.request_out!), { success: 'Demande annulée' })}>
              Annuler ma demande
            </Button>
          ) : (
            <Button icon={<Eye />} onClick={() => void run(() => api.requestCellarAccess(rel.user_id), { success: `Demande envoyée à ${name}` })}>
              Demander l’accès
            </Button>
          )
        }
      >
        {rel.request_out
          ? `Votre demande est en attente : ${name} choisira d’ouvrir sa cave ou non.`
          : `Vous restez en contact : vos groupes et vos événements communs fonctionnent comme d’habitude. Vous pouvez demander à voir sa cave ; ${name} accepte ou refuse.`}
      </EmptyState>
    );
  }

  return (
    <>
      <p className="small muted">Les bouteilles que {name} vous montre, en lecture seule.</p>
      <Notice tone="info">Une bouteille visible n’est pas forcément disponible : pour un dîner, suggérez-la depuis l’événement, son propriétaire confirmera.</Notice>
      <div className="search">
        <Search aria-hidden />
        <input className="input" type="search" aria-label={`Chercher dans la cave ${deName(name)}`} placeholder="Chercher…" value={q} onChange={(e) => setQ(e.target.value)} />
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
          {rows.length ? 'Essayez d’autres mots.' : `${name} vous a ouvert sa cave, mais n’y partage encore aucune bouteille.`}
        </EmptyState>
      ) : (
        <div className="list">
          {shown.map((s) => (
            <SharedItem key={s.lot_id} lot={s} />
          ))}
        </div>
      )}
    </>
  );
}

function originLabel(r: PreviewLot, name: string, selection: boolean) {
  switch (r.origin) {
    case 'friends':
      return 'Partagé avec mes amis';
    case 'proposable':
      return 'Proposable pour un événement';
    case 'exception':
      return selection ? `Sélection pour ${name}` : `Exception pour ${name}`;
    case 'group':
      return `Groupe « ${r.origin_label ?? ''} »`;
    case 'event':
      return r.origin_date ? `Événement du ${dateShort(r.origin_date)}` : 'Événement';
  }
}

/**
 * Onglet « Ce que X voit de moi », visible de moi seul. Toute la liste et tous les nombres viennent de
 * preview_my_cellar_as, la même règle que la vue réellement servie à cette personne.
 */
function WhatTheySee({ rel, name }: { rel: Relation; name: string }) {
  const { api, run, snapshot, userId, wine } = useStore();
  const confirm = useConfirm();
  const [preview, setPreview] = useState<PreviewLot[] | null>(null);
  const [overview, setOverview] = useState<RelationOverview | null>(null);
  const [exceptions, setExceptions] = useState<CellarException[]>([]);
  const [adding, setAdding] = useState(false);
  const [tick, setTick] = useState(0);
  const [until, setUntil] = useState(rel.access_expires_at ? localDay(new Date(rel.access_expires_at)) : '');
  const version = `${rel.they_see_mine}:${rel.detail_level}:${rel.exceptions}:${rel.visible_lots}:${rel.scope}:${rel.access_expires_at}:${snapshot.lots.length}:${tick}`;
  const selection = rel.scope === 'selection';
  const ended = !rel.they_see_mine && rel.access_expires_at !== null && new Date(rel.access_expires_at).getTime() <= Date.now();

  useEffect(() => {
    let alive = true;
    void Promise.all([api.previewAs(rel.user_id), api.relationOverview(rel.user_id), api.cellarExceptions(rel.user_id)])
      .then(([p, o, e]) => {
        if (!alive) return;
        setPreview(p);
        setOverview(o);
        setExceptions(e);
      })
      .catch(() => alive && setPreview([]));
    return () => {
      alive = false;
    };
  }, [api, rel.user_id, version]);

  /** Une action, puis l'aperçu relu. */
  const act = async (fn: () => Promise<unknown>, success: string) => {
    const res = await run(fn, { success });
    setTick((t) => t + 1);
    return res.ok;
  };

  if (!preview || !overview) return <InlineLoading />;

  const cellarRows = preview.filter((r) => r.origin === 'friends' || r.origin === 'proposable' || r.origin === 'exception');
  const groupRows = preview.filter((r) => r.origin === 'group');
  const eventRows = preview.filter((r) => r.origin === 'event');
  const lotQty = (id: string | null) => snapshot.lots.find((l) => l.id === id)?.quantity ?? 0;
  const bottles = cellarRows.reduce((n, r) => n + lotQty(r.lot_id), 0);
  const restricted = rel.detail_level === 'restricted';
  const shownCount = (k: 'hide_price' | 'hide_quantity' | 'hide_notes') => cellarRows.filter((r) => !r[k]).length;
  const visibility = (k: 'hide_price' | 'hide_quantity' | 'hide_notes') => {
    const n = shownCount(k);
    // « prix masqués », mais « quantités masquées », « notes masquées ».
    return n === 0 ? (k === 'hide_price' ? 'masqués' : 'masquées') : n === cellarRows.length ? 'visibles' : `visibles pour ${n} vin${n > 1 ? 's' : ''} sur ${cellarRows.length}`;
  };
  const now = Date.now();
  const upcoming = (overview.common_events ?? []).filter((e) => new Date(e.starts_at).getTime() >= now);
  const past = (overview.common_events ?? []).filter((e) => new Date(e.starts_at).getTime() < now);
  const lotName = (lotId: string) => {
    const lot = snapshot.lots.find((l) => l.id === lotId);
    const w = wine(lot?.wine_id);
    return w ? wineTitle(w) : 'Bouteille';
  };

  async function toggleCellar(open: boolean) {
    if (open) {
      await act(() => api.grantCellarAccess(rel.user_id), `Votre cave est ouverte à ${name}`);
      return;
    }
    const ok = await confirm({
      title: `Fermer votre cave à ${name} ?`,
      message: `${name} ne verra plus aucune bouteille de votre cave. Vous restez en contact : vos groupes et vos événements communs continuent.`,
      confirmLabel: 'Fermer ma cave',
      danger: true,
    });
    if (ok) await act(() => api.revokeCellarAccess(rel.user_id), `Votre cave est fermée à ${name}`);
  }

  return (
    <>
      <section className="card" aria-labelledby="h-summary">
        <h2 id="h-summary" className="section">
          En résumé
        </h2>
        <div className="summary-line">
          <span>
            <strong>Ma cave</strong>
            <br />
            <span className="small muted">
              {rel.they_see_mine
                ? `Ouverte à ${name} : ${selection ? 'une sélection' : 'toute votre cave partagée'}${rel.access_expires_at ? `, jusqu’au ${dateLong(rel.access_expires_at)}` : ''}`
                : ended
                  ? `L’accès de ${name} a pris fin le ${dateLong(rel.access_expires_at!)}`
                  : `Fermée : ${name} ne voit aucune bouteille de votre cave`}
            </span>
          </span>
          <Check checked={rel.they_see_mine} onChange={(v) => void toggleCellar(v)} label={<span className="sr-only">Ma cave ouverte à {name}</span>} />
        </div>
        <div className="summary-line">
          <span>Bouteilles visibles dans ma cave</span>
          <strong>
            {cellarRows.length} vin{cellarRows.length > 1 ? 's' : ''} · {bottles} bouteille{bottles > 1 ? 's' : ''}
          </strong>
        </div>
        <div className="summary-line">
          <span>Prix, quantités exactes et notes</span>
          <span className="small" style={{ textAlign: 'right' }}>
            {!rel.they_see_mine
              ? '—'
              : restricted
                ? 'Toujours masqués (niveau Restreint)'
                : `Prix ${visibility('hide_price')} · quantités ${visibility('hide_quantity')} · notes ${visibility('hide_notes')}`}
          </span>
        </div>
        <div className="summary-line" style={{ alignItems: 'flex-start' }}>
          <span>Groupes en commun</span>
          <span className="small" style={{ textAlign: 'right' }}>
            {(overview.common_groups ?? []).length === 0
              ? 'Aucun'
              : (overview.common_groups ?? []).map((g) => {
                  const n = groupRows.filter((r) => r.origin_id === g.id).length;
                  return (
                    <span key={g.id} style={{ display: 'block' }}>
                      <a href={`#/groupes/${g.id}`}>
                        {g.emoji} {g.name}
                      </a>{' '}
                      : {n} bouteille{n > 1 ? 's' : ''} visible{n > 1 ? 's' : ''}
                    </span>
                  );
                })}
          </span>
        </div>
        <div className="summary-line" style={{ alignItems: 'flex-start' }}>
          <span>Événements en commun</span>
          <span className="small" style={{ textAlign: 'right' }}>
            {upcoming.length + past.length === 0 ? (
              'Aucun'
            ) : (
              <>
                {upcoming.length > 0 && <span style={{ display: 'block' }}>À venir : {upcoming.map((e) => e.title).join(', ')}</span>}
                {past.length > 0 && <span style={{ display: 'block' }}>Passés : {past.map((e) => e.title).join(', ')}</span>}
              </>
            )}
          </span>
        </div>
        <div className="summary-line" style={{ alignItems: 'flex-start' }}>
          <span>Cave gérée à plusieurs</span>
          <span className="small" style={{ textAlign: 'right' }}>
            {(overview.shared_cellars ?? []).length === 0
              ? 'Non'
              : (overview.shared_cellars ?? []).map((c) => (
                  <span key={c.cellar_id} style={{ display: 'block' }}>
                    Oui : « {c.cellar_name} », {c.mine ? 'votre cave' : `la cave ${deName(name)}`}
                    {c.status === 'invited' ? ' (invitation en attente)' : ''}{' '}
                    <button
                      type="button"
                      className="link-btn"
                      onClick={async () => {
                        const ok = await confirm({
                          title: c.mine ? `Retirer ${name} de « ${c.cellar_name} » ?` : `Quitter « ${c.cellar_name} » ?`,
                          message: c.mine
                            ? `${name} ne pourra plus gérer cette cave avec vous. Ses bouteilles restent les vôtres.`
                            : `Vous ne pourrez plus gérer cette cave avec ${name}.`,
                          confirmLabel: c.mine ? 'Retirer' : 'Quitter',
                          danger: true,
                        });
                        if (ok) await act(() => api.removeCellarMember(c.cellar_id, c.mine ? rel.user_id : userId), c.mine ? `${name} est retiré de la cave` : 'Vous avez quitté la cave');
                      }}
                    >
                      Retirer
                    </button>
                  </span>
                ))}
          </span>
        </div>
      </section>

      {rel.they_see_mine && (
        <section className="card stack-sm" aria-labelledby="h-access-scope">
          <h2 id="h-access-scope" className="section">
            Ce que {name} peut voir
          </h2>
          <Segmented<AccessScope>
            label={`Ce que ${name} peut voir`}
            value={rel.scope ?? 'shared'}
            onChange={(scope) =>
              void act(
                () => api.setCellarAccessOptions(rel.user_id, { scope }),
                scope === 'selection' ? `${name} ne voit plus que votre sélection` : `${name} voit toute votre cave partagée`,
              )
            }
            options={[
              { value: 'shared', label: 'Toute ma cave partagée' },
              { value: 'selection', label: 'Une sélection' },
            ]}
          />
          <p className="small muted">
            {selection
              ? `Seulement les bouteilles choisies pour ${name} (« Ajouter une bouteille » ci-dessous), même privées. Lecture seule.`
              : `Les bouteilles « Partagé avec mes amis » ou « Proposable », sauf celles masquées pour ${name}. Lecture seule.`}
          </p>
          <Field
            label="Accès jusqu’au (facultatif)"
            htmlFor="access-until"
            hint={rel.access_expires_at ? `L’accès prendra fin le ${dateLong(rel.access_expires_at)}.` : 'Sans date : jusqu’à ce que vous fermiez votre cave à cette personne.'}
          >
            <div className="inline" style={{ flexWrap: 'nowrap' }}>
              <input id="access-until" className="input" type="date" min={localDay()} value={until} onChange={(e) => setUntil(e.target.value)} />
              <Button
                variant="secondary"
                disabled={!until}
                onClick={() => void act(() => api.setCellarAccessOptions(rel.user_id, { expires_at: endOfDay(until) }), `Accès de ${name} jusqu’au ${dateLong(endOfDay(until))}`)}
              >
                Enregistrer
              </Button>
            </div>
          </Field>
          {rel.access_expires_at && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setUntil('');
                void act(() => api.setCellarAccessOptions(rel.user_id, { expires_at: null }), 'Accès sans date de fin');
              }}
            >
              Retirer la date de fin
            </Button>
          )}
        </section>
      )}

      <section className="card stack-sm" aria-labelledby="h-level">
        <h2 id="h-level" className="section">
          Niveau de détail pour {name}
        </h2>
        {rel.they_see_mine ? (
          <>
            <Segmented<DetailLevel>
              label={`Niveau de détail pour ${name}`}
              value={rel.detail_level ?? 'standard'}
              onChange={(level) => void act(() => api.setDetailLevel(rel.user_id, level), level === 'restricted' ? 'Niveau « Restreint » enregistré' : 'Niveau « Standard » enregistré')}
              options={[
                { value: 'standard', label: 'Standard' },
                { value: 'restricted', label: 'Restreint' },
              ]}
            />
            <p className="small muted">
              {restricted
                ? `Prix, quantités exactes et notes toujours masqués pour ${name}, quels que soient les réglages de chaque bouteille (sauf dans un groupe, où vos partages gardent leurs réglages).`
                : 'Les réglages de chaque bouteille s’appliquent (prix, quantité et notes masqués ou non).'}
            </p>
          </>
        ) : (
          <p className="small muted">Ouvrez d’abord votre cave à {name} pour choisir ce qui est montré.</p>
        )}
      </section>

      <section aria-labelledby="h-preview" className="stack-sm">
        <div className="section-title">
          <h2 id="h-preview">Ce que {name} voit</h2>
          <span className="small muted">{preview.length}</span>
        </div>
        <div className="preview-banner">
          <Notice tone="gold">
            <strong>Aperçu : voici ce que {name} voit</strong> de vos bouteilles, en lecture seule. Masquer une bouteille ne la retire que de votre cave telle que {name} la
            voit : un partage dans un groupe ou un vin proposé pour un événement restent visibles.
          </Notice>
        </div>
        {preview.length === 0 ? (
          <EmptyState icon="🙈" title={`${name} ne voit aucune de vos bouteilles`}>
            {rel.they_see_mine ? 'Partagez des bouteilles avec vos amis (fiche du vin › Lot et partage), ou montrez-en une à cette personne seulement ci-dessous.' : 'Votre cave lui est fermée.'}
          </EmptyState>
        ) : (
          <>
            {cellarRows.length > 0 && (
              <PreviewList
                title="Dans ma cave"
                rows={cellarRows}
                name={name}
                selection={selection}
                action={(r) =>
                  r.origin === 'exception' ? (
                    <Button size="sm" variant="ghost" icon={<EyeOff />} onClick={() => void act(() => api.setCellarException(rel.user_id, r.lot_id!, null), `${lotName(r.lot_id!)} n’est plus montrée à ${name}`)}>
                      Ne plus la montrer
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<EyeOff />}
                      aria-label={`Masquer ${r.name} pour ${name}`}
                      onClick={() => void act(() => api.setCellarException(rel.user_id, r.lot_id!, 'hide'), `${r.name} est masquée pour ${name}`)}
                    >
                      Masquer pour {name}
                    </Button>
                  )
                }
              />
            )}
            {(overview.common_groups ?? []).map((g) => {
              const rows = groupRows.filter((r) => r.origin_id === g.id);
              return rows.length > 0 && <PreviewList key={g.id} title={`Dans le groupe « ${g.name} »`} rows={rows} name={name} />;
            })}
            {eventRows.length > 0 && <PreviewList title="Proposées pour nos événements" rows={eventRows} name={name} />}
          </>
        )}
      </section>

      <section className="card stack-sm" aria-labelledby="h-exceptions">
        <h2 id="h-exceptions" className="section">
          {selection ? `Votre sélection pour ${name}` : `Exceptions pour ${name}`}
        </h2>
        <p className="small muted">
          {selection
            ? `${name} ne voit que les bouteilles choisies ici.`
            : `Bouteille par bouteille, sans toucher au réglage général du lot : masquer une bouteille partagée, ou montrer une bouteille privée à ${name} seulement.`}
        </p>
        {exceptions.length > 0 && (
          <div className="list">
            {exceptions.map((e) => (
              <div key={e.lot_id} className="row static">
                {e.mode === 'hide' ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                <span className="row-main">
                  <span className="row-title">{lotName(e.lot_id)}</span>
                  <span className="row-sub">{e.mode === 'hide' ? `Masquée pour ${name}` : `Montrée à ${name} seulement`}</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => void act(() => api.setCellarException(rel.user_id, e.lot_id, null), 'Exception retirée')}>
                  Retirer
                </Button>
              </div>
            ))}
          </div>
        )}
        <Button variant="secondary" icon={<Plus />} disabled={!rel.they_see_mine} onClick={() => setAdding(true)}>
          Ajouter une bouteille
        </Button>
        {!rel.they_see_mine && <p className="small faint">Les exceptions s’appliquent quand votre cave est ouverte à {name}.</p>}
      </section>

      <RelationActions rel={rel} name={name} onChange={() => setTick((t) => t + 1)} />

      {adding && (
        <ExceptionSheet viewer={rel.user_id} name={name} selection={selection} existing={exceptions} onDone={() => setTick((t) => t + 1)} onClose={() => setAdding(false)} />
      )}
    </>
  );
}

/** Une partie de l'aperçu (ma cave, un groupe, nos événements) : ce que la personne voit de chaque bouteille. */
function PreviewList({
  title,
  rows,
  name,
  selection = false,
  action,
}: {
  title: string;
  rows: PreviewLot[];
  name: string;
  selection?: boolean;
  action?: (r: PreviewLot) => ReactNode;
}) {
  return (
    <div className="stack-sm">
      <h3 className="strong small">{title}</h3>
      <div className="list">
        {rows.map((r, i) => (
          <PreviewItem key={`${r.lot_id ?? r.name}-${r.origin}-${r.origin_id ?? ''}-${i}`} row={r} name={name} selection={selection} action={action?.(r)} />
        ))}
      </div>
    </div>
  );
}

function PreviewItem({ row, name, selection, action }: { row: PreviewLot; name: string; selection: boolean; action?: ReactNode }) {
  const { api } = useStore();
  const url = usePhotoUrl(api, row.label_photo);
  const vintage = vintageLabel(row);
  const isEvent = row.origin === 'event';
  return (
    <div className="row static" style={{ alignItems: 'flex-start' }}>
      <Thumb url={url} color={row.color} />
      <span className="row-main">
        <span className="row-title" style={{ whiteSpace: 'normal' }}>
          {row.name}
          {vintage && <span className="muted"> · {vintage}</span>}
        </span>
        <span className="row-sub" style={{ whiteSpace: 'normal' }}>
          {wineSubtitle(row)}
        </span>
        <span className="badges">
          <Pill tone={row.origin === 'exception' ? 'gold' : row.origin === 'group' || row.origin === 'event' ? 'info' : undefined}>{originLabel(row, name, selection)}</Pill>
          {isEvent ? (
            <Pill>
              {row.quantity} bouteille{(row.quantity ?? 0) > 1 ? 's' : ''} proposée{(row.quantity ?? 0) > 1 ? 's' : ''}
            </Pill>
          ) : (
            <>
              <Pill>{row.quantity !== null ? `${row.quantity} bouteille${row.quantity > 1 ? 's' : ''}` : 'Quantité masquée'}</Pill>
              <Pill>{row.purchase_price !== null ? money(row.purchase_price, row.currency ?? 'EUR') : 'Prix masqué'}</Pill>
              {row.hide_notes && <Pill>Notes masquées</Pill>}
            </>
          )}
        </span>
        {row.notes && (
          <span className="small muted" style={{ marginTop: 4 }}>
            « {row.notes} »
          </span>
        )}
        {action && <span style={{ marginTop: 6 }}>{action}</span>}
      </span>
    </div>
  );
}

/**
 * « Ajouter une bouteille » : montrer à cette personne seulement une bouteille privée (avec un accès limité à une
 * sélection : n'importe laquelle de mes bouteilles), ou lui masquer une bouteille partagée.
 */
function ExceptionSheet({
  viewer,
  name,
  selection,
  existing,
  onDone,
  onClose,
}: {
  viewer: string;
  name: string;
  selection: boolean;
  existing: CellarException[];
  onDone: () => void;
  onClose: () => void;
}) {
  const { snapshot, userId, wine, api, run } = useStore();
  const [mode, setMode] = useState<'show' | 'hide'>('show');
  const [q, setQ] = useState('');
  const taken = new Set(existing.map((e) => e.lot_id));
  const lots = snapshot.lots
    .filter((l) => l.owner_id === userId && l.quantity > 0 && !taken.has(l.id))
    .filter((l) => (mode === 'show' ? selection || l.visibility === 'private' : l.visibility !== 'private'))
    .map((l) => ({ lot: l, wine: wine(l.wine_id) }))
    .filter((x) => x.wine && fold([x.wine.name, x.wine.producer, x.wine.domaine, x.wine.appellation, vintageLabel(x.wine)].join(' ')).includes(fold(q)))
    .slice(0, 50);
  return (
    <Sheet open onClose={onClose} title="Ajouter une bouteille">
      <div className="stack">
        <Segmented<'show' | 'hide'>
          label="Exception"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'show', label: `Montrer à ${name}` },
            { value: 'hide', label: `Masquer pour ${name}` },
          ]}
        />
        <p className="small muted">
          {mode === 'show' ? `Une bouteille privée, visible de ${name} seulement (tant que votre cave lui est ouverte).` : `Une bouteille partagée avec vos amis, que ${name} ne verra plus.`}
        </p>
        <div className="search">
          <Search aria-hidden />
          <input className="input" type="search" aria-label="Chercher dans ma cave" placeholder="Chercher dans ma cave…" value={q} onChange={(e) => setQ(e.target.value)} data-autofocus />
        </div>
        {lots.length === 0 ? (
          <p className="small muted">{mode === 'show' ? 'Aucune bouteille privée disponible.' : 'Aucune bouteille partagée à masquer.'}</p>
        ) : (
          <div className="list">
            {lots.map(({ lot, wine: w }) => (
              <div key={lot.id} className="row static">
                <span className="row-main">
                  <span className="row-title" style={{ whiteSpace: 'normal' }}>
                    {wineTitle(w!)}
                  </span>
                  <span className="row-sub">
                    {lot.quantity} bouteille{lot.quantity > 1 ? 's' : ''}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={mode === 'show' ? <Eye /> : <EyeOff />}
                  onClick={async () => {
                    const res = await run(() => api.setCellarException(viewer, lot.id, mode), {
                      success: mode === 'show' ? `${w!.name} est montrée à ${name}` : `${w!.name} est masquée pour ${name}`,
                    });
                    if (res.ok) {
                      onDone();
                      onClose();
                    }
                  }}
                >
                  {mode === 'show' ? 'Montrer' : 'Masquer'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** Actions en bas de la fiche, chacune confirmée par une fenêtre qui dit ce que la personne perdra. */
function RelationActions({ rel, name, onChange }: { rel: Relation; name: string; onChange: () => void }) {
  const { api, run } = useStore();
  const confirm = useConfirm();
  const isFriend = rel.they_see_mine || rel.i_see_theirs;
  return (
    <section className="card soft stack-sm" aria-label={`Relation avec ${name}`}>
      {rel.they_see_mine && (
        <Button
          variant="ghost"
          icon={<Lock />}
          onClick={async () => {
            const ok = await confirm({
              title: `Fermer votre cave à ${name} ?`,
              message: `${name} ne verra plus aucune bouteille de votre cave. Vous restez en contact : vos groupes et vos événements communs continuent.`,
              confirmLabel: 'Fermer ma cave',
              danger: true,
            });
            if (ok && (await run(() => api.revokeCellarAccess(rel.user_id), { success: `Votre cave est fermée à ${name}` })).ok) onChange();
          }}
        >
          Fermer ma cave à {name}
        </Button>
      )}
      {!rel.they_see_mine && (
        <Button variant="ghost" icon={<KeyRound />} onClick={() => void run(() => api.grantCellarAccess(rel.user_id), { success: `Votre cave est ouverte à ${name}` }).then(onChange)}>
          Ouvrir ma cave à {name}
        </Button>
      )}
      {isFriend && (
        <Button
          variant="ghost"
          icon={<UserMinus />}
          onClick={async () => {
            const ok = await confirm({
              title: `Retirer ${name} de vos amis ?`,
              message: `Plus aucune cave ne sera ouverte entre vous : ${name} ne verra plus vos bouteilles, et vous ne verrez plus les siennes. Vous restez en contact, avec vos groupes et vos événements communs.`,
              confirmLabel: 'Retirer de mes amis',
              danger: true,
            });
            if (ok && (await run(() => api.unfriend(rel.user_id), { success: `${name} est maintenant un simple contact` })).ok) onChange();
          }}
        >
          Retirer de mes amis
        </Button>
      )}
      <Button
        variant="ghost"
        icon={<UserX />}
        onClick={async () => {
          const ok = await confirm({
            title: `Supprimer ${name} de vos contacts ?`,
            message: `Vous ne serez plus en relation : plus aucune cave ouverte entre vous, et vous ne pourrez plus vous inviter. Les souvenirs de vos événements communs sont conservés.`,
            confirmLabel: 'Supprimer le contact',
            danger: true,
          });
          if (ok && (await run(() => api.removeFriend(rel.user_id), { success: 'Contact supprimé' })).ok) go('/amis');
        }}
      >
        Supprimer le contact
      </Button>
      <Button
        variant="danger-ghost"
        icon={<Ban />}
        onClick={async () => {
          const ok = await confirm({
            title: `Bloquer ${name} ?`,
            message: `Vous ne serez plus en relation, et aucune cave ne sera plus ouverte entre vous. ${name} ne pourra plus vous trouver, vous envoyer de demande ni vous inviter, et n’en est pas averti. Vous pourrez débloquer dans Réglages › Confidentialité.`,
            confirmLabel: 'Bloquer',
            danger: true,
          });
          if (ok && (await run(() => api.blockUser(rel.user_id), { success: `${name} est bloqué` })).ok) go('/amis');
        }}
      >
        Bloquer
      </Button>
    </section>
  );
}

/** « Inviter dans un groupe » : les groupes où je peux inviter, ou un nouveau groupe avec cette personne. */
function InviteToGroupSheet({ friendId, friendName, onNewGroup, onClose }: { friendId: string; friendName: string; onNewGroup: () => void; onClose: () => void }) {
  const { snapshot, api, run } = useStore();
  const toast = useToast();
  const groups = snapshot.groups.filter((g) => g.my_status === 'active' && (g.my_role === 'admin' || g.my_role === 'manager'));
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Sheet open onClose={onClose} title={`Inviter ${friendName}`}>
      <div className="stack-sm">
        <p className="small muted">{friendName} pourra voir la cave du groupe et les bouteilles que ses membres y rendent visibles, pas votre cave. L’invitation peut être acceptée ou refusée.</p>
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

/** « Inviter à un événement » : mes événements à venir, ou un nouvel événement avec cette personne. */
function InviteToEventSheet({ friendId, friendName, onNewEvent, onClose }: { friendId: string; friendName: string; onNewEvent: () => void; onClose: () => void }) {
  const { snapshot, api, run, userId } = useStore();
  const events = snapshot.events.filter(
    (e) =>
      e.organizer_id === userId &&
      e.status === 'planned' &&
      new Date(e.starts_at) > new Date() &&
      !snapshot.participants.some((p) => p.event_id === e.id && p.user_id === friendId),
  );
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Sheet open onClose={onClose} title={`Inviter ${friendName}`}>
      <div className="stack-sm">
        <p className="small muted">{friendName} verra l’événement et les vins prévus, pas votre cave.</p>
        {events.length > 0 && (
          <div className="list">
            {events.map((e) => (
              <div key={e.id} className="row static">
                <span className="row-main">
                  <span className="row-title">{e.title}</span>
                  <span className="row-sub">{dateLong(e.starts_at)}</span>
                </span>
                <Button
                  size="sm"
                  loading={busy === e.id}
                  onClick={async () => {
                    setBusy(e.id);
                    const res = await run(() => api.inviteToEvent(e.id, [friendId]), { success: `${friendName} est invité à « ${e.title} »` });
                    setBusy(null);
                    if (res.ok) onClose();
                  }}
                >
                  Inviter
                </Button>
              </div>
            ))}
          </div>
        )}
        <Button variant={events.length ? 'ghost' : 'primary'} icon={<Plus />} onClick={onNewEvent}>
          Créer un événement avec {friendName}
        </Button>
      </div>
    </Sheet>
  );
}

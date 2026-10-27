/**
 * Amis & Groupes : recherche de personnes visibles, amis (au moins une cave ouverte) et contacts (aucune cave ouverte),
 * bouteilles partagées, invitations et demandes, liens d'invitation, groupes.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check as CheckIcon, Eye, KeyRound, Search, Send, UserPlus, X } from 'lucide-react';
import { m } from 'motion/react';
import type { Relation, SharedLot, UserResult } from '../../domain/types';
import { useStore } from '../../data/store';
import { dateLong, deName } from '../../domain/format';
import { toMessage } from '../../domain/errors';
import { fold, vintageLabel } from '../../domain/wine';
import { Avatar, Button, Check, EmptyState, InlineLoading, Notice, Pill, Segmented, Sheet } from '../../ui/kit';
import { rowMotion } from '../../ui/motion';
import { go, routeQuery, useRoute } from '../../ui/router';
import { useActions } from '../../ui/Shell';
import { FirstTip } from '../tour/Tour';
import { InviteSheet, MyInvites } from './InviteSheet';
import { SharedItem } from './SharedItem';
import { GroupsTab } from '../groups/GroupsTab';

type Tab = 'amis' | 'invitations' | 'groupes';

export function FriendsPage() {
  const { snapshot, userId } = useStore();
  const actions = useActions();
  const route = useRoute();
  const query = routeQuery(route);
  const requested = query.get('onglet');
  const [tab, setTab] = useState<Tab>(requested === 'invitations' || requested === 'groupes' ? requested : 'amis');
  const [inviting, setInviting] = useState(false);
  // « Inviter quelqu'un » : aussi ouvert par un accès direct (#/amis?inviter=1) ; l'adresse redevient celle de la page.
  const wantsInvite = query.get('inviter') === '1';
  useEffect(() => {
    if (!wantsInvite) return;
    setInviting(true);
    go(requested === 'invitations' || requested === 'groupes' ? `/amis?onglet=${requested}` : '/amis', { replace: true });
  }, [wantsInvite, requested]);
  useEffect(() => {
    if (requested === 'invitations' || requested === 'groupes' || requested === 'amis') setTab(requested);
  }, [requested]);
  const incoming =
    snapshot.requests.filter((r) => r.direction === 'in').length +
    snapshot.cellarLinks.filter((l) => l.user_id === userId && l.status === 'invited').length +
    snapshot.relations.filter((r) => r.request_in).length;
  const groupInvites = snapshot.groups.filter((g) => g.my_status === 'invited').length;

  return (
    <>
      <FirstTip id="amis" title="Vos amis et contacts" onHelp={actions.help}>
        « Inviter quelqu’un » envoie un lien, même à une personne sans compte. Découvrir l’application ne donne jamais accès à votre cave : vous
        l’ouvrez à qui vous voulez, en entier ou quelques bouteilles, et vous la refermez quand vous voulez.
      </FirstTip>
      <Button size="lg" block icon={<Send />} onClick={() => setInviting(true)} data-tour="inviter">
        Inviter quelqu’un
      </Button>
      <Segmented<Tab>
        label="Sections"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'amis', label: 'Amis' },
          { value: 'invitations', label: incoming ? `Invitations (${incoming})` : 'Invitations' },
          { value: 'groupes', label: groupInvites ? `Groupes (${groupInvites})` : 'Groupes' },
        ]}
      />
      {tab === 'amis' && <FriendsTab />}
      {tab === 'invitations' && <InvitationsTab />}
      {tab === 'groupes' && <GroupsTab />}
      {inviting && <InviteSheet onClose={() => setInviting(false)} />}
    </>
  );
}

/** Qui voit la cave de qui : « Voit ma cave », « Je vois sa cave ». */
export function AccessBadges({ relation }: { relation: Relation }) {
  if (!relation.they_see_mine && !relation.i_see_theirs) return null;
  return (
    <span className="badges">
      {relation.they_see_mine && <Pill tone="primary">Voit ma cave</Pill>}
      {relation.i_see_theirs && <Pill tone="gold">Je vois sa cave</Pill>}
    </span>
  );
}

function FriendsTab() {
  const { snapshot, api, run, me } = useStore();
  const [shared, setShared] = useState<SharedLot[] | null>(null);
  const [q, setQ] = useState('');
  const relations = snapshot.relations;
  const friends = relations.filter((r) => r.they_see_mine || r.i_see_theirs);
  const contacts = relations.filter((r) => !r.they_see_mine && !r.i_see_theirs);
  const openToMe = relations.filter((r) => r.i_see_theirs).length;
  const accessKey = relations.map((r) => `${r.user_id}:${r.i_see_theirs}`).join(',');

  useEffect(() => {
    let alive = true;
    void api
      .sharedLots(null)
      .then((rows) => alive && setShared(rows))
      .catch(() => alive && setShared([]));
    return () => {
      alive = false;
    };
  }, [api, accessKey]);

  const filtered = useMemo(() => {
    const words = fold(q).split(/\s+/).filter(Boolean);
    return (shared ?? []).filter((s) => words.every((w) => fold([s.name, s.producer, s.domaine, s.region, s.appellation, s.owner_name, vintageLabel(s)].join(' ')).includes(w)));
  }, [shared, q]);

  return (
    <>
      <PeopleSearch />
      {!me.discoverable && (
        <p className="small muted">
          Vous n’apparaissez pas dans la recherche des autres. Pour changer : <a href="#/reglages">Réglages › Confidentialité</a>.
        </p>
      )}

      <section aria-labelledby="h-friends">
        <div className="section-title">
          <h2 id="h-friends">Mes amis</h2>
          <span className="small muted">{friends.length}</span>
        </div>
        {friends.length === 0 ? (
          <EmptyState icon="🤝" title={contacts.length ? 'Aucune cave ouverte pour l’instant' : 'Pas encore d’amis'}>
            {contacts.length
              ? 'Un ami, c’est un contact à qui vous avez ouvert votre cave (ou qui vous a ouvert la sienne).'
              : 'Cherchez une personne ci-dessus, ou envoyez-lui un lien avec « Inviter quelqu’un ».'}
          </EmptyState>
        ) : (
          <div className="list">
            {friends.map((r, i) => (
              <m.a key={r.user_id} className="row" href={`#/amis/${r.user_id}`} {...rowMotion(i)}>
                <Avatar name={r.display_name} seed={r.user_id} />
                <span className="row-main">
                  <span className="row-title">{r.display_name}</span>
                  {/* Jamais « 0 vin partagé » : le compteur n'apparaît que s'il y a quelque chose à voir. */}
                  {r.shared_with_me > 0 && (
                    <span className="row-sub">
                      {r.shared_with_me} vin{r.shared_with_me > 1 ? 's' : ''} partagé{r.shared_with_me > 1 ? 's' : ''} avec vous
                    </span>
                  )}
                  <AccessBadges relation={r} />
                </span>
              </m.a>
            ))}
          </div>
        )}
      </section>

      {contacts.length > 0 && (
        <section aria-labelledby="h-contacts">
          <div className="section-title">
            <h2 id="h-contacts">Mes contacts</h2>
            <span className="small muted">{contacts.length}</span>
          </div>
          <p className="small muted" style={{ marginBottom: 10 }}>
            En relation, sans cave ouverte : vous pouvez vous inviter à des événements et à des groupes.
          </p>
          <div className="list">
            {contacts.map((r, i) => (
              <m.div key={r.user_id} className="row static" style={{ alignItems: 'flex-start' }} {...rowMotion(i, false)}>
                <Avatar name={r.display_name} seed={r.user_id} />
                <span className="row-main">
                  <a className="row-title" href={`#/amis/${r.user_id}`}>
                    {r.display_name}
                  </a>
                  <span className="inline" style={{ marginTop: 8 }}>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<KeyRound />}
                      aria-label={`Ouvrir ma cave à ${r.display_name}`}
                      onClick={() => void run(() => api.grantCellarAccess(r.user_id), { success: `Votre cave est ouverte à ${r.display_name}` })}
                    >
                      Ouvrir ma cave
                    </Button>
                    {r.request_out ? (
                      <span className="small muted">Accès demandé</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Eye />}
                        aria-label={`Demander à voir la cave ${deName(r.display_name)}`}
                        onClick={() => void run(() => api.requestCellarAccess(r.user_id), { success: `Demande envoyée à ${r.display_name}` })}
                      >
                        Demander l’accès
                      </Button>
                    )}
                  </span>
                </span>
              </m.div>
            ))}
          </div>
        </section>
      )}

      {relations.length === 0 && (
        <EmptyState icon="✉️" title="Invitez quelqu’un">
          « Inviter quelqu’un » › « Découvrir l’application » : un lien qui n’ouvre pas votre cave.
        </EmptyState>
      )}

      {openToMe > 0 &&
        (me.show_shared_wines ? (
          <details className="fold" open>
            <summary className="section-title">
              <h2 id="h-shared">Bouteilles partagées par mes amis</h2>
              {shared !== null && shared.length > 0 && <span className="small muted">{shared.length}</span>}
            </summary>
            <div className="stack-sm">
              <div className="search">
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
              <p className="small faint">
                <button type="button" className="link-btn" onClick={() => void run(() => api.setShowSharedWines(me.id, false), { success: 'Section masquée' })}>
                  Masquer cette section
                </button>{' '}
                (vous pourrez la réafficher dans Réglages › Affichage).
              </p>
            </div>
          </details>
        ) : (
          <p className="small faint">
            Section « Bouteilles partagées par mes amis » masquée.{' '}
            <button type="button" className="link-btn" onClick={() => void run(() => api.setShowSharedWines(me.id, true), { success: 'Section affichée' })}>
              L’afficher
            </button>
          </p>
        ))}
    </>
  );
}

/** Recherche de personnes visibles (3 lettres minimum), avec l'action adaptée à la relation. */
function PeopleSearch() {
  const { api, snapshot } = useStore();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<UserResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<UserResult | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) {
      setResults(null);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      api
        .searchUsers(term)
        .then((r) => alive && (setResults(r), setError(null)))
        .catch((e) => alive && setError(toMessage(e)));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [api, q]);

  const incoming = asking ? snapshot.requests.find((r) => r.direction === 'in' && r.other_id === asking.id) : undefined;

  return (
    <section className="card stack-sm" aria-labelledby="h-search">
      <h2 id="h-search" className="section">
        Trouver des personnes
      </h2>
      <div className="search">
        <Search aria-hidden />
        <input className="input" type="search" placeholder="Nom d’une personne (3 lettres minimum)" aria-label="Chercher une personne" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <Notice tone="warn">{error}</Notice>}
      {results !== null &&
        (results.length === 0 ? (
          <p className="small muted">Personne n’a été trouvé. Seules les personnes qui ont choisi d’apparaître dans la recherche sont proposées ; sinon, envoyez-leur un lien d’invitation.</p>
        ) : (
          <div className="list">
            {results.map((u) => (
              <div key={u.id} className="row static">
                <Avatar name={u.display_name} seed={u.id} />
                <span className="row-main">
                  <span className="row-title">{u.display_name}</span>
                </span>
                {u.relation === 'friend' || u.relation === 'contact' ? (
                  <Button size="sm" variant="ghost" onClick={() => go(`/amis/${u.id}`)}>
                    {u.relation === 'friend' ? 'Ami' : 'Contact'}
                  </Button>
                ) : u.relation === 'requested' ? (
                  <span className="small muted">Demande envoyée</span>
                ) : (
                  <Button size="sm" icon={<UserPlus />} onClick={() => setAsking(u)}>
                    {u.relation === 'incoming' ? 'Accepter' : 'Ajouter'}
                  </Button>
                )}
              </div>
            ))}
          </div>
        ))}
      {asking && (
        <ConnectSheet
          person={{ id: asking.id, name: asking.display_name }}
          request={incoming ? { id: incoming.id, openCellar: incoming.open_cellar } : null}
          onDone={(relation) => setResults((rs) => rs?.map((r) => (r.id === asking.id ? { ...r, relation } : r)) ?? null)}
          onClose={() => setAsking(null)}
        />
      )}
    </section>
  );
}

/**
 * Envoyer une demande (« Lui ouvrir ma cave », non coché) ou accepter celle reçue (« Ouvrir aussi la mienne », non coché).
 * Une demande crée un simple contact : aucune cave n'est ouverte sans un choix explicite.
 */
function ConnectSheet({
  person,
  request,
  onDone,
  onClose,
}: {
  person: { id: string; name: string };
  request: { id: string; openCellar: boolean } | null;
  onDone?: (relation: UserResult['relation']) => void;
  onClose: () => void;
}) {
  const { api, run } = useStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      open
      onClose={onClose}
      title={request ? `Accepter ${person.name}` : `Ajouter ${person.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              const res = request
                ? await run(
                    async () => {
                      await api.respondFriendRequest(request.id, true);
                      if (open) await api.grantCellarAccess(person.id);
                    },
                    { success: `${person.name} fait partie de vos ${open || request.openCellar ? 'amis' : 'contacts'}` },
                  )
                : await run(() => api.sendFriendRequest(person.id, open), { success: `Demande envoyée à ${person.name}` });
              setBusy(false);
              if (res.ok) {
                onDone?.(request ? (open || request.openCellar ? 'friend' : 'contact') : 'requested');
                onClose();
              }
            }}
          >
            {request ? 'Accepter' : 'Envoyer la demande'}
          </Button>
        </>
      }
    >
      <div className="stack">
        {request ? (
          <p className="muted">
            {request.openCellar
              ? `${person.name} vous ouvre aussi sa cave : vous verrez les bouteilles partagées avec ses amis.`
              : `Vous serez en contact : vous pourrez vous inviter à des événements et à des groupes, sans voir vos caves.`}
          </p>
        ) : (
          <p className="muted">
            {person.name} recevra une demande. Une fois acceptée, vous serez en contact : vous pourrez vous inviter à des événements et à des groupes.
          </p>
        )}
        <Check
          checked={open}
          onChange={setOpen}
          label={request ? 'Ouvrir aussi ma cave' : 'Lui ouvrir ma cave'}
          hint={`${person.name} verra les bouteilles que vous partagez avec vos amis, jamais vos bouteilles privées. Vous pourrez la refermer à tout moment.`}
        />
      </div>
    </Sheet>
  );
}

function InvitationsTab() {
  const { snapshot, api, run, userId } = useStore();
  const [accepting, setAccepting] = useState<{ id: string; name: string; requestId: string; openCellar: boolean } | null>(null);
  const received = snapshot.requests.filter((r) => r.direction === 'in');
  const sent = snapshot.requests.filter((r) => r.direction === 'out');
  // Caves dont la personne propriétaire me propose la gestion à plusieurs.
  const cellarInvites = snapshot.cellarLinks.filter((l) => l.user_id === userId && l.status === 'invited');
  // Demandes à voir ma cave.
  const accessRequests = snapshot.relations.filter((r) => r.request_in);

  return (
    <>
      {cellarInvites.length > 0 && (
        <section aria-labelledby="h-cellar-invites">
          <div className="section-title">
            <h2 id="h-cellar-invites">Caves à gérer à plusieurs</h2>
            <span className="small muted">{cellarInvites.length}</span>
          </div>
          <div className="list">
            {cellarInvites.map((c) => (
              <div key={c.cellar_id} className="row static" style={{ alignItems: 'flex-start' }}>
                <Avatar name={c.owner_name} seed={c.owner_id} />
                <span className="row-main">
                  <span className="row-title" style={{ whiteSpace: 'normal' }}>
                    « {c.cellar_name} », la cave {deName(c.owner_name)}
                  </span>
                  <span className="row-sub" style={{ whiteSpace: 'normal' }}>
                    {c.owner_name} vous propose de la gérer à plusieurs : vous la verrez comme la vôtre (ajouter, boire, corriger, ranger), avec votre compte.
                  </span>
                  <span className="inline" style={{ marginTop: 8 }}>
                    <Button
                      size="sm"
                      icon={<CheckIcon />}
                      aria-label={`Accepter de gérer « ${c.cellar_name} » ${deName(c.owner_name)}`}
                      onClick={() => void run(() => api.respondCellarInvite(c.cellar_id, true), { success: `Vous gérez maintenant « ${c.cellar_name} » avec ${c.owner_name}` })}
                    >
                      Accepter
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<X />}
                      aria-label={`Refuser de gérer « ${c.cellar_name} » ${deName(c.owner_name)}`}
                      onClick={() => void run(() => api.respondCellarInvite(c.cellar_id, false), { success: 'Invitation refusée' })}
                    >
                      Refuser
                    </Button>
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {accessRequests.length > 0 && (
        <section aria-labelledby="h-access">
          <div className="section-title">
            <h2 id="h-access">Demandes à voir ma cave</h2>
            <span className="small muted">{accessRequests.length}</span>
          </div>
          <div className="list">
            {accessRequests.map((r) => (
              <div key={r.request_in!} className="row static" style={{ alignItems: 'flex-start' }}>
                <Avatar name={r.display_name} seed={r.user_id} />
                <span className="row-main">
                  <span className="row-title">{r.display_name}</span>
                  <span className="row-sub" style={{ whiteSpace: 'normal' }}>
                    Souhaite voir les bouteilles que vous partagez avec vos amis.
                  </span>
                  <span className="inline" style={{ marginTop: 8 }}>
                    <Button
                      size="sm"
                      icon={<KeyRound />}
                      aria-label={`Ouvrir ma cave à ${r.display_name}`}
                      onClick={() => void run(() => api.respondAccessRequest(r.request_in!, true), { success: `Votre cave est ouverte à ${r.display_name}` })}
                    >
                      Ouvrir ma cave
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<X />}
                      aria-label={`Refuser la demande ${deName(r.display_name)}`}
                      onClick={() => void run(() => api.respondAccessRequest(r.request_in!, false), { success: 'Demande refusée' })}
                    >
                      Refuser
                    </Button>
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="h-received">
        <div className="section-title">
          <h2 id="h-received">Demandes reçues</h2>
          <span className="small muted">{received.length}</span>
        </div>
        {received.length === 0 ? (
          <p className="small muted">Aucune demande en attente.</p>
        ) : (
          <div className="list">
            {received.map((r) => (
              <div key={r.id} className="row static">
                <Avatar name={r.other_name} seed={r.other_id} />
                <span className="row-main">
                  <span className="row-title">{r.other_name}</span>
                  <span className="row-sub" style={{ whiteSpace: 'normal' }}>
                    Demande du {dateLong(r.created_at)}
                    {r.open_cellar ? ' · vous ouvre aussi sa cave' : ''}
                  </span>
                </span>
                <span className="inline">
                  <Button size="sm" icon={<CheckIcon />} onClick={() => setAccepting({ id: r.other_id, name: r.other_name, requestId: r.id, openCellar: r.open_cellar })}>
                    Accepter
                  </Button>
                  <Button size="sm" variant="ghost" icon={<X />} onClick={() => void run(() => api.respondFriendRequest(r.id, false), { success: 'Demande refusée' })}>
                    Refuser
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="h-sent">
        <div className="section-title">
          <h2 id="h-sent">Demandes envoyées</h2>
          <span className="small muted">{sent.length}</span>
        </div>
        {sent.length === 0 ? (
          <p className="small muted">Aucune demande en attente de réponse.</p>
        ) : (
          <div className="list">
            {sent.map((r) => (
              <div key={r.id} className="row static">
                <Avatar name={r.other_name} seed={r.other_id} />
                <span className="row-main">
                  <span className="row-title">{r.other_name}</span>
                  <span className="row-sub">Envoyée le {dateLong(r.created_at)}</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => void run(() => api.cancelFriendRequest(r.id), { success: 'Demande annulée' })}>
                  Annuler
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <MyInvites />

      <Button variant="ghost" onClick={() => go('/ami')}>
        J’ai reçu un code
      </Button>

      {accepting && (
        <ConnectSheet person={{ id: accepting.id, name: accepting.name }} request={{ id: accepting.requestId, openCellar: accepting.openCellar }} onClose={() => setAccepting(null)} />
      )}
    </>
  );
}

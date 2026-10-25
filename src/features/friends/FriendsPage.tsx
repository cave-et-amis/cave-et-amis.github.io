/**
 * Amis & Groupes : recherche de personnes visibles, amis (au moins une cave ouverte) et contacts (aucune cave ouverte),
 * bouteilles partagées, invitations et demandes, liens d'invitation, groupes.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check as CheckIcon, Copy, Eye, KeyRound, Search, Share2, UserPlus, Users, X } from 'lucide-react';
import type { InviteKind, Relation, SharedLot, UserResult } from '../../domain/types';
import { useStore } from '../../data/store';
import { dateLong, deName } from '../../domain/format';
import { toMessage } from '../../domain/errors';
import { fold, vintageLabel } from '../../domain/wine';
import { Avatar, Button, Check, copyText, EmptyState, Field, InlineLoading, Notice, Pill, Segmented, Sheet, useConfirm, useToast } from '../../ui/kit';
import { go, routeQuery, useRoute } from '../../ui/router';
import { INVITE_KINDS, inviteLink, inviteValidity, prettyCode } from './invite';
import { SharedItem } from './SharedItem';
import { GroupsTab } from '../groups/GroupsTab';

type Tab = 'amis' | 'invitations' | 'groupes';

export function FriendsPage() {
  const { snapshot, userId } = useStore();
  const route = useRoute();
  const requested = routeQuery(route).get('onglet');
  const [tab, setTab] = useState<Tab>(requested === 'invitations' || requested === 'groupes' ? requested : 'amis');
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
              : 'Cherchez une personne ci-dessus, ou envoyez-lui un lien d’invitation (onglet Invitations).'}
          </EmptyState>
        ) : (
          <div className="list">
            {friends.map((r) => (
              <a key={r.user_id} className="row" href={`#/amis/${r.user_id}`}>
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
              </a>
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
            {contacts.map((r) => (
              <div key={r.user_id} className="row static" style={{ alignItems: 'flex-start' }}>
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
              </div>
            ))}
          </div>
        </section>
      )}

      {relations.length === 0 && (
        <EmptyState icon="✉️" title="Invitez quelqu’un">
          Un lien « Découvrir l’application » permet d’inviter sans ouvrir votre cave (onglet Invitations).
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
  const confirm = useConfirm();
  const [created, setCreated] = useState<{ code: string; expires_at: string; kind: InviteKind; max_uses: number; target: string | null } | null>(null);
  const [accepting, setAccepting] = useState<{ id: string; name: string; requestId: string; openCellar: boolean } | null>(null);
  const received = snapshot.requests.filter((r) => r.direction === 'in');
  const sent = snapshot.requests.filter((r) => r.direction === 'out');
  // Caves dont la personne propriétaire me propose la gestion à plusieurs.
  const cellarInvites = snapshot.cellarLinks.filter((l) => l.user_id === userId && l.status === 'invited');
  // Demandes à voir ma cave.
  const accessRequests = snapshot.relations.filter((r) => r.request_in);
  const activeLinks = snapshot.invites.filter((i) => i.inviter_id === userId && i.status === 'pending' && new Date(i.expires_at) > new Date() && i.uses < i.max_uses);
  const targetName = (kind: InviteKind, id: string | null) =>
    kind === 'group' ? snapshot.groups.find((g) => g.id === id)?.name : kind === 'event' ? snapshot.events.find((e) => e.id === id)?.title : undefined;

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

      <NewInviteCard onCreated={setCreated} />

      {activeLinks.length > 0 && (
        <section aria-labelledby="h-links">
          <div className="section-title">
            <h2 id="h-links">Liens actifs</h2>
            <span className="small muted">{activeLinks.length}</span>
          </div>
          <div className="list">
            {activeLinks.map((i) => {
              const kind = INVITE_KINDS.find((k) => k.value === i.kind);
              const target = targetName(i.kind, i.target_id);
              return (
                <div key={i.id} className="row static">
                  <Share2 aria-hidden style={{ color: 'var(--primary)', flex: 'none' }} />
                  <span className="row-main">
                    <span className="row-title" style={{ whiteSpace: 'normal' }}>
                      {kind?.label ?? 'Invitation'}
                      {target ? ` : « ${target} »` : ''}
                    </span>
                    <span className="row-sub" style={{ whiteSpace: 'normal' }}>
                      {inviteValidity(i)}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Révoquer le lien ${kind?.label ?? ''}${target ? ` « ${target} »` : ''}`}
                    onClick={async () => {
                      const ok = await confirm({
                        title: 'Révoquer ce lien ?',
                        message: 'Il ne fonctionnera plus. Les personnes qui l’ont déjà utilisé gardent leur place.',
                        confirmLabel: 'Révoquer',
                        danger: true,
                      });
                      if (ok) await run(() => api.revokeInvite(i.id), { success: 'Lien révoqué' });
                    }}
                  >
                    Révoquer
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <Button variant="ghost" onClick={() => go('/ami')}>
        J’ai reçu un code
      </Button>

      <Sheet open={created !== null} onClose={() => setCreated(null)} title="Lien d’invitation">
        {created && <InviteShare {...created} />}
      </Sheet>
      {accepting && (
        <ConnectSheet person={{ id: accepting.id, name: accepting.name }} request={{ id: accepting.requestId, openCellar: accepting.openCellar }} onClose={() => setAccepting(null)} />
      )}
    </>
  );
}

/** Nouveau lien : découvrir l'application, ami avec accès à ma cave, rejoindre un de mes groupes, venir à un événement. */
function NewInviteCard({ onCreated }: { onCreated: (i: { code: string; expires_at: string; kind: InviteKind; max_uses: number; target: string | null }) => void }) {
  const { snapshot, api, run, userId } = useStore();
  const [kind, setKind] = useState<InviteKind>('discovery');
  const groups = snapshot.groups.filter((g) => g.my_status === 'active' && (g.my_role === 'admin' || g.my_role === 'manager'));
  const events = snapshot.events.filter((e) => e.organizer_id === userId && e.status === 'planned' && new Date(e.starts_at) > new Date());
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const options = INVITE_KINDS.filter((k) => (k.value === 'group' ? groups.length > 0 : k.value === 'event' ? events.length > 0 : true));
  const chosen = INVITE_KINDS.find((k) => k.value === kind)!;
  const needsTarget = kind === 'group' || kind === 'event';
  const list = kind === 'group' ? groups.map((g) => ({ id: g.id, label: g.name })) : events.map((e) => ({ id: e.id, label: `${e.title} (${dateLong(e.starts_at)})` }));
  const targetId = needsTarget ? target || list[0]?.id || '' : null;

  return (
    <section className="card stack" aria-labelledby="h-invite-link">
      <div className="inline">
        <Users aria-hidden style={{ color: 'var(--primary)' }} />
        <h2 id="h-invite-link" className="section">
          Inviter par lien
        </h2>
      </div>
      <p className="muted small">Pour une personne qui n’apparaît pas dans la recherche, ou pas encore inscrite : envoyez-lui un lien (SMS, WhatsApp, e-mail).</p>
      <Field label="Ce que le lien permet">
        <div className="stack-sm" role="radiogroup" aria-label="Type de lien">
          {options.map((k) => (
            <label key={k.value} className="check">
              <input
                type="radio"
                name="invite-kind"
                checked={kind === k.value}
                onChange={() => {
                  setKind(k.value);
                  setTarget('');
                }}
              />
              <span className="check-text">
                <span>{k.label}</span>
                {kind === k.value && <small>{k.hint}</small>}
              </span>
            </label>
          ))}
        </div>
      </Field>
      {needsTarget && (
        <Field label={kind === 'group' ? 'Groupe' : 'Événement'}>
          <select className="input" value={targetId ?? ''} onChange={(e) => setTarget(e.target.value)}>
            {list.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Button
        icon={<Share2 />}
        loading={busy}
        disabled={needsTarget && !targetId}
        onClick={async () => {
          setBusy(true);
          const res = await run(() => api.createInvite(kind, targetId));
          setBusy(false);
          if (res.ok) onCreated({ ...res.value, target: needsTarget ? (list.find((o) => o.id === targetId)?.label ?? null) : null });
        }}
      >
        Créer le lien « {chosen.label} »
      </Button>
    </section>
  );
}

const SHARE_TEXT: Record<InviteKind, (target: string | null) => string> = {
  discovery: () => 'Je t’invite à découvrir Cave & Amis, pour organiser nos dîners et parler vin',
  friend: () => 'Je t’invite sur Cave & Amis : je t’ouvre ma cave, pour partager nos bouteilles et organiser nos dîners',
  group: (t) => `Je t’invite à rejoindre le groupe « ${t ?? ''} » sur Cave & Amis`,
  event: (t) => `Je t’invite à « ${t ?? ''} » sur Cave & Amis`,
};

function InviteShare({ code, expires_at, kind, max_uses, target }: { code: string; expires_at: string; kind: InviteKind; max_uses: number; target: string | null }) {
  const toast = useToast();
  const link = inviteLink(code);
  const text = `${SHARE_TEXT[kind](target)} : ${link}`;
  return (
    <div className="stack">
      <p className="muted">
        Envoyez ce lien. La personne pourra accepter ou refuser. {max_uses === 1 ? 'Une seule utilisation' : `Jusqu’à ${max_uses} personnes`}, jusqu’au {dateLong(expires_at)}.
      </p>
      <div className="kbd-code" aria-label="Code d’invitation">
        {prettyCode(code)}
      </div>
      <p className="small faint center">Le code peut aussi être dicté : il se saisit dans Amis & Groupes › Invitations › « J’ai reçu un code ».</p>
      {typeof navigator.share === 'function' && (
        <Button icon={<Share2 />} onClick={() => void navigator.share({ title: 'Cave & Amis', text }).catch(() => undefined)}>
          Partager le lien
        </Button>
      )}
      <Button
        variant="secondary"
        icon={<Copy />}
        onClick={async () => toast((await copyText(link)) ? 'Lien copié' : 'Copie impossible : sélectionnez le code à la main', { tone: 'info' })}
      >
        Copier le lien
      </Button>
      <Notice tone="info">Ce code n’est montré qu’une fois. S’il se perd, créez simplement un nouveau lien. Vous pouvez le révoquer dans « Liens actifs ».</Notice>
    </div>
  );
}

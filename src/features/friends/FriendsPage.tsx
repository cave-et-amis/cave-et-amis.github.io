/** Amis & Groupes : recherche de personnes visibles, liste des amis, invitations reçues et envoyées, groupes. */
import { useEffect, useMemo, useState } from 'react';
import { Check as CheckIcon, Copy, Search, Share2, UserPlus, Users, X } from 'lucide-react';
import type { SharedLot, UserResult } from '../../domain/types';
import { useStore } from '../../data/store';
import { dateLong, deName } from '../../domain/format';
import { toMessage } from '../../domain/errors';
import { fold, vintageLabel } from '../../domain/wine';
import { Avatar, Button, copyText, EmptyState, InlineLoading, Notice, Segmented, Sheet, useConfirm, useToast } from '../../ui/kit';
import { go, routeQuery, useRoute } from '../../ui/router';
import { inviteLink, prettyCode } from './invite';
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
    snapshot.requests.filter((r) => r.direction === 'in').length + snapshot.cellarLinks.filter((l) => l.user_id === userId && l.status === 'invited').length;
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

function FriendsTab() {
  const { friends, api, me } = useStore();
  const [shared, setShared] = useState<SharedLot[] | null>(null);
  const [q, setQ] = useState('');
  const friendKey = friends.map((f) => f.id).join(',');

  useEffect(() => {
    let alive = true;
    void api
      .sharedLots(null)
      .then((rows) => alive && setShared(rows))
      .catch(() => alive && setShared([]));
    return () => {
      alive = false;
    };
  }, [api, friendKey]);

  const filtered = useMemo(() => {
    const words = fold(q).split(/\s+/).filter(Boolean);
    return (shared ?? []).filter((s) => words.every((w) => fold([s.name, s.producer, s.domaine, s.region, s.appellation, s.owner_name, vintageLabel(s)].join(' ')).includes(w)));
  }, [shared, q]);
  const countFor = (id: string) => (shared ?? []).filter((s) => s.owner_id === id).length;

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
          <EmptyState icon="🤝" title="Pas encore d’amis connectés">
            Cherchez une personne ci-dessus, ou envoyez-lui un lien d’invitation (onglet Invitations).
          </EmptyState>
        ) : (
          <div className="list">
            {friends.map((f) => (
              <a key={f.id} className="row" href={`#/amis/${f.id}`}>
                <Avatar name={f.display_name} seed={f.id} />
                <span className="row-main">
                  <span className="row-title">{f.display_name}</span>
                  <span className="row-sub">{shared === null ? '…' : `${countFor(f.id)} vin${countFor(f.id) > 1 ? 's' : ''} partagé${countFor(f.id) > 1 ? 's' : ''} avec vous`}</span>
                </span>
              </a>
            ))}
          </div>
        )}
      </section>

      {friends.length > 0 && (
        <section aria-labelledby="h-shared">
          <div className="section-title">
            <h2 id="h-shared">Bouteilles partagées par mes amis</h2>
          </div>
          <div className="search" style={{ marginBottom: 10 }}>
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
        </section>
      )}
    </>
  );
}

/** Recherche de personnes visibles (3 lettres minimum), avec l'action adaptée à la relation. */
function PeopleSearch() {
  const { api, run, snapshot } = useStore();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<UserResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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

  async function act(u: UserResult) {
    setBusy(u.id);
    const incoming = snapshot.requests.find((r) => r.direction === 'in' && r.other_id === u.id);
    const res = incoming
      ? await run(() => api.respondFriendRequest(incoming.id, true), { success: `${u.display_name} est maintenant votre ami` })
      : await run(() => api.sendFriendRequest(u.id), { success: `Demande envoyée à ${u.display_name}` });
    setBusy(null);
    if (res.ok) setResults((rs) => rs?.map((r) => (r.id === u.id ? { ...r, relation: incoming ? 'friend' : 'requested' } : r)) ?? null);
  }

  return (
    <section className="card stack-sm" aria-labelledby="h-search">
      <h2 id="h-search" className="section">
        Trouver des amis
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
                {u.relation === 'friend' ? (
                  <Button size="sm" variant="ghost" onClick={() => go(`/amis/${u.id}`)}>
                    Ami
                  </Button>
                ) : u.relation === 'requested' ? (
                  <span className="small muted">Demande envoyée</span>
                ) : (
                  <Button size="sm" icon={<UserPlus />} loading={busy === u.id} onClick={() => void act(u)}>
                    {u.relation === 'incoming' ? 'Accepter' : 'Demander en ami'}
                  </Button>
                )}
              </div>
            ))}
          </div>
        ))}
    </section>
  );
}

function InvitationsTab() {
  const { snapshot, api, run, userId } = useStore();
  const confirm = useConfirm();
  const [invite, setInvite] = useState<{ code: string; expires_at: string } | null>(null);
  const received = snapshot.requests.filter((r) => r.direction === 'in');
  const sent = snapshot.requests.filter((r) => r.direction === 'out');
  // Caves dont la personne propriétaire me propose la gestion à plusieurs.
  const cellarInvites = snapshot.cellarLinks.filter((l) => l.user_id === userId && l.status === 'invited');
  const pendingLinks = snapshot.invites.filter((i) => i.inviter_id === userId && i.status === 'pending' && new Date(i.expires_at) > new Date());

  async function createInvite() {
    const res = await run(() => api.createInvite(), { reload: true });
    if (res.ok) setInvite({ code: res.value.code, expires_at: res.value.expires_at });
  }

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
                  <span className="row-sub">Demande du {dateLong(r.created_at)}</span>
                </span>
                <span className="inline">
                  <Button size="sm" icon={<CheckIcon />} onClick={() => void run(() => api.respondFriendRequest(r.id, true), { success: `${r.other_name} est maintenant votre ami` })}>
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

      <section className="card stack">
        <div className="inline">
          <Users aria-hidden style={{ color: 'var(--primary)' }} />
          <h2 className="section">Inviter par lien</h2>
        </div>
        <p className="muted small">
          Pour une personne qui n’apparaît pas dans la recherche, ou pas encore inscrite : envoyez-lui un lien (SMS, WhatsApp, e-mail). Elle ne verra que les
          bouteilles que vous choisissez de partager.
        </p>
        <Button icon={<Share2 />} onClick={() => void createInvite()}>
          Créer un lien d’invitation
        </Button>
        <Button variant="ghost" onClick={() => go('/ami')}>
          J’ai reçu un code
        </Button>
        {pendingLinks.length > 0 && (
          <p className="small faint">
            {pendingLinks.length} lien{pendingLinks.length > 1 ? 's' : ''} en attente de réponse.{' '}
            <button
              type="button"
              className="link-btn"
              onClick={async () => {
                if (!(await confirm({ title: 'Annuler les liens en attente ?', message: 'Les liens déjà envoyés ne fonctionneront plus.', confirmLabel: 'Annuler les liens' }))) return;
                await run(async () => {
                  for (const i of pendingLinks) await api.revokeInvite(i.id);
                }, { success: 'Liens annulés' });
              }}
            >
              Les annuler
            </button>
          </p>
        )}
      </section>

      <Sheet open={invite !== null} onClose={() => setInvite(null)} title="Lien d’invitation">
        {invite && <InviteShare code={invite.code} expires={invite.expires_at} />}
      </Sheet>
    </>
  );
}

function InviteShare({ code, expires }: { code: string; expires: string }) {
  const toast = useToast();
  const link = inviteLink(code);
  const text = `Je t’invite sur Cave & Amis pour partager nos bouteilles et organiser nos dîners : ${link}`;
  return (
    <div className="stack">
      <p className="muted">Envoyez ce lien à votre ami. Il pourra accepter ou refuser. Valable jusqu’au {dateLong(expires)}, une seule fois.</p>
      <div className="kbd-code" aria-label="Code d’invitation">
        {prettyCode(code)}
      </div>
      <p className="small faint center">Le code peut aussi être dicté : votre ami le saisit dans Amis & Groupes › Invitations › « J’ai reçu un code ».</p>
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
      <Notice tone="info">Ce code n’est montré qu’une fois. S’il se perd, créez simplement un nouveau lien.</Notice>
    </div>
  );
}

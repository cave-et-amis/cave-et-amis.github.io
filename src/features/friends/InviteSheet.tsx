/**
 * « Inviter quelqu'un » : choisir ce que permet le lien (découvrir l'application, voir ma cave — tout ou une sélection,
 * avec une date de fin —, rejoindre un groupe, venir à un événement), puis le partager : QR code, WhatsApp, SMS, e-mail,
 * copie. « Mes invitations » : tous mes liens, leur état, qui les a utilisés ; recopier, partager à nouveau, révoquer.
 * Les droits sont vérifiés par la base, jamais seulement ici.
 */
import { useEffect, useMemo, useState } from 'react';
import { Copy, Link2, Mail, MessageCircle, MessageSquare, Search, Share2, UserCog } from 'lucide-react';
import type { AccessScope, FriendInvite, InviteKind, InviteRedemption } from '../../domain/types';
import { useStore } from '../../data/store';
import { dateLong, endOfDay, localDay } from '../../domain/format';
import { fold, vintageLabel, wineTitle } from '../../domain/wine';
import { Button, Check, copyText, Field, Pill, Segmented, Sheet, useConfirm, useToast } from '../../ui/kit';
import { QrCode } from '../../ui/QrCode';
import { go } from '../../ui/router';
import { INVITE_KINDS, INVITE_STATUS, inviteLink, inviteStatus, inviteValidity, prettyCode, shareLinks, shareMessage } from './invite';

type Created = { code: string; kind: InviteKind; target: string | null; expires_at: string; max_uses: number; uses?: number };

export function InviteSheet({ onClose }: { onClose: () => void }) {
  const { snapshot, api, run, userId, wine } = useStore();
  const [created, setCreated] = useState<Created | null>(null);
  const groups = snapshot.groups.filter((g) => g.my_status === 'active' && (g.my_role === 'admin' || g.my_role === 'manager'));
  const events = snapshot.events.filter((e) => e.organizer_id === userId && e.status === 'planned' && new Date(e.starts_at) > new Date());
  const options = INVITE_KINDS.filter((k) => (k.value === 'group' ? groups.length > 0 : k.value === 'event' ? events.length > 0 : true));
  const [kind, setKind] = useState<InviteKind>('discovery');
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const [scope, setScope] = useState<AccessScope>('shared');
  const [lots, setLots] = useState<string[]>([]);
  const [restricted, setRestricted] = useState(false);
  const [until, setUntil] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const needsTarget = kind === 'group' || kind === 'event';
  const list = kind === 'group' ? groups.map((g) => ({ id: g.id, label: g.name })) : events.map((e) => ({ id: e.id, label: `${e.title} (${dateLong(e.starts_at)})` }));
  const targetId = needsTarget ? target || list[0]?.id || '' : null;
  const targetLabel = needsTarget ? (kind === 'group' ? groups.find((g) => g.id === targetId)?.name : events.find((e) => e.id === targetId)?.title) ?? null : null;
  const myLots = useMemo(
    () =>
      snapshot.lots
        .filter((l) => l.owner_id === userId && l.quantity > 0)
        .map((l) => ({ lot: l, wine: wine(l.wine_id) }))
        .filter((x) => x.wine && fold([x.wine.name, x.wine.producer, x.wine.domaine, x.wine.appellation, vintageLabel(x.wine)].join(' ')).includes(fold(q)))
        .slice(0, 60),
    [snapshot.lots, userId, wine, q],
  );
  const today = localDay();
  const invalid = (needsTarget && !targetId) || (kind === 'friend' && scope === 'selection' && lots.length === 0);

  async function create() {
    setBusy(true);
    const res = await run(() =>
      api.createInvite(kind, targetId, {
        note: note.trim() || null,
        ...(kind === 'friend'
          ? { scope, lots: scope === 'selection' ? lots : [], detail_level: restricted ? 'restricted' : 'standard', access_expires_at: until ? endOfDay(until) : null }
          : {}),
      }),
    );
    setBusy(false);
    if (res.ok) setCreated({ code: res.value.code, kind, target: targetLabel, expires_at: res.value.expires_at, max_uses: res.value.max_uses });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={created ? 'Votre invitation est prête' : 'Inviter quelqu’un'}
      footer={
        created ? undefined : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Annuler
            </Button>
            <Button icon={<Link2 />} loading={busy} disabled={invalid} onClick={() => void create()}>
              Créer le lien
            </Button>
          </>
        )
      }
    >
      {created ? (
        <SharePanel invite={created} />
      ) : (
        <div className="form">
          <p className="small muted">Pas besoin d’être déjà amis : la personne reçoit un lien, découvre l’application, crée son compte si besoin, puis accepte.</p>
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
          {kind === 'friend' && (
            <>
              <Field label="Ce que la personne verra">
                <Segmented<AccessScope>
                  label="Ce que la personne verra"
                  value={scope}
                  onChange={setScope}
                  options={[
                    { value: 'shared', label: 'Toute ma cave partagée' },
                    { value: 'selection', label: 'Une sélection' },
                  ]}
                />
              </Field>
              {scope === 'selection' && (
                <Field label={`Bouteilles choisies (${lots.length})`} hint="Seulement celles-ci, même si elles sont privées ; les autres restent invisibles.">
                  <div className="stack-sm">
                    <div className="search">
                      <Search aria-hidden />
                      <input className="input" type="search" aria-label="Chercher dans ma cave" placeholder="Chercher dans ma cave…" value={q} onChange={(e) => setQ(e.target.value)} />
                    </div>
                    <div className="stack-sm" style={{ maxHeight: 220, overflowY: 'auto' }}>
                      {myLots.length === 0 && <p className="small muted">Aucune bouteille en cave ne correspond.</p>}
                      {myLots.map(({ lot, wine: w }) => (
                        <Check
                          key={lot.id}
                          checked={lots.includes(lot.id)}
                          onChange={(v) => setLots((s) => (v ? [...s, lot.id] : s.filter((x) => x !== lot.id)))}
                          label={wineTitle(w!)}
                          hint={`${lot.quantity} bouteille${lot.quantity > 1 ? 's' : ''}`}
                        />
                      ))}
                    </div>
                  </div>
                </Field>
              )}
              <Check
                checked={restricted}
                onChange={setRestricted}
                label="Masquer toujours mes prix, quantités exactes et notes"
                hint="Niveau « Restreint » pour cette personne. L’accès est toujours en lecture seule."
              />
              <Field label="Accès jusqu’au (facultatif)" htmlFor="inv-until" hint="Sans date, l’accès dure jusqu’à ce que vous fermiez votre cave à cette personne.">
                <input id="inv-until" className="input" type="date" min={today} value={until} onChange={(e) => setUntil(e.target.value)} />
              </Field>
            </>
          )}
          <Field label="Pour qui ? (facultatif)" htmlFor="inv-note" hint="Pour vous y retrouver dans « Mes invitations ».">
            <input id="inv-note" className="input" maxLength={60} placeholder="Paul, la famille…" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      )}
    </Sheet>
  );
}

/** Le lien prêt à partager : QR code, WhatsApp, SMS, e-mail, copie, partage du téléphone. */
export function SharePanel({ invite }: { invite: Created }) {
  const toast = useToast();
  const link = inviteLink(invite.code);
  const message = shareMessage(invite.kind, invite.target, link);
  const links = shareLinks(message);
  const kindLabel = INVITE_KINDS.find((k) => k.value === invite.kind)?.label ?? 'Invitation';
  return (
    <div className="stack">
      <p className="muted">
        <strong>{kindLabel}</strong>
        {invite.target ? ` : « ${invite.target} »` : ''}. {inviteValidity(invite)}.
      </p>
      <QrCode text={link} label="QR code de l’invitation, à scanner avec l’appareil photo" />
      <p className="small faint center">À scanner avec l’appareil photo d’un téléphone.</p>
      <div className="inline" style={{ justifyContent: 'center' }}>
        <a className="btn btn-secondary btn-sm" href={links.whatsapp} target="_blank" rel="noopener noreferrer">
          <MessageCircle aria-hidden /> WhatsApp
        </a>
        <a className="btn btn-secondary btn-sm" href={links.sms}>
          <MessageSquare aria-hidden /> SMS
        </a>
        <a className="btn btn-secondary btn-sm" href={links.email}>
          <Mail aria-hidden /> E-mail
        </a>
      </div>
      {typeof navigator.share === 'function' && (
        <Button icon={<Share2 />} onClick={() => void navigator.share({ title: 'Cave & Amis', text: message }).catch(() => undefined)}>
          Partager…
        </Button>
      )}
      <Button
        variant="secondary"
        icon={<Copy />}
        onClick={async () => toast((await copyText(link)) ? 'Lien copié' : 'Copie impossible : sélectionnez le lien à la main', { tone: 'info' })}
      >
        Copier le lien
      </Button>
      <div className="kbd-code" aria-label="Code d’invitation">
        {prettyCode(invite.code)}
      </div>
      <p className="small faint center">Le code peut aussi être dicté : il se saisit dans Amis & Groupes › Invitations › « J’ai reçu un code ».</p>
    </div>
  );
}

/** Mes invitations : actives d'abord ; état, utilisations, personnes arrivées ; partager, révoquer, gérer l'accès donné. */
export function MyInvites() {
  const { snapshot, api, run, userId } = useStore();
  const confirm = useConfirm();
  const [view, setView] = useState<'active' | 'all'>('active');
  const [used, setUsed] = useState<InviteRedemption[]>([]);
  const [sharing, setSharing] = useState<Created | null>(null);
  const mine = snapshot.invites.filter((i) => i.inviter_id === userId);
  const key = mine.map((i) => `${i.id}:${i.uses}:${i.status}`).join(',');

  useEffect(() => {
    let alive = true;
    void api
      .myInviteRedemptions()
      .then((r) => alive && setUsed(r))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [api, key]);

  const targetName = (i: FriendInvite) =>
    i.kind === 'group' ? (snapshot.groups.find((g) => g.id === i.target_id)?.name ?? null) : i.kind === 'event' ? (snapshot.events.find((e) => e.id === i.target_id)?.title ?? null) : null;
  const shown = mine
    .map((i) => ({ i, status: inviteStatus(i) }))
    .filter((x) => view === 'all' || x.status === 'active')
    .slice(0, 40);
  const activeCount = mine.filter((i) => inviteStatus(i) === 'active').length;

  if (mine.length === 0) return null;
  return (
    <section aria-labelledby="h-my-invites" className="stack-sm">
      <div className="section-title">
        <h2 id="h-my-invites">Mes invitations</h2>
        <span className="small muted">{activeCount} active{activeCount > 1 ? 's' : ''}</span>
      </div>
      <Segmented<'active' | 'all'>
        label="Invitations montrées"
        value={view}
        onChange={setView}
        options={[
          { value: 'active', label: 'Actives' },
          { value: 'all', label: 'Toutes' },
        ]}
      />
      {shown.length === 0 ? (
        <p className="small muted">Aucune invitation active. Toutes vos invitations : « Toutes ».</p>
      ) : (
        <div className="list">
          {shown.map(({ i, status }) => {
            const kind = INVITE_KINDS.find((k) => k.value === i.kind)?.label ?? 'Invitation';
            const target = targetName(i);
            const people = used.filter((u) => u.invite_id === i.id);
            const options = i.options ?? {};
            return (
              <div key={i.id} className="row static" style={{ alignItems: 'flex-start' }}>
                <Link2 aria-hidden style={{ color: 'var(--primary)', flex: 'none', marginTop: 2 }} />
                <span className="row-main">
                  <span className="row-title" style={{ whiteSpace: 'normal' }}>
                    {kind}
                    {target ? ` : « ${target} »` : ''}
                    {i.note ? ` — ${i.note}` : ''}
                  </span>
                  <span className="row-sub" style={{ whiteSpace: 'normal' }}>
                    Créé le {dateLong(i.created_at)} · {status === 'expired' ? 'expiré le' : 'jusqu’au'} {dateLong(i.expires_at)} · {i.uses} utilisation{i.uses > 1 ? 's' : ''}{' '}
                    sur {i.max_uses}
                  </span>
                  {i.kind === 'friend' && (options.scope === 'selection' || options.detail_level === 'restricted' || options.access_expires_at) && (
                    <span className="row-sub" style={{ whiteSpace: 'normal' }}>
                      {[
                        options.scope === 'selection' ? `sélection de ${options.lots?.length ?? 0} bouteille${(options.lots?.length ?? 0) > 1 ? 's' : ''}` : null,
                        options.detail_level === 'restricted' ? 'niveau Restreint' : null,
                        options.access_expires_at ? `accès jusqu’au ${dateLong(options.access_expires_at)}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  )}
                  {people.length > 0 && (
                    <span className="row-sub" style={{ whiteSpace: 'normal' }}>
                      A rejoint : {people.map((p) => p.display_name ?? 'une personne bloquée').join(', ')}
                    </span>
                  )}
                  <span className="badges">
                    <Pill tone={status === 'active' ? 'success' : undefined}>{INVITE_STATUS[status]}</Pill>
                  </span>
                  <span className="inline" style={{ marginTop: 8 }}>
                    {status === 'active' && i.code && (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<Share2 />}
                        aria-label={`Partager le lien ${kind}${i.note ? ` (${i.note})` : ''}`}
                        onClick={() => setSharing({ code: i.code!, kind: i.kind, target, expires_at: i.expires_at, max_uses: i.max_uses, uses: i.uses })}
                      >
                        Partager
                      </Button>
                    )}
                    {status === 'active' && !i.code && <span className="small faint">Lien créé avant cette version : il ne peut plus être affiché.</span>}
                    {i.kind === 'friend' &&
                      people
                        .filter((p) => p.display_name)
                        .map((p) => (
                          <Button key={p.user_id} size="sm" variant="ghost" icon={<UserCog />} onClick={() => go(`/amis/${p.user_id}?onglet=moi`)}>
                            Gérer l’accès de {p.display_name}
                          </Button>
                        ))}
                    {status === 'active' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Révoquer le lien ${kind}${target ? ` « ${target} »` : ''}${i.note ? ` (${i.note})` : ''}`}
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
                    )}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
      <Sheet open={sharing !== null} onClose={() => setSharing(null)} title="Partager l’invitation">
        {sharing && <SharePanel invite={sharing} />}
      </Sheet>
    </section>
  );
}

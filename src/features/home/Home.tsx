import { useMemo, useState } from 'react';
import { Bell, BookOpen, BottleWine, Camera, CalendarHeart, ChartColumn, Heart, PenLine, ScanSearch, Sparkles, UserPlus, Users, Wine } from 'lucide-react';
import { m } from 'motion/react';
import { useStore } from '../../data/store';
import { bottlesByEntryMonth, buildRows, colorBreakdown, dayPick, pastWindow, readyToDrink, type WineRow } from '../../domain/cellar';
import { tasteSummary } from '../../domain/tasteProfile';
import { currentYear, dateShort, eventDate, money, moneyRange } from '../../domain/format';
import { valuation, coverageText } from '../../domain/valuation';
import { useActions } from '../../ui/Shell';
import { Avatar, Button, EmptyState, Notice, StarsView } from '../../ui/kit';
import { usePhotoUrl } from '../../data/photos';
import { TAP } from '../../ui/motion';
import { PairingSheet } from '../cellar/PairingSheet';
import { go } from '../../ui/router';

/** Bouteille générique selon la couleur du vin (images générées, sans étiquette ni marque). */
const GENERIC_BOTTLE: Partial<Record<string, string>> = { blanc: 'bouteille-blanc', rose: 'bouteille-rose', effervescent: 'bouteille-effervescent' };

/** Photo de la bouteille (bouteille ou étiquette de la fiche), sinon une bouteille générique de sa couleur, sur fond de bois. */
function BottlePhoto({ row, large }: { row: WineRow; large?: boolean }) {
  const { api } = useStore();
  const url = usePhotoUrl(api, row.wine.bottle_photo ?? row.wine.label_photo);
  return (
    <span className={`dash-photo${large ? ' large' : ''}${url ? ' own' : ''}`} aria-hidden>
      <img src={url ?? `/img/${(row.wine.color && GENERIC_BOTTLE[row.wine.color]) || 'bouteille-generique'}.webp`} alt="" loading="lazy" decoding="async" />
    </span>
  );
}

export function Home() {
  const { snapshot, me, userId, profileName } = useStore();
  const actions = useActions();
  const [pairing, setPairing] = useState(false);
  const year = currentYear();
  const rows = useMemo(() => buildRows(snapshot.wines, snapshot.lots, snapshot.cellars, year), [snapshot, year]);
  const inStock = rows.filter((r) => r.stock > 0);
  const bottles = inStock.reduce((s, r) => s + r.stock, 0);
  const reserved = inStock.reduce((s, r) => s + r.reserved, 0);
  // Dont mises à disposition de mes groupes (le reste est réservé pour des événements).
  const forGroups = snapshot.groupShares.reduce((s, g) => s + g.allocated, 0);
  const blocked = [
    reserved - forGroups > 0 ? `${reserved - forGroups} réservée${reserved - forGroups > 1 ? 's' : ''}` : null,
    forGroups > 0 ? `${forGroups} pour mes groupes` : null,
  ].filter(Boolean);
  const ready = readyToDrink(rows, 5);
  const toTaste = readyToDrink(rows, 1000).length;
  // Recommandation du jour : une bouteille prête et libre, choisie sur l'appareil (la même toute la journée), sans IA.
  const pick = dayPick(readyToDrink(rows.filter((r) => r.wine.owner_id === userId), 1000));
  // Mes bouteilles seulement (une cave gérée à plusieurs montre aussi celles de son propriétaire).
  const mine = rows.filter((r) => r.wine.owner_id === userId);
  const urgent = pastWindow(mine);
  const byColor = colorBreakdown(mine);
  // Calculés sur l'appareil, sans requête ni IA : dernières dégustations et ce que le carnet dit des goûts.
  const recent = useMemo(() => [...snapshot.tastings].filter((t) => t.user_id === userId).sort((a, b) => b.tasted_on.localeCompare(a.tasted_on) || b.created_at.localeCompare(a.created_at)).slice(0, 3), [snapshot.tastings, userId]);
  const taste = useMemo(() => tasteSummary(snapshot.tastings, userId), [snapshot.tastings, userId]);
  const value = useMemo(() => valuation(snapshot.lots, snapshot.prices), [snapshot.lots, snapshot.prices]);

  const myEvents = snapshot.participants.filter((p) => p.user_id === userId);
  const upcoming = snapshot.events
    .filter((e) => e.status === 'planned' && myEvents.some((p) => p.event_id === e.id) && new Date(e.starts_at).getTime() > Date.now() - 6 * 3600_000)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const myRsvp = (id: string) => myEvents.find((p) => p.event_id === id)?.rsvp;
  const toConfirm = snapshot.myEventWines.filter((w) => w.status === 'proposed' && w.proposed_by !== userId);
  const firstName = me.display_name.split(' ')[0];
  const stats = useMemo(() => bottlesByEntryMonth(snapshot.lots, userId), [snapshot.lots, userId]);
  const maxStat = Math.max(1, ...stats.series.map((m) => m.bottles));
  const friendsCount = snapshot.friendships.length;

  const purchase = Object.entries(value.purchase.totals);
  const market = Object.entries(value.market.totals);

  return (
    <>
      <section className="dash-hello" data-tour="accueil">
        <Avatar name={me.display_name} seed={me.id} />
        <div className="dash-hello-text">
          <h2>Bonjour {firstName} !</h2>
          <p>Voici votre aperçu du jour</p>
        </div>
        <div className="dash-hello-actions">
          <a className="dash-round" href="#/assistant" aria-label="Demander à Lia">
            <Sparkles aria-hidden />
          </a>
          <a className="dash-round" href="#/notifications" aria-label="Notifications">
            <Bell aria-hidden />
            {snapshot.notifications.some((n) => !n.read_at) && <span className="dash-dot" />}
          </a>
        </div>
      </section>

      <section className="dash-tiles" aria-label="En bref">
        <m.a className="dash-tile" href="#/cave" whileTap={TAP}>
          <BottleWine aria-hidden className="ink" />
          <span>
            <b>{bottles}</b>
            {bottles > 1 ? 'Bouteilles' : 'Bouteille'}
          </span>
        </m.a>
        <m.a className="dash-tile" href="#/cave?tri=maturite" whileTap={TAP}>
          <Wine aria-hidden className="gold" />
          <span>
            <b>{toTaste}</b>À déguster
          </span>
        </m.a>
        <m.a className="dash-tile" href="#/evenements" whileTap={TAP}>
          <CalendarHeart aria-hidden className="accent" />
          <span>
            <b>{upcoming.length}</b>
            {upcoming.length > 1 ? 'Événements' : 'Événement'}
          </span>
        </m.a>
        <m.a className="dash-tile" href="#/amis" whileTap={TAP}>
          <Users aria-hidden className="blue" />
          <span>
            <b>{friendsCount}</b>
            {friendsCount > 1 ? 'Amis' : 'Ami'}
          </span>
        </m.a>
      </section>

      {rows.length === 0 && (
        <EmptyState icon="🍷" title="Commencez votre cave" action={<Button icon={<Camera />} onClick={actions.scanLabel}>Photographier une étiquette</Button>}>
          Ajoutez une première bouteille en photographiant son étiquette, ou saisissez-la à la main. Tout reste privé tant que vous ne choisissez pas de
          partager.
        </EmptyState>
      )}

      {toConfirm.length > 0 && (
        <Notice tone="gold">
          {toConfirm.length === 1 ? 'Une de vos bouteilles est suggérée' : `${toConfirm.length} de vos bouteilles sont suggérées`} pour un événement :{' '}
          <a href={`#/evenements/${toConfirm[0].event_id}`}>confirmez ou refusez</a>.
        </Notice>
      )}

      {urgent.length > 0 && (
        <Notice tone="warn">
          {urgent.length === 1 ? 'Un vin a passé' : `${urgent.length} vins ont passé`} sa période indiquée (fiche ou repère général) :{' '}
          <a href="#/cave?tri=maturite">à ouvrir sans tarder</a>.
        </Notice>
      )}

      <div className="dash-grid">
        <section className="card" aria-labelledby="h-ready">
          <div className="section-title">
            <h2 id="h-ready">À ouvrir bientôt</h2>
            <a href="#/cave?tri=maturite">Tout voir</a>
          </div>
          {ready.length === 0 ? (
            <p className="muted small">Aucune bouteille prête pour l’instant : les périodes de vos fiches s’afficheront ici.</p>
          ) : (
            ready.slice(0, 2).map((r) => (
              <div key={r.wine.id} className="dash-wine">
                <BottlePhoto row={r} />
                <div>
                  <strong>
                    {r.wine.name}
                    {r.wine.vintage ? ` ${r.wine.vintage}` : ''}
                  </strong>
                  <span className="small muted">
                    {r.wine.region || r.wine.appellation || 'Votre cave'}
                    {r.maturity === 'past' ? ' · À ouvrir sans tarder' : r.maturity === 'soon' ? ' · Bientôt à son apogée' : ' · Prêt à boire'}
                    {r.window?.approximate ? ' (≈)' : ''}
                  </span>
                  <a className="dash-pill" href={`#/cave/vin/${r.wine.id}`}>
                    Voir
                  </a>
                </div>
              </div>
            ))
          )}
        </section>

        <section className="card" aria-labelledby="h-reco">
          <div className="section-title">
            <h2 id="h-reco">
              <img className="dash-lia" src="/img/lia-avatar.webp" alt="" />
              Recommandation du jour
              <small>par Lia, parmi vos bouteilles prêtes</small>
            </h2>
          </div>
          {pick ? (
            <div className="dash-reco">
              <BottlePhoto row={pick} large />
              <div>
                <strong>Parfait pour ce soir !</strong>
                <p className="small muted">
                  {pick.wine.name}
                  {pick.wine.vintage ? ` ${pick.wine.vintage}` : ''} est prêt à boire{pick.wine.pairings ? ` : ${pick.wine.pairings}` : '.'}
                </p>
                <Button onClick={() => setPairing(true)}>Voir les accords</Button>
              </div>
            </div>
          ) : (
            <p className="muted small">Ajoutez des bouteilles avec une période de dégustation : Lia vous en proposera une chaque jour.</p>
          )}
        </section>

        <section className="card" aria-labelledby="h-next">
          <div className="section-title">
            <h2 id="h-next">Vos prochains événements</h2>
            <a href="#/evenements">Événements</a>
          </div>
          {upcoming.length === 0 ? (
            <EmptyState icon="🥂" title="Aucun événement prévu" action={<Button variant="secondary" icon={<CalendarHeart />} onClick={() => go('/evenements?nouveau=1')}>Organiser un dîner</Button>}>
              Invitez vos amis et choisissez ensemble les bouteilles.
            </EmptyState>
          ) : (
            upcoming.slice(0, 3).map((e) => (
              <m.a key={e.id} className="dash-event" href={`#/evenements/${e.id}`} whileTap={TAP}>
                <Avatar name={e.organizer_id === userId ? me.display_name : profileName(e.organizer_id)} seed={e.organizer_id} size="sm" />
                <span>
                  <strong>{e.title}</strong>
                  <span className="small muted">
                    {eventDate(e.starts_at)} · {snapshot.participants.filter((p) => p.event_id === e.id).length} participant(s)
                    {myRsvp(e.id) === 'pending' ? ' · Répondez à l’invitation' : ''}
                  </span>
                </span>
              </m.a>
            ))
          )}
        </section>

        <section className="card" aria-labelledby="h-stats">
          <div className="section-title">
            <h2 id="h-stats">
              Vos statistiques
              <small>Bouteilles en cave, par mois d’entrée</small>
            </h2>
          </div>
          <div className="dash-bars" role="img" aria-label={`Bouteilles par mois d’entrée : ${stats.series.map((m) => `${m.month} : ${m.bottles}`).join(', ')}`}>
            {stats.series.map((m, i) => (
              <i key={m.month} data-v={m.bottles} className={i >= stats.series.length - 2 ? 'recent' : ''} style={{ height: `${Math.max(6, (m.bottles / maxStat) * 100)}%` }} />
            ))}
          </div>
          <p className="small muted">
            <strong className="dash-up">
              +{stats.lastQuarter} bouteille{stats.lastQuarter > 1 ? 's' : ''}
            </strong>{' '}
            ce trimestre
          </p>
        </section>
      </div>

      <section aria-labelledby="h-shortcuts">
        <h2 id="h-shortcuts" className="sr-only">
          Raccourcis
        </h2>
        <button type="button" className="shortcut shortcut-wide" onClick={() => go('/scanner')}>
          <ScanSearch aria-hidden />
          Scanner avant d’acheter
          <span className="hint">En magasin : Lia identifie la bouteille et relève le prix</span>
        </button>
        <div className="shortcuts">
          <button type="button" className="shortcut" onClick={actions.scanLabel}>
            <Camera aria-hidden />
            Photographier une étiquette
            <span className="hint">L’assistant pré-remplit la fiche</span>
          </button>
          <button type="button" className="shortcut" onClick={() => actions.newWine()}>
            <PenLine aria-hidden />
            Saisir un vin
            <span className="hint">En quelques champs</span>
          </button>
          <button type="button" className="shortcut" onClick={() => actions.newTasting()}>
            <BookOpen aria-hidden />
            Noter une dégustation
            <span className="hint">Au restaurant, chez des amis…</span>
          </button>
          <button type="button" className="shortcut" onClick={() => go('/assistant?q=' + encodeURIComponent('Quel vin de ma cave ouvrir ce soir ?'))}>
            <Sparkles aria-hidden />
            Que boire ce soir ?
            <span className="hint">Demandez à l’assistant</span>
          </button>
          <button type="button" className="shortcut" onClick={() => go('/statistiques')}>
            <ChartColumn aria-hidden />
            Statistiques et carnet
            <span className="hint">Ma cave en chiffres, mes dégustations</span>
          </button>
          <button type="button" className="shortcut" onClick={() => go('/amis?inviter=1')}>
            <UserPlus aria-hidden />
            Inviter quelqu’un
            <span className="hint">Un lien ou un QR code, sans ouvrir votre cave</span>
          </button>
        </div>
      </section>

      {bottles > 0 && (
        <section aria-labelledby="h-summary">
          <div className="section-title">
            <h2 id="h-summary">Ma cave en bref</h2>
            <a href="#/cave">Inventaire</a>
          </div>
          <div className="tiles">
            <m.a className="tile" href="#/cave" whileTap={TAP}>
              <span className="value">{bottles}</span>
              <span className="label">bouteilles en stock</span>
            </m.a>
            <m.a className="tile" href="#/cave" whileTap={TAP}>
              <span className="value">{bottles - reserved}</span>
              <span className="label">disponibles{blocked.length ? ` (${blocked.join(', ')})` : ''}</span>
            </m.a>
            <div className="tile">
              <span className="value">{purchase.length ? purchase.map(([c, v]) => money(v, c)).join(' + ') : '—'}</span>
              <span className="label">
                valeur d’achat{value.purchase.covered < value.bottles ? ` (${coverageText(value.purchase.covered, value.bottles)})` : ''}
              </span>
            </div>
            <div className="tile">
              <span className="value" style={{ fontSize: market.length ? '1.15rem' : undefined }}>
                {market.length ? market.map(([c, v]) => moneyRange(v.low, v.high, c)).join(' + ') : '—'}
              </span>
              <span className="label">
                {market.length ? `valeur de marché estimée (${coverageText(value.market.covered, value.bottles)})` : 'valeur de marché : aucun prix relevé'}
              </span>
            </div>
          </div>
          {byColor.length > 1 && (
            <div className="color-mix" style={{ marginTop: 10 }}>
              <div className="color-bar" role="img" aria-label={`Répartition : ${byColor.map((c) => `${c.bottles} ${c.label.toLowerCase()}`).join(', ')}`}>
                {byColor.map((c) => (
                  <span key={c.color} style={{ flex: c.bottles, background: `var(--wine-${c.color})` }} />
                ))}
              </div>
              <ul className="color-legend" aria-hidden>
                {byColor.map((c) => (
                  <li key={c.color}>
                    <i style={{ background: `var(--wine-${c.color})` }} />
                    {c.label} <span className="faint">{c.bottles}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {recent.length > 0 && (
        <section aria-labelledby="h-recent">
          <div className="section-title">
            <h2 id="h-recent">Dernières dégustations</h2>
            <a href="#/carnet">Mon carnet</a>
          </div>
          <div className="list">
            {recent.map((t) => (
              <m.a key={t.id} className="card between" href={`#/carnet/degustation/${t.id}`} style={{ textDecoration: 'none', color: 'inherit' }} whileTap={TAP}>
                <span>
                  <strong>{t.wine_name}</strong>
                  {t.vintage ? ` ${t.vintage}` : ''}
                  <span className="small muted" style={{ display: 'block' }}>
                    {dateShort(t.tasted_on)}
                    {t.place ? ` · ${t.place}` : ''}
                  </span>
                </span>
                <StarsView value={t.rating} />
              </m.a>
            ))}
          </div>
        </section>
      )}

      {taste.liked.length > 0 && (
        <m.a className="card soft stack-sm" href="#/carnet/gouts" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }} whileTap={TAP}>
          <div className="between">
            <strong>Vos goûts, d’après votre carnet</strong>
            <span className="small muted">Mes goûts</span>
          </div>
          <div className="inline" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {taste.liked.slice(0, 4).map((t) => (
              <span key={t.key} className="pill">
                {t.label}
              </span>
            ))}
          </div>
        </m.a>
      )}

      {snapshot.friendships.length === 0 && rows.length > 0 && (
        <section className="card soft stack">
          <div className="inline">
            <UserPlus aria-hidden style={{ color: 'var(--primary)' }} />
            <strong>Partagez avec vos amis</strong>
          </div>
          <p className="muted small">Invitez un ami par lien : vous choisirez ensuite, bouteille par bouteille, ce qu’il peut voir.</p>
          <Button variant="secondary" onClick={() => go('/amis?inviter=1')}>
            Inviter un ami
          </Button>
        </section>
      )}

      {snapshot.wishlist.filter((w) => !w.done).length > 0 && (
        <m.a className="card soft between" href="#/carnet?onglet=envies" style={{ textDecoration: 'none', color: 'inherit' }} whileTap={TAP}>
          <span className="inline">
            <Heart aria-hidden style={{ color: 'var(--primary)' }} />
            {snapshot.wishlist.filter((w) => !w.done).length} vin(s) sur votre liste d’envies
          </span>
          <span className="small muted">Voir</span>
        </m.a>
      )}
      <PairingSheet open={pairing} onClose={() => setPairing(false)} />
    </>
  );
}

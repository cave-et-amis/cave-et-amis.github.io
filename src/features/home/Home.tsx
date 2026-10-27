import { useMemo, useState } from 'react';
import { BookOpen, Camera, CalendarHeart, Heart, PenLine, ScanSearch, Sparkles, UserPlus, UtensilsCrossed } from 'lucide-react';
import { m } from 'motion/react';
import { useStore } from '../../data/store';
import { buildRows, colorBreakdown, pastWindow, readyToDrink } from '../../domain/cellar';
import { tasteSummary } from '../../domain/tasteProfile';
import { currentYear, dateShort, eventDate, money, moneyRange, relativeDays } from '../../domain/format';
import { valuation, coverageText } from '../../domain/valuation';
import { EVENT_KINDS, label } from '../../domain/wine';
import { useActions } from '../../ui/Shell';
import { Button, EmptyState, Notice, StarsView } from '../../ui/kit';
import { TAP } from '../../ui/motion';
import { WineItem } from '../../ui/WineItem';
import { PairingSheet } from '../cellar/PairingSheet';
import { go } from '../../ui/router';

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
  const urgent = pastWindow(rows);
  const byColor = colorBreakdown(rows);
  // Calculés sur l'appareil, sans requête ni IA : dernières dégustations et ce que le carnet dit des goûts.
  const recent = useMemo(() => [...snapshot.tastings].filter((t) => t.user_id === userId).sort((a, b) => b.tasted_on.localeCompare(a.tasted_on) || b.created_at.localeCompare(a.created_at)).slice(0, 3), [snapshot.tastings, userId]);
  const taste = useMemo(() => tasteSummary(snapshot.tastings, userId), [snapshot.tastings, userId]);
  const value = useMemo(() => valuation(snapshot.lots, snapshot.prices), [snapshot.lots, snapshot.prices]);

  const myEvents = snapshot.participants.filter((p) => p.user_id === userId);
  const upcoming = snapshot.events
    .filter((e) => e.status === 'planned' && myEvents.some((p) => p.event_id === e.id) && new Date(e.starts_at).getTime() > Date.now() - 6 * 3600_000)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const next = upcoming[0];
  const myRsvp = (id: string) => myEvents.find((p) => p.event_id === id)?.rsvp;
  const toConfirm = snapshot.myEventWines.filter((w) => w.status === 'proposed' && w.proposed_by !== userId);
  const firstName = me.display_name.split(' ')[0];

  const purchase = Object.entries(value.purchase.totals);
  const market = Object.entries(value.market.totals);

  return (
    <>
      <section className="hero" data-tour="accueil">
        <h2>Bonjour {firstName}</h2>
        <p>
          {bottles > 0
            ? `${bottles} bouteille${bottles > 1 ? 's' : ''} en cave, ${inStock.length} vin${inStock.length > 1 ? 's' : ''} différent${inStock.length > 1 ? 's' : ''}.`
            : 'Votre cave, vos amis, la bonne bouteille au bon moment.'}
        </p>
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
          <button type="button" className="shortcut" onClick={() => setPairing(true)}>
            <UtensilsCrossed aria-hidden />
            Que boire avec…
            <span className="hint">Votre plat, vos bouteilles libres</span>
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

      {ready.length > 0 && (
        <section aria-labelledby="h-ready">
          <div className="section-title">
            <h2 id="h-ready">À ouvrir prochainement</h2>
            <a href="#/cave?tri=maturite">Tout voir</a>
          </div>
          <div className="list">
            {ready.map((r, i) => (
              <WineItem key={r.wine.id} row={r} index={i} />
            ))}
          </div>
          <p className="small faint" style={{ marginTop: 6 }}>
            Périodes indicatives : celles de vos fiches, sinon un repère général très approximatif (marqué « ≈ »).
          </p>
        </section>
      )}

      <section aria-labelledby="h-next">
        <div className="section-title">
          <h2 id="h-next">Prochain événement</h2>
          <a href="#/evenements">Événements</a>
        </div>
        {next ? (
          <m.a className="card" href={`#/evenements/${next.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }} whileTap={TAP}>
            <div className="between">
              <span className="pill gold">
                {EVENT_KINDS.find((k) => k.value === next.kind)?.icon} {label(EVENT_KINDS, next.kind)}
              </span>
              <span className="small muted">{relativeDays(next.starts_at)}</span>
            </div>
            <h3 className="title-font" style={{ fontSize: '1.25rem', marginTop: 8 }}>
              {next.title}
            </h3>
            <p className="muted">
              {eventDate(next.starts_at)}
              {next.place ? ` · ${next.place}` : ''}
            </p>
            <p className="small" style={{ marginTop: 6 }}>
              {next.organizer_id === userId ? 'Vous organisez' : `Organisé par ${profileName(next.organizer_id)}`}
              {myRsvp(next.id) === 'pending' && <strong style={{ color: 'var(--primary)' }}> · Répondez à l’invitation</strong>}
            </p>
          </m.a>
        ) : (
          <EmptyState icon="🥂" title="Aucun événement prévu" action={<Button variant="secondary" icon={<CalendarHeart />} onClick={() => go('/evenements?nouveau=1')}>Organiser un dîner</Button>}>
            Invitez vos amis, choisissez ensemble les bouteilles, et gardez le souvenir des vins dégustés.
          </EmptyState>
        )}
      </section>

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

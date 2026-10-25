import { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, BookOpen, CalendarHeart, HandHeart, Heart, Minus, Pencil, Plus, Sparkles, Undo2, Wine as WineIcon } from 'lucide-react';
import { newId } from '../../data/api';
import { useStore } from '../../data/store';
import { usePhotoUrl } from '../../data/photos';
import { PhotoCredit } from './OfficialPhoto';
import { generalAeration, generalServingTemperature } from '../../domain/advice';
import { buildRows, lotSplit, splitText } from '../../domain/cellar';
import { currentYear, dateShort, money } from '../../domain/format';
import { MATURITY_HINTS, MATURITY_LABELS, windowText } from '../../domain/maturity';
import type { Lot, Movement } from '../../domain/types';
import { colorLabel, label, MOVEMENT_LABELS, VISIBILITIES, volumeLabel, WINE_TYPES, vintageLabel, wineSubtitle } from '../../domain/wine';
import { useActions } from '../../ui/Shell';
import { Button, EmptyState, InlineLoading, Origin, StarsView, useConfirm } from '../../ui/kit';
import { go } from '../../ui/router';
import { AllocateSheet } from '../groups/AllocateSheet';
import { LotSheet } from './LotSheet';
import { MovementSheet } from './MovementSheet';
import { PriceSection } from './PriceSection';
import { WineFormSheet } from './WineForm';

export function WinePage({ id }: { id: string }) {
  const store = useStore();
  const { snapshot, api, run, wine: getWine, lotsOf, location, cellar } = store;
  const actions = useActions();
  const confirm = useConfirm();
  const wine = getWine(id);
  const lots = useMemo(() => lotsOf(id), [lotsOf, id]);
  const year = currentYear();
  const row = useMemo(
    () => (wine ? buildRows([wine], lots, snapshot.cellars, year, snapshot.groupShares)[0] : null),
    [wine, lots, snapshot.cellars, snapshot.groupShares, year],
  );
  const photo = usePhotoUrl(api, wine?.label_photo ?? wine?.bottle_photo);
  const bottlePhoto = usePhotoUrl(api, wine?.label_photo && wine?.bottle_photo ? wine.bottle_photo : null);
  const [sheet, setSheet] = useState<
    { kind: 'edit' } | { kind: 'lot'; lot?: Lot } | { kind: 'move'; lot?: Lot; mode: 'out' | 'in' | 'fix' } | { kind: 'allocate'; lot?: Lot } | null
  >(null);
  // Groupes dont je suis membre, et mes lots qui y sont visibles (dont des bouteilles mises à disposition).
  const myGroups = snapshot.groups.filter((g) => g.my_status === 'active');
  const shareOf = (lot: string, group: string) => snapshot.groupShares.find((s) => s.lot_id === lot && s.group_id === group);
  const [movements, setMovements] = useState<Movement[] | null>(null);
  const lotKey = lots.map((l) => `${l.id}:${l.quantity}:${l.reserved}`).join(',');

  useEffect(() => {
    let alive = true;
    void api
      .movements(lots.map((l) => l.id))
      .then((m) => alive && setMovements(m))
      .catch(() => alive && setMovements([]));
    return () => {
      alive = false;
    };
  }, [api, lotKey]);

  if (!wine || !row) {
    return (
      <EmptyState icon="🍷" title="Ce vin n’est pas (ou plus) dans votre cave" action={<Button onClick={() => go('/cave')}>Revenir à ma cave</Button>}>
        Il a peut-être été supprimé.
      </EmptyState>
    );
  }

  const tastings = snapshot.tastings.filter((t) => t.wine_id === wine.id);
  const reservations = snapshot.myEventWines.filter((ew) => ew.status === 'confirmed' && lots.some((l) => l.id === ew.lot_id));
  const generalTemp = generalServingTemperature(wine);
  const generalAer = generalAeration(wine, year);
  const reversed = new Set((movements ?? []).map((m) => m.reverses_id).filter(Boolean));
  const storageCaution = row.storage === 'piece';
  const forEvents = row.reserved - row.forGroups;
  const inStockLots = lots.filter((l) => l.quantity > 0);
  const wineShares = snapshot.groupShares.filter((s) => inStockLots.some((l) => l.id === s.lot_id));
  const groupName = (id: string) => snapshot.groups.find((g) => g.id === id)?.name ?? 'un groupe';
  const sharedIn = snapshot.groups.filter((g) => wineShares.some((s) => s.group_id === g.id));

  return (
    <>
      <section className="wine-head">
        <div className="wine-photo">{photo ? <img src={photo} alt={`Étiquette de ${wine.name}`} /> : <WineIcon aria-hidden style={{ color: `var(--wine-${wine.color ?? 'autre'})` }} />}</div>
        <div className="stack-sm" style={{ minWidth: 0, flex: 1 }}>
          <h2>{wine.name}</h2>
          <p className="muted">{[vintageLabel(wine), wineSubtitle(wine)].filter(Boolean).join(' · ') || 'Détails à compléter'}</p>
          <div className="inline">
            {wine.color && (
              <span className="pill">
                <span className="dot" style={{ background: `var(--wine-${wine.color})`, width: 10, height: 10 }} aria-hidden /> {colorLabel(wine.color)}
              </span>
            )}
            {wine.wine_type && <span className="pill">{label(WINE_TYPES, wine.wine_type)}</span>}
            {wine.grapes.length > 0 && <span className="pill">{wine.grapes.join(', ')}</span>}
          </div>
          <div className="inline">
            <Button
              variant={wine.favorite ? 'soft' : 'secondary'}
              size="sm"
              icon={<Heart fill={wine.favorite ? 'currentColor' : 'none'} />}
              aria-pressed={wine.favorite}
              onClick={() => void run(() => api.updateWine(wine.id, { favorite: !wine.favorite }), { success: wine.favorite ? 'Retiré des favoris' : 'Ajouté aux favoris' })}
            >
              Favori
            </Button>
            <Button variant="secondary" size="sm" icon={<Pencil />} onClick={() => setSheet({ kind: 'edit' })}>
              Modifier
            </Button>
          </div>
        </div>
      </section>
      {bottlePhoto && <img className="photo-preview" src={bottlePhoto} alt={`Bouteille de ${wine.name}`} />}
      {wine.bottle_photo && <PhotoCredit credit={wine.bottle_photo_credit} />}

      <section className="tiles" aria-label="Stock">
        <div className="tile">
          <span className="value">{row.stock}</span>
          <span className="label">en stock</span>
        </div>
        <div className="tile">
          <span className="value">{row.available}</span>
          <span className="label">disponible{row.available > 1 ? 's' : ''}</span>
        </div>
        <div className="tile">
          <span className="value">{forEvents}</span>
          <span className="label">réservée{forEvents > 1 ? 's' : ''} (événements)</span>
        </div>
        {myGroups.length > 0 || row.forGroups > 0 ? (
          <div className="tile">
            <span className="value">{row.forGroups}</span>
            <span className="label">pour mes groupes</span>
          </div>
        ) : (
          <div className="tile">
            <span className="value">{lots.length}</span>
            <span className="label">lot{lots.length > 1 ? 's' : ''}</span>
          </div>
        )}
      </section>

      <div className="grid-2-always">
        <Button icon={<Minus />} disabled={row.available < 1 && row.forGroups < 1} onClick={() => setSheet({ kind: 'move', mode: 'out' })}>
          J’en ai bu une
        </Button>
        <Button variant="secondary" icon={<Plus />} onClick={() => setSheet({ kind: 'lot' })}>
          Ajouter des bouteilles
        </Button>
        <Button
          variant="secondary"
          icon={<BookOpen />}
          onClick={() =>
            actions.newTasting({
              wine_id: wine.id,
              wine_name: wine.name,
              producer: wine.domaine || wine.producer,
              vintage: wine.vintage,
              non_vintage: wine.non_vintage,
              color: wine.color,
              region: wine.region,
              appellation: wine.appellation,
              grapes: wine.grapes,
              lots: lots.filter((l) => l.quantity - l.reserved > 0),
            })
          }
        >
          Noter une dégustation
        </Button>
        <Button variant="gold" icon={<Sparkles />} onClick={() => go(`/assistant?vin=${wine.id}`)}>
          Demander conseil
        </Button>
      </div>

      {reservations.length > 0 && (
        <div className="notice gold">
          <CalendarHeart aria-hidden />
          <div>
            Réservé pour :{' '}
            {reservations.map((r, i) => (
              <span key={r.id}>
                {i > 0 && ', '}
                <a href={`#/evenements/${r.event_id}`}>{snapshot.events.find((e) => e.id === r.event_id)?.title ?? 'un événement'}</a> ({r.reserved_qty})
              </span>
            ))}
          </div>
        </div>
      )}

      {(myGroups.length > 0 || sharedIn.length > 0) && (
        <section aria-labelledby="h-share" className="card stack-sm">
          <h2 id="h-share" className="section">
            Partage avec mes groupes
          </h2>
          <p className="strong">{splitText(row.stock, row.forGroups, forEvents)}</p>
          <span className="small muted">Visible : {sharedIn.length ? sharedIn.map((g) => `${g.emoji} ${g.name}`).join(', ') : 'dans aucun groupe'}</span>
          {sharedIn
            .map((g) => ({ g, n: wineShares.filter((s) => s.group_id === g.id).reduce((a, s) => a + s.allocated, 0) }))
            .filter((x) => x.n > 0)
            .map(({ g, n }) => (
              <span key={g.id} className="small">
                Disponible : {n} pour <a href={`#/groupes/${g.id}`}>{g.name}</a>
              </span>
            ))}
          {myGroups.length > 0 && row.stock > 0 && (
            <Button variant="secondary" icon={<HandHeart />} onClick={() => setSheet({ kind: 'allocate' })}>
              Mettre à disposition d’un groupe
            </Button>
          )}
        </section>
      )}

      <section aria-labelledby="h-advice" className="card">
        <h2 id="h-advice" className="section">
          Conseils
        </h2>
        <div className="advice-item">
          <div className="between">
            <strong>Quand l’ouvrir</strong>
            <Origin kind={row.window?.origin} />
          </div>
          {row.window ? (
            <>
              <span>
                {MATURITY_LABELS[row.maturity]} — à boire {windowText(row.window)}
                {row.window.origin === 'general' ? ' (repère très approximatif, d’après la couleur et le millésime)' : ''}.
              </span>
              <span className="small muted">{MATURITY_HINTS[row.maturity]}</span>
              {wine.window_note && <span className="small muted">Origine : {wine.window_note}</span>}
            </>
          ) : (
            <span className="muted">{MATURITY_HINTS.unknown}</span>
          )}
          {storageCaution && <span className="small" style={{ color: 'var(--warn)', fontWeight: 650 }}>Conservé dans une pièce à température ambiante : la garde peut être plus courte.</span>}
          <span className="small faint">Période indicative : chaque bouteille évolue selon sa conservation.</span>
        </div>
        <div className="advice-item">
          <div className="between">
            <strong>Température de service</strong>
            <Origin kind={wine.serve_temp_min !== null || wine.serve_temp_max !== null ? (wine.temp_source ?? 'personal') : generalTemp ? 'general' : null} />
          </div>
          {wine.serve_temp_min !== null || wine.serve_temp_max !== null ? (
            <span>
              {wine.serve_temp_min ?? wine.serve_temp_max} à {wine.serve_temp_max ?? wine.serve_temp_min} °C
            </span>
          ) : generalTemp ? (
            <span>{generalTemp.text}</span>
          ) : (
            <span className="muted">Indiquez la couleur du vin pour obtenir un repère.</span>
          )}
        </div>
        <div className="advice-item">
          <div className="between">
            <strong>Aération, carafage</strong>
            <Origin kind={wine.aeration ? (wine.aeration_source ?? 'personal') : generalAer ? 'general' : null} />
          </div>
          <span className={wine.aeration || generalAer ? '' : 'muted'}>{wine.aeration ?? generalAer ?? 'Pas de repère sans la couleur du vin.'}</span>
        </div>
        <div className="advice-item">
          <div className="between">
            <strong>Accords mets et vins</strong>
            <Origin kind={wine.pairings ? (wine.pairings_source ?? 'personal') : null} />
          </div>
          {wine.pairings ? (
            <span>{wine.pairings}</span>
          ) : (
            <span className="muted">
              Pas encore d’accord enregistré. <a href={`#/assistant?vin=${wine.id}&q=${encodeURIComponent('Avec quels plats servir ce vin ?')}`}>Demander à l’assistant</a>
            </span>
          )}
        </div>
        {wine.notes && (
          <div className="advice-item">
            <strong>Mes notes</strong>
            <span style={{ whiteSpace: 'pre-wrap' }}>{wine.notes}</span>
          </div>
        )}
      </section>

      <section aria-labelledby="h-lots">
        <div className="section-title">
          <h2 id="h-lots">Lots</h2>
          <button type="button" className="link btn-ghost" style={{ border: 0, background: 'none', color: 'var(--primary)', cursor: 'pointer' }} onClick={() => setSheet({ kind: 'lot' })}>
            + Ajouter
          </button>
        </div>
        <div className="stack">
          {lots.map((l) => (
            <article key={l.id} className="card stack-sm">
              <div className="between">
                <strong>
                  {l.quantity} bouteille{l.quantity > 1 ? 's' : ''} · {volumeLabel(l.volume_ml)}
                </strong>
                <span className={`pill ${l.visibility === 'private' ? '' : 'primary'}`}>{label(VISIBILITIES, l.visibility)}</span>
              </div>
              <span className="small muted">
                {cellar(l.cellar_id)?.name}
                {l.location_id ? ` › ${location(l.location_id)?.name}` : ''}
                {(() => {
                  const sp = lotSplit(l, snapshot.groupShares);
                  return [
                    sp.forGroups ? ` · ${sp.forGroups} pour ${sp.groups.length > 1 ? 'mes groupes' : `« ${groupName(sp.groups[0].group_id)} »`}` : '',
                    sp.forEvents ? ` · ${sp.forEvents} réservée${sp.forEvents > 1 ? 's' : ''} (événement)` : '',
                  ].join('');
                })()}
                {l.purchase_price !== null ? ` · acheté ${money(l.purchase_price, l.currency)}` : ''}
                {l.purchase_date ? ` le ${dateShort(l.purchase_date)}` : ''}
              </span>
              {l.visibility !== 'private' && (
                <span className="small faint">
                  Vos amis voient ce lot{[l.hide_price && 'sans le prix', l.hide_quantity && 'sans la quantité exacte', l.hide_notes && 'sans vos notes'].filter(Boolean).length ? ' ' : ''}
                  {[l.hide_price && 'sans le prix', l.hide_quantity && 'sans la quantité exacte', l.hide_notes && 'sans vos notes'].filter(Boolean).join(', ')}.
                </span>
              )}
              {l.notes && <span className="small">{l.notes}</span>}
              {myGroups.length > 0 && l.quantity > 0 && (
                <div className="stack-sm">
                  <span className="small muted">Visible dans mes groupes (les bouteilles restent à vous) :</span>
                  <div className="chips" role="group" aria-label="Groupes où ce lot est visible">
                    {myGroups.map((g) => {
                      const share = shareOf(l.id, g.id);
                      const on = !!share;
                      return (
                        <button
                          key={g.id}
                          type="button"
                          className="chip"
                          aria-pressed={on}
                          onClick={async () => {
                            if (
                              share?.allocated &&
                              !(await confirm({
                                title: `Ne plus partager avec « ${g.name} » ?`,
                                message:
                                  share.allocated > 1
                                    ? `Les ${share.allocated} bouteilles mises à disposition du groupe redeviendront libres.`
                                    : 'La bouteille mise à disposition du groupe redeviendra libre.',
                                confirmLabel: 'Ne plus partager',
                              }))
                            )
                              return;
                            await run(() => api.shareLotWithGroup(l.id, g.id, !on), { success: on ? `Retiré de « ${g.name} »` : `Visible dans « ${g.name} »` });
                          }}
                        >
                          {g.emoji} {g.name}
                          {share?.allocated ? ` · ${share.allocated} à disposition` : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="inline">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Minus />}
                  disabled={l.quantity - l.reserved < 1 && lotSplit(l, snapshot.groupShares).forGroups < 1}
                  onClick={() => setSheet({ kind: 'move', lot: l, mode: 'out' })}
                >
                  Sortie
                </Button>
                <Button size="sm" variant="secondary" icon={<ArrowDownToLine />} onClick={() => setSheet({ kind: 'move', lot: l, mode: 'in' })}>
                  Entrée
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSheet({ kind: 'move', lot: l, mode: 'fix' })}>
                  Corriger
                </Button>
                <Button size="sm" variant="ghost" icon={<Pencil />} onClick={() => setSheet({ kind: 'lot', lot: l })}>
                  Lot et partage
                </Button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <PriceSection wine={wine} lots={lots} tastings={tastings} />

      {tastings.length > 0 && (
        <section aria-labelledby="h-tastings">
          <div className="section-title">
            <h2 id="h-tastings">Mes dégustations</h2>
          </div>
          <div className="list">
            {tastings.map((t) => (
              <a key={t.id} className="row" href={`#/carnet/degustation/${t.id}`}>
                <span className="row-main">
                  <span className="row-title">{dateShort(t.tasted_on)}{t.place ? ` · ${t.place}` : ''}</span>
                  <span className="row-sub">{t.comment ?? 'Sans commentaire'}</span>
                </span>
                <StarsView value={t.rating} />
              </a>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="h-history" className="card">
        <h2 id="h-history" className="section">
          Historique des entrées et sorties
        </h2>
        {movements === null ? (
          <InlineLoading />
        ) : movements.length === 0 ? (
          <p className="muted">Aucun mouvement.</p>
        ) : (
          <div className="timeline">
            {movements.slice(0, 40).map((m) => {
              const canUndo = m.kind !== 'annulation' && !reversed.has(m.id);
              return (
                <div key={m.id} className="tl">
                  <span className={`delta ${m.delta > 0 ? 'plus' : 'minus'}`}>{m.delta > 0 ? `+${m.delta}` : m.delta}</span>
                  <span className="row-main">
                    <span className="strong">
                      {MOVEMENT_LABELS[m.kind]} · {dateShort(m.occurred_on)}
                    </span>
                    {(m.note || m.event_id || m.group_id) && (
                      <span className="small muted">
                        {m.event_id ? (
                          <a href={`#/evenements/${m.event_id}`}>{m.note ?? 'Événement'}</a>
                        ) : m.group_id ? (
                          <>
                            Mise à disposition de <a href={`#/groupes/${m.group_id}`}>{groupName(m.group_id)}</a>
                            {m.note ? ` · ${m.note}` : ''}
                          </>
                        ) : (
                          m.note
                        )}
                      </span>
                    )}
                    {reversed.has(m.id) && <span className="small faint">Annulé</span>}
                  </span>
                  {canUndo && (
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Annuler : ${MOVEMENT_LABELS[m.kind]} du ${dateShort(m.occurred_on)}`}
                      title="Annuler cette saisie"
                      onClick={async () => {
                        const ok = await confirm({
                          title: 'Annuler cette saisie ?',
                          message: `${MOVEMENT_LABELS[m.kind]} de ${Math.abs(m.delta)} bouteille(s) : le stock sera rétabli et l’annulation notée dans l’historique.`,
                          confirmLabel: 'Annuler la saisie',
                          cancelLabel: 'Garder',
                        });
                        if (ok) await run(() => api.reverseMovement(m.id, newId()), { success: 'Saisie annulée, stock rétabli' });
                      }}
                    >
                      <Undo2 />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {sheet?.kind === 'edit' && <WineFormSheet wine={wine} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'lot' && <LotSheet wine={wine} lot={sheet.lot} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'move' && <MovementSheet wine={wine} lots={lots} initialLot={sheet.lot} mode={sheet.mode} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'allocate' && <AllocateSheet lotIds={lots.map((l) => l.id)} initialLot={sheet.lot?.id} onClose={() => setSheet(null)} />}
    </>
  );
}

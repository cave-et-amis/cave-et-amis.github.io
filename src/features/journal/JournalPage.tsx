import { useMemo, useState } from 'react';
import { Download, Heart, Plus, Search, Trash2 } from 'lucide-react';
import { useStore } from '../../data/store';
import { buildRows } from '../../domain/cellar';
import { currentYear, dateShort, money } from '../../domain/format';
import type { Tasting } from '../../domain/types';
import { colorLabel, fold, label, OCCASIONS, PRICE_KINDS } from '../../domain/wine';
import { useActions } from '../../ui/Shell';
import { Button, EmptyState, StarsView, useConfirm } from '../../ui/kit';
import { routeQuery } from '../../ui/router';
import { WineItem } from '../../ui/WineItem';
import { WishFormSheet } from './WishForm';
import { FirstTip } from '../tour/Tour';

type Tab = 'degustations' | 'favoris' | 'envies' | 'possedes';

const TABS: { value: Tab; label: string }[] = [
  { value: 'degustations', label: 'Dégustés' },
  { value: 'favoris', label: 'Favoris' },
  { value: 'envies', label: 'Envies' },
  { value: 'possedes', label: 'Possédés' },
];

function tastingsCsv(rows: Tasting[]) {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const head = ['Date', 'Vin', 'Millésime', 'Couleur', 'Région', 'Appellation', 'Lieu', 'Occasion', 'Note /5', 'Commentaire', 'Robe', 'Nez', 'Bouche', 'Plat', 'Prix payé', 'Type de prix', 'À racheter'];
  const lines = rows.map((t) =>
    [t.tasted_on, t.wine_name, t.vintage, colorLabel(t.color), t.region, t.appellation, t.place, label(OCCASIONS, t.occasion), t.rating, t.comment, t.robe, t.nez, t.bouche, t.dish, t.price_paid, label(PRICE_KINDS, t.price_kind), t.rebuy ? 'oui' : '']
      .map(cell)
      .join(';'),
  );
  return '﻿' + [head.join(';'), ...lines].join('\r\n');
}

function TastingRow({ t }: { t: Tasting }) {
  return (
    <a className="row" href={`#/carnet/degustation/${t.id}`}>
      <span className="dot" style={{ background: `var(--wine-${t.color ?? 'autre'})` }} aria-hidden />
      <span className="row-main">
        <span className="row-title">
          {t.wine_name}
          {t.vintage ? <span className="muted"> · {t.vintage}</span> : null}
        </span>
        <span className="row-sub">
          {dateShort(t.tasted_on)}
          {t.place ? ` · ${t.place}` : ''}
          {t.price_paid !== null ? ` · ${money(t.price_paid, t.currency)}${t.price_kind === 'verre' ? ' le verre' : ''}` : ''}
        </span>
        <span className="inline" style={{ gap: 6, marginTop: 2 }}>
          {t.rebuy && <span className="pill gold">À racheter</span>}
          {t.favorite && <span className="pill primary">Coup de cœur</span>}
          {t.movement_id && <span className="pill">De ma cave</span>}
        </span>
      </span>
      <StarsView value={t.rating} />
    </a>
  );
}

export function JournalPage() {
  const { snapshot, api, run } = useStore();
  const actions = useActions();
  const confirm = useConfirm();
  const initial = routeQuery().get('onglet') as Tab | null;
  const [tab, setTab] = useState<Tab>(initial && TABS.some((t) => t.value === initial) ? initial : 'degustations');
  const [q, setQ] = useState('');
  const [wish, setWish] = useState<{ open: boolean; id?: string }>({ open: false });
  const year = currentYear();
  const rows = useMemo(() => buildRows(snapshot.wines, snapshot.lots, snapshot.cellars, year), [snapshot, year]);

  const words = fold(q).split(/\s+/).filter(Boolean);
  const match = (text: string) => words.every((w) => fold(text).includes(w));
  const tastings = snapshot.tastings.filter((t) => match([t.wine_name, t.producer, t.region, t.appellation, t.place, t.comment, t.vintage].join(' ')));
  const favWines = rows.filter((r) => r.wine.favorite && match([r.wine.name, r.wine.region, r.wine.appellation].join(' ')));
  const favTastings = tastings.filter((t) => t.favorite || t.rating === 5);
  const wishes = snapshot.wishlist.filter((w) => match([w.wine_name, w.producer, w.region, w.note].join(' ')));
  const rebuy = tastings.filter((t) => t.rebuy);
  const owned = rows.filter((r) => r.stock > 0 && match([r.wine.name, r.wine.region, r.wine.appellation, r.wine.producer, r.wine.domaine].join(' ')));

  return (
    <>
      <FirstTip id="carnet" title="Votre carnet" onHelp={actions.help}>
        Notez les vins goûtés, où que vous soyez, et gardez vos envies d’achat. Vos notes restent privées, sauf si vous les partagez avec un
        événement ou un groupe.
      </FirstTip>
      <div className="subtabs" role="tablist" aria-label="Sections du carnet">
        {TABS.map((t) => (
          <button key={t.value} type="button" role="tab" aria-selected={tab === t.value} aria-pressed={tab === t.value} onClick={() => setTab(t.value)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="search">
        <Search aria-hidden />
        <input className="input" type="search" aria-label="Chercher dans mon carnet" placeholder="Chercher un vin, un lieu…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {tab === 'degustations' && (
        <>
          <p className="small muted">Les vins que vous avez goûtés, ici ou ailleurs. Vos notes sont privées, sauf si vous les partagez avec un événement.</p>
          <Button icon={<Plus />} onClick={() => actions.newTasting()}>
            Noter une dégustation
          </Button>
          {tastings.length === 0 ? (
            <EmptyState icon="📓" title={snapshot.tastings.length ? 'Aucune dégustation ne correspond' : 'Votre carnet est vide'}>
              Notez un vin bu au restaurant, chez des amis, dans un salon… même s’il n’a jamais été dans votre cave.
            </EmptyState>
          ) : (
            <div className="list">
              {tastings.map((t) => (
                <TastingRow key={t.id} t={t} />
              ))}
            </div>
          )}
          {snapshot.tastings.length > 0 && (
            <Button
              variant="ghost"
              icon={<Download />}
              onClick={() => {
                const blob = new Blob([tastingsCsv(snapshot.tastings)], { type: 'text/csv;charset=utf-8' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `mon-carnet-${new Date().toISOString().slice(0, 10)}.csv`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 1000);
              }}
            >
              Exporter mon carnet (tableur)
            </Button>
          )}
        </>
      )}

      {tab === 'favoris' && (
        <>
          <p className="small muted">Les vins de votre cave marqués comme favoris, et vos coups de cœur de dégustation.</p>
          {favWines.length === 0 && favTastings.length === 0 ? (
            <EmptyState icon="❤️" title="Pas encore de favoris">
              Touchez « Favori » sur la fiche d’un vin, ou cochez « Coup de cœur » sur une dégustation.
            </EmptyState>
          ) : (
            <>
              {favWines.length > 0 && (
                <section>
                  <h2 className="section" style={{ marginBottom: 8 }}>
                    Dans ma cave
                  </h2>
                  <div className="list">
                    {favWines.map((r) => (
                      <WineItem key={r.wine.id} row={r} />
                    ))}
                  </div>
                </section>
              )}
              {favTastings.length > 0 && (
                <section>
                  <h2 className="section" style={{ marginBottom: 8 }}>
                    Coups de cœur dégustés
                  </h2>
                  <div className="list">
                    {favTastings.map((t) => (
                      <TastingRow key={t.id} t={t} />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </>
      )}

      {tab === 'envies' && (
        <>
          <p className="small muted">Les vins à acheter ou à goûter un jour.</p>
          <Button icon={<Heart />} onClick={() => setWish({ open: true })}>
            Ajouter une envie
          </Button>
          {wishes.length === 0 && rebuy.length === 0 ? (
            <EmptyState icon="🛒" title="Liste d’envies vide">
              Ajoutez un vin repéré chez un caviste, ou cochez « À racheter » sur une dégustation.
            </EmptyState>
          ) : (
            <>
              {wishes.length > 0 && (
                <div className="list">
                  {wishes.map((w) => (
                    <div key={w.id} className="row static">
                      <input
                        type="checkbox"
                        aria-label={`${w.wine_name} : acheté ou goûté`}
                        checked={w.done}
                        onChange={(e) => void run(() => api.updateWish(w.id, { done: e.target.checked }))}
                        style={{ width: 22, height: 22, accentColor: 'var(--primary)' }}
                      />
                      <button type="button" className="row-main" style={{ border: 0, background: 'none', textAlign: 'left', cursor: 'pointer', padding: 0 }} onClick={() => setWish({ open: true, id: w.id })}>
                        <span className="row-title" style={{ textDecoration: w.done ? 'line-through' : undefined }}>
                          {w.wine_name}
                          {w.vintage ? ` ${w.vintage}` : ''}
                        </span>
                        <span className="row-sub">{[w.producer, w.region, w.note].filter(Boolean).join(' · ')}</span>
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Retirer ${w.wine_name} de la liste`}
                        onClick={async () => {
                          if (await confirm({ title: 'Retirer cette envie ?', confirmLabel: 'Retirer' })) await run(() => api.deleteWish(w.id), { success: 'Envie retirée' });
                        }}
                      >
                        <Trash2 />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {rebuy.length > 0 && (
                <section>
                  <h2 className="section" style={{ margin: '8px 0' }}>
                    Dégustations « à racheter »
                  </h2>
                  <div className="list">
                    {rebuy.map((t) => (
                      <TastingRow key={t.id} t={t} />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </>
      )}

      {tab === 'possedes' && (
        <>
          <p className="small muted">Les vins actuellement dans votre cave (gestion complète dans « Ma cave »).</p>
          {owned.length === 0 ? (
            <EmptyState icon="🍾" title="Aucun vin en stock" action={<Button onClick={actions.add}>Ajouter un vin</Button>} />
          ) : (
            <div className="list">
              {owned.map((r) => (
                <WineItem key={r.wine.id} row={r} />
              ))}
            </div>
          )}
        </>
      )}

      {wish.open && <WishFormSheet item={snapshot.wishlist.find((w) => w.id === wish.id)} onClose={() => setWish({ open: false })} />}
    </>
  );
}

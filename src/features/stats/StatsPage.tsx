/**
 * Statistiques (Cave & Amis 2.0) : la cave en chiffres et en graphiques, calculés sur l'appareil, et le carnet de
 * dégustation (onglet « Mon carnet », le même écran que #/carnet).
 */
import { useMemo } from 'react';
import { useStore } from '../../data/store';
import { bottlesByEntryMonth, buildRows, colorBreakdown, maturityBreakdown, regionBreakdown } from '../../domain/cellar';
import { currentYear, money, moneyRange } from '../../domain/format';
import { MATURITY_LABELS } from '../../domain/maturity';
import { valuation, coverageText } from '../../domain/valuation';
import { Segmented } from '../../ui/kit';
import { go, routeQuery, useRoute } from '../../ui/router';
import { JournalPage } from '../journal/JournalPage';

type Tab = 'cave' | 'carnet';

export function StatsPage() {
  const { snapshot, userId } = useStore();
  // Onglet lu dans l'adresse : un lien « Mon carnet » l'ouvre même depuis cette page.
  const route = useRoute();
  const tab: Tab = routeQuery(route).get('onglet') === 'carnet' ? 'carnet' : 'cave';
  const setTab = (t: Tab) => go(t === 'carnet' ? '/statistiques?onglet=carnet' : '/statistiques', { replace: true });
  const year = currentYear();
  // Mes bouteilles seulement (une cave gérée à plusieurs montre aussi celles de son propriétaire).
  const rows = useMemo(() => buildRows(snapshot.wines, snapshot.lots, snapshot.cellars, year).filter((r) => r.wine.owner_id === userId), [snapshot, userId, year]);
  const inStock = rows.filter((r) => r.stock > 0);
  const bottles = inStock.reduce((s, r) => s + r.stock, 0);
  const byColor = colorBreakdown(rows);
  const byRegion = regionBreakdown(rows);
  const maturity = maturityBreakdown(rows);
  const months = useMemo(() => bottlesByEntryMonth(snapshot.lots, userId, 12), [snapshot.lots, userId]);
  const maxMonth = Math.max(1, ...months.series.map((m) => m.bottles));
  const maxRegion = Math.max(1, ...byRegion.map((r) => r.bottles));
  const value = useMemo(() => valuation(snapshot.lots.filter((l) => l.owner_id === userId), snapshot.prices), [snapshot.lots, snapshot.prices, userId]);
  const purchase = Object.entries(value.purchase.totals);
  const market = Object.entries(value.market.totals);
  const monthLabel = (m: string) => new Date(`${m}-01T12:00:00`).toLocaleDateString('fr-FR', { month: 'short' });

  return (
    <>
      <Segmented<Tab>
        label="Statistiques"
        options={[
          { value: 'cave', label: 'Ma cave' },
          { value: 'carnet', label: 'Mon carnet' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'carnet' ? (
        <JournalPage />
      ) : bottles === 0 ? (
        <div className="card">
          <p className="muted">Ajoutez des bouteilles : vos statistiques apparaîtront ici.</p>
        </div>
      ) : (
        <div className="dash-grid">
          <section className="card" aria-labelledby="h-st-total">
            <div className="section-title">
              <h2 id="h-st-total">En chiffres</h2>
            </div>
            <div className="stats-figures">
              <div>
                <b>{bottles}</b>
                <span>bouteilles</span>
              </div>
              <div>
                <b>{inStock.length}</b>
                <span>vins différents</span>
              </div>
              <div>
                <b>{purchase.length ? purchase.map(([c, v]) => money(v, c)).join(' + ') : '—'}</b>
                <span>valeur d’achat{value.purchase.covered < value.bottles ? ` (${coverageText(value.purchase.covered, value.bottles)})` : ''}</span>
              </div>
              <div className="wide">
                <b>{market.length ? market.map(([c, v]) => moneyRange(v.low, v.high, c)).join(' + ') : '—'}</b>
                <span>{market.length ? `valeur de marché estimée (${coverageText(value.market.covered, value.bottles)})` : 'valeur de marché : aucun prix relevé'}</span>
              </div>
            </div>
          </section>

          <section className="card stats-color" aria-labelledby="h-st-color">
            <div className="section-title">
              <h2 id="h-st-color">Par couleur</h2>
            </div>
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
            <ul className="stats-share">
              {byColor.slice(0, 3).map((c) => (
                <li key={c.color}>
                  <b>{Math.round((c.bottles / bottles) * 100)} %</b>
                  <span>{c.label.toLowerCase()}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card" aria-labelledby="h-st-region">
            <div className="section-title">
              <h2 id="h-st-region">Par région</h2>
            </div>
            <ul className="stats-hbars">
              {byRegion.map((r) => (
                <li key={r.region}>
                  <span>{r.region}</span>
                  <span className="track">
                    <i style={{ width: `${(r.bottles / maxRegion) * 100}%` }} />
                  </span>
                  <b>{r.bottles}</b>
                </li>
              ))}
            </ul>
          </section>

          <section className="card" aria-labelledby="h-st-maturity">
            <div className="section-title">
              <h2 id="h-st-maturity">
                Maturité
                <small>Périodes indicatives (fiches, sinon repère général)</small>
              </h2>
            </div>
            <ul className="stats-hbars">
              {(['ready', 'soon', 'young', 'past', 'unknown'] as const).map((k) => (
                <li key={k}>
                  <span>{MATURITY_LABELS[k]}</span>
                  <span className="track">
                    <i className={`m-${k}`} style={{ width: `${(maturity[k] / Math.max(1, bottles)) * 100}%` }} />
                  </span>
                  <b>{maturity[k]}</b>
                </li>
              ))}
            </ul>
          </section>

          <section className="card stats-wide" aria-labelledby="h-st-months">
            <div className="section-title">
              <h2 id="h-st-months">
                Entrées en cave
                <small>Bouteilles encore là, par mois d’achat (sinon d’ajout), sur 12 mois</small>
              </h2>
            </div>
            <div className="dash-bars" role="img" aria-label={`Bouteilles par mois : ${months.series.map((m) => `${monthLabel(m.month)} ${m.bottles}`).join(', ')}`}>
              {months.series.map((m) => (
                <i key={m.month} data-v={m.bottles} style={{ height: `${Math.max(4, (m.bottles / maxMonth) * 100)}%` }}>
                  {m.bottles > 0 && <em>{m.bottles}</em>}
                </i>
              ))}
            </div>
            <div className="stats-months" aria-hidden>
              {months.series.map((m) => (
                <span key={m.month}>{monthLabel(m.month)}</span>
              ))}
            </div>
            <p className="small muted" style={{ margin: '10px 0 0' }}>
              <strong className="dash-up">
                +{months.lastQuarter} bouteille{months.lastQuarter > 1 ? 's' : ''}
              </strong>{' '}
              entrée{months.lastQuarter > 1 ? 's' : ''} ces 3 derniers mois, encore en cave
            </p>
          </section>
        </div>
      )}
    </>
  );
}

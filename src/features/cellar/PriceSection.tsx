/**
 * Prix, présentés séparément : prix d'achat personnel, prix payés au restaurant ou au verre, prix de marché indicatif.
 * Un prix de marché indique toujours le vin et le millésime, la contenance, la devise, la date et ses sources.
 * Sans recherche vérifiable : « prix non vérifié ».
 */
import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Search, Trash2 } from 'lucide-react';
import { useStore } from '../../data/store';
import type { Lot, MarketPrice, PriceSource, PriceWatch, Tasting, Wine } from '../../domain/types';
import { dateLong, money, moneyRange, parseNumber } from '../../domain/format';
import { latestPrices } from '../../domain/valuation';
import { median, offersVsMedian, priceHistory, RANGES, variation, type PriceRange } from '../../domain/priceHistory';
import { label, PRICE_KINDS, VOLUMES, volumeLabel, wineTitle } from '../../domain/wine';
import { Button, Check, Field, InlineLoading, Notice, Segmented, Sheet, useConfirm } from '../../ui/kit';
import { SafeLink } from '../../ui/markdown';
import { useAiStatus } from './LabelScan';

type CheckResult = {
  status: 'verified' | 'unverified';
  check_id: string | null;
  volume_ml: number;
  currency: string | null;
  low: number | null;
  high: number | null;
  offers: PriceSource[];
  reason: string | null;
  checked_at: string;
};

/** Écart à une référence : vert si moins cher, rouge si plus cher ; neutre quand plus cher n'est pas une mauvaise nouvelle. */
export function DeltaPill({ delta, label, neutral }: { delta: number | null; label: string; neutral?: boolean }) {
  if (delta === null) return null;
  const text = `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta)} %`;
  return (
    <span className={`delta-pill ${neutral ? '' : delta < 0 ? 'down' : delta > 0 ? 'up' : ''}`} title={label}>
      {text}
      <span className="sr-only"> {label}</span>
    </span>
  );
}

function Sources({ sources, deltas }: { sources: PriceSource[]; deltas?: Map<string, number | null> }) {
  if (!sources.length) return null;
  return (
    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }} className="small">
      {sources.map((s) => (
        <li key={s.url}>
          {/* Nom trouvé par la recherche : le domaine réel est affiché s'il ne le montre pas. */}
          <SafeLink href={s.url} label={s.seller || s.title || new URL(s.url).hostname}>
            <ExternalLink aria-hidden style={{ width: 13, height: 13, marginLeft: 3, verticalAlign: -1 }} />
          </SafeLink>
          {s.price !== undefined && s.currency ? ` — ${money(s.price, s.currency)}` : ''}{' '}
          <DeltaPill delta={deltas?.get(s.url) ?? null} label="par rapport à la médiane des offres de ce relevé" />
        </li>
      ))}
    </ul>
  );
}

export function PriceSection({ wine, lots, tastings }: { wine: Wine; lots: Lot[]; tastings: Tasting[] }) {
  const { snapshot, api, run, userId } = useStore();
  const confirm = useConfirm();
  const [manual, setManual] = useState(false);
  const [lookup, setLookup] = useState(false);
  const prices = snapshot.prices.filter((p) => p.wine_id === wine.id);
  const latest = [...latestPrices(prices).values()];
  const older = prices.filter((p) => !latest.includes(p));
  const purchase = lots.filter((l) => l.purchase_price !== null);
  const restaurant = tastings.filter((t) => t.price_paid !== null);

  return (
    <section aria-labelledby="h-prices" className="card stack">
      <h2 id="h-prices" className="section">
        Prix
      </h2>

      <div className="stack-sm">
        <span className="strong small">Mon prix d’achat</span>
        {purchase.length ? (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {purchase.map((l) => (
              <li key={l.id}>
                {money(l.purchase_price, l.currency)} la bouteille ({volumeLabel(l.volume_ml)})
                {l.purchase_date ? `, le ${dateLong(l.purchase_date)}` : ''}
                {l.purchase_place ? ` — ${l.purchase_place}` : ''}
              </li>
            ))}
          </ul>
        ) : (
          <span className="muted small">Non renseigné.</span>
        )}
      </div>

      {restaurant.length > 0 && (
        <div className="stack-sm">
          <span className="strong small">Payé au restaurant, au verre ou en boutique (carnet)</span>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {restaurant.map((t) => (
              <li key={t.id}>
                {money(t.price_paid, t.currency)} — {label(PRICE_KINDS, t.price_kind) || 'prix payé'}
                {t.place ? `, ${t.place}` : ''} ({dateLong(t.tasted_on)})
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="stack-sm">
        <span className="strong small">Prix de marché indicatif</span>
        {latest.length === 0 && <span className="muted small">Prix non vérifié : aucun relevé enregistré pour ce vin.</span>}
        {latest.map((p) => (
          <MarketRow
            key={p.id}
            p={p}
            wine={wine}
            // Supprimer un relevé : au propriétaire de la fiche (une personne associée à la cave en ajoute seulement).
            onDelete={
              wine.owner_id === userId
                ? async () => {
                    if (await confirm({ title: 'Supprimer ce relevé de prix ?', confirmLabel: 'Supprimer', danger: true })) await run(() => api.deleteMarketPrice(p.id), { success: 'Relevé supprimé' });
                  }
                : undefined
            }
          />
        ))}
        {older.length > 0 && <span className="small faint">{older.length} relevé(s) plus ancien(s) conservé(s).</span>}
        {latest.map((p) => (
          <PriceChart
            key={`c-${p.id}`}
            prices={prices}
            volume={p.volume_ml}
            currency={p.currency}
            purchase={purchase.filter((l) => l.volume_ml === p.volume_ml && l.currency === p.currency).map((l) => Number(l.purchase_price))}
          />
        ))}
        {wine.owner_id === userId && <PriceWatchToggle wine={wine} volume={lots[0]?.volume_ml ?? 750} />}
        <div className="inline">
          <Button variant="gold" size="sm" icon={<Search />} onClick={() => setLookup(true)}>
            Rechercher le prix actuel
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setManual(true)}>
            Saisir un prix relevé
          </Button>
        </div>
      </div>

      {manual && <ManualPriceSheet wine={wine} volume={lots[0]?.volume_ml ?? 750} onClose={() => setManual(false)} />}
      {lookup && <LookupSheet wine={wine} volumes={[...new Set(lots.map((l) => l.volume_ml))]} onClose={() => setLookup(false)} />}
    </section>
  );
}

const WATCH_STATUS: Record<NonNullable<PriceWatch['last_status']>, string> = {
  lower: 'Prix plus bas trouvé',
  not_lower: 'Pas de baisse',
  unverified: 'Prix non vérifié (aucune offre fiable)',
  budget: 'Vérification reportée : plafond des alertes ou budget de l’assistant atteint',
  failed: 'La vérification n’a pas abouti',
};

/** « M'alerter si le prix baisse » : un seul vin suivi à la fois, vérifié le vendredi soir (décision du 28/10/2026). */
function PriceWatchToggle({ wine, volume }: { wine: Wine; volume: number }) {
  const { api, run, wine: wineById } = useStore();
  const [watch, setWatch] = useState<PriceWatch | null | undefined>(undefined);
  useEffect(() => {
    void api
      .priceWatch()
      .then(setWatch)
      .catch(() => setWatch(null));
  }, [api]);
  if (watch === undefined) return null;
  const on = watch?.wine_id === wine.id;
  const other = watch && !on ? wineById(watch.wine_id) : undefined;
  async function toggle(next: boolean) {
    const res = await run(() => api.setPriceWatch(next ? wine.id : null, next ? volume : null), {
      success: next ? 'Alerte de prix activée' : 'Alerte de prix retirée',
      reload: false,
    });
    if (res.ok) setWatch(await api.priceWatch().catch(() => null));
  }
  return (
    <div className="stack-sm price-watch">
      <Check
        checked={on}
        onChange={(v) => void toggle(v)}
        label="M’alerter si le prix baisse"
        hint={
          other
            ? `Vous suivez déjà « ${wineTitle(other)} » : un seul vin à la fois, cocher ici le remplace.`
            : 'Vérifié le vendredi soir, une fois par semaine. Un seul vin suivi à la fois. Ces vérifications ont un plafond de 2 $ par mois pour toute l’application, dans le budget de l’assistant : s’il est atteint, elles reprennent le mois suivant.'
        }
      />
      {on && watch && (
        <p className="small muted" style={{ margin: 0 }}>
          {watch.reference_price !== null && watch.currency ? `Alerte sous ${money(Number(watch.reference_price), watch.currency)}. ` : 'Le premier contrôle fixera le prix de référence. '}
          {watch.last_checked_at && watch.last_status
            ? `Dernier contrôle le ${dateLong(watch.last_checked_at)} : ${WATCH_STATUS[watch.last_status].toLowerCase()}.`
            : 'Premier contrôle vendredi soir.'}
        </p>
      )}
    </div>
  );
}

/** Courbe des relevés (milieu de chaque fourchette), sur 6 mois, 1 an, 3 ans ou tout l'historique. */
function PriceChart({ prices, volume, currency, purchase }: { prices: MarketPrice[]; volume: number; currency: string; purchase: number[] }) {
  const [range, setRange] = useState<PriceRange>('tout');
  const all = useMemo(() => priceHistory(prices, volume, currency, 'tout'), [prices, volume, currency]);
  const points = useMemo(() => priceHistory(prices, volume, currency, range), [prices, volume, currency, range]);
  if (all.length < 2) return null;
  const W = 320;
  const H = 130;
  const pad = { l: 34, r: 10, t: 12, b: 22 };
  const values = points.flatMap((p) => [p.low, p.high]);
  const lo = Math.floor(Math.min(...values) * 0.95);
  const hi = Math.ceil(Math.max(...values) * 1.05);
  const first = points[0];
  const last = points[points.length - 1];
  const t0 = first ? new Date(first.at).getTime() : 0;
  const t1 = last ? new Date(last.at).getTime() : 1;
  const x = (at: string) => pad.l + (t1 === t0 ? 0.5 : (new Date(at).getTime() - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (hi === lo ? 0.5 : (hi - v) / (hi - lo)) * (H - pad.t - pad.b);
  const line = points.map((p) => `${x(p.at)},${y(p.value)}`).join(' ');
  const change = points.length >= 2 ? variation(last.value, first.value) : null;
  const vsPurchase = last ? variation(last.value, median(purchase)) : null;
  const month = (at: string) => new Date(at).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
  return (
    <div className="price-chart stack-sm">
      <div className="between">
        <span className="strong small">
          Évolution · {volumeLabel(volume)} · {currency}
        </span>
        <span className="inline">
          <DeltaPill delta={change} label="sur la période affichée" />
          {vsPurchase !== null && (
            <span className="small muted">
              vs achat <DeltaPill delta={vsPurchase} label="par rapport à mon prix d’achat" neutral />
            </span>
          )}
        </span>
      </div>
      <Segmented<PriceRange> label="Période" options={RANGES.map((r) => ({ value: r.value, label: r.label }))} value={range} onChange={setRange} />
      {points.length === 0 ? (
        <p className="small muted">Aucun relevé sur cette période.</p>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Prix relevés de ${money(Math.min(...points.map((p) => p.value)), currency)} à ${money(Math.max(...points.map((p) => p.value)), currency)} ; dernier relevé : ${money(last.value, currency)}`}
        >
          {[lo, (lo + hi) / 2, hi].map((v) => (
            <g key={v}>
              <line className="chart-grid" x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} />
              <text className="chart-axis" x={pad.l - 4} y={y(v)} textAnchor="end" dominantBaseline="middle">
                {Math.round(v)}
              </text>
            </g>
          ))}
          {points.length > 1 && <polygon className="chart-area" points={`${x(first.at)},${H - pad.b} ${line} ${x(last.at)},${H - pad.b}`} />}
          <polyline className="chart-line" points={line} />
          {points.map((p) => (
            <circle key={p.at} className="chart-dot" cx={x(p.at)} cy={y(p.value)} r={p === last ? 4.5 : 3} />
          ))}
          <text className="chart-axis" x={pad.l} y={H - 6}>
            {month(first.at)}
          </text>
          {points.length > 1 && (
            <text className="chart-axis" x={W - pad.r} y={H - 6} textAnchor="end">
              {month(last.at)}
            </text>
          )}
        </svg>
      )}
      <p className="small faint">Milieu de chaque fourchette relevée ; seuls les relevés de même contenance et de même devise sont comparés.</p>
    </div>
  );
}

function MarketRow({ p, wine, onDelete }: { p: MarketPrice; wine: Wine; onDelete?: () => void }) {
  const old = Date.now() - new Date(p.checked_at).getTime() > 180 * 86400_000;
  return (
    <div className="card soft" style={{ padding: 12 }}>
      <div className="between">
        <strong>{moneyRange(Number(p.price_low), Number(p.price_high), p.currency)}</strong>
        {onDelete && (
          <button type="button" className="icon-btn" aria-label="Supprimer ce relevé" onClick={onDelete}>
            <Trash2 />
          </button>
        )}
      </div>
      <p className="small muted">
        {wineTitle(wine)} · {volumeLabel(p.volume_ml)} · {p.currency} · consulté le {dateLong(p.checked_at)} ·{' '}
        {p.method === 'web' ? 'relevé par la recherche web' : 'saisi par vous'}
      </p>
      {old && <p className="small" style={{ color: 'var(--warn)', fontWeight: 650 }}>Relevé de plus de 6 mois : il peut avoir changé.</p>}
      {p.note && <p className="small">{p.note}</p>}
      <Sources sources={p.sources} deltas={new Map(offersVsMedian(p).map((o) => [o.offer.url, o.delta]))} />
    </div>
  );
}

function ManualPriceSheet({ wine, volume, onClose }: { wine: Wine; volume: number; onClose: () => void }) {
  const { api, run, me } = useStore();
  const [low, setLow] = useState('');
  const [high, setHigh] = useState('');
  const [vol, setVol] = useState(volume);
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Saisir un prix relevé"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            loading={busy}
            onClick={async () => {
              const l = parseNumber(low);
              const h = parseNumber(high) ?? l;
              if (l === null || h === null || l < 0 || h < l) return setError('Indiquez un prix (et un maximum supérieur au minimum).');
              if (url && !/^https?:\/\/\S+$/.test(url.trim())) return setError('Le lien doit commencer par https://');
              setBusy(true);
              const res = await run(
                () =>
                  api.addManualPrice({
                    wine_id: wine.id,
                    volume_ml: vol,
                    currency: me.currency,
                    price_low: l,
                    price_high: h,
                    note: note.trim() || null,
                    sources: url.trim() ? [{ url: url.trim() }] : [],
                  }),
                { success: 'Prix enregistré' },
              );
              setBusy(false);
              if (res.ok) onClose();
            }}
          >
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="form">
        <p className="muted small">Pour « {wineTitle(wine)} ». Ce prix sera présenté comme saisi par vous, avec la date d’aujourd’hui.</p>
        <div className="field-row">
          <Field label={`Prix (${me.currency})`} htmlFor="mp-low">
            <input id="mp-low" className="input" inputMode="decimal" value={low} onChange={(e) => setLow(e.target.value)} />
          </Field>
          <Field label="jusqu’à (facultatif)" htmlFor="mp-high">
            <input id="mp-high" className="input" inputMode="decimal" value={high} onChange={(e) => setHigh(e.target.value)} />
          </Field>
        </div>
        <Field label="Contenance">
          <select className="input" value={vol} onChange={(e) => setVol(Number(e.target.value))}>
            {VOLUMES.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Lien de la source (facultatif)" htmlFor="mp-url">
          <input id="mp-url" className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
        </Field>
        <Field label="Note" htmlFor="mp-note">
          <input id="mp-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Cote, catalogue de caviste…" />
        </Field>
        {error && (
          <p role="alert" style={{ color: 'var(--danger)', fontWeight: 650 }}>
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}

function LookupSheet({ wine, volumes, onClose }: { wine: Wine; volumes: number[]; onClose: () => void }) {
  const { api, run } = useStore();
  const ai = useAiStatus();
  const [volume, setVolume] = useState(volumes[0] ?? 750);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function search() {
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await api.ai('price_lookup', { wine_id: wine.id, volume_ml: volume });
    setBusy(false);
    if (!res.ok) setError(res.message);
    else setResult(res.result as CheckResult);
  }

  return (
    <Sheet open onClose={onClose} title="Prix de marché actuel">
      <div className="stack">
        <p className="muted">
          L’assistant cherche des offres en ligne pour <strong>{wineTitle(wine)}</strong>
          {!wine.vintage && !wine.non_vintage ? ' (millésime à préciser sur la fiche)' : ''}. Seules les offres dont le lien provient réellement de la
          recherche sont retenues.
        </p>
        {volumes.length > 1 && (
          <Field label="Contenance">
            <select className="input" value={volume} onChange={(e) => setVolume(Number(e.target.value))}>
              {volumes.map((v) => (
                <option key={v} value={v}>
                  {volumeLabel(v)}
                </option>
              ))}
            </select>
          </Field>
        )}
        {ai.unavailable && <Notice tone="warn">{ai.unavailable} Prix non vérifié : vous pouvez saisir un prix relevé vous-même.</Notice>}
        {ai.status && !ai.status.web_search && !ai.unavailable && (
          <Notice tone="warn">La recherche web est désactivée par l’administrateur : le prix ne pourra pas être vérifié.</Notice>
        )}
        {!result && !busy && (
          <Button icon={<Search />} onClick={() => void search()} disabled={Boolean(ai.unavailable)}>
            Lancer la recherche
          </Button>
        )}
        {busy && <InlineLoading text="Recherche en cours sur le web… (jusqu’à une minute)" />}
        {error && <Notice tone="warn">{error}</Notice>}
        {result && result.status === 'unverified' && (
          <Notice tone="warn">
            <strong>Prix non vérifié.</strong> {result.reason}
          </Notice>
        )}
        {result && result.status === 'verified' && (
          <div className="card soft stack-sm">
            <strong style={{ fontSize: '1.2rem' }}>{moneyRange(result.low!, result.high!, result.currency!)}</strong>
            <span className="small muted">
              {wineTitle(wine)} · {volumeLabel(result.volume_ml)} · {result.currency} · consulté le {dateLong(result.checked_at)} · {result.offers.length} offre
              {result.offers.length > 1 ? 's' : ''}
              {result.low !== result.high ? ' (fourchette : les offres diffèrent)' : ''}
            </span>
            <Sources sources={result.offers} />
            <p className="small faint">Prix relevés en ligne par l’assistant : ils peuvent varier, vérifiez sur le site avant d’acheter ou de vendre.</p>
            {saved ? (
              <Notice tone="success">Relevé enregistré comme prix de marché.</Notice>
            ) : (
              <Button
                onClick={async () => {
                  const res = await run(() => api.savePriceCheck(result.check_id!), { success: 'Prix de marché enregistré' });
                  if (res.ok) setSaved(true);
                }}
              >
                Enregistrer ce relevé
              </Button>
            )}
          </div>
        )}
        {result && (
          <Button variant="secondary" onClick={() => void search()}>
            Relancer la recherche
          </Button>
        )}
      </div>
    </Sheet>
  );
}

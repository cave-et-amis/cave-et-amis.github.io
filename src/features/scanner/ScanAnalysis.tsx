/**
 * Lot 3b — verdict d'achat, prix du marché et analyse détaillée d'une bouteille vérifiée.
 * Les résultats arrivent l'un après l'autre (analyse du vin, puis prix) et sont enregistrés sur l'analyse ;
 * le verdict et la note sont recalculés ici selon la méthode documentée (src/domain/scan.ts).
 * Chaque information indique son origine : donnée confirmée, source identifiée, estimation de Lia ou indisponible.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useStore } from '../../data/store';
import { dateShort, money } from '../../domain/format';
import { computeVerdict, priceIsFresh, QUALITY_LABELS, VERDICT_LABELS, VERDICT_METHOD, wineKey, type Verdict } from '../../domain/scan';
import type { Scan, ScanAssessment, ScanMarket, SourcedText } from '../../domain/types';
import { Advanced, Button, InlineLoading, Notice, Origin } from '../../ui/kit';
import { useAiStatus } from '../cellar/LabelScan';

const TONE: Record<Verdict, string> = { excellent: 'success', good: 'success', fair: 'gold', poor: 'danger', insufficient: '' };
const RELIABILITY: Record<NonNullable<ScanMarket['reliability']>, string> = {
  haute: 'Haute : au moins trois offres vérifiées du même vin, dans la devise du magasin.',
  moyenne: 'Moyenne : une ou deux offres vérifiées seulement.',
  faible: 'Faible : offres trouvées seulement sur d’autres marchés ; elles ne servent pas au verdict.',
};
const VINTAGE_RATING: Record<string, string> = { exceptionnel: 'Exceptionnel', tres_bon: 'Très bon', bon: 'Bon', moyen: 'Moyen', difficile: 'Difficile' };

const pct = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)} %`;
const signed = (n: number, c: string) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n), c)}`;
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

function SourceLinks({ urls }: { urls: string[] }) {
  if (!urls.length) return null;
  return (
    <span className="small">
      {' '}
      ({urls.map((u, i) => (
        <span key={u}>
          {i > 0 && ', '}
          <a href={u} target="_blank" rel="noopener noreferrer">
            {host(u)}
          </a>
        </span>
      ))})
    </span>
  );
}

function Item({ label, value }: { label: string; value: SourcedText }) {
  if (!value.text) return null;
  return (
    <li>
      <span className="strong">{label}</span> <Origin kind={value.origin === 'source' ? 'source' : 'ai'} />
      <br />
      {value.text}
      <SourceLinks urls={value.sources} />
    </li>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="scan-group">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function ScanAnalysis({ scan }: { scan: Scan }) {
  const { api, online } = useStore();
  const ai = useAiStatus();
  const key = wineKey(scan.wine);
  // Une analyse faite pour un autre vin (fiche modifiée depuis) n'est pas reprise.
  const [assessment, setAssessment] = useState<ScanAssessment | null>(scan.assessment?.key === key ? scan.assessment : null);
  const [market, setMarket] = useState<ScanMarket | null>(scan.market?.key === key ? scan.market : null);
  const [step, setStep] = useState<'quality' | 'price' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const started = useRef(false);

  async function run(which: { quality: boolean; price: boolean }) {
    setFailure(null);
    if (which.quality) {
      setStep('quality');
      const res = await api.ai('scan_quality', { scan_id: scan.id });
      if (!res.ok) {
        setStep(null);
        setFailure(res.message);
        return;
      }
      setAssessment(res.assessment as ScanAssessment);
    }
    if (which.price) {
      setStep('price');
      const res = await api.ai('scan_price', { scan_id: scan.id });
      if (!res.ok) {
        setStep(null);
        setFailure(res.message);
        return;
      }
      setMarket(res.market as ScanMarket);
    }
    setStep(null);
  }

  // Dès la confirmation : analyse du vin puis prix, sauf s'ils sont déjà là (et le prix encore actuel).
  useEffect(() => {
    if (started.current || !ai.loaded || ai.unavailable || !online) return;
    const quality = !assessment;
    const price = !market || (!priceIsFresh(market.checked_at) && market.status === 'verified');
    if (!quality && !price) return;
    started.current = true;
    void run({ quality, price });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai.loaded, ai.unavailable, online]);

  const v = computeVerdict({ storePrice: scan.store_price, priceConfirmed: scan.price_confirmed, currency: scan.currency, assessment, market });
  const cur = scan.currency;
  const usable = market?.status === 'verified' && market.currency === cur;
  const stale = market ? !priceIsFresh(market.checked_at) : false;
  const busy = step !== null;

  const lines: string[] = [];
  if (v.gap && market)
    lines.push(
      `${money(scan.store_price, cur)} en rayon : ${v.gap.vsMedianPct === 0 ? 'au niveau de' : `${pct(v.gap.vsMedianPct)} par rapport à`} la médiane de ${market.count} offre${market.count > 1 ? 's' : ''} vérifiée${market.count > 1 ? 's' : ''}.`,
    );
  if (assessment?.quality) lines.push(`Qualité estimée par Lia : ${QUALITY_LABELS[assessment.quality.tier].toLowerCase()}, d’après ${assessment.quality.sources} source${assessment.quality.sources > 1 ? 's' : ''}.`);
  if (v.verdict === 'insufficient' && !busy && v.missing.length) lines.push(`Il manque : ${v.missing.join(', ')}.`);

  const unavailable: string[] = [];
  if (assessment) {
    if (!assessment.critics.length) unavailable.push('aucun avis de dégustateur trouvé pour ce millésime');
    if (!assessment.consumers.length) unavailable.push('aucune note de consommateurs avec nombre d’avis vérifiable');
    if (!assessment.vintage.rating) unavailable.push('qualité du millésime non établie par une source');
    if (!assessment.quality) unavailable.push(assessment.quality_note ?? 'qualité non notée');
  }
  if (market && !usable) unavailable.push('prix de marché non vérifié');

  return (
    <div className="stack">
      <section className={`card stack-sm scan-verdict ${TONE[v.verdict]}`} aria-live="polite" aria-labelledby="scan-verdict-title">
        <span className="small muted">Verdict de Lia</span>
        <h2 id="scan-verdict-title" style={{ margin: 0 }}>
          {busy && !assessment ? 'Analyse en cours…' : VERDICT_LABELS[v.verdict]}
        </h2>
        {lines.map((l) => (
          <p key={l} style={{ margin: 0 }}>
            {l}
          </p>
        ))}
        {v.score !== null && (
          <p className="small" style={{ margin: 0 }}>
            <strong>Estimation Lia : {String(v.score).replace('.', ',')}/10</strong> — note calculée par l’application selon une méthode fixe ; ce
            n’est pas une note de dégustateur.
          </p>
        )}
        {step === 'quality' && <InlineLoading text="Lia recherche des informations fiables sur ce vin… (jusqu’à une minute)" />}
        {step === 'price' && <InlineLoading text="Lia compare le prix avec des offres vérifiées…" />}
        {failure && <Notice tone="warn">{failure} Les informations déjà obtenues restent affichées.</Notice>}
        {!busy && ai.unavailable && (!assessment || !market) && <Notice tone="warn">{ai.unavailable} L’identification et le prix du rayon restent enregistrés.</Notice>}
        {!busy && !online && (!assessment || !market) && <Notice tone="warn">Pas de connexion : l’analyse reprendra quand le réseau reviendra.</Notice>}
        {!busy && !ai.unavailable && online && (failure || !assessment || !market) && (
          <Button size="sm" variant="secondary" onClick={() => void run({ quality: !assessment, price: !market || !usable })}>
            {failure ? 'Réessayer' : 'Lancer l’analyse'}
          </Button>
        )}
        <Advanced title="Comment le verdict est-il calculé ?">
          <ul className="small scan-method">
            {VERDICT_METHOD.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Advanced>
      </section>

      {(market || step === 'price') && (
        <section className="card stack-sm" aria-labelledby="scan-market-title">
          <h3 id="scan-market-title" style={{ margin: 0 }}>
            Prix comparés
          </h3>
          <dl className="scan-prices">
            <dt>Prix constaté en magasin</dt>
            <dd>{scan.price_confirmed ? money(scan.store_price, cur) : 'non confirmé'}</dd>
            {usable ? (
              <>
                <dt>Prix le plus bas vérifié</dt>
                <dd>{money(market!.low, cur)}</dd>
                <dt>Fourchette ({market!.count} offre{market!.count > 1 ? 's' : ''})</dt>
                <dd>
                  {money(market!.low, cur)} – {money(market!.high, cur)} · médiane {money(market!.median, cur)}
                </dd>
                {v.gap && (
                  <>
                    <dt>Écart avec la médiane</dt>
                    <dd>
                      {signed(v.gap.vsMedian, cur)} ({pct(v.gap.vsMedianPct)})
                    </dd>
                    <dt>Écart avec le plus bas</dt>
                    <dd>
                      {signed(v.gap.vsLow, cur)} ({pct(v.gap.vsLowPct)})
                    </dd>
                  </>
                )}
                <dt>Fiabilité</dt>
                <dd>{market!.reliability ? RELIABILITY[market!.reliability] : '—'}</dd>
              </>
            ) : market ? (
              <>
                <dt>Prix de marché</dt>
                <dd>
                  <strong>Prix de marché non vérifié</strong>
                  {market.reason ? ` — ${market.reason}` : ''}
                </dd>
              </>
            ) : null}
          </dl>
          {market && (
            <p className="small faint" style={{ margin: 0 }}>
              Relevé du {dateShort(market.checked_at)} · prix TTC d’une bouteille, livraison en sus quand elle est indiquée.
              {stale ? ' Ce relevé date : les prix ont pu changer.' : ''}
            </p>
          )}
          {market && stale && !busy && !ai.unavailable && online && (
            <Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={() => void run({ quality: false, price: true })}>
              Actualiser les prix
            </Button>
          )}
          {market && market.offers.length > 0 && (
            <Advanced title={`Voir les ${market.offers.length} offre${market.offers.length > 1 ? 's' : ''} et leurs sources`}>
              <ul className="scan-offers">
                {market.offers.map((o) => (
                  <li key={o.url}>
                    <a href={o.url} target="_blank" rel="noopener noreferrer">
                      {o.seller} <ExternalLink aria-hidden style={{ width: 14, height: 14, verticalAlign: '-2px' }} />
                    </a>{' '}
                    <strong>{money(o.price, o.currency)}</strong>
                    <span className="small muted">
                      {o.shipping !== null ? ` · livraison ${money(o.shipping, o.currency)}` : ''}
                      {o.min_quantity ? ` · par ${o.min_quantity}` : ''}
                      {o.country ? ` · ${o.country}` : ''}
                      {o.page_age ? ` · page du ${o.page_age}` : ''}
                      {o.currency !== cur ? ' · autre devise, non comparée' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </Advanced>
          )}
        </section>
      )}

      {assessment && (
        <section className="card">
          <Advanced title="Analyse détaillée">
            <Group title="Données confirmées par vous">
              <p className="small" style={{ margin: 0 }}>
                La fiche vérifiée ci-dessous et le prix du rayon {scan.price_confirmed ? `(${money(scan.store_price, cur)})` : '(non indiqué)'}.
              </p>
            </Group>
            {(assessment.critics.length > 0 || assessment.consumers.length > 0) && (
              <Group title="Avis et notes de sources identifiées">
                <ul className="scan-list">
                  {assessment.critics.map((c) => (
                    <li key={c.url + c.publication}>
                      <span className="strong">{c.publication}</span>
                      {c.reviewer ? ` (${c.reviewer})` : ''}
                      {c.score ? ` : ${c.score}` : ''}
                      {c.summary ? ` — ${c.summary}` : ''}
                      <SourceLinks urls={[c.url]} />
                    </li>
                  ))}
                  {assessment.consumers.map((c) => (
                    <li key={c.url + c.site}>
                      <span className="strong">{c.site}</span> : {String(c.average).replace('.', ',')}/{c.scale} ({c.count} avis)
                      <SourceLinks urls={[c.url]} />
                    </li>
                  ))}
                </ul>
              </Group>
            )}
            <Group title="Le producteur, l’appellation, le millésime">
              <ul className="scan-list">
                <Item label="Producteur et cuvée" value={assessment.producer} />
                <Item label="Appellation" value={assessment.appellation} />
                <Item
                  label={`Millésime${assessment.vintage.rating ? ` : ${VINTAGE_RATING[assessment.vintage.rating]}` : ''}`}
                  value={assessment.vintage}
                />
              </ul>
            </Group>
            <Group title="Estimations de Lia">
              <ul className="scan-list">
                {assessment.quality && (
                  <li>
                    <span className="strong">Niveau : {QUALITY_LABELS[assessment.quality.tier]}</span> <Origin kind="ai" />
                    {assessment.quality.reason ? (
                      <>
                        <br />
                        {assessment.quality.reason}
                      </>
                    ) : null}
                  </li>
                )}
                {assessment.aromatic_profile && (
                  <li>
                    <span className="strong">Profil aromatique</span> <Origin kind="ai" />
                    <br />
                    {assessment.aromatic_profile}
                  </li>
                )}
                {assessment.drink_window && (
                  <li>
                    <span className="strong">
                      À boire de {assessment.drink_window.from} à {assessment.drink_window.until}
                    </span>{' '}
                    <Origin kind={assessment.drink_window.origin === 'source' ? 'source' : 'ai'} />
                    {assessment.drink_window.source && <SourceLinks urls={[assessment.drink_window.source]} />}
                  </li>
                )}
                {assessment.pairings && (
                  <li>
                    <span className="strong">Accords</span> <Origin kind="ai" />
                    <br />
                    {assessment.pairings}
                  </li>
                )}
              </ul>
            </Group>
            {unavailable.length > 0 && (
              <Group title="Informations indisponibles">
                <ul className="scan-list small">
                  {unavailable.map((u) => (
                    <li key={u}>{u.charAt(0).toUpperCase() + u.slice(1)}.</li>
                  ))}
                </ul>
              </Group>
            )}
            {assessment.reason && <Notice tone="warn">{assessment.reason}</Notice>}
            {assessment.sources.length > 0 && (
              <Group title="Sources consultées">
                <ul className="scan-list small">
                  {assessment.sources.map((s) => (
                    <li key={s.url}>
                      <a href={s.url} target="_blank" rel="noopener noreferrer">
                        {s.title || host(s.url)}
                      </a>
                      {s.page_age ? ` · ${s.page_age}` : ''}
                    </li>
                  ))}
                </ul>
                <p className="small faint" style={{ margin: 0 }}>
                  Analyse du {dateShort(assessment.assessed_at)}.
                </p>
              </Group>
            )}
          </Advanced>
        </section>
      )}
    </div>
  );
}

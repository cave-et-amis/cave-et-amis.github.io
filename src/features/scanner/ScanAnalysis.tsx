/**
 * Lot 3b — verdict d'achat, prix du marché et analyse détaillée d'une bouteille vérifiée.
 * Les résultats arrivent l'un après l'autre (analyse du vin, puis prix) et sont enregistrés sur l'analyse ;
 * le verdict et la note sont recalculés ici selon la méthode documentée (src/domain/scan.ts).
 * Chaque information indique son origine : donnée confirmée, source identifiée, estimation de Lia ou indisponible.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ExternalLink, RefreshCw, Share2 } from 'lucide-react';
import { useStore } from '../../data/store';
import { dateShort, money, parseNumber } from '../../domain/format';
import { computeVerdict, priceIsFresh, QUALITY_LABELS, VERDICT_LABELS, VERDICT_METHOD, wineKey, type Verdict } from '../../domain/scan';
import { tasteFit } from '../../domain/taste';
import type { Scan, ScanAssessment, ScanMarket, SourcedText } from '../../domain/types';
import { wineTitle } from '../../domain/wine';
import { Advanced, Button, Field, InlineLoading, Notice, Origin, Pill, useToast } from '../../ui/kit';
import { SafeLink } from '../../ui/markdown';
import { useAiStatus } from '../cellar/LabelScan';

const TONE: Record<Verdict, string> = { excellent: 'success', good: 'success', fair: 'gold', poor: 'danger', insufficient: '' };
const RELIABILITY: Record<NonNullable<ScanMarket['reliability']>, string> = {
  haute: 'Haute : au moins trois offres vérifiées du même vin, dans la devise du magasin.',
  moyenne: 'Moyenne : une ou deux offres vérifiées seulement.',
  faible: 'Faible : offres trouvées seulement sur d’autres marchés ; elles ne servent pas au verdict.',
};
const VINTAGE_RATING: Record<string, string> = { exceptionnel: 'Exceptionnel', tres_bon: 'Très bon', bon: 'Bon', moyen: 'Moyen', difficile: 'Difficile' };

/** Budget habituel, gardé sur cet appareil seulement (commodité) ; celui de chaque analyse est enregistré avec elle. */
const BUDGET_KEY = 'cave.scan.budget';
function readBudget(): string {
  try {
    return localStorage.getItem(BUDGET_KEY) ?? '';
  } catch {
    return '';
  }
}
function rememberBudget(v: string) {
  try {
    if (v) localStorage.setItem(BUDGET_KEY, v);
    else localStorage.removeItem(BUDGET_KEY);
  } catch {
    // stockage indisponible (navigation privée) : sans gravité
  }
}
const FIT_TONE = { forte: 'success', moyenne: 'gold', faible: 'danger' } as const;

const pct = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)} %`;
const signed = (n: number, c: string) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n), c)}`;
export const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** Anneau de la note de Lia (0 à 10) ; décoratif, la note est aussi écrite en toutes lettres sous le verdict. */
function ScoreRing({ score }: { score: number }) {
  const r = 32;
  const c = 2 * Math.PI * r;
  const part = Math.max(0, Math.min(1, score / 10));
  return (
    <span className="score-ring" aria-hidden>
      <svg viewBox="0 0 76 76">
        <circle className="track" cx="38" cy="38" r={r} fill="none" strokeWidth="6" />
        <circle className="value" cx="38" cy="38" r={r} fill="none" strokeWidth="6" strokeDasharray={`${c * part} ${c}`} />
      </svg>
      <span className="score-ring-text">
        {String(score).replace('.', ',')}
        <small>/10</small>
      </span>
    </span>
  );
}

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

/** `onAssessment` : analyse en cours d’affichage (pour ce vin précis), reprise par l’ajout à la cave. */
export function ScanAnalysis({ scan, onAssessment }: { scan: Scan; onAssessment?: (a: ScanAssessment | null) => void }) {
  const { api, online, snapshot, userId } = useStore();
  const toast = useToast();
  const ai = useAiStatus();
  const key = wineKey(scan.wine);
  // Une analyse faite pour un autre vin (fiche modifiée depuis) n'est pas reprise.
  const [assessment, setAssessment] = useState<ScanAssessment | null>(scan.assessment?.key === key ? scan.assessment : null);
  const [market, setMarket] = useState<ScanMarket | null>(scan.market?.key === key ? scan.market : null);
  useEffect(() => onAssessment?.(assessment?.key === key ? assessment : null), [assessment, key, onAssessment]);
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

  const cur = scan.currency;
  const [budget, setBudget] = useState(() => (scan.budget !== null ? String(scan.budget).replace('.', ',') : readBudget()));
  const budgetValue = parseNumber(budget);
  const budgetOk = budgetValue !== null && budgetValue > 0 && budgetValue < 100000;
  // Vos goûts : calculés ici, à partir de vos seules données (rien n'est envoyé à l'IA).
  const fit = useMemo(
    () =>
      tasteFit({
        wine: scan.wine,
        me: userId,
        wines: snapshot.wines,
        lots: snapshot.lots,
        tastings: snapshot.tastings,
        wishlist: snapshot.wishlist,
        price: scan.price_confirmed ? scan.store_price : null,
        budget: budgetOk ? budgetValue : null,
        currency: cur,
      }),
    [scan, userId, snapshot, budgetOk, budgetValue, cur],
  );

  async function saveBudget() {
    const value = budgetOk ? Math.round(budgetValue! * 100) / 100 : null;
    if (!budget.trim() || budgetOk) rememberBudget(budget.trim());
    if (value === scan.budget || (budget.trim() && !budgetOk)) return;
    await api.updateScan(scan.id, { budget: value }).catch(() => undefined);
  }

  const v = computeVerdict({ storePrice: scan.store_price, priceConfirmed: scan.price_confirmed, currency: cur, assessment, market, fit: fit.points });
  const usable = market?.status === 'verified' && market.currency === cur;
  const stale = market ? !priceIsFresh(market.checked_at) : false;
  const busy = step !== null;

  const lines: string[] = [];
  if (v.gap && market)
    lines.push(
      `${money(scan.store_price, cur)} en rayon : ${v.gap.vsMedianPct === 0 ? 'au niveau de' : `${pct(v.gap.vsMedianPct)} par rapport à`} la médiane de ${market.count} offre${market.count > 1 ? 's' : ''} vérifiée${market.count > 1 ? 's' : ''}.`,
    );
  if (assessment?.quality) lines.push(`Qualité estimée par Lia : ${QUALITY_LABELS[assessment.quality.tier].toLowerCase()}, d’après ${assessment.quality.sources} source${assessment.quality.sources > 1 ? 's' : ''}.`);
  if (fit.level) lines.push(`Vos goûts : adéquation ${fit.level}.`);
  if (fit.overBudget !== null) lines.push(`Dépasse votre budget de ${money(fit.overBudget, cur)}.`);
  if (v.verdict === 'insufficient' && !busy && v.missing.length) lines.push(`Il manque : ${v.missing.join(', ')}.`);

  /**
   * Partage : un texte seulement (pas de lien vers l'analyse), sans vos goûts, votre cave ni votre budget.
   * Partage du téléphone s'il existe, sinon copie dans le presse-papiers.
   */
  async function share() {
    const w = scan.wine;
    const name = `${wineTitle({ name: w.name ?? 'Vin', vintage: w.vintage ?? null, non_vintage: w.non_vintage })}${w.cuvee ? ` · ${w.cuvee}` : ''}`;
    const text = [
      `${name} — ${VERDICT_LABELS[v.verdict]}`,
      scan.price_confirmed ? `Prix en rayon : ${money(scan.store_price, cur)}${scan.store_name ? ` (${scan.store_name})` : ''}` : null,
      usable ? `Marché : médiane ${money(market!.median, cur)} sur ${market!.count} offre${market!.count > 1 ? 's' : ''} vérifiée${market!.count > 1 ? 's' : ''} (relevé du ${dateShort(market!.checked_at)})` : 'Prix de marché non vérifié',
      assessment?.quality ? `Qualité estimée par Lia : ${QUALITY_LABELS[assessment.quality.tier].toLowerCase()}` : null,
      v.score !== null ? `Estimation Lia : ${String(v.score).replace('.', ',')}/10 (calculée par Cave & Amis, pas une note de dégustateur)` : null,
    ]
      .filter(Boolean)
      .join('\n');
    try {
      if (navigator.share) await navigator.share({ title: name, text });
      else {
        await navigator.clipboard.writeText(text);
        toast('Résultat copié : collez-le dans votre message.');
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') toast('Le partage n’a pas pu se faire sur cet appareil.', { tone: 'error' });
    }
  }

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
        <div className="scan-verdict-head">
          {v.score !== null && <ScoreRing score={v.score} />}
          <div>
            <span className="small muted">Verdict de Lia</span>
            <h2 id="scan-verdict-title" style={{ margin: 0 }}>
              {busy && !assessment ? 'Analyse en cours…' : VERDICT_LABELS[v.verdict]}
            </h2>
          </div>
        </div>
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
        {!busy && (assessment || market) && (
          <Button size="sm" variant="ghost" icon={<Share2 />} onClick={() => void share()}>
            Partager le résultat
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

      <section className="card stack-sm" aria-labelledby="scan-taste-title">
        <div className="between">
          <h3 id="scan-taste-title" style={{ margin: 0 }}>
            D’après votre cave et votre carnet
          </h3>
          {fit.level && <Pill tone={FIT_TONE[fit.level]}>Adéquation {fit.level}</Pill>}
        </div>
        {fit.notes.length > 0 ? (
          <ul className="scan-list">
            {fit.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            Rien de semblable dans votre cave ni dans votre carnet pour l’instant.
          </p>
        )}
        {fit.suggestion && <Notice tone="gold">{fit.suggestion}</Notice>}
        <Field label={`Votre budget pour cette bouteille (${cur === 'EUR' ? '€' : cur}, facultatif)`} error={budget.trim() && !budgetOk ? 'Indiquez un montant, par exemple 25.' : undefined}>
          <input className="input" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} onBlur={() => void saveBudget()} placeholder="25" />
        </Field>
        <p className="small faint" style={{ margin: 0 }}>
          Calculé sur cet appareil à partir de vos seules données (dégustations, cave, envies, favoris) : rien n’est envoyé à l’IA.
        </p>
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
                    {/* Nom du vendeur trouvé par la recherche : le domaine réel est affiché s'il ne le montre pas. */}
                    <SafeLink href={o.url} label={o.seller}>
                      {' '}
                      <ExternalLink aria-hidden style={{ width: 14, height: 14, verticalAlign: '-2px' }} />
                    </SafeLink>{' '}
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
                      <SafeLink href={s.url} label={s.title || host(s.url)} />
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

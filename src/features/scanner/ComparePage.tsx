/**
 * Lot 3d — comparer les bouteilles d'une même visite en magasin. Chaque bouteille est évaluée comme sur sa fiche
 * (verdict et note selon la méthode documentée, goûts calculés sur l'appareil) ; seules celles dont les informations
 * suffisent sont classées. Lia peut ensuite répondre à une question sur la sélection, avec les droits de la personne.
 */
import { useEffect, useMemo, useState } from 'react';
import { Camera, Sparkles, Trash2 } from 'lucide-react';
import { useStore } from '../../data/store';
import { usePhotoUrl } from '../../data/photos';
import { dateShort, money, parseNumber } from '../../domain/format';
import { toMessage } from '../../domain/errors';
import { computeVerdict, QUALITY_LABELS, VERDICT_LABELS, wineKey, type VerdictResult } from '../../domain/scan';
import { tasteFit, type TasteFit } from '../../domain/taste';
import type { Scan, ScanVisit } from '../../domain/types';
import { wineTitle } from '../../domain/wine';
import { Button, EmptyState, Field, InlineLoading, Notice, Pill, Thumb, useConfirm } from '../../ui/kit';
import { go } from '../../ui/router';

type Row = { scan: Scan; v: VerdictResult; fit: TasteFit; title: string };
const VERDICT_TONE = { excellent: 'success', good: 'success', fair: 'gold', poor: 'danger', insufficient: undefined } as const;

/** Question proposée à Lia pour la sélection. */
export function compareQuestion(count: number, occasion: string | null, budget: number | null) {
  return `Parmi ces ${count} bouteilles, laquelle me conseilles-tu pour ${occasion?.trim() || 'un dîner avec des amis'}${budget ? `, avec un budget maximal de ${money(budget)}` : ''} ?`;
}

export function ComparePage({ id }: { id: string }) {
  const { api, run, snapshot, userId } = useStore();
  const confirm = useConfirm();
  const [visit, setVisit] = useState<ScanVisit | null | undefined>(undefined);
  const [scans, setScans] = useState<Scan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [store, setStore] = useState('');
  const [budget, setBudget] = useState('');
  const [occasion, setOccasion] = useState('');

  useEffect(() => {
    let alive = true;
    Promise.all([api.visit(id), api.visitScans(id)])
      .then(([v, list]) => {
        if (!alive) return;
        setVisit(v);
        setScans(list);
        setStore(v?.store_name ?? '');
        setBudget(v?.budget != null ? String(v.budget).replace('.', ',') : '');
        setOccasion(v?.occasion ?? '');
      })
      .catch((e) => alive && setError(toMessage(e)));
    return () => {
      alive = false;
    };
  }, [api, id]);

  const budgetValue = parseNumber(budget);
  const budgetOk = budgetValue !== null && budgetValue > 0 && budgetValue < 100000;

  const rows = useMemo<Row[]>(
    () =>
      scans.map((scan) => {
        const key = wineKey(scan.wine);
        const assessment = scan.assessment?.key === key ? scan.assessment : null;
        const market = scan.market?.key === key ? scan.market : null;
        const price = scan.price_confirmed ? scan.store_price : null;
        const fit = tasteFit({
          wine: scan.wine,
          me: userId,
          wines: snapshot.wines,
          lots: snapshot.lots,
          tastings: snapshot.tastings,
          wishlist: snapshot.wishlist,
          price,
          budget: budgetOk ? budgetValue : scan.budget,
          currency: scan.currency,
        });
        const v = computeVerdict({ storePrice: scan.store_price, priceConfirmed: scan.price_confirmed, currency: scan.currency, assessment, market, fit: fit.points });
        const name = scan.wine.name ? wineTitle({ name: scan.wine.name, vintage: scan.wine.vintage ?? null, non_vintage: scan.wine.non_vintage }) : 'Vin à identifier';
        const title = scan.wine.cuvee ? `${name} · ${scan.wine.cuvee}` : name;
        return { scan, v, fit, title };
      }),
    [scans, snapshot, userId, budgetOk, budgetValue],
  );
  // Classement : seulement les bouteilles notées ; meilleure note d'abord, puis la moins chère.
  const ranked = rows.filter((r) => r.v.score !== null).sort((a, b) => b.v.score! - a.v.score! || (a.scan.store_price ?? 0) - (b.scan.store_price ?? 0));
  const others = rows.filter((r) => r.v.score === null);

  async function save() {
    if (!visit || (budget.trim() && !budgetOk)) return;
    const patch = { store_name: store.trim() || null, budget: budgetOk ? Math.round(budgetValue! * 100) / 100 : null, occasion: occasion.trim() || null };
    if (patch.store_name === visit.store_name && patch.budget === visit.budget && patch.occasion === visit.occasion) return;
    const res = await run(() => api.updateVisit(visit.id, patch), { silent: true });
    if (res.ok) setVisit(res.value);
  }

  async function removeVisit() {
    if (!visit) return;
    if (!(await confirm({ title: 'Supprimer cette comparaison ?', message: 'Les analyses des bouteilles restent dans votre historique.', confirmLabel: 'Supprimer', danger: true }))) return;
    const res = await run(() => api.deleteVisit(visit.id), { success: 'Comparaison supprimée' });
    if (res.ok) go('/scanner/historique', { replace: true });
  }

  function ask() {
    const q = compareQuestion(rows.length, occasion || null, budgetOk ? budgetValue : null);
    go(`/assistant?visite=${id}&q=${encodeURIComponent(q)}`);
  }

  if (error) return <Notice tone="warn">{error}</Notice>;
  if (visit === undefined) return <InlineLoading />;
  if (visit === null)
    return (
      <EmptyState icon="🔎" title="Comparaison introuvable" action={<Button onClick={() => go('/scanner')}>Scanner une bouteille</Button>}>
        Elle a peut-être été supprimée.
      </EmptyState>
    );

  return (
    <div className="stack">
      <section className="hero">
        <h2>
          {rows.length} bouteille{rows.length > 1 ? 's' : ''}
          {visit.store_name ? ` · ${visit.store_name}` : ''}
        </h2>
        <p>Comparaison du {dateShort(visit.created_at)} — seules les bouteilles assez documentées sont classées.</p>
      </section>

      <div className="card stack-sm">
        <div className="field-row">
          <Field label="Magasin (facultatif)">
            <input className="input" value={store} onChange={(e) => setStore(e.target.value)} onBlur={() => void save()} maxLength={80} placeholder="Caviste, supermarché…" />
          </Field>
          <Field label="Budget par bouteille (€)" error={budget.trim() && !budgetOk ? 'Indiquez un montant, par exemple 25.' : undefined}>
            <input className="input" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} onBlur={() => void save()} placeholder="25" />
          </Field>
        </div>
        <Field label="Occasion (facultatif)">
          <input className="input" value={occasion} onChange={(e) => setOccasion(e.target.value)} onBlur={() => void save()} maxLength={120} placeholder="un dîner avec des amis" />
        </Field>
      </div>

      {ranked.length > 0 && (
        <section aria-labelledby="cmp-ranked">
          <h3 id="cmp-ranked" className="section-title">
            Classement
          </h3>
          <ol className="cmp-list">
            {ranked.map((r, i) => (
              <CompareCard key={r.scan.id} row={r} rank={i + 1} budget={budgetOk ? budgetValue : null} />
            ))}
          </ol>
        </section>
      )}
      {others.length > 0 && (
        <section aria-labelledby="cmp-others">
          <h3 id="cmp-others" className="section-title">
            Non classées : informations insuffisantes
          </h3>
          <ul className="cmp-list">
            {others.map((r) => (
              <CompareCard key={r.scan.id} row={r} budget={budgetOk ? budgetValue : null} />
            ))}
          </ul>
        </section>
      )}
      {rows.length === 0 && <Notice tone="info">Aucune bouteille dans cette comparaison pour l’instant.</Notice>}

      <div className="stack-sm">
        <Button size="lg" icon={<Camera />} onClick={() => go(`/scanner?visite=${visit.id}`)}>
          Ajouter une bouteille
        </Button>
        {rows.length >= 2 && (
          <Button variant="secondary" icon={<Sparkles />} onClick={ask}>
            Demander à Lia laquelle choisir
          </Button>
        )}
        <Button variant="ghost" icon={<Trash2 />} onClick={() => void removeVisit()}>
          Supprimer cette comparaison
        </Button>
      </div>
    </div>
  );
}

function CompareCard({ row, rank, budget }: { row: Row; rank?: number; budget: number | null }) {
  const { api } = useStore();
  const { scan, v, fit, title } = row;
  const front = scan.photos.find((p) => p.role === 'front') ?? scan.photos[0];
  const url = usePhotoUrl(api, front?.path);
  const tier = scan.assessment?.quality?.tier;
  const price = scan.price_confirmed ? scan.store_price : null;
  return (
    <li className="cmp-card">
      <a href={`#/scanner/${scan.id}`} className="cmp-main">
        {rank && (
          <span className="cmp-rank" aria-label={`Rang ${rank}`}>
            {rank}
          </span>
        )}
        <Thumb url={url} color={scan.wine.color} alt="" />
        <span className="row-main">
          <span className="row-title" style={{ whiteSpace: 'normal' }}>
            {title}
          </span>
          <span className="row-sub">
            {price !== null ? money(price, scan.currency) : 'prix non confirmé'}
            {budget !== null && price !== null && price > budget ? ' · au-dessus du budget' : ''}
          </span>
        </span>
      </a>
      <dl className="cmp-facts">
        <dt>Millésime</dt>
        <dd>{scan.wine.vintage ?? (scan.wine.non_vintage ? 'sans' : 'inconnu')}</dd>
        <dt>Qualité</dt>
        <dd>{tier ? `${QUALITY_LABELS[tier]} (estimation)` : 'non établie'}</dd>
        <dt>Rapport qualité-prix</dt>
        <dd>{v.gap ? `${v.gap.vsMedianPct > 0 ? '+' : v.gap.vsMedianPct < 0 ? '−' : ''}${Math.abs(v.gap.vsMedianPct)} % / marché` : 'prix de marché non vérifié'}</dd>
        <dt>Vos goûts</dt>
        <dd>{fit.level ? `adéquation ${fit.level}` : 'non évalués'}</dd>
        <dt>Recommandation</dt>
        <dd>
          <Pill tone={VERDICT_TONE[v.verdict]}>{VERDICT_LABELS[v.verdict]}</Pill>
          {v.score !== null ? ` ${String(v.score).replace('.', ',')}/10` : ''}
        </dd>
      </dl>
      {v.score === null && (scan.status !== 'confirmed' || !scan.assessment) && (
        <p className="small muted" style={{ margin: 0 }}>
          {scan.status !== 'confirmed' ? 'Bouteille à vérifier : ouvrez-la pour confirmer le vin et le prix.' : 'Analyse non faite : ouvrez la bouteille pour la lancer.'}
        </p>
      )}
    </li>
  );
}

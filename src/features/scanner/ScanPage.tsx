/**
 * Une analyse du scanner : la personne vérifie ce que Lia a lu (champs incertains signalés, inconnus laissés vides),
 * choisit parmi les vins possibles si Lia hésite, et confirme le prix du rayon. Rien n'est ajouté à la cave :
 * « Ajouter à ma cave » ouvre le formulaire habituel (quantité, prix payé, cave, emplacement) à confirmer.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { BookmarkPlus, Camera, Columns3, Heart, Pencil, Sparkles, Trash2, Wine as WineIcon } from 'lucide-react';
import { useStore } from '../../data/store';
import { usePhotoUrl } from '../../data/photos';
import { normalizeBarcode } from '../../domain/barcode';
import { dateShort, money, parseNumber } from '../../domain/format';
import { toMessage } from '../../domain/errors';
import type { Color, Scan, ScanCandidate, ScanWine } from '../../domain/types';
import { colorLabel, volumeLabel, VOLUMES, wineSubtitle, wineTitle } from '../../domain/wine';
import { useActions } from '../../ui/Shell';
import { Button, Check, EmptyState, Field, InlineLoading, Notice, Pill, useConfirm } from '../../ui/kit';
import { go } from '../../ui/router';
import { ColorChips } from '../cellar/fields';
import { ROLES } from './ScannerPage';
import { host, ScanAnalysis } from './ScanAnalysis';

export const ISSUE_TEXT: Record<string, string> = {
  blurry: 'La photo est floue : si un champ vous semble faux, reprenez-la en tenant le téléphone immobile.',
  glare: 'Un reflet gêne la lecture : inclinez un peu la bouteille ou éloignez-vous de l’éclairage.',
  cropped: 'L’étiquette est coupée : reculez un peu pour la prendre en entier.',
  dark: 'La photo est trop sombre : rapprochez-vous de la lumière.',
  vintage_unreadable: 'Le millésime est illisible : indiquez-le si vous le voyez sur la bouteille.',
  price_unreadable: 'Le prix n’a pas pu être lu : saisissez celui affiché en rayon.',
  price_tag_mismatch: 'L’étiquette de prix semble concerner un autre vin : vérifiez qu’elle correspond bien à cette bouteille.',
  different_bottles: 'Les photos semblent montrer des bouteilles différentes : vérifiez les informations.',
};

type Form = {
  name: string;
  domaine: string;
  producer: string;
  cuvee: string;
  appellation: string;
  region: string;
  country: string;
  color: Color | null;
  vintage: string;
  non_vintage: boolean;
  volume_ml: number;
  alcohol: string;
  grapes: string;
  barcode: string;
  price: string;
  store: string;
};

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function toForm(scan: Scan): Form {
  const w = scan.wine;
  return {
    name: s(w.name),
    domaine: s(w.domaine),
    producer: s(w.producer),
    cuvee: s(w.cuvee),
    appellation: s(w.appellation),
    region: s(w.region),
    country: s(w.country),
    color: (w.color as Color) ?? null,
    vintage: s(w.vintage),
    non_vintage: Boolean(w.non_vintage),
    volume_ml: w.volume_ml ?? 750,
    alcohol: w.alcohol ? String(w.alcohol).replace('.', ',') : '',
    grapes: (w.grapes ?? []).join(', '),
    barcode: s(scan.barcode),
    price: scan.store_price !== null ? String(scan.store_price).replace('.', ',') : '',
    store: s(scan.store_name),
  };
}

const nul = (v: string) => (v.trim() ? v.trim() : null);

function toWine(f: Form): ScanWine {
  const vintage = parseNumber(f.vintage);
  const alcohol = parseNumber(f.alcohol);
  return {
    name: f.name.trim(),
    domaine: nul(f.domaine),
    producer: nul(f.producer),
    cuvee: nul(f.cuvee),
    appellation: nul(f.appellation),
    region: nul(f.region),
    country: nul(f.country),
    color: f.color,
    vintage: f.non_vintage ? null : vintage && Number.isInteger(vintage) ? vintage : null,
    non_vintage: f.non_vintage,
    volume_ml: f.volume_ml,
    alcohol: alcohol && alcohol >= 3 && alcohol <= 25 ? Math.round(alcohol * 10) / 10 : null,
    grapes: f.grapes
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean)
      .slice(0, 12),
  };
}

function candidateTitle(c: ScanCandidate) {
  return [c.name, c.cuvee, c.vintage].filter(Boolean).join(' · ');
}

export function ScanPhotos({ scan }: { scan: Scan }) {
  return (
    <div className="photo-pair scan-photos">
      {scan.photos.map((p) => (
        <ScanPhoto key={p.path} path={p.path} alt={ROLES.find((r) => r.role === p.role)?.title ?? 'Photo'} />
      ))}
    </div>
  );
}

function ScanPhoto({ path, alt }: { path: string; alt: string }) {
  const { api } = useStore();
  const url = usePhotoUrl(api, path);
  return url ? <img className="photo-preview" src={url} alt={alt} /> : <span className="photo-preview" aria-hidden />;
}

export function ScanPage({ id }: { id: string }) {
  const { api } = useStore();
  const [scan, setScan] = useState<Scan | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let alive = true;
    setScan(undefined);
    api
      .scan(id)
      .then((s) => alive && setScan(s))
      .catch((e) => alive && setError(toMessage(e)));
    return () => {
      alive = false;
    };
  }, [api, id]);

  if (error) return <Notice tone="warn">{error}</Notice>;
  if (scan === undefined) return <InlineLoading />;
  if (scan === null)
    return (
      <EmptyState icon="🔎" title="Analyse introuvable" action={<Button onClick={() => go('/scanner')}>Scanner une bouteille</Button>}>
        Elle a peut-être été supprimée, ou sa durée de conservation est passée.
      </EmptyState>
    );
  if (scan.status === 'confirmed' && !editing) return <ScanSummary scan={scan} onEdit={() => setEditing(true)} />;
  return (
    <ScanReview
      key={scan.updated_at}
      scan={scan}
      onSaved={(s) => {
        setScan(s);
        setEditing(false);
      }}
    />
  );
}

function ScanReview({ scan, onSaved }: { scan: Scan; onSaved: (s: Scan) => void }) {
  const { api, run } = useStore();
  const confirm = useConfirm();
  const [reading, setReading] = useState(scan.result);
  const manual = !reading.fields;
  const [f, setF] = useState<Form>(() => toForm(scan));
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const candidates = reading.candidates ?? [];
  const [chosen, setChosen] = useState(scan.status === 'confirmed' || candidates.length < 2);
  const [busy, setBusy] = useState(false);
  const uncertain = new Set(reading.uncertain ?? []);
  const set = (patch: Partial<Form>) => {
    setF((x) => ({ ...x, ...patch }));
    setTouched((t) => new Set([...t, ...Object.keys(patch)]));
  };
  const cls = (k: string) => `input${uncertain.has(k) && !touched.has(k) ? ' uncertain' : ''}`;
  const price = parseNumber(f.price);
  const priceError = f.price.trim() && !(price !== null && price > 0 && price < 100000) ? 'Indiquez un prix valable, par exemple 12,90.' : undefined;
  const barcodeError = f.barcode.trim() && !normalizeBarcode(f.barcode) ? 'Ce code ne semble pas complet.' : undefined;
  const tag = reading.price_tag;

  function choose(c: ScanCandidate | null) {
    if (c) set({ name: c.name, producer: c.producer ?? '', cuvee: c.cuvee ?? '', appellation: c.appellation ?? '', vintage: s(c.vintage) });
    setChosen(true);
  }

  async function restart() {
    if (!(await confirm({ title: 'Recommencer ?', message: 'Cette analyse et ses photos seront supprimées.', confirmLabel: 'Recommencer', danger: true }))) return;
    const res = await run(() => api.deleteScans([scan]));
    if (res.ok) go('/scanner', { replace: true });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.name.trim() || priceError || barcodeError) return;
    setBusy(true);
    const res = await run(() =>
      api.updateScan(scan.id, {
        status: 'confirmed',
        wine: toWine(f),
        barcode: normalizeBarcode(f.barcode),
        store_price: price,
        store_name: nul(f.store),
        price_confirmed: price !== null,
      }),
    );
    setBusy(false);
    if (res.ok) onSaved(res.value);
  }

  if (reading.is_wine_label === false)
    return (
      <div className="stack">
        <ScanPhotos scan={scan} />
        <Notice tone="warn">Ces photos ne semblent pas montrer une étiquette de vin. Reprenez-les de plus près, ou remplissez la fiche à la main.</Notice>
        <Button icon={<Camera />} onClick={() => void restart()}>
          Reprendre les photos
        </Button>
        <Button variant="secondary" onClick={() => setReading({})}>
          Remplir à la main
        </Button>
      </div>
    );

  return (
    <form className="form stack" onSubmit={submit}>
      <ScanPhotos scan={scan} />
      {manual ? (
        <Notice tone="info">Remplissez la fiche à partir des photos : rien n’est enregistré dans votre cave.</Notice>
      ) : (
        <Notice tone="info">
          Vérifiez ce que Lia a lu : les champs <span className="uncertain-sample">surlignés</span> sont incertains, ceux qu’elle n’a pas pu lire restent vides.
          {scan.from_cache ? ' (Lecture déjà faite pour ces photos : rien n’a été décompté.)' : ''}
        </Notice>
      )}
      {(reading.photo_issues ?? []).map((i) => (ISSUE_TEXT[i] ? <Notice key={i} tone="warn">{ISSUE_TEXT[i]}</Notice> : null))}
      {reading.notes && <p className="small muted">Remarque de Lia : {reading.notes}</p>}

      {!chosen && (
        <div className="card gold stack-sm" role="group" aria-labelledby="scan-cands">
          <strong id="scan-cands">Plusieurs vins sont possibles : lequel avez-vous en main ?</strong>
          {candidates.map((c) => (
            <button key={candidateTitle(c)} type="button" className="row" onClick={() => choose(c)}>
              <span className="row-main">
                <span className="row-title" style={{ whiteSpace: 'normal' }}>
                  {candidateTitle(c)}
                </span>
                <span className="row-sub" style={{ whiteSpace: 'normal' }}>
                  {[c.producer, c.appellation, c.reason].filter(Boolean).join(' — ')}
                </span>
              </span>
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => choose(null)}>
            Aucun de ceux-là : je complète moi-même
          </Button>
        </div>
      )}

      <Field label="Vin">
        <input className={cls('name')} value={f.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} required placeholder="Château, domaine ou nom du vin" />
      </Field>
      <div className="field-row">
        <Field label="Domaine ou château">
          <input className={cls('domaine')} value={f.domaine} onChange={(e) => set({ domaine: e.target.value })} maxLength={120} />
        </Field>
        <Field label="Producteur">
          <input className={cls('producer')} value={f.producer} onChange={(e) => set({ producer: e.target.value })} maxLength={120} />
        </Field>
      </div>
      <div className="field-row">
        <Field label="Cuvée">
          <input className={cls('cuvee')} value={f.cuvee} onChange={(e) => set({ cuvee: e.target.value })} maxLength={120} />
        </Field>
        <Field label="Millésime" hint={!f.vintage && !f.non_vintage ? 'Inconnu : indiquez-le si vous le lisez.' : undefined}>
          <input className={cls('vintage')} inputMode="numeric" value={f.vintage} onChange={(e) => set({ vintage: e.target.value.replace(/\D/g, '').slice(0, 4) })} disabled={f.non_vintage} />
        </Field>
      </div>
      <Check checked={f.non_vintage} onChange={(v) => set({ non_vintage: v, vintage: v ? '' : f.vintage })} label="Sans millésime" />
      <div className="field-row">
        <Field label="Appellation">
          <input className={cls('appellation')} value={f.appellation} onChange={(e) => set({ appellation: e.target.value })} maxLength={120} />
        </Field>
        <Field label="Région">
          <input className={cls('region')} value={f.region} onChange={(e) => set({ region: e.target.value })} maxLength={80} />
        </Field>
      </div>
      <Field label="Couleur">
        <ColorChips value={f.color} onChange={(c) => set({ color: c })} />
      </Field>
      <div className="field-row">
        <Field label="Contenance">
          <select className={cls('volume_ml')} value={f.volume_ml} onChange={(e) => set({ volume_ml: Number(e.target.value) })}>
            {(VOLUMES.some((v) => v.value === f.volume_ml) ? VOLUMES : [...VOLUMES, { value: f.volume_ml, label: volumeLabel(f.volume_ml) }]).map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Degré (% vol.)">
          <input className={cls('alcohol')} inputMode="decimal" value={f.alcohol} onChange={(e) => set({ alcohol: e.target.value })} placeholder="13,5" />
        </Field>
      </div>
      <div className="field-row">
        <Field label="Cépages">
          <input className={cls('grapes')} value={f.grapes} onChange={(e) => set({ grapes: e.target.value })} placeholder="Séparés par des virgules" />
        </Field>
        <Field label="Code-barres" error={barcodeError}>
          <input className={cls('barcode')} inputMode="numeric" value={f.barcode} onChange={(e) => set({ barcode: e.target.value.replace(/[^\d\s]/g, '').slice(0, 18) })} />
        </Field>
      </div>

      <div className="card stack-sm scan-price">
        <strong>Prix en rayon</strong>
        <div className="field-row">
          <Field
            label={`Prix d’une bouteille (${scan.currency === 'EUR' ? '€' : scan.currency}, TTC)`}
            error={priceError}
            hint={
              tag?.price != null
                ? `Lu sur l’étiquette de prix : ${money(tag.price, tag.currency)}. Corrigez-le si besoin.`
                : 'Saisissez le prix affiché ; laissez vide s’il n’y en a pas.'
            }
          >
            <input className={`input${tag?.price != null && !touched.has('price') ? ' uncertain' : ''}`} inputMode="decimal" value={f.price} onChange={(e) => set({ price: e.target.value })} placeholder="12,90" />
          </Field>
          <Field label="Magasin (facultatif)">
            <input className="input" value={f.store} onChange={(e) => set({ store: e.target.value })} maxLength={80} placeholder="Caviste, supermarché…" />
          </Field>
        </div>
        {tag?.label && <span className="small muted">Produit sur l’étiquette de prix : « {tag.label} »</span>}
        {tag?.conditions && <Notice tone="gold">Conditions lues : {tag.conditions}. Le prix retenu est celui d’une bouteille, sans condition.</Notice>}
      </div>

      <div className="stack-sm">
        <Button type="submit" size="lg" block loading={busy} disabled={!f.name.trim() || !chosen}>
          {price !== null ? 'Confirmer le vin et le prix' : 'Confirmer le vin (sans prix)'}
        </Button>
        <Button variant="ghost" icon={<Camera />} onClick={() => void restart()}>
          Reprendre les photos
        </Button>
      </div>
    </form>
  );
}

function ScanSummary({ scan, onEdit }: { scan: Scan; onEdit: () => void }) {
  const { api, run, userId } = useStore();
  const [copying, setCopying] = useState(false);
  const actions = useActions();
  const confirm = useConfirm();
  const w = scan.wine;
  const title = wineTitle({ name: w.name ?? 'Vin', vintage: w.vintage ?? null, non_vintage: w.non_vintage });
  const sub = [w.cuvee, wineSubtitle(w)].filter(Boolean).join(' · ');
  const details = [
    w.color ? colorLabel(w.color) : null,
    w.volume_ml ? volumeLabel(w.volume_ml) : null,
    w.alcohol ? `${String(w.alcohol).replace('.', ',')} % vol.` : null,
    w.grapes?.length ? w.grapes.join(', ') : null,
  ].filter(Boolean);

  /** Lot 3d : rattache l'analyse à une comparaison (créée au besoin). */
  function ensureVisit() {
    return run(async () => {
      if (scan.visit_id) return scan.visit_id;
      const visit = await api.createVisit({ store_name: scan.store_name, budget: scan.budget });
      await api.updateScan(scan.id, { visit_id: visit.id });
      return visit.id;
    });
  }

  async function compare() {
    const res = await ensureVisit();
    if (res.ok) go(`/scanner?visite=${res.value}`);
  }

  /** Question à Lia sur cette bouteille : Lia relit l'analyse (avec vos droits) par sa visite. */
  async function askLia() {
    const res = await ensureVisit();
    if (res.ok) go(`/assistant?visite=${res.value}&q=${encodeURIComponent(`Que penses-tu de ce vin${scan.price_confirmed ? ' à ce prix' : ''} ?`)}`);
  }

  /** Ajout à la cave : la photo d'étiquette est copiée (les photos du scanner sont supprimées après leur conservation). */
  async function addToCellar() {
    const { volume_ml, alcohol: _alcohol, ...wine } = w;
    const front = scan.photos.find((p) => p.role === 'front') ?? scan.photos.find((p) => p.role === 'back');
    let photo: string | null = null;
    if (front) {
      setCopying(true);
      photo = await api.copyPhoto(userId, front.path).catch(() => null);
      setCopying(false);
    }
    // Fenêtre de garde et accords de l'analyse : repris dans la fiche comme conseils de l'IA (modifiables avant l'ajout).
    const a = scan.assessment;
    const dw = a?.drink_window ?? null;
    const advice = {
      ...(dw ? { drink_from: dw.from, drink_until: dw.until, window_note: dw.source ? `D’après ${host(dw.source)}` : 'Estimation de Lia' } : {}),
      ...(a?.pairings ? { pairings: a.pairings } : {}),
    };
    actions.newWine({
      wine: { ...wine, ...advice, name: w.name ?? '', barcode: scan.barcode, label_photo: photo },
      aiAdvice: Object.keys(advice).length > 0,
      volume_ml: volume_ml ?? null,
      purchase: { price: scan.price_confirmed ? scan.store_price : null, place: scan.store_name },
      uploaded: photo ? [photo] : [],
    });
  }

  async function remove() {
    if (!(await confirm({ title: 'Supprimer cette analyse ?', message: 'Elle disparaît de votre historique, avec ses photos.', confirmLabel: 'Supprimer', danger: true }))) return;
    const res = await run(() => api.deleteScans([scan]), { success: 'Analyse supprimée' });
    if (res.ok) go('/scanner/historique', { replace: true });
  }

  return (
    <div className="stack">
      <ScanAnalysis key={scan.updated_at} scan={scan} />
      <div className="card stack-sm">
        <div className="between">
          <h2 style={{ margin: 0 }}>{title}</h2>
          <Pill tone="success">Vérifié</Pill>
        </div>
        {sub && <p className="muted" style={{ margin: 0 }}>{sub}</p>}
        {details.length > 0 && <p className="small" style={{ margin: 0 }}>{details.join(' · ')}</p>}
        <p style={{ margin: 0 }}>
          <span className="muted">Prix en rayon : </span>
          {scan.price_confirmed ? <strong>{money(scan.store_price, scan.currency)}</strong> : <span className="muted">non indiqué</span>}
          {scan.store_name ? <span className="muted"> · {scan.store_name}</span> : null}
        </p>
        <p className="small faint" style={{ margin: 0 }}>
          Analyse du {dateShort(scan.created_at)} · conservée jusqu’au {dateShort(scan.expires_at)}
        </p>
      </div>
      <div className="stack-sm">
        <Button
          icon={<Heart />}
          variant="secondary"
          onClick={() =>
            actions.newWish({
              wine_name: w.name ?? '',
              producer: w.producer ?? w.domaine ?? null,
              vintage: w.vintage ?? null,
              color: w.color ?? null,
              region: w.region ?? null,
              appellation: w.appellation ?? null,
              note: scan.price_confirmed ? `Vu à ${money(scan.store_price, scan.currency)}${scan.store_name ? ` (${scan.store_name})` : ''} le ${dateShort(scan.created_at)}` : null,
            })
          }
        >
          Ajouter à mes envies
        </Button>
        <Button
          icon={<BookmarkPlus />}
          variant="secondary"
          loading={copying}
          onClick={() => void addToCellar()}
        >
          Ajouter à ma cave
        </Button>
        <Button variant="secondary" icon={<Sparkles />} onClick={() => void askLia()}>
          Poser une question à Lia
        </Button>
        <Button variant="secondary" icon={<Columns3 />} onClick={() => void compare()}>
          Comparer avec une autre bouteille
        </Button>
        {scan.visit_id && (
          <Button variant="ghost" onClick={() => go(`/scanner/visite/${scan.visit_id}`)}>
            Voir la comparaison
          </Button>
        )}
        <Button variant="ghost" icon={<Pencil />} onClick={onEdit}>
          Modifier
        </Button>
        <Button variant="ghost" icon={<WineIcon />} onClick={() => go(scan.visit_id ? `/scanner?visite=${scan.visit_id}` : '/scanner')}>
          Scanner une autre bouteille
        </Button>
        <Button variant="ghost" icon={<Trash2 />} onClick={() => void remove()}>
          Supprimer cette analyse
        </Button>
      </div>
      <ScanPhotos scan={scan} />
    </div>
  );
}

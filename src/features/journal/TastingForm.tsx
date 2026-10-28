/**
 * Dégustation : un vin goûté n'importe où, même absent de la cave. Le stock ne bouge QUE si la personne
 * coche « la bouteille vient de ma cave » et choisit le lot. Notes privées par défaut.
 */
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { newId } from '../../data/api';
import { useStore } from '../../data/store';
import { parseNumber, todayIso } from '../../domain/format';
import type { Color, EventWine, Lot, Occasion, PriceKind, Tasting } from '../../domain/types';
import { fold, OCCASIONS, PRICE_KINDS, vintageLabel, volumeLabel } from '../../domain/wine';
import { Advanced, Button, Check, Chips, Field, Notice, Sheet, Stars } from '../../ui/kit';
import { go } from '../../ui/router';
import { ColorChips, PhotoField } from '../cellar/fields';

export type TastingPrefill = {
  wine_id?: string | null;
  wine_name?: string;
  producer?: string | null;
  vintage?: number | null;
  non_vintage?: boolean;
  color?: Color | null;
  region?: string | null;
  appellation?: string | null;
  grapes?: string[];
  lots?: Lot[];
  event_id?: string;
  eventWines?: EventWine[];
  /** Partager la note avec ce groupe (ouverte depuis la page du groupe ou une soirée du groupe). */
  group_id?: string | null;
  occasion?: Occasion;
  place?: string;
  tasted_on?: string;
  rating?: number | null;
  comment?: string | null;
  robe?: string | null;
  nez?: string | null;
  bouche?: string | null;
};

const ACIDITE = [
  { value: 'faible', label: 'Faible' },
  { value: 'moyenne', label: 'Moyenne' },
  { value: 'vive', label: 'Vive' },
] as const;
const TANINS = [
  { value: 'aucun', label: 'Aucun' },
  { value: 'souples', label: 'Souples' },
  { value: 'presents', label: 'Présents' },
  { value: 'marques', label: 'Marqués' },
] as const;
const LEVELS = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }));
const PROFILE = [
  { key: 'fruite', label: 'Fruité' },
  { key: 'puissance', label: 'Puissance' },
  { key: 'boise', label: 'Boisé' },
  { key: 'mineralite', label: 'Minéralité' },
] as const;
type ProfileKey = (typeof PROFILE)[number]['key'];
const LONGUEUR = [
  { value: 'courte', label: 'Courte' },
  { value: 'moyenne', label: 'Moyenne' },
  { value: 'longue', label: 'Longue' },
] as const;

export function TastingFormSheet({ prefill, tasting, onClose }: { prefill?: TastingPrefill; tasting?: Tasting; onClose: () => void }) {
  const { api, run, snapshot, me } = useStore();
  const editing = Boolean(tasting);
  const src = tasting ?? prefill ?? {};
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  const [eventWineId, setEventWineId] = useState<string>(tasting?.event_wine_id ?? '');
  const [wineId, setWineId] = useState<string | null>(src.wine_id ?? null);
  const [name, setName] = useState(s(src.wine_name));
  const [vintage, setVintage] = useState(s(src.vintage));
  const [nonVintage, setNonVintage] = useState(Boolean(src.non_vintage));
  const [color, setColor] = useState<Color | null>((src.color as Color) ?? null);
  const [producer, setProducer] = useState(s(src.producer));
  const [region, setRegion] = useState(s(src.region));
  const [appellation, setAppellation] = useState(s(src.appellation));
  const [grapes, setGrapes] = useState((src.grapes ?? []).join(', '));
  const [date, setDate] = useState(tasting?.tasted_on ?? prefill?.tasted_on ?? todayIso());
  const [place, setPlace] = useState(s(tasting?.place ?? prefill?.place));
  const [occasion, setOccasion] = useState<Occasion | null>(tasting?.occasion ?? prefill?.occasion ?? null);
  const [rating, setRating] = useState<number | null>(tasting?.rating ?? prefill?.rating ?? null);
  const [comment, setComment] = useState(s(tasting?.comment ?? prefill?.comment));
  const [robe, setRobe] = useState(s(tasting?.robe ?? prefill?.robe));
  const [nez, setNez] = useState(s(tasting?.nez ?? prefill?.nez));
  const [bouche, setBouche] = useState(s(tasting?.bouche ?? prefill?.bouche));
  const [acidite, setAcidite] = useState<Tasting['acidite']>(tasting?.acidite ?? null);
  const [tanins, setTanins] = useState<Tasting['tanins']>(tasting?.tanins ?? null);
  const [longueur, setLongueur] = useState<Tasting['longueur']>(tasting?.longueur ?? null);
  const [profile, setProfile] = useState<Record<ProfileKey, number | null>>({
    fruite: tasting?.fruite ?? null,
    puissance: tasting?.puissance ?? null,
    boise: tasting?.boise ?? null,
    mineralite: tasting?.mineralite ?? null,
  });
  const [dish, setDish] = useState(s(tasting?.dish));
  const [price, setPrice] = useState(s(tasting?.price_paid).replace('.', ','));
  const [priceKind, setPriceKind] = useState<PriceKind | ''>(tasting?.price_kind ?? '');
  const [rebuy, setRebuy] = useState(tasting?.rebuy ?? false);
  const [alsoWish, setAlsoWish] = useState(false);
  const [favorite, setFavorite] = useState(tasting?.favorite ?? false);
  const [photo, setPhoto] = useState<string | null>(tasting?.photo ?? null);
  const [share, setShare] = useState(tasting?.share_with_event ?? false);
  // Partage avec un groupe : celui de la page d'origine, ou celui de la soirée.
  const myGroups = snapshot.groups.filter((g) => g.my_status === 'active');
  const [groupId, setGroupId] = useState<string>(
    () =>
      tasting?.group_id ??
      prefill?.group_id ??
      snapshot.events.find((e) => e.id === (tasting?.event_id ?? prefill?.event_id))?.group_id ??
      '',
  );
  const [fromCellar, setFromCellar] = useState(false);
  const [lotId, setLotId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(newId());
  const uploaded = useRef<string[]>([]);
  const saved = useRef(false);
  const eventId = tasting?.event_id ?? prefill?.event_id ?? null;
  const eventWines = prefill?.eventWines ?? [];

  // Vins de ma cave correspondant au nom saisi (pour relier la dégustation, et éventuellement sortir la bouteille du stock).
  const matches = useMemo(() => {
    if (wineId || editing || !name.trim() || eventId) return [];
    return snapshot.wines.filter((w) => fold(w.name).includes(fold(name)) || fold(name).includes(fold(w.name))).slice(0, 4);
  }, [wineId, editing, name, eventId, snapshot.wines]);
  const cellarLots = (wineId ? snapshot.lots.filter((l) => l.wine_id === wineId && l.quantity - l.reserved > 0) : []) as Lot[];

  function pickEventWine(id: string) {
    setEventWineId(id);
    const w = eventWines.find((x) => x.id === id);
    if (!w) return;
    setName(w.wine_name);
    setVintage(s(w.wine_vintage));
    setNonVintage(w.wine_non_vintage);
    setColor(w.wine_color);
    setProducer(s(w.wine_producer));
    setRegion(s(w.wine_region));
    setAppellation(s(w.wine_appellation));
    setGrapes(w.wine_grapes.join(', '));
    setWineId(snapshot.lots.find((l) => l.id === w.lot_id)?.wine_id ?? null);
  }

  function linkWine(id: string) {
    const w = snapshot.wines.find((x) => x.id === id);
    if (!w) return;
    setWineId(w.id);
    setName(w.name);
    setVintage(s(w.vintage));
    setNonVintage(w.non_vintage);
    setColor(w.color);
    setProducer(s(w.domaine || w.producer));
    setRegion(s(w.region));
    setAppellation(s(w.appellation));
    setGrapes(w.grapes.join(', '));
  }

  async function close() {
    if (!saved.current && uploaded.current.length) void api.removePhotos(uploaded.current).catch(() => undefined);
    onClose();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Indiquez le nom du vin.');
    if (price && parseNumber(price) === null) return setError('Le prix doit être un nombre.');
    if (fromCellar && !lotId) return setError('Choisissez le lot de votre cave d’où vient la bouteille.');
    setError(null);
    setBusy(true);
    const payload = {
      wine_id: wineId,
      event_id: eventId,
      event_wine_id: eventWineId || null,
      wine_name: name.trim(),
      producer: producer.trim() || null,
      vintage: nonVintage ? null : parseNumber(vintage),
      non_vintage: nonVintage,
      color,
      region: region.trim() || null,
      appellation: appellation.trim() || null,
      grapes: grapes
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean),
      tasted_on: date || todayIso(),
      place: place.trim() || null,
      occasion,
      rating,
      comment: comment.trim() || null,
      robe: robe.trim() || null,
      nez: nez.trim() || null,
      bouche: bouche.trim() || null,
      acidite,
      tanins,
      longueur,
      ...profile,
      dish: dish.trim() || null,
      price_paid: parseNumber(price),
      price_kind: priceKind || null,
      currency: me.currency,
      rebuy,
      favorite,
      photo,
      share_with_event: Boolean(eventId) && share,
      group_id: groupId || null,
    };
    const res = await run(
      async () => {
        if (editing) {
          const { wine_id: _w, event_id: _e, event_wine_id: _ew, ...patch } = payload;
          void _w;
          void _e;
          void _ew;
          await api.updateTasting(tasting!.id, patch);
          return tasting!.id;
        }
        const t = await api.createTasting(payload, fromCellar ? lotId : null, request.current);
        if (alsoWish) await api.addWish({ wine_name: payload.wine_name, producer: payload.producer, vintage: payload.vintage, color: payload.color, region: payload.region, source_tasting_id: t.id });
        return t.id;
      },
      { success: editing ? 'Dégustation enregistrée' : fromCellar ? 'Dégustation enregistrée, bouteille sortie du stock' : 'Dégustation enregistrée' },
    );
    setBusy(false);
    if (res.ok) {
      saved.current = true;
      onClose();
      if (!editing) go(`/carnet/degustation/${res.value}`);
    }
  }

  return (
    <Sheet
      open
      onClose={() => void close()}
      title={editing ? 'Modifier la dégustation' : 'Nouvelle dégustation'}
      footer={
        <>
          <Button variant="secondary" onClick={() => void close()}>
            Annuler
          </Button>
          <Button type="submit" form="tasting-form" loading={busy}>
            Enregistrer
          </Button>
        </>
      }
    >
      <form id="tasting-form" className="form" onSubmit={submit}>
        {prefill?.comment && !editing && <Notice tone="gold">Note préparée par l’assistant : relisez-la et ajustez-la avec vos propres mots.</Notice>}
        {eventWines.length > 0 && !editing && (
          <Field label="Vin de la soirée">
            <select className="input" value={eventWineId} onChange={(e) => pickEventWine(e.target.value)}>
              <option value="">Autre vin</option>
              {eventWines.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.wine_name} {w.wine_vintage ?? ''}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Vin" htmlFor="t-name">
          <input id="t-name" className="input" value={name} onChange={(e) => (setName(e.target.value), setWineId(null))} maxLength={120} required placeholder="Nom du vin, domaine…" />
        </Field>
        {matches.length > 0 && (
          <div className="card soft stack-sm">
            <span className="small strong">Dans votre cave :</span>
            {matches.map((w) => (
              <Button key={w.id} size="sm" variant="secondary" onClick={() => linkWine(w.id)}>
                {w.name} {vintageLabel(w)}
              </Button>
            ))}
          </div>
        )}
        <div className="field-row">
          <Field label="Millésime" htmlFor="t-vintage">
            <input id="t-vintage" className="input" inputMode="numeric" value={nonVintage ? '' : vintage} disabled={nonVintage} onChange={(e) => setVintage(e.target.value.replace(/\D/g, '').slice(0, 4))} />
          </Field>
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <Check checked={nonVintage} onChange={setNonVintage} label="Sans millésime" />
          </div>
        </div>
        <Field label="Couleur">
          <ColorChips value={color} onChange={setColor} />
        </Field>
        <Field label="Ma note">
          <Stars value={rating} onChange={setRating} />
        </Field>
        <Field label="Commentaire" htmlFor="t-comment">
          <textarea id="t-comment" className="input" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={3000} placeholder="Ce qui vous a plu, ou moins plu…" />
        </Field>
        <div className="field-row">
          <Field label="Date" htmlFor="t-date">
            <input id="t-date" className="input" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Lieu" htmlFor="t-place">
            <input id="t-place" className="input" value={place} onChange={(e) => setPlace(e.target.value)} maxLength={120} placeholder="Restaurant, ville…" />
          </Field>
        </div>
        <Field label="Occasion">
          <Chips<Occasion> label="Occasion" value={occasion} onChange={(o) => setOccasion(o === occasion ? null : o)} options={OCCASIONS} />
        </Field>
        <Check checked={rebuy} onChange={setRebuy} label="À racheter" />
        {rebuy && !editing && <Check checked={alsoWish} onChange={setAlsoWish} label="L’ajouter aussi à ma liste d’envies" />}
        <Check checked={favorite} onChange={setFavorite} label="Coup de cœur (favori)" />

        <Advanced title="Observations guidées (facultatif)" open={Boolean(me.preferences.advanced) || Boolean(prefill?.robe || prefill?.nez || prefill?.bouche) || (editing && Boolean(tasting?.robe || tasting?.nez || tasting?.bouche || tasting?.acidite || tasting?.fruite || tasting?.puissance || tasting?.boise || tasting?.mineralite))}>
          <Field label="Robe" htmlFor="t-robe" hint="Couleur, reflets, intensité…">
            <input id="t-robe" className="input" value={robe} onChange={(e) => setRobe(e.target.value)} maxLength={300} />
          </Field>
          <Field label="Nez" htmlFor="t-nez" hint="Arômes : fruits, fleurs, épices, bois…">
            <input id="t-nez" className="input" value={nez} onChange={(e) => setNez(e.target.value)} maxLength={500} />
          </Field>
          <Field label="Bouche" htmlFor="t-bouche" hint="Attaque, équilibre, matière…">
            <input id="t-bouche" className="input" value={bouche} onChange={(e) => setBouche(e.target.value)} maxLength={500} />
          </Field>
          <Field label="Acidité">
            <Chips label="Acidité" value={acidite} onChange={(v) => setAcidite(v === acidite ? null : v)} options={[...ACIDITE]} />
          </Field>
          <Field label="Tanins">
            <Chips label="Tanins" value={tanins} onChange={(v) => setTanins(v === tanins ? null : v)} options={[...TANINS]} />
          </Field>
          <Field label="Longueur">
            <Chips label="Longueur" value={longueur} onChange={(v) => setLongueur(v === longueur ? null : v)} options={[...LONGUEUR]} />
          </Field>
          <p className="small muted">Profil du vin, de 1 (discret) à 5 (intense) : il dessine le radar de « Mes goûts ».</p>
          {PROFILE.map(({ key, label }) => (
            <Field key={key} label={label}>
              <Chips<number> label={label} value={profile[key]} onChange={(v) => setProfile((p) => ({ ...p, [key]: v === p[key] ? null : v }))} options={LEVELS} />
            </Field>
          ))}
          <p className="small faint">
            Besoin d’aide pour décrire ? <a href={`#/assistant?q=${encodeURIComponent('Aide-moi à décrire ce que je ressens pendant la dégustation.')}`}>Demandez à l’assistant</a>.
          </p>
        </Advanced>

        <Advanced title="Plat, prix, photo, détails du vin" open={Boolean(me.preferences.advanced) || (editing && Boolean(tasting?.dish || tasting?.price_paid || tasting?.photo))}>
          <Field label="Plat associé" htmlFor="t-dish">
            <input id="t-dish" className="input" value={dish} onChange={(e) => setDish(e.target.value)} maxLength={200} />
          </Field>
          <div className="field-row">
            <Field label={`Prix payé (${me.currency})`} htmlFor="t-price">
              <input id="t-price" className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
            <Field label="C’était…">
              <select className="input" value={priceKind} onChange={(e) => setPriceKind(e.target.value as PriceKind | '')}>
                <option value="">—</option>
                {PRICE_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <PhotoField label="Photo" path={photo} onChange={setPhoto} onUploaded={(p) => uploaded.current.push(p)} />
          <div className="field-row">
            <Field label="Producteur" htmlFor="t-prod">
              <input id="t-prod" className="input" value={producer} onChange={(e) => setProducer(e.target.value)} />
            </Field>
            <Field label="Région" htmlFor="t-region">
              <input id="t-region" className="input" value={region} onChange={(e) => setRegion(e.target.value)} />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Appellation" htmlFor="t-app">
              <input id="t-app" className="input" value={appellation} onChange={(e) => setAppellation(e.target.value)} />
            </Field>
            <Field label="Cépages" htmlFor="t-grapes">
              <input id="t-grapes" className="input" value={grapes} onChange={(e) => setGrapes(e.target.value)} />
            </Field>
          </div>
        </Advanced>

        {!editing && !eventId && cellarLots.length > 0 && (
          <div className="card soft">
            <Check
              checked={fromCellar}
              onChange={(v) => {
                setFromCellar(v);
                if (v && cellarLots.length === 1) setLotId(cellarLots[0].id);
              }}
              label="La bouteille vient de ma cave"
              hint="Cochez pour la sortir du stock (une bouteille). Sinon, votre stock ne change pas."
            />
            {fromCellar && cellarLots.length > 1 && (
              <select className="input" aria-label="Lot" value={lotId} onChange={(e) => setLotId(e.target.value)}>
                <option value="">Choisir le lot…</option>
                {cellarLots.map((l) => (
                  <option key={l.id} value={l.id}>
                    {volumeLabel(l.volume_ml)} — {l.quantity - l.reserved} disponible(s)
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        {!editing && eventId && <p className="small faint">Le stock des bouteilles de l’événement est mis à jour par la confirmation de leurs propriétaires, pas ici.</p>}
        {eventId && (
          <Check checked={share} onChange={setShare} label="Partager cette note avec les participants de l’événement" hint="Sinon, elle reste privée (visible par vous seul)." />
        )}
        {myGroups.length > 0 && (
          <Field label="Partager avec un groupe" hint="Les membres du groupe la verront dans l’onglet Notes du groupe.">
            <select className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">Non, elle reste privée</option>
              {myGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {`${g.emoji} ${g.name}`}
                </option>
              ))}
            </select>
          </Field>
        )}
        {error && (
          <p role="alert" style={{ color: 'var(--danger)', fontWeight: 650 }}>
            {error}
          </p>
        )}
      </form>
    </Sheet>
  );
}

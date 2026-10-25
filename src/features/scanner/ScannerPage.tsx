/**
 * Scanner avant d'acheter — capture en magasin : étiquette, contre-étiquette, étiquette de prix (et code-barres).
 * Les photos restent sur le téléphone jusqu'à « Analyser » : sans réseau, rien n'est perdu. Une photo déjà envoyée
 * n'est pas renvoyée ; le serveur reprend aussi la lecture d'une série de photos déjà lue.
 */
import { useEffect, useRef, useState } from 'react';
import { Camera, History, ImageUp, Barcode, RotateCcw, Tag, Trash2, Wine as WineIcon } from 'lucide-react';
import { useStore } from '../../data/store';
import { resizeImage } from '../../data/photos';
import { normalizeBarcode } from '../../domain/barcode';
import { toMessage } from '../../domain/errors';
import type { Scan, ScanPhotoRole } from '../../domain/types';
import { Button, Field, InlineLoading, Notice, useToast } from '../../ui/kit';
import { go } from '../../ui/router';
import { useAiStatus } from '../cellar/LabelScan';
import { barcodeSupported, detectBarcode, photoHash } from './capture';

type Slot = { blob: Blob; url: string; hash: string };

export const ROLES: { role: ScanPhotoRole; title: string; hint: string; icon: typeof Camera }[] = [
  { role: 'front', title: 'Étiquette', hint: 'Face avant, bien à plat, sans reflet.', icon: WineIcon },
  { role: 'back', title: 'Contre-étiquette', hint: 'Facultatif : cépages, degré, code-barres.', icon: RotateCcw },
  { role: 'price', title: 'Étiquette de prix', hint: 'Facultatif : le prix affiché en rayon.', icon: Tag },
];

export function ScannerPage() {
  const { api, userId, online } = useStore();
  const toast = useToast();
  const ai = useAiStatus();
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const target = useRef<ScanPhotoRole>('front');
  const [slots, setSlots] = useState<Partial<Record<ScanPhotoRole, Slot>>>({});
  const [barcode, setBarcode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [quota, setQuota] = useState<{ used: number; limit: number; retention_days: number } | null>(null);
  // Photos déjà envoyées (par empreinte) : réutilisées si l'on réessaie ; supprimées si l'on abandonne.
  const sent = useRef(new Map<string, string>());
  const kept = useRef(false);
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  useEffect(() => {
    void api
      .scanStatus()
      .then(setQuota)
      .catch(() => undefined);
  }, [api]);

  useEffect(
    () => () => {
      for (const s of Object.values(slotsRef.current)) if (s) URL.revokeObjectURL(s.url);
      if (!kept.current && sent.current.size) void api.removePhotos([...sent.current.values()]).catch(() => undefined);
    },
    [api],
  );

  const quotaReached = Boolean(quota && quota.used >= quota.limit);
  const unavailable = ai.unavailable ?? (quotaReached ? 'Vous avez atteint votre nombre d’analyses pour aujourd’hui.' : null);
  const filled = ROLES.filter((r) => slots[r.role]);
  const hasLabel = Boolean(slots.front || slots.back);

  function pick(role: ScanPhotoRole, from: 'camera' | 'gallery') {
    target.current = role;
    (from === 'camera' ? camera : gallery).current?.click();
  }

  async function handle(file: File | undefined) {
    if (!file) return;
    const role = target.current;
    setFailure(null);
    let blob: Blob;
    try {
      blob = await resizeImage(file);
    } catch {
      toast('Cette image n’a pas pu être lue. Essayez une autre photo.', { tone: 'error' });
      return;
    }
    const hash = await photoHash(blob);
    const twin = ROLES.find((r) => r.role !== role && slots[r.role]?.hash === hash);
    if (twin) {
      toast(`Cette photo est déjà utilisée pour « ${twin.title} ». Prenez la ${role === 'price' ? 'photo du prix' : 'photo demandée'}.`, { tone: 'error' });
      return;
    }
    setSlots((s) => {
      if (s[role]) URL.revokeObjectURL(s[role]!.url);
      return { ...s, [role]: { blob, url: URL.createObjectURL(blob), hash } };
    });
    if (!normalizeBarcode(barcode) && role !== 'price') {
      const code = await detectBarcode(blob);
      if (code) setBarcode((b) => (normalizeBarcode(b) ? b : code));
    }
  }

  function remove(role: ScanPhotoRole) {
    setSlots((s) => {
      if (s[role]) URL.revokeObjectURL(s[role]!.url);
      const next = { ...s };
      delete next[role];
      return next;
    });
  }

  /** Envoie les photos (une seule fois chacune) et renvoie leurs chemins. */
  async function upload() {
    const photos: Scan['photos'] = [];
    for (const r of filled) {
      const slot = slots[r.role]!;
      let path = sent.current.get(slot.hash);
      if (!path) {
        path = await api.uploadPhoto(userId, slot.blob);
        sent.current.set(slot.hash, path);
      }
      photos.push({ path, role: r.role });
    }
    return photos;
  }

  async function analyse() {
    setFailure(null);
    if (!online) {
      setFailure('Pas de connexion internet : vos photos restent sur ce téléphone. Touchez « Analyser » dès que le réseau revient.');
      return;
    }
    let photos: Scan['photos'];
    try {
      setBusy('Envoi des photos…');
      photos = await upload();
    } catch (e) {
      setBusy(null);
      setFailure(`Les photos n’ont pas pu être envoyées (${toMessage(e)}). Vos photos restent ici : réessayez.`);
      return;
    }
    if (unavailable) return manual(photos);
    setBusy('Lia lit les étiquettes… (quelques secondes)');
    const res = await api.ai('scan_identify', { photos, barcode: normalizeBarcode(barcode) });
    setBusy(null);
    if (!res.ok) {
      setFailure(res.message);
      return;
    }
    kept.current = true;
    go(`/scanner/${(res.scan as Scan).id}`);
  }

  /** Sans lecture de Lia : l'analyse est créée avec les photos, la personne remplit la fiche. */
  async function manual(photos?: Scan['photos']) {
    setBusy('Préparation de la fiche…');
    try {
      const list = photos ?? (filled.length ? await upload() : []);
      const scan = await api.createManualScan({ photos: list, wine: {}, barcode: normalizeBarcode(barcode) });
      kept.current = true;
      go(`/scanner/${scan.id}`);
    } catch (e) {
      setBusy(null);
      setFailure(toMessage(e));
    }
  }

  return (
    <div className="stack">
      <section className="hero">
        <h2>Scanner avant d’acheter</h2>
        <p>Photographiez la bouteille en rayon : Lia identifie le vin et relève le prix affiché. Vous vérifiez avant tout enregistrement.</p>
      </section>

      {!online && <Notice tone="warn">Pas de connexion : vous pouvez prendre vos photos maintenant et lancer l’analyse quand le réseau revient.</Notice>}
      {online && unavailable && (
        <Notice tone="warn">{unavailable} Vous pouvez tout de même photographier la bouteille et remplir la fiche à la main.</Notice>
      )}
      {quota && !quotaReached && quota.limit - quota.used <= 3 && (
        <Notice tone="gold">
          Il vous reste {quota.limit - quota.used} analyse{quota.limit - quota.used > 1 ? 's' : ''} aujourd’hui.
        </Notice>
      )}

      <ul className="scan-slots" aria-label="Photos de la bouteille">
        {ROLES.map(({ role, title, hint, icon: Icon }) => {
          const slot = slots[role];
          return (
            <li key={role} className={`scan-slot${slot ? ' filled' : ''}`}>
              {slot ? <img src={slot.url} alt={`${title} photographiée`} /> : <span className="scan-slot-icon" aria-hidden><Icon /></span>}
              <span className="scan-slot-text">
                <span className="strong">{title}</span>
                <span className="small muted">{slot ? 'Photo prête' : hint}</span>
              </span>
              <span className="scan-slot-actions">
                <Button size="sm" variant={slot ? 'secondary' : 'primary'} icon={<Camera />} onClick={() => pick(role, 'camera')} disabled={Boolean(busy)}>
                  {slot ? 'Reprendre' : 'Photographier'}
                </Button>
                {slot ? (
                  <button type="button" className="icon-btn" aria-label={`Retirer la photo : ${title}`} onClick={() => remove(role)} disabled={Boolean(busy)}>
                    <Trash2 />
                  </button>
                ) : (
                  <button type="button" className="icon-btn" aria-label={`Choisir une photo existante : ${title}`} onClick={() => pick(role, 'gallery')} disabled={Boolean(busy)}>
                    <ImageUp />
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <Field
        label={
          <>
            <Barcode aria-hidden style={{ width: 16, height: 16, verticalAlign: '-3px', marginRight: 4 }} />
            Code-barres (facultatif)
          </>
        }
        hint={
          normalizeBarcode(barcode)
            ? 'Code valable : il aide à retrouver le vin.'
            : barcodeSupported()
              ? 'Lu automatiquement sur les photos quand il est net ; sinon recopiez les chiffres.'
              : 'Lia le lira sur la contre-étiquette ; vous pouvez aussi recopier les chiffres.'
        }
        error={barcode.trim() && !normalizeBarcode(barcode) ? 'Ce code ne semble pas complet : vérifiez les chiffres.' : undefined}
      >
        <input className="input" inputMode="numeric" autoComplete="off" value={barcode} onChange={(e) => setBarcode(e.target.value.replace(/[^\d\s]/g, '').slice(0, 18))} placeholder="3 760 123 456 789" />
      </Field>

      {failure && <Notice tone="warn">{failure}</Notice>}
      {busy ? (
        <InlineLoading text={busy} />
      ) : (
        <div className="stack-sm">
          <Button size="lg" block onClick={() => void analyse()} disabled={!hasLabel}>
            {unavailable ? 'Continuer avec ces photos' : 'Analyser'}
          </Button>
          {!hasLabel && <p className="small muted center">Photographiez au moins l’étiquette ou la contre-étiquette.</p>}
          {failure && (
            <Button variant="secondary" block onClick={() => void manual()}>
              Remplir la fiche à la main
            </Button>
          )}
        </div>
      )}

      <div className="between">
        <Button variant="ghost" size="sm" icon={<History />} onClick={() => go('/scanner/historique')}>
          Mes analyses
        </Button>
        {!busy && (
          <Button variant="ghost" size="sm" onClick={() => void manual()}>
            Saisir sans photo
          </Button>
        )}
      </div>
      {quota && <p className="small faint center">Vos analyses sont privées et supprimées automatiquement après {quota.retention_days} jours.</p>}

      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void handle(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
      <input ref={gallery} type="file" accept="image/*" hidden onChange={(e) => void handle(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
    </div>
  );
}

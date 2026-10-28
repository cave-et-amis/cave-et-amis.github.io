/**
 * Import multiple (maquette Cave & Amis 2.0, panneau 7) : une photo de plusieurs bouteilles, lue par Lia, puis une liste
 * à vérifier (décocher, corriger le nom ou le millésime) avant tout ajout. La photo ne sert qu'à la lecture : elle est
 * supprimée ensuite. Les bouteilles d'un vin déjà en cave s'ajoutent à sa fiche ; les autres créent une fiche simple.
 */
import { useMemo, useRef, useState } from 'react';
import { Camera, ImageUp } from 'lucide-react';
import { newId } from '../../data/api';
import { resizeImage } from '../../data/photos';
import { useStore } from '../../data/store';
import { importPlan, matchWine, vintageToCheck, type ImportRow } from '../../domain/multiImport';
import type { Color, Wine } from '../../domain/types';
import { parseNumber } from '../../domain/format';
import { Button, EmptyState, Field, InlineLoading, Notice, Pill } from '../../ui/kit';
import { go } from '../../ui/router';
import { AiNotice } from '../legal/AiNotice';
import { useAiStatus } from './LabelScan';

type Shelf = { bottles: Omit<ImportRow, 'key' | 'selected'>[]; notes: string | null };

export function ImportPage() {
  const { api, run, userId, me, snapshot } = useStore();
  const ai = useAiStatus();
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const cellars = snapshot.cellars.filter((c) => c.owner_id === userId);
  const [cellarId, setCellarId] = useState(cellars[0]?.id ?? '');
  const plan = useMemo(() => importPlan(rows ?? [], snapshot.wines, userId), [rows, snapshot.wines, userId]);
  const total = plan.reduce((n, p) => n + p.quantity, 0);

  async function handle(file: File | undefined) {
    if (!file) return;
    setFailure(null);
    setRows(null);
    let blob: Blob;
    try {
      blob = await resizeImage(file);
    } catch {
      setFailure('Cette image n’a pas pu être lue. Essayez une autre photo.');
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(blob));
    let path: string;
    try {
      setBusy('Envoi de la photo…');
      path = await api.uploadPhoto(userId, blob);
    } catch {
      setBusy(null);
      setFailure('La photo n’a pas pu être envoyée. Vérifiez la connexion et réessayez.');
      return;
    }
    setBusy('Lia repère les bouteilles… (quelques secondes)');
    const res = await api.ai('identify_shelf', { photo_path: path });
    // La photo n'a servi qu'à la lecture.
    void api.removePhotos([path]).catch(() => undefined);
    setBusy(null);
    if (!res.ok) {
      setFailure(res.message);
      return;
    }
    const shelf = res.result as Shelf;
    setNotes(shelf.notes);
    setRows(shelf.bottles.map((b) => ({ ...b, key: newId(), selected: true })));
  }

  const patch = (key: string, p: Partial<ImportRow>) => setRows((rs) => (rs ?? []).map((r) => (r.key === key ? { ...r, ...p } : r)));

  async function add() {
    const res = await run(
      async () => {
        for (const { row, quantity, existing } of plan) {
          let wineId = existing?.id;
          if (!wineId) {
            wineId = newId();
            await api.saveNewWine({
              id: wineId,
              owner_id: userId,
              name: row.name.trim(),
              producer: row.producer,
              appellation: row.appellation,
              region: row.region,
              color: (row.color as Color | null) ?? null,
              vintage: row.vintage,
              non_vintage: row.non_vintage,
            } as Partial<Wine> & { id: string; name: string });
          }
          await api.createLot(
            {
              wine_id: wineId,
              cellar_id: cellarId || null,
              location_id: null,
              volume_ml: 750,
              quantity,
              origin: 'achat',
              currency: me.currency,
              visibility: me.preferences.default_visibility ?? 'private',
            },
            newId(),
          );
        }
      },
      { success: `${total} bouteille${total > 1 ? 's' : ''} ajoutée${total > 1 ? 's' : ''} à votre cave` },
    );
    if (res.ok) go('/cave');
  }

  return (
    <div className="stack">
      <section className="hero">
        <h2>Ajouter plusieurs bouteilles</h2>
        <p>Une seule photo d’une rangée, d’un carton ou d’une table : Lia repère chaque bouteille. Vous vérifiez la liste avant tout ajout.</p>
      </section>
      {!ai.unavailable && <AiNotice />}
      {ai.unavailable && <Notice tone="warn">{ai.unavailable} Ajoutez vos bouteilles une par une depuis « Ajouter ».</Notice>}

      <section className="viewfinder multi" aria-label="Photo des bouteilles">
        <div className="vf-frame wide">
          {preview ? <img className="vf-photo" src={preview} alt="Photo des bouteilles à ajouter" /> : <span className="vf-empty" aria-hidden />}
          <span className="vf-corners" aria-hidden />
        </div>
        <p className="vf-hint">Bouteilles debout, étiquettes face à vous, sans contre-jour. Jusqu’à 12 bouteilles.</p>
        <span className="inline">
          <Button icon={<Camera />} onClick={() => camera.current?.click()} disabled={Boolean(busy) || Boolean(ai.unavailable)}>
            Photographier
          </Button>
          <Button variant="secondary" icon={<ImageUp />} onClick={() => gallery.current?.click()} disabled={Boolean(busy) || Boolean(ai.unavailable)}>
            Choisir une photo
          </Button>
        </span>
      </section>

      {busy && <InlineLoading text={busy} />}
      {failure && <Notice tone="warn">{failure}</Notice>}

      {rows && rows.length === 0 && (
        <EmptyState icon="🍾" title="Aucune bouteille reconnue">
          {notes ?? 'Reprenez la photo plus près, étiquettes bien visibles.'}
        </EmptyState>
      )}
      {rows && rows.length > 0 && (
        <section className="card stack-sm" aria-labelledby="h-import">
          <h2 id="h-import" className="eyebrow">
            {rows.length} bouteille{rows.length > 1 ? 's' : ''} reconnue{rows.length > 1 ? 's' : ''}
          </h2>
          {notes && <p className="small muted">{notes}</p>}
          <ul className="import-list">
            {rows.map((r, i) => {
              const existing = matchWine(r, snapshot.wines, userId);
              const check = vintageToCheck(r);
              return (
                <li key={r.key} className={r.selected ? '' : 'off'}>
                  <input type="checkbox" checked={r.selected} onChange={(e) => patch(r.key, { selected: e.target.checked })} aria-label={`Ajouter la bouteille ${i + 1}`} />
                  <span className="import-fields">
                    <input className="input" value={r.name} onChange={(e) => patch(r.key, { name: e.target.value })} aria-label={`Nom de la bouteille ${i + 1}`} maxLength={120} />
                    <span className="small muted">{[r.producer, r.appellation || r.region].filter(Boolean).join(' · ')}</span>
                  </span>
                  <input
                    className="input import-vintage"
                    inputMode="numeric"
                    value={r.vintage ?? ''}
                    placeholder="Millésime"
                    onChange={(e) => {
                      const v = parseNumber(e.target.value);
                      patch(r.key, { vintage: v && Number.isInteger(v) ? v : null, uncertain: r.uncertain.filter((u) => u !== 'vintage') });
                    }}
                    aria-label={`Millésime de la bouteille ${i + 1}`}
                  />
                  <span className="import-status">
                    {existing ? <Pill tone="success">Déjà en cave · +1</Pill> : check ? <Pill tone="gold">Millésime à vérifier</Pill> : null}
                  </span>
                </li>
              );
            })}
          </ul>
          {cellars.length > 1 && (
            <Field label="Dans la cave">
              <select className="input" value={cellarId} onChange={(e) => setCellarId(e.target.value)}>
                {cellars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <p className="small faint">Contenance 75 cl, sans prix ni emplacement : vous pourrez compléter chaque fiche ensuite.</p>
          <Button size="lg" block disabled={total === 0} onClick={() => void add()}>
            {total ? `Vérifier et ajouter ${total === 1 ? 'la bouteille' : `les ${total}`}` : 'Cochez au moins une bouteille'}
          </Button>
        </section>
      )}

      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void handle(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
      <input ref={gallery} type="file" accept="image/*" hidden aria-label="Choisir une photo des bouteilles" onChange={(e) => void handle(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
    </div>
  );
}

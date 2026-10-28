import { useState, type FormEvent } from 'react';
import { useStore } from '../../data/store';
import { parseNumber } from '../../domain/format';
import type { Color, WishItem } from '../../domain/types';
import { Button, Field, Sheet } from '../../ui/kit';
import { ColorChips } from '../cellar/fields';
import { WineNameField } from '../cellar/WineAssist';

export type WishPrefill = Partial<Pick<WishItem, 'wine_name' | 'producer' | 'vintage' | 'color' | 'region' | 'appellation' | 'note' | 'source_tasting_id'>>;

export function WishFormSheet({ prefill, item, onClose }: { prefill?: WishPrefill; item?: WishItem; onClose: () => void }) {
  const { api, run } = useStore();
  const src = item ?? prefill ?? {};
  const [name, setName] = useState(src.wine_name ?? '');
  const [producer, setProducer] = useState(src.producer ?? '');
  const [vintage, setVintage] = useState(src.vintage ? String(src.vintage) : '');
  const [color, setColor] = useState<Color | null>((src.color as Color) ?? null);
  const [region, setRegion] = useState(src.region ?? '');
  const [note, setNote] = useState(src.note ?? '');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const payload = {
      wine_name: name.trim(),
      producer: producer.trim() || null,
      vintage: parseNumber(vintage),
      color,
      region: region.trim() || null,
      note: note.trim() || null,
      source_tasting_id: src.source_tasting_id ?? null,
    };
    const res = await run(() => (item ? api.updateWish(item.id, payload) : api.addWish(payload)), { success: item ? 'Envie modifiée' : 'Ajouté à votre liste d’envies' });
    setBusy(false);
    if (res.ok) onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={item ? 'Modifier l’envie' : 'Liste d’envies'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="wish-form" loading={busy} disabled={!name.trim()}>
            Enregistrer
          </Button>
        </>
      }
    >
      <form id="wish-form" className="form" onSubmit={submit}>
        <WineNameField
          id="wi-name"
          value={name}
          onChange={setName}
          photo={!item}
          onFields={(f) => {
            if (f.name) setName(f.name);
            if (f.producer) setProducer(f.producer);
            if (f.vintage) setVintage(String(f.vintage));
            if (f.color) setColor(f.color);
            if (f.region) setRegion(f.region);
          }}
        />
        <div className="field-row">
          <Field label="Producteur" htmlFor="wi-prod">
            <input id="wi-prod" className="input" value={producer} onChange={(e) => setProducer(e.target.value)} />
          </Field>
          <Field label="Millésime" htmlFor="wi-vintage">
            <input id="wi-vintage" className="input" inputMode="numeric" value={vintage} onChange={(e) => setVintage(e.target.value.replace(/\D/g, '').slice(0, 4))} />
          </Field>
        </div>
        <Field label="Couleur">
          <ColorChips value={color} onChange={setColor} />
        </Field>
        <Field label="Région" htmlFor="wi-region">
          <input id="wi-region" className="input" value={region} onChange={(e) => setRegion(e.target.value)} />
        </Field>
        <Field label="Pourquoi ? (facultatif)" htmlFor="wi-note">
          <input id="wi-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Goûté chez Paul, conseil du caviste…" />
        </Field>
      </form>
    </Sheet>
  );
}

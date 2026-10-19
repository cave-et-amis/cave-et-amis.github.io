/** Champs communs des formulaires de vin et de lot. */
import { useRef, useState, type ReactNode } from 'react';
import { Camera, Minus, Plus, Trash2 } from 'lucide-react';
import { useStore } from '../../data/store';
import { resizeImage, usePhotoUrl } from '../../data/photos';
import { toMessage } from '../../domain/errors';
import { COLORS, VISIBILITIES } from '../../domain/wine';
import type { Color, Visibility } from '../../domain/types';
import { Button, Chips, Field, useToast } from '../../ui/kit';

export function Stepper({ value, onChange, min = 0, max = 999, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; label: string }) {
  return (
    <div className="stepper">
      <button type="button" className="icon-btn" style={{ border: '1px solid var(--border-strong)' }} aria-label={`Diminuer : ${label}`} onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}>
        <Minus />
      </button>
      <input
        className="input"
        style={{ width: 56, textAlign: 'center', fontWeight: 700, padding: '10px 4px' }}
        inputMode="numeric"
        aria-label={label}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, ''));
          if (Number.isFinite(n)) onChange(Math.min(max, n));
        }}
      />
      <button type="button" className="icon-btn" style={{ border: '1px solid var(--border-strong)' }} aria-label={`Augmenter : ${label}`} onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>
        <Plus />
      </button>
    </div>
  );
}

export function ColorChips({ value, onChange }: { value: Color | null; onChange: (c: Color | null) => void }) {
  return (
    <Chips<Color>
      label="Couleur"
      value={value}
      onChange={(c) => onChange(c === value ? null : c)}
      options={COLORS.map((c) => ({
        value: c.value,
        label: (
          <>
            <span className="dot" style={{ background: `var(--wine-${c.value})`, width: 12, height: 12 }} aria-hidden />
            {c.label}
          </>
        ),
      }))}
    />
  );
}

export function VisibilityField({ value, onChange }: { value: Visibility; onChange: (v: Visibility) => void }) {
  return (
    <div className="stack-sm" role="radiogroup" aria-label="Qui peut voir ce lot ?">
      {VISIBILITIES.map((v) => (
        <label key={v.value} className="check" style={{ padding: '6px 0' }}>
          <input type="radio" name="visibility" checked={value === v.value} onChange={() => onChange(v.value)} />
          <span className="check-text">
            <span className="strong">{v.label}</span>
            <small>{v.hint}</small>
          </span>
        </label>
      ))}
    </div>
  );
}

/** Ajout d'une photo (appareil photo du téléphone ou fichier), réduite puis rangée dans le dossier privé. */
export function PhotoField({
  label,
  path,
  onChange,
  onUploaded,
}: {
  label: string;
  path: string | null;
  onChange: (p: string | null) => void;
  onUploaded?: (p: string) => void;
}) {
  const { api, userId } = useStore();
  const toast = useToast();
  const url = usePhotoUrl(api, path);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Field label={label}>
      {url && <img className="photo-preview" src={url} alt="" />}
      <div className="inline">
        <Button variant="secondary" size="sm" icon={<Camera />} loading={busy} onClick={() => input.current?.click()}>
          {path ? 'Remplacer la photo' : 'Ajouter une photo'}
        </Button>
        {path && (
          <Button variant="danger-ghost" size="sm" icon={<Trash2 />} onClick={() => onChange(null)}>
            Retirer
          </Button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setBusy(true);
          try {
            const blob = await resizeImage(file);
            const p = await api.uploadPhoto(userId, blob);
            onUploaded?.(p);
            onChange(p);
          } catch (err) {
            toast((err as Error).message === 'image_invalid' ? 'Cette image n’a pas pu être lue.' : toMessage(err), { tone: 'error' });
          } finally {
            setBusy(false);
          }
        }}
      />
    </Field>
  );
}

export function Uncertain({ show, children }: { show: boolean; children: ReactNode }) {
  if (!show) return <>{children}</>;
  return (
    <div className="stack-sm">
      {children}
      <span className="small" style={{ color: 'var(--gold-ink)', fontWeight: 700 }}>
        À vérifier : information incertaine sur la photo
      </span>
    </div>
  );
}

/**
 * Photo de l'étiquette → Lia la lit (identify_label, sur le serveur) → les champs du vin se remplissent, à vérifier.
 * Avec `onPhoto` (dégustation), la photo reste jointe, même si Lia est indisponible. Sans (envies, achats groupés, qui
 * n'ont pas de photo), elle est effacée juste après la lecture.
 */
import { useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { useStore } from '../../data/store';
import { resizeImage } from '../../data/photos';
import { toMessage } from '../../domain/errors';
import type { Color, Wine } from '../../domain/types';
import type { LwinWine } from '../../domain/lwin';
import { Button, Field, Notice } from '../../ui/kit';
import { LwinSuggest } from './LwinSuggest';
import { useAiStatus } from './LabelScan';
import { AiNotice } from '../legal/AiNotice';

export type LabelFields = {
  name?: string;
  producer?: string | null;
  vintage?: number | null;
  non_vintage?: boolean;
  color?: Color | null;
  region?: string | null;
  appellation?: string | null;
  grapes?: string[];
};

type LabelResult = { is_wine_label: boolean; fields: Partial<Wine>; uncertain: string[] };

const UNCERTAIN: Record<string, string> = { name: 'le nom', vintage: 'le millésime', color: 'la couleur', producer: 'le producteur', domaine: 'le domaine', region: 'la région', appellation: 'l’appellation', grapes: 'les cépages' };

export function LabelPhotoButton({ onPhoto, onFields }: { onPhoto?: (path: string) => void; onFields: (f: LabelFields) => void }) {
  const { api, userId } = useStore();
  const ai = useAiStatus();
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<'idle' | 'upload' | 'read'>('idle');
  const [message, setMessage] = useState<{ tone: 'warn' | 'gold'; text: string } | null>(null);

  async function handle(file: File | undefined) {
    if (!file) return;
    setMessage(null);
    setPhase('upload');
    let path: string;
    try {
      path = await api.uploadPhoto(userId, await resizeImage(file));
    } catch (e) {
      setPhase('idle');
      setMessage({ tone: 'warn', text: (e as Error).message === 'image_invalid' ? 'Cette image n’a pas pu être lue. Essayez une autre photo.' : toMessage(e) });
      return;
    }
    const keep = Boolean(onPhoto);
    onPhoto?.(path);
    const after = keep ? 'La photo est jointe : complétez le vin à la main.' : 'Complétez le vin à la main.';
    if (ai.unavailable) {
      if (!keep) void api.removePhotos([path]).catch(() => undefined);
      setPhase('idle');
      setMessage({ tone: 'warn', text: `${ai.unavailable} ${after}` });
      return;
    }
    setPhase('read');
    const res = await api.ai('identify_label', { photo_paths: [path] });
    // Sans champ photo dans ce formulaire : elle n'a servi qu'à la lecture.
    if (!keep) void api.removePhotos([path]).catch(() => undefined);
    setPhase('idle');
    if (!res.ok) {
      setMessage({ tone: 'warn', text: `${res.message} ${after}` });
      return;
    }
    const r = res.result as LabelResult;
    if (!r.is_wine_label) {
      setMessage({ tone: 'warn', text: `Lia ne voit pas d’étiquette de vin sur cette photo.${keep ? ' Elle reste jointe ;' : ''} vous pouvez en prendre une autre.` });
      return;
    }
    const f = r.fields;
    onFields({
      name: f.name ?? undefined,
      producer: f.domaine || f.producer || null,
      vintage: f.vintage ?? null,
      non_vintage: Boolean(f.non_vintage),
      color: f.color ?? null,
      region: f.region ?? null,
      appellation: f.appellation ?? null,
      grapes: f.grapes ?? [],
    });
    const doubts = r.uncertain.map((u) => UNCERTAIN[u]).filter(Boolean);
    setMessage({ tone: 'gold', text: `Lu par Lia : vérifiez avant d’enregistrer${doubts.length ? `, surtout ${doubts.join(', ')}` : ''}.` });
  }

  return (
    <div className="stack-sm">
      {!ai.unavailable && phase === 'idle' && !message && <AiNotice />}
      <Button variant="secondary" icon={<Camera />} loading={phase !== 'idle'} onClick={() => input.current?.click()}>
        {phase === 'upload' ? 'Envoi de la photo…' : phase === 'read' ? 'Lia lit l’étiquette…' : 'Photographier l’étiquette'}
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        aria-label="Photo de l’étiquette"
        onChange={(e) => {
          void handle(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
    </div>
  );
}

/** Un vin choisi dans le dictionnaire LWIN, pour les formulaires sans champ « cuvée » ni « appellation » séparés. */
export function lwinFields(w: LwinWine): LabelFields {
  return { name: w.cuvee ? `${w.name} ${w.cuvee}` : w.name, color: w.color, region: w.region, appellation: w.appellation };
}

/**
 * Nom du vin avec les deux aides : la photo de l'étiquette (Lia) au-dessus, les suggestions du dictionnaire LWIN
 * (sans IA, vins français) en dessous. Taper à nouveau dans le nom relance les suggestions.
 */
export function WineNameField({
  id,
  label = 'Vin',
  value,
  onChange,
  onFields,
  onPhoto,
  placeholder,
  photo = true,
}: {
  id: string;
  label?: string;
  value: string;
  onChange: (v: string) => void;
  onFields: (f: LabelFields) => void;
  onPhoto?: (path: string) => void;
  placeholder?: string;
  photo?: boolean;
}) {
  const [typed, setTyped] = useState(false);
  return (
    <>
      {photo && (
        <LabelPhotoButton
          onPhoto={onPhoto}
          onFields={(f) => {
            setTyped(false);
            onFields(f);
          }}
        />
      )}
      <Field label={label} htmlFor={id}>
        <input
          id={id}
          className="input"
          value={value}
          onChange={(e) => {
            setTyped(true);
            onChange(e.target.value);
          }}
          maxLength={120}
          placeholder={placeholder ?? 'Nom du vin, domaine…'}
        />
      </Field>
      <LwinSuggest
        query={value}
        active={typed}
        onPick={(w) => {
          setTyped(false);
          onFields(lwinFields(w));
        }}
      />
    </>
  );
}

/** Ce que Lia lit sur un document d'achat (server/api/documents.ts) : jamais de donnée personnelle. */
export type DocumentLine = {
  wine_name: string;
  producer: string | null;
  vintage: number | null;
  color: Color | null;
  volume_ml: number | null;
  unit_price: number | null;
  quantity: number | null;
};
export type DocumentResult = {
  is_readable: boolean;
  currency: string | null;
  purchase_date: string | null;
  seller: string | null;
  title: string | null;
  conditions: string | null;
  lines: DocumentLine[];
  uncertain: string[];
  notes: string | null;
};
export type DocumentKind = 'price' | 'receipt' | 'price_list';

const DOC_LABEL: Record<DocumentKind, string> = {
  price: 'Photographier le prix',
  receipt: 'Photographier le ticket ou la facture',
  price_list: 'Photographier la liste de prix',
};

/**
 * Photo d'un document d'achat (étiquette de prix, ticket, liste d'un vigneron) → Lia la lit → le formulaire se remplit,
 * à vérifier. La photo n'est jamais gardée : elle est effacée juste après la lecture.
 */
export function DocumentPhotoButton({ kind, onResult, hint }: { kind: DocumentKind; onResult: (r: DocumentResult) => void; hint?: string }) {
  const { api, userId } = useStore();
  const ai = useAiStatus();
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<'idle' | 'upload' | 'read'>('idle');
  const [message, setMessage] = useState<{ tone: 'warn' | 'gold'; text: string } | null>(null);
  if (ai.unavailable) return null;

  async function handle(file: File | undefined) {
    if (!file) return;
    setMessage(null);
    setPhase('upload');
    let path: string;
    try {
      path = await api.uploadPhoto(userId, await resizeImage(file));
    } catch (e) {
      setPhase('idle');
      setMessage({ tone: 'warn', text: (e as Error).message === 'image_invalid' ? 'Cette image n’a pas pu être lue. Essayez une autre photo.' : toMessage(e) });
      return;
    }
    setPhase('read');
    const res = await api.ai('read_document', { kind, photo_path: path });
    void api.removePhotos([path]).catch(() => undefined);
    setPhase('idle');
    if (!res.ok) return setMessage({ tone: 'warn', text: `${res.message} Remplissez le formulaire à la main.` });
    const r = res.result as DocumentResult;
    if (!r.is_readable) return setMessage({ tone: 'warn', text: 'Lia ne trouve pas de vin avec un prix sur cette photo. Essayez une photo plus nette, bien à plat.' });
    onResult(r);
    setMessage({ tone: 'gold', text: `Lu par Lia : vérifiez avant d’enregistrer${r.uncertain.length ? `, surtout : ${r.uncertain.join(', ')}` : ''}.` });
  }

  return (
    <div className="stack-sm">
      {phase === 'idle' && !message && <AiNotice />}
      <Button variant="secondary" icon={<Camera />} loading={phase !== 'idle'} onClick={() => input.current?.click()}>
        {phase === 'upload' ? 'Envoi de la photo…' : phase === 'read' ? 'Lia lit le document…' : DOC_LABEL[kind]}
      </Button>
      {hint && phase === 'idle' && !message && <p className="small faint">{hint}</p>}
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        aria-label={DOC_LABEL[kind]}
        onChange={(e) => {
          void handle(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
    </div>
  );
}

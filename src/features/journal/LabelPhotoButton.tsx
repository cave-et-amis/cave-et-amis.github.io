/**
 * Dégustation : photo de l'étiquette → Lia la lit (identify_label, sur le serveur) → les champs du vin se remplissent,
 * à vérifier. La photo reste jointe à la dégustation (champ « photo »). Lia indisponible : la photo est gardée quand
 * même, les champs se remplissent à la main.
 */
import { useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { useStore } from '../../data/store';
import { resizeImage } from '../../data/photos';
import { toMessage } from '../../domain/errors';
import type { Color, Wine } from '../../domain/types';
import { Button, Notice } from '../../ui/kit';
import { useAiStatus } from '../cellar/LabelScan';
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

export function LabelPhotoButton({ onPhoto, onFields }: { onPhoto: (path: string) => void; onFields: (f: LabelFields) => void }) {
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
    onPhoto(path);
    if (ai.unavailable) {
      setPhase('idle');
      setMessage({ tone: 'warn', text: `${ai.unavailable} La photo est jointe : complétez le vin à la main.` });
      return;
    }
    setPhase('read');
    const res = await api.ai('identify_label', { photo_paths: [path] });
    setPhase('idle');
    if (!res.ok) {
      setMessage({ tone: 'warn', text: `${res.message} La photo est jointe : complétez le vin à la main.` });
      return;
    }
    const r = res.result as LabelResult;
    if (!r.is_wine_label) {
      setMessage({ tone: 'warn', text: 'Lia ne voit pas d’étiquette de vin sur cette photo. Elle reste jointe ; vous pouvez en prendre une autre.' });
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

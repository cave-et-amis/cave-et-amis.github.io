/**
 * Photo d'étiquette → identification par Claude (sur le serveur) → formulaire pré-rempli à vérifier.
 * Si l'assistant n'est pas disponible, la photo est gardée et la fiche se remplit à la main.
 */
import { useEffect, useRef, useState } from 'react';
import { Camera, ImageUp } from 'lucide-react';
import type { AiStatus } from '../../data/api';
import { useStore } from '../../data/store';
import { resizeImage, usePhotoUrl } from '../../data/photos';
import { toMessage } from '../../domain/errors';
import type { Wine } from '../../domain/types';
import { useActions } from '../../ui/Shell';
import { Button, InlineLoading, Notice, Sheet } from '../../ui/kit';
import { AiNotice } from '../legal/AiNotice';

type LabelResult = {
  is_wine_label: boolean;
  fields: Partial<Wine> & { volume_ml?: number | null };
  uncertain: string[];
  advice: Partial<Pick<Wine, 'drink_from' | 'drink_until' | 'serve_temp_min' | 'serve_temp_max' | 'aeration' | 'pairings'>>;
  notes: string | null;
};

export function aiUnavailableText(status: AiStatus | null, configured: boolean | null) {
  if (configured === false || status?.key_status === 'missing') return 'L’assistant n’est pas configuré sur ce serveur.';
  if (status && !status.enabled) return 'L’assistant est désactivé pour le moment.';
  if (status?.key_status === 'invalid') return 'L’assistant est indisponible (configuration du serveur à vérifier).';
  if (status?.blocked) return 'L’accès à l’assistant n’est pas activé pour votre compte.';
  if (status?.budget_reached) return 'L’assistant a atteint sa limite d’utilisation pour ce mois-ci.';
  if (status && status.requests_today >= status.daily_limit) return 'Vous avez atteint votre nombre de demandes à l’assistant pour aujourd’hui.';
  return null;
}

export function useAiStatus() {
  const { api } = useStore();
  const [state, setState] = useState<{ status: AiStatus | null; configured: boolean | null; loaded: boolean; failure: string | null }>({
    status: null,
    configured: null,
    loaded: false,
    failure: null,
  });
  useEffect(() => {
    let alive = true;
    void api.ai('status').then((r) => {
      if (!alive) return;
      if (r.ok) setState({ status: r.status as AiStatus, configured: Boolean(r.configured), loaded: true, failure: null });
      else setState({ status: null, configured: r.code === 'ai_not_configured' ? false : null, loaded: true, failure: r.code === 'ai_not_configured' ? null : r.message });
    });
    return () => {
      alive = false;
    };
  }, [api]);
  return { ...state, unavailable: state.loaded ? (state.failure ?? aiUnavailableText(state.status, state.configured)) : null };
}

/**
 * Deux étapes : l'étiquette, puis (facultatif) la contre-étiquette. La contre-étiquette ne sert qu'à la lecture par
 * l'assistant : elle est supprimée ensuite, seule la photo de l'étiquette est jointe à la fiche.
 */
export function LabelScanSheet({ onClose }: { onClose: () => void }) {
  const { api, userId } = useStore();
  const actions = useActions();
  const ai = useAiStatus();
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [path, setPath] = useState<string | null>(null);
  const [back, setBack] = useState<string | null>(null);
  const [phase, setPhase] = useState<'pick' | 'back' | 'upload' | 'read' | 'failed' | 'notlabel'>('pick');
  const [message, setMessage] = useState<string | null>(null);
  const url = usePhotoUrl(api, path);
  const backUrl = usePhotoUrl(api, back);
  const used = useRef(false);

  function dropBack() {
    if (back) void api.removePhotos([back]).catch(() => undefined);
    setBack(null);
  }

  function manual(p: string | null) {
    used.current = true;
    dropBack();
    onClose();
    actions.newWine({ wine: { label_photo: p }, uploaded: p ? [p] : [] });
  }

  function restart() {
    if (path) void api.removePhotos([path]).catch(() => undefined);
    dropBack();
    setPath(null);
    setPhase('pick');
  }

  async function upload(file: File): Promise<string | null> {
    setMessage(null);
    setPhase('upload');
    try {
      return await api.uploadPhoto(userId, await resizeImage(file));
    } catch (e) {
      setPhase('failed');
      setMessage((e as Error).message === 'image_invalid' ? 'Cette image n’a pas pu être lue. Essayez une autre photo.' : toMessage(e));
      return null;
    }
  }

  async function handle(file: File | undefined) {
    if (!file) return;
    if (phase === 'back' && path) {
      const b = await upload(file);
      if (!b) return;
      setBack(b);
      await read(path, b);
      return;
    }
    const p = await upload(file);
    if (!p) return;
    setPath(p);
    if (ai.unavailable) {
      setPhase('failed');
      setMessage(`${ai.unavailable} La photo est gardée : complétez la fiche à la main.`);
      return;
    }
    setPhase('back');
  }

  async function read(p: string, b: string | null) {
    setPhase('read');
    const res = await api.ai('identify_label', { photo_paths: b ? [p, b] : [p] });
    // La contre-étiquette n'a servi qu'à la lecture.
    if (b) void api.removePhotos([b]).catch(() => undefined);
    setBack(null);
    if (!res.ok) {
      setPhase('failed');
      setMessage(`${res.message} La photo est gardée : vous pouvez compléter la fiche à la main.`);
      return;
    }
    const r = res.result as LabelResult;
    if (!r.is_wine_label) {
      setPhase('notlabel');
      return;
    }
    used.current = true;
    onClose();
    const { volume_ml, ...fields } = r.fields;
    actions.newWine({
      wine: { ...fields, ...r.advice, label_photo: p },
      uncertain: r.uncertain,
      aiAdvice: Object.keys(r.advice ?? {}).length > 0,
      volume_ml: volume_ml ?? null,
      aiNotes: r.notes,
      uploaded: [p],
    });
  }

  const pickButtons = (
    <>
      <Button size="lg" icon={<Camera />} onClick={() => camera.current?.click()}>
        Prendre la photo
      </Button>
      <Button variant="secondary" icon={<ImageUp />} onClick={() => gallery.current?.click()}>
        Choisir une photo existante
      </Button>
    </>
  );

  return (
    <Sheet
      open
      onClose={() => {
        if (!used.current) {
          const left = [path, back].filter((p): p is string => Boolean(p));
          if (left.length) void api.removePhotos(left).catch(() => undefined);
        }
        onClose();
      }}
      title="Photographier une étiquette"
    >
      <div className="stack">
        {(url || backUrl) && (
          <div className="photo-pair">
            {url && <img className="photo-preview" src={url} alt="Étiquette photographiée" />}
            {backUrl && <img className="photo-preview" src={backUrl} alt="Contre-étiquette photographiée" />}
          </div>
        )}
        {phase === 'pick' && (
          <>
            {!ai.unavailable && <AiNotice />}
            <p className="muted">Cadrez l’étiquette bien à plat, sans reflet. L’assistant propose les informations ; vous les vérifiez avant d’enregistrer.</p>
            {ai.unavailable && <Notice tone="warn">{ai.unavailable} La photo sera jointe à la fiche, que vous remplirez à la main.</Notice>}
            {pickButtons}
            <Button variant="ghost" onClick={() => manual(null)}>
              Saisir le vin à la main
            </Button>
          </>
        )}
        {phase === 'back' && (
          <>
            <p className="muted">
              <strong>Étape 2 sur 2 (facultatif) : la contre-étiquette.</strong> Au dos de la bouteille, elle indique souvent les cépages, la contenance ou le
              producteur : l’assistant en tiendra compte. Elle sert seulement à la lecture et n’est pas gardée.
            </p>
            {pickButtons}
            <Button variant="ghost" onClick={() => path && void read(path, null)}>
              Passer : lire seulement l’étiquette
            </Button>
          </>
        )}
        {phase === 'upload' && <InlineLoading text="Envoi de la photo…" />}
        {phase === 'read' && <InlineLoading text="L’assistant lit l’étiquette… (quelques secondes)" />}
        {phase === 'failed' && (
          <>
            {message && <Notice tone="warn">{message}</Notice>}
            <Button onClick={() => manual(path)}>Continuer à la main</Button>
            <Button variant="secondary" onClick={restart}>
              Reprendre une photo
            </Button>
          </>
        )}
        {phase === 'notlabel' && (
          <>
            <Notice tone="warn">Ces photos ne semblent pas montrer une étiquette de vin. Reprenez-les de plus près, ou saisissez le vin à la main.</Notice>
            <Button onClick={restart}>Reprendre une photo</Button>
            <Button variant="secondary" onClick={() => manual(path)}>
              Saisir à la main avec cette photo
            </Button>
          </>
        )}
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void handle(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
        <input ref={gallery} type="file" accept="image/*" hidden onChange={(e) => void handle(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
      </div>
    </Sheet>
  );
}

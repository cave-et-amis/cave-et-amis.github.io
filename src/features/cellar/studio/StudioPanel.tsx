/**
 * Studio photo, dans la fiche du vin : la photo de la bouteille est détourée dans le navigateur puis mise en scène
 * (4 styles). Avant / après côte à côte ; la personne choisit la version améliorée ou garde l'original, qui est
 * de toute façon conservé. Le moteur (46 Mo, une seule fois) n'est téléchargé qu'à la première utilisation.
 */
import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useStore } from '../../../data/store';
import { signedUrls } from '../../../data/photos';
import { STUDIO_STYLES, type StudioStyle } from '../../../domain/studio';
import { Button, InlineLoading, Notice } from '../../../ui/kit';

type Engine = typeof import('./engine');

const FAILURES: Record<string, string> = {
  no_bottle: 'Aucune bouteille trouvée sur la photo. Photographiez la bouteille entière, de face, sur un fond simple.',
  model_download: 'Le module du studio n’a pas pu être téléchargé. Vérifiez la connexion, puis réessayez.',
};

export function StudioPanel({ photo, onUse }: { photo: string; onUse: (path: string) => void }) {
  const { api, userId } = useStore();
  const [phase, setPhase] = useState<'intro' | 'work' | 'pick' | 'save'>('intro');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [style, setStyle] = useState<StudioStyle>('studio');
  const [cached, setCached] = useState<boolean | null>(null);
  const [before, setBefore] = useState<string | null>(null);
  const engine = useRef<Engine | null>(null);
  const bottle = useRef<HTMLCanvasElement | null>(null);
  const result = useRef<HTMLCanvasElement | null>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || cached !== null) return;
    void import('./engine')
      .then((m) => m.modelCached())
      .then(setCached, () => setCached(false));
  }, [open, cached]);

  // Nouvelle photo : on repart de zéro.
  useEffect(() => {
    bottle.current = null;
    setPhase('intro');
    setError(null);
  }, [photo]);

  function show(s: StudioStyle) {
    if (!engine.current || !bottle.current || !holder.current) return;
    setStyle(s);
    const out = engine.current.compose(bottle.current, s);
    out.className = 'studio-result';
    out.setAttribute('role', 'img');
    out.setAttribute('aria-label', `Version améliorée : ${STUDIO_STYLES.find((x) => x.id === s)!.label}`);
    holder.current.replaceChildren(out);
    result.current = out;
  }

  async function run() {
    setError(null);
    setPhase('work');
    setProgress(null);
    try {
      engine.current ??= await import('./engine');
      const url = (await signedUrls(api, [photo])).get(photo);
      if (!url) throw new Error('not_found');
      setBefore(url);
      const blob = await (await fetch(url)).blob();
      bottle.current = await engine.current.extractBottle(blob, (r) => setProgress(r));
      setCached(true);
      setPhase('pick');
    } catch (e) {
      const code = (e as Error)?.message;
      setError(FAILURES[code] ?? 'Le studio n’a pas pu traiter cette photo. Réessayez, ou gardez l’original.');
      setPhase('intro');
    }
  }

  useEffect(() => {
    if (phase === 'pick') show(style);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  async function use() {
    if (!engine.current || !result.current) return;
    setPhase('save');
    try {
      const path = await api.uploadPhoto(userId, await engine.current.toWebp(result.current));
      onUse(path);
      setOpen(false);
      setPhase('intro');
    } catch {
      setError('La version améliorée n’a pas pu être enregistrée. Réessayez.');
      setPhase('pick');
    }
  }

  if (!open)
    return (
      <Button variant="soft" size="sm" icon={<Sparkles />} onClick={() => setOpen(true)}>
        Mettre en valeur la photo (studio)
      </Button>
    );

  return (
    <div className="card soft stack-sm studio">
      <p className="strong">Studio photo</p>
      {phase === 'intro' && (
        <>
          <p className="small muted">
            La bouteille est détourée puis présentée sur un fond professionnel. Ses pixels ne sont pas redessinés : l’étiquette reste exactement celle de
            votre photo. Tout se passe sur cet appareil ; l’original est conservé.
          </p>
          {cached === false && (
            <Notice tone="info">Première utilisation : téléchargement d’un module de 46 Mo, une seule fois (Wi-Fi conseillé). Le traitement prend ensuite 5 à 20 secondes.</Notice>
          )}
          {error && <Notice tone="warn">{error}</Notice>}
          <div className="inline">
            <Button size="sm" icon={<Sparkles />} onClick={() => void run()}>
              Lancer le studio
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Annuler
            </Button>
          </div>
        </>
      )}
      {phase === 'work' && (
        <InlineLoading
          text={progress !== null && progress < 1 ? `Téléchargement du module : ${Math.round(progress * 100)} %` : 'Détourage de la bouteille… (5 à 20 secondes)'}
        />
      )}
      {(phase === 'pick' || phase === 'save') && (
        <>
          <div className="photo-pair">
            {before && (
              <figure className="studio-figure">
                <img className="photo-preview" src={before} alt="Photo d’origine" />
                <figcaption className="small muted">Avant</figcaption>
              </figure>
            )}
            <figure className="studio-figure">
              <div ref={holder} />
              <figcaption className="small muted">Après</figcaption>
            </figure>
          </div>
          <div className="chips" role="group" aria-label="Style">
            {STUDIO_STYLES.map((s) => (
              <button key={s.id} type="button" className="chip" aria-pressed={style === s.id} title={s.hint} onClick={() => show(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
          {error && <Notice tone="warn">{error}</Notice>}
          <div className="inline">
            <Button size="sm" loading={phase === 'save'} onClick={() => void use()}>
              Utiliser cette version
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Garder l’original
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

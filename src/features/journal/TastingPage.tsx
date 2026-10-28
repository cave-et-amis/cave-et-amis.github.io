import { useState } from 'react';
import { Heart, Pencil, Trash2 } from 'lucide-react';
import { useStore } from '../../data/store';
import { usePhotoUrl } from '../../data/photos';
import { dateLong, money } from '../../domain/format';
import { colorLabel, label, OCCASIONS, PRICE_KINDS } from '../../domain/wine';
import { useActions } from '../../ui/Shell';
import { Button, EmptyState, StarsView, useConfirm } from '../../ui/kit';
import { go } from '../../ui/router';
import { TastingFormSheet } from './TastingForm';

export function TastingPage({ id }: { id: string }) {
  const { snapshot, api, run } = useStore();
  const actions = useActions();
  const confirm = useConfirm();
  const t = snapshot.tastings.find((x) => x.id === id);
  const photo = usePhotoUrl(api, t?.photo);
  const [editing, setEditing] = useState(false);
  if (!t) {
    return (
      <EmptyState icon="📓" title="Dégustation introuvable" action={<Button onClick={() => go('/carnet')}>Mon carnet</Button>}>
        Elle a peut-être été supprimée.
      </EmptyState>
    );
  }
  const event = t.event_id ? snapshot.events.find((e) => e.id === t.event_id) : undefined;
  const obs = [
    ['Robe', t.robe],
    ['Nez', t.nez],
    ['Bouche', t.bouche],
    ['Acidité', t.acidite],
    ['Tanins', t.tanins],
    ['Longueur', t.longueur],
    ['Fruité', t.fruite && `${t.fruite}/5`],
    ['Puissance', t.puissance && `${t.puissance}/5`],
    ['Boisé', t.boise && `${t.boise}/5`],
    ['Minéralité', t.mineralite && `${t.mineralite}/5`],
  ].filter(([, v]) => v) as [string, string][];
  return (
    <>
      <section className="card stack-sm">
        <h2 className="title-font" style={{ fontSize: '1.45rem' }}>
          {t.wine_name}
          {t.vintage ? ` ${t.vintage}` : t.non_vintage ? ' (sans millésime)' : ''}
        </h2>
        <p className="muted">{[t.producer, t.appellation || t.region, colorLabel(t.color)].filter(Boolean).join(' · ')}</p>
        <StarsView value={t.rating} />
        <p className="small muted">
          {dateLong(t.tasted_on)}
          {t.place ? ` · ${t.place}` : ''}
          {t.occasion ? ` · ${label(OCCASIONS, t.occasion)}` : ''}
        </p>
        <div className="inline">
          {t.rebuy && <span className="pill gold">À racheter</span>}
          {t.favorite && <span className="pill primary">Coup de cœur</span>}
          {t.movement_id && <span className="pill">Bouteille sortie de ma cave</span>}
          {t.share_with_event ? <span className="pill info">Partagée avec l’événement</span> : <span className="pill">Privée</span>}
        </div>
        {event && (
          <p className="small">
            Événement : <a href={`#/evenements/${event.id}`}>{event.title}</a>
          </p>
        )}
        {t.wine_id && (
          <p className="small">
            <a href={`#/cave/vin/${t.wine_id}`}>Voir la fiche du vin dans ma cave</a>
          </p>
        )}
      </section>
      {photo && <img className="photo-preview" src={photo} alt={`Photo de ${t.wine_name}`} />}
      {t.comment && (
        <section className="card">
          <p style={{ whiteSpace: 'pre-wrap' }}>{t.comment}</p>
        </section>
      )}
      {(obs.length > 0 || t.dish || t.price_paid !== null) && (
        <section className="card">
          <dl className="facts">
            {obs.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
            {t.dish && (
              <>
                <dt>Plat</dt>
                <dd>{t.dish}</dd>
              </>
            )}
            {t.price_paid !== null && (
              <>
                <dt>Prix payé</dt>
                <dd>
                  {money(t.price_paid, t.currency)} {t.price_kind ? `(${label(PRICE_KINDS, t.price_kind).toLowerCase()})` : ''}
                </dd>
              </>
            )}
          </dl>
        </section>
      )}
      <div className="grid-2-always">
        <Button variant="secondary" icon={<Pencil />} onClick={() => setEditing(true)}>
          Modifier
        </Button>
        <Button
          variant="secondary"
          icon={<Heart />}
          onClick={() => actions.newWish({ wine_name: t.wine_name, producer: t.producer, vintage: t.vintage, color: t.color, region: t.region, source_tasting_id: t.id })}
        >
          Ajouter à mes envies
        </Button>
      </div>
      <Button
        variant="danger-ghost"
        icon={<Trash2 />}
        onClick={async () => {
          const ok = await confirm({
            title: 'Supprimer cette dégustation ?',
            message: t.movement_id ? 'La sortie de stock associée n’est pas annulée : si besoin, annulez-la depuis l’historique de la fiche du vin.' : undefined,
            confirmLabel: 'Supprimer',
            danger: true,
          });
          if (!ok) return;
          const res = await run(() => api.deleteTasting(t.id), { success: 'Dégustation supprimée' });
          if (res.ok) {
            if (t.photo) void api.removePhotos([t.photo]).catch(() => undefined);
            go('/carnet', { replace: true });
          }
        }}
      >
        Supprimer
      </Button>
      {editing && <TastingFormSheet tasting={t} onClose={() => setEditing(false)} />}
    </>
  );
}

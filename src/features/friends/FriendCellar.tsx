import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { SharedLot } from '../../domain/types';
import { useStore } from '../../data/store';
import { COLORS, fold, vintageLabel } from '../../domain/wine';
import type { Color } from '../../domain/types';
import { Avatar, Button, EmptyState, InlineLoading, Notice } from '../../ui/kit';
import { go } from '../../ui/router';
import { SharedItem } from './SharedItem';

export function FriendCellar({ friendId }: { friendId: string }) {
  const { friends, api } = useStore();
  const friend = friends.find((f) => f.id === friendId);
  const [rows, setRows] = useState<SharedLot[] | null>(null);
  const [q, setQ] = useState('');
  const [color, setColor] = useState<Color | null>(null);

  useEffect(() => {
    let alive = true;
    if (!friend) return;
    void api
      .sharedLots(friendId)
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [api, friendId, friend]);

  const shown = useMemo(() => {
    const words = fold(q).split(/\s+/).filter(Boolean);
    return (rows ?? []).filter(
      (s) => (!color || s.color === color) && words.every((w) => fold([s.name, s.producer, s.domaine, s.region, s.appellation, vintageLabel(s), ...(s.grapes ?? [])].join(' ')).includes(w)),
    );
  }, [rows, q, color]);

  if (!friend) {
    return (
      <EmptyState icon="🔒" title="Cave non accessible" action={<Button onClick={() => go('/amis')}>Revenir à mes amis</Button>}>
        Vous n’êtes pas (ou plus) connecté avec cette personne.
      </EmptyState>
    );
  }

  return (
    <>
      <div className="inline">
        <Avatar name={friend.display_name} seed={friend.id} />
        <div>
          <h2 className="section">{friend.display_name}</h2>
          <p className="small muted">Les bouteilles que {friend.display_name} a choisi de partager avec vous.</p>
        </div>
      </div>
      <Notice tone="info">Une bouteille visible n’est pas forcément disponible : pour un dîner, suggérez-la depuis l’événement, son propriétaire confirmera.</Notice>
      <div className="search">
        <Search aria-hidden />
        <input className="input" type="search" aria-label={`Chercher dans la cave de ${friend.display_name}`} placeholder="Chercher…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="subtabs" role="group" aria-label="Couleur">
        {COLORS.filter((c) => c.value !== 'autre').map((c) => (
          <button key={c.value} type="button" aria-pressed={color === c.value} onClick={() => setColor(color === c.value ? null : c.value)}>
            {c.label}
          </button>
        ))}
      </div>
      {rows === null ? (
        <InlineLoading />
      ) : shown.length === 0 ? (
        <EmptyState icon="🍷" title={rows.length ? 'Aucun vin ne correspond' : 'Rien de partagé pour l’instant'}>
          {rows.length ? 'Essayez d’autres mots.' : `${friend.display_name} n’a encore partagé aucune bouteille avec vous.`}
        </EmptyState>
      ) : (
        <div className="list">
          {shown.map((s) => (
            <SharedItem key={s.lot_id} lot={s} />
          ))}
        </div>
      )}
    </>
  );
}

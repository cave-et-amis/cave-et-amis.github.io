/** Historique privé des analyses du scanner : consultation, suppression une à une ou en totalité. */
import { useEffect, useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { useStore } from '../../data/store';
import { usePhotoUrl } from '../../data/photos';
import { dateShort, money } from '../../domain/format';
import { toMessage } from '../../domain/errors';
import type { Scan } from '../../domain/types';
import { wineTitle } from '../../domain/wine';
import { Button, EmptyState, InlineLoading, Notice, Pill, Thumb, useConfirm } from '../../ui/kit';
import { go } from '../../ui/router';

export function ScanHistory() {
  const { api, run } = useStore();
  const confirm = useConfirm();
  const [list, setList] = useState<Scan[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const all = await api.scans();
      // Durée de conservation passée : supprimées ici aussi (le serveur le fait à chaque nouvelle analyse).
      const now = Date.now();
      const expired = all.filter((s) => Date.parse(s.expires_at) <= now);
      if (expired.length) void api.deleteScans(expired).catch(() => undefined);
      setList(all.filter((s) => Date.parse(s.expires_at) > now));
    } catch (e) {
      setError(toMessage(e));
    }
  }

  useEffect(() => {
    void load();
  }, [api]);

  async function removeAll() {
    if (!list?.length) return;
    if (!(await confirm({ title: 'Supprimer tout l’historique ?', message: `${list.length} analyse${list.length > 1 ? 's' : ''} et leurs photos seront supprimées.`, confirmLabel: 'Tout supprimer', danger: true }))) return;
    const res = await run(() => api.deleteScans(list), { success: 'Historique supprimé' });
    if (res.ok) setList([]);
  }

  async function removeOne(scan: Scan) {
    const res = await run(() => api.deleteScans([scan]), { success: 'Analyse supprimée' });
    if (res.ok) setList((l) => (l ?? []).filter((s) => s.id !== scan.id));
  }

  if (error) return <Notice tone="warn">{error}</Notice>;
  if (!list) return <InlineLoading />;
  if (!list.length)
    return (
      <EmptyState icon="🔎" title="Aucune analyse pour l’instant" action={<Button icon={<Camera />} onClick={() => go('/scanner')}>Scanner une bouteille</Button>}>
        En magasin, photographiez une bouteille : Lia l’identifie et relève le prix du rayon.
      </EmptyState>
    );
  return (
    <div className="stack">
      <div className="list">
        {list.map((s) => (
          <HistoryRow key={s.id} scan={s} onRemove={() => void removeOne(s)} />
        ))}
      </div>
      <Button variant="ghost" icon={<Trash2 />} onClick={() => void removeAll()}>
        Supprimer tout l’historique
      </Button>
    </div>
  );
}

function HistoryRow({ scan, onRemove }: { scan: Scan; onRemove: () => void }) {
  const { api } = useStore();
  const front = scan.photos.find((p) => p.role === 'front') ?? scan.photos[0];
  const url = usePhotoUrl(api, front?.path);
  const name = scan.wine.name ? wineTitle({ name: scan.wine.name, vintage: scan.wine.vintage ?? null, non_vintage: scan.wine.non_vintage }) : 'Vin à identifier';
  return (
    <div className="row static">
      <a className="row-main inline" href={`#/scanner/${scan.id}`} style={{ textDecoration: 'none', color: 'inherit', gap: 12 }}>
        <Thumb url={url} color={scan.wine.color} />
        <span className="row-main">
          <span className="row-title">{name}</span>
          <span className="row-sub">
            {dateShort(scan.created_at)}
            {scan.price_confirmed ? ` · ${money(scan.store_price, scan.currency)}` : ''}
            {scan.store_name ? ` · ${scan.store_name}` : ''}
          </span>
        </span>
      </a>
      {scan.status === 'confirmed' ? <Pill tone="success">Vérifié</Pill> : <Pill tone="gold">À vérifier</Pill>}
      <button type="button" className="icon-btn" aria-label={`Supprimer l’analyse : ${name}`} onClick={onRemove}>
        <Trash2 />
      </button>
    </div>
  );
}

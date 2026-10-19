import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useStore } from '../../data/store';
import type { Cellar, Location, LocationKind, Storage } from '../../domain/types';
import { label, LOCATION_KINDS, STORAGES } from '../../domain/wine';
import { Button, Field, Sheet, useConfirm } from '../../ui/kit';

export function CellarsPage() {
  const { snapshot, api, run } = useStore();
  const confirm = useConfirm();
  const [cellarSheet, setCellarSheet] = useState<{ cellar?: Cellar } | null>(null);
  const [locSheet, setLocSheet] = useState<{ cellarId: string; location?: Location } | null>(null);
  const count = (pred: (l: (typeof snapshot.lots)[number]) => boolean) => snapshot.lots.filter(pred).reduce((s, l) => s + l.quantity, 0);

  return (
    <>
      <p className="muted small">
        Une cave = un lieu de stockage (cave, armoire à vin, appartement…). Ses conditions de conservation affinent les conseils de garde. Les emplacements
        (casier, étagère…) aident à retrouver vos bouteilles.
      </p>
      {snapshot.cellars.map((c) => (
        <section key={c.id} className="card stack-sm">
          <div className="between">
            <div>
              <h2 className="section">{c.name}</h2>
              <p className="small muted">
                {STORAGES.find((s) => s.value === c.storage)?.label} · {count((l) => l.cellar_id === c.id)} bouteille(s)
              </p>
            </div>
            <span className="inline" style={{ flexWrap: 'nowrap' }}>
              <button type="button" className="icon-btn" aria-label={`Modifier ${c.name}`} onClick={() => setCellarSheet({ cellar: c })}>
                <Pencil />
              </button>
              {snapshot.cellars.length > 1 && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Supprimer ${c.name}`}
                  onClick={async () => {
                    if (await confirm({ title: `Supprimer « ${c.name} » ?`, message: 'Seule une cave vide peut être supprimée.', confirmLabel: 'Supprimer', danger: true }))
                      await run(() => api.deleteCellar(c.id), { success: 'Cave supprimée' });
                  }}
                >
                  <Trash2 />
                </button>
              )}
            </span>
          </div>
          {c.notes && <p className="small">{c.notes}</p>}
          <div className="list" style={{ boxShadow: 'none' }}>
            {snapshot.locations
              .filter((l) => l.cellar_id === c.id)
              .map((l) => (
                <div key={l.id} className="row static" style={{ minHeight: 52 }}>
                  <span className="row-main">
                    <span className="row-title">{l.name}</span>
                    <span className="row-sub">
                      {label(LOCATION_KINDS, l.kind)} · {count((x) => x.location_id === l.id)} bouteille(s)
                    </span>
                  </span>
                  <button type="button" className="icon-btn" aria-label={`Renommer ${l.name}`} onClick={() => setLocSheet({ cellarId: c.id, location: l })}>
                    <Pencil />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Supprimer l’emplacement ${l.name}`}
                    onClick={async () => {
                      if (await confirm({ title: `Supprimer l’emplacement « ${l.name} » ?`, message: 'Les bouteilles restent dans la cave, sans emplacement.', confirmLabel: 'Supprimer' }))
                        await run(() => api.deleteLocation(l.id), { success: 'Emplacement supprimé' });
                    }}
                  >
                    <Trash2 />
                  </button>
                </div>
              ))}
          </div>
          <Button variant="ghost" size="sm" icon={<Plus />} onClick={() => setLocSheet({ cellarId: c.id })}>
            Ajouter un emplacement
          </Button>
        </section>
      ))}
      <Button variant="secondary" icon={<Plus />} onClick={() => setCellarSheet({})}>
        Ajouter une cave
      </Button>

      {cellarSheet && <CellarSheet cellar={cellarSheet.cellar} onClose={() => setCellarSheet(null)} />}
      {locSheet && <LocationSheet cellarId={locSheet.cellarId} location={locSheet.location} onClose={() => setLocSheet(null)} />}
    </>
  );
}

function CellarSheet({ cellar, onClose }: { cellar?: Cellar; onClose: () => void }) {
  const { api, run } = useStore();
  const [name, setName] = useState(cellar?.name ?? '');
  const [storage, setStorage] = useState<Storage>(cellar?.storage ?? 'unknown');
  const [notes, setNotes] = useState(cellar?.notes ?? '');
  return (
    <Sheet
      open
      onClose={onClose}
      title={cellar ? 'Modifier la cave' : 'Nouvelle cave'}
      footer={
        <Button
          disabled={!name.trim()}
          onClick={async () => {
            const payload = { name: name.trim(), storage, notes: notes.trim() || null };
            const res = await run(async () => void (cellar ? await api.updateCellar(cellar.id, payload) : await api.addCellar(payload)), { success: 'Cave enregistrée' });
            if (res.ok) onClose();
          }}
        >
          Enregistrer
        </Button>
      }
    >
      <div className="form">
        <Field label="Nom" htmlFor="c-name">
          <input id="c-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Cave de la maison, armoire du salon…" data-autofocus />
        </Field>
        <Field label="Conditions de conservation">
          <select className="input" value={storage} onChange={(e) => setStorage(e.target.value as Storage)}>
            {STORAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
                {s.hint ? ` — ${s.hint}` : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notes" htmlFor="c-notes">
          <input id="c-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
        </Field>
      </div>
    </Sheet>
  );
}

function LocationSheet({ cellarId, location, onClose }: { cellarId: string; location?: Location; onClose: () => void }) {
  const { api, run } = useStore();
  const [name, setName] = useState(location?.name ?? '');
  const [kind, setKind] = useState<LocationKind>(location?.kind ?? 'casier');
  return (
    <Sheet
      open
      onClose={onClose}
      title={location ? 'Modifier l’emplacement' : 'Nouvel emplacement'}
      footer={
        <Button
          disabled={!name.trim()}
          onClick={async () => {
            const res = await run(async () => void (location ? await api.updateLocation(location.id, { name: name.trim(), kind }) : await api.addLocation({ cellar_id: cellarId, name: name.trim(), kind })), {
              success: 'Emplacement enregistré',
            });
            if (res.ok) onClose();
          }}
        >
          Enregistrer
        </Button>
      }
    >
      <div className="form">
        <Field label="Type">
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as LocationKind)}>
            {LOCATION_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nom" htmlFor="l-name">
          <input id="l-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Casier A, étagère du bas…" data-autofocus />
        </Field>
      </div>
    </Sheet>
  );
}

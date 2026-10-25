/**
 * Mes caves et leurs emplacements ; caves gérées à plusieurs : associer une personne (un ami, avec son propre compte),
 * la retirer, ou quitter une cave dont on n'est pas le propriétaire.
 */
import { useState } from 'react';
import { LogOut, Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import { useStore } from '../../data/store';
import { dateShort, deName } from '../../domain/format';
import type { Cellar, Location, LocationKind, Storage } from '../../domain/types';
import { label, LOCATION_KINDS, STORAGES } from '../../domain/wine';
import { Avatar, Button, Check, EmptyState, Field, Sheet, useConfirm } from '../../ui/kit';

export function CellarsPage() {
  const { snapshot, api, run, userId, profileName, cellarPeople } = useStore();
  const confirm = useConfirm();
  const [cellarSheet, setCellarSheet] = useState<{ cellar?: Cellar } | null>(null);
  const [locSheet, setLocSheet] = useState<{ cellarId: string; location?: Location } | null>(null);
  const [associate, setAssociate] = useState<Cellar | null>(null);
  const count = (pred: (l: (typeof snapshot.lots)[number]) => boolean) => snapshot.lots.filter(pred).reduce((s, l) => s + l.quantity, 0);
  const own = snapshot.cellars.filter((c) => c.owner_id === userId);
  const shared = snapshot.cellars.filter((c) => c.owner_id !== userId);

  const locations = (c: Cellar) => (
    <>
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
    </>
  );

  return (
    <>
      <p className="muted small">
        Une cave = un lieu de stockage (cave, armoire à vin, appartement…). Ses conditions de conservation affinent les conseils de garde. Les emplacements
        (casier, étagère…) aident à retrouver vos bouteilles. Une cave peut être gérée à plusieurs (un couple, une famille), chaque personne avec son compte.
      </p>
      {own.map((c) => {
        const people = cellarPeople(c.id);
        return (
          <section key={c.id} className="card stack-sm" aria-label={`Cave ${c.name}`}>
            <div className="between">
              <div>
                <h2 className="section">{c.name}</h2>
                <p className="small muted">
                  {STORAGES.find((s) => s.value === c.storage)?.label} · {count((l) => l.cellar_id === c.id)} bouteille(s)
                  {people.some((p) => p.status === 'active') ? ' · gérée à plusieurs' : ''}
                </p>
              </div>
              <span className="inline" style={{ flexWrap: 'nowrap' }}>
                <button type="button" className="icon-btn" aria-label={`Modifier ${c.name}`} onClick={() => setCellarSheet({ cellar: c })}>
                  <Pencil />
                </button>
                {own.length > 1 && (
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
            {locations(c)}
            <div className="stack-sm" aria-label={`Personnes associées à ${c.name}`}>
              <span className="strong small">Gérée aussi par</span>
              {people.length === 0 ? (
                <span className="small muted">Personne pour l’instant. Associez par exemple la personne avec qui vous partagez cette cave : chaque personne garde son compte.</span>
              ) : (
                <div className="list" style={{ boxShadow: 'none' }}>
                  {people.map((p) => (
                    <div key={p.user_id} className="row static" style={{ minHeight: 52 }}>
                      <Avatar name={p.user_name} seed={p.user_id} />
                      <span className="row-main">
                        <span className="row-title">{p.user_name}</span>
                        <span className="row-sub">
                          {p.status === 'active' ? `Gère la cave depuis le ${dateShort(p.joined_at ?? p.invited_at)}` : `Invitation envoyée le ${dateShort(p.invited_at)}`}
                        </span>
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={p.status === 'active' ? `Retirer ${p.user_name} de ${c.name}` : `Annuler l’invitation de ${p.user_name}`}
                        onClick={async () => {
                          if (
                            p.status === 'active' &&
                            !(await confirm({
                              title: `Retirer ${p.user_name} ?`,
                              message: `${p.user_name} n’aura plus accès à « ${c.name} ». Les bouteilles restent dans la cave, et l’historique garde ce qui a été fait à son nom.`,
                              confirmLabel: 'Retirer',
                              danger: true,
                            }))
                          )
                            return;
                          await run(() => api.removeCellarMember(c.id, p.user_id), { success: p.status === 'active' ? `${p.user_name} ne gère plus « ${c.name} »` : 'Invitation annulée' });
                        }}
                      >
                        {p.status === 'active' ? 'Retirer' : 'Annuler'}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <Button variant="secondary" size="sm" icon={<UserPlus />} onClick={() => setAssociate(c)}>
                Associer une personne
              </Button>
            </div>
          </section>
        );
      })}
      <Button variant="secondary" icon={<Plus />} onClick={() => setCellarSheet({})}>
        Ajouter une cave
      </Button>

      {shared.length > 0 && (
        <>
          <h2 className="section">Caves que je gère avec leur propriétaire</h2>
          {shared.map((c) => {
            const others = cellarPeople(c.id).filter((p) => p.status === 'active' && p.user_id !== userId);
            return (
              <section key={c.id} className="card stack-sm" aria-label={`Cave ${c.name} ${deName(profileName(c.owner_id))}`}>
                <div>
                  <h2 className="section">{c.name}</h2>
                  <p className="small muted">
                    Cave {deName(profileName(c.owner_id))}, gérée à plusieurs · {count((l) => l.cellar_id === c.id)} bouteille(s)
                    {others.length ? ` · avec ${others.map((p) => p.user_name).join(', ')}` : ''}
                  </p>
                </div>
                <p className="small">
                  Vous ajoutez, buvez, corrigez et rangez ses bouteilles comme les vôtres ; chaque mouvement est noté à votre nom. Le partage avec les amis, les
                  groupes et les événements reste choisi par {profileName(c.owner_id)}.
                </p>
                {locations(c)}
                <Button
                  variant="danger-ghost"
                  icon={<LogOut />}
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Quitter « ${c.name} » ?`,
                      message: `Vous n’y aurez plus accès. Les bouteilles restent dans la cave ${deName(profileName(c.owner_id))}, qui pourra vous associer de nouveau.`,
                      confirmLabel: 'Quitter cette cave',
                      danger: true,
                    });
                    if (ok) await run(() => api.removeCellarMember(c.id, userId), { success: `Vous ne gérez plus « ${c.name} »` });
                  }}
                >
                  Quitter cette cave
                </Button>
              </section>
            );
          })}
        </>
      )}

      {cellarSheet && <CellarSheet cellar={cellarSheet.cellar} onClose={() => setCellarSheet(null)} />}
      {locSheet && <LocationSheet cellarId={locSheet.cellarId} location={locSheet.location} onClose={() => setLocSheet(null)} />}
      {associate && <AssociateSheet cellar={associate} onClose={() => setAssociate(null)} />}
    </>
  );
}

/** Associer des amis à ma cave : ils reçoivent une invitation et gèrent la cave avec leur propre compte. */
function AssociateSheet({ cellar, onClose }: { cellar: Cellar; onClose: () => void }) {
  const { friends, api, run, cellarPeople } = useStore();
  const already = new Set(cellarPeople(cellar.id).map((p) => p.user_id));
  const candidates = friends.filter((f) => !already.has(f.id));
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Associer à « ${cellar.name} »`}
      footer={
        candidates.length ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Annuler
            </Button>
            <Button
              loading={busy}
              disabled={chosen.size === 0}
              onClick={async () => {
                setBusy(true);
                const res = await run(() => api.inviteToCellar(cellar.id, [...chosen]), {
                  success: `${chosen.size} invitation${chosen.size > 1 ? 's' : ''} envoyée${chosen.size > 1 ? 's' : ''}`,
                });
                setBusy(false);
                if (res.ok) onClose();
              }}
            >
              Associer
            </Button>
          </>
        ) : undefined
      }
    >
      {candidates.length === 0 ? (
        <EmptyState icon="🤝" title="Personne à associer">
          La personne doit avoir son propre compte et être en relation avec vous : ajoutez-la d’abord dans Amis & Groupes.
        </EmptyState>
      ) : (
        <div className="stack-sm">
          <p className="small muted">
            La personne gère cette cave avec vous, avec son propre compte : elle voit les bouteilles, en ajoute, en boit, corrige et range ; chaque action est
            notée à son nom. Vous restez propriétaire : la seule personne à pouvoir supprimer la cave ou retirer quelqu’un, et à choisir ce qui est partagé
            avec vos amis, vos groupes et vos événements.
          </p>
          {candidates.map((f) => (
            <Check
              key={f.id}
              checked={chosen.has(f.id)}
              onChange={(v) => setChosen((s) => (v ? new Set(s).add(f.id) : new Set([...s].filter((x) => x !== f.id))))}
              label={f.display_name}
            />
          ))}
        </div>
      )}
    </Sheet>
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

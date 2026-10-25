import { useState, type FormEvent } from 'react';
import { useStore } from '../../data/store';
import { fromLocalInput, parseNumber, toLocalInput } from '../../domain/format';
import type { CaveEvent, EventKind, MyGroup } from '../../domain/types';
import { EVENT_KINDS } from '../../domain/wine';
import { Advanced, Avatar, Button, Check, Chips, Field, Sheet } from '../../ui/kit';
import { go } from '../../ui/router';

function defaultStart() {
  const d = new Date(Date.now() + 7 * 86400_000);
  d.setHours(20, 0, 0, 0);
  return toLocalInput(d.toISOString());
}

/**
 * Nouvel événement ou modification. Avec « group » : soirée de ce groupe, ses membres sont proposés (et cochés) comme
 * invités, même s'ils ne sont pas vos amis. Sinon, les personnes en relation (amis et contacts) ; « preselect » : déjà
 * cochées.
 */
export function EventFormSheet({
  event,
  group,
  members,
  preselect,
  onClose,
}: {
  event?: CaveEvent;
  group?: MyGroup;
  members?: { user_id: string; display_name: string }[];
  preselect?: string[];
  onClose: () => void;
}) {
  const { api, run, friends } = useStore();
  const editing = Boolean(event);
  const people = group ? (members ?? []).map((m) => ({ id: m.user_id, display_name: m.display_name })) : friends;
  const [kind, setKind] = useState<EventKind>(event?.kind ?? 'diner');
  const [title, setTitle] = useState(event?.title ?? '');
  const [start, setStart] = useState(event ? toLocalInput(event.starts_at) : defaultStart());
  const [place, setPlace] = useState(event?.place ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [theme, setTheme] = useState(event?.theme ?? '');
  const [budget, setBudget] = useState(event?.budget !== null && event?.budget !== undefined ? String(event.budget) : '');
  const [guests, setGuests] = useState<string[]>(() => (group ? people.map((p) => p.id) : (preselect ?? [])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError('Donnez un titre à l’événement.');
    if (!start) return setError('Choisissez la date et l’heure.');
    if (budget && parseNumber(budget) === null) return setError('Le budget doit être un nombre.');
    setError(null);
    setBusy(true);
    const payload = {
      kind,
      title: title.trim(),
      starts_at: fromLocalInput(start),
      place: place.trim() || null,
      description: description.trim() || null,
      theme: theme.trim() || null,
      budget: parseNumber(budget),
      ...(group && !editing ? { group_id: group.id } : {}),
    };
    const res = await run(
      async () => {
        if (editing) {
          await api.updateEvent(event!.id, payload);
          return event!.id;
        }
        return (await api.createEvent(payload, guests)).id;
      },
      { success: editing ? 'Événement modifié' : group ? 'Soirée créée' : 'Événement créé' },
    );
    setBusy(false);
    if (res.ok) {
      onClose();
      if (!editing) go(`/evenements/${res.value}`);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={editing ? 'Modifier l’événement' : group ? `Nouvelle soirée « ${group.name} »` : 'Nouvel événement'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="event-form" loading={busy}>
            {editing ? 'Enregistrer' : 'Créer'}
          </Button>
        </>
      }
    >
      <form id="event-form" className="form" onSubmit={submit}>
        <Field label="Type">
          <Chips<EventKind> label="Type d’événement" value={kind} onChange={setKind} options={EVENT_KINDS.map((k) => ({ value: k.value, label: `${k.icon} ${k.label}` }))} />
        </Field>
        <Field label="Titre" htmlFor="ev-title">
          <input
            id="ev-title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={group ? 'Soirée raclette, dégustation à l’aveugle…' : 'Dîner chez nous, dégustation de Bourgognes…'}
            maxLength={100}
            required
          />
        </Field>
        <Field label="Date et heure" htmlFor="ev-start">
          <input id="ev-start" className="input" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
        </Field>
        <Field label="Lieu" htmlFor="ev-place">
          <input id="ev-place" className="input" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Chez moi, restaurant…" maxLength={200} />
        </Field>
        {!editing && (
          <Field
            label="Invités"
            hint={
              group
                ? `Les membres de « ${group.name} ». Vous pourrez en inviter d’autres ensuite.`
                : friends.length
                  ? 'Parmi vos amis et contacts : ils verront l’événement et ses vins, pas votre cave. Vous pourrez en inviter d’autres ensuite.'
                  : 'Ajoutez d’abord des personnes (onglet Amis : recherche ou lien d’invitation) pour les convier.'
            }
          >
            <div className="stack-sm">
              {people.map((f) => (
                <Check
                  key={f.id}
                  checked={guests.includes(f.id)}
                  onChange={(v) => setGuests((g) => (v ? [...g, f.id] : g.filter((x) => x !== f.id)))}
                  label={
                    <span className="inline">
                      <Avatar name={f.display_name} seed={f.id} size="sm" /> {f.display_name}
                    </span>
                  }
                />
              ))}
            </div>
          </Field>
        )}
        <Advanced title="Description, thème et budget (facultatif)" open={editing && Boolean(event?.description || event?.theme || event?.budget)}>
          <Field label="Description" htmlFor="ev-desc">
            <textarea id="ev-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
          </Field>
          <Field label="Thème" htmlFor="ev-theme">
            <input id="ev-theme" className="input" value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="Vins de Loire, millésime 2010…" maxLength={120} />
          </Field>
          <Field label="Budget (€)" htmlFor="ev-budget">
            <input id="ev-budget" className="input" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
          </Field>
        </Advanced>
        {error && (
          <p role="alert" style={{ color: 'var(--danger)', fontWeight: 650 }}>
            {error}
          </p>
        )}
      </form>
    </Sheet>
  );
}

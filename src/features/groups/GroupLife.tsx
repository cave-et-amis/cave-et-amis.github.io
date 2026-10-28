/**
 * Vie de groupe : soirées du groupe, notes de dégustation partagées, envies communes.
 * Les bouteilles restent à leurs propriétaires ; une bouteille mise à disposition du groupe et choisie pour sa soirée
 * est prise sur cette mise à disposition, et lui revient si elle n'est pas ouverte (la base y veille).
 */
import { useMemo, useState } from 'react';
import { BookOpen, CalendarPlus, Heart, Plus, Trash2, Users } from 'lucide-react';
import { useStore } from '../../data/store';
import { dateShort, eventDate, parseNumber } from '../../domain/format';
import type { Color, GroupMember, GroupNote, GroupWish, MyGroup } from '../../domain/types';
import { colorLabel, fold } from '../../domain/wine';
import { useActions } from '../../ui/Shell';
import { Button, EmptyState, Field, InlineLoading, Sheet, StarsView, useConfirm } from '../../ui/kit';
import { ColorChips } from '../cellar/fields';
import { WineNameField } from '../cellar/WineAssist';
import { EventFormSheet } from '../events/EventForm';

const wineLabel = (w: { wine_name: string; vintage: number | null }) => [w.wine_name, w.vintage].filter(Boolean).join(' ');

/** Soirées du groupe auxquelles je participe ; « Nouvelle soirée » invite les membres du groupe. */
export function GroupEvenings({ group, members }: { group: MyGroup; members: GroupMember[] | null }) {
  const { snapshot, userId } = useStore();
  const [creating, setCreating] = useState(false);
  const events = snapshot.events.filter((e) => e.group_id === group.id);
  const upcoming = events.filter((e) => e.status === 'planned').sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = events.filter((e) => e.status !== 'planned').sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  const guests = (members ?? []).filter((m) => m.status === 'active' && m.user_id !== userId);
  const row = (e: (typeof events)[number]) => (
    <a key={e.id} className="row" href={`#/evenements/${e.id}`}>
      <span className="row-main">
        <span className="row-title">{e.title}</span>
        <span className="row-sub">
          {eventDate(e.starts_at)}
          {e.place ? ` · ${e.place}` : ''}
          {e.status === 'cancelled' ? ' · annulée' : ''}
        </span>
      </span>
    </a>
  );
  return (
    <section className="stack-sm" aria-label="Soirées du groupe">
      <p className="small muted">
        Une soirée avec les membres du groupe : chacun peut y suggérer les bouteilles partagées dans le groupe, et leur propriétaire confirme. Celles mises à
        disposition du groupe sont prises en premier ; non ouvertes, elles lui reviennent.
      </p>
      <Button icon={<CalendarPlus />} disabled={!members} onClick={() => setCreating(true)}>
        Nouvelle soirée
      </Button>
      {events.length === 0 ? (
        <EmptyState icon="🥂" title="Pas encore de soirée">
          Organisez la première : les membres du groupe seront invités.
        </EmptyState>
      ) : (
        <>
          {upcoming.length > 0 && <div className="list">{upcoming.map(row)}</div>}
          {past.length > 0 && (
            <>
              <p className="strong small">Soirées passées</p>
              <div className="list">{past.map(row)}</div>
            </>
          )}
        </>
      )}
      {creating && <EventFormSheet group={group} members={guests} onClose={() => setCreating(false)} />}
    </section>
  );
}

/** Notes de dégustation partagées avec le groupe, et la moyenne des vins notés plusieurs fois. */
export function GroupNotes({ group, notes }: { group: MyGroup; notes: GroupNote[] | null }) {
  const actions = useActions();
  const averages = useMemo(() => {
    const m = new Map<string, { label: string; sum: number; n: number }>();
    for (const t of notes ?? []) {
      if (!t.rating) continue;
      const key = `${fold(t.wine_name)}|${t.vintage ?? ''}`;
      const cur = m.get(key) ?? { label: wineLabel(t), sum: 0, n: 0 };
      m.set(key, { ...cur, sum: cur.sum + t.rating, n: cur.n + 1 });
    }
    return [...m.values()].filter((x) => x.n > 1).sort((a, b) => b.sum / b.n - a.sum / a.n);
  }, [notes]);
  if (notes === null) return <InlineLoading />;
  return (
    <section className="stack-sm" aria-label="Notes du groupe">
      <p className="small muted">Les dégustations que les membres partagent avec le groupe : de quoi connaître les goûts de chacun.</p>
      <Button variant="secondary" icon={<BookOpen />} onClick={() => actions.newTasting({ group_id: group.id })}>
        Noter un vin pour le groupe
      </Button>
      {averages.length > 0 && (
        <div className="card soft stack-sm">
          <span className="strong small">Moyennes du groupe</span>
          {averages.map((a) => (
            <span key={a.label} className="between small">
              <span>{a.label}</span>
              <span>
                {(a.sum / a.n).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}/5 ({a.n} notes)
              </span>
            </span>
          ))}
        </div>
      )}
      {notes.length === 0 ? (
        <EmptyState icon="📝" title="Aucune note partagée">
          En notant un vin, choisissez « Partager avec un groupe » : la note apparaîtra ici pour les membres.
        </EmptyState>
      ) : (
        <div className="list">
          {notes.map((t) => (
            <div key={t.id} className="row static" style={{ alignItems: 'flex-start' }}>
              <span className="row-main">
                <span className="row-title" style={{ whiteSpace: 'normal' }}>
                  {wineLabel(t)}
                </span>
                <span className="row-sub" style={{ whiteSpace: 'normal' }}>
                  {t.mine ? 'Vous' : t.author_name} · {dateShort(t.tasted_on)}
                  {t.color ? ` · ${colorLabel(t.color)}` : ''}
                  {t.dish ? ` · avec ${t.dish}` : ''}
                </span>
                {t.comment && <span className="small muted">« {t.comment} »</span>}
              </span>
              <StarsView value={t.rating} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Envies communes : ce que le groupe aimerait goûter, avec « je participe ». */
export function GroupWishes({ group, wishes, onChange }: { group: MyGroup; wishes: GroupWish[] | null; onChange: () => void }) {
  const { api, run, userId } = useStore();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const canModerate = group.my_role === 'admin' || group.my_role === 'manager';
  if (wishes === null) return <InlineLoading />;
  return (
    <section className="stack-sm" aria-label="Envies communes">
      <p className="small muted">Les vins que le groupe aimerait goûter ensemble. « Je participe » indique qui suit l’idée (un futur achat groupé, par exemple).</p>
      <Button variant="secondary" icon={<Plus />} onClick={() => setAdding(true)}>
        Proposer une envie
      </Button>
      {wishes.length === 0 ? (
        <EmptyState icon="💭" title="Aucune envie commune">
          Proposez un vin à découvrir ensemble.
        </EmptyState>
      ) : (
        <div className="list">
          {wishes.map((w) => (
            <div key={w.id} className="row static" style={{ alignItems: 'flex-start' }}>
              <span className="row-main">
                <span className="row-title" style={{ whiteSpace: 'normal' }}>
                  {wineLabel(w)}
                </span>
                <span className="row-sub" style={{ whiteSpace: 'normal' }}>
                  {[w.producer, w.color ? colorLabel(w.color) : null, w.author_name ? `proposée par ${w.created_by === userId ? 'vous' : w.author_name}` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {w.note && <span className="small muted">« {w.note} »</span>}
                <span className="small" style={{ marginTop: 4 }}>
                  <Users aria-hidden style={{ width: 14, height: 14, verticalAlign: '-2px' }} /> {w.votes} participe{w.votes > 1 ? 'nt' : ''}
                  {w.voters.length ? ` : ${w.voters.join(', ')}` : ''}
                </span>
                <span className="inline" style={{ marginTop: 8 }}>
                  <Button
                    size="sm"
                    variant={w.voted ? 'soft' : 'secondary'}
                    icon={<Heart fill={w.voted ? 'currentColor' : 'none'} />}
                    aria-pressed={w.voted}
                    aria-label={`Je participe : ${wineLabel(w)}`}
                    onClick={async () => (await run(() => api.voteGroupWish(w.id, !w.voted), { reload: false })).ok && onChange()}
                  >
                    Je participe
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void run(() => api.addWish({ wine_name: w.wine_name, producer: w.producer, vintage: w.vintage, color: w.color, note: w.note }), {
                        success: 'Ajouté à votre liste d’envies',
                      })
                    }
                  >
                    Dans mes envies
                  </Button>
                  {(w.created_by === userId || canModerate) && (
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Retirer l’envie ${wineLabel(w)}`}
                      onClick={async () => {
                        if (!(await confirm({ title: 'Retirer cette envie ?', message: 'Elle disparaîtra pour tout le groupe.', confirmLabel: 'Retirer' }))) return;
                        if ((await run(() => api.deleteGroupWish(w.id), { success: 'Envie retirée', reload: false })).ok) onChange();
                      }}
                    >
                      <Trash2 />
                    </button>
                  )}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
      {adding && (
        <WishSheet
          group={group}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            onChange();
          }}
        />
      )}
    </section>
  );
}

function WishSheet({ group, onClose, onDone }: { group: MyGroup; onClose: () => void; onDone: () => void }) {
  const { api, run } = useStore();
  const [name, setName] = useState('');
  const [producer, setProducer] = useState('');
  const [vintage, setVintage] = useState('');
  const [color, setColor] = useState<Color | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Envie commune « ${group.name} »`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            loading={busy}
            onClick={async () => {
              if (!name.trim()) return setError('Indiquez le nom du vin.');
              const y = parseNumber(vintage);
              if (vintage && (!y || y < 1800 || y > 2100)) return setError('Le millésime doit être une année.');
              setError(null);
              setBusy(true);
              const res = await run(
                () => api.addGroupWish(group.id, { wine_name: name.trim(), producer: producer.trim() || null, vintage: y, color, note: note.trim() || null }),
                { success: 'Envie proposée au groupe', reload: false },
              );
              setBusy(false);
              if (res.ok) onDone();
            }}
          >
            Proposer
          </Button>
        </>
      }
    >
      <div className="form">
        <WineNameField
          id="gw-name"
          value={name}
          onChange={setName}
          placeholder="Château Montus, Champagne de vigneron…"
          onFields={(f) => {
            if (f.name) setName(f.name);
            if (f.producer) setProducer(f.producer);
            if (f.vintage) setVintage(String(f.vintage));
            if (f.color) setColor(f.color);
          }}
        />
        <div className="field-row">
          <Field label="Producteur (facultatif)" htmlFor="gw-prod">
            <input id="gw-prod" className="input" value={producer} onChange={(e) => setProducer(e.target.value)} maxLength={120} />
          </Field>
          <Field label="Millésime (facultatif)" htmlFor="gw-vintage">
            <input id="gw-vintage" className="input" inputMode="numeric" value={vintage} onChange={(e) => setVintage(e.target.value.replace(/\D/g, '').slice(0, 4))} />
          </Field>
        </div>
        <Field label="Couleur">
          <ColorChips value={color} onChange={setColor} />
        </Field>
        <Field label="Pourquoi ? (facultatif)" htmlFor="gw-note">
          <input id="gw-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Pour Noël, à partager à six…" />
        </Field>
        {error && (
          <p role="alert" style={{ color: 'var(--danger)', fontWeight: 650 }}>
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}

/**
 * Achats groupés (maquette Cave & Amis 2.0, panneau 11) : dans un groupe, une liste partagée de vins à acheter ensemble,
 * où chacun prend sa part puis la valide. Aucun paiement ne passe par l'application : les membres s'arrangent entre eux.
 * La base refuse une part qui dépasserait le nombre de bouteilles prévu, même si deux personnes la prennent en même temps.
 */
import { useCallback, useEffect, useState } from 'react';
import { Check as CheckIcon, Minus, Plus, ShoppingBasket, Trash2 } from 'lucide-react';
import { useStore } from '../../data/store';
import { money, parseNumber } from '../../domain/format';
import type { Color, GroupPurchase, MyGroup, PurchaseItem } from '../../domain/types';
import { Button, Check, EmptyState, Field, InlineLoading, Pill, Sheet, useConfirm } from '../../ui/kit';
import { ColorChips } from '../cellar/fields';
import { DocumentPhotoButton, WineNameField, type DocumentLine } from '../cellar/WineAssist';

const taken = (i: PurchaseItem) => i.parts.reduce((n, p) => n + p.bottles, 0);
const mine = (i: PurchaseItem) => i.parts.find((p) => p.mine)?.bottles ?? 0;

/** Montant engagé (parts prises × prix unitaire), participants et participants ayant tout validé. */
export function purchaseSummary(p: GroupPurchase) {
  const committed = p.items.reduce((sum, i) => sum + taken(i) * Number(i.unit_price), 0);
  const people = new Map<string, boolean>();
  for (const i of p.items) for (const part of i.parts) people.set(part.user_id, (people.get(part.user_id) ?? true) && part.validated);
  return { committed, participants: people.size, validated: [...people.values()].filter(Boolean).length };
}

export function GroupPurchases({ group }: { group: MyGroup }) {
  const { api, run, userId } = useStore();
  const confirm = useConfirm();
  const [list, setList] = useState<GroupPurchase[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const canModerate = group.my_role === 'admin' || group.my_role === 'manager';

  const refresh = useCallback(async () => setList(await api.groupPurchases(group.id)), [api, group.id]);
  useEffect(() => {
    void refresh().catch(() => setList([]));
  }, [refresh]);
  // Toujours relire après une action : une part refusée (« plus assez de bouteilles ») montre la liste à jour.
  const act = async (fn: () => Promise<void>, success?: string) => {
    await run(fn, { success, reload: false });
    await refresh().catch(() => undefined);
  };

  if (list === null) return <InlineLoading />;
  return (
    <section className="stack-sm" aria-label="Achats groupés">
      <p className="small muted">Une liste partagée pour acheter ensemble : chacun prend sa part et la valide. Aucun paiement ne passe par l’application.</p>
      <Button variant="secondary" icon={<Plus />} onClick={() => setCreating(true)}>
        Proposer un achat groupé
      </Button>
      {list.length === 0 && (
        <EmptyState icon="🧺" title="Aucun achat groupé">
          Une caisse à partager, une commande chez un vigneron : proposez-la au groupe.
        </EmptyState>
      )}
      {list.map((p) => {
        const s = purchaseSummary(p);
        const open = p.status === 'open';
        const myParts = p.items.flatMap((i) => i.parts.filter((x) => x.mine));
        const allMineValidated = myParts.length > 0 && myParts.every((x) => x.validated);
        const manage = p.mine || canModerate;
        return (
          <article key={p.id} className="card stack-sm purchase" aria-labelledby={`h-p-${p.id}`}>
            <div className="between">
              <span>
                <h3 id={`h-p-${p.id}`} style={{ margin: 0 }}>
                  Achat groupé · {p.title}
                </h3>
                <span className="small muted">
                  {s.participants} participant{s.participants > 1 ? 's' : ''} · proposé par {p.mine ? 'vous' : (p.author ?? 'un ancien membre')}
                </span>
              </span>
              <Pill tone={open ? 'success' : p.status === 'closed' ? 'gold' : undefined}>{open ? 'En cours' : p.status === 'closed' ? 'Clos' : 'Annulé'}</Pill>
            </div>
            {p.note && <p className="small">« {p.note} »</p>}
            <ul className="purchase-items">
              {p.items.map((i) => {
                const t = taken(i);
                const m = mine(i);
                return (
                  <li key={i.id}>
                    <img src={`/img/${i.color === 'blanc' ? 'bouteille-blanc' : i.color === 'rose' ? 'bouteille-rose' : i.color === 'effervescent' ? 'bouteille-effervescent' : 'bouteille-generique'}.webp`} alt="" />
                    <span className="purchase-item-main">
                      <span className="strong">
                        {i.wine_name}
                        {i.vintage ? ` ${i.vintage}` : ''}
                      </span>
                      <span className="small muted">
                        {i.bottles} bouteille{i.bottles > 1 ? 's' : ''} · {money(Number(i.unit_price) * i.bottles)} ({money(Number(i.unit_price))} l’unité)
                      </span>
                      <span className="purchase-bar" aria-hidden>
                        <i style={{ width: `${Math.min(100, (t / i.bottles) * 100)}%` }} />
                      </span>
                      {i.parts.length > 0 && (
                        <span className="small">
                          {i.parts.map((x) => `${x.mine ? 'vous' : x.name} ${x.bottles}${x.validated ? ' ✓' : ''}`).join(' · ')}
                        </span>
                      )}
                    </span>
                    <span className="purchase-item-side">
                      <span className="small strong">
                        {t}/{i.bottles}
                      </span>
                      {open && (
                        <span className="inline purchase-stepper">
                          <button type="button" className="icon-btn" aria-label={`Une bouteille de moins pour moi : ${i.wine_name}`} disabled={m === 0} onClick={() => void act(() => api.setPurchasePart(i.id, m - 1))}>
                            <Minus />
                          </button>
                          <span aria-label={`Ma part : ${m}`}>{m}</span>
                          <button type="button" className="icon-btn" aria-label={`Une bouteille de plus pour moi : ${i.wine_name}`} disabled={t >= i.bottles} onClick={() => void act(() => api.setPurchasePart(i.id, m + 1))}>
                            <Plus />
                          </button>
                        </span>
                      )}
                      {open && (i.created_by === userId || manage) && (
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Retirer ${i.wine_name} de l’achat`}
                          onClick={async () => {
                            if (await confirm({ title: 'Retirer ce vin de l’achat ?', message: 'Les parts prises sur ce vin sont retirées aussi.', confirmLabel: 'Retirer' }))
                              await act(() => api.removeGroupPurchaseItem(i.id), 'Vin retiré');
                          }}
                        >
                          <Trash2 />
                        </button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            {open && (
              <Button variant="secondary" size="sm" icon={<Plus />} onClick={() => setAdding(p.id)}>
                Ajouter une bouteille
              </Button>
            )}
            <div className="purchase-budget">
              <span className="between">
                <span className="strong">Engagé</span>
                <span>
                  <strong>{money(s.committed)}</strong>
                  {p.budget ? ` / ${money(Number(p.budget))}` : ''}
                </span>
              </span>
              {p.budget ? (
                <span className="purchase-bar" aria-hidden>
                  <i className={s.committed > Number(p.budget) ? 'over' : ''} style={{ width: `${Math.min(100, (s.committed / Number(p.budget)) * 100)}%` }} />
                </span>
              ) : null}
              <span className="small muted">
                Parts validées : {s.validated} sur {s.participants} participant{s.participants > 1 ? 's' : ''}
              </span>
            </div>
            {open && myParts.length > 0 && (
              <Button size="sm" variant={allMineValidated ? 'ghost' : 'primary'} icon={<CheckIcon />} onClick={() => void act(() => api.validatePurchaseParts(p.id, !allMineValidated), allMineValidated ? 'Validation annulée' : 'Parts validées')}>
                {allMineValidated ? 'Annuler ma validation' : 'Valider mes parts'}
              </Button>
            )}
            {manage && (
              <span className="inline">
                {open ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => void act(() => api.setGroupPurchaseStatus(p.id, 'closed'), 'Achat clos')}>
                      Clore l’achat
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void act(() => api.setGroupPurchaseStatus(p.id, 'cancelled'), 'Achat annulé')}>
                      Annuler
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => void act(() => api.setGroupPurchaseStatus(p.id, 'open'), 'Achat rouvert')}>
                    Rouvrir
                  </Button>
                )}
              </span>
            )}
            <p className="small faint eyebrow" style={{ margin: 0 }}>
              Sans paiement dans l’application
            </p>
          </article>
        );
      })}
      {creating && (
        <PurchaseSheet
          onClose={() => setCreating(false)}
          onSave={async (title, budget, note, items) => {
            // L'achat, puis les vins lus sur la liste de prix (s'il y en a), dans l'ordre de la liste.
            await act(async () => {
              const p = await api.createGroupPurchase(group.id, { title, budget, note });
              for (const i of items) await api.addGroupPurchaseItem(p.id, i);
            }, items.length ? `Achat groupé proposé avec ${items.length} vin${items.length > 1 ? 's' : ''}` : 'Achat groupé proposé');
            setCreating(false);
          }}
        />
      )}
      {adding && (
        <ItemSheet
          onClose={() => setAdding(null)}
          onSave={async (item) => {
            await act(() => api.addGroupPurchaseItem(adding, item), 'Bouteille ajoutée à l’achat');
            setAdding(null);
          }}
        />
      )}
    </section>
  );
}

type NewItem = { wine_name: string; producer: string | null; vintage: number | null; color: string | null; unit_price: number; bottles: number };
type ListRow = DocumentLine & { key: number; selected: boolean; bottles: string };

function PurchaseSheet({ onClose, onSave }: { onClose: () => void; onSave: (title: string, budget: number | null, note: string | null, items: NewItem[]) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [budget, setBudget] = useState('');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<ListRow[]>([]);
  const b = budget.trim() ? parseNumber(budget) : null;
  const bad = Boolean(budget.trim()) && (b === null || b <= 0);
  // Vins lus sur la liste : seulement ceux cochés, avec un prix et un nombre de bouteilles valables.
  const items: NewItem[] = rows
    .filter((r) => r.selected && r.unit_price != null)
    .map((r) => ({ wine_name: r.wine_name, producer: r.producer, vintage: r.vintage, color: r.color, unit_price: r.unit_price!, bottles: parseNumber(r.bottles) ?? 0 }))
    .filter((i) => Number.isInteger(i.bottles) && i.bottles >= 1 && i.bottles <= 120);
  const patch = (key: number, p: Partial<ListRow>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...p } : r)));
  return (
    <Sheet
      open
      onClose={onClose}
      title="Proposer un achat groupé"
      footer={
        <Button disabled={!title.trim() || bad} icon={<ShoppingBasket />} onClick={() => void onSave(title.trim(), b, note.trim() || null, items)}>
          Proposer au groupe
        </Button>
      }
    >
      <div className="stack-sm">
        <DocumentPhotoButton
          kind="price_list"
          hint="La liste de prix d’un vigneron ou d’un caviste : Lia propose le titre et les vins, que vous cochez."
          onResult={(r) => {
            if (!title.trim()) setTitle(r.title ?? (r.seller ? `Commande chez ${r.seller}` : ''));
            if (!note.trim() && r.conditions) setNote(r.conditions);
            setRows(r.lines.map((l, key) => ({ ...l, key, selected: l.unit_price != null, bottles: String(l.quantity ?? 6) })));
          }}
        />
        {rows.length > 0 && (
          <div className="card soft stack-sm" role="group" aria-label="Vins lus sur la liste">
            <span className="small strong">Vins lus sur la liste : cochez ceux à proposer.</span>
            {rows.map((r) => (
              <div key={r.key} className="purchase-read-row">
                <Check
                  checked={r.selected}
                  onChange={(v) => patch(r.key, { selected: v })}
                  label={`${r.wine_name}${r.vintage ? ` ${r.vintage}` : ''}${r.unit_price != null ? ` · ${money(r.unit_price)}` : ' · prix illisible'}`}
                />
                {r.selected && (
                  <input
                    className="input"
                    inputMode="numeric"
                    aria-label={`Bouteilles à acheter : ${r.wine_name}`}
                    value={r.bottles}
                    onChange={(e) => patch(r.key, { bottles: e.target.value.replace(/\D/g, '').slice(0, 3) })}
                    style={{ width: 72 }}
                  />
                )}
              </div>
            ))}
            <p className="small faint">De 1 à 120 bouteilles par vin ; un vin sans prix lisible s’ajoute ensuite à la main.</p>
          </div>
        )}
        <Field label="Titre" hint="Par exemple : Bourgogne, Commande chez le vigneron.">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} autoFocus />
        </Field>
        <Field label="Budget total (facultatif)" error={bad ? 'Indiquez un montant, par exemple 500.' : undefined}>
          <input className="input" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </Field>
        <Field label="Note (facultatif)">
          <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
      </div>
    </Sheet>
  );
}

function ItemSheet({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (item: { wine_name: string; producer: string | null; vintage: number | null; color: string | null; unit_price: number; bottles: number }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [producer, setProducer] = useState('');
  const [vintage, setVintage] = useState('');
  const [color, setColor] = useState<Color | null>(null);
  const [price, setPrice] = useState('');
  const [bottles, setBottles] = useState('6');
  const p = parseNumber(price);
  const n = parseNumber(bottles);
  const v = vintage.trim() ? parseNumber(vintage) : null;
  const ok = name.trim() && p !== null && p >= 0 && n !== null && Number.isInteger(n) && n >= 1 && n <= 120 && (v === null || Number.isInteger(v));
  return (
    <Sheet
      open
      onClose={onClose}
      title="Ajouter une bouteille"
      footer={
        <Button disabled={!ok} onClick={() => void onSave({ wine_name: name.trim(), producer: producer.trim() || null, vintage: v, color, unit_price: p!, bottles: n! })}>
          Ajouter à l’achat
        </Button>
      }
    >
      <div className="stack-sm">
        <WineNameField
          id="gp-name"
          value={name}
          onChange={setName}
          onFields={(f) => {
            if (f.name) setName(f.name);
            if (f.producer) setProducer(f.producer);
            if (f.vintage) setVintage(String(f.vintage));
            if (f.color) setColor(f.color);
          }}
        />
        <Field label="Producteur (facultatif)">
          <input className="input" value={producer} onChange={(e) => setProducer(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Millésime (facultatif)">
          <input className="input" inputMode="numeric" value={vintage} onChange={(e) => setVintage(e.target.value)} maxLength={4} />
        </Field>
        <Field label="Couleur">
          <ColorChips value={color} onChange={setColor} />
        </Field>
        <Field label="Prix d’une bouteille">
          <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        <Field label="Nombre de bouteilles à acheter" hint="De 1 à 120 ; les membres se les partagent.">
          <input className="input" inputMode="numeric" value={bottles} onChange={(e) => setBottles(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}

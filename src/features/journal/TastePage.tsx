/**
 * Mes goûts (mission C de Cave & Amis 2.0) : ce que vous déclarez et ce que l'application déduit de votre carnet.
 * Consultable, corrigeable (écarter un trait déduit, modifier ses préférences) et effaçable. Lia s'en sert pour conseiller.
 */
import { useEffect, useMemo, useState } from 'react';
import { EyeOff, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { useStore } from '../../data/store';
import { money, parseNumber } from '../../domain/format';
import { cleanPreferenceList, DISLIKED_UNTIL, kindLabel, LIKED_FROM, MAX_IGNORED, MIN_COUNT, tasteSummary, type TasteProfile, type Trait } from '../../domain/tasteProfile';
import { Button, EmptyState, Field, InlineLoading, Notice, useConfirm } from '../../ui/kit';
import { go } from '../../ui/router';

const splitList = (s: string) => cleanPreferenceList(s.split(/[,;\n]/));

function TraitRow({ t, onIgnore, disabled }: { t: Trait; onIgnore: () => void; disabled: boolean }) {
  return (
    <li className="between" style={{ gap: 8 }}>
      <span>
        <strong>{t.label}</strong> <span className="small muted">· {kindLabel(t.kind)} · {t.count} dégustations, {String(t.average).replace('.', ',')}/5 en moyenne</span>
      </span>
      <button type="button" className="icon-btn" aria-label={`Écarter « ${t.label} » de mon profil`} onClick={onIgnore} disabled={disabled}>
        <EyeOff />
      </button>
    </li>
  );
}

export function TastePage() {
  const { snapshot, api, run, userId, me } = useStore();
  const confirm = useConfirm();
  const [profile, setProfile] = useState<TasteProfile | null | undefined>(undefined);
  const [likes, setLikes] = useState('');
  const [dislikes, setDislikes] = useState('');
  const [budget, setBudget] = useState('');
  const [note, setNote] = useState('');

  const load = async () => {
    const p = await api.myTaste(userId);
    setProfile(p);
    setLikes((p?.likes ?? []).join(', '));
    setDislikes((p?.dislikes ?? []).join(', '));
    setBudget(p?.budget_max ? String(p.budget_max).replace('.', ',') : '');
    setNote(p?.note ?? '');
  };
  useEffect(() => {
    void load().catch(() => setProfile(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const ignored = profile?.ignored ?? [];
  const summary = useMemo(() => tasteSummary(snapshot.tastings, userId, ignored), [snapshot.tastings, userId, ignored]);

  if (profile === undefined) return <InlineLoading />;

  async function save(patch: Partial<TasteProfile>, success = 'Profil enregistré') {
    const res = await run(() => api.saveTaste(userId, patch), { success, reload: false });
    if (res.ok) await load();
  }

  /** Écarte un trait, à partir de la liste à jour (un autre onglet a pu en écarter d'autres). */
  async function ignore(t: Trait) {
    const latest = (await api.myTaste(userId).catch(() => null))?.ignored ?? ignored;
    if (latest.includes(t.key)) return load();
    await save({ ignored: [...latest, t.key] }, `« ${t.label} » écarté`);
  }

  async function erase() {
    const ok = await confirm({
      title: 'Effacer mon profil de goûts ?',
      message: 'Vos préférences déclarées et les traits écartés sont supprimés. Ce qui est déduit de votre carnet reste calculé à partir de vos dégustations.',
      confirmLabel: 'Effacer',
      danger: true,
    });
    if (!ok) return;
    const res = await run(() => api.deleteTaste(userId), { success: 'Profil effacé', reload: false });
    if (res.ok) await load();
  }

  const budgetValue = budget.trim() ? parseNumber(budget) : null;
  const budgetBad = Boolean(budget.trim()) && (budgetValue === null || budgetValue <= 0 || budgetValue >= 100000);
  const full = ignored.length >= MAX_IGNORED;

  return (
    <div className="stack">
      <section className="card stack-sm" aria-labelledby="h-deduit">
        <h2 id="h-deduit" className="section">
          Ce que votre carnet dit de vos goûts
        </h2>
        <p className="small muted">
          Calculé sur ce téléphone à partir de vos {summary.rated} dégustations notées : un trait est retenu s’il revient au moins {MIN_COUNT} fois, à
          partir de {LIKED_FROM}/5 en moyenne (« vous aimez ») ou jusqu’à {String(DISLIKED_UNTIL).replace('.', ',')}/5 (« vous aimez moins »).
          C’est une estimation, pas un jugement.
        </p>
        {summary.liked.length === 0 && summary.disliked.length === 0 ? (
          <EmptyState icon="📓" title="Pas encore assez de dégustations notées">
            Notez vos vins dans le carnet : votre profil se construira de lui-même.
          </EmptyState>
        ) : (
          <>
            {summary.liked.length > 0 && (
              <>
                <span className="strong small">Vous aimez</span>
                <ul className="stack-sm" style={{ listStyle: 'none', padding: 0 }}>
                  {summary.liked.map((t) => (
                    <TraitRow key={t.key} t={t} disabled={full} onIgnore={() => void ignore(t)} />
                  ))}
                </ul>
              </>
            )}
            {summary.disliked.length > 0 && (
              <>
                <span className="strong small">Vous aimez moins</span>
                <ul className="stack-sm" style={{ listStyle: 'none', padding: 0 }}>
                  {summary.disliked.map((t) => (
                    <TraitRow key={t.key} t={t} disabled={full} onIgnore={() => void ignore(t)} />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
        {full && <Notice tone="warn">Vous avez écarté {MAX_IGNORED} traits, le maximum : rétablissez-les pour en écarter d’autres.</Notice>}
        {ignored.length > 0 && (
          <Button variant="ghost" size="sm" icon={<RotateCcw />} onClick={() => void save({ ignored: [] }, 'Traits écartés rétablis')}>
            Rétablir les {ignored.length} trait(s) écarté(s)
          </Button>
        )}
      </section>

      <form
        className="card form"
        aria-labelledby="h-declare"
        onSubmit={(e) => {
          e.preventDefault();
          void save({ likes: splitList(likes), dislikes: splitList(dislikes), budget_max: budgetValue, note: note.trim() || null });
        }}
      >
        <h2 id="h-declare" className="section">
          Ce que vous nous dites
        </h2>
        <p className="small muted">Vos préférences passent avant ce que le carnet laisse deviner. Elles restent privées : seule Lia les lit, pour vous conseiller.</p>
        <Field label="J’aime (séparez par des virgules)" hint="Exemples : pinot noir, Bourgogne, vins frais, bulles.">
          <input className="input" value={likes} onChange={(e) => setLikes(e.target.value)} maxLength={800} />
        </Field>
        <Field label="J’aime moins">
          <input className="input" value={dislikes} onChange={(e) => setDislikes(e.target.value)} maxLength={800} />
        </Field>
        <Field label={`Budget habituel par bouteille (${me.currency ?? 'EUR'})`} error={budgetBad ? 'Indiquez un montant entre 1 et 99 999, par exemple 25.' : undefined}>
          <input className="input" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </Field>
        <Field label="Autre chose à savoir (facultatif)">
          <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
        {profile?.budget_max ? <p className="small muted">Budget enregistré : {money(profile.budget_max, me.currency ?? 'EUR')}.</p> : null}
        <Button type="submit" disabled={budgetBad}>
          Enregistrer mes préférences
        </Button>
      </form>

      <section className="card stack-sm" aria-labelledby="h-gouts-actions">
        <h2 id="h-gouts-actions" className="section">
          Avec Lia
        </h2>
        <Notice>Lia lit ce profil quand vous lui demandez un conseil. Elle ne le partage avec personne.</Notice>
        <Button variant="secondary" icon={<Sparkles />} onClick={() => go('/assistant?q=' + encodeURIComponent('Que me conseilles-tu de boire ce soir, d’après mes goûts ?'))}>
          Demander un conseil à Lia
        </Button>
        {profile && (
          <Button variant="ghost" icon={<Trash2 />} onClick={() => void erase()}>
            Effacer mon profil de goûts
          </Button>
        )}
      </section>
    </div>
  );
}

/**
 * Mes goûts (mission C de Cave & Amis 2.0) : ce que vous déclarez et ce que l'application déduit de votre carnet.
 * Consultable, corrigeable (écarter un trait déduit, modifier ses préférences) et effaçable. Lia s'en sert pour conseiller.
 */
import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Sparkles, Trash2, X } from 'lucide-react';
import { useStore } from '../../data/store';
import { money, parseNumber } from '../../domain/format';
import { cleanPreferenceList, DISLIKED_UNTIL, kindLabel, LIKED_FROM, MAX_IGNORED, MIN_COUNT, tasteRadar, tasteSummary, type TasteProfile, type TasteRadar, type Trait } from '../../domain/tasteProfile';
import { Button, EmptyState, Field, InlineLoading, Notice, useConfirm } from '../../ui/kit';
import { go } from '../../ui/router';

const splitList = (s: string) => cleanPreferenceList(s.split(/[,;\n]/));

/** Une puce de goût : le trait, son nombre de dégustations, et le bouton pour l'écarter du profil. */
function TraitChip({ t, tone, onIgnore, disabled }: { t: Trait; tone: 'liked' | 'disliked'; onIgnore: () => void; disabled: boolean }) {
  const detail = `${kindLabel(t.kind)} · ${t.count} dégustations, ${String(t.average).replace('.', ',')}/5 en moyenne`;
  return (
    <li className={`taste-chip ${tone}`} title={detail}>
      <span>
        {t.label} <span className="sr-only">({detail})</span>
      </span>
      <button type="button" aria-label={`Écarter « ${t.label} » de mon profil`} onClick={onIgnore} disabled={disabled}>
        <X aria-hidden />
      </button>
    </li>
  );
}

/** Radar à cinq axes (1 à 5). Un axe sans assez de notes reste au centre et s'affiche « — » dans la légende. */
function Radar({ radar }: { radar: TasteRadar }) {
  const n = radar.axes.length;
  const R = 78;
  const point = (i: number, v: number) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [120 + Math.cos(a) * R * (v / 5), 110 + Math.sin(a) * R * (v / 5)] as const;
  };
  const ring = (v: number) => radar.axes.map((_, i) => point(i, v).join(',')).join(' ');
  const shape = radar.axes.map((ax, i) => point(i, ax.value ?? 0).join(',')).join(' ');
  return (
    <div className="radar">
      <svg viewBox="0 0 240 220" aria-hidden>
        {[1, 2, 3, 4, 5].map((v) => (
          <polygon key={v} className="radar-ring" points={ring(v)} />
        ))}
        {radar.axes.map((ax, i) => {
          const [x, y] = point(i, 5);
          const [lx, ly] = point(i, 6.3);
          return (
            <g key={ax.key}>
              <line className="radar-ring" x1="120" y1="110" x2={x} y2={y} />
              <text x={lx} y={ly} textAnchor={Math.abs(lx - 120) < 4 ? 'middle' : lx > 120 ? 'start' : 'end'} dominantBaseline="middle">
                {ax.label}
              </text>
            </g>
          );
        })}
        <polygon className="radar-shape" points={shape} />
        {radar.axes.map((ax, i) =>
          ax.value === null ? null : <circle key={ax.key} className="radar-dot" cx={point(i, ax.value)[0]} cy={point(i, ax.value)[1]} r="3.5" />,
        )}
      </svg>
      <ul className="radar-legend small">
        {radar.axes.map((ax) => (
          <li key={ax.key}>
            <span className="muted">{ax.label}</span> <strong>{ax.value === null ? '—' : `${String(ax.value).replace('.', ',')}/5`}</strong>
          </li>
        ))}
      </ul>
    </div>
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
  const radar = useMemo(() => tasteRadar(snapshot.tastings, userId), [snapshot.tastings, userId]);
  const radarReady = radar.axes.filter((a) => a.value !== null).length >= 3;

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
        <div className="taste-head">
          <img src="/img/lia-avatar.webp" alt="" width={44} height={44} />
          <div>
            <h2 id="h-deduit" className="section" style={{ margin: 0 }}>
              Ce que votre carnet dit de vos goûts
            </h2>
            <span className="small muted">
              Votre profil, d’après {summary.rated} dégustation{summary.rated > 1 ? 's' : ''} notée{summary.rated > 1 ? 's' : ''}
            </span>
          </div>
        </div>
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
                <span className="eyebrow">Vous aimez</span>
                <ul className="taste-chips">
                  {summary.liked.map((t) => (
                    <TraitChip key={t.key} t={t} tone="liked" disabled={full} onIgnore={() => void ignore(t)} />
                  ))}
                </ul>
              </>
            )}
            {summary.disliked.length > 0 && (
              <>
                <span className="eyebrow">Vous aimez moins</span>
                <ul className="taste-chips">
                  {summary.disliked.map((t) => (
                    <TraitChip key={t.key} t={t} tone="disliked" disabled={full} onIgnore={() => void ignore(t)} />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
        <h3 className="eyebrow" style={{ marginTop: 8 }}>
          Profil des vins que vous aimez
        </h3>
        {radarReady ? (
          <>
            <Radar radar={radar} />
            <p className="small faint">
              Moyenne de vos repères (fruité, puissance, boisé, acidité, minéralité) sur les vins notés {LIKED_FROM}/5 ou plus ; un axe compte à partir de{' '}
              {MIN_COUNT} notes.
            </p>
          </>
        ) : (
          <p className="small muted">
            Le radar apparaîtra quand au moins trois repères auront {MIN_COUNT} notes sur des vins que vous avez aimés. Notez-les dans « Observations
            guidées » de vos fiches de dégustation.
          </p>
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

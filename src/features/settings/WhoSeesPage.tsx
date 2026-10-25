/**
 * Réglages › Confidentialité › « Qui voit ma cave » : toutes mes relations, cave ouverte ou fermée, bouteilles visibles,
 * exceptions et niveau de détail (mêmes règles que la vue servie à chacun) ; « Fermer ma cave à tout le monde ».
 */
import { ChevronRight, Lock } from 'lucide-react';
import { useStore } from '../../data/store';
import { Avatar, Button, Check, EmptyState, Pill, useConfirm } from '../../ui/kit';

export function WhoSeesPage() {
  const { snapshot, api, run } = useStore();
  const confirm = useConfirm();
  const relations = snapshot.relations;
  const open = relations.filter((r) => r.they_see_mine);

  if (relations.length === 0) {
    return (
      <EmptyState icon="🔒" title="Personne ne voit votre cave">
        Vous n’êtes encore en relation avec personne. Votre cave reste privée tant que vous ne l’ouvrez pas à quelqu’un.
      </EmptyState>
    );
  }

  return (
    <>
      <p className="small muted">
        Votre cave n’est jamais publique. Une personne ne la voit que si vous la lui ouvrez, et seulement les bouteilles partagées avec vos amis (ou montrées à elle
        seule). Fermer votre cave ne touche ni à la relation, ni aux groupes, ni aux événements.
      </p>
      <div className="list" aria-label="Qui voit ma cave">
        {relations.map((r) => (
          <div key={r.user_id} className="row static" style={{ alignItems: 'flex-start' }}>
            <Avatar name={r.display_name} seed={r.user_id} />
            <span className="row-main">
              <a className="row-title" href={`#/amis/${r.user_id}?onglet=moi`}>
                {r.display_name}
              </a>
              <span className="row-sub" style={{ whiteSpace: 'normal' }}>
                {r.they_see_mine
                  ? `Voit ${r.visible_lots} vin${r.visible_lots > 1 ? 's' : ''} (${r.visible_bottles} bouteille${r.visible_bottles > 1 ? 's' : ''})`
                  : 'Cave fermée'}
                {r.exceptions > 0 ? ` · ${r.exceptions} exception${r.exceptions > 1 ? 's' : ''}` : ''}
              </span>
              {r.they_see_mine && <span className="badges">{r.detail_level === 'restricted' ? <Pill tone="warn">Restreint</Pill> : <Pill>Standard</Pill>}</span>}
            </span>
            <span className="row-side" style={{ alignItems: 'center', flexDirection: 'row', gap: 4 }}>
              <Check
                checked={r.they_see_mine}
                onChange={async (v) => {
                  if (v) {
                    await run(() => api.grantCellarAccess(r.user_id), { success: `Votre cave est ouverte à ${r.display_name}` });
                    return;
                  }
                  const ok = await confirm({
                    title: `Fermer votre cave à ${r.display_name} ?`,
                    message: `${r.display_name} ne verra plus aucune bouteille de votre cave. Vous restez en contact.`,
                    confirmLabel: 'Fermer ma cave',
                    danger: true,
                  });
                  if (ok) await run(() => api.revokeCellarAccess(r.user_id), { success: `Votre cave est fermée à ${r.display_name}` });
                }}
                label={<span className="sr-only">Ma cave ouverte à {r.display_name}</span>}
              />
              <a className="icon-btn" href={`#/amis/${r.user_id}?onglet=moi`} aria-label={`Ce que ${r.display_name} voit de moi`}>
                <ChevronRight />
              </a>
            </span>
          </div>
        ))}
      </div>
      <Button
        variant="danger-ghost"
        icon={<Lock />}
        disabled={open.length === 0}
        onClick={async () => {
          const ok = await confirm({
            title: 'Fermer votre cave à tout le monde ?',
            message: `${open.length} personne${open.length > 1 ? 's' : ''} ne ${open.length > 1 ? 'verront' : 'verra'} plus aucune bouteille de votre cave. Vos relations, vos groupes et vos événements ne changent pas ; vous pourrez rouvrir votre cave à chacun.`,
            confirmLabel: 'Fermer à tout le monde',
            danger: true,
          });
          if (ok) await run(() => api.closeCellarToEveryone(), { success: 'Votre cave est fermée à tout le monde' });
        }}
      >
        Fermer ma cave à tout le monde
      </Button>
    </>
  );
}

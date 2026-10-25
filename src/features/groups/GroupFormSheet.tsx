/** Création ou modification d'un groupe : nom, emoji, photo, description ; à la création, amis à inviter. */
import { useRef, useState, type FormEvent } from 'react';
import { useStore } from '../../data/store';
import type { MyGroup } from '../../domain/types';
import { Button, Check, Field, Sheet, useConfirm } from '../../ui/kit';
import { go } from '../../ui/router';
import { PhotoField } from '../cellar/fields';
import { GROUP_EMOJIS } from './common';

export function GroupFormSheet({ group, preselect, onClose }: { group?: MyGroup; preselect?: string[]; onClose: () => void }) {
  const { api, run, friends, userId } = useStore();
  const confirm = useConfirm();
  const editing = Boolean(group);
  const [name, setName] = useState(group?.name ?? '');
  const [emoji, setEmoji] = useState(group?.emoji ?? GROUP_EMOJIS[0]);
  const [description, setDescription] = useState(group?.description ?? '');
  const [photo, setPhoto] = useState<string | null>(group?.photo ?? null);
  const [invite, setInvite] = useState<Set<string>>(new Set(preselect ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploaded = useRef<string[]>([]);
  const saved = useRef(false);

  function close() {
    // Photos envoyées puis abandonnées (formulaire annulé ou photo remplacée) : supprimées.
    const unused = uploaded.current.filter((p) => !saved.current || p !== photo);
    if (unused.length) void api.removePhotos(unused).catch(() => undefined);
    onClose();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Donnez un nom au groupe.');
    setError(null);
    setBusy(true);
    if (editing) {
      const res = await run(() => api.updateGroup(group!.id, { name: name.trim(), emoji, description: description.trim() || null, photo }), { success: 'Groupe modifié' });
      setBusy(false);
      if (res.ok) {
        saved.current = true;
        // Ancienne photo remplacée ou retirée : supprimée si elle est dans mon dossier.
        if (group!.photo && group!.photo !== photo && group!.photo.startsWith(`${userId}/`)) void api.removePhotos([group!.photo]).catch(() => undefined);
        close();
      }
      return;
    }
    const res = await run(() => api.createGroup({ name: name.trim(), emoji, description: description.trim() || null, photo, invite: [...invite] }), {
      success: invite.size ? `Groupe créé, ${invite.size} invitation${invite.size > 1 ? 's' : ''} envoyée${invite.size > 1 ? 's' : ''}` : 'Groupe créé',
    });
    setBusy(false);
    if (res.ok) {
      saved.current = true;
      close();
      go(`/groupes/${res.value.id}`);
    }
  }

  return (
    <Sheet
      open
      onClose={close}
      title={editing ? 'Modifier le groupe' : 'Nouveau groupe'}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Annuler
          </Button>
          <Button type="submit" form="group-form" loading={busy}>
            {editing ? 'Enregistrer' : 'Créer le groupe'}
          </Button>
        </>
      }
    >
      <form id="group-form" className="form" onSubmit={submit}>
        <Field label="Nom du groupe" htmlFor="g-name" hint="Par exemple : Les soirées entre amis, La famille, Les grandes occasions.">
          <input id="g-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required data-autofocus />
        </Field>
        <Field label="Emoji">
          <div className="chips" role="group" aria-label="Emoji du groupe">
            {GROUP_EMOJIS.map((em) => (
              <button key={em} type="button" className="chip emoji-choice" aria-pressed={emoji === em} aria-label={`Emoji ${em}`} onClick={() => setEmoji(em)}>
                {em}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Description (facultatif)" htmlFor="g-desc">
          <textarea id="g-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        </Field>
        <PhotoField label="Photo du groupe (facultatif)" path={photo} onChange={setPhoto} onUploaded={(p) => uploaded.current.push(p)} />
        {!editing && (
          <Field label="Inviter des amis">
            {friends.length === 0 ? (
              <p className="small muted">Vous pourrez inviter vos amis plus tard, depuis la page du groupe.</p>
            ) : (
              friends.map((f) => (
                <Check
                  key={f.id}
                  checked={invite.has(f.id)}
                  onChange={(v) => setInvite((s) => (v ? new Set(s).add(f.id) : new Set([...s].filter((x) => x !== f.id))))}
                  label={f.display_name}
                />
              ))
            )}
          </Field>
        )}
        {editing && (
          <Button
            variant="danger-ghost"
            onClick={async () => {
              const ok = await confirm({
                title: `Supprimer « ${group!.name} » ?`,
                message: 'Le groupe, ses membres et son activité seront supprimés. Les bouteilles restent dans la cave de leurs propriétaires.',
                confirmLabel: 'Supprimer le groupe',
                danger: true,
              });
              if (!ok) return;
              const res = await run(() => api.deleteGroup(group!.id), { success: 'Groupe supprimé' });
              if (res.ok) {
                saved.current = true;
                onClose();
                go('/amis?onglet=groupes', { replace: true });
              }
            }}
          >
            Supprimer le groupe
          </Button>
        )}
        {error && (
          <p role="alert" style={{ color: 'var(--danger)', fontWeight: 650 }}>
            {error}
          </p>
        )}
      </form>
    </Sheet>
  );
}

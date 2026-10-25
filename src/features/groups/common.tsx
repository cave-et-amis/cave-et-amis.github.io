/** Éléments communs aux groupes : vignette (photo ou emoji), libellés des rôles, emojis proposés. */
import { usePhotoUrl } from '../../data/photos';
import { useStore } from '../../data/store';
import type { GroupRole, MyGroup } from '../../domain/types';

export const GROUP_EMOJIS = ['🍷', '🥂', '🍾', '🎉', '👨‍👩‍👧', '🧀', '🍇', '🏰', '🌿', '⭐'];

export const ROLE_LABELS: Record<GroupRole, string> = { admin: 'Administrateur', manager: 'Gestionnaire', member: 'Membre' };

export function GroupAvatar({ group, size = 44 }: { group: Pick<MyGroup, 'emoji' | 'photo' | 'name'>; size?: number }) {
  const { api } = useStore();
  const url = usePhotoUrl(api, group.photo);
  return (
    <span className="group-avatar" style={{ width: size, height: size, fontSize: size * 0.5 }} aria-hidden>
      {url ? <img src={url} alt="" /> : group.emoji}
    </span>
  );
}

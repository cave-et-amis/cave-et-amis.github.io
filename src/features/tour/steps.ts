/**
 * Étapes de la visite guidée. Chaque étape met en évidence un élément réel de l'interface, repéré par son attribut
 * data-tour, après être allée sur la bonne page. La liste s'adapte à la personne (administration, assistant, groupes).
 */
export type TourStep = { id: string; title: string; text: string; target: string; route?: string };

export function tourSteps(o: { admin: boolean; assistant: boolean; hasGroups: boolean }): TourStep[] {
  const steps: TourStep[] = [
    {
      id: 'accueil',
      route: '/',
      target: 'accueil',
      title: 'Votre tableau de bord',
      text: 'L’essentiel d’un coup d’œil : vos bouteilles, celles à ouvrir bientôt, votre prochain événement et des raccourcis.',
    },
    {
      id: 'cave',
      route: '/',
      target: 'nav-cave',
      title: 'Votre cave',
      text: 'Votre inventaire : recherche, filtres, emplacements. Tout est privé tant que vous ne choisissez pas de partager.',
    },
    {
      id: 'ajouter',
      route: '/',
      target: 'ajouter',
      title: 'Ajouter une bouteille',
      text: 'Photographiez une étiquette (Lia remplit la fiche pour vous) ou saisissez un vin en quelques champs.',
    },
    {
      id: 'lia',
      route: '/',
      target: 'lia',
      title: 'Lia, votre sommelière',
      text: o.assistant
        ? 'Demandez-lui quel vin ouvrir, avec quel plat… ou comment utiliser l’application. Elle ne modifie rien sans votre accord.'
        : 'Lia, l’assistante, n’est pas disponible pour le moment ; tout le reste de l’application fonctionne normalement.',
    },
    {
      id: 'inviter',
      route: '/amis',
      target: 'inviter',
      title: 'Inviter quelqu’un',
      text: 'Un lien par WhatsApp, SMS, e-mail ou QR code. Découvrir l’application ne donne jamais accès à votre cave : vous l’ouvrez à qui vous voulez.',
    },
    {
      id: 'groupes',
      route: '/amis?onglet=groupes',
      target: 'creer-groupe',
      title: o.hasGroups ? 'Vos groupes' : 'Créer ou rejoindre un groupe',
      text: 'Famille, amis du vendredi… Un groupe partage quelques bouteilles et prépare ses soirées. On y entre sur invitation.',
    },
    {
      id: 'evenements',
      route: '/evenements',
      target: 'organiser',
      title: 'Organiser un événement',
      text: 'Un dîner, une dégustation : invitez, choisissez les vins ensemble ; chaque propriétaire confirme ses bouteilles.',
    },
  ];
  if (o.admin) {
    steps.push({
      id: 'reglages',
      route: '/',
      target: 'reglages',
      title: 'Réglages et administration',
      text: 'Votre profil, la confidentialité (« Qui voit ma cave »)… et, comme administrateur, les réglages de l’assistant.',
    });
  }
  steps.push({
    id: 'aide',
    route: '/',
    target: 'aide',
    title: 'L’aide, à tout moment',
    text: 'Le bouton « ? » ouvre l’aide de la page où vous êtes, avec Lia pour vos questions. Cette visite se revoit dans les Réglages.',
  });
  return steps;
}

/** L'élément visible repéré par data-tour (la navigation existe en double : barre du bas et barre latérale). */
export function tourTarget(id: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') return el;
  }
  return null;
}

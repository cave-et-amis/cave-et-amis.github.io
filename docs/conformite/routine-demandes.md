# Répondre aux demandes reçues sur cocon.cave@gmail.com

Projet rédigé le 27/10/2026. Ce n'est pas un avis juridique. Chaque mention « [À VALIDER : …] » est un point juridique à faire vérifier par un juriste.

L'adresse cocon.cave@gmail.com est commune à Cave & Amis et Cocon. La politique de confidentialité promet : « Une réponse vous est apportée dans un délai d'un mois. » [À VALIDER : délai d'un mois, et prolongation possible de deux mois pour une demande complexe, en prévenant la personne dans le premier mois (article 12, paragraphe 3, du RGPD)]

## La routine

**Chaque semaine** (par exemple le dimanche), ouvrir la boîte cocon.cave@gmail.com :

1. Pour chaque nouveau message qui parle de données personnelles, ajouter une ligne au suivi des demandes (`B:\Claude Project\conformite\suivi-des-demandes.md`, hors du dépôt public) : date de réception, application, type de demande, **date limite = réception + 1 mois**.
2. Répondre tout de suite par un accusé de réception (modèle plus bas).
3. Traiter les demandes dont la date limite approche.
4. Un message qui signale une fuite ou un accès anormal n'est pas une demande ordinaire : suivre aussitôt la procédure `docs/conformite/procedure-violation.md`.

## Vérifier que c'est bien la personne

- Le plus simple : la demande vient de l'adresse e-mail de son compte. On peut le vérifier dans Supabase › Authentication › Users, sans rien modifier.
- Sinon, lui demander d'écrire depuis cette adresse, ou de faire la démarche elle-même depuis l'application quand c'est possible.
- Ne jamais demander de copie de pièce d'identité par défaut. [À VALIDER : justificatifs proportionnés à demander]
- Si la personne n'a pas de compte (elle est citée par quelqu'un), lui demander de quoi retrouver l'information (quel événement, quelle invitation) sans rien révéler de plus que ce qu'elle sait déjà.

## Par type de demande

| La personne demande… | Ce que l'application permet déjà | Ce que fait l'éditeur |
| --- | --- | --- |
| **Ses données** (accès, portabilité) | Réglages › Confidentialité et mes données › « Télécharger toutes mes données » (archive avec un fichier JSON et ses photos) | Lui indiquer le chemin. Si elle ne peut plus se connecter : voir avec une session Claude comment produire l'export sans rien modifier. |
| **Corriger** (rectification) | Elle corrige elle-même fiches, notes, événements, prénom, devise, et son adresse e-mail (Réglages › Mon profil › « Changer » : un lien à l'ancienne et un à la nouvelle adresse) | Lui indiquer le chemin. En dernier recours seulement (elle n'a plus accès à l'ancienne adresse), après vérification de son identité : Supabase › Authentication › Users. |
| **Effacer** | Elle supprime chaque élément, ou son compte entier (Réglages › Confidentialité et mes données ; mot de passe redemandé) | Lui indiquer le chemin. Si elle ne peut pas le faire elle-même : **ne rien supprimer à la main dans Supabase**. Une suppression par le tableau de bord ne ferait pas tout ce que fait l'application (photos, « Ancien membre » chez les autres, agenda Nous). Voir avec une session Claude la façon sûre de le faire. |
| **Retirer un consentement** | Recherche d'amis (Réglages), agenda Nous (délier), notifications (désactiver) | Lui indiquer le chemin. |
| **S'opposer ou limiter** | Rien dans l'application | Étudier la demande au cas par cas. [À VALIDER : conditions de l'opposition et de la limitation (articles 18 et 21 du RGPD)] |
| **Faire retirer une information qui la cite** (sans compte) | Rien : l'information est dans le compte d'une autre personne | Demander à l'auteur de la corriger, ou voir avec une session Claude, sans donner à la personne plus d'informations que ce qu'elle a cité. [À VALIDER : traitement de ces demandes] |
| **Directives après un décès** | Rien | [À VALIDER : directives post mortem (loi Informatique et Libertés)] |
| **Autre** (question générale) | — | Répondre simplement, en renvoyant vers la politique de confidentialité. |

Une sauvegarde faite avant une suppression peut encore contenir les données, jusqu'à son effacement (3 mois au plus) : le dire à la personne si elle le demande. [À VALIDER : traitement des sauvegardes lors d'un effacement]

## Refuser ou ne pas pouvoir répondre

Si la demande est refusée (identité non vérifiable, demande manifestement abusive), le dire à la personne dans le délai d'un mois, en expliquant pourquoi, et en lui rappelant qu'elle peut saisir la CNIL (www.cnil.fr). [À VALIDER : motifs de refus et mentions obligatoires de la réponse (article 12, paragraphes 4 et 5, du RGPD)]

## Modèles de réponse

**Accusé de réception**

> Bonjour,
>
> Nous avons bien reçu votre demande du [date] concernant vos données dans [Cave & Amis / Cocon]. Vous aurez une réponse au plus tard le [date limite].
>
> L'équipe de Cave & Amis et Cocon

**Export de ses données**

> Bonjour,
>
> Vous pouvez télécharger toutes vos données vous-même : dans Cave & Amis, ouvrez Réglages › Confidentialité et mes données, puis « Télécharger toutes mes données ». Vous obtenez une archive avec un fichier lisible par d'autres logiciels et vos photos.
>
> Si vous n'y arrivez pas, répondez à ce message.

**Suppression du compte**

> Bonjour,
>
> Vous pouvez supprimer votre compte vous-même : Réglages › Confidentialité et mes données › « Supprimer mon compte ». Votre mot de passe vous sera demandé. Pensez à télécharger vos données avant, si vous souhaitez les garder.
>
> Une sauvegarde faite avant la suppression peut encore contenir vos données pendant 3 mois au plus, puis elle est effacée.

[À VALIDER : formulation des modèles de réponse]

## À garder en tête

- Ne jamais transférer le message d'une personne à quelqu'un d'autre, ni la citer dans le dépôt GitHub.
- Ne jamais écrire de nom ni d'adresse e-mail dans les fichiers du dépôt : le suivi reste dans `B:\Claude Project\conformite\`.
- Une demande qui touche aussi Cocon se traite pour les deux applications, en une seule réponse.

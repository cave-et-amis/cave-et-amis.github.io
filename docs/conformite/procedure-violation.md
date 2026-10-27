# Que faire en cas de violation de données

Projet rédigé le 27/10/2026. Ce n'est pas un avis juridique. Chaque mention « [À VALIDER : …] » est un point juridique à faire vérifier par un juriste.

La politique de confidentialité annonce : « En cas de violation de données présentant un risque pour vous, la CNIL est prévenue dans les 72 heures et, si le risque est élevé, vous l'êtes aussi. » Cette procédure sert à tenir cette promesse.

## C'est quoi, une violation de données ?

Toute situation où des données personnelles de Cave & Amis sont perdues, détruites, modifiées, lues ou envoyées par quelqu'un qui n'aurait pas dû. Par exemple :

- une clé secrète publiée par erreur (sur GitHub, dans une capture d'écran, dans un message) ;
- une règle d'accès qui laisse une personne voir la cave, les notes ou les conversations d'une autre ;
- un compte administrateur utilisé par quelqu'un d'autre ;
- une sauvegarde, ou son mot de passe, perdue ou volée (PC volé, clé USB perdue) ;
- des données effacées par erreur sans sauvegarde pour les retrouver ;
- un prestataire (Supabase, GitHub, Anthropic…) qui annonce un incident touchant le projet.

[À VALIDER : définition (article 4, point 12, du RGPD)]

Même un doute compte : on note tout de suite dans le cahier des incidents, quitte à conclure ensuite que ce n'était rien.

## Le chrono : 72 heures

Le délai de 72 heures court à partir du moment où l'éditeur **a connaissance** de la violation, pas à partir du moment où elle a eu lieu. On note donc tout de suite la date et l'heure de la découverte. [À VALIDER : point de départ du délai (article 33 du RGPD)]

## Étape 1 : arrêter la fuite (dans l'heure)

Selon ce qui s'est passé, et seulement ce qui est utile :

- **Clé secrète exposée** : la remplacer chez le prestataire concerné (clé Anthropic dans la console Anthropic, clés du projet dans le tableau de bord Supabase, jeton de l'intégration Nous), puis mettre la nouvelle à sa place (secret Supabase). Ne jamais la recopier dans un message ni dans un fichier du dépôt.
- **Assistant en cause** : le désactiver depuis l'administration de l'assistant.
- **Inscriptions suspectes** : couper les nouvelles inscriptions dans Supabase (réglage « Allow new users to sign up »).
- **Compte détourné** : changer son mot de passe, puis « Déconnecter tous mes appareils » (Réglages).
- **Règle d'accès défaillante** : corriger la migration en cause, la tester et la mettre en ligne. Faire une sauvegarde avant (`scripts/sauvegarde.ps1`).
- **Ne rien supprimer** qui pourrait servir à comprendre ce qui s'est passé : journaux, lignes en base, messages du prestataire.

## Étape 2 : comprendre et noter (dans les 24 heures)

Remplir une fiche dans le cahier des incidents (`B:\Claude Project\conformite\cahier-des-incidents.md`, hors du dépôt public), avec :

1. la date et l'heure de la découverte, et comment on l'a découverte ;
2. ce qui s'est passé, et depuis quand (si on le sait) ;
3. les données touchées : lesquelles (voir le registre des traitements, T1 à T13), et combien de personnes, même approximativement ;
4. les conséquences possibles pour les personnes ;
5. ce qui a été fait pour arrêter la fuite, et quand.

Cette fiche se remplit **pour chaque incident, même petit**, même s'il n'est pas notifié à la CNIL. [À VALIDER : obligation de documenter toutes les violations (article 33, paragraphe 5, du RGPD)]

## Étape 3 : évaluer le risque pour les personnes

| Niveau | Exemples (à titre indicatif) | Que faire |
| --- | --- | --- |
| Pas de risque probable | Donnée chiffrée dont la clé n'a pas fui ; erreur corrigée avant que quiconque ait pu voir quoi que ce soit | Seulement la fiche du cahier |
| Risque | Une personne a pu voir la cave, les prix ou le carnet d'une autre ; adresses e-mail exposées | Fiche + **CNIL sous 72 heures** |
| Risque élevé | Conversations avec Lia, adresses d'événements ou habitudes de consommation exposées à grande échelle ; mots de passe hachés et e-mails publiés ensemble | Fiche + CNIL + **prévenir les personnes concernées** |

[À VALIDER : seuils de risque et exemples de ce tableau (articles 33 et 34 du RGPD)]

En cas de doute entre deux niveaux, choisir le plus élevé.

## Étape 4 : prévenir la CNIL (si risque)

- Par le téléservice de notification des violations sur le site de la CNIL (www.cnil.fr). [À VALIDER : adresse exacte du formulaire]
- Si tout n'est pas encore connu au bout de 72 heures, notifier quand même ce qu'on sait, puis compléter. Si la notification part après 72 heures, expliquer pourquoi. [À VALIDER : notification en plusieurs temps et justification du retard]
- Noter dans la fiche la date d'envoi et la référence donnée par la CNIL.

## Étape 5 : prévenir les personnes (si risque élevé)

- Écrire à chaque personne concernée depuis cocon.cave@gmail.com, avec des mots simples : ce qui s'est passé, les données touchées, ce qui a été fait, ce qu'elle peut faire (changer son mot de passe, se méfier des messages frauduleux…) et l'adresse de contact.
- Mettre les adresses en copie cachée, jamais en copie visible.
- Si Cocon est aussi touché (même responsable, même adresse de contact), un seul message pour les deux applications.

[À VALIDER : contenu obligatoire du message et cas où il n'est pas nécessaire (article 34 du RGPD)]

## Étape 6 : tirer les leçons

- Dans la fiche : la cause, la correction, et ce qui empêchera que cela recommence.
- Si une fonction ou un prestataire change : mettre à jour le registre des traitements et, si besoin, la politique de confidentialité (nouvelle version).
- Ajouter un test si le problème venait du code.

## Contacts utiles

- CNIL : www.cnil.fr
- Supabase, GitHub, Anthropic : depuis le tableau de bord de chaque compte. Leurs adresses figurent dans les mentions légales et la politique de confidentialité.
- Session Cocon : si l'incident touche aussi Nous ou Cocon.

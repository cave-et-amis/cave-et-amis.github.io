# Cave & Amis : questions pour un juriste

Document à transmettre à un juriste (RGPD et droit du numérique). Préparé le 27/10/2026.

## Le contexte en quelques lignes

- **Cave & Amis** est une application web gratuite, sans publicité, pour gérer sa cave à vin et la partager entre proches (famille et amis, sur invitation). Elle est publiée sur https://cave-et-amis.github.io.
- **L'éditeur** est un particulier, à titre non professionnel. Il est aussi le responsable de l'application **Cocon** (agenda familial « Nous »), qui peut être reliée à Cave & Amis. Les deux applications réunissent de 20 à 100 comptes, tous majeurs.
- **Hébergeurs et prestataires** : Supabase (base de données, région Francfort), GitHub Pages (site), Anthropic (intelligence artificielle de l'assistant « Lia »), Open Food Facts, services de notification des navigateurs. Brevo (e-mails) et Cloudflare Turnstile (anti-robots) sont prévus.
- **Les documents à relire** sont dans le dossier `docs/legal/` du dépôt : `cgu.md`, `confidentialite.md`, `mentions-legales.md` et `cookies.md`. Les documents internes sont dans `docs/conformite/` : `registre-des-traitements.md`, `procedure-violation.md` et `routine-demandes.md`. Chaque point à valider y est marqué « [À VALIDER : …] ».
- Ces textes ont été rédigés avec un assistant d'intelligence artificielle, à partir du fonctionnement réel de l'application. **Aucun n'a encore été relu par un juriste.** L'éditeur ne considère pas l'application comme conforme tant que ce n'est pas fait.

Pour chaque question : où elle se trouve, et ce qui est écrit aujourd'hui.

---

## A. Identité de l'éditeur et anonymat

1. **Option d'anonymat de la LCEN.** L'éditeur, non professionnel, ne publie que les coordonnées de ses hébergeurs. Ce recours est-il possible ici, la mention est-elle bien formulée, et faut-il vérifier que chaque hébergeur a bien reçu son identité ?
   *Mentions légales, « Éditeur ».*
2. **Directeur de la publication.** Comment le mentionner avec l'option d'anonymat ?
   *Mentions légales, « Directeur de la publication ».*
3. **Article 13 du RGPD et anonymat.** La politique de confidentialité doit-elle donner l'identité et les coordonnées du responsable, alors que les mentions légales s'en dispensent ? Une adresse e-mail dédiée (cocon.cave@gmail.com) suffit-elle ?
   *Politique de confidentialité, « Qui est responsable ».*
4. **Registre des traitements.** Ce registre est-il obligatoire pour un particulier dans cette situation ? Son contenu suffit-il, et faut-il y inscrire l'identité de l'éditeur, puisqu'il n'est pas publié en ligne ?
   *Registre, en-tête et fiche commune.*
5. **Délégué à la protection des données.** On considère qu'il n'est pas obligatoire. Est-ce exact ?
   *Politique, « Qui est responsable » ; registre.*

## B. Hébergeurs et mentions légales

6. **Numéro de téléphone des hébergeurs.** Ni GitHub (« We do not offer telephone support ») ni Supabase ne publient de numéro. Comment satisfaire l'exigence de la LCEN ?
   *Mentions légales, « Hébergement du site » et « Hébergement des données ».*
7. **Entité GitHub à citer.** GitHub, Inc. (San Francisco) selon ses conditions d'utilisation, ou GitHub B.V. (Amsterdam), citée dans sa déclaration de confidentialité ?
   *Mentions légales, « Hébergement du site ».*

## C. Contrats de sous-traitance et transferts hors de l'UE

8. **GitHub Customer Agreement.** Le 27/10/2026, l'éditeur a accepté pour son organisation GitHub la formule « Corporate » (GitHub Customer Agreement), qui contient le contrat de sous-traitance (DPA). GitHub présente cette formule comme destinée aux entreprises (« Best for businesses »), et la formule « Standard » aux particuliers (« Best for individuals »). Ce choix convient-il à un particulier ? Quel nom aurait dû être saisi comme entité signataire ? Faut-il revenir en arrière ?
   *Politique, « Prestataires » ; registre, « Sous-traitants ».*
9. **Services de notification (Google, Apple, Mozilla, Microsoft).** Ils transportent des notifications chiffrées qu'ils ne peuvent pas lire, et aucun contrat de sous-traitance n'est publié pour le Web Push. Quel est leur rôle (sous-traitant, destinataire, autre) ?
   *Politique, « Prestataires » ; registre, T5.*
10. **Open Food Facts.** Il reçoit un code-barres ou un nom de vin, sans identifiant de personne, ainsi que l'adresse IP des appareils qui affichent ses vignettes. Comment le qualifier ?
    *Registre, « Sous-traitants ».*
11. **Garanties de transfert.** Data Privacy Framework et clauses contractuelles types, d'après les pages des prestataires. La présentation est-elle suffisante ? (Les fiches du DPF seront revérifiées dans un navigateur avant publication.)
    *Politique, « Transferts hors de l'Union européenne ».*
12. **Conservation chez Anthropic.** Les pages d'Anthropic ne disent pas toutes la même chose : « supprimées sous 30 jours » ou « non conservées par défaut ». Quelle formulation retenir ?
    *Politique, « Lia, l'assistant » ; registre, T6.*
13. **Lieu de traitement chez Anthropic.** À préciser dans le registre.
    *Registre, « Sous-traitants ».*
14. **Prestataires à venir.** Ajouter Brevo et Cloudflare Turnstile à leur mise en service. Y a-t-il un point particulier à prévoir ?
    *Politique, « Les e-mails de connexion » et « Prestataires ».*

## D. Bases légales et nature des données

15. **Base légale de chaque traitement.** Exécution du contrat, consentement ou intérêt légitime : voir le registre, traitements T1 à T13. Sont-elles justes ?
    *Politique, « Les données traitées » ; registre.*
16. **Données d'autres personnes envoyées à Anthropic.** Quand une personne interroge l'assistant, les prénoms et des informations simples sur ses amis, les membres de ses groupes et les participants de ses événements peuvent être envoyés à Anthropic. Sur quelle base légale ?
    *Politique, « Lia » ; registre, T6.*
17. **Données des autres participants envoyées à l'agenda Nous.** La liaison repose sur le consentement de la personne qui relie ses comptes, mais elle transmet aussi les prénoms et réponses des autres participants. Quelle base légale ? (Changement décidé le 27/10/2026, pas encore en ligne : ces données ne seront plus visibles du foyer dans Nous, seulement de la personne reliée, et seront effacées 30 jours après la fin de l'événement. Le prénom de l'organisateur reste visible du foyer.)
    *Politique, « L'agenda Nous » ; registre, T9.*
18. **Preuves d'acceptation.** Base légale retenue : l'intérêt légitime. Est-ce juste ?
    *Politique, « Les preuves de vos choix » ; registre, T10.*
19. **Sauvegardes, journaux des hébergeurs, demandes et incidents.** Quelle base légale pour chacun ?
    *Registre, T11, T12 et T13.*
20. **Données sensibles ?** La cave et le carnet de dégustation révèlent des habitudes de consommation d'alcool. Sont-ce des données sensibles (article 9 du RGPD, par exemple des données de santé) ? Si oui, qu'est-ce que cela change ?
    *Registre, T2.*

## E. Durées de conservation

21. **Preuves gardées 5 ans** après la suppression du compte (identifiant, version et date seulement). Cette durée est-elle justifiée ?
    *Politique, « Combien de temps » ; registre, T10.*
22. **Comptes inactifs.** Aucune suppression automatique aujourd'hui. Faut-il en prévoir une, et au bout de combien de temps ?
    *Politique, « Combien de temps ».*
23. **Journaux des hébergeurs.** Supabase affiche « 1 day » pour son offre gratuite, sans préciser s'il s'agit du stockage ou de la consultation. GitHub ne publie aucune durée. La formulation de la politique est-elle acceptable ?
    *Politique, « Combien de temps » ; registre, T12.*
24. **Suivi des demandes et cahier des incidents.** Combien de temps les garder ?
    *Registre, T13.*
25. **Sauvegardes et effacement.** Une sauvegarde chiffrée, gardée 3 mois au plus, peut encore contenir les données d'un compte supprimé. Est-ce acceptable, et faut-il le dire à la personne ?
    *Politique, « Quand vous supprimez votre compte » ; routine des demandes.*

## F. Droits des personnes

26. **Délais de réponse.** Un mois, prolongeable de deux mois pour une demande complexe, en prévenant la personne dans le premier mois. Est-ce exact ?
    *Routine des demandes.*
27. **Vérification d'identité.** On demande d'écrire depuis l'adresse du compte, jamais une pièce d'identité par défaut. Est-ce proportionné ?
    *Politique, « Vos droits » ; routine des demandes.*
28. **Opposition et limitation.** Conditions à appliquer.
    *Routine des demandes.*
29. **Personnes sans compte** citées par un utilisateur (note « Pour qui ? », description d'un événement, commentaire) : comment traiter leurs demandes ?
    *Politique, « Si vous n'avez pas de compte » ; routine des demandes.*
30. **Directives après le décès** (loi Informatique et Libertés) : faut-il les prévoir, et comment ?
    *Politique, « Vos droits ».*
31. **Refus et réponses.** Motifs de refus possibles, mentions obligatoires d'une réponse, et formulation des modèles de réponse.
    *Routine des demandes.*

## G. Violation de données

32. **Définition et point de départ des 72 heures.**
    *Procédure, « C'est quoi » et « Le chrono ».*
33. **Documentation de toutes les violations**, même non notifiées.
    *Procédure, étape 2.*
34. **Seuils de risque.** Le tableau des niveaux de risque et ses exemples sont-ils justes ?
    *Procédure, étape 3.*
35. **Notification à la CNIL.** Adresse exacte du formulaire, notification en plusieurs temps, justification d'un retard.
    *Procédure, étape 4.*
36. **Information des personnes.** Contenu obligatoire du message, et cas où il n'est pas nécessaire.
    *Procédure, étape 5.*
37. **Relecture du registre.** Une fois par an : est-ce suffisant ?
    *Registre, « Tenue du registre ».*

## H. Conditions d'utilisation et page cookies

38. **Gratuité et caractère non commercial**, tels qu'ils sont décrits.
    *CGU, « Objet ».*
39. **Âge minimum de 18 ans**, et la façon de le vérifier (case à cocher « J'ai 18 ans ou plus »).
    *CGU, « Âge minimum ».*
40. **Message sanitaire** (« L'abus d'alcool est dangereux pour la santé ») : est-il utile, ou obligatoire, pour une application sans publicité ?
    *CGU, « Âge minimum ».*
41. **Limitation de responsabilité**, dans les limites permises par la loi.
    *CGU, « Responsabilité ».*
42. **Droit applicable et juridiction compétente.**
    *CGU, « Droit applicable et litiges ».*
43. **Engagement de l'éditeur sur son accès technique aux données** (seulement pour la maintenance, la sécurité ou une obligation légale) : formulation suffisante ?
    *Politique, « Qui voit vos données ».*
44. **Stockage sur l'appareil sans bandeau.** Peut-on qualifier tout le stockage de « strictement nécessaire », y compris le budget habituel du scanner et l'état des propositions de l'assistant ?
    *Page cookies, « Pourquoi aucun accord ne vous est demandé ».*

---

## Ce que l'éditeur attend

- Pour chaque question : « validé tel quel », « à reformuler » (avec la formulation) ou « à changer » (avec ce qui doit changer).
- Une fois un point validé, sa mention « [À VALIDER] » est retirée du texte. L'application refuse de publier un document qui en contient encore une.
- Les textes publiés seront datés et versionnés dans l'application. Les personnes inscrites accepteront les conditions d'utilisation à leur prochaine connexion.

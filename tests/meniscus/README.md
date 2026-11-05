# Barre de navigation « Meniscus » — Cave & Amis 2.0

Composant Web autonome `<meniscus-tabbar>` : une goutte colorée glisse sur la barre, qui se creuse sous elle. Aucune dépendance, il fonctionne en HTML pur comme dans React, Vue ou Svelte.

## Contenu

| Fichier | Rôle |
|---|---|
| `meniscus-tabbar.js` | Le composant (≈ 12 Ko, sans dépendance) |
| `index.html` | Démo complète : 5 onglets Cave / Amis / Groupes / Événements / Profil |
| `tests/test_meniscus.py` | 49 tests automatisés dans un vrai Chrome |

## Intégration en 3 étapes

1. Copier `meniscus-tabbar.js` dans le projet (par ex. `js/`).
2. Avant `</body>` :
   ```html
   <nav class="bottom-nav"><meniscus-tabbar id="nav" hash-routing></meniscus-tabbar></nav>
   <script src="js/meniscus-tabbar.js"></script>
   ```
3. Brancher l'affichage des écrans existants :
   ```js
   document.getElementById('nav').addEventListener('tab-change', e => {
     afficherEcran(e.detail.id); // 'cave' | 'amis' | 'groupes' | 'evenements' | 'profil'
   });
   ```

CSS conseillé pour la fixer en bas de l'écran (iPhone compris) :
```css
.bottom-nav{position:fixed;left:0;right:0;bottom:0;z-index:50;padding:0 12px calc(8px + env(safe-area-inset-bottom))}
main{padding-bottom:140px} /* le contenu ne passe pas sous la barre */
```
Et dans `<head>` : `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`.

## Personnalisation

```js
nav.tabs = [
  { id:'cave', label:'Cave', icon:'bottle', color:'#b0213f', ink:'#ffffff' },
  // icon : bottle, users, group, glass, user, home, calendar, settings — ou un <path> SVG
];
```
- `color` : couleur de la goutte et du libellé. `ink` : couleur de l'icône dans la goutte.
- Variables CSS : `--mt-bar` (fond de la barre), `--mt-stroke` (contour), `--mt-icon` (icônes inactives).
- `--mt-active` est exposée sur l'élément : utilisable pour teinter le reste de l'appli.

## API

| | |
|---|---|
| `hash-routing` (attribut) | Synchronise l'onglet avec l'URL (`#amis`), bouton retour et liens directs compris |
| `active="profil"` (attribut) | Onglet actif par id ou index |
| `nav.select('groupes')` | Change d'onglet, renvoie `false` si l'id n'existe pas |
| `nav.activeId` / `nav.activeIndex` | Onglet courant |
| Événement `tab-change` | `detail = { id, index, tab, previousIndex }` |

## Ce qui est géré

- Toucher, glisser au doigt ou à la souris, clavier (← → Début Fin), lecteurs d'écran (rôles ARIA tablist/tab)
- Écrans de 320 px à la tablette, rotation, encoche iPhone
- Option système « réduire les animations » respectée
- L'animation s'arrête dès que la goutte est posée : pas de consommation de batterie au repos

## Lancer les tests

```bash
pip install playwright && playwright install chromium
python3 tests/test_meniscus.py . shots
```

// Avant tout affichage : le dernier thème choisi sur cet appareil (voir src/ui/theme.ts), pour éviter un éclair de
// l'autre thème pendant le chargement. Sans choix noté : le thème par défaut de index.html (Clair-obscur).
(function () {
  try {
    var t = localStorage.getItem('cave.theme');
    if (t !== 'sombre' && t !== 'clair' && t !== 'nuit' && t !== 'auto') return;
    if (t === 'auto') t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'nuit' : 'clair';
    var root = document.documentElement;
    root.setAttribute('data-theme', t === 'clair' ? 'clair' : 'sombre');
    if (t === 'nuit') root.setAttribute('data-nuit', '');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'clair' ? '#f8f3ea' : '#0c0b0c');
  } catch (e) {
    // stockage indisponible : thème par défaut
  }
})();

/*
 * <meniscus-tabbar> — Cave & Amis 2.0
 * Barre d'onglets « ménisque » : une goutte glisse sur la barre, qui se creuse sous elle.
 * Web Component autonome, sans dépendance. Compatible tout framework ou HTML pur.
 *
 * Utilisation :
 *   <script src="meniscus-tabbar.js"></script>
 *   <meniscus-tabbar id="nav"></meniscus-tabbar>
 *   nav.tabs = [{ id:'cave', label:'Cave', icon:'bottle', color:'#b0213f', ink:'#fff' }, ...];
 *   nav.addEventListener('tab-change', e => console.log(e.detail.id, e.detail.index));
 *
 * Attributs : active="cave" (id ou index), hash-routing (synchronise avec #cave)
 * API : el.tabs, el.activeIndex, el.activeId, el.select(idOuIndex)
 *
 * Ajouts pour l'intégration dans l'application (le reste est le composant livré, inchangé) :
 * - `badge` (nombre) par onglet : pastille sur l'icône, et « (N en attente) » dans le nom lu par les lecteurs d'écran ;
 * - `tour` par onglet : attribut data-tour sur le bouton (visite guidée de l'application) ;
 * - `detail.dragging` dans tab-change : vrai pendant que la goutte est glissée (l'appli ne change d'écran qu'au lâcher) ;
 * - `image` (adresse) par onglet : icône 3D photoréaliste de l'application à la place du pictogramme au trait, dans le
 *   bouton et dans la goutte ; si l'image ne se charge pas, le pictogramme `icon` reprend sa place.
 */
(function () {
  const ICONS = {
    bottle: '<path d="M10 2h4v4c0 1 2 2 2 5v9a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-9c0-3 2-4 2-5z"/><path d="M8 13h8"/>',
    users: '<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/><path d="M21 21v-2a4 4 0 0 0-3-3.9"/>',
    group: '<circle cx="12" cy="8" r="3"/><circle cx="5" cy="10" r="2"/><circle cx="19" cy="10" r="2"/><path d="M7 20v-1a5 5 0 0 1 10 0v1"/><path d="M2 20v-1a3 3 0 0 1 4-2.8"/><path d="M22 20v-1a3 3 0 0 0-4-2.8"/>',
    glass: '<path d="M8 3h8l-.5 6a3.5 3.5 0 0 1-7 0z"/><path d="M12 12.5V20"/><path d="M8 21h8"/><path d="M8.3 7h7.4"/>',
    user: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.2 18.8a6 6 0 0 1 11.6 0"/>',
    home: '<path d="M5 12H3l9-9 9 9h-2"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
    calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M16 3v4M8 3v4M4 11h16"/>',
    settings: '<path d="M4 6h8M16 6h4M4 12h2M10 12h10M4 18h11M19 18h1"/><circle cx="14" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'
  };
  const svgIcon = (name, size) => {
    const body = ICONS[name] || name || '';
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  };

  /** Icône d'un onglet : l'image 3D si elle existe (pictogramme au trait en secours), sinon le pictogramme. */
  const visual = (t, size) => {
    if (!t.image) return document.createRange().createContextualFragment(svgIcon(t.icon, size));
    const img = document.createElement('img');
    img.className = 'pic'; img.src = t.image; img.width = size; img.height = size;
    img.alt = ''; img.draggable = false; img.decoding = 'async';
    img.addEventListener('error', () => img.replaceWith(document.createRange().createContextualFragment(svgIcon(t.icon, size))), { once: true });
    return img;
  };

  const DEFAULT_TABS = [
    { id: 'cave', label: 'Cave', icon: 'bottle', color: '#b0213f', ink: '#ffffff' },
    { id: 'amis', label: 'Amis', icon: 'users', color: '#f2a7b5', ink: '#4a1220' },
    { id: 'groupes', label: 'Groupes', icon: 'group', color: '#e8c766', ink: '#3d2c05' },
    { id: 'evenements', label: 'Événements', icon: 'glass', color: '#c9d97a', ink: '#2c3608' },
    { id: 'profil', label: 'Profil', icon: 'user', color: '#e0b089', ink: '#3d220c' }
  ];

  const BAR_TOP = 22, BAR_H = 62, BEAD = 48;
  const CORNER = 18, NOTCH_W = 27, NOTCH_HALF = NOTCH_W + 9;
  // Marge latérale : le creux du premier/dernier onglet ne doit jamais mordre sur les angles arrondis.
  const PAD = CORNER + NOTCH_HALF + 2;

  /** Contour de la barre avec un creux centré en p. Exporté pour les tests. */
  function meniscusPath(p, width, sag) {
    const y = BAR_TOP, b = BAR_TOP + BAR_H, r = CORNER, w = NOTCH_W, dp = 22 + (sag || 0);
    p = Math.max(r + NOTCH_HALF, Math.min(width - r - NOTCH_HALF, p));
    return `M0,${y + r} Q0,${y} ${r},${y} L${p - w - 9},${y} ` +
      `C${p - w + 6},${y} ${p - 20},${y + dp} ${p},${y + dp} ` +
      `C${p + 20},${y + dp} ${p + w - 6},${y} ${p + w + 9},${y} ` +
      `L${width - r},${y} Q${width},${y} ${width},${y + r} L${width},${b} L0,${b} Z`;
  }

  const css = `
    :host{display:block;position:relative;height:${BAR_TOP + BAR_H + 12}px;--mt-bar:#12060a;--mt-stroke:rgba(246,236,228,.28);--mt-icon:#f6ece4;font-family:inherit;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
    .wrap{position:absolute;inset:0}
    svg.bar{position:absolute;left:0;top:0;width:100%;height:${BAR_TOP + BAR_H}px;overflow:visible}
    path{fill:var(--mt-bar);stroke:var(--mt-stroke);stroke-width:1}
    [role=tablist]{position:absolute;left:0;right:0;top:${BAR_TOP}px;height:${BAR_H}px;margin:0;padding:0}
    button.tab{position:absolute;top:0;width:56px;height:${BAR_H}px;margin-left:-28px;border:0;background:none;color:var(--mt-icon);cursor:pointer;display:flex;align-items:flex-start;justify-content:center;padding-top:16px;transition:opacity .2s;opacity:.72;font:inherit}
    button.tab:focus-visible{outline:2px solid var(--mt-icon);outline-offset:-6px;border-radius:12px}
    button.tab .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
    .bead{position:absolute;top:${BAR_TOP - BEAD / 2 + 8}px;left:0;width:${BEAD}px;height:${BEAD}px;margin-left:-${BEAD / 2}px;border-radius:50% 50% 50% 50%/55% 55% 45% 45%;display:flex;align-items:center;justify-content:center;cursor:grab;touch-action:none;transition:background-color .3s,color .3s;will-change:transform,left}
    .bead.drag{cursor:grabbing}
    img.pic{display:block;object-fit:contain;pointer-events:none;-webkit-user-drag:none}
    .badge{position:absolute;top:6px;left:50%;margin-left:6px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--mt-badge,#b0213f);color:var(--mt-badge-ink,#fff);font-size:11px;font-weight:800;line-height:18px;text-align:center;pointer-events:none}
    .label{position:absolute;top:${BAR_TOP + 40}px;left:0;width:100px;margin-left:-50px;text-align:center;font-size:11px;font-weight:600;transition:color .3s;pointer-events:none;white-space:nowrap}
    .wrap:not(.ready) .bead,.wrap:not(.ready) .label,.wrap:not(.ready) button.tab{transition:none}
    @media (prefers-reduced-motion: reduce){.bead,.label,button.tab{transition:none}}
  `;

  class MeniscusTabbar extends HTMLElement {
    static get observedAttributes() { return ['active']; }

    constructor() {
      super();
      this._tabs = DEFAULT_TABS.slice();
      this._index = 0;
      this._x = 0; this._v = 0; this._target = 0;
      this._dragging = false; this._raf = 0; this._width = 0;
      this._reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${css}</style><div class="wrap">
        <svg class="bar" part="bar"><path></path></svg>
        <div role="tablist" aria-label="Navigation principale"></div>
        <div class="bead" part="bead" aria-hidden="true"></div>
        <div class="label" part="label" aria-hidden="true"></div></div>`;
      this._path = root.querySelector('path');
      this._list = root.querySelector('[role=tablist]');
      this._bead = root.querySelector('.bead');
      this._label = root.querySelector('.label');
      this._onHash = this._onHash.bind(this);
      this._tick = this._tick.bind(this);
      this._bindDrag();
      this._list.addEventListener('keydown', e => this._onKey(e));
    }

    connectedCallback() {
      if (this.hasAttribute('tabs')) {
        try { this._tabs = JSON.parse(this.getAttribute('tabs')); } catch (e) { console.warn('[meniscus-tabbar] attribut tabs invalide', e); }
      }
      this._ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this._layout()) : null;
      if (this._ro) this._ro.observe(this);
      if (this.hasAttribute('hash-routing')) {
        window.addEventListener('hashchange', this._onHash);
        const fromHash = this._find(location.hash.slice(1));
        if (fromHash >= 0) this._index = fromHash;
      }
      if (this.hasAttribute('active')) { const i = this._find(this.getAttribute('active')); if (i >= 0) this._index = i; }
      this._render();
    }

    disconnectedCallback() {
      if (this._ro) this._ro.disconnect();
      window.removeEventListener('hashchange', this._onHash);
      cancelAnimationFrame(this._raf); this._raf = 0;
    }

    attributeChangedCallback(name, _o, val) {
      if (name === 'active' && this.isConnected) this.select(val, { silent: true });
    }

    get tabs() { return this._tabs.slice(); }
    set tabs(list) {
      if (!Array.isArray(list) || !list.length) throw new TypeError('tabs doit être un tableau non vide');
      this._tabs = list.map((t, i) => ({
        id: String(t.id ?? i), label: t.label ?? String(t.id ?? i), icon: t.icon, color: t.color || '#b0213f', ink: t.ink || '#ffffff',
        badge: Number.isInteger(t.badge) && t.badge > 0 ? t.badge : 0, tour: typeof t.tour === 'string' ? t.tour : '',
        image: typeof t.image === 'string' ? t.image : ''
      }));
      this._index = Math.min(this._index, this._tabs.length - 1);
      if (this.isConnected) this._render();
    }
    get activeIndex() { return this._index; }
    get activeId() { return this._tabs[this._index].id; }

    /** Sélectionne un onglet par id ou index. Retourne true si l'onglet existe. */
    select(key, opts = {}) {
      const i = this._find(key);
      if (i < 0) return false;
      this._setIndex(i, opts);
      this._target = this._xs[i];
      this._kick();
      return true;
    }

    // ---------- interne ----------
    _find(key) {
      if (key === null || key === undefined || key === '') return -1;
      const byId = this._tabs.findIndex(t => t.id === String(key));
      if (byId >= 0) return byId;
      const n = Number(key);
      return Number.isInteger(n) && n >= 0 && n < this._tabs.length ? n : -1;
    }

    _render() {
      this._list.innerHTML = '';
      this._btns = this._tabs.map((t, i) => {
        const b = document.createElement('button');
        b.className = 'tab'; b.type = 'button';
        b.setAttribute('role', 'tab'); b.id = 'mt-tab-' + t.id;
        b.dataset.id = t.id;
        if (t.tour) b.dataset.tour = t.tour;
        b.appendChild(visual(t, t.image ? 30 : 22));
        const sr = document.createElement('span');
        sr.className = 'sr';
        sr.textContent = t.badge ? `${t.label} (${t.badge} en attente)` : t.label;
        b.appendChild(sr);
        if (t.badge) {
          const badge = document.createElement('span');
          badge.className = 'badge'; badge.setAttribute('aria-hidden', 'true');
          badge.textContent = t.badge > 9 ? '9+' : String(t.badge);
          b.appendChild(badge);
        }
        b.addEventListener('click', () => this.select(i));
        this._list.appendChild(b);
        return b;
      });
      const wrap = this.shadowRoot.querySelector('.wrap');
      wrap.classList.remove('ready');
      this._layout(true);
      this._setIndex(this._index, { silent: true, force: true });
      requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('ready')));
    }

    _layout(snap) {
      const w = this.clientWidth || 360;
      this._width = w;
      this._path.parentNode.setAttribute('viewBox', `0 0 ${w} ${BAR_TOP + BAR_H}`);
      const n = this._tabs.length, L = PAD, R = w - PAD;
      this._xs = this._tabs.map((_, i) => n === 1 ? w / 2 : L + i * (R - L) / (n - 1));
      (this._btns || []).forEach((b, i) => { b.style.left = this._xs[i] + 'px'; });
      this._target = this._xs[this._index];
      if (snap || !this._raf) { this._x = this._target; this._v = 0; }
      this._draw(0);
    }

    _setIndex(i, { silent, force } = {}) {
      const changed = i !== this._index;
      if (!changed && !force) return;
      const prev = this._index;
      this._index = i;
      const t = this._tabs[i];
      this._bead.style.backgroundColor = t.color;
      this._bead.style.color = t.ink;
      this._bead.replaceChildren(visual(t, t.image ? 34 : 22));
      this._label.textContent = t.label;
      this._label.style.color = t.color;
      this._btns.forEach((b, j) => {
        b.setAttribute('aria-selected', String(j === i));
        b.tabIndex = j === i ? 0 : -1;
      });
      this.style.setProperty('--mt-active', t.color);
      if (changed && !silent) {
        if (this.hasAttribute('hash-routing') && location.hash.slice(1) !== t.id) history.replaceState(null, '', '#' + t.id);
        this.dispatchEvent(new CustomEvent('tab-change', { bubbles: true, composed: true, detail: { index: i, id: t.id, tab: { ...t }, previousIndex: prev, dragging: this._dragging } }));
      }
    }

    _nearest(x) {
      let k = 0;
      this._xs.forEach((v, j) => { if (Math.abs(v - x) < Math.abs(this._xs[k] - x)) k = j; });
      return k;
    }

    _kick() {
      if (this._reduced) { this._x = this._target; this._v = 0; this._draw(0); return; }
      if (!this._raf) this._raf = requestAnimationFrame(this._tick);
    }

    _tick() {
      this._raf = 0;
      let sag = 0;
      if (this._dragging) { sag = 4; }
      else {
        this._v = this._v * 0.72 + (this._target - this._x) * 0.12;
        this._x += this._v;
        sag = Math.min(6, Math.abs(this._v) * 0.6);
        if (Math.abs(this._target - this._x) < 0.3 && Math.abs(this._v) < 0.3) { this._x = this._target; this._v = 0; sag = 0; }
      }
      this._draw(sag);
      if (this._dragging || this._v !== 0 || this._x !== this._target) this._raf = requestAnimationFrame(this._tick);
    }

    _draw(sag) {
      const x = this._x;
      this._path.setAttribute('d', meniscusPath(x, this._width, sag));
      this._bead.style.left = x + 'px';
      this._label.style.left = x + 'px';
      const stretch = 1 + Math.min(0.18, Math.abs(this._v) * 0.02);
      this._bead.style.transform = `scaleX(${stretch})`;
      (this._btns || []).forEach((b, i) => { b.style.opacity = Math.abs(this._xs[i] - x) < 30 ? '0' : ''; });
    }

    _bindDrag() {
      const bead = this._bead;
      let startX = 0, startPos = 0, moved = false;
      bead.addEventListener('pointerdown', e => {
        this._dragging = true; moved = false; this._v = 0;
        startX = e.clientX; startPos = this._x;
        bead.classList.add('drag');
        try { bead.setPointerCapture(e.pointerId); } catch (_) {}
        this._kick();
      });
      bead.addEventListener('pointermove', e => {
        if (!this._dragging) return;
        const dx = e.clientX - startX;
        if (Math.abs(dx) > 3) moved = true;
        const min = this._xs[0], max = this._xs[this._xs.length - 1];
        this._x = Math.max(min, Math.min(max, startPos + dx));
        this._setIndex(this._nearest(this._x));
        this._draw(4);
      });
      const end = () => {
        if (!this._dragging) return;
        this._dragging = false; bead.classList.remove('drag');
        this._target = this._xs[this._nearest(this._x)];
        this._kick();
      };
      bead.addEventListener('pointerup', end);
      bead.addEventListener('pointercancel', end);
      bead.addEventListener('lostpointercapture', end);
    }

    _onKey(e) {
      const n = this._tabs.length;
      let i = null;
      if (e.key === 'ArrowRight') i = (this._index + 1) % n;
      else if (e.key === 'ArrowLeft') i = (this._index - 1 + n) % n;
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = n - 1;
      if (i === null) return;
      e.preventDefault();
      this.select(i);
      this._btns[i].focus();
    }

    _onHash() {
      const i = this._find(location.hash.slice(1));
      if (i >= 0 && i !== this._index) this.select(i);
    }
  }

  MeniscusTabbar.meniscusPath = meniscusPath;
  MeniscusTabbar.icons = ICONS;
  if (!customElements.get('meniscus-tabbar')) customElements.define('meniscus-tabbar', MeniscusTabbar);
  if (typeof window !== 'undefined') window.MeniscusTabbar = MeniscusTabbar;
})();

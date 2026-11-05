"""Tests end-to-end du composant <meniscus-tabbar> dans un vrai Chrome (Playwright)."""
import sys, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(sys.argv[1]).resolve()
URL = ROOT.joinpath("index.html").as_uri()
SHOTS = pathlib.Path(sys.argv[2]).resolve(); SHOTS.mkdir(exist_ok=True)
results = []

def check(name, cond, info=""):
    results.append((name, bool(cond), info))
    print(("PASS " if cond else "FAIL ") + name + (f" — {info}" if info and not cond else ""))

def settle(page):
    page.wait_for_function("() => { const n=document.getElementById('nav'); return n._raf===0 && Math.abs(n._x-n._target)<0.01 }", timeout=5000)

def bead_x(page):
    return page.evaluate("() => { const b=document.getElementById('nav').shadowRoot.querySelector('.bead').getBoundingClientRect(); return b.left+b.width/2 }")

def tab_box(page, i):
    return page.evaluate(f"() => {{ const r=document.getElementById('nav').shadowRoot.querySelectorAll('button.tab')[{i}].getBoundingClientRect(); return {{x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height,l:r.left,r:r.right}} }}")

def open_page(browser, w=390, h=844, hash="", reduced=False):
    ctx = browser.new_context(viewport={"width": w, "height": h}, has_touch=True, reduced_motion="reduce" if reduced else "no-preference")
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL + hash)
    page.wait_for_function("() => customElements.get('meniscus-tabbar') && document.getElementById('nav').activeId")
    settle(page)
    page.evaluate("() => { window.__events=[]; document.getElementById('nav').addEventListener('tab-change', e => window.__events.push(e.detail.id)) }")
    return ctx, page, errors

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])

    # 1. Chargement
    ctx, page, errors = open_page(browser)
    n = page.evaluate("() => document.getElementById('nav').shadowRoot.querySelectorAll('[role=tab]').length")
    check("5 onglets rendus", n == 5, n)
    check("Onglet par défaut = cave", page.evaluate("() => document.getElementById('nav').activeId") == "cave")
    sel = page.evaluate("() => [...document.getElementById('nav').shadowRoot.querySelectorAll('[role=tab]')].map(b=>b.getAttribute('aria-selected'))")
    check("aria-selected correct", sel == ["true", "false", "false", "false", "false"], sel)
    check("Goutte alignée sur l'onglet actif", abs(bead_x(page) - tab_box(page, 0)["x"]) < 1.5)
    check("Goutte opaque dès le chargement", page.evaluate("() => getComputedStyle(document.getElementById('nav').shadowRoot.querySelector('.bead')).backgroundColor") == "rgb(176, 33, 63)")
    page.screenshot(path=str(SHOTS / "1_cave.png"))

    # 2. Clic
    t = tab_box(page, 2)
    page.mouse.click(t["x"], t["y"]); settle(page)
    check("Clic → Groupes actif", page.evaluate("() => document.getElementById('nav').activeId") == "groupes")
    check("Événement tab-change émis une fois", page.evaluate("() => window.__events") == ["groupes"], page.evaluate("() => window.__events"))
    check("Hash mis à jour", page.evaluate("() => location.hash") == "#groupes")
    check("Contenu de page mis à jour", page.inner_text("#title") == "Groupes")
    check("Goutte s'arrête sur l'onglet", abs(bead_x(page) - t["x"]) < 1.5, (bead_x(page), t["x"]))
    check("Couleur de la goutte = champagne", page.evaluate("() => getComputedStyle(document.getElementById('nav').shadowRoot.querySelector('.bead')).backgroundColor") == "rgb(232, 199, 102)")
    check("Animation arrêtée au repos (pas de boucle infinie)", page.evaluate("() => document.getElementById('nav')._raf") == 0)
    page.screenshot(path=str(SHOTS / "2_groupes_clic.png"))

    # 3. Glisser (souris)
    bx = bead_x(page); by = page.evaluate("() => { const b=document.getElementById('nav').shadowRoot.querySelector('.bead').getBoundingClientRect(); return b.top+b.height/2 }")
    last = tab_box(page, 4)
    page.mouse.move(bx, by); page.mouse.down()
    for k in range(1, 21):
        page.mouse.move(bx + (last["x"] - bx) * k / 20, by)
    mid_label = page.evaluate("() => document.getElementById('nav').shadowRoot.querySelector('.label').textContent")
    page.screenshot(path=str(SHOTS / "3_glisser_en_cours.png"))
    page.mouse.up(); settle(page)
    check("Glisser → Profil actif", page.evaluate("() => document.getElementById('nav').activeId") == "profil")
    check("Libellé suit pendant le glisser", mid_label == "Profil", mid_label)
    check("Goutte aimantée sur Profil", abs(bead_x(page) - last["x"]) < 1.5)
    ev = page.evaluate("() => window.__events")
    check("Événements émis pendant le glisser, sans doublon consécutif", ev[-1] == "profil" and all(a != b for a, b in zip(ev, ev[1:])), ev)

    # 3b. Glisser au-delà des bornes
    bx = bead_x(page)
    page.mouse.move(bx, by); page.mouse.down(); page.mouse.move(bx + 500, by); page.mouse.up(); settle(page)
    check("Glisser hors barre reste borné", abs(bead_x(page) - last["x"]) < 1.5)
    bx = bead_x(page); first = tab_box(page, 0)
    page.mouse.move(bx, by); page.mouse.down(); page.mouse.move(-200, by); page.mouse.up(); settle(page)
    check("Glisser loin à gauche → Cave", page.evaluate("() => document.getElementById('nav').activeId") == "cave" and abs(bead_x(page) - first["x"]) < 1.5)

    # 4. Clavier
    page.evaluate("() => document.getElementById('nav').shadowRoot.querySelector('[aria-selected=true]').focus()")
    page.keyboard.press("ArrowRight"); settle(page)
    check("Flèche droite → Amis", page.evaluate("() => document.getElementById('nav').activeId") == "amis")
    page.keyboard.press("End"); settle(page)
    check("Fin → Profil", page.evaluate("() => document.getElementById('nav').activeId") == "profil")
    page.keyboard.press("ArrowRight"); settle(page)
    check("Flèche droite boucle → Cave", page.evaluate("() => document.getElementById('nav').activeId") == "cave")
    page.keyboard.press("ArrowLeft"); settle(page)
    check("Flèche gauche boucle → Profil", page.evaluate("() => document.getElementById('nav').activeId") == "profil")
    page.keyboard.press("Home"); settle(page)
    check("Début → Cave", page.evaluate("() => document.getElementById('nav').activeId") == "cave")
    check("Focus suit l'onglet (roving tabindex)", page.evaluate("() => document.getElementById('nav').shadowRoot.activeElement.dataset.id") == "cave")

    # 5. Hash / navigation navigateur
    page.evaluate("() => { location.hash = 'evenements' }"); settle(page)
    check("hashchange → Événements", page.evaluate("() => document.getElementById('nav').activeId") == "evenements")
    page.screenshot(path=str(SHOTS / "4_evenements.png"))

    # 6. API
    check("select('id_inconnu') → false", page.evaluate("() => document.getElementById('nav').select('nimporte')") is False)
    check("select(1) → Amis", page.evaluate("() => { const n=document.getElementById('nav'); n.select(1); return n.activeId }") == "amis")
    settle(page)
    check("Attribut active pilote l'onglet", page.evaluate("() => { const n=document.getElementById('nav'); n.setAttribute('active','profil'); return n.activeId }") == "profil")
    settle(page)
    page.evaluate("() => document.getElementById('nav').tabs=[{id:'a',label:'A',icon:'home',color:'#ff0000'},{id:'b',label:'B',icon:'calendar',color:'#00ff00'},{id:'c',label:'C',icon:'settings',color:'#0000ff'}]")
    settle(page)
    check("Onglets personnalisés (3)", page.evaluate("() => document.getElementById('nav').shadowRoot.querySelectorAll('[role=tab]').length") == 3)
    check("Index ramené dans les bornes", page.evaluate("() => document.getElementById('nav').activeIndex") == 2)
    try:
        page.evaluate("() => { document.getElementById('nav').tabs = [] }"); bad = False
    except Exception:
        bad = True
    check("tabs vide refusé", bad)
    geo = page.evaluate("""() => { const f=window.MeniscusTabbar.meniscusPath; const bad=[];
      for (const w of [296,336,366,406,496]) { const pad=56; for (const p of [pad, w/2, w-pad]) {
        const nums=f(p,w,6).match(/-?[\\d.]+/g).map(Number); const xs=nums.filter((_,i)=>i%2===0);
        const lineXs=f(p,w,6).match(/L(-?[\\d.]+)/g).map(s=>+s.slice(1));
        if (Math.min(...xs)<0 || Math.max(...xs)>w) bad.push([w,p,'hors cadre']);
        if (lineXs[0] < 18 || lineXs[1] > w-18) bad.push([w,p,'creux sur angle']); } }
      return bad }""")
    check("Géométrie : le creux ne déborde jamais sur les angles", geo == [], geo)
    check("Aucune erreur console", not errors, errors)
    ctx.close()

    # 7. Chargement direct avec hash
    ctx, page, errors = open_page(browser, hash="#amis")
    check("URL #amis ouvre Amis", page.evaluate("() => document.getElementById('nav').activeId") == "amis" and page.inner_text("#title") == "Mes amis")
    check("Pas d'événement parasite au chargement", page.evaluate("() => window.__events") == [])
    ctx.close()

    # 8. Écrans mobiles : tailles et tactile
    for w, h in [(320, 568), (360, 740), (390, 844), (430, 932), (768, 1024)]:
        ctx, page, errors = open_page(browser, w, h)
        boxes = [tab_box(page, i) for i in range(5)]
        inside = all(b["l"] >= 0 and b["r"] <= w for b in boxes)
        spacing = min(boxes[i + 1]["x"] - boxes[i]["x"] for i in range(4))
        no_overflow = page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth")
        check(f"{w}px : onglets dans l'écran, cibles ≥44px, pas de débordement", inside and spacing >= 44 and boxes[0]["h"] >= 44 and no_overflow, (inside, spacing, no_overflow))
        lb = page.evaluate("() => { const r=document.getElementById('nav').shadowRoot.querySelector('.label').getBoundingClientRect(); return [r.left, r.right] }")
        t = tab_box(page, 3); page.touchscreen.tap(t["x"], t["y"]); settle(page)
        check(f"{w}px : tap tactile → Événements", page.evaluate("() => document.getElementById('nav').activeId") == "evenements")
        if w == 320:
            r = page.evaluate("() => { const r=document.getElementById('nav').shadowRoot.querySelector('.label').getBoundingClientRect(); return [r.left, r.right] }")
            txt = page.evaluate("() => { const l=document.getElementById('nav').shadowRoot.querySelector('.label'); return l.scrollWidth <= l.clientWidth }")
            check("320px : libellé « Événements » entier et visible", txt and r[0] >= 0 and r[1] <= w, r)
            page.screenshot(path=str(SHOTS / "5_mobile_320.png"))
        ctx.close()

    # 9. Redimensionnement (rotation)
    ctx, page, errors = open_page(browser, 390, 844)
    page.evaluate("() => document.getElementById('nav').select('groupes')"); settle(page)
    page.set_viewport_size({"width": 844, "height": 390}); page.wait_for_timeout(200); settle(page)
    check("Rotation : goutte recalée sur l'onglet", abs(bead_x(page) - tab_box(page, 2)["x"]) < 1.5)
    ctx.close()

    # 10. Mouvement réduit (accessibilité)
    ctx, page, errors = open_page(browser, reduced=True)
    page.evaluate("() => document.getElementById('nav').select('profil')")
    check("Mouvement réduit : déplacement instantané", abs(bead_x(page) - tab_box(page, 4)["x"]) < 1.5 and page.evaluate("() => document.getElementById('nav')._raf") == 0)
    ctx.close()

    # 11. Performance : temps moyen d'une image d'animation
    ctx, page, errors = open_page(browser)
    ms = page.evaluate("""async () => { const n=document.getElementById('nav'); let f=0; const t0=performance.now();
      await new Promise(res => { n.select(4); const loop=()=>{ f++; if(n._raf) requestAnimationFrame(loop); else res(); }; requestAnimationFrame(loop); });
      return { frames:f, total: performance.now()-t0 } }""")
    check("Transition < 1,5 s", ms["total"] < 1500, ms)
    ctx.close()
    browser.close()

ok = sum(r[1] for r in results)
print(f"\n{ok}/{len(results)} tests OK")
sys.exit(0 if ok == len(results) else 1)

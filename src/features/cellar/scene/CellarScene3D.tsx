/**
 * Cave visuelle en 3D (Three.js par React Three Fiber), chargée seulement à l'ouverture de la page. Tout est construit
 * dans le code, sans modèle à télécharger : bouteille tournée à partir d'un profil (LatheGeometry), verre teinté et
 * capsule de la couleur du vin, étagères en chêne (texture du site), spots ambrés, reflets d'un environnement calculé
 * sur place (RoomEnvironment, aucun réseau). Toutes les bouteilles d'une même pièce sont dessinées en une fois
 * (InstancedMesh) et l'image n'est recalculée que quand quelque chose change (frameloop « demand »).
 * La scène ne fait que montrer : la sélection, les fiches et les déplacements sont gérés par la page.
 */
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useLoader, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { CellarBottle, CellarShelf } from '../../../domain/cellarLayout';
import { MATURITY_LABELS } from '../../../domain/maturity';
import { wineTitle } from '../../../domain/wine';

// ───────────── Dimensions (en mètres, à l'échelle d'une vraie bouteille de 75 cl) ─────────────
const R = 0.037; // rayon du corps
const LEN = 0.3; // longueur de la bouteille
const SLOT_W = 0.092; // largeur d'un casier
const ROW_H = 0.095; // hauteur d'une rangée
const SHELF_GAP = 0.13; // espace entre deux étagères (bandeau et spots)
const DEPTH = 0.36; // profondeur de l'étagère
const FRONT = 0.045; // la capsule dépasse légèrement de la façade

const GLASS: Record<string, string> = { rouge: '#16241a', blanc: '#7f7a34', rose: '#e9b3b0', orange: '#c98a3c', effervescent: '#1c2c1c', autre: '#2b2626' };
const CAPSULE: Record<string, string> = { rouge: '#7d1527', blanc: '#caa24d', rose: '#e38ea4', orange: '#b8672b', effervescent: '#d8b75e', autre: '#6d5d52' };

/** Profil d'une bouteille bordelaise (ou champenoise), du fond (y = 0) au goulot (y = LEN). */
function bottleProfile(champagne: boolean) {
  const r = champagne ? R * 1.08 : R;
  const pts: [number, number][] = champagne
    ? [[0, 0], [r * 0.82, 0.002], [r, 0.012], [r, 0.17], [r * 0.93, 0.2], [r * 0.7, 0.23], [0.0175, 0.262], [0.0168, 0.29], [0.0182, 0.296], [0.0176, LEN], [0, LEN]]
    : [[0, 0], [r * 0.85, 0.002], [r, 0.01], [r, 0.195], [r * 0.96, 0.21], [r * 0.62, 0.232], [0.0172, 0.248], [0.0166, 0.29], [0.0176, LEN], [0, LEN]];
  return pts.map(([x, y]) => new THREE.Vector2(x, y));
}

function useGeometries() {
  return useMemo(() => {
    // La bouteille est couchée, goulot vers nous (axe +z), comme dans la maquette.
    const lay = (g: THREE.BufferGeometry) => g.rotateX(Math.PI / 2).translate(0, 0, -LEN + FRONT);
    const bordeaux = lay(new THREE.LatheGeometry(bottleProfile(false), 40));
    const champagne = lay(new THREE.LatheGeometry(bottleProfile(true), 40));
    const capsule = lay(new THREE.CylinderGeometry(0.0185, 0.0172, 0.058, 32).translate(0, LEN - 0.029, 0));
    const capTop = new THREE.CircleGeometry(0.0185, 32).translate(0, 0, FRONT + 0.0004);
    const ring = new THREE.TorusGeometry(0.0235, 0.0024, 8, 48).translate(0, 0, FRONT + 0.001);
    const dash = new THREE.BoxGeometry(0.006, 0.0035, 0.002);
    return { bordeaux, champagne, capsule, capTop, ring, dash };
  }, []);
}

/** Position du centre d'une bouteille dans la scène. */
export type Placement = { x: number; y: number };
export type ShelfFrame = { id: string; x: number; top: number; bottom: number; width: number; bottles: Map<string, Placement> };

/** Étagères empilées du haut vers le bas, centrées en x = 0. */
export function sceneLayout(shelves: CellarShelf[]) {
  const frames: ShelfFrame[] = [];
  let y = 0;
  for (const sh of shelves) {
    const width = sh.slots * SLOT_W + 0.05;
    const top = y;
    const map = new Map<string, Placement>();
    for (const b of sh.bottles) map.set(b.key, { x: (b.s - (sh.slots - 1) / 2) * SLOT_W, y: top - SHELF_GAP - b.r * ROW_H - R - 0.006 });
    const bottom = top - SHELF_GAP - sh.rows * ROW_H - 0.02;
    frames.push({ id: sh.id, x: 0, top, bottom, width, bottles: map });
    y = bottom - 0.06;
  }
  return { frames, height: -y, width: Math.max(0.6, ...frames.map((f) => f.width)) };
}

const hexColor = (c: string | null | undefined, table: Record<string, string>) => new THREE.Color(table[c ?? 'autre'] ?? table.autre);

/** Face de capsule photographiée : rouge, blanc (or), rosé, effervescent (feuille d'or). Orange et « autre » en empruntent une. */
const CAP_FACES = ['rouge', 'blanc', 'rose', 'effervescent'] as const;
type CapFace = (typeof CAP_FACES)[number];
const faceOf = (c: string | null | undefined): CapFace => (c === 'blanc' || c === 'orange' ? 'blanc' : c === 'rose' ? 'rose' : c === 'effervescent' ? 'effervescent' : 'rouge');

function Bottles({
  bottles,
  place,
  hovered,
  selected,
  appearing,
  onHover,
  onPick,
}: {
  bottles: CellarBottle[];
  place: Map<string, Placement>;
  hovered: string | null;
  selected: string | null;
  appearing: Set<string>;
  onHover: (key: string | null) => void;
  onPick: (key: string) => void;
}) {
  const g = useGeometries();
  const invalidate = useThree((s) => s.invalidate);
  const sets = useMemo(() => {
    const champagne = bottles.filter((b) => b.row.wine.color === 'effervescent');
    const still = bottles.filter((b) => b.row.wine.color !== 'effervescent');
    return { still, champagne };
  }, [bottles]);
  const ready = useMemo(() => bottles.filter((b) => b.row.maturity === 'ready' || b.row.maturity === 'past'), [bottles]);
  const soon = useMemo(() => bottles.filter((b) => b.row.maturity === 'soon'), [bottles]);

  const faces = useLoader(THREE.TextureLoader, CAP_FACES.map((f) => `/img/cave3d/capsule-${f}.webp`));
  useMemo(() => faces.forEach((t) => (t.colorSpace = THREE.SRGBColorSpace)), [faces]);
  const byFace = useMemo(() => CAP_FACES.map((f) => bottles.filter((b) => faceOf(b.row.wine.color) === f)), [bottles]);
  const glassStill = useRef<THREE.InstancedMesh>(null);
  const glassChamp = useRef<THREE.InstancedMesh>(null);
  const caps = useRef<THREE.InstancedMesh>(null);
  const capTops = useRef<(THREE.InstancedMesh | null)[]>([]);
  const rings = useRef<THREE.InstancedMesh>(null);
  const dashes = useRef<THREE.InstancedMesh>(null);
  // Avancée de la bouteille choisie, et apparition des bouteilles qui viennent d'arriver (0 → 1).
  const pull = useRef(new Map<string, number>());
  const grow = useRef(new Map<string, number>());

  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  const sc = useMemo(() => new THREE.Vector3(), []);

  const write = () => {
    const at = (b: CellarBottle) => {
      const p = place.get(b.key)!;
      const z = pull.current.get(b.key) ?? 0;
      const s = grow.current.get(b.key) ?? 1;
      v.set(p.x, p.y, z);
      sc.setScalar(s);
      return m.compose(v, q, sc);
    };
    const fill = (mesh: THREE.InstancedMesh | null, list: CellarBottle[], color?: (b: CellarBottle) => THREE.Color) => {
      if (!mesh) return;
      mesh.count = list.length;
      list.forEach((b, i) => {
        mesh.setMatrixAt(i, at(b));
        if (color) mesh.setColorAt(i, color(b));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
    const capColor = (b: CellarBottle) => {
      const c = hexColor(b.row.wine.color, CAPSULE);
      return b.key === hovered || b.key === selected ? c.clone().offsetHSL(0, 0, 0.12) : c;
    };
    fill(glassStill.current, sets.still, (b) => hexColor(b.row.wine.color, GLASS));
    fill(glassChamp.current, sets.champagne, (b) => hexColor(b.row.wine.color, GLASS));
    fill(caps.current, bottles, capColor);
    // Face photographiée : plus claire au survol et pour la bouteille choisie.
    CAP_FACES.forEach((_, i) => fill(capTops.current[i] ?? null, byFace[i], (b) => new THREE.Color(b.key === hovered || b.key === selected ? '#ffffff' : '#c9beb4')));
    fill(rings.current, ready);
    if (dashes.current) {
      // « Bientôt » : un anneau en pointillés (10 tirets).
      const mesh = dashes.current;
      mesh.count = soon.length * 10;
      soon.forEach((b, i) => {
        const p = place.get(b.key)!;
        const z = (pull.current.get(b.key) ?? 0) + FRONT + 0.001;
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2;
          q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a + Math.PI / 2);
          v.set(p.x + Math.cos(a) * 0.0235, p.y + Math.sin(a) * 0.0235, z);
          mesh.setMatrixAt(i * 10 + k, m.compose(v, q, sc.setScalar(1)));
        }
        q.identity();
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  };

  useLayoutEffect(() => {
    for (const k of appearing) grow.current.set(k, 0.001);
    write();
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bottles, byFace, place, hovered, selected, appearing]);

  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  useFrame((_, dt) => {
    let moving = false;
    const step = Math.min(1, dt * 8);
    for (const b of bottles) {
      const target = b.key === selected ? 0.07 : 0;
      const cur = pull.current.get(b.key) ?? 0;
      if (Math.abs(cur - target) > 0.0005) {
        pull.current.set(b.key, reduce ? target : cur + (target - cur) * step);
        moving = true;
      }
      const s = grow.current.get(b.key);
      if (s !== undefined && s < 1) {
        grow.current.set(b.key, reduce ? 1 : Math.min(1, s + dt * 2.2));
        moving = true;
      }
    }
    if (moving) {
      write();
      invalidate();
    }
  });

  const keyOf = (list: CellarBottle[]) => (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.instanceId !== undefined ? list[e.instanceId]?.key ?? null : null);
  const handlers = (list: CellarBottle[]) => ({
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      onHover(keyOf(list)(e));
    },
    onPointerOut: () => onHover(null),
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      const k = keyOf(list)(e);
      if (k) onPick(k);
    },
  });

  const max = Math.max(1, bottles.length);
  return (
    <group>
      <instancedMesh ref={glassStill} args={[g.bordeaux, undefined, max]} {...handlers(sets.still)}>
        <meshPhysicalMaterial roughness={0.12} metalness={0.05} clearcoat={1} clearcoatRoughness={0.08} envMapIntensity={1.1} />
      </instancedMesh>
      <instancedMesh ref={glassChamp} args={[g.champagne, undefined, max]} {...handlers(sets.champagne)}>
        <meshPhysicalMaterial roughness={0.12} metalness={0.05} clearcoat={1} clearcoatRoughness={0.08} envMapIntensity={1.1} />
      </instancedMesh>
      <instancedMesh ref={caps} args={[g.capsule, undefined, max]} {...handlers(bottles)}>
        <meshStandardMaterial roughness={0.35} metalness={0.55} />
      </instancedMesh>
      {CAP_FACES.map((f, i) => (
        <instancedMesh
          key={f}
          ref={(m) => {
            capTops.current[i] = m;
          }}
          args={[g.capTop, undefined, max]}
          {...handlers(byFace[i])}
        >
          {/* Photo déjà éclairée : affichée telle quelle, même teinte sur toutes les étagères. */}
          <meshBasicMaterial map={faces[i]} transparent alphaTest={0.4} toneMapped={false} />
        </instancedMesh>
      ))}
      <instancedMesh ref={rings} args={[g.ring, undefined, max]}>
        <meshStandardMaterial color="#e2b866" emissive="#8a5a16" emissiveIntensity={0.6} roughness={0.3} metalness={0.8} />
      </instancedMesh>
      <instancedMesh ref={dashes} args={[g.dash, undefined, max * 10]}>
        <meshStandardMaterial color="#e2b866" emissive="#8a5a16" emissiveIntensity={0.5} roughness={0.3} metalness={0.8} />
      </instancedMesh>
    </group>
  );
}

/** Une étagère : fond, côtés, tablettes, berceaux, bandeau et spots. */
function Shelf({ frame, shelf, wood }: { frame: ShelfFrame; shelf: CellarShelf; wood: THREE.Texture }) {
  const woodMat = useMemo(() => new THREE.MeshStandardMaterial({ map: wood, roughness: 0.55, metalness: 0.02, color: '#7a5038', envMapIntensity: 0.25 }), [wood]);
  const darkWood = useMemo(() => new THREE.MeshStandardMaterial({ map: wood, roughness: 0.9, color: '#24160f', envMapIntensity: 0.1 }), [wood]);
  const w = frame.width;
  const h = frame.top - frame.bottom;
  const cy = (frame.top + frame.bottom) / 2;
  const rowsTop = frame.top - SHELF_GAP;
  const cradles = useMemo(() => {
    const out: [number, number][] = [];
    for (let r = 0; r < shelf.rows; r++) for (let s = 0; s <= shelf.slots; s++) out.push([(s - shelf.slots / 2) * SLOT_W, rowsTop - (r + 1) * ROW_H + 0.012]);
    return out;
  }, [shelf.rows, shelf.slots, rowsTop]);
  const cradleRef = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = cradleRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    cradles.forEach(([x, y], i) => mesh.setMatrixAt(i, m.makeTranslation(x, y, FRONT - 0.03)));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [cradles]);
  const spots = Math.max(2, Math.min(6, Math.round(shelf.slots / 3)));
  return (
    <group>
      {/* Fond et côtés */}
      <mesh position={[0, cy, -DEPTH + 0.02]} material={darkWood}>
        <boxGeometry args={[w, h, 0.02]} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (w / 2), cy, -DEPTH / 2 + 0.03]} material={woodMat}>
          <boxGeometry args={[0.03, h + 0.02, DEPTH + 0.02]} />
        </mesh>
      ))}
      {/* Bandeau du haut, avec les spots */}
      <mesh position={[0, frame.top - 0.03, FRONT - 0.02]} material={woodMat}>
        <boxGeometry args={[w + 0.03, 0.06, 0.04]} />
      </mesh>
      {Array.from({ length: spots }, (_, i) => {
        const x = ((i + 0.5) / spots - 0.5) * (w - 0.1);
        return (
          <mesh key={i} position={[x, frame.top - 0.061, FRONT - 0.03]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.011, 20]} />
            <meshBasicMaterial color="#ffd9a0" toneMapped={false} />
          </mesh>
        );
      })}
      <pointLight position={[0, frame.top - 0.07, 0.06]} color="#ffb46b" intensity={2.2} distance={Math.max(0.8, w * 1.2)} decay={1.4} />
      {/* Une tablette sous chaque rangée */}
      {Array.from({ length: shelf.rows }, (_, r) => (
        <mesh key={r} position={[0, rowsTop - (r + 1) * ROW_H, -DEPTH / 2 + 0.03]} material={woodMat}>
          <boxGeometry args={[w, 0.012, DEPTH]} />
        </mesh>
      ))}
      {/* Berceaux : petites cales de bois entre les bouteilles, à l'avant */}
      <instancedMesh ref={cradleRef} args={[undefined, undefined, cradles.length]} material={woodMat}>
        <boxGeometry args={[0.008, 0.026, 0.05]} />
      </instancedMesh>
    </group>
  );
}

/** Caméra : vue générale ou zoom sur une étagère, avec transition douce (immédiate si l'on réduit les animations). */
function CameraRig({ target, controls }: { target: { x: number; y: number; dist: number }; controls: React.RefObject<OrbitControlsImpl | null> }) {
  const { camera, invalidate } = useThree();
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const goal = useRef(target);
  goal.current = target;
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    invalidate();
  }, [target, invalidate]);
  useFrame((_, dt) => {
    if (!active.current) return;
    const c = controls.current;
    const t = goal.current;
    const dest = new THREE.Vector3(t.x, t.y + t.dist * 0.03, t.dist);
    const look = new THREE.Vector3(t.x, t.y, -0.1);
    const k = reduce ? 1 : Math.min(1, dt * 4);
    camera.position.lerp(dest, k);
    if (c) {
      c.target.lerp(look, k);
      c.update();
    } else camera.lookAt(look);
    if (camera.position.distanceTo(dest) < 0.002) active.current = false;
    invalidate();
  });
  return null;
}

function Environment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    // Reflets discrets : le verre brille, le chêne reste sombre et chaud.
    scene.environmentIntensity = 0.45;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
}

function Scene({
  shelves,
  focus,
  hovered,
  selected,
  appearing,
  onHover,
  onPick,
  onFocus,
}: {
  shelves: CellarShelf[];
  focus: string | null;
  hovered: string | null;
  selected: string | null;
  appearing: Set<string>;
  onHover: (key: string | null) => void;
  onPick: (key: string) => void;
  onFocus: (id: string | null) => void;
}) {
  const wood = useLoader(THREE.TextureLoader, '/img/bois-casier.webp');
  useMemo(() => {
    wood.colorSpace = THREE.SRGBColorSpace;
    wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
    wood.repeat.set(2, 1);
    wood.anisotropy = 4;
  }, [wood]);
  const { size } = useThree();
  const layout = useMemo(() => sceneLayout(shelves), [shelves]);
  const place = useMemo(() => {
    const all = new Map<string, Placement>();
    for (const f of layout.frames) for (const [k, p] of f.bottles) all.set(k, p);
    return all;
  }, [layout]);
  const bottles = useMemo(() => shelves.flatMap((s) => s.bottles), [shelves]);
  const controls = useRef<OrbitControlsImpl | null>(null);
  const aspect = size.width / Math.max(1, size.height);
  const fit = (w: number, h: number) => {
    // Distance pour voir une largeur w et une hauteur h (champ vertical de 35°).
    const tan = Math.tan(THREE.MathUtils.degToRad(35 / 2));
    return Math.max(h / (2 * tan), w / (2 * tan * aspect)) * 1.04 + 0.08;
  };
  const target = useMemo(() => {
    const f = layout.frames.find((x) => x.id === focus);
    if (f) return { x: 0, y: (f.top + f.bottom) / 2, dist: fit(f.width, f.top - f.bottom) };
    return { x: 0, y: -layout.height / 2, dist: fit(layout.width, layout.height) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, focus, aspect]);
  const hoveredBottle = hovered ? bottles.find((b) => b.key === hovered) : undefined;
  const hp = hovered ? place.get(hovered) : undefined;
  return (
    <>
      <Environment />
      <ambientLight intensity={0.45} color="#ffe2c2" />
      <hemisphereLight args={['#ffd2a1', '#1a0f0b', 0.5]} />
      <directionalLight position={[0.4, 1.0, 2.2]} intensity={1.25} color="#ffe6c8" />
      {layout.frames.map((f, i) => (
        <Shelf key={f.id} frame={f} shelf={shelves[i]} wood={wood} />
      ))}
      <Bottles bottles={bottles} place={place} hovered={hovered} selected={selected} appearing={appearing} onHover={onHover} onPick={onPick} />
      {layout.frames.map((f, i) => (
        <Html key={`l-${f.id}`} position={[-f.width / 2 + 0.02, f.top - 0.03, FRONT + 0.01]} zIndexRange={[20, 0]}>
          <button type="button" className="shelf3d-label" tabIndex={-1} aria-hidden onClick={() => onFocus(focus === f.id ? null : f.id)}>
            {shelves[i].label} <span>{shelves[i].bottles.length + shelves[i].overflow}</span>
          </button>
        </Html>
      ))}
      {hoveredBottle && hp && (
        <Html position={[hp.x, hp.y + 0.05, FRONT + 0.05]} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
          <div className="bottle3d-tip" role="presentation">
            <strong>{wineTitle(hoveredBottle.row.wine)}</strong>
            <span>{MATURITY_LABELS[hoveredBottle.row.maturity]}</span>
          </div>
        </Html>
      )}
      <OrbitControls
        ref={controls}
        enableRotate={false}
        enableDamping={false}
        screenSpacePanning
        minDistance={0.25}
        maxDistance={target.dist * 1.6 + 1}
        zoomSpeed={0.8}
      />
      <CameraRig target={target} controls={controls} />
    </>
  );
}

export default function CellarScene3D(props: {
  shelves: CellarShelf[];
  focus: string | null;
  hovered: string | null;
  selected: string | null;
  appearing: Set<string>;
  onHover: (key: string | null) => void;
  onPick: (key: string) => void;
  onFocus: (id: string | null) => void;
  onLost: () => void;
}) {
  const [ready, setReady] = useState(false);
  // Fermer la scène (passage à la vue liste) libère aussi le contexte WebGL : ce n'est pas une panne.
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  return (
    <div className={`cellar3d${ready ? ' ready' : ''}`} aria-hidden>
      <Canvas
        frameloop="demand"
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        camera={{ fov: 35, near: 0.02, far: 40, position: [0, -0.5, 3] }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
          gl.domElement.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            // Vérifié après coup : à la fermeture de la scène, « alive » est déjà faux.
            setTimeout(() => alive.current && props.onLost(), 0);
          });
          setReady(true);
        }}
        onPointerMissed={() => props.onHover(null)}
      >
        <Suspense fallback={null}>
          <Scene {...props} />
        </Suspense>
      </Canvas>
    </div>
  );
}

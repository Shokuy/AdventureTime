import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { wait, all, type Script, type Waiter } from '../../../../game/coroutine';
import { LEVEL_PLUGINS, type Level3D, type Npc3 } from '../../level';
import { glow } from '../town/kit';
import { TOWN_HOOKS } from '../town';
import { TownHub, arcStage, type Figure } from '../town/hub';
import { say, type SpeakerId } from '../town/speech';
import { INTERLUDE, type Line } from './lines';

/*
 * The hub's lab interludes between the series of «Ночь клыков» (docs/script-fangs.md §5.9, §6.7, §7.7, §8.8): back in
 * Пастильное королевство by day, the first time anyone walks into the lab after series N of the arc, its scene plays
 * once (TOWN_HOOKS.labScene: the hub's host / solo decides, by the room's progress; a world scene for everyone).
 * The lab shows the arc's progress too: three flasks on a shelf fill one by one (Светик, Полдник, the sun dust), and
 * the Солнечная пушка on wheels waits in the yard before the last night.
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const NAMES = ['hub_after_fangs1', 'hub_after_fangs2', 'hub_after_fangs3', 'hub_after_fangs4'];
/** the flask shelf in the lab (by Ноки's window) and the cannon in the yard */
const SHELF = V(4.5, 0, -34.3);
const CANNON = V(6.4, 0, -25.6);

const hubOf = (L: Level3D) => L.refs.town as TownHub | undefined;

/** a figure walks to (x, z) (a Waiter, capped) */
function walk(f: Figure, x: number, z: number, speed = 2.2, max = 4): Waiter {
  f.walk = { to: V(x, f.g.position.y, z), speed };
  let t = 0;
  return { update: (dt) => { t += dt; if (t > max && f.walk) { f.walk = null; f.g.position.set(x, f.g.position.y, z); } return !f.walk; } };
}
function face(f: Figure, at: THREE.Vector3) { f.face = Math.atan2(at.x - f.g.position.x, at.z - f.g.position.z); }

function* speak(L: Level3D, figs: Partial<Record<string, Figure>>, ls: Line[]): Script {
  for (const [who, text, expr] of ls) {
    const f = figs[who];
    if (f) f.anim.expr = (expr as never) ?? 'normal';
    yield say(L, who as SpeakerId, text, expr);
    if (f) f.anim.expr = 'normal';
  }
}

/** the four (scene figures), the hub's own Пастила / Ноки set aside for the scene */
function stage4(hub: TownHub, at: Record<'tosha' | 'bublik' | 'pastila' | 'noki', [THREE.Vector3, number]>) {
  const hidden: Figure[] = [];
  for (const k of ['pastila', 'noki']) { const f = hub.figures.get(k); if (f && f.g.visible) { f.g.visible = false; hidden.push(f); } }
  const figs: Record<string, Figure> = {};
  for (const k of ['tosha', 'bublik', 'pastila', 'noki'] as const) figs[k] = hub.figure('i_' + k, k, at[k][0], at[k][1]);
  return {
    figs,
    done() { for (const k of ['tosha', 'bublik', 'pastila', 'noki']) hub.dropFigure('i_' + k); for (const f of hidden) f.g.visible = true; },
  };
}

/** the lab scenes 5.9 / 6.7 / 7.7 — the four at the flask shelf */
function* labInterlude(L: Level3D, n: number): Script {
  const hub = hubOf(L);
  if (!hub) return;
  L.cutscene(true);
  L.hud.chapter = null;
  const s = SHELF;
  // the shelf faces the lab's middle; the four stand in a little arc in front of it
  const fwd = V(0 - s.x, 0, -36 - s.z).normalize(), side = V(-fwd.z, 0, fwd.x);
  const G = s.clone().addScaledVector(fwd, 2.3);
  const at = (a: number, b: number) => G.clone().addScaledVector(side, a).addScaledVector(fwd, b);
  const shelfLook = s.clone().setY(1.5);
  const yawTo = (p: THREE.Vector3) => Math.atan2(s.x - p.x, s.z - p.z);
  const marks = { pastila: at(-1.25, -0.35), tosha: at(-0.4, 0.3), bublik: at(0.45, 0.35), noki: at(1.3, 0) };
  const st = stage4(hub, {
    pastila: [marks.pastila, yawTo(marks.pastila)], tosha: [marks.tosha, yawTo(marks.tosha)], bublik: [marks.bublik, yawTo(marks.bublik)], noki: [marks.noki, yawTo(marks.noki)],
  });
  const f = st.figs;
  // a shot from beside the shelf: the four's faces, the flasks at the edge of the frame
  const group = () => L.shot(s.clone().addScaledVector(fwd, 0.7).addScaledVector(side, -1.9).setY(1.75), G.clone().addScaledVector(side, 0.2).setY(1.05), 0.5);
  try {
    for (const k of Object.values(f)) face(k, shelfLook);
    // over their shoulders at the shelf (the flasks), then the faces
    yield L.shot(s.clone().addScaledVector(fwd, 4.4).addScaledVector(side, -0.8).setY(2.1), shelfLook, 0);
    yield all(L.shot(s.clone().addScaledVector(fwd, 3.8).addScaledVector(side, -0.6).setY(1.95), shelfLook, 1.2), wait(0.4));
    const ls = INTERLUDE[n];
    for (let i = 0; i < ls.length; i++) {
      if (i === 1) yield group();
      const who = ls[i][0];
      const fig = f[who];
      if (fig && i > 1 && ls[i - 1][0] !== who) {
        // a look at the speaker, from the shelf's side (the face, the others behind)
        const p = fig.g.position;
        const toShelf = s.clone().sub(p).setY(0).normalize();
        yield L.shot(p.clone().addScaledVector(toShelf, 1.9).addScaledVector(side, -0.6).setY(1.55), p.clone().setY(1.15), 0.45);
        for (const k of Object.values(f)) if (k !== fig) face(k, p);
      } else if (i > 1 && !fig) yield group();
      yield* speak(L, f, [ls[i]]);
    }
    yield wait(0.3);
  } finally {
    st.done();
  }
  L.cutscene(false);
  yield L.camBack(0.6);
}

/** 8.8 — the lab's yard: the Солнечная пушка on wheels, Ириска with her wrench, Вторник come to see them off */
function* yardInterlude(L: Level3D): Script {
  const hub = hubOf(L);
  if (!hub) return;
  L.cutscene(true);
  L.hud.chapter = null;
  const c = CANNON;
  const st = stage4(hub, {
    pastila: [V(c.x + 1.6, 0, c.z + 1.6), -2.4], tosha: [V(c.x - 1.0, 0, c.z + 3.0), 3.0], bublik: [V(c.x + 0.4, 0, c.z + 3.4), 3.0], noki: [V(c.x - 2.4, 0, c.z + 2.2), 2.4],
  });
  const f = st.figs;
  // Ириска (the hub's) at the wheel, the bear walks over
  const iri = hub.folk.find((x) => x.id === 'iriska');
  const iriHome = iri ? { p: iri.g.position.clone(), y: iri.g.rotation.y, mode: iri.mode } : null;
  if (iri) { iri.g.position.set(c.x + 1.4, 0, c.z - 0.8); iri.g.rotation.y = -1.2; iri.mode = 'stand'; iri.homeYaw = -1.2; }
  const prevBear = L.npcs.bear;
  const bear: Npc3 = L.npc('bear', c.x - 3.9, 0, c.z + 3.4, 1.9, 0.8);
  bear.anim.state = 'stand';
  try {
    for (const k of Object.values(f)) face(k, c);
    yield L.shot(V(c.x + 4.2, 2.6, c.z + 7.4), c.clone().setY(1.3), 0);
    yield all(L.shot(V(c.x + 3.4, 2.2, c.z + 6.4), c.clone().setY(1.2), 1.6), wait(0.6));
    const ls = INTERLUDE[4];
    yield* speak(L, f, ls.slice(0, 1));
    if (iri) { iri.waveT = 1.2; yield L.shot(V(c.x + 3.2, 1.6, c.z + 1.6), iri.g.position.clone().setY(1.0), 0.5); }
    audio.sfx('clang', { pitch: 1.6, volume: 0.5 });
    yield* speak(L, f, ls.slice(1, 2));
    yield L.shot(V(c.x - 1.8, 2.0, c.z + 7.6), bear.root.position.clone().setY(1.6), 0.6);
    for (const k of Object.values(f)) face(k, bear.root.position);
    yield* speak(L, f, ls.slice(2, 5));
    yield L.shot(V(c.x - 0.6, 1.8, c.z + 6.6), V(c.x - 1.6, 1.2, c.z + 2.8), 0.5);
    for (const k of Object.values(f)) face(k, f.tosha.g.position);
    yield* speak(L, f, ls.slice(5));
    yield wait(0.3);
  } finally {
    st.done();
    L.scene.remove(bear.root);
    L.npcList.splice(L.npcList.indexOf(bear), 1);
    if (prevBear) L.npcs.bear = prevBear;
    if (iri && iriHome) { iri.g.position.copy(iriHome.p); iri.g.rotation.y = iriHome.y; iri.homeYaw = iriHome.y; iri.mode = iriHome.mode; }
  }
  L.cutscene(false);
  yield L.camBack(0.6);
}

export const INTERLUDE_SCRIPTS: Record<string, (L: Level3D) => Script> = {
  hub_after_fangs1: (L) => labInterlude(L, 1),
  hub_after_fangs2: (L) => labInterlude(L, 2),
  hub_after_fangs3: (L) => labInterlude(L, 3),
  hub_after_fangs4: (L) => yardInterlude(L),
};

/** TOWN_HOOKS.labScene: the interlude of this arc stage (1–4); keeps whatever hook was there for other stages */
export function installLabHook() {
  const prev = TOWN_HOOKS.labScene;
  TOWN_HOOKS.labScene = (stage: number) => (stage >= 1 && stage <= 4 ? NAMES[stage - 1] : prev ? prev(stage) : null);
}

// ───────────────────────── the lab's look by stage (the hub level) ─────────────────────────

/** three flasks with tags on a little shelf; filled ones glow (stage 2: Светик, 3: Полдник, 4: the sun dust) */
function flaskShelf(L: Level3D, stage: number) {
  const g = new THREE.Group();
  const wood = new THREE.MeshToonMaterial({ color: '#8a5a32' });
  const board = (y: number) => { const b = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.5), wood); b.position.y = y; b.castShadow = true; g.add(b); };
  board(0.9); board(1.6);
  for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.75, 0.45), wood); p.position.set(sx * 0.92, 0.87, 0); g.add(p); }
  const fills = [
    { c: '#d8ff7a', e: '#a8e040' }, // Слеза светлячка («Светик»)
    { c: '#ffb04a', e: '#ff7a10' }, // Корень полуденника («Полдник»)
    { c: '#ffe14a', e: '#ffc010' }, // Пыль солнечного камня
  ];
  fills.forEach((f, i) => {
    const x = -0.6 + i * 0.6;
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), new THREE.MeshToonMaterial({ color: '#e8f8ff', transparent: true, opacity: 0.5 }));
    glass.position.set(x, 1.85, 0); g.add(glass);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.22, 10), new THREE.MeshToonMaterial({ color: '#e8f8ff', transparent: true, opacity: 0.55 }));
    neck.position.set(x, 2.13, 0); g.add(neck);
    const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.06, 0.08, 8), new THREE.MeshToonMaterial({ color: '#c8803e' }));
    cork.position.set(x, 2.27, 0); g.add(cork);
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.12), new THREE.MeshToonMaterial({ color: '#fff4e0', side: THREE.DoubleSide }));
    tag.position.set(x, 1.78, 0.21); g.add(tag);
    if (stage >= i + 2) {
      const liquid = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshToonMaterial({ color: f.c, emissive: f.e, emissiveIntensity: 0.8 }));
      liquid.position.set(x, 1.82, 0); g.add(liquid);
      const gl = glow(f.c, 0.9, 0.55); gl.position.set(x, 1.85, 0.05); g.add(gl);
    }
  });
  g.position.copy(SHELF);
  g.rotation.y = Math.atan2(-SHELF.x, -36 - SHELF.z);
  L.deco(g);
  L.col({ kind: 'box', min: V(SHELF.x - 0.5, 0, SHELF.z - 0.5), max: V(SHELF.x + 0.5, 1.8, SHELF.z + 0.5) });
}

/** the Солнечная пушка on wheels (one wheel tied on with string) */
function sunCannon(L: Level3D) {
  const g = new THREE.Group();
  const brass = new THREE.MeshToonMaterial({ color: '#e8b040', emissive: '#7a4a10', emissiveIntensity: 0.15 });
  const wood = new THREE.MeshToonMaterial({ color: '#c87a4a' });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.62, 2.6, 18), brass);
  barrel.rotation.x = Math.PI / 2 - 0.45; barrel.position.set(0, 1.35, 0.2); g.add(barrel);
  for (const z of [-0.6, 0.4, 1.2]) { const band = new THREE.Mesh(new THREE.TorusGeometry(0.56 - z * 0.08, 0.06, 6, 20), new THREE.MeshToonMaterial({ color: '#ff7aa8' })); band.position.set(0, 1.35 + z * Math.sin(0.45) * 0.9, 0.2 + z * Math.cos(0.45)); band.rotation.x = -0.45; g.add(band); }
  const sun = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), new THREE.MeshToonMaterial({ color: '#ffd34a', emissive: '#ffb020', emissiveIntensity: 0.7 }));
  sun.position.set(0, 2.05, 1.65); g.add(sun);
  const gl = glow('#ffd34a', 1.6, 0.5); gl.position.copy(sun.position); g.add(gl);
  const cart = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 2.0), wood); cart.position.set(0, 0.75, 0); g.add(cart);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.09, 8, 18), wood);
    w.rotation.y = Math.PI / 2; w.position.set(sx * 0.72, 0.5, sz * 0.75);
    if (sx === 1 && sz === 1) { w.rotation.z = 0.25; w.position.y = 0.46; const rope = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 6, 12), new THREE.MeshToonMaterial({ color: '#fff4d8' })); rope.position.copy(w.position); rope.rotation.y = Math.PI / 2; g.add(rope); }
    g.add(w);
  }
  g.position.copy(CANNON);
  g.rotation.y = -0.6;
  L.deco(g);
  L.col({ kind: 'cyl', x: CANNON.x, z: CANNON.z, r: 1.2, y0: 0, y1: 1.6 });
}

let plugged = false;
export function installHubLook() {
  if (plugged) return;
  plugged = true;
  LEVEL_PLUGINS.push((L) => {
    if (L.def.id !== 'hub' || !(L.refs.town instanceof TownHub)) return null;
    const st = arcStage();
    if (st >= 1) flaskShelf(L, st);
    if (st >= 4) sunCannon(L);
    return null;
  });
}

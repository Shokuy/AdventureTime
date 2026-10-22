import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { ease } from '../../../../engine/util';
import { wait, all, tween, type Script, type Waiter } from '../../../../game/coroutine';
import type { Level3D } from '../../level';
import { createMouse, type MouseKind, type MouseAnim } from '../fangs5/rigs';

/*
 * «Тем временем в замке» (docs/script-fangs-v2.md §0, 5.9, 6.7): a short tag at the end of a series. No hall is built:
 * a long-lens shot of Замок Полночь on its rock against the moon, far away in the direction of `L.refs.castleAt`; a
 * little bat-mouse (the beaten lieutenant, `createMouse(kind)`) flies across the frame into the glowing window of the
 * tall tower; then a slow push-in on the window: the King's silhouette, his cloak twitches (a little shadow with a
 * guitar tries to slip out of it). Every line is [за кадром] — spoken with the series' own `say` (portraits in the box).
 *
 *   yield* castleTag(L, [
 *     ['polnoch', 'Нетопырь. Тебя победили дети. И такса.'],
 *     ['netopyr', 'Пи! Такса нечестная! Она тянется!', 'scared'],
 *     ['polnoch', 'Ноки снова не одна. Как интересно.'],
 *     ['polnoch', 'Тише. Ты моя. Сто лет — моя.'],
 *   ], { say: (who, s, e) => say(L, who as Spk, s, e), mouse: 'netopyr', shot2At: 2, tugAt: 3 });
 *
 * Local visuals only (it runs on every machine like any scene script); it cleans up after itself, even when cut short.
 * It calls L.cutscene(true) if no cutscene is on, and leaves the cutscene state as it found it (no camBack: the caller
 * decides what comes next, e.g. finish() / endLevel).
 */

export type TagLine = [who: string, text: string, expr?: string];
export interface CastleTagOpts {
  /** the series' own say (its speaker ids → portraits) */
  say: (who: string, text: string, expr?: string) => Waiter;
  /** the beaten lieutenant as a mouse */
  mouse: MouseKind;
  /** carried in by Кар-Карыч (6.7, Мадам Морок) */
  raven?: boolean;
  /** the line index where К2 (the push-in on the window) starts (default: half the lines) */
  shot2At?: number;
  /** the line index at which the cloak twitches (the little shadow slips out; default: the last line); -1 = never */
  tugAt?: number;
  /** where the camera stands (default: where it is now, or the player's head) */
  from?: THREE.Vector3;
  /** the castle's direction / spot (default L.refs.castleAt, else north-west far away) */
  castleAt?: THREE.Vector3;
  /** the moon's colour (default Алая луна red) */
  moon?: string;
  /** a low `clang` on the last line (5.9) */
  clang?: boolean;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const flat = (color: string, o: THREE.MeshBasicMaterialParameters = {}) => new THREE.MeshBasicMaterial({ color, fog: false, ...o });

/** the window: red glow, the King's silhouette (crescent crown, long fingers, the cloak) */
function windowTex() {
  return canvasTex(128, 192, (g) => {
    const gr = g.createRadialGradient(64, 90, 10, 64, 96, 110);
    gr.addColorStop(0, '#ffb0a0'); gr.addColorStop(0.5, '#ff4a4a'); gr.addColorStop(1, '#5a0a1a');
    g.fillStyle = gr; g.beginPath(); g.moveTo(8, 192); g.lineTo(8, 60); g.arc(64, 60, 56, Math.PI, 0); g.lineTo(120, 192); g.closePath(); g.fill();
    g.fillStyle = '#100816';
    // cloak (wide, to the floor)
    g.beginPath(); g.moveTo(64, 70); g.quadraticCurveTo(22, 110, 18, 192); g.lineTo(110, 192); g.quadraticCurveTo(106, 110, 64, 70); g.fill();
    // head + crescent crown
    g.beginPath(); g.ellipse(64, 66, 13, 16, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(64, 44, 15, Math.PI * 0.95, Math.PI * 2.05); g.arc(64, 50, 11, Math.PI * 2.05, Math.PI * 0.95, true); g.fill();
    // a long-fingered hand at the sill
    g.save(); g.translate(92, 132); g.rotate(-0.3);
    for (let i = 0; i < 4; i++) g.fillRect(i * 4, -22, 2.4, 22);
    g.restore();
  });
}
/** the little shadow with pigtails and a guitar (the same look as fangs5's girlTex) */
function girlTex() {
  return canvasTex(64, 96, (g) => {
    g.scale(0.5, 0.5);
    g.fillStyle = 'rgba(10,6,20,0.95)';
    g.beginPath(); g.arc(64, 44, 18, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(40, 50, 6, 18, 0.35, 0, Math.PI * 2); g.ellipse(88, 50, 6, 18, -0.35, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(44, 62); g.lineTo(84, 62); g.lineTo(92, 130); g.lineTo(36, 130); g.closePath(); g.fill();
    g.fillRect(46, 128, 12, 50); g.fillRect(70, 128, 12, 50);
    g.beginPath(); g.ellipse(94, 112, 20, 15, 0.5, 0, Math.PI * 2); g.fill();
    g.save(); g.translate(78, 92); g.rotate(-0.7); g.fillRect(-3, -46, 6, 48); g.restore();
  });
}

interface Diorama { g: THREE.Group; win: THREE.Vector3; girl: THREE.Mesh; king: THREE.Mesh; dispose(): void }
/** the castle silhouette on its rock + the moon behind, `dist` m from the camera toward `dir` (fog-free) */
function diorama(L: Level3D, from: THREE.Vector3, dir: THREE.Vector3, dist: number, moonCol: string): Diorama {
  const g = new THREE.Group();
  const dark = flat('#120c1c');
  const base = from.clone().addScaledVector(dir, dist);
  base.y = from.y - 22;
  g.position.copy(base);
  g.lookAt(from.x, base.y, from.z);
  const rock = new THREE.Mesh(new THREE.ConeGeometry(16, 34, 7), dark); rock.position.y = 17; g.add(rock);
  const towers: [number, number, number][] = [[0, 22, 3.2], [-6, 15, 2.2], [6, 17, 2.4], [-2.2, 27, 1.5]];
  for (const [x, h, r] of towers) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 10), dark); t.position.set(x, 30 + h / 2, 0); g.add(t);
    const c = new THREE.Mesh(new THREE.ConeGeometry(r * 1.3, r * 2.4, 10), dark); c.position.set(x, 30 + h + r * 1.2, 0); g.add(c);
  }
  // the window of the tall tower, facing the camera: glow + the King
  const winLocal = V(0, 45, 3.3);
  const king = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.6), new THREE.MeshBasicMaterial({ map: windowTex(), fog: false, transparent: true }));
  king.position.copy(winLocal); g.add(king);
  const halo = new THREE.Mesh(new THREE.CircleGeometry(3.4, 24), flat('#ff4a4a', { transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.position.copy(winLocal).add(V(0, 0, -0.05)); g.add(halo);
  const girl = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.05), new THREE.MeshBasicMaterial({ map: girlTex(), fog: false, transparent: true, opacity: 0, depthWrite: false }));
  girl.position.copy(winLocal).add(V(0.2, -0.8, 0.06)); g.add(girl);
  // the moon behind (a big disc, its glow)
  const moon = new THREE.Mesh(new THREE.CircleGeometry(15, 40), flat(moonCol));
  moon.position.set(-9, 52, -40); g.add(moon);
  const mg = new THREE.Mesh(new THREE.CircleGeometry(26, 40), flat(moonCol, { transparent: true, opacity: 0.22, depthWrite: false }));
  mg.position.set(-9, 52, -40.5); g.add(mg);
  g.traverse((o) => { o.frustumCulled = false; (o as THREE.Mesh).renderOrder = 1; });
  L.scene.add(g);
  g.updateMatrixWorld(true);
  const win = king.getWorldPosition(new THREE.Vector3());
  return {
    g, win, girl, king,
    dispose() {
      g.removeFromParent();
      g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); const mt = m.material as THREE.MeshBasicMaterial; mt.map?.dispose(); mt.dispose(); } });
    },
  };
}

/** a simple raven carrying the mouse (6.7) */
function raven(): THREE.Group {
  const g = new THREE.Group();
  const m = flat('#141418');
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), m); body.scale.set(1, 0.9, 1.5); g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), m); head.position.set(0, 0.12, 0.28); g.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.16, 6), flat('#e8b040')); beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.1, 0.44); g.add(beak);
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.26), flat('#1c1c24', { side: THREE.DoubleSide }));
    w.position.set(s * 0.36, 0.05, 0); w.name = s > 0 ? 'wr' : 'wl'; g.add(w);
  }
  return g;
}

/** «Тем временем в замке» — see the file's header */
export function* castleTag(L: Level3D, lines: TagLine[], o: CastleTagOpts): Script {
  const wasCut = L.inCutscene;
  if (!wasCut) L.cutscene(true);
  const cam = L.tcam.cam;
  const from = (o.from ?? cam.position).clone();
  const target = o.castleAt ?? (L.refs.castleAt as THREE.Vector3 | undefined) ?? from.clone().add(V(-210, 0, -330));
  const dir = target.clone().sub(from).setY(0);
  if (dir.lengthSq() < 1) dir.set(-0.5, 0, -0.85);
  dir.normalize();
  const D = diorama(L, from, dir, 150, o.moon ?? '#ff5a4a');
  // the mouse (+ the raven): big enough to read in the long lens
  const mouse = createMouse(o.mouse);
  const ma: MouseAnim = { talk: 0, hop: 0, squeak: 0.6 };
  const flyer = new THREE.Group();
  flyer.add(mouse.root);
  const rv = o.raven ? raven() : null;
  if (rv) { flyer.add(rv); mouse.root.position.set(0, -0.42, 0.05); }
  flyer.scale.setScalar(4.2);
  flyer.traverse((x) => { x.frustumCulled = false; const mt = (x as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined; if (mt && 'fog' in mt) mt.fog = false; });
  L.scene.add(flyer);
  const side = V(-dir.z, 0, dir.x);
  const p0 = from.clone().addScaledVector(dir, 40).addScaledVector(side, -14).setY(D.win.y + 6);
  const p1 = D.win.clone().addScaledVector(dir, -2);
  flyer.position.copy(p0);
  // the long lens: hold a narrow fov while the tag runs
  let fovKick = -32, t = 0, tug = -1, inWin = false;
  const upd = (_t: number, dt: number) => {
    t += dt;
    L.tcam.fovKick = fovKick;
    mouse.update(dt, ma);
    if (rv) { const a = Math.sin(t * 14) * 0.7; const wr = rv.getObjectByName('wr'), wl = rv.getObjectByName('wl'); if (wr) wr.rotation.z = a; if (wl) wl.rotation.z = -a; }
    // the King breathes; the cloak twitches on the tug
    if (tug >= 0) {
      tug += dt;
      const k = Math.min(1, tug / 1.6);
      D.king.position.x = Math.sin(tug * 30) * 0.06 * (1 - k);
      const mat = D.girl.material as THREE.MeshBasicMaterial;
      // a little hand out, then pressed back in
      mat.opacity = Math.sin(Math.min(1, tug / 1.4) * Math.PI) * 0.95;
      D.girl.position.x = 0.2 + D.king.position.x + 0.9 * Math.sin(Math.min(1, tug / 1.4) * Math.PI);
    }
  };
  L.updaters.push(upd);
  const look1 = D.win.clone().add(V(0, -4, 0)).addScaledVector(dir, 0);
  const camAt = from.clone();
  try {
    audio.sfx('whoosh', { pitch: 0.6, volume: 0.35 });
    // К1: the castle against the moon, the mouse flies in
    yield L.shot(camAt, look1, 0);
    const flight = tween(2.6, (k) => {
      flyer.position.lerpVectors(p0, p1, k);
      flyer.position.y += Math.sin(k * Math.PI * 5) * 1.2 * (1 - k);
      flyer.lookAt(p1.x, flyer.position.y, p1.z);
      flyer.scale.setScalar(4.2 * (1 - k * 0.55));
      if (k >= 1 && !inWin) { inWin = true; flyer.visible = false; }
    }, ease.inOut);
    const split = Math.max(1, Math.min(lines.length, o.shot2At ?? Math.ceil(lines.length / 2)));
    const tugAt = o.tugAt ?? lines.length - 1;
    for (let i = 0; i < lines.length; i++) {
      if (i === split) {
        // К2: a slow push-in on the window
        flyer.visible = false;
        const w = L.shot(camAt.clone().addScaledVector(dir, 6), D.win.clone().add(V(0, -0.6, 0)), 2.6);
        const fk = tween(2.6, (k) => { fovKick = -32 - 14 * k; });
        yield all(w, fk, wait(0.3));
      }
      if (i === tugAt) { tug = 0; audio.sfx('whoosh', { pitch: 1.6, volume: 0.25 }); }
      if (o.clang && i === lines.length - 1) audio.sfx('clang', { pitch: 0.55, volume: 0.6 });
      const [who, text, expr] = lines[i];
      yield i === 0 ? all(o.say(who, text, expr), flight) : o.say(who, text, expr);
    }
    yield wait(0.4);
  } finally {
    const i = L.updaters.indexOf(upd);
    if (i >= 0) L.updaters.splice(i, 1);
    L.tcam.fovKick = 0;
    flyer.removeFromParent();
    D.dispose();
    if (!wasCut) L.cutscene(false);
  }
}

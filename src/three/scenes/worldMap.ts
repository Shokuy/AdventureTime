import * as THREE from 'three';
import { W, H, TAU, clamp, ease, lerp, srand } from '../../engine/util';
import { input } from '../../engine/input';
import { audio } from '../../engine/audio';
import { save } from '../../engine/save';
import { text, rrect, wrap, OUT } from '../../art/draw';
import { drawHint } from '../../ui/glyphs';
import { ChatPanel, QUICK_PHRASES, QP_ACTIONS } from '../../ui/chat';
import { drawMicBadge, drawSpeaker } from '../../ui/voiceHud';
import { MenuList } from '../../ui/widgets';
import { game, STORY } from '../../game/game';
import { net } from '../../net/session';
import { profile } from '../../net/profile';
import { MSG } from '../../net/protocol';
import { RT, toUI, viewUI } from '../runtime';
import { mat, basic, mesh, noOutline, canvasTex } from '../gfx';
import { FX3 } from '../fx';
import * as O from '../world/outdoor';
import { type HeroAnim, type HeroRig } from '../models/hero';
import { createHeroModel } from '../models/heroes';
import { openHeroPicker } from '../game/heroes';
import type { HeroKind, HeroLook } from '../../net/profile';
import { coop } from '../game/coop';
import { coopFlow } from '../game/coopFlow';
import { drawCrown } from './lobby';
import {
  EPISODES, episodeList, mapEdges, neighbours, epState, openedBy, myProgress, playEpisode, takeReveal, isBuilt,
  partName, ARC_FANGS, type Episode, type EpState, type Progress,
} from '../game/episodes';

/*
 * «Карта Хрумляндии»: a 3D diorama of the land. Nodes are the episodes (episodes.ts) joined by dotted paths; my hero
 * figurine walks them — arrows / stick / d-pad pick the neighbour in that direction on screen, a click walks to any
 * node. The node card shows the series, title, medals and «Играть» / «Переиграть» / the prologue's chapters.
 * Locked lands are dark silhouettes under clouds (the clouds lift when one opens); future lands stay that way.
 * Esc = main menu. Co-op: everyone walks a figurine and sees the others; the HOST's node and card are the room's
 * choice (clients see them and press «Готов»), the host starts the episode for the whole room (coopFlow).
 */

type C = CanvasRenderingContext2D;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const sstep = O.smoothstep;
const MAP_FIG = 'mapfig'; //  u  everyone -> all: my figurine { x, z, yw, mv, n }
const MAP_SEL = 'mapsel'; //     host -> all: the room's choice { n, f, s, sub } (+ prog every few s)
const FIG_SCALE = 3.1;
const WALK_SPEED = 15;
const WATER_Y = -0.5;
/** the camera keeps its target inside this box */
const CAM_BOX = { x0: -46, x1: 50, z0: -38, z1: 30 };

function heroAnim(o: Partial<HeroAnim> = {}): HeroAnim {
  return { state: 'idle', speed: 0, attack: null, weapon: 'none', flash: 0, talk: 0, expr: 'happy', squash: 1, ...o };
}

// ───────────────────────── the land ─────────────────────────
/** regions: ground tint + where their landmark stands (offset north of the node so the pin stays in front) */
interface Region { cx: number; cz: number; r: number; color: string }
const REGION: Record<string, Region> = {
  pit: { cx: -45, cz: 12, r: 12, color: '#9a7a52' },
  pastila: { cx: -18, cz: -1, r: 13, color: '#f2bfd0' },
  square: { cx: 3, cz: 10, r: 8, color: '#e8cba8' },
  swamp: { cx: 28, cz: 4, r: 11, color: '#5d7d4e' },
  glass: { cx: 10, cz: -18, r: 9, color: '#b4e0cc' },
  pass: { cx: 33, cz: -26, r: 13, color: '#5e5468' },
  castle: { cx: 51, cz: -44, r: 11, color: '#3c3248' },
  lemon: { cx: -48, cz: -21, r: 12, color: '#e6d45c' },
  ice: { cx: -18, cz: -43, r: 12, color: '#eef4fa' },
  fire: { cx: 61, cz: -5, r: 10, color: '#9a4a30' },
  carnival: { cx: 32, cz: 26, r: 9, color: '#f0b0d8' },
};

const ISLE = { cx: 4, cz: -4, rx: 76, rz: 55 };
/** > 0 on the island (1 in the middle, 0 at the coast) */
function isleK(x: number, z: number) {
  const a = Math.atan2(z - ISLE.cz, x - ISLE.cx);
  const wob = 1 + 0.07 * Math.sin(3 * a + 1) + 0.05 * Math.sin(5 * a + 2.3) + 0.03 * Math.sin(9 * a + 0.4);
  return 1 - Math.hypot((x - ISLE.cx) / ISLE.rx, (z - ISLE.cz) / ISLE.rz) / wob;
}
const bump = (x: number, z: number, cx: number, cz: number, r: number, h: number) => h * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (r * r));
/** ground height of the diorama */
function groundH(x: number, z: number): number {
  const k = isleK(x, z);
  let h = lerp(-6, 0, sstep(-0.14, 0.06, k));
  const inland = sstep(0.04, 0.2, k);
  h += (Math.sin(x * 0.13) * Math.cos(z * 0.11) + Math.sin(x * 0.07 + z * 0.05 + 1.3)) * 0.45 * inland;
  // the pit: a rim and a bowl
  const P = REGION.pit, dp = Math.hypot(x - P.cx, z - P.cz);
  h += 1.4 * Math.exp(-((dp - 7) ** 2) / 4) - 4.5 * sstep(6.2, 3.2, dp);
  // the swamp sits low (the water shows through)
  const S = REGION.swamp; h -= 1.25 * sstep(10, 5, Math.hypot(x - S.cx, z - S.cz));
  // the black pass and the ice mountain: rough hills; lemon hills; the castle's sea cliff stands on its own
  h += bump(x, z, 25, -32, 7, 4) + bump(x, z, 35, -38, 6, 4.5) + bump(x, z, 45, -19, 5, 3) + bump(x, z, 22, -22, 5, 2.5) + bump(x, z, 17, -30, 5, 2.5);
  h += bump(x, z, -20, -46, 9, 5) + bump(x, z, -8, -44, 6, 2.5);
  h += bump(x, z, -52, -24, 6, 2.2) + bump(x, z, -42, -26, 5, 1.6) + bump(x, z, -54, -12, 5, 1.4);
  h += bump(x, z, 62, -6, 8, 2);
  // flatten around the nodes (the pins stand level)
  for (const e of episodeList()) {
    const d = Math.hypot(x - e.node.x, z - e.node.z);
    if (d < 6) h = lerp(nodeBase(e), h, sstep(2.6, 6, d));
  }
  return h;
}
/** the ground under a node before flattening (sampled once) */
const nodeBaseCache = new Map<string, number>();
function nodeBase(e: Episode) {
  let h = nodeBaseCache.get(e.id);
  if (h === undefined) {
    const { x, z } = e.node;
    const k = isleK(x, z);
    h = lerp(-6, 0, sstep(-0.14, 0.06, k)) + (Math.sin(x * 0.13) * Math.cos(z * 0.11) + Math.sin(x * 0.07 + z * 0.05 + 1.3)) * 0.45 * sstep(0.04, 0.2, k);
    h = Math.max(h, 0.05);
    nodeBaseCache.set(e.id, h);
  }
  return h;
}

function buildTerrain(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(190, 140, 190, 140);
  geo.rotateX(-Math.PI / 2);
  geo.translate(6, 0, -4);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const cols = new Float32Array(pos.count * 3);
  const c = new THREE.Color(), tmp = new THREE.Color();
  const grassA = new THREE.Color('#7fb24a'), grassB = new THREE.Color('#9cc85a'), sand = new THREE.Color('#ecd9a0');
  const deep = new THREE.Color('#2e6f96'), gloomC = new THREE.Color('#463a5c');
  const regs = Object.values(REGION).map((r) => ({ ...r, col: new THREE.Color(r.color) }));
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = groundH(x, z);
    pos.setY(i, h);
    const n = 0.5 + 0.5 * Math.sin(x * 0.31 + Math.sin(z * 0.23) * 2) * Math.cos(z * 0.27 - x * 0.1);
    c.copy(grassA).lerp(grassB, n);
    for (const r of regs) {
      const d = Math.hypot(x - r.cx, z - r.cz);
      const w = sstep(r.r, r.r * 0.35, d);
      if (w > 0) c.lerp(r.col, w * 0.85);
    }
    // the far north-east is the vampires' night
    const gl = sstep(-6, 44, x) * sstep(14, -40, z);
    c.lerp(gloomC, gl * 0.4);
    // rocky slopes, the pit's dark bowl, beaches, the sea floor
    if (h > 2.2) c.lerp(tmp.set('#77708a'), sstep(2.2, 5, h) * 0.6);
    if (Math.hypot(x - REGION.pit.cx, z - REGION.pit.cz) < 6.5) c.lerp(tmp.set('#4a3626'), sstep(-0.5, -3.5, h));
    c.lerp(sand, sstep(0.2, -0.45, h) * (1 - sstep(-0.7, -1.4, h) * 0) * (Math.hypot(x - REGION.swamp.cx, z - REGION.swamp.cz) < 11 ? 0.2 : 1));
    if (isleK(x, z) < 0.16) c.lerp(deep, sstep(-0.9, -4, h));
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: (mat('#fff') as THREE.MeshToonMaterial).gradientMap });
  const t = mesh(geo, m, { cast: false, receive: true });
  t.name = 'terrain';
  return t;
}

/** the sea around the island: a grid over the coast without the island's middle (inland hollows stay dry), and a frame to the horizon */
function buildSea(): THREE.Group {
  const g = new THREE.Group();
  const m = mat('#4aa6cc', { transparent: true, opacity: 0.78 });
  const X0 = -110, X1 = 120, Z0 = -90, Z1 = 80;
  const grid = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0, 115, 85);
  grid.rotateX(-Math.PI / 2);
  grid.translate((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
  const pos = grid.attributes.position as THREE.BufferAttribute;
  const idx = grid.index!;
  const keep: number[] = [];
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
    const x = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, z = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    if (isleK(x, z) < 0.16) keep.push(a, b, c);
  }
  grid.setIndex(keep);
  g.add(new THREE.Mesh(grid, m));
  const far = 700;
  for (const [x0, x1, z0, z1] of [[-far, far, -far, Z0], [-far, far, Z1, far], [-far, X0, Z0, Z1], [X1, far, Z0, Z1]]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), m);
    p.rotation.x = -Math.PI / 2; p.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    g.add(p);
  }
  g.position.y = WATER_Y;
  g.traverse((o) => { o.receiveShadow = true; });
  noOutline(g);
  return g;
}

/** the sky: warm afternoon in the west, the vampires' night (stars) in the east */
function skyBall() {
  const tex = canvasTex(1024, 512, (g, w, h) => {
    for (let x = 0; x < w; x += 4) {
      const u = x / w;
      // north = u 0.75; east = 0.5; west = 0 / 1 — the night sits over Замок Полночь (north-east, u ≈ 0.62)
      const day = sstep(0.74, 0.98, u) + sstep(0.42, 0.18, u);
      const gr = g.createLinearGradient(0, 0, 0, h);
      const top = new THREE.Color('#1c1640').lerp(new THREE.Color('#4a78c8'), day);
      const mid = new THREE.Color('#5a3a78').lerp(new THREE.Color('#f2b090'), day);
      const low = new THREE.Color('#8a5a8a').lerp(new THREE.Color('#ffe2b0'), day);
      gr.addColorStop(0, '#' + top.getHexString()); gr.addColorStop(0.42, '#' + mid.getHexString()); gr.addColorStop(0.5, '#' + low.getHexString()); gr.addColorStop(1, '#' + low.getHexString());
      g.fillStyle = gr; g.fillRect(x, 0, 4, h);
    }
    const R = srand(3);
    for (let i = 0; i < 420; i++) {
      const u = 0.35 + R() * 0.45, v = R() * 0.45;
      const night = 1 - (sstep(0.74, 0.98, u) + sstep(0.42, 0.18, u));
      if (night < 0.3) continue;
      g.globalAlpha = night * (0.4 + R() * 0.6);
      g.fillStyle = '#fff8e8';
      const s = R() < 0.1 ? 3 : 1.6;
      g.fillRect(u * w, v * h, s, s);
    }
    g.globalAlpha = 1;
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(420, 48, 24), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }));
  noOutline(m);
  return m;
}

/** the big moon over Замок Полночь (a faint red rim: the Алая луна is coming) */
function moonSprite() {
  const tex = canvasTex(256, 256, (g, w) => {
    const c = w / 2;
    const halo = g.createRadialGradient(c, c, w * 0.2, c, c, w * 0.5);
    halo.addColorStop(0, 'rgba(255,120,120,0.55)'); halo.addColorStop(0.5, 'rgba(255,80,110,0.18)'); halo.addColorStop(1, 'rgba(255,80,110,0)');
    g.fillStyle = halo; g.fillRect(0, 0, w, w);
    const body = g.createRadialGradient(c - 18, c - 22, 10, c, c, w * 0.27);
    body.addColorStop(0, '#fffbe8'); body.addColorStop(0.75, '#f6e2c4'); body.addColorStop(1, '#f2b8a8');
    g.fillStyle = body; g.beginPath(); g.arc(c, c, w * 0.27, 0, TAU); g.fill();
    g.fillStyle = 'rgba(200,160,150,0.45)';
    for (const [x, y, r] of [[-20, -10, 12], [18, 16, 9], [10, -26, 6], [-14, 24, 7], [26, -4, 5]]) { g.beginPath(); g.arc(c + x, c + y, r, 0, TAU); g.fill(); }
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  noOutline(s);
  return s;
}

/** the banner on a node's flagpole: the series number (or a sign) */
function bannerTex(label: string, bg: string) {
  return canvasTex(128, 96, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, 0, w, 10);
    g.font = '900 64px Rubik, "Arial Black", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = OUT; g.lineJoin = 'round';
    g.strokeText(label, w / 2, h / 2 + 4);
    g.fillStyle = '#fffaf0'; g.fillText(label, w / 2, h / 2 + 4);
  });
}

// ───────────────────────── landmarks ─────────────────────────
/** a region's props; while its node is locked they show as dark silhouettes (materials swapped) */
class Landmark {
  g = new THREE.Group();
  anim: ((t: number) => void)[] = [];
  private sil = false;
  add<T extends THREE.Object3D>(o: T): T { this.g.add(o); return o; }
  cyl(rt: number, rb: number, h: number, c: string, x: number, y: number, z: number, seg = 14, flat = false) {
    const m = mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(c, { flat })); m.position.set(x, y + h / 2, z); return this.add(m);
  }
  cone(r: number, h: number, c: string, x: number, y: number, z: number, seg = 14, flat = false) {
    const m = mesh(new THREE.ConeGeometry(r, h, seg), mat(c, { flat })); m.position.set(x, y + h / 2, z); return this.add(m);
  }
  box(w: number, h: number, d: number, c: string, x: number, y: number, z: number, ry = 0) {
    const m = mesh(new THREE.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y + h / 2, z); m.rotation.y = ry; return this.add(m);
  }
  ball(r: number, c: string, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) {
    const m = mesh(new THREE.IcosahedronGeometry(r, 2), mat(c)); m.position.set(x, y, z); m.scale.set(sx, sy, sz); return this.add(m);
  }
  /** glowing bit (lamps, windows, wisps): unlit, no outline, hidden while a silhouette */
  glow(r: number, c: string, x: number, y: number, z: number) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), basic(c)); m.position.set(x, y, z); m.userData.glow = true; noOutline(m); return this.add(m);
  }
  /** silhouette ↔ colours (locked lands are dark shapes in the fog) */
  setSilhouette(on: boolean) {
    if (on === this.sil) return;
    this.sil = on;
    this.g.traverse((o) => {
      const m = o as THREE.Mesh;
      if ((o as THREE.Light).isLight) { o.visible = !on; return; }
      if (!m.isMesh && !(o as THREE.Sprite).isSprite) return;
      if (o.userData.glow) { o.visible = !on; return; }
      if (!m.isMesh) return;
      if (on) { m.userData.mat = m.material; m.material = SIL; } else if (m.userData.mat) m.material = m.userData.mat;
    });
  }
}
const SIL = mat('#3a3248');
const FP = new THREE.Vector3(), FS = new THREE.Vector3(), FQ = new THREE.Quaternion(), FM = new THREE.Matrix4();

function buildLandmark(look: string, R: () => number): Landmark {
  const L = new Landmark();
  const gh = (x: number, z: number) => groundH(x, z);
  const r = REGION[look];
  if (!r) return L;
  const { cx, cz } = r;
  switch (look) {
    case 'pit': {
      // the hole into the King's kingdom, a ladder up (Tosha's way out), rusty pipes and concrete bones of the old world
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.0, 9, 28, 1, true), new THREE.MeshBasicMaterial({ color: '#140c0a', side: THREE.BackSide }));
      hole.position.set(cx, -6.6, cz); L.add(hole);
      const bottom = new THREE.Mesh(new THREE.CircleGeometry(3.1, 28), basic('#0c0606')); bottom.rotation.x = -Math.PI / 2; bottom.position.set(cx, -8, cz); L.add(bottom);
      const glowL = new THREE.PointLight('#ff8a3a', 5, 8, 1.6); glowL.position.set(cx, -5, cz); L.add(glowL);
      L.glow(0.7, '#ff9a4a', cx, -5.5, cz).scale.set(3, 0.4, 3);
      for (let i = 0; i < 2; i++) {
        const a = 0.7 + i * 0.25;
        const rail = mesh(new THREE.BoxGeometry(0.16, 6.5, 0.16), mat('#9a6a3a'));
        rail.position.set(cx + Math.cos(a) * 3.3 + (i ? 0.7 : 0), -1.1, cz + Math.sin(a) * 3.3); rail.rotation.z = -0.35; L.add(rail);
      }
      for (let k = 0; k < 6; k++) { const rung = mesh(new THREE.BoxGeometry(0.9, 0.12, 0.12), mat('#b88a5a')); rung.position.set(cx + 2.2 + 0.35 + k * 0.32, -3.6 + k * 0.95, cz + 2.4); rung.rotation.z = -0.35; L.add(rung); }
      // rusty pipes
      for (const [px, pz, rx, rz, len] of [[-6.5, -2, 0.5, 0.3, 6], [5.5, -4.5, -0.4, 0.5, 5], [-3, 6.5, 0.2, -0.6, 4.5], [7.5, 3, -0.7, -0.2, 4]] as const) {
        const p = new THREE.Group();
        const tube = mesh(new THREE.CylinderGeometry(0.42, 0.42, len, 14), mat('#a85a32'));
        tube.position.y = len / 2; p.add(tube);
        for (const y of [len * 0.3, len * 0.85]) { const ring = mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.25, 14), mat('#6b3a22')); ring.position.y = y; p.add(ring); }
        p.position.set(cx + px, gh(cx + px, cz + pz) - 0.6, cz + pz); p.rotation.set(rx, 0, rz); L.add(p);
      }
      // concrete slabs with rebar
      for (const [sx, sz, ry, tilt] of [[-7, 3, 0.4, 0.35], [6, -7, -0.6, -0.3], [2, 8.5, 1.2, 0.25]] as const) {
        const s = mesh(new THREE.BoxGeometry(3.2, 0.7, 2.2), mat('#a4a29a')); s.position.set(cx + sx, gh(cx + sx, cz + sz) + 0.2, cz + sz); s.rotation.set(0, ry, tilt); L.add(s);
        for (let k = 0; k < 2; k++) { const rb = mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 5), mat('#7a3a24')); rb.position.set(cx + sx + 0.6 * k - 0.3, gh(cx + sx, cz + sz) + 1.1, cz + sz); rb.rotation.z = 0.4 - k * 0.5; L.add(rb); }
      }
      // dead trees at the rim
      for (const [tx, tz] of [[-8.5, -5], [8, 6.5]] as const) {
        const y = gh(cx + tx, cz + tz);
        L.cyl(0.18, 0.3, 3, '#5a4030', cx + tx, y, cz + tz, 7);
        const br = mesh(new THREE.CylinderGeometry(0.07, 0.12, 1.6, 6), mat('#5a4030')); br.position.set(cx + tx + 0.5, y + 2.4, cz + tz); br.rotation.z = -0.9; L.add(br);
      }
      break;
    }
    case 'pastila': {
      // marshmallow towers, a pastila wall with a gate toward the node, gingerbread houses, lollipop trees
      const towers: [number, number, number, number, string, string][] = [
        [0, -1, 9, 1.7, '#fff4f6', '#f07aa0'], [-4.5, 1.5, 6.5, 1.3, '#ffd6e4', '#6fd8b8'], [4.5, 0.5, 7, 1.35, '#e8f6ff', '#f29ac0'],
        [-2.5, -5, 10.5, 1.45, '#fff0d8', '#ff7aa8'], [3.5, -5.5, 8, 1.25, '#d8ffe8', '#f07aa0'], [-7.5, -3, 5.5, 1.1, '#fde8ff', '#8ab8ff'],
      ];
      for (const [dx, dz, h, rad, wall, roof] of towers) {
        const x = cx + dx, z = cz + dz, y = gh(x, z) - 0.2;
        L.cyl(rad, rad * 1.08, h, wall, x, y, z, 18);
        const puff = mesh(new THREE.TorusGeometry(rad * 1.02, rad * 0.32, 10, 20), mat('#ffffff')); puff.rotation.x = Math.PI / 2; puff.position.set(x, y + h, z); L.add(puff);
        L.cone(rad * 1.3, h * 0.45, roof, x, y + h, z, 18);
        L.ball(rad * 0.28, '#ffe680', x, y + h + h * 0.45 + rad * 0.15, z);
        for (let k = 0; k < 3; k++) { const a = k * 2.1 + dx; L.box(0.35, 0.6, 0.12, '#c05a8a', x + Math.sin(a) * rad * 1.02, y + h * (0.4 + k * 0.15), z + Math.cos(a) * rad * 1.02, a); }
      }
      // wall ring (gap to the south for the gate)
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * TAU;
        if (Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2))) < 0.42) continue;
        const x = cx + Math.cos(a) * 10, z = cz - 1.5 + Math.sin(a) * 8;
        L.box(2.3, 1.5, 1.1, i % 2 ? '#ffd0dc' : '#fff4f0', x, gh(x, z) - 0.2, z, -a + Math.PI / 2);
      }
      // gingerbread houses
      for (const [dx, dz, ry] of [[-8, 5, 0.3], [7.5, 4.5, -0.4], [9, -3, 0.9], [-10, -6, -0.6]] as const) {
        const x = cx + dx, z = cz + dz, y = gh(x, z) - 0.1;
        L.box(2, 1.6, 1.8, '#c07a3a', x, y, z, ry);
        const roof = mesh(new THREE.ConeGeometry(1.75, 1.3, 4), mat('#fff6f0')); roof.position.set(x, y + 2.2, z); roof.rotation.y = ry + Math.PI / 4; L.add(roof);
        L.box(0.5, 0.8, 0.1, '#7a3a1a', x + Math.sin(ry) * 0.92, y, z + Math.cos(ry) * 0.92, ry);
      }
      // lollipop trees
      const lolly = ['#ff5a8a', '#7ad8ff', '#ffd04a', '#9af08a', '#c88aff'];
      for (let i = 0; i < 9; i++) {
        const a = R() * TAU, rr = 11 + R() * 4;
        const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr * 0.8;
        if (Math.hypot(x - EPISODES.hub.node.x, z - EPISODES.hub.node.z) < 4) continue;
        const y = gh(x, z);
        L.cyl(0.1, 0.12, 2.2, '#fffaf0', x, y, z, 6);
        const pop = mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.3, 18), mat(lolly[i % lolly.length])); pop.rotation.x = Math.PI / 2; pop.rotation.z = R(); pop.position.set(x, y + 2.9, z); L.add(pop);
      }
      break;
    }
    case 'square': {
      // the town square: a fountain, lamps, houses — and bats circling over it
      const y0 = gh(cx, cz);
      L.cyl(5.5, 5.6, 0.18, '#dcc4a2', cx, y0 - 0.05, cz, 32);
      L.cyl(1.8, 1.9, 0.6, '#efe0f4', cx, y0, cz, 20);
      const water = new THREE.Mesh(new THREE.CircleGeometry(1.55, 20), mat('#8ad0ff')); water.rotation.x = -Math.PI / 2; water.position.set(cx, y0 + 0.55, cz); L.add(water);
      L.cyl(0.22, 0.3, 1.8, '#efe0f4', cx, y0, cz, 10);
      L.cyl(0.8, 0.4, 0.35, '#efe0f4', cx, y0 + 1.8, cz, 16);
      for (const [dx, dz, red] of [[-4, 2.5, 0], [4, 2.5, 1], [-4.5, -3, 0], [4.5, -3, 0]] as const) {
        const x = cx + dx, z = cz + dz;
        L.cyl(0.09, 0.12, 2.6, '#3a2a3a', x, y0, z, 6);
        L.glow(0.32, red ? '#ff5a6a' : '#ffd27a', x, y0 + 2.8, z);
      }
      for (const [dx, dz, w, h, wall, roof] of [[-5, -6.5, 2.6, 2.6, '#ffe0ea', '#e86a8a'], [-1, -7.5, 2.4, 3.2, '#e6f4ff', '#7a8ae8'], [3.5, -7, 2.8, 2.4, '#fff2d0', '#e8906a'], [7, -4.5, 2.2, 2.2, '#e8ffe8', '#e86a8a']] as const) {
        const x = cx + dx, z = cz + dz, y = gh(x, z) - 0.1;
        L.box(w, h, 2, wall, x, y, z);
        const rf = mesh(new THREE.ConeGeometry(w * 0.85, 1.5, 4), mat(roof)); rf.position.set(x, y + h + 0.75, z); rf.rotation.y = Math.PI / 4; L.add(rf);
        L.glow(0.18, '#ffd27a', x, y + h * 0.55, z + 1.02);
      }
      const bats = O.birdFlock(7, 12, '#24182c');
      L.add(bats.mesh);
      const c0 = V(cx, y0 + 7, cz - 1);
      L.anim.push((t) => { const a = t * 0.6; bats.update(t, V(c0.x + Math.cos(a) * 5, c0.y + Math.sin(t * 1.3) * 0.6, c0.z + Math.sin(a) * 3.5), -a, 0.9); });
      break;
    }
    case 'swamp': {
      const water = new THREE.Mesh(new THREE.CircleGeometry(10.5, 48), mat('#3e6a5c', { transparent: true, opacity: 0.88 }));
      water.rotation.x = -Math.PI / 2; water.position.set(cx, WATER_Y + 0.22, cz); water.receiveShadow = true; noOutline(water); L.add(water);
      // willows
      for (const [dx, dz, s] of [[-6, -3, 1.1], [5, -6, 1.2], [7.5, 3, 0.9], [-3, -8, 0.9], [-8.5, 4, 0.85]] as const) {
        const x = cx + dx, z = cz + dz, y = gh(x, z) - 0.3;
        const tr = mesh(new THREE.CylinderGeometry(0.22 * s, 0.4 * s, 3.4 * s, 7), mat('#4a3a2a')); tr.position.set(x, y + 1.7 * s, z); tr.rotation.z = 0.18; L.add(tr);
        for (let k = 0; k < 4; k++) L.ball(1.3 * s, k % 2 ? '#4f6e3a' : '#3f5e34', x + Math.cos(k * 1.7) * 1.1 * s, y + (3.3 - (k % 2) * 0.5) * s, z + Math.sin(k * 1.7) * 1.1 * s, 1, 0.75, 1);
      }
      // houses on stilts
      for (const [dx, dz, ry] of [[-2, -4.5, 0.3], [3, 1, -0.5], [-5.5, 1.5, 0.9]] as const) {
        const x = cx + dx, z = cz + dz, y = WATER_Y + 1.6;
        for (const [lx, lz] of [[-0.8, -0.7], [0.8, -0.7], [-0.8, 0.7], [0.8, 0.7]]) L.cyl(0.09, 0.09, 2.3, '#5a4632', x + lx, WATER_Y - 0.5, z + lz, 5);
        L.box(2, 1.3, 1.8, '#8a7a5a', x, y, z, ry);
        const rf = mesh(new THREE.ConeGeometry(1.75, 1.2, 4), mat('#5a4a3a')); rf.position.set(x, y + 1.9, z); rf.rotation.y = ry + Math.PI / 4; L.add(rf);
        L.glow(0.16, '#c8ffd8', x + Math.sin(ry) * 0.92, y + 0.7, z + Math.cos(ry) * 0.92);
      }
      // lily pads, reeds
      for (let i = 0; i < 14; i++) {
        const a = R() * TAU, rr = 2 + R() * 7.5;
        const pad = new THREE.Mesh(new THREE.CircleGeometry(0.35 + R() * 0.35, 12, 0.3, TAU - 0.6), mat('#6aa84a'));
        pad.rotation.x = -Math.PI / 2; pad.rotation.z = R() * TAU; pad.position.set(cx + Math.cos(a) * rr, WATER_Y + 0.26, cz + Math.sin(a) * rr); noOutline(pad); L.add(pad);
      }
      for (let i = 0; i < 18; i++) { const a = R() * TAU, rr = 8.5 + R() * 2.5; L.cone(0.08, 1.4 + R(), '#6a7a3a', cx + Math.cos(a) * rr, WATER_Y, cz + Math.sin(a) * rr, 5); }
      // will-o'-wisps
      const wisps: THREE.Mesh[] = [];
      for (let i = 0; i < 7; i++) { const w = L.glow(0.2, '#9affd8', cx + (R() - 0.5) * 14, 1.2, cz + (R() - 0.5) * 12); w.userData.base = w.position.clone(); w.userData.ph = R() * TAU; wisps.push(w); }
      L.anim.push((t) => { for (const w of wisps) { const b = w.userData.base as THREE.Vector3, ph = w.userData.ph as number; w.position.set(b.x + Math.sin(t * 0.5 + ph) * 1.2, b.y + Math.sin(t * 1.7 + ph) * 0.4, b.z + Math.cos(t * 0.4 + ph) * 1.2); } });
      break;
    }
    case 'glass': {
      const y0 = gh(cx, cz);
      L.cyl(6, 6.3, 0.6, '#d4cce0', cx, y0 - 0.2, cz, 32);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(5.2, 32, 14, 0, TAU, 0, Math.PI / 2), mat('#c4ecff', { transparent: true, opacity: 0.32, side: THREE.DoubleSide }));
      dome.position.set(cx, y0 + 0.4, cz); (dome.material as THREE.Material).depthWrite = false; L.add(dome);
      for (let k = 0; k < 6; k++) {
        const rib = mesh(new THREE.TorusGeometry(5.2, 0.08, 6, 36, Math.PI), mat('#eef4fa')); rib.position.set(cx, y0 + 0.4, cz); rib.rotation.y = (k / 6) * Math.PI; L.add(rib);
      }
      L.ball(0.4, '#eef4fa', cx, y0 + 5.7, cz);
      for (let i = 0; i < 6; i++) {
        const a = i * 1.05 + 0.3, rr = 1.2 + (i % 3) * 1.1;
        const cr = mesh(new THREE.OctahedronGeometry(0.55), mat('#c8a8ff', { emissive: '#7a4ad8', emissiveIntensity: 0.35, flat: true }));
        cr.scale.set(1, 2.4 + (i % 2), 1); cr.position.set(cx + Math.cos(a) * rr, y0 + 1.6, cz + Math.sin(a) * rr); cr.rotation.y = a; L.add(cr);
      }
      for (let k = 0; k < 3; k++) L.ball(0.8, '#5aa86a', cx - 2 + k * 2, y0 + 0.9, cz + 2.2, 1, 0.7, 1);
      // mirrors and shards outside
      for (const [dx, dz, ry] of [[-7.5, 1, 0.8], [7.2, -1.5, -0.7], [0, -7.8, 0], [-5, -6, 0.6]] as const) {
        const x = cx + dx, z = cz + dz, y = gh(x, z);
        L.box(0.2, 2.6, 1.6, '#8a8296', x, y, z, ry);
        const glass = mesh(new THREE.PlaneGeometry(1.3, 2.2), mat('#e8f4ff', { emissive: '#8aa8c8', emissiveIntensity: 0.3 })); glass.position.set(x + Math.cos(ry) * 0.12, y + 1.3, z - Math.sin(ry) * 0.12); glass.rotation.y = ry + Math.PI / 2; L.add(glass);
      }
      const beam = O.lightBeam(2.5, 6.5, 26, '#cfe4ff', 0.22);
      beam.mesh.position.set(cx, y0 + 13, cz); beam.mesh.userData.glow = true; L.add(beam.mesh);
      break;
    }
    case 'pass': {
      for (const [dx, dz, rad, h, c] of [[-8, -6, 6, 12, '#4e4660'], [2, -12, 5.5, 13, '#564c6c'], [12, 7, 5, 9, '#463e56'], [-11, 4, 4.5, 7, '#5a5070'], [-16, -4, 5, 9, '#4a4258']] as const) {
        const x = cx + dx, z = cz + dz;
        const m = L.cone(rad, h, c, x, gh(x, z) - 1.5, z, 7, true);
        m.rotation.y = dx;
        L.cone(rad * 0.32, h * 0.32, '#8a82a0', x, gh(x, z) - 1.5 + h * 0.68, z, 7, true).rotation.y = dx;
      }
      // a rope bridge over a ravine and broken pillars
      const by = gh(cx - 4, cz + 3) + 0.6;
      for (let k = 0; k < 9; k++) { const p = mesh(new THREE.BoxGeometry(0.42, 0.12, 1.6), mat('#6a4a2a')); p.position.set(cx - 7 + k * 0.62, by - Math.sin((k / 8) * Math.PI) * 0.5, cz + 3); p.rotation.z = 0.05 * (k - 4); L.add(p); }
      for (const s of [-0.8, 0.8]) { const rope = mesh(new THREE.CylinderGeometry(0.04, 0.04, 5.6, 5), mat('#c8a878')); rope.rotation.z = Math.PI / 2; rope.position.set(cx - 4.5, by + 0.6, cz + 3 + s); L.add(rope); }
      for (const [dx, dz, h, tilt] of [[3, 5, 2.4, 0], [5, 4, 1.4, 0.3], [-1, 7, 3, -0.15], [6.5, 8, 1, 0.6]] as const) {
        const x = cx + dx, z = cz + dz;
        L.cyl(0.4, 0.45, h, '#8a8496', x, gh(x, z) - 0.1, z, 10).rotation.z = tilt;
      }
      break;
    }
    case 'castle': {
      // a sea cliff with Замок Полночь on top
      const top = 10;
      const cliff = mesh(new THREE.CylinderGeometry(5.2, 8, top + 7, 9), mat('#3a3242', { flat: true })); cliff.position.set(cx, top - (top + 7) / 2, cz); L.add(cliff);
      for (const [dx, dz, s] of [[-6, 3, 2], [5, 5, 1.6], [7, -2, 1.4]] as const) L.ball(s, '#40384c', cx + dx, gh(cx + dx, cz + dz) + s * 0.3, cz + dz, 1.2, 0.8, 1);
      L.box(5, 3.4, 4, '#2e2638', cx, top, cz);
      for (const [dx, dz, rad, h, roof] of [[-2.6, 2, 0.9, 5, '#5a1a3a'], [2.6, 2, 0.9, 5.5, '#5a1a3a'], [-2.4, -2, 1, 6.5, '#2a1a2a'], [2.6, -1.8, 0.8, 4.5, '#5a1a3a'], [0, -0.5, 1.2, 9, '#2a1a2a']] as const) {
        const x = cx + dx, z = cz + dz;
        L.cyl(rad, rad * 1.1, h, '#3a2e48', x, top, z, 12);
        L.cone(rad * 1.35, rad * 3.4, roof, x, top + h, z, 12);
        L.glow(0.16, dx === 0 ? '#ff3a4a' : '#ffc860', x + 0.02, top + h * 0.7, z + rad * 1.02);
      }
      L.glow(0.2, '#ffc860', cx - 1, top + 1.8, cz + 2.02); L.glow(0.2, '#ff3a4a', cx + 1.2, top + 1.8, cz + 2.02);
      const red = new THREE.PointLight('#ff3a5a', 30, 26, 1.4); red.position.set(cx, top + 6, cz + 4); L.add(red);
      const bats = O.birdFlock(9, 21, '#1a1020');
      L.add(bats.mesh);
      L.anim.push((t) => { const a = -t * 0.5; bats.update(t, V(cx + Math.cos(a) * 7, top + 8 + Math.sin(t) * 0.8, cz + Math.sin(a) * 6), a + Math.PI, 1.1); });
      break;
    }
    case 'lemon': {
      for (let i = 0; i < 12; i++) {
        const a = R() * TAU, rr = 2 + R() * 9;
        const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr * 0.8, y = gh(x, z);
        L.cyl(0.14, 0.2, 1.6, '#7a5a30', x, y, z, 6);
        L.ball(1.1, i % 3 ? '#f2dc4a' : '#c8d84a', x, y + 2.3, z, 1, 1.3, 1);
      }
      L.box(4, 3, 3, '#f6e8a8', cx + 2, gh(cx + 2, cz - 3), cz - 3);
      for (const dx of [-0.6, 4.6]) { L.cyl(0.8, 0.8, 4.6, '#f6e8a8', cx + dx, gh(cx + dx, cz - 3), cz - 3, 12); L.cone(1.1, 2.4, '#d8b83a', cx + dx, gh(cx + dx, cz - 3) + 4.6, cz - 3, 12); }
      break;
    }
    case 'ice': {
      L.cone(9, 19, '#e8f0fa', cx, gh(cx, cz) - 2, cz, 9, true).rotation.y = 0.4;
      L.cone(5.5, 12, '#d8e6f6', cx + 8, gh(cx + 8, cz + 2) - 1.5, cz + 2, 8, true).rotation.y = 1.2;
      L.cone(4.5, 9, '#dce8f8', cx - 8, gh(cx - 8, cz + 3) - 1.5, cz + 3, 8, true);
      for (let i = 0; i < 6; i++) { const a = R() * TAU; const cr = mesh(new THREE.OctahedronGeometry(0.7), mat('#bfe8ff', { flat: true })); cr.scale.set(1, 2.2, 1); cr.position.set(cx + Math.cos(a) * 9, gh(cx + Math.cos(a) * 9, cz + 6) + 1, cz + 6 + Math.sin(a) * 2); L.add(cr); }
      break;
    }
    case 'fire': {
      const y = gh(cx, cz) - 1;
      L.cyl(2.4, 8, 9, '#6a3a2a', cx, y, cz, 12, true);
      const lava = new THREE.Mesh(new THREE.CircleGeometry(2.3, 16), basic('#ff7a2a')); lava.rotation.x = -Math.PI / 2; lava.position.set(cx, y + 9.05, cz); lava.userData.glow = true; noOutline(lava); L.add(lava);
      for (let i = 0; i < 5; i++) { const a = i * 1.3; L.cone(0.9, 2.2, '#8a4a30', cx + Math.cos(a) * 9, gh(cx + Math.cos(a) * 9, cz + Math.sin(a) * 7), cz + Math.sin(a) * 7, 6, true); }
      break;
    }
    case 'carnival': {
      for (const [dx, dz, rad, c] of [[-3, 0, 2.2, '#f06aa8'], [3, -2, 1.8, '#6ab8f0'], [0, 4, 1.6, '#ffd04a']] as const) {
        const x = cx + dx, z = cz + dz, y = gh(x, z);
        L.cyl(rad, rad, 1.8, '#fff4f0', x, y, z, 12);
        L.cone(rad * 1.2, 2.4, c, x, y + 1.8, z, 12);
      }
      const wy = gh(cx + 6, cz - 3) + 5;
      const wheel = new THREE.Group();
      wheel.add(mesh(new THREE.TorusGeometry(3.2, 0.14, 8, 32), mat('#e8e0f0')));
      for (let k = 0; k < 8; k++) { const sp = mesh(new THREE.BoxGeometry(0.1, 6.4, 0.1), mat('#e8e0f0')); sp.rotation.z = (k / 8) * Math.PI; wheel.add(sp); }
      wheel.position.set(cx + 6, wy, cz - 3); L.add(wheel);
      for (const s of [-1, 1]) { const leg = mesh(new THREE.BoxGeometry(0.25, 5.6, 0.25), mat('#c8c0d8')); leg.position.set(cx + 6 + s * 1.4, wy - 2.6, cz - 3); leg.rotation.z = s * 0.25; L.add(leg); }
      L.anim.push((t) => { wheel.rotation.z = t * 0.25; });
      for (let i = 0; i < 6; i++) L.ball(0.45, ['#ff5a8a', '#7ad8ff', '#ffd04a'][i % 3], cx - 6 + i * 0.6, gh(cx - 6, cz + 2) + 3 + (i % 2) * 0.6, cz + 2, 1, 1.2, 1);
      break;
    }
  }
  return L;
}

// ───────────────────────── nodes, paths, figurines ─────────────────────────
interface MapNode {
  ep: Episode;
  /** where a figurine stands (the pin's top) */
  pos: THREE.Vector3;
  pin: THREE.Group;
  flag: THREE.Mesh;
  ring: THREE.Mesh;
  lock: THREE.Group;
  land: Landmark | null;
  /** cartoon cloud puffs over a locked land (opaque blobs: they hide what's under them, outlines included) */
  fog: { mesh: THREE.InstancedMesh; items: { base: THREE.Vector3; s: THREE.Vector3; ph: number; dir: THREE.Vector3 }[] };
  /** 1 = clouds in, 0 = lifted */
  fogK: number;
  state: EpState;
  /** > 0 while the «just opened» reveal plays */
  reveal: number;
  bannerKey: string;
}

interface MapPath { a: string; b: string; pts: THREE.Vector3[]; len: number }

interface Figure {
  rig: HeroRig;
  g: THREE.Group;
  base: THREE.Mesh;
  pos: THREE.Vector3;
  yaw: number;
  moving: boolean;
  /** the node it stands at (or last left) */
  at: string;
  cheer: number;
  bubble: { text: string; t: number } | null;
  /** friends: what the last message said */
  target?: THREE.Vector3; tYaw?: number; seen?: number;
}

/** the room's choice on the map (the host's node, card focus, button, chapters list) */
interface Sel { n: string; f: boolean; s: number; sub: '' | 'ch' }

interface Btn { label: string; act: () => void; dis?: boolean }

export class WorldMap3D {
  is3d = true;
  /** coopFlow: this scene is the world map (a 'map' scene message doesn't reload it) */
  worldMap = true;
  t = 0;
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(36, 16 / 9, 1, 1200);
  fx = new FX3();
  private sun: THREE.DirectionalLight;
  private nodes = new Map<string, MapNode>();
  private paths: MapPath[] = [];
  private dotsOpen: THREE.InstancedMesh;
  private dotsShut: THREE.InstancedMesh;
  private pathKey = '';
  private lands: Landmark[] = [];
  /** cartoon clouds drifting round the island over the sea */
  private skyPuffs!: { mesh: THREE.InstancedMesh; items: { a: number; r: number; y: number; off: THREE.Vector3; s: THREE.Vector3 }[] };
  private moon: THREE.Sprite;
  /** co-op: the gold arrow over the room's choice (the host's node) */
  private marker: THREE.Group;
  /** a client walked lately: its camera follows its own figurine, else the room's choice */
  private myMoveT = 0;
  private me: Figure;
  private friends = new Map<string, Figure>();
  /** my walk: the nodes still ahead and the segment being walked */
  private route: string[] = [];
  private seg: { pts: THREE.Vector3[]; d: number; total: number; to: string; from: string } | null = null;
  private heldDir = false;
  private focus = false;
  private sel = 0;
  private sub: '' | 'ch' = '';
  private camT = new THREE.Vector3();
  private camDist = 76;
  private camFocus: { at: THREE.Vector3; t: number } | null = null;
  private toastMsg: { text: string; t: number; color: string } | null = null;
  private shake = 0;
  private hoverNode: string | null = null;
  private btnRects: { x: number; y: number; w: number; h: number; i: number }[] = [];
  private menuBtn = { x: 0, y: 0, w: 0, h: 0 };
  private cardBox = { x: 0, y: 0, s: 1 };
  // co-op
  private mp: boolean;
  private chat: ChatPanel | null = null;
  private offs: (() => void)[] = [];
  private hostSel: Sel | null = null;
  private lastSelKey = '';
  private selT = 0;
  private figT = 0;
  private confirmT = 0;
  private pause: MenuList | null = null;
  private lastQP = 0;

  constructor() {
    this.mp = coop.active;
    const sc = this.scene;
    sc.background = new THREE.Color('#9ab8d8');
    sc.fog = new THREE.Fog('#b8b0d0', 150, 420);
    sc.add(skyBall());
    sc.add(new THREE.HemisphereLight('#d8e0ff', '#6a5a48', 1.05));
    this.sun = new THREE.DirectionalLight('#ffe2c0', 2.3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sh = this.sun.shadow.camera; sh.left = -75; sh.right = 75; sh.top = 75; sh.bottom = -75; sh.near = 1; sh.far = 260;
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.05;
    sc.add(this.sun, this.sun.target);
    sc.add(buildTerrain());
    sc.add(buildSea());
    // a deep sea floor under everything (the transparent sea reads the same past the terrain's edge)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), mat('#2e6f96'));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -6.3; noOutline(floor);
    sc.add(floor);
    this.moon = moonSprite();
    this.moon.position.set(58, 15, -62); this.moon.scale.setScalar(40);
    sc.add(this.moon);
    this.buildNature();
    this.buildNodes();
    this.dotsOpen = this.dotMesh('#fff2c8', 900);
    this.dotsShut = this.dotMesh('#8a8296', 900);
    sc.add(this.dotsOpen, this.dotsShut);
    this.buildPaths();
    {
      const R = srand(17);
      const items: { a: number; r: number; y: number; off: THREE.Vector3; s: THREE.Vector3 }[] = [];
      for (let c = 0; c < 7; c++) {
        const a = (c / 7) * TAU + R() * 0.4, r = 92 + R() * 18, y = 9 + R() * 6;
        for (let k = 0; k < 5; k++) { const w = 2.6 + R() * 2.4; items.push({ a, r, y, off: V((k - 2) * 2.6 + R(), R() * 1.2, (R() - 0.5) * 2.5), s: V(w, w * 0.7, w * 0.9) }); }
      }
      const m = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), mat('#ffffff'), items.length);
      m.castShadow = false; m.frustumCulled = false;
      this.skyPuffs = { mesh: m, items };
      sc.add(m);
    }
    sc.add(this.fx.group);
    this.marker = new THREE.Group();
    const arrow = mesh(new THREE.ConeGeometry(1.3, 2.4, 4), mat('#ffd34a', { emissive: '#ffb02a', emissiveIntensity: 0.6 }));
    arrow.rotation.x = Math.PI; this.marker.add(arrow);
    const crownBall = mesh(new THREE.SphereGeometry(0.6, 12, 8), mat('#ffd34a', { emissive: '#ffb02a', emissiveIntensity: 0.6 })); crownBall.position.y = 1.7; this.marker.add(crownBall);
    this.marker.visible = false;
    sc.add(this.marker);
    // my figurine at the node I was last at
    // (co-op: friends start beside the host)
    const want = this.mp && !net.isHost && coopFlow.roomAt ? coopFlow.roomAt : save.data.mapAt;
    const at = EPISODES[want] ? want : 'prologue';
    // «Хрумляндия»: figurines are the heroes we picked
    this.me = this.makeFigure(profile.lookOf(profile.kind), at, this.mp ? net.me?.look.tagColor : undefined, profile.kind);
    this.me.pos.copy(this.standAt(at, net.myId));
    this.camT.copy(this.me.pos);
    this.refreshStates(true);
    // what just opened (an episode was finished): clouds lift, the camera looks there
    const fresh = takeReveal().filter((id) => this.nodes.get(id) && this.nodes.get(id)!.state !== 'locked');
    for (const id of fresh) {
      const n = this.nodes.get(id)!;
      n.fogK = 1; n.reveal = 3.2; n.land?.setSilhouette(true);
    }
    if (fresh.length) {
      const n = this.nodes.get(fresh[0])!;
      this.camFocus = { at: n.pos.clone(), t: 3.4 };
      this.toast(`Открыто: ${n.ep.title}!`, '#ffe680');
    }
    if (this.mp) {
      this.chat = new ChatPanel({ x: 16, y: 380, w: 380, h: 250, fade: true, onLine: (from, txt) => { const f = from === net.myId ? this.me : this.friends.get(from); if (f) f.bubble = { text: txt, t: 0 }; } });
      this.chat.attach();
      this.offs.push(net.on(MAP_FIG, (d: { x?: number; z?: number; yw?: number; mv?: number; n?: string }, from) => this.onFig(d, from)));
      this.offs.push(net.on(MAP_SEL, (d: Sel & { prog?: Progress }, from) => {
        if (from !== net.hostId || !d || typeof d.n !== 'string') return;
        this.hostSel = { n: d.n, f: !!d.f, s: d.s | 0, sub: d.sub === 'ch' ? 'ch' : '' };
        if (d.prog && typeof d.prog === 'object') coopFlow.roomProg = d.prog;
      }));
      this.offs.push(net.on(MSG.phrase, (d: { i?: number }, from) => {
        const i = Number(d?.i);
        const f = this.friends.get(from);
        if (f && i >= 0 && i < QUICK_PHRASES.length) f.bubble = { text: QUICK_PHRASES[i], t: 0 };
      }));
      net.setMeta({ scene: 'map' });
    }
    audio.playMusic('menu');
  }

  // ───────────────────────── building ─────────────────────────
  private buildNature() {
    const R = srand(5);
    const trees: O.TreeSpot[] = [], dark: O.TreeSpot[] = [];
    const edges = mapEdges().map(([a, b]) => [EPISODES[a].node, EPISODES[b].node]);
    const nearPath = (x: number, z: number) => edges.some(([a, b]) => {
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / l2, 0, 1);
      return Math.hypot(a.x + dx * t - x, a.z + dz * t - z) < 4.5;
    });
    for (let i = 0; i < 4000 && trees.length + dark.length < 260; i++) {
      const x = -70 + R() * 150, z = -56 + R() * 110;
      const k = isleK(x, z);
      if (k < 0.08) continue;
      const h = groundH(x, z);
      if (h < 0.1 || h > 4) continue;
      if (Object.values(REGION).some((r) => Math.hypot(x - r.cx, z - r.cz) < r.r * 0.85)) continue;
      if (episodeList().some((e) => Math.hypot(x - e.node.x, z - e.node.z) < 6)) continue;
      if (nearPath(x, z)) continue;
      const gloom = sstep(-6, 44, x) * sstep(14, -40, z);
      const s = 0.75 + R() * 0.6;
      (gloom > 0.35 ? dark : trees).push({ x, y: h, z, s, kind: R() < 0.45 ? 'pine' : 'round' });
    }
    this.scene.add(O.treeInstances(trees, 9));
    this.scene.add(O.treeInstances(dark, 10, { pine: ['#2e3a3e', '#34404a', '#28343a'], round: ['#3e4a44', '#46523e', '#3a4440'], trunk: '#3a2e2a' }));
    const rk: O.GroundSpot[] = [];
    for (let i = 0; i < 300 && rk.length < 60; i++) {
      const x = -70 + R() * 150, z = -56 + R() * 110;
      const k = isleK(x, z);
      if (k < 0.0 || k > 0.12) continue;
      rk.push({ x, y: groundH(x, z), z, s: 0.35 + R() * 0.6 });
    }
    this.scene.add(O.rocks(rk, ['#a49c8c', '#948e84', '#b4aa98'], 51));
  }

  private buildNodes() {
    const R = srand(11);
    for (const ep of episodeList()) {
      const y = nodeBase(ep) + 0.55;
      const pos = V(ep.node.x, y, ep.node.z);
      const pin = new THREE.Group();
      pin.position.set(ep.node.x, nodeBase(ep), ep.node.z);
      const plate = mesh(new THREE.CylinderGeometry(2.2, 2.5, 0.55, 28), mat('#f6ecd2')); plate.position.y = 0.27; plate.name = 'plate'; pin.add(plate);
      const rim = mesh(new THREE.TorusGeometry(2.2, 0.16, 8, 32), mat('#c8a060')); rim.rotation.x = Math.PI / 2; rim.position.y = 0.55; rim.name = 'rim'; pin.add(rim);
      const pole = mesh(new THREE.CylinderGeometry(0.08, 0.1, 4.2, 6), mat('#6a4a2a')); pole.position.set(-1.5, 2.1, -1.2); pin.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.4), new THREE.MeshToonMaterial({ side: THREE.DoubleSide, gradientMap: (mat('#fff') as THREE.MeshToonMaterial).gradientMap }));
      flag.position.set(-0.55, 3.55, -1.2); flag.castShadow = true; pin.add(flag);
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.2, 40), basic('#ffe680', { additive: true, opacity: 0.6, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.08; noOutline(ring); pin.add(ring);
      const lock = new THREE.Group();
      const body = mesh(new THREE.BoxGeometry(0.9, 0.75, 0.4), mat('#8a8296')); body.position.y = 1.0; lock.add(body);
      const shackle = mesh(new THREE.TorusGeometry(0.3, 0.08, 6, 14, Math.PI), mat('#b8b0c4')); shackle.position.y = 1.38; lock.add(shackle);
      lock.position.set(0.6, 0.4, 0.4); pin.add(lock);
      this.scene.add(pin);
      let land: Landmark | null = null;
      if (ep.node.look && REGION[ep.node.look]) {
        land = buildLandmark(ep.node.look, R);
        this.scene.add(land.g);
        this.lands.push(land);
      }
      // cloud puffs over the land (lifted when it opens); future lands sit lower so their silhouettes show
      const reg = ep.node.look ? REGION[ep.node.look] : null;
      const fx = reg ? (reg.cx * 0.6 + ep.node.x * 0.4) : ep.node.x, fz = reg ? (reg.cz * 0.6 + ep.node.z * 0.4) : ep.node.z;
      const fr = reg ? reg.r * 0.9 : 6;
      const nFog = ep.soon ? 16 : 22;
      const items: MapNode['fog']['items'] = [];
      for (let i = 0; i < nFog; i++) {
        const a = (i / nFog) * TAU * 2.3 + R(), rr = Math.sqrt((i + 0.5) / nFog) * fr;
        let x = fx + Math.cos(a) * rr, z = fz + Math.sin(a) * rr * 0.85;
        // the node's own pin stays clear (its label, lock and the figurine standing there)
        const dn = Math.hypot(x - ep.node.x, z - ep.node.z);
        if (dn < 4.6) { const k = 4.6 / Math.max(dn, 0.01); x = ep.node.x + (x - ep.node.x) * k; z = ep.node.z + (z - ep.node.z) * k - (dn < 0.01 ? 4.6 : 0); }
        const w = 2.6 + R() * 2.6;
        const base = V(x, Math.max(groundH(x, z), WATER_Y) + (ep.soon ? 0.6 : 1.4) + R() * (ep.soon ? 1.6 : 2.6), z);
        items.push({ base, s: V(w, w * (0.55 + R() * 0.25), w * (0.8 + R() * 0.3)), ph: R() * TAU, dir: V(x - ep.node.x, 0, z - ep.node.z).normalize() });
      }
      const fogMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), mat(ep.soon ? '#ddd6ea' : '#efe9f8'), items.length);
      fogMesh.castShadow = true; fogMesh.receiveShadow = true; fogMesh.frustumCulled = false;
      this.scene.add(fogMesh);
      const fog = { mesh: fogMesh, items };
      this.nodes.set(ep.id, { ep, pos, pin, flag, ring, lock, land, fog, fogK: 1, state: 'locked', reveal: 0, bannerKey: '' });
    }
  }

  private dotMesh(color: string, n: number) {
    const m = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.34, 0.4, 0.14, 10), mat(color), n);
    m.count = 0; m.receiveShadow = true; m.castShadow = false; m.frustumCulled = false;
    return m;
  }

  /** curved dotted paths between linked nodes (sampled once; the dots are re-coloured when nodes open) */
  private buildPaths() {
    let k = 0;
    for (const [a, b] of mapEdges()) {
      const A = this.nodes.get(a)!.pos, B = this.nodes.get(b)!.pos;
      const mid = A.clone().add(B).multiplyScalar(0.5);
      const d = Math.hypot(B.x - A.x, B.z - A.z);
      const side = (k++ % 2 ? 1 : -1) * d * 0.14;
      const ctrl = V(mid.x - (B.z - A.z) / d * side, 0, mid.z + (B.x - A.x) / d * side);
      const pts: THREE.Vector3[] = [];
      const N = Math.ceil(d * 1.6);
      for (let i = 0; i <= N; i++) {
        const t = i / N, u = 1 - t;
        const x = u * u * A.x + 2 * u * t * ctrl.x + t * t * B.x;
        const z = u * u * A.z + 2 * u * t * ctrl.z + t * t * B.z;
        const dA = Math.hypot(x - A.x, z - A.z), dB = Math.hypot(x - B.x, z - B.z);
        // on the pins: their top; in between: the ground (never under the swamp water)
        let y = Math.max(groundH(x, z) + 0.12, WATER_Y + 0.35);
        if (dA < 2.6) y = lerp(A.y, y, sstep(2.0, 2.6, dA));
        if (dB < 2.6) y = lerp(B.y, y, sstep(2.0, 2.6, dB));
        pts.push(V(x, y, z));
      }
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
      this.paths.push({ a, b, pts, len });
    }
  }

  private layDots() {
    const open = this.dotsOpen, shut = this.dotsShut;
    let no = 0, ns = 0;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    for (const path of this.paths) {
      const isOpen = this.nodes.get(path.a)!.state !== 'locked' && this.nodes.get(path.b)!.state !== 'locked';
      const step = isOpen ? 1.25 : 1.9;
      let acc = 0, next = 3.0;
      for (let i = 1; i < path.pts.length; i++) {
        const a = path.pts[i - 1], b = path.pts[i];
        const l = a.distanceTo(b);
        while (acc + l >= next && next < path.len - 2.8) {
          p.copy(a).lerp(b, (next - acc) / l);
          m.compose(p, q, s);
          if (isOpen && no < open.instanceMatrix.count) open.setMatrixAt(no++, m);
          else if (!isOpen && ns < shut.instanceMatrix.count) shut.setMatrixAt(ns++, m);
          next += step;
        }
        acc += l;
      }
    }
    open.count = no; shut.count = ns;
    open.instanceMatrix.needsUpdate = true; shut.instanceMatrix.needsUpdate = true;
  }

  private makeFigure(look: Partial<HeroLook>, at: string, tag?: string, kind: HeroKind = 'tosha'): Figure {
    const rig = createHeroModel(kind, look);
    const g = new THREE.Group();
    const base = mesh(new THREE.CylinderGeometry(0.42, 0.48, 0.12, 20), mat(tag ?? '#e8383d'));
    base.position.y = 0.06;
    g.add(base);
    rig.root.position.y = 0.12;
    g.add(rig.root);
    g.scale.setScalar(FIG_SCALE);
    this.scene.add(g);
    return { rig, g, base, pos: V(0, 0, 0), yaw: 0, moving: false, at, cheer: 0, bubble: null };
  }

  // ───────────────────────── state ─────────────────────────
  /** the progress the map shows: mine solo, the host's in co-op */
  private prog(): Progress { return this.mp ? coopFlow.mapProg() : myProgress(); }

  private refreshStates(first = false) {
    const prog = this.prog();
    let changed = false;
    for (const n of this.nodes.values()) {
      const st = epState(n.ep, prog);
      if (st !== n.state || first) {
        const wasLocked = n.state === 'locked' && !first;
        n.state = st;
        changed = true;
        if (first) { n.fogK = st === 'locked' ? 1 : 0; n.land?.setSilhouette(st === 'locked'); }
        else if (wasLocked && st !== 'locked') { n.reveal = Math.max(n.reveal, 3.2); }
        else if (st === 'locked') { n.fogK = 1; n.land?.setSilhouette(true); }
        this.styleNode(n);
      }
    }
    const key = [...this.nodes.values()].map((n) => n.state[0]).join('');
    if (changed || key !== this.pathKey) { this.pathKey = key; this.layDots(); }
  }

  private styleNode(n: MapNode) {
    const st = n.state, ep = n.ep;
    const label = ep.soon ? '?' : ep.hub ? '⌂' : String(ep.n);
    const bg = st === 'done' ? '#d8a020' : st === 'available' ? (ep.hub ? '#3aa8a0' : '#e8383d') : '#6a6478';
    const key = label + bg;
    if (key !== n.bannerKey) {
      n.bannerKey = key;
      const fm = n.flag.material as THREE.MeshToonMaterial;
      fm.map?.dispose();
      fm.map = bannerTex(label, bg); fm.needsUpdate = true;
    }
    (n.pin.getObjectByName('plate') as THREE.Mesh).material = mat(st === 'locked' ? '#a8a0b0' : st === 'done' ? '#ffe6a0' : '#f6ecd2');
    (n.pin.getObjectByName('rim') as THREE.Mesh).material = mat(st === 'done' ? '#f2c23a' : st === 'locked' ? '#7a7288' : '#c8a060');
    n.lock.visible = st === 'locked';
  }

  // ───────────────────────── helpers ─────────────────────────
  /** where a figurine stands on a node (friends around the middle, in join order) */
  private standAt(id: string, who: string): THREE.Vector3 {
    const n = this.nodes.get(id)!;
    if (!this.mp) return n.pos.clone();
    const ids = [...net.members.keys()];
    const i = Math.max(0, ids.indexOf(who));
    if (ids.length < 2) return n.pos.clone();
    const a = (i / ids.length) * TAU + 0.6;
    return n.pos.clone().add(V(Math.cos(a) * 1.6, 0, Math.sin(a) * 1.3));
  }

  private pathBetween(a: string, b: string): THREE.Vector3[] | null {
    for (const p of this.paths) {
      if (p.a === a && p.b === b) return p.pts;
      if (p.a === b && p.b === a) return [...p.pts].reverse();
    }
    return null;
  }

  /** shortest hop route from → to (BFS over the paths) */
  private routeTo(from: string, to: string): string[] {
    if (from === to) return [];
    const prev = new Map<string, string>([[from, '']]);
    const q = [from];
    while (q.length) {
      const c = q.shift()!;
      for (const nb of neighbours(c)) {
        if (prev.has(nb)) continue;
        prev.set(nb, c);
        if (nb === to) { const out = [to]; let k = c; while (k !== from) { out.unshift(k); k = prev.get(k)!; } return out; }
        q.push(nb);
      }
    }
    return [];
  }

  /** my figurine's node, or the one it's walking to */
  private myNode(): string { return this.route.length ? this.route[this.route.length - 1] : this.seg ? this.seg.to : this.me.at; }
  private standing() { return !this.seg && !this.route.length; }

  /** the room's choice: mine solo / as the host, the host's for a client */
  private choice(): Sel {
    if (this.mp && !net.isHost) return this.hostSel ?? { n: this.hostNodeGuess(), f: false, s: 0, sub: '' };
    return { n: this.myNode(), f: this.focus && this.standing(), s: this.sel, sub: this.sub };
  }
  private hostNodeGuess() {
    const f = net.hostId ? this.friends.get(net.hostId) : null;
    return f?.at ?? this.me.at;
  }

  private walkTo(id: string) {
    if (!this.nodes.has(id)) return;
    const from = this.seg ? this.seg.to : this.me.at;
    const r = this.routeTo(from, id);
    if (!r.length && !this.seg) return;
    this.route = r;
    this.focus = false; this.sub = '';
    if (!this.seg) this.nextSeg();
  }

  private nextSeg() {
    const to = this.route.shift();
    if (!to) { this.seg = null; return; }
    const from = this.me.at;
    const pts = this.pathBetween(from, to);
    if (!pts) { this.route = []; this.seg = null; return; }
    // start from where I stand (a co-op spot beside the middle), end at my spot on the next node
    const P = [this.me.pos.clone(), ...pts.slice(1, -1), this.standAt(to, net.myId)];
    let total = 0;
    for (let i = 1; i < P.length; i++) total += P[i].distanceTo(P[i - 1]);
    this.seg = { pts: P, d: 0, total, to, from };
    audio.sfx('menuMove', { volume: 0.4 });
  }

  /** the neighbour of `from` best lying in the screen direction (dx right, dy up), or null */
  private neighbourToward(from: string, dx: number, dy: number, avoid?: string): string | null {
    const a = toUI(this.nodes.get(from)!.pos, this.cam);
    let best: string | null = null, bestDot = 0.42;
    const l = Math.hypot(dx, dy) || 1;
    for (const nb of neighbours(from)) {
      const b = toUI(this.nodes.get(nb)!.pos, this.cam);
      const sx = b.x - a.x, sy = -(b.y - a.y);
      const sl = Math.hypot(sx, sy) || 1;
      let dot = (sx * dx + sy * dy) / (sl * l);
      if (nb === avoid) dot -= 0.35;
      if (dot > bestDot) { bestDot = dot; best = nb; }
    }
    return best;
  }

  private toast(s: string, color = '#fff3d8') { this.toastMsg = { text: s, t: 0, color }; }

  // ───────────────────────── buttons ─────────────────────────
  /** what the selected node offers (host / solo); a client's card has only «Готов» */
  private buttons(n: MapNode, sub: '' | 'ch'): Btn[] {
    const ep = n.ep;
    if (n.state === 'locked') return [];
    const prog = this.prog();
    const start = (fn: () => void) => () => this.startGame(fn);
    if (ep.id === 'prologue') {
      if (sub === 'ch') {
        const reached = this.mp && !net.isHost ? STORY.length : save.data.reached;
        const out: Btn[] = [];
        STORY.forEach((s, i) => {
          if (s.kind !== 'level' || (i > reached && out.length)) return;
          const m = save.data.medals[s.id] ?? 0;
          out.push({ label: s.title + (m ? '  ' + '★'.repeat(m) : ''), act: start(() => this.playPrologue(i)) });
        });
        out.push({ label: 'Назад', act: () => { this.sub = ''; this.sel = 0; } });
        return out;
      }
      const done = !!prog.prologue?.done;
      const cur = STORY[save.data.story];
      const where = cur?.kind === 'level' ? cur.title.split('. ')[1] ?? cur.title : cur?.kind === 'den' ? 'берлога' : cur?.kind === 'story' ? 'начало' : '';
      const out: Btn[] = [];
      if (!done && save.data.started) out.push({ label: `Продолжить: ${where}`, act: start(() => this.playPrologue(save.data.story)) });
      out.push({ label: done ? 'Переиграть пролог' : 'Играть с начала', act: start(() => this.playPrologue(0)) });
      if (save.data.reached >= 1) out.push({ label: 'Главы…', act: () => { this.sub = 'ch'; this.sel = 0; } });
      return out;
    }
    if (ep.hub) return [{ label: 'Войти в город', act: start(() => this.playEp(ep.id, 0)) }];
    const p = prog[ep.id];
    if (n.state === 'done') return [{ label: 'Переиграть', act: start(() => this.playEp(ep.id, 0)) }];
    if (p?.at && !this.mp) return [
      { label: `Продолжить (${partName(ep, p.at).toLowerCase()})`, act: start(() => this.playEp(ep.id, p.at!)) },
      { label: 'Сначала', act: start(() => this.playEp(ep.id, 0)) },
    ];
    return [{ label: 'Играть', act: start(() => this.playEp(ep.id, 0)) }];
  }

  private playPrologue(step: number) {
    save.data.mapAt = 'prologue';
    if (this.mp) coopFlow.hostStart(Math.max(1, step)); // (co-op starts at a chapter: the intro is a solo scene)
    else game.story(step);
  }
  private playEp(id: string, step: number) {
    if (this.mp) coopFlow.hostEpisode(id, step);
    else playEpisode(id, step);
  }

  /** host: not everyone is ready → ask once more; solo: go */
  private startGame(fn: () => void) {
    if (this.mp && net.isHost) {
      const [r, n] = coopFlow.othersReady();
      if (n && r < n && this.confirmT <= 0) { this.confirmT = 4; this.toast('Не все готовы — нажми ещё раз, чтобы начать без них', '#ffe680'); audio.sfx('denied'); return; }
    }
    audio.sfx('menuSelect');
    fn();
  }

  // ───────────────────────── update ─────────────────────────
  update(dt: number) {
    this.t += dt;
    if (this.toastMsg) { this.toastMsg.t += dt; if (this.toastMsg.t > 3.4) this.toastMsg = null; }
    this.confirmT = Math.max(0, this.confirmT - dt);
    this.shake = Math.max(0, this.shake - dt);
    const busy = this.chat ? this.updateChat(dt) : false;
    if (this.mp && !net.active) { game.toMenu(); return; }
    if (this.mp) { const nt = coopFlow.takeNotice(); if (nt) this.toast(nt, '#ffe680'); }
    this.refreshStates();
    if (!busy) this.updateInput(dt);
    this.updateWalk(dt);
    this.updateFriends(dt);
    if (this.mp) this.sendNet(dt);
    this.updateWorld(dt);
    this.updateCamera(dt);
    this.fx.update(dt);
  }

  private updateChat(dt: number): boolean {
    const c = this.chat!;
    if (this.pause) return false;
    if (c.update(dt, { allowOpen: true })) return true;
    if (c.typing) return true;
    for (let i = 0; i < 4; i++) if (input.pressed(QP_ACTIONS[i])) {
      if (this.t - this.lastQP < 0.6) break;
      this.lastQP = this.t;
      net.send('all', MSG.phrase, { i });
      this.me.bubble = { text: QUICK_PHRASES[i], t: 0 };
      audio.sfx('textBlip', { pitch: 1.6 });
    }
    return false;
  }

  private updateInput(dt: number) {
    input.menuTick(); // the d-pad walks / picks buttons here (no co-op quick phrases)
    // the map fades in while it updates: presses that were meant for the results card / the scene before (mashed
    // Enter) must not open a card and hit «Переиграть» on the episode just finished
    if (this.t < 0.6) return;
    if (this.pause) {
      this.pause.update(dt);
      if (input.pressed('back') || input.pressed('pause')) { this.pause = null; audio.sfx('menuMove'); }
      return;
    }
    // a reveal: the camera looks at what opened; any key skips it
    if (this.camFocus) {
      if (input.pressed('confirm') || input.pressed('back') || input.mouseClicked) this.camFocus.t = Math.min(this.camFocus.t, 0.3);
      return;
    }
    // mouse: the «Меню» button, the card's buttons, nodes
    const mx = input.mouseX, my = input.mouseY;
    const mb = this.menuBtn;
    const overMenu = mx >= mb.x && mx <= mb.x + mb.w && my >= mb.y && my <= mb.y + mb.h;
    const cb = this.cardBox;
    let overBtn = -1;
    for (const r of this.btnRects) {
      const lx = (mx - cb.x) / cb.s, ly = (my - cb.y) / cb.s;
      if (lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h) overBtn = r.i;
    }
    this.hoverNode = null;
    if (overBtn < 0 && !overMenu) {
      let best = 46 * this.uz();
      for (const n of this.nodes.values()) {
        const s = toUI(n.pos, this.cam);
        const d = Math.hypot(s.x - mx, s.y - 14 - my);
        if (s.vis && d < best) { best = d; this.hoverNode = n.ep.id; }
      }
    }
    const client = this.mp && !net.isHost;
    if (input.mouseMoved && overBtn >= 0 && !client) { this.focus = true; this.sel = overBtn; }
    if (input.mouseClicked) {
      if (overMenu) { this.back(); return; }
      if (overBtn >= 0) { if (client) this.toggleReady(); else { this.sel = overBtn; this.activate(); } return; }
      if (this.hoverNode) { this.walkTo(this.hoverNode); return; }
    }
    if (input.wheel) this.camDist = clamp(this.camDist + input.wheel * 6, 40, 110);
    // «Выбор героя» right from the map (my figurine becomes the new hero)
    if (input.pressed('interact')) { openHeroPicker({ onPick: () => this.refreshMyFigure() }); return; }

    const n = this.nodes.get(this.myNode())!;
    const btns = client ? [] : this.buttons(n, this.sub);
    if (this.focus && this.standing() && !client) {
      if (!btns.length) { this.focus = false; }
      else {
        if (input.pressed('down')) { this.sel = (this.sel + 1) % btns.length; audio.sfx('menuMove'); }
        if (input.pressed('up')) { this.sel = (this.sel - 1 + btns.length) % btns.length; audio.sfx('menuMove'); }
        if (input.pressed('confirm') || input.pressed('attack')) this.activate();
        if (input.pressed('back')) { if (this.sub) { this.sub = ''; this.sel = 0; } else this.focus = false; audio.sfx('menuMove'); }
        if (input.pressed('left') || input.pressed('right')) this.focus = false;
        else return;
      }
    }
    if (input.pressed('back') || input.pressed('pause')) { this.back(); return; }
    if (input.pressed('confirm') || input.pressed('attack')) {
      if (client) { this.toggleReady(); return; }
      if (!this.standing()) return;
      if (!btns.length) { this.shake = 0.4; audio.sfx('denied'); this.toast(n.ep.soon ? 'Эта земля ещё в тумане…' : 'Сюда пока не пройти', '#d8c8e8'); return; }
      this.focus = true; this.sel = 0; audio.sfx('menuSelect');
      return;
    }
    // walking: arrows / WASD / stick / d-pad pick the neighbour in that direction on screen
    const m = input.move3();
    let dx = m.x, dy = m.y;
    if (!dx && !dy) { dx = (input.down('right') ? 1 : 0) - (input.down('left') ? 1 : 0); dy = (input.down('up') ? 1 : 0) - (input.down('down') ? 1 : 0); }
    const pushed = Math.hypot(dx, dy) > 0.5;
    if (!pushed) { this.heldDir = false; return; }
    if (this.seg || this.route.length) return;
    const nb = this.neighbourToward(this.me.at, dx, dy, this.heldDir ? this.lastFrom : undefined);
    if (nb) { this.route = [nb]; this.focus = false; this.sub = ''; this.nextSeg(); }
    this.heldDir = true;
  }
  private lastFrom = '';

  /** my figurine shows the hero I play (after a pick in «Выбор героя») */
  private refreshMyFigure() {
    const f = this.me;
    this.swapFigureRig(f, profile.kind, profile.lookOf(profile.kind));
    f.cheer = 1.2;
  }
  private swapFigureRig(f: Figure, kind: HeroKind, look: HeroLook) {
    const name = kind === 'tosha' ? 'hero' : kind;
    if (f.rig.root.name === name) { if (JSON.stringify(f.rig.look) !== JSON.stringify(look)) f.rig.setLook(look); return; }
    const y = f.rig.root.position.y;
    f.g.remove(f.rig.root); f.rig.dispose();
    f.rig = createHeroModel(kind, look);
    f.rig.root.position.y = y;
    f.g.add(f.rig.root);
  }

  private activate() {
    const n = this.nodes.get(this.myNode())!;
    const b = this.buttons(n, this.sub)[this.sel];
    if (b && !b.dis) b.act();
  }

  private toggleReady() {
    const me = net.me;
    if (!me) return;
    net.setMeta({ ready: !me.ready });
    audio.sfx(me.ready ? 'menuMove' : 'checkpoint', { volume: 0.6 });
  }

  /** Esc: solo → main menu; co-op → the room menu */
  private back() {
    if (!this.mp) { audio.sfx('menuMove'); game.toMenu(); return; }
    const items = [
      { label: 'Назад к карте', action: () => { this.pause = null; } },
      ...(net.isHost ? [{ label: 'Всей комнатой в лобби', action: () => { this.pause = null; coopFlow.backToLobby(); } }] : []),
      { label: 'Покинуть комнату', action: () => { this.pause = null; net.leave(); game.toMenu(); } },
    ];
    this.pause = new MenuList(items, W / 2, 300, { w: 380, h: 50, gap: 12, size: 22 });
  }

  private updateWalk(dt: number) {
    const f = this.me;
    if (this.seg) {
      const s = this.seg;
      s.d = Math.min(s.total, s.d + WALK_SPEED * dt);
      let acc = 0;
      for (let i = 1; i < s.pts.length; i++) {
        const a = s.pts[i - 1], b = s.pts[i], l = a.distanceTo(b);
        if (acc + l >= s.d || i === s.pts.length - 1) {
          const k = l > 0 ? clamp((s.d - acc) / l, 0, 1) : 1;
          f.pos.copy(a).lerp(b, k);
          if (Math.hypot(b.x - a.x, b.z - a.z) > 0.01) f.yaw = Math.atan2(b.x - a.x, b.z - a.z);
          break;
        }
        acc += l;
      }
      f.moving = true;
      if (s.d >= s.total) {
        this.lastFrom = s.from;
        f.at = s.to;
        save.data.mapAt = s.to;
        this.seg = null;
        if (this.route.length) this.nextSeg();
        else {
          f.moving = false;
          f.cheer = this.nodes.get(s.to)!.state === 'available' ? 0.9 : 0;
          this.fx.dust(f.pos.clone().add(V(0, 0.2, 0)), 8);
          if (!this.mp) save.write();
        }
      }
    } else {
      f.moving = false;
      // co-op spot beside the middle (others came / went)
      f.pos.lerp(this.standAt(f.at, net.myId), 1 - Math.exp(-8 * dt));
    }
    this.poseFigure(f, dt);
  }

  private poseFigure(f: Figure, dt: number, anim?: Partial<HeroAnim>) {
    f.g.position.copy(f.pos);
    const cur = f.g.rotation.y;
    // walking: along the path; standing: turned toward the camera
    const want = f.moving ? f.yaw : Math.atan2(this.cam.position.x - f.pos.x, this.cam.position.z - f.pos.z);
    f.g.rotation.y = cur + Math.atan2(Math.sin(want - cur), Math.cos(want - cur)) * (1 - Math.exp(-10 * dt));
    f.cheer = Math.max(0, f.cheer - dt);
    if (f.bubble) { f.bubble.t += dt; if (f.bubble.t > 6) f.bubble = null; }
    f.rig.update(dt, heroAnim({ state: f.moving ? 'run' : f.cheer > 0 ? 'cheer' : 'idle', speed: f.moving ? 0.85 : 0, ...anim }));
  }

  // ───────────────────────── co-op ─────────────────────────
  private onFig(d: { x?: number; z?: number; yw?: number; mv?: number; n?: string }, from: string) {
    if (from === net.myId || typeof d?.x !== 'number' || typeof d.z !== 'number') return;
    const m = net.members.get(from);
    if (!m) return;
    let f = this.friends.get(from);
    const at = typeof d.n === 'string' && this.nodes.has(d.n) ? d.n : 'prologue';
    if (!f) {
      f = this.makeFigure(m.hero.look, at, m.look.tagColor, m.hero.kind);
      f.pos.set(d.x, 0, d.z);
      this.friends.set(from, f);
    }
    f.target = V(d.x, 0, d.z);
    f.tYaw = d.yw ?? f.yaw;
    f.moving = !!d.mv;
    f.at = at;
    f.seen = this.t;
  }

  private updateFriends(dt: number) {
    if (!this.mp) return;
    for (const [id, f] of this.friends) {
      const m = net.members.get(id);
      if (!m || (f.seen !== undefined && this.t - f.seen > 20)) { this.scene.remove(f.g); f.rig.dispose(); this.friends.delete(id); continue; }
      f.g.visible = m.scene === 'map';
      if (f.target) {
        const k = 1 - Math.exp(-10 * dt);
        f.pos.x = lerp(f.pos.x, f.target.x, k); f.pos.z = lerp(f.pos.z, f.target.z, k);
        // height from the ground / pins under it
        const n = this.nodes.get(f.at)!;
        const onPin = Math.hypot(f.pos.x - n.pos.x, f.pos.z - n.pos.z) < 2.3;
        f.pos.y = onPin ? n.pos.y : Math.max(groundH(f.pos.x, f.pos.z) + 0.12, WATER_Y + 0.35);
        for (const nn of this.nodes.values()) if (Math.hypot(f.pos.x - nn.pos.x, f.pos.z - nn.pos.z) < 2.3) f.pos.y = nn.pos.y;
        f.yaw = f.tYaw ?? f.yaw;
      }
      this.swapFigureRig(f, m.hero.kind, m.hero.look);
      f.base.material = mat(m.look.tagColor || '#e8383d');
      this.poseFigure(f, dt, { state: f.moving ? 'run' : m.ready ? 'cheer' : 'idle', talk: m.speaking ? Math.abs(Math.sin(this.t * 14)) * 0.8 : 0 });
    }
  }

  private sendNet(dt: number) {
    if (!net.active) return;
    // my figurine: ~8 Hz while walking, 1 Hz standing (unreliable), and once reliably on arrival
    this.figT -= dt;
    const moving = this.me.moving;
    if (this.figT <= 0) {
      this.figT = moving ? 0.12 : 1;
      net.send('all', MAP_FIG, { x: Math.round(this.me.pos.x * 100) / 100, z: Math.round(this.me.pos.z * 100) / 100, yw: Math.round(this.me.yaw * 100) / 100, mv: moving ? 1 : 0, n: this.me.at }, false);
    }
    if (!moving && this.wasMoving) net.send('all', MAP_FIG, { x: this.me.pos.x, z: this.me.pos.z, yw: this.me.yaw, mv: 0, n: this.me.at });
    this.wasMoving = moving;
    // host: the room's choice on change + every 2.5 s (late joiners, a new host's progress)
    if (!net.isHost) return;
    const c = this.choice();
    const key = `${c.n}|${c.f ? 1 : 0}|${c.s}|${c.sub}`;
    this.selT -= dt;
    if (key !== this.lastSelKey || this.selT <= 0) {
      const full = this.selT <= 0;
      this.lastSelKey = key;
      this.selT = 2.5;
      net.send('all', MAP_SEL, { ...c, ...(full ? { prog: coopFlow.mapProg() } : {}) });
    }
  }
  private wasMoving = false;

  // ───────────────────────── world ─────────────────────────
  private updateWorld(dt: number) {
    for (const l of this.lands) for (const a of l.anim) a(this.t);
    // co-op: the room's choice is marked for everyone
    this.marker.visible = this.mp && !this.camFocus;
    if (this.marker.visible) {
      const n = this.nodes.get(this.choice().n);
      if (n) { this.marker.position.set(n.pos.x, n.pos.y + 6 + Math.sin(this.t * 3.2) * 0.45, n.pos.z); this.marker.rotation.y = this.t * 1.5; }
    }
    for (const n of this.nodes.values()) {
      // reveal: silhouettes take their colours, the clouds drift off
      if (n.reveal > 0) {
        const before = n.reveal;
        n.reveal = Math.max(0, n.reveal - dt);
        if (before > 2.4 && n.reveal <= 2.4) { n.land?.setSilhouette(false); this.fx.stars(n.pos.clone().add(V(0, 2, 0)), 40); audio.sfx('checkpoint'); }
        if (n.reveal < 2.4) n.fogK = Math.max(0, n.fogK - dt / 2.2);
      } else if (n.state !== 'locked' && n.fogK > 0) n.fogK = Math.max(0, n.fogK - dt / 1.5);
      const fm = n.fog.mesh;
      fm.visible = n.fogK > 0.01;
      if (fm.visible) {
        const k = ease.inOut(n.fogK), out = 1 - k;
        n.fog.items.forEach((f, i) => {
          FP.set(f.base.x + f.dir.x * out * 12 + Math.sin(this.t * 0.25 + f.ph) * 0.5, f.base.y + out * 4 + Math.sin(this.t * 0.6 + f.ph) * 0.18, f.base.z + f.dir.z * out * 12);
          FS.copy(f.s).multiplyScalar(Math.max(0.001, k));
          FM.compose(FP, FQ, FS);
          fm.setMatrixAt(i, FM);
        });
        fm.instanceMatrix.needsUpdate = true;
      }
      // the open node's ring breathes; flags flap
      n.ring.visible = n.state === 'available';
      if (n.ring.visible) { const s = 1 + Math.sin(this.t * 3 + n.pos.x) * 0.06; n.ring.scale.set(s, s, s); (n.ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.25 * Math.sin(this.t * 3 + n.pos.x); }
      n.flag.rotation.y = Math.sin(this.t * 2.2 + n.pos.z) * 0.18;
    }
    const sp = this.skyPuffs;
    sp.items.forEach((c, i) => {
      const a = c.a + this.t * 0.012;
      FP.set(ISLE.cx + Math.cos(a) * c.r * 1.1, c.y, ISLE.cz + Math.sin(a) * c.r * 0.8).add(c.off);
      FM.compose(FP, FQ, c.s);
      sp.mesh.setMatrixAt(i, FM);
    });
    sp.mesh.instanceMatrix.needsUpdate = true;
  }

  private uz() {
    return clamp(Math.min(RT.winW, RT.winH) / 720 / RT.scale, 1, 2.2);
  }

  private updateCamera(dt: number) {
    let target = this.me.pos;
    // a client watches the room's choice unless it walked lately
    if (this.me.moving) this.myMoveT = 4;
    this.myMoveT = Math.max(0, this.myMoveT - dt);
    if (this.mp && !net.isHost && this.myMoveT <= 0) { const n = this.nodes.get(this.choice().n); if (n) target = n.pos; }
    if (this.camFocus) {
      this.camFocus.t -= dt;
      target = this.camFocus.at;
      if (this.camFocus.t <= 0) this.camFocus = null;
    }
    const aspect = RT.winW / RT.winH;
    // a wide window has the card on the right: the figurine stays in the middle of what's left
    const tanH = Math.tan(THREE.MathUtils.degToRad(this.cam.fov / 2)) * aspect;
    const dist = Math.max(this.camDist, 54 / (2 * tanH));
    const side = aspect > 1.15 ? dist * tanH * 0.3 : 0;
    const tx = clamp(target.x + side, CAM_BOX.x0, CAM_BOX.x1), tz = clamp(target.z, CAM_BOX.z0, CAM_BOX.z1);
    const k = 1 - Math.exp(-(this.camFocus ? 2.2 : 3.2) * dt);
    this.camT.x = lerp(this.camT.x, tx, k); this.camT.z = lerp(this.camT.z, tz, k); this.camT.y = lerp(this.camT.y, 0, k);
    // further north the camera tips up and looks ahead (the castle's moon comes into view)
    const north = sstep(0, -34, this.camT.z);
    const pitch = lerp(0.95, 0.52, north);
    this.cam.aspect = aspect;
    // (narrow, tall windows back off so about 54 units of land still fit across)
    const shake = this.shake > 0 ? Math.sin(this.t * 60) * this.shake * 0.25 : 0;
    this.cam.position.set(this.camT.x + shake, this.camT.y + Math.sin(pitch) * dist, this.camT.z + Math.cos(pitch) * dist);
    this.cam.lookAt(this.camT.x, this.camT.y, this.camT.z - lerp(4, 15, north));
    this.cam.updateProjectionMatrix();
    this.sun.position.set(this.camT.x - 50, 90, this.camT.z + 40);
    this.sun.target.position.copy(this.camT);
  }

  // ───────────────────────── drawing ─────────────────────────
  render(ctx: C) {
    this.fx.setScale(RT.winH * (RT.r3?.pixelRatio ?? 1) * 0.9);
    RT.r3?.render(this.scene, this.cam);
    ctx.clearRect(-2000, -2000, W + 4000, H + 4000);
    const v = viewUI();
    const uz = this.uz();
    this.drawLabels(ctx, uz);
    this.drawFigureTags(ctx, uz);
    this.drawTitle(ctx, v, uz);
    this.drawCard(ctx, v, uz);
    this.drawHints(ctx, v, uz);
    if (this.chat) { this.chat.draw(ctx); drawMicBadge(ctx, 20, 120, { t: this.t }); }
    if (this.toastMsg) {
      const tm = this.toastMsg;
      const a = clamp(Math.min(tm.t * 5, (3.4 - tm.t) * 2), 0, 1);
      ctx.save(); ctx.globalAlpha = a;
      const cx = (v.x0 + v.x1) / 2, y = v.y0 + 96 * uz;
      ctx.translate(cx, y); ctx.scale(uz, uz);
      ctx.font = '400 22px Pangolin, sans-serif';
      const w = ctx.measureText(tm.text).width + 48;
      rrect(ctx, -w / 2, -30, w, 46, 16, 'rgba(26,14,30,0.85)', 3);
      text(ctx, tm.text, 0, 2, { size: 22, font: 'body', color: tm.color, align: 'center' });
      ctx.restore();
    }
    if (this.pause) {
      ctx.fillStyle = 'rgba(12,6,16,0.6)'; ctx.fillRect(-2000, -2000, W + 4000, H + 4000);
      text(ctx, 'Комната', W / 2, 250, { size: 44, color: '#ffd34a', align: 'center', stroke: 8 });
      this.pause.draw(ctx);
    }
  }

  private drawLabels(ctx: C, uz: number) {
    const sel = this.choice().n;
    for (const n of this.nodes.values()) {
      const s = toUI(n.pos, this.cam);
      if (!s.vis) continue;
      const ep = n.ep;
      const locked = n.state === 'locked';
      const hot = this.hoverNode === ep.id || sel === ep.id;
      ctx.save();
      ctx.translate(s.x, s.y + 30 * uz);
      ctx.scale(uz, uz);
      const name = ep.node.name;
      ctx.font = `700 ${hot ? 18 : 16}px Rubik, sans-serif`;
      const tw = ctx.measureText(name).width;
      const badge = ep.n > 0 ? 24 : 0;
      const w = tw + 20 + badge;
      ctx.globalAlpha = locked && !hot ? 0.8 : 1;
      rrect(ctx, -w / 2, -14, w, 28, 12, locked ? 'rgba(40,32,52,0.82)' : hot ? 'rgba(60,30,20,0.9)' : 'rgba(30,18,24,0.78)', hot ? 2.5 : 0);
      let x = -w / 2 + 10;
      if (badge) {
        const bc = n.state === 'done' ? '#f2c23a' : locked ? '#8a8296' : '#e8383d';
        ctx.beginPath(); ctx.arc(x + 9, 0, 10, 0, TAU); ctx.fillStyle = bc; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = OUT; ctx.stroke();
        text(ctx, String(ep.n), x + 9, 1, { size: 13, color: '#fff', align: 'center', base: 'middle' });
        x += badge;
      }
      text(ctx, name, x, 1, { size: hot ? 18 : 16, weight: 700, color: locked ? '#c8c0d8' : n.state === 'done' ? '#ffe680' : '#fff3d8', base: 'middle' });
      if (locked && !ep.soon) drawLock(ctx, w / 2 + 2, -12, 0.8);
      if (n.state === 'done') { const m = this.prog()[ep.id]?.medal ?? 0; if (m) text(ctx, '★'.repeat(m), 0, 28, { size: 15, color: '#ffd34a', align: 'center', stroke: 3 }); }
      ctx.restore();
    }
  }

  private drawFigureTags(ctx: C, uz: number) {
    if (!this.mp) { this.drawBubble(ctx, this.me, uz); return; }
    const figs: [string, Figure][] = [[net.myId, this.me], ...this.friends];
    // friends standing on one node: their tags stack up instead of overlapping
    const stack = new Map<string, number>();
    const order = [...net.members.keys()];
    figs.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
    for (const [id, f] of figs) {
      const m = net.members.get(id);
      if (!m || !f.g.visible) continue;
      const p = toUI(f.pos.clone().add(V(0, 2.9, 0)), this.cam);
      if (!p.vis) continue;
      const k = f.moving ? '' : f.at;
      const row = k ? stack.get(k) ?? 0 : 0;
      if (k) stack.set(k, row + 1);
      ctx.save(); ctx.translate(p.x, p.y - row * 24 * uz); ctx.scale(uz, uz);
      ctx.font = '700 15px Rubik, sans-serif';
      const w = ctx.measureText(m.name).width + 18 + (m.isHost ? 18 : 0) + (m.ready && !m.isHost ? 18 : 0);
      rrect(ctx, -w / 2, -20, w, 22, 9, 'rgba(20,10,16,0.72)', 0);
      let x = -w / 2 + 9;
      if (m.isHost) { drawCrown(ctx, x + 7, -9, 13); x += 18; }
      text(ctx, m.name, x, -4, { size: 15, weight: 700, color: m.look.tagColor || '#ffd34a' });
      if (m.ready && !m.isHost) text(ctx, '✓', w / 2 - 12, -3, { size: 16, color: '#7ef08a', align: 'center', stroke: 3 });
      if (m.speaking || m.muted) drawSpeaker(ctx, w / 2 + 12, -9, 16, { speaking: m.speaking, muted: m.muted, t: this.t });
      ctx.restore();
      this.drawBubble(ctx, f, uz);
    }
  }

  private drawBubble(ctx: C, f: Figure, uz: number) {
    if (!f.bubble) return;
    const p = toUI(f.pos.clone().add(V(0, 3.4, 0)), this.cam);
    if (!p.vis) return;
    const a = clamp(Math.min(f.bubble.t / 0.15, (6 - f.bubble.t) / 0.6), 0, 1);
    ctx.save(); ctx.globalAlpha = a; ctx.translate(p.x, p.y); ctx.scale(uz, uz);
    ctx.font = '400 17px Pangolin, sans-serif';
    const lines = wrap(ctx, f.bubble.text, 200).slice(0, 3);
    const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 22, bh = lines.length * 20 + 12;
    rrect(ctx, -bw / 2, -26 - bh, bw, bh, 11, '#fffaf0', 3);
    lines.forEach((l, k) => text(ctx, l, 0, -26 - bh + 23 + k * 20, { size: 17, font: 'body', color: OUT, align: 'center' }));
    ctx.restore();
  }

  private drawTitle(ctx: C, v: { x0: number; y0: number; x1: number; y1: number }, uz: number) {
    ctx.save();
    ctx.translate(v.x0 + 22 * uz, v.y0 + 18 * uz);
    ctx.scale(uz, uz);
    // «◀ Меню»
    const mw = 92, mh = 34;
    const mx = input.mouseX, my = input.mouseY;
    const bx = v.x0 + 22 * uz, by = v.y0 + 18 * uz;
    const hover = mx >= bx && mx <= bx + mw * uz && my >= by && my <= by + mh * uz;
    this.menuBtn = { x: bx, y: by, w: mw * uz, h: mh * uz };
    rrect(ctx, 0, 0, mw, mh, 12, hover ? '#ffd34a' : '#f6ecd2', 3);
    text(ctx, this.mp ? '◀ Комната' : '◀ Меню', mw / 2, 23, { size: this.mp ? 14 : 17, color: OUT, align: 'center' });
    // the land's name and the arc's progress
    text(ctx, 'Хрумляндия', mw + 16, 30, { size: 34, color: '#ffe680', stroke: 7 });
    const prog = this.prog();
    const arc = episodeList().filter((e) => e.arc === ARC_FANGS);
    const done = arc.filter((e) => prog[e.id]?.done).length;
    text(ctx, `Арка «${ARC_FANGS}»: ${done} из ${arc.length}`, mw + 18, 56, { size: 16, font: 'body', color: '#fff3d8', stroke: 4 });
    ctx.restore();
  }

  private drawHints(ctx: C, v: { x0: number; y0: number; x1: number; y1: number }, uz: number) {
    ctx.save();
    ctx.translate(v.x0 + 24 * uz, v.y1 - 26 * uz);
    ctx.scale(uz, uz);
    const client = this.mp && !net.isHost;
    let x = 0;
    const gap = 26;
    text(ctx, 'Стрелки / стик — идти', x, 6, { size: 17, font: 'body', color: '#fff3d8', stroke: 4 });
    x += 196;
    x += drawHint(ctx, 'confirm', client ? 'готов' : 'выбрать', x, 0, { size: 24 }) + gap;
    x += drawHint(ctx, 'back', this.focus ? 'назад' : this.mp ? 'комната' : 'в меню', x, 0, { size: 24 }) + gap;
    x += drawHint(ctx, 'interact', 'герой', x, 0, { size: 24 }) + gap;
    if (this.mp) drawHint(ctx, 'chat', 'чат', x, 0, { size: 24 });
    ctx.restore();
  }

  /** the card of the room's choice: series, title, medals, the pitch, buttons (a client: «Готов») */
  private drawCard(ctx: C, v: { x0: number; y0: number; x1: number; y1: number }, uz: number) {
    const c = this.choice();
    const n = this.nodes.get(c.n);
    this.btnRects = [];
    if (!n || this.camFocus) return;
    const ep = n.ep;
    const client = this.mp && !net.isHost;
    const prog = this.prog();
    const cw = 350;
    ctx.save();
    ctx.font = '400 17px Pangolin, sans-serif';
    const teaser = wrap(ctx, ep.teaser ?? '', cw - 40).slice(0, 5);
    ctx.font = '900 30px Rubik, sans-serif';
    const title = wrap(ctx, ep.title, cw - 36).slice(0, 2);
    const btns = client ? [] : this.buttons(n, c.sub);
    const subList = c.sub === 'ch';
    const unbuilt = !ep.soon && !isBuilt(ep);
    let h = 20 + 30 + title.length * 34 + 26 + 10;
    if (!ep.hub && !ep.soon) h += 30;
    if (!subList) h += teaser.length * 22 + 10;
    h += 34; // state line
    if (client) h += 18 + 50 + 30;
    else if (btns.length) h += 10 + btns.length * 48;
    if (this.mp) h += 34;
    h += 14;
    const landscape = v.x1 - v.x0 > (v.y1 - v.y0) * 1.15;
    const cx = landscape ? v.x1 - (cw + 20) * uz : (v.x0 + v.x1) / 2 - (cw / 2) * uz;
    const cy = landscape ? clamp((v.y0 + v.y1) / 2 - (h / 2) * uz, v.y0 + 84 * uz, Math.max(v.y0 + 84 * uz, v.y1 - (h + 60) * uz)) : v.y1 - (h + 64) * uz;
    this.cardBox = { x: cx, y: cy, s: uz };
    const shake = this.shake > 0 ? Math.sin(this.t * 50) * this.shake * 10 : 0;
    ctx.translate(cx + shake, cy);
    ctx.scale(uz, uz);
    // panel
    rrect(ctx, 5, 7, cw, h, 22, 'rgba(0,0,0,0.3)', 0);
    rrect(ctx, 0, 0, cw, h, 22, n.state === 'locked' ? '#3a3248' : '#fff6e4', 4);
    const ink = n.state === 'locked' ? '#e8e0f0' : OUT;
    const soft = n.state === 'locked' ? '#b8b0c8' : '#7a5a4a';
    let y = 20;
    // the strip: series / town / soon + the arc
    const tag = ep.soon ? 'СКОРО' : ep.hub ? 'ГОРОД' : ep.id === 'prologue' ? 'ПРОЛОГ · СЕРИЯ 1' : `СЕРИЯ ${ep.n}`;
    ctx.font = '900 15px Rubik, sans-serif';
    const tagW = ctx.measureText(tag).width + 22;
    rrect(ctx, 16, y, tagW, 26, 10, ep.soon ? '#6a6478' : ep.hub ? '#3aa8a0' : n.state === 'done' ? '#d8a020' : '#e8383d', 2.5);
    text(ctx, tag, 16 + tagW / 2, y + 18, { size: 15, color: '#fff', align: 'center' });
    if (ep.arc) text(ctx, `арка «${ep.arc}»`, 16 + tagW + 10, y + 18, { size: 15, font: 'body', color: soft });
    y += 30;
    for (const l of title) { y += 34; text(ctx, l, 18, y, { size: 30, color: ink }); }
    y += 24;
    text(ctx, ep.soon ? 'Новые земли — скоро' : ep.hub ? ep.subtitle : `${ep.node.name} · ${ep.subtitle}`, 18, y, { size: 16, font: 'body', color: soft });
    y += 10;
    if (!ep.hub && !ep.soon) {
      y += 28;
      const m = prog[ep.id]?.medal ?? 0;
      const stars = '★'.repeat(m) + '☆'.repeat(3 - m);
      text(ctx, stars, 18, y, { size: 24, color: m ? '#f2b81a' : n.state === 'locked' ? '#6a6478' : '#c8b8a0', stroke: m ? 3 : 0 });
      const st = n.state === 'done' ? 'Пройдено ✓' : n.state === 'available' ? 'Новая серия!' : '';
      if (st) text(ctx, st, cw - 18, y - 2, { size: 17, font: 'body', color: n.state === 'done' ? '#3a8a3a' : '#e8383d', align: 'right' });
    }
    if (!subList) {
      y += 10;
      for (const l of teaser) { y += 22; text(ctx, l, 18, y, { size: 17, font: 'body', color: ink }); }
    }
    // state line
    y += 34;
    let line = '', lc = soft;
    if (ep.soon) { line = 'Эта земля ещё в тумане…'; }
    else if (n.state === 'locked') { const by = openedBy(ep); line = ep.lockHint ?? (by ? `Откроется после серии «${by.title}»` : 'Пока закрыто'); drawLock(ctx, 18, y - 18, 0.9); }
    else if (unbuilt) { line = ep.hub ? '🚧 Город ещё строится' : '🚧 Серия в разработке'; lc = '#d86a1a'; }
    else if (subList) { line = 'Главы пролога'; }
    if (line) text(ctx, line, n.state === 'locked' && !ep.soon ? 42 : 18, y, { size: 17, font: 'body', color: lc });
    // buttons
    if (client) {
      y += 18;
      const host = net.hostId ? net.members.get(net.hostId) : null;
      const ready = !!net.me?.ready;
      this.drawButton(ctx, 16, y, cw - 32, 42, ready ? '✓ Готов (отменить)' : 'Я готов!', true, ready ? '#9ae06a' : '#ffd34a', 0);
      y += 50 + 22;
      text(ctx, c.f ? `${host?.name ?? 'Хозяин'} выбирает…` : `Серию выбирает ${host?.name ?? 'хозяин'}`, cw / 2, y, { size: 16, font: 'body', color: soft, align: 'center' });
    } else if (btns.length) {
      y += 10;
      btns.forEach((b, i) => {
        const on = c.f && c.s === i;
        this.drawButton(ctx, 16, y, cw - 32, 40, b.label, on, i === 0 ? '#ffd34a' : '#f6ecd2', i);
        y += 48;
      });
    }
    if (this.mp) {
      y += 26;
      const [r, total] = coopFlow.othersReady();
      text(ctx, total ? `Готовы: ${r} из ${total}` : 'Ты пока один в комнате', 18, y, { size: 16, font: 'body', color: soft });
      let x = cw - 18;
      for (const m of [...net.members.values()].reverse()) {
        if (m.isHost) continue;
        ctx.beginPath(); ctx.arc(x - 8, y - 6, 8, 0, TAU); ctx.fillStyle = m.ready ? (m.look.tagColor || '#9ae06a') : 'rgba(120,100,100,0.35)'; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = OUT; ctx.stroke();
        x -= 22;
      }
    }
    ctx.restore();
  }

  private drawButton(ctx: C, x: number, y: number, w: number, h: number, label: string, on: boolean, color: string, i: number) {
    this.btnRects.push({ x, y, w, h, i });
    ctx.save();
    if (on) { ctx.translate(x + w / 2, y + h / 2); ctx.scale(1.04, 1.04); ctx.translate(-(x + w / 2), -(y + h / 2)); }
    rrect(ctx, x + 3, y + 4, w, h, 14, 'rgba(0,0,0,0.25)', 0);
    rrect(ctx, x, y, w, h, 14, on ? color : '#efe4cc', on ? 3.5 : 2.5);
    ctx.font = '900 19px Rubik, sans-serif';
    const tw = ctx.measureText(label).width;
    const size = tw > w - 24 ? Math.max(12, Math.floor(19 * (w - 24) / tw)) : 19;
    text(ctx, label, x + w / 2, y + h / 2 + 1, { size, color: OUT, align: 'center', base: 'middle' });
    ctx.restore();
  }

  leave() {
    for (const o of this.offs) o();
    this.offs = [];
    this.chat?.detach();
    for (const f of [this.me, ...this.friends.values()]) { this.scene.remove(f.g); f.rig.dispose(); }
    this.friends.clear();
    if (!this.mp) save.write();
    // the diorama is rebuilt on every visit: free its geometry and its own textures / unlit materials
    // (shared toon materials from gfx.mat stay cached)
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh && !(o as THREE.Sprite).isSprite) return;
      if (m.isMesh) m.geometry.dispose();
      for (const mt of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.Material[]) {
        const map = (mt as THREE.MeshBasicMaterial).map;
        if (map) map.dispose();
        if (!(mt instanceof THREE.MeshToonMaterial) || map || mt.vertexColors) mt.dispose();
      }
    });
  }

  // ───────────────────────── testkit ─────────────────────────
  /** dev: where things are (for scripted tests) */
  debug() {
    return {
      at: this.me.at, walking: !this.standing(), node: this.myNode(), focus: this.focus, sel: this.sel, sub: this.sub,
      states: Object.fromEntries([...this.nodes.values()].map((n) => [n.ep.id, n.state])),
      choice: this.choice(), friends: [...this.friends.entries()].map(([id, f]) => [id, f.at, f.g.visible]),
      reveal: !!this.camFocus,
    };
  }
  /** dev: put my figurine on a node at once */
  jump(id: string) {
    if (!this.nodes.has(id)) return false;
    this.route = []; this.seg = null; this.me.at = id; this.me.pos.copy(this.standAt(id, net.myId)); this.camT.copy(this.me.pos);
    save.data.mapAt = id;
    return true;
  }
  /** dev: open the card and press its button `i` */
  press(i = 0) { this.focus = true; this.sel = i; this.activate(); }
}

/** a little padlock */
function drawLock(ctx: C, x: number, y: number, s: number) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.lineWidth = 3; ctx.strokeStyle = '#c8c0d8';
  ctx.beginPath(); ctx.arc(10, 9, 6, Math.PI, 0); ctx.stroke();
  rrect(ctx, 2, 9, 16, 13, 3, '#e8c84a', 2);
  ctx.restore();
}

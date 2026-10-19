import * as THREE from 'three';
import { PAL, basic, canvasTex, noOutline } from '../gfx';
import type { Rig } from './rig';
import { G, Mats, TAU, clamp, lerp, damp, smooth, seg, easeOut, grp, part, teardrop, starGeo, cached, Blinker, vis, taperedTube, merge } from './kit';

export type GuardKind = 'guard' | 'spitter' | 'feeder' | 'shield' | 'bomber' | 'charger';
export interface GuardAnim {
  state: 'idle' | 'walk' | 'windup' | 'attack' | 'hurt' | 'spit' | 'cheer' | 'alert' | 'carry'
    | 'look' | 'block' | 'bash' | 'throw' | 'charge' | 'dizzy';
  speed: number;
  flash: number;
  /** head/body turn while searching (−1..1), used by 'look' */
  look?: number;
  /** 0..1 progress of a timed action ('throw', 'bash') */
  p?: number;
}

/** createGuard() result: the rig plus a few anchors inside the animated hierarchy (read them with getWorldPosition). */
export interface GuardRig extends Rig<GuardAnim> {
  /** right hand (spear / sword / lance grip). 'bomber': the cherry bomb leaves this hand at p = 0.45 of 'throw'. */
  hand: THREE.Object3D;
  /** a point just above the helmet (the dizzy stars orbit here) — handy for "!" / "?" marks. */
  head: THREE.Object3D;
  /** 'shield' only: the pot lid (local +Z = outward normal of the lid face). */
  lid: THREE.Object3D | null;
  /** 'charger' only: the tip of the fork-lance tines. */
  lanceTip: THREE.Object3D | null;
}

type V3 = [number, number, number];
const CENTER_Y = 0.48;

let melonTexCache: THREE.Texture | null = null;
function melonTex() {
  if (melonTexCache) return melonTexCache;
  melonTexCache = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = PAL.melon; g.fillRect(0, 0, w, h);
    const n = 11;
    for (let k = 0; k < n; k++) {
      const x0 = (k + 0.5) * (w / n) + Math.sin(k * 3.1) * 6;
      const left: [number, number][] = [];
      const right: [number, number][] = [];
      for (let y = -4; y <= h + 4; y += 4) {
        const c = x0 + Math.sin(y * 0.045 + k * 1.3) * 10 + Math.sin(y * 0.13 + k * 2.1) * 3.5;
        const wid = 9 + Math.sin(y * 0.07 + k) * 3 + (Math.sin(y * 0.9 + k * 5) > 0.2 ? 2.5 : 0);
        left.push([c - wid - Math.abs(Math.sin(y * 0.6 + k)) * 3, y]);
        right.push([c + wid + Math.abs(Math.cos(y * 0.5 + k * 3)) * 3, y]);
      }
      g.fillStyle = PAL.melonStripe;
      for (const dx of [-w, 0, w]) {
        g.beginPath();
        left.forEach(([x, y], i) => (i ? g.lineTo(x + dx, y) : g.moveTo(x + dx, y)));
        for (let i = right.length - 1; i >= 0; i--) g.lineTo(right[i][0] + dx, right[i][1]);
        g.closePath();
        g.fill();
      }
    }
    // a few light speckles
    g.fillStyle = 'rgba(255,255,255,0.10)';
    for (let i = 0; i < 70; i++) { g.beginPath(); g.ellipse((i * 97.3) % w, (i * 53.7) % h, 3, 1.6, 0, 0, Math.PI * 2); g.fill(); }
  }, { wrap: true });
  return melonTexCache;
}

let strawTexCache: THREE.Texture | null = null;
function strawTex() {
  if (strawTexCache) return strawTexCache;
  strawTexCache = canvasTex(64, 128, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8383d';
    for (let i = -4; i < 12; i++) {
      g.beginPath();
      g.moveTo(0, i * 16); g.lineTo(w, i * 16 + 24); g.lineTo(w, i * 16 + 32); g.lineTo(0, i * 16 + 8);
      g.closePath(); g.fill();
    }
  }, { wrap: true });
  return strawTexCache;
}

/** colander helmet: brushed steel with rows of holes (dome uv: v = 1 at the top → canvas y = 0, v = 0 at the rim) */
let colanderTexCache: THREE.Texture | null = null;
function colanderTex() {
  if (colanderTexCache) return colanderTexCache;
  colanderTexCache = canvasTex(512, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#f6f8fb'); gr.addColorStop(0.65, '#d6dde7'); gr.addColorStop(1, '#b0bac8');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.22)';
    for (let i = 0; i < 46; i++) g.fillRect((i * 131.7) % w, 0, 1.5, h);
    const pxR = h / (Math.PI / 2); // px per radian along a meridian
    const hole = (cx: number, cy: number, rx: number, ry: number) => {
      g.fillStyle = '#2b3240';
      g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 2;
      g.beginPath(); g.ellipse(cx, cy + 1.5, rx, ry, 0, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
    };
    const rows = [0.24, 0.46, 0.68, 0.9, 1.12];
    rows.forEach((th, ri) => {
      const sin = Math.sin(th);
      const n = ri === 0 ? 6 : Math.floor((TAU * sin) / 0.22);
      const rx = (0.05 * w) / (TAU * sin), ry = 0.05 * pxR;
      for (let k = 0; k < n; k++) {
        const x = ((k + (ri % 2 ? 0.5 : 0)) / n) * w;
        for (const dx of [-w, 0, w]) hole(x + dx, th * pxR, rx, ry);
      }
    });
    // plain band near the rim
    g.fillStyle = 'rgba(60,70,88,0.28)'; g.fillRect(0, h - 22, w, 22);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, h - 24, w, 3);
  }, { wrap: true });
  return colanderTexCache;
}

/** crimped bottle-cap skirt: extruded star polygon (vertical) */
const capGeo = () => cached('guard-cap', () => {
  const s = new THREE.Shape();
  const teeth = 21;
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? 0.2 : 0.183;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.016, bevelSize: 0.012, bevelSegments: 2, curveSegments: 4 });
  g.rotateX(-Math.PI / 2); // extrude along +Y
  return g;
});

const steakGeo = () => cached('guard-steak', () => {
  const g = new THREE.SphereGeometry(1, 24, 14);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const a = Math.atan2(v.z, v.x);
    const k = 1 + 0.12 * Math.sin(a * 3 + 0.5) + 0.06 * Math.sin(a * 5);
    p.setXYZ(i, v.x * k, v.y, v.z * k);
  }
  g.computeVertexNormals();
  return g;
});

/** dizzy eye: flat 2-turn spiral in the XY plane, outer radius 1 */
const spiralGeo = () => cached('guard-spiral', () => {
  const pts: THREE.Vector3[] = [];
  const n = 48, turns = 2.1;
  for (let i = 0; i <= n; i++) {
    const u = i / n, a = u * turns * TAU, r = 0.1 + 0.9 * u;
    pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 90, 0.17, 6, false);
});

/** pot lid: shallow dome (convex side toward +Z), radius 1, depth 0.2 */
const lidGeo = () => cached('guard-lid', () => {
  const pts: THREE.Vector2[] = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const r = 1 - i / n;
    pts.push(new THREE.Vector2(Math.max(r, 1e-3), 0.2 * (1 - r * r) ** 0.8));
  }
  const g = new THREE.LatheGeometry(pts, 40);
  g.rotateX(Math.PI / 2); // axis +Y → +Z
  return g;
});

/** curved bull horn (base at the origin), mirrored by side */
const hornGeo = (side: 1 | -1) => cached(`charger-horn${side}`, () => {
  const c = new THREE.CubicBezierCurve3(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(side * 0.12, 0.0, 0.0),
    new THREE.Vector3(side * 0.2, 0.08, 0.04),
    new THREE.Vector3(side * 0.2, 0.2, 0.1),
  );
  return taperedTube(c, 18, 10, (t) => lerp(0.052, 0.008, Math.pow(t, 0.85)));
});

// bandolier (bomber): a tube on the melon surface along a tilted plane — over the right shoulder, under the face, down the left hip
const MEL0: V3 = [0.36, 0.33, 0.35];
const SASH_N = new THREE.Vector3(0.35, 1, 0.75).normalize();
const SASH_D = -0.09;
const SASH_U = new THREE.Vector3(0, 0, 1).addScaledVector(SASH_N, -SASH_N.z).normalize();
const SASH_V = new THREE.Vector3().crossVectors(SASH_N, SASH_U);
function sashPoint(th: number, out: THREE.Vector3, push = 1.03) {
  const w = new THREE.Vector3().copy(SASH_U).multiplyScalar(Math.cos(th)).addScaledVector(SASH_V, Math.sin(th));
  const q = new THREE.Vector3().copy(SASH_N).multiplyScalar(SASH_D);
  let A = 0, B = 0, C = -1;
  for (let i = 0; i < 3; i++) {
    const s = MEL0[i], wi = w.getComponent(i), qi = q.getComponent(i);
    A += (wi / s) ** 2; B += (2 * qi * wi) / (s * s); C += (qi / s) ** 2;
  }
  const r = (-B + Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A);
  return out.copy(q).addScaledVector(w, r).multiplyScalar(push);
}
const sashGeo = () => cached('bomber-sash', () => {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 64; i++) pts.push(sashPoint((i / 64) * TAU, new THREE.Vector3()));
  return taperedTube(new THREE.CatmullRomCurve3(pts, true), 128, 6, () => 0.026, false);
});

/** a small cherry bomb (sphere + glossy dot + stem) */
interface CherryMats { red: THREE.Material; hl: THREE.Material; stem: THREE.Material }
function cherryParts(parent: THREE.Object3D, r: number, p: V3, rot: V3, m: CherryMats) {
  const c = grp(parent, p, rot);
  part(c, G.sphere(), m.red, undefined, [r, r * 0.93, r]);
  part(c, G.ball(), m.hl, [-r * 0.38, r * 0.42, r * 0.62], r * 0.24, undefined, { cast: false });
  part(c, G.capsule(r * 0.13, r * 0.7), m.stem, [r * 0.12, r * 1.15, 0], 1, [0, 0, -0.35]);
  return c;
}
type BandoSlot = 'red' | 'hl' | 'stem' | 'brass';
/** the four bandolier cherries are static on the body: bake them into one geometry per material slot */
const bandoGeo = (slot: BandoSlot) => cached(`bomber-bando-${slot}`, () => {
  const tmp = new THREE.Group();
  const ph: Record<BandoSlot, THREE.Material> = { red: new THREE.MeshBasicMaterial(), hl: new THREE.MeshBasicMaterial(), stem: new THREE.MeshBasicMaterial(), brass: new THREE.MeshBasicMaterial() };
  const p = new THREE.Vector3(), nrm = new THREE.Vector3();
  for (const th of [-1.05, -0.62, 0.42, 0.92]) {
    sashPoint(th, p, 1.03);
    nrm.set(p.x / MEL0[0] ** 2, p.y / MEL0[1] ** 2, p.z / MEL0[2] ** 2).normalize();
    p.addScaledVector(nrm, 0.04);
    const c = cherryParts(tmp, 0.056, [p.x, p.y, p.z], [0.1 * th, 0, -0.3 * th], ph);
    part(c, G.torus(0.02, 0.007, 5, 12), ph.brass, [0, 0.06, -0.02], 1, [Math.PI / 2, 0, 0]); // buckle loop
  }
  tmp.updateMatrixWorld(true);
  const list: Array<{ g: THREE.BufferGeometry }> = [];
  tmp.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.material === ph[slot]) list.push({ g: m.geometry.clone().applyMatrix4(m.matrixWorld) });
  });
  for (const k of Object.keys(ph) as BandoSlot[]) ph[k].dispose();
  return merge(list);
});

/** n small rivet balls on a horizontal ring, merged into one geometry */
const rivetRing = (key: string, n: number, R: number, y: number, r: number, a0: number) => cached(key, () =>
  merge(Array.from({ length: n }, (_, i) => {
    const a = (i / n) * TAU + a0;
    return { g: G.ball(), p: [Math.sin(a) * R, y, Math.cos(a) * R] as V3, s: r };
  })));

/** fork-lance (charger): handle along +Z, origin = tuck point under the arm; tines at +Z */
const LANCE_TIP_Z = 0.86;

const _v = new THREE.Vector3();
interface Reach { p: number; y: number; k: number }
/** pitch / yaw (roll 0, shoulder order YXZ) and stretch so an arm hanging along −Y from `sh` puts its hand at `target` */
function reach(sh: THREE.Vector3, target: THREE.Vector3, out: Reach) {
  _v.subVectors(target, sh);
  const L = Math.max(1e-4, _v.length());
  _v.multiplyScalar(1 / L);
  out.p = -Math.acos(clamp(-_v.y, -1, 1));
  out.y = Math.atan2(_v.x, _v.z);
  out.k = Math.max(0.5, L / 0.065 - 1);
  return out;
}

// lid poses in body space: [x, y, z, pitch, yaw, roll]
type Pose6 = [number, number, number, number, number, number];
const LID_REST: Pose6 = [0.47, -0.08, 0.14, 0.05, 1.0, -0.06];
const LID_GUARD: Pose6 = [0.34, -0.02, 0.36, 0.0, 0.55, 0];
const LID_BLOCK: Pose6 = [0.07, -0.01, 0.5, -0.04, 0.05, 0];
const LID_WIND: Pose6 = [0.16, -0.02, 0.4, 0.02, 0.3, 0];
const LID_SLAM: Pose6 = [0.04, 0.0, 0.68, -0.06, -0.04, 0];
const LID_HURT: Pose6 = [0.46, 0.14, 0.02, 0.4, 1.35, 0.5];
const LID_UP: Pose6 = [0.44, 0.06, 0.18, -0.2, 0.9, -0.3];

export function createGuard(kind: GuardKind): GuardRig {
  const M = new Mats();
  const black = basic('#1b1214');
  const white = basic('#ffffff');
  const big = kind === 'charger';
  const capColor = kind === 'spitter' ? PAL.capBlue : kind === 'feeder' ? PAL.capGold : kind === 'charger' ? '#4a4f62' : PAL.capRed;
  const limbM = M.get('#4fae46');
  const handM = M.get('#6cc25c');
  const footM = M.get(PAL.melonStripe);
  const MEL: V3 = big ? [0.395, 0.345, 0.38] : MEL0;
  const SHX = big ? 0.372 : 0.335;
  const FZ = MEL[2] - 0.35; // face push for the fatter melon

  const root = new THREE.Group();
  root.name = `guard-${kind}`;
  // everything visual hangs off `base` (feet at y = 0), so the charger can be scaled up without moving its feet
  const base = grp(root, undefined, undefined, 'base');
  if (big) base.scale.setScalar(1.3);

  // feet (stepping in base space)
  const feet: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const f = grp(base, [s * (big ? 0.155 : 0.13), 0, 0.02]);
    part(f, G.sphere(), footM, [0, 0.055, 0.025], big ? [0.1, 0.064, 0.125] : [0.085, 0.058, 0.11]);
    part(f, G.capsule(0.035, 0.04), limbM, [0, 0.12, 0], big ? [1.25, 1, 1.25] : undefined);
    feet.push(f);
  }

  const sway = grp(base, undefined, undefined, 'sway');
  const hop = grp(sway);
  const bodyC = grp(hop, [0, CENTER_Y, 0], undefined, 'body');

  // melon
  part(bodyC, G.sphere(), M.get('#ffffff', { map: melonTex() }), undefined, MEL, [0, 0.4, 0]);

  // face window
  const face = grp(bodyC, [0, -0.01, FZ]);
  part(face, G.sphere(), M.get(PAL.rind), [0, 0, 0.29], [0.245, 0.225, 0.075]);
  part(face, G.sphere(), M.get(PAL.flesh), [0, 0, 0.305], [0.21, 0.19, 0.07]);
  const fleshZ = (x: number, y: number) => 0.305 + 0.07 * Math.sqrt(Math.max(0, 1 - (x / 0.21) ** 2 - (y / 0.19) ** 2));
  const fo = { cast: false };
  // eyes (seed teardrops)
  interface GEye { g: THREE.Group; x: number; eye: THREE.Mesh; glint: THREE.Mesh; happy: THREE.Mesh; brow: THREE.Mesh; spiral: THREE.Mesh }
  const eyes: GEye[] = [];
  for (const s of [1, -1]) {
    const x = s * 0.078, y = 0.045;
    const g = grp(face, [x, y, fleshZ(x, y) - 0.004], [-y * 1.6, x * 2.2, 0]);
    const eye = part(g, teardrop(), black, undefined, [0.031, 0.042, 0.013], [0, 0, -s * 0.12], fo);
    const glint = part(g, G.ball(), white, [0.009, 0.012, 0.012], 0.0105, undefined, fo);
    const happy = part(g, G.arc(0.026, 0.009, Math.PI), black, [0, -0.008, 0.006], [1, 1, 0.6], undefined, fo);
    const spiral = part(g, spiralGeo(), black, [0, 0, 0.008], 0.036, undefined, fo);
    spiral.visible = false;
    const bx = s * 0.085, by = 0.118;
    const brow = part(face, G.capsule(0.013, 0.055), M.get('#1d4a1f'), [bx, by, fleshZ(bx, by) + 0.008], 1, [0, 0, Math.PI / 2], fo);
    eyes.push({ g, x, eye, glint, happy, brow, spiral });
  }
  // seeds
  for (const [x, y, r] of [[-0.14, -0.055, 0.4], [0.142, -0.045, -0.5], [-0.085, -0.135, 0.2], [0.09, -0.13, -0.25], [0.0, -0.165, 0.0]] as const) {
    part(face, teardrop(), black, [x, y, fleshZ(x, y) - 0.002], [0.011, 0.016, 0.006], [-y, x * 2, r], fo);
  }
  // mouth
  const mouth = grp(face, [0, -0.072, fleshZ(0, -0.072)]);
  const smile = part(mouth, G.arc(0.028, 0.0085, Math.PI), black, [0, 0.016, 0.002], [1, 1, 0.6], [0, 0, Math.PI], fo);
  const frown = part(mouth, G.arc(0.024, 0.0085, Math.PI), black, [0, -0.018, 0.002], [1, 1, 0.6], undefined, fo);
  const open = part(mouth, G.ball(), basic('#5a0f1c'), [0, -0.006, 0], [0.04, 0.03, 0.016], undefined, fo);
  const teeth = part(mouth, G.capsule(0.008, 0.04), white, [0, 0.008, 0.012], 1, [0, 0, Math.PI / 2], fo);

  // ── helmets ──
  const steel = M.get('#d3dae4');
  const steelD = M.get('#8a94a4');
  if (kind === 'shield') {
    // upside-down colander: holey steel dome, riveted rim, side handles, foot ring on top
    const helm = grp(bodyC, [0, 0.17, -0.012], [-0.17, 0, 0.07]);
    part(helm, G.dome(), M.get('#ffffff', { map: colanderTex() }), undefined, [0.305, 0.235, 0.305]);
    part(helm, G.torus(0.302, 0.024, 8, 40), steelD, [0, 0.004, 0], 1, [Math.PI / 2, 0, 0]);
    part(helm, rivetRing('colander-rivets', 12, 0.318, 0.012, 0.017, 0), steel, undefined, undefined, undefined, fo);
    for (const s of [1, -1]) part(helm, G.torus(0.055, 0.016, 6, 18), steelD, [s * 0.315, 0.05, 0], 1, [0, Math.PI / 2, 0]);
    part(helm, G.torus(0.09, 0.02, 6, 28), steelD, [0, 0.232, 0], 1, [Math.PI / 2, 0, 0]);
    part(helm, G.cyl(), steel, [0, 0.236, 0], [0.085, 0.012, 0.085]);
  } else if (kind === 'bomber') {
    // leather aviator cap: fleece trim, ear flaps, strap and brass goggles pushed up on the forehead
    const leather = M.get('#9a5228');
    const leatherD = M.get('#6e3418');
    const fleece = M.get('#f6e8c8');
    const helm = grp(bodyC, [0, 0.13, -0.01], [-0.1, 0, 0.05]);
    part(helm, G.dome(), leather, undefined, [0.335, 0.26, 0.335]);
    part(helm, G.arc(1, 0.035, Math.PI), leatherD, [0, 0, 0], [0.338, 0.263, 0.338], [0, Math.PI / 2, 0]);
    part(helm, G.torus(0.335, 0.032, 8, 40), fleece, [0, 0.0, 0], 1, [Math.PI / 2, 0, 0]);
    for (const s of [1, -1]) {
      const flap = grp(helm, [s * 0.33, -0.02, 0.0], [0, 0, s * 0.14]);
      part(flap, G.sphere(), leather, [0, -0.04, 0], [0.05, 0.11, 0.1]);
      part(flap, G.sphere(), fleece, [-s * 0.012, -0.045, 0], [0.042, 0.1, 0.088]);
    }
    // goggles band + goggles
    part(helm, G.torus(1, 0.04, 6, 44), M.get('#3a2a24'), [0, 0.07, 0], [0.326, 0.326, 0.6], [Math.PI / 2, 0, 0]);
    const gog = grp(helm, [0, 0.085, 0.3], [-0.42, 0, 0]);
    const brass = M.get('#d8a43a');
    for (const s of [1, -1]) {
      part(gog, G.torus(0.05, 0.017, 8, 24), brass, [s * 0.07, 0, 0.025], 1);
      part(gog, G.cyl(), M.get('#3a2a24'), [s * 0.07, 0, 0.012], [0.055, 0.03, 0.055], [Math.PI / 2, 0, 0]);
      part(gog, G.sphere(), M.get('#7fe2ff'), [s * 0.07, 0, 0.03], [0.045, 0.045, 0.016]);
      part(gog, G.ball(), white, [s * 0.07 - 0.016, 0.017, 0.044], 0.011, undefined, fo);
    }
    part(gog, G.capsule(0.012, 0.03), brass, [0, 0, 0.03], 1, [0, 0, Math.PI / 2]);
  } else {
    // bottle-cap helmet
    const cap = grp(bodyC, big ? [0, 0.262, -0.02] : [0, 0.25, -0.015], [-0.12, 0, big ? 0.05 : 0.09]);
    if (big) cap.scale.set(1.18, 1.05, 1.18);
    const capM = M.get(capColor);
    part(cap, capGeo(), capM);
    const topColor = new THREE.Color(capColor).lerp(new THREE.Color('#ffffff'), 0.28);
    part(cap, G.cyl(), M.get(topColor), [0, 0.132, 0], [0.158, 0.014, 0.158]);
    part(cap, starGeo(), M.get(big ? PAL.gold : '#fff5d8'), [0, 0.142, 0], [0.15, 0.15, 0.1], [-Math.PI / 2, 0, 0]);
    if (big) {
      // two curved bull horns + rivets
      const hornM = M.get('#f7eed6');
      const bandM = M.get('#2f3240');
      for (const s of [1, -1] as const) {
        const h = grp(cap, [s * 0.17, 0.07, 0.0], [0, 0, 0]);
        part(h, hornGeo(s), hornM);
        part(h, G.torus(0.05, 0.016, 6, 18), bandM, [s * 0.025, 0.0, 0], 1, [0, Math.PI / 2, 0]);
      }
      part(cap, rivetRing('charger-rivets', 8, 0.205, 0.05, 0.016, 0.2), M.get('#c9ced8'), undefined, undefined, undefined, fo);
    }
  }
  if (big) {
    // bull nose ring between the eyes and the mouth
    part(face, G.torus(0.032, 0.008, 6, 20), M.get(PAL.gold), [0, -0.03, fleshZ(0, -0.03) + 0.01], 1, [0.25, 0, 0], fo);
  }

  // head anchor + dizzy stars
  const head = grp(bodyC, [0, big ? 0.52 : 0.47, 0], undefined, 'head');
  const stars = grp(head);
  const starList: THREE.Mesh[] = [];
  const starM = M.get('#ffd83a');
  for (let i = 0; i < 3; i++) starList.push(part(stars, starGeo(), starM, undefined, 0.16, undefined, fo));
  stars.visible = false;

  // arms
  const mkArm = (s: number) => {
    const sh = grp(bodyC, [s * SHX, -0.01, 0.03]);
    sh.rotation.order = 'YXZ';
    const arm = part(sh, G.capsule(0.042, 0.075), limbM, [0, -0.06, 0], big ? [1.2, 1, 1.2] : undefined);
    const hand = grp(sh, [0, -0.13, 0]);
    part(hand, G.ball(), handM, undefined, big ? 0.064 : 0.056);
    const mount = grp(hand);
    return { sh, arm, hand, mount };
  };
  const armL = mkArm(1);
  const armR = mkArm(-1);

  // ── kind-specific props ──
  let spear: THREE.Group | null = null;
  let spearHold: THREE.Group | null = null;
  if (kind === 'guard') {
    spearHold = grp(armR.mount);
    spear = grp(spearHold);
    const stick = M.get(PAL.skewer);
    part(spear, G.cyl(), stick, [0, 0, 0.14], [0.012, 0.86, 0.012], [Math.PI / 2, 0, 0]);
    part(spear, G.cone(), stick, [0, 0, 0.61], [0.015, 0.08, 0.015], [Math.PI / 2, 0, 0]);
    part(spear, G.sphere(), M.get(PAL.olive), [0, 0, 0.46], [0.05, 0.05, 0.064]);
    part(spear, G.ball(), M.get('#e0302e'), [0, 0, 0.518], [0.025, 0.025, 0.014]);
    part(spear, G.ball(), stick, [0, 0, -0.29], 0.018);
  }
  if (kind === 'shield') {
    // short skewer sword: wooden blade, red cross-guard, wrapped grip, cherry-tomato pommel
    spearHold = grp(armR.mount);
    spear = grp(spearHold);
    const stick = M.get(PAL.skewer);
    part(spear, G.cyl(), stick, [0, 0, 0.21], [0.017, 0.34, 0.017], [Math.PI / 2, 0, 0]);
    part(spear, G.cone(), stick, [0, 0, 0.42], [0.02, 0.08, 0.02], [Math.PI / 2, 0, 0]);
    part(spear, G.capsule(0.02, 0.13), M.get('#e0302e'), [0, 0, 0.045], 1, [0, 0, Math.PI / 2]);
    part(spear, G.cyl(), M.get('#7a4a2c'), [0, 0, -0.02], [0.02, 0.1, 0.02], [Math.PI / 2, 0, 0]);
    part(spear, G.ball(), M.get('#e0302e'), [0, 0, -0.085], 0.03);
  }
  let straw: THREE.Group | null = null;
  if (kind === 'spitter') {
    straw = grp(mouth, [0.006, -0.006, 0.0], [-0.12, 0.5, 0]);
    part(straw, G.cyl(), M.get('#ffffff', { map: strawTex() }), [0, 0, 0.13], [0.019, 0.27, 0.019], [Math.PI / 2, 0, 0]);
  }
  let plate: THREE.Group | null = null;
  if (kind === 'feeder') {
    plate = grp(bodyC, [0, 0.44, 0.02], undefined, 'plate');
    plate.scale.setScalar(1.12);
    part(plate, G.cyl(), M.get('#f6f2e8'), [0, 0, 0], [0.25, 0.022, 0.25]);
    part(plate, G.torus(0.235, 0.02, 8, 36), M.get('#f6f2e8'), [0, 0.012, 0], 1, [Math.PI / 2, 0, 0]);
    part(plate, G.torus(0.2, 0.008, 6, 36), M.get('#5aa0d8'), [0, 0.014, 0], 1, [Math.PI / 2, 0, 0]);
    const steak = grp(plate, [0, 0.07, 0], [0, 0.4, 0]);
    steak.scale.setScalar(1.25);
    part(steak, steakGeo(), M.get('#f2d0b0'), [0, 0, 0], [0.185, 0.058, 0.14]);
    part(steak, steakGeo(), M.get(PAL.meat), [0, 0.012, 0], [0.165, 0.058, 0.122]);
    for (const z of [-0.05, 0, 0.05]) part(steak, G.capsule(0.007, 0.16), M.get('#5a1a10'), [0, 0.068, z], 1, [0.2, 0, Math.PI / 2 + 0.5]);
    // bone
    part(steak, G.capsule(0.022, 0.12), M.get('#fff8ea'), [0.2, 0.01, 0], 1, [0, 0, Math.PI / 2]);
    part(steak, G.ball(), M.get('#fff8ea'), [0.29, 0.01, 0.022], 0.03);
    part(steak, G.ball(), M.get('#fff8ea'), [0.29, 0.01, -0.022], 0.03);
    plate.visible = false;
  }

  // shield: pot lid held on the left arm (the arm is aimed at the grip every frame)
  let lid: THREE.Group | null = null;
  const lidGrip = new THREE.Vector3(0.085, 0.03, -0.045);
  if (kind === 'shield') {
    lid = grp(bodyC, undefined, undefined, 'lid');
    lid.rotation.order = 'YXZ';
    const LR = 0.29;
    const lm = M.get('#cfd7e2');
    part(lid, lidGeo(), lm, undefined, [LR, LR, LR * 0.9]);
    part(lid, G.cyl(), M.get('#a9b3c1'), [0, 0, -0.004], [LR * 0.985, 0.012, LR * 0.985], [Math.PI / 2, 0, 0]);
    part(lid, G.torus(LR, 0.022, 8, 44), M.get('#6e7888'), [0, 0, 0.002], 1);
    // concentric pressed ring
    part(lid, G.torus(LR * 0.62, 0.007, 6, 40), M.get('#b2bccb'), [0, 0, LR * 0.9 * 0.2 * 0.62 + 0.004], 1);
    // knob: black bakelite on a little steel washer
    part(lid, G.cyl(), steelD, [0, 0, 0.06], [0.05, 0.014, 0.05], [Math.PI / 2, 0, 0]);
    part(lid, G.cyl(), M.get('#2a2326'), [0, 0, 0.082], [0.026, 0.035, 0.026], [Math.PI / 2, 0, 0]);
    part(lid, G.sphere(), M.get('#2a2326'), [0, 0, 0.105], [0.052, 0.052, 0.034]);
    part(lid, G.ball(), white, [-0.016, 0.018, 0.128], 0.009, undefined, fo);
    // dent (a dull pressed-in dimple with a bright edge) + a scratch
    part(lid, G.sphere(), M.get('#9aa4b3'), [0.13, -0.11, 0.024], [0.05, 0.036, 0.012], [0, 0, 0.5], fo);
    part(lid, G.arc(0.048, 0.005, Math.PI * 0.9), M.get('#ffffff'), [0.13, -0.11, 0.033], [1, 0.75, 1], [0, 0, 0.9], fo);
    part(lid, G.capsule(0.004, 0.07), M.get('#8a94a4'), [-0.12, 0.1, 0.03], 1, [0.2, 0.3, 0.9], fo);
    // strap behind (what the hand grabs)
    part(lid, G.capsule(0.016, 0.1), M.get('#7a4a2c'), [lidGrip.x, lidGrip.y, -0.03], 1, [0, 0, 0.0]);
  }

  // bomber: bandolier of cherry bombs + one cherry in the throwing hand
  let heldBomb: THREE.Group | null = null;
  let spark: THREE.Mesh | null = null;
  if (kind === 'bomber') {
    const cm: CherryMats = { red: M.get('#e3203c'), hl: white, stem: M.get('#4a2e1c') };
    part(bodyC, sashGeo(), M.get('#6a3a1e'));
    part(bodyC, bandoGeo('red'), cm.red);
    part(bodyC, bandoGeo('hl'), cm.hl, undefined, undefined, undefined, fo);
    part(bodyC, bandoGeo('stem'), cm.stem);
    part(bodyC, bandoGeo('brass'), M.get('#c8963a'), undefined, undefined, undefined, fo);
    heldBomb = cherryParts(armR.mount, 0.068, [0, -0.045, 0.035], [0.3, 0, 0], cm);
    spark = part(heldBomb, G.ball(), basic('#ffd25a', { additive: true }), [0.032, 0.125, 0], 0.024, undefined, { cast: false, receive: false });
    noOutline(spark);
    heldBomb.visible = false;
  }

  // charger: big fork-lance tucked under the right arm (pivot = body centre so it can sweep)
  let lancePivot: THREE.Group | null = null;
  let lance: THREE.Group | null = null;
  let lanceTip: THREE.Group | null = null;
  const lanceGrip = new THREE.Vector3(0, 0, 0.21);
  const LANCE_X = -0.435, LANCE_Y = -0.075, LANCE_Z = 0.02;
  if (kind === 'charger') {
    lancePivot = grp(bodyC, [0, 0, 0], undefined, 'lancePivot');
    lance = grp(lancePivot, [LANCE_X, LANCE_Y, LANCE_Z], undefined, 'lance');
    lance.rotation.order = 'YXZ';
    const fm = M.get('#d8dfe9');
    const fd = M.get('#99a3b3');
    part(lance, G.cyl(), fm, [0, 0, 0.06], [0.026, 0.78, 0.019], [Math.PI / 2, 0, 0]);
    part(lance, G.sphere(), fm, [0, 0, -0.33], [0.034, 0.024, 0.05]);
    part(lance, G.cyl(), M.get('#b0283a'), [0, 0, -0.2], [0.03, 0.14, 0.023], [Math.PI / 2, 0, 0]);
    for (const z of [-0.27, -0.13]) part(lance, G.cyl(), M.get(PAL.gold), [0, 0, z], [0.034, 0.016, 0.027], [Math.PI / 2, 0, 0]);
    // neck flaring into the head
    part(lance, G.cyl(), fm, [0, 0, 0.5], [0.04, 0.12, 0.018], [Math.PI / 2, 0, 0]);
    part(lance, G.sphere(), fm, [0, 0, 0.585], [0.115, 0.022, 0.07]);
    part(lance, G.cyl(), fd, [0, 0, 0.44], [0.032, 0.012, 0.024], [Math.PI / 2, 0, 0]);
    for (const x of [-0.084, -0.028, 0.028, 0.084]) {
      part(lance, G.capsule(0.0155, 0.2), fm, [x, 0, 0.71], 1, [Math.PI / 2, 0, 0]);
      part(lance, G.cone(), fm, [x, 0, 0.835], [0.0155, 0.05, 0.0155], [Math.PI / 2, 0, 0]);
    }
    lanceTip = grp(lance, [0, 0, LANCE_TIP_Z], undefined, 'lanceTip');
  }

  // ── state ──
  const KEYS = ['swayX', 'swayZ', 'hopY', 'hopZ', 'tw', 'aLp', 'aLr', 'aLy', 'kL', 'aRp', 'aRr', 'aRy', 'kR', 'spearP', 'push', 'sx', 'sy', 'faceS', 'eyeS',
    'lx', 'ly', 'lz', 'lp', 'lyw', 'lr', 'nP', 'nY', 'nYl', 'nZ'] as const;
  type K = (typeof KEYS)[number];
  const C = {} as Record<K, number>;
  const T = {} as Record<K, number>;
  for (const k of KEYS) { C[k] = 0; T[k] = 0; }
  const setLid = (P: Pose6) => { T.lx = P[0]; T.ly = P[1]; T.lz = P[2]; T.lp = P[3]; T.lyw = P[4]; T.lr = P[5]; };
  const mixLid = (A: Pose6, B: Pose6, k: number) => { T.lx = lerp(A[0], B[0], k); T.ly = lerp(A[1], B[1], k); T.lz = lerp(A[2], B[2], k); T.lp = lerp(A[3], B[3], k); T.lyw = lerp(A[4], B[4], k); T.lr = lerp(A[5], B[5], k); };
  const lidTmp: Pose6 = [0, 0, 0, 0, 0, 0];
  let first = true;
  let t = Math.random() * 10;
  let st = 0;
  let last: GuardAnim['state'] | '' = '';
  let phase = Math.random() * 6;
  const blinker = new Blinker();
  const R: Reach = { p: 0, y: 0, k: 1 };
  // brow-shading hand for 'look' (the shield-bearer uses the sword hand — the lid arm is busy)
  const browSide = kind === 'shield' ? -1 : 1;
  const browArm = browSide > 0 ? armL : armR;
  const browT = new THREE.Vector3(browSide * 0.15, 0.19, MEL[2] - 0.02);
  const grip = new THREE.Vector3();

  function update(dt: number, a: GuardAnim) {
    dt = Math.min(dt, 0.1);
    t += dt;
    if (a.state !== last) { st = 0; last = a.state; } else st += dt;
    const s = a.state;
    const spd = clamp(a.speed, 0, 1);
    const charging = s === 'charge';
    const walking = s === 'walk' || (s === 'carry' && spd > 0.05) || charging;
    if (walking) phase += dt * (charging ? 12 + 8 * spd : 7 + 7 * spd);
    // timed-action progress: from the game, or a looping demo cycle (preview)
    const prog = a.p !== undefined ? clamp(a.p) : clamp((st % 1.4) / 1.0);

    // defaults
    T.swayX = 0; T.swayZ = 0; T.hopY = 0; T.hopZ = 0; T.tw = 0;
    T.aLp = -0.1; T.aLr = 0.42; T.aLy = 0; T.kL = 1;
    T.aRp = -0.35; T.aRr = -0.42; T.aRy = 0; T.kR = 1;
    T.spearP = -1.42; T.push = 0; T.sx = 1; T.sy = 1; T.faceS = 1; T.eyeS = 1;
    setLid(LID_REST);
    T.nP = -0.06; T.nY = 0; T.nYl = 0; T.nZ = 0;
    const b = Math.sin(t * 2.6);
    let angry = false, openAmt = 0, squint = 0, happy = false, frownOn = false, dizzy = false, teethOn = false;
    let jitter = 0;
    let footLift = 0;
    let lookEyes = 0;
    let lidShake = 0;
    let paw = false;
    let showBomb = false;
    let lam = 16;

    if (walking) {
      const ss = Math.sin(phase);
      T.swayZ = ss * (charging ? 0.08 : 0.14); T.hopY = Math.abs(ss) * (charging ? 0.05 : 0.035);
      T.aLp = ss * 0.45; T.aRp = -ss * 0.35 - 0.35;
      footLift = charging ? 1.45 : 1;
      if (lid) { T.lp = LID_REST[3] + ss * 0.14; T.lyw = LID_REST[4] - ss * 0.08; }
      if (lance) T.nP = -0.06 + ss * 0.04;
    } else {
      T.sy = 1 + 0.015 * b; T.sx = 1 - 0.008 * b;
      T.aLr += 0.04 * b; T.aRr -= 0.04 * b;
    }

    switch (s) {
      case 'windup':
        if (lance) {
          // pawing the ground before the charge
          const q = Math.sin(t * 9);
          T.swayX = 0.2 + 0.02 * q; T.hopY = -0.025; T.sy = 0.96; T.sx = 1.03; T.hopZ = -0.02;
          T.aLp = -0.5 + 0.15 * q; T.aLr = 0.55;
          T.nP = 0.06; T.nZ = 0.02;
          jitter = 1; angry = true; frownOn = true; openAmt = 0.18; teethOn = true; paw = true;
        } else {
          T.swayX = -0.14; T.aRp = -0.85; T.aRr = -0.25; T.aRy = 0.25; T.spearP = 0.02; T.push = -0.14;
          T.aLp = -0.6; T.aLr = 0.6;
          jitter = 1; angry = true; openAmt = 0.25; frownOn = true;
          if (lid) setLid(LID_GUARD);
        }
        break;
      case 'attack': {
        lam = 40;
        if (lance) {
          // sideways lance sweep (right → left across the front); a.p drives it if given, else ~0.95 s from entering the state
          const q = a.p !== undefined ? clamp(a.p) : st / 0.95;
          const k = easeOut(seg(q, 0.04, 0.34));
          const back = smooth(seg(q, 0.58, 1));
          const sw = lerp(-0.75, 1.15, k) * (1 - back);
          T.nY = sw; T.tw = lerp(-0.3, 0.42, k) * (1 - back); T.nYl = 0.18 * (1 - back); T.nZ = 0.12 * (1 - back); T.nP = 0.04;
          T.swayX = 0.12 * (1 - back); T.swayZ = -0.08 * k * (1 - back);
          T.aLp = -0.4; T.aLr = 0.9;
          angry = true; openAmt = 0.8; teethOn = true;
        } else {
          const k = easeOut(clamp(st / 0.1));
          const back = smooth(seg(st, 0.45, 0.8));
          T.swayX = lerp(0.24 * k, 0.05, back); T.hopZ = lerp(0.13 * k, 0.03, back);
          T.aRp = -1.45; T.aRr = -0.12; T.aRy = 0.3; T.spearP = 0.04; T.push = lerp(0.2 * k, 0.05, back);
          T.aLp = 0.5; T.aLr = 0.7;
          angry = true; openAmt = 0.9;
          if (lid) setLid(LID_GUARD);
        }
        break;
      }
      case 'hurt':
        T.swayX = -0.42; T.hopZ = -0.06; T.aLp = -1.2; T.aLr = 1.5; T.aRp = -1.2; T.aRr = -1.5; T.spearP = -1.9;
        squint = 1; openAmt = 0.6;
        if (lid) setLid(LID_HURT);
        if (lance) { T.nP = -0.55; T.nZ = -0.06; }
        break;
      case 'spit': {
        const q = (st % 0.9) / 0.9;
        const puff = smooth(seg(q, 0, 0.38)) * (1 - smooth(seg(q, 0.4, 0.46)));
        const rec = smooth(seg(q, 0.4, 0.47)) * (1 - smooth(seg(q, 0.55, 0.95)));
        T.sx = 1 + 0.15 * puff - 0.04 * rec; T.sy = 1 + 0.06 * puff; T.faceS = 1 + 0.12 * puff;
        T.swayX = -0.3 * rec + 0.06 * puff; T.hopZ = -0.05 * rec;
        T.aLp = -0.3; T.aLr = 0.6 + 0.4 * puff; T.aRp = -0.3; T.aRr = -0.6 - 0.4 * puff;
        squint = puff > 0.3 ? 1 : 0; angry = true; frownOn = true;
        break;
      }
      case 'cheer': {
        const h = Math.abs(Math.sin(t * 7));
        T.hopY = h * 0.14; T.aLp = -0.2; T.aLr = 2.5 + Math.sin(t * 11) * 0.2; T.aRp = -0.2; T.aRr = -2.5 + Math.sin(t * 11) * 0.2;
        T.spearP = -1.6; T.sy = 1 + 0.06 * (h - 0.5); T.sx = 1 - 0.03 * (h - 0.5);
        happy = true; openAmt = 0.55;
        if (lid) { setLid(LID_UP); T.ly = LID_UP[1] + h * 0.06; }
        if (lance) T.nP = -0.5 - h * 0.15;
        break;
      }
      case 'alert': {
        const h = st < 0.35 ? Math.sin((st / 0.35) * Math.PI) : 0;
        T.hopY = h * 0.13; T.swayX = 0.08; T.aLr = 0.8 + h * 0.6; T.aRr = -0.8 - h * 0.6; T.eyeS = 1.25;
        T.sy = 1 + 0.08 * h; angry = true; openAmt = 0.45;
        if (lid) setLid(LID_GUARD);
        if (lance) T.nP = -0.2 - h * 0.2;
        break;
      }
      case 'carry':
        T.aLp = -0.1; T.aLr = 3.4; T.aRp = -0.1; T.aRr = -3.4; T.kL = T.kR = 4.6;
        if (walking) T.swayZ *= 0.6;
        break;
      case 'look': {
        // searching: turn left/right, hand shading the eyes, squint
        const lk = clamp(a.look ?? (Math.sin(t * 1.25) * 1.15), -1, 1);
        T.tw = lk * 0.7; lookEyes = lk;
        T.swayX = 0.07; T.swayZ = -lk * 0.05; T.hopY = 0.008;
        reach(browArm.sh.position, browT, R);
        if (browSide > 0) { T.aLp = R.p; T.aLy = R.y; T.aLr = 0; T.kL = R.k; }
        else { T.aRp = R.p; T.aRy = R.y; T.aRr = 0; T.kR = R.k; T.spearP = -2.3; }
        squint = 0.55; frownOn = true;
        break;
      }
      case 'dizzy': {
        const w = t * 4.4;
        T.swayX = Math.sin(w) * 0.14; T.swayZ = Math.cos(w) * 0.17; T.tw = Math.sin(w * 0.5) * 0.3;
        T.hopY = -0.02;
        T.aLp = Math.sin(w + 1) * 0.45; T.aLr = 0.8 + Math.cos(w) * 0.3; T.aRp = -Math.sin(w + 1) * 0.45 - 0.2; T.aRr = -0.8 + Math.cos(w) * 0.3;
        T.spearP = -1.2 + Math.sin(w) * 0.3;
        dizzy = true; openAmt = 0.25 + 0.1 * Math.sin(t * 6);
        if (lid) { setLid(LID_REST); T.ly = LID_REST[1] - 0.04; T.lp = 0.25 + Math.sin(w) * 0.2; T.lr = Math.cos(w) * 0.2; }
        if (lance) { T.nP = 0.3 + Math.sin(w) * 0.1; T.nY = Math.cos(w) * 0.15; }
        break;
      }
      case 'block': {
        T.hopY = -0.045; T.sy = 0.93; T.sx = 1.04; T.swayX = 0.07;
        jitter = 0.5; angry = true; frownOn = true;
        if (lid) {
          setLid(LID_BLOCK); lidShake = 1;
          T.aRp = -0.2; T.aRr = -0.5; T.spearP = -0.5;
        } else {
          T.aLp = -1.55; T.aLr = 0.05; T.aLy = -0.5; T.aRp = -1.55; T.aRr = -0.05; T.aRy = 0.5; T.kL = T.kR = 1.6; squint = 1;
          if (lance) T.nP = -0.5;
        }
        break;
      }
      case 'bash': {
        lam = 40;
        const p = prog;
        const wind = smooth(seg(p, 0, 0.35)), slam = easeOut(seg(p, 0.35, 0.6)), ret = smooth(seg(p, 0.8, 1));
        const back = wind * (1 - slam), fwd = slam * (1 - ret);
        T.swayX = -0.12 * back + 0.26 * fwd; T.hopZ = -0.04 * back + 0.13 * fwd; T.tw = 0.3 * back - 0.2 * fwd;
        T.sy = 1 - 0.05 * back; T.sx = 1 + 0.04 * back; T.hopY = 0.03 * fwd;
        angry = true; frownOn = back > 0.3; openAmt = fwd * 0.9; teethOn = fwd > 0.2;
        if (lid) {
          for (let i = 0; i < 6; i++) lidTmp[i] = lerp(LID_GUARD[i], LID_WIND[i], wind);
          for (let i = 0; i < 6; i++) lidTmp[i] = lerp(lidTmp[i], LID_SLAM[i], slam);
          mixLid(lidTmp, LID_GUARD, ret);
          T.aRp = 0.3 * back - 0.4; T.spearP = -0.8;
        } else {
          T.aLp = lerp(0.4, -1.6, fwd) * (back + fwd); T.aRp = lerp(0.4, -1.6, fwd) * (back + fwd); T.aLr = 0.2; T.aRr = -0.2;
          T.kL = T.kR = 1 + fwd * 1.6;
        }
        break;
      }
      case 'throw': {
        lam = 40;
        const p = prog;
        const cock = smooth(seg(p, 0, 0.32));
        const rel = easeOut(seg(p, 0.45, 0.58));
        const fol = smooth(seg(p, 0.72, 1));
        // overhand: pitch goes back (+) over the top and comes down in front (continuous, wraps at the end)
        T.aRp = p < 0.45 ? lerp(-0.35, 2.75, cock) : lerp(lerp(2.75, 5.0, rel), TAU - 0.35, fol);
        T.aRr = p < 0.45 ? -0.28 - 0.3 * cock : lerp(-0.58, -0.3, rel); T.aRy = 0; T.kR = lerp(1 + 1.3 * cock, 1, fol);
        if (p >= 0.45) T.kR = lerp(2.3, 1, fol);
        T.tw = p < 0.45 ? -0.45 * cock : lerp(lerp(-0.45, 0.35, rel), 0, fol);
        T.swayX = p < 0.45 ? -0.13 * cock : lerp(lerp(-0.13, 0.24, rel), 0, fol);
        T.hopZ = p < 0.45 ? -0.03 * cock : lerp(lerp(-0.03, 0.07, rel), 0, fol);
        T.hopY = p < 0.45 ? 0 : 0.04 * rel * (1 - fol);
        // other arm points at the target, then swings back
        T.aLp = p < 0.45 ? -1.25 * cock : lerp(lerp(-1.25, 0.6, rel), -0.1, fol); T.aLr = 0.3;
        showBomb = p < 0.45;
        angry = true;
        if (p < 0.45) { squint = 0.45 * cock; frownOn = true; } else { openAmt = 0.75 * (1 - fol); teethOn = true; }
        break;
      }
      case 'charge': {
        const ss = Math.sin(phase);
        T.swayX = 0.36; T.hopZ = 0.04; T.swayZ = ss * 0.06;
        if (lance) {
          T.nP = -0.26 + ss * 0.02; T.nZ = 0.1; // counter the body lean: lance ends up level, slightly lowered
          T.aLp = ss * 1.0 + 0.2; T.aLr = 0.5;
        } else {
          T.aLp = 1.25; T.aRp = 1.25; T.aLr = 0.35; T.aRr = -0.35; T.spearP = 0.0;
          if (lid) setLid(LID_BLOCK);
        }
        angry = true; openAmt = 0.75 + 0.15 * Math.sin(t * 20); teethOn = true;
        break;
      }
      default: break;
    }
    if (kind !== 'feeder' && s === 'carry') { T.aLr = 0.42; T.aRr = -0.42; T.kL = T.kR = 1; }

    if (first) for (const k of KEYS) C[k] = T[k];
    else {
      // the overhand throw winds the arm pitch one full turn forward: unwrap it once it's over (or a new throw starts)
      if (C.aRp - T.aRp > Math.PI) C.aRp -= TAU;
      for (const k of KEYS) C[k] = damp(C[k], T[k], lam, dt);
    }

    // apply
    const jx = jitter ? Math.sin(t * 57) * 0.01 * jitter : 0;
    sway.rotation.set(C.swayX, 0, C.swayZ);
    hop.position.set(jx, C.hopY, C.hopZ);
    bodyC.rotation.set(jitter ? Math.sin(t * 43) * 0.03 * jitter : 0, C.tw, 0);
    bodyC.scale.set(C.sx, C.sy, C.sx);
    face.scale.setScalar(C.faceS);
    armL.sh.rotation.set(C.aLp, C.aLy, C.aLr);
    armR.sh.rotation.set(C.aRp, C.aRy, C.aRr);
    // rubber-hose arm: the capsule spans shoulder → hand (identical to the old rest pose at k = 1)
    const stretch = (arm: typeof armL, k: number) => {
      const L = 0.065 + 0.065 * k;
      arm.arm.scale.y = (L + 0.03) / 0.159;
      arm.arm.position.y = (0.01 - L) / 2;
      arm.hand.position.y = -L;
    };
    stretch(armL, C.kL);
    stretch(armR, C.kR);
    if (spearHold && spear) {
      armR.mount.rotation.set(C.spearP - C.aRp, 0, 0);
      spearHold.position.z = C.push;
    }
    if (plate) vis(plate, s === 'carry');

    // shield lid: pose, then aim the left arm at its strap
    if (lid) {
      const sh = lidShake ? Math.sin(t * 47) * 0.007 : 0;
      lid.position.set(C.lx + sh, C.ly + (lidShake ? Math.sin(t * 61) * 0.005 : 0), C.lz);
      lid.rotation.set(C.lp, C.lyw, C.lr + sh * 2);
      lid.updateMatrix();
      grip.copy(lidGrip).applyMatrix4(lid.matrix);
      reach(armL.sh.position, grip, R);
      armL.sh.rotation.set(R.p, R.y, 0);
      stretch(armL, R.k);
    }
    // charger lance: pose, then aim the right arm at the grip
    if (lance && lancePivot) {
      lancePivot.rotation.y = C.nY;
      lance.position.set(LANCE_X, LANCE_Y, LANCE_Z + C.nZ);
      lance.rotation.set(C.nP, C.nYl, 0);
      lancePivot.updateMatrix();
      lance.updateMatrix();
      grip.copy(lanceGrip).applyMatrix4(lance.matrix).applyMatrix4(lancePivot.matrix);
      reach(armR.sh.position, grip, R);
      armR.sh.rotation.set(R.p, R.y, 0);
      stretch(armR, R.k);
    }
    if (heldBomb) {
      vis(heldBomb, showBomb);
      if (showBomb && spark) {
        const f = 0.7 + 0.5 * Math.abs(Math.sin(t * 37)) + 0.3 * Math.sin(t * 23);
        spark.scale.setScalar(0.022 * f);
      }
    }

    // feet
    for (let i = 0; i < 2; i++) {
      const ph = phase + i * Math.PI;
      const lift = footLift * Math.max(0, Math.sin(ph)) * 0.055;
      const fz = footLift * Math.cos(ph) * 0.06;
      const f = feet[i];
      f.position.y = damp(f.position.y, lift + (s === 'cheer' || s === 'alert' ? C.hopY * 0.6 : 0), 25, dt);
      f.position.z = damp(f.position.z, 0.02 + fz + C.hopZ * 0.5, 25, dt);
      f.rotation.x = footLift ? -Math.sin(ph) * 0.25 : 0;
    }
    if (paw) {
      // right foot scrapes back along the ground, then lifts and comes forward again
      const q = (t * 1.8) % 1;
      const f = feet[1];
      const drag = q < 0.55;
      const u = drag ? q / 0.55 : (q - 0.55) / 0.45;
      f.position.z = drag ? lerp(0.1, -0.13, smooth(u)) : lerp(-0.13, 0.1, smooth(u));
      f.position.y = drag ? 0.004 : Math.sin(u * Math.PI) * 0.05;
      f.rotation.x = drag ? 0.25 : -0.3 * Math.sin(u * Math.PI);
    }

    // face
    const blink = blinker.update(dt);
    for (let i = 0; i < 2; i++) {
      const e = eyes[i];
      const sgn = i === 0 ? 1 : -1;
      const closed = squint >= 1 || happy;
      vis(e.eye, !happy && !dizzy); vis(e.glint, !closed && !dizzy); vis(e.happy, happy && !dizzy); vis(e.spiral, dizzy);
      if (dizzy) e.spiral.rotation.z = -t * 9 * sgn;
      const open = 0.042 * (1 - blink * 0.9) * (angry ? 0.85 : 1);
      const sy = lerp(open, 0.012, clamp(squint));
      e.eye.scale.set(0.031 * C.eyeS, sy * C.eyeS, 0.013);
      e.g.position.x = e.x + lookEyes * 0.014;
      const browOn = angry || squint > 0.3 || dizzy;
      vis(e.brow, browOn);
      if (browOn) e.brow.rotation.set(0, 0, Math.PI / 2 + sgn * (dizzy ? -0.35 : angry ? 0.55 : 0.22));
    }
    const isOpen = openAmt > 0.05;
    vis(open, isOpen); vis(teeth, isOpen && (angry || teethOn));
    vis(smile, !isOpen && !frownOn); vis(frown, !isOpen && frownOn);
    if (isOpen) open.scale.set(0.04 + 0.01 * openAmt, 0.008 + 0.034 * openAmt, 0.016);
    if (straw) straw.position.z = s === 'spit' ? 0.02 * clamp(Math.sin(((st % 0.9) / 0.9) * Math.PI * 2 - 2.5)) : 0;

    // dizzy stars
    vis(stars, dizzy);
    if (dizzy) {
      for (let i = 0; i < 3; i++) {
        const an = t * 3.4 + (i * TAU) / 3;
        const st3 = starList[i];
        st3.position.set(Math.cos(an) * 0.3, 0.04 * Math.sin(an * 2 + i), Math.sin(an) * 0.3);
        st3.rotation.set(0, -an + Math.PI / 2, t * 5 + i);
      }
    }

    M.flash(a.flash);
    first = false;
  }

  return { root, update, hand: armR.hand, head, lid, lanceTip };
}

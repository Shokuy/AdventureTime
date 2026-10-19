import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PAL, basic, noOutline, canvasTex } from '../gfx';
import type { Rig } from './rig';
import {
  G, Mats, TAU, clamp, lerp, damp, smooth, seg, easeOut, easeInOut, wrapAngle,
  grp, part, surf, arcRibbon, Blinker, vis, cached, between, merge, taperedTube, starGeo,
} from './kit';
import { DEFAULT_LOOK, type HeroLook, type HatKind, type BackKind } from '../../net/profile';

export type HeroState = 'idle' | 'run' | 'walk' | 'sneak' | 'jump' | 'fall' | 'dash' | 'hurt' | 'grabbed' | 'dead' | 'sit' | 'cheer' | 'lookUp' | 'tumble'
  // co-op: emotes (short loops) and knocked down (lying on the belly, crawling with `speed`)
  | 'wave' | 'dance' | 'bow' | 'facepalm' | 'downed';
export type HeroExpr = 'normal' | 'happy' | 'angry' | 'scared' | 'surprised' | 'hurt' | 'sleepy';
/**
 * Attack / action poses of every playable hero (each rig shows its own and ignores the others):
 * Tosha sword / swordAlt / fork / spin / sling · Bublik punch / punchAlt (a front paw stretched forward, fx.reach),
 * mill (spinning with stretched paws), grab (stretch-grapple, fx.reach + fx.aim) · Noki axe / axeAlt (axe-guitar
 * chops), axeSpin (air), chord (strums it) · Pastila syringe (syrup pistol shot), flask / flaskAlt (flask smash).
 */
export type HeroAtk = 'sword' | 'swordAlt' | 'fork' | 'spin' | 'sling'
  | 'punch' | 'punchAlt' | 'mill' | 'grab'
  | 'axe' | 'axeAlt' | 'axeSpin' | 'chord'
  | 'syringe' | 'flask' | 'flaskAlt';
/** a hero kit's visible state (the rig of that hero reads what concerns it; all optional, 0 = off) */
export interface HeroFx {
  /** Bublik: how far (m) the attacking / grappling front paw reaches out */
  reach?: number;
  /** Bublik: the grapple's pitch (rad, + = up) */
  aim?: number;
  /** Bublik: stretched as a bridge — total length (m) from the rump to the front paws */
  bridge?: number;
  /** Bublik: inflated as a trampoline (0..1) */
  puff?: number;
  /** Noki: turned into a bat (0..1) */
  bat?: number;
  /** Noki: gliding (0..1) */
  glide?: number;
  /** Noki: charging the heavy axe hit (0..1, 1 = full) */
  charge?: number;
  /** Pastila: a gadget out (0 none, 1.. = which) */
  gadget?: number;
}
export interface HeroAnim {
  state: HeroState;
  /** 0..1 horizontal speed relative to run speed (drives leg/arm cycle rate & lean) */
  speed: number;
  /** p = 0..1 progress */
  attack: { kind: HeroAtk; p: number } | null;
  weapon: 'sword' | 'fork' | 'none';
  /** 0..1 white hit flash */
  flash: number;
  /** 0..1 mouth open amount */
  talk: number;
  expr: HeroExpr;
  /** 1 = normal; >1 stretched tall, <1 squashed (volume preserving) */
  squash: number;
  /** kit visuals (see HeroFx) */
  fx?: HeroFx;
}

/** Tosha rig: `setLook` recolours / swaps the customizable parts live (hat, scarf, clothes, back item). */
export type HeroRig = Rig<HeroAnim> & {
  weaponTip: THREE.Object3D;
  /** the look currently shown (sanitized copy) */
  readonly look: HeroLook;
  /** apply a look (partial = patch on top of the current one); unknown kinds / bad colours are ignored */
  setLook(look: Partial<HeroLook>): void;
  /** free this rig's own GPU resources (call when it leaves for good); shared cached geometries / textures stay */
  dispose(): void;
};

export const HAT_KINDS: HatKind[] = ['beanie', 'cap', 'crown', 'pirate', 'bunny', 'chef', 'viking', 'none'];
export const BACK_KINDS: BackKind[] = ['none', 'backpack', 'cape', 'wings'];
const COLOR_KEYS = ['hatColor', 'scarfColor', 'shirtColor', 'shortsColor', 'bootColor', 'backColor', 'tagColor'] as const;
const HEX = /^#[0-9a-f]{6}$/i;

/** Clean up a look coming from storage / the network: unknown kinds and malformed colours fall back to `base`. */
export function sanitizeLook(l: Partial<HeroLook> | null | undefined, base: HeroLook = DEFAULT_LOOK): HeroLook {
  const o: HeroLook = { ...base };
  if (!l) return o;
  if (HAT_KINDS.includes(l.hat as HatKind)) o.hat = l.hat as HatKind;
  if (BACK_KINDS.includes(l.back as BackKind)) o.back = l.back as BackKind;
  for (const k of COLOR_KEYS) { const v = l[k]; if (typeof v === 'string' && HEX.test(v)) o[k] = v.toLowerCase(); }
  return o;
}

// ───────────────────────── colour helpers ─────────────────────────
const hslA = { h: 0, s: 0, l: 0 }, hslB = { h: 0, s: 0, l: 0 }, hslC = { h: 0, s: 0, l: 0 };
const tmpCol = new THREE.Color();
/** The colour that relates to `c` the way `to` relates to `from` (hue shift, saturation & lightness ratios). Exact for c === from. */
function derive(c: string, from: string, to: string): string {
  if (c.toLowerCase() === from.toLowerCase()) return to;
  const cs = THREE.SRGBColorSpace;
  tmpCol.set(from).getHSL(hslA, cs); tmpCol.set(to).getHSL(hslB, cs); tmpCol.set(c).getHSL(hslC, cs);
  const s = hslA.s > 1e-3 ? hslC.s * (hslB.s / hslA.s) : hslC.s;
  const l = hslA.l > 1e-3 ? hslC.l * (hslB.l / hslA.l) : hslC.l;
  return '#' + tmpCol.setHSL(hslC.h + hslB.h - hslA.h, clamp(s), clamp(l), cs).getHexString(cs);
}
/** a darker shade (same relation as the classic beanie → its band) */
const darker = (c: string) => derive(c, PAL.beanie, PAL.band);
const lighter = (c: string) => '#' + new THREE.Color(c).lerp(new THREE.Color('#ffffff'), 0.5).getHexString();

// ───────────────────────── pose vector ─────────────────────────
const KEYS = [
  'bodyY', 'bodyZ', 'leanX', 'leanZ', 'tiltX', 'tiltZ', 'tiltH', 'twist',
  'hipL', 'hipR', 'kneeL', 'kneeR', 'splay',
  'aLp', 'aLy', 'aLr', 'aRp', 'aRy', 'aRr', 'blade', 'push',
  'headX', 'headY', 'headZ', 'scarf',
] as const;
type PK = (typeof KEYS)[number];
type Pose = Record<PK, number>;
const newPose = (): Pose => { const p = {} as Pose; for (const k of KEYS) p[k] = 0; return p; };

/** Height of the tumble / lying-down pivot above the feet. */
const CY = 0.45;
const SHOULDER_Y = 0.435;

// ───────────────────────── shared geometry ─────────────────────────
const bladeGeo = () => cached('hero-blade', () => {
  const s = new THREE.Shape();
  const w = 0.034, L = 0.43;
  s.moveTo(-w, 0); s.lineTo(w, 0); s.lineTo(w, L - 0.07);
  s.quadraticCurveTo(w * 0.85, L - 0.015, 0, L);
  s.quadraticCurveTo(-w * 0.85, L - 0.015, -w, L - 0.07);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.007, bevelSize: 0.007, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, 0, -0.007);
  g.rotateX(Math.PI / 2); // length → +Z, thickness → Y (flat side faces up when held level)
  return g;
});

const pomGeo = () => cached('hero-pom', () => {
  const g = new THREE.SphereGeometry(1, 20, 16);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 1 + 0.07 * Math.sin(v.x * 9 + v.y * 4) * Math.sin(v.z * 8 - v.y * 5) + 0.04 * Math.sin(v.y * 13);
    v.multiplyScalar(n);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
});

const ribCache = new Map<string, THREE.Texture>();
function ribTex(base: string, rib: string, ribs: number) {
  const key = `${base}|${rib}|${ribs}`;
  let t = ribCache.get(key);
  if (!t) {
    t = canvasTex(256, 8, (g, w, h) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      g.fillStyle = rib;
      const step = w / ribs;
      for (let i = 0; i < ribs; i++) g.fillRect(i * step, 0, step * 0.32, h);
    }, { wrap: true });
    ribCache.set(key, t);
  }
  return t;
}

/**
 * Surface of revolution around Y with a per-angle profile of (r, y) points (yaw convention: x = r·sinφ, z = r·cosφ).
 * A profile running up the outside gives outward normals; `loop` closes the profile into a solid ring.
 */
function revolve(segs: number, profile: (phi: number) => Array<[number, number]>, loop = false): THREE.BufferGeometry {
  const rows: Array<Array<[number, number]>> = [];
  for (let j = 0; j < segs; j++) rows.push(profile((j / segs) * TAU));
  const K = rows[0].length;
  const pos = new Float32Array(segs * K * 3);
  for (let j = 0; j < segs; j++) {
    const phi = (j / segs) * TAU, s = Math.sin(phi), c = Math.cos(phi);
    for (let k = 0; k < K; k++) {
      const [r, y] = rows[j][k];
      const i = (j * K + k) * 3;
      pos[i] = r * s; pos[i + 1] = y; pos[i + 2] = r * c;
    }
  }
  const idx: number[] = [];
  const kn = loop ? K : K - 1;
  for (let j = 0; j < segs; j++) {
    const jn = (j + 1) % segs;
    for (let k = 0; k < kn; k++) {
      const k2 = (k + 1) % K;
      const a = j * K + k, b = j * K + k2, c = jn * K + k, d = jn * K + k2;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ── hats ──
const capBrimGeo = () => cached('hero-cap-brim', () => {
  const s = new THREE.Shape();
  const N = 20;
  for (let i = 0; i <= N; i++) { const a = (i / N) * Math.PI; const x = Math.cos(a) * 0.272, y = Math.sin(a) * 0.43; if (i) s.lineTo(x, y); else s.moveTo(x, y); }
  for (let i = N; i >= 0; i--) { const a = (i / N) * Math.PI; s.lineTo(Math.cos(a) * 0.235, Math.sin(a) * 0.235); }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.018, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, 0, -0.009);
  g.rotateX(Math.PI / 2); // shape +Y → forward (+Z), thickness → Y
  return g;
});

const crownBandGeo = () => cached('hero-crown-band', () => revolve(40, () => [[0.178, -0.05], [0.205, -0.05], [0.216, 0.05], [0.19, 0.05]], true));
const crownSpikesGeo = () => cached('hero-crown-spikes', () => merge(Array.from({ length: 5 }, (_, i) => {
  const a = (i / 5) * TAU, r = 0.2;
  return [
    { g: G.cone(), p: [Math.sin(a) * r, 0.1, Math.cos(a) * r] as [number, number, number], s: [0.045, 0.11, 0.045] as [number, number, number] },
    { g: G.ball(), p: [Math.sin(a) * r, 0.158, Math.cos(a) * r] as [number, number, number], s: 0.024 },
  ];
}).flat()));
const crownGemsGeo = () => cached('hero-crown-gems', () => merge(Array.from({ length: 5 }, (_, i) => {
  const a = (i / 5) * TAU, r = 0.214;
  return { g: G.ball(), p: [Math.sin(a) * r, 0.002, Math.cos(a) * r] as [number, number, number], s: (i ? [0.024, 0.027, 0.012] : [0.032, 0.034, 0.014]) as [number, number, number], r: [0, a, 0] as [number, number, number] };
})));

/** tricorn brim: a rounded triangle (flat side at the front) whose three flaps are turned up */
function pirateEdge(phi: number) {
  const k = (1 + Math.cos(3 * phi)) / 2; // 1 at the flap centres (front, back-left, back-right), 0 at the corners
  const rw = 0.3 + 0.1 * (1 - k) * (1 - k);
  const h = 0.045 + 0.15 * Math.pow(k, 0.8);
  return { rw, h, rt: rw + 0.35 * h };
}
const PIRATE_T = 0.022;
const pirateBrimGeo = () => cached('hero-pirate-brim', () => revolve(72, (phi) => {
  const { rw, h, rt } = pirateEdge(phi);
  const t = PIRATE_T, r0 = 0.2;
  return [[r0, -0.012], [rw + t, -0.012], [rt + t, h], [rt, h], [rw, t], [r0, t]];
}, true));
const pirateTrimGeo = () => cached('hero-pirate-trim', () => {
  const pts: THREE.Vector3[] = [];
  for (let j = 0; j < 72; j++) {
    const phi = (j / 72) * TAU;
    const { h, rt } = pirateEdge(phi);
    const r = rt + PIRATE_T * 0.5;
    pts.push(new THREE.Vector3(Math.sin(phi) * r, h + 0.004, Math.cos(phi) * r));
  }
  return taperedTube(new THREE.CatmullRomCurve3(pts, true), 144, 6, () => 0.013, false);
});
const crossbonesGeo = () => cached('hero-crossbones', () => merge([-1, 1].flatMap((s) => {
  const r = s * 0.78, c = Math.cos(r), sn = Math.sin(r), L = 0.052;
  return [
    { g: G.capsule(0.0075, 0.1), r: [0, 0, r] as [number, number, number] },
    { g: G.ball(), p: [-sn * L - c * 0.007, c * L - sn * 0.007, 0] as [number, number, number], s: 0.011 },
    { g: G.ball(), p: [-sn * L + c * 0.007, c * L + sn * 0.007, 0] as [number, number, number], s: 0.011 },
    { g: G.ball(), p: [sn * L - c * 0.007, -c * L - sn * 0.007, 0] as [number, number, number], s: 0.011 },
    { g: G.ball(), p: [sn * L + c * 0.007, -c * L + sn * 0.007, 0] as [number, number, number], s: 0.011 },
  ];
})));

const chefGeo = () => cached('hero-chef', () => revolve(60, (phi) => {
  const prof: Array<[number, number]> = [[0.25, 0.04], [0.246, 0.14], [0.262, 0.23], [0.3, 0.31], [0.324, 0.385], [0.318, 0.45], [0.28, 0.5], [0.2, 0.537], [0.11, 0.553], [0.002, 0.558]];
  const pleat = 1 + 0.05 * Math.cos(phi * 10);
  return prof.map(([r, y], i) => [r * lerp(1, pleat, clamp((i - 1) / 3)), y] as [number, number]);
}));

const hornCurve = (s: number) => new THREE.CatmullRomCurve3([
  new THREE.Vector3(s * 0.19, 0.07, 0), new THREE.Vector3(s * 0.33, 0.1, 0.02),
  new THREE.Vector3(s * 0.43, 0.22, 0.05), new THREE.Vector3(s * 0.45, 0.37, 0.07),
]);
const hornGeo = (s: number) => cached(`hero-horn${s}`, () => taperedTube(hornCurve(s), 24, 12, (t) => 0.054 * Math.pow(1 - t, 0.85) + 0.007));

const tuftGeo = () => cached('hero-tuft', () => merge([
  { g: taperedTube(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.2, 0.04), new THREE.Vector3(0.01, 0.31, 0.03), new THREE.Vector3(0.0, 0.36, 0.08), new THREE.Vector3(-0.01, 0.335, 0.125)]), 16, 10, (t) => 0.038 * (1 - t) + 0.008) },
  { g: taperedTube(new THREE.CatmullRomCurve3([new THREE.Vector3(-0.04, 0.2, 0.0), new THREE.Vector3(-0.07, 0.29, -0.02), new THREE.Vector3(-0.11, 0.31, -0.06)]), 12, 8, (t) => 0.028 * (1 - t) + 0.006) },
]));

// ── back items ──
const bpBodyGeo = () => cached('hero-bp-body', () => new RoundedBoxGeometry(0.235, 0.26, 0.13, 3, 0.05));
const bpFlapGeo = () => cached('hero-bp-flap', () => new RoundedBoxGeometry(0.248, 0.085, 0.148, 3, 0.035));
const bpPocketGeo = () => cached('hero-bp-pocket', () => new RoundedBoxGeometry(0.16, 0.1, 0.05, 3, 0.022));

const wingGeo = (upper: boolean) => cached(`hero-wing-${upper ? 'u' : 'l'}`, () => {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  if (upper) { s.bezierCurveTo(0.03, 0.15, 0.2, 0.25, 0.265, 0.175); s.bezierCurveTo(0.31, 0.1, 0.17, 0.02, 0, 0); }
  else { s.bezierCurveTo(0.06, -0.01, 0.19, -0.04, 0.18, -0.13); s.bezierCurveTo(0.16, -0.19, 0.04, -0.1, 0, 0); }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.01, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 14 });
  g.translate(0, 0, -0.005);
  return g;
});
/** lighter membrane panel inside a wing (pokes out of both faces) */
const wingPanelGeo = (upper: boolean) => cached(`hero-wingp-${upper ? 'u' : 'l'}`, () => {
  const g = wingGeo(upper).clone();
  const c = upper ? [0.15, 0.12] : [0.1, -0.075];
  g.translate(-c[0], -c[1], 0); g.scale(0.62, 0.62, 1.9); g.translate(c[0], c[1], 0);
  return g;
});

/** cape cloth grid (rows go down, columns go across) */
const CAPE_R = 9, CAPE_C = 7, CAPE_L = 0.38;

export function createHero(look: Partial<HeroLook> = DEFAULT_LOOK): HeroRig {
  const M = new Mats();
  const black = basic('#1b1214');
  const white = basic('#ffffff');
  const mouthDark = basic('#6a1622');
  const tongueM = basic('#ff7f8e');
  const cheekM = basic('#ff9d9d');

  // customizable slots: own materials (never shared with another slot), recoloured by setLook
  const L0 = sanitizeLook(look);
  const hatM = M.own(L0.hatColor);
  const hatDarkM = M.own(darker(L0.hatColor));
  const scarfM = M.own(L0.scarfColor);
  const fringeM = M.own(derive(L0.scarfColor, PAL.scarf, '#c4262c'));
  const shirt = M.own(L0.shirtColor);
  const shortsM = M.own(L0.shortsColor);
  const bootM = M.own(L0.bootColor);
  const cuffM = M.own(derive(L0.bootColor, PAL.boot, '#6a4535'));
  const backM = M.own(L0.backColor);
  const backDarkM = M.own(darker(L0.backColor));
  const backLightM = M.own(lighter(L0.backColor));
  // the beanie's knit (colours baked into rib textures) — created when the beanie is first built
  let beanieM: THREE.MeshToonMaterial | null = null;
  let beanieBandM: THREE.MeshToonMaterial | null = null;
  const goldM = M.get(PAL.gold);

  const root = new THREE.Group();
  root.name = 'hero';
  const squashG = grp(root, undefined, undefined, 'squash');
  const leanG = grp(squashG, undefined, undefined, 'lean');
  const tilt = grp(leanG, [0, CY, 0], undefined, 'tilt');
  const spin = grp(tilt, undefined, undefined, 'spin');
  const body = grp(spin, [0, -CY, 0], undefined, 'body');

  const skin = M.get(PAL.skin);

  // ── torso ──
  part(body, G.sphere(), shortsM, [0, 0.2, 0], [0.15, 0.085, 0.127]);
  part(body, G.sphere(), shirt, [0, 0.335, 0], [0.155, 0.158, 0.13]);

  // ── legs ──
  const legs: { hip: THREE.Group; knee: THREE.Group }[] = [];
  for (const s of [1, -1]) {
    const hip = grp(body, [s * 0.07, 0.18, 0]);
    part(hip, G.capsule(0.042, 0.045), skin, [0, -0.035, 0]);
    const knee = grp(hip, [0, -0.07, 0]);
    part(knee, G.capsule(0.04, 0.035), skin, [0, -0.03, 0]);
    part(knee, G.sphere(), bootM, [0, -0.068, 0.022], [0.062, 0.047, 0.088]);
    part(knee, G.torus(0.045, 0.014, 8, 20), cuffM, [0, -0.04, 0.004], 1, [Math.PI / 2, 0, 0]);
    legs.push({ hip, knee });
  }
  const [legL, legR] = legs;

  // ── arms ──
  const mkArm = (s: number) => {
    const sh = grp(body, [s * 0.148, SHOULDER_Y, 0]);
    sh.rotation.order = 'YXZ';
    part(sh, G.sphere(), shirt, [0, -0.028, 0], [0.052, 0.06, 0.052]);
    part(sh, G.capsule(0.035, 0.07), skin, [0, -0.09, 0]);
    part(sh, G.sphere(), skin, [0, -0.162, 0], 0.05);
    const mount = grp(sh, [0, -0.162, 0]);
    return { sh, mount };
  };
  const armL = mkArm(1);
  const armR = mkArm(-1);

  // ── weapons (right hand = −X side) ──
  const holder = grp(armR.mount);
  const wood = M.get(PAL.woodDark);
  const sword = grp(holder, undefined, undefined, 'sword');
  part(sword, bladeGeo(), M.get(PAL.woodBlade), [0, 0, 0.05]);
  part(sword, cached('hero-hilt', () => merge([
    { g: G.capsule(0.019, 0.1), p: [0, 0, 0.045], r: [0, 0, Math.PI / 2] },
    { g: G.cyl(), p: [0, 0, -0.01], s: [0.017, 0.1, 0.017], r: [Math.PI / 2, 0, 0] },
    { g: G.ball(), p: [0, 0, -0.065], s: 0.025 },
  ])), wood);
  const steel = M.get(PAL.steel);
  const fork = grp(holder, undefined, undefined, 'fork');
  part(fork, cached('hero-fork', () => merge([
    { g: G.cyl(), p: [0, 0, 0.19], s: [0.016, 0.82, 0.016], r: [Math.PI / 2, 0, 0] },
    { g: G.ball(), p: [0, 0, -0.225], s: 0.027 },
    { g: G.ball(), p: [0, 0, 0.6], s: [0.03, 0.03, 0.035] },
    { g: G.capsule(0.022, 0.09), p: [0, 0, 0.635], r: [0, 0, Math.PI / 2] },
    ...[-0.045, 0, 0.045].map((x) => ({ g: G.capsule(0.011, 0.17), p: [x, 0, 0.73] as [number, number, number], r: [Math.PI / 2, 0, 0] as [number, number, number] })),
  ])), steel);
  part(fork, G.cyl(), M.get('#8a5530'), [0, 0, -0.1], [0.021, 0.16, 0.021], [Math.PI / 2, 0, 0]); // grip wrap
  const weaponTip = new THREE.Object3D();
  weaponTip.name = 'weaponTip';
  holder.add(weaponTip);

  // slingshot (left hand, only during 'sling')
  const sling = grp(armL.mount, undefined, undefined, 'sling');
  const slingWood = M.get('#9a6234');
  const tips = [new THREE.Vector3(-0.037, 0.093, 0), new THREE.Vector3(0.037, 0.093, 0)];
  part(sling, cached('hero-sling', () => merge([
    { g: G.cyl(), p: [0, -0.02, 0], s: [0.014, 0.1, 0.014] },
    ...[-1, 1].flatMap((s) => [
      { g: G.cyl(), p: [s * 0.018, 0.058, 0] as [number, number, number], s: [0.012, 0.08, 0.012] as [number, number, number], r: [0, 0, -s * 0.48] as [number, number, number] },
      { g: G.ball(), p: [s * 0.037, 0.093, 0] as [number, number, number], s: 0.015 },
    ]),
  ])), slingWood);
  const bandM = M.get(PAL.scarf);
  const band1 = part(sling, G.cyl(), bandM, undefined, undefined, undefined, { cast: false });
  const band2 = part(sling, G.cyl(), bandM, undefined, undefined, undefined, { cast: false });
  const pouch = part(sling, G.ball(), M.get('#7a3a2a'), [0, 0.09, -0.03], [0.022, 0.016, 0.014]);
  sling.visible = false;

  // ── scarf ──
  part(body, cached('hero-scarf', () => merge([
    { g: G.torus(0.108, 0.043, 10, 28), p: [0, 0.468, 0], s: [1, 1, 1.15], r: [Math.PI / 2 - 0.08, 0, 0.05] },
    { g: G.sphere(), p: [-0.075, 0.445, 0.085], s: [0.04, 0.038, 0.032] },
  ])), scarfM);
  const tails: THREE.Group[][] = [];
  const tailRoots: THREE.Group[] = [];
  const mkTail = (x: number, n: number, w: number) => {
    let parent: THREE.Object3D = grp(body, [x, 0.462, -0.105]);
    tailRoots.push(parent as THREE.Group);
    const segs: THREE.Group[] = [];
    for (let i = 0; i < n; i++) {
      const piv = grp(parent, i === 0 ? [0, 0, 0] : [0, -0.088, 0]);
      part(piv, G.sphere(), scarfM, [0, -0.046, 0], [w * (1 - i * 0.06), 0.058, 0.014]);
      segs.push(piv);
      parent = piv;
    }
    // fringe at the end
    part(parent, cached(`hero-fringe-${w}`, () => merge([
      { g: G.capsule(0.006, 0.02), p: [-w * 0.5, -0.1, 0] },
      { g: G.capsule(0.006, 0.02), p: [0, -0.103, 0] },
      { g: G.capsule(0.006, 0.02), p: [w * 0.5, -0.1, 0] },
    ])), fringeM);
    tails.push(segs);
  };
  mkTail(0.035, 3, 0.036);
  mkTail(-0.03, 2, 0.033);

  // ── head ──
  const R = 0.26;
  const head = grp(body, [0, 0.72, 0], undefined, 'head');
  head.rotation.order = 'YXZ';
  part(head, G.sphere(), skin, undefined, R);
  for (const s of [-1, 1]) part(head, G.sphere(), skin, [s * 0.252, -0.06, -0.01], [0.04, 0.055, 0.04]);

  // face: eyes
  const faceOpts = { cast: false };
  interface Eye { g: THREE.Group; oval: THREE.Mesh; glint: THREE.Mesh; sclera: THREE.Mesh; happy: THREE.Mesh; closed: THREE.Mesh; chev: THREE.Mesh; brow: THREE.Mesh; browG: THREE.Group }
  const eyes: Eye[] = [];
  for (const s of [1, -1]) {
    const g = surf(head, s * 0.36, -0.33, R * 0.99);
    const sclera = part(g, G.ball(), white, [0, 0, 0.002], [0.056, 0.072, 0.02], undefined, faceOpts);
    const oval = part(g, G.ball(), black, [0, 0, 0.006], [0.044, 0.064, 0.022], undefined, faceOpts);
    const glint = part(g, G.ball(), white, [0.013, 0.024, 0.024], 0.013, undefined, faceOpts);
    const happy = part(g, G.arc(0.033, 0.011, Math.PI), black, [0, -0.014, 0.01], [1, 1, 0.6], undefined, faceOpts);
    const closed = part(g, G.capsule(0.01, 0.046), black, [0, -0.012, 0.012], 1, [0, 0, Math.PI / 2], faceOpts);
    // '>' on the −X eye, '<' on the +X eye (they point toward each other)
    const dir = s > 0 ? -1 : 1;
    const chev = part(g, cached(`hero-chev${dir}`, () => merge([
      { g: G.capsule(0.0095, 0.034), p: [0, 0.013, 0], r: [0, 0, dir * -0.55 - Math.PI / 2] },
      { g: G.capsule(0.0095, 0.034), p: [0, -0.013, 0], r: [0, 0, dir * 0.55 - Math.PI / 2] },
    ])), black, [0, 0, 0.012], 1, undefined, faceOpts);
    const browG = surf(head, s * 0.37, -0.02, 0.305);
    const brow = part(browG, G.capsule(0.013, 0.05), M.get('#5a3322'), undefined, 1, [0, 0, Math.PI / 2], faceOpts);
    eyes.push({ g, oval, glint, sclera, happy, closed, chev, brow, browG });
  }
  // nose, cheeks
  part(surf(head, 0, -0.47, R * 0.985), G.ball(), M.get(PAL.skinD), undefined, [0.024, 0.02, 0.018], undefined, faceOpts);
  const cheeks: THREE.Mesh[] = [];
  for (const s of [-1, 1]) cheeks.push(part(surf(head, s * 0.62, -0.5, R * 0.985), G.ball(), cheekM, undefined, [0.042, 0.026, 0.01], undefined, faceOpts));
  // mouth
  const mouth = surf(head, 0, -0.66, R * 0.985);
  const smile = part(mouth, G.arc(0.034, 0.0085, Math.PI), black, [0, 0.018, 0.004], [1, 1, 0.6], [0, 0, Math.PI], faceOpts);
  const frown = part(mouth, G.arc(0.026, 0.0085, Math.PI), black, [0, -0.022, 0.004], [1, 1, 0.6], undefined, faceOpts);
  const open = part(mouth, G.ball(), mouthDark, [0, -0.004, 0.002], [0.042, 0.03, 0.018], undefined, faceOpts);
  const tongue = part(mouth, G.ball(), tongueM, [0, -0.02, 0.012], [0.024, 0.011, 0.01], undefined, faceOpts);

  // ───────────────────────── hats (built on first use) ─────────────────────────
  const hats: Partial<Record<HatKind, THREE.Group>> = {};
  let pomPivot: THREE.Group | null = null;
  let pom: THREE.Mesh | null = null;
  let pomFirst = true;
  interface Ear { base: THREE.Group; piv: THREE.Group; tip: THREE.Group; side: number; fold: THREE.Quaternion; p: THREE.Vector3; v: THREE.Vector3; first: boolean }
  const ears: Ear[] = [];

  const buildHat = (kind: HatKind): THREE.Group => {
    switch (kind) {
      case 'beanie': {
        const g = grp(head, [0, 0.026, -0.006], [-0.06, 0, 0.045]);
        beanieM = M.own('#ffffff', { map: ribTex(PAL.beanie, '#f07a1c', 28) });
        beanieBandM = M.own('#ffffff', { map: ribTex(PAL.band, '#c9551a', 22) });
        part(g, G.dome(), beanieM, undefined, [0.273, 0.3, 0.273]);
        part(g, G.torus(0.268, 0.045, 12, 40), beanieBandM, [0, 0.008, 0], [1, 1, 1.3], [Math.PI / 2, 0, 0]);
        pomPivot = grp(g, [0, 0.29, 0]);
        pom = part(pomPivot, pomGeo(), M.get(PAL.pom), [0, 0.06, 0], 0.075);
        return g;
      }
      case 'cap': {
        const g = grp(head, [0, 0.022, -0.004], [-0.05, 0, 0]);
        part(g, G.dome(), hatM, undefined, [0.276, 0.272, 0.282]);
        part(g, G.ball(), hatDarkM, [0, 0.27, 0], [0.034, 0.02, 0.034]);
        part(g, capBrimGeo(), hatDarkM, [0, 0.018, 0], 1, [0.12, 0, 0], { cast: false }); // no shadow: keep the face bright
        const logo = surf(g, 0, 0.5, 0.262);
        part(logo, G.ball(), M.get('#ffffff'), undefined, [0.06, 0.06, 0.014], undefined, faceOpts);
        part(logo, starGeo(), goldM, [0, 0.002, 0.012], [0.075, 0.075, 0.07], undefined, faceOpts);
        return g;
      }
      case 'crown': {
        const g = grp(head, [0.02, 0.19, -0.01], [-0.12, 0, -0.14]);
        g.scale.setScalar(1.1);
        part(g, G.sphere(), hatM, [0, 0.028, 0], [0.188, 0.105, 0.188]);
        part(g, crownBandGeo(), goldM);
        part(g, G.torus(0.205, 0.017, 8, 40), goldM, [0, -0.05, 0], 1, [Math.PI / 2, 0, 0]);
        part(g, crownSpikesGeo(), goldM);
        part(g, crownGemsGeo(), hatM);
        part(g, G.ball(), goldM, [0, 0.14, 0], 0.03);
        return g;
      }
      case 'pirate': {
        const g = grp(head, [0, 0.05, -0.01], [-0.08, 0, 0.05]);
        part(g, G.dome(), hatM, undefined, [0.27, 0.24, 0.27]);
        part(g, G.torus(0.268, 0.022, 10, 40), hatDarkM, [0, 0.014, 0], 1, [Math.PI / 2, 0, 0]);
        part(g, pirateBrimGeo(), hatM);
        part(g, pirateTrimGeo(), goldM);
        // skull & crossbones on the front flap (tilted with the flap)
        const sk = grp(g, [0, 0.1, 0.322 + 0.35 * 0.1 + 0.012], [Math.atan(0.35), 0, 0]);
        const bone = M.get('#fff6e0');
        part(sk, crossbonesGeo(), bone, [0, -0.006, -0.006], 1, undefined, faceOpts);
        part(sk, G.ball(), bone, [0, 0.008, 0], [0.042, 0.038, 0.02], undefined, faceOpts);
        part(sk, G.ball(), bone, [0, -0.024, 0], [0.026, 0.018, 0.016], undefined, faceOpts);
        for (const s of [-1, 1]) part(sk, G.ball(), black, [s * 0.015, 0.006, 0.017], [0.011, 0.012, 0.006], undefined, faceOpts);
        part(sk, G.ball(), black, [0, -0.01, 0.018], [0.005, 0.006, 0.004], undefined, faceOpts);
        return g;
      }
      case 'bunny': {
        const g = grp(head, [0, 0, -0.02], [-0.18, 0, 0]);
        part(g, G.arc(0.286, 0.02, Math.PI), hatDarkM, undefined, [1, 1, 1.25]);
        const pink = M.get('#ffb3c6');
        for (const s of [1, -1]) {
          const a = 0.42;
          const base = grp(g, [s * Math.sin(a) * 0.286, Math.cos(a) * 0.286, 0], [-0.12, 0, -s * 0.28]);
          part(base, G.sphere(), hatM, [0, 0.01, 0], [0.05, 0.03, 0.04]);
          const piv = grp(base);
          part(piv, G.sphere(), hatM, [0, 0.13, 0], [0.062, 0.145, 0.035]);
          part(piv, G.sphere(), pink, [0, 0.13, 0.021], [0.038, 0.11, 0.02], undefined, faceOpts);
          const tip = grp(piv, [0, 0.25, 0]);
          part(tip, G.sphere(), hatM, [0, 0.08, 0], [0.056, 0.105, 0.032]);
          part(tip, G.sphere(), pink, [0, 0.075, 0.018], [0.034, 0.078, 0.018], undefined, faceOpts);
          // the right ear (−X) is a floppy one
          const fold = new THREE.Quaternion().setFromEuler(new THREE.Euler(s > 0 ? 0.15 : 1.5, 0, s > 0 ? 0 : 0.35));
          ears.push({ base, piv, tip, side: s, fold, p: new THREE.Vector3(), v: new THREE.Vector3(), first: true });
        }
        return g;
      }
      case 'chef': {
        const g = grp(head, [0, 0.02, -0.01], [-0.1, 0, 0.06]);
        part(g, G.cyl(), hatDarkM, [0, 0.075, 0], [0.272, 0.11, 0.272]);
        part(g, chefGeo(), hatM);
        return g;
      }
      case 'viking': {
        const g = grp(head, [0, 0.015, -0.005], [-0.06, 0, 0]);
        const iron = M.get('#b4bfcc');
        part(g, G.dome(), iron, undefined, [0.282, 0.285, 0.288]);
        part(g, G.torus(0.282, 0.032, 10, 44), hatM, [0, 0.01, 0], [1, 1, 1.0], [Math.PI / 2, 0, 0]);
        part(g, G.arc(0.287, 0.024, Math.PI), hatM, undefined, [1, 0.99, 1], [0, Math.PI / 2, 0]);
        part(g, cached('hero-viking-rivets', () => merge(Array.from({ length: 10 }, (_, i) => {
          const a = ((i + 0.5) / 10) * TAU;
          return { g: G.ball(), p: [Math.sin(a) * 0.312, 0.01, Math.cos(a) * 0.312] as [number, number, number], s: 0.014 };
        }))), goldM);
        const hornM = M.get('#f2e6c8');
        for (const s of [1, -1]) {
          part(g, hornGeo(s), hornM);
          const c = hornCurve(s);
          const collar = part(g, G.cyl(), hatM);
          between(collar, c.getPointAt(0.13), c.getPointAt(0.21), 0.058);
          const ring = part(g, G.cyl(), hatDarkM);
          between(ring, c.getPointAt(0.82), c.getPointAt(0.86), 0.022);
        }
        return g;
      }
      case 'none': return grp(head); // just the hair (see buildHair)
    }
  };

  // hair: a mop with a cowlick when bare-headed; also peeks out under the crown and the bunny headband
  let hair: THREE.Group | null = null;
  let tuft: THREE.Mesh | null = null;
  const buildHair = () => {
    const g = grp(head, undefined, undefined, 'hair');
    const hairM = M.get('#6e4128');
    const cap = grp(g, [0, 0.008, -0.006], [-0.36, 0, 0]);
    part(cap, G.dome(), hairM, undefined, 0.274);
    part(cap, cached('hero-hair-rim', () => merge(Array.from({ length: 13 }, (_, i) => {
      const a = Math.PI * 0.32 + (i / 12) * Math.PI * 1.36; // around the sides & back (the front gets bangs)
      return { g: G.sphere(), p: [Math.sin(a) * 0.262, 0.004, Math.cos(a) * 0.262] as [number, number, number], s: [0.06, 0.05, 0.05] as [number, number, number], r: [0, a, 0] as [number, number, number] };
    }))), hairM);
    part(cap, cached('hero-hair-bangs', () => merge([-0.42, -0.14, 0.14, 0.42].map((a, i) => ({
      g: G.sphere(), p: [Math.sin(a) * 0.262, -0.012 - (i % 2) * 0.008, Math.cos(a) * 0.262] as [number, number, number],
      s: [0.058, 0.045, 0.035] as [number, number, number], r: [0.5, a, (i - 1.5) * 0.25] as [number, number, number],
    })))), hairM);
    tuft = part(g, tuftGeo(), hairM);
    hair = g;
  };

  // ───────────────────────── back items (built on first use) ─────────────────────────
  const backs: Partial<Record<BackKind, THREE.Group>> = {};
  const wingPivots: { yaw: THREE.Group; low: THREE.Group; side: number }[] = [];
  let capeMesh: THREE.Mesh | null = null;
  let capeAnchor: THREE.Group | null = null;

  const buildBack = (kind: BackKind): THREE.Group => {
    const g = grp(body);
    if (kind === 'backpack') {
      const bp = grp(g, [0, 0.31, -0.205]);
      bp.scale.setScalar(1.12);
      part(bp, bpBodyGeo(), backM);
      part(bp, bpFlapGeo(), backDarkM, [0, 0.105, -0.008], 1, [0.14, 0, 0]);
      part(bp, bpPocketGeo(), backDarkM, [0, -0.05, -0.07]);
      part(bp, G.ball(), goldM, [0, 0.072, -0.085], [0.02, 0.024, 0.012]);
      part(bp, G.ball(), goldM, [0, -0.03, -0.097], [0.014, 0.014, 0.008]);
      for (const s of [1, -1]) {
        part(g, G.arc(1, 0.1, Math.PI * 1.3), backDarkM, [s * 0.088, 0.335, -0.005], [0.122, 0.142, 0.3], [0, Math.PI / 2, 0]);
      }
    } else if (kind === 'cape') {
      capeAnchor = grp(g, [0, 0.455, -0.13]);
      const n = CAPE_R * CAPE_C;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
      const idx: number[] = [];
      for (let i = 0; i < CAPE_R - 1; i++) for (let j = 0; j < CAPE_C - 1; j++) {
        const a = i * CAPE_C + j, b = a + 1, c = a + CAPE_C, d = c + 1;
        idx.push(a, b, c, b, d, c); // outer face (away from the back)
      }
      const half = idx.length;
      for (let k = 0; k < half; k += 3) idx.push(idx[k] + n, idx[k + 2] + n, idx[k + 1] + n); // lining (same cloth, reversed)
      geo.setIndex(idx);
      geo.addGroup(0, half, 0);
      geo.addGroup(half, half, 1);
      capeMesh = new THREE.Mesh(geo, [backM, backDarkM]);
      capeMesh.castShadow = true; capeMesh.receiveShadow = true;
      capeMesh.frustumCulled = false;
      capeAnchor.add(capeMesh);
      // little gold clasps where the cape meets the shoulders
      for (const s of [1, -1]) part(g, G.ball(), goldM, [s * 0.125, 0.44, -0.07], 0.02);
    } else if (kind === 'wings') {
      const wg = grp(g, [0, 0.4, -0.125]);
      wg.scale.setScalar(1.3);
      for (const s of [1, -1]) {
        const yaw = grp(wg, [s * 0.025, 0, 0]);
        const up = grp(yaw, undefined, [0, 0, 0.32]);
        part(up, wingGeo(true), backM);
        part(up, wingPanelGeo(true), backLightM);
        const low = grp(yaw, [0, -0.01, 0]);
        const lowT = grp(low, undefined, [0, 0, -0.1]);
        part(lowT, wingGeo(false), backM);
        part(lowT, wingPanelGeo(false), backLightM);
        wingPivots.push({ yaw, low, side: s });
      }
    }
    return g;
  };

  // ── swing trail (no outline, in the lean frame so it doesn't twist with the body) ──
  const trailTex = canvasTex(256, 16, (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const v = y / (h - 1);
      for (let x = 0; x < w; x++) {
        const u = x / (w - 1);
        let a = u <= 0.5 ? smooth((u - 0.1) / 0.4) : u < 0.515 ? 1 - (u - 0.5) / 0.015 : 0;
        a *= Math.pow(v, 1.6) * (1 - 0.35 * Math.pow(v, 8));
        const k = (y * w + x) * 4;
        img.data[k] = 255; img.data[k + 1] = 255; img.data[k + 2] = 255; img.data[k + 3] = Math.round(clamp(a) * 255);
      }
    }
    g.putImageData(img, 0, 0);
  });
  trailTex.repeat.set(0.5, 1);
  const trailMat = basic('#ffffff', { transparent: true, map: trailTex, side: THREE.DoubleSide, depthWrite: false });
  const trailGeos = {
    sword: cached('hero-trail-r2l', () => arcRibbon(0.4, 0.88, -2.4, 1.85, 48)),
    swordAlt: cached('hero-trail-l2r', () => arcRibbon(0.4, 0.88, 1.6, -2.2, 48)),
    spin: cached('hero-trail-spin', () => arcRibbon(0.4, 0.9, -1.3, -1.3 + TAU, 80)),
  };
  const trail = new THREE.Mesh(trailGeos.sword, trailMat);
  trail.position.y = SHOULDER_Y;
  trail.renderOrder = 5;
  trail.visible = false;
  leanG.add(noOutline(trail));

  // ───────────────────────── look ─────────────────────────
  let cur: HeroLook = { ...L0 };
  function setLook(patch: Partial<HeroLook>) {
    const l = sanitizeLook(patch, cur);
    cur = l;
    hatM.color.set(l.hatColor);
    hatDarkM.color.set(darker(l.hatColor));
    scarfM.color.set(l.scarfColor);
    fringeM.color.set(derive(l.scarfColor, PAL.scarf, '#c4262c'));
    shirt.color.set(l.shirtColor);
    shortsM.color.set(l.shortsColor);
    bootM.color.set(l.bootColor);
    cuffM.color.set(derive(l.bootColor, PAL.boot, '#6a4535'));
    backM.color.set(l.backColor);
    backDarkM.color.set(darker(l.backColor));
    backLightM.color.set(lighter(l.backColor));
    if (!hats[l.hat]) hats[l.hat] = buildHat(l.hat);
    for (const k of HAT_KINDS) { const h = hats[k]; if (h) vis(h, k === l.hat); }
    const hairOn = l.hat === 'none' || l.hat === 'crown' || l.hat === 'bunny';
    if (hairOn && !hair) buildHair();
    if (hair) vis(hair, hairOn);
    if (tuft) vis(tuft, l.hat === 'none');
    if (l.hat === 'beanie' && beanieM && beanieBandM) {
      const c = l.hatColor;
      beanieM.map = ribTex(c, derive(c, PAL.beanie, '#f07a1c'), 28);
      beanieBandM.map = ribTex(darker(c), derive(c, PAL.beanie, '#c9551a'), 22);
      pomFirst = true;
    }
    if (l.hat === 'bunny') for (const e of ears) e.first = true;
    if (l.back !== 'none' && !backs[l.back]) backs[l.back] = buildBack(l.back);
    for (const k of BACK_KINDS) { const b = backs[k]; if (b) vis(b, k === l.back); }
    // the scarf tails would poke through a backpack / cape
    const tailsOn = l.back === 'none' || l.back === 'wings';
    for (const r of tailRoots) vis(r, tailsOn);
  }

  // ── state ──
  const C = newPose();
  const T = newPose();
  const A = newPose();
  const blinker = new Blinker();
  let t = 0;
  let phase = 0;
  let spinCur = 0;
  let tumbleCur = 0;
  let first = true;
  /** time in the current state (emote loops) */
  let stT = 0;
  let lastSt: HeroState = 'idle';
  const pomPos = new THREE.Vector3();
  const pomVel = new THREE.Vector3();
  const tmpA = new THREE.Vector3();
  const tmpO = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const qId = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);
  const pouchP = new THREE.Vector3();
  let pouchZ = 0;
  // accessories
  const rootPos = new THREE.Vector3();
  const rootPrev = new THREE.Vector3();
  const rootVel = new THREE.Vector3();
  const capeP = new THREE.Vector3();
  const capeV = new THREE.Vector3();
  const capeRest = new THREE.Vector3();
  const capeRestPrev = new THREE.Vector3();
  let capeFirst = true;
  let capeA = 0.1, capeB = 0;
  let capePh = 0;
  let wingPh = 0, wingRate = 3, wingAmp = 0.1, wingBase = 0.38;

  /** spring point mass toward `rest` (world space); returns nothing, mutates p/v */
  function spring(p: THREE.Vector3, v: THREE.Vector3, rest: THREE.Vector3, dt: number, k: number, d: number, g: number, maxOff: number, restVel?: THREE.Vector3) {
    const steps = dt > 0.02 ? 2 : 1;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      tmpO.subVectors(rest, p).multiplyScalar(k);
      if (restVel) tmpB.subVectors(v, restVel); else tmpB.copy(v);
      tmpO.addScaledVector(tmpB, -d);
      tmpO.y -= g;
      v.addScaledVector(tmpO, h);
      if (v.lengthSq() > 900) v.setLength(30);
      p.addScaledVector(v, h);
    }
    tmpO.subVectors(p, rest);
    if (tmpO.length() > maxOff) { tmpO.setLength(maxOff); p.copy(rest).add(tmpO); }
  }

  function updateEars(dt: number) {
    for (const e of ears) {
      e.base.updateMatrixWorld();
      // rest tip (with a little idle wiggle) in world space
      tmpA.set(Math.sin(t * 2.1 + e.side) * 0.02, 0.34, Math.sin(t * 1.7 + e.side * 2) * 0.015);
      e.base.localToWorld(tmpA);
      e.base.getWorldPosition(tmpB);
      const Lw = tmpA.distanceTo(tmpB);
      if (e.first) { e.p.copy(tmpA); e.v.set(0, 0, 0); e.first = false; }
      spring(e.p, e.v, tmpA, dt, 140, 5, 1.6 * Lw / 0.34, Lw * 0.7);
      tmpB.copy(e.p);
      e.base.worldToLocal(tmpB);
      if (tmpB.lengthSq() < 1e-8) continue;
      tmpB.normalize();
      e.piv.quaternion.setFromUnitVectors(UP, tmpB);
      // the tip whips further in the same direction (+ its rest fold)
      tmpQ.copy(qId).slerp(e.piv.quaternion, 0.7);
      e.tip.quaternion.copy(tmpQ).multiply(e.fold);
    }
  }

  function updateCape(dt: number, st: HeroState) {
    if (!capeMesh || !capeAnchor) return;
    capeAnchor.updateMatrixWorld();
    // secondary motion: a point mass that lags behind accelerations (not constant speed)
    capeRest.set(0, -CAPE_L, -0.05);
    capeAnchor.localToWorld(capeRest);
    if (capeFirst) { capeP.copy(capeRest); capeV.set(0, 0, 0); capeRestPrev.copy(capeRest); capeFirst = false; }
    tmpA.subVectors(capeRest, capeRestPrev).divideScalar(Math.max(dt, 1e-4));
    if (tmpA.lengthSq() > 900) tmpA.setLength(30);
    capeRestPrev.copy(capeRest);
    spring(capeP, capeV, capeRest, dt, 90, 7, 0, CAPE_L * 0.8, tmpA);
    tmpB.copy(capeP);
    capeAnchor.worldToLocal(tmpB);
    const dA = Math.atan2(-tmpB.z, -tmpB.y) - Math.atan2(0.05, CAPE_L);
    const dB = Math.atan2(tmpB.x, -tmpB.y);
    // base lift from speed (pose 'scarf' already encodes run / dash / fall) and from falling
    const fallLift = clamp(-rootVel.y * 0.08, -0.25, 0.9);
    const lying = st === 'dead' || st === 'sit' || st === 'downed';
    const base = lying ? 0.05 : 0.08 + 0.36 * Math.min(C.scarf, 2.3) + fallLift;
    capeA = damp(capeA, clamp(base + dA, 0.03, 2.3), 14, dt);
    capeB = damp(capeB, clamp(dB, -0.6, 0.6), 14, dt);
    const spd = clamp(Math.max(C.scarf / 1.6, Math.hypot(rootVel.x, rootVel.z) / 7.6, Math.abs(rootVel.y) / 8));
    capePh += dt * (5 + 9 * spd);
    const amp = (lying ? 0.01 : 0.05) + 0.24 * spd;
    const pos = (capeMesh.geometry.attributes.position as THREE.BufferAttribute);
    const arr = pos.array as Float32Array;
    const n = CAPE_R * CAPE_C;
    const segL = CAPE_L / (CAPE_R - 1);
    for (let j = 0; j < CAPE_C; j++) {
      const u = j / (CAPE_C - 1), su = 2 * u - 1;
      let y = 0, z = 0;
      for (let i = 0; i < CAPE_R; i++) {
        const v = i / (CAPE_R - 1);
        if (i > 0) {
          const a = capeA * (0.3 + 0.95 * v) + amp * v * Math.sin(capePh - v * 4.5 + su * 1.6);
          y -= segL * Math.cos(a); z -= segL * Math.sin(a);
        }
        const down = -y;
        const x = su * lerp(0.15, 0.215, v) + Math.sin(capeB) * down * 0.8;
        const zz = z + 0.1 * su * su * (1 - v) * (1 - v) - 0.022 * (1 - su * su) + amp * 0.12 * v * Math.sin(capePh * 1.3 - v * 3 + su * 5);
        const k = (i * CAPE_C + j) * 3;
        arr[k] = x; arr[k + 1] = y; arr[k + 2] = zz;
        arr[k + n * 3] = x; arr[k + n * 3 + 1] = y; arr[k + n * 3 + 2] = zz;
      }
    }
    pos.needsUpdate = true;
    capeMesh.geometry.computeVertexNormals();
  }

  function updateWings(dt: number, st: HeroState) {
    if (!wingPivots.length) return;
    let r = 3.2, a = 0.1, b = 0.38;
    if (st === 'jump' || st === 'fall' || st === 'tumble' || st === 'grabbed') { r = 26; a = 0.55; b = 0.62; }
    else if (st === 'dash') { r = 30; a = 0.35; b = 0.9; }
    else if (st === 'cheer') { r = 16; a = 0.42; b = 0.55; }
    else if (st === 'run') { r = 9; a = 0.2; b = 0.55; }
    else if (st === 'dead' || st === 'sit' || st === 'downed') { r = 1.5; a = 0.03; b = 1.15; }
    if (Math.abs(rootVel.y) > 2 && st !== 'dead') { r = Math.max(r, 24); a = Math.max(a, 0.5); }
    wingRate = damp(wingRate, r, 8, dt);
    wingAmp = damp(wingAmp, a, 8, dt);
    wingBase = damp(wingBase, b, 8, dt);
    wingPh += dt * wingRate;
    const th = wingBase + wingAmp * Math.sin(wingPh);
    const lag = wingAmp * 0.45 * Math.sin(wingPh - 0.9);
    for (const w of wingPivots) {
      w.yaw.rotation.y = w.side > 0 ? th : Math.PI - th;
      w.low.rotation.y = lag;
    }
  }

  function update(dt: number, a: HeroAnim) {
    dt = Math.min(dt, 0.1);
    t += dt;
    const st = a.state;
    const sp = clamp(a.speed, 0, 1);
    const atk = a.attack;
    const ak = atk ? atk.kind : null;
    const ap = atk ? clamp(atk.p) : 0;

    // which weapon is shown
    let shown: 'sword' | 'fork' | 'none' = a.weapon;
    if (ak === 'fork') shown = 'fork';
    else if ((ak === 'sword' || ak === 'swordAlt' || ak === 'spin') && shown === 'none') shown = 'sword';
    else if (ak === 'sling') shown = 'none';

    // cycle phase
    if (st === 'run') phase += dt * (7 + 7 * sp);
    else if (st === 'walk') phase += dt * (5 + 5 * sp);
    else if (st === 'sneak') phase += dt * (4 + 4 * sp);
    else if (st === 'downed') phase += dt * (1.2 + 40 * sp);
    else phase += dt * 6;
    if (st !== lastSt) { lastSt = st; stT = 0; } else stT += dt;
    const s = Math.sin(phase);

    // ── base pose ──
    for (const k of KEYS) T[k] = 0;
    T.aLr = 0.16; T.aRr = -0.16; T.aRp = -0.3; T.aLp = 0.04;
    T.blade = shown === 'fork' ? -1.42 : -0.85;
    T.scarf = 0.12;
    const breathe = Math.sin(t * 2.4);
    switch (st) {
      case 'idle':
        T.bodyY = 0.004 * breathe; T.aLr += 0.03 * breathe; T.aRr -= 0.03 * breathe;
        T.headX = 0.025 * breathe; T.headZ = 0.035 * Math.sin(t * 0.8);
        break;
      case 'run': case 'walk': {
        const run = st === 'run';
        const amp = run ? 0.8 + 0.35 * sp : 0.45 + 0.25 * sp;
        T.hipL = -s * amp; T.hipR = s * amp;
        const K = run ? 1.5 : 0.65;
        T.kneeL = 0.1 + K * Math.max(0, Math.cos(phase + 0.3));
        T.kneeR = 0.1 + K * Math.max(0, Math.cos(phase + Math.PI + 0.3));
        const aa = run ? 0.95 : 0.5;
        T.aLp = s * aa; T.aRp = -s * aa - 0.35;
        T.aLr = run ? 0.3 : 0.18; T.aRr = run ? -0.3 : -0.18;
        T.bodyY = (run ? 0.045 * (0.5 + sp) : 0.016) * s * s - (run ? 0.012 : 0);
        T.leanX = run ? 0.1 + 0.2 * sp : 0.05;
        T.leanZ = Math.cos(phase) * (run ? 0.035 : 0.025);
        T.headX = -T.leanX * 0.6; T.headZ = -T.leanZ * 0.6;
        T.scarf = run ? 0.6 + 0.7 * sp : 0.3;
        T.blade = shown === 'fork' ? -0.75 : -1.2;
        break;
      }
      case 'sneak':
        T.bodyY = -0.045;
        T.hipL = -0.85 - s * 0.28; T.hipR = -0.85 + s * 0.28;
        T.kneeL = 1.45 + Math.max(0, Math.cos(phase + 0.3)) * 0.45; T.kneeR = 1.45 + Math.max(0, Math.cos(phase + Math.PI + 0.3)) * 0.45;
        T.leanX = 0.3; T.leanZ = Math.sin(phase) * 0.06;
        T.aLp = -1.15; T.aLr = 0.3; T.aLy = -0.35; T.aRp = -1.0; T.aRr = -0.3; T.aRy = 0.3;
        T.headX = -0.3; T.blade = -0.25;
        break;
      case 'jump':
        T.hipL = -1.05; T.kneeL = 1.75; T.hipR = -0.4; T.kneeR = 1.05;
        T.aLp = -2.3; T.aLr = 0.35; T.aRp = -2.1; T.aRr = -0.35;
        T.blade = -1.3; T.scarf = 0.35; T.headX = -0.1;
        break;
      case 'fall': {
        const f = Math.sin(t * 13) * 0.18;
        T.aLp = -2.6 + f; T.aLr = 0.65; T.aRp = -2.6 - f; T.aRr = -0.65;
        T.hipL = -0.35; T.kneeL = 0.55; T.hipR = 0.15; T.kneeR = 0.35; T.splay = 0.12;
        T.scarf = 2.5; T.blade = -1.6;
        break;
      }
      case 'dash':
        T.leanX = 0.62; T.bodyY = -0.02;
        T.aLp = 1.3; T.aLr = 0.35; T.aRp = 1.2; T.aRr = -0.35;
        T.blade = shown === 'fork' ? -3.0 : -2.75;
        T.hipL = -0.95; T.kneeL = 0.95; T.hipR = 0.65; T.kneeR = 0.6;
        T.headX = -0.5; T.scarf = 2.1;
        break;
      case 'hurt':
        T.leanX = -0.42; T.bodyZ = -0.04;
        T.aLp = -1.55; T.aLr = 0.75; T.aRp = -1.35; T.aRr = -0.75;
        T.hipL = -0.65; T.kneeL = 0.95; T.hipR = 0.1; T.kneeR = 0.2;
        T.headX = -0.3; T.scarf = 0.9; T.blade = -1.6;
        break;
      case 'grabbed': {
        const k = Math.sin(t * 22), k2 = Math.sin(t * 18);
        T.aLp = -2.55 + k * 0.6; T.aLr = 0.55; T.aRp = -2.55 - k * 0.6; T.aRr = -0.55;
        T.hipL = -0.5 + k2 * 0.65; T.kneeL = 0.8 + k2 * 0.3; T.hipR = -0.5 - k2 * 0.65; T.kneeR = 0.8 - k2 * 0.3;
        T.tiltZ = Math.sin(t * 13) * 0.14; T.headZ = Math.sin(t * 9) * 0.16; T.scarf = 0.8;
        break;
      }
      case 'dead':
        T.tiltX = -Math.PI / 2; T.tiltH = 0.2 - CY;
        T.aLp = -0.2; T.aLr = 1.35; T.aRp = -0.3; T.aRr = -1.35; T.splay = 0.28;
        T.headY = 0.35; T.headZ = 0.12; T.scarf = 0.0; T.blade = 1.45;
        break;
      case 'sit':
        T.bodyY = -0.1; T.hipL = -1.45; T.hipR = -1.4; T.kneeL = 0.25; T.kneeR = 0.32; T.splay = 0.12;
        T.aLp = -0.5; T.aLr = 0.32; T.aRp = -0.55; T.aRr = -0.32; T.leanX = -0.08;
        T.blade = -0.95; T.scarf = 0.05; T.headX = 0.02 * breathe;
        break;
      case 'cheer': {
        const h = Math.abs(Math.sin(t * 7));
        const w = Math.sin(t * 10) * 0.18;
        T.aLp = -0.3; T.aLr = 2.6 + w; T.aRp = -0.3; T.aRr = -2.6 + w;
        T.bodyY = h * 0.075; T.kneeL = T.kneeR = (1 - h) * 0.5; T.hipL = T.hipR = -(1 - h) * 0.25;
        T.blade = -1.45; T.headX = -0.15; T.scarf = 0.4 + h * 0.4;
        break;
      }
      case 'lookUp':
        T.headX = -0.6; T.leanX = -0.08; T.aLp = 0.25; T.aRp = 0.1; T.bodyY = 0.004 * breathe;
        break;
      case 'tumble': {
        const f = Math.sin(t * 15) * 0.4;
        T.aLp = -2.4 + f; T.aLr = 1.0; T.aRp = -2.4 - f; T.aRr = -1.0;
        T.hipL = -0.6; T.kneeL = 1.0; T.hipR = 0.4; T.kneeR = 0.6; T.splay = 0.35;
        T.scarf = 2.0; T.blade = -1.5;
        break;
      }
      // ── co-op emotes ──
      case 'wave': {
        // the free (left) hand high up, waving; a little hop on the spot
        const w2 = Math.sin(t * 11);
        T.aLr = 2.45 + w2 * 0.38; T.aLp = -0.2; T.aLy = 0.15;
        T.aRp = -0.15; T.aRr = -0.22; T.blade = -1.1;
        T.leanZ = -0.05 + w2 * 0.025; T.headZ = 0.14; T.headX = -0.08;
        T.bodyY = Math.max(0, Math.sin(t * 5.5)) * 0.02 + 0.004 * breathe;
        T.scarf = 0.25;
        break;
      }
      case 'dance': {
        const b = t * 7.5, half = Math.sin(b / 2), bounce = Math.abs(Math.sin(b));
        T.bodyY = bounce * 0.055;
        T.kneeL = 0.12 + (1 - bounce) * 0.42 + Math.max(0, half) * 0.5; T.kneeR = 0.12 + (1 - bounce) * 0.42 + Math.max(0, -half) * 0.5;
        T.hipL = -(1 - bounce) * 0.22 - Math.max(0, half) * 0.4; T.hipR = -(1 - bounce) * 0.22 - Math.max(0, -half) * 0.4;
        T.leanZ = half * 0.13; T.twist = half * 0.45;
        T.aLr = 1.55 + half * 0.95; T.aLp = -0.35 + Math.sin(b) * 0.25;
        T.aRr = -1.55 + half * 0.95; T.aRp = -0.35 - Math.sin(b) * 0.25;
        T.headZ = -half * 0.18; T.headX = -0.06 + Math.sin(b) * 0.07;
        T.blade = -1.45; T.scarf = 0.45 + bounce * 0.4;
        break;
      }
      case 'bow': {
        // a deep theatrical bow: dip, hold, straighten, a short pause — repeated
        const c = stT % 2.1;
        const k = smooth(seg(c, 0.05, 0.45)) * (1 - smooth(seg(c, 1.15, 1.55)));
        T.leanX = 0.62 * k; T.bodyZ = -0.06 * k; T.bodyY = -0.015 * k;
        T.hipL = 0.62 * k; T.hipR = 0.62 * k; T.kneeL = 0.08 * k; T.kneeR = 0.08 * k;
        T.aRp = -0.3 - 0.75 * k; T.aRy = 0.55 * k; T.aRr = -0.16 + 0.12 * k; // sword hand to the chest
        T.aLp = 0.04 + 1.0 * k; T.aLr = 0.16 + 0.25 * k; // free hand flourishes behind
        T.headX = 0.32 * k; T.blade = -0.6;
        T.scarf = 0.12 + 0.5 * k;
        break;
      }
      case 'facepalm': {
        // the free hand on the face, the head shakes slowly
        const k = smooth(seg(stT, 0, 0.25));
        T.aLp = -2.05 * k + 0.04 * (1 - k); T.aLy = -0.62 * k; T.aLr = 0.16 + 0.42 * k;
        T.aRp = -0.15; T.aRr = -0.2; T.blade = -1.0;
        T.headX = 0.36 * k; T.headY = Math.sin(t * 3.2) * 0.12 * k; T.headZ = 0.06;
        T.leanX = 0.08 * k; T.bodyY = 0.004 * breathe;
        T.scarf = 0.08;
        break;
      }
      case 'downed': {
        // knocked flat on the belly; crawls along (arms reach in turns, legs kick) while moving, else just twitches
        const cs = Math.sin(phase), cc = Math.cos(phase);
        const m = clamp(sp * 6);
        T.tiltX = Math.PI / 2 - 0.12; T.tiltH = 0.2 - CY;
        T.aLp = -2.75 + cs * 0.55 * m - 0.08 * breathe; T.aLr = 0.45; T.aRp = -2.75 - cs * 0.55 * m - 0.08 * breathe; T.aRr = -0.45;
        T.hipL = 0.15 + cs * 0.35 * m; T.hipR = 0.15 - cs * 0.35 * m;
        T.kneeL = 0.5 + Math.max(0, cc) * 0.7 * m; T.kneeR = 0.5 + Math.max(0, -cc) * 0.7 * m;
        T.splay = 0.16; T.leanZ = cs * 0.05 * m;
        T.headX = -0.75; T.headZ = Math.sin(t * 1.7) * 0.08;
        T.blade = 0.9; T.scarf = 0.05;
        break;
      }
    }

    // ── attack override ──
    let w = 0;
    let spinTarget = 0;
    let trailOn = false;
    let trailH = 0;
    let trailO = 0;
    let slingPull = 0;
    if (atk) {
      for (const k of KEYS) A[k] = T[k];
      A.leanZ = 0; A.tiltZ = 0;
      if (ak === 'sword' || ak === 'swordAlt') {
        const alt = ak === 'swordAlt';
        const wind = smooth(seg(ap, 0, 0.16));
        const sweep = easeOut(seg(ap, 0.16, 0.46));
        const y0 = alt ? 1.05 : -1.95, y1 = alt ? -1.65 : 1.35;
        const tw0 = alt ? 0.45 : -0.45, tw1 = alt ? -0.45 : 0.5;
        const yaw = lerp(lerp(alt ? 0.3 : -0.6, y0, wind), y1, sweep);
        const tw = lerp(lerp(0, tw0, wind), tw1, sweep);
        A.aRp = -1.45; A.aRy = yaw; A.aRr = 0; A.blade = 0.06; A.push = 0;
        A.twist = tw; A.leanX = 0.14; A.bodyY = -0.015;
        A.aLp = 0.45; A.aLr = 0.55; A.aLy = 0;
        A.hipL = -0.4; A.kneeL = 0.45; A.hipR = 0.35; A.kneeR = 0.2;
        A.headY = -tw * 0.6; A.headX = -0.08;
        w = 1 - smooth(seg(ap, 0.62, 1));
        const a0 = alt ? 1.6 : -2.4, a1 = alt ? -2.2 : 1.85;
        trailOn = true;
        trailH = clamp((tw + yaw - a0) / (a1 - a0));
        trailO = smooth(seg(ap, 0.13, 0.2)) * (1 - smooth(seg(ap, 0.42, 0.78)));
        trail.geometry = alt ? trailGeos.swordAlt : trailGeos.sword;
      } else if (ak === 'spin') {
        const sp2 = easeInOut(seg(ap, 0.04, 0.84));
        spinTarget = TAU * sp2;
        A.aRp = -1.5; A.aRy = -1.3; A.aRr = 0; A.blade = 0.04;
        A.aLp = -1.4; A.aLy = 1.3; A.aLr = 0;
        A.bodyY = -0.025; A.leanX = 0.06; A.twist = 0;
        A.hipL = -0.35; A.kneeL = 0.55; A.hipR = -0.35; A.kneeR = 0.55; A.splay = 0.18;
        A.headX = -0.05; A.scarf = 1.4;
        w = 1 - smooth(seg(ap, 0.84, 1));
        trailOn = true;
        trailH = sp2;
        trailO = smooth(seg(ap, 0.04, 0.14)) * (1 - smooth(seg(ap, 0.72, 0.98)));
        trail.geometry = trailGeos.spin;
      } else if (ak === 'fork') {
        const pull = smooth(seg(ap, 0, 0.2));
        const thrust = easeOut(seg(ap, 0.2, 0.38));
        A.aRp = lerp(lerp(-0.6, -0.95, pull), -1.55, thrust); A.aRy = 0.18; A.aRr = 0;
        A.blade = 0; A.push = lerp(lerp(0, -0.12, pull), 0.24, thrust);
        A.leanX = lerp(-0.08 * pull, 0.32, thrust); A.bodyZ = thrust * 0.07; A.twist = lerp(-0.25 * pull, 0.15, thrust);
        A.aLp = 0.5; A.aLr = 0.45; A.aLy = 0;
        A.hipL = lerp(-0.2, -0.55, thrust); A.kneeL = 0.5; A.hipR = lerp(0.1, 0.45, thrust); A.kneeR = 0.25;
        A.headX = -0.2; A.scarf = 0.5 + thrust * 0.6;
        w = 1 - smooth(seg(ap, 0.62, 1));
      } else if (ak === 'sling') {
        const draw = smooth(seg(ap, 0.02, 0.55));
        const rel = seg(ap, 0.55, 0.6);
        A.aLp = -1.52; A.aLy = -0.12; A.aLr = 0;
        A.aRp = -1.35 + draw * 0.55; A.aRy = 0.55; A.aRr = 0;
        A.twist = -0.15 * draw; A.leanX = 0.04 - 0.06 * draw; A.headX = -0.06;
        A.hipL = -0.25; A.kneeL = 0.3; A.hipR = 0.2; A.kneeR = 0.15;
        slingPull = draw * (1 - rel);
        w = 1 - smooth(seg(ap, 0.75, 1));
      }
      for (const k of KEYS) T[k] = lerp(T[k], A[k], w);
    }

    // ── smooth toward target ──
    const lam = atk ? 42 : 15;
    if (first) { for (const k of KEYS) C[k] = T[k]; }
    else for (const k of KEYS) C[k] = damp(C[k], T[k], lam, dt);

    // spin & tumble bypass smoothing (continuous rotations)
    if (ak === 'spin') spinCur = spinTarget;
    else spinCur = damp(wrapAngle(spinCur), 0, 14, dt);
    if (st === 'tumble') tumbleCur += dt * 9;
    else tumbleCur = damp(wrapAngle(tumbleCur), 0, 10, dt);

    // ── apply ──
    const sq = Math.max(0.2, a.squash || 1);
    const sx = 1 / Math.sqrt(sq);
    squashG.scale.set(sx, sq, sx);
    leanG.rotation.set(C.leanX, 0, C.leanZ);
    tilt.position.y = CY + C.tiltH;
    tilt.rotation.set(C.tiltX + tumbleCur, 0, C.tiltZ);
    spin.rotation.y = C.twist + spinCur;
    body.position.set(0, -CY + C.bodyY, C.bodyZ);
    legL.hip.rotation.set(C.hipL, 0, C.splay);
    legR.hip.rotation.set(C.hipR, 0, -C.splay);
    legL.knee.rotation.x = C.kneeL;
    legR.knee.rotation.x = C.kneeR;
    armL.sh.rotation.set(C.aLp, C.aLy, C.aLr);
    armR.sh.rotation.set(C.aRp, C.aRy, C.aRr);
    armR.mount.rotation.x = C.blade - C.aRp;
    holder.position.z = C.push;
    head.rotation.set(C.headX, C.headY, C.headZ);

    // weapons
    vis(sword, shown === 'sword');
    vis(fork, shown === 'fork');
    weaponTip.position.set(0, 0, shown === 'sword' ? 0.48 : shown === 'fork' ? 0.83 : 0);
    const slingOn = ak === 'sling';
    vis(sling, slingOn);
    if (slingOn) {
      armL.mount.rotation.set(-C.aLp, 0, 0);
      // band snaps forward with a little overshoot after release
      const targetZ = -0.03 - slingPull * 0.24;
      pouchZ = slingPull > 0 ? targetZ : damp(pouchZ, 0.0, 30, dt);
      pouchP.set(0, 0.09, pouchZ);
      pouch.position.copy(pouchP);
      between(band1, tips[0], pouchP, 0.006);
      between(band2, tips[1], pouchP, 0.006);
    } else {
      armL.mount.rotation.set(0, 0, 0);
      pouchZ = -0.03;
    }

    // scarf tails
    const flutterAmp = 0.06 + 0.22 * clamp(C.scarf / 1.5);
    for (let ti = 0; ti < tails.length; ti++) {
      const segs = tails[ti];
      for (let i = 0; i < segs.length; i++) {
        const f = Math.sin(t * (9 + 6 * clamp(C.scarf)) - i * 1.1 + ti * 1.7) * flutterAmp * (1 + i * 0.4);
        if (i === 0) segs[i].rotation.set(0.22 + C.scarf * 1.05 + f * 0.5, 0, (ti ? -0.12 : 0.12) + f * 0.3);
        else segs[i].rotation.set(f + C.scarf * 0.12, 0, f * 0.4);
      }
    }

    // ── face ──
    let ex: HeroExpr = a.expr;
    if (st === 'hurt' || st === 'dead') ex = 'hurt';
    else if ((st === 'grabbed' || st === 'tumble') && ex === 'normal') ex = 'scared';
    else if (st === 'dash' && ex === 'normal') ex = 'angry';
    else if (st === 'cheer' && ex === 'normal') ex = 'happy';
    else if ((st === 'wave' || st === 'dance' || st === 'bow') && ex === 'normal') ex = 'happy';
    else if (st === 'facepalm' && ex === 'normal') ex = 'sleepy';
    else if (st === 'downed' && ex === 'normal') ex = 'hurt';
    if (atk && ex === 'normal' && ak !== 'sling') ex = 'angry';
    const blink = blinker.update(dt);
    const wide = ex === 'scared' || ex === 'surprised';
    const openEyes = ex === 'normal' || ex === 'angry' || wide;
    for (let i = 0; i < 2; i++) {
      const e = eyes[i];
      const sgn = i === 0 ? 1 : -1;
      vis(e.oval, openEyes); vis(e.glint, openEyes); vis(e.sclera, wide);
      vis(e.happy, ex === 'happy'); vis(e.closed, ex === 'sleepy'); vis(e.chev, ex === 'hurt');
      if (openEyes) {
        const bl = 1 - blink * 0.92;
        if (wide) {
          const tr = ex === 'scared' ? Math.sin(t * 40 + i) * 0.003 : 0;
          e.sclera.scale.set(0.056, 0.074 * bl, 0.02);
          e.oval.scale.set(0.024, 0.033 * bl, 0.022);
          e.oval.position.set(tr, -0.004, 0.012);
          e.glint.position.set(0.008 + tr, 0.008, 0.026); e.glint.scale.setScalar(0.009);
        } else {
          e.oval.scale.set(0.044, (ex === 'angry' ? 0.052 : 0.064) * bl, 0.022);
          e.oval.position.set(0, ex === 'angry' ? -0.006 : 0, 0.006);
          e.glint.position.set(0.013, ex === 'angry' ? 0.014 : 0.024, 0.024); e.glint.scale.setScalar(0.013 * Math.max(0.2, bl));
        }
      }
      const browOn = ex === 'angry' || wide || ex === 'hurt';
      vis(e.brow, browOn);
      if (browOn) {
        let rz = 0, dy = 0;
        if (ex === 'angry') { rz = 0.5 * sgn; dy = -0.012; }
        else if (ex === 'hurt') { rz = -0.35 * sgn; dy = -0.004; }
        else { rz = -0.28 * sgn; dy = ex === 'surprised' ? 0.022 : 0.012; }
        e.brow.rotation.set(0, 0, Math.PI / 2 + rz);
        e.brow.position.set(0, dy, 0);
      }
    }
    for (const c of cheeks) c.scale.set(ex === 'happy' ? 0.05 : 0.042, ex === 'happy' ? 0.03 : 0.026, 0.01);
    const baseOpen = ex === 'happy' ? 0.45 : ex === 'scared' ? 0.45 : ex === 'surprised' ? 0.75 : ex === 'hurt' ? 0.35 : 0;
    const op = Math.max(baseOpen, clamp(a.talk) * 0.95);
    const isOpen = op > 0.08;
    vis(open, isOpen); vis(tongue, isOpen && op > 0.25);
    vis(smile, !isOpen && (ex === 'normal' || ex === 'happy' || ex === 'sleepy'));
    vis(frown, !isOpen && !(ex === 'normal' || ex === 'happy' || ex === 'sleepy'));
    if (isOpen) {
      const wdt = ex === 'surprised' ? 0.03 : ex === 'happy' ? 0.05 : 0.042;
      open.scale.set(wdt, 0.008 + 0.036 * op, 0.018);
      open.position.y = -0.004 - 0.012 * op;
      tongue.position.y = -0.008 - 0.03 * op;
    }
    smile.scale.set(ex === 'sleepy' ? 0.6 : 1, ex === 'sleepy' ? 0.6 : 1, 0.6);

    // ── trail ──
    vis(trail, trailOn && trailO > 0.01);
    if (trail.visible) {
      trailTex.offset.x = 0.5 - 0.5 * trailH;
      trailMat.opacity = trailO * 0.9;
    }

    // ── world-space secondary motion (pompom, ears, cape) ──
    root.updateMatrixWorld(true);
    root.getWorldPosition(rootPos);
    if (first) rootPrev.copy(rootPos);
    tmpA.subVectors(rootPos, rootPrev).divideScalar(Math.max(dt, 1e-4));
    if (tmpA.lengthSq() > 900) tmpA.set(0, 0, 0); // teleport
    rootVel.lerp(tmpA, 1 - Math.exp(-12 * dt));
    rootPrev.copy(rootPos);

    // pompom spring (world-space lag)
    if (pomPivot && pom && cur.hat === 'beanie') {
      pomPivot.getWorldPosition(tmpA);
      if (pomFirst) { pomPos.copy(tmpA); pomVel.set(0, 0, 0); pomFirst = false; }
      const steps = dt > 0.02 ? 2 : 1;
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        tmpO.subVectors(tmpA, pomPos).multiplyScalar(170);
        tmpO.addScaledVector(pomVel, -9);
        tmpO.y -= 1.5; // tiny sag
        pomVel.addScaledVector(tmpO, h);
        pomPos.addScaledVector(pomVel, h);
      }
      tmpO.subVectors(pomPos, tmpA);
      if (tmpO.length() > 0.09) { tmpO.setLength(0.09); pomPos.copy(tmpA).add(tmpO); }
      pomPivot.getWorldQuaternion(tmpQ).invert();
      tmpO.applyQuaternion(tmpQ);
      pom.position.set(tmpO.x, 0.062 + tmpO.y, tmpO.z);
    }
    if (cur.hat === 'bunny') updateEars(dt);
    if (cur.back === 'cape') updateCape(dt, st); else capeFirst = true;
    if (cur.back === 'wings') updateWings(dt, st);

    M.flash(a.flash);
    first = false;
  }

  setLook(L0);

  // own materials (every Mats entry is per rig; rib textures are a shared cache), trail, cape cloth
  function dispose() {
    for (const m of M.all) m.dispose();
    for (const m of [black, white, mouthDark, tongueM, cheekM, trailMat]) m.dispose();
    trailTex.dispose();
    capeMesh?.geometry.dispose();
  }

  return {
    root, update, weaponTip, setLook, dispose,
    get look() { return { ...cur }; },
  };
}

import * as THREE from 'three';
import { basic, canvasTex, noOutline } from '../gfx';
import { G, Mats, TAU, cached, clamp, damp, grp, merge, part, surf, taperedTube, vis } from './kit';
import type { HeroExpr } from './hero';

/*
 * «Мультяшное лицо» — the expressive face shared by the new heroes (Ноки, Пастила, Бублик) and the candy townsfolk.
 * A Hat in Time / Spyro style face built from real 3D pieces (no texture swaps), sitting on a head sphere:
 *  - eyes: a glossy white eyeball bulging out of the head, a painted iris cap (iris colour, darker ring, pupil, two
 *    catch-lights) that darts around (saccades), skin-coloured upper & lower eyelids that really close over the
 *    ball (blinks, half-lids, the ^^ happy crescent, the angry slant) with a lash line on each lid rim, optional
 *    eyeliner wing / lashes;
 *  - brows: thick tapered strokes that act (raise, knit, worry, one cocked brow);
 *  - mouth: closed smile / smirk / frown / flat line, or an open mouth whose top & bottom halves change shape
 *    independently (D-grin, O, gritted teeth, a wince), with upper teeth, a tongue and optional fangs that always
 *    stay INSIDE the mouth shape (a single fang peeks under the closed smile without touching the line);
 *  - blush, a nose.
 * Every expression of HeroExpr is covered; `talk` (0..1) opens the mouth with vowel-like shape changes.
 * Decals use polygon offset and the small inner bits are kept out of the outline pass (no z-fighting / speckles).
 */

export interface ToonFaceOpts {
  /** head sphere radius (the face sits on it) and its centre in head space */
  R: number;
  center?: [number, number, number];
  /** eye centre on the sphere: yaw (± spread) and pitch, half width / half height of the eyeball */
  eyeYaw: number; eyePitch: number; eyeW: number; eyeH: number;
  /** how far the eyeball pokes out (fraction of eyeW, default 0.42) */
  eyeD?: number;
  /** outer corners up (+) / down (−) (radians) */
  eyeTilt?: number;
  /** iris colour (and its dark ring); pupil colour */
  iris: string; irisDark?: string; pupil?: string;
  /** iris cap half-angle (rad): 0.55 small … 0.9 huge (default 0.72) */
  irisSize?: number;
  /** a slit-ish pupil (vampire) */
  slit?: boolean;
  /** eyelid material (the skin) */
  lidMat: THREE.Material;
  /** upper lid rest closure: 0 = wide open … 0.5 = half-lidded (sarcastic / sleepy) */
  lidRest?: number;
  /** colour of the lash lines / liner */
  lash?: string;
  /** eyeliner wing at the outer corner */
  liner?: boolean;
  /** number of lash flicks at the outer top (0..3) */
  lashes?: number;
  /** brows */
  brow: string; browW?: number; browThick?: number; browLift?: number;
  /** mouth position on the sphere (pitch) and half width */
  mouthPitch: number; mouthW: number;
  /** resting smile: 'smile' (default) | 'smirk' (one-sided, Noki) */
  rest?: 'smile' | 'smirk';
  /** fangs: 1 = a single fang that peeks under the closed smile, 2 = a pair (only when open) */
  fangs?: 0 | 1 | 2;
  /** buck teeth showing under a closed smile (rabbit / dog) — not used for people */
  tongueColor?: string;
  mouthColor?: string;
  cheek?: string;
  /** a little nose */
  nose?: { mat: THREE.Material; w: number; h?: number; pitch?: number };
  /** no mouth (the dog has a real jaw) */
  noMouth?: boolean;
  /** keep the brows above hair: lift their anchor off the sphere (default 1.0 = on the surface) */
  browOut?: number;
}

export interface FaceLook { x: number; y: number }
export interface ToonFace {
  /** call each frame; `look` (−1..1) overrides the idle saccades; `browBias` lifts / lowers the brows a bit (acting) */
  update(dt: number, ex: HeroExpr, talk: number, o?: { look?: FaceLook | null; browBias?: number; cock?: number }): void;
  /** the groups (to hide the face, e.g. while transformed) */
  root: THREE.Group;
  dispose(): void;
}

type V3 = [number, number, number];
const no = <T extends THREE.Object3D>(o: T): T => { noOutline(o); return o; };

// ───────────────────────── shared geometry ─────────────────────────
/** the eyeball (a plain sphere; its texture is painted in its own coordinates) */
const eyeGeo = () => cached('tf-eye', () => new THREE.SphereGeometry(1, 40, 24));
/** the upper eyelid: a hemisphere shell (+Y half) */
const lidGeo = (r: number) => cached(`tf-lid|${r}`, () => new THREE.SphereGeometry(r, 28, 14, 0, TAU, 0, Math.PI / 2));
/** lash line along a lid's front rim (half torus in the XZ plane, +Z side) — thicker in the middle */
const rimGeo = (r: number, tube: number) => cached(`tf-rim|${r}|${tube}`, () => {
  const curve = new THREE.EllipseCurve(0, 0, r, r, -0.08, Math.PI + 0.08, false, 0);
  const pts = curve.getPoints(28).map((v) => new THREE.Vector3(v.x, 0, v.y));
  const c = new THREE.CatmullRomCurve3(pts);
  return taperedTube(c, 28, 6, (t) => tube * (0.45 + 0.75 * Math.sin(t * Math.PI)));
});
/** the brow stroke: a tapered curved tube along X (thick inner end at −X… mirrored per side by scale) */
const browGeo = (w: number, th: number) => cached(`tf-brow|${w}|${th}`, () => {
  const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-w, -th * 0.4, 0), new THREE.Vector3(0, th * 1.6, 0), new THREE.Vector3(w, -th * 0.6, 0));
  const g = taperedTube(c, 16, 7, (t) => th * (1.05 - 0.6 * t) * (0.6 + 0.4 * Math.sin(Math.min(1, t * 1.4 + 0.3) * Math.PI)));
  return g;
});
/** lower half sphere (−Y) */
const lowerGeo = () => cached('tf-lower', () => new THREE.SphereGeometry(1, 24, 10, 0, TAU, Math.PI / 2, Math.PI / 2));
/** a ">" chevron in XY (pointing −X); mirrored for "<" */
const chevGeo = (w: number, th: number) => cached(`tf-chev|${w}|${th}`, () => merge([
  { g: G.capsule(th, w), p: [0, w * 0.32, 0], r: [0, 0, -Math.PI / 2 - 0.55] },
  { g: G.capsule(th, w), p: [0, -w * 0.32, 0], r: [0, 0, -Math.PI / 2 + 0.55] },
]));

// ───────────────────────── eyeball textures ─────────────────────────
/**
 * The whole eyeball is ONE textured sphere (white + the painted iris at its +Z pole, pre-warped for the sphere's
 * equirectangular UVs), so there is nothing to z-fight; the gaze turns the ball itself.
 */
const eyeTexs = new Map<string, THREE.Texture>();
function eyeTex(col: string, dark: string, pupil: string, ia: number, small: boolean, slit: boolean) {
  const key = `${col}|${dark}|${pupil}|${ia}|${small}|${slit}`;
  let t = eyeTexs.get(key);
  if (t) return t;
  const W = 256, H = 128;
  const cIris = new THREE.Color(col), cDark = new THREE.Color(dark), cLight = new THREE.Color(col).lerp(new THREE.Color('#ffffff'), 0.4);
  const cPup = new THREE.Color(pupil), cWhite = new THREE.Color('#ffffff'), cShade = new THREE.Color('#e4e2f0');
  const tmp = new THREE.Color();
  const rI = small ? ia * 0.62 : ia; // iris angular radius
  t = canvasTex(W, H, (g) => {
    const img = g.createImageData(W, H);
    const d = img.data;
    for (let r = 0; r < H; r++) {
      const th = ((r + 0.5) / H) * Math.PI;
      for (let c = 0; c < W; c++) {
        const ph = ((c + 0.5) / W) * TAU;
        const x = -Math.cos(ph) * Math.sin(th), y = Math.cos(th), z = Math.sin(ph) * Math.sin(th);
        const ang = Math.acos(clamp(z, -1, 1));
        // local 2D position on the iris disc (angle-scaled): u right, v up
        const k = ang > 1e-4 ? ang / Math.sqrt(x * x + y * y) : 0;
        const u = x * k / rI, v = y * k / rI;
        const rr = Math.sqrt(u * u + v * v);
        // white with a soft shade toward the top (the lid's shadow)
        tmp.copy(cWhite).lerp(cShade, clamp((y - 0.25) * 1.2) * 0.8);
        if (rr < 1) {
          // iris: dark ring, dark top → light bottom gradient, faint streaks
          tmp.copy(cDark).lerp(cIris, clamp(0.25 - v * 0.9)).lerp(cLight, clamp(-v * 0.9 - 0.15));
          const streak = 0.06 * Math.sin(Math.atan2(v, u) * 18);
          tmp.offsetHSL(0, 0, streak * rr);
          if (rr > 0.84) tmp.lerp(cDark, clamp((rr - 0.84) / 0.08));
          // pupil
          const pu = u / (slit && !small ? 0.2 : small ? 0.36 : 0.44), pv = (v + 0.04) / (slit && !small ? 0.62 : small ? 0.42 : 0.5);
          if (pu * pu + pv * pv < 1) tmp.copy(cPup);
          // catch-lights
          const h1u = (u - 0.32) / 0.25, h1v = (v - 0.36) / 0.21;
          const h2u = (u + 0.3) / 0.11, h2v = (v + 0.38) / 0.11;
          if (h1u * h1u + h1v * h1v < 1 || h2u * h2u + h2v * h2v < 1) tmp.copy(cWhite);
        }
        const i = (r * W + c) * 4;
        d[i] = Math.round(Math.pow(tmp.r, 1 / 2.2) * 255); d[i + 1] = Math.round(Math.pow(tmp.g, 1 / 2.2) * 255); d[i + 2] = Math.round(Math.pow(tmp.b, 1 / 2.2) * 255); d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });
  eyeTexs.set(key, t);
  return t;
}
function lighten(c: string, k: number) { return '#' + new THREE.Color(c).lerp(new THREE.Color('#ffffff'), k).getHexString(); }

/** decal material: unlit, pulled toward the camera so it never fights with what it sits on */
function decal(color: THREE.ColorRepresentation, layer: number, o: { map?: THREE.Texture; transparent?: boolean; opacity?: number } = {}) {
  const m = basic(color, { map: o.map, transparent: o.transparent || !!o.map, opacity: o.opacity, depthWrite: !(o.transparent) });
  m.polygonOffset = true; m.polygonOffsetFactor = -layer; m.polygonOffsetUnits = -layer * 4;
  if (o.map) { m.alphaTest = 0.5; m.transparent = false; }
  return m;
}

// ───────────────────────── expression table ─────────────────────────
interface XP {
  /** upper lid angle (−1.57 open … 0 half … +0.35 shut), lower lid (1.57 open … −0.6 happy crescent) */
  up: number; lo: number;
  /** lid slant (+ = inner corner down: angry) */
  slant: number;
  small: boolean;
  /** brows: raise (× eyeH), slant (+ = inner down) */
  bY: number; bR: number;
  /** mouth: closed shape or open with top/bottom heights (× mouthW) */
  m: 'smile' | 'frown' | 'flat' | 'open';
  w: number; hu: number; hl: number;
  teeth: number; tongue: boolean;
  shut?: boolean; chev?: boolean;
}
const X: Record<HeroExpr, XP> = {
  normal: { up: -1.0, lo: 1.2, slant: 0, small: false, bY: 0, bR: 0.06, m: 'smile', w: 1, hu: 0, hl: 0, teeth: 0, tongue: false },
  happy: { up: -1.15, lo: -0.5, slant: -0.05, small: false, bY: 0.45, bR: -0.18, m: 'open', w: 1.15, hu: 0.12, hl: 0.85, teeth: 1, tongue: true },
  angry: { up: -0.5, lo: 0.75, slant: 0.42, small: false, bY: -0.42, bR: 0.55, m: 'open', w: 0.95, hu: 0.32, hl: 0.3, teeth: 2, tongue: false },
  scared: { up: -1.45, lo: 1.35, slant: -0.25, small: true, bY: 0.5, bR: -0.5, m: 'open', w: 0.85, hu: 0.32, hl: 0.5, teeth: 1, tongue: false },
  surprised: { up: -1.55, lo: 1.45, slant: 0, small: true, bY: 0.85, bR: -0.08, m: 'open', w: 0.55, hu: 0.55, hl: 0.75, teeth: 0, tongue: true },
  hurt: { up: 0.3, lo: -0.3, slant: 0.2, small: false, bY: -0.15, bR: -0.45, m: 'open', w: 0.95, hu: 0.25, hl: 0.4, teeth: 2, tongue: false, shut: true, chev: true },
  sleepy: { up: -0.1, lo: 1.0, slant: -0.18, small: false, bY: -0.15, bR: -0.2, m: 'flat', w: 0.6, hu: 0, hl: 0, teeth: 0, tongue: false },
};

export function buildToonFace(head: THREE.Object3D, M: Mats, o: ToonFaceOpts): ToonFace {
  const R = o.R;
  const C: V3 = o.center ?? [0, 0, 0];
  const root = grp(head, undefined, undefined, 'face');
  const ew = o.eyeW, eh = o.eyeH, ed = ew * (o.eyeD ?? 0.42);
  const lashC = o.lash ?? '#1b1214';
  const own: THREE.Material[] = [];
  const keep = <T extends THREE.Material>(m: T) => { own.push(m); return m; };
  const lashM = keep(basic(lashC));
  const ia = o.irisSize ?? 0.72;
  const irisDark = o.irisDark ?? '#' + new THREE.Color(o.iris).multiplyScalar(0.4).getHexString();
  const eyeMat = keep(basic('#ffffff', { map: eyeTex(o.iris, irisDark, o.pupil ?? '#140c14', ia, false, !!o.slit) }));
  const eyeSmallMat = keep(basic('#ffffff', { map: eyeTex(o.iris, irisDark, o.pupil ?? '#140c14', ia, true, false) }));

  interface Eye {
    s: number; eg: THREE.Group; gaze: THREE.Group; iris: THREE.Mesh;
    upP: THREE.Group; up: THREE.Group; loP: THREE.Group; lo: THREE.Group; deco: THREE.Group; chev: THREE.Mesh;
    brow: THREE.Group; browM: THREE.Mesh;
  }
  const eyes: Eye[] = [];
  for (const s of [1, -1]) {
    const anchor = surf(root, s * o.eyeYaw, o.eyePitch, R * 0.985, C);
    const tilt = grp(anchor, undefined, [0, 0, s * (o.eyeTilt ?? 0)]);
    const eg = grp(tilt, [0, 0, -ed * 0.45]);
    eg.scale.set(ew, eh, ed);
    const gaze = grp(eg);
    const iris = part(gaze, eyeGeo(), eyeMat, undefined, undefined, undefined, { cast: false });
    // eyelids: pivot (slant about Z) → lid (closure about X)
    const upP = grp(eg); const up = grp(upP, undefined, undefined, 'lidUp');
    part(up, lidGeo(1.08), o.lidMat, undefined, undefined, undefined, { cast: false });
    no(part(up, rimGeo(1.085, 0.11), lashM, undefined, undefined, undefined, { cast: false }));
    const loP = grp(eg); const lo = grp(loP, undefined, undefined, 'lidLo');
    part(lo, lidGeo(1.06), o.lidMat, undefined, undefined, [0, 0, Math.PI], { cast: false });
    no(part(lo, rimGeo(1.065, 0.06), lashM, undefined, undefined, [0, 0, Math.PI], { cast: false }));
    // liner wing + lashes ride on the upper lid (in the unscaled anchor space so they keep their shape)
    const deco = grp(tilt);
    if (o.liner) no(part(deco, G.capsule(ew * 0.1, ew * 0.55), lashM, [s * ew * 1.12, eh * 0.42, ed * 0.15], 1, [0, 0, s * -1.05], { cast: false }));
    for (let i = 0; i < (o.lashes ?? 0); i++) {
      const a = 0.55 + i * 0.4;
      no(part(deco, G.capsule(ew * 0.075, ew * 0.38), lashM, [s * (ew * (0.78 + i * 0.16)), eh * (0.78 - i * 0.26), ed * 0.2], 1, [0, 0, s * -a - Math.PI * 0.08 * s], { cast: false }));
    }
    const chev = no(part(tilt, chevGeo(ew * 0.9, ew * 0.16), lashM, [0, 0, ed * 0.75], [s, 1, 1], undefined, { cast: false }));
    // the brow
    const bw = o.browW ?? ew * 1.15, bt = o.browThick ?? ew * 0.2;
    const browA = surf(root, s * o.eyeYaw * 1.04, o.eyePitch + (eh * (o.browLift ?? 1.75)) / R, R * (o.browOut ?? 1.0), C);
    const brow = grp(browA);
    const browM = part(brow, browGeo(bw, bt), M.get(o.brow), undefined, [s, 1, 1], undefined, { cast: false });
    eyes.push({ s, eg, gaze, iris, upP, up, loP, lo, deco, chev, brow, browM });
  }

  // ── nose, blush ──
  if (o.nose) part(surf(root, 0, o.nose.pitch ?? (o.eyePitch - eh / R * 1.4), R * 0.99, C), G.sphere(), o.nose.mat, undefined, [o.nose.w, o.nose.h ?? o.nose.w * 0.8, o.nose.w * 0.7], undefined, { cast: false });
  const cheeks: THREE.Mesh[] = [];
  if (o.cheek) {
    const cm = keep(decal(o.cheek, 1, { transparent: true, opacity: 0.55 }));
    for (const s of [-1, 1]) cheeks.push(no(part(surf(root, s * o.eyeYaw * 1.55, o.eyePitch - eh / R * 1.45, R * 0.99, C), G.sphere(), cm, undefined, [ew * 0.95, ew * 0.55, 0.006], undefined, { cast: false })));
  }

  // ── mouth ──
  const mw = o.mouthW;
  const mouthA = surf(root, 0, o.mouthPitch, R * 0.975, C);
  const mouth = grp(mouthA);
  const inM = keep(decal(o.mouthColor ?? '#5a1424', 1));
  const tongueM = keep(decal(o.tongueColor ?? '#ff7f96', 3));
  const toothM = keep(decal('#fffaf4', 4));
  const lineM = keep(decal(lashC, 3));
  const dz = mw * 0.32;
  const upH = part(mouth, G.dome(), inM, undefined, [mw, 0.01, dz], undefined, { cast: false });
  const loH = part(mouth, lowerGeo(), inM, undefined, [mw, 0.01, dz], undefined, { cast: false });
  const tongue = no(part(mouth, G.sphere(), tongueM, undefined, [mw * 0.5, mw * 0.2, dz * 0.9], undefined, { cast: false }));
  const teethU = no(part(mouth, lowerGeo(), toothM, undefined, [mw * 0.8, mw * 0.16, dz * 0.95], undefined, { cast: false }));
  const teethL = no(part(mouth, G.dome(), toothM, undefined, [mw * 0.7, mw * 0.12, dz * 0.95], undefined, { cast: false }));
  const fangs: THREE.Mesh[] = [];
  for (const s of (o.fangs === 2 ? [1, -1] : o.fangs === 1 ? [1] : [])) {
    fangs.push(no(part(mouth, G.cone(), toothM, [s * mw * 0.42, 0, dz * 0.9], [mw * 0.13, mw * 0.3, mw * 0.08], [Math.PI, 0, 0], { cast: false })));
  }
  // closed lines
  const lineT = mw * 0.085;
  const smile = no(part(mouth, G.arc(mw * 0.8, lineT, Math.PI), lineM, [0, mw * 0.32, dz * 0.4], [1, 0.62, 0.6], [0, 0, Math.PI], { cast: false }));
  const frown = no(part(mouth, G.arc(mw * 0.6, lineT, Math.PI), lineM, [0, -mw * 0.3, dz * 0.4], [1, 0.6, 0.6], undefined, { cast: false }));
  const flat = no(part(mouth, G.capsule(lineT, mw * 0.9), lineM, [0, 0, dz * 0.4], 1, [0, 0, Math.PI / 2], { cast: false }));
  // a peeking fang under the closed smile (sits below the line, never on it)
  const peek = o.fangs ? no(part(mouth, G.cone(), toothM, [mw * 0.36, -mw * 0.02, dz * 0.3], [mw * 0.11, mw * 0.22, mw * 0.07], [Math.PI, 0, 0], { cast: false })) : null;
  const smirk = o.rest === 'smirk';
  if (o.noMouth) mouth.visible = false;

  // ── animation state ──
  const cur = { up: -1.0, lo: 1.2, slant: 0, bY: 0, bR: 0, w: 1, hu: 0, hl: 0, open: 0, lookX: 0, lookY: 0 };
  let t = Math.random() * 10, blinkT = 0, nextBlink = 1 + Math.random() * 2, dbl = false;
  let sacT = 0, sacX = 0, sacY = 0, yawn = 0, nextYawn = 4;
  let first = true;

  function update(dt: number, ex: HeroExpr, talk: number, uo: { look?: FaceLook | null; browBias?: number; cock?: number } = {}) {
    dt = Math.min(dt, 0.1);
    t += dt;
    const P = X[ex] ?? X.normal;
    talk = clamp(talk);
    // blink (not while shut / happy-squinting)
    blinkT += dt;
    if (blinkT > nextBlink + 0.16) { blinkT = 0; nextBlink = dbl ? 0.18 : 1.8 + Math.random() * 3.2; dbl = !dbl && Math.random() < 0.18; }
    const bk = blinkT > nextBlink ? Math.sin(((blinkT - nextBlink) / 0.16) * Math.PI) : 0;
    // saccades
    sacT -= dt;
    if (sacT <= 0) { sacT = 0.6 + Math.random() * 2.2; const r = Math.random(); sacX = r < 0.45 ? 0 : (Math.random() * 2 - 1) * 0.8; sacY = r < 0.45 ? 0 : (Math.random() * 2 - 1) * 0.45; }
    const lk = uo.look ?? { x: sacX, y: sacY };
    // sleepy: a yawn now and then
    if (ex === 'sleepy') { nextYawn -= dt; if (nextYawn < 0) { yawn += dt / 1.6; if (yawn >= 1) { yawn = 0; nextYawn = 4 + Math.random() * 4; } } } else { yawn = 0; nextYawn = 2.5; }
    const yk = Math.sin(clamp(yawn) * Math.PI);

    // targets
    const restLid = (o.lidRest ?? 0) * 1.0;
    let up = P.up + (ex === 'normal' || ex === 'angry' ? restLid : 0);
    let lo = P.lo;
    if (!P.shut && ex !== 'happy') { up = up + (0.32 - up) * bk; lo = lo + (-0.3 - lo) * bk; }
    if (yk > 0) up += 0.25 * yk;
    const lam = first ? 1e3 : 26;
    cur.up = damp(cur.up, up, ex === 'happy' || P.shut ? 18 : lam, dt);
    cur.lo = damp(cur.lo, lo, ex === 'happy' || P.shut ? 18 : lam, dt);
    cur.slant = damp(cur.slant, P.slant, 14, dt);
    const talkBrow = talk > 0.2 ? Math.max(0, Math.sin(t * 3.3)) * 0.25 : 0;
    cur.bY = damp(cur.bY, P.bY + (uo.browBias ?? 0) + talkBrow, first ? 1e3 : 14, dt);
    cur.bR = damp(cur.bR, P.bR, first ? 1e3 : 14, dt);
    cur.lookX = damp(cur.lookX, clamp(lk.x, -1, 1), 30, dt);
    cur.lookY = damp(cur.lookY, clamp(lk.y, -1, 1), 30, dt);

    for (const e of eyes) {
      e.upP.rotation.z = e.s * cur.slant;
      e.loP.rotation.z = e.s * cur.slant * 0.4;
      e.up.rotation.x = cur.up;
      e.lo.rotation.x = cur.lo;
      e.deco.rotation.z = 0;
      e.deco.position.y = clamp((cur.up + 1.0) * -0.5, -1, 0.2) * eh * 0.9;
      vis(e.deco, cur.up < 0.0);
      e.gaze.rotation.set(-cur.lookY * 0.22, cur.lookX * 0.3, 0);
      const em = P.small ? eyeSmallMat : eyeMat;
      if (e.iris.material !== em) e.iris.material = em;
      vis(e.chev, !!P.chev);
      const cock = (uo.cock ?? 0) * (e.s > 0 ? 1 : -0.4);
      e.brow.position.set(0, (cur.bY + cock) * eh, 0);
      e.brow.rotation.z = e.s * cur.bR;
    }
    for (const c of cheeks) c.scale.set(ew * (ex === 'happy' ? 1.15 : 0.95), ew * (ex === 'happy' ? 0.62 : 0.55), 0.006);

    // mouth
    let shape = P.m, w = P.w, hu = P.hu, hl = P.hl;
    let teeth = P.teeth, showTongue = P.tongue;
    if (yk > 0.05) { shape = 'open'; w = 0.6; hu = 0.6 * yk; hl = 0.9 * yk; teeth = 0; showTongue = true; }
    if (talk > 0.05) {
      // vowels: alternate between a wide "э" and a round "о", on top of the expression's shape
      const v = 0.5 + 0.5 * Math.sin(t * 11.3 + Math.sin(t * 4.1) * 2);
      if (shape !== 'open') { shape = 'open'; w = 0.75; hu = 0.2; hl = 0.35; teeth = 1; showTongue = true; }
      const k = talk;
      w = w * (1 + 0.18 * (v - 0.5)) * (0.9 + 0.15 * k);
      hu = Math.max(hu, (0.15 + 0.35 * (1 - v)) * k);
      hl = Math.max(hl * (ex === 'normal' ? 0 : 1), (0.3 + 0.55 * k) * (0.7 + 0.3 * v));
    }
    const open = shape === 'open';
    cur.w = damp(cur.w, open ? w : 1, 28, dt);
    cur.hu = damp(cur.hu, open ? hu : 0, 28, dt);
    cur.hl = damp(cur.hl, open ? hl : 0, 28, dt);
    const isOpen = open && cur.hl + cur.hu > 0.12;
    vis(upH, isOpen); vis(loH, isOpen);
    const W = mw * cur.w, HU = mw * Math.max(0.02, cur.hu), HL = mw * Math.max(0.02, cur.hl);
    if (isOpen) {
      upH.scale.set(W, HU, dz);
      loH.scale.set(W, HL, dz);
      // upper teeth: a band hanging from the mouth's centre line (always inside the outline)
      vis(teethU, teeth >= 1);
      teethU.scale.set(W * 0.8, Math.min(HL * 0.38, mw * 0.2), dz * 1.04);
      teethU.position.set(0, HU * 0.15, 0);
      vis(teethL, teeth >= 2);
      teethL.scale.set(W * 0.7, Math.min(HL * 0.3, mw * 0.16), dz * 1.04);
      teethL.position.set(0, -HL * 0.98, 0);
      vis(tongue, showTongue && HL > mw * 0.3);
      tongue.scale.set(W * 0.45, HL * 0.3, dz * 0.95);
      tongue.position.set(0, -HL * 0.62, 0);
      for (let i = 0; i < fangs.length; i++) {
        const s = fangs.length === 1 ? 1 : i === 0 ? 1 : -1;
        fangs[i].position.set(s * W * 0.42, HU * 0.1, dz * 0.92);
        fangs[i].scale.set(mw * 0.11, Math.min(HL * 0.42, mw * 0.3), mw * 0.07);
        vis(fangs[i], true);
      }
    } else {
      vis(teethU, false); vis(teethL, false); vis(tongue, false);
      for (const f of fangs) vis(f, false);
    }
    const closed = !isOpen;
    vis(smile, closed && shape === 'smile');
    vis(frown, closed && shape === 'frown');
    vis(flat, closed && shape === 'flat');
    if (peek) vis(peek, closed && (shape === 'smile' || shape === 'flat') && fangs.length === 1);
    if (smirk && closed) {
      smile.rotation.set(0, 0, Math.PI + 0.22);
      smile.position.set(mw * 0.08, mw * 0.3, dz * 0.4);
      smile.scale.set(0.95, 0.75, 0.6);
    } else { smile.rotation.set(0, 0, Math.PI); smile.position.set(0, mw * 0.32, dz * 0.4); smile.scale.set(1, 0.62, 0.6); }
    if (peek) peek.position.set(mw * 0.4, smirk ? mw * 0.02 : -mw * 0.02, dz * 0.3);
    flat.scale.set(1, ex === 'sleepy' ? 0.6 : 1, 1);
    first = false;
  }

  return {
    update, root,
    dispose() { for (const m of own) m.dispose(); },
  };
}

/** map a folk / NPC mood onto a hero expression (helper for the townsfolk) */
export function moodExpr(state: string): HeroExpr {
  switch (state) {
    case 'cheer': case 'wave': case 'happy': return 'happy';
    case 'scared': case 'stun': return 'scared';
    case 'sleepy': return 'sleepy';
    default: return 'normal';
  }
}

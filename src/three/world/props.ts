import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Built } from '../physics/types';
import { PAL, BOOK_COLORS, LAYER_NO_OUTLINE } from '../gfx';
import {
  B, TAU, clamp, lerp, rng, rr, hashSeed, tmat, bmat, cg, unitCyl, unitDome,
  boxGeo, atlasBox, planarUV, scaleUV, latheV, latheC, bandGeo, shapeGeo, archShape, archRing, type LP, type UVRect,
} from './kit';
import {
  woodGrainTex, woodPlanksTex, crateTex, tableclothTex, stoneBricksTex, fluteTex, bookAtlas, jarLabelTex, canLabelTex,
  bottleLabelTex, stencilTex, plaqueTex, plateTex, porcelainTex, tinTex, tinLidTex, cheeseTex, breadTex, cookieTex,
  sugarTex, burlapTex, barrelTex, liquidTex, noodleTex, velvetTex, kingPortraitTex, moonWindowTex, signTex, bannerTex,
  doorTex, glowTex, beamTex, rugTex, shade, type WoodTone, type Fruit, type CanKind,
} from './textures';

/**
 * Giant props for the Huge Kingdom. Conventions (see also README notes in preview.ts):
 *  - (x,y,z) = WORLD position of the prop's bottom-center (hanging props: the hang point; wall props: bottom-center on the wall face).
 *  - rotY = quarter turns about Y: 0 → front faces +Z, 1 → +X, 2 → -Z, 3 → -X. Props with colliders round it to an integer.
 *  - Colliders/hazards are returned in world space; tops match the visible walkable surfaces.
 *  - Returned obj is static & frozen (matrixAutoUpdate=false); only flames/liquids/jelly/cookies animate.
 */

const seedOf = (o: { x: number; y: number; z: number; seed?: number }) => o.seed ?? hashSeed(o.x, o.y, o.z);
const woodM = (tone: WoodTone = 'warm') => tmat(woodGrainTex(tone));
const steelM = () => tmat(null, PAL.steel, { emissive: '#8090a8', emissiveIntensity: 0.25 });
const goldM = () => tmat(null, PAL.gold);
const ironM = () => tmat(null, '#3a3440');

// ───────────────────────── flames (shared) ─────────────────────────

interface Flame { g: THREE.Group; ph: number }
const flameGeo = () => latheC('flame', [[0, 0, 0], [0.42, 0.1, 0.2], [0.56, 0.3, 0.4], [0.44, 0.58, 0.6], [0.2, 0.84, 0.8], [0, 1, 1]], 12);
const spriteMats = new Map<string, THREE.SpriteMaterial>();
function glowSprite(color: string, opacity = 0.75) {
  const k = `${color}|${opacity}`;
  let m = spriteMats.get(k);
  if (!m) {
    m = new THREE.SpriteMaterial({ map: glowTex(), color: new THREE.Color(color), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity });
    spriteMats.set(k, m);
  }
  const s = new THREE.Sprite(m);
  s.layers.set(LAYER_NO_OUTLINE);
  return s;
}
/** flame of height fh with its base at (x,y,z); animated by flicker() */
function addFlame(b: B, parent: THREE.Object3D, x: number, y: number, z: number, fh: number, R: () => number): Flame {
  const g = b.group(x, y, z, parent, true);
  b.m(flameGeo(), bmat('#ff7a1a', { depthWrite: false }), 0, 0, 0, { parent: g, glow: true, sx: fh * 0.45, sy: fh, sz: fh * 0.45, order: 2 });
  b.m(flameGeo(), bmat('#ffe066', { depthWrite: false }), 0, fh * 0.03, 0, { parent: g, glow: true, sx: fh * 0.24, sy: fh * 0.6, sz: fh * 0.24, order: 3 });
  const s = glowSprite('#ffae4a');
  s.scale.setScalar(fh * 3.4); s.position.y = fh * 0.45;
  g.add(s);
  return { g, ph: R() * 100 };
}
function flicker(f: Flame, t: number) {
  const p = f.ph;
  const k = 1 + 0.09 * Math.sin(t * 13.1 + p) + 0.06 * Math.sin(t * 29.7 + p * 1.3) + 0.04 * Math.sin(t * 5.3 + p * 0.7);
  f.g.scale.set(1 + 0.05 * Math.sin(t * 17 + p), k, 1 + 0.05 * Math.cos(t * 15 + p));
  f.g.rotation.z = 0.07 * Math.sin(t * 4.1 + p);
  f.g.rotation.x = 0.05 * Math.sin(t * 3.3 + p * 2);
  return k;
}

// ───────────────────────── books ─────────────────────────

export interface BookOpts { x: number; y: number; z: number; w: number; h: number; d: number; color?: string; lying?: boolean; rotY?: number; seed?: number }

function pickBook(color: string | undefined, R: () => number) {
  const main = bookAtlas();
  if (!color) return { atlas: main, ci: Math.floor(R() * main.colors.length) };
  const i = main.index(color);
  if (i >= 0) return { atlas: main, ci: i };
  return { atlas: bookAtlas([color]), ci: 0 };
}

/**
 * Adds one book (visual only) with its bottom-center at local (cx, y0, cz). Spine faces +Z (or -Z if flip).
 * lying: w×d cover on top, thickness h. upright: w = thickness, h = height, d = cover width (depth).
 */
function addBook(b: B, cx: number, y0: number, cz: number, w: number, h: number, d: number, lying: boolean, R: () => number, color?: string, flip = false) {
  const { atlas, ci } = pickBook(color, R);
  const m = tmat(atlas.tex);
  const g = b.group(cx, y0, cz);
  if (flip) g.rotation.y = Math.PI;
  const cov = atlas.cover(ci), sp = atlas.spine(ci, R() < 0.5 ? 0 : 1), pl = atlas.plain(ci), pg = atlas.pages;
  const P: (UVRect | null)[] = [pl, pl, pl, pl, pl, pl];
  if (lying) {
    const c = clamp(h * 0.12, 0.08, 0.28), o = clamp(Math.min(w, d) * 0.03, 0.08, 0.22);
    const dz = d - c;
    const coverRot = w > dz;
    b.m(atlasBox(w, c, dz, [pl, pl, cov, pl, pl, pl], [false, false, coverRot]), m, 0, h - c / 2, -c / 2, { parent: g });
    b.m(atlasBox(w, c, dz, [pl, pl, pl, cov, pl, pl], [false, false, false, coverRot]), m, 0, c / 2, -c / 2, { parent: g });
    b.m(atlasBox(w, h, c, [pl, pl, pl, pl, sp, pl], [false, false, false, false, true]), m, 0, h / 2, d / 2 - c / 2, { parent: g });
    b.m(atlasBox(w - 2 * o, h - 2 * c, d - c - o, [pg, pg, null, null, pl, pg]), m, 0, h / 2, (o - c) / 2, { parent: g });
  } else {
    const c = clamp(w * 0.12, 0.08, 0.25), o = clamp(Math.min(h, d) * 0.02, 0.06, 0.2);
    const dz = d - c;
    const rot = dz > h;
    const L = [...P]; L[1] = cov;
    const Rr = [...P]; Rr[0] = cov;
    b.m(atlasBox(c, h, dz, L, [false, rot]), m, -w / 2 + c / 2, h / 2, -c / 2, { parent: g });
    b.m(atlasBox(c, h, dz, Rr, [rot]), m, w / 2 - c / 2, h / 2, -c / 2, { parent: g });
    b.m(atlasBox(w, h, c, [pl, pl, pl, pl, sp, pl]), m, 0, h / 2, d / 2 - c / 2, { parent: g });
    b.m(atlasBox(w - 2 * c, h - 2 * o, d - c - o, [pl, pl, pg, pg, pl, pg], [false, false, true, true, false, true]), m, 0, h / 2, (o - c) / 2, { parent: g });
  }
}

/** A single giant book, lying (default) or upright. Collider = its box. */
export function book(o: BookOpts): Built {
  const b = new B('book');
  const R = rng(seedOf(o));
  const lying = o.lying ?? true;
  addBook(b, 0, 0, 0, o.w, o.h, o.d, lying, R, o.color, false);
  b.box(-o.w / 2, 0, -o.d / 2, o.w / 2, o.h, o.d / 2);
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

/** n lying books stacked with jitter; one collider per book. `top` = world Y of the top surface. */
export function bookStack(o: { x: number; y: number; z: number; n: number; w: number; d: number; seed?: number; h?: number; hMin?: number; hMax?: number; rotY?: number }): Built & { top: number } {
  const b = new B('bookStack');
  const R = rng(seedOf(o));
  let yy = 0;
  for (let i = 0; i < o.n; i++) {
    const bw = o.w * rr(R, 0.84, 1), bd = o.d * rr(R, 0.84, 1);
    const bh = o.h ?? rr(R, o.hMin ?? 1.2, o.hMax ?? 2.1);
    const ox = (R() - 0.5) * (o.w - bw), oz = (R() - 0.5) * (o.d - bd);
    addBook(b, ox, yy, oz, bw, bh, bd, true, R, undefined, R() < 0.4);
    b.box(ox - bw / 2, yy, oz - bd / 2, ox + bw / 2, yy + bh, oz + bd / 2);
    yy += bh;
  }
  return Object.assign(b.done(o.x, o.y, o.z, o.rotY ?? 0), { top: o.y + yy });
}

/**
 * Box of wood with a flush contrasting edge band on its front face (+Z), built from 3 boxes that only
 * TOUCH (no overlapping coplanar faces → no z-fighting, no thin ledges that alias in the outline pass).
 * Box spans x ±w/2, y y0..y0+h, z z0..z1; the band covers `bandH` of the front at the top (top=true) or bottom.
 */
function bandedBox(b: B, body: THREE.Material, band: THREE.Material, w: number, h: number, y0: number, z0: number, z1: number, bandH: number, bandD: number, top: boolean, tile: number) {
  const cz = (a: number, c: number) => (a + c) / 2;
  const yb0 = top ? y0 + h - bandH : y0, yb1 = yb0 + bandH;   // band rows
  const yr0 = top ? y0 : y0 + bandH, yr1 = top ? y0 + h - bandH : y0 + h; // full-depth rows
  b.bx(body, w, yr1 - yr0, z1 - z0, 0, cz(yr0, yr1), cz(z0, z1), tile);
  b.bx(body, w, bandH, z1 - bandD - z0, 0, cz(yb0, yb1), cz(z0, z1 - bandD), tile);
  b.bx(band, w, bandH, bandD, 0, cz(yb0, yb1), z1 - bandD / 2, tile);
}

/**
 * Giant bookcase (front = +Z). `shelves` compartments stacked; walkable boards, sides, crown.
 * Each compartment holds clumps of upright books (~fill of the width) with walkable gaps, plus one
 * "staircase" clump (steps ≤1.7) ending in a tall book that sticks out of the shelf so the hero can
 * hop to the next board (set climb:false to disable).
 */
export function bookshelf(o: { x: number; y: number; z: number; w: number; h: number; d: number; shelves: number; fill?: number; seed?: number; rotY?: number; climb?: boolean; tone?: WoodTone }): Built & { boards: number[] } {
  const b = new B('bookshelf');
  const R = rng(seedOf(o));
  const { w, h, d } = o;
  const n = Math.max(1, Math.round(o.shelves));
  const fill = clamp(o.fill ?? 0.6, 0, 0.95);
  const t = clamp(w * 0.035, 0.7, 1.4), bt = 0.6, base = clamp(h * 0.04, 0.8, 1.6), boardT = 0.8;
  const crownH = 1.1, crownO = 0.45;
  const wm = woodM(o.tone ?? 'dark'), trim = woodM('warm');
  const tile = 7;
  // carcass
  const sideH = h - crownH;
  b.bx(wm, t, sideH, d, -w / 2 + t / 2, sideH / 2, 0, tile); b.box(-w / 2, 0, -d / 2, -w / 2 + t, sideH, d / 2);
  b.bx(wm, t, sideH, d, w / 2 - t / 2, sideH / 2, 0, tile); b.box(w / 2 - t, 0, -d / 2, w / 2, sideH, d / 2);
  const wi = w - 2 * t;
  b.bx(tmat(woodPlanksTex('dark', 4)), wi, sideH - base, bt, 0, base + (sideH - base) / 2, -d / 2 + bt / 2, 9);
  b.box(-wi / 2, base, -d / 2, wi / 2, sideH, -d / 2 + bt);
  // base with a flush kick band on the lower half of its front (the old separate trim box shared the
  // base's front plane → z-fighting)
  bandedBox(b, wm, trim, wi, base, 0, -d / 2, d / 2, base * 0.5, 0.12, false, tile);
  b.box(-wi / 2, 0, -d / 2, wi / 2, base, d / 2);
  // crown molding (walkable top)
  b.bx(trim, w + 2 * crownO, crownH * 0.45, d + crownO, 0, sideH + crownH * 0.775, crownO / 2, tile);
  b.bx(wm, w + crownO, crownH * 0.55, d + crownO * 0.5, 0, sideH + crownH * 0.275, crownO / 4, tile);
  b.box(-w / 2 - crownO, sideH, -d / 2, w / 2 + crownO, h, d / 2 + crownO);
  // compartments
  const clear = (sideH - base - (n - 1) * boardT) / n;
  const boards: number[] = [];
  const xs = -wi / 2, xe = wi / 2;
  const zBack = -d / 2 + bt + 0.04;
  const maxDepth = Math.max(1, d - bt - 0.3);
  const maxH = clear - 1.15; // keep headroom to stand on books
  const climb = o.climb ?? true;
  for (let k = 0; k < n; k++) {
    const fy = base + k * (clear + boardT);
    if (k > 0) {
      // board (stops at the back panel) with a flush edge band along the top of its front. The old trim
      // was a separate box sharing the board's front AND top planes → the stair-step z-fighting stripes
      // along every shelf; the board's back face also used to be coplanar with the back panel's.
      bandedBox(b, wm, trim, wi, boardT, fy - boardT, -d / 2 + bt, d / 2, 0.22, 0.1, true, tile);
      b.box(-wi / 2, fy - boardT, -d / 2, wi / 2, fy, d / 2);
    }
    boards.push(o.y + fy);
    if (maxH < 1) continue;
    // plan clumps across the width
    const total = xe - xs;
    let budget = fill * total;
    const clumps: number[] = [];
    while (budget > 0.8) { const cw = Math.min(budget, rr(R, 3.5, 8)); clumps.push(cw); budget -= cw; }
    const gapTotal = total - clumps.reduce((a, c) => a + c, 0);
    const weights = clumps.map(() => 0.5 + R()); weights.push(0.5 + R());
    if (R() < 0.5) weights[0] *= 0.2; // often a clump leans against the side panel
    const ws = weights.reduce((a, c) => a + c, 0);
    const climbIdx = climb && clumps.length ? (k % 2 === 0 ? 0 : clumps.length - 1) : -1;
    let x = xs + gapTotal * weights[0] / ws;
    clumps.forEach((cw, ci) => {
      const end = Math.min(xe, x + cw);
      if (ci === climbIdx) {
        // staircase: ascending heights toward the free side, last one protrudes
        const top = clear - 0.35;
        const steps = Math.max(2, Math.ceil((top - 1.6) / 1.6) + 1);
        const hs: number[] = [];
        for (let i = 0; i < steps; i++) hs.push(lerp(Math.min(1.6, top), top, steps === 1 ? 1 : i / (steps - 1)));
        const asc = k % 2 === 0; // left clump climbs toward +x, right clump toward -x
        let bx = asc ? x : end;
        for (let i = 0; i < steps; i++) {
          const bw = rr(R, 1.25, 1.65);
          const bh = hs[i];
          // every step sticks out of the shelf so the hero can jump without bumping the board above
          const bd = maxDepth + (k === n - 1 ? 1.5 : 1.05) + (R() - 0.5) * 0.2;
          const cx = asc ? bx + bw / 2 : bx - bw / 2;
          const cz = zBack + bd / 2;
          addBook(b, cx, fy, cz, bw, bh, bd, false, R);
          b.box(cx - bw / 2, fy, cz - bd / 2, cx + bw / 2, fy + bh, cz + bd / 2);
          bx += asc ? bw + 0.02 : -(bw + 0.02);
        }
      } else if (R() < 0.22 && cw > 3.2) {
        // a lying stack in the clump
        let yy = 0; const sw = Math.min(cw, rr(R, 3.2, 5.5));
        const ns = 1 + Math.floor(R() * 3);
        for (let i = 0; i < ns && yy < maxH - 0.6; i++) {
          const bh = Math.min(rr(R, 0.6, 1.1), maxH - yy);
          const bw2 = sw * rr(R, 0.85, 1), bd = maxDepth * rr(R, 0.6, 0.9);
          const cx = x + sw / 2 + (R() - 0.5) * (sw - bw2), cz = zBack + bd / 2;
          addBook(b, cx, fy + yy, cz, bw2, bh, bd, true, R, undefined, R() < 0.3);
          b.box(cx - bw2 / 2, fy + yy, cz - bd / 2, cx + bw2 / 2, fy + yy + bh, cz + bd / 2);
          yy += bh;
        }
      } else {
        let bx = x;
        let prevH = 0;
        while (bx < end - 0.5) {
          const bw = Math.min(rr(R, 0.8, 1.55), end - bx);
          if (bw < 0.5) break;
          let bh = clamp(rr(R, 0.45, 1) * maxH, Math.min(2.4, maxH), maxH);
          if (prevH && Math.abs(bh - prevH) < 0.25) bh = clamp(bh + (R() < 0.5 ? -0.5 : 0.5), Math.min(2.4, maxH), maxH);
          prevH = bh;
          const bd = maxDepth * rr(R, 0.72, 0.98);
          const cx = bx + bw / 2, cz = zBack + bd / 2;
          addBook(b, cx, fy, cz, bw, bh, bd, false, R);
          b.box(cx - bw / 2, fy, cz - bd / 2, cx + bw / 2, fy + bh, cz + bd / 2);
          bx += bw + 0.02;
        }
      }
      x = end + gapTotal * weights[ci + 1] / ws;
    });
  }
  boards.push(o.y + h);
  return Object.assign(b.done(o.x, o.y, o.z, o.rotY ?? 0), { boards });
}

/** Wooden wall shelf plank (walkable). y = bottom of the plank; brackets hang below at the back (decor). */
export function shelfBoard(o: { x: number; y: number; z: number; w: number; d: number; th?: number; rotY?: number; brackets?: boolean; tone?: WoodTone }): Built {
  const b = new B('shelf');
  const th = o.th ?? 0.8;
  const m = woodM(o.tone ?? 'light');
  // plank with a flush edge band along the bottom of its front (the old trim box shared the plank's
  // front, bottom and end planes → z-fighting stripes)
  bandedBox(b, m, woodM('warm'), o.w, th, 0, -o.d / 2, o.d / 2, th * 0.3, 0.12, false, 6);
  b.box(-o.w / 2, 0, -o.d / 2, o.w / 2, th, o.d / 2);
  if (o.brackets ?? true) {
    const s = Math.min(o.d * 0.8, 3.2);
    const geo = cg(`bracket:${s.toFixed(2)}`, () => {
      const sh = new THREE.Shape();
      sh.moveTo(0, 0); sh.lineTo(s, 0); sh.lineTo(s, -0.3); sh.quadraticCurveTo(s * 0.3, -s * 0.3, 0.3, -s); sh.lineTo(0, -s); sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.35, bevelEnabled: false });
      g.translate(0, 0, -0.175); g.rotateY(-Math.PI / 2);
      return planarUV(g, 'z', 'y', 1 / 4, 1 / 4);
    });
    const nb = Math.max(2, Math.round(o.w / 9) + 1);
    for (let i = 0; i < nb; i++) {
      const bx = lerp(-o.w / 2 + 1, o.w / 2 - 1, nb === 1 ? 0.5 : i / (nb - 1));
      b.m(geo, woodM('warm'), bx, 0, -o.d / 2, {});
    }
  }
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

// ───────────────────────── pantry goods ─────────────────────────

/**
 * Wooden crate with a framed edge and stenciled label. Very tall / wide crates are drawn as a stack /
 * row of crate modules (one box collider for the whole thing).
 */
export function crate(o: { x: number; y: number; z: number; w: number; h: number; d: number; label?: string; rotY?: number }): Built {
  const b = new B('crate');
  const { w, h, d } = o;
  const side: UVRect = { u0: 0, u1: 1, v0: 0.5, v1: 1 }, lid: UVRect = { u0: 0, u1: 1, v0: 0, v1: 0.5 };
  const cm = tmat(crateTex(o.label ?? '')), fm = woodM('warm');
  const ny = Math.max(1, Math.round(h / Math.max(w, d, 1.5)));
  const nx = Math.max(1, Math.round(w / Math.max((h / ny) * 1.6, d * 1.2, 1.5)));
  const mw = w / nx, mh = h / ny;
  for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
    const cx = -w / 2 + mw * (ix + 0.5), y0 = iy * mh;
    const k = 0.035 * Math.min(mw, mh, d);
    b.m(atlasBox(mw - 2 * k, mh - 2 * k, d - 2 * k, [side, side, lid, lid, side, side]), cm, cx, y0 + mh / 2, 0);
    const e = clamp(Math.min(mw, mh, d) * 0.09, 0.15, 0.42);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.bx(fm, e, mh, e, cx + sx * (mw / 2 - e / 2), y0 + mh / 2, sz * (d / 2 - e / 2), 4);
    for (const yy of [y0 + e / 2, y0 + mh - e / 2]) {
      for (const sz of [-1, 1]) b.bx(fm, mw - 2 * e, e, e, cx, yy, sz * (d / 2 - e / 2), 4);
      for (const sx of [-1, 1]) b.bx(fm, e, e, d - 2 * e, cx + sx * (mw / 2 - e / 2), yy, 0, 4);
    }
  }
  b.box(-w / 2, 0, -d / 2, w / 2, h, d / 2);
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

const JAM: Record<'red' | 'orange' | 'green' | 'honey', { c: string; fruit: Fruit; label: string; cloth: string }> = {
  red: { c: PAL.jamRed, fruit: 'strawberry', label: 'ДЖЕМ', cloth: '#d2323c' },
  orange: { c: PAL.jamOrange, fruit: 'orange', label: 'АБРИКОС', cloth: '#3a8a3a' },
  green: { c: '#6aa83a', fruit: 'pear', label: 'ГРУША', cloth: '#e0622a' },
  honey: { c: '#eaa01e', fruit: 'honey', label: 'МЁД', cloth: '#3a6ad8' },
};
/** Glass jam jar (r≈2.5–3.5, h≈6–9): jam inside, gingham cloth lid tied with string, paper label. Walkable lid. */
export function jar(o: { x: number; y: number; z: number; r: number; h: number; jam?: 'red' | 'orange' | 'green' | 'honey'; label?: string; rotY?: number }): Built {
  const b = new B('jar');
  const J = JAM[o.jam ?? 'red'];
  const { r, h } = o;
  const glass = latheC('jarGlass', [[0, 0, 0], [0.86, 0, 0.05, 1], [0.97, 0.025, 0.08], [1, 0.08, 0.12], [1, 0.74, 0.7], [0.95, 0.8, 0.78], [0.85, 0.845, 0.85], [0.85, 0.88, 0.9]], 32);
  b.m(glass, tmat(null, '#e4f2ff', { transparent: true, opacity: 0.22, depthWrite: false }), 0, 0, 0, { sx: r, sy: h, sz: r, cast: false, order: 1 });
  // jam (top a bit lighter)
  b.cy(tmat(null, J.c), r * 0.93, h * 0.66, 0, h * 0.02, 0, 28);
  b.m(cg('jamTop', () => new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2)), tmat(null, shade(J.c, 0.25), { decal: true }), 0, h * 0.68 + 0.015, 0, { s: r * 0.9, cast: false });
  // cloth lid with scalloped hem
  const cloth = cg('jarCloth', () => {
    const g = latheV([[1.0, 0.8, 0], [0.93, 0.86, 0.3], [0.89, 0.95, 0.55], [0.84, 0.995, 0.7], [0.55, 1.0, 0.85], [0, 1.0, 1]], 40);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) if (Math.abs(p.getY(i) - 0.8) < 1e-4) {
      const a = Math.atan2(p.getX(i), p.getZ(i));
      p.setY(i, 0.8 + 0.025 * (1 - Math.abs(Math.cos(a * 6))));
    }
    g.computeVertexNormals();
    return planarUV(g, 'x', 'z', 1.6, 1.6);
  });
  b.m(cloth, tmat(tableclothTex(J.cloth), '#ffffff', { side: THREE.DoubleSide }), 0, 0, 0, { sx: r, sy: h, sz: r });
  // string + bow
  const strM = tmat(null, '#f2e2c0');
  b.m(cg('torus48', () => new THREE.TorusGeometry(1, 0.035, 8, 48)), strM, 0, h * 0.87, 0, { rx: Math.PI / 2, s: r * 0.885 });
  for (const s of [-1, 1]) b.m(cg('torus16', () => new THREE.TorusGeometry(1, 0.25, 8, 16)), strM, s * r * 0.16, h * 0.87, r * 0.9, { s: r * 0.12, sx: r * 0.14, rz: s * 0.4 });
  // label
  const lt = jarLabelTex(o.label ?? J.label, J.fruit, J.c);
  b.m(bandGeo(r * 1.015, h * 0.26, h * 0.6, 2.0, 20), tmat(lt, '#ffffff', { alphaTest: 0.5 }), 0, 0, 0);
  // glass highlights
  const hl = bmat('#ffffff', { opacity: 0.55, depthWrite: false });
  b.m(bandGeo(r * 1.006, h * 0.14, h * 0.72, 0.16, 3), hl, 0, 0, 0, { ry: -0.75, glow: true, order: 2 });
  b.m(bandGeo(r * 1.006, h * 0.62, h * 0.72, 0.08, 2), hl, 0, 0, 0, { ry: -0.42, glow: true, order: 2 });
  b.cyl(0, 0, r, 0, h);
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

/** Tin can (r≈1.5–2.5, h≈3–5). label: 'fish' | 'tomato' | 'peas' pictograms, or any text. Walkable top. */
export function can(o: { x: number; y: number; z: number; r: number; h: number; color?: string; label?: string; kind?: CanKind; rotY?: number }): Built {
  const b = new B('can');
  const isKind = o.label === 'fish' || o.label === 'tomato' || o.label === 'peas';
  const L = (o.label ?? '').toLowerCase();
  const guess: CanKind | null = /томат|tomat|помид/.test(L) ? 'tomato' : /рыб|fish|шпрот|сардин|килька/.test(L) ? 'fish' : /горо|pea/.test(L) ? 'peas' : null;
  const kind: CanKind = o.kind ?? (isKind ? o.label as CanKind : guess ?? (['fish', 'tomato', 'peas'] as const)[hashSeed(o.x, o.z) % 3]);
  const text = isKind ? undefined : o.label;
  const color = o.color ?? (kind === 'fish' ? '#2e86c1' : kind === 'tomato' ? '#c0392b' : '#27ae60');
  const geo = latheC('can', [[0, 0, 0], [0.95, 0, 0.02, 1], [1, 0.025, 0.04], [1, 0.06, 0.06], [0.985, 0.075, 0.065], [1, 0.09, 0.07, 1], [1, 0.91, 0.79, 1], [0.985, 0.925, 0.795], [1, 0.94, 0.8], [1, 0.975, 0.82], [0.97, 1.0, 0.84, 1], [0.93, 0.985, 0.86], [0.9, 0.975, 0.88, 1], [0, 0.975, 1]], 32);
  b.m(geo, tmat(canLabelTex(kind, color, text)), 0, 0, 0, { sx: o.r, sy: o.h, sz: o.r });
  b.cyl(0, 0, o.r, 0, o.h);
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

/** Block of holey cheese (box collider). */
export function cheese(o: { x: number; y: number; z: number; w: number; h: number; d: number; rotY?: number }): Built {
  const b = new B('cheese');
  const m = tmat(cheeseTex());
  b.m(scaleUV(new RoundedBoxGeometry(o.w, o.h, o.d, 2, Math.min(o.w, o.h, o.d) * 0.06), Math.max(o.w, o.d) / 6, o.h / 6), m, 0, o.h / 2, 0);
  // a few dents on top
  const R = rng(hashSeed(o.x, o.z, 7));
  for (let i = 0; i < 4; i++) {
    const s = rr(R, 0.3, 0.7);
    b.m(cg('disc16', () => new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2)), tmat(null, '#c8901a', { decal: true }), rr(R, -0.35, 0.35) * o.w, o.h + 0.012, rr(R, -0.35, 0.35) * o.d, { s, sz: s * 0.8, cast: false });
  }
  b.box(-o.w / 2, 0, -o.d / 2, o.w / 2, o.h, o.d / 2);
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

/** Loaf of bread along X (rounded top, scored crust). Collider top = loaf crown. */
export function bread(o: { x: number; y: number; z: number; w: number; h: number; d: number; rotY?: number }): Built {
  const b = new B('bread');
  const { w, h, d } = o;
  const bev = Math.min(w, d, h) * 0.12;
  const sw = d - 2 * bev, shh = h - 2 * bev;
  const sh = new THREE.Shape();
  sh.moveTo(-sw / 2, 0); sh.lineTo(sw / 2, 0); sh.lineTo(sw / 2, shh * 0.45);
  sh.bezierCurveTo(sw / 2, shh * 0.95, sw * 0.28, shh, 0, shh);
  sh.bezierCurveTo(-sw * 0.28, shh, -sw / 2, shh * 0.95, -sw / 2, shh * 0.45); sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: w - 2 * bev, bevelEnabled: true, bevelSize: bev, bevelThickness: bev, bevelSegments: 3, curveSegments: 10 });
  g.translate(0, bev, -(w - 2 * bev) / 2); g.rotateY(Math.PI / 2);
  scaleUV(g, 1 / 5);
  b.m(g, tmat(breadTex()), 0, 0, 0);
  const R = rng(hashSeed(o.x, o.z, 3));
  const n = Math.max(2, Math.round(w / 2.2));
  for (let i = 0; i < n; i++) {
    const x = lerp(-w * 0.36, w * 0.36, n === 1 ? 0.5 : i / (n - 1));
    b.sp(tmat(null, '#f2d8a0'), 1, x, h - h * 0.045, (R() - 0.5) * d * 0.08, 12, { sx: w * 0.035, sy: h * 0.06, sz: d * 0.3, ry: 0.6 });
  }
  b.box(-w / 2, 0, -d / 2, w / 2, h, d / 2);
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

/** Butter block on a porcelain dish. */
export function butter(o: { x: number; y: number; z: number; w?: number; h?: number; d?: number; rotY?: number }): Built {
  const b = new B('butter');
  const w = o.w ?? 4, h = o.h ?? 1.6, d = o.d ?? 2.6;
  const dw = w * 1.4, dd = d * 1.5, dh = 0.3;
  b.m(new RoundedBoxGeometry(dw, dh, dd, 2, 0.12), tmat(null, '#f6f0e4'), 0, dh / 2, 0);
  b.bx(tmat(null, '#7aa8e0'), dw * 0.92, 0.04, dd * 0.92, 0, dh, 0);
  b.bx(tmat(null, '#f6f0e4'), dw * 0.86, 0.08, dd * 0.86, 0, dh, 0);
  b.m(new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.08), tmat(null, '#ffe27a'), 0, dh + h / 2, 0);
  b.m(cg('curl', () => new THREE.TorusGeometry(1, 0.35, 8, 16, Math.PI * 1.4)), tmat(null, '#fff0a0'), w * 0.15, dh + h + 0.05, 0, { s: Math.min(w, d) * 0.12, rx: -Math.PI / 2 + 0.3 });
  b.box(-dw / 2, 0, -dd / 2, dw / 2, dh, dd / 2);
  b.box(-w / 2, dh, -d / 2, w / 2, dh + h, d / 2);
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

/** Sparkly sugar cube of size s. */
export function sugarCube(o: { x: number; y: number; z: number; s: number }): Built {
  const b = new B('sugar');
  const s = o.s;
  b.m(new RoundedBoxGeometry(s, s, s, 2, s * 0.06), tmat(sugarTex()), 0, s / 2, 0);
  b.box(-s / 2, 0, -s / 2, s / 2, s, s / 2);
  return b.done(o.x, o.y, o.z, 0);
}

// ───────────────────────── tableware & food ─────────────────────────

/** Porcelain plate (r≈3–7). Collider top = the inner well (rim is ~0.15 higher, visual only). */
export function plate(o: { x: number; y: number; z: number; r: number; accent?: string }): Built & { top: number } {
  const b = new B('plate');
  const T = clamp(o.r * 0.1, 0.35, 0.9);
  const geo = latheC('plate', [[0, 0.04, 0], [0.5, 0.04, 0.12], [0.55, 0, 0.16, 1], [0.6, 0, 0.18], [0.66, 0.12, 0.24], [0.94, 0.62, 0.4], [1.0, 0.8, 0.45, 1], [0.98, 0.95, 0.48], [0.92, 0.98, 0.52], [0.72, 0.62, 0.64], [0.64, 0.55, 0.7], [0, 0.55, 1.0]], 40);
  b.m(geo, tmat(plateTex(o.accent)), 0, 0, 0, { sx: o.r, sy: T, sz: o.r });
  const top = T * 0.55 + 0.04;
  b.cyl(0, 0, o.r * 0.97, 0, top);
  return Object.assign(b.done(o.x, o.y, o.z, 0), { top: o.y + top });
}

/** Teacup on a saucer with a handle (+X). Walk on the saucer and on the tea surface. */
export function cup(o: { x: number; y: number; z: number; r: number; h: number; color?: string; rotY?: number }): Built {
  const b = new B('cup');
  const { r, h } = o;
  const color = o.color ?? '#2e86c1';
  const rs = r * 1.55, ts = clamp(h * 0.1, 0.2, 0.5);
  b.m(latheC('saucer', [[0, 0, 0], [0.62, 0, 0.1, 1], [0.68, 0.12, 0.15], [0.95, 0.6, 0.4], [1, 0.82, 0.45, 1], [0.94, 1.0, 0.5], [0.66, 0.55, 0.68], [0, 0.55, 1]], 36), tmat(plateTex(color)), 0, 0, 0, { sx: rs, sy: ts, sz: rs });
  const yb = ts * 0.55;
  const body = latheC('cup', [[0, 0, 0], [0.55, 0, 0.05, 1], [0.6, 0.05, 0.08], [0.78, 0.3, 0.25], [0.95, 0.7, 0.45], [1, 1, 0.6, 1], [0.95, 1.0, 0.64, 1], [0.935, 0.91, 0.75], [0, 0.91, 1]], 32);
  b.m(body, tmat(porcelainTex(color, 0.22, 0.42)), 0, yb, 0, { sx: r, sy: h, sz: r });
  const tea = tmat(liquidTex('tea'), '#ffffff', { decal: true });
  b.m(cg('disc32', () => new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2)), tea, 0, yb + h * 0.925, 0, { s: r * 0.945, cast: false });
  b.m(cg('handle', () => new THREE.TorusGeometry(1, 0.22, 10, 20, Math.PI * 1.25)), tmat(null, '#fbf6ec'), r * 0.92, yb + h * 0.55, 0, { s: h * 0.3, rz: -Math.PI * 0.625 });
  b.cyl(0, 0, rs * 0.97, 0, ts * 0.55);
  b.cyl(0, 0, r * 0.72, yb, yb + h * 0.45);
  b.cyl(0, 0, r * 0.97, yb + h * 0.45, yb + h * 0.92);
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

/** Golden goblet with gems and wine. Stacked cylinder colliders (base / stem / cup). */
export function goblet(o: { x: number; y: number; z: number; r: number; h: number }): Built {
  const b = new B('goblet');
  const { r, h } = o;
  const geo = latheC('goblet', [[0, 0, 0], [0.8, 0, 0.05, 1], [0.8, 0.04, 0.08], [0.6, 0.07, 0.12], [0.22, 0.1, 0.16], [0.16, 0.2, 0.22], [0.26, 0.28, 0.26], [0.16, 0.36, 0.3], [0.15, 0.48, 0.36], [0.3, 0.53, 0.4], [0.7, 0.62, 0.5], [0.95, 0.8, 0.62], [1, 1, 0.75, 1], [0.93, 1, 0.78, 1], [0.9, 0.93, 0.82], [0, 0.93, 1]], 32);
  b.m(geo, goldM(), 0, 0, 0, { sx: r, sy: h, sz: r });
  b.m(cg('disc32', () => new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2)), tmat(liquidTex('wine')), 0, h * 0.955, 0, { s: r * 0.94 });
  const gems = ['#e8283a', '#2e86c1', '#27ae60', '#e8283a'];
  gems.forEach((c, i) => {
    const a = i / gems.length * TAU + 0.4;
    b.sp(tmat(null, c, { emissive: c, emissiveIntensity: 0.25 }), r * 0.1, Math.sin(a) * r * 0.86, h * 0.76, Math.cos(a) * r * 0.86, 10);
  });
  b.cyl(0, 0, r * 0.8, 0, h * 0.07);
  b.cyl(0, 0, r * 0.24, h * 0.07, h * 0.55);
  b.cyl(0, 0, r * 0.62, h * 0.55, h * 0.7);
  b.cyl(0, 0, r * 0.98, h * 0.7, h * 0.955);
  return b.done(o.x, o.y, o.z, 0);
}

function dripGeo(r: number, top: number, len: number, R: () => number): THREE.BufferGeometry {
  const N = 64;
  const drips: [number, number, number][] = [];
  const nd = 7 + Math.floor(R() * 5);
  for (let i = 0; i < nd; i++) drips.push([R() * TAU, rr(R, 0.12, 0.28), rr(R, 0.5, 1)]);
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const a = i / N * TAU;
    let L = 0.28;
    for (const [da, wdt, amp] of drips) { let dd = Math.abs(a - da); dd = Math.min(dd, TAU - dd); if (dd < wdt) L = Math.max(L, 0.28 + amp * 0.72 * Math.cos(dd / wdt * Math.PI / 2)); }
    const sx = Math.sin(a), cz = Math.cos(a);
    pos.push(sx * r, top, cz * r, sx * r, top - len * L, cz * r);
    nor.push(sx, 0, cz, sx, 0, cz);
    uv.push(i / N, 1, i / N, 0);
  }
  for (let i = 0; i < N; i++) { const a = i * 2, b2 = a + 1, c = a + 2, d = a + 3; idx.push(a, b2, c, c, b2, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Layered cake with icing drips, cream dollops and cherries. One cylinder collider per tier. */
export function cake(o: { x: number; y: number; z: number; r: number; h: number; tiers?: number; seed?: number }): Built {
  const b = new B('cake');
  const R = rng(seedOf(o));
  const nt = o.tiers ?? (o.h >= 5 ? 3 : 2);
  const fr = nt === 3 ? [0.42, 0.33, 0.25] : nt === 2 ? [0.58, 0.42] : [1];
  const rad = nt === 3 ? [1, 0.72, 0.46] : nt === 2 ? [1, 0.66] : [1];
  const sponge = ['#ff9ec4', '#fff0d8', '#7a4528'];
  const icing = ['#fff6ee', '#ff6fa8', '#ffb8d8'];
  let y = 0;
  for (let i = 0; i < nt; i++) {
    const ri = o.r * rad[i], hi = o.h * fr[i];
    b.cy(tmat(null, sponge[i % 3]), ri, hi, 0, y, 0, 40);
    const top = y + hi;
    const ic = tmat(null, icing[i % 3]);
    // icing cap sits 0.03 ABOVE the sponge top (its top face used to be coplanar with the sponge's → z-fight)
    const ih = Math.min(0.14, hi * 0.05);
    b.cy(ic, ri * 1.02, ih + 0.03, 0, top - ih, 0, 40);
    b.m(dripGeo(ri * 1.03, top + 0.03, hi * 0.55, R), tmat(null, icing[i % 3], { side: THREE.DoubleSide }), 0, 0, 0);
    // stripe of jam between layers (clearly proud of the sponge side)
    b.cy(tmat(null, PAL.jamRed), ri * 1.012, hi * 0.06, 0, y + hi * 0.3, 0, 40);
    const nd = Math.max(8, Math.round(ri * 3.2));
    for (let k = 0; k < nd; k++) {
      const a = k / nd * TAU;
      b.sp(ic, Math.min(0.35, ri * 0.08), Math.sin(a) * ri * 0.9, top + 0.02, Math.cos(a) * ri * 0.9, 10, { sy: Math.min(0.35, ri * 0.08) * 0.8 });
    }
    y = top;
  }
  const rt = o.r * rad[nt - 1];
  const nc = 3 + Math.floor(R() * 3);
  const cherries: [number, number, number][] = [];
  for (let k = 0; k < nc; k++) {
    const a = k / nc * TAU + R(), d = k === 0 ? 0 : rt * 0.42;
    const cr = Math.max(0.3, rt * 0.14);
    const cx = Math.sin(a) * d, cz = Math.cos(a) * d;
    b.sp(tmat(null, '#d01e3a'), cr, cx, y + cr * 0.8, cz, 14);
    cherries.push([cx, cz, cr]);
    b.sp(bmat('#ffffff', { opacity: 0.7 }), cr * 0.25, cx - cr * 0.35, y + cr * 1.2, cz + cr * 0.45, 8, { glow: true });
    b.m(unitCyl(6), tmat(null, '#4a7a2a'), cx, y + cr * 1.6, cz, { sx: cr * 0.1, sy: cr * 1.3, sz: cr * 0.1, rz: 0.4 });
  }
  const topY = y;
  y = 0;
  for (let i = 0; i < nt; i++) { const hi = o.h * fr[i]; b.cyl(0, 0, o.r * rad[i] * 1.0, y, y + hi); y += hi; }
  for (const [cx, cz, cr] of cherries) b.cyl(cx, cz, cr * 0.85, topY, topY + cr * 1.7, { tag: 'cherry' });
  return b.done(o.x, o.y, o.z, 0);
}

/**
 * Bowl (r≈4–7, h≈3–5): rim = ring of thin cylinder colliders, inner floor collider, and for soup a
 * hazard filling the inside below the surface. Spaghetti: walkable noodle mound.
 */
export function bowl(o: { x: number; y: number; z: number; r: number; h: number; contents: 'soup' | 'spaghetti' | 'empty'; color?: string }): Built {
  const b = new B('bowl');
  const { r, h } = o;
  const tt = clamp(0.45 / r, 0.05, 0.12);
  const geo = latheV([[0, 0, 0], [0.6, 0, 0.04, 1], [0.64, 0.04, 0.06], [0.62, 0.08, 0.08, 1], [0.72, 0.1, 0.12], [0.9, 0.3, 0.25], [0.98, 0.6, 0.38], [1, 0.97, 0.48], [1 - tt * 0.5, 1.03, 0.52], [1 - tt, 0.97, 0.56], [1 - tt * 1.05, 0.62, 0.66], [0.85, 0.32, 0.8], [0.6, 0.16, 0.9], [0, 0.14, 1]], 40);
  b.m(geo, tmat(porcelainTex(o.color ?? '#c0392b', 0.28, 0.42)), 0, 0, 0, { sx: r, sy: h, sz: r });
  const ri = r * (1 - tt);
  let floor = h * 0.14;
  if (o.contents === 'soup') {
    const sy = h * 0.8;
    const tx = liquidTex('soup').clone(); tx.needsUpdate = true;
    const surf = b.m(cg('disc40', () => new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2)), tmat(tx), 0, sy, 0, { s: ri * 1.0, keep: true });
    surf.castShadow = false;
    tx.repeat.set(r / 4, r / 4);
    floor = sy - 0.6;
    const bubbles: THREE.Mesh[] = [];
    const R = rng(hashSeed(o.x, o.z, 11));
    const bm = tmat(null, '#ff9a4a');
    for (let i = 0; i < 4; i++) {
      const m = b.sp(bm, 1, 0, sy, 0, 10, { dyn: true, s: 0.01 });
      m.userData.ph = R() * 5; m.userData.max = rr(R, 0.25, 0.5);
      bubbles.push(m);
    }
    const steam: THREE.Sprite[] = [];
    for (let i = 0; i < 3; i++) { const s = glowSprite('#ffffff', 0.18); s.userData.dyn = true; s.userData.ph = i / 3; b.root.add(s); steam.push(s); }
    b.update((t) => {
      tx.offset.set(t * 0.015, t * 0.01);
      for (const m of bubbles) {
        const k = ((t * 0.6 + m.userData.ph) % 1);
        if (k < 0.02) { const a = R() * TAU, d = R() * ri * 0.7; m.position.set(Math.sin(a) * d, sy, Math.cos(a) * d); }
        const s = k < 0.85 ? (k / 0.85) * m.userData.max : 0.01;
        m.scale.setScalar(Math.max(0.01, s));
      }
      for (const s of steam) {
        const k = (t * 0.25 + s.userData.ph) % 1;
        s.position.set(Math.sin(k * 5 + s.userData.ph * 9) * ri * 0.3, sy + 0.5 + k * r * 0.9, Math.cos(s.userData.ph * 7) * ri * 0.3);
        s.scale.setScalar(r * (0.5 + k * 0.9));
      }
    });
    const hz0 = floor, hz1 = sy - 0.15;
    b.hazard(-ri * 0.7, hz0, -ri * 0.7, ri * 0.7, hz1, ri * 0.7, 'soup', 1);
    b.hazard(-ri * 0.93, hz0, -ri * 0.38, ri * 0.93, hz1, ri * 0.38, 'soup', 1);
    b.hazard(-ri * 0.38, hz0, -ri * 0.93, ri * 0.38, hz1, ri * 0.93, 'soup', 1);
  } else if (o.contents === 'spaghetti') {
    const base = h * 0.62, mh = h * 0.36;
    b.m(unitDome(24), tmat(noodleTex()), 0, base, 0, { sx: ri * 0.98, sy: mh, sz: ri * 0.98 });
    b.sp(tmat(null, PAL.sauce), 1, 0, base + mh * 0.92, 0, 16, { sx: ri * 0.38, sy: mh * 0.16, sz: ri * 0.34 });
    const R = rng(hashSeed(o.x, o.z, 5));
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * TAU + R(), d = ri * rr(R, 0.25, 0.55);
      const yy = base + mh * Math.sqrt(Math.max(0, 1 - (d / (ri * 0.98)) ** 2));
      b.sp(tmat(null, PAL.meatball), ri * 0.14, Math.sin(a) * d, yy, Math.cos(a) * d, 14);
    }
    floor = base + mh * 0.88;
  }
  b.cyl(0, 0, ri, 0, floor);
  // rim ring
  const Rr = r * (1 - tt / 2);
  let rc = Math.max(r * tt * 0.5 + 0.12, 0.3);
  const N = clamp(Math.ceil(TAU * Rr / (2 * rc + 0.3)), 10, 64);
  rc = Math.max(rc, (TAU * Rr / N - 0.3) / 2); // gaps between rim posts stay < 0.3 (hero is 0.6 wide)
  for (let i = 0; i < N; i++) { const a = i / N * TAU; b.cyl(Math.sin(a) * Rr, Math.cos(a) * Rr, rc, 0, h * 1.03); }
  return b.done(o.x, o.y, o.z, 0);
}

/** Bouncy jelly block (bounce 18). collider.obj = the jelly mesh (pivot bottom-center) for wobble. */
export function jellyBlock(o: { x: number; y: number; z: number; w: number; h: number; d: number; color?: string }): Built {
  const b = new B('jelly');
  const color = o.color ?? PAL.jelly;
  const { w, h, d } = o;
  const rad = Math.min(w, h, d) * 0.18;
  const geo = new RoundedBoxGeometry(w, h, d, 3, rad).translate(0, h / 2, 0);
  const jm = b.m(geo, tmat(null, color, { emissive: color, emissiveIntensity: 0.22, transparent: true, opacity: 0.82 }), 0, 0, 0, { dyn: true });
  b.m(new RoundedBoxGeometry(w * 0.62, h * 0.55, d * 0.62, 2, rad * 0.6).translate(0, h * 0.42, 0), tmat(null, shade(color, -0.3)), 0, 0, 0, { parent: jm, cast: false });
  const shine = bmat('#ffffff', { opacity: 0.75, depthWrite: false, decal: true });
  b.m(cg('plane', () => new THREE.PlaneGeometry(1, 1)), shine, -w * 0.28, h * 0.72, d / 2 + 0.02, { parent: jm, glow: true, sx: w * 0.14, sy: h * 0.32, order: 2 });
  b.m(cg('plane', () => new THREE.PlaneGeometry(1, 1)), shine, -w * 0.12, h * 0.85, d / 2 + 0.02, { parent: jm, glow: true, sx: w * 0.06, sy: h * 0.12, order: 2 });
  b.m(cg('planeUp', () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), shine, -w * 0.2, h + 0.02, -d * 0.15, { parent: jm, glow: true, sx: w * 0.3, sz: d * 0.12, ry: 0.4, order: 2 });
  b.box(-w / 2, 0, -d / 2, w / 2, h, d / 2, { bounce: 18, obj: jm });
  return b.done(o.x, o.y, o.z, 0);
}

/** Crumbly giant cookie (box collider, crumbly). collider.obj = cookie group, pivot at its center. */
export function cookie(o: { x: number; y: number; z: number; r: number; h: number }): Built {
  const b = new B('cookie');
  const { r, h } = o;
  const g = b.group(0, h / 2, 0, undefined, true);
  const geo = cg('cookie', () => planarUV(latheV([[0, -0.5, 0], [0.85, -0.5, 0.3], [0.97, -0.38, 0.4], [1, 0, 0.5], [0.97, 0.38, 0.6], [0.85, 0.5, 0.7], [0, 0.5, 1]], 28), 'x', 'z', 0.5, 0.5, 0.5, 0.5));
  b.m(geo, tmat(cookieTex()), 0, 0, 0, { parent: g, sx: r, sy: h, sz: r });
  const R = rng(hashSeed(o.x, o.z, 9));
  const n = Math.max(4, Math.round(r * 2.2));
  for (let i = 0; i < n; i++) {
    const a = R() * TAU, d = Math.sqrt(R()) * r * 0.78, s = rr(R, 0.18, 0.32) * Math.max(1, r * 0.25);
    b.sp(tmat(null, '#4a2412'), s, Math.sin(a) * d, h / 2 - s * 0.2, Math.cos(a) * d, 8, { parent: g, sy: s * 0.6 });
  }
  b.box(-r * 0.85, 0, -r * 0.85, r * 0.85, h, r * 0.85, { crumbly: true, obj: g });
  return b.done(o.x, o.y, o.z, 0);
}

/** Giant spoon lying flat (bowl toward +X at rotY 0) — a walkable bridge. y = bottom; top = y + thickness. */
export function spoon(o: { x: number; y: number; z: number; len: number; w: number; rotY?: number }): Built & { top: number } {
  const b = new B('spoon');
  const { len, w } = o;
  const T = clamp(w * 0.1, 0.3, 0.7), bv = Math.min(0.08, T * 0.2);
  const bl = len * 0.36, x0 = -len / 2, xn = len / 2 - bl, xb = len / 2 - bl / 2;
  const he = w * 0.19, hn = w * 0.09;
  const s = new THREE.Shape();
  s.moveTo(x0 + he, he);
  s.absarc(x0 + he, 0, he, Math.PI / 2, Math.PI * 1.5, false);
  s.lineTo(xn - len * 0.04, -hn);
  s.quadraticCurveTo(xn + bl * 0.02, -hn, xn + bl * 0.085, -w * 0.28);
  s.absellipse(xb, 0, bl / 2, w / 2, -2.55, 2.55, false, 0);
  s.quadraticCurveTo(xn + bl * 0.02, hn, xn - len * 0.04, hn);
  s.lineTo(x0 + he, he);
  const g = new THREE.ExtrudeGeometry(s, { depth: T - 2 * bv, bevelEnabled: true, bevelSize: bv, bevelThickness: bv, bevelSegments: 2, curveSegments: 20 });
  g.rotateX(-Math.PI / 2); g.translate(0, bv, 0);
  b.m(g, steelM(), 0, 0, 0);
  b.m(cg('disc32', () => new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2)), tmat(null, '#9aa4b4', { decal: true }), xb + bl * 0.03, T + 0.015, 0, { sx: bl * 0.4, sz: w * 0.38, cast: false });
  b.m(cg('disc32', () => new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2)), bmat('#ffffff', { opacity: 0.6, depthWrite: false, decal: true }), xb + bl * 0.12, T + 0.03, -w * 0.12, { sx: bl * 0.14, sz: w * 0.06, ry: 0.3, glow: true, order: 2 });
  b.box(x0, 0, -w * 0.16, xn, T, w * 0.16);
  b.box(xn, 0, -w * 0.42, len / 2 + bv, T, w * 0.42);
  return Object.assign(b.done(o.x, o.y, o.z, o.rotY ?? 0), { top: o.y + T });
}

function drapeGeo(w: number, d: number, top: number, len: number, off: number, tile: number, R: () => number): THREE.BufferGeometry {
  const a = w / 2 + off, c = d / 2 + off, cr = Math.min(0.4, a, c);
  // perimeter (front +Z going +X, then right, back, left) with rounded corners
  const pts: [number, number, number, number][] = []; // x, z, nx, nz
  const seg = (x0: number, z0: number, x1: number, z1: number, nx: number, nz: number) => {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(L / 0.35));
    for (let i = 0; i < n; i++) { const t = i / n; pts.push([lerp(x0, x1, t), lerp(z0, z1, t), nx, nz]); }
  };
  const arc = (cx: number, cz: number, a0: number) => {
    for (let i = 0; i < 4; i++) { const an = a0 + i / 4 * Math.PI / 2; pts.push([cx + Math.sin(an) * cr, cz + Math.cos(an) * cr, Math.sin(an), Math.cos(an)]); }
  };
  seg(-a + cr, c, a - cr, c, 0, 1); arc(a - cr, c - cr, 0);
  seg(a, c - cr, a, -c + cr, 1, 0); arc(a - cr, -c + cr, Math.PI / 2);
  seg(a - cr, -c, -a + cr, -c, 0, -1); arc(-a + cr, -c + cr, Math.PI);
  seg(-a, -c + cr, -a, c - cr, -1, 0); arc(-a + cr, c - cr, Math.PI * 1.5);
  pts.push(pts[0]);
  const rows = 6, N = pts.length;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let sAcc = 0;
  const ph = R() * 10, foldLen = 2.4;
  for (let i = 0; i < N; i++) {
    if (i > 0) sAcc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const [x, z, nx, nz] = pts[i];
    const fold = Math.sin(sAcc / foldLen * TAU + ph);
    const hem = 0.22 * (0.5 + 0.5 * Math.cos(sAcc / 1.2 * TAU));
    for (let k = 0; k < rows; k++) {
      const t = k / (rows - 1);
      const out = Math.pow(t, 1.5) * 0.3 * (0.6 + 0.4 * fold);
      const y = top - t * (len - hem);
      pos.push(x + nx * out, y, z + nz * out);
      uv.push(sAcc / tile, y / tile);
    }
  }
  for (let i = 0; i < N - 1; i++) for (let k = 0; k < rows - 1; k++) {
    const p = i * rows + k, q = (i + 1) * rows + k;
    idx.push(p, p + 1, q, q, p + 1, q + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Giant dining table. y = floor; tabletop surface at y+h (walkable). Legs = trunk-like turned legs (cyl colliders).
 * cloth: checkered tablecloth with draped sides; the drape region is solid (collider spans h-drop..h).
 */
export function table(o: { x: number; y: number; z: number; w: number; d: number; h: number; cloth?: boolean; drop?: number; rotY?: number; seed?: number }): Built & { top: number } {
  const b = new B('table');
  const { w, d, h } = o;
  const R = rng(seedOf(o));
  const cloth = o.cloth ?? true;
  const tt = clamp(h * 0.08, 0.8, 2.0);
  const ct = cloth ? 0.06 : 0;
  const wood = woodM('warm');
  b.bx(wood, w, tt, d, 0, h - ct - tt / 2, 0, 8);
  const rl = clamp(Math.min(w, d) * 0.06 + h * 0.03, 1.0, 3.6); // trunk-like legs
  const legH = h - ct - tt;
  const inset = rl * 1.5;
  const legGeo = latheC('tableLeg', [[0, 0, 0], [0.85, 0, 0.02, 1], [1, 0.03, 0.05], [1, 0.06, 0.08], [0.72, 0.09, 0.1], [0.92, 0.14, 0.14], [0.66, 0.2, 0.2], [0.56, 0.45, 0.4], [0.72, 0.6, 0.55], [0.6, 0.66, 0.6], [0.62, 0.84, 0.8], [0.86, 0.9, 0.85], [0.86, 1, 0.95, 1], [0, 1, 1]], 24);
  const legs: [number, number][] = [[-w / 2 + inset, -d / 2 + inset], [w / 2 - inset, -d / 2 + inset], [-w / 2 + inset, d / 2 - inset], [w / 2 - inset, d / 2 - inset]];
  for (const [lx, lz] of legs) {
    b.m(legGeo, tmat(woodGrainTex('dark')), lx, 0, lz, { sx: rl, sy: legH, sz: rl });
    b.cyl(lx, lz, rl * 0.88, 0, legH);
  }
  // apron boards
  const ah = Math.min(1.6, legH * 0.12), at = Math.max(0.4, rl * 0.4);
  b.bx(wood, w - 2 * inset, ah, at, 0, legH - ah / 2, d / 2 - inset, 6);
  b.bx(wood, w - 2 * inset, ah, at, 0, legH - ah / 2, -d / 2 + inset, 6);
  b.bx(wood, at, ah, d - 2 * inset, w / 2 - inset, legH - ah / 2, 0, 6);
  b.bx(wood, at, ah, d - 2 * inset, -w / 2 + inset, legH - ah / 2, 0, 6);
  if (cloth) {
    const drop = o.drop ?? Math.min(h * 0.32, 6);
    const off = 0.15;
    const ctex = tableclothTex();
    b.bx(tmat(ctex), w + 2 * off, ct, d + 2 * off, 0, h - ct / 2, 0, 5);
    b.m(drapeGeo(w, d, h - 0.02, drop, off, 5, R), tmat(ctex, '#ffffff', { side: THREE.DoubleSide }), 0, 0, 0);
    b.box(-w / 2 - off - 0.25, h - drop, -d / 2 - off - 0.25, w / 2 + off + 0.25, h, d / 2 + off + 0.25);
  } else {
    b.box(-w / 2, h - tt, -d / 2, w / 2, h, d / 2);
    b.box(-w / 2 + inset - at / 2, legH - ah, -d / 2 + inset - at / 2, w / 2 - inset + at / 2, legH, d / 2 - inset + at / 2);
  }
  return Object.assign(b.done(o.x, o.y, o.z, o.rotY ?? 0), { top: o.y + h });
}

/** Patch of upright fork tines stuck in the surface at height y (hazard on the tine region). */
export function forkRow(o: { x: number; y: number; z: number; w: number; d: number; seed?: number; dmg?: number }): Built {
  const b = new B('forks');
  const R = rng(seedOf(o));
  const sm = steelM();
  const nx = Math.max(1, Math.floor(o.w / 1.25)), nz = Math.max(1, Math.floor(o.d / 1.5));
  let maxTop = 0;
  const slot = tmat(null, '#2a1b1a', { decal: true });
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
    const fx = (nx === 1 ? 0 : lerp(-o.w / 2 + 0.5, o.w / 2 - 0.5, i / (nx - 1))) + (R() - 0.5) * 0.2;
    const fz = (nz === 1 ? 0 : lerp(-o.d / 2 + 0.5, o.d / 2 - 0.5, k / (nz - 1))) + (R() - 0.5) * 0.3;
    const th = rr(R, 1.2, 1.6);
    maxTop = Math.max(maxTop, th + 0.3);
    const g = b.group(fx, 0, fz);
    g.rotation.set((R() - 0.5) * 0.14, (R() - 0.5) * 0.6, (R() - 0.5) * 0.14);
    b.m(cg('forkNeck', () => new RoundedBoxGeometry(0.86, 0.42, 0.2, 1, 0.07)), sm, 0, 0.14, 0, { parent: g });
    for (let t = 0; t < 4; t++) {
      const tx = -0.3 + t * 0.2;
      b.bx(sm, 0.13, th - 0.3, 0.15, tx, 0.3 + (th - 0.3) / 2, 0, 0, { parent: g });
      b.m(cg('tip', () => new THREE.ConeGeometry(0.095, 0.32, 4).translate(0, 0.16, 0)), sm, tx, th - 0.02, 0, { parent: g, ry: Math.PI / 4 });
    }
    b.m(cg('disc16', () => new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2)), slot, fx, 0.02, fz, { sx: 0.5, sz: 0.14, ry: g.rotation.y, cast: false });
  }
  b.hazard(-o.w / 2 + 0.15, 0.35, -o.d / 2 + 0.15, o.w / 2 - 0.15, maxTop - 0.05, o.d / 2 - 0.15, 'forks', o.dmg ?? 1);
  return b.done(o.x, o.y, o.z, 0);
}

/** Liquid pool surface at height y (soup or jam) with waves & bubbles. Hazard from y-2 to y-0.15. */
export function pool(o: { x: number; y: number; z: number; w: number; d: number; kind: 'soup' | 'jam'; dmg?: number }): Built {
  const b = new B('pool');
  const { w, d } = o;
  const sx = clamp(Math.ceil(w / 1.2), 4, 48), sz = clamp(Math.ceil(d / 1.2), 4, 48);
  const geo = new THREE.PlaneGeometry(w, d, sx, sz).rotateX(-Math.PI / 2);
  const tile = 6;
  planarUV(geo, 'x', 'z', 1 / tile, 1 / tile);
  const tx = liquidTex(o.kind).clone(); tx.needsUpdate = true;
  const surf = b.m(geo, tmat(tx, '#ffffff', { emissive: o.kind === 'soup' ? '#5a1a00' : '#3a0010', emissiveIntensity: 0.35 }), 0, 0, 0, { dyn: true, cast: false });
  // dark basin below so the gap never looks empty
  b.m(boxGeo(w, 2.4, d), tmat(null, o.kind === 'soup' ? '#5a2010' : '#3a0812', { side: THREE.BackSide }), 0, -1.22, 0, { cast: false, receive: false });
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const base = Float32Array.from(pos.array as Float32Array);
  const R = rng(hashSeed(o.x, o.z, 13));
  const amp = o.kind === 'soup' ? 0.13 : 0.08, spd = o.kind === 'soup' ? 1.6 : 0.8;
  const bubbles: THREE.Mesh[] = [];
  const bm = tmat(null, o.kind === 'soup' ? '#ffa25a' : '#e8344e');
  const nb = clamp(Math.round(w * d / 30), 2, 10);
  for (let i = 0; i < nb; i++) {
    const m = b.sp(bm, 1, 0, 0, 0, 10, { dyn: true, s: 0.01 });
    m.userData.ph = R(); m.userData.max = rr(R, 0.25, 0.55);
    bubbles.push(m);
  }
  let frame = 0;
  b.update((t) => {
    tx.offset.set(t * 0.01 * spd, t * 0.007 * spd);
    if ((frame++ & 1) === 0) {
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3], z = base[i * 3 + 2];
        pos.setY(i, amp * (Math.sin(x * 0.7 + t * spd * 1.8) + Math.sin(z * 0.9 - t * spd * 1.3) + 0.5 * Math.sin((x + z) * 1.7 + t * spd * 2.6)));
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
    }
    for (const m of bubbles) {
      const k = (t * 0.45 + m.userData.ph) % 1;
      if (k < 0.02 || m.position.y === 0) m.position.set((R() - 0.5) * (w - 1), 0.02, (R() - 0.5) * (d - 1));
      m.scale.set(1, 0.75, 1).multiplyScalar(Math.max(0.01, k < 0.85 ? (k / 0.85) * m.userData.max : 0.01));
    }
  });
  surf.frustumCulled = false;
  b.hazard(-w / 2 + 0.15, -2, -d / 2 + 0.15, w / 2 - 0.15, -0.15, d / 2 - 0.15, o.kind, o.dmg ?? 1);
  return b.done(o.x, o.y, o.z, 0);
}

// ───────────────────────── lights ─────────────────────────

/** Big candle (top of wax at y+h) with drips, brass holder, flickering flame and optional warm PointLight. */
export function candle(o: { x: number; y: number; z: number; r: number; h: number; light?: boolean; color?: string; holder?: boolean; intensity?: number; distance?: number }): Built {
  const b = new B('candle');
  const R = rng(hashSeed(o.x, o.y, o.z));
  const { r, h } = o;
  const holder = o.holder ?? true;
  const hb = holder ? clamp(r * 0.28, 0.2, 0.6) : 0;
  const y0 = holder ? hb * 0.45 : 0;
  const wh = h - y0;
  const wax = o.color ?? '#fff3da';
  const wm = tmat(null, wax), dm = tmat(null, shade(wax, -0.06));
  if (holder) {
    b.m(latheC('holder', [[0, 0, 0], [0.8, 0, 0.1, 1], [0.85, 0.3, 0.2], [1, 0.8, 0.4], [1, 1, 0.5, 1], [0.93, 1, 0.55], [0.75, 0.45, 0.7], [0, 0.45, 1]], 28), goldM(), 0, 0, 0, { sx: r * 1.6, sy: hb, sz: r * 1.6 });
    b.m(cg('torus16b', () => new THREE.TorusGeometry(1, 0.22, 8, 16)), goldM(), r * 1.75, hb * 0.6, 0, { s: r * 0.35, rx: Math.PI / 2 });
    b.cyl(0, 0, r * 1.6 * 0.97, 0, hb);
  }
  b.m(latheC('wax', [[0, 0, 0], [1, 0, 0.05, 1], [1, 0.97, 0.9], [0.94, 1, 0.95], [0.6, 0.975, 0.98], [0, 0.96, 1]], 28), wm, 0, y0, 0, { sx: r, sy: wh, sz: r });
  // drips
  const nd = 3 + Math.floor(R() * 4);
  for (let i = 0; i < nd; i++) {
    const a = (i + R() * 0.6) / nd * TAU, L = rr(R, 0.15, 0.6) * wh, dr = r * rr(R, 0.13, 0.2);
    const cx = Math.sin(a) * r * 0.96, cz = Math.cos(a) * r * 0.96;
    b.m(cg('capsule', () => new THREE.CapsuleGeometry(1, 1, 4, 8)), dm, cx, y0 + wh - L / 2 - dr * 0.4, cz, { sx: dr, sy: L / 2, sz: dr });
    b.sp(dm, dr * 1.3, cx, y0 + wh - L - dr * 0.2, cz, 10);
  }
  b.m(cg('torus48', () => new THREE.TorusGeometry(1, 0.035, 8, 48)), wm, 0, y0 + wh - r * 0.09, 0, { rx: Math.PI / 2, s: r * 0.96, sz: r * 2.4 });
  const wr = clamp(r * 0.06, 0.05, 0.14);
  b.cy(tmat(null, '#2a1b1a'), wr, Math.max(0.3, r * 0.25), 0, y0 + wh * 0.96, 0, 6);
  const fh = clamp(r * 0.9, 0.5, 2.2);
  const flame = addFlame(b, b.root, 0, y0 + wh * 0.96 + Math.max(0.3, r * 0.25) * 0.6, 0, fh, R);
  let light: THREE.PointLight | null = null;
  const base = o.intensity ?? 28;
  if (o.light) light = b.light('#ffb45a', base, o.distance ?? 25, 1.5, 0, h + fh * 0.7, 0);
  b.update((t) => { const k = flicker(flame, t); if (light) light.intensity = base * (0.82 + 0.18 * (k - 0.8) / 0.4); });
  b.cyl(0, 0, r, y0, h);
  return b.done(o.x, o.y, o.z, 0);
}

/** Hanging chandelier: (x,y,z) = ring center; chain goes up `chain` units. One PointLight. Decor only. */
export function chandelier(o: { x: number; y: number; z: number; r: number; chain?: number; light?: boolean; intensity?: number; distance?: number }): Built {
  const b = new B('chandelier');
  const R = rng(hashSeed(o.x, o.y, o.z));
  const { r } = o;
  const L = o.chain ?? 10;
  const swing = b.group(0, L, 0, undefined, true);
  const inner = b.group(0, -L, 0, swing);
  const im = ironM(), gm = goldM();
  const link = cg('link', () => new THREE.TorusGeometry(0.22, 0.06, 6, 12));
  for (let y = 0.4, i = 0; y < L; y += 0.42, i++) b.m(link, im, 0, y, 0, { parent: inner, ry: i % 2 ? Math.PI / 2 : 0, sy: 1.3 });
  b.m(cg('torus64', () => new THREE.TorusGeometry(1, 0.06, 8, 64)), gm, 0, 0, 0, { parent: inner, rx: Math.PI / 2, s: r, sz: r * 1.6 });
  b.m(cg('torus64', () => new THREE.TorusGeometry(1, 0.06, 8, 64)), im, 0, -0.35, 0, { parent: inner, rx: Math.PI / 2, s: r * 0.55, sz: r * 1.2 });
  for (let i = 0; i < 4; i++) b.m(unitCyl(6), im, 0, 0, 0, { parent: inner, sx: 0.07, sy: r, sz: 0.07, rz: Math.PI / 2, ry: i / 4 * TAU });
  b.sp(gm, Math.max(0.35, r * 0.14), 0, 0, 0, 14, { parent: inner });
  b.m(cg('finial', () => new THREE.ConeGeometry(1, 2, 12).translate(0, -1, 0)), gm, 0, -Math.max(0.35, r * 0.14), 0, { parent: inner, s: Math.max(0.25, r * 0.1) });
  const n = Math.max(4, Math.round(r * 2));
  const flames: Flame[] = [];
  const wm = tmat(null, '#fff3da');
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU;
    const cx = Math.sin(a) * r, cz = Math.cos(a) * r;
    b.m(latheC('cupC', [[0, 0, 0], [0.5, 0, 0.2], [1, 0.6, 0.6], [1, 1, 0.8, 1], [0, 1, 1]], 12), gm, cx, 0.02, cz, { parent: inner, s: 0.32, sy: 0.25 });
    b.cy(wm, 0.16, 0.9, cx, 0.2, cz, 10, { parent: inner });
    flames.push(addFlame(b, inner, cx, 1.18, cz, 0.55, R));
  }
  const base = o.intensity ?? 55;
  let light: THREE.PointLight | null = null;
  if (o.light ?? true) light = b.light('#ffbe6a', base, o.distance ?? 40, 1.5, 0, 0.8, 0, inner);
  b.update((t) => {
    let k = 0;
    for (const f of flames) k += flicker(f, t);
    if (light) light.intensity = base * (0.85 + 0.15 * (k / flames.length - 0.8) / 0.4);
    swing.rotation.z = 0.025 * Math.sin(t * 0.6);
    swing.rotation.x = 0.018 * Math.sin(t * 0.47 + 1);
  });
  return b.done(o.x, o.y, o.z, 0);
}

/** Wall torch: (x,y,z) = bracket on the wall face, front = +Z (rotY quarter turns). Flame ≈1.1 above y. */
export function torch(o: { x: number; y: number; z: number; rotY?: number; light?: boolean; intensity?: number; distance?: number }): Built {
  const b = new B('torch');
  const R = rng(hashSeed(o.x, o.y, o.z));
  const im = ironM();
  b.bx(im, 0.5, 0.8, 0.1, 0, 0, 0.05);
  b.bx(im, 0.12, 0.12, 0.55, 0, -0.1, 0.35, 0, { rx: -0.35 });
  b.m(cg('torus16b', () => new THREE.TorusGeometry(1, 0.22, 8, 16)), im, 0, 0.0, 0.55, { s: 0.2, rx: Math.PI / 2 });
  const stick = b.group(0, 0, 0.55);
  stick.rotation.x = 0.3;
  b.m(cg('stick', () => new THREE.CylinderGeometry(0.11, 0.07, 1.5, 8).translate(0, 0.1, 0)), woodM('dark'), 0, 0, 0, { parent: stick });
  b.m(unitCyl(10), tmat(null, '#5a3a28'), 0, 0.72, 0, { parent: stick, sx: 0.17, sy: 0.36, sz: 0.17 });
  const flame = addFlame(b, stick, 0, 1.04, 0, 0.9, R);
  const base = o.intensity ?? 34;
  let light: THREE.PointLight | null = null;
  if (o.light ?? true) light = b.light('#ff9a40', base, o.distance ?? 25, 1.5, 0, 1.6, 0.9);
  b.update((t) => { const k = flicker(flame, t); if (light) light.intensity = base * (0.8 + 0.2 * (k - 0.8) / 0.4); });
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

// ───────────────────────── storage & hanging ─────────────────────────

/** Burlap sack tied with rope (optional stencil label). Collider = body up to the shoulder. */
export function sack(o: { x: number; y: number; z: number; r?: number; h?: number; label?: string; rotY?: number }): Built {
  const b = new B('sack');
  const r = o.r ?? 1.6, h = o.h ?? 3.4;
  const geo = cg('sack', () => scaleUV(latheV([[0, 0, 0], [0.8, 0, 0.05, 1], [0.95, 0.06, 0.1], [1, 0.3, 0.3], [0.97, 0.6, 0.5], [0.85, 0.75, 0.6], [0.45, 0.86, 0.7], [0.32, 0.88, 0.75], [0.34, 0.9, 0.78], [0.5, 0.97, 0.85], [0.56, 1.0, 0.9], [0.3, 0.97, 0.95], [0, 0.95, 1]], 28), 4, 2.5));
  b.m(geo, tmat(burlapTex()), 0, 0, 0, { sx: r * 1.04, sy: h, sz: r * 0.97 });
  b.m(cg('torus48', () => new THREE.TorusGeometry(1, 0.035, 8, 48)), tmat(null, '#8a6a3a'), 0, h * 0.885, 0, { rx: Math.PI / 2, s: r * 0.34, sz: r * 1.2 });
  if (o.label) b.m(bandGeo(r * 1.0, h * 0.28, h * 0.55, 1.4, 14), tmat(stencilTex(o.label), '#ffffff', { alphaTest: 0.4 }), 0, 0, 0);
  b.cyl(0, 0, r * 0.92, 0, h * 0.72);
  b.cyl(0, 0, r * 0.4, h * 0.72, h * 0.98); // tied neck: bump you can hop onto
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

/** Glass bottle with cork & label. Colliders: body / shoulder / neck. */
export function bottle(o: { x: number; y: number; z: number; r: number; h: number; color?: string; label?: string; rotY?: number }): Built {
  const b = new B('bottle');
  const { r, h } = o;
  const color = o.color ?? '#2f7a3a';
  b.m(latheC('bottle', [[0, 0, 0], [0.92, 0, 0.03, 1], [1, 0.04, 0.06], [1, 0.55, 0.4], [0.9, 0.64, 0.48], [0.5, 0.72, 0.56], [0.36, 0.78, 0.62], [0.34, 0.92, 0.8], [0.4, 0.93, 0.82, 1], [0.4, 0.96, 0.85, 1], [0.3, 0.96, 0.87], [0, 0.96, 1]], 28), tmat(null, color, { emissive: color, emissiveIntensity: 0.15 }), 0, 0, 0, { sx: r, sy: h, sz: r });
  b.cy(tmat(null, '#c8a070'), r * 0.29, h * 0.06, 0, h * 0.94, 0, 12);
  b.m(bandGeo(r * 1.012, h * 0.16, h * 0.44, 1.6, 14), tmat(bottleLabelTex(o.label ?? 'ВИНО'), '#ffffff', { alphaTest: 0.5 }), 0, 0, 0);
  b.m(bandGeo(r * 1.006, h * 0.08, h * 0.52, 0.12, 2), bmat('#ffffff', { opacity: 0.45, depthWrite: false }), 0, 0, 0, { ry: -0.9, glow: true, order: 2 });
  b.cyl(0, 0, r, 0, h * 0.6);
  b.cyl(0, 0, r * 0.62, h * 0.6, h * 0.73);
  b.cyl(0, 0, r * 0.4, h * 0.73, h);
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

/** Wooden barrel with iron hoops; walkable lid. */
export function barrel(o: { x: number; y: number; z: number; r?: number; h?: number }): Built {
  const b = new B('barrel');
  const r = o.r ?? 2.2, h = o.h ?? 4.6;
  b.m(latheC('barrel', [[0.86, 0, 0, 1], [0.88, 0.02, 0.02], [0.97, 0.25, 0.25], [1, 0.5, 0.5], [0.97, 0.75, 0.75], [0.88, 0.98, 0.97], [0.86, 1, 0.99, 1], [0.8, 1, 1, 1], [0.8, 0.95, 1]], 28), tmat(barrelTex()), 0, 0, 0, { sx: r, sy: h, sz: r });
  b.m(planarUV(new THREE.CylinderGeometry(0.81, 0.81, 0.03, 28), 'x', 'z', 0.6, 0.6), tmat(woodPlanksTex('warm', 4)), 0, h * 0.955, 0, { sx: r, sy: h, sz: r });
  const prof = (t: number) => (t < 0.5 ? lerp(0.86, 1, Math.sin(t / 0.5 * Math.PI / 2)) : lerp(0.86, 1, Math.sin((1 - t) / 0.5 * Math.PI / 2)));
  for (const t of [0.08, 0.27, 0.73, 0.92]) b.cy(ironM(), r * (prof(t) + 0.025), h * 0.05, 0, h * (t - 0.025), 0, 28);
  b.cyl(0, 0, r * 0.94, 0, h * 0.97);
  return b.done(o.x, o.y, o.z, 0);
}

/** String of sausages hanging from (x,y,z), n links over `len` units (decor, gently swaying). */
export function sausages(o: { x: number; y: number; z: number; n: number; len: number }): Built {
  const b = new B('sausages');
  const sw = b.group(0, 0, 0, undefined, true);
  const L = o.len / o.n, sr = L * 0.24;
  const sm = tmat(null, '#b0462c'), km = tmat(null, '#e8d8b0');
  b.m(cg('hook', () => new THREE.TorusGeometry(0.25, 0.05, 6, 12, Math.PI * 1.4)), ironM(), 0, -0.1, 0, { parent: sw, rz: Math.PI * 0.8 });
  let y = -0.35;
  for (let i = 0; i < o.n; i++) {
    const tilt = (i % 2 ? 1 : -1) * 0.22;
    const cyy = y - L / 2;
    b.m(cg('capsule', () => new THREE.CapsuleGeometry(1, 1, 4, 8)), sm, Math.sin(tilt) * L * 0.25, cyy, 0, { parent: sw, sx: sr, sy: (L - 2 * sr) / 2 + 0.01, sz: sr, rz: tilt });
    b.m(bandGeo(sr * 1.03, -L * 0.2, L * 0.2, 0.3, 2), bmat('#ffffff', { opacity: 0.4, depthWrite: false }), Math.sin(tilt) * L * 0.25, cyy, 0, { parent: sw, ry: -0.6, rz: tilt, glow: true, order: 2 });
    b.sp(km, sr * 0.35, 0, y - L + sr * 0.3, 0, 8, { parent: sw });
    y -= L;
  }
  b.cy(km, 0.03, 0.35, 0, -0.35, 0, 4, { parent: sw });
  const ph = hashSeed(o.x, o.z) % 100;
  b.update((t) => { sw.rotation.z = 0.04 * Math.sin(t * 0.9 + ph); sw.rotation.x = 0.03 * Math.sin(t * 0.7 + ph); });
  return b.done(o.x, o.y, o.z, 0);
}

/** Braid of garlic bulbs hanging from (x,y,z) (decor). */
export function garlic(o: { x: number; y: number; z: number; n?: number }): Built {
  const b = new B('garlic');
  const n = o.n ?? 7;
  const sw = b.group(0, 0, 0, undefined, true);
  const stem = tmat(null, '#c8b070');
  const len = n * 0.5 + 0.4;
  b.cy(stem, 0.08, len, 0, -len, 0, 6, { parent: sw });
  b.m(cg('hook', () => new THREE.TorusGeometry(0.25, 0.05, 6, 12, Math.PI * 1.4)), ironM(), 0, -0.1, 0, { parent: sw, rz: Math.PI * 0.8 });
  const bulb = cg('garlicBulb', () => latheV([[0, 0, 0], [0.45, 0.04, 0.1], [0.95, 0.35, 0.3], [0.85, 0.72, 0.55], [0.4, 0.95, 0.75], [0.14, 1.12, 0.85], [0.07, 1.4, 0.95], [0, 1.42, 1]], 8));
  const bm = tmat(null, '#f4ead6', { flat: true });
  for (let i = 0; i < n; i++) {
    const s = 0.42 + (i % 3) * 0.04;
    const side = i % 2 ? 1 : -1;
    b.m(bulb, bm, side * 0.26, -0.5 - i * 0.5 - s * 1.35, 0.1 * side, { parent: sw, s, rz: -side * 0.3, ry: i });
  }
  const ph = hashSeed(o.x, o.z) % 100;
  b.update((t) => { sw.rotation.z = 0.035 * Math.sin(t * 0.8 + ph); });
  return b.done(o.x, o.y, o.z, 0);
}

// ───────────────────────── wall decor ─────────────────────────

/** Royal banner on a rod (wall decor). y = bottom of the tails; spans y..y+h; front = +Z. */
export function banner(o: { x: number; y: number; z: number; w: number; h: number; rotY?: number; color?: string }): Built {
  const b = new B('banner');
  const { w, h } = o;
  const fh = h - 0.4;
  const geo = new THREE.PlaneGeometry(w, fh, 10, 4).translate(0, fh / 2, 0);
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setZ(i, 0.12 * Math.sin((p.getX(i) / w + 0.5) * Math.PI * 3) * (0.3 + 0.7 * (1 - p.getY(i) / fh)));
  geo.computeVertexNormals();
  b.m(geo, tmat(bannerTex(o.color), '#ffffff', { alphaTest: 0.5, side: THREE.DoubleSide }), 0, 0, 0.45);
  const gm = goldM();
  b.m(unitCyl(10), gm, -w * 0.58, fh + 0.12, 0.45, { sx: 0.12, sy: w * 1.16, sz: 0.12, rz: -Math.PI / 2 });
  for (const s of [-1, 1]) {
    b.sp(gm, 0.22, s * w * 0.6, fh + 0.12, 0.45, 10);
    b.bx(ironM(), 0.12, 0.12, 0.45, s * w * 0.42, fh + 0.12, 0.22);
  }
  for (const s of [-1, 1]) {
    b.cy(gm, 0.03, 0.9, s * w * 0.42, fh - 0.75, 0.47, 4);
    b.m(cg('tassel', () => new THREE.ConeGeometry(0.14, 0.5, 8)), gm, s * w * 0.42, fh - 0.95, 0.47);
  }
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

/** Gold-framed portrait of the King. y = bottom of the frame, front = +Z. */
export function painting(o: { x: number; y: number; z: number; w: number; h: number; rotY?: number; plaque?: string }): Built {
  const b = new B('painting');
  const { w, h } = o;
  const fb = Math.min(w, h) * 0.1, depth = 0.5;
  b.m(cg('plane', () => new THREE.PlaneGeometry(1, 1)), tmat(kingPortraitTex()), 0, h / 2, 0.18, { sx: w - 2 * fb + 0.05, sy: h - 2 * fb + 0.05 });
  const gm = goldM(), gd = tmat(null, '#c8901a');
  b.bx(gm, w, fb, depth, 0, h - fb / 2, depth / 2);
  b.bx(gm, w, fb, depth, 0, fb / 2, depth / 2);
  b.bx(gm, fb, h - 2 * fb, depth, -w / 2 + fb / 2, h / 2, depth / 2);
  b.bx(gm, fb, h - 2 * fb, depth, w / 2 - fb / 2, h / 2, depth / 2);
  const li = fb * 0.25;
  b.bx(gd, w - 2 * fb + li * 2, li, 0.12, 0, h - fb - li / 2 + li, depth * 0.55);
  b.bx(gd, w - 2 * fb + li * 2, li, 0.12, 0, fb + li / 2 - li, depth * 0.55);
  b.bx(gd, li, h - 2 * fb, 0.12, -w / 2 + fb - li / 2 + li, h / 2, depth * 0.55);
  b.bx(gd, li, h - 2 * fb, 0.12, w / 2 - fb + li / 2 - li, h / 2, depth * 0.55);
  for (const sx of [-1, 1]) for (const sy of [0, 1]) b.sp(gm, fb * 0.5, sx * (w / 2 - fb / 2), sy ? h - fb / 2 : fb / 2, depth + fb * 0.1, 12);
  const crest = new THREE.Shape();
  const cw = Math.min(w * 0.35, 3), ch = cw * 0.6;
  crest.moveTo(-cw / 2, 0); crest.lineTo(-cw / 2, ch * 0.7); crest.lineTo(-cw / 4, ch * 0.35); crest.lineTo(0, ch); crest.lineTo(cw / 4, ch * 0.35); crest.lineTo(cw / 2, ch * 0.7); crest.lineTo(cw / 2, 0); crest.closePath();
  b.m(new THREE.ExtrudeGeometry(crest, { depth: 0.3, bevelEnabled: false }), gm, 0, h - fb * 0.3, depth * 0.3);
  const pw = Math.min(w * 0.45, 4);
  b.m(cg('plane', () => new THREE.PlaneGeometry(1, 1)), tmat(plaqueTex(o.plaque ?? 'КОРОЛЬ ГРОМАДИН'), '#ffffff', { decal: true }), 0, fb / 2, depth + 0.02, { sx: pw, sy: pw / 4, cast: false });
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

/** Arched moonlit window (emissive night sky) with stone frame, sill and a soft light shaft. Front = +Z. */
export function window(o: { x: number; y: number; z: number; w: number; h: number; rotY?: number; beam?: boolean }): Built {
  const b = new B('window');
  const { w, h } = o;
  const fw = Math.max(0.5, w * 0.12);
  const ring = archShape(w + 2 * fw, h + fw, -fw);
  ring.holes.push(archShape(w, h));
  const fg = new THREE.ExtrudeGeometry(ring, { depth: 0.7, bevelEnabled: false, curveSegments: 16 });
  planarUV(fg, 'x', 'y', 1 / 6, 1 / 6);
  b.m(fg, tmat(stoneBricksTex('#7a6a92')), 0, 0, 0);
  b.m(shapeGeo(archShape(w, h), 16), bmat('#ffffff', { map: moonWindowTex() }), 0, 0, 0.08, { cast: false, receive: false });
  b.bx(tmat(stoneBricksTex('#8a7aa2')), w + 2 * fw + 0.6, 0.45, 1.1, 0, -0.195, 0.55, 4);
  if (o.beam ?? true) {
    const bm = bmat('#9ab4ff', { map: beamTex(), opacity: 0.22, additive: true, side: THREE.DoubleSide });
    b.m(new THREE.PlaneGeometry(w * 1.1, h * 2.4).translate(0, -h * 1.2, 0), bm, 0, h * 0.75, 0.3, { glow: true, rx: -0.75 });
  }
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

/**
 * Arched mouse-hole opening with a warm glow inside, placed against a wall (front = +Z).
 * Everything stands 0.15–0.55 off the wall face so it clears room baseboards (0.35 deep).
 */
export function mousehole(o: { x: number; y: number; z: number; w: number; h: number; rotY?: number; light?: boolean }): Built {
  const b = new B('mousehole');
  const { w, h } = o;
  const fw = Math.max(0.2, w * 0.12), z0 = 0.15, dep = 0.42;
  b.m(shapeGeo(archShape(w, h), 16), bmat('#120804', { decal: true }), 0, 0.005, z0 + 0.03, { cast: false });
  const glow = bmat('#ffb060', { map: glowTex(), opacity: 0.85, additive: true });
  b.m(shapeGeo(archShape(w * 0.8, h * 0.85), 16), glow, 0, 0, z0 + 0.06, { glow: true, order: 2 });
  const fg = new THREE.ExtrudeGeometry(archRing(w, h, fw), { depth: dep, bevelEnabled: false, curveSegments: 16 });
  planarUV(fg, 'x', 'y', 1 / 3, 1 / 3);
  b.m(fg, woodM('warm'), 0, 0, z0);
  const md = Math.max(0.6, w * 0.5);
  b.bx(tmat(rugTex('#c0392b')), w * 1.1, 0.04, md, 0, 0.02, z0 + dep + md / 2 + 0.05);
  if (o.light) b.light('#ffb060', 12, 10, 1.5, 0, h * 0.4, 1.2);
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

/** Arched wooden door with stone frame (decor; put it on a wall; front = +Z; clears baseboards). */
export function door(o: { x: number; y: number; z: number; w: number; h: number; rotY?: number }): Built {
  const b = new B('door');
  const { w, h } = o;
  const lz = 0.12, ld = 0.38;
  const leaf = new THREE.ExtrudeGeometry(archShape(w, h), { depth: ld, bevelEnabled: false, curveSegments: 16 });
  planarUV(leaf, 'x', 'y', 1 / w, 1 / h, 0.5, 0);
  b.m(leaf, tmat(doorTex()), 0, 0, lz);
  const fw = Math.max(0.4, w * 0.13);
  const fg = new THREE.ExtrudeGeometry(archRing(w, h, fw), { depth: 0.7, bevelEnabled: false, curveSegments: 16 });
  planarUV(fg, 'x', 'y', 1 / 5, 1 / 5);
  b.m(fg, tmat(stoneBricksTex('#7a6a92')), 0, 0, 0);
  const im = ironM(), fz = lz + ld;
  b.m(cg('torus16b', () => new THREE.TorusGeometry(1, 0.22, 8, 16)), im, w * 0.3, h * 0.4, fz + 0.1, { s: w * 0.06 });
  b.bx(im, w * 0.08, w * 0.12, 0.08, w * 0.3, h * 0.47, fz + 0.03);
  b.bx(tmat(null, '#120804'), w * 0.02, w * 0.05, 0.02, w * 0.3, h * 0.47, fz + 0.075);
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

/** Flat rug with border pattern and fringe (no collider; 0.05 thick). */
export function rug(o: { x: number; y: number; z: number; w: number; d: number; color?: string; rotY?: number }): Built {
  const b = new B('rug');
  const t = rugTex(o.color ?? '#b8323a');
  const edge: UVRect = { u0: 0.005, u1: 0.02, v0: 0.005, v1: 0.02 }, full: UVRect = { u0: 0, u1: 1, v0: 0, v1: 1 };
  b.m(atlasBox(o.w, 0.05, o.d, [edge, edge, full, edge, edge, edge], [false, false, o.w < o.d]), tmat(t), 0, 0.025, 0, { cast: false });
  const fm = tmat(null, '#f2e6c8');
  const along = o.w >= o.d;
  const len = along ? o.d : o.w;
  for (let s = -1; s <= 1; s += 2) for (let p = -len / 2 + 0.1; p <= len / 2 - 0.05; p += 0.16) {
    if (along) b.bx(fm, 0.35, 0.025, 0.06, s * (o.w / 2 + 0.17), 0.013, p, 0, { cast: false });
    else b.bx(fm, 0.06, 0.025, 0.35, p, 0.013, s * (o.d / 2 + 0.17), 0, { cast: false });
  }
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

// ───────────────────────── royal ─────────────────────────

/** Giant golden throne with red velvet (s=1 fits the ~28-unit seated King; seat top ≈ 9.4·s). Front = +Z. */
export function throne(o: { x: number; y: number; z: number; s?: number; rotY?: number }): Built & { seatY: number } {
  const b = new B('throne');
  const s = o.s ?? 1;
  const gm = goldM(), gd = tmat(null, '#c8901a');
  const vel = tmat(velvetTex(PAL.robe));
  const S = (v: number) => v * s;
  // plinth
  b.bx(tmat(stoneBricksTex('#6a5a82')), S(26), S(1.2), S(18), 0, S(0.6), 0, S(6));
  b.box(S(-13), 0, S(-9), S(13), S(1.2), S(9));
  // seat block
  b.bx(gm, S(20), S(6.8), S(14), 0, S(1.2 + 3.4), 0);
  b.bx(gd, S(16), S(4.2), S(0.3), 0, S(1.2 + 3.4), S(7.1));
  b.sp(tmat(null, '#e8283a', { emissive: '#e8283a', emissiveIntensity: 0.2 }), S(1.0), 0, S(4.6), S(7.3), 14, { sz: S(0.5) });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.sp(gm, S(1.6), sx * S(9.5), S(2.2), sz * S(6.4), 14); // paw feet
  b.box(S(-10), S(1.2), S(-7), S(10), S(8), S(7));
  // cushion
  b.m(scaleUV(new RoundedBoxGeometry(S(17.2), S(1.4), S(12), 2, S(0.5)), S(17.2) / 4, S(12) / 4), vel, 0, S(8.7), S(0.55));
  b.box(S(-8.6), S(8), S(-5.45), S(8.6), S(9.4), S(6.55));
  // arms
  for (const sx of [-1, 1]) {
    b.bx(gm, S(2.8), S(5), S(13), sx * S(10), S(10.5), S(0.5));
    b.m(unitCyl(16), gm, sx * S(10), S(13), S(-6), { sx: S(1.6), sy: S(13.5), sz: S(1.6), rx: Math.PI / 2 });
    b.sp(gm, S(1.9), sx * S(10), S(13), S(7.6), 14);
    b.box(sx > 0 ? S(8.6) : S(-11.6), S(8), S(-6), sx > 0 ? S(11.6) : S(-8.6), S(14.6), S(7.6));
  }
  // back
  b.bx(gm, S(21), S(28.8), S(3), 0, S(1.2 + 14.4), S(-7.5));
  b.m(scaleUV(new RoundedBoxGeometry(S(16), S(17), S(0.8), 2, S(0.35)), S(16) / 4, S(17) / 4), vel, 0, S(18.5), S(-5.7));
  b.box(S(-10.5), S(1.2), S(-9), S(10.5), S(30), S(-5.3));
  // crest crown
  const cr = new THREE.Shape();
  cr.moveTo(S(-11), 0); cr.lineTo(S(-11), S(4)); cr.lineTo(S(-6), S(1.8)); cr.lineTo(S(-3), S(5.5)); cr.lineTo(0, S(2.2)); cr.lineTo(S(3), S(5.5)); cr.lineTo(S(6), S(1.8)); cr.lineTo(S(11), S(4)); cr.lineTo(S(11), 0); cr.closePath();
  b.m(new THREE.ExtrudeGeometry(cr, { depth: S(2), bevelEnabled: false }), gm, 0, S(30), S(-8.5));
  for (const [x, y, c] of [[-11, 4, '#2e86c1'], [-3, 5.5, '#e8283a'], [3, 5.5, '#e8283a'], [11, 4, '#27ae60'], [0, 1.2, '#e8283a']] as const) {
    b.sp(tmat(null, c, { emissive: c, emissiveIntensity: 0.25 }), S(0.9), S(x), S(30 + y), S(-6.3), 12);
  }
  b.box(S(-11), S(30), S(-8.5), S(11), S(32), S(-6.5));
  return Object.assign(b.done(o.x, o.y, o.z, o.rotY ?? 0), { seatY: o.y + S(9.4) });
}

/** Stone pillar with square base & capital. Colliders: base box, shaft cylinder, capital box. */
export function pillar(o: { x: number; y: number; z: number; r: number; h: number; color?: string }): Built {
  const b = new B('pillar');
  const { r, h } = o;
  const color = o.color ?? PAL.stone;
  const baseH = clamp(h * 0.05, 0.8, 2.0), capH = clamp(h * 0.06, 0.8, 2.2), bs = r * 1.35;
  const sm = tmat(stoneBricksTex(shade(color, 0.1)));
  b.bx(sm, bs * 2, baseH, bs * 2, 0, baseH / 2, 0, 5);
  b.m(cg('torus32', () => new THREE.TorusGeometry(1, 0.1, 8, 32)), tmat(null, shade(color, 0.15)), 0, baseH + r * 0.08, 0, { rx: Math.PI / 2, s: r * 1.02 });
  const sh = h - baseH - capH;
  const shaft = new THREE.CylinderGeometry(r, r, sh, 32, 1, true);
  scaleUV(shaft, 1, sh / (Math.PI * r));
  b.m(shaft, tmat(fluteTex(color)), 0, baseH + sh / 2, 0);
  b.m(new THREE.CylinderGeometry(bs * 0.92, r * 1.02, capH * 0.45, 32), tmat(null, shade(color, 0.1)), 0, h - capH + capH * 0.225, 0);
  b.bx(sm, bs * 2, capH * 0.55, bs * 2, 0, h - capH * 0.275, 0, 5);
  b.box(-bs, 0, -bs, bs, baseH, bs);
  b.cyl(0, 0, r, baseH, h - capH * 0.55);
  b.box(-bs, h - capH * 0.55, -bs, bs, h, bs);
  return b.done(o.x, o.y, o.z, 0);
}

/** ≈1.2-tall marble pedestal with a velvet top (for artifacts). Top at y+1.2. */
export function pedestal(o: { x: number; y: number; z: number; color?: string }): Built & { top: number } {
  const b = new B('pedestal');
  const mm = tmat(null, o.color ?? '#e8e0d4'), gm = goldM();
  b.bx(mm, 1.2, 0.25, 1.2, 0, 0.125, 0);
  b.bx(gm, 1.24, 0.06, 1.24, 0, 0.2, 0);
  b.m(new THREE.CylinderGeometry(0.36, 0.42, 0.7, 16), mm, 0, 0.6, 0);
  b.bx(mm, 1.16, 0.21, 1.16, 0, 1.055, 0);
  b.bx(gm, 1.18, 0.05, 1.18, 0, 1.0, 0);
  b.bx(tmat(velvetTex('#2c3e8f')), 1.0, 0.04, 1.0, 0, 1.18, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.m(cg('tassel', () => new THREE.ConeGeometry(0.14, 0.5, 8)), gm, sx * 0.5, 1.08, sz * 0.5, { s: 0.45 });
  b.box(-0.6, 0, -0.6, 0.6, 0.25, 0.6);
  b.box(-0.42, 0.25, -0.42, 0.42, 0.95, 0.42);
  b.box(-0.58, 0.95, -0.58, 0.58, 1.2, 0.58);
  return Object.assign(b.done(o.x, o.y, o.z, 0), { top: o.y + 1.2 });
}

/** Wooden signpost ≈1.6 tall with a board showing short text (\n allowed). Front = +Z. Post collider. */
export function signpost(o: { x: number; y: number; z: number; rotY?: number; text: string }): Built {
  const b = new B('signpost');
  const wm = woodM('warm');
  const g = b.group(0, 0, 0);
  g.rotation.z = (hashSeed(o.x, o.z) % 7 - 3) * 0.012;
  b.cy(wm, 0.09, 1.5, 0, 0, 0, 8, { parent: g });
  b.m(cg('postTip', () => new THREE.ConeGeometry(0.09, 0.18, 8).translate(0, 0.09, 0)), wm, 0, 1.5, 0, { parent: g });
  b.bx(wm, 1.36, 0.66, 0.08, 0, 1.18, 0.12, 0, { parent: g });
  b.m(cg('plane', () => new THREE.PlaneGeometry(1, 1)), tmat(signTex(o.text), '#ffffff', { decal: true }), 0, 1.18, 0.172, { parent: g, sx: 1.3, sy: 0.62, cast: false });
  for (const sx of [-1, 1]) b.sp(ironM(), 0.035, sx * 0.55, 1.42, 0.17, 6, { parent: g });
  b.cyl(0, 0, 0.12, 0, 1.6);
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

/** Round cookie tin with a walkable lid. */
export function tin(o: { x: number; y: number; z: number; r: number; h: number; color?: string }): Built {
  const b = new B('tin');
  const color = o.color ?? '#2c6fb8';
  const { r, h } = o;
  b.m(latheC('tinBody', [[0, 0, 0], [0.97, 0, 0.02, 1], [1, 0.03, 0.05], [1, 0.84, 0.9, 1], [0.96, 0.84, 0.95], [0, 0.84, 1]], 36), tmat(tinTex(color)), 0, 0, 0, { sx: r, sy: h, sz: r });
  b.m(latheC('tinLid', [[1.03, 0.8, 0, 1], [1.03, 0.97, 0.5], [1.0, 1.0, 0.8, 1], [0, 1.0, 1]], 36), tmat(null, shade(color, -0.1)), 0, 0, 0, { sx: r, sy: h, sz: r });
  b.m(cg('disc40', () => new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2)), tmat(tinLidTex(color), '#ffffff', { decal: true }), 0, h + 0.012, 0, { s: r * 0.985, cast: false });
  b.m(cg('torus48', () => new THREE.TorusGeometry(1, 0.035, 8, 48)), goldM(), 0, h * 0.885, 0, { rx: Math.PI / 2, s: r * 1.035, sz: r });
  b.cyl(0, 0, r * 1.03, 0, h);
  return b.done(o.x, o.y, o.z, 0);
}

/** Porcelain teapot (spout +X, handle -X). Colliders: body + upper/lid. */
export function teapot(o: { x: number; y: number; z: number; r?: number; h?: number; color?: string; rotY?: number }): Built {
  const b = new B('teapot');
  const r = o.r ?? 2.5, h = o.h ?? r * 2.1;
  const color = o.color ?? '#2e86c1';
  const hb = h * 0.72;
  b.m(latheC('teapot', [[0, 0, 0], [0.6, 0, 0.03, 1], [0.66, 0.04, 0.06], [0.92, 0.2, 0.2], [1, 0.45, 0.35], [0.92, 0.72, 0.5], [0.7, 0.9, 0.62], [0.58, 0.97, 0.7, 1], [0, 0.97, 1]], 32), tmat(porcelainTex(color, 0.32, 0.52)), 0, 0, 0, { sx: r, sy: hb, sz: r });
  const pm = tmat(null, '#fbf6ec');
  const lidH = h - hb;
  b.m(latheC('tpLid', [[0.6, 0, 0, 1], [0.6, 0.12, 0.2], [0.5, 0.35, 0.4], [0.3, 0.55, 0.6], [0.12, 0.62, 0.75, 1], [0.12, 0.7, 0.8], [0, 0.7, 1]], 24), tmat(null, color), 0, hb * 0.965, 0, { sx: r, sy: lidH, sz: r });
  b.sp(pm, r * 0.16, 0, hb * 0.965 + lidH * 0.78, 0, 12);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(r * 0.8, hb * 0.35, 0), new THREE.Vector3(r * 1.25, hb * 0.45, 0), new THREE.Vector3(r * 1.5, hb * 0.75, 0), new THREE.Vector3(r * 1.62, hb * 0.95, 0)]);
  b.m(new THREE.TubeGeometry(curve, 16, r * 0.14, 10, false), pm, 0, 0, 0);
  b.m(cg('torusSp', () => new THREE.TorusGeometry(1, 0.3, 8, 16)), pm, r * 1.62, hb * 0.95, 0, { s: r * 0.15, rx: Math.PI / 2, rz: 0.4 });
  b.m(cg('handle', () => new THREE.TorusGeometry(1, 0.22, 10, 20, Math.PI * 1.25)), pm, -r * 0.92, hb * 0.5, 0, { s: hb * 0.32, rz: Math.PI * 0.375 });
  b.cyl(0, 0, r * 0.96, 0, hb * 0.62);
  b.cyl(0, 0, r * 0.62, hb * 0.62, hb * 0.965 + lidH * 0.45);
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

/** list of builders → handy for tools/previews */
export const BOOK_PALETTE = BOOK_COLORS;
export type { LP };

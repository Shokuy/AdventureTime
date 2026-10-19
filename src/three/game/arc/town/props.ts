import * as THREE from 'three';
import type { Built } from '../../../physics/types';
import { unitCyl, unitSphere, unitDome, boxGeo, archRing, archShape, shapeGeo, hashSeed } from '../../../world/kit';
import { shade } from '../../../world/textures';
import { B, TAU, cg, tmat, bmat, rng, rr, latheC, tm, glow, puffGeo, gumdropGeo, jellyGeo, icingEdge, ringCols } from './kit';
import { gingerTex, marshTex, layersTex, caneTex, stripeTex, sprinkleTex, windowTex, doorTex, boardTex, noteTex, mirrorTex, chalkTex, syrupTex } from './tex';
import type { TownPalette } from './palette';
import { DAY } from './palette';

/**
 * Candy-town prop kit (Пастильное королевство). Same conventions as world/props.ts:
 *  - (x, y, z) = world position of the prop's bottom centre; rotY = quarter turns (0 → front faces +Z, 1 → +X, 2 → −Z, 3 → −X);
 *  - colliders are world-space boxes / vertical cylinders whose tops match the walkable surfaces (gingerbread roofs are
 *    stepped ≤ 0.35 so you can run up and over them); returned objects are static except for small animations;
 *  - every prop takes an optional palette `pal` (day by default): the night variant swaps colours and lights windows / lamps.
 * The hero is ≈ 1 unit tall (jump ≈ 2.1, double jump ≈ 3.7).
 */

type Pal = { pal?: TownPalette };
const P = (o: Pal) => o.pal ?? DAY;
const pickC = (a: string[], s: number) => a[Math.abs(Math.floor(s)) % a.length];

// ───────────────────────── marshmallow tower ─────────────────────────

export interface TowerOpts extends Pal { x: number; y: number; z: number; r: number; h: number; wall?: string; roof?: string; seed?: number; top?: 'cone' | 'deck'; balcony?: number; flag?: boolean; windows?: boolean }
export interface TowerBuilt extends Built { top: number; balconyTop?: number }

/**
 * A marshmallow tower: stacked puffy marshmallow drums with sugar seams, arched windows (lit at night), a striped cone
 * roof with an icing rim and a golden bead (or a crenellated deck you can stand on), an optional balcony ring.
 */
export function marshmallowTower(o: TowerOpts): TowerBuilt {
  const pal = P(o);
  const seed = o.seed ?? hashSeed(o.x, o.z);
  const R = rng(seed);
  const b = new B('mtower');
  const { r, h } = o;
  const wall = o.wall ?? pickC(pal.walls, seed);
  const roof = o.roof ?? pickC(pal.roofs, seed >> 3);
  const wm = tmat(marshTex(wall));
  const seamM = tm(shade(wall, -0.08));
  const icing = tm(pal.icing);
  const segs = Math.max(2, Math.round(h / 2.4));
  const sh = h / segs;
  for (let i = 0; i < segs; i++) {
    const rs = r * (1 - i * 0.025);
    b.m(puffGeo(), wm, 0, i * sh, 0, { sx: rs, sy: sh, sz: rs });
    if (i > 0) b.m(cg('town-torus24', () => new THREE.TorusGeometry(1, 0.06, 6, 28)), seamM, 0, i * sh, 0, { rx: Math.PI / 2, s: rs * 0.985, sz: rs * 2.4 });
  }
  const topR = r * (1 - (segs - 1) * 0.025);
  // windows: a few arched windows spiralling up
  if (o.windows !== false) {
    const lit = pal.night;
    const wmat = lit ? bmat('#ffffff', { map: windowTex(pal.windowGlow, pal.icing, true) }) : tmat(windowTex(pal.glass, pal.icing, false));
    const nw = Math.max(2, Math.round(h / 2.2));
    for (let i = 0; i < nw; i++) {
      const a = R() * TAU, y = 1.6 + (i / nw) * (h - 2.6);
      const rr0 = r * (1 - (y / h) * segs * 0.025) * 1.02 + 0.02;
      const g = b.group(Math.sin(a) * rr0, y, Math.cos(a) * rr0);
      g.rotation.y = a;
      b.m(cg('town-plane', () => new THREE.PlaneGeometry(1, 1)), wmat, 0, 0, 0, { parent: g, sx: 0.62, sy: 0.95, cast: false });
      b.bx(icing, 0.78, 0.1, 0.14, 0, -0.5, 0.04, 0, { parent: g });
      if (lit && R() < 0.5) { const s = glow(pal.windowGlow, 1.6, 0.35); s.position.set(0, 0, 0.3); g.add(s); }
    }
  }
  // balcony ring
  let balconyTop: number | undefined;
  if (o.balcony) {
    const by = o.balcony;
    const br = r + 1.3;
    b.m(puffGeo(), tm(shade(wall, 0.04)), 0, by - 0.35, 0, { sx: br, sy: 0.35, sz: br });
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU;
      b.cy(tmat(caneTex('#ffffff', roof, 3)), 0.06, 0.75, Math.sin(a) * (br - 0.12), by, Math.cos(a) * (br - 0.12), 8);
    }
    b.m(cg('town-torus48', () => new THREE.TorusGeometry(1, 0.07, 6, 48)), icing, 0, by + 0.75, 0, { rx: Math.PI / 2, s: br - 0.12, sz: br * 2 });
    b.cyl(0, 0, br, by - 0.35, by);
    balconyTop = o.y + by;
  }
  b.cyl(0, 0, r * 1.01, 0, h);
  let top = h;
  if ((o.top ?? 'cone') === 'cone') {
    // puffy icing rim + striped cone + golden bead + a little flag
    b.m(cg('town-torus-rim', () => new THREE.TorusGeometry(1, 0.28, 10, 32)), icing, 0, h + 0.05, 0, { rx: Math.PI / 2, s: topR * 1.04 });
    const ch = Math.max(2.6, r * 1.9);
    const cone = b.m(cg('town-cone', () => new THREE.ConeGeometry(1, 1, 24, 1).translate(0, 0.5, 0)), tmat(stripeTex(roof, shade(roof, 0.28), 6)), 0, h, 0, { sx: topR * 1.22, sy: ch, sz: topR * 1.22 });
    cone.rotation.y = R() * TAU;
    // icing drips under the cone rim
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + R() * 0.2, L = rr(R, 0.15, 0.45);
      b.m(cg('town-cap', () => new THREE.CapsuleGeometry(1, 1, 4, 8)), icing, Math.sin(a) * topR * 1.2, h + 0.1 - L / 2, Math.cos(a) * topR * 1.2, { sx: 0.1, sy: L / 2, sz: 0.1 });
    }
    b.sp(tm('#ffd34a', { emissive: '#ffb020', emissiveIntensity: 0.25 }), Math.max(0.25, r * 0.16), 0, h + ch + 0.1, 0, 14);
    if (o.flag !== false) {
      const fg = b.group(0, h + ch + 0.2, 0, undefined, true);
      b.cy(tm('#fff6e8'), 0.04, 1.4, 0, 0, 0, 6, { parent: fg });
      const flag = b.m(cg('town-flag', () => { const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(1, -0.28); s.lineTo(0, -0.56); s.closePath(); return new THREE.ShapeGeometry(s); }), tm(pickC(pal.candy, seed >> 5), { side: THREE.DoubleSide }), 0, 1.38, 0, { parent: fg, s: 0.9 });
      const ph = R() * 10;
      b.update((t) => { flag.rotation.y = Math.sin(t * 2.2 + ph) * 0.35; flag.scale.x = 0.9 * (0.85 + 0.15 * Math.sin(t * 5 + ph)); });
    }
    b.cyl(0, 0, topR * 0.55, h, h + ch * 0.45);
  } else {
    // crenellated deck you can stand on
    b.m(cg('town-disc', () => new THREE.CylinderGeometry(1, 1, 0.3, 32)), tm(shade(wall, 0.05)), 0, h - 0.15 + 0.01, 0, { s: topR * 1.06, sy: 1 });
    const n = Math.max(8, Math.round(topR * 4));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      b.m(puffGeo(), icing, Math.sin(a) * topR * 0.98, h, Math.cos(a) * topR * 0.98, { sx: 0.32, sy: 0.4, sz: 0.32 });
    }
    top = h;
  }
  const out = b.done(o.x, o.y, o.z, 0) as TowerBuilt;
  out.top = o.y + top;
  if (balconyTop !== undefined) out.balconyTop = balconyTop;
  return out;
}

// ───────────────────────── gingerbread house ─────────────────────────

export interface HouseOpts extends Pal { x: number; y: number; z: number; w: number; d: number; h: number; rotY?: number; roof?: string; roofH?: number; seed?: number; flat?: boolean; chimney?: boolean; door?: boolean; wall?: string }
export interface HouseBuilt extends Built { eave: number; ridge: number }

/**
 * Gingerbread house: baked walls with piped icing on the corners, an iced door and windows, a pitched icing roof
 * (ridge along the house's width) with drips and gumdrops — stepped colliders so the roof can be run over — and a
 * striped chimney. `flat`: a flat iced roof terrace instead (rooftop routes).
 */
export function gingerHouse(o: HouseOpts): HouseBuilt {
  const pal = P(o);
  const seed = o.seed ?? hashSeed(o.x, o.z, o.w);
  const R = rng(seed);
  const b = new B('ghouse');
  const { w, d, h } = o;
  const gm = o.wall ? tmat(marshTex(o.wall)) : tmat(gingerTex(pal.ginger));
  const icing = tm(pal.icing);
  const roofC = o.roof ?? pickC(pal.roofs, seed);
  b.m(boxGeo(w, h, d, 2.4), gm, 0, h / 2, 0);
  // plinth of candy stones
  b.m(boxGeo(w + 0.16, 0.35, d + 0.16, 1), tm(shade(pal.gingerDark, 0.1)), 0, 0.175, 0);
  // corner piping
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cy(icing, 0.09, h, sx * w / 2, 0, sz * d / 2, 8);
  // door
  if (o.door !== false) {
    const dw = Math.min(1.15, w * 0.3), dh = Math.min(1.85, h * 0.62);
    b.m(cg('town-plane', () => new THREE.PlaneGeometry(1, 1)), tmat(doorTex(pickC(pal.candy, seed >> 2))), 0, dh / 2, d / 2 + 0.02, { sx: dw, sy: dh, cast: false });
    b.m(cg('town-arch', () => new THREE.TorusGeometry(1, 0.08, 6, 20, Math.PI)), icing, 0, dh - dw / 2, d / 2 + 0.04, { s: dw / 2 + 0.06 });
    for (const sx of [-1, 1]) b.cy(icing, 0.08, dh - dw / 2, sx * (dw / 2 + 0.06), 0, d / 2 + 0.04, 6);
    b.bx(tm(shade(pal.gingerDark, 0.15)), dw + 0.5, 0.18, 0.5, 0, 0.09, d / 2 + 0.25);
  }
  // windows
  const lit = pal.night;
  const wmat = lit ? bmat('#ffffff', { map: windowTex(pal.windowGlow, pal.icing, true) }) : tmat(windowTex(pal.glass, pal.icing, false));
  const win = (x: number, y: number, z: number, ry: number) => {
    const g = b.group(x, y, z); g.rotation.y = ry;
    b.m(cg('town-plane', () => new THREE.PlaneGeometry(1, 1)), wmat, 0, 0, 0.02, { parent: g, sx: 0.7, sy: 1.0, cast: false });
    b.bx(icing, 0.92, 0.12, 0.18, 0, -0.55, 0.07, 0, { parent: g });
    icingEdge(b, icing, -0.42, 0.56, 0.06, 0.42, 0.56, 0.06, seed + Math.round(x * 10), { parent: g, bead: 0.06, maxLen: 0.2, drips: 3 });
    if (lit) { const s = glow(pal.windowGlow, 1.5, 0.3); s.position.set(0, 0, 0.3); g.add(s); }
  };
  const wy = Math.min(h - 0.9, 1.75);
  const nwF = w > 3.4 ? 2 : w > 2.2 ? 1 : 0;
  if (nwF === 2) { win(-w * 0.3, wy, d / 2, 0); win(w * 0.3, wy, d / 2, 0); } else if (nwF === 1 && o.door === false) win(0, wy, d / 2, 0);
  if (d > 2.4) { win(w / 2, wy, 0, Math.PI / 2); win(-w / 2, wy, 0, -Math.PI / 2); }
  if (h > 4.2) { win(-w * 0.25, h - 1.0, d / 2, 0); win(w * 0.25, h - 1.0, d / 2, 0); win(-w * 0.25, h - 1.0, -d / 2, Math.PI); }
  if (w > 3) win(0, wy, -d / 2, Math.PI);
  b.box(-w / 2, 0, -d / 2, w / 2, h, d / 2);
  let eave = h, ridge = h;
  if (o.flat) {
    // iced roof terrace with a scalloped rim and sprinkles
    b.m(boxGeo(w + 0.5, 0.32, d + 0.5, 2), tmat(sprinkleTex(pal.icing, pal.candy)), 0, h + 0.16, 0);
    icingEdge(b, icing, -w / 2 - 0.25, h, d / 2 + 0.25, w / 2 + 0.25, h, d / 2 + 0.25, seed + 1, { maxLen: 0.5 });
    icingEdge(b, icing, -w / 2 - 0.25, h, -d / 2 - 0.25, w / 2 + 0.25, h, -d / 2 - 0.25, seed + 2, { maxLen: 0.5 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.m(gumdropGeo(), tm(pickC(pal.candy, seed + sx * 3 + sz)), sx * (w / 2 + 0.05), h + 0.32, sz * (d / 2 + 0.05), { sx: 0.3, sy: 0.32, sz: 0.3 });
    b.box(-w / 2 - 0.25, h, -d / 2 - 0.25, w / 2 + 0.25, h + 0.32, d / 2 + 0.25);
    eave = ridge = h + 0.32;
  } else {
    // pitched roof: attic prism (gingerbread gables) + two iced slabs; ridge along x
    const rh = o.roofH ?? Math.min(2.4, d * 0.55);
    const ov = 0.35;
    const hd = d / 2 + ov;
    const s = new THREE.Shape(); s.moveTo(-d / 2, 0); s.lineTo(d / 2, 0); s.lineTo(0, rh); s.closePath();
    const prism = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
    prism.translate(0, 0, -w / 2);
    prism.rotateY(Math.PI / 2);
    b.m(prism, gm, 0, h, 0);
    const slope = Math.atan2(rh, hd);
    const sl = Math.hypot(hd, rh) + 0.05;
    const roofM = tmat(sprinkleTex(roofC === pal.icing ? pal.icing : shade(roofC, 0.35), pal.candy));
    for (const sz of [-1, 1]) {
      const g = b.group(0, h + rh / 2 + 0.1, sz * hd / 2);
      g.rotation.x = sz * slope;
      b.m(boxGeo(w + ov * 2, 0.26, sl, 2), roofM, 0, 0, 0, { parent: g });
      // icing drips along the eave
      icingEdge(b, icing, -w / 2 - ov, h + 0.02, sz * hd, w / 2 + ov, h + 0.02, sz * hd, seed + (sz > 0 ? 11 : 12), { maxLen: 0.55 });
    }
    // gumdrops along the ridge
    const ng = Math.max(2, Math.round(w / 0.9));
    for (let i = 0; i < ng; i++) {
      const x = -w / 2 + (i + 0.5) * (w / ng);
      b.m(gumdropGeo(), tm(pickC(pal.candy, seed + i)), x, h + rh + 0.12, 0, { sx: 0.24, sy: 0.3, sz: 0.24 });
    }
    // stepped colliders over the roof (≤ 0.35 per step)
    const n = Math.max(2, Math.ceil(rh / 0.34));
    for (let i = 0; i < n; i++) {
      const y1 = h + rh * ((i + 1) / n);
      const hz = Math.max(0.2, hd * (1 - (y1 - h) / rh) + (hd / n) * 0.5);
      b.box(-w / 2 - ov, h + rh * (i / n), -hz, w / 2 + ov, y1 + 0.05, hz);
    }
    eave = h; ridge = h + rh + 0.15;
    if (o.chimney !== false) {
      const cx = w * 0.28 * (R() < 0.5 ? -1 : 1), cz = -hd * 0.35;
      const chH = rh * 0.75 + 1.0;
      b.m(boxGeo(0.7, chH, 0.7, 0), tmat(caneTex(pickC(pal.candy, seed >> 1), '#fff6ee', 3)), cx, h + rh * 0.35 + chH / 2, cz);
      b.m(puffGeo(), icing, cx, h + rh * 0.35 + chH, cz, { sx: 0.5, sy: 0.25, sz: 0.5 });
      b.box(cx - 0.36, h, cz - 0.36, cx + 0.36, h + rh * 0.35 + chH + 0.2, cz + 0.36);
    }
  }
  const out = b.done(o.x, o.y, o.z, o.rotY ?? 0) as HouseBuilt;
  out.eave = o.y + eave; out.ridge = o.y + ridge;
  return out;
}

// ───────────────────────── marmalade lamp ─────────────────────────

export interface LampOpts extends Pal { x: number; y: number; z: number; h?: number; color?: string; light?: boolean; rotY?: number; seed?: number }

/** A candy-cane lamp post with a hanging marmalade lantern. At night (or `light`) it glows and may cast a point light. */
export function marmaladeLamp(o: LampOpts): Built {
  const pal = P(o);
  const seed = o.seed ?? hashSeed(o.x, o.z);
  const b = new B('mlamp');
  const h = o.h ?? 3.2;
  const jc = o.color ?? pickC(pal.jelly, seed);
  const cane = tmat(caneTex('#fff8f0', '#ff4f6a', 5));
  b.cy(tm(shade(pal.gingerDark, 0.2)), 0.22, 0.25, 0, 0, 0, 12);
  b.cy(cane, 0.09, h, 0, 0, 0, 10);
  // the hook: a half torus over to the lantern
  b.m(cg('town-hook', () => new THREE.TorusGeometry(0.42, 0.09, 8, 16, Math.PI)), cane, 0.42, h, 0);
  const lit = pal.lampsLit || !!o.light;
  const lg = b.group(0.84, h - 0.18, 0, undefined, true);
  b.cy(tm('#ffd34a'), 0.16, 0.12, 0, -0.05, 0, 10, { parent: lg });
  const jm = lit ? bmat(shade(jc, 0.25)) : tmat(null, jc, { emissive: jc, emissiveIntensity: 0.35, transparent: true, opacity: 0.92 });
  b.m(jellyGeo(), jm, 0, -0.62, 0, { parent: lg, sx: 0.32, sy: 0.6, sz: 0.32 });
  b.sp(tm('#ffd34a'), 0.07, 0, -0.68, 0, 8, { parent: lg });
  let light: THREE.PointLight | null = null;
  if (lit) {
    const s = glow(jc, 3.2, 0.55); s.position.set(0, -0.35, 0); lg.add(s);
    if (o.light !== false && pal.lampsLit) light = b.light(pal.lampLight, 14, 12, 1.6, 0.84, h - 0.6, 0);
  }
  const ph = (seed % 100) / 10;
  b.update((t) => {
    lg.rotation.z = Math.sin(t * 1.3 + ph) * 0.06;
    if (light) light.intensity = 14 * (0.92 + 0.08 * Math.sin(t * 7 + ph));
  });
  b.cyl(0, 0, 0.16, 0, h);
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

// ───────────────────────── pastila bridge ─────────────────────────

export interface BridgeOpts extends Pal { x: number; y: number; z: number; len: number; w: number; rotY?: number; arch?: number; rails?: boolean; seed?: number; th?: number }

/**
 * A layered pastila bridge spanning `len` along local X (rotY turns it), arched by `arch`, with candy-cane railings.
 * (x, y, z) = middle of the span at its ends' height. Stepped colliders follow the arch.
 */
export function pastilaBridge(o: BridgeOpts): Built {
  const pal = P(o);
  const seed = o.seed ?? hashSeed(o.x, o.z, o.len);
  const b = new B('pbridge');
  const { len, w } = o;
  const arch = o.arch ?? 0;
  const th = o.th ?? 0.45;
  const lm = tmat(layersTex(pal.bank, seed % 7));
  const topM = tmat(sprinkleTex(pal.icing, pal.candy));
  const n = Math.max(1, arch > 0 ? Math.round(len / 0.9) : 1);
  const yAt = (t: number) => arch * Math.sin(Math.PI * t);
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const x0 = -len / 2 + t0 * len, x1 = -len / 2 + t1 * len;
    const y0 = yAt(t0), y1 = yAt(t1);
    const sl = Math.hypot(x1 - x0, y1 - y0) + 0.04;
    const g = b.group((x0 + x1) / 2, (y0 + y1) / 2, 0);
    g.rotation.z = Math.atan2(y1 - y0, x1 - x0);
    b.m(boxGeo(sl, th, w, 0), lm, 0, -th / 2, 0, { parent: g });
    b.m(boxGeo(sl, 0.08, w + 0.04, 2), topM, 0, 0.02, 0, { parent: g });
    const ym = yAt((t0 + t1) / 2);
    b.box(x0 - 0.02, ym - th - 0.2, -w / 2, x1 + 0.02, ym + 0.04, w / 2);
  }
  if (o.rails !== false) {
    const posts = Math.max(2, Math.round(len / 1.3) + 1);
    const cane = tmat(caneTex('#fff8f0', pickC(pal.candy, seed), 4));
    for (const sz of [-1, 1]) {
      let prev: THREE.Vector3 | null = null;
      for (let i = 0; i < posts; i++) {
        const t = i / (posts - 1);
        const x = -len / 2 + t * len, y = yAt(t);
        const z = sz * (w / 2 - 0.12);
        b.cy(cane, 0.07, 0.95, x, y, z, 8);
        b.sp(tm(pickC(pal.candy, seed + i)), 0.13, x, y + 1.0, z, 10);
        const p = new THREE.Vector3(x, y + 0.8, z);
        if (prev) {
          const mid = p.clone().add(prev).multiplyScalar(0.5);
          const m = b.m(cg('town-cyl12', () => new THREE.CylinderGeometry(1, 1, 1, 12)), tm(pal.icing), mid.x, mid.y, mid.z, { sx: 0.06, sy: p.distanceTo(prev), sz: 0.06 });
          m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.clone().sub(prev).normalize());
        }
        prev = p;
      }
      // rail colliders (keep you on the deck)
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n;
        const ym = yAt((t0 + t1) / 2);
        b.box(-len / 2 + t0 * len, ym, sz * (w / 2) - 0.12, -len / 2 + t1 * len, ym + 1.05, sz * (w / 2) + 0.05);
      }
    }
  }
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

// ───────────────────────── candy-cane fence ─────────────────────────

export interface FenceOpts extends Pal { x0: number; z0: number; x1: number; z1: number; y: number; h?: number; seed?: number; collide?: boolean }

/** Candy-cane posts with hooked tops and ribbon rails from (x0, z0) to (x1, z1). Colliders follow straight lines. */
export function caneFence(o: FenceOpts): Built {
  const pal = P(o);
  const seed = o.seed ?? hashSeed(o.x0, o.z0, o.x1, o.z1);
  const b = new B('cfence');
  const h = o.h ?? 1.15;
  const dx = o.x1 - o.x0, dz = o.z1 - o.z0;
  const len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.round(len / 1.25));
  const ang = Math.atan2(dx, dz);
  const red = pickC(pal.candy, seed);
  const cane = tmat(caneTex('#fff8f0', red, 4));
  const ribbon = tm(shade(red, 0.15));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = o.x0 + dx * t, z = o.z0 + dz * t;
    b.cy(cane, 0.075, h, x, 0, z, 8);
    const hook = b.m(cg('town-fhook', () => new THREE.TorusGeometry(0.16, 0.075, 6, 12, Math.PI)), cane, x + Math.cos(ang) * 0.16, h, z - Math.sin(ang) * 0.16);
    hook.rotation.y = ang;
  }
  for (const yy of [h * 0.42, h * 0.78]) {
    const m = b.m(boxGeo(1, 0.1, 0.04, 0), ribbon, (o.x0 + o.x1) / 2, yy, (o.z0 + o.z1) / 2, { sx: len, sy: 1, sz: 1 });
    m.rotation.y = ang - Math.PI / 2;
  }
  if (o.collide !== false) {
    // axis-aligned stretches get one box; diagonal ones a box per gap
    if (Math.abs(dx) < 0.01 || Math.abs(dz) < 0.01) b.box(Math.min(o.x0, o.x1) - 0.12, 0, Math.min(o.z0, o.z1) - 0.12, Math.max(o.x0, o.x1) + 0.12, h + 0.1, Math.max(o.z0, o.z1) + 0.12);
    else for (let i = 0; i < n; i++) {
      const ax = o.x0 + dx * (i / n), az = o.z0 + dz * (i / n), bx = o.x0 + dx * ((i + 1) / n), bz = o.z0 + dz * ((i + 1) / n);
      b.box(Math.min(ax, bx) - 0.1, 0, Math.min(az, bz) - 0.1, Math.max(ax, bx) + 0.1, h + 0.1, Math.max(az, bz) + 0.1);
    }
  }
  return b.done(0, o.y, 0, 0);
}

// ───────────────────────── candy trees ─────────────────────────

export type TreeKind = 'gumdrop' | 'lolly' | 'cotton';
export interface TreeOpts extends Pal { x: number; y: number; z: number; s?: number; kind?: TreeKind; color?: string; seed?: number }

/** Gumdrop trees (stacked sugared gumdrops on a licorice trunk), swirl lollipops and cotton-candy puffs. */
export function candyTree(o: TreeOpts): Built {
  const pal = P(o);
  const seed = o.seed ?? hashSeed(o.x, o.z);
  const R = rng(seed);
  const b = new B('ctree');
  const s = o.s ?? 1;
  const kind = o.kind ?? 'gumdrop';
  const col = o.color ?? pickC(pal.candy, seed);
  if (kind === 'gumdrop') {
    const trunkH = 1.3 * s;
    b.m(cg('town-trunk', () => new THREE.CylinderGeometry(0.7, 1, 1, 10).translate(0, 0.5, 0)), tmat(caneTex(shade(pal.gingerDark, -0.1), shade(pal.gingerDark, 0.15), 3)), 0, 0, 0, { sx: 0.2 * s, sy: trunkH + 0.4 * s, sz: 0.2 * s });
    const gm = tmat(marshTex(col));
    const tiers = 3;
    for (let i = 0; i < tiers; i++) {
      const k = 1 - i * 0.28;
      b.m(gumdropGeo(), gm, 0, trunkH + i * 0.85 * s, 0, { sx: 1.45 * s * k, sy: 1.1 * s * k, sz: 1.45 * s * k, ry: R() * 3 });
    }
    // sugar crystals on the tiers' shoulders
    for (let i = 0; i < 9; i++) {
      const tier = i % tiers, k = 1 - tier * 0.28;
      const a = R() * TAU, rr0 = 1.45 * s * k * 0.86;
      b.sp(tm('#ffffff'), 0.07 * s, Math.sin(a) * rr0, trunkH + tier * 0.85 * s + 0.36 * 1.1 * s * k, Math.cos(a) * rr0, 6);
    }
    b.cyl(0, 0, 0.25 * s, 0, trunkH);
  } else if (kind === 'lolly') {
    const stick = 2.4 * s;
    b.cy(tm('#fffaf2'), 0.08 * s, stick, 0, 0, 0, 8);
    const g = b.group(0, stick + 0.75 * s, 0);
    g.rotation.y = R() * TAU;
    const disc = cg('town-lolly', () => {
      const geo = new THREE.CylinderGeometry(1, 1, 0.28, 32, 1);
      geo.rotateX(Math.PI / 2);
      return geo;
    });
    b.m(disc, tmat(swirlTex(col, '#fff8f0')), 0, 0, 0, { parent: g, s: 0.85 * s, sz: 0.85 * s });
    b.m(cg('town-torus-lolly', () => new THREE.TorusGeometry(1, 0.08, 8, 32)), tm(shade(col, -0.1)), 0, 0, 0, { parent: g, s: 0.85 * s });
    b.cyl(0, 0, 0.14 * s, 0, stick);
  } else {
    // cotton candy on a paper cone
    b.m(cg('town-pcone', () => new THREE.ConeGeometry(1, 1, 12).rotateX(Math.PI).translate(0, 0.5, 0)), tmat(stripeTex('#fff6e8', shade(col, 0.2), 6)), 0, 0, 0, { sx: 0.28 * s, sy: 1.9 * s, sz: 0.28 * s });
    const cm = tm(shade(col, 0.45));
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU, rr0 = i === 0 ? 0 : 0.7 * s;
      b.sp(cm, (i === 0 ? 1.0 : 0.72) * s, Math.sin(a) * rr0, 2.6 * s + (i === 0 ? 0.35 * s : R() * 0.4 * s), Math.cos(a) * rr0, 14);
    }
    b.cyl(0, 0, 0.2 * s, 0, 1.9 * s);
  }
  return b.done(o.x, o.y, o.z, 0);
}

const swirlCache = new Map<string, THREE.Texture>();
function swirlTex(a: string, c: string) {
  const k = a + c;
  let t = swirlCache.get(k);
  if (!t) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const g = cv.getContext('2d')!;
    g.fillStyle = c; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = a; g.lineWidth = 9; g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i < 220; i++) { const th = i * 0.12, r = 2 + i * 0.27; const x = 64 + Math.cos(th) * r, y = 64 + Math.sin(th) * r; if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); }
    g.stroke();
    t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    swirlCache.set(k, t);
  }
  return t;
}

// ───────────────────────── fountain ─────────────────────────

export interface FountainOpts extends Pal { x: number; y: number; z: number; r?: number }

/**
 * The square's fountain: a layered pastila basin you can hop into (the syrup is ankle-deep), a cupcake column with
 * two bowls (you can climb them), syrup streams and splashing drops, and a strawberry on top.
 */
export function fountain(o: FountainOpts): Built {
  const pal = P(o);
  const b = new B('fountain');
  const r = o.r ?? 4.5;
  const rimH = 0.8;
  const lm = tmat(layersTex(pal.bank, 4));
  const icing = tm(pal.icing);
  // basin wall (lathe ring) + iced rim
  b.m(latheC('town-basin', [[0.88, 0, 0], [1, 0, 0.1, 1], [1.02, 0.2, 0.3], [1, 1, 0.9, 1], [0.94, 1, 0.95], [0.9, 0.95, 1], [0.88, 0.2, 1]], 40), lm, 0, 0, 0, { sx: r, sy: rimH, sz: r });
  b.m(cg('town-torus-basin', () => new THREE.TorusGeometry(1, 0.035, 8, 64)), icing, 0, rimH, 0, { rx: Math.PI / 2, s: r * 0.97, sz: r * 4 });
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    b.m(cg('town-cap', () => new THREE.CapsuleGeometry(1, 1, 4, 8)), icing, Math.sin(a) * r * 1.005, rimH - 0.18, Math.cos(a) * r * 1.005, { sx: 0.1, sy: 0.14 + ((i * 7) % 5) * 0.04, sz: 0.1 });
  }
  // syrup surface (scrolling swirls)
  const st = syrupTex(pal.syrup, pal.syrupLight).clone();
  st.needsUpdate = true; st.wrapS = st.wrapT = THREE.RepeatWrapping; st.repeat.set(2.5, 2.5);
  const water = new THREE.Mesh(new THREE.CircleGeometry(r * 0.9, 48).rotateX(-Math.PI / 2), tmat(st, '#ffffff'));
  water.position.y = 0.55; water.receiveShadow = true; water.userData.keep = true;
  b.root.add(water);
  // column: plinth, lower bowl (cupcake), shaft, upper bowl, strawberry
  b.m(latheC('town-plinth', [[0, 0, 0], [1, 0, 0.1, 1], [1, 0.6, 0.4], [0.75, 0.75, 0.6], [0.55, 1, 0.9], [0, 1, 1]], 24), tm(pal.walls[0]), 0, 0, 0, { sx: 0.95, sy: 1.4, sz: 0.95 });
  b.m(latheC('town-bowl', [[0.3, 0, 0], [0.55, 0.1, 0.2], [0.85, 0.5, 0.5], [1, 0.95, 0.9, 1], [0.92, 1, 0.95], [0.6, 0.85, 1], [0, 0.82, 1]], 32), tmat(stripeTex(pal.walls[1], shade(pal.walls[1], -0.12), 10)), 0, 1.25, 0, { sx: 1.9, sy: 0.6, sz: 1.9 });
  b.m(cg('town-disc', () => new THREE.CylinderGeometry(1, 1, 0.3, 32)), tmat(syrupTex(pal.syrup, pal.syrupLight)), 0, 1.72, 0, { sx: 1.62, sy: 0.2, sz: 1.62 });
  b.cy(tm(pal.walls[2]), 0.32, 1.5, 0, 1.75, 0, 16);
  b.m(latheC('town-bowl', [[0.3, 0, 0], [0.55, 0.1, 0.2], [0.85, 0.5, 0.5], [1, 0.95, 0.9, 1], [0.92, 1, 0.95], [0.6, 0.85, 1], [0, 0.82, 1]], 32), tmat(stripeTex(pal.walls[3], shade(pal.walls[3], -0.12), 8)), 0, 3.05, 0, { sx: 1.0, sy: 0.45, sz: 1.0 });
  b.m(cg('town-disc', () => new THREE.CylinderGeometry(1, 1, 0.3, 32)), tmat(syrupTex(pal.syrup, pal.syrupLight)), 0, 3.4, 0, { sx: 0.85, sy: 0.2, sz: 0.85 });
  // strawberry
  const sg = b.group(0, 3.5, 0, undefined, true);
  b.m(cg('town-berry', () => new THREE.SphereGeometry(1, 18, 14).scale(1, 1.2, 1)), tm('#ff3a5a'), 0, 0.55, 0, { parent: sg, s: 0.45 });
  for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; b.m(cg('town-leaf', () => new THREE.ConeGeometry(0.12, 0.4, 6)), tm('#4ad86a'), Math.sin(a) * 0.18, 1.08, Math.cos(a) * 0.18, { parent: sg, rx: Math.cos(a) * 1.1, rz: -Math.sin(a) * 1.1 }); }
  for (let i = 0; i < 16; i++) { const a = i * 2.4, y = 0.3 + (i % 4) * 0.17; b.sp(tm('#ffe680'), 0.035, Math.sin(a) * 0.44, y + 0.25, Math.cos(a) * 0.44, 6, { parent: sg }); }
  // syrup streams: falling sheets from the upper bowl (cylinder shells) + drops
  const sheet = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.55, 1.7, 32, 1, true), new THREE.MeshBasicMaterial({ color: pal.syrupLight, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
  sheet.position.y = 2.6; sheet.userData.keep = true; sheet.renderOrder = 2; sheet.layers.set(1);
  b.root.add(sheet);
  const sheet2 = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.6, 1.27, 40, 1, true), sheet.material);
  sheet2.position.y = 1.18; sheet2.userData.keep = true; sheet2.renderOrder = 2; sheet2.layers.set(1);
  b.root.add(sheet2);
  const drops = b.group(0, 0, 0, undefined, true);
  const dm = bmat(pal.syrupLight);
  const D: { m: THREE.Mesh; a: number; ph: number; sp: number }[] = [];
  for (let i = 0; i < 18; i++) {
    const m = b.m(unitSphere(8), dm, 0, 0, 0, { parent: drops, s: 0.08, glow: true, dyn: true });
    D.push({ m, a: (i / 18) * TAU, ph: i * 0.37, sp: 0.9 + (i % 3) * 0.15 });
  }
  b.update((t) => {
    st.offset.set(t * 0.03, t * 0.05);
    for (const d of D) {
      const k = ((t * d.sp + d.ph) % 1);
      const rr0 = 1.0 + k * 1.3;
      d.m.position.set(Math.sin(d.a) * rr0, 3.3 + k * 0.9 - k * k * 3.4, Math.cos(d.a) * rr0);
      d.m.visible = d.m.position.y > 0.5;
    }
  });
  // colliders: rim ring, shallow floor, column, bowls
  ringCols(b, 0, 0, r * 0.94, 0, rimH, { n: Math.round((TAU * r * 0.94) / 0.5), post: 0.33 });
  b.box(-r * 0.85, 0, -r * 0.85, r * 0.85, 0.3, r * 0.85);
  b.cyl(0, 0, 0.95, 0, 1.25);
  b.cyl(0, 0, 1.75, 1.25, 1.78);
  b.cyl(0, 0, 0.36, 1.78, 3.05);
  b.cyl(0, 0, 0.95, 3.05, 3.45);
  b.cyl(0, 0, 0.4, 3.45, 4.2);
  return b.done(o.x, o.y, o.z, 0);
}

// ───────────────────────── princess Pastila's laboratory ─────────────────────────

export interface LabOpts extends Pal { x: number; y: number; z: number; rotY?: number; r?: number }
export interface LabBuilt extends Built { /** where the princess stands (world, facing the door) */ princess: THREE.Vector3; door: THREE.Vector3 }

/**
 * The princess's laboratory — the «розовая башня»: a round tower of pink pastila bricks with porthole windows, an arched
 * door, a big glass dome on copper ribs and a telescope poking through it. Inside: a stepladder by the telescope's
 * eyepiece, the table-model of Хрумляндия, a bench of retorts and flasks bubbling in candy colours, shelves of jars,
 * a chalkboard of formulas and the bubbling vat of the (unfinished) Sunny Syrup.
 */
export function laboratory(o: LabOpts): LabBuilt {
  const pal = P(o);
  const b = new B('lab');
  const R = rng(77);
  const r = o.r ?? 6;
  const wallH = 6.2, th = 0.55;
  const brick = tmat(layersTex(['#ffc8da', '#fff2f6', '#ff9fbc', '#fff2f6', '#ffd6e4'], 9));
  const icing = tm(pal.icing);
  const copper = tm('#e0904a', { emissive: '#7a3a10', emissiveIntensity: 0.15 });
  const doorA = 0; // the door faces +Z
  const doorHalf = 0.24;
  const rm = r - th / 2;
  // the wall ring (segments, door gap)
  const nSeg = 44;
  for (let i = 0; i < nSeg; i++) {
    const a0 = (i / nSeg) * TAU, a1 = ((i + 1) / nSeg) * TAU, am = (a0 + a1) / 2;
    const dd = Math.atan2(Math.sin(am - doorA), Math.cos(am - doorA));
    const segLen = 2 * Math.sin((a1 - a0) / 2) * rm + 0.05;
    const g = b.group(Math.sin(am) * rm, 0, Math.cos(am) * rm);
    g.rotation.y = am;
    if (Math.abs(dd) < doorHalf) { b.m(boxGeo(segLen, wallH - 3.4, th, 1.2), brick, 0, 3.4 + (wallH - 3.4) / 2, 0, { parent: g }); continue; }
    b.m(boxGeo(segLen, wallH, th, 1.2), brick, 0, wallH / 2, 0, { parent: g });
  }
  // icing bands and a scalloped rim under the dome
  b.m(cg('town-labrim', () => new THREE.TorusGeometry(1, 0.24, 8, 64)), icing, 0, wallH, 0, { rx: Math.PI / 2, s: rm });
  b.m(cg('town-labband', () => new THREE.TorusGeometry(1, 0.08, 6, 64)), tm(pal.roofs[0]), 0, 3.6, 0, { rx: Math.PI / 2, s: r + 0.02 });
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * TAU;
    b.m(cg('town-cap', () => new THREE.CapsuleGeometry(1, 1, 3, 7)), icing, Math.sin(a) * (r + 0.02), wallH - 0.25 - ((i * 7) % 4) * 0.05, Math.cos(a) * (r + 0.02), { sx: 0.12, sy: 0.16 + ((i * 5) % 4) * 0.05, sz: 0.12 });
  }
  // porthole windows (outer + inner faces); the one at +X is the one Ноки comes through
  const winM = pal.night ? bmat('#ffffff', { map: windowTex(pal.windowGlow, '#ffd34a', true) }) : tmat(windowTex(pal.glass, '#ffd34a', false));
  for (const a of [Math.PI / 2, Math.PI * 0.85, -Math.PI * 0.85, -Math.PI / 2, -Math.PI * 0.42, Math.PI * 0.42]) {
    for (const io of [1, -1]) {
      const rr0 = io > 0 ? r + 0.03 : r - th - 0.03;
      const g = b.group(Math.sin(a) * rr0, 2.7, Math.cos(a) * rr0);
      g.rotation.y = a + (io > 0 ? 0 : Math.PI);
      b.m(cg('town-plane', () => new THREE.PlaneGeometry(1, 1)), winM, 0, 0, 0, { parent: g, sx: 1.0, sy: 1.4, cast: false });
      b.m(cg('town-arch', () => new THREE.TorusGeometry(1, 0.08, 6, 20, Math.PI)), tm('#ffd34a'), 0, 0.2, 0.02, { parent: g, s: 0.55 });
    }
  }
  // door arch (pink frame), the brick above it, a sign, steps
  const doorW = 2 * Math.sin(doorHalf) * r * 0.98;
  const arch = new THREE.ExtrudeGeometry(archRing(doorW, 3.4, 0.35), { depth: th + 0.2, bevelEnabled: false });
  arch.translate(0, 0, -(th + 0.2) / 2);
  b.m(arch, tm(pal.roofs[0]), 0, 0, rm);
  const ys = 3.4 - doorW / 2;
  const ls = new THREE.Shape();
  ls.moveTo(-doorW / 2 - 0.4, ys); ls.lineTo(-doorW / 2, ys); ls.absarc(0, ys, doorW / 2, Math.PI, 0, true);
  ls.lineTo(doorW / 2 + 0.4, ys); ls.lineTo(doorW / 2 + 0.4, 3.45); ls.lineTo(-doorW / 2 - 0.4, 3.45); ls.closePath();
  const lintel = new THREE.ExtrudeGeometry(ls, { depth: th, bevelEnabled: false });
  lintel.translate(0, 0, -th / 2);
  b.m(lintel, brick, 0, 0, rm);
  b.m(cg('town-plane', () => new THREE.PlaneGeometry(1, 1)), tmat(boardTex('ЛАБОРАТОРИЯ', '#ff7aa8', '#7a2a5a', 512, 120)), 0, 4.15, r + 0.06, { sx: 3.4, sy: 0.8, cast: false });
  for (let i = 0; i < 3; i++) b.bx(tm(shade(pal.walls[0], -0.04 * i)), doorW + 1.2 - i * 0.3, 0.18, 0.7, 0, 0.09, r + 0.35 + i * 0.6);
  // floor
  b.m(cg('town-labfloor', () => new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2)), tmat(stripeTex('#fff4ea', '#ffd3e0', 12)), 0, 0.03, 0, { s: r - th, cast: false });
  // glass dome on copper ribs
  const domeM = new THREE.MeshToonMaterial({ color: '#cfeeff', transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
  const dome = new THREE.Mesh(unitDome(32), domeM);
  dome.position.y = wallH + 0.1; dome.scale.setScalar(rm); dome.renderOrder = 3; dome.userData.keep = true; dome.layers.set(1);
  b.root.add(dome);
  for (let i = 0; i < 8; i++) b.m(cg('town-rib', () => new THREE.TorusGeometry(1, 0.05, 6, 32, Math.PI / 2)), copper, 0, wallH + 0.1, 0, { s: rm, ry: (i / 8) * TAU });
  b.m(cg('town-torus48', () => new THREE.TorusGeometry(1, 0.07, 6, 48)), copper, 0, wallH + 0.1 + rm * Math.sin(Math.PI / 4), 0, { rx: Math.PI / 2, s: rm * Math.cos(Math.PI / 4) });
  // a sun weathervane on top
  const vg = b.group(0, wallH + rm - 0.1, 0, undefined, true);
  b.cy(copper, 0.05, 1.2, 0, 0, 0, 6, { parent: vg });
  b.sp(tm('#ffd34a', { emissive: '#ffb020', emissiveIntensity: 0.4 }), 0.28, 0, 1.3, 0, 12, { parent: vg });
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; b.m(cg('town-ray', () => new THREE.ConeGeometry(0.07, 0.3, 5)), tm('#ffd34a'), Math.cos(a) * 0.4, 1.3 + Math.sin(a) * 0.4, 0, { parent: vg, rz: a - Math.PI / 2 }); }
  b.update((t) => { vg.rotation.y = t * 0.4; });
  // the telescope: eyepiece by the stepladder, the tube up through the dome
  const eye = new THREE.Vector3(-2.9, 2.35, -2.7), far = new THREE.Vector3(-5.2, 10.4, -5.0);
  const tube = b.m(cg('town-tele', () => new THREE.CylinderGeometry(0.34, 0.2, 1, 16)), copper, (eye.x + far.x) / 2, (eye.y + far.y) / 2, (eye.z + far.z) / 2, { sx: 1, sy: eye.distanceTo(far), sz: 1 });
  tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), far.clone().sub(eye).normalize());
  b.m(cg('town-tele2', () => new THREE.CylinderGeometry(0.42, 0.42, 0.4, 16)), tm('#5a3a6a'), far.x, far.y, far.z, { s: 1 });
  for (const [dx, dz] of [[0.6, 0.3], [-0.3, 0.6], [-0.2, -0.6]] as const) {
    const leg = b.m(cg('town-cyl12', () => new THREE.CylinderGeometry(1, 1, 1, 12)), copper, eye.x + dx / 2, 1.1, eye.z + dz / 2, { sx: 0.05, sy: 2.3, sz: 0.05 });
    leg.rotation.set(dz * 0.4, 0, -dx * 0.4);
  }
  // the stepladder (Пастила stands on it before the meeting)
  const lad = new THREE.Vector3(-2.5, 0, -2.0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = b.m(boxGeo(0.08, 1.12, 0.08, 0), tmat(gingerTex(pal.gingerDark)), lad.x + sx * 0.36, 0.52, lad.z + sz * 0.42);
    leg.rotation.x = -sz * 0.22;
  }
  for (let i = 0; i < 3; i++) b.m(boxGeo(0.8, 0.06, 0.22, 0), tm('#fff4ea'), lad.x, 0.28 + i * 0.3, lad.z + 0.48 - i * 0.07);
  b.m(boxGeo(0.8, 0.08, 0.6, 0), tm('#fff4ea'), lad.x, 1.02, lad.z);
  b.box(lad.x - 0.42, 0, lad.z - 0.32, lad.x + 0.42, 1.06, lad.z + 0.32);
  // the table-model of Хрумляндия
  const tb = new THREE.Vector3(-0.6, 0, 0.9);
  b.cy(tmat(gingerTex(pal.ginger)), 0.28, 0.82, tb.x, 0, tb.z, 12);
  b.m(cg('town-table', () => new THREE.CylinderGeometry(1, 1, 0.12, 32)), tm('#c8803e'), tb.x, 0.86, tb.z, { s: 1.35, sy: 1 });
  b.m(cg('town-disc', () => new THREE.CylinderGeometry(1, 1, 0.3, 32)), tmat(mapTableTex()), tb.x, 0.93, tb.z, { sx: 1.25, sy: 0.08, sz: 1.25 });
  // little marshmallow towers, a black castle and a flag on the model
  for (const [dx, dz, h, c] of [[-0.35, 0.25, 0.22, '#ffd6e4'], [-0.28, 0.32, 0.16, '#fff4f6'], [0.62, -0.62, 0.3, '#2a2030'], [-0.62, 0.05, 0.12, '#ffd34a']] as const) b.cy(tm(c), 0.05, h, tb.x + dx, 0.95, tb.z + dz, 8);
  b.cyl(tb.x, tb.z, 1.35, 0, 0.95);
  // the bench along the back with retorts and flasks
  const benchZ = -r + 1.6;
  b.m(boxGeo(5.2, 1.0, 1.2, 1), tmat(gingerTex(pal.ginger)), 0, 0.5, benchZ);
  b.m(boxGeo(5.4, 0.12, 1.35, 1), tm('#fff4ea'), 0, 1.06, benchZ);
  b.box(-2.7, 0, benchZ - 0.68, 2.7, 1.12, benchZ + 0.68);
  const liquids = ['#ff5a8a', '#7ad8ff', '#ffd04a', '#9af08a', '#c88aff'];
  const bubbles: { m: THREE.Mesh; x: number; y0: number; z: number; ph: number; h: number }[] = [];
  const bubG = b.group(0, 0, 0, undefined, true);
  const glassM = tm('#e8f8ff', { transparent: true, opacity: 0.55 });
  for (let i = 0; i < 6; i++) {
    const x = -2.2 + i * 0.88, z = benchZ + (R() - 0.5) * 0.4;
    const lc = liquids[i % liquids.length];
    const kind = i % 3;
    if (kind === 0) {
      b.m(unitSphere(14), glassM, x, 1.48, z, { s: 0.36, keep: true });
      b.m(unitSphere(14), bmat(lc), x, 1.42, z, { s: 0.3 });
      b.cy(glassM, 0.08, 0.55, x, 1.75, z, 8, { keep: true });
    } else if (kind === 1) {
      b.m(cg('town-erl', () => new THREE.CylinderGeometry(0.1, 0.36, 0.6, 14).translate(0, 0.3, 0)), glassM, x, 1.12, z, { keep: true });
      b.m(cg('town-erl2', () => new THREE.CylinderGeometry(0.2, 0.34, 0.32, 14).translate(0, 0.16, 0)), bmat(lc), x, 1.13, z);
    } else {
      b.m(unitSphere(14), glassM, x, 1.45, z, { s: 0.32, keep: true });
      b.m(unitSphere(14), bmat(lc), x, 1.4, z, { s: 0.26 });
      b.m(cg('town-retort', () => new THREE.CylinderGeometry(0.04, 0.09, 0.9, 8)), glassM, x + 0.35, 1.72, z, { rz: -1.0, keep: true });
    }
    for (let k = 0; k < 2; k++) {
      const m = b.m(unitSphere(6), bmat('#ffffff', { transparent: true, opacity: 0.8 }), x, 1.6, z, { parent: bubG, s: 0.05, glow: true, dyn: true });
      bubbles.push({ m, x, y0: 1.55, z, ph: R() * 3, h: 0.5 + R() * 0.4 });
    }
    const gl = glow(lc, 0.9, 0.35); gl.position.set(x, 1.45, z); b.root.add(gl);
  }
  // a smoking flask (the «БУМ!») on the bench
  b.m(unitSphere(10), tm('#6a6a7a', { transparent: true, opacity: 0.5 }), 2.2, 1.9, benchZ, { s: 0.3, keep: true });
  // shelves with jars on the wall behind
  b.m(boxGeo(4.4, 0.14, 0.6, 1), tmat(gingerTex(pal.gingerDark)), 0, 2.4, -r + th + 0.32);
  for (let i = 0; i < 6; i++) {
    const x = -1.9 + i * 0.76, lc = liquids[(i + 2) % liquids.length];
    b.cy(tm('#e8f8ff', { transparent: true, opacity: 0.6 }), 0.17, 0.42, x, 2.47, -r + th + 0.32, 10, { keep: true });
    b.cy(tm(lc), 0.14, 0.3, x, 2.48, -r + th + 0.32, 10);
    b.cy(tm('#c8803e'), 0.1, 0.08, x, 2.89, -r + th + 0.32, 8);
  }
  // chalkboard on the wall (left)
  const cbA = -1.05;
  const cbg = b.group(Math.sin(cbA) * (r - th - 0.05), 2.0, Math.cos(cbA) * (r - th - 0.05));
  cbg.rotation.y = cbA + Math.PI;
  b.m(cg('town-plane', () => new THREE.PlaneGeometry(1, 1)), tmat(chalkTex()), 0, 0, 0, { parent: cbg, sx: 2.4, sy: 1.5, cast: false });
  // the Sunny Syrup vat (back right): copper cauldron with glowing gold syrup
  const vx = 3.0, vz = -2.2;
  b.m(latheC('town-vat', [[0, 0, 0], [0.8, 0, 0.1], [1, 0.3, 0.3], [1.05, 0.7, 0.6], [1, 1, 0.9, 1], [0.92, 1, 0.95], [0.9, 0.9, 1]], 28), copper, vx, 0, vz, { sx: 1.05, sy: 1.15, sz: 1.05 });
  b.m(cg('town-disc', () => new THREE.CylinderGeometry(1, 1, 0.3, 32)), bmat('#ffd84a'), vx, 1.0, vz, { sx: 0.92, sy: 0.2, sz: 0.92 });
  const vatGlow = glow('#ffcf3a', 3.2, 0.5); vatGlow.position.set(vx, 1.4, vz); b.root.add(vatGlow);
  for (const [dx, dz] of [[-0.65, -0.65], [0.65, -0.65], [0, 0.8]] as const) b.cy(tm('#5a3a2a'), 0.08, 0.5, vx + dx, 0, vz + dz, 6);
  for (let k = 0; k < 6; k++) {
    const m = b.m(unitSphere(8), bmat('#fff2a0'), vx, 1.1, vz, { parent: bubG, s: 0.09, glow: true, dyn: true });
    bubbles.push({ m, x: vx + (R() - 0.5) * 1.1, y0: 1.02, z: vz + (R() - 0.5) * 1.1, ph: R() * 3, h: 0.35 + R() * 0.3 });
  }
  b.cyl(vx, vz, 1.1, 0, 1.15);
  b.update((t) => {
    for (const bb of bubbles) {
      const k = (t * 0.8 + bb.ph) % 1;
      bb.m.position.set(bb.x + Math.sin(t * 3 + bb.ph) * 0.03, bb.y0 + k * bb.h, bb.z);
      bb.m.scale.setScalar(0.05 + k * 0.05);
    }
    vatGlow.material.opacity = 0.42 + Math.sin(t * 2.3) * 0.08;
  });
  // walls (round, door gap), the lintel over the door, the dome as a cap you can stand on (no climbing in through it)
  ringCols(b, 0, 0, rm, 0, wallH + 0.25, { gapAt: doorA, gapHalf: doorHalf + 0.05, post: 0.42 });
  b.box(-doorW / 2 - 0.4, 3.4, rm - th / 2 - 0.1, doorW / 2 + 0.4, wallH + 0.25, rm + th / 2 + 0.1);
  b.cyl(0, 0, r - 0.2, wallH + 0.1, wallH + 0.6);
  b.cyl(0, 0, r * 0.7, wallH + 0.6, wallH + r * 0.72);
  b.cyl(0, 0, r * 0.38, wallH + r * 0.72, wallH + r * 0.95);
  const out = b.done(o.x, o.y, o.z, o.rotY ?? 0) as LabBuilt;
  const q = Math.round(o.rotY ?? 0) * Math.PI / 2;
  const rot = (lx: number, lz: number) => new THREE.Vector3(o.x + Math.cos(q) * lx + Math.sin(q) * lz, o.y, o.z - Math.sin(q) * lx + Math.cos(q) * lz);
  out.princess = rot(-0.9, benchZ + 1.5);
  out.door = rot(0, r + 1.6);
  return out;
}

/** the table-model of Хрумляндия: candy lands, roads, fog over the unknown, the black castle */
function mapTableTex() {
  return cachedTex('mapTable', 256, 256, (g, w, h) => {
    g.fillStyle = '#8ad0ff'; g.fillRect(0, 0, w, h);
    const R = rng(5);
    g.fillStyle = '#b8e8a0';
    g.beginPath(); for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU, rr0 = 96 + R() * 20; const x = w / 2 + Math.cos(a) * rr0, y = h / 2 + Math.sin(a) * rr0 * 0.8; if (i) g.lineTo(x, y); else g.moveTo(x, y); } g.closePath(); g.fill();
    g.strokeStyle = '#c8a070'; g.lineWidth = 3; g.setLineDash([6, 5]);
    const nodes: [number, number, string][] = [[70, 150, '#8a6a4a'], [100, 130, '#ff9fc0'], [130, 160, '#ffd6e4'], [175, 140, '#6a8a6a'], [150, 95, '#bfe8ff'], [185, 75, '#5a5a6a'], [205, 50, '#2a2030']];
    g.beginPath(); nodes.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); g.setLineDash([]);
    for (const [x, y, c] of nodes) { g.fillStyle = c; g.beginPath(); g.arc(x, y, 9, 0, TAU); g.fill(); g.lineWidth = 2; g.strokeStyle = '#2a1b1a'; g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,0.75)';
    for (const [x, y, rr0] of [[160, 160, 26], [180, 95, 30], [205, 55, 22], [60, 70, 34], [40, 200, 26]] as const) { g.beginPath(); g.arc(x, y, rr0, 0, TAU); g.fill(); }
    g.fillStyle = '#ff3a4a'; g.beginPath(); g.moveTo(70, 150); g.lineTo(70, 128); g.lineTo(84, 134); g.lineTo(70, 140); g.fill();
  });
}

// ───────────────────────── the clock tower ─────────────────────────

export interface ClockOpts extends Pal { x: number; y: number; z: number; r?: number; h?: number }
export interface ClockBuilt extends Built { top: number }

/** «Часовая башня»: a tall marshmallow tower with a candy clock on four sides, an open belfry and a striped spire. */
export function clockTower(o: ClockOpts): ClockBuilt {
  const pal = P(o);
  const b = new B('clock');
  const r = o.r ?? 2.6, h = o.h ?? 13;
  const body = marshmallowTower({ x: 0, y: 0, z: 0, r, h, wall: pal.walls[3], roof: pal.roofs[4], top: 'deck', pal, seed: 711, windows: true });
  b.root.add(body.obj); b.cols.push(...body.colliders);
  if (body.update) b.update(body.update);
  const cr = r * 1.04;
  b.m(boxGeo(cr * 2, 3.0, cr * 2, 2), tmat(marshTex(pal.walls[0])), 0, h + 1.5, 0);
  b.m(boxGeo(cr * 2 + 0.3, 0.3, cr * 2 + 0.3, 1), tm(pal.icing), 0, h + 0.15, 0);
  b.m(boxGeo(cr * 2 + 0.3, 0.3, cr * 2 + 0.3, 1), tm(pal.icing), 0, h + 3.0, 0);
  const hands: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    const g = b.group(Math.sin(a) * (cr + 0.02), h + 1.5, Math.cos(a) * (cr + 0.02));
    g.rotation.y = a;
    b.m(cg('town-clock', () => new THREE.CircleGeometry(1, 32)), tmat(clockTex(), '#ffffff'), 0, 0, 0.01, { parent: g, s: 1.15, cast: false });
    b.m(cg('town-torus-clock', () => new THREE.TorusGeometry(1, 0.08, 8, 32)), tm('#ffd34a'), 0, 0, 0.03, { parent: g, s: 1.18 });
    const hg = b.group(0, 0, 0.08, g, true);
    b.bx(tm('#3a2a4a'), 0.09, 0.85, 0.04, 0, 0.36, 0, 0, { parent: hg, dyn: true });
    const mg = b.group(0, 0, 0.1, g, true);
    b.bx(tm('#ff4f7a'), 0.06, 1.0, 0.04, 0, 0.45, 0, 0, { parent: mg, dyn: true });
    b.sp(tm('#ffd34a'), 0.09, 0, 0, 0.14, 8, { parent: g });
    hands.push(hg, mg);
  }
  // belfry: four candy-cane posts, a bell, a spire
  const by = h + 3.15;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) b.cy(tmat(caneTex('#fff8f0', pal.roofs[4], 4)), 0.16, 2.2, sx * (cr - 0.3), by, sz * (cr - 0.3), 8);
  const bell = b.group(0, by + 2.0, 0, undefined, true);
  b.m(latheC('town-bell', [[0, 0, 0], [0.9, 0, 0.1], [0.75, 0.2, 0.3], [0.5, 0.75, 0.7], [0.3, 1, 0.9], [0, 1.05, 1]], 20), tm('#ffd34a', { emissive: '#a06010', emissiveIntensity: 0.15 }), 0, -1.1, 0, { parent: bell, s: 0.9 });
  b.m(boxGeo(cr * 2 + 0.5, 0.3, cr * 2 + 0.5, 1), tm(pal.icing), 0, by + 2.3, 0);
  b.m(cg('town-cone4', () => new THREE.ConeGeometry(1, 1, 4, 1).translate(0, 0.5, 0)), tmat(stripeTex(pal.roofs[4], shade(pal.roofs[4], 0.3), 4)), 0, by + 2.45, 0, { sx: cr * 1.45, sy: 4.2, sz: cr * 1.45, ry: Math.PI / 4 });
  b.sp(tm('#ffd34a', { emissive: '#ffb020', emissiveIntensity: 0.3 }), 0.3, 0, by + 6.75, 0, 12);
  b.box(-cr, h, -cr, cr, by + 2.45, cr);
  b.update((t) => {
    for (let i = 0; i < hands.length; i += 2) { hands[i].rotation.z = -t * 0.01 - 1.2; hands[i + 1].rotation.z = -t * 0.12; }
    bell.rotation.z = Math.sin(t * 0.9) * 0.05;
  });
  const out = b.done(o.x, o.y, o.z, 0) as ClockBuilt;
  out.top = o.y + by + 6.9;
  return out;
}

const texCache = new Map<string, THREE.Texture>();
function cachedTex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  let t = texCache.get(key);
  if (!t) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    draw(cv.getContext('2d')!, w, h);
    t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    texCache.set(key, t);
  }
  return t;
}
function clockTex() {
  return cachedTex('clockface', 256, 256, (g, w, h) => {
    g.fillStyle = '#fff8ee'; g.beginPath(); g.arc(w / 2, h / 2, w / 2, 0, TAU); g.fill();
    g.strokeStyle = '#ff9fc0'; g.lineWidth = 10; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 10, 0, TAU); g.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      g.fillStyle = ['#ff5a8a', '#7ad8ff', '#ffd04a', '#9af08a'][i % 4];
      g.beginPath(); g.arc(w / 2 + Math.sin(a) * 96, h / 2 - Math.cos(a) * 96, i % 3 === 0 ? 13 : 8, 0, TAU); g.fill();
    }
  });
}

// ───────────────────────── small things by the gate and the shops ─────────────────────────

/** a candy-cane post with an arrow board */
export function townSignpost(o: Pal & { x: number; y: number; z: number; rotY?: number; label: string }): Built {
  const pal = P(o);
  const b = new B('tsign');
  b.cy(tmat(caneTex('#fff8f0', pal.candy[0], 4)), 0.09, 2.3, 0, 0, 0, 8);
  b.sp(tm('#ffd34a'), 0.14, 0, 2.38, 0, 10);
  const s = new THREE.Shape(); s.moveTo(-0.9, -0.28); s.lineTo(0.7, -0.28); s.lineTo(1.0, 0); s.lineTo(0.7, 0.28); s.lineTo(-0.9, 0.28); s.closePath();
  // the board hangs in FRONT of the post (the cane, r 0.09, used to poke through the label: «К▮РТА»)
  b.m(new THREE.ExtrudeGeometry(s, { depth: 0.08, bevelEnabled: false }), tm('#9ae06a'), 0.35, 1.8, 0.1);
  b.m(cg('town-plane', () => new THREE.PlaneGeometry(1, 1)), tmat(boardTex(o.label, '#9ae06a', '#2a5a2a', 384, 110)), 0.3, 1.8, 0.19, { sx: 1.55, sy: 0.48, cast: false });
  // a little bracket holding it to the post
  b.bx(tm('#c8a050'), 0.06, 0.62, 0.12, 0, 1.8, 0.07);
  b.cyl(0, 0, 0.12, 0, 2.3);
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

/** a waffle doormat («Ноги — о коврик-вафлю»), flat, walk over it */
export function waffleMat(o: { x: number; y: number; z: number; w: number; d: number }): Built {
  const b = new B('waffle');
  const t = cachedTex('waffle', 128, 128, (g, w, h) => {
    g.fillStyle = '#e8b060'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c8883a';
    for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) g.fillRect(6 + i * 32, 6 + k * 32, 22, 22);
    g.fillStyle = 'rgba(255,255,255,0.25)'; for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) g.fillRect(6 + i * 32, 6 + k * 32, 22, 4);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  const geo = boxGeo(o.w, 0.06, o.d, 1.2);
  b.m(geo, tmat(t), 0, 0.03, 0, { cast: false });
  return b.done(o.x, o.y, o.z, 0);
}

/** a shop sign on a façade (bakery, post office) */
export function facadeSign(o: Pal & { x: number; y: number; z: number; rotY?: number; label: string; color: string; w?: number }): Built {
  const b = new B('fsign');
  const w = o.w ?? 2.6;
  b.bx(tm('#c8803e'), w + 0.2, 0.82, 0.1, 0, 0, 0);
  b.m(cg('town-plane', () => new THREE.PlaneGeometry(1, 1)), tmat(boardTex(o.label, o.color, '#6a2a4a', 512, 150)), 0, 0, 0.06, { sx: w, sy: 0.72, cast: false });
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

/** the post's mailbox */
export function mailbox(o: Pal & { x: number; y: number; z: number; rotY?: number }): Built {
  const b = new B('mailbox');
  b.cy(tm('#5a3a2a'), 0.07, 1.0, 0, 0, 0, 8);
  b.m(boxGeo(0.7, 0.9, 0.5, 0), tm('#3a6ad8'), 0, 1.4, 0);
  b.m(cg('town-mbtop', () => new THREE.CylinderGeometry(0.25, 0.25, 0.7, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2)), tm('#3a6ad8'), 0, 1.85, 0);
  b.bx(tm('#1a1a2a'), 0.42, 0.06, 0.04, 0, 1.6, 0.26);
  b.m(cg('town-heart', () => { const s = new THREE.Shape(); s.moveTo(0, -0.35); s.bezierCurveTo(-0.6, 0.05, -0.3, 0.5, 0, 0.22); s.bezierCurveTo(0.3, 0.5, 0.6, 0.05, 0, -0.35); return new THREE.ShapeGeometry(s); }), tm('#ffd34a'), 0, 1.3, 0.26, { s: 0.3 });
  b.cyl(0, 0, 0.36, 0, 2.1);
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

// ───────────────────────── castle gate ─────────────────────────

export interface GateOpts extends Pal { x: number; y: number; z: number; w?: number; rotY?: number; label?: string; labelIn?: string }
export interface GateBuilt extends Built { /** walkway top over the arch */ deck: number; open: number }

/** The town gate: two marshmallow towers, a layered pastila arch with a raised licorice portcullis, banners and a name board. */
export function castleGate(o: GateOpts): GateBuilt {
  const pal = P(o);
  const b = new B('cgate');
  const w = o.w ?? 6;
  const archH = 6.2, deckY = 7.4, th = 2.2;
  const lm = tmat(layersTex([pal.wall, pal.wallTop, shade(pal.wall, -0.06), pal.wallTop], 5));
  const icing = tm(pal.icing);
  const span = w + 2.2;
  // arch body
  const ring = new THREE.ExtrudeGeometry(archRing(w, archH, 1.1), { depth: th, bevelEnabled: false });
  ring.translate(0, 0, -th / 2);
  b.m(ring, lm, 0, 0, 0);
  // walls above the arch up to the deck
  const ys = archH - w / 2;
  const s = new THREE.Shape();
  s.moveTo(-span / 2, ys); s.absarc(0, ys, span / 2, Math.PI, 0, true); s.lineTo(span / 2, deckY); s.lineTo(-span / 2, deckY); s.closePath();
  const top = new THREE.ExtrudeGeometry(s, { depth: th, bevelEnabled: false });
  top.translate(0, 0, -th / 2);
  b.m(top, lm, 0, 0, 0);
  // deck + merlons
  b.m(boxGeo(span + 0.6, 0.4, th + 0.6, 2), tm(pal.wallTop), 0, deckY + 0.2, 0);
  for (let i = 0; i < 6; i++) for (const sz of [-1, 1]) b.m(puffGeo(), icing, -span / 2 + 0.6 + i * (span - 1.2) / 5, deckY + 0.4, sz * (th / 2 + 0.05), { sx: 0.38, sy: 0.6, sz: 0.38 });
  // portcullis (raised: only its spiky lower edge shows under the arch top)
  const lic = tm('#3a2238');
  for (let i = 0; i < 7; i++) {
    const x = -w / 2 + 0.45 + i * (w - 0.9) / 6;
    b.cy(lic, 0.09, 1.6, x, archH - 1.6 + 0.2, 0, 8);
    b.m(cg('town-spike', () => new THREE.ConeGeometry(0.12, 0.36, 8).rotateX(Math.PI)), lic, x, archH - 1.6 + 0.02, 0);
  }
  b.bx(lic, w - 0.4, 0.14, 0.14, 0, archH - 0.9, 0);
  // name boards on both faces
  const label = o.label ?? 'ПАСТИЛЬНОЕ КОРОЛЕВСТВО';
  for (const sz of [-1, 1]) b.m(cg('town-plane', () => new THREE.PlaneGeometry(1, 1)), tmat(boardTex(sz > 0 ? label : o.labelIn ?? label, sz > 0 ? '#ff7aa8' : '#9ae06a', sz > 0 ? '#7a2a5a' : '#2a5a2a', 768, 110)), 0, archH + 0.35, sz * (th / 2 + 0.03), { sx: Math.min(span - 1, 7.6), sy: 1.05, ry: sz > 0 ? 0 : Math.PI, cast: false });
  // flanking towers
  for (const sx of [-1, 1]) {
    const tw = marshmallowTower({ x: sx * (span / 2 + 1.3), y: 0, z: 0, r: 2.0, h: 9.5, wall: pal.walls[sx > 0 ? 1 : 0], roof: pal.roofs[0], pal, seed: 400 + sx, windows: true });
    b.root.add(tw.obj); b.cols.push(...tw.colliders);
    if (tw.update) b.update(tw.update);
    // banners hanging off the towers
    const bg = b.group(sx * (span / 2 + 1.3), 6.4, 2.05);
    b.m(cg('town-plane', () => new THREE.PlaneGeometry(1, 1)), tmat(stripeTex(pal.roofs[2], '#fff6ee', 2), '#ffffff', { side: THREE.DoubleSide }), 0, 0, 0, { parent: bg, sx: 1.0, sy: 2.4, cast: false });
    b.sp(tm('#ffd34a'), 0.14, 0, 1.25, 0, 8, { parent: bg });
  }
  // colliders: the arch's sides and the deck (towers come with theirs)
  b.box(-span / 2, 0, -th / 2, -w / 2, deckY, th / 2);
  b.box(w / 2, 0, -th / 2, span / 2, deckY, th / 2);
  b.box(-span / 2, archH - 0.3, -th / 2, span / 2, deckY + 0.4, th / 2);
  const out = b.done(o.x, o.y, o.z, o.rotY ?? 0) as GateBuilt;
  out.deck = o.y + deckY + 0.4; out.open = w;
  return out;
}

// ───────────────────────── market stall ─────────────────────────

export type Goods = 'candy' | 'jars' | 'cakes' | 'balloons';
export interface StallOpts extends Pal { x: number; y: number; z: number; rotY?: number; goods?: Goods; color?: string; label?: string; seed?: number }

/** A market stall: gingerbread counter, candy-cane posts, a striped scalloped awning, goods and a little sign. */
export function marketStall(o: StallOpts): Built {
  const pal = P(o);
  const seed = o.seed ?? hashSeed(o.x, o.z);
  const R = rng(seed);
  const b = new B('mstall');
  const col = o.color ?? pickC(pal.candy, seed);
  const w = 2.8, d = 1.3, ch = 1.05, ph = 2.5;
  b.m(boxGeo(w, ch, d, 1.5), tmat(gingerTex(pal.ginger)), 0, ch / 2, 0);
  b.m(boxGeo(w + 0.2, 0.12, d + 0.2, 1), tm(pal.icing), 0, ch + 0.06, 0);
  icingEdge(b, tm(pal.icing), -w / 2 - 0.1, ch, d / 2 + 0.1, w / 2 + 0.1, ch, d / 2 + 0.1, seed, { maxLen: 0.3, bead: 0.08 });
  const cane = tmat(caneTex('#fff8f0', col, 4));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cy(cane, 0.07, ph + 0.2, sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08), 8);
  // awning: slanted striped slab + scallops
  const ag = b.group(0, ph + 0.35, 0.15);
  ag.rotation.x = 0.28;
  b.m(boxGeo(w + 0.5, 0.08, d + 0.9, 0), tmat(stripeTex(col, '#fff6ee', 5)), 0, 0, 0, { parent: ag });
  for (let i = 0; i < 9; i++) b.m(cg('town-scallop', () => new THREE.CylinderGeometry(1, 1, 0.06, 14, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(-Math.PI / 2)), tm(i % 2 ? '#fff6ee' : col), -w / 2 - 0.25 + (i + 0.5) * (w + 0.5) / 9, -0.02, (d + 0.9) / 2, { parent: ag, s: (w + 0.5) / 18 });
  // goods
  const goods = o.goods ?? 'candy';
  if (goods === 'candy') {
    for (let i = 0; i < 9; i++) {
      const x = -w / 2 + 0.35 + (i % 5) * 0.52, z = -0.2 + Math.floor(i / 5) * 0.42;
      const c = pickC(pal.candy, seed + i);
      if (i % 3 === 0) b.m(gumdropGeo(), tm(c), x, ch + 0.12, z, { sx: 0.18, sy: 0.22, sz: 0.18 });
      else if (i % 3 === 1) { b.sp(tm(c), 0.14, x, ch + 0.26, z, 10); b.m(cg('town-wrap', () => new THREE.ConeGeometry(0.1, 0.18, 6).rotateZ(Math.PI / 2)), tm(shade(c, 0.3)), x + 0.2, ch + 0.26, z); b.m(cg('town-wrap2', () => new THREE.ConeGeometry(0.1, 0.18, 6).rotateZ(-Math.PI / 2)), tm(shade(c, 0.3)), x - 0.2, ch + 0.26, z); }
      else { b.cy(tm('#fffaf2'), 0.025, 0.5, x, ch + 0.12, z, 6); b.m(cg('town-lolly-s', () => new THREE.CylinderGeometry(1, 1, 0.1, 16).rotateX(Math.PI / 2)), tmat(stripeTex(c, '#ffffff', 4)), x, ch + 0.7, z, { s: 0.2 }); }
    }
  } else if (goods === 'jars') {
    for (let i = 0; i < 6; i++) {
      const x = -w / 2 + 0.4 + i * 0.4, c = pickC(pal.jelly, seed + i);
      b.cy(tm('#e8f8ff', { transparent: true, opacity: 0.6 }), 0.16, 0.45, x, ch + 0.12, 0.1 * (i % 2), 10, { keep: true });
      b.cy(tm(c), 0.13, 0.32, x, ch + 0.13, 0.1 * (i % 2), 10);
      b.cy(tm(pickC(pal.candy, i)), 0.17, 0.08, x, ch + 0.57, 0.1 * (i % 2), 10);
    }
  } else if (goods === 'cakes') {
    for (let i = 0; i < 3; i++) {
      const x = -0.9 + i * 0.9, c = pickC(pal.candy, seed + i);
      b.cy(tm(pal.walls[(i + 1) % pal.walls.length]), 0.34, 0.32, x, ch + 0.12, 0, 16);
      b.m(puffGeo(), tm(shade(c, 0.35)), x, ch + 0.44, 0, { sx: 0.36, sy: 0.12, sz: 0.36 });
      b.sp(tm('#ff3a5a'), 0.07, x, ch + 0.6, 0, 8);
    }
  } else {
    const bg = b.group(w / 2 - 0.2, ph + 0.5, d / 2 - 0.1, undefined, true);
    for (let i = 0; i < 5; i++) {
      const a = i * 1.3, h0 = 0.9 + R() * 0.7;
      const p = new THREE.Vector3(Math.sin(a) * 0.35, h0, Math.cos(a) * 0.3);
      b.m(cg('town-balloon', () => new THREE.SphereGeometry(1, 14, 12).scale(1, 1.18, 1)), tm(pickC(pal.candy, seed + i)), p.x, p.y, p.z, { parent: bg, s: 0.28 });
      const str = b.m(cg('town-cyl12', () => new THREE.CylinderGeometry(1, 1, 1, 12)), tm('#ffffff'), p.x / 2, p.y / 2 - 0.1, p.z / 2, { parent: bg, sx: 0.012, sy: p.length(), sz: 0.012 });
      str.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.clone().normalize());
    }
    const ph0 = R() * 5;
    b.update((t) => { bg.rotation.z = Math.sin(t * 1.1 + ph0) * 0.08; bg.rotation.x = Math.sin(t * 0.8 + ph0) * 0.06; });
  }
  if (o.label) b.m(cg('town-plane', () => new THREE.PlaneGeometry(1, 1)), tmat(boardTex(o.label, col, '#6a2a4a', 384, 110)), 0, ch - 0.45, d / 2 + 0.02, { sx: 1.9, sy: 0.55, cast: false });
  b.box(-w / 2, 0, -d / 2, w / 2, ch + 0.12, d / 2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(sx * (w / 2 - 0.08), sz * (d / 2 - 0.08), 0.1, 0, ph + 0.2);
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

// ───────────────────────── the shop ─────────────────────────

export interface ShopOpts extends Pal { x: number; y: number; z: number; rotY?: number; label?: string }
export interface ShopBuilt extends Built { keeper: THREE.Vector3; counter: THREE.Vector3 }

/**
 * The shop (Лавка): a gingerbread house whose front is a wide counter window under a striped awning, shelves of
 * jars and goods inside, a big sign on the roof. The keeper stands behind the counter (`keeper`), customers in front
 * of it (`counter`).
 */
export function shopHouse(o: ShopOpts): ShopBuilt {
  const pal = P(o);
  const b = new B('shop');
  const w = 7, d = 5, h = 3.8;
  const gm = tmat(gingerTex(pal.ginger));
  const icing = tm(pal.icing);
  const openW = 4.2, sill = 1.1, openTop = 3.0;
  // walls: back, sides, front pieces around the counter window
  b.m(boxGeo(w, h, 0.4, 2.4), gm, 0, h / 2, -d / 2 + 0.2);
  for (const sx of [-1, 1]) b.m(boxGeo(0.4, h, d, 2.4), gm, sx * (w / 2 - 0.2), h / 2, 0);
  const sideW = (w - openW) / 2;
  for (const sx of [-1, 1]) b.m(boxGeo(sideW, h, 0.4, 2.4), gm, sx * (openW / 2 + sideW / 2), h / 2, d / 2 - 0.2);
  b.m(boxGeo(openW, h - openTop, 0.4, 2.4), gm, 0, openTop + (h - openTop) / 2, d / 2 - 0.2);
  // counter
  b.m(boxGeo(openW, sill, 0.9, 1.5), tmat(stripeTex('#fff4ea', '#ffc8da', 10)), 0, sill / 2, d / 2 - 0.2);
  b.m(boxGeo(openW + 0.3, 0.14, 1.1, 1), icing, 0, sill + 0.07, d / 2 - 0.2);
  icingEdge(b, icing, -openW / 2 - 0.15, sill, d / 2 + 0.35, openW / 2 + 0.15, sill, d / 2 + 0.35, 31, { maxLen: 0.35, bead: 0.08 });
  // floor inside + the keeper's raised boards behind the counter
  b.m(boxGeo(w - 0.8, 0.1, d - 0.8, 1), tm('#f6d8c0'), 0, 0.05, 0);
  b.m(boxGeo(openW + 0.4, 0.45, 1.5, 1), tmat(gingerTex(pal.gingerDark)), 0, 0.225, 1.1);
  b.box(-openW / 2 - 0.2, 0, 0.35, openW / 2 + 0.2, 0.45, 1.85);
  // shelves on the back wall with jars, candies, and a cake
  for (const y of [1.4, 2.3]) {
    b.m(boxGeo(w - 1.2, 0.12, 0.6, 1), tmat(gingerTex(pal.gingerDark)), 0, y, -d / 2 + 0.7);
    for (let i = 0; i < 8; i++) {
      const x = -w / 2 + 1.0 + i * 0.68, c = pickC([...pal.jelly, ...pal.candy], i + (y > 2 ? 3 : 0));
      if ((i + (y > 2 ? 1 : 0)) % 2) { b.cy(tm('#e8f8ff', { transparent: true, opacity: 0.55 }), 0.2, 0.5, x, y + 0.06, -d / 2 + 0.7, 10, { keep: true }); b.cy(tm(c), 0.17, 0.36, x, y + 0.07, -d / 2 + 0.7, 10); b.cy(tm(pickC(pal.candy, i)), 0.21, 0.08, x, y + 0.56, -d / 2 + 0.7, 10); }
      else b.m(gumdropGeo(), tm(c), x, y + 0.06, -d / 2 + 0.7, { sx: 0.24, sy: 0.3, sz: 0.24 });
    }
  }
  // the honey jar of the old den (a little nod) on the counter
  b.cy(tm('#e8f8ff', { transparent: true, opacity: 0.55 }), 0.24, 0.55, -1.6, sill + 0.14, d / 2 - 0.2, 12, { keep: true });
  b.cy(tm('#ffb020'), 0.2, 0.42, -1.6, sill + 0.15, d / 2 - 0.2, 12);
  b.cy(tm('#c8803e'), 0.26, 0.1, -1.6, sill + 0.68, d / 2 - 0.2, 12);
  // a scale with sweets
  b.cy(tm('#ffd34a'), 0.05, 0.6, 1.4, sill + 0.14, d / 2 - 0.25, 8);
  b.m(cg('town-pan', () => new THREE.CylinderGeometry(0.32, 0.22, 0.1, 16)), tm('#ffd34a'), 1.4, sill + 0.78, d / 2 - 0.25);
  for (let i = 0; i < 4; i++) b.sp(tm(pickC(pal.candy, i)), 0.09, 1.3 + (i % 2) * 0.2, sill + 0.88 + Math.floor(i / 2) * 0.1, d / 2 - 0.25 + (i % 2 ? 0.08 : -0.06), 8);
  // awning
  const ag = b.group(0, openTop + 0.25, d / 2 + 0.2);
  ag.rotation.x = 0.35;
  b.m(boxGeo(openW + 1.2, 0.08, 1.8, 0), tmat(stripeTex('#ff7aa8', '#fff6ee', 6)), 0, 0, 0.8, { parent: ag });
  for (let i = 0; i < 12; i++) b.m(cg('town-scallop', () => new THREE.CylinderGeometry(1, 1, 0.06, 14, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(-Math.PI / 2)), tm(i % 2 ? '#fff6ee' : '#ff7aa8'), -openW / 2 - 0.6 + (i + 0.5) * (openW + 1.2) / 12, -0.02, 1.7, { parent: ag, s: (openW + 1.2) / 24 });
  // roof (pitched, iced) + sign
  const rh = 2.2, ov = 0.4, hd = d / 2 + ov;
  const s = new THREE.Shape(); s.moveTo(-d / 2, 0); s.lineTo(d / 2, 0); s.lineTo(0, rh); s.closePath();
  const prism = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
  prism.translate(0, 0, -w / 2); prism.rotateY(Math.PI / 2);
  b.m(prism, gm, 0, h, 0);
  const slope = Math.atan2(rh, hd), sl = Math.hypot(hd, rh) + 0.05;
  const roofM = tmat(sprinkleTex(shade('#ff9fc0', 0.3), pal.candy));
  for (const sz of [-1, 1]) {
    const g = b.group(0, h + rh / 2 + 0.1, sz * hd / 2); g.rotation.x = sz * slope;
    b.m(boxGeo(w + ov * 2, 0.26, sl, 2), roofM, 0, 0, 0, { parent: g });
    icingEdge(b, icing, -w / 2 - ov, h + 0.02, sz * hd, w / 2 + ov, h + 0.02, sz * hd, 40 + sz, { maxLen: 0.55 });
  }
  const sg = b.group(0, h + rh * 0.55, hd * 0.55 + 0.3);
  sg.rotation.x = -0.25;
  b.m(cg('town-plane', () => new THREE.PlaneGeometry(1, 1)), tmat(boardTex(o.label ?? 'ЛАВКА', '#ffd34a', '#7a2a4a', 512, 150)), 0, 0, 0.06, { parent: sg, sx: 3.6, sy: 1.05, cast: false });
  b.bx(tm('#c8803e'), 3.8, 1.2, 0.1, 0, 0, 0, 0, { parent: sg });
  // a giant lollipop by the door as a shop symbol
  b.cy(tm('#fffaf2'), 0.08, 2.6, w / 2 + 0.6, 0, d / 2 - 0.4, 8);
  b.m(cg('town-lolly', () => { const geo = new THREE.CylinderGeometry(1, 1, 0.28, 32, 1); geo.rotateX(Math.PI / 2); return geo; }), tmat(swirlTex('#ff5a8a', '#fff8f0')), w / 2 + 0.6, 3.2, d / 2 - 0.4, { s: 0.7 });
  // colliders
  b.box(-w / 2, 0, -d / 2, w / 2, h, -d / 2 + 0.4);
  for (const sx of [-1, 1]) b.box(sx > 0 ? w / 2 - 0.4 : -w / 2, 0, -d / 2, sx > 0 ? w / 2 : -w / 2 + 0.4, h, d / 2);
  for (const sx of [-1, 1]) b.box(sx > 0 ? openW / 2 : -w / 2, 0, d / 2 - 0.4, sx > 0 ? w / 2 : -openW / 2, h, d / 2);
  b.box(-openW / 2, 0, d / 2 - 0.75, openW / 2, sill + 0.14, d / 2 + 0.35);
  b.box(-openW / 2, openTop, d / 2 - 0.4, openW / 2, h, d / 2);
  b.box(-w / 2, h, -d / 2, w / 2, h + 0.6, d / 2);
  b.cyl(w / 2 + 0.6, d / 2 - 0.4, 0.15, 0, 2.6);
  const n = Math.ceil(rh / 0.34);
  for (let i = 0; i < n; i++) {
    const y1 = h + rh * ((i + 1) / n);
    const hz = Math.max(0.2, hd * (1 - (y1 - h) / rh) + (hd / n) * 0.5);
    b.box(-w / 2 - ov, h + rh * (i / n), -hz, w / 2 + ov, y1 + 0.05, hz);
  }
  const out = b.done(o.x, o.y, o.z, o.rotY ?? 0) as ShopBuilt;
  const q = Math.round(o.rotY ?? 0) * Math.PI / 2;
  const rot = (lx: number, lz: number) => new THREE.Vector3(o.x + Math.cos(q) * lx + Math.sin(q) * lz, o.y, o.z - Math.sin(q) * lx + Math.cos(q) * lz);
  out.keeper = rot(0, 1.2).setY(o.y + 0.45);
  out.counter = rot(0, d / 2 + 1.6);
  return out;
}

// ───────────────────────── the hero mirror ─────────────────────────

export interface MirrorOpts extends Pal { x: number; y: number; z: number; rotY?: number }

/** «Зеркало героев»: a tall arched mirror in a golden candy frame on a gingerbread dais; its glass shimmers and sparkles. */
export function heroMirror(o: MirrorOpts): Built {
  const pal = P(o);
  const b = new B('hmirror');
  const mw = 1.9, mh = 3.4, base = 0.5;
  const gold = tm('#ffd34a', { emissive: '#ffa020', emissiveIntensity: 0.2 });
  // dais steps
  b.m(cg('town-dais', () => new THREE.CylinderGeometry(1, 1.05, 1, 24).translate(0, 0.5, 0)), tmat(layersTex(pal.bank, 2)), 0, 0, 0, { sx: 1.9, sy: 0.25, sz: 1.5 });
  b.m(cg('town-dais', () => new THREE.CylinderGeometry(1, 1.05, 1, 24).translate(0, 0.5, 0)), tm(pal.icing), 0, 0.25, 0, { sx: 1.5, sy: 0.25, sz: 1.15 });
  // frame
  const frame = new THREE.ExtrudeGeometry(archRing(mw, mh, 0.28), { depth: 0.3, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2 });
  frame.translate(0, 0, -0.15);
  b.m(frame, gold, 0, base, 0);
  b.m(boxGeo(mw + 0.56, 0.3, 0.42, 0), gold, 0, base, 0);
  // back panel
  const back = new THREE.ExtrudeGeometry(archShape(mw + 0.1, mh + 0.05, 0), { depth: 0.12, bevelEnabled: false });
  back.translate(0, 0, -0.2);
  b.m(back, tm('#7a3a6a'), 0, base, 0);
  // mirror glass (shimmering)
  const mt = mirrorTex().clone(); mt.needsUpdate = true; mt.wrapS = mt.wrapT = THREE.RepeatWrapping;
  const glass = new THREE.Mesh(shapeGeo(archShape(mw, mh, 0), 20), new THREE.MeshBasicMaterial({ map: mt }));
  glass.position.set(0, base, 0.02); glass.userData.keep = true;
  b.root.add(glass);
  const glass2 = new THREE.Mesh(glass.geometry, tm('#7a3a6a')); glass2.rotation.y = Math.PI; glass2.position.set(0, base, -0.22); b.root.add(glass2);
  // candy gems on the frame + a heart crest
  const gems = ['#ff5a8a', '#7ad8ff', '#9af08a', '#c88aff'];
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (i / 8);
    const rx = Math.cos(a) * (mw / 2 + 0.14), ry = mh - mw / 2 + Math.sin(a) * (mw / 2 + 0.14);
    b.m(cg('town-gem', () => new THREE.OctahedronGeometry(1, 0)), tm(gems[i % 4], { emissive: gems[i % 4], emissiveIntensity: 0.25 }), rx, base + ry, 0.2, { s: 0.13 });
  }
  const heart = new THREE.Shape(); heart.moveTo(0, -0.35); heart.bezierCurveTo(-0.6, 0.05, -0.3, 0.5, 0, 0.22); heart.bezierCurveTo(0.3, 0.5, 0.6, 0.05, 0, -0.35);
  b.m(new THREE.ExtrudeGeometry(heart, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2 }), tm('#ff4f7a', { emissive: '#ff2050', emissiveIntensity: 0.2 }), 0, base + mh + 0.5, 0.0, { s: 0.9 });
  for (const sx of [-1, 1]) b.cy(gold, 0.09, 1.4, sx * (mw / 2 + 0.3), 0.25, -0.35, 8);
  // sparkles drifting over the glass
  const spg = b.group(0, 0, 0, undefined, true);
  const sparks: { s: THREE.Sprite; x: number; y: number; ph: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const s = glow('#ffffff', 0.4, 0.8);
    const x = (Math.random() - 0.5) * mw * 0.8, y = base + 0.4 + Math.random() * (mh - 0.6);
    s.position.set(x, y, 0.12); spg.add(s);
    sparks.push({ s, x, y, ph: Math.random() * 6 });
  }
  const aura = glow('#c8b4ff', 5.5, 0.22); aura.position.set(0, base + mh / 2, 0.2); b.root.add(aura);
  b.update((t) => {
    mt.offset.set(Math.sin(t * 0.3) * 0.08, (t * 0.06) % 1);
    for (const sp of sparks) { const k = (Math.sin(t * 2 + sp.ph) + 1) / 2; sp.s.scale.setScalar(0.15 + k * 0.45); sp.s.position.y = sp.y + Math.sin(t * 0.7 + sp.ph) * 0.15; }
    aura.material.opacity = 0.18 + Math.sin(t * 1.6) * 0.06;
  });
  b.cyl(0, 0, 1.5, 0, 0.5);
  b.box(-mw / 2 - 0.3, 0.5, -0.3, mw / 2 + 0.3, base + mh + 0.3, 0.22);
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

// ───────────────────────── notice board ─────────────────────────

export interface NoticeOpts extends Pal { x: number; y: number; z: number; rotY?: number; notes: { title: string; lines: string[] }[] }

/** «Доска объявлений»: a gingerbread board under a little iced roof with pinned paper notes. */
export function noticeBoard(o: NoticeOpts): Built {
  const pal = P(o);
  const b = new B('nboard');
  const w = 3.4, bh = 1.9, by = 0.8;
  const gm = tmat(gingerTex(pal.ginger));
  for (const sx of [-1, 1]) b.cy(tmat(caneTex('#fff8f0', pal.candy[0], 4)), 0.1, by + bh + 0.6, sx * (w / 2 - 0.1), 0, 0, 8);
  b.m(boxGeo(w, bh, 0.2, 1.2), gm, 0, by + bh / 2, 0);
  b.m(boxGeo(w - 0.3, bh - 0.3, 0.05, 0), tm('#d8a070'), 0, by + bh / 2, 0.11);
  // roof
  const rg = b.group(0, by + bh + 0.55, 0);
  for (const sz of [-1, 1]) {
    const g = b.group(0, 0, sz * 0.32, rg); g.rotation.x = sz * 0.75;
    b.m(boxGeo(w + 0.5, 0.12, 0.9, 1), tmat(sprinkleTex(shade(pal.roofs[1], 0.35), pal.candy)), 0, 0, 0, { parent: g });
  }
  icingEdge(b, tm(pal.icing), -w / 2 - 0.25, by + bh + 0.22, 0.62, w / 2 + 0.25, by + bh + 0.22, 0.62, 5, { maxLen: 0.3, bead: 0.07 });
  // notes
  const notes = o.notes.slice(0, 3);
  const paper = ['#fff8e8', '#fff0f6', '#eef8ff'];
  const pins = ['#ff4f6a', '#4fa8ff', '#5ac85a'];
  notes.forEach((n, i) => {
    const x = -w / 2 + 0.6 + i * ((w - 1.2) / Math.max(1, notes.length - 1));
    const nm = b.m(cg('town-plane', () => new THREE.PlaneGeometry(1, 1)), tmat(noteTex(n.title, n.lines, paper[i % 3], pins[i % 3]), '#ffffff', { transparent: true, alphaTest: 0.05 }), notes.length === 1 ? 0 : x, by + bh / 2 + (i % 2 ? -0.08 : 0.06), 0.15, { sx: 1.05, sy: 1.05, cast: false });
    nm.rotation.z = (i - 1) * 0.06;
  });
  b.box(-w / 2, 0, -0.15, w / 2, by + bh + 0.3, 0.15);
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

// ───────────────────────── small decor ─────────────────────────

/** A candy bench (gingerbread planks on cane legs). Sit height ≈ 0.55. */
export function candyBench(o: Pal & { x: number; y: number; z: number; rotY?: number; color?: string }): Built {
  const pal = P(o);
  const b = new B('cbench');
  const col = o.color ?? pal.candy[0];
  const gm = tmat(gingerTex(pal.ginger));
  b.m(boxGeo(2.2, 0.14, 0.7, 1), gm, 0, 0.55, 0);
  b.m(boxGeo(2.2, 0.55, 0.12, 1), gm, 0, 0.95, -0.3);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cy(tmat(caneTex('#fff8f0', col, 3)), 0.06, 0.55, sx * 0.95, 0, sz * 0.25, 8);
  icingEdge(b, tm(pal.icing), -1.1, 1.23, -0.3, 1.1, 1.23, -0.3, 3, { bead: 0.06, maxLen: 0.15, drips: 5 });
  b.box(-1.1, 0, -0.35, 1.1, 0.62, 0.35);
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

/** A bed of candy flowers (lollipop blossoms, sugar leaves) in a cookie-crust border. Walk-through (no collider). */
export function flowerBed(o: Pal & { x: number; y: number; z: number; w: number; d: number; seed?: number }): Built {
  const pal = P(o);
  const seed = o.seed ?? hashSeed(o.x, o.z);
  const R = rng(seed);
  const b = new B('fbed');
  b.m(boxGeo(o.w, 0.22, o.d, 1), tm(shade(pal.ginger, 0.15)), 0, 0.11, 0);
  b.m(boxGeo(o.w - 0.3, 0.06, o.d - 0.3, 1), tm(shade(pal.grass, -0.15)), 0, 0.22, 0);
  const n = Math.round(o.w * o.d * 2.2);
  for (let i = 0; i < n; i++) {
    const x = (R() - 0.5) * (o.w - 0.5), z = (R() - 0.5) * (o.d - 0.5);
    const h = 0.25 + R() * 0.35;
    b.cy(tm('#5ac87a'), 0.025, h, x, 0.22, z, 5);
    const c = pickC(pal.candy, Math.floor(R() * 100));
    b.m(unitSphere(8), tm(c), x, 0.22 + h, z, { s: 0.11 + R() * 0.05, sy: 0.08 });
    b.sp(tm('#fff2a0'), 0.04, x, 0.22 + h + 0.06, z, 6);
  }
  b.box(-o.w / 2, 0, -o.d / 2, o.w / 2, 0.22, o.d / 2);
  return b.done(o.x, o.y, o.z, 0);
}

/** A barrel of honey with golden drips over the rim (the bear's shop). */
export function honeyBarrel(o: Pal & { x: number; y: number; z: number; s?: number }): Built {
  const b = new B('hbarrel');
  const s = o.s ?? 1;
  const pal = P(o);
  b.m(latheC('town-barrel', [[0, 0, 0], [0.86, 0, 0.05, 1], [0.92, 0.1, 0.1], [1, 0.5, 0.5], [0.92, 0.9, 0.9], [0.86, 1, 0.95, 1], [0, 1, 1]], 20), tmat(gingerTex(pal.gingerDark)), 0, 0, 0, { sx: 0.48 * s, sy: 1.0 * s, sz: 0.48 * s });
  for (const y of [0.18, 0.82]) b.m(cg('town-hoop', () => new THREE.TorusGeometry(1, 0.05, 6, 24)), tm('#6a4a3a'), 0, y * s, 0, { rx: Math.PI / 2, s: 0.47 * s * (y > 0.5 ? 0.97 : 0.97) });
  b.m(cg('town-disc', () => new THREE.CylinderGeometry(1, 1, 0.3, 32)), tm('#ffb020', { emissive: '#a05a00', emissiveIntensity: 0.15 }), 0, 1.0 * s, 0, { sx: 0.42 * s, sy: 0.12, sz: 0.42 * s });
  icingEdge(b, tm('#ffb020'), -0.4 * s, 1.0 * s, 0.25 * s, 0.4 * s, 1.0 * s, 0.25 * s, Math.round(o.x * 7), { bead: 0.06, maxLen: 0.35, drips: 4 });
  b.cyl(0, 0, 0.5 * s, 0, 1.0 * s);
  return b.done(o.x, o.y, o.z, 0);
}

/** A stack of candy crates / a syrup barrel (decor you can climb: boxes). */
export function candyCrate(o: Pal & { x: number; y: number; z: number; s?: number; color?: string; rotY?: number }): Built {
  const pal = P(o);
  const b = new B('ccrate');
  const s = o.s ?? 1;
  const col = o.color ?? pal.candy[2];
  b.m(boxGeo(s, s, s, 0), tmat(gingerTex(pal.ginger)), 0, s / 2, 0);
  for (const sz of [-1, 1]) b.bx(tm(col), s * 1.02, s * 0.16, 0.05, 0, s * 0.5, sz * s * 0.5);
  for (const sx of [-1, 1]) b.bx(tm(col), 0.05, s * 0.16, s * 1.02, sx * s * 0.5, s * 0.5, 0);
  for (let i = 0; i < 3; i++) b.m(gumdropGeo(), tm(pickC(pal.candy, i + Math.round(o.x))), (i - 1) * s * 0.28, s, (i % 2 ? 0.1 : -0.12) * s, { sx: 0.13 * s, sy: 0.16 * s, sz: 0.13 * s });
  b.box(-s / 2, 0, -s / 2, s / 2, s, s / 2);
  return b.done(o.x, o.y, o.z, o.rotY ?? 0);
}

/** Town wall stretch (axis-aligned): layered pastila with puffy marshmallow merlons; a tall invisible collider keeps everyone in. */
export function townWall(o: Pal & { x0: number; z0: number; x1: number; z1: number; y: number; h?: number; th?: number }): Built {
  const pal = P(o);
  const b = new B('twall');
  const h = o.h ?? 4.2, th = o.th ?? 1.4;
  const alongX = Math.abs(o.x1 - o.x0) >= Math.abs(o.z1 - o.z0);
  const len = alongX ? Math.abs(o.x1 - o.x0) : Math.abs(o.z1 - o.z0);
  const cx = (o.x0 + o.x1) / 2, cz = (o.z0 + o.z1) / 2;
  const lm = tmat(layersTex([pal.wall, pal.wallTop, shade(pal.wall, -0.06), pal.wallTop, shade(pal.wall, 0.04)], 6));
  const g = b.group(cx, 0, cz); if (!alongX) g.rotation.y = Math.PI / 2;
  b.m(boxGeo(len, h, th, 2.2), lm, 0, h / 2, 0, { parent: g });
  b.m(boxGeo(len + 0.2, 0.3, th + 0.3, 2), tm(pal.wallTop), 0, h + 0.15, 0, { parent: g });
  const n = Math.max(2, Math.round(len / 1.6));
  for (let i = 0; i < n; i++) b.m(puffGeo(), tm(pal.icing), -len / 2 + (i + 0.5) * (len / n), h + 0.3, th * 0.3, { parent: g, sx: 0.42, sy: 0.55, sz: 0.42 });
  const hx = alongX ? len / 2 : th / 2, hz = alongX ? th / 2 : len / 2;
  b.box(cx - hx, 0, cz - hz, cx + hx, h + 0.3, cz + hz);
  b.box(cx - hx, h + 0.3, cz - hz, cx + hx, 40, cz + hz);
  return b.done(0, o.y, 0, 0);
}

export { pickC };

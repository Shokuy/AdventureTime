import * as THREE from 'three';
import { canvasTex, noOutline } from '../../../gfx';
import { B, tmat, bmat, boxGeo, unitCyl, cg, rng, archRing, shapeGeo } from '../../../world/kit';
import { stoneBricksTex, woodPlanksTex, rugTex } from '../../../world/textures';

/**
 * Замок Полночь — building blocks: castle materials (stone, flagstones, slate, wood, carpet), walls with colliders,
 * battlements, round towers, glowing windows, banners, braziers, bookcases, the sea and the cliff.
 * Every collider is an axis-aligned box or a vertical cylinder (the physics has nothing else), so walls are built on
 * the axes and round things (the tower, the roof) get rings of cylinders.
 */

export const STONE = '#7a6f8e';
export const STONE_D = '#5a4f6e';
export const TRIM = '#4a4058';

const cached = new Map<string, THREE.Texture>();
const tx = (key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) => {
  let t = cached.get(key);
  if (!t) { t = canvasTex(w, h, draw, { wrap: true }); cached.set(key, t); }
  return t;
};

/** flagstones (floors): irregular slabs in violet greys */
export function flagTex(color = '#8a809c') {
  return tx('f5flag' + color, 512, 512, (g, w, h) => {
    const R = rng(7);
    g.fillStyle = '#3a3248'; g.fillRect(0, 0, w, h);
    const n = 4;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const x = c * w / n + (r % 2) * w / n / 2, y = r * h / n;
      for (const ox of [0, -w]) {
        const c0 = new THREE.Color(color).offsetHSL(0, 0, (R() - 0.5) * 0.08);
        g.fillStyle = '#' + c0.getHexString();
        g.beginPath(); g.roundRect(x + ox + 5, y + 5, w / n - 10, h / n - 10, 10); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(x + ox + 8, y + 8, w / n - 16, 8);
        g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x + ox + 8, y + h / n - 20, w / n - 16, 12);
      }
    }
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},${0.04 + R() * 0.06})`; g.fillRect(R() * w, R() * h, 2 + R() * 3, 2 + R() * 3); }
  });
}
/** slate roof tiles */
export function slateTex() {
  return tx('f5slate', 256, 256, (g, w, h) => {
    g.fillStyle = '#241c34'; g.fillRect(0, 0, w, h);
    const R = rng(3);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 9; c++) {
      const x = c * 32 - (r % 2) * 16, y = r * 32;
      g.fillStyle = `hsl(265, 22%, ${24 + R() * 10}%)`;
      g.beginPath(); g.moveTo(x + 2, y); g.lineTo(x + 30, y); g.lineTo(x + 30, y + 22); g.quadraticCurveTo(x + 16, y + 34, x + 2, y + 22); g.closePath(); g.fill();
    }
  });
}
/** book spines on shelves (a bookcase front) */
export function shelfTex(seed = 1) {
  return tx('f5shelf' + seed, 512, 512, (g, w, h) => {
    const R = rng(seed * 13 + 5);
    g.fillStyle = '#3a2418'; g.fillRect(0, 0, w, h);
    const rows = 4, rh = h / rows;
    const cols = ['#8a1c30', '#2a4a8a', '#3a7a4a', '#6a3a8a', '#b07a20', '#7a2a2a', '#2a6a6a', '#5a5a6a', '#a0405a'];
    for (let r = 0; r < rows; r++) {
      let x = 8;
      const y0 = r * rh + 10, y1 = (r + 1) * rh - 12;
      while (x < w - 10) {
        const bw = 14 + R() * 18, bh = (y1 - y0) * (0.72 + R() * 0.28);
        if (R() < 0.06) { x += bw; continue; }
        const lean = R() < 0.08 ? 0.12 : 0;
        g.save(); g.translate(x, y1); g.rotate(lean);
        g.fillStyle = cols[Math.floor(R() * cols.length)]; g.fillRect(0, -bh, bw - 2, bh);
        g.fillStyle = 'rgba(255,220,140,0.55)'; g.fillRect(2, -bh + 10, bw - 6, 3); g.fillRect(2, -16, bw - 6, 3);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(bw - 6, -bh, 4, bh);
        g.restore();
        x += bw;
      }
      g.fillStyle = '#5a3a24'; g.fillRect(0, (r + 1) * rh - 12, w, 12);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, r * rh, w, 10);
    }
  });
}
/** the sea far below: dark water with moonlit wave strokes */
export function seaTex() {
  return tx('f5sea', 512, 512, (g, w, h) => {
    g.fillStyle = '#1a1838'; g.fillRect(0, 0, w, h);
    const R = rng(11);
    for (let i = 0; i < 140; i++) {
      const x = R() * w, y = R() * h, l = 20 + R() * 50;
      g.strokeStyle = `rgba(${R() < 0.3 ? '255,120,140' : '160,170,230'},${0.15 + R() * 0.25})`;
      g.lineWidth = 2 + R() * 2; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + l / 2, y - 6, x + l, y); g.stroke();
    }
  });
}

export const M = {
  stone: () => tmat(stoneBricksTex(STONE), '#ffffff'),
  stoneD: () => tmat(stoneBricksTex(STONE_D), '#ffffff'),
  flag: () => tmat(flagTex(), '#ffffff'),
  flagD: () => tmat(flagTex('#6e6484'), '#ffffff'),
  slate: () => tmat(slateTex(), '#ffffff'),
  wood: () => tmat(woodPlanksTex('dark'), '#ffffff'),
  trim: () => tmat(null, TRIM),
  iron: () => tmat(null, '#2a2632'),
  gold: () => tmat(null, '#d8b040'),
  red: () => tmat(null, '#8a1830'),
  carpet: () => tmat(rugTex('#8a1830'), '#ffffff'),
  rock: () => tmat(null, '#3e344e', { flat: true }),
  rockL: () => tmat(null, '#4e4462', { flat: true }),
};

// ───────────────────────── builders (add to a B in world space; done(0,0,0)) ─────────────────────────

/** a solid block: mesh with world-tiled UVs + its collider */
export function block(b: B, mat: THREE.Material, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, o: { tile?: number; col?: boolean; cast?: boolean; tag?: string } = {}) {
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  b.m(boxGeo(w, h, d, o.tile ?? 3), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, { cast: o.cast ?? true });
  if (o.col !== false) b.box(x0, y0, z0, x1, y1, z1, o.tag ? { tag: o.tag } : {});
}

/** battlement teeth along an axis-aligned top edge (merlons every `step`), with a low invisible parapet collider */
export function crenels(b: B, mat: THREE.Material, ax: number, az: number, bx: number, bz: number, y: number, o: { th?: number; h?: number; step?: number; guard?: number } = {}) {
  const th = o.th ?? 0.8, h = o.h ?? 1.1, step = o.step ?? 1.8;
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.floor(len / step));
  const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
  for (let i = 0; i < n; i++) {
    const k = (i + 0.5) / n;
    const x = ax + (bx - ax) * k, z = az + (bz - az) * k;
    if (alongX) b.m(boxGeo(step * 0.55, h, th, 1.5), mat, x, y + h / 2, z); else b.m(boxGeo(th, h, step * 0.55, 1.5), mat, x, y + h / 2, z);
  }
  // the low wall between the teeth is part of the wall below; the guard keeps heroes from walking off
  const g = o.guard ?? 1.6;
  if (g > 0) {
    if (alongX) b.box(Math.min(ax, bx), y, az - th / 2, Math.max(ax, bx), y + g, az + th / 2); else b.box(ax - th / 2, y, Math.min(az, bz), ax + th / 2, y + g, Math.max(az, bz));
  }
}

/** a round tower: stone drum (collider cylinder), crenellated top, optional slate cone roof and a red window */
export function tower(b: B, x: number, z: number, r: number, y0: number, y1: number, o: { roof?: number; window?: boolean; crown?: boolean } = {}) {
  const sm = M.stone();
  const g = new THREE.CylinderGeometry(r, r * 1.04, y1 - y0, 28, 1);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (Math.PI * 2 * r) / 3, uv.getY(i) * (y1 - y0) / 3);
  b.m(g, sm, x, (y0 + y1) / 2, z);
  b.cyl(x, z, r, y0, y1);
  // corbelled ring + merlons
  b.m(new THREE.CylinderGeometry(r + 0.45, r, 0.6, 28), M.trim(), x, y1 - 0.3, z);
  if (o.crown !== false) {
    const n = Math.max(6, Math.round((Math.PI * 2 * r) / 1.6));
    for (let i = 0; i < n; i += 1) {
      if (i % 2) continue;
      const a = (i / n) * Math.PI * 2;
      b.m(boxGeo(1, 1, 0.7, 1.5), sm, x + Math.cos(a) * (r + 0.1), y1 + 0.5, z + Math.sin(a) * (r + 0.1), { ry: -a + Math.PI / 2 });
    }
  }
  if (o.roof) {
    b.m(new THREE.ConeGeometry(r + 0.7, o.roof, 28, 1), M.slate(), x, y1 + o.roof / 2 + 0.1, z);
    b.m(new THREE.SphereGeometry(0.35, 10, 8), M.gold(), x, y1 + o.roof + 0.2, z, { cast: false });
  }
  if (o.window) {
    for (const a of [0.6, 2.4, 4.2]) {
      const wy = y0 + (y1 - y0) * 0.62;
      const m = b.m(archGeo(0.8, 1.6), bmat('#ff6a3a'), x + Math.cos(a) * (r + 0.02), wy, z + Math.sin(a) * (r + 0.02), { ry: Math.PI / 2 - a, glow: true });
      m.userData.keep = true;
    }
  }
}

/** a flat arch-shaped plane (glowing windows, dark doorways), standing on y = 0, facing +Z */
export function archGeo(w: number, h: number) {
  return cg(`f5arch${w}|${h}`, () => {
    const s = new THREE.Shape();
    const r = w / 2;
    s.moveTo(-r, 0); s.lineTo(r, 0); s.lineTo(r, h - r); s.absarc(0, h - r, r, 0, Math.PI, false); s.lineTo(-r, 0);
    return shapeGeo(s);
  });
}

/** a stone arch frame (no collider), standing on y=0, facing ±Z (q = quarter turns) */
export function archFrame(b: B, x: number, y: number, z: number, w: number, h: number, q = 0) {
  const g = cg(`f5archring${w}|${h}`, () => new THREE.ExtrudeGeometry(archRing(w, h, 0.7), { depth: 1.2, bevelEnabled: false }).translate(0, 0, -0.6));
  b.m(g, M.trim(), x, y, z, { ry: q * Math.PI / 2 });
}

/** a glowing window (a red-orange arch with a cross of mullions) on a wall facing `dir` */
export function windowAt(b: B, x: number, y: number, z: number, w: number, h: number, ry: number, color = '#ff7a4a') {
  const win = b.m(archGeo(w, h), bmat(color), x, y, z, { ry, glow: true });
  win.userData.keep = true;
  const nx = Math.sin(ry) * 0.04, nz = Math.cos(ry) * 0.04;
  b.m(boxGeo(0.12, h * 0.95, 0.08), M.iron(), x + nx, y + h * 0.48, z + nz, { ry, cast: false });
  b.m(boxGeo(w * 0.95, 0.12, 0.08), M.iron(), x + nx, y + h * 0.5, z + nz, { ry, cast: false });
}

/** a hanging banner: red cloth with a silver crescent */
let bannerTexC: THREE.Texture | null = null;
function bannerTex() {
  if (bannerTexC) return bannerTexC;
  bannerTexC = canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#7a1428'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#5a0c1c'; g.fillRect(0, 0, 10, h); g.fillRect(w - 10, 0, 10, h);
    g.fillStyle = '#e8e4f4'; g.beginPath(); g.arc(w / 2, 96, 34, Math.PI * 0.75, Math.PI * 2.25); g.arc(w / 2 + 12, 88, 28, Math.PI * 2.2, Math.PI * 0.8, true); g.closePath(); g.fill();
    g.fillStyle = '#d8b040'; g.fillRect(0, 0, w, 8);
    g.fillStyle = '#7a1428';
    g.beginPath(); g.moveTo(0, h); g.lineTo(w / 2, h - 30); g.lineTo(w, h); g.closePath(); g.fillStyle = '#000000'; g.globalCompositeOperation = 'destination-out'; g.fill();
  });
  return bannerTexC;
}
export function banner(b: B, x: number, y: number, z: number, w: number, h: number, ry: number) {
  const m = b.m(new THREE.PlaneGeometry(w, h), tmat(bannerTex(), '#ffffff', { side: THREE.DoubleSide, alphaTest: 0.5 }), x, y - h / 2, z, { ry, cast: false });
  m.userData.keep = true;
  b.m(new THREE.CylinderGeometry(0.06, 0.06, w + 0.4, 8), M.gold(), x, y + 0.05, z, { rz: Math.PI / 2, ry, cast: false });
}

/** a brazier on a stand: a real light only when asked (lights are expensive) */
export function brazier(b: B, x: number, y: number, z: number, o: { light?: boolean; h?: number; color?: string } = {}) {
  const h = o.h ?? 1.3;
  b.cy(M.iron(), 0.08, h, x, y, z, 8);
  b.m(new THREE.CylinderGeometry(0.42, 0.22, 0.38, 12), M.iron(), x, y + h + 0.1, z);
  const flame = b.m(new THREE.ConeGeometry(0.28, 0.8, 8), bmat(o.color ?? '#ff9a3a', { transparent: true, opacity: 0.9 }), x, y + h + 0.6, z, { glow: true, dyn: true });
  const core = b.m(new THREE.ConeGeometry(0.15, 0.5, 8), bmat('#ffe08a'), x, y + h + 0.5, z, { glow: true, dyn: true });
  const ph = Math.random() * 6;
  b.update((t) => {
    const s = 1 + Math.sin(t * 13 + ph) * 0.12 + Math.sin(t * 7.3 + ph) * 0.08;
    flame.scale.set(1, s, 1); core.scale.set(1, 2 - s, 1);
  });
  if (o.light) b.light(o.color ?? '#ff9a50', 14, 11, 1.6, x, y + h + 0.9, z);
}

/** a bookcase against a wall: wooden carcass + a texture of book spines on its front (facing `q` quarter turns from +Z) */
export function bookcase(b: B, x: number, y: number, z: number, w: number, h: number, d: number, q: number, seed = 1) {
  const alongX = q % 2 === 0;
  const sx = alongX ? w : d, sz = alongX ? d : w;
  b.m(boxGeo(sx, h, sz, 2), M.wood(), x, y + h / 2, z);
  b.box(x - sx / 2, y, z - sz / 2, x + sx / 2, y + h, z + sz / 2);
  const face = new THREE.PlaneGeometry(w - 0.3, h - 0.3);
  const uv = face.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 3), uv.getY(i) * (h / 3));
  const ry = q * Math.PI / 2;
  const off = d / 2 + 0.02;
  b.m(face, tmat(shelfTex(seed), '#ffffff'), x + Math.sin(ry) * off, y + h / 2, z + Math.cos(ry) * off, { ry, cast: false });
}

/** the sea far below and the cliff rocks the castle stands on */
export function seaAndCliff(L: { deco(o: THREE.Object3D): unknown; updaters: ((t: number, dt: number) => void)[] }) {
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), tmat(seaTex(), '#ffffff'));
  sea.rotation.x = -Math.PI / 2; sea.position.y = -42;
  const tex = (sea.material as THREE.MeshToonMaterial).map!;
  tex.repeat.set(60, 60);
  sea.receiveShadow = false;
  noOutline(sea);
  L.deco(sea);
  L.updaters.push((t) => { tex.offset.set(t * 0.004, t * 0.002); });
  const R = rng(91);
  const rock = M.rock(), rockL = M.rockL();
  const crag = (x: number, z: number, r: number, top: number) => {
    const g = new THREE.CylinderGeometry(r * (0.55 + R() * 0.2), r, top + 44, 7, 3);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.85 + R() * 0.3), p.getY(i), p.getZ(i) * (0.85 + R() * 0.3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, R() < 0.5 ? rock : rockL);
    m.position.set(x, (top - 44) / 2, z);
    m.rotation.y = R() * 6;
    m.castShadow = false; m.receiveShadow = true;
    L.deco(m);
  };
  // the castle's rock (under the courtyard, keep, tower and roof)
  for (const [x, z, r, t] of [[0, 22, 30, -0.4], [0, -16, 26, -0.4], [0, -56, 26, -0.4], [0, -88, 18, 5.5], [0, -118, 26, -0.4], [-26, -40, 16, -6], [27, -70, 15, -8], [-20, -110, 18, -10], [24, 10, 14, -4]] as const) crag(x, z, r, t);
  // the far bank where the bridge starts, and stacks in the sea
  for (const [x, z, r, t] of [[0, 96, 26, -0.4], [-34, 92, 18, -6], [32, 100, 20, -4], [-70, 30, 12, -20], [80, -40, 16, -18], [-90, -110, 14, -16], [60, 70, 10, -24]] as const) crag(x, z, r, t);
}

/** a long carpet runner on the floor (decal, no collider) */
export function carpet(b: B, x: number, y: number, z: number, w: number, d: number) {
  const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), uv.getY(i) * d / w);
  b.m(g, M.carpet(), x, y + 0.03, z, { cast: false });
}

/** a column (cylinder collider) */
export function column(b: B, x: number, z: number, y0: number, h: number, r = 0.6) {
  b.m(unitCyl(16), M.stoneD(), x, y0, z, { sx: r, sy: h, sz: r });
  b.m(new THREE.CylinderGeometry(r * 1.35, r * 1.35, 0.4, 16), M.trim(), x, y0 + 0.2, z);
  b.m(new THREE.CylinderGeometry(r * 1.4, r * 1.1, 0.5, 16), M.trim(), x, y0 + h - 0.25, z);
  b.cyl(x, z, r, y0, y0 + h);
}

export { B };

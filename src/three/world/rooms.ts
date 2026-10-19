import * as THREE from 'three';
import type { Built } from '../physics/types';
import { PAL, LAYER_NO_OUTLINE } from '../gfx';
import { B, tmat, bmat, boxGeo, clamp, rng, rr, hashSeed, combine } from './kit';
import {
  woodPlanksTex, woodGrainTex, damaskTex, libraryWallTex, stoneBricksTex, earthTex, dirtTex, carpetTex, skyTex, shade,
  type SkyTheme,
} from './textures';
import { banner } from './props';

/**
 * Rooms: floor slab (with rectangular holes), thick walls with themed textures, baseboards / wainscot,
 * crown molding, optional ceiling beams and theme decor. Everything is built directly in world space.
 *
 * Walls: n = the z0 side (faces +Z), s = z1 side (faces -Z), w = x0 side (faces +X), e = x1 side (faces -X).
 * Wall colliders are `wallT` thick (default 4) outside the room rect; the floor collider is a 2-thick slab
 * whose top is exactly floorY. Baseboards/wainscot add thin colliders along the inner wall faces.
 */

export type RoomTheme = 'pantry' | 'feast' | 'library' | 'gallery' | 'throne' | 'den';
export interface Rect { x0: number; x1: number; z0: number; z1: number }
export interface RoomOpts {
  theme: RoomTheme;
  x0: number; x1: number; z0: number; z1: number;
  floorY: number;
  wallH: number;
  /** rectangular gaps in the floor (pools go here) */
  holes?: Rect[];
  /** which walls to build (default: all) */
  walls?: { n?: boolean; s?: boolean; e?: boolean; w?: boolean };
  /** ceiling beams decor (default: pantry / den / feast) */
  beams?: boolean;
  /** gallery/throne: red carpet runner along the long axis (default true there) */
  carpet?: boolean;
  /** gallery/throne: banners along the walls (default true there) */
  banners?: boolean;
  /** wall collider thickness (default 4) */
  wallT?: number;
  /** floor slab thickness (default 2) */
  floorT?: number;
}

/** Split rect r into boxes that avoid all holes. */
export function subtractRects(r: Rect, holes: Rect[]): Rect[] {
  const hs = holes
    .map((h) => ({ x0: Math.max(r.x0, Math.min(h.x0, h.x1)), x1: Math.min(r.x1, Math.max(h.x0, h.x1)), z0: Math.max(r.z0, Math.min(h.z0, h.z1)), z1: Math.min(r.z1, Math.max(h.z0, h.z1)) }))
    .filter((h) => h.x1 - h.x0 > 1e-4 && h.z1 - h.z0 > 1e-4);
  if (!hs.length) return [r];
  const xs = Array.from(new Set([r.x0, r.x1, ...hs.flatMap((h) => [h.x0, h.x1])])).sort((a, b) => a - b);
  const out: Rect[] = [];
  let prev: { x0: number; x1: number; iv: [number, number][] } | null = null;
  const flush = () => { if (prev) for (const [z0, z1] of prev.iv) out.push({ x0: prev.x0, x1: prev.x1, z0, z1 }); };
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i], b = xs[i + 1];
    if (b - a < 1e-4) continue;
    const cov = hs.filter((h) => h.x0 < b - 1e-6 && h.x1 > a + 1e-6).map((h) => [h.z0, h.z1] as [number, number]).sort((p, q) => p[0] - q[0]);
    const iv: [number, number][] = [];
    let z = r.z0;
    for (const [c0, c1] of cov) { if (c0 > z + 1e-4) iv.push([z, c0]); z = Math.max(z, c1); }
    if (r.z1 > z + 1e-4) iv.push([z, r.z1]);
    if (prev && prev.iv.length === iv.length && prev.iv.every((p, k) => Math.abs(p[0] - iv[k][0]) < 1e-4 && Math.abs(p[1] - iv[k][1]) < 1e-4)) { prev.x1 = b; continue; }
    flush();
    prev = { x0: a, x1: b, iv };
  }
  flush();
  return out;
}

interface ThemeDef {
  floor: () => THREE.Material; floorTile: number;
  wall: () => THREE.Material; wallTile: number;
  base: (() => THREE.Material) | null;
  crown: () => THREE.Material;
  beams: boolean; carpet: boolean; banners: boolean;
}
const THEMES: Record<RoomTheme, ThemeDef> = {
  pantry: {
    floor: () => tmat(woodPlanksTex('warm', 4)), floorTile: 10,
    wall: () => tmat(woodPlanksTex('honey', 6)), wallTile: 12,
    base: () => tmat(woodGrainTex('dark')), crown: () => tmat(woodGrainTex('dark')),
    beams: true, carpet: false, banners: false,
  },
  feast: {
    floor: () => tmat(woodPlanksTex('red', 4)), floorTile: 10,
    wall: () => tmat(damaskTex('feast')), wallTile: 9,
    base: () => tmat(woodGrainTex('dark')), crown: () => tmat(null, PAL.gold),
    beams: true, carpet: false, banners: false,
  },
  library: {
    floor: () => tmat(woodPlanksTex('dark', 4)), floorTile: 10,
    wall: () => tmat(libraryWallTex()), wallTile: 14,
    base: () => tmat(woodGrainTex('dark')), crown: () => tmat(woodGrainTex('red')),
    beams: false, carpet: false, banners: false,
  },
  gallery: {
    floor: () => tmat(stoneBricksTex('#4e4266')), floorTile: 10,
    wall: () => tmat(stoneBricksTex(PAL.stone)), wallTile: 10,
    base: () => tmat(stoneBricksTex(PAL.stoneD)), crown: () => tmat(stoneBricksTex('#7a6a92')),
    beams: false, carpet: true, banners: true,
  },
  throne: {
    floor: () => tmat(stoneBricksTex('#4e4266')), floorTile: 10,
    wall: () => tmat(stoneBricksTex(PAL.stone)), wallTile: 10,
    base: () => tmat(stoneBricksTex(PAL.stoneD)), crown: () => tmat(null, PAL.gold),
    beams: false, carpet: true, banners: true,
  },
  den: {
    floor: () => tmat(dirtTex()), floorTile: 12,
    wall: () => tmat(earthTex()), wallTile: 14,
    base: null, crown: () => tmat(woodGrainTex('dark')),
    beams: true, carpet: false, banners: false,
  },
};

/** floor slab box with world-aligned UVs on the top face (so split pieces line up) */
function floorGeo(w: number, t: number, d: number, cx: number, cz: number, tile: number) {
  const g = boxGeo(w, t, d, tile);
  const p = g.attributes.position as THREE.BufferAttribute, uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 8; i < 12; i++) uv.setXY(i, (cx + p.getX(i)) / tile, -(cz + p.getZ(i)) / tile);
  return g;
}

type Side = 'n' | 's' | 'e' | 'w';

/** Themed room. See RoomOpts. Returns one Built (room + its decor). */
export function room(o: RoomOpts): Built {
  const th = THEMES[o.theme];
  const b = new B(`room:${o.theme}`);
  const { x0, x1, z0, z1, floorY: fy, wallH } = o;
  const FT = o.floorT ?? 2, T = o.wallT ?? 4, vt = 1;
  const R = rng(hashSeed(x0, z0, x1, z1));
  const holes = o.holes ?? [];
  // ── floor
  const fm = th.floor();
  for (const p of subtractRects({ x0, x1, z0, z1 }, holes)) {
    const w = p.x1 - p.x0, d = p.z1 - p.z0, cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
    b.m(floorGeo(w, FT, d, cx, cz, th.floorTile), fm, cx, fy - FT / 2, cz, { cast: false });
    b.box(p.x0, fy - FT, p.z0, p.x1, fy, p.z1, { tag: 'floor' });
  }
  // ── carpet (gallery / throne)
  if (o.carpet ?? th.carpet) {
    const alongX = x1 - x0 >= z1 - z0;
    const cw = clamp(Math.min(x1 - x0, z1 - z0) * 0.22, 4, 10);
    const cr: Rect = alongX ? { x0: x0 + 1, x1: x1 - 1, z0: (z0 + z1) / 2 - cw / 2, z1: (z0 + z1) / 2 + cw / 2 } : { x0: (x0 + x1) / 2 - cw / 2, x1: (x0 + x1) / 2 + cw / 2, z0: z0 + 1, z1: z1 - 1 };
    const cm = tmat(carpetTex(), '#ffffff', { decal: true });
    for (const p of subtractRects(cr, holes)) {
      const w = p.x1 - p.x0, d = p.z1 - p.z0;
      const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
      const pos = g.attributes.position as THREE.BufferAttribute, uv = g.attributes.uv as THREE.BufferAttribute;
      const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
      for (let i = 0; i < pos.count; i++) {
        const wx = cx + pos.getX(i), wz = cz + pos.getZ(i);
        if (alongX) uv.setXY(i, (wz - cr.z0) / cw, wx / 8); else uv.setXY(i, (wx - cr.x0) / cw, wz / 8);
      }
      b.m(g, cm, cx, fy + 0.035, cz, { cast: false });
      // thin edge so the carpet reads as thick cloth (top stays well below the textured plane: it used
      // to be only 0.01 under it, which z-fights at the far end of long halls)
      b.m(boxGeo(w, 0.02, d), tmat(null, '#8a1f2a'), cx, fy + 0.01, cz, { cast: false });
    }
  }
  // ── walls
  const ws = { n: o.walls?.n ?? true, s: o.walls?.s ?? true, e: o.walls?.e ?? true, w: o.walls?.w ?? true };
  const y0 = fy - FT, y1 = fy + wallH;
  const wm = th.wall();
  const libShelfH = clamp(wallH * 0.55, 8, 30);
  const along = (side: Side) => (side === 'n' || side === 's' ? [x0 - vt, x1 + vt] : [z0, z1]);
  /** inner-face-aligned box: from the wall plane `depth0`..`depth1` into the room, along the side, y range */
  const sideBox = (side: Side, a0: number, a1: number, d0: number, d1: number, ya: number, yb: number) => {
    // returns world min/max for a slab hugging the inner face of the wall
    if (side === 'n') return [a0, ya, z0 + d0, a1, yb, z0 + d1] as const;
    if (side === 's') return [a0, ya, z1 - d1, a1, yb, z1 - d0] as const;
    if (side === 'w') return [x0 + d0, ya, a0, x0 + d1, yb, a1] as const;
    return [x1 - d1, ya, a0, x1 - d0, yb, a1] as const;
  };
  const slab = (m: THREE.Material, bx: readonly number[], tile: number, cast = true) => {
    const w = bx[3] - bx[0], h = bx[4] - bx[1], d = bx[5] - bx[2];
    return b.m(boxGeo(w, h, d, tile), m, (bx[0] + bx[3]) / 2, (bx[1] + bx[4]) / 2, (bx[2] + bx[5]) / 2, { cast });
  };
  const sides = (['n', 's', 'w', 'e'] as Side[]).filter((s) => ws[s]);
  for (const side of sides) {
    const [a0, a1] = along(side);
    // structural wall (visual 1 thick, collider T thick)
    if (o.theme === 'library') {
      slab(wm, sideBox(side, a0, a1, -vt, 0, y0, fy + libShelfH), th.wallTile);
      slab(tmat(damaskTex('library')), sideBox(side, a0, a1, -vt, 0, fy + libShelfH, y1), 9);
      slab(tmat(woodGrainTex('red')), sideBox(side, a0, a1, 0, 0.7, fy + libShelfH - 0.6, fy + libShelfH + 0.6), 6);
    } else {
      slab(wm, sideBox(side, a0, a1, -vt, 0, y0, y1), th.wallTile);
    }
    const [c0, c1] = side === 'n' || side === 's' ? [x0 - T, x1 + T] : [z0, z1];
    const cb = sideBox(side, c0, c1, -T, 0, y0, y1);
    b.box(cb[0], cb[1], cb[2], cb[3], cb[4], cb[5], { tag: 'wall' });
    // trims along the inner face (only over the room span; side walls stop where the n/s trims begin)
    const ns = side === 'n' || side === 's';
    const span = (dep: number): [number, number] => (ns ? [x0, x1] : [z0 + (ws.n ? dep : 0), z1 - (ws.s ? dep : 0)]);
    const trim = (m: THREE.Material, dep: number, ya: number, yb: number, tile: number, col: boolean, cast = true) => {
      const [i0, i1] = span(dep);
      const c = sideBox(side, i0, i1, 0, dep, ya, yb);
      slab(m, c, tile, cast);
      if (col) b.box(c[0], c[1], c[2], c[3], c[4], c[5], { tag: 'wall' });
    };
    if (o.theme === 'feast') {
      const wsH = clamp(wallH * 0.12, 3, 7);
      trim(tmat(woodPlanksTex('dark', 4)), 0.4, fy, fy + wsH, 8, true);
      trim(tmat(null, PAL.gold), 0.5, fy + wsH, fy + wsH + 0.4, 0, true);
      trim(tmat(null, PAL.gold), 0.45, fy + wsH * 0.45, fy + wsH * 0.45 + 0.18, 0, false);
    }
    if (th.base) {
      const bh = clamp(wallH * 0.03, 0.8, 1.4), bd = o.theme === 'feast' ? 0.6 : 0.35;
      trim(th.base(), bd, fy, fy + bh, 4, true);
      trim(tmat(null, o.theme === 'gallery' || o.theme === 'throne' ? '#7a6a92' : '#d89a5e'), bd + 0.05, fy + bh, fy + bh + 0.12, 0, false);
    }
    // crown molding (decor)
    trim(th.crown(), 0.9, y1 - 1.4, y1, 4, false, false);
    trim(th.crown(), 0.5, y1 - 2.1, y1 - 1.4, 4, false, false);
  }
  // ── ceiling beams
  if (o.beams ?? th.beams) {
    const bm = tmat(woodGrainTex('dark'));
    const alongX = x1 - x0 < z1 - z0; // beams span the short side
    const L0 = alongX ? z0 : x0, L1 = alongX ? z1 : x1;
    const span = alongX ? x1 - x0 : z1 - z0;
    const n = Math.max(1, Math.floor((L1 - L0) / 14));
    for (let i = 0; i < n; i++) {
      const p = L0 + (L1 - L0) * (i + 0.5) / n;
      if (alongX) b.m(boxGeo(span + 2, 1.6, 1.4, 6), bm, (x0 + x1) / 2, y1 - 0.4, p, {});
      else b.m(boxGeo(1.4, 1.6, span + 2, 6), bm, p, y1 - 0.4, (z0 + z1) / 2, {});
      if (o.theme === 'den') {
        // support posts against the walls under each beam
        const posts: [number, number][] = alongX ? [[x0 + 0.6, p], [x1 - 0.6, p]] : [[p, z0 + 0.6], [p, z1 - 0.6]];
        for (const [px, pz] of posts) {
          b.m(boxGeo(1.2, wallH, 1.2, 6), bm, px, fy + wallH / 2, pz, {});
          b.box(px - 0.6, fy, pz - 0.6, px + 0.6, y1, pz + 0.6, { tag: 'wall' });
        }
      }
    }
  }
  // ── den roots hanging from the top of the walls
  if (o.theme === 'den') {
    const rm = tmat(null, '#8a5a34');
    const root = new THREE.ConeGeometry(1, 1, 7).translate(0, -0.5, 0);
    for (const side of sides) {
      const [a0, a1] = side === 'n' || side === 's' ? [x0, x1] : [z0, z1];
      const n = Math.max(2, Math.floor((a1 - a0) / 5));
      for (let i = 0; i < n; i++) {
        const a = a0 + (a1 - a0) * (i + R()) / n, len = rr(R, 2, 7), rad = rr(R, 0.2, 0.45);
        const c = sideBox(side, a, a, 0.3, 0.3, y1, y1);
        b.m(root, rm, c[0], y1 - 1, c[2], { sx: rad, sy: len, sz: rad, rx: (R() - 0.5) * 0.4, rz: (R() - 0.5) * 0.4 });
      }
    }
  }
  const parts: Built[] = [b.done(0, 0, 0, 0)];
  // ── banners (gallery / throne)
  if (o.banners ?? th.banners) {
    const bh = clamp(wallH * 0.38, 8, 18), bw = clamp(bh * 0.32, 3, 6);
    const by = fy + clamp(wallH * 0.32, 4, wallH - bh - 2);
    const colors = [PAL.robe, '#2c3e8f', PAL.robe, '#5a2a7a'];
    for (const side of sides) {
      const [a0, a1] = side === 'n' || side === 's' ? [x0, x1] : [z0, z1];
      const n = Math.floor((a1 - a0) / 18);
      for (let i = 0; i < n; i++) {
        const a = a0 + (a1 - a0) * (i + 0.5) / n;
        const q = side === 'n' ? 0 : side === 's' ? 2 : side === 'w' ? 1 : 3;
        const c = sideBox(side, a, a, 0, 0, by, by);
        parts.push(banner({ x: c[0], y: by, z: c[2], w: bw, h: bh, rotY: q, color: colors[i % colors.length] }));
      }
    }
  }
  return combine(`room:${o.theme}`, parts);
}

/** Big inverted sphere with a vertical gradient (+ motes / stars for 'throne') for distant darkness. */
export function skyBackdrop(o: { theme: SkyTheme; center: { x: number; y: number; z: number }; radius: number }): Built {
  const g = new THREE.SphereGeometry(o.radius, 32, 16);
  const m = bmat('#ffffff', { map: skyTex(o.theme), side: THREE.BackSide, depthWrite: false, fog: false });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(o.center.x, o.center.y, o.center.z);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  mesh.layers.set(LAYER_NO_OUTLINE);
  mesh.name = `sky:${o.theme}`;
  mesh.updateMatrix(); mesh.matrixAutoUpdate = false;
  return { obj: mesh, colliders: [] };
}

/** handy color for each theme's fog/background */
export const THEME_FOG: Record<RoomTheme, string> = {
  pantry: '#2a160c', feast: '#2a0c10', library: '#0c2226', gallery: '#1a1028', throne: '#121434', den: '#1e140a',
};
export const themeShade = (t: RoomTheme, amt: number) => shade(THEME_FOG[t], amt);

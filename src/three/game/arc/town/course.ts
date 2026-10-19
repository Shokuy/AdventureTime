import * as THREE from 'three';
import type { Built } from '../../../physics/types';
import { boxGeo, hashSeed } from '../../../world/kit';
import { shade } from '../../../world/textures';
import type { Level3D, Hittable3 } from '../../level';
import type { Shot3 } from '../../objects';
import { addGrappleRing } from '../../heroes';
import type { HeroKind } from '../../../../net/profile';
import { audio } from '../../../../engine/audio';
import { B, tm, tmat, cg, glow, mergeBuilts, gumdropGeo, puffGeo } from './kit';
import { marshTex, layersTex, caneTex, boardTex, gingerTex, stripeTex } from './tex';
import * as T from './props';
import type { TownPalette } from './palette';

/*
 * «Полоса препятствий имени Ириски» (docs/script-fangs.md 4.6) — the lab's yard, four stations side by side, one per hero:
 *  Тоша (gumdrop steps up to a high platform, a vampire dummy), Бублик (a grapple ring over a tall ledge, a gap between
 *  two blocks), Ноки (a wall with a slit only a bat gets through, dummies, a «sun» lamp), Пастила (bullseye targets, a high
 *  shelf for the gingerbread trampoline, a candy cannon, a dark tent with an «invisible» dummy).
 * Nothing here is required: every station is a playground for that hero's moves (hub.ts plays Ириска's lines and the
 * hero's button toasts on each mat). Built the same on every machine (the grapple ring too).
 */

export interface Box { x0: number; z0: number; x1: number; z1: number }
export interface Station { kind: HeroKind; mat: Box; sign: THREE.Vector3; focus: THREE.Vector3; color: string }
export interface Course { area: Box; gate: Box; host: THREE.Vector3; hostYaw: number; stations: Station[] }

const X0 = 12.8, X1 = 32.4, Z0 = -48.4, Z1 = -37.2;
const COLORS: Record<HeroKind, string> = { tosha: '#ff8a2a', bublik: '#e8a850', noki: '#c8304a', pastila: '#ff7aa8' };
const NAMES: Record<HeroKind, string> = { tosha: 'СТАНЦИЯ ТОШИ', bublik: 'СТАНЦИЯ БУБЛИКА', noki: 'СТАНЦИЯ НОКИ', pastila: 'СТАНЦИЯ ПАСТИЛЫ' };

export function buildCourse(L: Level3D, pal: TownPalette): Course {
  const parts: Built[] = [];
  const add = (b: Built) => { parts.push(b); return b; };
  const W = (X1 - X0) / 4.2;
  // fences (an entrance on the lab side) and the arch with the name
  add(T.caneFence({ x0: X0, z0: Z0, x1: X1, z1: Z0, y: 0, pal }));
  add(T.caneFence({ x0: X0, z0: Z1, x1: X1, z1: Z1, y: 0, pal }));
  add(T.caneFence({ x0: X1, z0: Z0, x1: X1, z1: Z1, y: 0, pal }));
  add(T.caneFence({ x0: X0, z0: Z0, x1: X0, z1: -44.2, y: 0, pal }));
  add(T.caneFence({ x0: X0, z0: -41.0, x1: X0, z1: Z1, y: 0, pal }));
  add(courseArch(X0, -42.6, pal));
  // the yard's floor: a soft sugar mat
  add(floorMat(X0 + 0.2, Z0 + 0.2, X1 - 0.2, Z1 - 0.2, '#f6e4ee'));
  const stations: Station[] = [];
  const kinds: HeroKind[] = ['tosha', 'bublik', 'noki', 'pastila'];
  kinds.forEach((kind, i) => {
    const x0 = X0 + 1.4 + i * W, x1 = x0 + W, cx = (x0 + x1) / 2;
    const color = COLORS[kind];
    const mat: Box = { x0: x0 + 0.3, z0: -41.4, x1: x1 - 0.3, z1: -38.0 };
    add(floorMat(mat.x0, mat.z0, mat.x1, mat.z1, shade(color, 0.45)));
    add(stationSign(cx, -38.6, NAMES[kind], color));
    stations.push({ kind, mat, sign: new THREE.Vector3(cx, 0, -38.6), focus: new THREE.Vector3(cx, 1.6, -44.4), color });
    if (kind === 'tosha') {
      // gumdrop steps up to a platform with a pennant (double jump on the last one), a vampire dummy
      for (const [x, z, h, c] of [[x0 + 0.9, -42.6, 1.0, pal.candy[0]], [x0 + 2.6, -44.2, 2.0, pal.candy[2]], [x0 + 1.2, -45.9, 3.1, pal.candy[1]]] as const) add(gumdropStep(x, z, h, c));
      add(platform(x1 - 1.3, -46.9, 1.7, 1.5, 4.6, color));
      add(pennant(x1 - 1.3, 4.6, -46.9, color));
      dummy(L, x1 - 1.0, -42.9, pal);
    } else if (kind === 'bublik') {
      // a tall ledge with a grapple ring above its front; two blocks with a gap between
      add(platform(cx, -47.0, 2.6, 1.6, 4.6, color));
      addGrappleRing(L, cx, 6.9, -45.2);
      add(platform(x0 + 0.9, -43.6, 1.3, 1.3, 1.5, shade(color, 0.2)));
      add(platform(x1 - 0.9, -43.6, 1.3, 1.3, 1.5, shade(color, 0.2)));
    } else if (kind === 'noki') {
      // a wall with a slit only a bat gets through; dummies; a «sun» lamp
      add(slitWall(cx, -45.0, W - 0.6, 3.0, pal));
      dummy(L, x0 + 1.0, -42.6, pal);
      dummy(L, x1 - 1.0, -46.9, pal);
      add(sunLamp(x1 - 0.7, -41.9));
    } else {
      // bullseye targets, a high shelf (the gingerbread trampoline), a candy cannon, a dark tent with an «invisible» dummy
      for (const [x, z] of [[x0 + 0.8, -47.3], [cx, -47.6], [x1 - 0.8, -47.3]] as const) target(L, x, z);
      add(platform(x0 + 1.0, -44.6, 1.4, 1.2, 4.0, color));
      add(cannon(x1 - 0.9, -43.9));
      add(darkTent(x1 - 1.2, -40.0));
      dummy(L, x1 - 1.2, -40.0, pal, true);
    }
  });
  L.add(mergeBuilts('course', parts));
  return {
    area: { x0: X0 + 0.2, z0: Z0 + 0.2, x1: X1 - 0.2, z1: Z1 - 0.2 },
    gate: { x0: X0 - 1.6, z0: -44.2, x1: X0 + 1.2, z1: -41.0 },
    host: new THREE.Vector3(X0 + 1.0, 0, -45.2), hostYaw: -Math.PI / 2 + 0.5,
    stations,
  };
}

// ───────────────────────── pieces ─────────────────────────

function floorMat(x0: number, z0: number, x1: number, z1: number, color: string): Built {
  const b = new B('cmat');
  b.m(boxGeo(x1 - x0, 0.05, z1 - z0, 0), tm(color, { decal: true }), (x0 + x1) / 2, 0.025, (z0 + z1) / 2, { cast: false });
  return b.done(0, 0, 0, 0);
}

function courseArch(x: number, z: number, pal: TownPalette): Built {
  const b = new B('carch');
  const cane = tmat(caneTex('#fff8f0', '#ff8a2a', 4));
  for (const sz of [-1.6, 1.6]) { b.cy(cane, 0.14, 3.4, 0, 0, sz, 10); b.m(gumdropGeo(), tm(pal.candy[sz > 0 ? 2 : 0]), 0, 3.4, sz, { sx: 0.3, sy: 0.35, sz: 0.3 }); b.cyl(0, sz, 0.16, 0, 3.4); }
  const g = b.group(0, 3.0, 0);
  g.rotation.y = -Math.PI / 2;
  b.m(cg('town-plane', () => new THREE.PlaneGeometry(1, 1)), tmat(boardTex('ПОЛОСА ИМЕНИ ИРИСКИ', '#ff8a2a', '#6a2a1a', 640, 120)), 0, 0, 0.08, { parent: g, sx: 3.6, sy: 0.7, cast: false });
  b.m(cg('town-plane', () => new THREE.PlaneGeometry(1, 1)), tmat(boardTex('ПОЛОСА ИМЕНИ ИРИСКИ', '#ff8a2a', '#6a2a1a', 640, 120)), 0, 0, -0.08, { parent: g, sx: 3.6, sy: 0.7, ry: Math.PI, cast: false });
  b.bx(tm('#c8803e'), 3.8, 0.85, 0.12, 0, 0, 0, 0, { parent: g });
  return b.done(x, 0, z, 0);
}

function stationSign(x: number, z: number, label: string, color: string): Built {
  const b = new B('csign');
  b.cy(tmat(caneTex('#fff8f0', color, 3)), 0.07, 1.9, 0, 0, 0, 8);
  b.bx(tm('#c8803e'), 2.3, 0.62, 0.1, 0, 1.75, 0);
  b.m(cg('town-plane', () => new THREE.PlaneGeometry(1, 1)), tmat(boardTex(label, color, '#4a1a2a', 512, 130)), 0, 1.75, 0.06, { sx: 2.2, sy: 0.55, cast: false });
  b.cyl(0, 0, 0.1, 0, 1.9);
  return b.done(x, 0, z, 0);
}

/** a block you can stand on, iced on top */
function platform(x: number, z: number, w: number, d: number, h: number, color: string): Built {
  const b = new B('cplat');
  b.m(boxGeo(w, h, d, 1.2), tmat(layersTex([shade(color, 0.5), '#fff8f2', shade(color, 0.3), '#fff8f2'], hashSeed(x, z) % 9)), 0, h / 2, 0);
  b.m(boxGeo(w + 0.16, 0.18, d + 0.16, 1), tm('#fffaf5'), 0, h - 0.05, 0);
  b.box(-w / 2, 0, -d / 2, w / 2, h + 0.04, d / 2);
  return b.done(x, 0, z, 0);
}

function gumdropStep(x: number, z: number, h: number, color: string): Built {
  const b = new B('cstep');
  b.cy(tmat(caneTex('#fff8f0', color, 3)), 0.22, h - 0.35, 0, 0, 0, 10);
  b.m(gumdropGeo(), tmat(marshTex(color)), 0, h - 0.45, 0, { sx: 0.75, sy: 0.5, sz: 0.75 });
  b.cyl(0, 0, 0.7, 0, h);
  return b.done(x, 0, z, 0);
}

function pennant(x: number, y: number, z: number, color: string): Built {
  const b = new B('cpen');
  b.cy(tm('#fffaf2'), 0.04, 1.4, 0, 0, 0, 6);
  const fg = b.group(0, 1.3, 0, undefined, true);
  const flag = b.m(cg('town-flag', () => { const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(1, -0.28); s.lineTo(0, -0.56); s.closePath(); return new THREE.ShapeGeometry(s); }), tm(color, { side: THREE.DoubleSide }), 0, 0, 0, { parent: fg, s: 0.8 });
  b.update((t) => { flag.rotation.y = Math.sin(t * 2.6) * 0.4; });
  return b.done(x, y, z, 0);
}

function slitWall(x: number, z: number, w: number, h: number, pal: TownPalette): Built {
  const b = new B('cslit');
  const slit = 0.42, side = (w - slit) / 2;
  const m = tmat(layersTex([pal.wall, pal.wallTop, shade(pal.wall, -0.06), pal.wallTop], 4));
  for (const sx of [-1, 1]) { b.m(boxGeo(side, h, 0.5, 1.2), m, sx * (slit / 2 + side / 2), h / 2, 0); b.box(sx > 0 ? slit / 2 : -w / 2, 0, -0.25, sx > 0 ? w / 2 : -slit / 2, h, 0.25); }
  b.m(boxGeo(slit + 0.02, 0.4, 0.5, 0), m, 0, 0.2, 0);
  b.m(boxGeo(slit + 0.02, h - 2.4, 0.5, 0), m, 0, 2.4 + (h - 2.4) / 2, 0);
  b.box(-slit / 2, 0, -0.25, slit / 2, 0.4, 0.25);
  b.box(-slit / 2, 2.4, -0.25, slit / 2, h, 0.25);
  b.m(boxGeo(w + 0.2, 0.22, 0.7, 1), tm(pal.icing), 0, h + 0.05, 0);
  return b.done(x, 0, z, 0);
}

function sunLamp(x: number, z: number): Built {
  const b = new B('csun');
  b.cy(tm('#5a3a2a'), 0.08, 2.6, 0, 0, 0, 8);
  b.sp(tm('#ffd84a', { emissive: '#ffb020', emissiveIntensity: 0.8 }), 0.38, 0, 2.95, 0, 14);
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; b.m(cg('town-ray', () => new THREE.ConeGeometry(0.07, 0.3, 5)), tm('#ffd84a'), Math.cos(a) * 0.55, 2.95 + Math.sin(a) * 0.55, 0, { rz: a - Math.PI / 2 }); }
  const s = glow('#ffe680', 3.2, 0.5); s.position.set(0, 2.95, 0); b.root.add(s);
  b.cyl(0, 0, 0.12, 0, 2.6);
  return b.done(x, 0, z, 0);
}

function cannon(x: number, z: number): Built {
  const b = new B('ccannon');
  b.m(boxGeo(1.2, 0.5, 1.0, 0), tmat(gingerTex('#a8642a')), 0, 0.25, 0);
  for (const sx of [-1, 1]) b.m(cg('town-wheel', () => new THREE.CylinderGeometry(0.42, 0.42, 0.16, 16).rotateZ(Math.PI / 2)), tmat(stripeTex('#ff5a8a', '#fff8f0', 6)), sx * 0.66, 0.42, 0);
  const tube = b.m(cg('town-cbarrel', () => new THREE.CylinderGeometry(0.26, 0.34, 1.5, 16)), tmat(caneTex('#fff8f0', '#7ad8ff', 4)), 0, 0.95, -0.25, { rx: -1.0 });
  void tube;
  b.box(-0.7, 0, -0.55, 0.7, 0.9, 0.55);
  return b.done(x, 0, z, 0);
}

function darkTent(x: number, z: number): Built {
  const b = new B('ctent');
  const m = tm('#2a1f3a', { side: THREE.DoubleSide });
  b.m(cg('town-tent', () => new THREE.ConeGeometry(1.5, 2.6, 8, 1, true, 0.5, Math.PI * 2 - 1.0).translate(0, 1.3, 0)), m, 0, 0, 0);
  b.m(puffGeo(), tm('#4a3a5a'), 0, 2.5, 0, { sx: 0.25, sy: 0.25, sz: 0.25 });
  return b.done(x, 0, z, 0);
}

// ───────────────────────── things you hit ─────────────────────────

/** a vampire scarecrow: wobbles, puffs and squeaks when hit (sword, peas, anything) — never breaks */
function dummy(L: Level3D, x: number, z: number, pal: TownPalette, ghost = false) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const body = new THREE.Group(); g.add(body);
  const mk = (geo: THREE.BufferGeometry, m: THREE.Material, px: number, py: number, pz: number, s: [number, number, number] = [1, 1, 1]) => { const me = new THREE.Mesh(geo, m); me.position.set(px, py, pz); me.scale.set(...s); me.castShadow = true; body.add(me); return me; };
  const op = ghost ? { transparent: true, opacity: 0.35 } : {};
  mk(new THREE.CylinderGeometry(0.06, 0.06, 1.3, 6), tm('#8a5a3a', op), 0, 0.65, 0);
  mk(new THREE.SphereGeometry(0.38, 12, 10), tm('#8a6aa8', op), 0, 1.25, 0, [1, 1.15, 0.9]);
  mk(new THREE.ConeGeometry(0.5, 1.0, 10, 1, true), tm('#241a2a', { side: THREE.DoubleSide, ...op }), 0, 1.25, -0.05);
  mk(new THREE.SphereGeometry(0.27, 12, 10), tm('#e6dcf0', op), 0, 1.85, 0);
  for (const sx of [-1, 1]) {
    mk(new THREE.ConeGeometry(0.08, 0.26, 6), tm('#241a2a', op), sx * 0.16, 2.12, 0);
    mk(new THREE.SphereGeometry(0.045, 6, 5), new THREE.MeshBasicMaterial({ color: '#ff3a4a', transparent: ghost, opacity: ghost ? 0.5 : 1 }), sx * 0.09, 1.9, 0.24);
    mk(new THREE.ConeGeometry(0.025, 0.08, 4).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: '#ffffff' }), sx * 0.05, 1.74, 0.25);
  }
  void pal;
  L.deco(g);
  L.col({ kind: 'cyl', x, z, r: 0.35, y0: 0, y1: 2.0 });
  let wob = 0, ph = 0;
  const hitAt = (from: THREE.Vector3) => {
    wob = 1; ph = Math.atan2(x - from.x, z - from.z);
    L.fx.stars(new THREE.Vector3(x, 1.5, z), 10, ['#ffffff', '#c8b4ff', '#ff9fc0']);
    audio.sfx('bounce', { pitch: 1.5, volume: 0.6 });
    if (Math.random() < 0.35) L.bark(g, ['Ай!', 'Пи!', 'Не по лицу!', 'Ещё!'][Math.floor(Math.random() * 4)], 1.1, 2.4);
  };
  const lastAtk = new Set<number>();
  const near = (c: THREE.Vector3, range: number) => Math.hypot(c.x - x, c.z - z) < range + 0.5 && c.y < 2.6;
  const h: Hittable3 & { predictHit(L: Level3D, c: THREE.Vector3, range: number, dir: THREE.Vector3, half: number, atkId: number): boolean } = {
    meleeHit(_L, c, _dir, range, _dmg, atkId) { if (lastAtk.has(atkId) || !near(c, range)) return false; lastAtk.add(atkId); if (lastAtk.size > 16) lastAtk.clear(); hitAt(c); return true; },
    predictHit(_L, c, range, _dir, _half, atkId) { return h.meleeHit(L, c, _dir, range, 0, atkId, ''); },
    shotHit(_L, s: Shot3) { const p = s.pos; if (s.owner !== 'player' || Math.hypot(p.x - x, p.z - z) > 0.6 || p.y > 2.3 || p.y < 0.6) return false; hitAt(p); return true; },
  };
  L.hittables.push(h);
  L.updaters.push((_t, dt) => {
    wob = Math.max(0, wob - dt * 1.6);
    const a = Math.sin(wob * 18) * wob * 0.35;
    body.rotation.set(Math.cos(ph) * a, 0, -Math.sin(ph) * a);
  });
}

/** a bullseye target on a post: spins when hit */
function target(L: Level3D, x: number, z: number) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 6), tm('#8a5a3a')); post.position.y = 0.8; g.add(post);
  const face = new THREE.Group(); face.position.y = 1.8; g.add(face);
  const rings = ['#ff4f6a', '#ffffff', '#ff4f6a', '#ffffff', '#ffd34a'];
  rings.forEach((c, i) => { const r = 0.55 - i * 0.11; const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.08 + i * 0.01, 24).rotateX(Math.PI / 2), tm(c)); m.position.z = i * 0.006; face.add(m); });
  L.deco(g);
  L.col({ kind: 'cyl', x, z, r: 0.12, y0: 0, y1: 1.6 });
  let spin = 0;
  const hit = () => { spin = 1; L.fx.stars(new THREE.Vector3(x, 1.8, z), 12, ['#ffd34a', '#ffffff', '#ff4f6a']); audio.sfx('coin', { pitch: 1.5, volume: 0.6 }); };
  const lastAtk = new Set<number>();
  const h: Hittable3 & { predictHit(L: Level3D, c: THREE.Vector3, range: number, dir: THREE.Vector3, half: number, atkId: number): boolean } = {
    meleeHit(_L, c, _d, range, _dmg, atkId) { if (lastAtk.has(atkId) || Math.hypot(c.x - x, c.z - z) > range + 0.6) return false; lastAtk.add(atkId); if (lastAtk.size > 16) lastAtk.clear(); hit(); return true; },
    predictHit(_L, c, range, dir, _half, atkId) { return h.meleeHit(L, c, dir, range, 0, atkId, ''); },
    shotHit(_L, s: Shot3) { const p = s.pos; if (s.owner !== 'player' || Math.hypot(p.x - x, p.z - z) > 0.7 || Math.abs(p.y - 1.8) > 0.7) return false; hit(); return true; },
  };
  L.hittables.push(h);
  L.updaters.push((_t, dt) => { spin = Math.max(0, spin - dt * 0.8); face.rotation.y += dt * spin * 18; });
}

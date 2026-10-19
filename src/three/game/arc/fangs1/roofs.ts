import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import type { Built } from '../../../physics/types';
import * as O from '../../../world/outdoor';
import { noOutline } from '../../../gfx';
import type { Level3D } from '../../level';
import type { Level3Def } from '../../levels';
import { addGrappleRing } from '../../heroes';
import { townProps as T, TOWN_NIGHT } from '../town';
import { mergeBuilts, B, tmat, rng, ringCols, glow } from '../town/kit';
import { cobbleTex, marshTex, layersTex, sprinkleTex, stripeTex, caneTex } from '../town/tex';
import { vamp, type VampKit, type Lantern } from '../vampires';
import { Cast } from './cast';
import { Count3 } from './boss';
import { Squirter, companion } from './common';
import { TITLE, DEATH, SIGNS, BARK } from './lines';

/*
 * «Клыки в пастиле», part 2 — `fangs1_roofs` (docs/script-fangs.md §5.4–5.8): out of the clock tower onto the roofs
 * under the Алая луна. A run over gingerbread roofs (flat terraces, gable ridges with chimneys, a marshmallow tower's
 * deck, pastila bridges, chimney stacks to hop), scout flocks, biters, a brute on a big terrace, flyers diving from the
 * moon — and the town hall's marshmallow dome, where Граф Нетопырь waits on the weathervane (the boss, boss.ts).
 * The streets far below: a fall is a pit (−1 ♥, back on the roof). Candles on the way; the last one at the bridge to
 * the dome. Secrets: a chimney stack for a hook / double jump / Пастила's pad, an attic only Ноки's bat gets into.
 * Co-op: build-order replication as usual; the boss is a host-simulated Netted (fixed id); scenes are world scenes.
 */

export const ROOFS_ID = 'fangs1_roofs';
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** the town hall's dome: the boss arena (floor centre, radius), the Count's weathervane */
export const HALL = { c: V(-21.5, 14, -50), R: 12.2, perch: V(-21.5, 20.7, -50) };
/** the clock tower's gallery (start) */
export const GALLERY = V(0, 13, 0);

export function roofsLevel(): Level3Def {
  const p = TOWN_NIGHT;
  return {
    id: ROOFS_ID, chapter: 0, title: TITLE.roofs, subtitle: 'Клыки в пастиле', music: 'night_town',
    spawn: [3.7, 13.05, 0.4], yaw: Math.PI / 2, killY: 3.5, fallLimit: 4.6,
    bg: p.bg, fog: p.fog, hemi: p.hemi, sun: { ...p.sun, dir: [...p.sun.dir] as [number, number, number] },
    castScenes: true, deathText: DEATH.roofs,
    startScript: 'fangs1_roofs_intro',
    build(L) { new Roofs(L); },
  };
}

/** the level's runtime (L.refs.f1roofs) */
export class Roofs {
  V: VampKit;
  cast: Cast;
  boss: Count3;
  arenaLanterns: Lantern[] = [];
  squirt: Squirter;
  private parts: Built[] = [];
  private deco: Built[] = [];
  private t = 0;
  private retried = false;

  constructor(readonly L: Level3D) {
    L.refs.f1roofs = this;
    const pal = TOWN_NIGHT;
    const V = this.V = vamp(L);
    V.nightLook({ red: 1, moonDir: [-0.5, 0.55, -0.68], fog: [34, 170], dark: 0.5 });
    V.moon({ size: 46, red: 1 });
    // ── the dome first: its six «солнышки» get the real lights ──
    this.buildHall();
    this.cast = new Cast(L);
    this.buildSky();
    this.buildStreets();
    this.buildRoute();
    this.buildFiller();
    for (const b of [mergeBuilts('roofs-route', this.parts), mergeBuilts('roofs-deco', this.deco)]) L.add(b);
    // colour: the roofs the Count drank (the hall comes back when he's beaten)
    V.greyZone('roofs0', [12, 12, 0], 11);
    V.greyZone('roofsA', [29, 11, -12], 14);
    V.greyZone('roofsB', [12, 10.6, -30], 13);
    V.greyZone('roofsC', [-13, 13, -30], 13);
    V.greyZone('hall', [HALL.c.x, HALL.c.y, HALL.c.z], 19, { auto: 'none' });
    this.buildEnemies();
    // candles
    L.cp(2.4, 13, -2.6);
    L.cp(29, 11, -12.4);
    L.cp(13.5, 10.6, -27.4);
    L.cp(-21.5, 14, -32.4); // (at the bridge's mouth: every way to the dome passes it)
    // signs (§11)
    L.signAt(11.0, 12.8, 2.4, SIGNS.roofer);
    L.signAt(-19.8, 14, -32.6, SIGNS.hall);
    // the boss on his weathervane (waits there the whole climb)
    this.boss = new Count3(L, { c: HALL.c.clone(), R: HALL.R, lanterns: this.arenaLanterns, perch: HALL.perch.clone(), cast: this.cast });
    L.boss = this.boss;
    // the boss fight begins on the dome
    if (!L.seen.has('fangs1_boss_intro')) L.trigger(HALL.c.x - 4, 12.5, HALL.c.z + 8.5, HALL.c.x + 4, 18, HALL.c.z + 12.6, 'fangs1_boss_intro');
    this.squirt = new Squirter(L);
    L.updaters.push((_t, dt) => this.update(dt));
    L.overlayDraw.push((ctx) => this.squirt.draw(ctx));
  }

  // ───────────────────────── building ─────────────────────────
  private put(b: Built) { this.parts.push(b); return b; }

  /** a flat iced terrace on a gingerbread house (top = walking height) */
  private flat(x: number, z: number, w: number, d: number, top: number, seed: number, rotY = 0, o: Partial<T.HouseOpts> = {}) {
    return this.put(T.gingerHouse({ x, y: 0, z, w, d, h: top - 0.32, rotY, flat: true, seed, pal: TOWN_NIGHT, ...o }));
  }
  /** a gable house: ridge along local x (rotY 1 → along world z) */
  private gable(x: number, z: number, w: number, d: number, h: number, seed: number, rotY = 0, roofH = 2.2) {
    return this.put(T.gingerHouse({ x, y: 0, z, w, d, h, rotY, roofH, seed, pal: TOWN_NIGHT }));
  }
  /** a candy-cane chimney stack you can hop on */
  private stack(x: number, z: number, r: number, top: number, color: string) {
    const b = new B('stack');
    b.m(new THREE.CylinderGeometry(r, r * 1.08, top, 16), tmat(caneTex(color, '#e8e0f0', 6)), 0, top / 2, 0);
    b.m(new THREE.TorusGeometry(r * 1.02, 0.12, 8, 20), tmat(null, '#d8d2e6'), 0, top, 0, { rx: Math.PI / 2 });
    b.m(new THREE.CylinderGeometry(r * 0.94, r * 0.94, 0.1, 16), tmat(null, '#3a2a3a'), 0, top + 0.02, 0);
    b.cyl(0, 0, r * 1.02, 0, top + 0.05);
    return this.put(b.done(x, 0, z, 0));
  }
  private bridge(x: number, y: number, z: number, len: number, w: number, rotY: number, o: { rails?: boolean; arch?: number } = {}) {
    return this.put(T.pastilaBridge({ x, y, z, len, w, rotY, rails: o.rails ?? true, arch: o.arch ?? 0, pal: TOWN_NIGHT, th: 0.4 }));
  }

  private buildSky() {
    const L = this.L, pal = TOWN_NIGHT, hl = pal.hills;
    const sd = new THREE.Vector3(...L.def.sun.dir).normalize();
    const az = Math.atan2(sd.x, -sd.z);
    L.deco(O.hillRings([
      { r: 150, base: -6, amp: 12, seed: 41, color: hl[0].color, rim: hl[0].rim, haze: hl[0].haze, bumps: 3, seg: 700 },
      { r: 230, base: 0, amp: 24, seed: 42, color: hl[1].color, rim: hl[1].rim, haze: hl[1].haze, seg: 600 },
      { r: 330, base: 8, amp: 46, seed: 43, color: hl[3].color, rim: hl[3].rim, haze: hl[3].haze, seg: 500, notch: 0.3 },
    ], az, '#2a2a5a'));
    // the castle on its rock, far away under the moon (where the Count flies when he's beaten)
    const g = new THREE.Group();
    const dark = new THREE.MeshBasicMaterial({ color: '#120c1c', fog: false });
    const rock = new THREE.Mesh(new THREE.ConeGeometry(26, 70, 7), dark); rock.position.set(0, 20, 0); g.add(rock);
    for (const [x, h, r] of [[0, 30, 5], [-8, 22, 3.4], [8, 24, 3.6], [-3, 38, 2.2]] as const) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 10), dark); t.position.set(x, 55 + h / 2, 0); g.add(t);
      const c = new THREE.Mesh(new THREE.ConeGeometry(r * 1.3, r * 2.4, 10), dark); c.position.set(x, 55 + h + r * 1.2, 0); g.add(c);
    }
    const win = glow('#ff4a4a', 4, 0.8); win.position.set(0, 72, 3); g.add(win);
    g.position.set(-210, -10, -330);
    g.lookAt(0, 0, 0);
    noOutline(g);
    L.deco(g);
    L.refs.castleAt = g.position.clone().setY(80);
  }

  /** the streets far below: cobbles, a few lamps glowing */
  private buildStreets() {
    const L = this.L, pal = TOWN_NIGHT;
    const geo = new THREE.PlaneGeometry(170, 150).rotateX(-Math.PI / 2);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 170 / 3.2, uv.getY(i) * 150 / 3.2);
    const tex = cobbleTex(pal.cobble, pal.cobbleGap);
    const m = new THREE.Mesh(geo, tmat(tex));
    m.position.set(0, 0, -25); m.receiveShadow = true;
    L.deco(m);
    L.col({ kind: 'box', min: V(-85, -2, -100), max: V(85, 0, 50) });
    for (const [x, z] of [[6, 6], [20, -6], [35, -20], [-2, -22], [-12, -40], [8, -44], [24, -42], [-30, -24]] as const) this.deco.push(T.marmaladeLamp({ x, y: 0, z, pal, light: false }));
  }

  private buildHall() {
    const L = this.L, V = this.V, pal = TOWN_NIGHT;
    const { c, R } = HALL;
    const b = new B('hall');
    const drumR = R + 0.4, floorY = c.y;
    // the drum: stacked marshmallow puffs with seams and lit windows
    const wm = tmat(marshTex(pal.walls[1]));
    const segs = 5;
    for (let i = 0; i < segs; i++) {
      const y0 = (i / segs) * (floorY - 0.4), h = (floorY - 0.4) / segs;
      b.m(new THREE.CylinderGeometry(drumR * (1 - i * 0.012), drumR * (1 - i * 0.012) + 0.1, h, 48), wm, 0, y0 + h / 2, 0);
      if (i) b.m(new THREE.TorusGeometry(drumR * (1 - i * 0.012) + 0.05, 0.08, 6, 64), tmat(null, pal.icing), 0, y0, 0, { rx: Math.PI / 2 });
    }
    // the floor: a marshmallow disc with a pink swirl
    const sw = document.createElement('canvas'); sw.width = sw.height = 256;
    const g2 = sw.getContext('2d')!;
    g2.fillStyle = '#c4b4cc'; g2.fillRect(0, 0, 256, 256);
    g2.strokeStyle = '#b48aa8'; g2.lineWidth = 9;
    g2.beginPath(); for (let a = 0; a < Math.PI * 9; a += 0.05) { const r = a * 4.2; const x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r; if (a === 0) g2.moveTo(x, y); else g2.lineTo(x, y); } g2.stroke();
    const swT = new THREE.CanvasTexture(sw); swT.colorSpace = THREE.SRGBColorSpace;
    b.m(new THREE.CylinderGeometry(drumR, drumR, 0.4, 48), tmat(swT), 0, floorY - 0.2, 0);
    // a puffy rim and a low icing balustrade (a gap toward the bridge, +Z)
    b.m(new THREE.TorusGeometry(R + 0.15, 0.42, 10, 64), tmat(null, pal.icing), 0, floorY + 0.15, 0, { rx: Math.PI / 2 });
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.22) continue;
      b.cy(tmat(caneTex('#f0e8f4', pal.roofs[0], 3)), 0.09, 0.9, Math.sin(a) * (R - 0.1), floorY, Math.cos(a) * (R - 0.1), 8);
    }
    b.cyl(0, 0, drumR, 0, floorY);
    ringCols(b, 0, 0, R - 0.1, floorY, floorY + 0.95, { gapAt: 0, gapHalf: 0.22 });
    // the weathervane spire in the middle: a little cupola, a thin spire, a bat-shaped vane
    b.m(new THREE.CylinderGeometry(0.9, 1.1, 1.6, 20), tmat(stripeTex(pal.roofs[0], '#5a2a4a', 6)), 0, floorY + 0.8, 0);
    b.m(new THREE.ConeGeometry(1.15, 2.2, 20), tmat(stripeTex(pal.roofs[6], '#4a1a2a', 8)), 0, floorY + 2.7, 0);
    b.cy(tmat(null, '#c8a050'), 0.06, 3.0, 0, floorY + 3.6, 0, 8);
    b.cyl(0, 0, 1.05, floorY, floorY + 1.6);
    b.cyl(0, 0, 0.6, floorY + 1.6, floorY + 3.2);
    const vane = b.group(0, floorY + 6.35, 0, undefined, true);
    const vs = new THREE.Shape(); vs.moveTo(-1, 0); vs.quadraticCurveTo(-0.6, 0.35, -0.2, 0.1); vs.lineTo(0, 0.25); vs.lineTo(0.2, 0.1); vs.quadraticCurveTo(0.6, 0.35, 1, 0); vs.quadraticCurveTo(0.6, -0.1, 0.4, -0.2); vs.quadraticCurveTo(0.2, -0.05, 0, -0.25); vs.quadraticCurveTo(-0.2, -0.05, -0.4, -0.2); vs.quadraticCurveTo(-0.6, -0.1, -1, 0);
    b.m(new THREE.ShapeGeometry(vs), tmat(null, '#c8a050', { side: THREE.DoubleSide }), 0, 0, 0, { parent: vane, s: 0.9 });
    b.update((t) => { vane.rotation.y = Math.sin(t * 0.3) * 0.6; });
    // the hall's front under the bridge (doors, a sign, a clock-less gable)
    L.add(b.done(c.x, 0, c.z, 0));
    // six «солнышки» around the rim (the first lanterns of the level: real lights)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      this.arenaLanterns.push(V.lantern(c.x + Math.sin(a) * (R - 1.4), floorY, c.z + Math.cos(a) * (R - 1.4), { r: 4.3 }));
    }
  }

  /** the run: gallery → bridge → terraces, ridges, a tower deck, an arched bridge, a big terrace, chimney hops → the dome */
  private buildRoute() {
    const L = this.L, pal = TOWN_NIGHT;
    // S0: the clock tower and its gallery
    this.put(T.clockTower({ x: 0, y: 0, z: 0, r: 2.6, h: 13, pal }));
    const gb = new B('gallery');
    gb.m(new THREE.CylinderGeometry(4.6, 4.6, 0.36, 36), tmat(layersTex([pal.icing, pal.walls[5], pal.icing], 3)), 0, 12.82, 0);
    gb.m(new THREE.TorusGeometry(4.5, 0.14, 8, 48), tmat(null, pal.icing), 0, 13.0, 0, { rx: Math.PI / 2 });
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      if (Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2))) < 0.3) continue; // the gap toward the bridge (+X)
      gb.cy(tmat(caneTex('#f0e8f4', pal.roofs[4], 3)), 0.06, 0.85, Math.sin(a) * 4.45, 13, Math.cos(a) * 4.45, 8);
    }
    gb.cyl(0, 0, 4.6, 12.6, 13.0);
    ringCols(gb, 0, 0, 4.45, 13.0, 13.9, { gapAt: Math.PI / 2, gapHalf: 0.3 });
    // a little door in the clock box (we came out of it)
    gb.m(new THREE.PlaneGeometry(1.0, 1.7), tmat(null, '#5a3a2a'), 2.72, 13.85, 0, { ry: Math.PI / 2 });
    this.put(gb.done(0, 0, 0, 0));
    // B1 → P1
    this.bridge(6.9, 12.8, 0, 5.2, 2.0, 0);
    this.flat(12.5, 0, 6.2, 6, 12.8, 801);
    // the attic on P1: a slot under its door (0.62 m) — only Ноки's bat fits
    this.attic(14.2, 12.8, -1.7);
    // P2: a gable to run along (ridge along x)
    this.gable(21.5, 0, 6.8, 6, 10.4, 802, 0, 2.2);
    // P3, the plank north, P4
    this.flat(29, 0, 6, 7, 11.0, 803);
    this.bridge(29, 11.0, -5.5, 4.2, 1.2, 1, { rails: false });
    this.flat(29, -11, 7, 7, 11.0, 804);
    // P5: a gable with its ridge along z
    this.gable(29, -20.5, 6, 7, 9.4, 805, 1, 2.4);
    // P6: a marshmallow tower's deck
    this.put(T.marshmallowTower({ x: 29, y: 0, z: -30, r: 3.2, h: 10.6, top: 'deck', pal, seed: 806 }));
    // B3: an arched bridge west to the big terrace
    this.bridge(21.9, 10.6, -30, 7.6, 2.2, 0, { arch: 0.9 });
    this.flat(13.5, -30, 9, 9, 10.6, 807, 0, { chimney: false });
    // chimney hops up to P8
    this.stack(6.7, -30.2, 1.0, 11.4, pal.candy[0]);
    this.stack(3.8, -31.2, 1.0, 12.2, pal.candy[2]);
    this.stack(0.9, -30.2, 1.0, 13.0, pal.candy[4]);
    this.flat(-4.5, -30, 6.5, 6, 13.0, 808);
    // P9: a gable along x, P10: the terrace before the dome
    this.gable(-13, -30, 7, 6, 10.8, 809, 0, 2.2);
    this.flat(-21.5, -30, 7, 7, 14.0, 810, 0, { chimney: false });
    // B4: the bridge to the dome
    this.bridge(-21.5, 14.0, -35.9, 4.6, 2.4, 1);
    // secrets: the tall chimney by the big terrace (a hook / double jump / Пастила's pad)
    this.stack(13.5, -36.6, 0.9, 13.9, pal.candy[5]);
    addGrappleRing(L, 13.5, 16.6, -35.0);
    L.pick('nut', 13.5, 14.6, -36.6, 'nut_f1_chimney');
    L.pick('bigcrumb', 0.8, 13.6, -30.2, 'f1r_stack');
    // a ring over the gap P5 → P6 (Бублик's shortcut)
    addGrappleRing(L, 29, 14.6, -25.4);
    // crumbs along the way
    L.crumbLine(9.8, 12.8, 0, 15, 12.8, 0, 4);
    L.crumbLine(19, 12.6, 0, 24, 12.6, 0, 4);
    L.crumbLine(29, 11, -8, 29, 11, -14, 3);
    L.crumbLine(19, 11.4, -30, 24.8, 11.4, -30, 4);
    L.crumbLine(-2, 13, -30, -7, 13, -30, 3);
    L.crumbLine(-21.5, 14, -27.5, -21.5, 14, -32.5, 3);
    // a few lanterns on the way (glow only)
    const V = this.V;
    V.lantern(14.6, 12.8, 2.2, { r: 4, light: false });
    V.lantern(31.5, 11.0, -13.2, { r: 4, light: false, lit: false });
    V.lantern(17.2, 10.6, -33.6, { r: 4.2, light: false });
    V.lantern(-23.8, 14.0, -27.2, { r: 4, light: false, lit: false });
  }

  /** an attic box with a bat-sized slot (the walnut inside) */
  private attic(x: number, y: number, z: number) {
    const L = this.L;
    const b = new B('attic');
    const wm = tmat(marshTex(TOWN_NIGHT.walls[3]));
    const w = 2.4, h = 1.8, th = 0.22;
    const wall = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
      b.m(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), wm, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      b.box(x0, y0, z0, x1, y1, z1);
    };
    wall(-w / 2, 0, -w / 2, w / 2, h, -w / 2 + th);
    wall(-w / 2, 0, w / 2 - th, w / 2, h, w / 2);
    wall(w / 2 - th, 0, -w / 2 + th, w / 2, h, w / 2 - th);
    // the front (−x): a slot under a little door
    wall(-w / 2, 0.62, -w / 2 + th, -w / 2 + th, h, w / 2 - th);
    b.m(new THREE.BoxGeometry(w + 0.5, 0.25, w + 0.5), tmat(sprinkleTex(TOWN_NIGHT.roofs[5], TOWN_NIGHT.candy)), 0, h + 0.12, 0);
    b.box(-w / 2 - 0.25, h, -w / 2 - 0.25, w / 2 + 0.25, h + 0.25, w / 2 + 0.25);
    b.m(new THREE.PlaneGeometry(0.7, 0.9), tmat(null, '#6a3a2a'), -w / 2 - 0.01, 1.1, 0, { ry: -Math.PI / 2 });
    this.put(b.done(x, y, z, 0));
    L.pick('nut', x + 0.2, y + 0.55, z, 'nut_f1_attic');
  }

  /** the rest of the town around: lower roofs and towers (no route; looks) */
  private buildFiller() {
    const pal = TOWN_NIGHT;
    const R = rng(4242);
    const route: [number, number, number, number][] = [
      [-6, -6, 6, 6], [4, -4, 33, 4.5], [24, -16, 34, -4], [24, -36, 34, -15], [7, -36, 26, -24], [-9, -35, 8, -25],
      [-27, -37, -8, -24], [-36, -64, -6, -36], [9, -40, 18, -33],
    ];
    const free = (x: number, z: number, r: number) => !route.some(([x0, z0, x1, z1]) => x > x0 - r && x < x1 + r && z > z0 - r && z < z1 + r);
    for (let gx = -44; gx <= 48; gx += 9) for (let gz = -70; gz <= 18; gz += 9) {
      const x = gx + (R() - 0.5) * 3, z = gz + (R() - 0.5) * 3;
      if (!free(x, z, 4.2)) continue;
      const w = 4.5 + R() * 2.5, d = 4.5 + R() * 2, h = 4 + R() * 3.6;
      if (R() < 0.12) this.deco.push(T.marshmallowTower({ x, y: 0, z, r: 2 + R() * 1.2, h: 9 + R() * 7, pal, seed: Math.round(R() * 999) }));
      else this.deco.push(T.gingerHouse({ x, y: 0, z, w, d, h, rotY: R() < 0.5 ? 0 : 1, roofH: 1.6 + R(), seed: Math.round(R() * 9999), pal, flat: R() < 0.15 }));
    }
  }

  private buildEnemies() {
    const L = this.L, V = this.V;
    L.enemy('fanger', 12.8, 12.8, 1.4, { aggro: 9, leash: 8 });
    V.flock(25.5, 14.6, 0, 4);
    L.enemy('fanger', 28.4, 11.0, -9.4, { aggro: 9, leash: 7 });
    L.enemy('fanger', 30.6, 11.0, -13.0, { aggro: 9, leash: 7 });
    L.enemy('mist', 29, 10.6, -30, { aggro: 9, leash: 5 });
    V.flock(21.9, 13.8, -30, 3);
    L.enemy('brute', 14.4, 10.6, -31.6, { aggro: 10, leash: 7 });
    L.enemy('fanger', 10.6, 10.6, -27.4, { aggro: 9, leash: 7 });
    L.enemy('flyer', 13.5, 17, -30);
    L.enemy('fanger', -4.5, 13.0, -28.8, { aggro: 9, leash: 5 });
    L.enemy('fanger', -20.2, 14.0, -28.4, { aggro: 9, leash: 6 });
    L.enemy('fanger', -22.8, 14.0, -31.6, { aggro: 9, leash: 6 });
    L.enemy('flyer', -16, 19.5, -32);
  }

  // ───────────────────────── per frame ─────────────────────────
  private update(dt: number) {
    const L = this.L;
    this.t += dt;
    // a retry after a respawn / team restart: the Count is back on his vane; whoever reaches the dome starts it again
    const b = this.boss;
    if (L.authority && L.seen.has('fangs1_boss_intro') && !b.active && !b.dead && !this.retried && !L.inCutscene && !L.worldCut) {
      if (L.alivePlayers().some((h) => Math.hypot(h.pos.x - HALL.c.x, h.pos.z - HALL.c.z) < HALL.R - 1 && h.pos.y > HALL.c.y - 1)) { this.retried = true; L.run('fangs1_boss_retry'); }
    }
    // a friend who loaded into a running fight (or missed the intro's end): the boss camera and music
    if (b.active && !b.dead && !L.inCutscene && L.camModeDefault !== 'boss') {
      L.camModeDefault = 'boss'; L.tcam.bossPoint = b.pos; L.tcam.mode = 'boss';
      audio.playMusic('vampire_boss');
    }
    // the story four's lines on the way (solo)
    if (!L.nl && !L.inCutscene) {
      const p = L.player.pos;
      if (Math.hypot(p.x - 29, p.z + 11) < 5) companion(L, 'r_noki_up', 'noki', BARK.noki[0]);
      if (Math.hypot(p.x - 13.5, p.z + 30) < 6) companion(L, 'r_tosha_together', 'tosha', BARK.tosha[1]);
      if (Math.hypot(p.x + 21.5, p.z + 30) < 5) companion(L, 'r_tosha_go', 'tosha', BARK.tosha[0]);
    }
    this.squirt.update(dt);
  }
}

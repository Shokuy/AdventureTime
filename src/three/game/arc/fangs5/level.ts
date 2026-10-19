import * as THREE from 'three';
import type { Level3D } from '../../level';
import type { Level3Def } from '../../levels';
import { basic, noOutline } from '../../../gfx';
import { B, unitCyl, tmat, bmat } from '../../../world/kit';
import { stoneBricksTex } from '../../../world/textures';
import { addGrappleRing } from '../../heroes';
import { vamp, type Lantern } from '../vampires';
import { F5 } from './lines';
import { M, block, crenels, tower, archFrame, windowAt, banner, brazier, bookcase, seaAndCliff, carpet, column, archGeo, STONE, flagTex } from './castle';
import { Siege, Candles, Crumble, portraitDeco } from './mechanics';
import { ROOF, CANNON_AT } from './boss';
import type { PaintKind } from './rigs';
import type { BoxCol } from '../../../physics/types';

/**
 * `fangs5_castle` — Серия 6 «Замок Полночь» (docs/script-fangs.md §9). North (−z) is the way on:
 *   A  the bridge over the sea (spawn, the intro scene)                      z  100 … 46
 *   B  the gate and the courtyard: the lantern siege, пресняки, a broken wall walk (secret)   z   46 … 4
 *   C  the portrait hall: eyes that follow you, living portraits, the candle puzzle            z    4 … −35
 *   D  the library: book-bats, the ambush ring, the stair to the gallery, bookcase tops (secret) z −36 … −73
 *   E  the spiral tower: stone discs up the wall, crumbling ones, the little bats (scene), a chandelier (secret)
 *   F  the roof under the moon: Король Полночь, the Солнечная пушка                     centre (0, 38, −118)
 *   G  (far east) the morning square of Пастильное королевство for the finale — finale.ts
 * Every required step is a single jump (≤ 1.4 m up, ≤ 3 m across) — any hero, alone. Abilities open the secrets.
 */

export const TOWER = { x: 0, z: -86, r: 9.5, y0: 6, y1: 38 };
/** spiral discs: centre radius, disc radius, rise, angle step, first angle */
const SP = { R: 7.4, r: 1.75, rise: 0.7, da: 0.3065, n: 46 };
// (the first step stands just east of the door: 45 × da = 2 turns + a quarter less a little, ending east at the top floor)
export const LIB = { y: 6 };

/** where the cast stands in each scene (scripts.ts) and other shared spots */
export const SPOTS = {
  spawn: new THREE.Vector3(0, 0, 78),
  bell: new THREE.Vector3(0, 46.2, -86),
  stairsLanding: 20,
};

/** a spot on landing `i` (k = 0 the stair disc … 1 the inner disc), turned `da` round the shaft */
export function landingSpot(i: number, k: number, da = 0) {
  const d = discAt(i);
  const r = SP.R - 2.1 * k, a = d.a + da / r;
  return new THREE.Vector3(TOWER.x + Math.sin(a) * r, d.y, TOWER.z + Math.cos(a) * r);
}
export function discAt(i: number) {
  const aEnd = Math.PI / 2;
  const a = aEnd - (SP.n - 1 - i) * SP.da;
  return { x: TOWER.x + Math.sin(a) * SP.R, z: TOWER.z + Math.cos(a) * SP.R, y: TOWER.y0 + SP.rise * (i + 1), a };
}
const LANDINGS = new Set([10, 20, 31]);

export function fangs5Level(): Level3Def {
  return {
    id: 'fangs5_castle', chapter: 0, title: 'Замок Полночь', subtitle: 'Серия 6', music: 'castle',
    spawn: [0, 0, 78], yaw: Math.PI, killY: -22,
    bg: '#2a0d20', fog: ['#3a1028', 40, 160],
    hemi: ['#d07890', '#2c1022', 0.9], sun: { color: '#ff9e9e', intensity: 1.2, dir: [0, 0.32, -1] },
    startScript: 'fangs5_intro',
    castScenes: true,
    fallLimit: 9,
    deathText: F5.death[Math.floor(Math.random() * F5.death.length)],
    build: (L) => build(L),
  };
}

function build(L: Level3D) {
  const V = vamp(L);
  V.nightLook({ red: 1, fog: [42, 170], moonDir: [0, 0.32, -1], dark: 0.45 });
  V.moon({ size: 78, red: 1 });
  seaAndCliff(L);
  bridge(L);
  courtyard(L);
  hall(L);
  library(L);
  spiral(L);
  roof(L);
}

// ═════════════════════════════ A — the bridge ═════════════════════════════
function bridge(L: Level3D) {
  const b = new B('f5bridge');
  // the far bank and the bridge deck
  block(b, M.flagD(), -11, -3, 84, 11, 0, 100, { tile: 4 });
  block(b, M.flag(), -3, -1.2, 46, 3, 0, 84, { tile: 3 });
  for (const s of [-1, 1]) crenels(b, M.stone(), s * 3.4, 46, s * 3.4, 84, -0.3, { th: 0.8, h: 1.2, step: 2.2, guard: 1.8 });
  // arches down into the sea
  for (const z of [54, 66, 78]) {
    b.m(unitCyl(10), M.stoneD(), -2.4, -44, z, { sx: 1.1, sy: 43, sz: 1.1 });
    b.m(unitCyl(10), M.stoneD(), 2.4, -44, z, { sx: 1.1, sy: 43, sz: 1.1 });
  }
  // lamp posts with red flames on the bank
  brazier(b, -4, 0, 88, { h: 2.2, color: '#ff6a4a' });
  brazier(b, 4, 0, 88, { h: 2.2, color: '#ff6a4a' });
  // the gatehouse
  block(b, M.stone(), -24, 0, 40, -2.5, 14, 46);
  block(b, M.stone(), 2.5, 0, 40, 24, 14, 46);
  block(b, M.stone(), -2.5, 6, 40, 2.5, 14, 46);
  // the floor of the gate passage (bridge deck → courtyard)
  block(b, M.flagD(), -2.5, -2, 40, 2.5, 0, 46, { tile: 3 });
  crenels(b, M.stone(), -24, 46, 24, 46, 14, { guard: 0 });
  archFrame(b, 0, 0, 46.1, 5, 6);
  tower(b, -6.5, 46.5, 3.2, 0, 20, { roof: 7, window: true });
  tower(b, 6.5, 46.5, 3.2, 0, 20, { roof: 7, window: true });
  banner(b, -3.8, 12.5, 46.15, 1.6, 4, 0);
  banner(b, 3.8, 12.5, 46.15, 1.6, 4, 0);
  windowAt(b, -14, 7, 46.05, 1.4, 2.6, 0);
  windowAt(b, 14, 7, 46.05, 1.4, 2.6, 0);
  // the biting bell by the gate (§11)
  const bell = b.group(4.2, 2.8, 47.2, undefined, true);
  b.m(new THREE.SphereGeometry(0.5, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), M.gold(), 0, 0, 0, { parent: bell });
  for (const s of [-1, 1]) b.m(new THREE.ConeGeometry(0.06, 0.18, 6), basic('#ffffff'), s * 0.15, -0.25, 0.42, { parent: bell, rx: Math.PI, cast: false });
  b.m(new THREE.BoxGeometry(0.12, 1.4, 0.12), M.iron(), 0, 0.8, 0, { parent: bell });
  b.update((t) => { bell.rotation.z = Math.sin(t * 2.4) * 0.12; });
  L.add(b.done(0, 0, 0));
  L.signAt(3.6, 0, 48, F5.signs.gate);
  // the gate leaves (open in the intro: refs.gateLeaves)
  const leaves: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(s * 2.5, 0, 45.6);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(2.5, 5.6, 0.3), M.wood());
    leaf.position.set(-s * 1.25, 2.8, 0); leaf.castShadow = true;
    hinge.add(leaf);
    for (const y of [1.2, 4.2]) { const band = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.2, 0.34), M.iron()); band.position.set(-s * 1.25, y, 0); hinge.add(band); }
    L.deco(hinge);
    leaves.push(hinge);
  }
  const gcol: BoxCol = { kind: 'box', min: new THREE.Vector3(-2.5, 0, 45.2), max: new THREE.Vector3(2.5, 6, 46) };
  L.col(gcol);
  L.refs.f5gate = { leaves, col: gcol };
  if (L.seen.has('fangs5_intro')) { leaves[0].rotation.y = -1.6; leaves[1].rotation.y = 1.6; gcol.active = false; }
  // the cannon on its cart (Пастила wheels it in during the intro; it waits on the roof)
  L.refs.f5bridgeCannonAt = new THREE.Vector3(1.8, 0, 72);
}

// ═════════════════════════════ B — the courtyard ═════════════════════════════
function courtyard(L: Level3D) {
  const V = vamp(L);
  const b = new B('f5court');
  block(b, M.flag(), -22, -2, 3, 22, 0, 40, { tile: 3 });
  // curtain walls with battlements
  block(b, M.stone(), -25, 0, 4, -22, 9, 40);
  block(b, M.stone(), 22, 0, 4, 25, 9, 40);
  crenels(b, M.stone(), -23.5, 4, -23.5, 40, 9, { guard: 0 });
  crenels(b, M.stone(), 23.5, 4, 23.5, 40, 9, { guard: 0 });
  // wall walks: west whole, east broken in the middle (a secret beyond the gap)
  block(b, M.stoneD(), -22, 0, 8, -19, 5.5, 38);
  block(b, M.stoneD(), 19, 0, 28.5, 22, 5.5, 38);
  block(b, M.stoneD(), 19, 0, 7, 22, 5.5, 19.5);
  // rubble in the gap
  for (const [x, z, s] of [[20, 22, 0.9], [21, 25, 1.2], [19.6, 27, 0.7]] as const) b.m(new THREE.DodecahedronGeometry(s, 0), M.stoneD(), x, s * 0.6, z, { ry: x });
  b.box(19, 0, 20.5, 22, 1.2, 27.5);
  // stairs up to the wall walks (1.1 m each)
  for (let i = 0; i < 5; i++) {
    const x0 = 13.5 + 1.2 * i, top = 1.1 * (i + 1);
    block(b, M.stoneD(), -x0 - 1.2, 0, 34, -x0, top, 37.5, { tile: 2 });
    block(b, M.stoneD(), x0, 0, 34, x0 + 1.2, top, 37.5, { tile: 2 });
  }
  // the keep's facade with the portcullis gate
  block(b, M.stone(), -22, 0, 3, -2.5, 16, 6);
  block(b, M.stone(), 2.5, 0, 3, 22, 16, 6);
  block(b, M.stone(), -2.5, 5.2, 3, 2.5, 16, 6);
  crenels(b, M.stone(), -22, 5.5, 22, 5.5, 16, { guard: 0 });
  archFrame(b, 0, 0, 6.05, 5, 5.2);
  windowAt(b, 0, 8.4, 6.05, 3.2, 5.6, 0, '#ff4a4a');
  for (const x of [-12, 12]) windowAt(b, x, 7, 6.05, 1.6, 3, 0);
  banner(b, -5, 14, 6.1, 2, 5.5, 0); banner(b, 5, 14, 6.1, 2, 5.5, 0);
  tower(b, -22.5, 5, 3.4, 0, 22, { roof: 8, window: true });
  tower(b, 22.5, 5, 3.4, 0, 22, { roof: 8, window: true });
  // the well in the middle, carts, barrels
  b.m(new THREE.CylinderGeometry(1.8, 1.9, 1.1, 18), M.stoneD(), 0, 0.55, 22);
  b.m(new THREE.CylinderGeometry(1.4, 1.4, 0.2, 18), basic('#140a18'), 0, 1.02, 22, { cast: false });
  b.cyl(0, 22, 1.8, 0, 1.1);
  for (const s of [-1, 1]) b.m(new THREE.BoxGeometry(0.2, 2.6, 0.2), M.wood(), s * 1.5, 2.1, 22);
  b.m(new THREE.BoxGeometry(3.4, 0.25, 0.4), M.wood(), 0, 3.4, 22);
  brazier(b, -4, 0, 7.5, { light: true });
  brazier(b, 4, 0, 7.5);
  L.add(b.done(0, 0, 0));
  for (const [x, z] of [[-17, 18], [17, 32], [-8, 38.5], [9, 8]] as const) L.breakable('crate', x, 0, z, 3);
  // the portcullis (rises when the siege is won)
  const gate = new THREE.Group();
  gate.position.set(0, 0, 4.6);
  for (let i = 0; i <= 6; i++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 5.2, 0.16), M.iron()); bar.position.set(-2.4 + i * 0.8, 2.6, 0); bar.castShadow = true; gate.add(bar); }
  for (const y of [1.2, 3, 4.8]) { const bar = new THREE.Mesh(new THREE.BoxGeometry(5, 0.16, 0.16), M.iron()); bar.position.y = y; gate.add(bar); }
  for (let i = 0; i <= 6; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 6), M.iron()); sp.position.set(-2.4 + i * 0.8, -0.1, 0); sp.rotation.x = Math.PI; gate.add(sp); }
  L.deco(gate);
  const gcol = { kind: 'box' as const, min: new THREE.Vector3(-2.5, 0, 4.2), max: new THREE.Vector3(2.5, 5.2, 5) };
  L.col(gcol);
  // the grey courtyard, its lanterns, its пресняки, its guards
  V.greyZone('f5court', [0, 0, 22], 21, { auto: 'none', edge: 4 });
  const lan: Lantern[] = [[-11, 31], [11, 31], [-11, 13], [11, 13]].map(([x, z]) => V.lantern(x, 0, z, { lit: false, r: 5 }));
  V.folk(-16, 0, 28, 'zefir'); V.folk(15.5, 0, 25, 'pryanik'); V.folk(-6, 0, 10, 'marmelad');
  L.enemy('brute', 0, 0, 26);
  L.enemy('fanger', -8, 0, 22);
  L.enemy('fanger', 8, 0, 17);
  L.enemy('flyer', 3, 6, 12);
  const siege = new Siege(L, { lanterns: lan, box: [-22, 6, 22, 39.5], gate, col: gcol, spawns: [[-17, 0, 30], [17, 0, 33], [-17, 0, 15], [17, 0, 11], [-10, 0, 8], [10, 0, 8]], zone: 'f5court' });
  L.refs.f5siege = siege;
  L.cp(-3.6, 0, 38.5);
  L.signAt(-3.6, 0, 36.5, F5.signs.courtyard);
  // the secret beyond the broken wall walk: a heart (Бублик's ring, Ноки's bat, a dash)
  addGrappleRing(L, 20.5, 7.6, 19.2);
  L.pick('container', 20.5, 6.4, 11, 'f5_heart');
  L.crumbLine(20.5, 5.5, 37, 20.5, 5.5, 30, 3);
  L.crumbLine(-20.5, 5.5, 36, -20.5, 5.5, 12, 6);
}

// ═════════════════════════════ C — the portrait hall ═════════════════════════════
function hall(L: Level3D) {
  const b = new B('f5hall');
  block(b, M.flagD(), -8.5, -2, -36, 8.5, 0, 3, { tile: 3 });
  block(b, M.stone(), -9.5, 0, -36, -7.5, 12, 3);
  block(b, M.stone(), 7.5, 0, -36, 9.5, 12, 3);
  block(b, M.stoneD(), -9.5, 12, -36, 9.5, 13, 3, { tile: 4 });
  // the north wall around the King's portrait (a door)
  block(b, M.stone(), -7.5, 0, -35.5, -2.5, 12, -34.5);
  block(b, M.stone(), 2.5, 0, -35.5, 7.5, 12, -34.5);
  block(b, M.stone(), -2.5, 6.4, -35.5, 2.5, 12, -34.5);
  carpet(b, 0, 0, -15.5, 3.2, 36);
  for (const z of [0, -8, -14, -22, -30]) for (const s of [-1, 1]) column(b, s * 4.6, z, 0, 12, 0.5);
  for (const z of [-4, -12, -20, -28]) for (const s of [-1, 1]) windowAt(b, s * 7.45, 7.5, z, 1.2, 3, s > 0 ? -Math.PI / 2 : Math.PI / 2, '#ff5a5a');
  brazier(b, 5.6, 0, -33, { light: true, h: 1.1 });
  // a chandelier over the middle of the hall (warm light on the portraits)
  b.m(new THREE.TorusGeometry(1.6, 0.1, 8, 24), M.iron(), 0, 8.5, -7, { rx: Math.PI / 2 });
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; b.m(new THREE.ConeGeometry(0.08, 0.24, 6), bmat('#ffb040'), Math.cos(a) * 1.6, 8.75, -7 + Math.sin(a) * 1.6, { glow: true }); }
  b.m(new THREE.CylinderGeometry(0.03, 0.03, 3.5, 5), M.iron(), 0, 10.25, -7, { cast: false });
  b.light('#ffc070', 26, 22, 1.4, 0, 8.2, -7);
  // a slate roof over the hall
  b.m(gable(11.3, 39), M.slate(), 0, 12 + 5.65 * 0.45, -16.5, { sy: 0.45 });
  L.add(b.done(0, 0, 0));
  // portraits (their eyes follow you) — and Ноки's, a hundred years ago
  const deco: [PaintKind, number, number, number][] = [['lady', -1, 3.2, -1.5], ['knight', 1, 3.2, -1.5], ['candy', -1, 3.2, -10], ['bear', 1, 3.2, -10], ['baker', -1, 3.2, -31], ['owl', 1, 3.2, -31], ['candy', -1, 3.2, -6], ['lady', 1, 3.2, -14.5]];
  for (const [k, s, y, z] of deco) portraitDeco(L, k, s * 7.42, y, z, s > 0 ? -Math.PI / 2 : Math.PI / 2);
  const noki = portraitDeco(L, 'girl', 7.42, 3.0, -6, -Math.PI / 2, { w: 1.6, h: 2.2 });
  L.refs.f5nokiPortrait = noki.root;
  // the four lieutenants and the candles under them: I and III on the west wall, II and IV on the east
  const lieut: [PaintKind, number, number][] = [['netopyr', -1, -18], ['morok', 1, -18], ['shepot', -1, -26], ['twins', 1, -26]];
  lieut.forEach(([k, s, z], i) => portraitDeco(L, k, s * 7.42, 3.1, z, s > 0 ? -Math.PI / 2 : Math.PI / 2, { w: k === 'twins' ? 2.2 : 1.7, h: 2.3, plaque: F5.plaques[i] }));
  // the King's portrait: a door on a hinge at x = −2.5
  const hinge = new THREE.Group();
  hinge.position.set(-2.5, 0, -34.4);
  const door = portraitDeco(L, 'king', 0, 0, 0, 0, { w: 5, h: 6.3 });
  door.root.removeFromParent();
  door.root.position.set(2.5, 0.05, 0);
  hinge.add(door.root);
  L.deco(hinge);
  const dcol = { kind: 'box' as const, min: new THREE.Vector3(-2.5, 0, -34.6), max: new THREE.Vector3(2.5, 6.4, -34.2) };
  L.col(dcol);
  const candles = new Candles(L, {
    at: [new THREE.Vector3(-6.2, 0, -18), new THREE.Vector3(6.2, 0, -18), new THREE.Vector3(-6.2, 0, -26), new THREE.Vector3(6.2, 0, -26)],
    door: hinge, col: dcol,
    wallSpots: [[-7, 4, -4, Math.PI / 2], [7, 4, -8, -Math.PI / 2], [-7, 4, -12, Math.PI / 2], [7, 4, -20, -Math.PI / 2]],
  });
  L.refs.f5candles = candles;
  // two portraits that are alive
  L.enemy('portrait', -7.1, 3.6, 2, { yaw: Math.PI / 2, paint: 'knight', wake: 6.5 });
  L.enemy('portrait', 7.1, 3.6, -12.5, { yaw: -Math.PI / 2, paint: 'lady', wake: 6.5 });
  L.cp(-3.2, 0, 1.5);
  L.signAt(-3, 0, 1.5, F5.signs.portraits);
  L.signAt(0, 0, -15.5, F5.signs.puzzle);
  L.crumbLine(0, 0, -2, 0, 0, -12, 4);
}

// ═════════════════════════════ D — the library ═════════════════════════════
function library(L: Level3D) {
  const V = vamp(L);
  const b = new B('f5lib');
  // the passage behind the King's portrait
  block(b, M.flagD(), -2.5, -2, -37, 2.5, 0, -34.4, { tile: 3 });
  block(b, M.stone(), -3.5, 0, -37, -2.5, 6.4, -34.5);
  block(b, M.stone(), 2.5, 0, -37, 3.5, 6.4, -34.5);
  // the room
  block(b, tmat(flagTex('#7a6a8a'), '#ffffff'), -16, -2, -72, 16, 0, -37, { tile: 3 });
  block(b, M.stone(), -17, 0, -74, -16, 16, -36);
  block(b, M.stone(), 16, 0, -74, 17, 16, -36);
  block(b, M.stone(), -16, 0, -37, -2.5, 16, -36);
  block(b, M.stone(), 2.5, 0, -37, 16, 16, -36);
  block(b, M.stone(), -2.5, 6.4, -37, 2.5, 16, -36);
  block(b, M.stone(), -16, 0, -74, -2, 16, -72);
  block(b, M.stone(), 2, 0, -74, 16, 16, -72);
  block(b, M.stone(), -2, 0, -74, 2, 6, -72);
  block(b, M.stone(), -2, 10.5, -74, 2, 16, -72);
  block(b, M.stoneD(), -17, 16, -74, 17, 17, -36, { tile: 4 });
  // the gallery (north) on columns, the stair up along the east wall
  block(b, M.wood(), -16, 5.4, -72, 16, 6, -67.2, { tile: 2 });
  for (const x of [-12, -6, 6, 10]) column(b, x, -67.6, 0, 5.4, 0.35);
  // (the railing leaves the west end open: from there the bookcase tops climb to a secret)
  b.box(-13.6, 6, -67.4, 11.6, 7.1, -67.1);
  b.m(new THREE.BoxGeometry(25.2, 0.12, 0.12), M.gold(), -1, 7.0, -67.25);
  for (let x = -13.4; x <= 11.4; x += 1.6) b.m(new THREE.BoxGeometry(0.08, 1.0, 0.08), M.gold(), x, 6.5, -67.25, { cast: false });
  for (let i = 0; i < 8; i++) {
    const z0 = -40.5 - 3.2 * i, top = 0.75 * (i + 1);
    block(b, M.stoneD(), 12.4, 0, z0 - 3.2, 16, top, z0, { tile: 2 });
  }
  block(b, M.wood(), 12.4, 5.4, -67.2, 16, 6, -66.2, { tile: 2 });
  // bookcases: west wall (a staircase of tops toward the gallery: the secret), the south wall, under the gallery
  bookcase(b, -15.4, 0, -41.5, 4.4, 10, 1.2, 1, 1);
  bookcase(b, -15.4, 0, -46.5, 4.4, 10, 1.2, 1, 2);
  bookcase(b, -15.4, 0, -54, 4.4, 10.2, 1.2, 1, 3);
  bookcase(b, -15.4, 0, -59, 4.4, 8.8, 1.2, 1, 4);
  bookcase(b, -15.4, 0, -64, 4.4, 7.4, 1.2, 1, 5);
  for (const x of [-11, -6.5, 6.5, 11]) bookcase(b, x, 0, -37.4, 4, 6, 1, 2, 6 + Math.round(x));
  for (const x of [-12, -6, 0, 6]) bookcase(b, x, 0, -71.2, 5, 5.2, 1.2, 0, 9 + x);
  // windows, lights
  for (const z of [-44, -52, -60]) { windowAt(b, -15.95, 10.5, z, 1.4, 3.4, Math.PI / 2, '#ff5050'); windowAt(b, 15.95, 10.5, z, 1.4, 3.4, -Math.PI / 2, '#ff5050'); }
  brazier(b, -8, 0, -45);
  brazier(b, 8, 0, -45);
  carpet(b, 0, 0, -55, 9, 9);
  b.m(new THREE.TorusGeometry(2.2, 0.12, 8, 28), M.iron(), 0, 11, -55, { rx: Math.PI / 2 });
  for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5; b.m(new THREE.ConeGeometry(0.09, 0.26, 6), bmat('#ffb040'), Math.cos(a) * 2.2, 11.27, -55 + Math.sin(a) * 2.2, { glow: true }); }
  b.m(new THREE.CylinderGeometry(0.03, 0.03, 5, 5), M.iron(), 0, 13.5, -55, { cast: false });
  b.light('#ffc070', 30, 26, 1.3, 0, 10.6, -55);
  b.m(gable(19.6, 38.5), M.slate(), 0, 17 + 9.8 * 0.4, -55, { sy: 0.4 });
  // the doorway to the tower (bars until the ambush is won)
  archFrame(b, 0, 6, -72.05, 4, 4.5);
  L.add(b.done(0, 0, 0));
  const bars = new THREE.Group();
  for (let i = 0; i <= 4; i++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 4.4, 0.14), M.iron()); bar.position.set(-1.6 + i * 0.8, 8.2, -72.3); bars.add(bar); }
  L.deco(bars);
  const bcol = { kind: 'box' as const, min: new THREE.Vector3(-2, 6, -72.8), max: new THREE.Vector3(2, 10.5, -71.8), active: true };
  L.col(bcol);
  L.refs.f5libBars = { bars, col: bcol };
  // the book-bats on the shelves
  const books: [number, number, number, number][] = [[-14.3, 3.2, -44, Math.PI / 2], [-14.3, 6.4, -50, Math.PI / 2], [-14.3, 4.6, -57, Math.PI / 2], [-11, 4.2, -38.3, Math.PI], [11, 3.6, -38.3, Math.PI], [-6, 3.8, -70.3, 0], [6, 3.4, -70.3, 0], [14.6, 6.5, -61, -Math.PI / 2]];
  for (const [x, y, z, yaw] of books) L.enemy('bookbat', x, y, z, { yaw, wake: 8 });
  // the ambush ring in the reading circle
  L.arena(0, 0, -55, 6.5, [
    [{ kind: 'bookbat', x: -2, y: 2.5, z: -53, o: { wake: 0 } }, { kind: 'bookbat', x: 2, y: 2.5, z: -57, o: { wake: 0 } }, { kind: 'fanger', x: 0, y: 0, z: -59 }],
    [{ kind: 'bookbat', x: -3, y: 2.6, z: -57, o: { wake: 0 } }, { kind: 'bookbat', x: 3, y: 2.6, z: -53, o: { wake: 0 } }, { kind: 'servant', x: 3, y: 0, z: -56 }, { kind: 'fanger', x: -3, y: 0, z: -52 }],
  ], [{ kind: 'honey', x: 0, y: 0.6, z: -55 }], 1.4);
  V.dustZone([0, 0, -55], 5);
  L.cp(-3.4, 0, -39.6);
  L.signAt(3.2, 0, -39, F5.signs.library);
  // Бублик's ring up to the gallery (a shortcut)
  addGrappleRing(L, -4, 8.3, -68.6);
  // the secret on the tallest bookcase (climb the bookcase tops from the gallery)
  L.pick('nut', -15.4, 10.9, -54, 'nut_f5_library');
  L.crumbLine(14.2, 1, -42, 14.2, 6, -62, 6);
}

// ═════════════════════════════ E — the spiral tower ═════════════════════════════
function spiral(L: Level3D) {
  const b = new B('f5tower');
  const T = TOWER;
  // the corridor from the gallery
  block(b, M.wood(), -2, 5.4, -76.8, 2, 6, -72, { tile: 2 });
  block(b, M.stone(), -3, 6, -77, -2, 10.5, -72);
  block(b, M.stone(), 2, 6, -77, 3, 10.5, -72);
  block(b, M.stoneD(), -3, 10.5, -77, 3, 11.2, -72);
  // the drum: an inner face (seen from inside), walls as a ring of posts, the floor
  // (three bands: the corridor's opening at the bottom south, the roof walk's at the top north)
  const inM = tmat(stoneBricksTex(STONE), '#ffffff', { side: THREE.DoubleSide });
  const band = (r: number, y0: number, y1: number, gapAt: number | null, mat: THREE.Material) => {
    const th0 = gapAt === null ? 0 : gapAt + 0.27, len = gapAt === null ? Math.PI * 2 : Math.PI * 2 - 0.54;
    const g = new THREE.CylinderGeometry(r, r, y1 - y0, 40, 1, true, th0, len);
    const u = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * (len * r) / 3, u.getY(i) * (y1 - y0) / 3);
    b.m(g, mat, T.x, (y0 + y1) / 2, T.z);
  };
  for (const [r, m] of [[T.r + 0.1, inM], [T.r + 1.3, M.stone()]] as const) {
    band(r, 0, 10.5, 0, m);
    band(r, 10.5, T.y1, null, m);
    band(r, T.y1, T.y1 + (r > T.r + 1 ? 2.5 : 4), Math.PI, m);
  }
  const n = 44;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = T.x + Math.sin(a) * (T.r + 0.9), z = T.z + Math.cos(a) * (T.r + 0.9);
    // openings: the corridor (south, at the base) and the roof walk (north, at the top)
    const south = Math.abs(wrap(a)) < 0.2, north = Math.abs(wrap(a - Math.PI)) < 0.2;
    if (south) { b.cyl(x, z, 1.05, 10.5, T.y1 + 6); b.cyl(x, z, 1.05, 0, T.y0); continue; }
    if (north) { b.cyl(x, z, 1.05, 0, T.y1); b.cyl(x, z, 1.05, T.y1 + 4, T.y1 + 6); continue; }
    b.cyl(x, z, 1.05, 0, T.y1 + 6);
  }
  block(b, M.flagD(), T.x - T.r, T.y0 - 1, T.z - T.r, T.x + T.r, T.y0, T.z + T.r, { tile: 3 });
  // windows round the drum
  for (const a of [0.9, 2.2, 3.9, 5.3]) for (const y of [14, 26]) windowAt(b, T.x + Math.sin(a) * (T.r - 0.05), y, T.z + Math.cos(a) * (T.r - 0.05), 1.0, 2.2, a + Math.PI, '#ff5a5a');
  // the top: half a floor (north) at the roof's height, crenels, a belfry with the clock bell
  block(b, M.flagD(), T.x - T.r, T.y1 - 0.5, T.z - T.r, T.x + T.r, T.y1, T.z - 1.75, { tile: 3 });
  for (const [x, z] of [[-4, -90], [4, -90]] as const) b.m(unitCyl(8), M.stoneD(), x, T.y1, z, { sx: 0.35, sy: 8, sz: 0.35 });
  b.cyl(-4, -90, 0.35, T.y1, T.y1 + 8); b.cyl(4, -90, 0.35, T.y1, T.y1 + 8);
  b.m(new THREE.ConeGeometry(7, 5, 4), M.slate(), T.x, T.y1 + 10.5, T.z, { ry: Math.PI / 4 });
  b.m(new THREE.BoxGeometry(9, 0.6, 9), M.trim(), T.x, T.y1 + 8, T.z);
  // the roof walk to the keep roof
  block(b, M.flag(), -2, T.y1 - 0.6, -101, 2, T.y1, -95.4, { tile: 3 });
  b.box(-2.6, T.y1, -101, -2.1, T.y1 + 1.4, -96); b.box(2.1, T.y1, -101, 2.6, T.y1 + 1.4, -96);
  for (const s of [-1, 1]) b.m(new THREE.BoxGeometry(0.3, 1.1, 5), M.stoneD(), s * 2.3, T.y1 + 0.55, -98.5);
  L.add(b.done(0, 0, 0));
  // the bell (the clock «БОМ!» of phase 3)
  const bell = new THREE.Group();
  bell.position.copy(SPOTS.bell);
  const bm = new THREE.Mesh(new THREE.SphereGeometry(1.1, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), M.gold());
  bm.castShadow = true; bell.add(bm);
  L.deco(bell);
  L.refs.f5bell = bell;
  // the spiral of stone discs (some crumble), landings
  const crumble = new Crumble(L);
  const discG = new THREE.CylinderGeometry(SP.r, SP.r, 0.4, 20);
  for (let i = 0; i < SP.n; i++) {
    const d = discAt(i);
    const land = LANDINGS.has(i);
    const crum = !land && i > 12 && i < SP.n - 2 && i % 4 === 1 && !LANDINGS.has(i - 1) && !LANDINGS.has(i + 1);
    const g = new THREE.Group();
    g.position.set(d.x, d.y - 0.2, d.z);
    // the first steps stand on the floor as stone drums (a disc that low would be a ceiling over the floor)
    const low = d.y - TOWER.y0 < 2.6;
    const disc = new THREE.Mesh(low ? new THREE.CylinderGeometry(SP.r, SP.r, d.y - TOWER.y0, 20).translate(0, 0.2 - (d.y - TOWER.y0) / 2, 0) : discG, crum ? tmat(stoneBricksTex('#9a8a7a'), '#ffffff') : M.stone());
    disc.castShadow = true; disc.receiveShadow = true;
    g.add(disc);
    const brace = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.4, 6), M.stoneD());
    brace.position.set(Math.sin(d.a) * 1.2, -0.85, Math.cos(d.a) * 1.2); brace.rotation.x = Math.PI;
    g.add(brace);
    if (crum) { for (let k = 0; k < 3; k++) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.9), basic('#2a2030')); c.position.set(Math.cos(k * 2.1) * 0.6, 0, Math.sin(k * 2.1) * 0.6); c.rotation.y = k * 2.1; g.add(c); } }
    L.deco(g);
    const col = { kind: 'cyl' as const, x: d.x, z: d.z, r: SP.r, y0: low ? TOWER.y0 : d.y - 0.4, y1: d.y };
    L.col(col);
    if (crum) crumble.add(col, g);
    if (land) {
      // a landing: a second disc on the same height, further into the shaft (it never covers the next steps)
      for (const dr of [-2.1]) {
        const x = TOWER.x + Math.sin(d.a) * (SP.R + dr), z = TOWER.z + Math.cos(d.a) * (SP.R + dr);
        const m2 = new THREE.Mesh(discG, M.stone()); m2.position.set(x, d.y - 0.2, z); m2.castShadow = true; m2.receiveShadow = true; L.deco(m2);
        L.col({ kind: 'cyl', x, z, r: SP.r, y0: d.y - 0.4, y1: d.y });
      }
    }
  }
  const l1 = discAt(10), l2 = discAt(20), l3 = discAt(31);
  L.cp(TOWER.x - 2.8, TOWER.y0, TOWER.z + 6.2);
  L.cp(l2.x, l2.y, l2.z);
  L.signAt(TOWER.x + 2, TOWER.y0, TOWER.z + 8, F5.signs.stairs);
  vamp(L).flock(0, l1.y + 3, TOWER.z, 3);
  vamp(L).flock(0, l3.y + 2, TOWER.z, 4);
  L.enemy('fanger', l1.x, l1.y, l1.z);
  L.enemy('servant', l3.x, l3.y, l3.z);
  // the chandelier in the shaft (a secret: glide, a ring, a double jump)
  const ch = new B('f5chand');
  const cy = l2.y + 3.6;
  ch.m(new THREE.CylinderGeometry(1.5, 1.2, 0.3, 16), M.iron(), 0, -0.15, 0);
  ch.cyl(0, 0, 1.5, -0.3, 0);
  for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; ch.m(new THREE.CylinderGeometry(0.08, 0.08, 0.4, 6), new THREE.MeshToonMaterial({ color: '#f4ecd8' }), Math.cos(a) * 1.3, 0.2, Math.sin(a) * 1.3); ch.m(new THREE.ConeGeometry(0.07, 0.2, 6), basic('#ffb040'), Math.cos(a) * 1.3, 0.5, Math.sin(a) * 1.3, { glow: true }); }
  ch.m(new THREE.CylinderGeometry(0.04, 0.04, TOWER.y1 + 8 - cy, 5), M.iron(), 0, (TOWER.y1 + 8 - cy) / 2, 0, { cast: false });
  L.add(ch.done(TOWER.x, cy, TOWER.z));
  L.pick('nut', TOWER.x, cy + 0.8, TOWER.z, 'nut_f5_tower');
  addGrappleRing(L, TOWER.x + 1.6, cy + 3.4, TOWER.z);
  // the crumbs on the way up
  for (let i = 2; i < SP.n; i += 5) { const d = discAt(i); L.pick('crumb', d.x, d.y + 0.4, d.z); }
}
/** a triangular prism along z (a gable roof): circumradius r, length len, apex up */
function gable(r: number, len: number) {
  const g = new THREE.CylinderGeometry(r, r, len, 3, 1, false, Math.PI).rotateX(Math.PI / 2);
  const u = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * r / 2, u.getY(i) * len / 3);
  return g;
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// ═════════════════════════════ F — the roof ═════════════════════════════
function roof(L: Level3D) {
  const V = vamp(L);
  const b = new B('f5roof');
  const R = ROOF;
  const fl = new THREE.CylinderGeometry(R.r + 1.2, R.r + 1.6, 3, 48);
  const uv = fl.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 12, uv.getY(i));
  b.m(fl, M.stoneD(), R.x, R.y - 1.5, R.z);
  const top = new THREE.CircleGeometry(R.r + 1.2, 48).rotateX(-Math.PI / 2);
  const tuv = top.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < tuv.count; i++) tuv.setXY(i, tuv.getX(i) * 12, tuv.getY(i) * 12);
  b.m(top, M.flag(), R.x, R.y + 0.002, R.z);
  b.cyl(R.x, R.z, R.r + 1.2, R.y - 3, R.y);
  // a ring of merlons; the walls keep heroes on the roof (a gap at the south for the walk)
  const n = 52;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = R.x + Math.sin(a) * (R.r + 1.0), z = R.z + Math.cos(a) * (R.r + 1.0);
    const gap = Math.abs(wrap(a)) < 0.12;
    if (gap) continue;
    b.m(new THREE.BoxGeometry(1.4, i % 2 ? 1.0 : 1.9, 0.9), M.stone(), x, R.y + (i % 2 ? 0.5 : 0.95), z, { ry: a });
    b.cyl(x, z, 1.15, R.y, R.y + 3.2);
  }
  // the great keep under the roof (seen from outside: the roof isn't floating)
  const keep = new THREE.CylinderGeometry(R.r + 1.1, R.r + 2.4, R.y - 1, 40, 1, true);
  const kuv = keep.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < kuv.count; i++) kuv.setXY(i, kuv.getX(i) * (Math.PI * 2 * R.r) / 3, kuv.getY(i) * (R.y - 1) / 3);
  b.m(keep, M.stone(), R.x, (R.y - 3) / 2 - 0.5, R.z);
  for (const a of [0.5, 1.6, 2.6, 3.7, 4.7, 5.7]) for (const y of [14, 26]) windowAt(b, R.x + Math.sin(a) * (R.r + 1.65), y, R.z + Math.cos(a) * (R.r + 1.65), 1.3, 2.6, a, '#ff5a4a');
  // the King's merlon (north) where he waits
  block(b, M.stone(), -1.2, R.y, R.z - 18.6, 1.2, R.y + 2.2, R.z - 16.6);
  // corner turrets
  for (const a of [0.8, -0.8, 2.4, -2.4]) tower(b, R.x + Math.sin(a) * (R.r + 3), R.z + Math.cos(a) * (R.r + 3), 2.4, R.y - 12, R.y + 4, { roof: 5 });
  brazier(b, -3, R.y, R.z + 16, { h: 1.2 });
  L.add(b.done(0, 0, 0));
  const lan = [[-9, -110], [9, -110], [-9, -126], [9, -126]].map(([x, z]) => V.lantern(x, R.y, z, { r: 4.6 }));
  L.refs.f5roofLanterns = lan;
  L.cp(4.2, R.y, -102.4);
  // the cannon (Пастила waits by it: scripts / boss)
  L.refs.f5cannonAt = CANNON_AT.clone();
  // the moon glow behind the King
  const glow = new THREE.Mesh(new THREE.CircleGeometry(30, 32), basic('#ff3040', { additive: true, transparent: true, opacity: 0.08, depthWrite: false, fog: false }));
  glow.position.set(0, R.y + 25, R.z - 70); noOutline(glow); L.deco(glow);
  void archGeo; void STONE;
}

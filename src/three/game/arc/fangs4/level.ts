import * as THREE from 'three';
import * as P from '../../../world/props';
import { tmat } from '../../../world/kit';
import { glowTex } from '../../../world/textures';
import { choose } from '../../../../engine/util';
import type { Level3D, Actor3 } from '../../level';
import type { Level3Def } from '../../levels';
import { addGrappleRing } from '../../heroes';
import { vamp, isVamp } from '../vampires';
import { slab, cliff, wall, pipe, concrete, roadSign, windFlag, iceBlock, frozenFall, campfire, farMountains, boulder, flushBoulders, rockTex, rustTex, ROCK, type Campfire } from './world';
import { CrumbleBridge } from './bridge';
import { Wind } from './wind';
import { BatSwarm } from './swarm';
import { Twins } from './twins';
import { createSunStone, createFarCastle, type SunStone } from './models';
import { LINES4 } from './lines';
import './goat';

/**
 * «Чёрный перевал» (fangs4_pass) — Серия 5. The mountain road to Замок Полночь, heading north (−Z), uphill:
 *   A  the foot of the pass (spawn, intro) — rusty pipes in the rock, the old stub of a bridge («Мост на ремонте»):
 *      a 6.5 m gap to a ledge with a golden walnut (Бублик's Мост, Ноки's glide / bat, a double jump)
 *   B  chasm 1: a rope bridge that collapses behind the first hero on it (run!) · the ledges along the west wall
 *   C  chasm 2: two spans over a rock pillar, every plank drops 0.6 s after you land on it (11 m spans: Бублик's Мост)
 *      · an old concrete beam below on the east for everyone else
 *   D  the wind ridge: a 4 m knife-edge, gusts in a rhythm push you east into the chasm — concrete blocks to hide
 *      behind, rails here and there, a sheltered nook with a candle; a flyer above; a spire with a ring (Бублик)
 *   E  the cliff climb: four tiers of rock stairs up a notch (21 m), a frozen waterfall, climbing vampires, grapple
 *      rings that skip a tier (Бублик), an ice block with a walnut
 *   F  the ravine: the bat swarm chases you down to the cave (cracks, a fallen pipe, boulders)
 *   G  the cave (a candle, a «солнышко») → the ruins of the old world: a bus stop «ОСТ_НОВКА», grey goats
 *      (пресняки) to restore, a broken watchtower to climb (walnut), the courtyard ambush, «ВЫХ_Д»
 *   H  stairs up to the summit: the arena with the Солнечный камень, the twins; the campfire under a giant pipe
 */

export const F4 = {
  /** the summit arena */
  C: new THREE.Vector3(0, 20, -394), R: 15,
  /** the campfire */
  fire: new THREE.Vector3(6, 20, -405),
  ravine: { z0: -214, zCave: -300, top: 20.8 },
  YR: 14.2,
};

export interface F4Refs {
  wind: Wind; bridges: CrumbleBridge[]; swarm: BatSwarm; twins: Twins; stone: SunStone; fire: Campfire;
  /** the stone's glow 0..1 (scripts tween it; the level animates the blink) */
  stoneK: number;
}
export const f4 = (L: Level3D) => L.refs.f4 as F4Refs;

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export function fangs4Pass(): Level3Def {
  return {
    id: 'fangs4_pass', chapter: 5, title: 'Чёрный перевал', subtitle: 'Серия 5',
    music: 'pass',
    spawn: [0, 0, 7], yaw: Math.PI, killY: -42,
    bg: '#2a0d20', fog: ['#3a1028', 45, 190],
    hemi: ['#d07890', '#2c1022', 0.9], sun: { color: '#ff9e9e', intensity: 1.3, dir: [0.05, 0.42, -1] },
    startScript: 'fangs4_intro',
    castScenes: true,
    fallLimit: 9.5,
    deathText: LINES4.death.wind,
    build(L) { build(L); },
  };
}

function build(L: Level3D) {
  const Vk = vamp(L);
  Vk.nightLook({ red: 0.85, fog: [45, 190], moonDir: [0.05, 0.42, -1], dark: 0.45 });
  Vk.moon({ size: 36 });
  farMountains(L, 0, -200);
  const castle = createFarCastle();
  castle.position.set(40, 30, -760);
  L.deco(castle);

  // ═════════════ A — the foot of the pass ═════════════
  slab(L, -9, 9, 14, -28, 0, { edges: true });
  cliff(L, -24, 24, 14, 22, -30, 16);
  cliff(L, -24, -9, 14, -28, -30, 16);
  cliff(L, 9, 24, 14, -5, -30, 12);
  cliff(L, 9, 24, -17, -28, -30, 12);
  // the bones of the old world: rusty pipes out of the rock, concrete posts
  pipe(L, V(9, 4.5, -2), V(4.5, 6.5, -3), 0.55);
  pipe(L, V(-9, 2.6, -10), V(-5.8, 3.6, -11), 0.45);
  pipe(L, V(9, 3.2, -22), V(5.5, 4.2, -21), 0.7);
  pipe(L, V(-9, 7, 4), V(-6, 9.5, 3), 0.4);
  concrete(L, -6.5, 0, -2, 1.1, 3.4, 1.1, { tilt: 0.12 });
  concrete(L, 6.5, 0, -19, 1.2, 4.2, 1.2, { tilt: -0.08 });
  // the old bridge stub on the east: 6.5 m of air to a ledge (Бублик's Мост / Ноки's glide or bat / a double jump)
  slab(L, 9, 12, -8, -14, 0, { depth: 4 });
  for (const z of [-8.3, -13.7]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 2.2, 8), tmat(null, '#7a4a2c')); post.position.set(11.6, 1.1, z); post.castShadow = true; L.deco(post); }
  for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.14, 2.6), tmat(null, '#a07a4a')); b.position.set(12.5 + i * 0.9, -0.15 - i * 0.35, -11); b.rotation.z = -0.3 - i * 0.2; L.deco(b); }
  L.add(P.signpost({ x: 10.5, y: 0, z: -14.6, rotY: -Math.PI / 2, text: 'Ремонт' }));
  L.signAt(10.5, 0, -14.6, LINES4.signs.repair);
  slab(L, 18.5, 25, -5, -17, 0, { edges: true });
  cliff(L, 25, 32, -5, -17, -30, 9);
  L.pick('nut', 22, 0.7, -11, 'nut_fangs4_stub');
  L.pick('bigcrumb', 21, 0.4, -8);
  L.pick('heart', 21, 0.4, -14);
  L.crumbLine(0, 0, 2, 0, 0, -22, 6);

  // ═════════════ B — chasm 1: the collapsing bridge (z −28 … −50) ═════════════
  cliff(L, -24, -11, -28, -50, -30, 16);
  cliff(L, 11, 24, -28, -50, -30, 14);
  const b1 = new CrumbleBridge(L, 'wave', 0, -28, -50, 0, 2.6, { id: 94101, sag: 0.55 });
  // the ledges along the west wall (the way round)
  slab(L, -10.8, -7.6, -28.4, -31.5, -0.2, { depth: 6 });
  slab(L, -10.8, -7.6, -34, -37, -0.7, { depth: 6 });
  slab(L, -10.8, -7.6, -39.5, -42.5, 0.1, { depth: 6 });
  slab(L, -10.8, -7.6, -45, -48, -0.5, { depth: 6 });
  L.crumbLine(-9.2, 0, -30, -9.2, 0, -46.5, 4);

  // ═════════════ C — chasm 2: two spans over a pillar, planks drop under you (z −64 … −90) ═════════════
  slab(L, -11, 11, -50, -64, 0, { edges: true });
  cliff(L, -24, -11, -50, -90, -30, 15);
  cliff(L, 11, 24, -50, -90, -30, 13);
  L.cp(-6, 0, -57);
  L.pick('heart', 6, 0.4, -55);
  slab(L, -3, 3, -75, -79, 0, { depth: 40 });
  const b2 = new CrumbleBridge(L, 'step', 0, -64, -75, 0, 2.6, { id: 94102, sag: 0.35 });
  const b3 = new CrumbleBridge(L, 'step', 0, -79, -90, 0, 2.6, { id: 94103, sag: 0.35 });
  // the old concrete beam (east), a jump in the middle
  concrete(L, 6.9, -2.2, -70.5, 1.4, 1.0, 12, { rebar: true });
  concrete(L, 6.9, -2.2, -84.5, 1.4, 1.0, 10, { rebar: true });
  for (const z of [-64.3, -89.7]) concrete(L, 6.9, -22, z, 1.6, 19.8, 1.6, { rebar: false });
  L.crumbLine(6.9, -1.2, -66, 6.9, -1.2, -88, 5);

  // ═════════════ D — the wind ridge (z −90 … −162) ═════════════
  slab(L, -11, 11, -90, -98, 0, { edges: true });
  cliff(L, -24, -11, -90, -98, -30, 12);
  cliff(L, 11, 24, -90, -98, -30, 10);
  L.cp(-4, 0, -94);
  slab(L, -2, 2, -98, -162, 0, { depth: 40 });
  cliff(L, -36, -18, -98, -162, -40, 6);
  cliff(L, 18, 36, -98, -162, -40, 3);
  const wind = new Wind(L, V(1, 0, 0), 5.6);
  wind.zone(-8, 7, -98.5, -162, -12, 3);
  // concrete blocks on the windward edge: their lee is calm
  for (const z of [-106, -115, -123.5, -141, -149.5, -157]) {
    concrete(L, -1.35, 0, z, 1.3, 2.6, 1.8);
    wind.shelter(-0.7, 2.6, z - 1.25, z + 1.25);
  }
  // the nook with a candle (sheltered by an old wall)
  slab(L, -6.5, -2, -127.5, -134.5, 0, { depth: 40 });
  concrete(L, -6.2, 0, -131, 0.6, 3.4, 7, { rebar: true });
  wind.shelter(-6, 2.6, -127.5, -134.5);
  L.cp(-4.2, 0, -131);
  // rails on the lee edge here and there («Держитесь за поручни. Если они есть.»)
  for (const [z0, z1] of [[-98.5, -110], [-134.5, -146]] as const) {
    wall(L, 1.75, 0, z0, 2.15, 1.15, z1);
    pipe(L, V(1.95, 1.0, z0), V(1.95, 1.0, z1), 0.08);
    for (let z = z0; z >= z1; z -= 3) pipe(L, V(1.95, 0, z), V(1.95, 1.05, z), 0.06);
  }
  for (const [x, z] of [[-1.6, -100.5], [-1.7, -137.5], [-1.7, -160.5]] as const) wind.flags.push(windFlag(L, x, 0, z));
  L.enemy('flyer', 0, 7, -146, { aggro: 15, leash: 22 });
  L.crumbLine(0.6, 0, -100, 0.6, 0, -160, 10);
  // a rock spire west of the nook: two grapple rings (Бублик's paw-hook) — onto a shelf, then onto the top (a walnut)
  slab(L, -10, -6.6, -135.6, -138.6, 8, { depth: 50, path: false });
  slab(L, -6.6, -5.1, -136, -138.2, 5, { depth: 2, path: false });
  addGrappleRing(L, -5.6, 6.3, -137.1, { rope: 0 });
  addGrappleRing(L, -7.6, 10.6, -137.1, { rope: 0 });
  L.pick('nut', -8.4, 8.6, -137.1, 'nut_fangs4_spire');
  L.pick('bigcrumb', -9.2, 8.4, -136.2);
  for (const z of [-104, -120, -152]) { boulder(L, -18.5, 6, z, 1.6); boulder(L, 18.5, 3, z + 4, 1.4); }

  // ═════════════ E — the cliff climb (z −162 … −194, up to 20.8) ═════════════
  slab(L, -12, 12, -162, -182, 0, { edges: true });
  cliff(L, -26, -12, -162, -214, -30, 30);
  cliff(L, 12, 26, -162, -214, -30, 30);
  // tier 0 (west → east) on the ground, shelf 1
  climbStep(L, -10, -7.4, -182, -179.6, 0, 1.3);
  climbStep(L, -6, -3.4, -182, -179.6, 0, 2.6);
  climbStep(L, -2, 0.6, -182, -179.6, 0, 3.9);
  slab(L, -12, 12, -182, -186, 5.2, { depth: 26 });
  // tier 1 (west → east) on shelf 1, shelf 2
  climbStep(L, 2.4, 5, -186, -183.6, 5.2, 6.5);
  climbStep(L, 6.4, 9, -186, -183.6, 5.2, 7.8);
  climbStep(L, 10.4, 12, -186, -183.6, 5.2, 9.1);
  slab(L, -12, 12, -186, -190, 10.4, { depth: 26 });
  // tier 2 (east → west) on shelf 2 — ice, shelf 3
  iceBlock(L, 7, 9.6, -190, -187.6, 10.4, 11.7);
  iceBlock(L, 3, 5.6, -190, -187.6, 10.4, 13.0);
  climbStep(L, -1, 1.6, -190, -187.6, 10.4, 14.3);
  slab(L, -12, 12, -190, -194, 15.6, { depth: 26 });
  // tier 3 (east → west) on shelf 3, the plateau
  climbStep(L, -4.4, -1.8, -194, -191.6, 15.6, 16.9);
  climbStep(L, -8.4, -5.8, -194, -191.6, 15.6, 18.2);
  climbStep(L, -12, -9.8, -194, -191.6, 15.6, 19.5);
  slab(L, -12, 12, -194, -214, 20.8, { depth: 30, edges: true });
  // the frozen waterfall on the west wall + the ice block with a walnut (drop onto it from tier 3)
  frozenFall(L, -12.4, -187, 0, 27, 3.2);
  iceBlock(L, -12, -9.4, -190, -186.4, 10.4, 13.2);
  L.pick('nut', -10.7, 13.9, -188.2, 'nut_fangs4_ice');
  // grapple rings that skip a tier (Бублик)
  // (just over the next shelf's edge: seen from the front of the shelf below)
  addGrappleRing(L, 0, 12.6, -186.6, { rope: 0.8 });
  addGrappleRing(L, -6, 17.8, -190.6, { rope: 0.8 });
  addGrappleRing(L, 6, 23.0, -194.6, { rope: 0.8 });
  // climbing vampires on the shelves
  L.enemy('fanger', -5, 5.2, -184.2, { aggro: 9, leash: 7 });
  L.enemy('fanger', 2, 10.4, -186.8, { aggro: 9, leash: 6 });
  L.enemy('fanger', 6, 15.6, -190.8, { aggro: 9, leash: 6 });
  L.crumbLine(-8.7, 1.3, -180.8, -0.7, 3.9, -180.8, 3);
  L.crumbLine(3.7, 6.5, -184.8, 11.2, 9.1, -184.8, 3);
  L.pick('heart', 10, 10.8, -188);
  pipe(L, V(-12, 8, -183.5), V(-8.8, 9.2, -184), 0.45);
  pipe(L, V(12, 14, -188), V(9.4, 15.6, -188.5), 0.5);
  L.cp(6, 20.8, -204);

  // ═════════════ F — the ravine (the bat swarm), z −214 … −300 ═════════════
  const R0 = F4.ravine;
  cliff(L, -12, -3.5, -214, -222, 20.8, 34);
  cliff(L, 3.5, 12, -214, -222, 20.8, 34);
  cliff(L, -12, -3.5, -222, -300, 4, 34);
  cliff(L, 3.5, 12, -222, -300, 4, 34);
  slab(L, -3.5, 3.5, -222, -300, 6, { depth: 8, path: false });
  const floor: [number, number, number][] = [[-214, -224, 20.8], [-224, -232, 20.1], [-232, -243, 19.4], [-246, -256, 18.7], [-256, -264, 18.0], [-264, -274, 17.3], [-276.5, -286, 16.6], [-286, -293, 15.8], [-293, -300.5, 15.0]];
  for (const [z0, z1, y] of floor) slab(L, -3.5, 3.5, z0, z1, y, { depth: 1.2 + (y - 6) * 0 + 6 });
  ravineRock(L, -3.5, 0.3, -226, -228, 20.1, 1.0);
  pipe(L, V(-3.6, 19.85, -237.5), V(3.6, 19.85, -237.5), 0.45, true);
  ravineRock(L, -3.5, -1, -250, -252.5, 18.7, 1.5);
  ravineRock(L, 1, 3.5, -250, -252.5, 18.7, 1.5);
  pipe(L, V(-3.6, 18.45, -260.5), V(3.6, 18.45, -260.5), 0.45, true);
  ravineRock(L, 0.5, 3.5, -268, -270, 17.3, 1.0);
  ravineRock(L, -3.5, -0.5, -280, -282, 16.6, 1.2);
  ravineRock(L, 0.5, 3.5, -283.5, -285.5, 16.6, 1.2);
  pipe(L, V(-3.6, 16.25, -290), V(3.6, 16.25, -290), 0.42, true);
  L.crumbLine(0, 20.8, -216, 0, 19.4, -241, 6);
  L.crumbLine(0, 18.0, -258, 0, 15.8, -291, 7);
  const swarm = new BatSwarm(L, R0.z0, R0.zCave, 0, 3.5, R0.top);

  // ═════════════ G — the cave, the ruins, the courtyard ambush (y 14.2) ═════════════
  const YR = F4.YR;
  slab(L, -3, 3, -300.5, -318, YR, { depth: 10 });
  cliff(L, -12, -3, -300, -318, YR - 10, 24);
  cliff(L, 3, 12, -300, -318, YR - 10, 24);
  cliff(L, -3, 3, -300.5, -316, YR + 4.4, 24);
  // the cave mouth (narrow)
  cliff(L, -3.5, -1.9, -299.5, -301.5, YR, YR + 5);
  cliff(L, 1.9, 3.5, -299.5, -301.5, YR, YR + 5);
  L.cp(-1.5, YR, -311);
  Vk.lantern(1.9, YR, -308, { r: 4.5, h: 2.0 });
  // the ruins
  slab(L, -18, 18, -318, -344, YR, { edges: true });
  cliff(L, -28, -18, -316, -372, YR - 20, 30);
  cliff(L, 18, 28, -316, -372, YR - 20, 30);
  cliff(L, -18, -3, -316, -318, YR, 26);
  cliff(L, 3, 18, -316, -318, YR, 26);
  busStop(L, -11, YR, -325);
  roadSign(L, -8.2, YR, -323.2, LINES4.signs.stop, LINES4.signs.stopTip, 0.3);
  roadSign(L, 12, YR, -321.5, LINES4.signs.rockfall, LINES4.signs.rockfallTip, -0.4, { color: '#c8901a' });
  for (const [x, z, s] of [[14, -320, 1.4], [15.5, -322.5, 1.0], [13, -324, 0.8], [16, -326, 1.2], [-15, -340, 1.3], [-16, -337, 0.9]] as const) boulder(L, x, YR, z, s);
  concrete(L, 4, YR, -321, 3, 1.1, 1.2, { tilt: 0.05 });
  concrete(L, -5, YR, -341, 2.4, 1.6, 1.2);
  pipe(L, V(-18, YR + 2.2, -330), V(-13, YR + 0.5, -332), 0.9);
  watchtower(L, 12.5, YR, -338);
  Vk.greyZone('ruins', [0, YR, -331], 15, { auto: 'clear' });
  for (const [x, z] of [[-8, -330], [6, -327], [-3, -338], [9, -333]] as const) L.enemy('goat', x, YR, z);
  L.enemy('fanger', 7, YR, -339, { aggro: 11 });
  L.enemy('fanger', -12, YR, -334, { aggro: 11 });
  Vk.flock(0, YR + 4.5, -336, 3);
  L.crumbLine(-2, YR, -320, 2, YR, -342, 5);
  L.trigger(-18, YR - 1, -322, 18, YR + 6, -318.5, 'fangs4_ruins');
  // the courtyard (the only way on): broken walls, an ambush ring, «ВЫХ_Д»
  slab(L, -9, 9, -344, -363, YR);
  cliff(L, -18, -9, -344, -372, YR - 20, 30);
  cliff(L, 9, 18, -344, -372, YR - 20, 30);
  for (const [x0, x1] of [[-9, -2.2], [2.2, 9]] as const) {
    concrete(L, (x0 + x1) / 2, YR, -344.5, x1 - x0, 2.2, 0.9, { rebar: true });
    concrete(L, (x0 + x1) / 2, YR, -362.5, x1 - x0, 4.2, 0.9, { rebar: true });
  }
  roadSign(L, 3.2, YR, -361.6, LINES4.signs.exit, LINES4.signs.exitTip, Math.PI, { w: 1.6, color: '#2a8a4a' });
  L.arena(0, YR, -353, 8, [
    [{ kind: 'fanger', x: -4, y: YR, z: -351 }, { kind: 'fanger', x: 4, y: YR, z: -351 }, { kind: 'fanger', x: 0, y: YR, z: -357 }],
    [{ kind: 'bat', x: -3, y: YR + 3, z: -355 }, { kind: 'bat', x: 3, y: YR + 3, z: -355 }, { kind: 'flyer', x: 0, y: YR + 6, z: -354 }, { kind: 'fanger', x: 0, y: YR, z: -349 }],
    [{ kind: 'brute', x: 0, y: YR, z: -356 }, { kind: 'fanger', x: -5, y: YR, z: -352 }, { kind: 'fanger', x: 5, y: YR, z: -352 }],
  ], [{ kind: 'honey', x: 0, y: YR + 0.6, z: -353 }, { kind: 'heart', x: 1.5, y: YR + 0.6, z: -353 }], 2);

  // ═════════════ H — stairs to the summit, the arena (y 20), the campfire ═════════════
  for (const [z0, z1, y] of [[-363, -366, YR + 1.2], [-366, -369, YR + 2.4], [-369, -372, YR + 3.6], [-372, -375, YR + 4.8]] as const) slab(L, -4, 4, z0, z1, y, { depth: 8 });
  slab(L, -4, 4, -375, -380, 20, { depth: 12 });
  cliff(L, -18, -4, -363, -380, YR, 26);
  cliff(L, 4, 18, -363, -380, YR, 26);
  L.cp(-2.4, 20, -377);
  L.pick('heart', 2.4, 20.4, -377.5);
  // the summit disc
  const C = F4.C;
  L.col({ kind: 'cyl', x: C.x, z: C.z, r: F4.R, y0: C.y - 30, y1: C.y });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(F4.R, F4.R * 0.75, 30, 40), [tmat(rockTex(), ROCK), tmat(rockTex(), '#8a7c94'), tmat(rockTex(), ROCK)]);
  disc.position.set(C.x, C.y - 15, C.z); disc.receiveShadow = true; disc.castShadow = true;
  L.deco(disc);
  const rim = new THREE.Mesh(new THREE.RingGeometry(F4.R - 1.4, F4.R, 48).rotateX(-Math.PI / 2), tmat(null, '#5a4e68'));
  rim.position.set(C.x, C.y + 0.02, C.z); L.deco(rim);
  // ruined columns round the rim (not on the way in, not by the fire)
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.31;
    const x = C.x + Math.cos(a) * 13.3, z = C.z + Math.sin(a) * 13.3;
    if (z > C.z + 9 && Math.abs(x) < 6) continue;
    if (x > 2 && z < C.z - 8) continue;
    concrete(L, x, C.y, z, 1.3, 2 + ((i * 37) % 5), 1.3, { rebar: true });
  }
  // the Солнечный камень (an old traffic light on a stump)
  const stone = createSunStone(glowTex());
  stone.root.position.copy(C);
  L.deco(stone.root);
  L.col({ kind: 'box', min: V(C.x - 0.95, C.y, C.z - 0.9), max: V(C.x + 0.95, C.y + 3.0, C.z + 0.9) });
  L.signAt(C.x, C.y, C.z + 1.9, LINES4.signs.stone);
  Vk.greyZone('summit', [C.x, C.y, C.z], 19, { auto: 'none' });
  L.trigger(-5, C.y - 2, -381.5, 5, C.y + 6, -379.2, 'fangs4_boss_intro');
  // the campfire under a giant rusty pipe on the north rim, looking out at the castle
  slab(L, 2.4, 9.8, -400, -413, 20, { depth: 12, path: false });
  const big = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.3, 9, 24, 1, true), tmat(rustTex(), '#ffffff', { side: THREE.DoubleSide }));
  big.rotation.x = Math.PI / 2; big.position.set(F4.fire.x, 20.6, F4.fire.z - 1); big.castShadow = true; big.receiveShadow = true;
  L.deco(big);
  for (const s of [-1, 1]) wall(L, F4.fire.x + s * 3.3 - 0.25, 20, -410.5, F4.fire.x + s * 3.3 + 0.25, 23.5, -401.5);
  const fire = campfire(L, F4.fire.x, 20, F4.fire.z);
  boulder(L, F4.fire.x + 2, 20.1, F4.fire.z - 4.3, 0.55);

  flushBoulders(L);

  // climbers and the swarm bark (8.2.4): a hunting vampire near a hero calls out now and then (host; replayed)
  let barkT = 4;
  const climbers: Actor3 = {
    update(L2, dt) {
      if (!L2.authority || (barkT -= dt) > 0) return;
      barkT = 5 + Math.random() * 4;
      const hs = L2.alivePlayers();
      const e = L2.enemies.find((x) => !x.dead && isVamp(x) && (x as { hunting?: boolean }).hunting && x.kind !== 'bat' && hs.some((h) => h.pos.distanceTo(x.body.pos) < 16));
      if (e) L2.bark(e.root, choose(LINES4.climber as unknown as string[]), 1.6, 1.6);
    },
  };
  L.actors.push(climbers);

  const twins = new Twins(L, C, F4.R);
  const refs: F4Refs = { wind, bridges: [b1, b2, b3], swarm, twins, stone, fire, stoneK: 0 };
  L.refs.f4 = refs;
  // the stone blinks yellow once it glows («мигал жёлтым, чтобы все были осторожны»)
  L.updaters.push((t) => { const k = refs.stoneK; stone.set(k, k > 0 ? (Math.sin(t * 3.2) > 0 ? 1 : 0.35) : 0); });
}

/** one rock step of the climb (a pillar from `base` up to `top`) */
function climbStep(L: Level3D, x0: number, x1: number, z0: number, z1: number, base: number, top: number) {
  slab(L, x0, x1, z0, z1, top, { depth: top - base + 0.02 });
}
/** a boulder block in the ravine (solid) */
function ravineRock(L: Level3D, x0: number, x1: number, z0: number, z1: number, y: number, h: number) {
  slab(L, x0, x1, z0, z1, y + h, { depth: h + 0.1, path: false });
  boulder(L, (x0 + x1) / 2, y + h * 0.3, (z0 + z1) / 2, Math.min(Math.abs(x1 - x0), Math.abs(z1 - z0)) * 0.55);
}

/** an old-world bus stop: a back wall, a roof, a bench (the «ОСТ_НОВКА» sign stands beside it) */
function busStop(L: Level3D, x: number, y: number, z: number) {
  concrete(L, x, y, z - 1.1, 4.6, 2.6, 0.3, { rebar: false });
  concrete(L, x - 2.2, y, z, 0.25, 2.6, 2.4, { rebar: false });
  const roof = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.2, 2.8), tmat(rustTex(), '#ffffff'));
  roof.position.set(x, y + 2.7, z - 0.1); roof.rotation.z = 0.06; roof.castShadow = true; L.deco(roof);
  const bench = new THREE.Mesh(new THREE.BoxGeometry(3, 0.15, 0.6), tmat(null, '#8a5a3a'));
  bench.position.set(x + 0.2, y + 0.55, z - 0.6); L.deco(bench);
  L.col({ kind: 'box', min: V(x - 1.3, y, z - 0.9), max: V(x + 1.7, y + 0.6, z - 0.3) });
}

/** the broken watchtower: a concrete drum with rubble stairs round it, a walnut on top */
function watchtower(L: Level3D, x: number, y: number, z: number) {
  const r = 2.3, h = 7.2;
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.08, h, 14), tmat(rockTex(), '#a8a0a0'));
  drum.position.set(x, y + h / 2, z); drum.castShadow = true; drum.receiveShadow = true;
  L.deco(drum);
  L.col({ kind: 'cyl', x, z, r, y0: y, y1: y + h });
  // the broken crown
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; if (i === 2) continue; concrete(L, x + Math.cos(a) * (r - 0.3), y + h, z + Math.sin(a) * (r - 0.3), 0.8, 0.6 + (i % 2) * 0.5, 0.8, { rebar: i % 2 === 0, solid: false }); }
  // rubble steps spiralling up (1.2 m each)
  const steps = 6;
  for (let i = 0; i < steps; i++) {
    const a = Math.PI * 0.95 + i * 0.95;
    const cx = x + Math.cos(a) * (r + 1.0), cz = z + Math.sin(a) * (r + 1.0);
    const top = y + 1.2 * (i + 1);
    slab(L, cx - 0.95, cx + 0.95, cz - 0.95, cz + 0.95, top, { depth: top - y + 0.02, path: false, color: '#8a8290' });
  }
  L.pick('nut', x, y + h + 0.7, z, 'nut_fangs4_tower');
  L.pick('bigcrumb', x + 0.8, y + h + 0.5, z + 0.6);
  void choose;
}

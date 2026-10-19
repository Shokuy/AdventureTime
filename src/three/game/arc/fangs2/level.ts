import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { mat, matU, basic, noOutline } from '../../../gfx';
import { glowTex } from '../../../world/textures';
import { G, damp, clamp } from '../../../models/kit';
import type { Level3D, Npc3, LevelPlugin } from '../../level';
import type { Level3Def } from '../../levels';
import type { HeroAnim } from '../../../models/hero';
import { addGrappleRing } from '../../heroes';
import { vamp, markCharacter } from '../vampires';
import { SwampKit, SinkPlank, Raft, FireflySwarm, FireflyJar, Drawbridge, FIREFLY_LIGHT_R } from './props';
import { Morok3, ARENA } from './boss';
import { createSvetlyachikha, type GlowRig } from './models';
import { frogBarks } from './enemies';
import { talkingNow } from './speech';
import { SIGNS, TOASTS, SQUAD, DEATH, FROG_BRIDGE } from './lines';

/**
 * «Туманные топи» (series 3, `fangs2_swamp`) — the level. North (−z) from Камыш's pier:
 *   A  the pier (spawn, intro)            B  rotten boardwalk: sinking planks, an island with ghouls, a broken walk
 *   C  Камыш's ferry across the pond      D  Деревня Ква on stilts: a grey zone — restore the frogs, the bridge lowers
 *   E  the mist: stepping stones (real fireflies blink, wisps lie), an ambush on a clearing, the fork (the fake Бублик)
 *   F  Дом Мадам Морок: the veranda arena (boss), the ending, Камыш's boat home (the exit).
 * Every required jump is ≤ 2.5 m and ≤ 0.4 m up (any hero, alone). Abilities open secrets: Бублик's grapple ring to a
 * willow nest, a 6 m gap (Бублик's bridge, Ноки's glide, a double jump + dash).
 */

/** marks the scenes and the arena use */
export const MARK = {
  spawn: new THREE.Vector3(0, 1.0, 67),
  pierCast: new THREE.Vector3(0, 1.0, 62),
  fork: new THREE.Vector3(-3, 0.7, -131),
  fakeHummock: new THREE.Vector3(-10.5, 0.75, -135),
  veranda: new THREE.Vector3(-8, ARENA.y, -154.6),
  chair: new THREE.Vector3(-8, ARENA.y, -166.2),
  bottle: new THREE.Vector3(-8, ARENA.y, -174.5),
  exitBoat: new THREE.Vector3(6.2, 0.75, -157),
};

export interface SwampRefs {
  kit: SwampKit;
  boss: Morok3;
  bridge: Drawbridge;
  cast: Record<'tosha' | 'bublik' | 'noki' | 'pastila', Npc3>;
  mother: GlowRig;
  motherG: THREE.Group;
  bottle: THREE.Group;
  jars: THREE.InstancedMesh;
  jarGlow: THREE.Points;
  houseSwarm: FireflySwarm;
  ferry: Raft;
}
export const swampOf = (L: Level3D) => L.refs.fangs2 as SwampRefs | undefined;

export function fangs2Level(): Level3Def {
  return {
    id: 'fangs2_swamp', chapter: 0, title: 'Туманные топи', subtitle: 'Серия 3',
    music: 'swamp',
    spawn: [MARK.spawn.x, MARK.spawn.y, MARK.spawn.z], yaw: Math.PI, killY: -6,
    bg: '#0f1a1c', fog: ['#1a2a2a', 16, 70],
    hemi: ['#7d9cb0', '#22301e', 0.9], sun: { color: '#c4d0ff', intensity: 1.4, dir: [-0.45, 0.62, -0.65] },
    startScript: 'fangs2_intro',
    castScenes: true,
    deathText: DEATH.bog,
    build: buildSwamp,
  };
}

function buildSwamp(L: Level3D) {
  const V = vamp(L);
  V.nightLook({ red: 0.5, fog: [16, 70], dark: 0.55 });
  V.moon({ size: 32 });
  const S = new SwampKit(L, 7);
  L.refs.swamp = S;
  S.water(-90, -240, 100, 120);
  S.castle(new THREE.Vector3(-0.45, 0, -0.65));

  // ═══════════ A. the pier ═══════════
  S.deck(-5, 56, 5, 72, 1.0, { alongX: true });
  S.rail(-5, 72, 5, 72, 1.0);
  S.rail(5, 56, 5, 72, 1.0);
  S.sign(-3.6, 1.0, 64, SIGNS.wasLight, Math.PI / 2);
  L.cp(3.2, 1.0, 59);
  // a mooring post with an empty lantern
  const moor = new THREE.Mesh(G.cyl(), S.bark); moor.position.set(-4.6, 1.6, 58); moor.scale.set(0.16, 3.2, 0.16); L.deco(moor);
  S.island(-10, 66, 3, 0.7); S.willow(-10.5, 66.5, 0.7, 1.1);
  S.island(10, 71, 2.6, 0.7); S.willow(10.2, 71.3, 0.7, 0.9);
  S.reeds(0, 64, 9.5, 40, 1.0);
  S.pads(-12, 56, 6, 22); S.pads(12, 58, 6, 18);
  S.hut(-24, 30, 1.0, { yaw: 0.7, wall: '#5a4a3a', glow: '#8a7a50' });
  S.deck(-28, 26, -20, 34, 1.0);

  // ═══════════ B. the rotten boardwalk ═══════════
  S.walk(0, 56, 0, 44, 1.0, 2.2);
  for (const [x, z] of [[0, 41.0], [0.6, 38.4], [-0.4, 35.8], [0.3, 33.2]] as const) new SinkPlank(S, x, z, 2.0, 1.8, 0.75);
  S.island(0, 27, 4.5, 0.7, { mush: 3 });
  S.willow(-2.6, 28.6, 0.7, 1.0);
  L.enemy('ghoul', 1.6, 0.7, 24.2);
  L.enemy('ghoul', -2.2, 0.7, 25.0);
  L.breakable('crate', 3.0, 0.7, 29.2);
  // broken walk east, then north
  S.walk(4, 27, 9, 27, 1.0, 2.2);
  S.walk(11.2, 27, 15.2, 27, 1.0, 2.2);
  S.deck(17.4, 24, 24, 30, 1.0);
  L.enemy('ghoul', 21.5, 1.0, 28);
  S.walk(21, 24, 21, 17, 1.0, 2.2);
  S.walk(21, 14.8, 21, 9, 1.0, 2.2);
  S.walk(21, 6.8, 21, 2, 1.0, 2.2);
  V.flock(21, 4.2, 12, 4);
  S.pads(14, 10, 5, 16); S.reeds(26, 15, 3, 18); S.reeds(15, 22, 2, 12);
  // the first jar: its fireflies light the broken walk
  new FireflyJar(S, 2.6, 0.7, 25.2, [new THREE.Vector3(10.1, 1.2, 27), new THREE.Vector3(21, 1.2, 20), new THREE.Vector3(21, 1.2, 8)], 'f2jar1');
  // secret: a walkway in the willows (Бублик's grapple ring at its near end flings him along it)
  S.island(12, 16, 2.3, 0.7);
  S.willow(11.6, 15.2, 0.7, 1.15);
  S.willow(7.4, 16.8, 0, 1.1);
  S.deck(6.4, 14.6, 14.4, 17.6, 5.4, { stilts: false, th: 0.3 });
  S.rail(6.4, 14.6, 14.4, 14.6, 5.4, 0.6); S.rail(6.4, 17.6, 14.4, 17.6, 5.4, 0.6);
  addGrappleRing(L, 14.4, 7.1, 16.1);
  L.pick('nut', 7.4, 5.9, 16.1, 'nut_fangs2_nest');
  L.crumbLine(13.2, 5.4, 16.1, 8.6, 5.4, 16.1, 5);
  // willows and decor along the walk
  for (const [x, z, s] of [[-7, 48, 1], [6.5, 40, 0.9], [-6.5, 33, 1.2], [8, 21, 1], [27, 22, 1.1], [15, 4, 1], [28, 6, 0.9], [-12, 18, 1.3]] as const) S.willow(x, z, 0, s);
  S.mistBank(0, 40, 22, 14, { opacity: 0.22 });
  S.mistBank(18, 12, 16, 10, { opacity: 0.22 });

  // ═══════════ C. the ferry dock and the pond ═══════════
  S.deck(15, -10, 27, 2, 1.0);
  S.rail(27, -10, 27, 2, 1.0);
  L.cp(24, 1.0, -2);
  S.sign(25.5, 1.0, 0.6, SIGNS.ferry, -Math.PI / 2);
  V.lantern(16.2, 1.0, -8.6, { r: 4.5 });
  new FireflyJar(S, 17.2, 1.0, -1.2, [new THREE.Vector3(20, 1.2, -22), new THREE.Vector3(20, 1.2, -36)], 'f2jar2');
  L.breakable('jar', 26, 1.0, -9);
  const ferry = new Raft(S, [new THREE.Vector3(21, 0, -12.8), new THREE.Vector3(19, 0, -29.5), new THREE.Vector3(21, 0, -46.3)], { r: 2.6, top: 0.75, dwell: 5.5, travel: 12, ferry: true });
  V.flock(17, 4.6, -30, 5);
  L.enemy('flyer', 27, 6.5, -33);
  S.pads(8, -28, 8, 30); S.pads(32, -24, 7, 24);
  for (const [x, z, s] of [[6, -14, 1.2], [34, -12, 1], [4, -40, 1.1], [36, -44, 1.2], [10, -30, 0.9]] as const) { S.island(x, z, 2, 0.4, { grass: 2 }); S.willow(x, z, 0.4, s); }
  S.mistBank(20, -28, 18, 18, { opacity: 0.26 });
  S.hut(42, 4, 1.0, { yaw: -1.2, glow: '#7a6a48' }); S.deck(38, 0, 46, 8, 1.0);

  // ═══════════ D. Деревня Ква ═══════════
  S.deck(16, -56, 26, -49.2, 1.0);
  S.deck(10, -74, 30, -56, 1.2, { alongX: false });
  // huts round the plaza
  S.deck(-4, -68, 4, -60, 1.2); S.walk(4, -64, 10, -64, 1.2, 2.2); S.hut(-0.2, -64, 1.2, { yaw: Math.PI / 2, wall: '#6a5a44' });
  S.deck(36, -68, 44, -60, 1.2); S.walk(30, -64, 36, -64, 1.2, 2.2); S.hut(40.2, -64, 1.2, { yaw: -Math.PI / 2, wall: '#5e5040' });
  S.deck(4, -84, 14, -74, 1.2); S.hut(7.8, -80, 1.2, { yaw: 0.4, w: 3.6, d: 3.6, wall: '#665238' });
  S.deck(26, -84, 36, -74, 1.2); S.hut(32.2, -80, 1.2, { yaw: -0.4, w: 3.6, d: 3.6, wall: '#5a4a36' });
  S.rail(10, -56, 16, -56, 1.2); S.rail(26, -56, 30, -56, 1.2);
  S.rail(14, -74, 18.6, -74, 1.2); S.rail(21.4, -74, 26, -74, 1.2);
  // the plaza's pole of empty jars
  const pole = new THREE.Mesh(G.cyl(), S.bark); pole.position.set(20, 3.2, -65); pole.scale.set(0.2, 4, 0.2); L.deco(pole);
  L.col({ kind: 'cyl', x: 20, z: -65, r: 0.25, y0: 1.2, y1: 5.2 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const j = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.4, 10), matU('#9ab0a8', { transparent: true, opacity: 0.45 }));
    j.position.set(20 + Math.cos(a) * 0.7, 4.3, -65 + Math.sin(a) * 0.7); L.deco(j);
  }
  V.greyZone('village', [20, 0, -66], 25, { edge: 5, auto: 'clear' });
  V.lantern(13, 1.2, -71.5, { r: 4.8 });
  V.lantern(27.5, 1.2, -58.5, { r: 4.8 });
  L.cp(22.5, 1.2, -57.5);
  for (const [x, z] of [[14.5, -59.5], [25, -70.5], [-2.6, -61.2], [42.4, -66.6], [11.6, -77.4], [28.6, -77.4], [18, -69]] as const) L.enemy('frogfolk', x, 1.2, z, { yaw: Math.random() * 6 });
  L.enemy('bloodfrog', 17, 1.2, -63);
  L.enemy('bloodfrog', 24, 1.2, -60);
  L.enemy('bloodfrog', 28, 1.2, -76.2);
  L.enemy('ghoul', 2.5, 1.2, -61.5);
  L.enemy('ghoul', 38.5, 1.2, -66.5);
  L.enemy('brute', 21, 1.2, -68, { aggro: 9 });
  L.breakable('crate', 1, 1.2, -67); L.breakable('jar', 43, 1.2, -61); L.breakable('crate', 12.5, 1.2, -82.5);
  L.pick('nut', 34.6, 1.6, -82.8, 'nut_fangs2_village');
  S.reeds(20, -65, 26, 60, 3);
  S.pads(20, -90, 14, 30);
  for (const [x, z, s] of [[-8, -52, 1.2], [48, -54, 1.1], [-10, -80, 1], [50, -78, 1.2]] as const) S.willow(x, z, 0, s);
  S.mistBank(20, -66, 30, 14, { opacity: 0.2 });
  const bridge = new Drawbridge(S, 20, -74, -83.9, 1.2, 2.6);
  if (V.zone('village')?.done) bridge.lower(true);
  V.onZone((id) => {
    if (id !== 'village') return;
    bridge.lower();
    L.hud.toast(TOASTS.bridge, 4);
    const frog = L.actors.find((a) => (a as unknown as { root?: THREE.Object3D }).root?.getObjectByName?.('frogfolk')) as unknown as { root: THREE.Object3D } | undefined;
    if (frog) L.bark(frog.root, FROG_BRIDGE, 2.2, 1.4);
    audio.sfx('door', { pitch: 0.7 });
  });

  // ═══════════ E. the mist ═══════════
  S.island(20, -87.5, 4, 0.7, { mush: 3 });
  S.sign(17.4, 0.7, -86, SIGNS.wisps, Math.PI / 2);
  new FireflyJar(S, 22.6, 0.7, -89.6, [new THREE.Vector3(14, 1.0, -97), new THREE.Vector3(8, 1.0, -104), new THREE.Vector3(2, 1.0, -114)], 'f2jar3');
  const stones: [number, number, number][] = [[16.5, -93, 1.5], [14, -97, 1.4], [11.5, -101, 1.5], [8, -104, 1.6], [5.5, -107.5, 1.4]];
  for (const [x, z, r] of stones) { S.island(x, z, r, 0.65, { grass: 1 }); new FireflySwarm(L, new THREE.Vector3(x, 0.65, z), 0.8, 5, { height: 1.2, size: 0.32 }); }
  L.cp(5.5, 0.65, -107.5);
  for (const [x, z] of [[24.5, -96.5], [19.5, -103], [14.5, -108.5], [3.5, -98.5]] as const) L.enemy('wisp', x, 1.6, z);
  // the clearing (ambush)
  S.island(2, -116, 8.5, 0.7, { mush: 5 });
  S.willow(-4.6, -110.5, 0.7, 1.2);
  S.willow(8.4, -121.5, 0.7, 1.0);
  L.arena(2, 0.7, -116, 7.5, [
    [{ kind: 'ghoul', x: -1, y: 0.7, z: -112.5 }, { kind: 'ghoul', x: 5, y: 0.7, z: -119 }, { kind: 'bloodfrog', x: 2, y: 0.7, z: -111 }],
    [{ kind: 'mist', x: -2, y: 0.7, z: -118 }, { kind: 'bloodfrog', x: 6, y: 0.7, z: -113 }, { kind: 'ghoul', x: 0, y: 0.7, z: -120.5 }],
    [{ kind: 'brute', x: 2, y: 0.7, z: -116 }, { kind: 'bloodfrog', x: -3, y: 0.7, z: -115 }],
  ], [{ kind: 'honey', x: 2, y: 1.3, z: -116 }]);
  // the log walk to the fork
  S.walk(-2, -123, -2, -128.4, 0.85, 2.2);
  S.island(-3, -132, 4, 0.7, { mush: 2 });
  S.island(MARK.fakeHummock.x, MARK.fakeHummock.z, 1.1, 0.75, { grass: 2 });
  L.trigger(-7, 0, -134.5, 1, 3, -129, 'fangs2_fake');
  L.enemy('mist', -0.5, 0.7, -134.5);
  L.enemy('mist', -5.5, 0.7, -129.6);
  // secret island west of the fork: a 6 m gap (Бублик's bridge, Ноки's glide, a double jump + dash)
  S.island(-14.5, -127.5, 2.4, 0.7, { mush: 2 });
  L.pick('nut', -14.5, 1.3, -127.5, 'nut_fangs2_island');
  L.crumbRing(-14.5, 0.7, -127.5, 1.4, 6);
  // Ноки's launch stump (north-west of the fork: a step, the stump, then glide to the secret island)
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.85, 2.0, 12), S.bark); stump.position.set(-5.6, 1.7, -129.4); L.deco(stump);
  L.col({ kind: 'cyl', x: -5.6, z: -129.4, r: 0.7, y0: 0.7, y1: 2.7 });
  L.add({ obj: new THREE.Group(), colliders: [{ kind: 'box', min: new THREE.Vector3(-4.6, 0.7, -130.6), max: new THREE.Vector3(-3.6, 1.7, -129.6) }] });
  const step = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), S.bark); step.position.set(-4.1, 1.2, -130.1); L.deco(step);
  L.refs.f2stump = [stump, step];
  // on to the house
  for (const [x, z, r] of [[-4, -138.2, 1.5], [-7, -141.8, 1.5]] as const) { S.island(x, z, r, 0.65, { grass: 1 }); new FireflySwarm(L, new THREE.Vector3(x, 0.65, z), 0.8, 5, { height: 1.2, size: 0.32 }); }
  for (const [x, z] of [[-12, -137.5], [3.5, -140], [-11.5, -125.5], [-1, -146]] as const) L.enemy('wisp', x, 1.6, z);
  S.walk(-8, -148.5, -8, -144, 1.0, 2.2);
  S.walk(-8, -153, -8, -148.5, 1.2, 2.2);
  L.cp(-8, 1.0, -145.4);
  S.mistBank(10, -105, 24, 34, { opacity: 0.2, size: 9, y: 0.7 });
  S.mistBank(-4, -135, 18, 24, { opacity: 0.2, size: 9, y: 0.7 });
  for (const [x, z, s] of [[24, -110, 1.2], [-8, -100, 1.1], [16, -124, 1], [-16, -118, 1.3], [8, -138, 1], [-18, -145, 1.2], [6, -150, 1]] as const) S.willow(x, z, 0, s);
  S.reeds(4, -115, 11, 50, 2.5); S.reeds(-4, -136, 7, 30, 2);
  S.pads(-10, -110, 8, 20); S.pads(14, -132, 8, 20);

  // ═══════════ F. Дом Мадам Морок ═══════════
  const x0 = ARENA.cx - ARENA.hx - 0.8, x1 = ARENA.cx + ARENA.hx + 0.8, z0 = ARENA.cz - ARENA.hz - 0.4, z1 = ARENA.cz + ARENA.hz + 0.8;
  S.deck(x0, z0, x1, z1, ARENA.y, { th: 0.4 });
  S.rail(x0, z1, -10.2, z1, ARENA.y); S.rail(-5.8, z1, x1, z1, ARENA.y);
  S.rail(x0, z0, x0, z1, ARENA.y);
  S.rail(x1, z0, x1, -159.6, ARENA.y); S.rail(x1, -154.6, x1, z1, ARENA.y);
  S.sign(-11.2, 1.2, -150.6, SIGNS.house, Math.PI / 2);
  V.lantern(ARENA.cx - ARENA.hx + 0.6, ARENA.y, ARENA.cz + 2, { r: 4.6 });
  V.lantern(ARENA.cx + ARENA.hx - 0.6, ARENA.y, ARENA.cz - 3, { r: 4.6 });
  V.greyZone('house', [-8, 0, -170], 22, { edge: 7, auto: 'none', amount: 0.7 });
  const house = buildHouse(L, S, x0, x1, z0);
  L.trigger(-10, 0, -154.5, -6, 4, -150, 'fangs2_boss_intro');
  for (const [x, z, s] of [[-26, -158, 1.3], [10, -168, 1.2], [-24, -176, 1.1], [8, -184, 1.3], [-30, -140, 1.2]] as const) S.willow(x, z, 0, s);
  S.reeds(-8, -162, 18, 70, 3);
  S.pads(-8, -150, 18, 30); S.pads(12, -158, 6, 12);
  S.mistBank(-8, -163, 26, 22, { opacity: 0.25, size: 12, y: 0.7 });
  S.hut(22, -150, 1.0, { yaw: -0.8, glow: '#6a6048' }); S.deck(18, -154, 26, -146, 1.0);
  S.hut(-36, -160, 1.0, { yaw: 1.0, glow: '#6a6048' }); S.deck(-40, -164, -32, -156, 1.0);

  // the story four (scenes; in solo they also stand by on the veranda in the fight)
  const cast = {
    tosha: L.npc('tosha', 0, -50, 0), bublik: L.npc('bublik', 0, -50, 0), noki: L.npc('noki', 0, -50, 0), pastila: L.npc('pastila', 0, -50, 0),
  };
  for (const n of Object.values(cast)) n.root.visible = false;
  const boss = new Morok3(L, MARK.chair);
  S.finish();
  const refs: SwampRefs = { kit: S, boss, bridge, cast, ferry, ...house };
  L.refs.fangs2 = refs;
}

/** the house on stilts: walls with a wide door, a thatched roof, hundreds of jars under the eaves, the big bottle inside */
function buildHouse(L: Level3D, S: SwampKit, x0: number, x1: number, zFront: number) {
  const y = ARENA.y;
  const hx0 = -17, hx1 = 1, hz0 = -183, hz1 = zFront + 0.2;
  const H = 6.2;
  const wall = mat('#4e4234'), wallD = mat('#3a3026');
  const box = (a: number, b: number, c: number, d: number, e: number, f: number, m: THREE.Material, solid = true) => {
    const ms = new THREE.Mesh(new THREE.BoxGeometry(d - a, e - b, f - c), m);
    ms.position.set((a + d) / 2, (b + e) / 2, (c + f) / 2); ms.castShadow = true; ms.receiveShadow = true;
    L.deco(ms);
    if (solid) L.col({ kind: 'box', min: new THREE.Vector3(a, b, c), max: new THREE.Vector3(d, e, f) });
    return ms;
  };
  S.deck(hx0 - 0.5, hz0 - 0.5, hx1 + 0.5, hz1, y, { th: 0.4 });
  box(hx0, y, hz0, hx1, y + H, hz0 + 0.4, wall);
  box(hx0, y, hz0, hx0 + 0.4, y + H, hz1, wall);
  box(hx1 - 0.4, y, hz0, hx1, y + H, hz1, wall);
  // the front: a wide doorway in the middle (the bottle shows through it)
  box(hx0, y, hz1 - 0.4, -11, y + H, hz1, wall);
  box(-5, y, hz1 - 0.4, hx1, y + H, hz1, wall);
  box(-11, y + 4.2, hz1 - 0.4, -5, y + H, hz1, wall, false);
  // log bands
  for (let i = 0; i < 5; i++) {
    const yy = y + 0.5 + i * 1.2;
    if (yy < y + 4.2) { box(hx0 - 0.08, yy, hz1 - 0.48, -11, yy + 0.12, hz1 + 0.08, wallD, false); box(-5, yy, hz1 - 0.48, hx1 + 0.08, yy + 0.12, hz1 + 0.08, wallD, false); }
    else box(hx0 - 0.08, yy, hz1 - 0.48, hx1 + 0.08, yy + 0.12, hz1 + 0.08, wallD, false);
  }
  // the doorway is a dark hall with the bottle in it (nobody walks in: the hall is hers)
  L.col({ kind: 'box', min: new THREE.Vector3(-11, y, hz1 - 0.6), max: new THREE.Vector3(-5, y + 4.2, hz1 - 0.2) });
  // round windows with a dim jar glow
  for (const wx of [-14.2, -1.8]) {
    const w = new THREE.Mesh(new THREE.CircleGeometry(0.9, 20), basic('#a89a58')); w.position.set(wx, y + 3.2, hz1 + 0.03); L.deco(w);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#c8b060', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.4 }));
    sp.position.set(wx, y + 3.2, hz1 + 0.6); sp.scale.setScalar(3); noOutline(sp); L.deco(sp);
  }
  // the roof: a big thatched gable
  const roofM = mat('#6a5a3a');
  for (const s of [-1, 1]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(hx1 - hx0 + 2.4, 0.35, 9.6), roofM);
    r.position.set((hx0 + hx1) / 2, y + H + 2.0, (hz0 + hz1) / 2 + s * 3.4);
    r.rotation.x = s * 0.62; r.castShadow = true; L.deco(r);
  }
  const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, hx1 - hx0 + 2.6, 8), wallD); ridge.rotation.z = Math.PI / 2; ridge.position.set((hx0 + hx1) / 2, y + H + 4.6, (hz0 + hz1) / 2); L.deco(ridge);
  // jars under the eaves (instanced) with their dim fireflies (one Points cloud)
  const jarGeo = new THREE.CylinderGeometry(0.14, 0.13, 0.32, 8);
  const N = 70;
  const jars = new THREE.InstancedMesh(jarGeo, matU('#b8d0c8', { transparent: true, opacity: 0.55 }), N);
  const m4 = new THREE.Matrix4();
  const glowPos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const row = i % 2, k = Math.floor(i / 2) / (N / 2 - 1);
    const x = hx0 - 0.8 + (hx1 - hx0 + 1.6) * k, z = hz1 + 0.7 + row * 0.5, yy = y + H - 0.4 - row * 0.5 - (Math.floor(i / 2) % 3) * 0.2;
    m4.makeTranslation(x, yy, z); jars.setMatrixAt(i, m4);
    glowPos[i * 3] = x; glowPos[i * 3 + 1] = yy; glowPos[i * 3 + 2] = z;
  }
  jars.instanceMatrix.needsUpdate = true; jars.castShadow = false;
  noOutline(jars);
  L.deco(jars);
  const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(glowPos, 3));
  const jarGlow = new THREE.Points(gg, new THREE.PointsMaterial({ size: 0.5, map: glowTex(), color: '#ffd860', transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
  noOutline(jarGlow); L.deco(jarGlow);
  // the beam the jars hang from
  const beam = new THREE.Mesh(new THREE.BoxGeometry(hx1 - hx0 + 2.2, 0.2, 0.2), wallD); beam.position.set((hx0 + hx1) / 2, y + H, hz1 + 0.9); L.deco(beam);
  // the big bottle with Матушка Светлячиха inside
  const bottle = new THREE.Group();
  bottle.position.copy(MARK.bottle);
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 3.4, 24), matU('#bfe0d8', { transparent: true, opacity: 0.32 }));
  glass.position.y = 1.7; bottle.add(glass);
  const shoulder = new THREE.Mesh(new THREE.SphereGeometry(1.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), matU('#bfe0d8', { transparent: true, opacity: 0.32 })); shoulder.position.y = 3.4; bottle.add(shoulder);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 1.2, 16), matU('#bfe0d8', { transparent: true, opacity: 0.36 })); neck.position.y = 5.2; bottle.add(neck);
  const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.55, 0.5, 16), mat('#8a6a3a')); cork.position.y = 5.9; bottle.add(cork);
  noOutline(glass); noOutline(shoulder); noOutline(neck);
  L.deco(bottle);
  L.col({ kind: 'cyl', x: MARK.bottle.x, z: MARK.bottle.z, r: 1.6, y0: y, y1: y + 5 });
  const mother = createSvetlyachikha();
  const motherG = new THREE.Group();
  motherG.add(mother.root);
  motherG.position.copy(MARK.bottle).setY(y + 0.2);
  motherG.scale.setScalar(0.85);
  mother.glow = 0.25;
  markCharacter(mother.root);
  L.deco(motherG);
  // a dim swarm inside the house (the caught fireflies) — set free at the end
  const houseSwarm = new FireflySwarm(L, new THREE.Vector3(-8, y + 3.2, -168.4), 9, 120, { height: 2, on: false });
  void x0; void x1;
  return { mother, motherG, bottle, jars, jarGlow, houseSwarm };
}

// ═════════════════════════════ per-level hooks ═════════════════════════════

/** SCRIPTS3.special.fangs2_swamp: after the build on every machine */
export function fangs2Special(L: Level3D) {
  const R = swampOf(L);
  if (!R) return;
  const V = vamp(L);
  frogBarks(L);
  for (const n of Object.values(R.cast)) markCharacter(n.rig.root, L.scene);
  // Ноки's chord through the kit unmasks the copy too
  const chord = V.chord.bind(V);
  V.chord = (at, r = 5, by = null) => { chord(at, r, by); const p = at instanceof THREE.Vector3 ? at : new THREE.Vector3(at[0], at[1], at[2]); R.boss.chordAt(L, p, r); };
  // the трясина: the first time, a tip
  const p = L.player;
  const hz = p.hazardHit.bind(p);
  p.hazardHit = (L2: Level3D, dmg: number) => { if (p.pos.y < 0 && !p.dead) L2.hint('fangs2bog', TOASTS.bog); hz(L2, dmg); };
  // the boss: L.boss from the fight on (scripts); the defeat starts the next scene (host)
  const boss = R.boss;
  boss.setCast(L.nl ? [] : Object.values(R.cast));
  boss.onDefeat = () => {
    if (!L.authority) return;
    L.runGen((function* () { yield { update: (() => { let t = 0; return (dt: number) => (t += dt) > 1.6; })() }; L.run('fangs2_boss_defeat'); })());
  };
  const won = L.seen.has('fangs2_boss_defeat');
  if (won) afterVictory(L, true);
  else if (L.seen.has('fangs2_boss_intro')) {
    // a restart in the fight (solo respawn / co-op team wipe): Морок greets you again, the fight goes on
    L.boss = boss;
    L.camModeDefault = 'boss'; L.tcam.mode = 'boss';
    L.tcam.bossPoint = new THREE.Vector3(ARENA.cx, ARENA.y + 2, ARENA.cz);
    boss.pos.set(ARENA.cx, ARENA.y, ARENA.cz - 4);
    if (!L.nl) showCastSolo(L);
    const nl = L.nl;
    if (!nl) L.runGen((function* () { yield undefined; L.run('fangs2_boss_retry'); })());
    else if (L.authority) L.runGen((function* () { yield { update: () => !nl.waiting }; L.run('fangs2_boss_retry'); })());
  }
}

/** solo: the four stand by on the veranda (south rail) for the fight */
export function showCastSolo(L: Level3D) {
  const R = swampOf(L);
  if (!R || L.nl) return;
  const spots: [number, number][] = [[-15.5, -154.6], [-13, -154.2], [-3, -154.2], [-0.5, -154.6]];
  const kinds = (['tosha', 'bublik', 'noki', 'pastila'] as const).filter((k) => k !== L.player.kind);
  (['tosha', 'bublik', 'noki', 'pastila'] as const).forEach((k) => { R.cast[k].root.visible = false; });
  kinds.forEach((k, i) => {
    const n = R.cast[k];
    n.root.visible = true;
    n.root.position.set(spots[i][0], ARENA.y, spots[i][1]);
    n.root.rotation.y = Math.PI;
    (n.anim as HeroAnim).state = 'idle';
  });
  R.boss.setCast(kinds.map((k) => R.cast[k]));
}

/** the house after the victory: fireflies free, colour back, the bottle cracked (also after a rebuild) */
export function afterVictory(L: Level3D, quiet: boolean) {
  const R = swampOf(L);
  if (!R) return;
  const V = vamp(L);
  R.houseSwarm.target = 1;
  R.jarGlow.visible = false;
  if (quiet) { V.zone('house')?.finish(); R.bottle.visible = false; R.motherG.visible = false; }
  R.boss.form = 'dead';
  const sw = new FireflySwarm(L, new THREE.Vector3(-8, 1.4, -160), 22, 260, { height: 7 });
  sw.target = quiet ? 1 : 0;
  L.refs.f2bigSwarm = sw;
  if (L.seen.has('fangs2_ending')) openExit(L);
}

/** the way home: Камыш's boat at the east gap of the veranda */
export function openExit(L: Level3D) {
  const R = swampOf(L);
  if (!R || L.refs.f2exit) return;
  const S = R.kit;
  L.refs.f2exit = true;
  const boat = new Raft(S, [MARK.exitBoat.clone(), MARK.exitBoat.clone().add(new THREE.Vector3(0.01, 0, 0))], { r: 1.9, top: 0.75, dwell: 1000, travel: 1, ferry: true });
  L.refs.f2boat = boat;
  L.exit(4.2, 0, -160, 8.4, 4, -154);
}

/** per-level plugin: the swamp's moving bits, the fog thickening in the mist, mouths of the speakers, small hints */
export function fangs2Plugin(L: Level3D): LevelPlugin | null {
  if (L.def.id !== 'fangs2_swamp') return null;
  const fogBase = { near: 16, far: 70 };
  let mistK = 0, glow = 0, prevY = 1;
  const said = new Set<string>();
  const bg = new THREE.Color();
  return {
    update(dt) {
      const R = swampOf(L);
      const S = L.refs.swamp as SwampKit | undefined;
      S?.update(dt);
      const p = L.player.pos;
      // a splash where my hero goes into the bog (he sinks a moment before it takes him)
      if (prevY >= 0.02 && p.y < 0.02 && !L.player.body.onGround && !L.player.dead) {
        L.fx.emit(p.clone().setY(0.1), { count: 22, speed: [1.5, 4], dir: new THREE.Vector3(0, 1, 0), spread: 0.6, life: [0.4, 0.8], size: [0.1, 0.22], colors: ['#4a7a5a', '#8ab8a0', '#2a4a3a'], g: 12 });
        L.fx.ring(p.clone().setY(0.05), 1.4, '#9ac8b0', 0.4);
        audio.sfx('splash');
      }
      prevY = p.y;
      // riding the ferry: a fall into the bog puts me back on the nearer pier, not where I boarded
      if (R && L.player.body.ground === R.ferry.col) L.player.lastSafe.copy(R.ferry.pos.z < -29.5 ? FERRY_B : FERRY_A);
      // the freed fireflies are the light themselves: no sun-orb over their spots (every machine)
      for (const tl of vamp(L).temps) if (tl.r === FIREFLY_LIGHT_R && tl.obj.visible) tl.obj.visible = false;
      // fog: thick in the mist stretch, thinner after the victory
      const inMist = p.z < -86 && p.z > -150 ? 1 : 0;
      mistK = damp(mistK, inMist, 1.2, dt);
      glow = damp(glow, L.seen.has('fangs2_boss_defeat') ? 1 : 0, 0.8, dt);
      const fog = L.scene.fog as THREE.Fog | null;
      if (fog) {
        fog.near = fogBase.near - mistK * 9 + glow * 8;
        fog.far = fogBase.far - mistK * 28 + glow * 30;
        // a greenish swamp tint over the night's fog colour (the kit sets it every frame)
        fog.color.lerp(bg.set(glow > 0.5 ? '#2a4a3a' : mistK > 0.5 ? '#26363a' : '#1e3430'), 0.45 + mistK * 0.3);
        if (L.scene.background instanceof THREE.Color) L.scene.background.copy(fog.color).multiplyScalar(0.8);
      }
      // the cast talks for its speaker (Пастила / Ноки lines go through the custom box)
      const sp = talkingNow(L);
      if (R && sp && (sp === 'pastila' || sp === 'noki')) R.cast[sp].talk = 0.35;
      // first look at the village / the mist: a tip and my hero's own line (§6.2.4)
      if (!said.has('village') && p.z < -50 && p.z > -86 && !L.inCutscene) { said.add('village'); if (!vamp(L).zone('village')?.done) L.hint('fangs2village', TOASTS.village); }
      if (!said.has('mist') && p.z < -90 && !L.inCutscene) { said.add('mist'); squadLine(L, 'noki'); squadLine(L, 'pastila'); }
      if (!said.has('ferry') && p.z < -8 && p.z > -14 && !L.inCutscene) { said.add('ferry'); L.hint('fangs2ferry', TOASTS.ferry); squadLine(L, 'tosha'); }
      // solo: the big swarm of freed fireflies breathes in
      const big = L.refs.f2bigSwarm as FireflySwarm | undefined;
      if (big) big.target = Math.max(big.target, glow);
      if (R) R.mother.update(dt, R && talkingNow(L) === 'svetlyachikha' ? 1 : 0);
      void clamp;
    },
  };
}

const FERRY_A = new THREE.Vector3(21, 1.05, -8.4);
const FERRY_B = new THREE.Vector3(21, 1.05, -51);

/** my hero says his own line of §6.2.4 (only if I play that hero) */
function squadLine(L: Level3D, kind: keyof typeof SQUAD) {
  if (L.player.kind !== kind) return;
  L.bark(L.player.root, SQUAD[kind], 2.2, 1.9);
}

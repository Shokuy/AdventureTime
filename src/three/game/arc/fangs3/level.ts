import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { net } from '../../../../net/session';
import { drawHint } from '../../../../ui/glyphs';
import { toUI } from '../../../runtime';
import { mat, basic, noOutline } from '../../../gfx';
import * as P from '../../../world/props';
import type { Level3D, LevelPlugin, HeroLike } from '../../level';
import type { Level3Def } from '../../levels';
import type { Netted } from '../../netLevel';
import { addGrappleRing } from '../../heroes';
import { vamp, type VampKit, type Lantern } from '../vampires';
import { Batch, slab, glassWall, gableRoof, latticeDome, arch, planter, nightFlower, bedFlowers, flaskTable, shards, railing, pollenPatch, moonBeam, outside, crystal, wallCol, M, P3 } from './props';
import { BeamMirror, CrystalDoor, Reflections, mirrorPanel, backOf, type GhostSrc } from './mirrors';
import { PollenMotes, Footprints, PollenFlower } from './pollen';
import { SprinklerCart, Sprinkler } from './movers';
import { Whispers } from './whisper';
import { Cast } from './cast';
import { castMouths } from './speech';
import { ARENA, type Shepot3 } from './boss';
import { WateringCan, Puddles } from './can';
import { KingMirror } from './kingMirror';
import { SIGNS, DEATH, WHISPERS, FOUR, HELP, TOAST, NOTES, NAMES, MAZE_GIRL, ECHO, TOSHA_WING, echoOf, type Bk } from './lines';

/*
 * `fangs3_garden` — Серия 4 «Стеклянная оранжерея» (docs/script-fangs.md §7). The way (toward −z):
 *   S0  the hill path and the arch «Оранжерея королевы Карамели» (the intro scene)
 *   S1  the moonlit courtyard: mirror 1 → the grey flowerbed blooms (mini-scene) → door 1
 *   S2  the glass hall: a catwalk with a spinning sprinkler over the pit of broken flasks, watering carts on rails,
 *       then a climb up the frame of a little dome to mirror 2 at its top → door 2
 *       (Бублик: a grapple ring over the pit and a bridge across it; a high ledge with a walnut; a glide ledge)
 *   S3  the grey botanical wing: pollen everywhere, Невидимки-слуги (prints in the pollen give them away), grey
 *       flowers to restore, giant pollen flowers to burst, an ambush ring, mirror 3 → door 3
 *   S4  the mirror maze: the mirrors show the invisible ones — and the way out (one «mirror» is a doorway)
 *   S4b the antechamber: mirror 4 → the dome's door (opens when all four mirrors face the dome)
 *   S5  the dome: Шёпот (boss.ts), then the root and the way out to the north
 * Shared state lives in Netted things (mirrors, pollen flowers, lanterns, zones, enemies, the boss); doors follow the
 * mirrors on every machine; carts and sprinklers follow the room clock.
 */

export const LEVEL_ID = 'fangs3_garden';
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const v1 = new THREE.Vector3();

/** marks for the story scenes */
export const MARKS = {
  intro: { tosha: [-1.4, 58.6, Math.PI], bublik: [0.1, 59.4, Math.PI], pastila: [1.5, 58.4, Math.PI + 0.2], noki: [3.0, 59.6, Math.PI + 0.35] },
  mirror: { tosha: [-5.6, 41.8, -2.6], bublik: [-4.5, 40.4, -2.9], pastila: [-6.6, 39.6, -2.2], noki: [-2.4, 42.6, -2.4] },
  bed: { tosha: [-2.4, -126.4, Math.PI], bublik: [-0.8, -125.9, Math.PI], pastila: [1.0, -126.1, Math.PI], noki: [2.7, -126.8, Math.PI + 0.25] },
} as const;
/** the court's grey bed (the cold open: the can waters it) and where the can lies after it drops */
export const COURT_BED = V(-3.5, 0, 37);
export const CAN_DROPPED = V(-0.9, 0, 39.6);
/** the mirror maze: 3 m cells (8 columns from x −12, 6 rows from z −83); panels on the cell edges; the exit (a
 *  «mirror» that is a doorway) south of cell (row 5, column 6) */
const MAZE_H: Record<number, number[]> = { 0: [0, 1, 2, 5, 6, 7], 1: [1, 2, 4, 6], 2: [0, 2, 3, 5, 6, 7], 3: [1, 2, 4, 5, 7], 4: [0, 1, 3, 4, 6], 5: [1, 2, 3, 5, 7] };
const MAZE_V: Record<number, number[]> = { 2: [1, 2], 3: [3, 4], 4: [1, 5], 5: [2], 6: [4, 5], 7: [1, 2] };
const MAZE_EXIT_C = 6;
const cellX = (c: number) => -12 + 3 * c + 1.5, cellZ = (r: number) => -83 - 3 * r - 1.5;
/** steps to the exit from every cell (BFS from the exit cell) */
const MAZE_DIST = (() => {
  const d = new Map<string, number>();
  const open = (r: number, c: number, r2: number, c2: number) => {
    if (r2 < 0 || r2 > 5 || c2 < 0 || c2 > 7) return false;
    if (r2 !== r) return !(MAZE_H[Math.max(r, r2)] ?? []).includes(c);
    return !(MAZE_V[Math.max(c, c2)] ?? []).includes(r);
  };
  const q: [number, number][] = [[5, MAZE_EXIT_C]];
  d.set(`5,${MAZE_EXIT_C}`, 0);
  while (q.length) {
    const [r, c] = q.shift()!;
    for (const [r2, c2] of [[r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]] as [number, number][]) {
      if (!open(r, c, r2, c2) || d.has(`${r2},${c2}`)) continue;
      d.set(`${r2},${c2}`, d.get(`${r},${c}`)! + 1); q.push([r2, c2]);
    }
  }
  return { d, open };
})();

export function fangs3Level(): Level3Def {
  return {
    id: LEVEL_ID, chapter: 0, title: 'Стеклянная оранжерея', subtitle: 'Серия 4', music: 'garden',
    spawn: [0, 0, 70], yaw: Math.PI, killY: -4,
    bg: '#20102a', fog: ['#2a1430', 40, 200],
    hemi: ['#9aa0e0', '#2a1d40', 1.0], sun: { color: '#ffb8c0', intensity: 1.5, dir: [-0.4, 0.66, -0.64] },
    startScript: 'fangs3_intro',
    castScenes: true,
    deathText: DEATH[Math.floor(Math.random() * DEATH.length)],
    build(L) { new Garden(L); },
  };
}

/** the four mirrors of the way (index 0..3) and where they shine */
interface Way { m: BeamMirror; door: CrystalDoor | null }

export class Garden implements Netted {
  netId = 0;
  netKind = 'f3garden';
  V: VampKit;
  way: Way[] = [];
  arenaMirrors: BeamMirror[] = [];
  arenaLanterns: Lantern[] = [];
  arenaFlowers: PollenFlower[] = [];
  flowers: PollenFlower[] = [];
  doors: CrystalDoor[] = [];
  domeDoor!: CrystalDoor;
  exitDoor!: CrystalDoor;
  feet: Footprints;
  whispers: Whispers;
  refl: Reflections;
  motes: PollenMotes[] = [];
  carts: SprinklerCart[] = [];
  sprinklers: Sprinkler[] = [];
  cast!: Cast;
  boss: Shepot3 | null = null;
  bud!: Bud;
  bedCrystal!: ReturnType<typeof crystal>;
  courtBeam: THREE.Mesh | null = null;
  /** host: story scenes waiting for a free moment */
  pending: string[] = [];
  /** the fight is staged (intro played, not won) */
  fight = false;
  won = false;
  private lvlWhT = 30;
  private lvlWhI = 0;
  private hinted = new Set<string>();
  private said = new Set<string>();
  private helpT = 6;
  private fightT = 0;
  private helpers: ('pastila' | 'noki')[] = [];
  private lastAtk = -1;
  /** (the first second and a half everything is drawn once: shaders compile at the start, not mid-run) */
  private cullT = 1.5;
  private brokenSeen = new Set<object>();
  private exitAt = V(0, 0, -101.4);
  /** Карамель's old watering can: the cold open's, then Шёпот's in the fight (v2 §7.0, §7.4) */
  can: WateringCan;
  puddles: Puddles;
  /** the big north mirror (the King's face in the ending) */
  kingMirror!: KingMirror;
  /** extra things the mirrors show (the scenes: Шёпот behind each of the four in the boss intro) */
  sceneGhosts: GhostSrc[] | null = null;
  /** what the heroes said lately, as echoes (the decoys of phase 2 whisper them back) */
  heard: string[] = [];
  private echoT = 0;
  private notesRead = new Set<string>();
  private noteAt: { key: string; pos: THREE.Vector3 }[] = [];
  /** the shadow girl in the maze's mirrors (where she stands behind the glass, eased) */
  private girl = { pos: V(0, 0, -86), on: 0, flip: false };

  constructor(readonly L: Level3D) {
    L.refs.garden = this;
    this.V = vamp(L);
    const V3 = this.V;
    this.feet = new Footprints(L);
    // Тоша's bark (§7.2.4) when prints show up next to him
    this.feet.onStamp = (x, z) => { if (Math.hypot(x - L.player.pos.x, z - L.player.pos.z) < 6) this.four('tosha'); };
    this.whispers = new Whispers(L);
    this.refl = new Reflections(L, () => this.ghosts());
    this.can = new WateringCan(L);
    this.puddles = new Puddles(L);
    if (L.seen.has('fangs3_cold')) this.dropCan();
    this.hookBarks();
    if (L.nl) L.nl.add(this, 931);
    V3.nightLook({ red: 0.7, fog: [34, 210], moonDir: [-0.4, 0.66, -0.64], dark: 0.55 });
    V3.moon({ size: 30 });
    outside(L, V(150, -20, -360));
    const B = new Batch();
    // (first: the dome's lanterns get the real lights)
    this.buildDome(B);
    this.buildPath(B);
    this.buildCourt(B);
    this.buildHall(B);
    this.buildWing(B);
    this.buildMaze(B);
    B.flush(L);
    // doors follow the mirrors (every machine; also at once for mirrors already locked on a rebuild)
    this.way.forEach((w, i) => w.m.onLock((_m, fromNet) => this.mirrorLocked(i, fromNet)));
  }

  // ═════════════════════════════ BUILD ═════════════════════════════
  private buildPath(B: Batch) {
    const L = this.L;
    slab(L, B, -5, 54, 5, 75, 0);
    for (const s of [-1, 1]) {
      wallCol(L, s * 5.2, -1, 54, s * 5.6, 6, 75);
      // a low hedge of night flowers and stones along the path
      for (let z = 56; z < 74; z += 2.2) {
        const st = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), M.stoneD());
        st.position.set(s * 5.4, 0.1, z + (z % 3)); st.scale.set(1, 0.6, 1); L.deco(st);
      }
      nightFlower(L, s * 6.5, 0, 60, 1.1, s > 0 ? P3.petalM : P3.petalV, 3 + s, B);
      nightFlower(L, s * 7.2, 0, 67, 0.9, P3.petalB, 5 + s, B);
    }
    wallCol(L, -6, -1, 74.6, 6, 6, 75.4);
    arch(L, B, 0, 0, 56, 5.2, 5.4);
    L.add(P.signpost({ x: -3.4, y: 0, z: 60, rotY: 0.3, text: 'Оранжерея' }));
    L.signAt(-3.4, 0, 60, SIGNS.gate);
    this.V.lantern(3.4, 0, 63);
  }

  private buildCourt(B: Batch) {
    const L = this.L, V3 = this.V;
    slab(L, B, -13, 30, 13, 54, 0);
    glassWall(L, B, -13, 54, 13, 54, 0, 5.5, { gaps: [[10.4, 15.6]] });
    glassWall(L, B, -13, 30, 13, 30, 0, 5.5, { gaps: [[11, 15]] });
    glassWall(L, B, -13, 30, -13, 54, 0, 5.5);
    glassWall(L, B, 13, 30, 13, 54, 0, 5.5);
    gableRoof(L, B, -13, 30, 13, 54, 5.5, 3.2, { holes: [3, 4] });
    V3.greyZone('court', [-2, 0, 42], 11, { auto: 'none', amount: 0.9 });
    // the bed: grey flowers and a sun crystal on a stalk (mirror 1 shines on it)
    const top = planter(L, B, -3.5, 0, 37, 2.1);
    bedFlowers(L, -3.5, top - 0.1, 37, 2.1, 26, 7, B);
    this.bedCrystal = crystal(L, -3.5, top + 1.0, 37, 0.9);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.0, 6), M.brass()); stalk.position.set(-3.5, top + 0.5, 37); L.deco(stalk);
    // mirror 1 (sticky) under the hole in the roof
    const m1 = new BeamMirror(L, -8, 0, 44.5, { target: V(-3.5, top + 1.0, 37), start: 3, key: 'f3m1', moon: 12 });
    const d1 = new CrystalDoor(L, B, 0, 0, 30, 4, 3.4, true);
    this.way.push({ m: m1, door: d1 }); this.doors.push(d1);
    L.add(P.signpost({ x: -9.6, y: 0, z: 46.5, rotY: 0.6, text: 'К куполу!' }));
    L.signAt(-9.6, 0, 46.5, SIGNS.mirror);
    // a servant in a patch of pollen (the first invisible one: prints and a shimmer)
    pollenPatch(L, 4.5, 0, 41, 3.2); V3.dustZone([4.5, 0, 41], 3.2); this.feet.addZone(4.5, 41, 3.2);
    L.enemy('servant', 4.5, 0, 41, { aggro: 9, leash: 14 });
    L.enemy('gflower', 9.5, 0, 47.5);
    L.enemy('gflower', 9.8, 0, 34.5);
    flaskTable(L, B, 6, 0, 32.4, 0, 2);
    flaskTable(L, B, -10.6, 0, 33.5, Math.PI / 2, 3);
    L.breakable('jar', 3.8, 0, 32.2);
    L.breakable('jar', -11, 0, 50);
    for (const [x, z, c] of [[-11, 40, P3.petalV], [11, 42, P3.petalM], [-10.5, 51.5, P3.petalB], [10.8, 51, P3.petalV]] as const) nightFlower(L, x, 0, z, 1.2, c, Math.abs(x * z), B);
    L.cp(7, 0, 50.5);
    L.crumbLine(-6, 0, 50, -6, 0, 40, 5);
    this.note('court', 3.9, 51.6, -0.4);
  }

  private buildHall(B: Batch) {
    const L = this.L, V3 = this.V;
    // floors: the entry ledge, the catwalk, landings, the dome floor (the rest is the pit)
    slab(L, B, -6, 25, 6, 30, 0);
    slab(L, B, -1, 15, 1, 25, 0, 0.6);
    railing(L, B, -1, 15, -1, 25, 0); railing(L, B, 1, 15, 1, 25, 0);
    slab(L, B, -5, 9, 5, 15, 0);
    slab(L, B, -7, -5, 7, 1, 0);
    slab(L, B, -16, -24, 16, -5, 0);
    shards(L, B, -16, 1, 16, 9, -9, 21);
    shards(L, B, -16, 9, -5, 25, -9, 22);
    shards(L, B, 5, 9, 16, 25, -9, 23);
    shards(L, B, -16, -5, -7, 1, -9, 24); shards(L, B, 7, -5, 16, 1, -9, 25);
    shards(L, B, -6, 15, -1, 25, -9, 26); shards(L, B, 1, 15, 6, 25, -9, 27);
    // walls / roof
    glassWall(L, B, -16, 30, -13, 30, 0, 9); glassWall(L, B, 13, 30, 16, 30, 0, 9);
    glassWall(L, B, -16, -24, -16, 30, -9, 18);
    glassWall(L, B, 16, -24, 16, 30, -9, 18);
    glassWall(L, B, -16, -24, 16, -24, 0, 9, { gaps: [[14, 18]] });
    gableRoof(L, B, -16, -24, 16, 30, 9, 4.5, { holes: [3] });
    L.cp(4.2, 0, 27.5);
    this.note('hall', -4.2, 27.4, 0.5);
    // the catwalk's sprinkler + the carts over the pit
    this.sprinklers.push(new Sprinkler(L, 0, 0, 20, 1.15, 1.7, 0));
    this.carts.push(new SprinklerCart(L, -2.2, 0, 7.6, 2.4, 2.4, 2.4, 6.5, 0));
    this.carts.push(new SprinklerCart(L, 2.2, 0, 7.6, 2.4, 2.4, 2.4, 6.5, 0.5));
    addGrappleRing(L, 0, 4.4, 5);
    // a fanger on the far landing and bats over the dome floor
    L.enemy('fanger', 3, 0, -2.5, { aggro: 10 });
    V3.flock(0, 4.5, -9, 3);
    L.enemy('fanger', -9, 0, -19, { aggro: 10 });
    L.breakable('jar', 3.6, 0, 13.2); L.breakable('jar', -3.6, 0, 10.4); L.breakable('crate', 5.6, 0, -3.6);
    // the little dome: an open frame with a spiral of ledges up to mirror 2
    const cx = 0, cz = -15;
    latticeDome(L, B, cx, 0, cz, 8, { meridians: 12, rings: 4, open: 0.18, panes: false });
    for (let i = 0; i < 7; i++) {
      const th = 0.4 + i * 0.75, r = 6.2 - i * 0.3, y = 1 + i * 0.9;
      const x = cx + Math.sin(th) * r, z = cz + Math.cos(th) * r;
      slab(L, B, x - 1.2, z - 1.2, x + 1.2, z + 1.2, y, i === 0 ? y : 0.45, { tiles: false, color: P3.brass });
      B.bar(M.iron(), V(x, y - 0.45, z), V(cx + Math.sin(th) * 7.9, Math.max(0, y - 1.6), cz + Math.cos(th) * 7.9), 0.08);
    }
    // the top: a round platform on a pillar
    const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 6.6, 12), M.iron()); pil.position.set(cx, 3.3, cz); pil.castShadow = true; L.deco(pil);
    const disk = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.4, 24), M.brass()); disk.position.set(cx, 6.8, cz); disk.castShadow = true; disk.receiveShadow = true; L.deco(disk);
    L.col({ kind: 'cyl', x: cx, z: cz, r: 2.2, y0: 0, y1: 7 });
    const m2 = new BeamMirror(L, cx, 7, cz, { target: V(0, 4.4, -24), start: 5, key: 'f3m2', moon: 12 });
    const d2 = new CrystalDoor(L, B, 0, 0, -24, 4, 3.4, true);
    this.way.push({ m: m2, door: d2 }); this.doors.push(d2);
    L.cp(-9, 0, -8);
    // secrets: a ledge high on the west wall (ring / double jump via a glass post) and a glide ledge east
    slab(L, B, -16, 3.5, -13.4, 6.5, 4.5, 0.5, { tiles: false, color: P3.stoneD });
    slab(L, B, -10.3, 6.7, -8.7, 8.3, 2.6, 0.5, { tiles: false, color: P3.glass });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 11.5, 8), basic(P3.glass, { transparent: true, opacity: 0.35 })); post.position.set(-9.5, -3.2, 7.5); noOutline(post); L.deco(post);
    addGrappleRing(L, -11.6, 7.4, 5.2);
    L.pick('nut', -14.6, 5.1, 5, 'nut_fangs3_hall');
    L.crumbLine(-15, 4.7, 4, -15, 4.7, 6, 3);
    slab(L, B, 11.5, -13, 14.5, -9, 2.6, 0.5, { tiles: false, color: P3.brass });
    L.pick('bigcrumb', 13, 3.0, -11);
    L.crumbRing(13, 2.6, -11, 1.0, 5);
    for (const [x, z] of [[-13, 18], [13, 20], [-13, -20], [13, -21]] as const) nightFlower(L, x, z > 0 ? -9 : 0, z, z > 0 ? 2.6 : 1.3, P3.petalV, x * 3 + z, B);
  }

  private buildWing(B: Batch) {
    const L = this.L, V3 = this.V;
    slab(L, B, -14, -80, 14, -24, 0);
    glassWall(L, B, -14, -80, -14, -24, 0, 7);
    glassWall(L, B, 14, -80, 14, -24, 0, 7);
    glassWall(L, B, -14, -80, 14, -80, 0, 7, { gaps: [[12, 16]] });
    gableRoof(L, B, -14, -80, 14, -24, 7, 4, { holes: [1] });
    V3.greyZone('wing', [0, 0, -52], 23, { auto: 'clear' });
    this.motes.push(new PollenMotes(L, -13, 0.4, -79, 13, 5.5, -25, 320, 4));
    for (const [x, z, r] of [[-6, -34, 3.6], [6, -43, 3.6], [0, -55, 7.6], [-5, -69, 3.6], [5, -73, 3.0]] as const) {
      pollenPatch(L, x, 0, z, r); V3.dustZone([x, 0, z], r); this.feet.addZone(x, z, r);
    }
    L.add(P.signpost({ x: -4, y: 0, z: -28.5, rotY: 0.4, text: 'Тише!' }));
    L.signAt(-4, 0, -28.5, SIGNS.quiet);
    V3.lantern(2.5, 0, -29.5);
    V3.lantern(9.5, 0, -76, { lit: false });
    L.cp(5.5, 0, -27.5);
    // invisible servants, sleepy grey flowers, giant pollen flowers
    L.enemy('servant', -6, 0, -34, { aggro: 11 });
    L.enemy('servant', 6, 0, -43, { aggro: 11 });
    L.enemy('servant', -5, 0, -69, { aggro: 11 });
    for (const [x, z] of [[-10.5, -30], [10.5, -33.5], [-11, -46], [11, -60], [-10.5, -72], [9.5, -77]] as const) L.enemy('gflower', x, 0, z);
    for (const [x, z] of [[-8.5, -40], [8.5, -49], [-8.5, -62], [7.5, -68]] as const) this.flowers.push(new PollenFlower(L, x, 0, z, 6.5, 1));
    for (const [x, z, c] of [[-12.3, -38, P3.petalM], [12.3, -40, P3.petalV], [-12.3, -56, P3.petalB], [12.3, -66, P3.petalM], [-12.3, -64, P3.petalV], [12.4, -30, P3.petalB]] as const) nightFlower(L, x, 0, z, 1.5, c, Math.abs(x * z), B);
    // the ambush ring in the pollen: waves of servants (+1 per two more heroes)
    const extra = L.nl ? Math.floor((Math.max(1, net.members.size) - 1) / 2) : 0;
    const ring = (n: number, r = 4.5, a0 = 0) => Array.from({ length: n }, (_, i) => ({ kind: 'servant' as const, x: Math.sin(a0 + (i / n) * Math.PI * 2) * r, y: 0, z: -55 + Math.cos(a0 + (i / n) * Math.PI * 2) * r }));
    L.arena(0, 0, -55, 7.6, [
      ring(2 + extra, 4.5, 0.3),
      [...ring(2 + extra, 4.8, 1.2), { kind: 'fanger', x: 0, y: 0, z: -59.5 }],
      ring(3 + extra, 4.2, 0.6),
    ], [{ kind: 'honey', x: 0, y: 0.6, z: -55 }, { kind: 'bigcrumb', x: 1.2, y: 0.6, z: -55.5 }]);
    // mirror 3 near the end of the wing
    const m3 = new BeamMirror(L, -9, 0, -74.5, { target: V(0, 4.4, -80), start: 2, key: 'f3m3', moon: 10 });
    const d3 = new CrystalDoor(L, B, 0, 0, -80, 4, 3.4, true);
    this.way.push({ m: m3, door: d3 }); this.doors.push(d3);
    L.breakable('jar', 12, 0, -28); L.breakable('jar', -12, 0, -77); L.breakable('crate', 12.2, 0, -52);
    // secret: a high shelf (Бублик's ring / a double jump from the tall planter)
    slab(L, B, 12, -47, 14, -43, 4.2, 0.4, { tiles: false, color: P3.stoneD });
    planter(L, B, 10.6, 0, -50, 1.0, 1.4);
    addGrappleRing(L, 10.4, 6.4, -45);
    L.pick('nut', 13, 4.8, -45, 'nut_fangs3_wing');
    // Шуршик's little bed by the tall planter (a note: «не трогать — он стесняется»)
    const sb = planter(L, B, 7.6, 0, -57.8, 0.8, 0.4);
    bedFlowers(L, 7.6, sb - 0.1, -57.8, 0.8, 7, 31, B);
    this.note('wing', 9.4, -55.6, -0.6);
  }

  private buildMaze(B: Batch) {
    const L = this.L;
    slab(L, B, -12, -111.2, 12, -80, 0);
    glassWall(L, B, -12, -111.2, -12, -80, 0, 8);
    glassWall(L, B, 12, -111.2, 12, -80, 0, 8);
    glassWall(L, B, -12, -111.2, 12, -111.2, 0, 8, { gaps: [[10, 14]] });
    gableRoof(L, B, -12, -111.2, 12, -80, 8, 3, { holes: [8] });
    L.cp(-7.5, 0, -81.6);
    this.note('maze', 4.6, -81.5, 0);
    // the maze: 3 m cells (x from −12, z from −83), panels 4 m tall on the cell edges
    const H = MAZE_H, Vw = MAZE_V;
    const ph = 4;
    for (const [r, cs] of Object.entries(H)) for (const c of cs) {
      const p = mirrorPanel(L, B, -12 + 3 * c + 1.5, 0, -83 - 3 * Number(r), 3, ph, V(0, 0, 1));
      this.refl.add(p); this.refl.add(backOf(p));
    }
    for (const [c, rs] of Object.entries(Vw)) for (const r of rs) {
      const p = mirrorPanel(L, B, -12 + 3 * Number(c), 0, -83 - 3 * r - 1.5, 3, ph, V(1, 0, 0));
      this.refl.add(p); this.refl.add(backOf(p));
    }
    // the far wall: eight mirrors, one of them a doorway (the way out shows in the other mirrors)
    for (let c = 0; c < 8; c++) {
      const fake = c === MAZE_EXIT_C;
      const p = mirrorPanel(L, B, -12 + 3 * c + 1.5, 0, -101.3, 3, ph + 1, V(0, 0, 1), { fake });
      this.refl.add(p);
      if (!fake) this.refl.add(backOf(p));
      else this.exitAt = V(-12 + 3 * c + 1.5, 0, -101.3);
    }
    wallCol(L, -12, 4, -101.5, 12, 9, -101.1);
    L.enemy('servant', -7.5, 0, -93.5, { aggro: 8, leash: 10 });
    L.enemy('servant', 7.5, 0, -90.5, { aggro: 8, leash: 10 });
    L.pick('bigcrumb', -4.5, 0.4, -87.5);
    L.crumbLine(-10.5, 0, -95, -10.5, 0, -99, 3);
    // the antechamber: mirror 4 → the dome's door
    const m4 = new BeamMirror(L, 8.5, 0, -106.5, { target: V(0, 4.4, -111.2), start: 6, key: 'f3m4', moon: 9 });
    this.domeDoor = new CrystalDoor(L, B, 0, 0, -111.2, 4, 3.4, true);
    this.way.push({ m: m4, door: null });
    L.cp(-7.5, 0, -106.5);
    L.breakable('jar', 5, 0, -109.5);
    L.add(P.signpost({ x: -3.8, y: 0, z: -108.4, rotY: 0.2, text: 'Полуденник' }));
    L.signAt(-3.8, 0, -108.4, SIGNS.root);
  }

  private buildDome(B: Batch) {
    const L = this.L, V3 = this.V, c = ARENA.c;
    // lanterns first: they get the level's real lights
    for (const [a, lit] of [[0, true], [Math.PI / 2, false], [Math.PI, true], [Math.PI * 1.5, false]] as const) {
      this.arenaLanterns.push(V3.lantern(c.x + Math.sin(a) * 7.5, 0, c.z + Math.cos(a) * 7.5, { lit, r: 4.2 }));
    }
    slab(L, B, -20, -151, 20, -111.2, 0);
    slab(L, B, -2.6, -164, 2.6, -151, 0);
    latticeDome(L, B, c.x, 0, c.z, 20.5, { meridians: 20, rings: 6, open: 0.1 });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(20.2, 20.4, 1.0, 64, 1, true), M.stoneD()); ring.position.set(c.x, 0.5, c.z); L.deco(ring);
    // the round wall (gaps south — the door in — and north — the way out)
    for (let i = 0; i < 52; i++) {
      const a = (i / 52) * Math.PI * 2;
      const da = Math.abs(Math.atan2(Math.sin(a), Math.cos(a))), dn = Math.abs(Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI)));
      if (da < 0.1 || dn < 0.1) continue;
      L.col({ kind: 'cyl', x: c.x + Math.sin(a) * 20.3, z: c.z + Math.cos(a) * 20.3, r: 1.5, y0: -1, y1: 12 });
    }
    for (const s of [-1, 1]) { wallCol(L, s * 2.1, -1, -151.5, s * 6, 12, -150); wallCol(L, s * 2.1, -1, -112.5, s * 6, 12, -111); }
    wallCol(L, -2.7, -1, -164, -2.6, 6, -151); wallCol(L, 2.6, -1, -164, 2.7, 6, -151);
    V3.greyZone('dome', [c.x, 0, c.z], 19, { auto: 'none', amount: 0.65 });
    // the pollen floor (prints everywhere)
    pollenPatch(L, c.x, 0, c.z, 17, 0.32);
    for (const [x, z, r] of [[-8, -124, 5], [8, -140, 5], [9, -123, 4], [-9, -141, 4], [0, -146, 3.5], [-12, -131, 3.5], [12, -131, 3.5]] as const) pollenPatch(L, x, 0, z, r, 0.55);
    this.feet.addZone(c.x, c.z, 17);
    this.motes.push(new PollenMotes(L, c.x - 16, 0.4, c.z - 16, c.x + 16, 6, c.z + 16, 260, 9));
    // the bed with the bud of the noon root
    const top = planter(L, B, c.x, 0, c.z, 2.6, 0.7);
    bedFlowers(L, c.x, top - 0.1, c.z, 2.6, 30, 12, B);
    this.bud = new Bud(L, c.x, top, c.z);
    // three beam mirrors around, shining on the bed (he turns them away; [E] turns them back)
    for (const a of [Math.PI / 3, Math.PI, (5 * Math.PI) / 3]) {
      const m = new BeamMirror(L, c.x + Math.sin(a) * 11, 0, c.z + Math.cos(a) * 11, { target: V(c.x, top + 1.1, c.z), start: 0, sticky: false, moon: 16 });
      this.arenaMirrors.push(m);
    }
    for (const a of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]) this.arenaFlowers.push(new PollenFlower(L, c.x + Math.sin(a) * 13.5, 0, c.z + Math.cos(a) * 13.5, 6.5, 1.15));
    // tall mirrors around the wall: they show him (and you)
    for (let k = 0; k < 8; k++) {
      const a = Math.PI / 8 + (k * Math.PI) / 4;
      const x = c.x + Math.sin(a) * 17.6, z = c.z + Math.cos(a) * 17.6;
      this.refl.add(mirrorPanel(L, B, x, 0, z, 3.2, 5.2, V(-Math.sin(a), 0, -Math.cos(a))));
    }
    // balconies for the story helpers (solo)
    for (const s of [-1, 1]) {
      const a = Math.PI + s * Math.PI / 4;
      const x = c.x + Math.sin(a) * 17.2, z = c.z + Math.cos(a) * 17.2;
      slab(L, B, x - 1.1, z - 1.1, x + 1.1, z + 1.1, 2.4, 2.4, { tiles: false, color: P3.stoneD });
    }
    // the way out (north): a door that opens after the root is dug up — behind the big mirror (the King's, §7.6)
    this.exitDoor = new CrystalDoor(L, B, 0, 0, -151, 4, 3.4, true);
    this.kingMirror = new KingMirror(L, B, 0, c.z - 15.6);
    this.refl.add(this.kingMirror.panel);
    if (L.seen.has('fangs3_ending')) this.kingMirror.shatter(false);
    for (const z of [-154, -158, -162]) for (const s of [-1, 1]) nightFlower(L, s * 3.6, 0, z, 0.9, s > 0 ? P3.petalM : P3.petalB, z * s, B);
  }

  // ═════════════════════════════ RUNTIME ═════════════════════════════
  /** a mirror of the way faces its target (every machine; fromNet: the host's word) */
  private mirrorLocked(i: number, live: boolean) {
    const L = this.L;
    const w = this.way[i];
    w.door?.setOpen(true, !this.L.building);
    if (i === 0) {
      this.bedCrystal.set(1);
      this.courtBeamOn();
      if (L.authority) this.V.restoreZone('court');
      if (L.authority && !L.seen.has('fangs3_mirror') && !L.building) this.pending.push('fangs3_mirror');
    }
    if (!L.building && live !== undefined) {
      const n = this.way.filter((x) => x.m.locked).length;
      if (n > 1 || L.seen.has('fangs3_mirror')) L.hud.showBanner(TOAST.mirrorN(n), '#ffd34a');
    }
  }
  private courtBeamOn() {
    if (this.courtBeam) return;
    const from = this.bedCrystal.group.position.clone(), to = this.way[0].door!.center;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1, 8, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2), basic('#ffe9a0', { additive: true, transparent: true, opacity: 0.6, depthWrite: false }));
    m.position.copy(from); m.lookAt(to); m.scale.set(1.4, 1.4, from.distanceTo(to));
    noOutline(m);
    this.L.scene.add(m);
    this.courtBeam = m;
  }

  /** a little timer (not a script: L.runGen would count as a cutscene) */
  private timers: { t: number; f: () => void }[] = [];
  after(secs: number, f: () => void) { this.timers.push({ t: secs, f }); }

  /** a page of Карамель's diary on a little lectern (§7.2.2): a sign; reading it, a bark of the four */
  private note(key: string, x: number, z: number, rotY: number) {
    const L = this.L;
    const n = NOTES.find((q) => q.key === key)!;
    L.add(P.signpost({ x, y: 0, z, rotY, text: 'Дневник' }));
    L.signAt(x, 0, z, n.sign);
    this.noteAt.push({ key, pos: V(x, 0, z) });
  }
  /** the can after the cold open: lying on its side by the court's bed */
  dropCan() {
    const c = this.can;
    c.lying = true; c.tilt = 0; c.pour = 0;
    c.root.visible = true;
    c.root.position.copy(CAN_DROPPED);
    c.root.rotation.set(0, 0.8, 0);
    c.update(0);
  }

  /** a bark of one of the four: over the hero who plays them (any machine's figure), else over the story NPC if it
   *  stands here, else over my hero with the name in front («Пастила: …») — solo and teams without them hear it too */
  barkFor(kind: Bk, str: string, dur = 2.6) {
    const L = this.L;
    for (const h of L.heroes()) {
      const k = h.isLocal ? L.player.kind : (h as unknown as { kind?: string }).kind;
      const root = h.isLocal ? L.player.root : (h as unknown as { root?: THREE.Object3D }).root;
      if (k === kind && root && !h.dead && h.pos.distanceTo(L.player.pos) < 22) { L.bark(root, str, dur, kind === 'bublik' ? 1.4 : 1.9); return; }
    }
    const n = this.cast?.figs[kind];
    if (n && n.root.visible && n.root.position.distanceTo(L.player.pos) < 26) { L.bark(n.root, str, dur, 1.9); return; }
    L.bark(L.player.root, `${NAMES[kind]}: ${str}`, dur + 0.4, L.player.kind === 'bublik' ? 1.4 : 1.9);
  }

  /** §7.2.4 the echo: 1.5 s after a bar of the four, its last two words come back as a whisper (≤ once in 10 s);
   *  in the fight they are kept for the decoys to whisper back (§7.4 phase 2). Local to every machine. */
  private hookBarks() {
    const L = this.L;
    const orig = L.bark.bind(L);
    L.bark = (obj, str, dur, dy) => {
      orig(obj, str, dur, dy);
      if (!this.isHeroObj(obj) || str.startsWith('…')) return;
      const e = echoOf(str.replace(/^[А-ЯЁ][а-яё]+: /, ''));
      if (!e) return;
      this.heard.push(e);
      if (this.heard.length > 6) this.heard.shift();
      if (this.won || this.fight || L.t < this.echoT) return;
      this.echoT = L.t + ECHO.every;
      const at = obj.getWorldPosition(new THREE.Vector3());
      const yaw = obj.rotation.y;
      this.after(ECHO.delay, () => this.whispers.say(at.clone().add(V(-Math.sin(yaw) * 1.6, 0.3, -Math.cos(yaw) * 1.6)), e, 2.8));
    };
  }
  private isHeroObj(obj: THREE.Object3D) {
    const L = this.L;
    if (obj === L.player.root) return true;
    for (const h of L.heroes()) if ((h as unknown as { root?: THREE.Object3D }).root === obj) return true;
    if (this.cast) for (const k of ['tosha', 'bublik', 'noki', 'pastila'] as const) if (this.cast.figs[k].root === obj) return true;
    return false;
  }

  /** the maze (§7.2.3): the girl with the guitar stands behind the glass a cell or two ahead of me on the way out —
   *  every mirror around shows her pointing on; in the last cell she points at the mirror that is a doorway */
  private mazeGirl(dt: number) {
    const L = this.L, p = L.player.pos, gl = this.girl;
    const inMaze = p.z < -82.5 && p.z > -101.3 && Math.abs(p.x) < 12 && !L.inCutscene;
    gl.on = Math.max(0, Math.min(1, gl.on + (inMaze ? dt * 1.5 : -dt * 2)));
    if (!inMaze) return;
    if (!this.said.has('girl')) {
      this.said.add('girl');
      this.after(1.4, () => this.barkFor(MAZE_GIRL[0][0], MAZE_GIRL[0][1]));
      this.after(4.6, () => this.barkFor(MAZE_GIRL[1][0], MAZE_GIRL[1][1], 3));
    }
    let c = Math.floor((p.x + 12) / 3), r = Math.floor((-83 - p.z) / 3);
    c = Math.max(0, Math.min(7, c)); r = Math.max(0, Math.min(5, r));
    // two steps along the way out (fewer near the end); at the exit cell: in the doorway itself
    let cr = r, cc = c;
    for (let k = 0; k < 2; k++) {
      const here = MAZE_DIST.d.get(`${cr},${cc}`);
      if (here === undefined || here === 0) break;
      const next = ([[cr + 1, cc], [cr - 1, cc], [cr, cc + 1], [cr, cc - 1]] as [number, number][]).find(([r2, c2]) => MAZE_DIST.open(cr, cc, r2, c2) && MAZE_DIST.d.get(`${r2},${c2}`) === here - 1);
      if (!next) break;
      [cr, cc] = next;
    }
    const at = cr === 5 && cc === MAZE_EXIT_C && r === 5 && c === MAZE_EXIT_C ? V(this.exitAt.x, 0, this.exitAt.z - 1.4) : V(cellX(cc), 0, cellZ(cr));
    gl.flip = at.x < p.x;
    gl.pos.lerp(at, Math.min(1, dt * 2.5));
  }

  /** what the mirrors show (every machine, from what it draws) */
  private ghosts(): GhostSrc[] {
    const L = this.L, out: GhostSrc[] = [];
    if (L.castHidden && this.cast) {
      for (const k of ['tosha', 'bublik', 'pastila'] as const) { const r = this.cast.figs[k].root; if (r.visible) out.push({ kind: 'hero', pos: r.position, h: k === 'bublik' ? 0.8 : 1.15 }); }
    }
    for (const h of L.heroes()) {
      if (h.dead || h.hidden || L.castHidden) continue;
      const kind = h.isLocal ? L.player.kind : (h as unknown as { kind?: string }).kind;
      if (kind === 'noki') continue; // no shadow, no reflection
      out.push({ kind: 'hero', pos: h.pos, h: kind === 'bublik' ? 0.8 : 1.15 });
    }
    for (const e of L.enemies) if (!e.dead && e.kind === 'servant') out.push({ kind: 'servant', pos: e.body.pos, h: 1.0 });
    const b = this.boss?.ghost();
    if (b) out.push({ kind: 'boss', pos: b, h: 2.7 });
    if (!this.way[3].m.locked || this.L.player.pos.z > -112) out.push({ kind: 'exit', pos: this.exitAt, h: 3.6 });
    if (this.girl.on > 0.02) out.push({ kind: 'girl', pos: this.girl.pos, h: 1.5, flip: this.girl.flip, alpha: this.girl.on });
    if (this.sceneGhosts) out.push(...this.sceneGhosts);
    return out;
  }

  netEvent(_L: Level3D, ev: string, d: { p?: number[]; s?: string }) {
    if (ev === 'wh' && d.p && d.s) this.whispers.say(V(d.p[0], d.p[1], d.p[2]), d.s);
  }

  /** host: a whisper for everyone */
  whisperAll(at: THREE.Vector3, str: string) {
    this.whispers.say(at, str);
    this.L.nl?.entEvent(this, 'wh', { p: [Math.round(at.x * 10) / 10, Math.round(at.y * 10) / 10, Math.round(at.z * 10) / 10], s: str });
  }

  private hint(key: string, str: string) {
    if (this.hinted.has(key)) return;
    this.hinted.add(key);
    this.L.hint('f3' + key, str);
  }
  /** a bark of the four (§7.2.4) over MY hero — when it happens to the hero who says it */
  private four(kind: 'tosha' | 'bublik' | 'noki' | 'pastila') {
    const L = this.L;
    if (L.player.kind !== kind || this.said.has(kind) || L.inCutscene) return;
    this.said.add(kind);
    L.bark(L.player.root, FOUR[kind], 2.4, 1.9);
  }

  update(dt: number) {
    const L = this.L, p = L.player;
    this.cast?.update(dt);
    castMouths(L);
    if (this.timers.length) {
      for (const tm of this.timers) tm.t -= dt;
      const due = this.timers.filter((tm) => tm.t <= 0);
      this.timers = this.timers.filter((tm) => tm.t > 0);
      for (const tm of due) tm.f();
    }
    const busy = L.inCutscene || !p.control || L.worldCut;
    for (const w of this.way) { w.m.update(dt); w.m.interact(p, busy); }
    for (const m of this.arenaMirrors) { m.update(dt); m.interact(p, busy || !this.fight); }
    for (const d of this.doors) d.update(dt);
    this.domeDoor.update(dt); this.exitDoor.update(dt);
    for (const f of [...this.flowers, ...this.arenaFlowers]) f.update(dt, () => this.hint('pollen', TOAST.pollen));
    for (const m of this.motes) m.update(dt);
    for (const c of this.carts) c.update(dt);
    for (const s of this.sprinklers) s.update(dt);
    this.feet.update(dt);
    this.whispers.update(dt);
    this.bedCrystal.spin(dt);
    this.bud.update(dt);
    this.can.update(dt);
    this.kingMirror.update(dt);
    this.mazeGirl(dt);
    // Карамель's notes: reading one (standing at it), a bark of the four (§7.2.2)
    if (!L.inCutscene) for (const n of this.noteAt) {
      if (this.notesRead.has(n.key) || Math.hypot(p.pos.x - n.pos.x, p.pos.z - n.pos.z) > 2.6) continue;
      this.notesRead.add(n.key);
      const bs = NOTES.find((q) => q.key === n.key)!.barks;
      bs.forEach(([k, str], i) => this.after(0.9 + i * 2.6, () => this.barkFor(k, str)));
    }
    // Тоша, once, in the wing (§7.2.5)
    if (!this.said.has('toshaWing') && p.pos.z < -31 && p.pos.z > -78 && !L.inCutscene) { this.said.add('toshaWing'); this.barkFor('tosha', TOSHA_WING); }
    // invisible servants leave prints in the pollen
    for (const e of L.enemies) {
      if (e.dead || e.kind !== 'servant') continue;
      const inv = (e as unknown as { invis?: { vis: number } }).invis;
      if (inv && inv.vis < 0.7 && Math.hypot(e.body.vel.x, e.body.vel.z) > 0.3) this.feet.track(e, e.body.pos, 0.85, e.body.onGround);
      // Бублик steps on something invisible
      if (inv && inv.vis < 0.3 && e.body.pos.distanceTo(p.pos) < 1.0) this.four('bublik');
    }
    this.refl.update(L.t);
    // the glass lets the eye see the whole garden at once: things far from the camera aren't drawn
    if ((this.cullT -= dt) <= 0) {
      this.cullT = 0.2;
      const cam = L.tcam.cam.position, far = 70;
      const near = (q: THREE.Vector3) => Math.abs(q.x - cam.x) + Math.abs(q.z - cam.z) < far;
      for (const e of L.enemies) if (!e.dead) e.root.visible = near(e.body.pos);
      for (const l of this.V.lanterns) l.obj.visible = near(l.pos);
      for (const f of [...this.flowers, ...this.arenaFlowers]) f.cull(near(f.pos));
      for (const m of [...this.way.map((w) => w.m), ...this.arenaMirrors]) m.cull(near(m.pos));
    }
    // the dome's door: open once all four mirrors face the dome, shut during the fight
    const all = this.way.every((w) => w.m.locked);
    this.domeDoor.setOpen(all && !(this.fight && !this.won), !L.building);
    if (!all && p.pos.z < -104 && p.pos.z > -111 && Math.abs(p.pos.x) < 3) this.hint('shut', TOAST.domeShut);
    if (p.pos.z < -80.5 && p.pos.z > -101) this.hint('maze', TOAST.maze);
    if (Math.hypot(p.pos.x - this.exitAt.x, p.pos.z - this.exitAt.z) < 2.4 && p.pos.z > -101.6) this.hint('fake', TOAST.fakeMirror);
    if (p.pos.z < 26 && p.pos.z > 16 && Math.abs(p.pos.x) < 2) this.hint('sprinkler', TOAST.sprinkler);
    // pastila's flasks
    for (const h of L.hittables) {
      const b = h as unknown as { dead?: boolean; kind?: string; pos?: THREE.Vector3 };
      if (b.dead && b.kind === 'jar' && b.pos && !this.brokenSeen.has(h)) { this.brokenSeen.add(h); if (b.pos.distanceTo(p.pos) < 3) this.four('pastila'); }
    }
    // Ноки's chord (her kit stuns / reveals through the vampire kit, which reaches Шёпот too): her bark
    if (p.kind === 'noki' && p.atk === 'chord' && p.atkId !== this.lastAtk) { this.lastAtk = p.atkId; this.four('noki'); }
    // goal: the next mirror, then the dome
    const next = this.way.find((w) => !w.m.locked);
    L.refs.goalHint = next ? next.m.pos.clone() : !this.fight && !this.won ? ARENA.c.clone() : undefined;
    if (L.authority) this.host(dt);
    this.fightLocal(dt);
  }

  private host(dt: number) {
    const L = this.L;
    // story scenes that waited for a free moment
    if (this.pending.length && !L.worldCut && !L.inCutscene && !L.complete) L.run(this.pending.shift()!);
    // the dome: the fight begins when someone walks in
    if (!this.fight && !this.won && !L.worldCut && !L.seen.has('fangs3_boss_intro') && this.way.every((w) => w.m.locked)) {
      if (L.alivePlayers().some((h) => Math.hypot(h.pos.x - ARENA.c.x, h.pos.z - ARENA.c.z) < 15 && h.pos.z < -113)) L.run('fangs3_boss_intro');
    }
    // Шёпот along the way (§7.2.2): now and then, right behind somebody
    if (!this.fight && !this.won && !L.worldCut && (this.lvlWhT -= dt) <= 0) {
      this.lvlWhT = 28 + Math.random() * 16;
      const hs = L.alivePlayers();
      if (hs.length) {
        const h = hs[Math.floor(Math.random() * hs.length)];
        const f = h.forward(v1);
        this.whisperAll(h.pos.clone().addScaledVector(f, -2.2).setY(h.pos.y + 0.4), WHISPERS[this.lvlWhI++ % WHISPERS.length]);
      }
    }
  }

  /** the fight, on every machine: friends outside the dome are brought in; solo: the story helpers */
  private fightLocal(dt: number) {
    const L = this.L, b = this.boss, p = L.player;
    if (!b || !this.fight || this.won) return;
    if (b.active && !b.beaten && !p.dead && !p.downed && !L.worldCut && Math.hypot(p.pos.x - ARENA.c.x, p.pos.z - ARENA.c.z) > 18.5) {
      const a = Math.random() * Math.PI * 2;
      L.fx.stars(p.center(), 16);
      L.teleportMe(V(ARENA.c.x + Math.sin(a) * 9, 0.05, ARENA.c.z + Math.cos(a) * 9), a + Math.PI);
      L.fx.stars(p.center(), 20);
      L.hud.toast('Шёпот в куполе! Все сюда!');
    }
    // the four's barks during the fight (§7.4; over whoever plays them, the balcony NPC, or my hero with the name)
    if (b.active && !b.beaten && !L.inCutscene) {
      this.fightT += dt;
      const once = (k: string) => (this.said.has(k) ? false : (this.said.add(k), true));
      if (this.fightT > 4 && once('h:tosha')) this.barkFor('tosha', HELP.tosha);
      if (this.fightT > 9 && b.vis > 0.8 && once('h:bublik')) this.barkFor('bublik', HELP.bublik);
      if (b.phase === 3 && once('h:dark')) this.barkFor('pastila', HELP.pastilaDark, 3);
      if (p.kind === 'noki' && p.atk === 'chord' && once('h:noki')) this.barkFor('noki', HELP.noki);
    }
    // solo: the story NPC does the team's move (GDD §8)
    if (L.nl || !b.active || b.beaten || L.worldCut) return;
    if ((this.helpT -= dt) > 0) return;
    if (b.unseenT < 7) { this.helpT = 1; return; }
    const who = this.helpers.includes('pastila') && (Math.random() < 0.6 || !this.helpers.includes('noki')) ? 'pastila' : this.helpers.includes('noki') ? 'noki' : null;
    if (!who) return;
    const n = this.cast.figs[who];
    if (who === 'pastila') {
      const at = b.pos.clone().add(V((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2));
      this.V.light(at, { r: 4.2, secs: 5.5 });
      L.bark(n.root, HELP.pastila, 2.2, 1.8);
      this.cast.anim('pastila').attack = { kind: 'syringe', p: 0.5 };
      setTimeout(() => { if (this.cast) this.cast.anim('pastila').attack = null; }, 600);
      this.helpT = 15;
    } else {
      b.revealAll(4);
      L.bark(n.root, HELP.noki, 2.2, 1.8);
      L.fx.ring(n.root.position.clone().setY(n.root.position.y + 0.2), 4, '#c070ff', 0.6);
      L.fx.ring(ARENA.c.clone().setY(1), 16, '#c070ff', 0.8, false);
      this.cast.anim('noki').attack = { kind: 'chord', p: 0.5 };
      setTimeout(() => { if (this.cast) this.cast.anim('noki').attack = null; }, 800);
      audio.sfx('clang', { pitch: 1.6, volume: 0.6 });
      this.helpT = 17;
    }
  }

  /** solo: who helps from the balconies (the two of Пастила / Ноки the player isn't) */
  placeHelpers(on: boolean) {
    const L = this.L;
    if (L.nl) return;
    this.helpers = on ? (['pastila', 'noki'] as const).filter((k) => L.player.kind !== k) : [];
    for (const k of ['pastila', 'noki'] as const) {
      if (!this.helpers.includes(k)) { if (!on) this.cast.show(false, [k]); continue; }
      const s = k === 'pastila' ? 1 : -1;
      const a = Math.PI + s * Math.PI / 4;
      this.cast.show(true, [k]);
      this.cast.place(k, ARENA.c.x + Math.sin(a) * 17.2, 2.4, ARENA.c.z + Math.cos(a) * 17.2, a + Math.PI);
      this.cast.look(k, ARENA.c);
    }
    this.helpT = 8;
  }

  draw(ctx: CanvasRenderingContext2D) {
    const L = this.L;
    this.whispers.draw(ctx);
    if (L.inCutscene || L.player.dead) return;
    for (const m of [...this.way.map((w) => w.m), ...this.arenaMirrors]) {
      if (!m.near) continue;
      const s = toUI(m.pivot.clone().setY(m.pivot.y + 1.2), L.tcam.cam);
      if (!s.vis) continue;
      drawHint(ctx, 'interact', TOAST.turn, s.x - 100, s.y, { size: 26 });
    }
  }

  plugin(): LevelPlugin {
    return { update: (dt) => this.update(dt), draw: (ctx) => this.draw(ctx), dispose: () => { this.whispers.clear(); } };
  }
}

/** the bud of the noon root on the bed: closed → half open (the artificial noon) → open (the ending) */
export class Bud {
  private g = new THREE.Group();
  private petals: THREE.Group[] = [];
  private core: THREE.Mesh;
  private halo: THREE.Sprite;
  open = 0;
  private k = 0;
  private t = 0;
  constructor(private L: Level3D, x: number, y: number, z: number) {
    this.g.position.set(x, y, z);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 1.1, 8), mat('#3a8a4a')); stem.position.y = 0.55; this.g.add(stem);
    const head = new THREE.Group(); head.position.y = 1.15; this.g.add(head);
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), mat('#ffc94a', { emissive: '#ff9a10', emissiveIntensity: 0.4 }));
    head.add(this.core);
    for (let i = 0; i < 7; i++) {
      const pv = new THREE.Group(); pv.rotation.y = (i / 7) * Math.PI * 2; head.add(pv);
      const pe = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat(i % 2 ? '#ff9a3a' : '#ffd04a'));
      pe.scale.set(0.2, 0.55, 0.08); pe.position.set(0, 0.3, 0.22); pv.add(pe);
      this.petals.push(pv);
    }
    for (let i = 0; i < 3; i++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), mat('#4a9a5a'));
      leaf.scale.set(0.5, 0.05, 0.2); leaf.position.set(Math.cos(i * 2.1) * 0.4, 0.3, Math.sin(i * 2.1) * 0.4); leaf.rotation.y = -i * 2.1;
      this.g.add(leaf);
    }
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexLocal(), color: '#ffe9a0', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    this.halo.scale.setScalar(4); this.halo.position.y = 1.2;
    noOutline(this.halo);
    this.g.add(this.halo);
    L.deco(this.g);
  }
  get top() { return this.g.position.clone().setY(this.g.position.y + 1.2); }
  update(dt: number) {
    this.t += dt;
    this.k += (this.open - this.k) * Math.min(1, dt * 1.5);
    for (const pv of this.petals) pv.children[0].rotation.x = 0.15 + this.k * 1.2;
    (this.core.material as THREE.MeshToonMaterial).emissiveIntensity = 0.3 + this.k * 1.2 + Math.sin(this.t * 3) * 0.1 * this.k;
    (this.halo.material as THREE.SpriteMaterial).opacity = this.k * (0.7 + 0.2 * Math.sin(this.t * 2));
    void this.L;
  }
}
let gt: THREE.Texture | null = null;
function glowTexLocal() {
  if (gt) return gt;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  gt = new THREE.CanvasTexture(c);
  return gt;
}

export type { HeroLike };

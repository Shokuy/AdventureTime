import * as THREE from 'three';
import type { Built } from '../../../physics/types';
import type { Level3D } from '../../level';
import * as O from '../../../world/outdoor';
import { noOutline } from '../../../gfx';
import { B, tmat, bmat, mergeBuilts, boxCol } from './kit';
import { grassTex, cobbleTex, plazaTex, syrupTex, layersTex, boardTex } from './tex';
import * as T from './props';
import { DAY, NIGHT, type TownPalette } from './palette';

/**
 * Пастильное королевство laid out on the ground (x → east, z → south; y = 0 is the street level):
 *
 *            north wall (z −60) ── the princess's palace (towers) ──
 *                         the LABORATORY (0, −36), door to the south
 *   ── north street (z −25…−20) ───────────────────────────────────────
 *   houses │ west lane (x −32)        the SQUARE (r 16) + fountain      east lane (x 32) │ rooftop route
 *          │   SHOP (−23.5, 0) faces east ──┤      ├── MIRROR gazebo (22, 0) faces west │ (flat roofs → tower)
 *   ~~~~~~~~ strawberry-syrup creek (z 17…22): three pastila bridges (x −32, 0, 32) ~~~~~~~~
 *   ── south street (z 27…31) ── notice board (−7, 25) ──
 *   houses       market street: stalls at x ±7.5 (z 30…44)       houses
 *            south wall (z 54) with the GATE (0, 54) — spawn just inside, exit to the map through it
 *
 * buildTown(L, opts) adds it all to a level (sky, hills, ground + colliders, every prop) and returns the TownLayout:
 * named spots for the hub (NPCs, the shop, the mirror, the board, the gate) and for the night episode
 * («Клыки в пастиле»: lamps, roofs, the rooftop route, walk loops, streets).
 */

export interface V3 { x: number; y: number; z: number }
export interface TownOpts {
  /** the night variant (dark palette, lit windows and lamps); ignored when `pal` is given */
  night?: boolean;
  /** a palette of your own (e.g. a greyed-out town) */
  pal?: TownPalette;
  /** sky dome, hills and clouds (default true) */
  sky?: boolean;
  /** night: how many lamps also cast a real point light (the rest only glow; default 8) */
  lampLights?: number;
  /** leave out the hub's interaction props (shop counter sign, mirror, notice board, stall goods stay) */
  noHubProps?: boolean;
  /** the board over the gate's inner face (default «НА КАРТУ ХРУМЛЯНДИИ») */
  gateLabel?: string;
  /** notes on the notice board (hub) */
  notes?: { title: string; lines: string[] }[];
}

export interface TownLayout {
  pal: TownPalette;
  spawn: V3 & { yaw: number };
  /** the passage through the gate (leaving the town → the map); `out` is just outside */
  gate: { x: number; z: number; zone: { min: V3; max: V3 }; out: V3 };
  square: { x: number; z: number; r: number };
  fountain: { x: number; z: number; r: number };
  shop: { keeper: V3; keeperYaw: number; counter: V3 };
  mirror: { at: V3; front: V3; yaw: number };
  lab: { door: V3; princess: V3; princessYaw: number; center: V3; r: number };
  board: { at: V3; front: V3 };
  /** the clock tower on the square (the night episode gathers here) */
  clock: { x: number; z: number; r: number; top: number };
  /** the bakery (Мадам Безе) and the post (Пончик): their doors */
  bakery: V3; post: V3;
  stalls: { at: V3; yaw: number; keeper: V3 }[];
  benches: { seat: V3; yaw: number }[];
  lamps: V3[];
  houses: { x: number; z: number; w: number; d: number; rotY: number; eave: number; ridge: number; flat: boolean }[];
  /** the rooftop run in the east quarter: points from the crates up to the tower balcony (walnut spot last) */
  roofRoute: V3[];
  towers: { x: number; z: number; r: number; top: number; balcony?: number }[];
  bridges: { x: number; z: number; len: number; w: number; rotY: number }[];
  streets: { x0: number; z0: number; x1: number; z1: number }[];
  /** closed loops townsfolk can stroll along (and night patrols) */
  walks: V3[][];
  creek: { z0: number; z1: number; floor: number; water: number };
  /** the town wall's inner bounds */
  bounds: { x0: number; x1: number; z0: number; z1: number };
}

const v = (x: number, y: number, z: number): V3 => ({ x, y, z });

export function buildTown(L: Level3D, opts: TownOpts = {}): TownLayout {
  const pal = opts.pal ?? (opts.night ? NIGHT : DAY);
  const lit = { n: 0, max: opts.lampLights ?? 8 };
  const lay: TownLayout = {
    pal,
    spawn: { x: 0, y: 0, z: 46, yaw: Math.PI },
    gate: { x: 0, z: 54, zone: { min: v(-2.9, -1, 53.6), max: v(2.9, 4, 58) }, out: v(0, 0, 59) },
    square: { x: 0, z: 0, r: 16 },
    fountain: { x: 0, z: 0, r: 4.5 },
    shop: { keeper: v(0, 0, 0), keeperYaw: Math.PI / 2, counter: v(0, 0, 0) },
    mirror: { at: v(23.6, 0, 0), front: v(21.0, 0, 0), yaw: -Math.PI / 2 },
    lab: { door: v(0, 0, 0), princess: v(0, 0, 0), princessYaw: 0, center: v(0, 0, -36), r: 6 },
    board: { at: v(-8.5, 0, 24.6), front: v(-6.7, 0, 24.6) },
    clock: { x: -13.5, z: -15.5, r: 2.6, top: 0 },
    bakery: v(-14.5, 0, 32.2), post: v(14.5, 0, 32.2),
    stalls: [], benches: [], lamps: [], houses: [], roofRoute: [], towers: [], bridges: [], streets: [], walks: [],
    creek: { z0: 17, z1: 22, floor: -0.9, water: -0.42 },
    bounds: { x0: -55, x1: 55, z0: -59, z1: 53 },
  };

  if (opts.sky !== false) buildSky(L, pal);
  buildGround(L, pal, lay);

  const districts: Record<string, Built[]> = { center: [], south: [], creek: [], west: [], east: [], north: [], walls: [] };
  const put = (d: string, b: Built) => { districts[d].push(b); return b; };
  const lamp = (d: string, x: number, z: number, y = 0) => {
    const light = pal.lampsLit && lit.n < lit.max;
    if (light) lit.n++;
    lay.lamps.push(v(x, y, z));
    return put(d, T.marmaladeLamp({ x, y, z, pal, light, rotY: x < 0 ? 0 : 2 }));
  };
  const house = (d: string, o: T.HouseOpts) => {
    const b = T.gingerHouse({ ...o, pal });
    lay.houses.push({ x: o.x, z: o.z, w: o.w, d: o.d, rotY: o.rotY ?? 0, eave: b.eave, ridge: b.ridge, flat: !!o.flat });
    return put(d, b);
  };
  const tower = (d: string, o: T.TowerOpts) => {
    const b = T.marshmallowTower({ ...o, pal });
    lay.towers.push({ x: o.x, z: o.z, r: o.r, top: b.top, ...(b.balconyTop !== undefined ? { balcony: b.balconyTop } : {}) });
    return put(d, b);
  };
  const tree = (d: string, x: number, z: number, kind: T.TreeKind = 'gumdrop', s = 1, color?: string) => put(d, T.candyTree({ x, y: 0, z, s, kind, pal, ...(color ? { color } : {}) }));
  const fence = (d: string, x0: number, z0: number, x1: number, z1: number) => put(d, T.caneFence({ x0, z0, x1, z1, y: 0, pal }));

  // ───────────── walls, corner towers, the gate ─────────────
  put('walls', T.townWall({ x0: -56, z0: -60, x1: 56, z1: -60, y: 0, pal }));
  put('walls', T.townWall({ x0: -56, z0: -60, x1: -56, z1: 54, y: 0, pal }));
  put('walls', T.townWall({ x0: 56, z0: -60, x1: 56, z1: 54, y: 0, pal }));
  put('walls', T.townWall({ x0: -56, z0: 54, x1: -7.6, z1: 54, y: 0, pal }));
  put('walls', T.townWall({ x0: 7.6, z0: 54, x1: 56, z1: 54, y: 0, pal }));
  for (const [x, z] of [[-56, -60], [56, -60], [-56, 54], [56, 54]] as const) tower('walls', { x, y: 0, z, r: 3, h: 11, seed: Math.round(x * 3 + z) });
  put('south', T.castleGate({ x: 0, y: 0, z: 54, w: 6, pal, labelIn: opts.gateLabel ?? 'НА КАРТУ ХРУМЛЯНДИИ' }));
  // outside the gate: the road on toward the map with candy trees along it (out of reach — the gate leads to the map)
  for (let i = 0; i < 6; i++) {
    const z = 64 + i * 7.5, k = i % 3;
    tree('south', -(5.5 + k * 1.6), z, (['gumdrop', 'lolly', 'cotton'] as const)[k], 1.1 - k * 0.1, pal.candy[i % pal.candy.length]);
    tree('south', 5.8 + ((i + 1) % 3) * 1.4, z + 3.6, (['cotton', 'gumdrop', 'lolly'] as const)[k], 1.0, pal.candy[(i + 3) % pal.candy.length]);
  }
  put('south', T.townSignpost({ x: 3.6, y: 0, z: 66, rotY: 2, label: 'ХРУМЛЯНДИЯ', pal }));
  // invisible sides outside the gate (the gate is the way to the map)
  L.col([boxCol(-3.6, 0, 55.2, -2.9, 30, 62), boxCol(2.9, 0, 55.2, 3.6, 30, 62), boxCol(-3.6, 0, 61.5, 3.6, 30, 62.2)]);

  // ───────────── the square: fountain, benches, lamps, flowerbeds ─────────────
  put('center', T.fountain({ x: 0, y: 0, z: 0, r: 4.5, pal }));
  for (const [x, z, r] of [[-7, -10, 0], [7, -10, 0], [-7, 10, 2], [7, 10, 2]] as const) {
    put('center', T.candyBench({ x, y: 0, z, rotY: r, pal, color: pal.candy[(x > 0 ? 1 : 0) + (z > 0 ? 2 : 0)] }));
    lay.benches.push({ seat: v(x, 0.55, z + (r === 0 ? 0.05 : -0.05)), yaw: r === 0 ? 0 : Math.PI });
  }
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) / 8 * Math.PI * 2;
    lamp('center', Math.sin(a) * 15.2, Math.cos(a) * 15.2);
  }
  for (const [x, z] of [[-11, -10], [11, -10], [-11, 10], [11, 10]] as const) put('center', T.flowerBed({ x, y: 0, z, w: 3, d: 2.6, pal }));

  // the clock tower at the square's north-west corner
  const clock = T.clockTower({ x: lay.clock.x, y: 0, z: lay.clock.z, r: lay.clock.r, h: 13, pal });
  put('center', clock);
  lay.clock.top = clock.top;

  // ───────────── the shop (west of the square) ─────────────
  const shop = T.shopHouse({ x: -23.5, y: 0, z: 0, rotY: 1, pal, label: 'МЕДОВАЯ ЛАВКА' });
  put('center', shop);
  lay.shop = { keeper: { x: shop.keeper.x, y: shop.keeper.y, z: shop.keeper.z }, keeperYaw: Math.PI / 2, counter: { x: shop.counter.x, y: 0, z: shop.counter.z } };
  tree('center', -19.5, -6.5, 'lolly', 0.9, pal.candy[0]);
  tree('center', -19.5, 6.5, 'cotton', 0.9, pal.candy[4]);
  put('center', T.candyCrate({ x: -21.4, y: 0, z: 5.2, s: 0.9, pal }));
  for (const [x, z, sc] of [[-20.4, 4.2, 1], [-20.2, -5.3, 0.9], [-19.4, -5.0, 0.7]] as const) put('center', T.honeyBarrel({ x, y: 0, z, s: sc, pal }));

  // ───────────── the hero mirror in a gazebo (east of the square) ─────────────
  put('center', gazebo(22, 0, pal));
  if (!opts.noHubProps) put('center', T.heroMirror({ x: 23.6, y: 0.3, z: 0, rotY: 3, pal }));
  lamp('center', 18.2, -4.6); lamp('center', 18.2, 4.6);
  tree('center', 27.5, -6, 'gumdrop', 1.1, pal.candy[3]);
  tree('center', 27.5, 6, 'gumdrop', 1.0, pal.candy[1]);

  // ───────────── the laboratory and the palace (north) ─────────────
  const lab = T.laboratory({ x: 0, y: 0, z: -36, r: 6, pal });
  put('north', lab);
  lay.lab = { door: { x: lab.door.x, y: 0, z: lab.door.z }, princess: { x: lab.princess.x, y: 0, z: lab.princess.z }, princessYaw: 0, center: v(0, 0, -36), r: 6 };
  lamp('north', -3.6, -28.2); lamp('north', 3.6, -28.2);
  house('north', { x: 0, y: 0, z: -53.5, w: 22, d: 8, h: 7.5, roofH: 3.4, wall: pal.walls[0], roof: pal.roofs[0], chimney: false, door: false, seed: 900 });
  tower('north', { x: 0, y: 0, z: -49.5, r: 4.2, h: 21, roof: pal.roofs[0], seed: 901 });
  tower('north', { x: -12.5, y: 0, z: -52, r: 3.0, h: 15.5, roof: pal.roofs[2], seed: 902 });
  tower('north', { x: 12.5, y: 0, z: -52, r: 3.0, h: 15.5, roof: pal.roofs[2], seed: 903 });
  tower('north', { x: -19, y: 0, z: -55, r: 2.3, h: 11.5, roof: pal.roofs[1], seed: 904 });
  tower('north', { x: 19, y: 0, z: -55, r: 2.3, h: 11.5, roof: pal.roofs[1], seed: 905 });
  for (const sx of [-1, 1]) { tree('north', sx * 9.5, -34, 'gumdrop', 1.2, pal.candy[sx > 0 ? 0 : 4]); tree('north', sx * 9, -42, 'cotton', 1.0, pal.candy[sx > 0 ? 2 : 1]); }
  put('north', T.flowerBed({ x: -7.5, y: 0, z: -29.5, w: 3.2, d: 1.6, pal }));
  put('north', T.flowerBed({ x: 7.5, y: 0, z: -29.5, w: 3.2, d: 1.6, pal }));

  // north-west / north-east rows along the north street (facing south)
  const rowN: [number, number, number, number, number][] = [[-46, 5, 5, 3.6, 0], [-38.5, 6, 6, 4.4, 1], [-30.5, 5, 5, 3.4, 2], [-22.5, 6, 5, 4.2, 3], [-14.5, 5, 4.6, 3.6, 4]];
  for (const [x, w, d, h, s] of rowN) {
    house(x < 0 ? 'west' : 'east', { x, y: 0, z: -29.5 - d / 2, w, d, h, rotY: 0, seed: 100 + s });
    house('east', { x: -x, y: 0, z: -29.5 - d / 2, w, d, h: h + (s % 2 ? -0.4 : 0.3), rotY: 0, seed: 200 + s });
  }
  for (const [x, z] of [[-46, -46], [-36, -47], [36, -47], [46, -46]] as const) house(x < 0 ? 'west' : 'east', { x, y: 0, z, w: 6, d: 6, h: 4.2, rotY: 0, seed: 300 + x });
  tree('west', -27, -45, 'gumdrop', 1.2); tree('west', -50, -38, 'lolly', 1.1); tree('east', 50, -38, 'lolly', 1.1);
  for (const x of [-44, -26, 26, 44]) lamp(x < 0 ? 'west' : 'east', x, -25.6);

  // ───────────── west quarter (houses facing the west lane) ─────────────
  for (const [z, h, s] of [[-12, 3.8, 0], [-3.5, 4.4, 1], [5, 3.6, 2], [12.5, 4.0, 3]] as const) house('west', { x: -38.5, y: 0, z, w: 5.6, d: 6, h, rotY: 1, seed: 400 + s });
  for (const [z, h, s] of [[-8, 4.2, 0], [4, 3.8, 1]] as const) house('west', { x: -48.5, y: 0, z, w: 7, d: 6, h, rotY: 1, seed: 450 + s });
  tree('west', -48, -16, 'cotton', 1.0); tree('west', -48.5, 12.5, 'gumdrop', 1.1); tree('west', -27.5, -14, 'gumdrop', 1.0, pal.candy[2]); tree('west', -27, 12, 'lolly', 0.9);
  fence('west', -52.5, 15.5, -43, 15.5); fence('west', -52.5, -16.5, -43.5, -16.5);
  lamp('west', -29.2, -10); lamp('west', -29.2, 8);

  // ───────────── east quarter: houses + the rooftop route ─────────────
  // R1 (flat, low) → R2 (flat) → bridge → R3 (flat) → R4 (gingerbread ridge) → the tower balcony (walnut)
  house('east', { x: 38.5, y: 0, z: -12, w: 5, d: 6, h: 3.0, rotY: 3, flat: true, door: true, seed: 501 });
  house('east', { x: 38.5, y: 0, z: -4.5, w: 5, d: 6, h: 4.4, rotY: 3, flat: true, seed: 502 });
  house('east', { x: 38.5, y: 0, z: 4.5, w: 5, d: 6, h: 4.4, rotY: 3, flat: true, seed: 503 });
  house('east', { x: 38.5, y: 0, z: 12.0, w: 5, d: 6, h: 4.4, rotY: 3, roofH: 2.2, seed: 504 });
  put('east', T.pastilaBridge({ x: 38.5, y: 4.72, z: 0, len: 4.6, w: 1.7, rotY: 1, rails: true, pal, th: 0.35 }));
  lay.bridges.push({ x: 38.5, z: 0, len: 4.6, w: 1.7, rotY: 1 });
  const rt = tower('east', { x: 46, y: 0, z: 9.5, r: 2.4, h: 11, balcony: 7.7, roof: pal.roofs[5], seed: 505 });
  void rt;
  put('east', T.candyCrate({ x: 36.4, y: 0, z: -15.9, s: 1.3, pal }));
  put('east', T.candyCrate({ x: 38.0, y: 0, z: -16.0, s: 1.2, pal, color: pal.candy[0] }));
  put('east', T.candyCrate({ x: 37.9, y: 1.2, z: -16.0, s: 1.0, pal, color: pal.candy[4] }));
  lay.roofRoute = [v(36.4, 1.3, -15.9), v(37.9, 2.2, -16.0), v(38.5, 3.32, -12), v(38.5, 4.72, -4.5), v(38.5, 4.72, 0), v(38.5, 4.72, 4.5), v(38.5, 6.6, 12), v(42.4, 7.7, 9.5), v(46, 7.7, 12.6)];
  house('east', { x: 48.5, y: 0, z: -9, w: 7, d: 6, h: 4.0, rotY: 3, seed: 551 });
  house('east', { x: 49.5, y: 0, z: 1, w: 6, d: 5, h: 3.4, rotY: 3, seed: 552 });
  tree('east', 48, -16, 'cotton', 1.0, pal.candy[0]); tree('east', 27.5, -14, 'gumdrop', 1.0, pal.candy[4]); tree('east', 27, 12, 'lolly', 0.9, pal.candy[1]);
  fence('east', 43, -16.5, 52.5, -16.5); fence('east', 41.5, 15.5, 43.5, 15.5);
  lamp('east', 29.2, -10); lamp('east', 29.2, 8);

  // ───────────── the creek's banks: bridges, fences, trees ─────────────
  for (const [x, len, w, arch] of [[0, 9.2, 7, 0.9], [-32, 8.4, 3.6, 1.1], [32, 8.4, 3.6, 1.1]] as const) {
    put('creek', T.pastilaBridge({ x, y: 0, z: 19.5, len, w, rotY: 1, arch, pal }));
    lay.bridges.push({ x, z: 19.5, len, w, rotY: 1 });
    for (const sx of [-1, 1]) for (const z of [14.6, 24.4]) lamp('creek', x + sx * (w / 2 + 0.7), z);
  }
  const gaps = [[-34.3, -29.7], [-3.9, 3.9], [29.7, 34.3]];
  for (const z of [16.7, 22.3]) {
    let x0 = -55.2;
    for (const [g0, g1] of gaps) { fence('creek', x0, z, g0, z); x0 = g1; }
    fence('creek', x0, z, 55.2, z);
  }
  for (const x of [-48, -42, -21, -12, 12, 21, 42, 48]) { tree('creek', x, 25.5, x % 2 ? 'lolly' : 'gumdrop', 0.95); tree('creek', x + 3, 13.5, 'cotton', 0.85); }

  // ───────────── south: the market street, the notice board, houses by the wall ─────────────
  const goods: T.Goods[] = ['jars', 'candy', 'cakes', 'balloons', 'candy'];
  const labels = ['ВАРЕНЬЕ', 'КОНФЕТЫ', 'ПИРОЖНЫЕ', 'ШАРИКИ', 'ЛЕДЕНЦЫ'];
  [[-7.5, 31.5, 1], [-7.5, 37.5, 1], [-7.5, 43.5, 1], [7.5, 34.5, 3], [7.5, 40.5, 3]].forEach(([x, z, r], i) => {
    put('south', T.marketStall({ x, y: 0, z, rotY: r, goods: goods[i], label: labels[i], pal, color: pal.candy[i] }));
    const kx = x + (r === 1 ? -1.4 : 1.4);
    lay.stalls.push({ at: v(x, 0, z), yaw: r === 1 ? Math.PI / 2 : -Math.PI / 2, keeper: v(kx, 0, z) });
  });
  if (!opts.noHubProps) put('south', T.noticeBoard({ x: lay.board.at.x, y: 0, z: lay.board.at.z, rotY: 1, pal, notes: opts.notes ?? [{ title: 'Объявления', lines: ['Скоро!'] }] }));
  for (const z of [29, 37.5, 46.5]) { lamp('south', -4.7, z); lamp('south', 4.7, z); }
  for (const [x, w, h, s] of [[-14.5, 5, 3.8, 0], [-22.5, 6, 4.4, 1], [-38.5, 6, 4.0, 2], [-46.5, 5, 3.6, 3]] as const) {
    house('south', { x, y: 0, z: 35, w, d: 5, h, rotY: 2, seed: 600 + s });
    house('south', { x: -x, y: 0, z: 35, w, d: 5, h: h + 0.3, rotY: 2, seed: 650 + s });
  }
  for (const [x, z] of [[-30, 46], [-46, 47], [30, 46], [46, 47], [-16, 47], [16, 47]] as const) house('south', { x, y: 0, z, w: 6, d: 5, h: 3.6, rotY: 0, seed: 700 + x });
  // the bakery (−14.5) and the post (14.5) on the south street
  put('south', T.facadeSign({ x: -14.5, y: 2.75, z: 32.42, rotY: 2, label: 'ПЕКАРНЯ', color: '#ffb3cc', pal }));
  put('south', T.facadeSign({ x: 14.5, y: 2.75, z: 32.42, rotY: 2, label: 'ПОЧТА', color: '#7ab8ff', pal }));
  put('south', T.mailbox({ x: 12.2, y: 0, z: 31.6, rotY: 2, pal }));
  put('south', T.candyCrate({ x: -17.2, y: 0, z: 31.8, s: 0.8, pal, color: pal.candy[0] }));
  for (const x of [-22.5, 22.5, -38.5, 38.5]) tree('south', x, 45, x > 0 ? 'gumdrop' : 'lolly', 1.0);
  tree('south', -11.5, 50, 'cotton', 1.0, pal.candy[0]); tree('south', 11.5, 50, 'cotton', 1.0, pal.candy[1]);
  for (const x of [-30, -16, 16, 30]) lamp('south', x, 32.6);

  // ───────────── merge per district (few draw calls, still culled by district) ─────────────
  for (const [name, parts] of Object.entries(districts)) if (parts.length) L.add(mergeBuilts('town-' + name, parts));

  // ───────────── spots for scripts ─────────────
  lay.streets = [
    { x0: -4, z0: 24, x1: 4, z1: 54 }, { x0: -4, z0: -30, x1: 4, z1: -15 },
    { x0: -52, z0: 27, x1: 52, z1: 31 }, { x0: -52, z0: -25, x1: 52, z1: -20 },
    { x0: -34, z0: -20, x1: -30, z1: 27 }, { x0: 30, z0: -20, x1: 34, z1: 27 },
    { x0: -21, z0: -4, x1: -15, z1: 4 }, { x0: 15, z0: -4, x1: 19.5, z1: 4 },
  ];
  lay.walks = [
    // around the fountain
    Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return v(Math.sin(a) * 7.2, 0, Math.cos(a) * 7.2); }),
    // the market street and the bridge
    [v(-1.6, 0, 47), v(-1.6, 0, 27), v(1.6, 0, 27), v(1.6, 0, 47)],
    // the north street, lab to the lanes
    [v(-30, 0, -22.5), v(30, 0, -22.5), v(30, 0, -21.8), v(-30, 0, -21.8)],
    // the south street
    [v(-48, 0, 29), v(48, 0, 29), v(48, 0, 29.6), v(-48, 0, 29.6)],
  ];
  return lay;
}

// ───────────────────────── sky, hills, clouds ─────────────────────────

function buildSky(L: Level3D, pal: TownPalette) {
  const sd = new THREE.Vector3(...pal.sun.dir).normalize();
  const az = Math.atan2(sd.x, -sd.z);
  const sky = O.skyDome(pal.sky, sd, { sunSize: pal.night ? 0.08 : 0.05, moonDir: pal.night ? sd : new THREE.Vector3(-0.3, 0.6, -0.7), moonSize: pal.night ? 0.07 : 0.02 });
  L.deco(sky.mesh);
  const hl = pal.hills;
  L.deco(O.hillRings([
    { r: 140, base: -8, amp: 10, seed: 31, color: hl[0].color, rim: hl[0].rim, haze: hl[0].haze, bumps: 3.2, seg: 900 },
    { r: 200, base: -4, amp: 18, seed: 32, color: hl[1].color, rim: hl[1].rim, haze: hl[1].haze, bumps: 2.0, seg: 900 },
    { r: 280, base: 2, amp: 30, seed: 33, color: hl[2].color, rim: hl[2].rim, haze: hl[2].haze, seg: 700 },
    { r: 380, base: 10, amp: 52, seed: 34, color: hl[3].color, rim: hl[3].rim, haze: hl[3].haze, seg: 512, notch: 0.3 },
  ], az, pal.night ? '#2a2a5a' : '#c8b8f0'));
  L.deco(O.cloudBank([
    { az: -0.5, el: 0.16, dist: 600, w: 150, h: 30, seed: 11 },
    { az: 0.5, el: 0.2, dist: 640, w: 130, h: 26, seed: 12 },
    { az: 1.6, el: 0.13, dist: 620, w: 120, h: 24, seed: 13 },
    { az: 2.6, el: 0.22, dist: 660, w: 170, h: 28, seed: 14 },
    { az: -1.7, el: 0.12, dist: 600, w: 110, h: 22, seed: 15 },
    { az: -2.6, el: 0.18, dist: 650, w: 140, h: 26, seed: 16 },
  ], az, pal.clouds));
  // a big pale meadow under everything beyond the walls
  const meadow = new THREE.Mesh(new THREE.CircleGeometry(150, 48).rotateX(-Math.PI / 2), tmat(grassTex(pal.grass, pal.grassDots), '#ffffff'));
  const uv = meadow.geometry.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 30, uv.getY(i) * 30);
  (meadow.material as THREE.MeshToonMaterial).map!.wrapS = THREE.RepeatWrapping;
  meadow.position.y = -0.06; meadow.receiveShadow = true;
  L.deco(meadow);
  // big candy "mountains" on the horizon: cone silhouettes with icing caps
  const peaks = new THREE.Group();
  for (const [a, d, h, c] of [[-0.9, 120, 34, hl[1].color], [-0.6, 135, 26, hl[2].color], [0.7, 125, 30, hl[0].color], [2.4, 115, 22, hl[1].color], [-2.4, 118, 28, hl[2].color], [1.2, 140, 40, hl[3].color]] as const) {
    const x = Math.sin(a) * d, z = -Math.cos(a) * d;
    const m = new THREE.Mesh(new THREE.ConeGeometry(h * 0.7, h, 20), bmat(c));
    m.position.set(x, h / 2 - 2, z); peaks.add(m);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(h * 0.7 * 0.32, h * 0.32, 20), bmat(pal.night ? '#8a8ab0' : '#ffffff'));
    cap.position.set(x, h - 2 - h * 0.16 + 0.05, z); peaks.add(cap);
  }
  noOutline(peaks);
  L.deco(peaks);
}

// ───────────────────────── ground, paths, the square, the creek ─────────────────────────

function plane(w: number, d: number, tile: number) {
  const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tile, uv.getY(i) * d / tile);
  return g;
}

function buildGround(L: Level3D, pal: TownPalette, lay: TownLayout) {
  const { z0, z1, floor, water } = lay.creek;
  const grassM = tmat(grassTex(pal.grass, pal.grassDots));
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.receiveShadow = true; me.updateMatrix(); me.matrixAutoUpdate = false; L.deco(me); return me;
  };
  // grass (north and south of the creek)
  add(plane(124, z0 + 66, 9), grassM, 0, 0, (z0 - 66) / 2);
  add(plane(124, 62 - z1, 9), grassM, 0, 0, (62 + z1) / 2);
  L.col([boxCol(-62, -3, -66, 62, 0, z0), boxCol(-62, -3, z1, 62, 0, 62), boxCol(-62, -4, z0, 62, floor, z1)]);
  // paths: cobble strips (decals on the grass)
  const cob = tmat(cobbleTex(pal.cobble, pal.cobbleGap), '#ffffff', { decal: true });
  const strip = (x0: number, za: number, x1: number, zb: number, y = 0.012) => add(plane(x1 - x0, zb - za, 3.2), cob, (x0 + x1) / 2, y, (za + zb) / 2);
  strip(-4, z1, 4, 62);
  strip(-4, -30, 4, -14);
  strip(-52, 27, 52, 31, 0.014);
  strip(-52, -25, 52, -20, 0.014);
  strip(-34, -20, -30, z0); strip(-34, z1, -30, 27);
  strip(30, -20, 34, z0); strip(30, z1, 34, 27);
  strip(-21, -4, -14, 4); strip(14, -4, 19.5, 4);
  strip(-4, 14, 4, z0);
  // the square: a disc of concentric pastel tiles
  const pg = new THREE.RingGeometry(0.01, lay.square.r, 64, 8).rotateX(-Math.PI / 2);
  {
    const p = pg.attributes.position as THREE.BufferAttribute, uv = pg.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      uv.setXY(i, ((Math.atan2(x, z) / (Math.PI * 2)) + 1) % 1 * 2, Math.hypot(x, z) / lay.square.r);
    }
  }
  add(pg, tmat(plazaTex(pal.plaza, pal.plazaGap), '#ffffff', { decal: true }), lay.square.x, 0.02, lay.square.z);
  // gate road outside (and on across the meadow)
  strip(-2.9, 54, 2.9, 62, 0.016);
  strip(-2.9, 62, 2.9, 106, -0.045);
  // the creek: syrup bed, banks of layered pastila, the flowing surface
  add(plane(124, z1 - z0, 6), tmat(null, pal.syrup), 0, floor + 0.01, (z0 + z1) / 2);
  const bankM = tmat(layersTex(pal.bank, 8));
  for (const [z, ry] of [[z0, 0], [z1, Math.PI]] as const) {
    const g = new THREE.PlaneGeometry(124, -floor + 0.02);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 124 / 3, uv.getY(i));
    const m = add(g, bankM, 0, floor / 2, z);
    m.rotation.y = ry; m.updateMatrix();
  }
  const st = syrupTex(pal.syrup, pal.syrupLight).clone(); st.needsUpdate = true; st.wrapS = st.wrapT = THREE.RepeatWrapping;
  const surf = add(plane(124, z1 - z0, 5), tmat(st, '#ffffff', { transparent: true, opacity: 0.88 }), 0, water, (z0 + z1) / 2);
  surf.renderOrder = 1;
  L.updaters.push((t) => { st.offset.set(t * 0.12, Math.sin(t * 0.5) * 0.02); });
}

// ───────────────────────── the mirror's gazebo ─────────────────────────

function gazebo(x: number, z: number, pal: TownPalette): Built {
  const b = new B('gazebo');
  const r = 3.4, h = 3.6;
  const floorM = tmat(layersTex([pal.icing, pal.walls[5], pal.icing], 3));
  b.m(new THREE.CylinderGeometry(r + 0.3, r + 0.45, 0.3, 32), floorM, 0, 0.15, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.cy(tmat(null, pal.icing), 0.14, h, Math.sin(a) * r, 0.3, Math.cos(a) * r, 10);
    b.m(new THREE.TorusGeometry(0.2, 0.08, 6, 12), tmat(null, pal.roofs[5]), Math.sin(a) * r, h + 0.2, Math.cos(a) * r, { rx: Math.PI / 2 });
    b.cyl(Math.sin(a) * r, Math.cos(a) * r, 0.18, 0.3, h + 0.3);
  }
  // meringue dome roof
  b.m(new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), tmat(null, pal.walls[5]), 0, h + 0.25, 0, { sx: r + 0.7, sy: 2.0, sz: r + 0.7 });
  b.m(new THREE.TorusGeometry(r + 0.6, 0.22, 8, 40), tmat(null, pal.icing), 0, h + 0.28, 0, { rx: Math.PI / 2 });
  b.m(new THREE.ConeGeometry(0.5, 1.4, 16), tmat(null, pal.roofs[5]), 0, h + 2.9, 0);
  b.sp(tmat(null, '#ffd34a'), 0.25, 0, h + 3.7, 0, 12);
  b.box(-r - 0.3, 0, -r - 0.3, r + 0.3, 0.3, r + 0.3);
  b.cyl(0, 0, r + 0.6, h + 0.2, h + 1.6);
  return b.done(x, 0, z, 0);
}

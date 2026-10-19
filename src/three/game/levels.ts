import * as THREE from 'three';
import type { MusicName } from '../../engine/audio';
import type { CamMode } from '../camera';
import { srand } from '../../engine/util';
import type { Level3D } from './level';
import type { HeroKind } from '../../net/profile';
import * as P from '../world/props';
import { room } from '../world/rooms';
import { BOOK_COLORS, mat } from '../gfx';
import type { Built } from '../physics/types';
import { Blocker3 } from './chase';
import { magicBookPortal } from '../world/portal';
import type { MagicBookPortal } from '../world/portal';
import { coopStash } from './plates';
import { coop } from './coop';

/** the library's exit book (read by the library hook/scripts) */
export const LIB_PORTAL: { book: MagicBookPortal | null } = { book: null };

export interface Level3Def {
  id: string; chapter: number; title: string; subtitle: string;
  music: MusicName;
  spawn: [number, number, number]; yaw: number; killY: number;
  bg: string; fog: [string, number, number];
  hemi: [string, string, number];
  sun: { color: string; intensity: number; dir: [number, number, number] };
  startScript?: string;
  camMode?: CamMode;
  /** falling further than this (m) counts as a pit: −1 heart and back to the last safe spot */
  fallLimit?: number;
  /**
   * with fallLimit: a long fall is NOT a pit — no heart lost, no trip back up: you land where you fall (the library
   * floor) with a tumble, and climb again (co-op hardcore: knocked out there until a friend comes down)
   */
  fallToFloor?: boolean;
  /** the line under «ОЙ-ОЙ-ОЙ!» when the hero is knocked out (default: a nameless one — any hero can read it) */
  deathText?: string;
  /**
   * «Хрумляндия»: who the players play here. Unset = the prologue's chapters (and PvP) are Tosha, every other level is
   * each player's pick (heroes/index.ts heroKindFor). Set a kind to force it.
   */
  hero?: HeroKind;
  /**
   * «Сюжетный состав» (GDD 8): while the cinematic bars are down, every player figure (mine and friends', with their
   * shadows and nameplates) is hidden — the story cast (L.npc('tosha' | 'bublik' | 'noki' | 'pastila', …)) acts the
   * scene; the players reappear where they stood when the bars go up. Arc levels with story scenes set this.
   */
  castScenes?: boolean;
  build(L: Level3D): void;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** box collider helper for invisible blockers */
const boxCol = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => ({ kind: 'box' as const, min: V(x0, y0, z0), max: V(x1, y1, z1) });

// ════════════════════════════ CHAPTER 1 — PANTRY ════════════════════════════
// Floor y=0. North wall shelving: board 1 top y=8, board 2 top y=17 (z from -30 to -16).
function pantry(): Level3Def {
  return {
    id: 'pantry', chapter: 1, title: 'Кладовая', subtitle: 'Глава 1', music: 'pantry',
    spawn: [2, 0, 14], yaw: Math.PI, killY: -12,
    bg: '#2a170e', fog: ['#3a2216', 40, 120],
    hemi: ['#ffe2bc', '#5a3420', 1.15], sun: { color: '#ffd9a0', intensity: 2.2, dir: [0.5, 1, 0.65] },
    startScript: 'pantry_intro',
    build(L) {
      L.add(room({ theme: 'pantry', x0: -24, x1: 64, z0: -30, z1: 24, floorY: 0, wallH: 42 }));
      // ── shelving boards ──
      const B1 = 8, B2 = 17, TH = 0.8;
      for (const [x0, x1] of [[-24, 30], [38, 64]]) L.add(P.shelfBoard({ x: (x0 + x1) / 2, y: B1 - TH, z: -23, w: x1 - x0, d: 14, th: TH }));
      for (const [x0, x1] of [[-24, 8], [15, 64]]) L.add(P.shelfBoard({ x: (x0 + x1) / 2, y: B2 - TH, z: -23, w: x1 - x0, d: 14, th: TH }));
      L.add(P.shelfBoard({ x: 20, y: 26 - TH, z: -23, w: 88, d: 14, th: TH }));

      // ── A: tutorial on the floor ──
      L.add(P.signpost({ x: 4, y: 0, z: 10, text: 'WASD + мышь' }));
      L.signAt(4, 0, 10, 'WASD или стрелки — бежать. Кликни по экрану и крути камеру мышью.');
      L.add(P.sack({ x: 12, y: 0, z: 16 }));
      L.add(P.barrel({ x: -8, y: 0, z: 18 }));
      // things to smash for crumbs
      for (const [k, x, y, z] of [['jar', -3, 0, 17], ['jar', -5, 0, 19.5], ['crate', 15.5, 0, 18], ['crate', 21, 0, -4], ['crate', 40, 0, -7], ['jar', 51, 0, -4],
        ['jar', -20, 8, -27.5], ['crate', 6.5, 8, -28], ['crate', -14, 17, -28.5], ['jar', 12, 17, -27.5], ['crate', 52.5, 17, -27.5]] as const) L.breakable(k, x, y, z);
      L.add(P.candle({ x: 9, y: 0, z: 8, r: 0.9, h: 4, light: true }));
      L.add(P.crate({ x: 4, y: 0, z: 2, w: 3.4, h: 1.6, d: 3.4, label: 'ГОРОХ' }));
      L.add(P.signpost({ x: 1, y: 0, z: 5, text: 'Пробел' }));
      L.signAt(1, 0, 5, 'Пробел — прыжок. Держи дольше — прыгнешь выше!');
      L.crumbLine(4, 1.6, 2, 4, 1.6, 2, 1);
      L.crumbLine(8, 0, 4, 14, 0, -2, 5);
      L.add(P.signpost({ x: 9, y: 0, z: -2, text: 'ЛКМ / J' }));
      L.signAt(9, 0, -2, 'ЛКМ или J — удар мечом. Арбузята видят только то, что впереди, и слышат шаги. Подкрадись со спины — удар будет двойным!');
      L.enemy('guard', 14, 0, -8, { path: [[14, -8], [6, -6], [3, -13], [12, -15]] });
      L.enemy('guard', -6, 0, -4, { path: [[-6, -4], [-14, -2], [-12, 6], [-3, 4]] });
      // secret: a golden walnut in the dark corner under the bottom shelf
      L.pick('nut', -22, 0.7, -27.5, 'nut_pantry_corner');
      L.pick('bigcrumb', -20.5, 0.4, -28);
      // stairs up to board 1 (west)
      L.add(P.crate({ x: -9, y: 0, z: -12, w: 3.6, h: 2, d: 3.6 }));
      L.add(P.book({ x: -13, y: 0, z: -12, w: 4.4, h: 1.9, d: 3.8, lying: true, color: '#2e86c1' }));
      L.add(P.book({ x: -13, y: 1.9, z: -12, w: 4, h: 1.8, d: 3.4, lying: true, color: '#c0392b' }));
      L.add(P.crate({ x: -17, y: 0, z: -12, w: 3.6, h: 5.4, d: 3.6, label: 'МУКА' }));
      L.add(P.jar({ x: -21, y: 0, z: -12, r: 1.9, h: 7, jam: 'red', label: 'Варенье' }));
      L.crumbLine(-9, 2, -12, -21, 7, -12, 6);

      // ── B: board 1 west ──
      L.add(P.jar({ x: -12.5, y: B1, z: -26, r: 2.6, h: 8, jam: 'orange' }));
      L.add(P.can({ x: -6, y: B1, z: -27, r: 2, h: 5, color: '#d8343a', label: 'ТОМАТЫ' }));
      L.add(P.can({ x: -2, y: B1, z: -26, r: 1.6, h: 3.2, color: '#2e86c1', label: 'РЫБА' }));
      L.add(P.crate({ x: 3, y: B1, z: -27, w: 4, h: 3, d: 4 }));
      L.noodle(-8, B2 - TH, -21, 7.2);
      L.add(P.signpost({ x: -14, y: B1, z: -18, text: 'Спагетти!' }));
      L.signAt(-14, B1, -18, 'Спагетти хватают! Если поймали — жми прыжок или удар. Их можно перерубить мечом.');
      L.enemy('spitter', -2, B1 + 3.2, -26, { yaw: Math.PI / 2 });
      L.enemy('guard', -16, B1, -19, { path: [[-16, -19], [4, -19], [-6, -22]] });
      L.crumbLine(-18, B1, -20, 6, B1, -20, 8);
      L.add(P.candle({ x: 2, y: B1, z: -22, r: 0.7, h: 3, light: false }));
      L.cp(8, B1, -19);
      L.add(P.sausages({ x: -4, y: 40, z: -8, n: 5, len: 12 }));
      L.add(P.garlic({ x: 18, y: 40, z: -4 }));

      // ── C: the bear ──
      L.add(P.tin({ x: 22, y: B1, z: -24, r: 2.2, h: 1.2, color: '#3a6ad8' }));
      L.npc('bear', 22, B1 + 1.2, -24, -0.6);
      L.trigger(14, B1 - 1, -30, 16, B1 + 4, -16, 'pantry_bear');
      L.add(P.cup({ x: 27.4, y: B1, z: -27, r: 1.8, h: 2.4, color: '#f6f0ff' }));
      L.pick('peas', 18, B1 + 0.4, -19);
      L.pick('honey', 25, B1 + 0.4, -19);
      L.add(P.signpost({ x: 27, y: B1, z: -18, text: 'ПКМ / K' }));
      L.signAt(27, B1, -18, 'Рогатка: щёлкни ПКМ (K) — горох летит в цель в жёлтой рамке. Зажми ПКМ — целишься сам, отпусти — выстрел. Сбей плевуна с верхней полки!');
      L.enemy('spitter', 24, B2, -26, { yaw: Math.PI });

      // ── D: jar-lid bridge over the gap in board 1 ──
      L.add(P.forkRow({ x: 34, y: 0, z: -23, w: 8, d: 12 }));
      for (const [x, h, z] of [[31.6, 7.6, -21], [34, 7.2, -24], [36.4, 7.8, -21]] as const) L.add(P.jar({ x, y: 0, z, r: 1.15, h, jam: 'green' }));
      L.crumbLine(31.6, 7.6, -21, 36.4, 7.8, -21, 3);
      // secret: high above the middle lid — come back with the feather
      L.pick('nut', 34, 11.1, -24, 'nut_pantry_lids');
      // safety stairs back up from the floor (east)
      L.add(P.crate({ x: 42, y: 0, z: -11, w: 3.6, h: 2, d: 3.6 }));
      L.add(P.crate({ x: 42, y: 2, z: -11, w: 3, h: 1.8, d: 3 }));
      L.add(P.can({ x: 42, y: 0, z: -14.2, r: 1.4, h: 5.5, color: '#27ae60' }));
      L.add(P.cheese({ x: 46, y: 0, z: -12, w: 4, h: 7.2, d: 4 }));
      // co-op stash on the quiet east floor: two plates far apart
      coopStash(L, 35, 0, 15, [[28, 0, 8], [42, 0, 8]], 'stash_pantry');
      L.signAt(35, 0, 15, 'Тайник! Встань на светящуюся плиту. С друзьями нужно встать на обе плиты сразу.');

      // ── E: board 1 east — the feather is the prize of an ambush ──
      L.add(P.crate({ x: 54, y: B1, z: -25, w: 3.6, h: 2.2, d: 3.6 }));
      L.add(P.pedestal({ x: 54, y: B1 + 2.2, z: -25 }));
      L.arena(49, B1, -22.5, 5.6, [
        [{ kind: 'guard', x: 46, y: B1, z: -20 }, { kind: 'guard', x: 52, y: B1, z: -19.5 }],
        [{ kind: 'shield', x: 46.5, y: B1, z: -25 }, { kind: 'guard', x: 51, y: B1, z: -19 }, { kind: 'guard', x: 45, y: B1, z: -19.5 }],
      ], [{ kind: 'doubleJump', x: 54, y: B1 + 2.2 + 1.2 + 0.9, z: -25 }], 1.2);
      L.signAt(44, B1, -17.5, 'Перо Прыгуна охраняют! Победи стражу — и оно твоё.');
      L.add(P.crate({ x: 50, y: B1, z: -22, w: 2.4, h: 1.2, d: 2.4 }));
      L.add(P.candle({ x: 59, y: B1, z: -27, r: 0.7, h: 3.2, light: false }));
      // climb to board 2 in front of the shelf (needs the double jump)
      L.add(P.signpost({ x: 56, y: B1, z: -17.5, text: '↑↑' }));
      L.signAt(56, B1, -17.5, 'Высоко? Прыгни ещё раз прямо в воздухе — Перо Прыгуна поможет!');
      L.add(P.jar({ x: 56, y: 0, z: -11.5, r: 2.4, h: 11, jam: 'honey', label: 'МЁД' }));
      L.add(P.crate({ x: 61, y: 0, z: -9, w: 4, h: 14, d: 4, label: 'СУХАРИ' }));
      L.crumbLine(56, 11, -11.5, 61, 14, -9, 3);
      // secret: on top of the cheese tower (double jump from the crates)
      L.pick('nut', 46, 7.9, -12, 'nut_pantry_cheese');

      // ── F: board 2 east — arena on the cheese board ──
      L.cp(58, B2, -20);
      L.arena(40, B2, -23, 6.6, [
        [{ kind: 'guard', x: 37, y: B2, z: -24 }, { kind: 'guard', x: 43, y: B2, z: -22 }, { kind: 'jelly', x: 40, y: B2, z: -27 }],
        [{ kind: 'shield', x: 36, y: B2, z: -21 }, { kind: 'spitter', x: 40, y: B2, z: -27.5 }, { kind: 'guard', x: 44, y: B2, z: -25 }, { kind: 'guard', x: 40, y: B2, z: -19 }],
      ], [{ kind: 'honey', x: 40, y: B2 + 0.6, z: -23 }]);
      L.add(P.candle({ x: 49, y: B2, z: -28, r: 0.7, h: 3, light: true }));
      // hidden heart on a tall jar
      L.add(P.can({ x: 27, y: B2, z: -27.5, r: 1.6, h: 3, color: '#8e44ad' }));
      L.add(P.jar({ x: 23, y: B2, z: -27, r: 1.8, h: 6, jam: 'red' }));
      L.pick('container', 23, B2 + 6 + 0.9, -27, 'pantry_heart');
      L.crumbLine(30, B2, -20, 18, B2, -20, 6);
      // spoon bridge over the gap in board 2
      L.add(P.spoon({ x: 11.5, y: B2 - 0.4, z: -20, len: 11, w: 2.4 }));
      L.add(P.sugarCube({ x: 18, y: B2, z: -26, s: 2 }));

      // ── G: board 2 west — exit through the mouse hole ──
      L.enemy('guard', 2, B2, -19, { path: [[2, -19], [-14, -19], [-8, -25]] });
      L.enemy('guard', -10, B2, -24, { range: 3 });
      L.enemy('shield', -18, B2, -21, { range: 1.5, yaw: Math.PI / 2 });
      L.add(P.bookStack({ x: -6, y: B2, z: -27.5, n: 3, w: 5, d: 4 }));
      L.crumbLine(4, B2, -19, -16, B2, -19, 7);
      L.add(P.mousehole({ x: -24, y: B2, z: -23, w: 4, h: 4.5, rotY: 1 }));
      L.exit(-24, B2 - 0.5, -26, -21.5, B2 + 4, -20);
      L.add(P.candle({ x: -18, y: B2, z: -28, r: 0.7, h: 3, light: true }));
    },
  };
}

// ════════════════════════════ CHAPTER 2 — FEAST ════════════════════════════
// The banquet table is the level (tabletop y=0, z −14..14; hall floor y=−18). The King sits on his throne at the
// east end and eats; the hero crosses the table toward him and slips out through the door beside his table.
//  zone 1  x 0–30   bread wall across the table — bounce over it on the jelly
//  zone 2  x 32–58  the spaghetti monster in its bowl guards the way
//  zone 3  x 60–84  ambush on the big platter (fork pedestal right after)
//  zone 4  x 86–106 cake hill + spoon bridge to the King's table
//  zone 5  x 102–132 the King's end: servants bring platters, his hand snatches snacks; book bridge north to the door
export const FEAST_KING = { x: 144, seatY: -18 + 9.4 * 1.5 };
function feast(): Level3Def {
  return {
    id: 'feast', chapter: 2, title: 'Пиршественный зал', subtitle: 'Глава 2', music: 'feast',
    spawn: [4, 0, 0], yaw: Math.PI / 2, killY: -14,
    bg: '#2a0c12', fog: ['#3a141c', 70, 210],
    hemi: ['#ffd8c0', '#5a1a20', 1.1], sun: { color: '#ffe0b0', intensity: 2.3, dir: [-0.3, 1, 0.5] },
    startScript: 'feast_intro',
    build(L) {
      L.add(room({ theme: 'feast', x0: -30, x1: 180, z0: -46, z1: 40, floorY: -18, wallH: 70 }));
      L.add(P.table({ x: 48, y: -18, z: 0, w: 96, d: 28, h: 18, cloth: true }));
      L.add(P.table({ x: 117, y: -18, z: 0, w: 30, d: 28, h: 18, cloth: true }));
      L.add(P.chandelier({ x: 24, y: 46, z: 0, r: 6 }));
      L.add(P.chandelier({ x: 72, y: 46, z: 0, r: 6 }));
      L.add(P.chandelier({ x: 120, y: 46, z: 0, r: 6 }));
      for (const x of [0, 50, 160]) L.add(P.window({ x, y: 2, z: -46, w: 16, h: 38 }));
      for (const x of [20, 90]) L.add(P.banner({ x, y: 20, z: 40, w: 8, h: 18, rotY: 2 }));

      for (const [k, x, z] of [['jar', 5, -12], ['crate', 13.5, 12.5], ['crate', 40, 9], ['jar', 58, -12], ['crate', 86, 11], ['jar', 100, 12], ['crate', 111.5, -12.6], ['jar', 119.2, -36]] as const) L.breakable(k, x, 0, z);
      // ── zone 1: bread wall + jelly ──
      L.add(P.plate({ x: 7, y: 0, z: -9.5, r: 3.4 }));
      L.add(P.goblet({ x: 10, y: 0, z: 10.5, r: 1.6, h: 6.5 }));
      L.add(P.cheese({ x: 15, y: 0, z: -11.5, w: 4, h: 3.2, d: 3.4 }));
      L.add(P.candle({ x: 3, y: 0, z: 11, r: 1, h: 5, light: true }));
      L.crumbLine(6, 0, 0, 18, 0, 0, 6);
      L.enemy('guard', 13, 0, 4, { path: [[13, 4], [13, -6], [7, -4], [8, 6]] });
      L.enemy('guard', 20, 0, -8, { path: [[20, -8], [20, 8]] });
      L.enemy('spitter', 15, 3.2, -11.5, { yaw: -Math.PI / 2 });
      L.add(P.signpost({ x: 17, y: 0, z: 5, rotY: 1, text: 'Желе!' }));
      L.signAt(17, 0, 5, 'Хлебная стена! Слишком высоко даже для двойного прыжка. Прыгни на желе — оно подбросит, а в воздухе прыгни ещё раз!');
      L.add(P.jellyBlock({ x: 21.5, y: 0, z: 0, w: 3.2, h: 1.4, d: 5.5, color: '#ff4f7f' }));
      L.add(P.bread({ x: 26.5, y: 0, z: 0, w: 28, h: 5.6, d: 3.8, rotY: 1 }));
      L.crumbLine(26.5, 6.4, -6, 26.5, 6.4, 6, 4);
      // secret: at the far end of the bread wall's top
      L.pick('nut', 26.5, 6.3, -12.8, 'nut_feast_bread');

      // ── zone 2: the spaghetti monster's bowl ──
      // it sits right on the tablecloth in its own sauce puddle; an empty pasta bowl lies tipped over behind it
      L.add(P.bowl({ x: 52, y: 0, z: -9.5, r: 3.4, h: 1.8, contents: 'empty' }));
      L.pick('nut', 52, 0.9, -9.5, 'nut_feast_bowl');
      L.add(P.bottle({ x: 36, y: 0, z: -12, r: 1.5, h: 8, label: 'ВИНО' }));
      L.add(P.bottle({ x: 54, y: 0, z: 12, r: 1.4, h: 7.4, color: '#7a2a3a', label: 'СОУС' }));
      L.add(P.candle({ x: 36, y: 0, z: 12, r: 0.9, h: 4.2, light: true }));
      L.signAt(33, 0, 4, 'Макаронный монстр! Перепрыгивай удары щупалец или руби их. Бей мясной шарик — а горох в глаз оглушит его!');
      L.add(P.signpost({ x: 33, y: 0, z: 4, rotY: 1, text: 'Осторожно!' }));
      L.cp(31.5, 0, 9);
      FEAST_SPOTS.monster.set(45, 0, 0);
      // co-op stash in the monster's south corner: one keeps it busy, two stand on the plates
      coopStash(L, 45.5, 0, 11.4, [[37.5, 0, 6.5], [51.5, 0, 7.5]], 'stash_feast');
      L.signAt(45.5, 0, 11.4, 'Тайник! Встань на светящуюся плиту. С друзьями нужно встать на обе плиты сразу.');

      // ── zone 3: ambush on the platter ──
      const platter = L.add(P.plate({ x: 72, y: 0, z: 0, r: 9 })) as ReturnType<typeof P.plate>;
      const PT = platter.top;
      for (const z of [-13.1, 13.1]) L.add(P.goblet({ x: 72, y: 0, z, r: 1.4, h: 6.5 }));
      L.arena(72, PT, 0, 12, [
        [{ kind: 'guard', x: 67, y: PT, z: -3 }, { kind: 'meatball', x: 77, y: PT, z: 4, o: { to: V(66, PT, 4) } }, { kind: 'guard', x: 76, y: PT, z: -4 }],
        [{ kind: 'jelly', x: 67, y: PT, z: 4 }, { kind: 'bomber', x: 72, y: PT, z: -7 }, { kind: 'shield', x: 77, y: PT, z: 3 }, { kind: 'guard', x: 70, y: PT, z: 6 }],
        [{ kind: 'guard', x: 66, y: PT, z: 0 }, { kind: 'guard', x: 78, y: PT, z: 0 }, { kind: 'bomber', x: 72, y: PT, z: 7 }, { kind: 'jelly', x: 72, y: PT, z: -6, o: { hue: 1 } }, { kind: 'spitter', x: 75, y: PT, z: -7 }],
      ], [{ kind: 'honey', x: 72, y: PT + 0.6, z: 0 }, { kind: 'fork', x: 88, y: 2.1, z: -2 }], 0.6);
      L.add(P.pedestal({ x: 88, y: 0, z: -2 }));
      L.add(P.signpost({ x: 90, y: 0, z: -6, rotY: 1, text: 'Q' }));
      L.signAt(90, 0, -6, 'Q — сменить оружие. Вилка-копьё бьёт дальше и сильнее!');

      // ── zone 4: cake hill + spoon bridge ──
      L.add(P.cake({ x: 91, y: 0, z: 8.5, r: 4.4, h: 3 }));
      L.add(P.cake({ x: 91, y: 3, z: 8.5, r: 3, h: 2.6 }));
      L.add(P.cake({ x: 91, y: 5.6, z: 8.5, r: 1.8, h: 2.2 }));
      L.pick('container', 91, 7.8 + 0.9, 8.5, 'feast_heart');
      L.add(P.spoon({ x: 99, y: 0, z: -4, len: 8.5, w: 2.8 }));
      L.crumbLine(93, 0, -4, 105, 0, -4, 5);
      L.cp(94, 0, -9);
      L.enemy('guard', 97, 0, 3, { path: [[97, 3], [100, -9], [92, -10]] });
      L.enemy('bomber', 91, 7.8, 8.5, { range: 0.5 });

      // ── zone 5: the King's end of the table ──
      const kx = FEAST_KING.x;
      L.add(P.throne({ x: kx + 3, y: -18, z: 0, s: 1.5, rotY: 3 }));
      L.add(P.rug({ x: kx - 4, y: -18, z: 0, w: 34, d: 44, color: '#8a1a2a' }));
      L.trigger(102, -1, -14, 106, 6, 14, 'feast_king');
      for (const [x, z] of [[108, -9.5], [114, -4], [120, -10], [125.5, -3.5]]) L.add(P.plate({ x, y: 0, z, r: 2.3 }));
      L.add(P.goblet({ x: 129, y: 0, z: -11, r: 2.2, h: 6.3 }));
      L.add(P.candle({ x: 129, y: 0, z: 11, r: 1.2, h: 6, light: true }));
      L.add(P.bottle({ x: 104.5, y: 0, z: 12, r: 1.4, h: 7.5, color: '#2f5a8a', label: 'КВАС' }));
      // book bridge north to the library door
      L.add(P.book({ x: 117, y: -1.2, z: -21.5, w: 6, h: 1.2, d: 14, lying: true, color: '#8e44ad' }));
      L.add(P.book({ x: 117, y: -1.2, z: -33.5, w: 6.5, h: 1.2, d: 11, lying: true, color: '#c0392b' }));
      L.add(P.book({ x: 117, y: -1.2, z: -42.5, w: 10, h: 1.2, d: 7, lying: true, color: '#c9a227' }));
      L.add(P.door({ x: 117, y: 0, z: -46, w: 7, h: 11 }));
      L.exit(114, -1, -46, 120, 4, -42);
      L.crumbLine(117, 0, -17, 117, 0, -38, 6);
      // the door is guarded
      L.enemy('guard', 117, 0, -26, { path: [[117, -25], [117, -39]] });
      L.enemy('shield', 117, 0, -41, { range: 0.8, yaw: 0 });
      // secret: a walnut on the goblet by the King's elbow (cheese step + double jump)
      L.add(P.cheese({ x: 125.6, y: 0, z: -12.8, w: 3, h: 3.4, d: 2.6 }));
      L.pick('nut', 129, 6.6, -11, 'nut_feast_goblet');
    },
  };
}
/** world positions shared with the feast scripts */
export const FEAST_SPOTS = { monster: new THREE.Vector3(), hatch: new THREE.Vector3(106, 0, 8.5), serve: new THREE.Vector3(126.5, 0, 4.5) };

// ════════════════════════════ CHAPTER 3 — LIBRARY ════════════════════════════
// A square tower 52×52; climb a spiral of books jutting from the walls up to y≈80.
function library(): Level3Def {
  return {
    id: 'library', chapter: 3, title: 'Библиотека', subtitle: 'Глава 3', music: 'library',
    spawn: [0, 0, 18], yaw: Math.PI, killY: -12,
    bg: '#0e1a22', fog: ['#16262f', 50, 150],
    hemi: ['#cfe6ff', '#1a2a33', 1.0], sun: { color: '#d6e8ff', intensity: 2.0, dir: [0.4, 1, 0.3] },
    startScript: 'library_intro',
    // missing a book drops you all the way down: no heart lost, but the climb starts over from the floor
    fallLimit: 10, fallToFloor: true,
    build(L) {
      L.add(room({ theme: 'library', x0: -26, x1: 26, z0: -26, z1: 26, floorY: 0, wallH: 100 }));
      // giant bookcases lining the walls (decor only — the climbing books jut out in front of them)
      for (let row = 0; row < 3; row++) {
        for (const off of [-12.5, 12.5]) {
          // N/S cases span the full corners; E/W cases are a bit narrower so the corner columns never overlap
          L.deco(P.bookshelf({ x: off, y: row * 30, z: -25.2, w: 24, h: 30, d: 1.6, shelves: 5, fill: 0.95, seed: row * 10 + 1, climb: false }).obj);
          L.deco(P.bookshelf({ x: off, y: row * 30, z: 25.2, w: 24, h: 30, d: 1.6, shelves: 5, fill: 0.95, seed: row * 10 + 2, rotY: 2, climb: false }).obj);
          L.deco(P.bookshelf({ x: -25.2, y: row * 30, z: off * 0.968, w: 22.8, h: 30, d: 1.6, shelves: 5, fill: 0.95, seed: row * 10 + 3, rotY: 1, climb: false }).obj);
          L.deco(P.bookshelf({ x: 25.2, y: row * 30, z: off * 0.968, w: 22.8, h: 30, d: 1.6, shelves: 5, fill: 0.95, seed: row * 10 + 4, rotY: 3, climb: false }).obj);
        }
      }
      // the bookcases are solid: nothing to fall into behind the climbing books, and the camera never ends up inside them
      L.col([boxCol(-26, 0, -26, 26, 100, -24.4), boxCol(-26, 0, 24.4, 26, 100, 26), boxCol(-26, 0, -26, -24.4, 100, 26), boxCol(24.4, 0, -26, 26, 100, 26)]);
      L.add(P.rug({ x: 0, y: 0, z: 0, w: 22, d: 22, color: '#7a2a3a' }));
      L.add(P.signpost({ x: 3, y: 0, z: 14, text: '↑' }));
      L.signAt(3, 0, 14, 'Выход — под самым потолком. Карабкайся по книгам вдоль стен!');
      // the reading room floor is patrolled
      L.enemy('guard', -6, 0, 6, { path: [[-6, 6], [-14, -8], [8, -13], [13, 8]] });
      L.enemy('shield', 8, 0, 12, { path: [[8, 12], [-10, 14], [-14, 2]] });
      L.enemy('charger', 4, 0, -16, { range: 3 });
      L.add(P.signpost({ x: -3, y: 0, z: 15, text: 'Таран!' }));
      L.signAt(-3, 0, 15, 'Таран бодается с разбега! Отскочи в сторону — пусть врежется в шкаф и ошалеет.');
      // central reading table & globe-ish decor
      L.add(P.table({ x: 0, y: 0, z: -4, w: 12, d: 8, h: 4.5, cloth: false }));
      L.add(P.candle({ x: 2, y: 4.5, z: -4, r: 0.6, h: 2.4, light: true }));
      // secret: under the reading table
      L.pick('nut', -2.5, 0.7, -5, 'nut_lib_table');
      for (const [k, x, z] of [['crate', -20, 20], ['jar', -20, -20], ['crate', 17, -20], ['jar', -9, -21], ['crate', 12, 19]] as const) L.breakable(k, x, 0, z);
      // co-op stash in the south-west corner of the reading room (the climb starts on the east wall)
      coopStash(L, -17, 0, 16, [[-9.5, 0, 21], [-21.5, 0, 8.5]], 'stash_library');
      L.signAt(-17, 0, 16, 'Тайник! Встань на светящуюся плиту. С друзьями нужно встать на обе плиты сразу.');
      // ── spiral of books ──
      // perimeter path (inset 3.6 from walls), counter-clockwise starting at the south-east corner
      const R = srand(77);
      const inset = 22.3;
      const pathPt = (s: number): [number, number, number] => {
        // s in [0, 4) around the square; returns x, z and the wall-normal axis (0 = x-wall, 1 = z-wall)
        const side = Math.floor(s) % 4, k = s - Math.floor(s);
        if (side === 0) return [inset, inset - k * 2 * inset, 0];                       // east wall, z from +i to -i
        if (side === 1) return [inset - k * 2 * inset, -inset, 1];                      // north wall, x from +i to -i
        if (side === 2) return [-inset, -inset + k * 2 * inset, 0];                     // west wall, z from -i to +i
        return [-inset + k * 2 * inset, inset, 1];                                      // south wall, x from -i to +i
      };
      let y = 1.6;
      let s = 0.06;
      const steps: { x: number; y: number; z: number; ax: number }[] = [];
      let n = 0;
      while (y < 79) {
        const [x, z, ax] = pathPt(s);
        steps.push({ x, y, z, ax });
        n++;
        const dashZone = y > 46 && y < 58;
        const rise = y < 18 ? 1.5 : y < 46 ? 2.2 + R() * 0.5 : dashZone ? 0.6 : 2.3 + R() * 0.4;
        y += rise;
        s += dashZone ? 0.33 : 0.135 + R() * 0.02;
      }
      // walk on (flat) until the north wall, where the top landing is
      while (!(Math.floor(s) % 4 === 1 && s - Math.floor(s) > 0.38)) {
        const [x, z, ax] = pathPt(s);
        steps.push({ x, y, z, ax });
        s += 0.12;
      }
      const dashStep = steps.find((st) => st.y >= 42) ?? null;
      const findY = (y: number) => steps.find((st) => st.y >= y) ?? steps[steps.length - 1];
      const wide = [findY(20), findY(60)];
      steps.forEach((st, i) => {
        if (st === dashStep || wide.includes(st)) return; // bigger landings below take their place
        const w = 5.2, d = 4.2;
        const color = BOOK_COLORS[i % BOOK_COLORS.length];
        // book long side along the path; neighbours never share a top height (no z-fighting where corners overlap)
        const bw = st.ax === 0 ? d : w, bd = st.ax === 0 ? w : d;
        const lift = i % 2 ? 0.07 : 0;
        st.y += lift;
        L.add(P.book({ x: st.x, y: st.y - 1.1 - lift, z: st.z, w: bw, h: 1.1 + lift, d: bd, lying: true, color, seed: i }));
        if (i % 4 === 1) L.crumbLine(st.x, st.y, st.z, st.x, st.y, st.z, 1);
      });
      // landings with checkpoints & the dash cloak
      const landing = (idx: number) => steps[Math.min(idx, steps.length - 1)];
      const byY = findY;
      /** a wide shelf jutting out of the bookcase at a step: [center x, z, inward normal] */
      const ledge = (st: { x: number; y: number; z: number; ax: number }, w: number, d: number, color: string) => {
        const nx = st.ax === 0 ? -Math.sign(st.x) : 0, nz = st.ax === 1 ? -Math.sign(st.z) : 0;
        const cx = st.x + nx * (d / 2 - 2.1), cz = st.z + nz * (d / 2 - 2.1);
        L.add(P.book({ x: cx, y: st.y - 1.2, z: cz, w: st.ax === 0 ? d : w, h: 1.2, d: st.ax === 0 ? w : d, lying: true, color }));
        return { x: cx, z: cz, nx, nz };
      };
      const l1 = byY(20);
      const w1 = ledge(l1, 9, 8, '#2e6a8e');
      // hardcore: no candles in the tower — whoever falls must be fetched, and a wipe starts the climb over
      if (!coop.hard) L.cp(l1.x, l1.y, l1.z);
      L.enemy('guard', w1.x + w1.nx * 1.5, l1.y, w1.z + w1.nz * 1.5, { range: 2 });
      L.breakable('crate', w1.x - w1.nx * 2 - w1.nz * 3, l1.y, w1.z - w1.nz * 2 - w1.nx * 3);
      L.enemy('bomber', w1.x + w1.nx * 2.8 + (w1.nz ? 2.5 : 0), l1.y, w1.z + w1.nz * 2.8 + (w1.nx ? 2.5 : 0), { post: true, yaw: Math.atan2(w1.nx, w1.nz) });
      const l2 = dashStep ?? byY(42); // the dash cloak — the prize of an ambush, just before the wide gaps that need it
      const w2 = ledge(l2, 11, 10, '#7f5539');
      L.add(P.pedestal({ x: l2.x, y: l2.y, z: l2.z }));
      L.arena(w2.x, l2.y, w2.z, 4.6, [
        [{ kind: 'book', x: w2.x, y: l2.y + 3, z: w2.z }, { kind: 'guard', x: w2.x + w2.nz * 2.5, y: l2.y, z: w2.z + w2.nx * 2.5 }, { kind: 'guard', x: w2.x - w2.nz * 2.5, y: l2.y, z: w2.z - w2.nx * 2.5 }],
        [{ kind: 'shield', x: w2.x + w2.nx * 2, y: l2.y, z: w2.z + w2.nz * 2 }, { kind: 'book', x: w2.x + 1, y: l2.y + 3.5, z: w2.z - 1 }, { kind: 'book', x: w2.x - 1, y: l2.y + 3, z: w2.z + 1 }, { kind: 'bomber', x: w2.x + w2.nz * 2.5, y: l2.y, z: w2.z + w2.nx * 2.5, o: { post: true } }],
      ], [{ kind: 'dash', x: l2.x, y: l2.y + 2.15, z: l2.z }], 1.2);
      L.signAt(l2.x, l2.y, l2.z, 'Shift или L — рывок. Работает и в воздухе: перелетай большие пропасти!');
      const l3 = byY(60);
      const w3 = ledge(l3, 9, 8, '#8e2e4a');
      if (!coop.hard) L.cp(l3.x, l3.y, l3.z);
      L.enemy('guard', w3.x + w3.nx * 1.2, l3.y, w3.z + w3.nz * 1.2, { range: 2 });
      L.enemy('shield', w3.x + w3.nx * 2.5 - w3.nz * 2, l3.y, w3.z + w3.nz * 2.5 - w3.nx * 2, { range: 1.5 });
      L.enemy('bomber', w3.x + w3.nx * 3 + w3.nz * 2.5, l3.y, w3.z + w3.nz * 3 + w3.nx * 2.5, { post: true });
      L.breakable('jar', w3.x - w3.nx * 2 + w3.nz * 3, l3.y, w3.z - w3.nz * 2 + w3.nx * 3);
      // flying books harass the whole climb; spitters perch on steps; books rain from traps
      for (const f of [0.1, 0.22, 0.34, 0.46, 0.58, 0.7, 0.82, 0.92]) {
        const st = landing(Math.floor(steps.length * f));
        L.enemy('book', st.x * 0.72, st.y + 3, st.z * 0.72);
      }
      for (const f of [0.28, 0.5, 0.76]) { const st = landing(Math.floor(steps.length * f)); L.enemy('spitter', st.x, st.y, st.z, { yaw: Math.atan2(-st.x, -st.z) }); }
      for (const f of [0.08, 0.3, 0.55, 0.68, 0.88]) { const st = landing(Math.floor(steps.length * f)); L.trap(st.x - 2.6, st.y - 0.5, st.z - 2.6, st.x + 2.6, st.y + 2, st.z + 2.6, [[st.x, st.z]], st.y + 22); }
      // secret: a walnut on a lone book out over the void — dash across from the steps
      const ns = byY(50);
      L.add(P.book({ x: ns.x * 0.62, y: ns.y + 0.4, z: ns.z * 0.62, w: 2.6, h: 0.9, d: 2.6, lying: true, color: '#c9a227' }));
      L.pick('nut', ns.x * 0.62, ns.y + 2, ns.z * 0.62, 'nut_lib_void');
      // secret: a little ledge high on the west bookcase, above the path
      const west = steps.filter((st) => st.ax === 0 && st.x < 0 && st.y > 24).sort((a, b) => Math.abs(a.z) - Math.abs(b.z))[0];
      if (west) {
        L.add(P.book({ x: -23.6, y: west.y + 2.6, z: west.z, w: 2.2, h: 0.7, d: 3.2, lying: true, color: '#3a7a3a' }));
        L.pick('nut', -23.3, west.y + 4, west.z, 'nut_lib_ledge');
      }
      // hidden heart on a high shelf in the middle of the room (reach it by dashing from a step)
      const hs = byY(64);
      L.add(P.book({ x: hs.x * 0.55, y: hs.y - 0.6, z: hs.z * 0.55, w: 3.6, h: 1.2, d: 3.6, lying: true, color: '#c9a227' }));
      L.pick('container', hs.x * 0.55, hs.y + 1.4, hs.z * 0.55, 'lib_heart');
      // top landing on the north wall with the arena and the exit
      const top = steps[steps.length - 1];
      const ty = top.y + 1.2;
      L.add(P.shelfBoard({ x: -4, y: ty - 1, z: -18.5, w: 26, d: 15, th: 1 }));
      L.arena(1.5, ty, -17.5, 5.8, [
        [{ kind: 'book', x: -0.5, y: ty + 3, z: -17 }, { kind: 'book', x: 4, y: ty + 3, z: -16 }, { kind: 'guard', x: 1.5, y: ty, z: -19 }, { kind: 'shield', x: 4, y: ty, z: -20 }],
        [{ kind: 'charger', x: -1.5, y: ty, z: -21 }, { kind: 'bomber', x: 5, y: ty, z: -21, o: { post: true } }, { kind: 'book', x: 1.5, y: ty + 3, z: -14 }],
        [{ kind: 'guard', x: -1.5, y: ty, z: -17 }, { kind: 'guard', x: 4.5, y: ty, z: -15 }, { kind: 'spitter', x: 4, y: ty, z: -21.5 }, { kind: 'jelly', x: 1.5, y: ty, z: -14, o: { hue: 1 } }],
      ], [{ kind: 'honey', x: 1.5, y: ty + 0.6, z: -17.5 }]);
      // the way on: a magic book that opens once the ambush is beaten — jump into its pages
      const book = L.add(magicBookPortal({ x: -11.5, y: ty, z: -21.4, s: 1 }));
      LIB_PORTAL.book = book as MagicBookPortal;
      L.signAt(-11.5, ty + 1.2, -19.5, 'Волшебная книга «Большая галерея» — дорога к Тронному залу. Раскроется — запрыгни прямо в страницы.');
      L.add(P.chandelier({ x: 0, y: 96, z: 0, r: 7 }));
    },
  };
}

// ════════════════════════════ CHAPTER 4 — CHASE ════════════════════════════
// The Great Gallery along +X. The hero auto-runs down a carpet lane (z −7..7, balustrades on both sides);
// the King bursts through the brick wall behind (x −36) and chases him to the throne-room door at x 300.
// Every obstacle spans the lane: dodge (crates), jump (forks, pits), time (swinging noodles), bounce (jelly),
// cut through (lane guards), dash (wide pit).
export const CHASE = { laneZ: 0, half: 7, wallX: -36 };
/** obstacles the King smashes as he walks through them (filled by the chase build, read by the chase hook) */
export const CHASE_SMASH: { x: number; b: Built; colors: string[] }[] = [];
function chase(): Level3Def {
  return {
    id: 'chase', chapter: 4, title: 'Погоня', subtitle: 'Глава 4', music: 'chase',
    spawn: [4, 0, 0], yaw: Math.PI / 2, killY: -10,
    bg: '#120c1c', fog: ['#1e1530', 50, 150],
    hemi: ['#e8d8ff', '#2a1e3a', 1.05], sun: { color: '#ffe2c0', intensity: 2.0, dir: [0.6, 1, 0.4] },
    startScript: 'chase_intro',
    build(L) {
      CHASE_SMASH.length = 0;
      const H = CHASE.half;
      const pit = (x0: number, x1: number) => ({ x0, x1, z0: -H, z1: H });
      const pits = [pit(58.5, 61.5), pit(137, 145), pit(241, 250)];
      L.add(room({ theme: 'gallery', x0: -80, x1: 306, z0: -22, z1: 22, floorY: 0, wallH: 46, holes: pits }));
      for (const h of pits) L.add(P.pool({ x: (h.x0 + h.x1) / 2, y: -0.3, z: 0, w: h.x1 - h.x0, d: h.z1 - h.z0, kind: 'soup' }));
      // balustrades along the carpet runway
      for (const zs of [-1, 1]) {
        const z = zs * (H + 0.5);
        L.col(boxCol(-80, 0, z - 0.5, 306, 7, z + 0.5));
        const rail = new THREE.Mesh(new THREE.BoxGeometry(386, 1.3, 0.9), mat('#6a5a82'));
        rail.position.set(113, 0.65, z); rail.receiveShadow = true; rail.castShadow = true;
        const cap = new THREE.Mesh(new THREE.BoxGeometry(386, 0.25, 1.3), mat('#f2c23a'));
        cap.position.set(113, 1.42, z);
        L.deco(rail); L.deco(cap);
      }
      for (let x = -76; x < 306; x += 24) {
        for (const z of [-15, 15]) L.add(P.pillar({ x, y: 0, z, r: 1.8, h: 46 }));
        L.add(P.banner({ x: x + 12, y: 22, z: -22, w: 6, h: 14 }));
        L.add(P.banner({ x: x + 12, y: 22, z: 22, w: 6, h: 14, rotY: 2 }));
        if (Math.round(x / 24) % 2 === 0) L.add(P.torch({ x: x + 6, y: 10, z: -22, rotY: 0, light: Math.round(x / 24) % 4 === 0 }));
      }
      const smash = (x: number, b: Built, colors: string[]) => { CHASE_SMASH.push({ x, b, colors }); return b; };
      // low spike rows a runner can clear with a normal jump (hazard ≈1 high)
      const lowForks = (x: number, z: number, d: number) => {
        const b = L.add(P.forkRow({ x, y: 0, z, w: 1.6, d }));
        b.obj.scale.y = 0.55; b.obj.updateMatrix(); b.obj.updateMatrixWorld(true);
        for (const h of b.hazards ?? []) h.max.y = 0.95;
        return b;
      };
      const wood = ['#b47a46', '#7a4a2c', '#d89a5e'];

      // ── A: warm-up ──
      L.crumbLine(10, 0, 0, 20, 0, 0, 4);
      smash(22, L.add(P.crate({ x: 22, y: 0, z: -4, w: 3, h: 1.8, d: 3 })), wood);
      smash(22, L.add(P.crate({ x: 22, y: 0, z: 4, w: 3, h: 1.8, d: 3 })), wood);
      L.crumbLine(26, 0, 0, 32, 0, 0, 3);
      smash(34, L.add(P.barrel({ x: 34, y: 0, z: 0, r: 1.4, h: 3 })), wood);
      smash(34, L.add(P.sack({ x: 34, y: 0, z: -5.6, r: 1.3, h: 2.6 })), ['#c8a070', '#8a6a4a']);
      smash(34, L.add(P.sack({ x: 34, y: 0, z: 5.6, r: 1.3, h: 2.6 })), ['#c8a070', '#8a6a4a']);
      lowForks(46, 0, H * 2);
      L.crumbLine(44, 1.9, 0, 48, 1.9, 0, 3);
      L.crumbLine(57, 1.8, 0, 63, 1.8, 0, 4);
      for (const z of [-4.2, 0, 4.2]) L.addEnemy(new Blocker3(V(76, 0, z), 1.6));
      L.cp(88, 0, 5.5);

      // ── B: noodles, bread wall, cookie pit, the spaghetti monster ──
      [100, 107, 114].forEach((x, i) => L.noodle(x, 20, 0, 19.2, { hang: 'colander', thick: 0.14, swing: { axis: 'z', amp: 0.38, speed: 1.7, phase: i * 2.1 } }));
      // risky walnut between the swinging colanders
      L.pick('nut', 103.5, 2.7, 0, 'nut_chase_noodles');
      L.add(P.signpost({ x: 94, y: 0, z: 6, rotY: 3, text: 'Лапша!' }));
      L.add(P.jellyBlock({ x: 122, y: 0, z: 0, w: 3, h: 1.4, d: 5, color: '#ff4f7f' }));
      smash(127, L.add(P.bread({ x: 127, y: 0, z: 0, w: H * 2, h: 4.3, d: 3.6, rotY: 1 })), ['#c8823a', '#f2d8a0']);
      L.crumbLine(127, 5.1, -3, 127, 5.1, 3, 3);
      L.add(P.signpost({ x: 114, y: 0, z: 6, rotY: 3, text: 'Желе!' }));
      L.add(P.cookie({ x: 141, y: -0.45, z: 0, r: 1.9, h: 0.65 }));
      CHASE_SPOTS.monster.set(160, 0, -9.8);
      // a melon on a balcony lobs cherry bombs onto the runway
      // (on stacked crates so it can see over the runway's side walls)
      L.add(P.crate({ x: 150, y: 0, z: -11.5, w: 3.6, h: 3.6, d: 3.6 }));
      L.add(P.crate({ x: 150, y: 3.6, z: -11.5, w: 3, h: 3.6, d: 3 }));
      L.enemy('bomber', 150, 7.2, -11.5, { post: true, yaw: -Math.PI / 4 });
      L.addEnemy(new Blocker3(V(174, 0, -3), 2.2));
      L.addEnemy(new Blocker3(V(174, 0, 3), 2.2, true));
      L.cp(186, 0, 5.5);

      // ── C: slalom, double noodles, the dash pit, meatballs, the last line ──
      lowForks(198, -3.5, 7);
      lowForks(210, 3.5, 7);
      [220, 227].forEach((x, i) => L.noodle(x, 20, 0, 19.2, { hang: 'colander', thick: 0.14, swing: { axis: 'z', amp: 0.38, speed: 2.1, phase: i * Math.PI } }));
      smash(234, L.add(P.crate({ x: 234, y: 0, z: -2.5, w: 3, h: 1.8, d: 3 })), wood);
      L.add(P.signpost({ x: 233, y: 0, z: 6, rotY: 3, text: 'Рывок!' }));
      L.crumbLine(241, 1.8, 0, 250, 1.8, 0, 3);
      // walnut at the top of the dash arc over the last soup pit
      L.pick('nut', 246, 3.6, 0, 'nut_chase_pit');
      L.enemy('meatball', 262, 0, -6, { to: V(262, 0, 6) });
      L.enemy('meatball', 270, 0, 6, { to: V(270, 0, -6) });
      L.add(P.crate({ x: 268, y: 0, z: 11.5, w: 3.6, h: 3.6, d: 3.6 }));
      L.add(P.crate({ x: 268, y: 3.6, z: 11.5, w: 3, h: 3.6, d: 3 }));
      L.enemy('bomber', 268, 7.2, 11.5, { post: true, yaw: -3 * Math.PI / 4 });
      L.addEnemy(new Blocker3(V(284, 0, -4.5), 1.8));
      L.addEnemy(new Blocker3(V(284, 0, 0), 1.8, true));
      L.addEnemy(new Blocker3(V(284, 0, 4.5), 1.8));
      L.add(P.door({ x: 306, y: 0, z: 0, w: 12, h: 16, rotY: 3 }));
      L.exit(296, -1, -7, 306, 6, 7);
    },
  };
}
/** world positions shared with the chase scripts */
export const CHASE_SPOTS = { monster: new THREE.Vector3() };

// ════════════════════════════ CHAPTER 5 — THRONE ════════════════════════════
function throne(): Level3Def {
  return {
    id: 'throne', chapter: 5, title: 'Король Громадин', subtitle: 'Глава 5', music: 'boss',
    spawn: [0, 0, 24], yaw: Math.PI, killY: -10,
    bg: '#100a18', fog: ['#1a1228', 70, 180],
    hemi: ['#dcd0ff', '#2a1c3a', 1.1], sun: { color: '#cfe0ff', intensity: 2.3, dir: [0.2, 1, 0.5] },
    startScript: 'throne_intro',
    build(L) {
      L.add(room({ theme: 'throne', x0: -36, x1: 36, z0: -48, z1: 36, floorY: 0, wallH: 60 }));
      // a big throne set into the dais so the seat is low (the King sits on it; his palms reach the floor)
      L.add(P.throne({ x: 0, y: THRONE_SEAT.y - 9.4 * 1.5, z: -38, s: 1.5 }));
      for (const [x, z] of [[-32, -20], [32, -20], [-32, 10], [32, 10], [-20, 32], [20, 32]]) L.add(P.pillar({ x, y: 0, z, r: 2, h: 60 }));
      for (const [x, z, r] of [[-36, 0, 1], [36, 0, 3]] as const) L.add(P.torch({ x, y: 12, z, rotY: r }));
      for (const x of [-24, 24]) L.add(P.banner({ x, y: 24, z: -48, w: 8, h: 18 }));
      L.add(P.rug({ x: 0, y: 0, z: 6, w: 20, d: 40, color: '#b8323a' }));
      // moonbeam from the well above (decor only)
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(4, 6, 120, 32, 1, true), new THREE.MeshBasicMaterial({ color: '#b8d0ff', transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      beam.position.set(0, 60, 4);
      beam.layers.set(1);
      L.deco(beam);
    },
  };
}

/** where the boss King sits (root position) */
export const THRONE_SEAT = new THREE.Vector3(0, 4.1, -36);

export const LEVELS3: Record<string, () => Level3Def> = { pantry, feast, library, chase, throne };

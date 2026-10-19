import type { LevelDef, SolidDef, EnemyKind, PickupKind, EnemyDef, PickupDef } from './types';
import type { SolidStyle, HazardStyle, Decor, DecorType } from '../art/props';
import type { Theme } from '../art/backgrounds';
import type { MusicName } from '../engine/audio';

class B {
  d: LevelDef;
  constructor(o: { id: string; chapter: number; title: string; subtitle: string; theme: Theme; music: MusicName; w: number; h: number; spawn: { x: number; y: number } }) {
    this.d = {
      ...o, solids: [], hazards: [], enemies: [], pickups: [], decor: [], signs: [], checkpoints: [],
      noodles: [], triggers: [], traps: [], arenas: [], npcs: [],
    };
  }
  solid(x: number, y: number, w: number, h: number, style: SolidStyle, o: Partial<SolidDef> = {}) {
    this.d.solids.push({ x, y, w, h, style, ...o });
    return this;
  }
  /** solid block that extends from top y down to the level bottom */
  block(x: number, y: number, w: number, style: SolidStyle, o: Partial<SolidDef> = {}) {
    return this.solid(x, y, w, this.d.h - y + 40, style, o);
  }
  floor(x1: number, x2: number, y: number, style: SolidStyle = 'floor') { return this.block(x1, y, x2 - x1, style); }
  plat(x: number, y: number, w: number, style: SolidStyle = 'shelf', h = 22) { return this.solid(x, y, w, h, style, { oneway: true }); }
  table(x: number, y: number, w: number, legsTo: number) { return this.solid(x, y, w, 26, 'table', { oneway: true, legs: legsTo }); }
  cookie(x: number, y: number, w = 110) { return this.solid(x, y, w, 30, 'cookie', { crumbly: true }); }
  jelly(x: number, y: number, w: number, h: number, bounce = 1150) { return this.solid(x, y, w, h, 'jelly', { bounce }); }
  hazard(x: number, y: number, w: number, h: number, style: HazardStyle, dmg = 1) { this.d.hazards.push({ x, y, w, h, style, dmg }); return this; }
  forks(x: number, groundY: number, w: number) { return this.hazard(x, groundY - 34, w, 34, 'forks'); }
  pins(x: number, groundY: number, w: number) { return this.hazard(x, groundY - 30, w, 30, 'pins'); }
  liquid(x: number, groundY: number, w: number, style: HazardStyle) { return this.hazard(x, groundY + 30, w, this.d.h - groundY, style); }
  enemy(kind: EnemyKind, x: number, y: number, o: Partial<EnemyDef> = {}) { this.d.enemies.push({ kind, x, y, ...o }); return this; }
  pick(kind: PickupKind, x: number, y: number, id?: string) { this.d.pickups.push({ kind, x, y, id }); return this; }
  crumbs(x1: number, x2: number, y: number, n: number) {
    for (let i = 0; i < n; i++) this.pick('crumb', x1 + ((x2 - x1) * i) / Math.max(1, n - 1), y);
    return this;
  }
  arc(cx: number, y: number, n: number, w = 140, hgt = 70) {
    for (let i = 0; i < n; i++) {
      const k = n === 1 ? 0.5 : i / (n - 1);
      this.pick('crumb', cx - w / 2 + w * k, y - Math.sin(k * Math.PI) * hgt);
    }
    return this;
  }
  deco(type: DecorType, x: number, y: number, o: Partial<Decor> = {}) { this.d.decor.push({ type, x, y, ...o }); return this; }
  sign(x: number, y: number, label: string, text: string) { this.d.signs.push({ x, y, label, text }); return this; }
  cp(x: number, y: number) { this.d.checkpoints.push({ x, y }); return this; }
  noodle(x: number, y: number, len: number, dir: 1 | -1 = 1) { this.d.noodles.push({ x, y, len, dir }); return this; }
  trig(x: number, y: number, w: number, h: number, script: string) { this.d.triggers.push({ x, y, w, h, script, once: true }); return this; }
  trap(x: number, y: number, w: number, h: number, drops: number[], dropY: number) { this.d.traps.push({ x, y, w, h, drops, dropY }); return this; }
  arena(x: number, w: number, floorY: number, waves: EnemyDef[][], reward?: PickupDef[]) { this.d.arenas.push({ x, w, floorY, waves, reward }); return this; }
  npc(kind: 'bear' | 'kingBg' | 'dog', x: number, y: number, s = 1, facing = 1) { this.d.npcs.push({ kind, x, y, s, facing }); return this; }
  done(o: Partial<LevelDef> = {}) { return { ...this.d, ...o }; }
}

// ════════════════════════════ CHAPTER 1 — PANTRY ════════════════════════════
function pantry(): LevelDef {
  const G = 1180;
  const b = new B({ id: 'pantry', chapter: 1, title: 'Кладовая', subtitle: 'Глава 1', theme: 'pantry', music: 'pantry', w: 7600, h: 1300, spawn: { x: 170, y: G } });
  // ground
  b.floor(0, 3800, G).floor(4320, 7600, G);
  b.solid(7480, -200, 140, G + 200, 'woodwall');
  b.liquid(3800, G, 520, 'jam');

  // A: tutorial
  b.deco('candle', 90, G, { s: 1.1 }).deco('sack', 40, G, { s: 0.9 });
  b.sign(330, G, '→', 'Бегать: ← → или A / D');
  b.sign(470, G, '↑', 'Прыжок: Пробел, W или ↑. Держи дольше — прыгнешь выше!');
  b.solid(560, G - 80, 130, 80, 'crate');
  b.solid(780, G - 170, 130, 170, 'jar', { color: '#c8203a' });
  b.arc(625, G - 110, 4, 90, 40).arc(845, G - 200, 4, 90, 40);
  b.deco('sausages', 660, G - 760).deco('garlic', 980, G - 820).deco('bottle', 1180, G, { s: 0.9 });
  b.sign(1060, G, '!', 'Удар: J или X. Арбузята-стражники не любят, когда их шлёпают!');
  b.enemy('guard', 1300, G, { range: 90, facing: -1 });
  b.crumbs(1150, 1400, G - 30, 5);

  // B: noodles, forks, shelves
  b.sign(1450, G, '?', 'Спагетти хватают! Если поймали — жми прыжок или удар. Мечом их можно перерубить.');
  b.solid(1530, G - 60, 220, 60, 'books');
  b.plat(1500, G - 420, 300);
  b.noodle(1640, G - 398, 300);
  b.deco('candle', 1740, G, { s: 0.9 });
  b.sign(1790, G, '!', 'Вилки! Разбегись и прыгни. А профи бьют вниз в прыжке (↓ + J) и отскакивают от них.');
  b.forks(1860, G, 100);
  b.arc(1910, G - 90, 5, 120, 60);
  b.plat(2060, G - 95, 260).plat(2340, G - 190, 260);
  b.crumbs(2380, 2560, G - 220, 5);
  b.enemy('spitter', 2520, G - 190, { facing: -1 });
  b.enemy('guard', 2250, G, { range: 140 });
  b.solid(2640, G - 100, 120, 100, 'crate');
  b.deco('painting', 2200, G - 520).deco('sausages', 2900, G - 760).deco('cobweb', 2100, G - 1180);
  b.cp(2840, G);

  // C: the bear
  b.deco('teacup', 3330, G, { s: 1.2 }).deco('candle', 3020, G).deco('lamp', 3150, G - 560);
  b.npc('bear', 3170, G, 1, -1);
  b.trig(2990, G - 300, 40, 300, 'pantry_bear');
  b.pick('peas', 3260, G - 40).pick('honey', 3300, G - 40);
  b.sign(3480, G, 'K', 'Рогатка: K или C. Сбей плевуна с верхней полки!');
  b.plat(3640, G - 330, 220);
  b.enemy('spitter', 3780, G - 330, { facing: -1 });
  b.crumbs(3560, 3760, G - 30, 5);

  // D: jam pit + tower with the feather
  b.block(3880, G - 50, 100, 'jar', { color: '#e88a20' });
  b.block(4040, G - 90, 90, 'can');
  b.block(4190, G - 40, 110, 'jar', { color: '#c8203a' });
  b.plat(3990, G - 470, 200);
  b.noodle(4085, G - 448, 250);
  b.arc(4085, G - 140, 3, 60, 30);
  b.solid(4420, G - 100, 120, 100, 'crate');
  b.plat(4560, G - 200, 140);
  b.block(4700, G - 300, 300, 'books');
  b.enemy('guard', 4800, G - 300, { range: 80 });
  b.pick('doubleJump', 4950, G - 340, 'pantry_dj');
  b.deco('garlic', 4600, G - 900).deco('candle', 4460, G - 100, { s: 0.8 });
  b.crumbs(4720, 4900, G - 330, 4);

  // E: double-jump wall, cookies over forks
  b.sign(5150, G, '↑↑', 'Высоко? Прыгни ещё раз прямо в воздухе — Перо Прыгуна поможет!');
  b.solid(5250, G - 185, 180, 185, 'crate');
  b.arc(5340, G - 230, 4, 100, 40);
  b.forks(5430, G, 300);
  b.cookie(5525, G - 170, 110);
  b.block(5730, G - 180, 300, 'cheese');
  b.cp(5880, G - 180);
  b.deco('sausages', 5600, G - 800).deco('bottle', 6100, G, { s: 1.1 });

  // arena
  b.arena(6200, 820, G, [
    [{ kind: 'guard', x: 6420, y: G }, { kind: 'guard', x: 6820, y: G, facing: -1 }],
    [{ kind: 'guard', x: 6350, y: G }, { kind: 'spitter', x: 6620, y: G, facing: -1 }, { kind: 'guard', x: 6880, y: G, facing: -1 }],
  ], [{ kind: 'honey', x: 6610, y: G - 60 }]);
  b.deco('candle', 6260, G).deco('candle', 6960, G).deco('painting', 6610, G - 520);

  // hidden heart above
  b.plat(7060, G - 160, 160).plat(7220, G - 320, 160).plat(7040, G - 480, 150);
  b.pick('container', 7115, G - 520, 'pantry_heart');
  b.crumbs(7240, 7360, G - 350, 3);

  // exit
  b.deco('mousehole', 7420, G, { w: 100, h: 130 });
  b.d.exit = { x: 7395, y: G - 130, w: 50, h: 130 };
  return b.done({ startScript: 'pantry_intro' });
}

// ════════════════════════════ CHAPTER 2 — FEAST ════════════════════════════
function feast(): LevelDef {
  const G = 1180;
  const b = new B({ id: 'feast', chapter: 2, title: 'Пиршественный зал', subtitle: 'Глава 2', theme: 'feast', music: 'feast', w: 8200, h: 1300, spawn: { x: 150, y: G } });
  b.floor(0, 1850, G).floor(2450, 5000, G).floor(6000, 8200, G);
  b.liquid(1850, G, 600, 'soup').liquid(5000, G, 1000, 'soup');
  b.solid(8110, -200, 120, G + 200, 'woodwall');

  // A
  b.sign(270, G, '↓', 'С тарелок и скатертей можно спрыгнуть: ↓ + прыжок.');
  b.table(350, G - 190, 520, G);
  b.plat(470, G - 320, 150, 'plate', 18).plat(660, G - 440, 150, 'plate', 18);
  b.arc(735, G - 480, 4, 100, 40).crumbs(400, 820, G - 220, 6);
  b.enemy('meatball', 900, G, { facing: -1 });
  b.sign(980, G, '!', 'Желе пружинит! Запрыгни на него — подлетишь высоко.');
  b.jelly(1050, G - 60, 140, 60, 1320);
  b.table(1180, G - 380, 670, G);
  b.solid(1360, G - 470, 180, 90, 'cake');
  b.enemy('guard', 1650, G - 380, { range: 120 });
  b.arc(1450, G - 520, 5, 140, 50);
  b.deco('chandelier', 1100, 250).deco('candle', 250, G).deco('window', 1500, G - 300, { w: 180, h: 300 });

  // B: spoon bridges over soup
  b.plat(1880, G - 300, 260, 'spoon', 24);
  b.plat(2200, G - 240, 140, 'plate', 18);
  b.table(2400, G - 200, 520, G);
  b.solid(2560, G - 270, 180, 70, 'bread');
  b.enemy('spitter', 2850, G - 200, { facing: -1 });
  b.crumbs(1920, 2120, G - 330, 5).crumbs(2420, 2560, G - 230, 4);
  b.deco('chandelier', 2200, 200);
  b.cp(3050, G);

  // King reveal
  b.deco('arch', 3420, G, { w: 760, h: 760 });
  b.npc('kingBg', 3420, G - 6, 0.36, 1);
  b.trig(3100, G - 300, 40, 300, 'feast_king');
  b.deco('candle', 3020, G).deco('candle', 3830, G);

  // arena
  b.arena(3900, 900, G, [
    [{ kind: 'guard', x: 4100, y: G }, { kind: 'meatball', x: 4500, y: G }, { kind: 'guard', x: 4700, y: G, facing: -1 }],
    [{ kind: 'jelly', x: 4050, y: G }, { kind: 'jelly', x: 4650, y: G, hue: 1 }, { kind: 'guard', x: 4350, y: G }, { kind: 'spitter', x: 4720, y: G, facing: -1 }],
  ], [{ kind: 'honey', x: 4350, y: G - 60 }]);
  b.deco('chandelier', 4350, 230);
  b.pick('fork', 4880, G - 40, 'feast_fork');
  b.sign(4960, G, 'Q', 'Q — сменить оружие. Вилка бьёт дальше и сильнее!');

  // C: soup lake with spoons, cookies, plates
  b.plat(5020, G - 120, 200, 'spoon', 24);
  b.cookie(5300, G - 200, 100);
  b.plat(5480, G - 300, 150, 'plate', 18);
  b.noodle(5555, G - 640, 270);
  b.plat(5480, G - 662, 150, 'tray', 20);
  b.cookie(5700, G - 220, 100);
  b.plat(5850, G - 140, 200, 'spoon', 24);
  b.arc(5350, G - 250, 3, 60, 30).arc(5750, G - 270, 3, 60, 30);
  b.deco('chandelier', 5500, 180);
  b.enemy('jelly', 6250, G, { hue: 2 });
  b.cp(6100, G);

  // D: tables rising
  b.table(6350, G - 180, 300, G);
  b.table(6800, G - 340, 300, G);
  b.table(7250, G - 500, 300, G);
  b.enemy('guard', 6500, G - 180, { range: 100 });
  b.enemy('meatball', 6950, G - 340, { facing: -1 });
  b.enemy('spitter', 7450, G - 500, { facing: -1 });
  b.enemy('meatball', 7100, G);
  b.crumbs(6380, 6620, G - 210, 5).crumbs(6830, 7070, G - 370, 5);
  b.plat(7620, G - 640, 130, 'plate', 18);
  b.pick('container', 7685, G - 680, 'feast_heart');
  b.deco('chandelier', 7000, 220).deco('window', 7800, G - 300, { w: 180, h: 300 });

  b.deco('door', 8040, G, { w: 120, h: 180 });
  b.d.exit = { x: 8000, y: G - 170, w: 70, h: 170 };
  return b.done({ startScript: 'feast_intro' });
}

// ════════════════════════════ CHAPTER 3 — LIBRARY ════════════════════════════
function library(): LevelDef {
  const G = 2880;
  const b = new B({ id: 'library', chapter: 3, title: 'Библиотека', subtitle: 'Глава 3', theme: 'library', music: 'library', w: 3600, h: 3000, spawn: { x: 200, y: G } });
  b.floor(60, 3540, G, 'floor');
  b.solid(0, -100, 60, 3100, 'woodwall');
  b.solid(3540, -100, 60, 3100, 'woodwall');

  // section 1: staircase
  b.sign(330, G, '↑', 'Выход из Библиотеки — под самым потолком. Карабкайся!');
  b.solid(520, G - 90, 200, 90, 'books');
  b.solid(820, G - 180, 200, 180, 'books');
  b.block(1120, G - 270, 220, 'books');
  b.enemy('guard', 650, G, { range: 120 });
  b.arc(920, G - 220, 4, 120, 40);
  b.pins(1340, G, 400);
  b.plat(1430, G - 390, 300);
  b.plat(1130, G - 520, 260);
  b.plat(1430, G - 650, 300);
  b.enemy('book', 1650, G - 520);
  b.plat(1800, G - 650, 520);
  b.enemy('guard', 2100, G - 650, { range: 180 });
  b.cp(1900, G - 650);
  b.crumbs(1450, 1700, G - 420, 5);
  b.deco('globe', 300, G, { s: 1.2 }).deco('lamp', 900, G - 900).deco('lamp', 1700, G - 1100);

  // section 2: up to the dash cloak (right side)
  b.plat(2400, G - 780, 220);
  b.plat(2700, G - 910, 220);
  b.plat(3000, G - 1040, 540);
  b.enemy('book', 2650, G - 1080);
  b.pick('dash', 3380, G - 1080, 'lib_dash');
  b.sign(3150, G - 1040, '»', 'Shift / L — рывок. Работает и в воздухе. Перелети пропасть!');
  b.crumbs(2420, 2600, G - 810, 4).crumbs(2720, 2900, G - 940, 4);
  b.trap(2380, G - 800, 260, 160, [2440, 2560], G - 1500);

  // section 3: long gaps leftwards
  b.plat(3080, G - 1180, 200);
  b.plat(2760, G - 1320, 180);
  b.plat(2160, G - 1320, 280);
  b.arc(2600, G - 1380, 5, 200, 60);
  b.trap(2160, G - 1500, 280, 180, [2200, 2300, 2400], G - 1900);
  b.enemy('book', 2450, G - 1500);
  b.plat(1720, G - 1440, 280);
  b.plat(1320, G - 1560, 280);
  b.cp(1420, G - 1560);
  b.enemy('spitter', 1900, G - 1440, { facing: -1 });

  // section 4: west, then up
  b.plat(720, G - 1560, 300);
  b.arc(1170, G - 1610, 4, 160, 50);
  b.solid(420, G - 1700, 220, 140, 'books');
  b.plat(150, G - 1830, 250);
  b.plat(460, G - 1960, 250);
  b.plat(150, G - 2090, 250);
  b.enemy('book', 600, G - 2050);
  b.plat(460, G - 2220, 420);
  b.plat(1000, G - 2260, 420);
  b.plat(1620, G - 2300, 400);
  b.enemy('spitter', 1880, G - 2300, { facing: -1 });
  b.enemy('book', 1300, G - 2420);
  b.crumbs(500, 840, G - 2250, 6).crumbs(1040, 1380, G - 2290, 6);
  b.plat(150, G - 2360, 200);
  b.pick('container', 250, G - 2400, 'lib_heart');

  // top arena + exit
  b.solid(2100, G - 2320, 1440, 60, 'bookRow');
  b.arena(2100, 1100, G - 2320, [
    [{ kind: 'book', x: 2400, y: G - 2500 }, { kind: 'book', x: 2900, y: G - 2480 }, { kind: 'guard', x: 2700, y: G - 2320 }],
    [{ kind: 'guard', x: 2300, y: G - 2320 }, { kind: 'spitter', x: 3000, y: G - 2320, facing: -1 }, { kind: 'book', x: 2650, y: G - 2520 }, { kind: 'jelly', x: 2500, y: G - 2320, hue: 1 }],
  ], [{ kind: 'honey', x: 2650, y: G - 2380 }]);
  b.cp(3300, G - 2320);
  b.deco('door', 3440, G - 2320, { w: 110, h: 170 });
  b.d.exit = { x: 3400, y: G - 2490, w: 70, h: 170 };
  b.deco('lamp', 2650, G - 2900).deco('cobweb', 60, 0).deco('lamp', 800, G - 2600);
  return b.done({ startScript: 'library_intro', darkness: 0.35 });
}

// ════════════════════════════ CHAPTER 4 — CHASE ════════════════════════════
function chase(): LevelDef {
  const G = 1180;
  const b = new B({ id: 'chase', chapter: 4, title: 'Погоня', subtitle: 'Глава 4', theme: 'gallery', music: 'chase', w: 9800, h: 1300, spawn: { x: 1250, y: G } });
  b.floor(0, 2600, G, 'carpet').floor(3000, 3500, G, 'carpet').floor(4100, 6400, G, 'carpet').floor(6900, 8000, G, 'carpet').floor(8320, 9800, G, 'carpet');
  b.liquid(2600, G, 400, 'soup').liquid(3500, G, 600, 'soup').liquid(6400, G, 500, 'soup').liquid(8000, G, 320, 'soup');
  b.solid(9700, -200, 140, G + 200, 'stone');

  b.deco('torch', 1500, G - 300).deco('banner', 1900, G - 640).deco('torch', 2400, G - 300);
  b.solid(1650, G - 80, 120, 80, 'crate');
  b.forks(1960, G, 100);
  b.enemy('guard', 2350, G, { range: 60, facing: -1 });
  b.table(2600, G - 160, 400, G);
  b.crumbs(2620, 2980, G - 190, 5);
  b.plat(3150, G - 460, 140, 'shelf');
  b.noodle(3220, G - 438, 300);
  b.plat(3550, G - 120, 140, 'plate', 18).plat(3780, G - 200, 140, 'plate', 18).plat(3990, G - 120, 140, 'plate', 18);
  b.cp(4300, G);
  b.deco('torch', 4300, G - 300).deco('banner', 3800, G - 640);

  b.jelly(4600, G - 60, 130, 60, 1420);
  b.sign(4520, G, '!', 'Стена! Отпрыгни от желе!');
  b.plat(4700, G - 440, 760, 'shelf');
  b.block(4950, G - 320, 150, 'books');
  b.arc(5100, G - 490, 6, 300, 50);
  b.enemy('spitter', 5800, G - 260, { facing: -1 });
  b.plat(5700, G - 260, 240, 'shelf');
  b.enemy('guard', 5600, G, { range: 60, facing: -1 });
  b.trap(5900, G - 200, 300, 200, [6000, 6150, 6300], G - 900);
  b.cookie(6450, G - 120, 100).cookie(6650, G - 160, 100);
  b.crumbs(6460, 6740, G - 200, 5);
  b.cp(7100, G);
  b.deco('torch', 7100, G - 300).deco('banner', 6600, G - 640).deco('statue', 5300, G, { s: 0.6 });

  b.forks(7300, G, 100);
  b.solid(7600, G - 100, 140, 100, 'crate');
  b.noodle(7780, G - 600, 340);
  b.plat(7700, G - 622, 160, 'shelf');
  b.sign(7900, G, '»', 'Рывок! Shift / L — в прыжке!');
  b.arc(8160, G - 160, 5, 260, 80);
  b.enemy('guard', 8700, G, { range: 60, facing: -1 });
  b.forks(8900, G, 90);
  b.enemy('meatball', 9200, G, { facing: -1 });
  b.deco('door', 9550, G, { w: 220, h: 320 });
  b.deco('torch', 9350, G - 300).deco('torch', 9750, G - 300);
  b.d.exit = { x: 9500, y: G - 300, w: 100, h: 300 };
  return b.done({ startScript: 'chase_intro', special: 'chase', zoom: 0.85 });
}

// ════════════════════════════ CHAPTER 5 — THRONE ════════════════════════════
function throne(): LevelDef {
  const G = 980;
  const b = new B({ id: 'throne', chapter: 5, title: 'Король Громадин', subtitle: 'Глава 5', theme: 'throne', music: 'boss', w: 1800, h: 1100, spawn: { x: 200, y: G } });
  b.floor(0, 1800, G, 'carpet');
  b.plat(230, G - 150, 210, 'cushion', 30);
  b.plat(1360, G - 150, 210, 'cushion', 30);
  b.plat(800, G - 185, 200, 'cushion', 30);
  b.deco('moonbeam', 900, G, { w: 520, h: 1300 });
  b.deco('torch', 70, G - 360).deco('torch', 1730, G - 360);
  b.deco('banner', 260, G - 760).deco('banner', 1540, G - 760);
  return b.done({ startScript: 'throne_intro', special: 'boss', zoom: 0.82 });
}

export const LEVELS: Record<string, () => LevelDef> = { pantry, feast, library, chase, throne };

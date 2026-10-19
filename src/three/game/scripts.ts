import * as THREE from 'three';
import { audio } from '../../engine/audio';
import { choose, ease, lerp, rand } from '../../engine/util';
import { Script, wait, tween, all, until } from '../../game/coroutine';
import { createDog, createDogFist } from '../models';
import { mat, mesh, PAL } from '../gfx';
import { bucket } from '../world/outdoor';
import { Pickup3 } from './objects';
import { KingChaser3 } from './boss';
import { KingBoss3 } from './throneBoss';
import { FeastKing3 } from './feast';
import { FEAST_KING, FEAST_SPOTS, CHASE, CHASE_SMASH, CHASE_SPOTS, THRONE_SEAT, LIB_PORTAL } from './levels';
import type { MagicBookPortal } from '../world/portal';
import { BreakWall } from './chase';
import { SpagMonster3 } from './spaghettiMonster';
import type { Level3D } from './level';
import type { Waiter } from '../../game/coroutine';
import { net } from '../../net/session';

/*
 * Co-op (see docs/MULTIPLAYER.md): the host calls L.run(name) and EVERY machine plays the same script with its own
 * camera and its own hero (dialog lines advance by themselves). So a script is split into
 *  • presentation — camera, dialog, MY hero (auto/hidden/faceYaw/forceState/expr), NPC anims, item-get — runs everywhere;
 *  • world actions — boss.start(), the chaser's front/speed/active, the feast King's flags, L.endLevel() — run once,
 *    where L.authority is true (solo, or the host); clients see them through replication. (The wall burst, the King's
 *    priming and the chaser's head start guard themselves: BreakWall / FeastKing3 / KingChaser3.)
 * Waits on world things (the King's hands) read the replicated state, so every machine stays on the same beat;
 * waits on MY things (a walk, the item card) are capped so no one holds the scene.
 * Solo takes exactly the old code path everywhere (L.nl === null, L.authority === true).
 */

type ScriptFn = (L: Level3D) => Script;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function* chapterTitle(L: Level3D) {
  L.hud.showChapter(L.def.title, L.def.subtitle);
  L.bannerShown = true;
  yield undefined;
}

/** wait until cond() is true, but at most max seconds */
function untilOr(cond: () => boolean, max: number): Waiter {
  let t = 0;
  return { update: (dt: number) => { t += dt; return cond() || t >= max; } };
}

// ───────────── co-op helpers (each is the old behaviour / a no-op in solo) ─────────────

/** my place in the team, in the same order as the spawn ring in Level3D (0 in solo) */
function slotOf(L: Level3D) {
  if (!L.nl) return 0;
  const ids = [...net.members.keys()].sort();
  return Math.max(0, ids.indexOf(net.myId));
}

/** spots for scripted walks: [along the facing (− = behind), sideways]; the first hero stands on the mark */
const FORMATION: [number, number][] = [[0, 0], [0, 1.5], [0, -1.5], [-1.5, 0.75], [-1.5, -0.75], [-1.5, 2.25]];
/** co-op: a hero farther than this from the mark (or on another floor) is gathered there instead of walking blind */
const GATHER = 16;
const DONE: Waiter = { update: () => true };

/**
 * Walk MY hero to (x, z) on the floor at floorY, the spot facing along (fx, fz). Solo: exactly L.walkTo.
 * Co-op: every hero takes its own spot of a little formation (no stacking); a friend still far behind (another
 * floor, the other end of the room) pops over to his spot in a puff of stars; a blocked / dead / downed hero never
 * holds the scene for more than `max` seconds.
 */
/** MY spot of the formation around the mark (x, z) on the floor at floorY, facing (fx, fz) — the mark itself in solo */
function spotOf(L: Level3D, x: number, z: number, fx: number, fz: number, floorY: number) {
  const [a, b] = FORMATION[slotOf(L) % FORMATION.length];
  const l = Math.hypot(fx, fz) || 1, dx = fx / l, dz = fz / l;
  let tx = x, tz = z;
  // the full offset, or half of it, whichever is not inside a wall / prop
  for (const k of [1, 0.5]) {
    const cx = x + (dx * a - dz * b) * k, cz = z + (dz * a + dx * b) * k;
    if (!L.phys.pointInSolid(V(cx, floorY + 0.5, cz), 'hero')) { tx = cx; tz = cz; break; }
  }
  return { x: tx, z: tz, dx, dz };
}

/**
 * Put MY hero on his spot by the mark at once — for a shot that doesn't show him, so the scene can be staged around
 * a known place wherever the fight ended (co-op: everyone gets their own spot; friends see a jump, not a slide).
 */
function placeMine(L: Level3D, x: number, z: number, fx: number, fz: number, floorY: number) {
  const p = L.player;
  if (p.dead || p.grabbedBy) return;
  const s = spotOf(L, x, z, fx, fz, floorY);
  const gy = L.phys.groundAt(s.x, s.z, floorY + 2, 0.3);
  L.teleportMe(V(s.x, (gy > floorY - 3 ? gy : floorY) + 0.05, s.z), Math.atan2(s.dx, s.dz));
}

function walkMine(L: Level3D, x: number, z: number, speed: number, fx: number, fz: number, floorY: number, max = 6): Waiter {
  if (!L.nl) return L.walkTo(x, z, speed);
  const p = L.player;
  if (p.dead || p.downed || p.grabbedBy) return DONE;
  const { x: tx, z: tz, dx, dz } = spotOf(L, x, z, fx, fz, floorY);
  if (Math.hypot(p.pos.x - tx, p.pos.z - tz) > GATHER || Math.abs(p.pos.y - floorY) > 2) {
    const gy = L.phys.groundAt(tx, tz, floorY + 2, 0.3);
    if (gy > floorY - 3) {
      L.fx.stars(p.center(), 16, ['#ffe14a', '#fff3c0', '#ffffff']);
      L.teleportMe(V(tx, gy + 0.05, tz), Math.atan2(dx, dz)); // (friends see a jump, not a slide through the shelves)
      L.fx.stars(p.center(), 24, ['#ffe14a', '#fff3c0', '#ffffff']);
      audio.sfx('whoosh', { pitch: 1.3, volume: 0.6 });
      return DONE;
    }
  }
  p.auto = { x: tx, z: tz, speed };
  let t = 0;
  return { update: (dt: number) => { t += dt; if (p.auto && (t > max || p.dead || p.downed)) p.auto = null; return p.auto === null; } };
}

/**
 * The gift's item card. Solo: waits for the player to close it. Co-op: the card closes by itself after a few seconds
 * (or sooner on a press), so the shared scene doesn't wait for the slowest reader.
 */
function* itemCard(L: Level3D): Script {
  if (!L.nl) { yield until(() => !L.itemGetting); return; }
  yield untilOr(() => !L.itemGetting || (L.popup.active && L.popup.t > 3.2), 8);
  if (L.popup.active) L.popup.close();
  yield untilOr(() => !L.itemGetting, 2);
}

/**
 * What a script still does after its shared beat is over (a late toast, an expression reset).
 * Solo: inline, exactly as before. Co-op: on the side, so the world (L.worldCut lasts as long as the story
 * script) is not held frozen for it.
 */
function* tail(L: Level3D, g: Script): Script {
  if (L.nl) L.runGen(g);
  else yield* g;
}

/**
 * Personal feedback (my runner hints, the book banner) from inside an actor's update: the host captures effects of
 * the world tick and replays them on every client, which must not happen for these (each machine shows its own).
 */
function mine(L: Level3D, f: () => void) {
  const nl = L.nl;
  if (!nl || !nl.capturing) { f(); return; }
  nl.capturing = false;
  try { f(); } finally { nl.capturing = true; }
}

/** a random line — co-op: the same one on every machine (picked by the room's shared clock, not Math.random) */
function line(L: Level3D, xs: string[]) {
  if (!L.nl) return choose(xs);
  const n = xs.length;
  return xs[((Math.floor(net.time() / 5) % n) + n) % n];
}

/** a line said to (or about) the whole team: solo — one Тоша, co-op — the plural (the same on every machine) */
function pl(L: Level3D, solo: string, coop: string) { return L.nl ? coop : solo; }

/**
 * A personal reaction (a palm that just missed): solo — a dialog line; co-op — a bark over the hero it happened to,
 * so a room full of Тоши doesn't say it in chorus.
 */
function* react(L: Level3D, h: { root?: THREE.Object3D } | null, str: string, expr?: string): Script {
  if (!L.nl) { yield L.say('hero', str, expr); return; }
  const obj = h?.root ?? L.player.root;
  L.bark(obj, str, 1.8, 1.9);
  yield wait(1.4);
}

/** an exit scene starts — co-op: on every machine when the host says the team is through the door */
function exitStart(L: Level3D) {
  if (L.nl) { L.complete = true; L.exitWait = null; }
}

/** the chapter is over: the host (or solo) ends it; clients get the host's 'end' (and their own results card) */
function finish(L: Level3D) {
  if (L.authority) L.endLevel();
}

/** where the King's fist hits the gallery wall (BreakWall itself tells every client when the host bursts it) */
const WALL_HIT = () => V(CHASE.wallX, 10, 0);

/**
 * Hand control to the player in runner mode with the King on his heels.
 * Co-op: every machine puts its own runner in runner mode; only the host wakes the King (who gives the rearmost
 * runner a head start himself — see KingChaser3).
 */
function startChase(L: Level3D, ch: KingChaser3, speed: number) {
  const p = L.player;
  L.tcam.mode = 'chase'; L.camModeDefault = 'chase';
  L.tcam.focus.copy(p.pos);
  p.autoRun = 8.4;
  L.hud.showBanner('БЕГИ!!!', '#ff5a4a');
  p.expr = 'angry';
  audio.playMusic('chase');
  if (L.authority) { ch.active = true; ch.speed = speed; }
  if (L.nl) L.refs.chaseOn = true;
  L.toast('A / D — уворачивайся, W — быстрее, S — тормози, Пробел — прыжок, Shift — рывок');
}

/** the chase restarts after a respawn: a short countdown, then run (solo: a side coroutine; co-op: the 'chase_retry' script) */
function* chaseRetry(L: Level3D): Script {
  L.refs.chaseRetry = true;
  L.player.control = false;
  L.hud.showBanner('ПРИГОТОВЬСЯ...', '#ffd34a');
  L.shout(line(L, [pl(L, 'Никуда ты не денешься!', 'Никуда вы не денетесь!'), 'Опять бегать?!', 'Я ИДУ!']), 1.6);
  audio.playMusic('chase');
  yield wait(1.3);
  L.player.control = true;
  startChase(L, L.chaser as KingChaser3, 5);
}

/** the victory scene's mark: in the moonlight in front of the throne */
const VIC = V(0, 0, 5);
/** people talking to each other turn this much (m) toward the camera at +z, so a face reads instead of a cheek */
const CHEAT = 2.2;

/**
 * Which side of MY hero (−1 = −x, the default, or +1) has nobody else standing within `d` m of it — Bublik lands
 * there in the victory scene (co-op: a friend may be on his formation spot beside me).
 */
function freeSide(L: Level3D, d: number) {
  const p = L.player;
  const room = (sx: number) => Math.min(d * 2, ...L.heroes().filter((h) => h !== p && !h.hidden).map((h) => Math.hypot(h.pos.x - (p.pos.x + sx * d), h.pos.z - p.pos.z)));
  return room(-1) >= Math.min(d, room(1)) ? -1 : 1;
}

/** world point relative to the player */
const near = (L: Level3D, dx: number, dy: number, dz: number) => L.player.pos.clone().add(V(dx, dy, dz));

const scripts: Record<string, ScriptFn> = {
  // ───────────── CHAPTER 1: PANTRY ─────────────
  *pantry_intro(L) {
    const p = L.player;
    L.cutscene(true);
    p.forceState = 'dead'; p.expr = 'sleepy';
    yield L.shot(near(L, 3, 1.5, 4), near(L, 0, 0.4, 0), 0);
    yield wait(1.2);
    p.forceState = 'sit';
    audio.sfx('thud', { volume: 0.4 });
    yield wait(0.7);
    yield L.say('hero', 'Ой-ой-ой... Где это я?');
    p.forceState = null; p.expr = 'surprised'; p.squash = 0.7;
    yield wait(0.4);
    yield L.say('hero', 'Бублик? БУБЛИК! Ты где?!', 'scared');
    // reveal the giant pantry
    yield L.shot(near(L, -2, 3, 8), near(L, 0, 14, -30), 2.4);
    yield L.say('hero', 'Ничего себе... Тут всё такое ОГРОМНОЕ! Банки, ящики... я как муравей!', 'surprised');
    yield L.shot(near(L, 0, 2.2, 5), near(L, 0, 1, 0), 1.2);
    p.expr = 'angry';
    yield L.say('hero', 'Ладно. Надо выбраться отсюда и найти Бублика!', 'angry');
    p.expr = undefined;
    yield L.camBack(0.8);
    L.cutscene(false);
    yield* chapterTitle(L);
    yield* tail(L, (function* () {
      yield wait(4.5);
      L.toast('Кликни по экрану — и крути камеру мышью');
    })());
  },

  // co-op: every hero walks up to the bear (own spot; a friend far behind is gathered) and gets their own slingshot
  *pantry_bear(L) {
    const p = L.player;
    const bear = L.npcs.bear;
    L.cutscene(true);
    const bp = bear.root.position;
    yield walkMine(L, bp.x - 3.2, bp.z + 1.2, 0.5, 3.2, -1.2, bp.y - 1.2);
    p.faceYaw = Math.atan2(bp.x - p.pos.x, bp.z - p.pos.z);
    yield L.shot(V(bp.x - 1.5, bp.y + 2.5, bp.z + 6), V(bp.x - 1.6, bp.y + 1.4, bp.z), 1.2);
    bear.anim.wave = 1;
    yield L.say('bear', pl(L, 'Хо-хо! Опять кто-то свалился. Ну здравствуй, малыш.', 'Хо-хо! Сразу целая компания свалилась! Здравствуйте, малыши.'));
    bear.anim.wave = 0;
    yield L.say('hero', 'Ой! Здрасьте... А вы кто?', 'surprised');
    yield L.say('bear', 'Я — Вторник. Свалился сюда во вторник — так и зовусь. Сижу тут лет сорок.');
    yield L.say('bear', 'Это Громадное королевство. Король — последний из Громадин, великанов. Мы для него — крошки.');
    yield L.say('bear', 'Над нами — Хрумляндия, целая страна. Король топает — земля трескается, и все падают к нему.');
    yield L.say('hero', pl(L, 'А как отсюда выбраться?', 'А как нам отсюда выбраться?'));
    yield L.shot(V(bp.x + 3, bp.y + 2.2, bp.z + 4.5), V(bp.x - 1, bp.y + 1.6, bp.z), 1.5);
    yield L.say('bear', pl(L, 'Никак, дружок. Король скучает один — вот и собирает всех, кто упал. Насовсем.', 'Никак, дружочки. Король скучает один — вот и собирает всех, кто упал. Насовсем.'));
    p.expr = 'angry';
    yield L.say('hero', pl(L, 'Всё равно выберусь! И друга найду — он тоже упал. Вы таксу не видели?', 'Всё равно выберемся! И Бублика найдём — он тоже упал. Вы таксу не видели?'), 'angry');
    p.expr = undefined;
    yield L.say('bear', 'Таксу? Нет. Но в Лунном колодце с ночи что-то скрипит. И ворчит про пироги.');
    yield L.say('bear', pl(L, 'Упрямый. Прямо как я в молодости... Держи-ка — от прошлого гостя осталась.', 'Упрямые. Прямо как я в молодости... Держите-ка — от прошлых гостей остались.'));
    L.collect(new Pickup3('sling', p.pos.clone().setY(p.pos.y + 1), 'pantry_sling'));
    yield* itemCard(L);
    yield L.say('bear', 'Лунный колодец — в Тронном зале. Туда все ходы ведут через пир и Библиотеку.');
    yield L.say('bear', pl(L, 'Сам бы ушёл, да колодец высоченный — медведю не влезть. Заглядывай ко мне в берлогу!', 'Сам бы ушёл, да колодец высоченный — медведю не влезть. Заглядывайте ко мне в берлогу!'));
    yield L.say('hero', 'Спасибо, дедушка Вторник!', 'happy');
    bear.anim.wave = 1;
    p.faceYaw = null;
    yield L.camBack(0.8);
    bear.anim.wave = 0;
    L.cutscene(false);
    L.toast('Рогатка: щелчок ПКМ — автоприцел, зажми ПКМ — целься сам');
  },

  *exit_pantry(L) {
    const p = L.player;
    exitStart(L);
    L.cutscene(true);
    yield L.shot(near(L, 2.5, 2, 3.5), near(L, -1, 1, -1), 0.8);
    yield L.say('hero', 'Пиршественный зал... Звучит вкусно. И опасно.');
    p.auto = { x: p.pos.x - 3, z: p.pos.z, speed: 0.6 };
    yield wait(0.6);
    p.hidden = true;
    audio.sfx('door');
    yield wait(0.6);
    finish(L);
  },

  // ───────────── CHAPTER 2: FEAST ─────────────
  // world (host): the King's flags and the primed feeding; clients watch the host's King (hand states arrive in
  // his snapshots, so every machine waits for the same moments of the meal)
  *feast_intro(L) {
    const p = L.player;
    const k = L.refs.feastKing as FeastKing3;
    L.cutscene(true);
    if (L.authority) k.dangerous = false;
    // the endless table, the King at its far end
    yield L.shot(V(-7, 12, 10), V(80, 6, 0), 0);
    yield wait(0.5);
    yield all(L.say('hero', 'Ммм... Пахнет так, будто тут кормят великана.'), L.shot(V(-4.5, 10.5, 7.5), V(80, 6, 0), 2.5));
    // the feeding, watched without dialog boxes (barks only)
    k.primeFeeding(); // (host only — a client's King gets it from the snapshots)
    yield L.shot(V(103, 7, 19), V(128, 7.5, 2), 0);
    L.bark(k.rig.head, 'ЕЩЁ! Ещё мяса! Я проголодался!', 2.4, 8); k.talk = 0.8;
    yield all(L.shot(V(106.5, 6.5, 15.5), V(128.5, 7, 2), 5), untilOr(() => k.hands[1].state === 'toMouth', 6.5));
    const feeder = k.pairs[0].guards[0].root;
    L.bark(feeder, 'Приятного аппетита, Ваше Громадейшество!', 2.2, 1.8);
    yield untilOr(() => k.hands[1].state === 'back', 3);
    yield wait(0.6);
    // (said over the King, still on screen: the hero is watching him from the far end of the table)
    p.expr = 'scared';
    yield L.say('hero', 'Ой... Так это и есть Король Громадин?!', 'scared');
    yield L.shot(V(98, 9, 8), V(117, 4, -44), 1.8);
    yield L.say('hero', 'А вон и дверь в Библиотеку — прямо возле его стола. Придётся пройти через весь пир...');
    yield L.shot(near(L, -2.4, 1.9, 3.2), near(L, 0, 0.9, 0), 1.0);
    p.expr = 'angry';
    yield L.say('hero', 'Главное — не попасться ему на глаза. А то оставит у себя. Насовсем.', 'angry');
    p.expr = undefined;
    yield L.camBack(0.8);
    if (L.authority) k.dangerous = true;
    L.cutscene(false);
    yield* chapterTitle(L);
  },

  // world (host): which snack the hand comes for + the flags. Every machine picks the same snack the same way
  // (nearest to any hero on the table) so all cameras look where the hand lands.
  *feast_king(L) {
    const p = L.player;
    const k = L.refs.feastKing as FeastKing3;
    L.cutscene(true);
    if (L.authority) k.dangerous = false;
    // the snack hand comes down right next to the hero
    const alive = L.nl ? L.alivePlayers() : [];
    const hs = alive.length ? alive : [p];
    const dist = (s: { at: THREE.Vector3 }) => Math.min(...hs.map((h) => s.at.distanceTo(h.pos)));
    const snack = k.snacks.filter((s) => s.obj).sort((a, b) => dist(a) - dist(b))[0] ?? null;
    if (L.authority && snack && k.hands[0].state === 'rest') k.forceSnack = snack;
    const look = snack ? snack.at.clone().setY(1.5) : near(L, 6, 1.5, 0);
    yield L.shot(V(p.pos.x - 7, 6.5, p.pos.z + 9), look, 0.8);
    // the palm lands (a client may see the short 'grab' only as the hand already carrying the snack away)
    yield untilOr(() => k.hands[0].state === 'grab' || (!L.authority && k.hands[0].state === 'toMouth'), 4.5);
    p.expr = 'scared'; p.squash = 0.7;
    // (co-op: only the hero the palm came down next to cries out)
    const close = snack ? [...hs].sort((a, b) => a.pos.distanceTo(snack.at) - b.pos.distanceTo(snack.at))[0] : p;
    yield* react(L, close as unknown as { root?: THREE.Object3D }, 'Ай! Чуть не прихлопнул!', 'scared');
    const face = k.face();
    yield L.shot(V(face.x - 30, face.y + 3, 16), V(face.x - 2, face.y - 2, 0), 1.2);
    yield L.say('king', 'Слышите, малявки? Никто... ням... никто и никогда не уходит из моего королевства. Тут же так уютно...', 'chew');
    yield L.camBack(1.0);
    yield L.say('hero', 'Ой-ой... Сейчас как шлёпнет! Надо смотреть под ноги.', 'scared');
    p.expr = undefined;
    if (L.authority) k.dangerous = true;
    L.cutscene(false);
    L.toast('Светящийся круг — сюда опустится ладонь Короля!');
  },

  *exit_feast(L) {
    const p = L.player;
    const k = L.refs.feastKing as FeastKing3;
    exitStart(L);
    L.cutscene(true);
    if (L.authority) { k.noticed = true; k.dangerous = false; }
    yield L.shot(near(L, 2.6, 1.9, 3.2), near(L, 0, 1.1, -2), 0.5);
    audio.sfx('warn', { pitch: 0.7 });
    yield wait(0.5);
    const face = k.face();
    const kingShot = () => L.shot(V(face.x - 24, face.y - 2, -16), face.clone().setY(face.y - 1), 0.6);
    yield kingShot();
    yield L.say('king', 'Э-э-э?! А это ещё КТО бегает по моему столу?!', 'angry');
    yield L.shot(near(L, 2.4, 1.8, 3), near(L, 0, 1, 0), 0.5);
    p.expr = 'scared'; p.faceYaw = Math.atan2(face.x - p.pos.x, face.z - p.pos.z);
    yield L.say('hero', pl(L, 'Ой-ой... Заметил!', 'Ой-ой... Он нас заметил!'), 'scared');
    yield kingShot();
    audio.sfx('roar'); L.tcam.shake(0.8);
    yield L.say('king', pl(L, 'СТРАЖА! ДЕРЖИТЕ ЕГО! Никто не уходит из моего королевства!!!', 'СТРАЖА! ДЕРЖИТЕ ИХ! Никто не уходит из моего королевства!!!'), 'angry');
    p.faceYaw = null;
    yield L.shot(near(L, 3, 2, 3), near(L, 0, 1.2, -2), 0.4);
    p.auto = { x: p.pos.x, z: p.pos.z - 3, speed: 1 };
    yield wait(0.5);
    p.hidden = true; audio.sfx('door');
    yield wait(0.6);
    finish(L);
  },

  // ───────────── CHAPTER 3: LIBRARY ─────────────
  *library_intro(L) {
    L.cutscene(true);
    yield L.shot(near(L, 0, 2, 7), near(L, 0, 1.5, 0), 0);
    yield wait(0.4);
    yield L.say('hero', 'Сколько книг! Может, тут есть книжка «Как сбежать от короля»?');
    yield L.say('hero', pl(L, 'Тихо... Стража ищет меня по всему замку. Надо наверх, и быстро.', 'Тихо... Стража ищет нас по всему замку. Надо наверх, и быстро.'));
    yield L.shot(near(L, 0, 4, 4), near(L, 0, 70, -10), 2.4);
    yield L.say('hero', 'Вторник говорил: волшебная книга — на самом верху. Придётся карабкаться по полкам!');
    yield L.camBack(1.4);
    L.cutscene(false);
    yield* chapterTitle(L);
  },

  // co-op: every hero flies into the pages on their own machine (friends see them vanish)
  *exit_library(L) {
    const p = L.player;
    const book = L.refs.portal as MagicBookPortal;
    const pc = book.pageCenter.clone();
    exitStart(L);
    L.cutscene(true);
    p.body.gravity = 0; p.body.vel.set(0, 0, 0);
    L.bark(p.root, 'Ух ты-ы-ы!', 1.4, 1.6);
    audio.sfx('artifact', { pitch: 0.7 }); audio.sfx('whoosh', { pitch: 0.8 });
    yield L.shot(pc.clone().add(V(5.5, -2.5, 9)), pc.clone().add(V(0, -1, 0)), 0.5);
    const from = p.pos.clone();
    yield tween(1.1, (k) => {
      p.body.pos.lerpVectors(from, pc.clone().add(V(0, -0.5, -0.6)), k);
      p.yaw += 0.25 + k * 0.6;
      p.root.scale.setScalar(Math.max(0.05, 1 - k * 0.95));
      if (Math.random() < 0.5) L.fx.stars(p.center(), 3, ['#ffe14a', '#fff3c0']);
    }, ease.inCubic);
    p.hidden = true; p.root.scale.setScalar(1);
    L.whiteFlash = 1;
    L.fx.stars(pc, 60, ['#ffe14a', '#fff3c0', '#ffffff']);
    yield wait(0.7);
    p.body.gravity = 32;
    finish(L);
  },

  // ───────────── CHAPTER 4: CHASE ─────────────
  // world (host): the King's front line, the wall burst (BreakWall sends it to everyone), the chaser waking up.
  // Every machine: the gallery reveal for its own hero and runner mode.
  *chase_intro(L) {
    const p = L.player;
    const ch = L.chaser as KingChaser3;
    const wall = L.refs.breakWall as BreakWall;
    L.cutscene(true);
    audio.playMusic('tension');
    // the magic book spits the hero out into the gallery
    p.hidden = true;
    yield L.shot(near(L, 4, 2.4, 5.5), near(L, 0, 1.4, 0), 0);
    yield wait(0.4);
    L.whiteFlash = 0.8;
    audio.sfx('artifact', { pitch: 0.75 });
    L.fx.stars(p.center().setY(p.pos.y + 1.5), 50, ['#ffe14a', '#fff3c0', '#ffffff']);
    L.fx.ring(p.pos.clone().setY(p.pos.y + 0.1), 3, '#ffe14a', 0.5);
    p.hidden = false; p.body.pos.y += 1.8; p.expr = 'surprised';
    yield wait(1.0);
    yield L.say('hero', pl(L, 'Ух! Книжка опять меня выплюнула... Вот она, Большая галерея!', 'Ух! Книжка опять нас выплюнула... Вот она, Большая галерея!'), 'surprised');
    p.faceYaw = Math.PI / 2;
    yield L.shot(near(L, -3, 2.6, 2.5), V(300, 7, 0), 1.6);
    p.expr = 'happy';
    yield L.say('hero', pl(L, 'Вон там, в конце — Тронный зал. А в нём — Лунный колодец. Почти выбрался!', 'Вон там, в конце — Тронный зал. А в нём — Лунный колодец. Почти выбрались!'), 'happy');
    // rumble from behind
    audio.sfx('thud', { pitch: 0.45 }); L.tcam.shake(0.4);
    yield wait(0.55);
    audio.sfx('thud', { pitch: 0.45 }); L.tcam.shake(0.6);
    yield wait(0.45);
    p.expr = 'scared'; p.faceYaw = -Math.PI / 2;
    yield L.shot(V(13, 2.6, 8), V(CHASE.wallX + 6, 12, 0), 0.7);
    yield L.say('hero', '...А это ещё что?', 'scared');
    audio.sfx('bigSlam'); L.tcam.shake(0.8);
    L.fx.dust(V(CHASE.wallX + 1, 6, rand(-6, 6)), 18, '#c8b8d8');
    yield wait(0.7);
    // BOOM — the King bursts through the wall (clients: the host's King arrives in snapshots, the burst as an event)
    if (L.authority) ch.front = CHASE.wallX - 8;
    yield tween(0.9, (k) => {
      if (!L.authority) return;
      ch.front = lerp(CHASE.wallX - 8, CHASE.wallX + 14, k);
      if (k > 0.12 && !wall.broken) wall.burst(L, WALL_HIT());
    }, ease.outCubic);
    audio.sfx('roar'); L.tcam.shake(1);
    yield wait(0.4);
    yield L.shot(V(2, 5, 12), V((L.authority ? ch.front : CHASE.wallX + 14) - 11, 22, 0), 0.6);
    yield L.say('king', pl(L, 'ВОТ ТЫ ГДЕ, КРОШКА!!!', 'ВОТ ВЫ ГДЕ, КРОШКИ!!!'), 'angry');
    yield L.say('king', pl(L, 'Я сто лет никуда не бегал... НО РАДИ ТЕБЯ — ПОБЕГУ!', 'Я сто лет никуда не бегал... НО РАДИ ВАС — ПОБЕГУ!'), 'angry');
    audio.sfx('roar'); L.tcam.shake(1);
    yield wait(0.3);
    p.faceYaw = null;
    // a head start for the hero (co-op: the King gives the rearmost runner one himself when he wakes up)
    if (!L.nl) ch.front = Math.min(ch.front, p.pos.x - 16);
    // a client that somehow missed the host's burst (event and snapshots) must still not run into a solid wall
    if (!L.authority && !wall.broken) wall.burst(L, WALL_HIT(), 1, true);
    L.cutscene(false);
    startChase(L, ch, 4);
    yield* tail(L, (function* () {
      yield wait(2);
      p.expr = undefined;
    })());
  },

  // co-op countdown after a team restart from a candle: the host decides (special.chase), everyone runs it
  chase_retry: chaseRetry,

  *exit_chase(L) {
    const ch = L.chaser as KingChaser3;
    exitStart(L);
    L.cutscene(true);
    L.allowHurtInCutscene = false;
    // the portcullis is shut behind the team: a look back at the King behind the bars, then out the door (boss.ts)
    yield* ch.exitBeat(L);
    finish(L);
  },

  // ───────────── CHAPTER 5: THRONE ─────────────
  // every machine: the walk-in (own spot), the King's leap (a local tween of the root — the boss holds still while
  // manualRoot is set), dialog. World (host): boss.start() — clients see the fight through the boss's replication.
  *throne_intro(L) {
    const p = L.player;
    const boss = L.boss as KingBoss3;
    L.cutscene(true);
    boss.manualRoot = true;
    boss.root.visible = false;
    audio.playMusic('tension');
    yield L.shot(V(0, 4, 30), V(0, 3, 0), 0);
    yield walkMine(L, 0, 12, 0.6, 0, -1, 0);
    p.faceYaw = Math.PI;
    p.forceState = 'lookUp'; p.expr = 'happy';
    yield L.shot(V(3, 2.2, 17), V(0, 30, -4), 2.0);
    yield L.say('hero', 'Лунный колодец! Вон там, наверху — небо!', 'happy');
    // far up the shaft, faintly: Бублик is still on his way down (he lands in the victory scene)
    const well = new THREE.Object3D();
    well.position.set(0, 27, -4);
    L.scene.add(well);
    L.bark(well, '...То-о-оша-а!.. Я ско-о-оро!..', 4.4, 0);
    yield wait(1.6);
    p.expr = 'surprised';
    yield L.say('hero', pl(L, 'Бублик?! Это ты?! Бублик, я здесь!', 'Бублик?! Это ты?! Бублик, мы здесь!'), 'surprised');
    L.scene.remove(well);
    p.forceState = null;
    audio.sfx('thud', { pitch: 0.5 }); L.tcam.shake(0.4);
    yield wait(0.6);
    audio.sfx('thud', { pitch: 0.5 }); L.tcam.shake(0.6);
    yield wait(0.45);
    p.faceYaw = 0; p.expr = 'scared';
    yield L.shot(near(L, -2.5, 1.6, -3.5), near(L, 0, 1.2, 0), 0.5);
    yield L.say('hero', 'Ой-ой... Он что, уже здесь?!', 'scared');
    // the King leaps over the hero from the gallery doors and lands on his throne
    yield L.shot(near(L, 1.5, 1.0, -5), V(0, 18, -20), 0.4);
    boss.root.visible = true;
    const from = V(0, 0, 58), to = THRONE_SEAT.clone();
    audio.sfx('whoosh', { pitch: 0.4 }); audio.sfx('roar', { volume: 0.5 });
    p.faceYaw = Math.PI;
    yield tween(1.5, (k) => {
      boss.root.position.lerpVectors(from, to, k);
      boss.root.position.y += Math.sin(Math.PI * k) * 52;
      boss.root.rotation.x = Math.sin(Math.PI * k) * -0.35;
      boss.anim.stand = 1 - k * k;
      boss.anim.anger = 0.8; boss.anim.eye = 1;
      for (const h of boss.hands) h.pos.copy(boss.restPos(h));
      boss.syncRig(0.016);
    });
    boss.root.rotation.x = 0;
    audio.sfx('bigSlam'); audio.sfx('thud', { pitch: 0.4 });
    L.tcam.shake(1.4);
    L.fx.dust(THRONE_SEAT.clone().setY(0).add(V(0, 0, 10)), 50, '#c8b0e0');
    L.fx.ring(THRONE_SEAT.clone().setY(0.2).add(V(0, 0, 10)), 20, '#ffffff', 0.5);
    boss.manualRoot = false;
    p.expr = 'scared';
    yield wait(0.5);
    yield L.shot(V(0, 7, 18), V(0, 20, -28), 1.0);
    yield L.say('king', pl(L, 'Думал, решётка меня удержит? Я через неё ПЕРЕЛЕЗ!', 'Думали, решётка меня удержит? Я через неё ПЕРЕЛЕЗ!'), 'angry');
    yield L.say('king', 'НИКТО. НЕ УХОДИТ. ИЗ ГРОМАДНОГО КОРОЛЕВСТВА!', 'angry');
    p.expr = 'angry';
    yield L.shot(near(L, 2, 1.8, 3.5), near(L, 0, 1.1, 0), 0.8);
    yield L.say('hero', pl(L, 'А я уйду! Даже если придётся надавать тебе по пальцам!', 'А мы уйдём! Даже если придётся надавать тебе по пальцам!'), 'angry');
    yield L.shot(V(0, 7, 18), V(0, 20, -28), 0.8);
    yield L.say('king', pl(L, 'ХА-ХА-ХА! Ну попробуй, крошка!', 'ХА-ХА-ХА! Ну попробуйте, крошки!'), 'angry');
    audio.sfx('roar');
    L.tcam.shake(0.8);
    p.expr = undefined; p.faceYaw = null;
    yield L.camBack(0.7);
    L.cutscene(false);
    audio.playMusic('boss');
    if (L.authority) boss.start();
    L.toast('Светящийся круг — сюда хлопнет ладонь! Отбегай, а потом бей застрявшую ладонь');
    yield* tail(L, (function* () {
      yield wait(5);
      L.toast('Котлеты можно отбить мечом обратно Королю в лицо!');
    })());
  },

  // after a restart (solo respawn / co-op team wipe); co-op: the host runs it for everyone, the fight starts on the host
  *throne_retry(L) {
    const boss = L.boss as KingBoss3;
    L.cutscene(true);
    boss.anim.anger = 0.6; boss.anim.eye = 1;
    yield L.shot(V(0, 7, 18), V(0, 20, -28), 0);
    yield wait(0.3);
    yield L.say('king', line(L, L.nl ? ['ОПЯТЬ ВЫ?!', 'Вернулись? Вот и умницы! Оставайтесь!', 'Соскучились по мне?!'] : ['ОПЯТЬ ТЫ?!', 'Вернулся? Вот и умница! Оставайся!', 'Соскучился по мне?!']), 'angry');
    yield L.camBack(0.6);
    L.cutscene(false);
    audio.playMusic('boss');
    if (L.authority) boss.start();
  },

  // the host detects the defeat (special.throne) and runs this for everyone. Every machine stages it around a mark in
  // the moonlight in front of the throne (VIC): the heroes step onto their spots there while the camera is on the
  // King, then Bublik lands beside MY hero and the bear walks up to him (on the side no friend stands on), so every
  // shot frames its speaker wherever the fight ended. The boss replica is held still (freezeHands/manualRoot).
  *throne_victory(L) {
    const p = L.player;
    const boss = L.boss as KingBoss3;
    L.cutscene(true);
    L.hud.bossMax = 0;
    audio.stopMusic(1.5);
    boss.freezeHands = true;
    boss.manualRoot = true;
    const a = boss.anim;
    const hands = boss.hands;
    const settle = (k: number) => { for (const h of hands) { h.pos.lerp(boss.restPos(h), k); h.pose = 'rest'; h.tele.hide(); } };
    const kingShot = (d: number) => L.shot(V(0, 8, 16), V(0, 18, -28), d);
    yield kingShot(1.0);
    placeMine(L, VIC.x, VIC.z, 0, -1, 0);
    p.faceYaw = Math.PI;
    yield tween(1.2, (k) => { a.slump = k * 0.8; a.dizzy = 1; settle(0.06); boss.syncRig(0.016); }, ease.outCubic);
    yield L.say('king', 'Ох... моя... корона... кружится...');
    // the hero's face (the camera between him and the throne)
    p.forceState = 'cheer'; p.expr = 'happy';
    yield L.shot(near(L, -1.1, 1.3, -2.9), near(L, 0, 0.95, 0), 0);
    yield L.say('hero', 'Получилось! ПОЛУЧИЛОСЬ!', 'happy');
    p.forceState = null; p.expr = undefined;
    yield kingShot(0);
    audio.sfx('roar');
    L.tcam.shake(1);
    yield tween(0.7, (k) => { a.slump = lerp(0.8, 0, k); a.dizzy = 1 - k; a.anger = 1; a.eye = 1; settle(0.1); boss.syncRig(0.016); }, ease.outBack);
    yield L.say('king', pl(L, '...НЕТ! Ты... останешься... СО МНОЙ!!!', '...НЕТ! Вы... останетесь... СО МНОЙ!!!'), 'angry');
    // the giant fist rises over the hero
    const fist = hands[1];
    const f0 = fist.pos.clone();
    const fTarget = p.pos.clone().add(V(0.5, 11, -3));
    yield all(
      L.shot(near(L, 2.5, 0.8, 5), near(L, 0, 7, -2), 0.9),
      tween(0.9, (k) => { fist.pos.lerpVectors(f0, fTarget, k); fist.pose = 'fist'; boss.syncRig(0.016); }, ease.inOut),
    );
    p.expr = 'scared'; p.forceState = 'lookUp';
    // Bublik drops in through the Moon Well and lands beside my hero (D); the bear will stop on his other side (B)
    const side = freeSide(L, 1.7);
    const D = p.pos.clone().add(V(side * 1.7, 0, -0.5)).setY(p.pos.y);
    const B = p.pos.clone().add(V(-side * 2.5, 0, -0.9)).setY(p.pos.y);
    const dog = createDog();
    const dogRoot = new THREE.Group();
    dogRoot.add(dog.root);
    dogRoot.scale.setScalar(2.2);
    dogRoot.position.set(D.x, D.y + 70, D.z);
    dogRoot.rotation.y = Math.PI / 2;
    L.scene.add(dogRoot);
    // he rides down the Moon Well in its old bucket (the intro: he fell into the well by the path, right into it)
    const chute = new THREE.Group();
    const pail = bucket(); pail.scale.setScalar(3.8); chute.add(pail);
    const rope = mesh(new THREE.CylinderGeometry(0.07, 0.07, 90, 5), mat('#b8955e'));
    rope.position.y = 1.75 + 45; chute.add(rope);
    chute.position.copy(dogRoot.position).add(V(0, -0.9, 0));
    L.scene.add(chute);
    audio.sfx('fall');
    // looking up the shaft of moonlight: he shouts while he comes down into the shot
    yield L.shot(V(D.x - 4.5, D.y + 10, D.z + 10), V(D.x, D.y + 21, D.z), 0.6);
    yield all(L.say('dog', 'ТОША-А-А-А!!!'), tween(1.6, (k) => {
      dogRoot.position.y = D.y + lerp(70, 15, k);
      chute.position.y = dogRoot.position.y - 0.9;
      dog.update(0.016, { state: 'fly', speed: 0, talk: 0, stretch: 1, expr: 'angry' });
    }, ease.outCubic));
    dogRoot.rotation.y = Math.atan2(0 - dogRoot.position.x, -28 - dogRoot.position.z);
    // BUBLIK PUNCH: the paw grows into a giant fist on a stretchy arm
    const fistObj = createDogFist();
    const armM = mat(PAL.dog);
    const arm = mesh(new THREE.CylinderGeometry(1, 1, 1, 18, 1, true), armM);
    L.scene.add(fistObj, arm);
    const face = boss.faceTarget();
    const shoulder = () => dogRoot.position.clone().add(V(0, 0.6, 0)).addScaledVector(V(Math.sin(dogRoot.rotation.y), 0, Math.cos(dogRoot.rotation.y)), 1.2);
    const placeArm = (fistPos: THREE.Vector3, s: number) => {
      const a0 = shoulder();
      const dir = fistPos.clone().sub(a0);
      dir.normalize();
      fistObj.position.copy(fistPos);
      fistObj.lookAt(fistPos.clone().add(dir));
      fistObj.scale.setScalar(s);
      const wrist = fistPos.clone().addScaledVector(dir, -0.75 * s);
      const mid = a0.clone().lerp(wrist, 0.5);
      arm.position.copy(mid);
      arm.quaternion.setFromUnitVectors(V(0, 1, 0), dir);
      arm.scale.set(0.35 + s * 0.14, Math.max(0.01, a0.distanceTo(wrist)), 0.35 + s * 0.14);
    };
    // the standoff: the dog in his bucket on one side, the King's face on the other
    yield L.shot(V(D.x - 18, 14, D.z + 16), face.clone().lerp(dogRoot.position, 0.45), 0.5);
    yield L.say('dog', pl(L, 'А ну, руки прочь от моего друга, обжора!', 'А ну, руки прочь от моих друзей, обжора!'), 'angry');
    audio.sfx('whoosh', { pitch: 0.6 });
    yield tween(0.18, (k) => { placeArm(shoulder().addScaledVector(face.clone().sub(shoulder()).normalize(), -1.5 * k), 1 + k * 3); dog.update(0.016, { state: 'fly', speed: 0, talk: 0, stretch: 1, expr: 'angry' }); });
    audio.sfx('whoosh', { pitch: 0.4 });
    yield tween(0.32, (k) => { placeArm(shoulder().lerp(face.clone().add(V(0, 0, 5)), k), 4 + k * 15); }, ease.inCubic);
    audio.sfx('bigSlam'); audio.sfx('bossHit'); audio.sfx('slam', { pitch: 0.5 });
    L.tcam.shake(1.5);
    L.whiteFlash = 0.9;
    L.hitstop(0.35);
    L.fx.text(face.clone().add(V(0, 6, 4)), 'БУБЛИК-ПАНЧ!', '#ffe14a', 64);
    L.fx.stars(face, 70);
    L.fx.ring(face.clone(), 10, '#ffffff', 0.4, false);
    // the head spins round and round like in the cartoons; the King topples back into his throne
    a.dizzy = 1;
    const fistHome = fist.pos.clone();
    yield all(
      L.shot(V(-12, 16, 6), V(0, 20, -30), 0.4),
      tween(2.2, (k) => {
        a.spin = ease.outCubic(k) * Math.PI * 2 * 5;
        a.slump = lerp(0, 0.25, k);
        boss.root.rotation.x = -0.32 * ease.outBack(Math.min(1, k * 1.6));
        fist.pos.lerpVectors(fistHome, boss.restPos(fist).add(V(0, -2, 2)), ease.outCubic(Math.min(1, k * 2)));
        hands[0].pos.lerp(boss.restPos(hands[0]).add(V(0, -2, 2)), 0.08);
        for (const h of hands) h.pose = 'open';
        boss.syncRig(0.016);
      }),
      tween(0.7, (k) => { placeArm(shoulder().lerp(face.clone().add(V(0, 0, 5)), 1 - ease.inCubic(k)), lerp(19, 1, k)); }),
    );
    L.scene.remove(fistObj, arm);
    audio.sfx('bigSlam'); audio.sfx('thud', { pitch: 0.4 });
    L.tcam.shake(1.1);
    L.fx.dust(THRONE_SEAT.clone().setY(0).add(V(0, 0, 9)), 40, '#c8b0e0');
    a.eye = 0; a.spin = 0;
    yield tween(0.5, (k) => { a.slump = lerp(0.25, 0.55, k); boss.syncRig(0.016); });
    audio.sfx('snore');
    // (off camera) the rope runs out and the bucket drops down beside the heroes; it stays there, tipped over
    chute.remove(rope);
    yield tween(0.9, (k) => { dogRoot.position.y = D.y + lerp(15, 0, k); chute.position.y = dogRoot.position.y - 0.9; }, ease.outBounce);
    pail.scale.setScalar(1.7);
    chute.position.copy(D).add(V(side * 1.2, 0.5, -1.3));
    pail.rotation.set(0, side * 0.6, side * 1.45);
    dogRoot.scale.setScalar(1);
    dogRoot.position.copy(D);
    // (face to face, both cheated a little toward the camera so their faces show)
    dogRoot.rotation.y = Math.atan2(p.pos.x - D.x, p.pos.z + CHEAT - D.z);
    L.npcs.dog = { kind: 'dog', root: dogRoot, rig: dog, anim: { state: 'idle', speed: 0, talk: 0, stretch: 1, expr: 'happy' }, talk: 0, t: 0 };
    L.npcList.push(L.npcs.dog);
    p.forceState = null;
    p.faceYaw = Math.atan2(D.x - p.pos.x, D.z + CHEAT - p.pos.z);
    p.expr = 'happy';
    // the two of them face to face, the sleeping King behind them
    const mid = p.pos.clone().lerp(D, 0.5);
    yield L.shot(mid.clone().add(V(0, 1.25, 3.7)), mid.clone().add(V(0, 0.62, 0)), 1.0);
    yield L.say('hero', 'БУБЛИК!!! Ты пришёл!', 'happy');
    yield L.say('dog', 'Прости, что так долго! Ведро спускалось всю ночь. Очень. Медленно.', 'happy');
    yield L.say('dog', pl(L, 'Слышу — внизу грохот. Ну, думаю, это Тоша! А тут и верёвка кончилась.', 'Слышу — внизу грохот. Ну, думаю, это наши! А тут и верёвка кончилась.'), 'happy');
    yield L.say('dog', 'Зато по дороге научился тянуться ещё длиннее! И бить — тоже.', 'happy');
    // the bear comes in from the side and joins them: the camera opens up to take in all three
    const bear = L.npc('bear', B.x - side * 12, B.y, B.z + 1, side * Math.PI / 2);
    bear.anim.state = 'walk'; bear.anim.speed = 1;
    const g = p.pos.clone().add(D).add(B).multiplyScalar(1 / 3);
    yield all(
      L.shot(g.clone().add(V(0, 1.8, 5.3)), g.clone().add(V(0, 1.1, 0)), 1.2),
      tween(2.2, (k) => { bear.root.position.x = lerp(B.x - side * 12, B.x, k); bear.root.position.z = lerp(B.z + 1, B.z, k); }),
    );
    bear.anim.state = 'stand'; bear.anim.speed = 0;
    // (turned half toward the camera, half toward the hero)
    bear.root.rotation.y = side * 0.85;
    p.faceYaw = Math.atan2(B.x - p.pos.x, B.z + CHEAT * 1.6 - p.pos.z);
    yield L.say('bear', 'Ну надо же... Сколько себя тут помню — всё жуёт. А тут уснул!');
    yield L.say('hero', 'Дедушка Вторник! А решётку в галерее — это вы опустили?', 'surprised');
    yield L.say('bear', 'Я, я. Пробрался туда своими норами. Сорок лет ждал случая! Хо-хо.');
    yield L.say('hero', 'Пойдёмте с нами наверх!', 'happy');
    yield L.say('bear', 'Наверх?.. Сорок лет боялся... А, была не была! Пойдём!');
    yield L.say('dog', 'Хватайтесь за меня! Я растянусь до самого верха. Только тихо — не разбудите Короля!', 'happy');
    audio.sfx('victory');
    yield wait(0.5);
    finish(L);
  },
};

// ───────────── per-level setup hooks (run on every build, incl. respawns / co-op team restarts) ─────────────
// Co-op: every machine builds the same things in the same order (host: the real ones, clients: replicas);
// only the host decides when a fight / chase starts and when the level is won.
const special: Record<string, (L: Level3D) => void> = {
  feast(L) {
    const k = new FeastKing3(L, {
      x: FEAST_KING.x, seatY: FEAST_KING.seatY, tableY: 0, hatch: FEAST_SPOTS.hatch, serve: FEAST_SPOTS.serve,
      snacks: [[108, -9.5, 'grapes'], [114, -4, 'pudding'], [120, -10, 'cakeSlice'], [125.5, -3.5, 'pie']],
    });
    L.actors.push(k);
    L.refs.feastKing = k;
    // the spaghetti monster in its bowl
    const mp = FEAST_SPOTS.monster.clone();
    const m = new SpagMonster3(L, mp, 1.9, -Math.PI / 2, 15);
    L.actors.push(m); L.hittables.push(m);
    L.refs.monster = m;
  },
  // the book opens once the ambush is beaten: the host finishes the arena; clients get its state (L.netArena) and the
  // same actor reacts to it on every machine (book + exit zone for the goal arrow; only the host's exit check counts)
  library(L) {
    const book = LIB_PORTAL.book;
    if (!book) return;
    L.refs.portal = book;
    L.refs.goalHint = book.pageCenter.clone();
    let opened = false;
    const openBook = (instant: boolean) => {
      opened = true;
      book.open(1, instant);
      const pc = book.pageCenter;
      L.exit(pc.x - 3, pc.y - 4.3, pc.z - 1.5, pc.x + 3, pc.y + 4, pc.z + 1.8);
      if (!instant) {
        // each machine plays its own (the host's must not be captured too, or clients would get it twice)
        mine(L, () => {
          audio.sfx('artifact', { pitch: 0.6 });
          L.hud.showBanner('КНИГА ОТКРЫЛАСЬ!', '#ffd34a');
          L.toast('На обложке: «Большая галерея». Запрыгни в светящиеся страницы!');
        });
      }
    };
    // the ambush on the top landing beside the book (not simply the first one built: that one guards the dash cloak
    // halfway up, and the book used to open — and the last fight be skippable — as soon as the cloak was won)
    const pc0 = book.pageCenter;
    const guard = [...L.arenas].sort((a, b) => a.center.distanceTo(pc0) - b.center.distanceTo(pc0))[0];
    if (!guard || guard.state === 'done') openBook(true);
    else L.actors.push({ update: () => { if (!opened && guard.state === 'done') openBook(false); } });
  },
  chase(L) {
    const cp = L.checkpoint;
    const retry = !!cp || L.seen.has('chase_intro');
    const wall = new BreakWall(L, CHASE.wallX, -22, 22, 0, 46, 1.8, retry);
    L.actors.push(wall);
    L.refs.breakWall = wall;
    // co-op: from the spawn mark, not from my own spot in the spawn ring, so the King starts at the same x everywhere
    const startX = cp ? cp.x : L.nl ? L.def.spawn[0] : L.player.pos.x;
    const ch = new KingChaser3(L, retry ? startX - 24 : CHASE.wallX - 8, 0, CHASE.laneZ);
    for (const sm of CHASE_SMASH) ch.smash.push({ x: sm.x, objs: [sm.b.obj], cols: sm.b.colliders, colors: sm.colors, done: false });
    L.chaser = ch;
    const m = new SpagMonster3(L, CHASE_SPOTS.monster.clone(), 2.1, 0, 30, true);
    L.actors.push(m); L.hittables.push(m);
    // runner hints: shown once as the hero approaches
    const hints: [number, string][] = [
      [62, 'Стражники в ряд! Руби одного (ЛКМ) — или перепрыгни'],
      [90, 'Лапша качается — проскакивай, когда она отлетит в сторону'],
      [110, 'Хлебная стена! Беги прямо на желе — оно подбросит тебя'],
      [146, 'Макаронный монстр! Перепрыгни удар щупалец'],
      [190, 'Вилки! Обегай их змейкой'],
      [228, 'Широкий ров: прыжок, ещё прыжок и рывок (Shift) в воздухе!'],
    ];
    // my own hints (co-op: each runner's own, never the host's replayed)
    L.actors.push({ update: (L2) => {
      const x = L2.player.pos.x;
      while (hints.length && x > hints[0][0]) { const h = hints.shift()!; if (x < h[0] + 12 && !L2.inCutscene) mine(L2, () => L2.toast(h[1])); }
    } });
    if (retry) {
      L.tcam.mode = 'chase'; L.camModeDefault = 'chase';
      L.tcam.focus.copy(L.player.pos);
      L.player.yaw = Math.PI / 2;
      if (!L.nl) L.runGen(chaseRetry(L));
      else {
        // co-op team restart: hold still until the host counts down for everyone ('chase_retry' on every machine,
        // once all friends have loaded the level again); a client that never hears it counts down on its own
        L.player.control = false;
        const nl = L.nl;
        if (L.authority) L.runGen((function* () { yield until(() => !nl.waiting); L.run('chase_retry'); })());
        else L.runGen((function* () { yield untilOr(() => !!L.refs.chaseRetry, 15); if (!L.refs.chaseRetry) yield* chaseRetry(L); })());
      }
    }
  },
  throne(L) {
    const boss = new KingBoss3(L, THRONE_SEAT);
    L.boss = boss;
    L.camModeDefault = 'boss';
    L.tcam.bossPoint = V(0, 20, -28);
    // the host decides the victory; L.run plays it on every machine
    boss.onDefeat = () => {
      if (!L.authority) return;
      L.runGen((function* () {
        yield wait(1.6);
        L.run('throne_victory');
      })());
    };
    if (L.seen.has('throne_intro')) {
      // co-op (team restart): the host runs the retry for everyone once all friends have loaded the level again
      const nl = L.nl;
      if (!nl) L.runGen((function* () { yield wait(0.01); L.run('throne_retry'); })());
      else if (L.authority) L.runGen((function* () { yield until(() => !nl.waiting); L.run('throne_retry'); })());
    }
  },
};

export const SCRIPTS3 = { scripts, special };

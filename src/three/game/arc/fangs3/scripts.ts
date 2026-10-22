import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { ease } from '../../../../engine/util';
import { wait, tween, all, until, type Script, type Waiter } from '../../../../game/coroutine';
import { glyphLabel } from '../../../../ui/glyphs';
import { ambient } from '../vampires/fxUtil';
import { createMouse, type MouseAnim } from '../fangs5/rigs';
import { safeMark, clearMarks } from '../shared/safeMark';
import { setStoryFlag } from '../../episodes';
import type { Level3D } from '../../level';
import { Garden, MARKS, LEVEL_ID, COURT_BED, CAN_DROPPED } from './level';
import { Cast, CAST, slotOf, type CastKind } from './cast';
import { say, shepotSeen, NAMED } from './speech';
import { Shepot3, ARENA } from './boss';
import { showCard } from './card';
import { mirrorFaceMat } from './mirrors';
import { BANNER, NIGHT, TOAST, RETRY } from './lines';

/*
 * The scenes of «Стеклянная оранжерея» (docs/script-fangs.md §7). Co-op: the host runs them (L.run) and every
 * machine plays them with its own camera; lines advance by themselves (≤ 14 a scene: the 120 s watchdog). The
 * canonical four stand on their marks (castScenes), the players' figures are hidden while the bars are down.
 * World actions (boss.start, zone restores, the next scene) happen only where L.authority is true.
 */

type ScriptFn = (L: Level3D) => Script;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const G = (L: Level3D) => L.refs.garden as Garden;

/** a mark through safeMark (v2 §0: never inside a wall / prop / under a roof); returns [x, y, z] */
function placeAt(L: Level3D, v: THREE.Vector3, label: string, wall = 0.9): [number, number, number] {
  const p = safeMark(L, v, { wall, label: 'fangs3 ' + label });
  return [p.x, p.y, p.z];
}
function marks(L: Level3D, c: Cast, set: Record<CastKind, readonly [number, number, number]>, y = 0) {
  for (const k of CAST) { const [x, z, yaw] = set[k]; c.place(k, ...placeAt(L, V(x, y, z), k), yaw); }
}
/** §7.3: the four round the bed (about 2 m off its edge), facing the middle */
function ringMarks(L: Level3D, c: Cast) {
  const C = ARENA.c, r = 4.7;
  const ang: Record<CastKind, number> = { tosha: -1.9, bublik: -0.62, pastila: 0.62, noki: 1.9 };
  for (const k of CAST) {
    const a = ang[k];
    c.place(k, ...placeAt(L, V(C.x + Math.sin(a) * r, 0, C.z + Math.cos(a) * r), k, 0.8), a + Math.PI);
  }
}
/** a two-shot: `a` (who speaks) and `b`, from the side so both faces read */
function two(L: Level3D, c: Cast, a: CastKind, b: CastKind, awayFrom?: THREE.Vector3): Waiter {
  const pa = c.head(a), pb = c.head(b);
  const mid = pa.clone().lerp(pb, 0.45);
  const across = V(pb.x - pa.x, 0, pb.z - pa.z);
  const d = Math.max(1.2, across.length());
  across.normalize();
  // the side the two are facing (their average forward)
  const ya = c.figs[a].root.rotation.y, yb = c.figs[b].root.rotation.y;
  const f = V(Math.sin(ya) + Math.sin(yb), 0, Math.cos(ya) + Math.cos(yb));
  if (f.lengthSq() < 0.01) f.set(-across.z, 0, across.x);
  // (round a prop — the bed: from its far side, never across it)
  if (awayFrom) f.set(mid.x - awayFrom.x, 0, mid.z - awayFrom.z);
  f.normalize();
  const pos = mid.clone().addScaledVector(f, 1.6 + d * 0.9).addScaledVector(across, -0.4).setY(mid.y + 0.25);
  return L.shot(pos, mid, 0.6);
}
/** a shot of a cast member's face from in front of them (d m away, a little to the side) */
function face(L: Level3D, c: Cast, k: CastKind, d = 2.4, side = 0.5, up = 0.25): Waiter {
  const r = c.figs[k].root;
  const f = V(Math.sin(r.rotation.y), 0, Math.cos(r.rotation.y));
  const h = c.head(k);
  const pos = h.clone().addScaledVector(f, d).add(V(-f.z * side, up, f.x * side));
  return L.shot(pos, h, 0.7);
}
function stageOn(L: Level3D) { L.cutscene(true); clearMarks(L); G(L).cast.show(true); }
function stageOff(L: Level3D) { const g = G(L); g.cast.show(false); g.placeHelpers(g.fight && !g.won); }
/** put MY hero on my spot of a ring around (x, z), facing the middle (after a scene: everyone stands somewhere sane) */
function gather(L: Level3D, x: number, z: number, r: number, a0: number) {
  const p = L.player;
  if (p.dead) return;
  const s = slotOf(L);
  const a = a0 + (s - 2.5) * 0.32;
  const at = V(x + Math.sin(a) * r, 0.05, z + Math.cos(a) * r);
  L.teleportMe(at, Math.atan2(x - at.x, z - at.z));
}
const toastKey = (s: string) => s.replace('[E]', glyphLabel('interact'));

const scripts: Record<string, ScriptFn> = {
  // ───────────── 7.0 fangs3_cold — Лейка (cold open, before the banner) ─────────────
  *fangs3_cold(L) {
    const g = G(L), can = g.can;
    L.cutscene(true);
    g.cast.show(false);
    audio.stopMusic(0.3);
    const bed = COURT_BED, top = 0.6;
    // the can hangs in the air by itself, a metre over the grey bed by mirror 1, its rose over the flowers
    const hang = V(bed.x + 1.4, top + 1.0, bed.z + 1.4);
    can.lying = false; can.root.visible = true; can.tilt = 0; can.pour = 0;
    can.root.position.copy(hang); can.root.rotation.set(0, Math.atan2(bed.x - hang.x, bed.z - hang.z), 0);
    // a music box, slowly, note by note
    const tune = [1, 1.26, 1.5, 1.26, 1.12, 1, 0.84, 1, 1.12, 0.94];
    let playing = true;
    const box = (i: number) => { if (!playing) return; audio.sfx('menuMove', { pitch: tune[i % tune.length] * 0.8, volume: 0.45 }); g.after(0.55, () => box(i + 1)); };
    box(0);
    ambient(L, () => audio.sfx('mist', { pitch: 0.7, volume: 0.5 }));
    try {
      // К1 the glass arches, grey flowers
      yield L.shot(V(8.5, 4.4, 51.5), V(bed.x, 1.2, bed.z), 0);
      yield L.shot(V(5.5, 3.4, 47), V(bed.x, 1.3, bed.z), 2.2);
      // К2 the can waters a grey flower; the flower shivers and greys even more
      yield L.shot(V(hang.x + 1.0, 2.0, hang.z - 2.8), V(bed.x + 0.8, 1.3, bed.z + 0.7), 0);
      can.tilt = 0.8; can.pour = 1;
      const drip = () => ambient(L, () => { L.fx.emit(V(bed.x + 0.9, top + 0.4, bed.z + 0.9), { count: 6, speed: [0.3, 1.2], life: [0.5, 1], size: [0.15, 0.3], size2: 1.6, colors: ['#8a8a96', '#b8b8c4', '#6a6a78'], g: -0.6, drag: 2 }); });
      drip(); g.after(0.8, drip); g.after(1.8, drip); g.after(2.8, drip);
      ambient(L, () => audio.sfx('drain', { pitch: 1.3, volume: 0.5 }));
      yield say(L, 'shepot', '…пей… пей, маленький… ну почему ты опять серый…', 'sad');
      // К3 the can freezes; far off, a door creaks
      can.tilt = 0; can.pour = 0;
      ambient(L, () => audio.sfx('door', { pitch: 0.55, volume: 0.6 }));
      yield L.shot(V(bed.x - 3.3, 1.9, bed.z + 5.2), hang.clone().setY(hang.y + 0.4), 0);
      g.whispers.say(hang.clone(), '…гости…', 2.8);
      yield say(L, 'shepot', '…гости… тёплые… цветные… ш-ш-ш…', 'scared');
      // К4 it drops and rolls; nobody's there
      playing = false;
      yield L.shot(V(CAN_DROPPED.x + 2.1, 0.55, CAN_DROPPED.z + 2.6), CAN_DROPPED.clone().setY(0.3), 0);
      const from = hang.clone(), mid = V(bed.x + 2.0, 0, bed.z + 2.0);
      yield tween(0.45, (k) => { can.root.position.lerpVectors(from, mid, k); can.root.position.y = from.y * (1 - k * k); can.root.rotation.z = k * 1.2; }, (k) => k);
      ambient(L, () => { audio.sfx('clang', { pitch: 0.9, volume: 0.7 }); L.fx.emit(mid.clone().setY(0.2), { count: 8, speed: [0.5, 1.5], life: [0.3, 0.6], size: [0.1, 0.2], size2: 1.5, colors: ['#c8c4d8', '#8a86a0'], g: 2, drag: 2 }); });
      can.lying = true;
      yield tween(0.9, (k) => { can.root.position.lerpVectors(mid, CAN_DROPPED, ease.outCubic(k)); can.root.rotation.y = 0.8 * k; }, (k) => k);
      yield wait(1.2);
    } finally {
      playing = false;
      g.dropCan();
    }
    if (L.authority) L.runGen((function* (): Script { yield wait(0.05); L.run('fangs3_intro'); })());
    yield wait(0.1);
  },

  // ───────────── 7.1 fangs3_intro — Эхо ─────────────
  *fangs3_intro(L) {
    const g = G(L), c = g.cast;
    stageOn(L);
    marks(L, c, MARKS.intro);
    audio.playMusic('garden');
    L.hud.showBanner(BANNER, '#d8c8ff');
    // К1 into the garden, toward the big dome far away
    yield L.shot(V(5, 7, 72), V(-1, 3.5, 20), 0);
    yield all(L.shot(V(2.4, 4.6, 66), V(0, 4.5, 10), 3.2), say(L, 'narrator', 'Третья ночь. Луна — как спелая вишня. Отряд вошёл в Стеклянную оранжерею.'));
    // К2 Пастила with the diary
    c.expr('pastila', 'sad');
    yield face(L, c, 'pastila', 2.5, 0.6);
    yield say(L, 'pastila', 'Прабабушка Карамель построила её. Тут росли все растения Хрумляндии.', 'sad');
    c.expr('pastila', 'normal');
    yield say(L, 'pastila', 'У меня её дневник. «Опыт номер один: сад, где всегда полдень».');
    // (Тоша answers: the two of them)
    yield two(L, c, 'pastila', 'tosha');
    yield say(L, 'tosha', 'А теперь тут пусто. И всё трескается.');
    // К3 Бублик, a whisper right behind his ear — nobody there
    c.expr('bublik', 'scared');
    yield face(L, c, 'bublik', 2.0, 0.3, 0.1);
    yield say(L, 'bublik', 'Тоша, кто-то шепчет. Прямо у меня за ухом.', 'scared');
    const ear = c.pos('bublik').clone().add(V(0.6, 0.6, 0.8));
    g.whispers.say(ear, '…за ухом…', 3.5);
    yield L.shot(c.pos('bublik').clone().add(V(-0.6, 1.0, -2.0)), ear, 0.6);
    yield say(L, 'shepot', '…за ухом… за ухом… ш-ш-ш…');
    // К4 Ноки and Бублик
    c.expr('bublik', 'normal');
    c.look('noki', c.pos('bublik'));
    yield two(L, c, 'noki', 'bublik');
    yield say(L, 'noki', 'Шёпот. Он повторяет за вами. Не болтайте лишнего.');
    c.expr('bublik', 'happy');
    yield say(L, 'bublik', 'Я молчу. Совсем. Это я молча говорю.', 'happy');
    g.whispers.say(ear, '…молча…', 3);
    yield say(L, 'shepot', '…молча… молча…');
    c.look('noki', null); c.expr('bublik', 'normal');
    // К5 the mirrors on their stands (over Пастила's shoulder, into the court: mirror 1 is there)
    const pp = c.pos('pastila');
    yield L.shot(V(pp.x + 1.3, 1.75, pp.z + 1.9), V(-6.5, 1.1, 44.5), 0.8);
    yield say(L, 'pastila', 'Корень полуденника — под куполом. Он цветёт только в полдень.');
    c.pose('pastila', 'cheer', 'happy');
    yield say(L, 'pastila', 'Значит, сделаем полдень! Зеркала ловят свет. Повернём их на купол!', 'happy');
    c.pose('pastila', 'idle', 'happy');
    // К6 Тоша and Пастила
    c.pose('tosha', 'cheer', 'happy');
    yield two(L, c, 'tosha', 'pastila');
    yield say(L, 'tosha', 'Солнце посреди ночи? Это по-нашему!', 'happy');
    c.pose('tosha', 'idle');
    for (const k of CAST) c.expr(k, 'normal');
    stageOff(L);
    yield L.camBack(0.7);
    L.cutscene(false);
    L.hud.showChapter(L.def.title, `${L.def.subtitle} · ${NIGHT}`);
    L.bannerShown = true;
    L.hud.toast(TOAST.intro, 7);
  },

  // ───────────── 7.2.1 fangs3_mirror — the first mirror: the grey bed blooms (as v1) ─────────────
  *fangs3_mirror(L) {
    const g = G(L), c = g.cast;
    stageOn(L);
    marks(L, c, MARKS.mirror);
    for (const k of CAST) c.look(k, V(-3.5, 1, 37));
    yield L.shot(V(-1.2, 3.2, 43.5), V(-3.6, 0.8, 37), 0);
    yield wait(0.9);
    yield L.shot(V(-2.4, 2.4, 42.6), V(-5.2, 1.0, 40.5), 0.9);
    c.expr('pastila', 'happy'); c.pose('pastila', 'cheer', 'happy');
    yield say(L, 'pastila', 'Работает! Свет греет цветы. Ещё три зеркала — и будет полдень!', 'happy');
    c.pose('pastila', 'idle');
    for (const k of CAST) c.look(k, null);
    stageOff(L);
    yield L.camBack(0.6);
    L.cutscene(false);
    L.hud.toast(toastKey(TOAST.mirror), 6);
  },

  // ───────────── 7.3 fangs3_boss_intro — Все зеркала ─────────────
  *fangs3_boss_intro(L) {
    const g = G(L), c = g.cast, b = g.boss!;
    const C = ARENA.c;
    stageOn(L);
    ringMarks(L, c);
    for (const k of CAST) c.look(k, V(C.x, 1, C.z));
    try {
      // К1 from above: the four round the bed in the light of a made noon
      g.bud.open = 0.5;
      yield L.shot(V(C.x + 1.0, 14, C.z + 3.6), V(C.x, 0, C.z + 1.6), 0);
      c.pose('pastila', 'cheer', 'happy');
      yield all(L.shot(V(C.x + 0.8, 12.5, C.z + 3.2), V(C.x, 0, C.z + 1.6), 2.4), say(L, 'pastila', 'Полдень! Искусственный, но настоящий. Корень раскрывается!', 'happy'));
      c.pose('pastila', 'idle', 'surprised');
      // К2 the bud
      yield L.shot(V(C.x + 2.2, 1.9, C.z + 2.6), g.bud.top, 0);
      yield wait(0.8);
      // К3 the light blinks — and every mirror shows a skinny eared figure right behind each of the four
      audio.stopMusic(0.2);
      for (let i = 0; i < 3; i++) { g.bud.open = 0.1; L.whiteFlash = 0.15; yield wait(0.16); g.bud.open = 0.5; yield wait(0.2); }
      g.sceneGhosts = CAST.map((k) => {
        const p = c.pos(k), out = V(p.x - C.x, 0, p.z - C.z).normalize();
        return { kind: 'boss' as const, pos: p.clone().addScaledVector(out, 0.9), h: 2.2 };
      });
      ambient(L, () => { audio.sfx('hiss', { pitch: 1.6, volume: 0.6 }); audio.sfx('reflect', { pitch: 0.6, volume: 0.7 }); });
      // (a wide shot from the bed out toward the mirrors of the north-west wall, the four in front of them)
      // (from the north of the bed toward the south wall's mirrors: the four between us and the glass)
      yield L.shot(V(C.x - 1.5, 2.5, C.z - 6.5), V(C.x + 1.5, 1.8, C.z + 12), 0);
      c.expr('bublik', 'scared');
      yield say(L, 'bublik', 'Он… за каждым из нас. Сразу.', 'scared');
      // К4 they spin round — nobody behind them
      g.sceneGhosts = null;
      for (const k of CAST) { const p = c.pos(k); c.look(k, V(p.x * 2 - C.x, 1, p.z * 2 - C.z)); c.expr(k, 'scared'); }
      yield L.shot(V(C.x + 2.6, 1.9, C.z + 9.3), V(C.x + 0.2, 1.0, C.z + 3.5), 0);
      g.whispers.say(V(C.x + 3, 1.6, C.z - 7), '…НЕТ…', 3);
      ambient(L, () => audio.sfx('hiss', { pitch: 0.9 }));
      yield say(L, 'shepot', '…НЕТ… свет… больно… гасите…', 'angry');
      for (const k of CAST) { c.look(k, V(C.x, 1, C.z)); c.expr(k, 'normal'); }
      c.expr('tosha', 'angry');
      yield face(L, c, 'tosha', 2.6, -0.5);
      yield say(L, 'tosha', 'Покажись! Нечестно — невидимкой!', 'angry');
      g.whispers.say(V(C.x - 6, 1.6, C.z + 2), '…честно?..', 3);
      yield say(L, 'shepot', '…честно?.. сто лет я никому не показывался… я забыл, какой я…');
      c.expr('tosha', 'normal');
      // К5 Пастила with the diary
      yield face(L, c, 'pastila', 2.4, 0.6);
      yield say(L, 'pastila', 'Прабабушка писала про ученика. Ушастый, говорил с цветами… Шуршик?');
      g.whispers.say(V(C.x + 5, 1.6, C.z - 4), '…не называй…', 3);
      yield say(L, 'shepot', '…не называй… не смотри… это не я…', 'scared');
      // К6 over Ноки's shoulder onto the empty air over the bed
      const np = c.pos('noki');
      const toBed = V(C.x - np.x, 0, C.z - np.z).normalize();
      const nh = c.head('noki');
      yield L.shot(nh.clone().addScaledVector(toBed, -2.0).add(V(-toBed.z * 0.85, 0.5, toBed.x * 0.85)), nh.clone().addScaledVector(toBed, 3.5).setY(0.2), 0.6);
      yield say(L, 'noki', 'Аккорд его проявит. Пастила, держи маяк.');
      // К7 Пастила raises the beacon — her hands shake
      c.expr('pastila', 'scared');
      c.anim('pastila').attack = { kind: 'syringe', p: 0.5 };
      yield face(L, c, 'pastila', 2.2, 0.4);
      yield say(L, 'pastila', 'Держу. Не дрожит. Это свет дрожит.', 'scared');
      c.anim('pastila').attack = null;
      audio.playMusic('vampire_boss');
      g.whispers.say(V(C.x + 7, 1.6, C.z + 3), '…ш-ш-ш…', 3);
      yield L.shot(V(C.x, 6, C.z + 13), V(C.x, 1, C.z - 4), 1.0);
      yield say(L, 'shepot', '…тогда я заберу ваши цвета… и вас тоже никто не увидит…');
    } finally {
      g.sceneGhosts = null;
    }
    // the fight
    for (const k of CAST) { c.look(k, null); c.expr(k, 'normal'); }
    g.fight = true;
    L.boss = b;
    stageOff(L);
    gather(L, C.x, C.z, 7, 0);
    yield L.camBack(0.6);
    L.cutscene(false);
    audio.playMusic('vampire_boss');
    if (L.authority) b.start();
    L.hud.toast(TOAST.boss, 7);
  },

  // after a restart (solo respawn / co-op team wipe): a whisper, then the fight again
  *fangs3_boss_retry(L) {
    const g = G(L), b = g.boss!;
    const C = ARENA.c;
    L.cutscene(true);
    g.fight = true; L.boss = b; g.bud.open = 0.5;
    gather(L, C.x, C.z, 7, 0);
    yield L.shot(V(C.x, 5, C.z + 12), V(C.x, 1.4, C.z - 3), 0);
    g.whispers.say(V(C.x - 4, 1.6, C.z - 5), '…тёплые…', 3);
    yield say(L, 'shepot', RETRY);
    g.placeHelpers(true);
    yield L.camBack(0.6);
    L.cutscene(false);
    audio.playMusic('vampire_boss');
    if (L.authority) b.start();
  },

  // ───────────── 7.5 fangs3_boss_defeat — Шуршик и страница ─────────────
  *fangs3_boss_defeat(L) {
    const g = G(L), c = g.cast, b = g.boss!;
    const C = ARENA.c;
    stageOn(L);
    L.hud.toasts.length = 0; // (the fight's hints would sit right over his face)
    L.seen.add('f3:won');
    g.won = true;
    L.hud.bossMax = 0;
    audio.stopMusic(1.2);
    marks(L, c, MARKS.bed);
    // he shows for good: a little, skinny, eared vampire in Карамель's huge apron, sitting on the bed, face in his paws
    const seat = V(C.x, 0.7, C.z + 2.35);
    b.pos.copy(seat); b.yaw = 0; b.visGoal = 1; b.vis = 1;
    b.anim.small = 1; b.anim.hide = 1;
    shepotSeen(L, true);
    for (const k of CAST) c.look(k, seat);
    g.V.light(V(C.x - 3.4, 0, C.z + 1.2), { r: 4.5, secs: 20 });
    let mouseG: THREE.Group | null = null;
    try {
      // К1 a low shot, at his height
      yield L.shot(V(C.x + 0.25, 0.95, C.z + 4.4), seat.clone().setY(1.15), 0);
      yield wait(0.5);
      yield say(L, 'shepot', '…не смотрите… я страшный…', 'scared');
      // К2 Бублик crouches next to him (0.8 m)
      c.place('bublik', ...placeAt(L, V(C.x + 0.35, 0, C.z + 3.2), 'bublik', 0.35), Math.PI + 0.3);
      c.look('bublik', seat);
      c.expr('bublik', 'surprised');
      yield L.shot(V(C.x + 2.5, 1.2, C.z + 2.0), V(C.x + 0.1, 0.9, C.z + 2.8), 0);
      yield say(L, 'bublik', 'Ты маленький. И ушастый. Как я!', 'surprised');
      c.expr('bublik', 'happy');
      b.anim.hide = 0.3;
      yield say(L, 'shepot', '…правда?.. меня в посаде дразнили за уши… я попросил, чтобы меня не видели…', 'sad');
      // К3 Пастила with the diary
      c.expr('pastila', 'sad');
      yield face(L, c, 'pastila', 2.4, 0.5);
      yield say(L, 'pastila', 'Прабабушка тебя искала, Шуршик. Всю жизнь. В дневнике — каждый год.', 'sad');
      c.expr('pastila', 'normal');
      // К4 out of the apron: a folded yellowed page (from here his name in the box is «Шуршик»)
      L.seen.add(NAMED);
      setStoryFlag(NAMED);
      b.anim.hide = 0;
      b.rig.page.visible = true;
      yield L.shot(V(C.x - 0.7, 1.25, C.z + 4.7), seat.clone().setY(1.0), 0);
      ambient(L, () => audio.sfx('artifact', { pitch: 0.8, volume: 0.6 }));
      yield say(L, 'shepot', '…она велела отдать… девочке с гитарой… а я стеснялся… сто лет…', 'sad');
      // К5 Ноки and Шуршик
      c.expr('noki', 'surprised');
      yield c.walk('noki', C.x + 1.35, C.z + 3.3, 2.6, 2.5);
      c.look('noki', seat);
      yield L.shot(V(C.x - 1.3, 1.4, C.z + 5.7), V(C.x + 0.6, 1.0, C.z + 2.9), 0);
      yield say(L, 'noki', 'Мне?', 'surprised');
      b.rig.page.visible = false;
      yield showCard(L, 'page');
      c.expr('noki', 'normal');
      yield say(L, 'shepot', '…спасибо, что посмотрели… пи…');
      // К6 пуф — a little eared mouse looks round and waves; a wave of colour, the crystal rings
      ambient(L, () => {
        L.fx.emit(seat.clone().setY(1.0), { count: 30, speed: [1, 4], dir: V(0, 1, 0), spread: 0.9, life: [0.5, 1.1], size: [0.2, 0.42], size2: 1.8, colors: ['#4a3a66', '#2b2140', '#8a7ab0'], g: -1, drag: 2 });
        L.fx.stars(seat.clone().setY(1.0), 12, ['#ffe14a', '#ffffff']);
        audio.sfx('batScreech', { pitch: 1.9, volume: 0.3 });
      });
      b.gone = true; b.active = false;
      const mouse = createMouse('shepot');
      const mg = new THREE.Group(); mg.add(mouse.root); mg.scale.setScalar(1.7); mg.position.copy(seat); mg.position.y = 0.72;
      L.scene.add(mg); mouseG = mg;
      const ma: MouseAnim = { talk: 0, hop: 0, squeak: 0 };
      const look = (k: number) => { mg.rotation.y = Math.sin(k * Math.PI * 3) * 0.9; ma.hop = Math.max(0, Math.sin(k * Math.PI * 4)); ma.squeak = k > 0.6 ? 1 : 0; mouse.update(0.016, ma); };
      yield all(L.shot(V(C.x - 2.6, 2.4, C.z + 7.8), seat.clone().setY(0.9), 0.5), tween(1.6, look));
      if (L.authority) { g.V.restoreZone('dome'); g.V.restoreZone('wing'); g.V.restoreZone('court'); }
      ambient(L, () => { audio.sfx('colorRestore', { pitch: 0.7 }); audio.sfx('reflect', { pitch: 0.6, volume: 0.8 }); L.fx.ring(C.clone().setY(0.3), 19, '#ffe9a0', 1.2); });
      const m0 = mg.position.clone(), m1 = V(C.x + 3.5, 0, C.z + 1.5);
      yield all(L.shot(V(C.x - 9, 5, C.z + 12), V(C.x, 3, C.z - 4), 1.4), tween(1.4, (k) => { mg.position.lerpVectors(m0, m1, k); mg.position.y = 0.72 * (1 - k) + Math.abs(Math.sin(k * Math.PI * 5)) * 0.25; mg.rotation.y = Math.atan2(m1.x - m0.x, m1.z - m0.z); ma.hop = 1; mouse.update(0.016, ma); mg.scale.setScalar(1.7 * (1 - k * 0.8)); }));
      yield wait(0.6);
    } finally {
      mouseG?.removeFromParent();
      b.gone = true; b.active = false;
      b.rig.page.visible = false;
      shepotSeen(L, false);
    }
    if (L.authority) L.runGen((function* (): Script { yield wait(0.05); L.run('fangs3_ending'); })());
    yield wait(0.1);
  },

  // ───────────── 7.6 fangs3_ending — Король в зеркале ─────────────
  *fangs3_ending(L) {
    const g = G(L), c = g.cast, km = g.kingMirror;
    const C = ARENA.c;
    stageOn(L);
    marks(L, c, MARKS.bed);
    c.place('pastila', ...placeAt(L, V(C.x + 0.5, 0, C.z + 3.0), 'pastila', 0.3), Math.PI);
    for (const k of CAST) c.look(k, V(C.x, 1, C.z));
    g.bud.open = 1;
    audio.playMusic('garden');
    const faceM = mirrorFaceMat();
    try {
      // К1 Пастила digs up the root
      yield L.shot(V(C.x + 2.4, 2.2, C.z + 4.8), g.bud.top, 0.9);
      c.pose('pastila', 'cheer', 'happy');
      yield say(L, 'pastila', 'Корень полуденника! Тёплый, как сковородка. Не уроните!', 'happy');
      c.pose('pastila', 'idle', 'happy');
      yield showCard(L);
      yield face(L, c, 'bublik', 2.0, 0.4, 0.05);
      yield say(L, 'bublik', 'Пахнет летним полднем. С пирожками.');
      g.bud.open = 0.6; // the made noon fades
      // К2 Пастила and Ноки
      c.look('pastila', c.pos('noki')); c.look('noki', c.pos('pastila'));
      yield two(L, c, 'pastila', 'noki', C);
      yield say(L, 'pastila', 'Две колбы. Ноки… ты прочитаешь страницу?');
      yield say(L, 'noki', 'Не сейчас.');
      // К3 the dome's mirrors go dark at once; the music breaks off
      audio.stopMusic(0.15);
      for (const k of CAST) c.look(k, km.pos.clone().setY(2));
      yield L.shot(V(C.x + 6, 4.2, C.z + 9), V(C.x - 1, 2.6, C.z - 10), 0);
      ambient(L, () => audio.sfx('snuff', { pitch: 0.5 }));
      yield tween(0.8, (k) => { faceM.color.setScalar(1 - 0.8 * k); km.setDark(k); });
      // К4 the big mirror: instead of a reflection, the face of Король Полночь
      const mirrorShot = () => L.shot(V(km.pos.x + 0.6, 3.2, km.pos.z + 7.5), V(km.pos.x, 3.3, km.pos.z), 0);
      yield mirrorShot();
      yield tween(1.0, (k) => { km.king = k; });
      ambient(L, () => audio.sfx('hiss', { pitch: 0.45, volume: 0.8 }));
      yield say(L, 'polnoch', 'Ноки. Ты привела ко мне внучку Карамели. Спасибо.');
      // К5 from the mirror (over the King's shoulder) onto the four — Ноки starts walking toward him
      c.expr('pastila', 'scared');
      yield L.shot(V(C.x - 0.8, 2.6, C.z - 3.6), V(C.x, 0.9, C.z + 5), 0); // (from the mirror's side of the bed)
      const nokiTo = placeAt(L, V(km.pos.x + 0.3, 0, km.pos.z + 1.6), 'noki', 0.5);
      const nokiGo = c.route('noki', [[C.x + 4.2, C.z], [nokiTo[0], nokiTo[2]]], 2.6); // (round the bed, not through it)
      yield say(L, 'pastila', 'Он… видит нас?', 'scared');
      yield mirrorShot();
      yield say(L, 'polnoch', 'Зеркала — мои окна. У тебя прабабкин нос, принцесса. Она тоже тряслась.');
      // К6 Тоша
      c.expr('tosha', 'angry');
      yield face(L, c, 'tosha', 2.6, -0.5);
      yield say(L, 'tosha', 'Мы идём за тобой! Слышишь?', 'angry');
      yield mirrorShot();
      yield say(L, 'polnoch', 'Слышу. Идите через перевал. Сёстры вас встретят. Стол накрыт.');
      // К7 Ноки swings: ДЗЫНЬ — the mirror flies to pieces
      yield nokiGo;
      c.look('noki', km.pos.clone().setY(2));
      const bublikGo = c.route('bublik', [[C.x + 4.0, C.z + 1.5], [C.x + 3.4, C.z - 4], [nokiTo[0] + 1.4, nokiTo[2] + 1.0]], 4.5);
      yield L.shot(V(km.pos.x + 3.2, 2.0, km.pos.z + 4.6), V(km.pos.x - 0.2, 1.8, km.pos.z + 0.8), 0);
      c.expr('noki', 'angry');
      c.anim('noki').attack = { kind: 'chord', p: 0.5 };
      yield wait(0.35);
      km.shatter();
      c.anim('noki').attack = null;
      yield wait(0.5);
      yield face(L, c, 'noki', 2.3, -0.6);
      yield say(L, 'noki', 'Не слушайте его. Он всегда говорит последним.', 'angry');
      // К8 Ноки and Бублик
      c.expr('noki', 'normal'); c.look('bublik', c.pos('noki')); c.look('noki', c.pos('bublik'));
      c.expr('bublik', 'happy');
      yield bublikGo;
      // (from the bed's side: the broken frame behind them)
      const mid2 = c.head('bublik').lerp(c.head('noki'), 0.5);
      yield L.shot(mid2.clone().add(V(1.6, 0.35, 3.0)), mid2.clone().setY(mid2.y - 0.2), 0.5);
      yield say(L, 'bublik', 'Уже не всегда.', 'happy');
      yield wait(0.6);
    } finally {
      faceM.color.setScalar(1); km.setDark(0); km.king = 0;
      km.shatter(false);
      for (const k of CAST) { c.look(k, null); c.expr(k, 'normal'); }
      openExit(L);
    }
    audio.playMusic('garden');
    stageOff(L);
    gather(L, C.x, C.z - 12, 3, 0); // north of the bed, facing the broken mirror and the open door out
    yield L.camBack(0.7);
    L.cutscene(false);
    L.hud.toast(TOAST.exit, 6);
  },

  // the way out: through the north door along the moonlit path
  *exit_fangs3_garden(L) {
    if (L.nl) { L.complete = true; L.exitWait = null; }
    L.cutscene(true);
    G(L).cast.show(false);
    // from the moonlit path out of the dome, toward the castle on the horizon
    yield L.shot(V(-1.6, 2.6, -154.5), V(22, 14, -187), 0.9);
    yield wait(1.8);
    if (L.authority) L.endLevel();
  },
};

/** the root is out: the north door opens, the way out is there (every machine) */
function openExit(L: Level3D) {
  const g = G(L);
  L.seen.add('fangs3_ending');
  g.exitDoor.setOpen(true, true);
  L.exit(-2.5, -1, -163.5, 2.5, 5, -158);
  L.boss = null;
  g.fight = false;
}

/** every machine, after the build: the cast, the boss and its hooks, the state of a rebuilt level */
function setup(L: Level3D) {
  const g = G(L);
  if (!g) return;
  g.cast = new Cast(L);
  const b = new Shepot3(L, { lanterns: g.arenaLanterns, mirrors: g.arenaMirrors, flowers: g.arenaFlowers, feet: g.feet, whispers: g.whispers, can: g.can, puddles: g.puddles, heard: () => g.heard });
  // (the cold open was seen but the intro never ran: a crash / quit in between)
  if (L.seen.has('fangs3_cold') && !L.seen.has('fangs3_intro') && L.authority) g.pending.push('fangs3_intro');
  g.boss = b;
  b.onDefeat = () => { if (L.authority) g.pending.push('fangs3_boss_defeat'); };
  // the kit's reveals and chords reach him too (pollen bursts, Ноки's chord, scripts)
  const K = g.V;
  const vec = (a: THREE.Vector3 | [number, number, number]) => (a instanceof THREE.Vector3 ? a.clone() : V(a[0], a[1], a[2]));
  const rev = K.revealAround.bind(K), ch = K.chord.bind(K);
  K.revealAround = (at, r, secs = 4) => { rev(at, r, secs); b.revealNear(vec(at), r, secs); };
  K.chord = (at, r = 5, by = null) => { ch(at, r, by); b.chordNear(vec(at), r); };
  if (L.seen.has('f3:won')) {
    g.won = true;
    b.state = 'dead'; b.gone = true;
    g.bud.open = 1;
    if (L.seen.has('fangs3_ending')) openExit(L);
    else if (L.authority) g.pending.push('fangs3_ending');
    return;
  }
  if (L.seen.has('fangs3_boss_intro')) {
    // a restart in the fight: the whisper and the fight again (co-op: once every friend has loaded the level again)
    g.fight = true; L.boss = b;
    const nl = L.nl;
    if (!nl) L.runGen((function* (): Script { yield wait(0.01); L.run('fangs3_boss_retry'); })());
    else if (L.authority) L.runGen((function* (): Script { yield until(() => !nl.waiting); L.run('fangs3_boss_retry'); })());
  }
}

export const F3_SCRIPTS = { scripts, special: { [LEVEL_ID]: setup } };

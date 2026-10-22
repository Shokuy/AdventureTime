import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { ease, clamp, W } from '../../../../engine/util';
import { text } from '../../../../art/draw';
import { all, tween, wait, until, sub, type Script } from '../../../../game/coroutine';
import { tmat } from '../../../world/kit';
import type { Level3D, Actor3 } from '../../level';
import { vamp, ambient } from '../vampires';
import { ShadowGirl } from '../vampires/shadowGirl';
import { clearMarks } from '../shared/safeMark';
import { createMouse, type MouseAnim } from '../fangs5/rigs';
import { say } from './speech';
import { storyCard } from './card';
import { cast, mark, faceTo, hideCast, barkSeq, expr, CAST, type CastKind } from './cast';
import { SISTER_COLOR, RIBBON_COLOR } from './models';
import { f4, F4 } from './level';
import { LINES4, BANNER, NIGHT, type Sister } from './lines';

/*
 * The scenes of «Чёрный перевал» (docs/script-fangs-v2.md §8). Co-op: the host starts each one (L.run) and every machine
 * plays it with its own camera; lines advance by themselves. World actions (the fight's start, the zone's colour, the
 * level's end) happen where L.authority is true; everything else (the cast on its marks, the camera, the sisters'
 * staging, the stone's glow, the fire, the kingdom's lights) is staged identically on every machine. The players'
 * figures are hidden while the bars are down (castScenes); the story cast — Тоша, Бублик, Ноки, Пастила — acts.
 * Shots are named by the script's frames: [К1] … (ОП/СП/КП/2К/ВЗГ, v2 §0).
 */

type ScriptFn = (L: Level3D) => Script;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const C = F4.C;

/** v2: the banner after the cold open — «Серия 5. Чёрный перевал», «Ночь 4 из 5» */
function* chapterTitle(L: Level3D) { L.hud.showChapter(BANNER, NIGHT); L.bannerShown = true; yield undefined; }
function* end(L: Level3D, d = 0.6): Script {
  yield L.camBack(d);
  hideCast(L);
  L.cutscene(false);
}
/** start the next scene of a chain (host / solo; the clients get it from the host) */
function next(L: Level3D, id: string) {
  if (L.authority) L.runGen((function* (): Script { yield wait(0.05); yield until(() => !L.storyOn()); L.run(id); })());
}

/** the four on marks facing yaw (x, z offsets from a centre) */
function four(L: Level3D, y: number, spots: Record<CastKind, [number, number]>, yaw: number) {
  for (const k of CAST) mark(L, k, spots[k][0], y, spots[k][1], yaw);
}
/** Ноки has no shadow (bible §1.3) */
function noShadow(L: Level3D) { cast(L).noki.root.traverse((o) => { o.castShadow = false; }); }

// the sisters (back to back 2.5 m in front of the stone: Ночка looks west, Тенька east)
const nochkaShot = (L: Level3D, d = 0) => L.shot(V(-4.4, 21.75, C.z + 4.4), V(-0.62, 21.55, C.z + 2.5), d);
const tenkaShot = (L: Level3D, d = 0) => L.shot(V(4.4, 21.75, C.z + 4.4), V(0.62, 21.55, C.z + 2.5), d);
const sistersShot = (L: Level3D, d = 0) => L.shot(V(0, 22.2, C.z + 9.2), V(0, 21.2, C.z + 1.6), d);

// ───────────────────────── the sisters' voices from the summit (8.2.4, «ветер доносит») ─────────────────────────
/** lines at the top of the screen, one after another, wobbling in the wind (every machine; never holds the world) */
function windVoices(L: Level3D, items: [Sister, string][]) {
  let t = 0;
  const STEP = 2.4;
  const draw = (ctx: CanvasRenderingContext2D) => {
    const i = Math.floor(t / STEP);
    if (i >= items.length) return;
    const u = t - i * STEP;
    const a = clamp(Math.min(u / 0.25, (STEP - 0.2 - u) / 0.35), 0, 1);
    if (a <= 0) return;
    const [w, line] = items[i];
    ctx.save();
    ctx.globalAlpha = a * (0.85 + 0.15 * Math.sin(L.t * 9));
    ctx.translate(W / 2 + Math.sin(L.t * 2.3 + i) * 10, 128);
    ctx.rotate(Math.sin(L.t * 3.1) * 0.02);
    text(ctx, `${w === 'nochka' ? 'Ночка' : 'Тенька'} (издалека): ${line}`, 0, 0, { size: 26, font: 'body', color: SISTER_COLOR[w], align: 'center', stroke: 6 });
    ctx.restore();
  };
  L.overlayDraw.push(draw);
  let said = -1;
  const act: Actor3 = {
    dead: false,
    update(_L, dt) {
      t += dt;
      const i = Math.floor(t / STEP);
      if (i !== said && i < items.length) { said = i; audio.sfx('whoosh', { pitch: 0.5, volume: 0.35 }); }
      if (t > items.length * STEP) { act.dead = true; const k = L.overlayDraw.indexOf(draw); if (k >= 0) L.overlayDraw.splice(k, 1); }
    },
  };
  L.actors.push(act);
}
function* fangs4_v_bridge(L: Level3D): Script { windVoices(L, LINES4.voices.bridge); yield undefined; }
function* fangs4_v_cave(L: Level3D): Script { windVoices(L, LINES4.voices.cave); yield undefined; }
function* fangs4_v_stairs(L: Level3D): Script { windVoices(L, LINES4.voices.stairs); yield undefined; }

// ───────────────────────── 8.0 fangs4_cold — Спиной к спине ─────────────────────────
function* fangs4_cold(L: Level3D): Script {
  const tw = f4(L).twins;
  L.cutscene(true);
  audio.duckMusic(0.35);
  tw.place();
  // [К1] ОП: the summit, the moon, the wind flags
  yield L.shot(V(3, 22.5, C.z + 20), V(0, 25.3, C.z), 0);
  yield L.shot(V(2.2, 22.3, C.z + 15.5), V(0, 25.0, C.z), 2.2);
  // [К2] СП Ночка (looks left)
  yield nochkaShot(L);
  yield say(L, 'nochka', 'Сестрица. С моей стороны кто-то идёт.');
  // [К3] СП Тенька (looks right)
  yield tenkaShot(L);
  yield say(L, 'tenka', 'С моей — никого. Значит, никого.');
  // [К4] ВЗГ Ночки: far below on the road, four tiny figures
  const yr = F4.YR;
  four(L, yr, { pastila: [-1.7, -356.5], tosha: [-0.6, -357.4], noki: [0.6, -356.4], bublik: [1.7, -357.6] }, Math.PI);
  for (const k of CAST) { const n = cast(L)[k]; n.anim.state = 'walk'; n.anim.speed = 2.2; }
  noShadow(L);
  yield L.shot(V(0.8, 24.2, -375.5), V(0, yr + 0.6, -357), 0);
  yield say(L, 'nochka', 'Идут. Четверо. Один длинный.');
  hideCast(L);
  yield tenkaShot(L);
  yield say(L, 'tenka', 'Покажи.');
  yield nochkaShot(L);
  yield say(L, 'nochka', 'Не могу. Ты же знаешь — не могу повернуться.');
  // [К5] КП: the ribbon in their hair
  yield L.shot(V(0.25, 22.9, C.z + 3.6), V(0, 22.05, C.z + 2.45), 0);
  yield say(L, 'tenka', 'Знаю. Сто лет знаю, сестрица.', 'sad');
  // [К6] ОП, the moon, the King's voice
  yield L.shot(V(1.2, 20.7, C.z + 15), V(2, 30, C.z - 30), 0);
  audio.sfx('hiss', { pitch: 0.5, volume: 0.7 });
  yield say(L, 'polnoch', 'Никого не пускать к камню.');
  tw.talkNow('nochka');
  yield say(L, 'nochka', 'Да, Ваше Величество.');
  yield say(L, 'tenka', 'Нет, Ваше Величество. То есть да!', 'scared');
  // the banner over the moon, then 8.1 at the foot of the pass
  yield L.shot(V(1.0, 20.9, C.z + 15.6), V(2.4, 32, C.z - 40), 2.6);
  yield* chapterTitle(L);
  yield wait(2.8);
  audio.duckMusic(1);
  next(L, 'fangs4_intro');
  // (a client whose intro never comes from the host gets its hero back)
  if (!L.authority) { let t = 0; yield until(() => L.seen.has('fangs4_intro') || (t += 1 / 60) > 4); if (!L.seen.has('fangs4_intro')) yield* end(L, 0.3); }
}

// ───────────────────────── 8.1 fangs4_intro — Ветер и кости старого мира ─────────────────────────
function* fangs4_intro(L: Level3D): Script {
  L.cutscene(true);
  noShadow(L);
  four(L, 0, { tosha: [-0.9, 3.0], bublik: [0.5, 3.6], noki: [1.8, 2.6], pastila: [-2.3, 3.8] }, Math.PI);
  const group = () => L.shot(V(0.1, 1.45, -1.6), V(-0.3, 0.85, 3.3), 0);
  yield L.shot(V(0.6, 3.4, 11), V(0, 1.2, -26), 0);
  yield all(L.shot(V(0.6, 2.8, 8), V(0, 1.0, -30), 3.5), say(L, 'narrator', 'Четвёртая ночь. Луна алая, почти круглая. Дорога к замку шла через Чёрный перевал.'));
  yield group();
  expr(L, 'bublik', 'scared');
  yield say(L, 'bublik', 'Тут дует так, что у меня уши завязались бантиком.', 'scared');
  expr(L, 'bublik', 'normal');
  yield say(L, 'pastila', 'Ветер — восемь баллов. Держитесь за поручни. Если они есть.');
  // a rusty pipe close up
  yield L.shot(V(3.2, 3.3, 1.6), V(6.4, 5.4, -2.6), 0);
  yield say(L, 'tosha', 'А что это за трубы в скалах? И столбы ржавые?');
  yield say(L, 'pastila', 'Кости старого мира. Он был тут до Хрумляндии. Какой — никто не помнит.');
  // the bridge over the chasm
  yield L.shot(V(-2.6, 3.2, -21), V(0, -0.4, -46), 0);
  yield say(L, 'noki', 'Мосты тут рушатся. Стаи летают. А на вершине — Солнечный камень и Сёстры.');
  // the castle on the horizon
  yield L.shot(V(0, 1.9, 2.4), V(40, 90, -760), 0);
  yield say(L, 'noki', 'Пока одна смотрит на вас — вторую не тронуть. Бейте ту, что отвернулась.');
  yield group();
  cast(L).tosha.anim.state = 'cheer';
  yield say(L, 'tosha', 'Значит, разделимся! Одни отвлекают, другие бьют.', 'happy');
  cast(L).tosha.anim.state = 'idle';
  yield say(L, 'pastila', 'Записываю: «Тоша предложил тактику». Исторический момент.', 'sly');
  expr(L, 'tosha', 'angry');
  yield say(L, 'tosha', 'Эй!', 'angry');
  expr(L, 'tosha', 'normal');
  // КП Бублик at the old stub of the bridge, looking over the gap
  const bu = mark(L, 'bublik', 10.0, 0, -11, Math.PI / 2, 'idle', { wall: 0.5 });
  yield L.shot(V(13.2, 1.25, -9.6), V(bu.root.position.x, 0.75, bu.root.position.z), 0);
  expr(L, 'bublik', 'scared');
  yield say(L, 'bublik', 'Если мост рухнет — я буду мостом. Наверное. Не прыгайте сильно.');
  expr(L, 'bublik', 'normal');
  yield* end(L, 0.7);
  if (!L.bannerShown) yield* chapterTitle(L);
}

// ───────────────────────── 8.2.3 the ruins, «ОСТ_НОВКА» (bars over the team, no bars) ─────────────────────────
function* fangs4_ruins(L: Level3D): Script {
  barkSeq(L, [[0.3, 'bublik', LINES4.ruins.bublik], [3.0, 'pastila', LINES4.ruins.pastila]]);
  yield undefined;
}
function* fangs4_stop(L: Level3D): Script {
  barkSeq(L, [[0.2, 'bublik', LINES4.stop]]);
  yield undefined;
}

// ───────────────────────── 8.3 fangs4_boss_intro — Сёстры у камня ─────────────────────────
function fightOn(L: Level3D) {
  const r = f4(L);
  L.boss = r.twins;
  L.camModeDefault = 'boss';
  L.tcam.mode = 'boss';
  L.tcam.bossPoint = C.clone().setY(C.y + 2.5);
  L.def.deathText = LINES4.death.twins;
  if (!L.nl) {
    // solo: the story cast helps from the rim (minus the hero I play)
    const mineK = (L.player as unknown as { kind: string }).kind;
    const spots: Record<CastKind, THREE.Vector3> = { bublik: V(-5.8, C.y, C.z + 11.8), tosha: V(6.1, C.y, C.z + 12.1), pastila: V(-10.6, C.y, C.z + 6), noki: V(10.6, C.y, C.z + 6) };
    r.twins.setHelpers(L, CAST.filter((k) => k !== mineK).map((k) => ({ kind: k, at: spots[k] })));
  }
  audio.playMusic('vampire_boss');
  if (L.authority) r.twins.start();
}

function* fangs4_boss_intro(L: Level3D): Script {
  const tw = f4(L).twins;
  L.boss = tw;
  L.cutscene(true);
  audio.playMusic('vampire_boss');
  tw.place();
  noShadow(L);
  // the four on the top step, 2K pairs: Пастила + Бублик, Тоша + Ноки
  const z = C.z + 12.4;
  four(L, C.y, { pastila: [-2.3, z], bublik: [-1.0, z - 0.2], tosha: [0.4, z + 0.1], noki: [1.8, z - 0.1] }, Math.PI);
  const at = (k: CastKind) => cast(L)[k].root.position;
  const pair = (a: CastKind, b: CastKind) => { const m = at(a).clone().lerp(at(b), 0.5); return L.shot(V(m.x, C.y + 1.45, m.z - 2.8), V(m.x, C.y + 0.95, m.z), 0); };
  yield sistersShot(L);
  yield wait(0.4);
  // [К1] … [К2]
  yield nochkaShot(L, 0.6);
  yield say(L, 'nochka', 'Смотри, сестрица, гости.');
  yield tenkaShot(L);
  yield say(L, 'tenka', 'Вижу, сестрица. Я смотрю в другую сторону — но вижу.');
  // [К3] 2К Пастила и Бублик
  yield pair('pastila', 'bublik');
  yield say(L, 'pastila', 'Нам нужна только щепотка пыли с камня! Одна щепотка!');
  yield tenkaShot(L);
  yield say(L, 'tenka', 'Щепотка — это много.');
  yield nochkaShot(L);
  yield say(L, 'nochka', 'Щепотка — это всё.');
  yield pair('pastila', 'bublik');
  yield say(L, 'bublik', 'Вы всегда разговариваете по очереди?');
  yield nochkaShot(L);
  yield say(L, 'nochka', 'Да.');
  yield tenkaShot(L);
  yield say(L, 'tenka', 'Нет.');
  // [К5] СП Ноки
  yield L.shot(V(at('noki').x + 0.3, C.y + 1.5, at('noki').z - 2.9), V(at('noki').x, C.y + 1.05, at('noki').z), 0);
  yield say(L, 'noki', 'Смотрительницы камня. Я помню, как вы его зажигали. Вы смеялись тогда.', 'sad');
  // [К4] ОП: the sisters and the stone
  yield sistersShot(L);
  yield say(L, 'nochka', 'Смеялись. Пока не поссорились навсегда.', 'sad');
  // [К6] 2К Тоша и Ноки
  yield pair('tosha', 'noki');
  expr(L, 'tosha', 'angry');
  yield say(L, 'tosha', 'Разделяемся: одни на Ночку, другие на Теньку!');
  expr(L, 'tosha', 'normal');
  yield nochkaShot(L);
  yield say(L, 'nochka', 'Разделитесь?', 'sly');
  yield tenkaShot(L);
  yield say(L, 'tenka', 'Как мило. Мы тоже.', 'sly');
  // [К7] a flash: they swap places
  yield sistersShot(L);
  swapFx(L);
  yield wait(0.7);
  L.toast(LINES4.ruleToast);
  yield* end(L, 0.6);
  fightOn(L);
}

/** the swap flash of the intro (every machine) */
function swapFx(L: Level3D) {
  const tw = f4(L).twins;
  const a = tw.sister('nochka'), b = tw.sister('tenka');
  for (const s of [a, b]) L.fx.emit(s.pos.clone().setY(s.pos.y + 1), { count: 26, speed: [2, 5], life: [0.3, 0.6], size: [0.2, 0.4], colors: [SISTER_COLOR[s.kind], '#ffffff'], drag: 3 });
  const p = a.pos.clone(); a.pos.copy(b.pos); b.pos.copy(p);
  a.yaw = Math.PI / 2; b.yaw = -Math.PI / 2; a.gaze = a.yaw; b.gaze = b.yaw;
  L.whiteFlash = 0.5;
  audio.sfx('reflect', { pitch: 0.7 });
}

// v2 §12: the retry after a team restart / a solo respawn
function* fangs4_boss_retry(L: Level3D): Script {
  const tw = f4(L).twins;
  L.boss = tw;
  L.cutscene(true);
  tw.place();
  yield sistersShot(L);
  yield wait(0.3);
  for (const [w, s] of LINES4.retry) yield say(L, w, s, 'sly');
  yield* end(L, 0.5);
  fightOn(L);
}

// ───────────────────────── 8.5 fangs4_boss_defeat — Лицом к лицу + 8.6 fangs4_stone ─────────────────────────
function* fangs4_boss_defeat(L: Level3D): Script {
  const r = f4(L), tw = r.twins;
  L.cutscene(true);
  audio.stopMusic(1.2);
  L.seen.add('f4won');
  // the wind dies down
  r.wind.strength = 0;
  tw.staged = true;
  tw.clearHelpers(L);
  noShadow(L);
  const z = C.z + 2.0;
  // [К1] СП: both on their knees at the stone, back to back, the ribbon still ties them
  L.fx.emit(V(0, C.y + 1, z), { count: 30, speed: [1, 3], life: [0.4, 0.8], size: [0.2, 0.4], colors: ['#ffffff', '#c8b0e0'], drag: 3 });
  tw.place(2.0, 'kneel');
  for (const s of tw.sis) { s.down = true; s.argue = false; s.gazeOn = 0; }
  tw.tether.mend();
  // the four 5 m off, out of К4's frame
  four(L, C.y, { pastila: [-2.2, C.z + 7.6], bublik: [-0.8, C.z + 7.9], tosha: [0.7, C.z + 7.7], noki: [2.2, C.z + 7.4] }, Math.PI);
  const k1 = () => L.shot(V(0.6, C.y + 1.45, z + 5.0), V(0, C.y + 0.95, z), 0);
  yield k1();
  yield wait(1.0);
  // [К2] КП: the ribbon snaps
  yield L.shot(V(0.3, C.y + 1.9, z + 1.25), V(0, C.y + 1.35, z), 0);
  yield wait(0.5);
  tw.tether.snap();
  audio.sfx('break', { pitch: 1.9, volume: 0.6 });
  L.fx.sparks(V(0, C.y + 1.5, z), 10, [RIBBON_COLOR, '#ffffff']);
  yield wait(1.1);
  yield k1();
  yield say(L, 'nochka', 'Сестрица… лента порвалась.', 'surprised');
  yield say(L, 'tenka', 'Значит… можно повернуться?', 'surprised');
  // [К3] a slow fly round (d = 2.5): they turn to each other — silence
  const a = tw.sister('nochka'), b = tw.sister('tenka');
  const R0 = 4.6;
  yield tween(2.5, (k) => {
    const ang = -0.9 + k * 1.8;
    L.shot(V(Math.sin(ang) * R0, C.y + 1.45, z + Math.cos(ang) * R0), V(0, C.y + 1.0, z), 0);
    const u = ease.inOut(k);
    // (a cheat toward the camera: profiles, three-quarter)
    a.yaw = -Math.PI / 2 + (Math.PI - 0.55) * u; b.yaw = Math.PI / 2 - (Math.PI - 0.55) * u;
    a.gaze = a.yaw; b.gaze = b.yaw;
    a.pos.x = C.x - 0.62 - 0.14 * u; b.pos.x = C.x + 0.62 + 0.14 * u;
  });
  // [К4] 2К profiles, face to face
  yield L.shot(V(0, C.y + 1.2, z + 4.3), V(0, C.y + 1.05, z), 0);
  yield say(L, 'nochka', '…У тебя нос в веснушку.');
  yield say(L, 'tenka', 'Это мой нос. Он у нас один на двоих.');
  yield say(L, 'nochka', 'Сто лет я не видела твоего лица.', 'happy');
  yield say(L, 'tenka', 'А я — твоего. Ты постарела, сестрица.', 'happy');
  yield say(L, 'nochka', 'На три минуты! Ты младше на три минуты!', 'angry');
  // they laugh, holding hands
  tw.pose('nochka', 'laugh'); tw.pose('tenka', 'laugh');
  audio.sfx('colorRestore');
  yield wait(1.8);
  // the double puff: two little bats bump foreheads and fly off to the castle together
  const mice = (['nochka', 'tenka'] as const).map((k) => {
    const rig = createMouse(k);
    const g = new THREE.Group(); g.add(rig.root); g.scale.setScalar(2.2);
    const s = tw.sister(k);
    g.position.copy(s.pos).setY(C.y + 0.6);
    L.scene.add(g);
    L.fx.emit(g.position.clone().setY(C.y + 1.1), { count: 30, speed: [2, 6], life: [0.3, 0.7], size: [0.25, 0.5], colors: [SISTER_COLOR[k], '#ffffff', '#2a1a3a'], drag: 3 });
    return { rig, g, anim: { talk: 0, hop: 0, squeak: 0 } as MouseAnim };
  });
  tw.vanishAll();
  audio.sfx('reflect', { pitch: 0.6 }); audio.sfx('batFlap');
  const anim = (dt: number) => { for (const m of mice) m.rig.update(dt, m.anim); };
  const p0 = mice.map((m) => m.g.position.clone());
  const up = p0.map((p) => p.clone().setY(C.y + 2.6));
  // (a low angle: they meet above the stone, against the red sky)
  yield L.shot(V(0.5, C.y + 0.9, z + 5.0), V(0, C.y + 3.4, z - 1), 0);
  yield tween(0.6, (k) => { anim(1 / 60); mice.forEach((m, i) => { m.g.position.lerpVectors(p0[i], up[i], ease.outCubic(k)); m.g.lookAt(up[1 - i].x, m.g.position.y, up[1 - i].z); }); });
  const meet = V(0, C.y + 4.4, z);
  yield tween(0.35, (k) => { anim(1 / 60); mice.forEach((m, i) => m.g.position.lerpVectors(up[i], meet.clone().setX((i ? 0.18 : -0.18)), ease.inCubic(k))); });
  L.fx.stars(meet.clone(), 24); audio.sfx('pogo', { pitch: 1.6 });
  for (const m of mice) m.anim.squeak = 1;
  yield wait(0.5);
  const far = meet.clone().add(V(14, 26, -60));
  yield tween(2.4, (k) => {
    anim(1 / 60);
    mice.forEach((m, i) => { m.g.position.lerpVectors(meet, far, ease.inCubic(k)); m.g.position.x += (i ? 0.25 : -0.25); m.g.lookAt(far); });
  });
  for (const m of mice) m.g.removeFromParent();
  // [К5] СП Пастила; Ноки looks at the castle without a word
  const pas = cast(L).pastila.root.position;
  yield L.shot(V(pas.x + 0.3, C.y + 1.5, pas.z - 2.3), V(pas.x, C.y + 1.15, pas.z), 0);
  yield say(L, 'pastila', 'Он всем обещает то, чего им хочется. И забирает тень.', 'sad');
  const no = cast(L).noki;
  faceTo(no, F4.castle.x, F4.castle.z);
  yield L.shot(V(no.root.position.x - 1.2, C.y + 1.5, no.root.position.z + 1.9), V(F4.castle.x, 40, F4.castle.z), 0);
  yield wait(1.6);
  // the stone wakes up warm and yellow; the ruins round it get their colour back
  yield L.shot(V(0, 22.4, C.z + 10.5), V(0, 22.4, C.z), 0);
  if (L.authority) vamp(L).restoreZone('summit');
  audio.sfx('artifact', { pitch: 0.8 });
  yield tween(1.6, (k) => { r.stoneK = k; });
  r.stoneK = 1;
  yield wait(1.0);
  // 8.6 — Пыль солнечного камня (как v1)
  clearMarks(L);
  mark(L, 'pastila', 0, C.y, C.z + 1.9, Math.PI, 'lookUp', { wall: 0.4 });
  mark(L, 'bublik', -1.6, C.y, C.z + 3.0, Math.PI);
  mark(L, 'tosha', -0.4, C.y, C.z + 4.2, Math.PI);
  mark(L, 'noki', -3.0, C.y, C.z + 2.0, Math.PI);
  faceTo(cast(L).bublik, 0, C.z); faceTo(cast(L).tosha, 0, C.z); faceTo(cast(L).noki, 0, C.z);
  // (on tiptoe, scraping the lens with a spoon)
  let sc = 0;
  const tip = cast(L).pastila;
  const tipY = tip.root.position.y;
  const scrape: Actor3 = { dead: false, update: (_L, dt) => { sc += dt; if (tip.anim.state !== 'lookUp') { scrape.dead = true; return; } tip.root.position.y = tipY + 0.12 + Math.abs(Math.sin(sc * 9)) * 0.05; } };
  L.actors.push(scrape);
  yield L.shot(V(3.6, 21.4, C.z + 3.0), V(-0.6, 21.3, C.z + 1.3), 0);
  expr(L, 'pastila', 'happy');
  yield say(L, 'pastila', 'Солнечный камень снова светится! Скребу… осторожно… Есть!', 'happy');
  tip.anim.state = 'cheer'; tip.root.position.y = tipY;
  yield storyCard(L, LINES4.cardDust, 'dust');
  tip.anim.state = 'idle';
  yield L.shot(V(-3.4, 21.7, C.z - 2.4), V(-1.0, 20.9, C.z + 3.0), 0);
  yield say(L, 'bublik', 'А что это за камень? Похож на большой жёлтый глаз. И мигает.');
  yield say(L, 'pastila', 'Учёные спорят. Я думаю, это маяк старого мира. Он мигал жёлтым, чтобы все были осторожны.');
  yield say(L, 'bublik', 'Мигал жёлтым — и все были осторожны. Мудрый был мир.');
  yield say(L, 'pastila', 'Все три ингредиента! Разводим костёр. Сироп сварю прямо здесь.', 'happy');
  // the fire under the big pipe is lit; the team walks over to it (the exit → 8.7)
  r.fire.set(true);
  setExit(L);
  L.boss = null;
  L.camModeDefault = 'follow';
  L.tcam.mode = 'follow';
  L.def.deathText = LINES4.death.wind;
  yield* end(L, 0.7);
  audio.playMusic('pass');
  L.toast(LINES4.campfire);
}

/** the campfire is the way out of the level (every machine; only the host's exit check counts) */
export function setExit(L: Level3D) {
  const f = F4.fire;
  L.exit(f.x - 4, f.y - 1, f.z - 4, f.x + 4.5, f.y + 4, f.z + 6.5);
}

// ───────────────────────── 8.7 fangs4_campfire — Страница (the arc's twist) ─────────────────────────
interface Camp { pot: THREE.Group; syrup: THREE.MeshToonMaterial; page: THREE.Mesh; rocks: THREE.Mesh[]; girl: ShadowGirl | null; cookie: THREE.Mesh | null }
/** the campfire set (every machine; built once, kept for 8.8) */
function camp(L: Level3D): Camp {
  let c = L.refs.f4camp as Camp | undefined;
  if (c) return c;
  const f = F4.fire;
  const pot = new THREE.Group();
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), tmat(null, '#2a2228', { side: THREE.DoubleSide }));
  const syrup = tmat(null, '#ffc828', { emissive: '#ffa818', emissiveIntensity: 0.9 }) as THREE.MeshToonMaterial;
  const sy = new THREE.Mesh(new THREE.CircleGeometry(0.42, 16).rotateX(-Math.PI / 2), syrup);
  bowl.position.y = 0.95; sy.position.y = 0.94; pot.add(bowl, sy);
  pot.position.set(f.x, f.y, f.z);
  L.scene.add(pot);
  const rocks = [0, 1].map((i) => {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(i ? 0.4 : 0.5, 0), tmat(null, '#5a5068', { flat: true }));
    rock.position.set(f.x + 0.4, f.y + 0.2, f.z - 6.6 - i * 1.0); rock.scale.set(1, i ? 0.55 : 0.5, 1);
    L.scene.add(rock);
    return rock;
  });
  // Карамель's page (folded in four, yellowed): in Пастила's hands
  const pageTex = (() => {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 160;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#f2dfa8'; g.fillRect(0, 0, 128, 160);
    g.strokeStyle = 'rgba(160,120,60,0.6)'; g.lineWidth = 2; g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 160); g.moveTo(0, 80); g.lineTo(128, 80); g.stroke();
    g.strokeStyle = 'rgba(80,40,20,0.7)'; g.lineWidth = 1.6;
    for (let i = 0; i < 12; i++) { g.beginPath(); const y = 14 + i * 11; g.moveTo(10, y); for (let x = 10; x < 118; x += 6) g.lineTo(x, y + Math.sin(x * 0.7 + i) * 1.5); g.stroke(); }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const page = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.42), new THREE.MeshBasicMaterial({ map: pageTex, side: THREE.DoubleSide }));
  page.visible = false;
  L.scene.add(page);
  c = { pot, syrup, page, rocks, girl: null, cookie: null };
  L.refs.f4camp = c;
  return c;
}

/** everyone's marks round the fire (8.7, 8.8): Пастила at the pot, Тоша across the fire from Ноки, Бублик by Тоша */
function campMarks(L: Level3D) {
  const f = F4.fire;
  clearMarks(L);
  const pas = mark(L, 'pastila', f.x + 1.25, f.y, f.z + 0.3, 0, 'idle', { wall: 0.6 }); faceTo(pas, f.x, f.z);
  const no = mark(L, 'noki', f.x + 0.4, f.y + 0.45, f.z - 6.6, Math.PI / 2, 'sit', false);
  const to = mark(L, 'tosha', f.x - 0.4, f.y, f.z + 1.7, 0, 'idle', { wall: 0.6 }); faceTo(to, no.root.position.x, no.root.position.z);
  const bu = mark(L, 'bublik', f.x - 1.6, f.y, f.z + 1.1, 0, 'idle', { wall: 0.6 }); faceTo(bu, f.x, f.z);
  return { pas, no, to, bu };
}

function* fangs4_campfire(L: Level3D): Script {
  const f = F4.fire, r = f4(L);
  L.cutscene(true);
  audio.duckMusic(0.3);
  r.fire.set(true);
  noShadow(L);
  const c = camp(L);
  const { pas, no, to } = campMarks(L);
  pas.anim.attack = { kind: 'flask', p: 0.3 };
  // [К1] ОП: the fire, the castle far away
  yield L.shot(V(f.x, f.y + 2.3, f.z + 4.8), V(f.x + 0.6, f.y + 0.8, f.z - 4.2), 0);
  yield say(L, 'narrator', 'Ночью у костра Пастила варила сироп. Он пах солнцем и немножко пирогами.');
  pas.anim.attack = null;
  // [К2] 2К Тоша и Ноки (over the fire)
  yield L.shot(V(f.x + 1.0, f.y + 2.0, f.z + 3.9), V(f.x + 0.2, f.y + 0.9, f.z - 4.2), 0);
  yield say(L, 'tosha', 'Ноки. Перевал пройден. Страница.');
  yield say(L, 'noki', '…Читай ты, Пастила. У меня руки дрожат. От холода.', 'sad');
  // [К3] КП: the page in Пастила's hands, firelight
  const pp = pas.root.position;
  const fwd = V(f.x - pp.x, 0, f.z - pp.z).normalize();
  c.page.position.copy(pp).addScaledVector(fwd, 0.42).setY(f.y + 1.02);
  c.page.lookAt(c.page.position.clone().addScaledVector(fwd, -1).setY(f.y + 1.6));
  c.page.visible = true;
  pas.anim.state = 'lookUp';
  audio.sfx('artifact', { pitch: 1.6, volume: 0.4 });
  yield L.shot(c.page.position.clone().addScaledVector(fwd, 0.9).add(V(0.25, 0.38, 0)), c.page.position.clone(), 0);
  yield say(L, 'karamel', '«Моя Ноки ушла к Королю одна, с гитарой. Я видела с колокольни.»');
  // [К4] a slow push-in on Ноки in profile against the castle (d = 6): the rest of the page on one shot
  const np = no.root.position;
  yield L.shot(V(np.x + 0.5, f.y + 1.2, np.z + 3.4), V(np.x + 0.5, f.y + 1.55, np.z - 4), 0);
  yield all(
    L.shot(V(np.x + 0.45, f.y + 1.25, np.z + 1.9), V(np.x + 0.45, f.y + 1.6, np.z - 4), 6),
    sub((function* (): Script {
      yield say(L, 'karamel', '«Она отдала ему свою тень — чтобы он ушёл из посада до следующей луны.»');
      yield say(L, 'karamel', '«Утром посад был цветной, а Ноки — нет. Она думает, что проиграла.»');
      yield say(L, 'karamel', '«Она не проиграла. Она нас выкупила. Если она вернётся — скажите ей.»');
    })()),
  );
  c.page.visible = false;
  pas.anim.state = 'idle';
  // [К5] СП Ноки, her eyes — a long pause, the fire crackles
  yield L.shot(V(np.x + 1.3, f.y + 1.35, np.z + 0.9), V(np.x, f.y + 1.3, np.z), 0);
  expr(L, 'noki', 'surprised');
  audio.sfx('crumble', { pitch: 1.8, volume: 0.25 });
  yield wait(1.8);
  expr(L, 'noki', 'hurt');
  yield say(L, 'noki', 'Я не помню. Я сто лет помнила только, что проиграла.', 'sad');
  // [К6] СП Пастила
  yield L.shot(V(pp.x - 1.5, f.y + 1.35, pp.z - 1.4), V(pp.x, f.y + 1.15, pp.z), 0);
  yield say(L, 'pastila', 'Тень помнит то, что ты забыла. Он унёс память вместе с ней.');
  yield say(L, 'pastila', 'Кто отдал тень ради себя — стал вампиром. А ты — ради других.');
  yield say(L, 'pastila', 'Поэтому ты осталась наполовину собой. Это не проклятие. Это сдача.', 'happy');
  // [К7] ОП
  yield L.shot(V(f.x, f.y + 2.6, f.z + 5.4), V(f.x + 0.4, f.y + 0.9, f.z - 5), 1.2);
  yield wait(0.6);
  void to;
  next(L, 'fangs4_promise');
}

// ───────────────────────── 8.8 fangs4_promise — Печенье для тени ─────────────────────────
function* fangs4_promise(L: Level3D): Script {
  const f = F4.fire, r = f4(L);
  try {
    L.cutscene(true);
    audio.duckMusic(0.25);
    r.fire.set(true);
    noShadow(L);
    const c = camp(L);
    const { pas, no, to } = campMarks(L);
    const np = no.root.position;
    // Бублик comes over and sits down next to Ноки
    const bu = mark(L, 'bublik', np.x + 1.4, f.y, np.z + 0.45, 0, 'idle', { wall: 0.5, spacing: 0.6 }); faceTo(bu, np.x, np.z);
    const two = () => L.shot(V(np.x + 0.8, f.y + 1.3, np.z + 2.7), V(np.x + 0.75, f.y + 0.85, np.z), 0);
    // [К1] 2К Бублик и Ноки
    yield two();
    yield say(L, 'bublik', 'Значит, ты не чудовище. Ты героиня. Просто с клыками.');
    // [К2] КП: a small shadow of a girl with a guitar sits down on the stone next to Ноки
    const seat = c.rocks[1].position.clone().setY(f.y + 0.3);
    const camAt = V(np.x + 1.9, f.y + 0.95, seat.z - 0.5);
    const girl = c.girl ?? (c.girl = new ShadowGirl(L));
    girl.sitBeside(seat, Math.atan2(camAt.x - seat.x, camAt.z - seat.z), 0.55);
    girl.fly.material.opacity = 0;
    yield L.shot(camAt, V(seat.x, f.y + 0.7, seat.z + 0.3), 0);
    yield tween(1.2, (k) => { girl.fly.material.opacity = 0.88 * k; });
    // [К3] КП: Бублик holds out a cookie without a word, the shadow takes it
    bu.anim.attack = { kind: 'punch', p: 0.45 }; bu.anim.fx = { reach: 0.5 };
    const cookie = c.cookie ?? (c.cookie = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 14), tmat(null, '#c88a3a')));
    cookie.rotation.set(Math.PI / 2, 0, 0);
    const from = bu.root.position.clone().add(V(-0.5, 0.55, -0.25)), to2 = seat.clone().add(V(0.12, 0.28, 0.12));
    cookie.position.copy(from); cookie.visible = true; L.scene.add(cookie);
    yield wait(0.6);
    // (the shared silhouette's 'reach' frame is a standing one: she takes it sitting — the cookie goes dark in her hands)
    const cm = cookie.material as THREE.MeshToonMaterial, c0 = cm.color.clone();
    yield tween(0.8, (k) => { cookie.position.lerpVectors(from, to2, ease.inOut(k)); });
    bu.anim.attack = null; bu.anim.fx = {};
    yield tween(0.5, (k) => { cm.color.copy(c0).lerp(new THREE.Color('#140a1e'), k); });
    yield wait(0.3);
    cookie.visible = false; cm.color.copy(c0);
    // (Ноки and the shadow beside her, both in the frame)
    yield L.shot(V(np.x + 2.4, f.y + 1.15, np.z - 0.3), V(np.x, f.y + 0.95, np.z - 0.55), 0);
    expr(L, 'noki', 'surprised');
    yield say(L, 'noki', '…Ты её видишь?', 'surprised');
    // [К4] 2К Ноки и Бублик
    yield two();
    expr(L, 'bublik', 'happy');
    yield say(L, 'bublik', 'С первой ночи. Она за тобой ходит. Она тебя ждёт.');
    expr(L, 'bublik', 'normal');
    // [К5] 2К Тоша и Ноки
    yield L.shot(V(f.x + 1.0, f.y + 2.0, f.z + 3.9), V(f.x + 0.2, f.y + 0.9, f.z - 4.2), 0);
    to.anim.state = 'cheer';
    yield say(L, 'tosha', 'Мы вернём тебе тень. Слово героя.', 'happy');
    to.anim.state = 'idle';
    expr(L, 'noki', 'normal');
    yield say(L, 'noki', 'Ты всем это говоришь?', 'sly');
    yield say(L, 'tosha', 'Только друзьям.');
    // [К6] СП Пастила, the pot flares gold
    const pp = pas.root.position;
    yield L.shot(V(pp.x - 1.5, f.y + 1.35, pp.z - 1.4), V(pp.x - 0.6, f.y + 1.0, pp.z), 0);
    pas.anim.state = 'cheer';
    L.fx.emit(V(f.x, f.y + 1.1, f.z), { count: 40, speed: [1, 4], life: [0.5, 1.0], size: [0.1, 0.25], colors: ['#ffd040', '#fff0a0', '#ffa818'], g: -2, drag: 2 });
    audio.sfx('artifact', { pitch: 1.2 });
    const em0 = c.syrup.emissiveIntensity;
    yield all(
      tween(1.4, (k) => { c.syrup.emissiveIntensity = em0 + 2.6 * Math.sin(k * Math.PI); }),
      say(L, 'pastila', 'Сироп готов! Солнечный, полный заряд.', 'happy'),
    );
    pas.anim.state = 'idle';
    yield storyCard(L, LINES4.cardSyrup, 'syrup');
    // [К7] ОП from the edge of the summit, behind the four: far below the kingdom's lights go out one by one
    girl.hide();
    const K = F4.kingdom;
    const edge: Record<CastKind, [number, number]> = { tosha: [10.6, C.z - 0.6], bublik: [10.9, C.z + 0.6], noki: [10.3, C.z - 1.9], pastila: [10.4, C.z + 1.9] };
    for (const k of CAST) { const n = mark(L, k, edge[k][0], C.y, edge[k][1], Math.PI / 2, 'idle', { wall: 0.5, spacing: 0.7 }); faceTo(n, K.x, K.z); n.anim.expr = 'normal'; }
    yield L.shot(V(5.6, C.y + 2.5, C.z + 0.2), V(K.x, K.y + 6, K.z), 0);
    r.kingdomOut = 0;
    yield wait(1.0);
    audio.sfx('drain', { pitch: 0.6 });
    audio.playMusic('tension');
    yield all(
      tween(5.0, (k) => { r.kingdomOut = k; }),
      sub((function* (): Script { yield wait(1.8); expr(L, 'pastila', 'scared'); yield say(L, 'pastila', 'Королевство… огни гаснут!', 'scared'); })()),
    );
    r.kingdomOut = 1;
    // [К8] the four jump up
    for (const k of CAST) { const n = cast(L)[k]; n.anim.state = 'hurt'; }
    L.tcam.shake(0.2);
    yield L.shot(V(7.2, C.y + 1.6, C.z - 4.4), V(10.4, C.y + 1.2, C.z - 1.2), 0);
    for (const k of CAST) cast(L)[k].anim.state = 'idle';
    expr(L, 'noki', 'angry');
    yield say(L, 'noki', 'Он мстит. За камень. Домой — бегом!', 'angry');
    audio.duckMusic(1);
    yield wait(0.4);
  } finally {
    // the chapter ends whatever ends this scene (a co-op force-end too)
    if (L.authority && !L.results) L.endLevel();
  }
}

// ───────────────────────── barks during play (8.2.1, 8.2.2) ─────────────────────────
/** the first collapse of the first bridge (every machine) */
export function bridgeBarks(L: Level3D) {
  if (L.refs.f4bridgeBarked) return;
  L.refs.f4bridgeBarked = true;
  barkSeq(L, [[0, 'tosha', LINES4.bridge.tosha], [1.5, 'bublik', LINES4.bridge.bublik], [3.0, 'pastila', LINES4.bridge.pastila]]);
  // v2 8.2.1: once everybody is across — «Бублик, ты герой!»
  const zB = f4(L).bridges[0].zB;
  let t = 0;
  const across: Actor3 = {
    dead: false,
    update(L2, dt) {
      t += dt;
      const hs = L2.alivePlayers();
      if (t > 3.5 && hs.length && hs.every((h) => h.pos.z < zB - 0.8 && h.pos.y > -3)) {
        across.dead = true;
        barkSeq(L2, [[0.2, 'tosha', LINES4.bridgeCrossed.tosha], [2.0, 'bublik', LINES4.bridgeCrossed.bublik]]);
      }
      if (t > 240) across.dead = true;
    },
  };
  L.actors.push(across);
  if ((L.player as unknown as { kind: string }).kind === 'bublik') ambient(L, () => L.toast(LINES4.bridgeToastBublik));
}
/** the swarm wakes (every machine) */
export function swarmBarks(L: Level3D) {
  barkSeq(L, [[0.2, 'noki', LINES4.swarm.noki], [1.8, 'tosha', LINES4.swarm.tosha]]);
  L.toast(LINES4.swarmToast);
}

export const FANGS4_SCRIPTS: Record<string, ScriptFn> = {
  fangs4_cold, fangs4_intro, fangs4_ruins, fangs4_stop, fangs4_v_bridge, fangs4_v_cave, fangs4_v_stairs,
  fangs4_boss_intro, fangs4_boss_retry, fangs4_boss_defeat,
  // the exit (the campfire) plays 8.7, which chains 8.8 (that one ends the chapter)
  exit_fangs4_pass: fangs4_campfire, fangs4_campfire, fangs4_promise,
};

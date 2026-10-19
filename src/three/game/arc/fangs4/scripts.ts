import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { ease } from '../../../../engine/util';
import { all, tween, wait, type Script } from '../../../../game/coroutine';
import { tmat } from '../../../world/kit';
import type { Level3D, Actor3 } from '../../level';
import { vamp, ambient } from '../vampires';
import { say } from './speech';
import { storyCard } from './card';
import { cast, mark, faceTo, hideCast, barkSeq, expr, CAST, type CastKind } from './cast';
import { swarmBatGeo, SISTER_COLOR } from './models';
import { f4, F4 } from './level';
import { LINES4 } from './lines';

/*
 * The scenes of «Чёрный перевал» (docs/script-fangs.md §8). Co-op: the host starts each one (L.run) and every machine
 * plays it with its own camera; lines advance by themselves. World actions (the fight's start, the zone's colour, the
 * level's end) happen where L.authority is true; everything else (the cast on its marks, the camera, the little bats,
 * the stone's glow, the fire) is staged identically on every machine. The players' figures are hidden while the bars
 * are down (castScenes); the story cast — Тоша, Бублик, Ноки, Пастила — acts.
 */

type ScriptFn = (L: Level3D) => Script;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const C = F4.C;

function* chapterTitle(L: Level3D) { L.hud.showChapter(L.def.title, L.def.subtitle); L.bannerShown = true; yield undefined; }
function* end(L: Level3D, d = 0.6): Script {
  yield L.camBack(d);
  hideCast(L);
  L.cutscene(false);
}

/** the four on marks facing yaw (x, z offsets from a centre) */
function four(L: Level3D, y: number, spots: Record<CastKind, [number, number]>, yaw: number) {
  for (const k of CAST) mark(L, k, spots[k][0], y, spots[k][1], yaw);
}
/** Ноки has no shadow (bible §1.7) */
function noShadow(L: Level3D) { cast(L).noki.root.traverse((o) => { o.castShadow = false; }); }

// ───────────────────────── 8.1 fangs4_intro ─────────────────────────
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
  yield say(L, 'noki', 'Мосты тут рушатся. Стаи летают. А на вершине — Солнечный камень.');
  // the castle on the horizon
  yield L.shot(V(0, 1.9, 2.4), V(40, 90, -760), 0);
  yield say(L, 'noki', 'И Сёстры. Пока одна смотрит на вас — вторую не тронуть. Бейте ту, что отвернулась.');
  yield group();
  cast(L).tosha.anim.state = 'cheer';
  yield say(L, 'tosha', 'Значит, разделимся! Одни отвлекают, другие бьют.', 'happy');
  cast(L).tosha.anim.state = 'idle';
  yield say(L, 'pastila', 'Записываю: «Тоша предложил тактику». Исторический момент.', 'sly');
  expr(L, 'tosha', 'angry');
  yield say(L, 'tosha', 'Эй!', 'angry');
  yield* end(L, 0.7);
  yield* chapterTitle(L);
}

// ───────────────────────── 8.2.3 the ruins (bars over the team, no bars) ─────────────────────────
function* fangs4_ruins(L: Level3D): Script {
  barkSeq(L, [[0.3, 'bublik', LINES4.ruins.bublik], [3.0, 'pastila', LINES4.ruins.pastila]]);
  yield undefined;
}

// ───────────────────────── 8.3 fangs4_boss_intro ─────────────────────────
const nochkaShot = (L: Level3D, d = 0) => L.shot(V(-4.6, 21.8, C.z + 3.4), V(-0.9, 21.55, C.z + 2.2), d);
const tenkaShot = (L: Level3D, d = 0) => L.shot(V(4.6, 21.8, C.z + 3.4), V(0.9, 21.55, C.z + 2.2), d);
const sistersShot = (L: Level3D, d = 0) => L.shot(V(0, 22.2, C.z + 9.2), V(0, 21.2, C.z + 1.6), d);
const heroesShot = (L: Level3D, d = 0) => L.shot(V(0.4, 21.4, C.z + 7.6), V(0.4, 20.9, C.z + 12.6), d);

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
    const spots: Record<CastKind, THREE.Vector3> = { bublik: V(-6.6, C.y, C.z + 11.2), tosha: V(6.6, C.y, C.z + 11.2), pastila: V(-10.6, C.y, C.z + 6), noki: V(10.6, C.y, C.z + 6) };
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
  const z = C.z + 12.4;
  four(L, C.y, { tosha: [-1.7, z + 0.2], bublik: [-0.4, z - 0.3], noki: [1.0, z + 0.3], pastila: [2.4, z - 0.1] }, Math.PI);
  yield sistersShot(L);
  yield wait(0.4);
  yield nochkaShot(L, 0.6);
  yield say(L, 'nochka', 'Смотри, сестрица, гости.');
  yield tenkaShot(L);
  yield say(L, 'tenka', 'Вижу, сестрица. Я смотрю в другую сторону — но вижу.');
  yield nochkaShot(L);
  yield say(L, 'nochka', 'Король велел никого не пускать к камню.');
  yield tenkaShot(L);
  yield say(L, 'tenka', 'Король велел — мы не пускаем. Мы послушные.');
  yield heroesShot(L);
  yield say(L, 'bublik', 'Вы всегда разговариваете по очереди?');
  yield sistersShot(L);
  yield say(L, 'nochka', 'Да.');
  yield say(L, 'tenka', 'Нет.');
  yield heroesShot(L);
  yield say(L, 'pastila', 'Нам нужна только щепотка пыли с камня! Одна щепотка!');
  yield sistersShot(L);
  yield say(L, 'tenka', 'Щепотка — это много.');
  yield say(L, 'nochka', 'Щепотка — это всё.');
  yield heroesShot(L);
  expr(L, 'noki', 'angry');
  yield say(L, 'noki', 'Хватит. Разделяемся: одни на Ночку, другие на Теньку.', 'angry');
  yield nochkaShot(L);
  yield say(L, 'nochka', 'Разделитесь?', 'sly');
  yield tenkaShot(L);
  yield say(L, 'tenka', 'Как мило. Мы тоже.', 'sly');
  // a flash: they swap places
  yield sistersShot(L);
  swapFx(L);
  yield wait(0.7);
  L.toast('Пока сестра смотрит на вас, её близняшку не ранить. Отвлекайте одну — бейте другую. Сёстры меняются местами!');
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

// §12: the retry after a team restart / a solo respawn
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

// ───────────────────────── 8.5 fangs4_boss_defeat + 8.6 fangs4_stone ─────────────────────────
function* fangs4_boss_defeat(L: Level3D): Script {
  const r = f4(L), tw = r.twins;
  L.cutscene(true);
  audio.stopMusic(1.2);
  L.seen.add('f4won');
  const a = tw.sister('nochka'), b = tw.sister('tenka');
  const mid = a.pos.clone().lerp(b.pos, 0.5);
  const side = V(-(b.pos.z - a.pos.z), 0, b.pos.x - a.pos.x).normalize();
  if (side.dot(V(mid.x - C.x, 0, mid.z - C.z)) < 0 && mid.distanceTo(C) > 1) side.negate();
  const span = Math.max(4, a.pos.distanceTo(b.pos));
  const camAt = mid.clone().addScaledVector(side, span * 0.75 + 2).setY(C.y + 2.6);
  yield L.shot(camAt, mid.clone().setY(C.y + 1), 0);
  yield say(L, 'nochka', 'Сестрица… мы проиграли?', 'scared');
  yield say(L, 'tenka', 'Не знаю, сестрица. Я смотрела в другую сторону.', 'scared');
  // a double puff: two little bats fly apart, bump into each other, and fly off to the castle together
  const bats = [a, b].map((s) => {
    const m = new THREE.Mesh(swarmBatGeo(), tmat(null, s.kind === 'nochka' ? '#3a2a4e' : '#a678d8', { side: THREE.DoubleSide }));
    m.position.copy(s.pos).setY(s.pos.y + 1); m.scale.setScalar(1.6);
    L.scene.add(m);
    L.fx.emit(m.position.clone(), { count: 30, speed: [2, 6], life: [0.3, 0.7], size: [0.25, 0.5], colors: [SISTER_COLOR[s.kind], '#ffffff', '#2a1a3a'], drag: 3 });
    return m;
  });
  tw.vanishAll();
  audio.sfx('reflect', { pitch: 0.6 }); audio.sfx('batFlap');
  const p0 = bats.map((m) => m.position.clone());
  const out = bats.map((m, i) => m.position.clone().addScaledVector(V(p0[1 - i].x - p0[i].x, 0, p0[1 - i].z - p0[i].z).normalize(), -3).setY(C.y + 3.2));
  const flap = (t: number) => { for (const m of bats) m.scale.set(1.6 * (0.4 + 0.6 * Math.abs(Math.sin(t * 22))), 1.6, 1.6); };
  let ft = 0;
  yield tween(0.8, (k) => { ft += 0.016; flap(ft); bats.forEach((m, i) => m.position.lerpVectors(p0[i], out[i], ease.outCubic(k))); });
  const meet = mid.clone().setY(C.y + 3.6);
  yield tween(0.45, (k) => { ft += 0.016; flap(ft); bats.forEach((m, i) => m.position.lerpVectors(out[i], meet, ease.inCubic(k))); });
  L.fx.stars(meet.clone(), 24); audio.sfx('pogo', { pitch: 1.6 });
  yield say(L, 'nochka', 'Пи!');
  const far = meet.clone().add(V(14, 26, -60));
  yield all(
    say(L, 'tenka', 'Пи-пи!'),
    tween(2.4, (k) => { ft += 0.016; flap(ft); bats.forEach((m, i) => { m.position.lerpVectors(meet, far, ease.inCubic(k)); m.position.x += (i ? 0.4 : -0.4) * (1 - k); m.lookAt(far); }); }),
  );
  for (const m of bats) m.removeFromParent();
  // the stone wakes up warm and yellow; the ruins round it get their colour back
  yield L.shot(V(0, 22.4, C.z + 10.5), V(0, 22.2, C.z), 0);
  if (L.authority) vamp(L).restoreZone('summit');
  audio.sfx('artifact', { pitch: 0.8 });
  yield tween(1.6, (k) => { r.stoneK = k; });
  r.stoneK = 1;
  yield wait(1.2);
  // 8.6 — Пыль солнечного камня
  noShadow(L);
  tw.clearHelpers(L);
  mark(L, 'pastila', 0, C.y, C.z + 1.9, Math.PI, 'lookUp');
  mark(L, 'bublik', -1.6, C.y, C.z + 3.0, Math.PI);
  mark(L, 'tosha', -0.4, C.y, C.z + 4.2, Math.PI);
  mark(L, 'noki', -3.0, C.y, C.z + 2.0, Math.PI);
  faceTo(cast(L).bublik, 0, C.z); faceTo(cast(L).tosha, 0, C.z); faceTo(cast(L).noki, 0, C.z);
  // (on tiptoe, scraping the lens with a spoon)
  let sc = 0;
  const tip = cast(L).pastila;
  const scrape: Actor3 = { dead: false, update: (_L, dt) => { sc += dt; if (tip.anim.state !== 'lookUp') { scrape.dead = true; return; } tip.root.position.y = C.y + 0.12 + Math.abs(Math.sin(sc * 9)) * 0.05; } };
  L.actors.push(scrape);
  yield L.shot(V(3.6, 21.4, C.z + 3.0), V(-0.6, 21.3, C.z + 1.3), 0);
  expr(L, 'pastila', 'happy');
  yield say(L, 'pastila', 'Солнечный камень снова светится! Скребу… осторожно… Есть!', 'happy');
  tip.anim.state = 'cheer'; tip.root.position.y = C.y;
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

// ───────────────────────── 8.7 exit_fangs4_pass — Признание Ноки ─────────────────────────
function* exit_fangs4_pass(L: Level3D): Script {
  const f = F4.fire, r = f4(L);
  L.cutscene(true);
  audio.duckMusic(0.45);
  r.fire.set(true);
  noShadow(L);
  const pas = mark(L, 'pastila', f.x + 1.25, f.y, f.z + 0.3, 0); faceTo(pas, f.x, f.z);
  const to = mark(L, 'tosha', f.x - 1.3, f.y, f.z + 0.9, 0); faceTo(to, f.x, f.z);
  const bu = mark(L, 'bublik', f.x - 1.0, f.y, f.z - 1.2, 0); faceTo(bu, f.x, f.z);
  const no = mark(L, 'noki', f.x + 0.4, f.y + 0.45, f.z - 6.6, Math.PI / 2, 'sit');
  // the pot of syrup on the fire, glowing gold
  const pot = new THREE.Group();
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), tmat(null, '#2a2228', { side: THREE.DoubleSide }));
  const syrup = new THREE.Mesh(new THREE.CircleGeometry(0.42, 16).rotateX(-Math.PI / 2), tmat(null, '#ffc828', { emissive: '#ffa818', emissiveIntensity: 0.9 }));
  bowl.position.y = 0.95; syrup.position.y = 0.94; pot.add(bowl, syrup);
  pot.position.set(f.x, f.y, f.z);
  L.scene.add(pot);
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 0), tmat(null, '#5a5068', { flat: true }));
  rock.position.set(f.x + 0.4, f.y + 0.2, f.z - 6.6); rock.scale.set(1, 0.5, 1);
  L.scene.add(rock);
  pas.anim.attack = { kind: 'flask', p: 0.3 };
  yield L.shot(V(f.x, f.y + 2.3, f.z + 4.8), V(f.x + 0.6, f.y + 0.8, f.z - 4.2), 0);
  yield say(L, 'narrator', 'Ночью у костра Пастила варила сироп. Он пах солнцем и немножко пирогами.');
  pas.anim.attack = null;
  yield L.shot(V(f.x + 1.6, f.y + 1.4, f.z - 2.4), V(f.x - 1.2, f.y + 0.9, f.z + 0.8), 0);
  faceTo(to, no.root.position.x, no.root.position.z);
  yield say(L, 'tosha', 'Ноки… Помнишь, ты сказала «потом»? Уже «потом».');
  // Ноки in profile, the castle behind her
  const nokiShot = () => L.shot(V(f.x + 0.9, f.y + 1.15, f.z - 3.4), V(f.x + 0.9, f.y + 1.75, f.z - 9), 0);
  yield nokiShot();
  yield say(L, 'noki', 'Сто лет назад была прошлая Алая луна. Мне было четырнадцать. Я играла громче всех.', 'sad');
  yield say(L, 'noki', 'Король Полночь пил цвет у моего города. Я вышла против него. Одна. С гитарой.');
  yield say(L, 'noki', 'Мой цвет он выпить не смог — слишком громко я играла. Тогда он забрал мою тень.');
  yield L.shot(V(f.x - 1.6, f.y + 1.3, f.z - 1.8), V(f.x + 1.4, f.y + 0.9, f.z + 0.3), 0);
  yield say(L, 'pastila', 'Его плащ сшит из теней тех, кто ему не поддался. Одна из них — твоя.');
  yield nokiShot();
  yield say(L, 'noki', 'Без тени я застряла посередине. Не взрослею. Не отражаюсь. Солнце жжётся. И клыки выросли.');
  yield L.shot(V(f.x + 1.4, f.y + 1.3, f.z - 2.9), V(f.x - 1.0, f.y + 0.8, f.z - 0.6), 0);
  expr(L, 'bublik', 'sad');
  yield say(L, 'bublik', 'Сто лет без отражения… Ты даже не знаешь, какая ты сейчас?', 'sad');
  expr(L, 'bublik', 'normal');
  yield nokiShot();
  yield say(L, 'noki', 'Помню, какая была. Косички и гитара больше меня.');
  yield L.shot(V(f.x + 1.6, f.y + 1.4, f.z - 2.4), V(f.x - 1.2, f.y + 0.9, f.z + 0.8), 0);
  to.anim.state = 'cheer';
  yield say(L, 'tosha', 'Мы вернём тебе тень. Слово героя!', 'happy');
  to.anim.state = 'idle';
  yield nokiShot();
  yield say(L, 'noki', 'Ты всем это говоришь?', 'sly');
  yield L.shot(V(f.x + 1.6, f.y + 1.4, f.z - 2.4), V(f.x - 1.2, f.y + 0.9, f.z + 0.8), 0);
  yield say(L, 'tosha', 'Только друзьям.');
  pas.anim.state = 'cheer';
  yield L.shot(V(f.x - 1.6, f.y + 1.3, f.z - 1.8), V(f.x + 1.4, f.y + 0.9, f.z + 0.3), 0);
  yield say(L, 'pastila', 'Сироп готов! Солнечный сироп, полный заряд для пушки.', 'happy');
  pas.anim.state = 'idle';
  yield L.shot(V(f.x, f.y + 2.3, f.z + 4.8), V(f.x + 0.6, f.y + 1.6, f.z - 9), 1.2);
  yield say(L, 'noki', 'Завтра — Алая полночь. Завтра — замок.');
  yield storyCard(L, LINES4.cardSyrup, 'syrup');
  audio.duckMusic(1);
  audio.sfx('victory');
  yield wait(0.6);
  if (L.authority) L.endLevel();
}

// ───────────────────────── barks during play (8.2.1, 8.2.2) ─────────────────────────
/** the first collapse of the first bridge (every machine) */
export function bridgeBarks(L: Level3D) {
  if (L.refs.f4bridgeBarked) return;
  L.refs.f4bridgeBarked = true;
  barkSeq(L, [[0, 'tosha', LINES4.bridge.tosha], [1.5, 'bublik', LINES4.bridge.bublik], [3.0, 'pastila', LINES4.bridge.pastila]]);
  if ((L.player as unknown as { kind: string }).kind === 'bublik') ambient(L, () => L.toast(LINES4.bridgeToastBublik));
}
/** the swarm wakes (every machine) */
export function swarmBarks(L: Level3D) {
  barkSeq(L, [[0.2, 'noki', LINES4.swarm.noki], [1.8, 'tosha', LINES4.swarm.tosha]]);
  L.toast(LINES4.swarmToast);
}

export const FANGS4_SCRIPTS: Record<string, ScriptFn> = {
  fangs4_intro, fangs4_ruins, fangs4_boss_intro, fangs4_boss_retry, fangs4_boss_defeat, exit_fangs4_pass,
};

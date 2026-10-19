import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { ease } from '../../../../engine/util';
import { wait, tween, all, until, type Script, type Waiter } from '../../../../game/coroutine';
import { glyphLabel } from '../../../../ui/glyphs';
import { createBat } from '../vampires/models';
import { ambient } from '../vampires/fxUtil';
import type { Level3D } from '../../level';
import { Garden, MARKS, LEVEL_ID } from './level';
import { Cast, CAST, slotOf, type CastKind } from './cast';
import { say, shepotSeen } from './speech';
import { Shepot3, ARENA } from './boss';
import { showCard } from './card';
import { BANNER, TOAST, RETRY } from './lines';

/*
 * The scenes of «Стеклянная оранжерея» (docs/script-fangs.md §7). Co-op: the host runs them (L.run) and every
 * machine plays them with its own camera; lines advance by themselves (≤ 14 a scene: the 120 s watchdog). The
 * canonical four stand on their marks (castScenes), the players' figures are hidden while the bars are down.
 * World actions (boss.start, zone restores, the next scene) happen only where L.authority is true.
 */

type ScriptFn = (L: Level3D) => Script;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const G = (L: Level3D) => L.refs.garden as Garden;

function marks(c: Cast, set: Record<CastKind, readonly [number, number, number]>, y = 0) {
  for (const k of CAST) { const [x, z, yaw] = set[k]; c.place(k, x, y, z, yaw); }
}
/** a shot of a cast member's face from in front of them (d m away, a little to the side) */
function face(L: Level3D, c: Cast, k: CastKind, d = 2.4, side = 0.5, up = 0.25): Waiter {
  const r = c.figs[k].root;
  const f = V(Math.sin(r.rotation.y), 0, Math.cos(r.rotation.y));
  const h = c.head(k);
  const pos = h.clone().addScaledVector(f, d).add(V(-f.z * side, up, f.x * side));
  return L.shot(pos, h, 0.7);
}
function stageOn(L: Level3D) { L.cutscene(true); G(L).cast.show(true); }
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
  // ───────────── 7.1 fangs3_intro — Сад прабабушки Карамели ─────────────
  *fangs3_intro(L) {
    const g = G(L), c = g.cast;
    stageOn(L);
    marks(c, MARKS.intro);
    L.hud.showBanner(BANNER, '#d8c8ff');
    // into the garden, toward the big dome far away
    yield L.shot(V(5, 7, 72), V(-1, 3.5, 20), 0);
    yield all(L.shot(V(2.4, 4.6, 66), V(0, 4.5, 10), 3.2), say(L, 'narrator', 'Третья ночь. Луна — как спелая вишня. Отряд вошёл в Стеклянную оранжерею.'));
    c.expr('pastila', 'sad');
    yield face(L, c, 'pastila', 2.5, 0.6);
    yield say(L, 'pastila', 'Её построила моя прапрабабушка Карамель. Тут росли все растения Хрумляндии.', 'sad');
    c.expr('pastila', 'normal');
    yield face(L, c, 'tosha', 2.5, -0.5);
    yield say(L, 'tosha', 'А теперь тут пусто. И всё стеклянное. И трескается.');
    // someone whispers right behind Бублик's ear — nobody there
    c.expr('bublik', 'scared');
    yield face(L, c, 'bublik', 2.0, 0.3, 0.1);
    yield say(L, 'bublik', 'Тоша, кто-то шепчет. Прямо у меня за ухом.', 'scared');
    const ear = c.pos('bublik').clone().add(V(0.6, 0.6, 0.8));
    g.whispers.say(ear, '…ш-ш-ш…', 3.5);
    yield L.shot(c.pos('bublik').clone().add(V(-0.6, 1.0, -2.0)), ear, 0.6);
    yield say(L, 'shepot', '…ш-ш-ш… гости… тёплые… цветные… ш-ш-ш…');
    c.expr('bublik', 'normal');
    c.look('noki', ear);
    yield face(L, c, 'noki', 2.4, -0.6);
    yield say(L, 'noki', 'Шёпот. Он рядом. Он всегда рядом.');
    c.look('noki', null);
    yield L.shot(V(1, 2.6, 53.2), V(0.8, 1.2, 59), 0.8);
    yield say(L, 'pastila', 'Корень полуденника — в центре, под большим куполом. Но он цветёт только в полдень.');
    yield say(L, 'bublik', 'А сейчас полночь. Подождём двенадцать часов?');
    yield face(L, c, 'noki', 2.4, -0.6);
    yield say(L, 'noki', 'У нас нет двенадцати часов. У нас две ночи.');
    yield face(L, c, 'pastila', 2.6, 0.7);
    yield say(L, 'pastila', 'Тогда сделаем полдень. Зеркала сада ловят свет. Направим их на купол — и будет солнце!');
    c.pose('tosha', 'cheer', 'happy');
    yield face(L, c, 'tosha', 2.6, -0.4);
    yield say(L, 'tosha', 'Солнце посреди ночи? Это по-нашему!', 'happy');
    c.pose('tosha', 'idle');
    yield L.shot(V(1, 2.6, 53.2), V(0.8, 1.2, 59), 0.6);
    yield say(L, 'pastila', 'Помните: невидимку видно в зеркалах, на пыльце и в свете маяка.');
    stageOff(L);
    yield L.camBack(0.7);
    L.cutscene(false);
    L.hud.showChapter(L.def.title, L.def.subtitle);
    L.bannerShown = true;
    L.hud.toast(TOAST.intro, 7);
  },

  // ───────────── 7.2.1 fangs3_mirror — the first mirror: the grey bed blooms ─────────────
  *fangs3_mirror(L) {
    const g = G(L), c = g.cast;
    stageOn(L);
    marks(c, MARKS.mirror);
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

  // ───────────── 7.3 fangs3_boss_intro — Искусственный полдень ─────────────
  *fangs3_boss_intro(L) {
    const g = G(L), c = g.cast, b = g.boss!;
    const C = ARENA.c;
    stageOn(L);
    marks(c, MARKS.bed);
    audio.playMusic('tension');
    for (const k of CAST) c.look(k, V(C.x, 1, C.z));
    // the bud between three beams, the light of a made noon
    yield L.shot(V(C.x + 4.5, 2.6, C.z + 5.5), g.bud.top, 0);
    g.bud.open = 0.5;
    yield wait(0.6);
    c.pose('pastila', 'cheer', 'happy');
    yield all(L.shot(V(C.x + 3, 2.0, C.z + 3.4), g.bud.top, 1.2), say(L, 'pastila', 'Полдень! Искусственный, но настоящий. Корень раскрывается!', 'happy'));
    c.pose('pastila', 'idle', 'surprised');
    // the light blinks — something invisible in the beam
    for (let i = 0; i < 3; i++) { g.bud.open = 0.1; L.whiteFlash = 0.15; yield wait(0.18); g.bud.open = 0.5; yield wait(0.22); }
    yield L.shot(V(C.x - 5, 3.0, C.z - 1), V(C.x + 2, 1.6, C.z - 6), 0.8);
    g.whispers.say(V(C.x + 3, 1.6, C.z - 7), '…НЕТ…', 3);
    yield say(L, 'shepot', '…НЕТ… ш-ш-ш… свет… больно… гасите…', 'angry');
    c.expr('tosha', 'angry');
    yield face(L, c, 'tosha', 2.6, -0.5);
    yield say(L, 'tosha', 'Покажись! Нечестно драться невидимкой!', 'angry');
    g.whispers.say(V(C.x - 6, 1.6, C.z + 2), '…честно?..', 3);
    yield L.shot(V(C.x + 1, 2.2, C.z + 9), V(C.x - 6, 1.6, C.z + 2), 0.7);
    yield say(L, 'shepot', '…честно?.. сто лет я никому не показывался… я забыл, какой я…');
    yield face(L, c, 'noki', 2.4, -0.6);
    yield say(L, 'noki', 'Он прятался так долго, что исчез совсем. Аккорд его проявит.');
    yield face(L, c, 'pastila', 2.4, 0.6);
    yield say(L, 'pastila', 'А маяк подержит видимым. Не дайте ему погасить зеркала!');
    g.whispers.say(V(C.x + 7, 1.6, C.z + 3), '…ш-ш-ш…', 3);
    yield L.shot(V(C.x, 6, C.z + 13), V(C.x, 1, C.z - 4), 1.0);
    yield say(L, 'shepot', '…ш-ш-ш… тогда я заберу ваши цвета… и вас тоже никто не увидит…');
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

  // ───────────── 7.5 fangs3_boss_defeat — Каким был Шёпот ─────────────
  *fangs3_boss_defeat(L) {
    const g = G(L), c = g.cast, b = g.boss!;
    const C = ARENA.c;
    stageOn(L);
    L.hud.toasts.length = 0; // (the fight's hints would sit right over his face)
    L.seen.add('f3:won');
    g.won = true;
    L.hud.bossMax = 0;
    audio.stopMusic(1.2);
    marks(c, MARKS.bed);
    // in the beacon's light he stays visible for good: a little, skinny, eared vampire in a huge cloak
    const seat = V(C.x, 0.7, C.z + 2.35);
    b.pos.copy(seat); b.yaw = 0; b.visGoal = 1; b.vis = 1;
    b.anim.small = 1; b.anim.hide = 1;
    shepotSeen(L, true);
    for (const k of CAST) c.look(k, seat);
    g.V.light(V(C.x - 3.4, 0, C.z + 1.2), { r: 4.5, secs: 16 });
    // a low shot, at his height
    yield L.shot(V(C.x + 0.4, 1.0, C.z + 5.6), seat.clone().setY(1.2), 0);
    yield wait(0.5);
    yield say(L, 'shepot', '…не смотрите на меня… я страшный…', 'scared');
    c.expr('bublik', 'surprised');
    yield face(L, c, 'bublik', 1.8, 0.4, 0.05);
    yield say(L, 'bublik', 'Ты… маленький. И ушастый. Как я!', 'surprised');
    c.expr('bublik', 'happy');
    yield L.shot(V(C.x - 0.6, 1.1, C.z + 4.9), seat.clone().setY(1.25), 0.6);
    b.anim.hide = 0.3;
    yield say(L, 'shepot', '…правда?.. сто лет меня никто не видел… а я, оказывается… ушастый…', 'sad');
    // пуф — a little bat; it flies up, looks back
    b.anim.hide = 0;
    ambient(L, () => {
      L.fx.emit(seat.clone().setY(1.2), { count: 30, speed: [1, 4], dir: V(0, 1, 0), spread: 0.9, life: [0.5, 1.1], size: [0.2, 0.42], size2: 1.8, colors: ['#4a3a66', '#2b2140', '#8a7ab0'], g: -1, drag: 2 });
      L.fx.stars(seat.clone().setY(1.2), 12, ['#ffe14a', '#ffffff']);
      audio.sfx('batScreech', { pitch: 1.8, volume: 0.35 });
    });
    b.gone = true; b.active = false;
    const bat = createBat();
    const br = new THREE.Group(); br.add(bat.root); br.scale.setScalar(0.7); br.position.copy(seat).setY(1.3);
    L.scene.add(br);
    const fly = (k: number) => { br.position.y = 1.3 + k * 1.6; br.rotation.y = Math.PI; bat.update(0.016, { st: 'fly', p: 0, speed: 0, flash: 0 }); };
    yield tween(0.8, fly, ease.outCubic);
    br.rotation.y = 0;
    yield L.shot(V(C.x + 0.2, 2.6, C.z + 4.6), br.position, 0.4);
    yield say(L, 'shepot', '…пи… спасибо, что посмотрели… пи…');
    // off to the castle; colour flows back over the garden, the crystal rings
    const from = br.position.clone(), to = V(C.x + 60, 30, C.z - 120);
    yield all(L.shot(V(C.x, 3, C.z + 8), V(C.x + 6, 6, C.z - 10), 1.6), tween(1.8, (k) => { br.position.lerpVectors(from, to, k); br.rotation.y = Math.atan2(to.x - from.x, to.z - from.z); bat.update(0.016, { st: 'fly', p: 0, speed: 0, flash: 0 }); br.scale.setScalar(0.7 * (1 - k * 0.7)); }));
    L.scene.remove(br);
    if (L.authority) { g.V.restoreZone('dome'); g.V.restoreZone('wing'); g.V.restoreZone('court'); }
    ambient(L, () => { audio.sfx('colorRestore', { pitch: 0.7 }); audio.sfx('reflect', { pitch: 0.6, volume: 0.8 }); L.fx.ring(C.clone().setY(0.3), 19, '#ffe9a0', 1.2); });
    yield L.shot(V(C.x - 9, 5, C.z + 12), V(C.x, 3, C.z - 4), 1.4);
    yield wait(1.0);
    shepotSeen(L, false);
    if (L.authority) L.runGen((function* (): Script { yield wait(0.05); L.run('fangs3_ending'); })());
    yield wait(0.1);
  },

  // ───────────── 7.6 fangs3_ending — Корень полуденника ─────────────
  *fangs3_ending(L) {
    const g = G(L), c = g.cast;
    const C = ARENA.c;
    stageOn(L);
    marks(c, MARKS.bed);
    c.place('pastila', C.x + 0.5, 0, C.z + 3.0, Math.PI);
    for (const k of CAST) c.look(k, V(C.x, 1, C.z));
    g.bud.open = 1;
    audio.playMusic('garden');
    yield L.shot(V(C.x + 2.4, 2.2, C.z + 4.8), g.bud.top, 0.9);
    c.pose('pastila', 'cheer', 'happy');
    yield say(L, 'pastila', 'Корень полуденника! Тёплый, как сковородка. Аккуратно, не уроните!', 'happy');
    c.pose('pastila', 'idle', 'happy');
    yield showCard(L);
    yield face(L, c, 'bublik', 2.0, 0.4, 0.05);
    yield say(L, 'bublik', 'Пахнет летним полднем. С пирожками.');
    g.bud.open = 0.6; // the made noon fades
    yield face(L, c, 'pastila', 2.4, 0.5);
    yield say(L, 'pastila', 'Прабабушка вывела его, чтобы зимой было солнце. А пригодился против луны.');
    c.pose('tosha', 'cheer', 'happy');
    yield face(L, c, 'tosha', 2.4, -0.5);
    yield say(L, 'tosha', 'Две колбы! Осталась одна!', 'happy');
    c.pose('tosha', 'idle');
    yield face(L, c, 'pastila', 2.4, 0.5);
    yield say(L, 'pastila', 'Пыль солнечного камня. Камень стоит на Чёрном перевале. По дороге к замку.');
    c.expr('noki', 'sad');
    yield face(L, c, 'noki', 2.4, -0.6);
    yield say(L, 'noki', 'По дороге к замку… Значит, скоро.', 'sad');
    c.look('tosha', c.pos('noki'));
    yield face(L, c, 'tosha', 2.4, -0.5);
    yield say(L, 'tosha', 'Ноки, ты чего?');
    c.expr('noki', 'normal');
    yield face(L, c, 'noki', 2.4, -0.6);
    yield say(L, 'noki', 'На перевале стерегут Сёстры Близняшки. Ночка и Тенька. Никогда не смотрят в одну сторону.');
    c.expr('bublik', 'happy');
    yield face(L, c, 'bublik', 2.0, 0.4, 0.05);
    yield say(L, 'bublik', 'Это как я и мой хвост.', 'happy');
    yield face(L, c, 'noki', 2.4, -0.6);
    yield say(L, 'noki', 'Почти. Только хвост не кусается.', 'sly');
    yield L.shot(V(C.x + 0.5, 2.6, C.z + 7.5), V(C.x, 1.2, C.z), 0.7);
    yield say(L, 'pastila', 'Осталось две ночи. Луна почти алая.');
    // the last shot: Ноки looks at the far castle
    const castle = V(150, 20, -360);
    c.look('noki', castle);
    const np = c.pos('noki');
    const dir = castle.clone().sub(np).setY(0).normalize();
    yield L.shot(np.clone().addScaledVector(dir, -2.6).setY(1.9).add(V(-dir.z * 0.8, 0, dir.x * 0.8)), np.clone().addScaledVector(dir, 30).setY(9), 1.6);
    yield wait(1.6);
    for (const k of CAST) { c.look(k, null); c.expr(k, 'normal'); }
    openExit(L);
    stageOff(L);
    gather(L, C.x, C.z - 12, 3, 0); // north of the bed, facing the open door out
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
  const b = new Shepot3(L, { lanterns: g.arenaLanterns, mirrors: g.arenaMirrors, flowers: g.arenaFlowers, feet: g.feet, whispers: g.whispers });
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

import * as THREE from 'three';
import { audio } from '../../../../engine/audio';
import { ease, lerp } from '../../../../engine/util';
import { net } from '../../../../net/session';
import { Script, Waiter, wait, tween, all, until } from '../../../../game/coroutine';
import { createHeroModel } from '../../../models/heroes';
import type { HeroAnim } from '../../../models/hero';
import { makeBlob } from '../../../fx';
import { basic, noOutline } from '../../../gfx';
import { glowTex } from '../../../world/textures';
import type { Level3D, Npc3 } from '../../level';
import { vamp, createBat, type VAnim } from '../vampires';
import { say } from './speech';
import { ingredientCard } from './card';
import { createKamysh, createLilyBoat, createCrow } from './models';
import { swampOf, showCastSolo, afterVictory, openExit, MARK } from './level';
import { ARENA } from './boss';
import { TOASTS, MOROK, CARD, DEATH } from './lines';

/*
 * Story scenes of «Туманные топи» (docs/script-fangs.md §6). Co-op: the host runs them (L.run) and every machine plays
 * them with its own camera; lines advance by themselves. World actions (the fight's start, the end of the level) only
 * where L.authority. While the bars are down the story four (L.npc cast) act and the players' figures are hidden
 * (`castScenes`). Every wait on something of mine is capped, so nobody holds the shared scene.
 */

type Kind = 'tosha' | 'bublik' | 'noki' | 'pastila';
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const untilOr = (cond: () => boolean, max: number): Waiter => { let t = 0; return { update: (dt) => (t += dt) >= max || cond() }; };

function cast(L: Level3D) { return swampOf(L)!.cast; }
/** put the four on their marks (others hidden), facing (fx, fz) or a point */
function stage(L: Level3D, spots: Partial<Record<Kind, [number, number, number]>>, look?: THREE.Vector3) {
  const c = cast(L);
  for (const k of ['tosha', 'bublik', 'noki', 'pastila'] as Kind[]) {
    const n = c[k], s = spots[k];
    n.root.visible = !!s;
    if (!s) continue;
    n.root.position.set(s[0], s[1], s[2]);
    if (look) n.root.rotation.y = Math.atan2(look.x - s[0], look.z - s[2]);
    an(n).state = 'idle'; an(n).expr = 'normal'; an(n).attack = null;
  }
}
const an = (n: Npc3) => n.anim as HeroAnim;
function hideCast(L: Level3D) { for (const n of Object.values(cast(L))) n.root.visible = false; }
function faceTo(n: Npc3, p: THREE.Vector3) { n.root.rotation.y = Math.atan2(p.x - n.root.position.x, p.z - n.root.position.z); }
const at = (n: Npc3, dx: number, dy: number, dz: number) => n.root.position.clone().add(V(dx, dy, dz));

/** my place in the team (co-op: by sorted member id) */
function slot(L: Level3D) { return L.nl ? Math.max(0, [...net.members.keys()].sort().indexOf(net.myId)) : 0; }
/** MY hero onto his spot of a little formation around (x, z) facing yaw (friends see a jump, not a slide) */
function placeMe(L: Level3D, x: number, y: number, z: number, yaw: number) {
  const p = L.player;
  if (p.dead) return;
  const OFF: [number, number][] = [[0, 0], [1.5, 0], [-1.5, 0], [0.75, 1.4], [-0.75, 1.4], [2.25, 1.4]];
  const [a, b] = OFF[slot(L) % OFF.length];
  const sx = Math.cos(yaw), sz = -Math.sin(yaw), fx = Math.sin(yaw), fz = Math.cos(yaw);
  const px = x + sx * a - fx * b, pz = z + sz * a - fz * b;
  const gy = L.phys.groundAt(px, pz, y + 1.5, 0.2);
  L.teleportMe(V(px, (gy > y - 2 ? gy : y) + 0.05, pz), yaw);
}

/** the fight is on (every machine): the boss, its camera, solo — the four by the rail */
function fightOn(L: Level3D) {
  const R = swampOf(L)!;
  L.boss = R.boss;
  L.camModeDefault = 'boss';
  L.tcam.bossPoint = V(ARENA.cx, ARENA.y + 2, ARENA.cz);
  L.def.deathText = DEATH.boss;
  if (L.nl) hideCast(L); else showCastSolo(L);
  audio.playMusic('vampire_boss');
}

const SCRIPTS: Record<string, (L: Level3D) => Script> = {
  // ─────────────────────── 6.1 Топи без светлячков ───────────────────────
  *fangs2_intro(L) {
    const c = cast(L);
    L.cutscene(true);
    placeMe(L, MARK.spawn.x, MARK.spawn.y, MARK.spawn.z, Math.PI);
    const boatTo = V(-6.6, 0, 62.6);
    stage(L, { tosha: [-3.0, 1, 63.6], bublik: [-3.5, 1, 61.8], pastila: [-1.6, 1, 60.4], noki: [-1.2, 1, 64.8] }, V(-8, 1, 62.4));
    // Камыш's lily boat, out of the mist
    const boat = new THREE.Group();
    boat.add(createLilyBoat(1.6));
    const kam = createKamysh();
    kam.root.rotation.y = Math.PI / 2;
    boat.add(kam.root);
    const lantern = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#8a8a70', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.15 }));
    lantern.position.set(0.6, 2.1, 0.2); lantern.scale.setScalar(0.8); noOutline(lantern); boat.add(lantern);
    boat.position.set(-24, -0.1, 78);
    L.scene.add(boat);
    let talkK = 0;
    const kamT = (dt: number) => { talkK = L.dialog.active && L.dialog.who === 'narrator' && L.dialog.shown < L.dialog.str.length ? Math.abs(Math.sin(L.t * 14)) : 0; kam.update(dt, talkK, boat.userData.moving ? 'pole' : 'idle'); };
    L.updaters.push((_t, dt) => kamT(dt));
    try {
      yield L.shot(V(7, 5.5, 76), V(-6, 1.2, 56), 0);
      yield all(L.shot(V(5, 3.6, 70), V(-5, 1.6, 58), 3.2), say(L, 'narrator', 'Вторая ночь. Луна стала краснее. Отряд дошёл до Туманных топей.'));
      yield L.shot(at(c.bublik, 1.6, 1.1, 2.6), at(c.bublik, 0, 0.6, 0), 0.6);
      an(c.bublik).expr = 'scared';
      yield say(L, 'bublik', 'Тут сыро, темно и пахнет старыми носками.', 'scared');
      an(c.bublik).expr = 'normal';
      yield L.shot(at(c.pastila, 1.8, 1.4, 1.6), at(c.pastila, -0.4, 1.0, 0), 0.6);
      yield say(L, 'pastila', 'Это болотный газ. Ничего не поджигайте.');
      yield L.shot(V(2.5, 2.8, 67.5), V(-3, 1.2, 61), 0.7);
      yield say(L, 'tosha', 'А где светлячки? Пастила говорила, тут их тысячи.');
      // the boat glides in
      boat.userData.moving = true;
      const from = boat.position.clone();
      yield all(
        L.shot(V(-3, 2.6, 68), V(-10, 0.8, 64), 1.2),
        tween(3.6, (k) => { boat.position.lerpVectors(from, boatTo, k); boat.rotation.y = lerp(-0.9, 0, k); }, ease.outCubic),
      );
      boat.userData.moving = false;
      yield L.shot(V(-4.8, 1.2, 62.5), V(-6.7, 1.1, 62.7), 0.6);
      yield say(L, 'kamysh', 'Были тысячи. Ква. Мадам Морок переловила их всех. В банки.', 'sad');
      yield say(L, 'kamysh', 'Я Камыш, паромщик. Без светлячков в тумане не видать ни дороги, ни упырей.');
      yield L.shot(at(c.noki, 2.2, 1.3, 1.2), at(c.noki, -0.6, 1.1, 0), 0.6);
      yield say(L, 'noki', 'Морок держит их в своём доме на сваях. Посреди топи.');
      yield L.shot(V(-4.8, 1.2, 62.5), V(-6.7, 1.1, 62.7), 0.5);
      yield say(L, 'kamysh', 'И Матушку Светлячиху тоже. Она самая большая. Самая яркая. Самая… ква… грустная.');
      an(c.pastila).state = 'cheer'; an(c.pastila).expr = 'happy';
      yield L.shot(at(c.pastila, 1.8, 1.4, 1.6), at(c.pastila, -0.4, 1.0, 0), 0.5);
      yield say(L, 'pastila', 'Слеза светлячка! Освободим Матушку — она заплачет от радости. Вот наш ингредиент!', 'happy');
      an(c.pastila).state = 'idle'; an(c.pastila).expr = 'normal';
      yield L.shot(V(-0.5, 2.2, 64.5), V(-3.2, 1.0, 61.2), 0.5);
      yield say(L, 'bublik', 'А если не заплачет?');
      yield say(L, 'pastila', 'Будем щекотать.');
      yield L.shot(V(-4.8, 1.2, 62.5), V(-6.7, 1.1, 62.7), 0.5);
      yield say(L, 'kamysh', 'Садитесь на кувшинки. И не верьте огонькам в тумане. Они врут.');
      // the far stilt house with its dim jars, deep in the fog
      yield all(L.shot(V(-1, 3.0, 58), V(-24, 3.2, 31), 1.4), say(L, 'noki', 'И друг другу не верьте. Морок может стать любым из нас.'));
      yield wait(0.4);
      // Камыш pushes off toward his ferry
      boat.userData.moving = true;
      const b0 = boat.position.clone();
      tweenOn(L, 6, (k) => { boat.position.lerpVectors(b0, V(-18, -0.1, 40), k); boat.rotation.y = -2.6; }, () => boat.removeFromParent());
    } finally {
      hideCast(L);
    }
    yield L.camBack(0.7);
    L.cutscene(false);
    L.hud.showChapter(L.def.title, L.def.subtitle);
    L.bannerShown = true;
    L.hud.toast(TOASTS.intro, 6);
  },

  // ─────────────────────── 6.2.2 Фальшивый Бублик ───────────────────────
  *fangs2_fake(L) {
    const c = cast(L);
    L.cutscene(true);
    const hum = MARK.fakeHummock;
    // (Бублик clear of the launch step's box, x −4.6…−3.6, z −130.6…−129.6: it is hidden for the scene but still solid)
    stage(L, { tosha: [-2.2, 0.7, -130.0], bublik: [-3.4, 0.7, -131.0], pastila: [-1.0, 0.7, -131.4], noki: [-4.9, 0.7, -131.9] }, hum);
    // the fake Бублик on the hummock: no shadow at all
    const fake = createHeroModel('bublik');
    fake.root.traverse((o) => { o.castShadow = false; });
    const fg = new THREE.Group(); fg.add(fake.root);
    fg.position.copy(hum); fg.rotation.y = Math.atan2(c.bublik.root.position.x - hum.x, c.bublik.root.position.z - hum.z);
    L.scene.add(fg);
    const fa: HeroAnim = { state: 'wave', speed: 0, attack: null, weapon: 'none', flash: 0, talk: 0, expr: 'happy', squash: 1 };
    let fakeTalk = false, alive = true;
    const upd = (_t: number, dt: number) => {
      if (!alive) return;
      fa.talk = fakeTalk && L.dialog.shown < L.dialog.str.length ? Math.abs(Math.sin(L.t * 16)) : 0;
      if (fakeTalk) c.bublik.talk = 0;
      fake.update(dt, fa);
    };
    L.updaters.push(upd);
    const crows: { g: THREE.Group; r: ReturnType<typeof createCrow>; v: THREE.Vector3 }[] = [];
    // (Ноки's launch stump stands in the way of these shots: out of the picture while the scene plays)
    const props = (L.refs.f2stump as THREE.Object3D[] | undefined) ?? [];
    for (const o of props) o.visible = false;
    try {
      yield L.shot(V(-0.5, 3.6, -127.4), V(-7, 1.0, -133.5), 0);
      yield wait(0.5);
      // two Бублики in one shot
      yield L.shot(V(-1.0, 3.4, -127.6), V(-7.5, 0.9, -133.8), 0.6);
      fakeTalk = true;
      yield say(L, 'bublik', 'Ребята! Сюда! Тут короткая дорога!', 'happy');
      fakeTalk = false;
      an(c.bublik).expr = 'surprised';
      yield L.shot(at(c.bublik, 1.4, 1.0, 2.2), at(c.bublik, 0, 0.5, 0), 0.5);
      yield say(L, 'bublik', 'Э-э… Это я. Но я — тут.', 'surprised');
      an(c.bublik).expr = 'normal';
      // close on the hummock: the moonlight, the grass — and no shadow
      yield L.shot(V(hum.x + 2.6, 2.4, hum.z + 2.2), V(hum.x, 0.6, hum.z), 0.7);
      yield say(L, 'pastila', 'Смотрите на кочку. У него нет тени!');
      // it giggles in somebody else's voice and bursts into crows
      fa.state = 'cheer';
      audio.sfx('batScreech', { pitch: 0.7, volume: 0.6 });
      yield wait(0.4);
      alive = false;
      fg.removeFromParent(); fake.dispose();
      L.fx.emit(hum.clone().setY(hum.y + 0.8), { count: 40, speed: [2, 6], life: [0.5, 1.1], size: [0.15, 0.3], colors: ['#16121c', '#3a2a48', '#6a2a8a'], drag: 2, g: -1 });
      audio.sfx('batFlap', { pitch: 0.8 });
      for (let i = 0; i < 9; i++) {
        const r = createCrow(i === 0);
        const g = new THREE.Group(); g.add(r.root); g.position.copy(hum).setY(hum.y + 0.8);
        L.scene.add(g);
        const a = (i / 9) * Math.PI * 2;
        crows.push({ g, r, v: V(Math.cos(a) * 3, 3 + (i % 3), Math.sin(a) * 3 - 2) });
      }
      const fly = (dt: number) => { for (const k of crows) { k.g.position.addScaledVector(k.v, dt); k.g.rotation.y = Math.atan2(k.v.x, k.v.z); k.r.update(dt, { st: 'fly', p: 0, flash: 0, talk: 0, speed: 0 }); } };
      const flyW = (d: number): Waiter => { let t = 0; return { update: (dt) => { fly(dt); return (t += dt) >= d; } }; };
      yield all(L.shot(V(hum.x + 3, 3.2, hum.z + 5), V(hum.x - 1, 4.5, hum.z - 4), 1.0), flyW(1.0));
      yield all(say(L, 'morok', 'Хи-хи… Догадливые. Посмотрим, как вы угадаете у меня дома, дорогуши.', 'sly'), flyW(0.01));
      for (const k of crows) k.g.removeFromParent();
      crows.length = 0;
      yield L.shot(at(c.tosha, 1.4, 1.2, 2.0), at(c.tosha, 0, 0.8, 0), 0.5);
      yield say(L, 'tosha', 'У копии нет тени. Запомнили!');
      // …and Ноки has none either
      faceTo(c.pastila, c.noki.root.position);
      yield L.shot(at(c.noki, 2.2, 1.6, 1.4), at(c.noki, -0.4, 0.4, 0), 0.6);
      yield say(L, 'pastila', 'Стойте… Ноки, у тебя ведь тоже нет тени.', 'surprised');
      an(c.noki).expr = 'angry';
      yield say(L, 'noki', 'Я знаю. Я сто лет это знаю.', 'angry');
      faceTo(c.tosha, c.noki.root.position);
      yield L.shot(V(-1.0, 2.0, -127.6), V(-3.5, 1.0, -131.4), 0.5);
      yield say(L, 'tosha', 'Мы тебе верим! …Да?');
      an(c.noki).expr = 'normal';
      yield say(L, 'noki', 'Проверите в бою.');
    } finally {
      alive = false;
      for (const o of props) o.visible = true;
      fg.removeFromParent();
      for (const k of crows) k.g.removeFromParent();
      const i = L.updaters.indexOf(upd); if (i >= 0) L.updaters.splice(i, 1);
      hideCast(L);
    }
    yield L.camBack(0.6);
    L.cutscene(false);
  },

  // ─────────────────────── 6.3 Дом Мадам Морок ───────────────────────
  *fangs2_boss_intro(L) {
    const R = swampOf(L)!;
    const c = cast(L), boss = R.boss;
    L.cutscene(true);
    audio.stopMusic(1);
    placeMe(L, MARK.veranda.x, MARK.veranda.y, MARK.veranda.z, Math.PI);
    stage(L, { tosha: [-7.2, ARENA.y, -155.4], bublik: [-8.9, ARENA.y, -155.8], pastila: [-5.8, ARENA.y, -156.3], noki: [-10.2, ARENA.y, -156.1] }, MARK.chair);
    const chairLook = MARK.chair.clone().setY(ARENA.y + 1.4);
    try {
      // the jars and the bottle through the doorway
      yield L.shot(V(-8, 3.0, -158.5), V(-8, 3.2, -174.5), 0);
      yield wait(1.0);
      yield L.shot(V(-6.4, 2.6, -161.6), chairLook, 1.0);
      boss.talk = 1;
      yield say(L, 'morok', 'Гости! Как мило. Вытирайте лапки — у меня чисто. Почти.', 'sly');
      yield L.shot(at(c.pastila, 1.6, 1.5, 2.2), at(c.pastila, -0.6, 1.0, -2), 0.5);
      yield say(L, 'pastila', 'Отпустите светлячков! Без них болото погаснет!', 'angry');
      yield L.shot(V(-6.4, 2.6, -161.6), chairLook, 0.5);
      yield say(L, 'morok', 'Погаснет? Ну что вы. Оно станет красиво-серым. Как я люблю.');
      yield L.shot(at(c.bublik, 1.5, 1.0, 2.2), at(c.bublik, 0, 0.5, -1), 0.5);
      yield say(L, 'bublik', 'А вы вообще кто? Ведьма? Вампир? Тётя?');
      yield L.shot(V(-6.4, 2.6, -161.6), chairLook, 0.5);
      yield say(L, 'morok', 'Всё сразу, пончик. Мадам Морок. Сейчас я — это я. А через минуту — кто угодно.');
      yield L.shot(at(c.noki, 1.8, 1.4, 1.8), at(c.noki, -0.2, 1.0, -2), 0.5);
      yield say(L, 'noki', 'Она оборотень. Волк, жаба, вороны… и любой из нас.');
      // Ноки and Морок, face to face
      yield L.shot(V(1.5, 3.0, -160.5), V(-9, 1.6, -161), 0.7);
      yield say(L, 'morok', 'Ноки, дорогуша! Всё ещё без тени? Тебя я копировать не буду — сама запутаешься.', 'sly');
      an(c.tosha).expr = 'angry';
      yield L.shot(at(c.tosha, 1.5, 1.3, 2.2), at(c.tosha, 0, 0.9, -1), 0.5);
      yield say(L, 'tosha', 'Хватит болтать! Матушку Светлячиху — на свободу!', 'angry');
      // she stands up out of the rocking chair
      yield L.shot(V(-8, 2.4, -158.8), chairLook, 0.6);
      boss.form = 'lady'; boss.act = 'taunt';
      boss.pos.copy(MARK.chair).add(V(0, 0, 1.2));
      yield say(L, 'morok', 'Ах так? Тогда угадайте… кто из вас — я!', 'sly');
      L.fx.emit(boss.center(), { count: 34, speed: [1.5, 5], life: [0.4, 1.0], size: [0.15, 0.32], colors: ['#16121c', '#3a2a48', '#6a2a8a', '#c060ff'], drag: 2.5, g: -1 });
      audio.sfx('batFlap', { pitch: 0.8 });
    } finally {
      an(c.tosha).expr = 'normal';
      if (L.authority && boss.form !== 'dead') { boss.form = 'intro'; boss.start(); }
      fightOn(L);
    }
    yield L.camBack(0.6);
    L.cutscene(false);
    L.tcam.mode = 'boss';
    L.hud.toast(L.nl ? TOASTS.bossCoop : TOASTS.boss, 6);
  },

  // a restart in the fight (§12)
  *fangs2_boss_retry(L) {
    const R = swampOf(L)!;
    const boss = R.boss;
    L.cutscene(true);
    // (the candle is out on the walk: back onto the veranda, like the first time)
    placeMe(L, MARK.veranda.x, MARK.veranda.y, MARK.veranda.z, Math.PI);
    boss.form = 'lady'; boss.act = 'taunt';
    boss.pos.set(ARENA.cx, ARENA.y, ARENA.cz - 4);
    yield L.shot(V(ARENA.cx + 2, 2.8, ARENA.cz + 2), boss.center(), 0);
    yield say(L, 'morok', MOROK.retry, 'sly');
    if (L.authority) { boss.form = 'intro'; boss.start(); }
    fightOn(L);
    yield L.camBack(0.5);
    L.cutscene(false);
    L.tcam.mode = 'boss';
  },

  // ─────────────────────── 6.5 Морок в тине ───────────────────────
  *fangs2_boss_defeat(L) {
    const R = swampOf(L)!;
    const boss = R.boss;
    L.cutscene(true);
    L.hud.bossMax = 0;
    audio.stopMusic(1.5);
    hideCast(L);
    boss.form = 'dead';
    const p0 = boss.pos.clone().setY(ARENA.y);
    yield L.shot(p0.clone().add(V(3, 2.4, 3.6)), p0.clone().setY(ARENA.y + 1.2), 0);
    // the тина: a slick of bog-green slime under her
    const slick = new THREE.Mesh(new THREE.CircleGeometry(1.6, 24).rotateX(-Math.PI / 2), basic('#3a5a2a', { transparent: true, opacity: 0.85 }));
    slick.position.copy(p0).setY(ARENA.y + 0.03); slick.scale.setScalar(0.1);
    L.scene.add(slick);
    yield all(tween(0.6, (k) => slick.scale.setScalar(0.1 + k)), say(L, 'morok', 'Ах! Моя вуаль… мой дом… мои баночки!', 'scared'));
    L.fx.emit(p0.clone().setY(ARENA.y + 0.4), { count: 20, speed: [1, 3], dir: V(0, 1, 0), spread: 0.6, life: [0.4, 0.8], size: [0.12, 0.24], colors: ['#3a5a2a', '#6a8a4a'], g: 9 });
    audio.sfx('splash');
    yield say(L, 'morok', 'Король вам этого не простит, дорогуши. Пи… пи?!');
    // пуф — a mouse, off to the castle
    boss.gone = true;
    L.fx.emit(boss.center(), { count: 30, speed: [1, 4], dir: V(0, 1, 0), spread: 0.9, life: [0.5, 1.1], size: [0.2, 0.42], size2: 1.8, colors: ['#4a3a66', '#2b2140', '#8a7ab0'], g: -1, drag: 2 });
    L.fx.stars(boss.center(), 12, ['#ffe14a', '#ffffff']);
    audio.sfx('batScreech', { pitch: 1.8, volume: 0.4 });
    const mouse = createBat();
    const mg = new THREE.Group(); mg.add(mouse.root); mg.position.copy(boss.center()); mg.scale.setScalar(0.7);
    L.scene.add(mg);
    const ma: VAnim = { st: 'fly', p: 0, speed: 0, flash: 0 };
    const away = V(-0.45, 0.35, -0.65).normalize();
    yield all(
      L.shot(p0.clone().add(V(4, 2, 4)), p0.clone().add(V(-6, 5, -8)), 1.6),
      tween(2.2, (k) => { mg.position.copy(p0).setY(ARENA.y + 1).addScaledVector(away, k * 22); mg.rotation.y = Math.atan2(away.x, away.z); mouse.update(1 / 60, ma); mg.scale.setScalar(0.7 * (1 - k * 0.6)); }),
    );
    mg.removeFromParent(); slick.removeFromParent();
    // the jars burst one by one, the fireflies rise, the bog turns green
    yield L.shot(V(-8, 8, -146), V(-8, 4, -168), 1.0);
    const jars = R.jars;
    const m4 = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
    let popped = 0;
    const N = jars.count;
    if (L.authority) vamp(L).restoreZone('house');
    vamp(L).night?.set(0.25, 5);
    vamp(L).moonCtl?.set(0.25, 5);
    afterVictory(L, false);
    yield tween(2.4, (k) => {
      const want = Math.floor(k * N);
      while (popped < want) {
        jars.getMatrixAt(popped, m4);
        const pos = V(0, 0, 0).setFromMatrixPosition(m4);
        jars.setMatrixAt(popped, zero);
        if (popped % 3 === 0) { L.fx.sparks(pos, 4, ['#e8f8ff', '#ffffff']); L.fx.stars(pos, 3, ['#ffe36a', '#fff6c0']); }
        if (popped % 9 === 0) audio.sfx('break', { pitch: 1.4 + Math.random() * 0.4, volume: 0.3 });
        popped++;
      }
      jars.instanceMatrix.needsUpdate = true;
    });
    audio.sfx('colorRestore');
    yield L.shot(V(-8, 14, -136), V(-8, 2, -165), 2.4);
    yield wait(0.6);
    L.cutscene(false);
    // the ending follows at once (its own scene, so each fits the co-op watchdog)
    if (L.authority) L.runGen((function* (): Script { yield wait(0.05); L.run('fangs2_ending'); })());
    yield wait(0.1);
  },

  // ─────────────────────── 6.6 Слеза светлячка ───────────────────────
  *fangs2_ending(L) {
    const R = swampOf(L)!;
    const c = cast(L);
    L.cutscene(true);
    audio.playMusic('swamp');
    stage(L, { tosha: [-9.8, ARENA.y, -158.2], bublik: [-11.4, ARENA.y, -157.6], pastila: [-6.4, ARENA.y, -159.4], noki: [-4.6, ARENA.y, -158.4] }, V(-8, 2, -164));
    const mother = R.motherG, rig = R.mother;
    mother.visible = true;
    mother.scale.setScalar(0.85);
    // the bottle cracks
    R.bottle.visible = true;
    const m0 = mother.position.clone();
    const out = V(-8, ARENA.y + 0.6, -164.2);
    try {
      yield L.shot(V(-8, 3.2, -157.5), V(-8, 2.6, -172), 0);
      L.fx.sparks(MARK.bottle.clone().setY(ARENA.y + 3), 30, ['#e8f8ff', '#ffffff', '#cfe8e0']);
      audio.sfx('break', { pitch: 0.7 });
      R.bottle.visible = false;
      yield all(tween(2.4, (k) => { mother.position.lerpVectors(m0, out, k); rig.glow = 0.25 + 0.75 * k; mother.scale.setScalar(0.85 + 0.25 * k); }, ease.inOut), L.shot(V(-8, 2.8, -156.4), V(-8, 2.6, -164), 2.4));
      yield say(L, 'svetlyachikha', 'Свет… Наконец-то свет! Мои детки летают!', 'happy');
      yield say(L, 'svetlyachikha', 'Спасибо вам, храбрые. Ох… я сейчас… я сейчас расплачусь!');
      // the tear falls — Пастила catches it in her flask
      faceTo(c.pastila, out);
      an(c.pastila).attack = { kind: 'flask', p: 0.35 };
      const tear = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), basic('#fff07a'));
      const tg = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#ffe86a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      tg.scale.setScalar(0.9); tear.add(tg); noOutline(tear);
      const t0 = out.clone().add(V(0.2, 2.1, 0.5)), t1 = c.pastila.root.position.clone().add(V(0, 1.0, 0));
      L.scene.add(tear);
      yield all(L.shot(at(c.pastila, 1.8, 1.6, 2.4), at(c.pastila, -0.4, 1.4, -1.5), 0.5), tween(1.3, (k) => { tear.position.lerpVectors(t0, t1, k); tear.position.y += Math.sin(k * Math.PI) * 0.6; }, ease.inOut));
      tear.removeFromParent();
      L.fx.stars(t1, 20, ['#fff07a', '#ffffff']);
      audio.sfx('artifact');
      an(c.pastila).attack = null; an(c.pastila).state = 'cheer'; an(c.pastila).expr = 'happy';
      yield* ingredientCard(L, CARD.title, CARD.desc, 'fangs:tear');
      yield say(L, 'pastila', 'Поймала! Слеза светлячка. Чистый свет в жидком виде.', 'happy');
      an(c.pastila).state = 'idle';
      yield L.shot(at(c.bublik, 1.4, 1.0, 2.2), at(c.bublik, 0, 0.6, -1), 0.5);
      yield say(L, 'bublik', 'А если она ещё поплачет, можно вторую? Про запас?');
      yield L.shot(V(-8, 2.8, -156.4), V(-8, 2.6, -164), 0.5);
      yield say(L, 'svetlyachikha', 'Хи-хи. От счастья — сколько угодно!', 'happy');
      // Камыш paddles up to the east gap
      openExit(L);
      yield L.shot(V(1.5, 2.6, -152.5), MARK.exitBoat.clone().setY(1.4), 0.7);
      yield say(L, 'kamysh', 'Ква! Топь светится! Я снова вижу дорогу. И упырей вижу. Лучше бы не видел.', 'happy');
      faceTo(c.tosha, c.noki.root.position); faceTo(c.noki, c.tosha.root.position);
      yield L.shot(V(-7.2, 2.2, -154.6), V(-7.2, 1.2, -158.4), 0.6);
      yield say(L, 'tosha', 'Ноки, ты билась лучше всех. Прости, что сомневались.');
      yield say(L, 'noki', 'Я бы тоже сомневалась. Без тени я сама себе не верю.');
      faceTo(c.tosha, out); faceTo(c.noki, out);
      yield L.shot(at(c.pastila, 1.8, 1.5, 2.2), at(c.pastila, -0.4, 1.1, -1), 0.5);
      yield say(L, 'pastila', 'Следующий — Корень полуденника. Он растёт только в Стеклянной оранжерее.');
      yield L.shot(at(c.noki, 1.6, 1.4, 2.0), at(c.noki, -0.2, 1.1, -1), 0.5);
      yield say(L, 'noki', 'Там живёт Шёпот. Его никто не видел. Только слышал.');
      an(c.bublik).expr = 'scared';
      yield L.shot(at(c.bublik, 1.4, 1.0, 2.2), at(c.bublik, 0, 0.6, -1), 0.5);
      yield say(L, 'bublik', 'Невидимый вампир? А можно нам кого-нибудь видимого?', 'scared');
      an(c.bublik).expr = 'normal';
      yield L.shot(V(-8, 3.4, -154.5), V(-8, 2.6, -164), 0.6);
      yield say(L, 'svetlyachikha', 'Возьмите моих деток. В темноте друг всегда светится.');
    } finally {
      for (const n of Object.values(c)) an(n).attack = null;
      hideCast(L);
      openExit(L);
      // she stays, glowing over her bog
      mother.position.copy(out).setY(ARENA.y + 1.2);
      rig.glow = 1;
    }
    yield L.camBack(0.7);
    L.cutscene(false);
    L.tcam.mode = 'follow'; L.camModeDefault = 'follow';
    L.boss = null;
    L.hud.toast(TOASTS.exit, 6);
  },

  // ─────────────────────── the way home ───────────────────────
  *exit_fangs2_swamp(L) {
    if (L.nl) { L.complete = true; L.exitWait = null; }
    L.cutscene(true);
    const boat = L.refs.f2boat as { obj: THREE.Group } | undefined;
    const b0 = boat ? boat.obj.position.clone() : MARK.exitBoat.clone();
    yield L.shot(b0.clone().add(V(-6, 3.5, 7)), b0.clone().add(V(0, 1, 0)), 0);
    L.player.hidden = true;
    yield all(
      L.shot(b0.clone().add(V(-4, 6, 10)), b0.clone().add(V(14, 1, -8)), 3.2),
      tween(3.2, (k) => { if (boat) boat.obj.position.copy(b0).add(V(k * 14, 0, -k * 8)); }, ease.inOut),
    );
    yield wait(0.3);
    if (L.authority) L.endLevel();
  },
};

/** a side tween that doesn't hold the scene (done → `end`) */
function tweenOn(L: Level3D, d: number, f: (k: number) => void, end: () => void) {
  L.runGen((function* (): Script { yield tween(d, f, ease.inOut); end(); })());
}

/** blob shadows under the story four (Ноки has none: she lost her shadow — §1.7) */
export function castShadows(L: Level3D) {
  const c = cast(L);
  for (const k of ['tosha', 'bublik', 'pastila'] as Kind[]) {
    const b = makeBlob(0.45);
    b.position.y = 0.03;
    c[k].root.add(b);
  }
  c.noki.rig.root.traverse((o) => { o.castShadow = false; });
}

export const FANGS2_SCRIPTS = SCRIPTS;
void until; void untilOr;

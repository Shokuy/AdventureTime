import { audio } from '../engine/audio';
import { save } from '../engine/save';
import { ease, clamp, lerp, TAU } from '../engine/util';
import { drawDog, drawDogFist, drawGuard } from '../art/characters';
import { rrect, ellipse, limbQ, text, OUT, line } from '../art/draw';
import type { LevelScene } from '../scenes/level';
import { Script, wait, tween, all, until } from './coroutine';
import { Pickup, Npc } from './entities';
import { KingBoss, KingChaser } from './boss';

type ScriptFn = (L: LevelScene) => Script;

function* chapterTitle(L: LevelScene) {
  L.hud.showChapter(L.def.title, L.def.subtitle);
  L.bannerShown = true;
  yield undefined;
}

const scripts: Record<string, ScriptFn> = {
  // ───────────── CHAPTER 1: PANTRY ─────────────
  *pantry_intro(L) {
    const p = L.player;
    L.cutscene(true);
    p.forceState = 'dead'; p.facing = 1;
    L.cam.x = p.cx + 120; L.cam.y = p.cy - 60; L.cam.clampToBounds();
    yield wait(1.2);
    p.forceState = 'sit'; p.expr = 'sleepy';
    audio.sfx('thud', { volume: 0.4 });
    yield wait(0.8);
    yield L.say('hero', 'Ой-ой-ой... Где это я?');
    p.forceState = 'idle'; p.expr = 'surprised';
    p.sy = 0.7; p.sx = 1.3;
    yield wait(0.4);
    p.facing = -1; yield wait(0.5); p.facing = 1; yield wait(0.3);
    yield L.say('hero', 'Бублик? БУБЛИК! Ты где?!', 'scared');
    p.expr = 'surprised';
    yield L.camTo(p.cx + 520, p.cy - 260, 1.8);
    yield L.say('hero', 'Ничего себе... Тут всё такое ОГРОМНОЕ! Банки, ящики... я как муравей.', 'surprised');
    yield L.camBack(1.0);
    p.expr = 'angry';
    yield L.say('hero', 'Ладно. Надо выбраться отсюда и найти Бублика!', 'angry');
    p.expr = undefined; p.forceState = null;
    L.cutscene(false);
    yield* chapterTitle(L);
  },

  *pantry_bear(L) {
    const p = L.player;
    const bear = L.npcs.bear;
    L.cutscene(true);
    yield L.walkTo(bear.x - 150, 0.55);
    p.facing = 1;
    yield L.camTo(bear.x - 70, p.cy - 90, 1.0);
    bear.wave = 1.6;
    yield L.say('bear', 'Хо-хо! Ещё один свалился в яму. Ну здравствуй, малыш.');
    yield L.say('hero', 'Ой! Здрасьте... А вы кто?', 'surprised');
    yield L.say('bear', 'Я — Вторник. Медведь. Сижу здесь уже лет сорок... а может, пятьдесят. Тут, внизу, время какое-то вкусное — не замечаешь, как проходит.');
    yield L.say('hero', 'А как отсюда выбраться?');
    yield L.say('bear', 'Выбраться? Ха! Из Громадного Королевства не уходят, дружок. Король Громадин ужасно этого не любит.');
    yield L.say('bear', 'Он огромный, ленивый и всё время жуёт. А его стражники-арбузята ловят всех, кто пытается удрать.');
    p.expr = 'angry';
    yield L.say('hero', 'А я всё равно выберусь! Меня друг ждёт. Наверное. Он тоже куда-то упал...', 'angry');
    p.expr = undefined;
    yield L.say('bear', 'Хм. Упрямый. Прямо как я в молодости... Ну, держи-ка подарок.');
    const pk = new Pickup('sling', p.cx + 40, p.y - 30, 'pantry_sling');
    L.collect(pk);
    yield until(() => !L.popup.active);
    yield L.say('bear', 'Единственный путь наверх — Лунный колодец. Он прямо над троном Короля. Иди через Пиршественный зал и Библиотеку.');
    yield L.say('bear', 'Да, и заглядывай ко мне в берлогу — я знаю тут все норы. Насобираешь крошек — помогу, чем смогу.');
    yield L.say('hero', 'Спасибо, дедушка Вторник!', 'happy');
    bear.wave = 1.2;
    yield L.camBack(0.8);
    L.cutscene(false);
    L.toast('K / C — выстрел из рогатки');
  },

  *exit_pantry(L) {
    const p = L.player;
    L.cutscene(true);
    p.facing = 1;
    yield L.say('hero', 'Пиршественный зал... Звучит вкусно. И опасно.');
    p.auto = { x: p.cx + 80, speed: 0.5 };
    yield wait(0.4);
    p.hidden = true;
    audio.sfx('door');
    yield wait(0.6);
    L.endLevel();
  },

  // ───────────── CHAPTER 2: FEAST ─────────────
  *feast_intro(L) {
    const p = L.player;
    L.cutscene(true);
    p.facing = 1;
    yield wait(0.6);
    yield L.say('hero', 'Ммм... Пахнет так, будто тут кормят великана.');
    yield L.say('hero', 'Главное — никому не попасться на глаза. И в тарелку.');
    L.cutscene(false);
    yield* chapterTitle(L);
  },

  *feast_king(L) {
    const p = L.player;
    const king = L.npcs.kingBg;
    L.cutscene(true);
    p.expr = 'surprised';
    const feeders = { k: 0 };
    const drawFeeders = (ctx: CanvasRenderingContext2D) => {
      for (const side of [-1, 1]) {
        const fx = king.x + side * lerp(420, 150, feeders.k);
        const fy = king.y + 6 + Math.sin(L.t * 12 + side) * 2;
        drawGuard(ctx, fx, fy, 1.1, { t: L.t, facing: -side, state: feeders.k < 1 ? 'walk' : 'idle', phase: L.t * 9, kind: 'feeder', carry: feeders.k < 1 });
      }
    };
    L.extraDraw.push(drawFeeders);
    yield L.camTo(king.x, king.y - 200, 2.0, 0.85);
    king.chew = 1;
    yield tween(1.2, (k) => { feeders.k = k; });
    audio.sfx('chomp'); king.mouth = 1;
    yield wait(0.4);
    king.mouth = 0;
    yield wait(0.5);
    yield L.say('king', 'ЕЩЁ! Ещё мяса! Король проголодался!', 'chew');
    yield L.say('guard', 'Да, Ваше Громадейшество! Несём, Ваше Громадейшество!', 'cheer');
    king.eye = 0.3;
    yield L.say('king', 'И пусть никто... ням... никто и никогда не уходит из моего королевства. Здесь же так уютно... и вкусно...', 'chew');
    audio.sfx('snore');
    yield wait(0.8);
    yield L.camBack(1.4);
    L.extraDraw = L.extraDraw.filter((f) => f !== drawFeeders);
    yield L.say('hero', 'Так вот ты какой, Король Громадин... Тише-тише, мимо.', 'scared');
    p.expr = undefined;
    L.cutscene(false);
  },

  *exit_feast(L) {
    const p = L.player;
    L.cutscene(true);
    yield L.say('hero', 'Дальше — Библиотека. Надеюсь, книжки там не кусаются.');
    p.auto = { x: p.cx + 80, speed: 0.5 };
    yield wait(0.4);
    p.hidden = true; audio.sfx('door');
    yield wait(0.6);
    L.endLevel();
  },

  // ───────────── CHAPTER 3: LIBRARY ─────────────
  *library_intro(L) {
    L.cutscene(true);
    yield wait(0.5);
    yield L.say('hero', 'Сколько книг! Может, тут есть книжка «Как сбежать от короля»?');
    yield L.camTo(L.player.cx + 300, L.player.cy - 600, 1.6);
    yield L.say('hero', 'Выход, наверное, на самом верху... Придётся карабкаться.');
    yield L.camBack(1);
    L.cutscene(false);
    yield* chapterTitle(L);
  },

  *exit_library(L) {
    const p = L.player;
    L.cutscene(true);
    yield L.say('hero', 'Там, за дверью, слышно храп... Тронный зал. Только бы не разбудить!', 'scared');
    p.auto = { x: p.cx + 80, speed: 0.4 };
    yield wait(0.5);
    p.hidden = true; audio.sfx('door');
    yield wait(0.6);
    L.endLevel();
  },

  // ───────────── CHAPTER 4: CHASE ─────────────
  *chase_intro(L) {
    const p = L.player;
    const ch = L.chaser as KingChaser;
    L.cutscene(true);
    audio.playMusic('tension');
    p.facing = -1;
    L.cam.x = p.cx - 300; L.cam.y = p.cy - 200; L.cam.clampToBounds();
    yield wait(0.8);
    audio.sfx('snore');
    yield L.camTo(ch.bodyX + 200, L.def.h - 470, 1.6, 0.8);
    yield wait(1.0);
    p.expr = 'scared';
    yield L.say('hero', '(шёпотом) Вот он. Спит прямо на троне...', 'scared');
    yield L.say('hero', '(шёпотом) Медведь говорил: Лунный колодец — за Большой галереей. Тихонечко, на цыпочках...', 'scared');
    yield L.camBack(1.0);
    p.facing = 1;
    p.forceState = 'sneak';
    p.auto = { x: p.cx + 230, speed: 0.25 };
    yield until(() => !p.auto);
    // squeak!
    audio.sfx('bounce', { pitch: 2.2 });
    L.fx.text(p.cx, p.y - 30, 'ПИИИ!', '#ffffff', 26);
    p.forceState = null; p.expr = 'surprised';
    p.sy = 0.7;
    yield wait(0.9);
    yield L.camTo(ch.bodyX + 160, L.def.h - 500, 0.7, 0.8);
    ch.eye = 0.2;
    yield wait(0.5);
    ch.sleeping = false;
    audio.sfx('roar');
    L.cam.shake(0.9);
    yield wait(0.6);
    yield L.say('king', 'КТО... ПОСМЕЛ... УХОДИТЬ ИЗ МОЕГО КОРОЛЕВСТВА?!', 'angry');
    yield L.say('king', 'Я не вставал с трона сто лет... НО РАДИ ТЕБЯ — ВСТАНУ!', 'angry');
    audio.sfx('bigSlam');
    L.cam.shake(1);
    yield L.camBack(0.6);
    L.hud.showBanner('БЕГИ!!!', '#ff5a4a');
    p.expr = 'angry';
    L.cutscene(false);
    audio.playMusic('chase');
    ch.active = true;
    ch.speed = 120;
    yield wait(2);
    p.expr = undefined;
  },

  *exit_chase(L) {
    const p = L.player;
    const ch = L.chaser as KingChaser;
    L.cutscene(true);
    L.allowHurtInCutscene = false;
    p.auto = { x: p.cx + 140, speed: 1 };
    ch.speed = 900;
    yield wait(0.35);
    p.hidden = true; audio.sfx('door');
    yield wait(0.35);
    audio.sfx('bigSlam');
    L.cam.shake(1);
    L.whiteFlash = 0.6;
    yield wait(0.8);
    L.endLevel();
  },

  // ───────────── CHAPTER 5: THRONE ─────────────
  *throne_intro(L) {
    const p = L.player;
    const boss = L.boss as KingBoss;
    L.cutscene(true);
    boss.hidden = true;
    audio.playMusic('tension');
    p.auto = { x: 340, speed: 0.6 };
    yield L.camTo(900, 660, 0.01, 0.82);
    yield until(() => !p.auto);
    p.expr = 'surprised';
    p.forceState = 'lookUp';
    yield L.say('hero', 'Лунный колодец! Вон там, наверху — небо!', 'happy');
    p.forceState = null;
    audio.sfx('thud'); L.cam.shake(0.4);
    yield wait(0.6);
    audio.sfx('thud'); L.cam.shake(0.6);
    yield wait(0.5);
    // king crashes in
    boss.hidden = false;
    boss.slump = -2.5;
    audio.sfx('bigSlam');
    yield tween(0.5, (k) => { boss.slump = lerp(-2.5, 0, k); }, ease.outBounce);
    L.cam.shake(1.2);
    L.fx.dust(boss.x, boss.floorY, 30, '#c8b0e0');
    p.facing = 1;
    p.expr = 'scared';
    boss.anger = 0.8; boss.eye = 1;
    yield wait(0.5);
    yield L.say('king', 'НИКТО. НЕ УХОДИТ. ИЗ ГРОМАДНОГО КОРОЛЕВСТВА!', 'angry');
    p.expr = 'angry';
    yield L.say('hero', 'А я уйду! Даже если придётся надавать тебе по пальцам!', 'angry');
    yield L.say('king', 'ХА-ХА-ХА! Ну попробуй, крошка!', 'angry');
    audio.sfx('roar');
    L.cam.shake(0.8);
    p.expr = undefined;
    L.cutscene(false);
    L.camOverride = false;
    audio.playMusic('boss');
    boss.start();
    L.toast('Бей по ладоням, когда они застрянут в полу!');
    yield wait(3.5);
    L.toast('Котлеты можно отбить мечом обратно в Короля!');
  },

  *throne_retry(L) {
    const boss = L.boss as KingBoss;
    L.cutscene(true);
    boss.anger = 0.6; boss.eye = 1;
    yield L.camTo(900, 660, 0.01, 0.82);
    yield wait(0.4);
    yield L.say('king', choose3(['ОПЯТЬ ТЫ?!', 'Ещё одна порция?', 'Вернулся на десерт?!']), 'angry');
    L.cutscene(false);
    L.camOverride = false;
    audio.playMusic('boss');
    boss.start();
  },

  *throne_victory(L) {
    const p = L.player;
    const boss = L.boss as KingBoss;
    L.cutscene(true);
    L.hud.bossMax = 0;
    audio.stopMusic(1.5);
    yield L.camTo(900, 660, 1.0, 0.82);
    yield tween(1.2, (k) => { boss.slump = k * 0.8; boss.dizzy = 1; }, ease.outCubic);
    yield L.say('king', 'Ох... моя... корона... кружится...');
    p.expr = 'happy'; p.forceState = 'cheer';
    yield L.say('hero', 'Получилось! ПОЛУЧИЛОСЬ!', 'happy');
    p.forceState = null; p.expr = undefined;
    yield wait(0.4);
    // king rises for one last attack
    audio.sfx('roar');
    L.cam.shake(1);
    yield tween(0.7, (k) => { boss.slump = lerp(0.8, -0.3, k); boss.dizzy = 1 - k; boss.anger = 1; boss.eye = 1; }, ease.outBack);
    yield L.say('king', '...НЕТ! Я ещё... НЕ ДОЕЛ... ТЕБЯ!!!', 'angry');
    const fist = boss.hands[1];
    boss.freezeHands = true;
    yield tween(0.8, (k) => { fist.x = lerp(fist.x, p.cx + 40, k * 0.2); fist.y = lerp(fist.y, boss.floorY - 520, k * 0.2); fist.look = 'fist'; });
    p.expr = 'scared'; p.facing = 1;
    yield wait(0.3);
    // dog arrives
    const dog = { x: 900, y: -200, vy: 0, L: 46, s: 1.5, fist: 0, cart: true };
    L.extraDrawFront.push((ctx) => drawDogArrival(ctx, dog, L.t, boss));
    audio.sfx('fall');
    yield L.say('dog', 'ТОША-А-А-А!!!');
    yield tween(1.2, (k) => { dog.y = lerp(-200, boss.floorY - 520, k); }, ease.outCubic);
    yield wait(0.2);
    yield L.say('dog', 'А ну, руки прочь от моего друга, толстяк!', 'angry');
    // stretch punch
    audio.sfx('whoosh', { pitch: 0.7 });
    yield tween(0.35, (k) => { dog.fist = k; }, ease.inCubic);
    audio.sfx('bigSlam'); audio.sfx('bossHit');
    L.cam.shake(1.4);
    L.whiteFlash = 0.9;
    L.hitstop(0.3);
    L.fx.text(boss.x, boss.faceCenter().y - 80, 'БУБЛИК-ПАНЧ!', '#ffe14a', 54);
    L.fx.emit(boss.x - 100, boss.faceCenter().y, { count: 40, speed: [200, 700], life: [0.5, 1.2], size: [4, 9], colors: ['#ffe14a', '#ffffff', '#ff8a2a'], shape: 'star', drag: 2, additive: true });
    boss.dizzy = 1;
    for (const h of boss.hands) { h.x = h.restX; h.y = h.restY; h.look = 'rest'; }
    yield all(
      tween(1.2, (k) => { boss.slump = lerp(-0.3, 1.4, k); boss.lean = 0.2 * k; }, ease.outBounce),
      tween(0.6, (k) => { dog.fist = 1 - k; }, ease.outCubic),
    );
    boss.eye = 0;
    audio.sfx('snore');
    yield wait(0.6);
    yield tween(0.8, (k) => { dog.y = lerp(boss.floorY - 520, boss.floorY, k); dog.cart = k < 0.5; }, ease.outBounce);
    p.expr = 'happy';
    yield L.say('hero', 'БУБЛИК!!! Ты пришёл!', 'happy');
    yield L.say('dog', 'Прости, что так долго. Я спускался на тележке с парашютом. Очень. Медленно.', 'happy');
    yield L.say('dog', 'Зато на последних метрах я разогнался и научился вытягиваться ещё длиннее! Смотри!', 'happy');
    // bear arrives
    const bear = new Npc('bear', -120, boss.floorY, 1, 1);
    bear.state = 'walk'; bear.vx = 160;
    L.npcList.push(bear); L.npcs.bear = bear;
    yield until(() => bear.x > 330);
    bear.vx = 0; bear.state = 'idle';
    yield L.say('bear', 'Ну надо же... Король уснул. Впервые за сто лет — и не жуя.');
    yield L.say('hero', 'Дедушка Вторник! Пойдём с нами наверх!', 'happy');
    yield L.say('bear', 'Наверх?.. Я ведь и забыл, какое оно — небо. Ох... Пойдём!');
    yield L.say('dog', 'Хватайтесь за хвост! Я растянусь до самого верха!', 'happy');
    yield wait(0.4);
    audio.sfx('victory');
    L.endLevel();
  },
};

function choose3(a: string[]) { return a[Math.floor(Math.random() * a.length)]; }

function drawDogArrival(ctx: CanvasRenderingContext2D, d: { x: number; y: number; s: number; fist: number; cart: boolean }, t: number, boss: KingBoss) {
  const x = d.x - 260, y = d.y;
  if (d.cart) {
    // parachute
    ctx.save();
    ctx.translate(x, y - 260);
    ctx.beginPath(); ctx.moveTo(-140, 40); ctx.quadraticCurveTo(0, -150, 140, 40); ctx.quadraticCurveTo(70, 20, 0, 40); ctx.quadraticCurveTo(-70, 20, -140, 40); ctx.closePath();
    ctx.fillStyle = '#c8a870'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = OUT; ctx.stroke();
    ctx.fillStyle = '#a8885a'; ctx.fillRect(-60, -40, 30, 60);
    for (const sx of [-130, -50, 50, 130]) line(ctx, sx, 38, sx * 0.4, 230, '#4a3a2a', 2);
    ctx.restore();
    // cart
    rrect(ctx, x - 90, y - 50, 180, 50, 8, '#8a5530', 4);
    ellipse(ctx, x - 60, y + 4, 16, 16, '#4a4a55', 3);
    ellipse(ctx, x + 60, y + 4, 4, 16, '#4a4a55', 3);
  }
  drawDog(ctx, x - 10, y - (d.cart ? 46 : 0), d.s, t, { facing: 1, state: 'idle', expr: 'angry', talk: 0 });
  if (d.fist > 0.01) {
    const f = boss.faceCenter();
    const sx = x + 60, sy = y - 80;
    const ex = lerp(sx + 60, f.x - 60, d.fist), ey = lerp(sy, f.y + 40, d.fist);
    limbQ(ctx, sx, sy, (sx + ex) / 2, Math.min(sy, ey) - 120 * d.fist, ex, ey, 34, '#b0612e', 4);
    drawDogFist(ctx, ex, ey, 0.6 + d.fist * 0.9, Math.atan2(ey - sy, ex - sx));
  }
  void text; void clamp; void TAU;
}

// ───────────── special setup hooks (run on every level build) ─────────────
const special: Record<string, (L: LevelScene) => void> = {
  chase(L) {
    const G = L.def.h - 120;
    const cp = L.checkpoint;
    const ch = new KingChaser(cp ? cp.x - 760 : 1020, G);
    if (cp) {
      ch.sleeping = false;
      ch.bodyX = ch.front - 430;
      L.runGen((function* () {
        L.hud.showBanner('ПРИГОТОВЬСЯ...', '#ffd34a');
        audio.playMusic('chase');
        yield wait(1.3);
        L.hud.showBanner('БЕГИ!!!', '#ff5a4a');
        ch.active = true; ch.speed = 150;
      })());
    }
    L.chaser = ch;
    // keep both the fleeing hero and the king's furious face on screen
    L.camTarget = () => {
      const p = L.player;
      const half = 1280 / 2 / L.cam.zoom;
      if (!ch.active) return { x: p.cx + p.facing * 90, y: p.cy - 60 };
      const ideal = (p.cx + ch.front) / 2 + 160;
      return { x: Math.max(ideal, p.cx - half + 260), y: p.cy - 60 };
    };
    // trample enemies the king passes
    const origUpdate = ch.update.bind(ch);
    ch.update = (LL: LevelScene, dt: number) => {
      origUpdate(LL, dt);
      if (ch.active) for (const e of LL.enemies) if (e.cx < ch.front - 20 && !e.dead) { e.loot = 0; e.die(LL); }
    };
  },
  throne(L) {
    const G = L.def.h - 120;
    const boss = new KingBoss(900, G);
    L.boss = boss;
    boss.onDefeat = () => {
      L.runGen((function* () {
        yield wait(1.6);
        L.run('throne_victory');
      })());
    };
    if (L.seen.has('throne_intro')) {
      L.runGen((function* () { yield wait(0.01); L.run('throne_retry'); })());
    }
  },
};

export const SCRIPTS = { scripts, special };
void save;

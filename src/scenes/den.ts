import { W, H, TAU, srand, clamp, ease, damp } from '../engine/util';
import { input } from '../engine/input';
import { audio } from '../engine/audio';
import { save } from '../engine/save';
import { Particles } from '../engine/particles';
import { drawBear, drawHero } from '../art/characters';
import { rrect, text, wrap, glow, ellipse, OUT } from '../art/draw';
import * as Props from '../art/props';
import { drawBerryHeart, drawHoney, drawPeaPod, vignetteCanvas, drawCrumb, drawCloak } from '../art/props';
import { MenuList } from '../ui/widgets';
import { bindText } from '../ui/glyphs';
import { game, STORY } from '../game/game';

type C = CanvasRenderingContext2D;
type Icon = (ctx: C, x: number, y: number, s: number, t: number) => void;

/** icons that may come from the art module (fallback: a plain token) */
function icon(name: string, fallback: string): Icon {
  return (ctx, x, y, s, t) => {
    const f = (Props as unknown as Record<string, Icon | undefined>)[name];
    if (f) { f(ctx, x, y, s, t); return; }
    ctx.beginPath(); ctx.arc(x, y, 15 * s, 0, TAU); ctx.fillStyle = fallback; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = OUT; ctx.stroke();
  };
}
const nutIcon = icon('drawGoldenNut', '#ffcf3a');

interface ShopItem {
  key: string;
  name: string;
  desc: string;
  /** what it costs: crumbs or golden walnuts */
  cur: 'crumb' | 'nut';
  price: () => number;
  /** why it's still locked (null = on sale) */
  locked: () => string | null;
  /** owned count / max (for multi-level items) */
  level?: () => [number, number];
  soldOut: () => boolean;
  buy: () => void;
  icon: Icon;
}

/**
 * What the bear says as the heroes come in — one line every few seconds. Each visit explains how they got here in the
 * middle of an escape (a burrow from the pantry; a hole too small for the melon guards; the magic book spits everyone
 * out here first) and where the road goes next. Solo: to Тоша; co-op: to the whole team around the fire.
 */
function greet(visit: number, team: boolean): string[] {
  const t = (solo: string, coop: string) => (team ? coop : solo);
  if (visit === 2) return [
    'Быстрей в нору, быстрей! Арбузята сюда не пролезут — пусть себе бегают.',
    t('Король тебя заметил? Ох... Теперь стража ищет тебя по всему замку.', 'Король вас заметил? Ох... Теперь стража ищет вас по всему замку.'),
    'Из моей норы ход прямо в Библиотеку. На самой верхней полке там волшебная книга — она дорогу знает.',
    t('А книжки там летают и кусаются. Крышка-щит тебе бы пригодилась...', 'А книжки там летают и кусаются. Крышка-щит вам бы пригодилась...'),
    t('И слышь: в Лунном колодце опять скрипело. И кто-то ворчал про пироги. Всё ближе!', 'И слышите: в Лунном колодце опять скрипело. И кто-то ворчал про пироги. Всё ближе!'),
  ];
  if (visit === 3) return [
    t('Прыгнул в книжку? Волшебные книги всех сперва выплёвывают ко мне. Я им корешки подклеиваю.', 'Прыгнули в книжку? Волшебные книги всех сперва выплёвывают ко мне. Я им корешки подклеиваю.'),
    t('Как будешь готов — книжка выплюнет тебя дальше. Следующая страница — Большая галерея.', 'Как будете готовы — книжка выплюнет вас дальше. Следующая страница — Большая галерея.'),
    t('Король тебя видел. Он сто лет не бегал, но ради беглеца побежит. Услышишь грохот — беги!', 'Король вас видел. Он сто лет не бегал, но ради беглецов побежит. Услышите грохот — бегите!'),
    t('Возьми всё, что нужно. Я в тебя верю, малыш.', 'Берите всё, что нужно. Я в вас верю, малыши.'),
  ];
  return [
    t('Заходи, заходи! Живой, целый — молодец!', 'Заходите, заходите! Все живы, все целы!'),
    'Это моя берлога. Из кладовой сюда нора — Король про неё и не знает.',
    'Крошки тут вместо денег. Покажу, что припрятал. А за золотые орешки — особые штучки!',
    'Беглецов арбузята просто несут обратно. А «съем!» — это Король так пугает: ест он только то, что носят.',
    t('Орешки — королевские. Он прячет их по всему королевству и забывает где. Найдёшь — неси мне!', 'Орешки — королевские. Он прячет их по всему королевству и забывает где. Найдёте — несите мне!'),
    t('Дальше — пир. Король там шлёпает ладонью по столу: где засветится — там не стой!', 'Дальше — пир. Король там шлёпает ладонью по столу: где засветится — там не стойте!'),
  ];
}

const REACT = {
  buy: ['Отличный выбор!', 'Носи на здоровье!', 'Хо-хо, пригодится!', 'Сам бы купил, да лапы не те.'],
  poor: ['Крошек маловато, дружок.', 'Подсобери ещё крошек.', 'Не хватает... а в долг не даю!'],
  poorNut: ['Тут нужны золотые орешки! Они спрятаны в самых хитрых местах.', 'Орешков маловато... поищи получше!'],
  sold: ['Больше нет, всё распродал!'],
};

/**
 * Co-op den (set by the 3D den when a co-op game runs): everyone shops on their own, clients press «Готов»,
 * the host moves the room on when everyone is ready (or presses twice to go without them).
 */
export interface DenCoop {
  host(): boolean;
  /** my ready flag (clients) */
  ready(): boolean;
  toggleReady(): void;
  /** [ready, all] among the others */
  count(): [number, number];
  /** host: on to the next chapter */
  go(): void;
  chat(): void;
  leave(): void;
  /** next chapter title ('' if none) */
  next: string;
}

/**
 * The same shop opened from a shopkeeper NPC in the hub town (Медовая лавка Вторника, arc/town/hub.ts): the goods and
 * upgrades are the den's (one save, so purchases carry over), only the title, the keeper's lines and the one button
 * («закрыть») differ; Esc closes it, and it never changes the music or the story.
 */
export interface ShopHook {
  title: string;
  /** who winks at the locked goods («Вторник хитро подмигивает») */
  keeper: string;
  /** greeting lines, one every few seconds */
  greet: string[];
  react?: Partial<typeof REACT>;
  /** the button's label */
  closeLabel?: string;
  close: () => void;
}

const COLS = 2, CARD_W = 284, CARD_H = 74, GAP = 12;
const PX = 640, PY = 24, PW = 620, PH = 672;
const GX = PX + 20, GY = PY + 102;

/** the bear's shop between chapters (2D panel; the 3D den draws the room behind it) */
export class DenScene {
  t = 0;
  fx = new Particles();
  items: ShopItem[];
  sel = 0;
  bubble = '';
  bubbleT = 0;
  greetIdx = 0;
  /** the bear's greeting lines for this visit (greet()) */
  greet: string[];
  visit: number;
  vignette = vignetteCanvas(W, H, 0.55);
  chapters: MenuList | null = null;
  private anim: number[] = [];
  private buttons: { label: string | (() => string); w: number; action: () => void }[];
  /** host pressed "go" while not everyone was ready: a second press within this time goes anyway */
  private forceT = 0;

  /** what the keeper says back (purchases, too few crumbs, sold out) */
  react: typeof REACT;

  /** `opts.settings`: open the settings panel (the 3D den) — a «Настройки» button, Esc / Options and F1; `opts.shop`: the hub's shop */
  constructor(visit: number, public coop: DenCoop | null = null, private opts: { settings?: () => void; shop?: ShopHook } = {}) {
    this.visit = visit;
    this.react = { ...REACT, ...(opts.shop?.react ?? {}) };
    const d = save.data;
    const needSling = () => (d.abilities.slingshot ? null : 'Сначала найди рогатку');
    const needVisit = (v: number) => () => (visit >= v ? null : 'Привезут позже');
    this.items = [
      {
        key: 'heart', name: 'Сердце-вишня', desc: '+1 сердечко к здоровью навсегда.', cur: 'crumb',
        price: () => [60, 100, 150][d.bought.heart] ?? 0, locked: () => null, level: () => [d.bought.heart, 3], soldOut: () => d.bought.heart >= 3,
        buy: () => { d.bought.heart++; d.maxHp++; },
        icon: (ctx, x, y, s, t) => drawBerryHeart(ctx, x, y, s, t, true),
      },
      {
        key: 'sharp', name: 'Точильный камень', desc: 'Меч и вилка бьют сильнее: +1 урон каждым ударом.', cur: 'crumb',
        price: () => [90, 170][d.bought.sharp] ?? 0, locked: () => (d.bought.sharp >= 1 && visit < 2 ? 'Второй камень — в следующий раз' : null), level: () => [d.bought.sharp, 2], soldOut: () => d.bought.sharp >= 2,
        buy: () => { d.bought.sharp++; d.dmg++; },
        icon: (ctx, x, y, s) => { ellipse(ctx, x, y + 2, 20 * s, 11 * s, '#8a8a9a', 3); ellipse(ctx, x - 4 * s, y - 1, 9 * s, 4 * s, '#b8b8c8', 0); },
      },
      {
        key: 'honey', name: 'Баночка мёда', desc: 'Съешь в бою (E) — вернёт сердечки. Можно носить 3 баночки.', cur: 'crumb',
        price: () => 30, locked: () => null, level: () => [d.potions, 3], soldOut: () => d.potions >= 3,
        buy: () => { d.potions++; },
        icon: (ctx, x, y, s, t) => drawHoney(ctx, x, y, 1.3 * s, t),
      },
      {
        key: 'magnet', name: 'Магнит для крошек', desc: 'Крошки сами летят к тебе издалека, а враги роняют на 1 крошку больше.', cur: 'crumb',
        price: () => 50, locked: () => null, soldOut: () => d.upgrades.magnet,
        buy: () => { d.upgrades.magnet = true; },
        icon: icon('drawMagnet', '#e8383d'),
      },
      {
        key: 'bag', name: 'Мешочек гороха', desc: 'В рогатку влезает на 5 горошин больше.', cur: 'crumb',
        price: () => [35, 70][d.bought.bag] ?? 0, locked: needSling, level: () => [d.bought.bag, 2], soldOut: () => d.bought.bag >= 2,
        buy: () => { d.bought.bag++; d.ammoMax += 5; },
        icon: (ctx, x, y, s, t) => drawPeaPod(ctx, x, y, 1.3 * s, t),
      },
      {
        key: 'lid', name: 'Крышка-щит', desc: 'Принимает один удар на себя. Заново заряжается у каждой зажжённой свечки.', cur: 'crumb',
        price: () => 120, locked: needVisit(2), soldOut: () => d.upgrades.lid,
        buy: () => { d.upgrades.lid = true; },
        icon: icon('drawPotLid', '#b8c0d0'),
      },
      {
        key: 'comb', name: 'Медовые соты', desc: 'Мёд лечит 5 сердечек вместо 3.', cur: 'crumb',
        price: () => 70, locked: needVisit(2), soldOut: () => d.upgrades.comb,
        buy: () => { d.upgrades.comb = true; },
        icon: icon('drawHoneycomb', '#ffb020'),
      },
      {
        key: 'wind', name: 'Ветряной плащ', desc: 'Два рывка в воздухе подряд, и рывок перезаряжается быстрее.', cur: 'crumb',
        price: () => 100, locked: () => (d.abilities.dash ? null : 'Сначала найди Плащ-Рывок'), soldOut: () => d.upgrades.windCloak,
        buy: () => { d.upgrades.windCloak = true; },
        icon: (ctx, x, y, s, t) => { const f = (Props as unknown as Record<string, Icon | undefined>).drawWindCloak; if (f) f(ctx, x, y, s, t); else drawCloak(ctx, x, y, 0.9 * s, t); },
      },
      {
        key: 'nutHeart', name: 'Ореховое сердце', desc: 'Особое: +1 сердечко навсегда. Меняю на золотые орешки.', cur: 'nut',
        price: () => 3, locked: () => null, soldOut: () => d.upgrades.nutHeart,
        buy: () => { d.upgrades.nutHeart = true; d.maxHp++; },
        icon: icon('drawNutHeart', '#ffcf3a'),
      },
      {
        key: 'nutSling', name: 'Ореховая рогатка', desc: 'Особое: горох бьёт на 1 сильнее и пробивает врагов насквозь.', cur: 'nut',
        price: () => 4, locked: needSling, soldOut: () => d.upgrades.nutSling,
        buy: () => { d.upgrades.nutSling = true; },
        icon: icon('drawNutSling', '#ffcf3a'),
      },
    ];
    const next = STORY[save.data.story + 1];
    const co = this.coop;
    const shop = opts.shop;
    this.buttons = shop ? [
      { label: shop.closeLabel ?? 'Спасибо, до встречи!', w: 364, action: () => shop.close() },
    ] : co ? [
      { label: () => this.coopGoLabel(), w: 364, action: () => this.coopGo() },
      { label: 'Чат', w: 96, action: () => co.chat() },
      { label: 'Выйти', w: 96, action: () => { save.write(); co.leave(); } },
    ] : [
      { label: next && next.kind === 'level' ? `В путь: ${next.title.split('. ')[1] ?? ''} →` : 'В путь! →', w: 364, action: () => this.leave() },
      { label: 'Главы', w: 96, action: () => { if (save.data.reached >= 2) this.openChapters(); } },
      { label: 'Меню', w: 96, action: () => { save.write(); game.toMenu(); } },
    ];
    // «Настройки» before the last button (the row keeps its width: 250 + 3 smaller ones)
    const settings = opts.settings;
    if (settings) {
      this.buttons.splice(2, 0, { label: 'Настройки', w: 118, action: () => settings() });
      this.buttons[0].w = 250; this.buttons[1].w = 88; this.buttons[3].w = 88;
    }
    this.anim = new Array(this.items.length + this.buttons.length).fill(0);
    this.greet = shop?.greet ?? greet(visit, !!coop);
    this.bubble = this.greet[0];
    this.sel = this.items.length; // start on "go on" so a stray key never buys anything
    if (!shop) audio.playMusic('den');
    save.write();
  }

  // ── layout ──
  cardRect(i: number) { const c = i % COLS, r = Math.floor(i / COLS); return { x: GX + c * (CARD_W + GAP), y: GY + r * (CARD_H + GAP), w: CARD_W, h: CARD_H }; }
  buttonRect(j: number) {
    let x = PX + 20;
    for (let k = 0; k < j; k++) x += this.buttons[k].w + 12;
    return { x, y: PY + PH - 62, w: this.buttons[j].w, h: 46 };
  }
  private rect(i: number) { return i < this.items.length ? this.cardRect(i) : this.buttonRect(i - this.items.length); }

  purchase(it: ShopItem) {
    const why = it.locked();
    if (why) { this.say(it.key === 'bag' || it.key === 'nutSling' ? 'Этого тебе пока не надо. Найди сперва рогатку!' : `${why}.`); audio.sfx('denied'); return; }
    if (it.soldOut()) { this.say(it.key === 'honey' ? 'Больше трёх баночек не унесёшь!' : this.react.sold[0]); audio.sfx('denied'); return; }
    const price = it.price();
    const have = it.cur === 'nut' ? save.data.nuts : save.data.crumbs;
    if (have < price) { this.say(pick(it.cur === 'nut' ? this.react.poorNut : this.react.poor)); audio.sfx('denied'); return; }
    if (it.cur === 'nut') save.data.nuts -= price; else save.data.crumbs -= price;
    it.buy();
    save.write();
    audio.sfx('buy');
    this.say(pick(this.react.buy));
    const r = this.cardRect(this.items.indexOf(it));
    this.fx.emit(r.x + 40, r.y + r.h / 2, { count: 24, speed: [80, 300], life: [0.5, 1], size: [3, 6], colors: ['#ffe14a', '#ffffff', '#ff8a2a'], shape: 'star', g: 300, additive: true });
  }

  say(s: string) { this.bubble = s; this.bubbleT = 0; }

  leave() {
    audio.sfx('door');
    if (this.opts.shop) { this.opts.shop.close(); return; }
    game.advance();
  }

  // ── co-op: ready / go ──
  private coopGoLabel(): string {
    const co = this.coop!;
    const [r, n] = co.count();
    const where = co.next ? `: ${co.next}` : '';
    if (co.host()) {
      if (this.forceT > 0) return 'Точно идём без них? →';
      return n && r < n ? `В путь${where} (${r}/${n}) →` : `В путь${where} →`;
    }
    return co.ready() ? '✓ Готов! (отменить)' : 'Я готов! →';
  }

  private coopGo() {
    const co = this.coop!;
    if (!co.host()) {
      co.toggleReady();
      if (co.ready()) this.say('Подождём остальных. Отдохни у огонька!');
      else { audio.sfx('door'); this.say('Иди, иди, ещё покупай!'); }
      return;
    }
    const [r, n] = co.count();
    if (n && r < n && this.forceT <= 0) {
      this.forceT = 4;
      this.say(`Не все готовы (${r} из ${n})! Нажми ещё раз — пойдёте без них.`);
      audio.sfx('denied');
      return;
    }
    audio.sfx('door');
    co.go();
  }

  private coopDesc(): string {
    const co = this.coop!;
    const b = this.sel - this.items.length;
    if (b === 1) return bindText('Написать друзьям (T).');
    if (b === 2 && this.opts.settings) return 'Звук, картинка, управление, сложность.';
    if (b === this.buttons.length - 1) return 'Покинуть комнату и вернуться в главное меню.';
    const [r, n] = co.count();
    if (co.host()) return n ? `Готовы ${r} из ${n}. Когда все соберутся — веди команду дальше!` : 'Веди команду дальше!';
    return co.ready() ? 'Ты готов. Хозяин комнаты поведёт всех дальше.' : 'Закупись и нажми «Я готов!». Каждый покупает за свои крошки.';
  }

  openChapters() {
    const items = STORY.map((s, i) => ({ s, i })).filter(({ s, i }) => s.kind === 'level' && i <= save.data.reached);
    this.chapters = new MenuList([
      ...items.map(({ s, i }) => ({ label: (s as { title: string }).title, action: () => game.story(i) })),
      { label: 'Назад', action: () => { this.chapters = null; } },
    ], W / 2, 150, { w: 520, h: 52, gap: 10, size: 22 });
  }

  private activate(i: number) {
    if (i < this.items.length) this.purchase(this.items[i]);
    else { audio.sfx('menuSelect'); this.buttons[i - this.items.length].action(); }
  }

  update(dt: number) {
    this.t += dt; this.bubbleT += dt;
    this.forceT = Math.max(0, this.forceT - dt);
    this.fx.update(dt);
    input.menuTick(); // the d-pad steers the shop (no co-op quick phrases here)
    if (this.chapters) {
      if (input.pressed('back')) this.chapters = null;
      else this.chapters.update(dt);
      return;
    }
    if (this.opts.shop && input.pressed('back')) { audio.sfx('menuSelect'); this.opts.shop.close(); return; }
    if (this.opts.settings && (input.pressed('pause') || input.pressed('help'))) { this.opts.settings(); return; }
    const n = this.items.length, nb = this.buttons.length;
    const move = (to: number) => { if (to !== this.sel) { this.sel = to; audio.sfx('menuMove'); } };
    if (input.pressed('down')) {
      if (this.sel < n) move(this.sel + COLS < n ? this.sel + COLS : n);
      else move(this.sel);
    }
    if (input.pressed('up')) {
      if (this.sel >= n) move(n - COLS + Math.min(this.sel - n, COLS - 1));
      else if (this.sel - COLS >= 0) move(this.sel - COLS);
    }
    if (input.pressed('right')) { if (this.sel < n) { if (this.sel % COLS < COLS - 1 && this.sel + 1 < n) move(this.sel + 1); } else move(n + Math.min(nb - 1, this.sel - n + 1)); }
    if (input.pressed('left')) { if (this.sel < n) { if (this.sel % COLS > 0) move(this.sel - 1); } else move(n + Math.max(0, this.sel - n - 1)); }
    for (let i = 0; i < n + nb; i++) {
      const r = this.rect(i);
      if (input.mouseX >= r.x && input.mouseX <= r.x + r.w && input.mouseY >= r.y && input.mouseY <= r.y + r.h) {
        if (input.mouseMoved) move(i);
        if (input.mouseClicked) { this.sel = i; this.activate(i); }
      }
    }
    if (input.pressed('confirm') || input.pressed('jump') || input.pressed('attack')) this.activate(this.sel);
    for (let i = 0; i < n + nb; i++) this.anim[i] = damp(this.anim[i], i === this.sel ? 1 : 0, 14, dt);
    if (this.bubbleT > 6 && this.greetIdx < this.greet.length - 1) { this.greetIdx++; this.say(this.greet[this.greetIdx]); }
    if (Math.random() < 0.3) this.fx.emit(330 + Math.random() * 60, 470, { count: 1, speed: [20, 60], angle: [-2, -1.2], life: [0.6, 1.2], size: [2, 4], colors: ['#ffb02a', '#ffe14a', '#ff6a2a'], g: -80, additive: true });
  }

  render(ctx: C) {
    // den background (2D version)
    const g = ctx.createRadialGradient(400, 380, 50, 400, 380, 900);
    g.addColorStop(0, '#6a3e22'); g.addColorStop(1, '#22120a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 8;
    for (let r = 300; r < 1100; r += 90) { ctx.beginPath(); ctx.arc(400, 760, r, Math.PI, TAU); ctx.stroke(); }
    ctx.strokeStyle = '#3a2010'; ctx.lineWidth = 7;
    const R = srand(5);
    for (let i = 0; i < 7; i++) { const x = R() * W; ctx.beginPath(); ctx.moveTo(x, 0); ctx.quadraticCurveTo(x + 40, 60 + R() * 40, x - 20, 100 + R() * 80); ctx.stroke(); }
    rrect(ctx, 250, 380, 220, 200, 20, '#5a4a4a', 4);
    rrect(ctx, 280, 420, 160, 160, 60, '#1a0a06', 3);
    const fl = Math.sin(this.t * 10) * 6;
    ctx.fillStyle = '#ff6a2a'; ctx.beginPath(); ctx.moveTo(300, 580); ctx.quadraticCurveTo(320, 470 + fl, 360, 440); ctx.quadraticCurveTo(400, 480 - fl, 420, 580); ctx.fill();
    glow(ctx, 360, 520, 380, '#ff9a3a', 0.45 + Math.sin(this.t * 9) * 0.04);
    ctx.fillStyle = '#3a2214'; ctx.fillRect(0, 600, W, H - 600);
    ellipse(ctx, 330, 640, 300, 40, '#a8343a', 4);
    rrect(ctx, 30, 400, 230, 220, 40, '#6a2a5a', 4);
    drawBear(ctx, 145, 600, 1.7, this.t, { talk: this.bubbleT < 1.5 ? Math.abs(Math.sin(this.t * 14)) : 0, facing: 1 });
    drawHero(ctx, 520, 640, 1.9, { t: this.t, facing: -1, state: 'idle', weapon: 'sword' });
    ctx.drawImage(this.vignette, 0, 0, W, H);
    this.renderPanel(ctx, true);
  }

  /** shop panel + bear's speech bubble (used by the 3D den too) */
  renderPanel(ctx: C, withBubble: boolean, bubbleX = 250, bubbleY = 250) {
    if (withBubble && this.bubble) {
      const a = ease.outBack(clamp(this.bubbleT * 4, 0, 1));
      ctx.save(); ctx.translate(bubbleX, bubbleY); ctx.scale(a, a);
      ctx.font = '400 21px Pangolin, sans-serif';
      const lines = wrap(ctx, this.bubble, 330);
      const h = lines.length * 26 + 24;
      rrect(ctx, -10, -h, 370, h, 18, '#fff7e6', 4);
      ctx.beginPath(); ctx.moveTo(30, -3); ctx.lineTo(10, 30); ctx.lineTo(60, -3); ctx.closePath(); ctx.fillStyle = '#fff7e6'; ctx.fill();
      ctx.strokeStyle = OUT; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(30, 0); ctx.lineTo(10, 30); ctx.lineTo(60, 0); ctx.stroke();
      lines.forEach((l, i) => text(ctx, l, 8, -h + 32 + i * 26, { size: 21, font: 'body', color: OUT }));
      ctx.restore();
    }
    rrect(ctx, PX, PY, PW, PH, 26, 'rgba(30,14,10,0.86)', 5);
    text(ctx, this.opts.shop?.title ?? 'Берлога Вторника', PX + 24, PY + 52, { size: 32, color: '#ffd34a', stroke: 6 });
    // wallet
    const d = save.data;
    rrect(ctx, PX + PW - 230, PY + 22, 98, 40, 14, 'rgba(255,255,255,0.12)', 0);
    drawCrumb(ctx, PX + PW - 208, PY + 42, 1.5, 0);
    text(ctx, String(d.crumbs), PX + PW - 190, PY + 52, { size: 22, color: '#ffe0a0', stroke: 5 });
    rrect(ctx, PX + PW - 122, PY + 22, 98, 40, 14, 'rgba(255,255,255,0.12)', 0);
    nutIcon(ctx, PX + PW - 100, PY + 42, 0.6, this.t);
    text(ctx, String(d.nuts), PX + PW - 80, PY + 52, { size: 22, color: '#ffe680', stroke: 5 });
    text(ctx, `♥ ${d.maxHp}   урон ${d.dmg}   горох ${d.ammoMax}   мёд ${d.potions}/3`, PX + 24, PY + 84, { size: 16, font: 'body', color: '#d8c8b0' });
    if (this.chapters) {
      ctx.fillStyle = 'rgba(15,6,12,0.8)'; ctx.fillRect(0, 0, W, H);
      text(ctx, 'Главы', W / 2, 110, { size: 48, color: '#ffd34a', align: 'center', stroke: 8 });
      this.chapters.draw(ctx);
      return;
    }
    // cards
    this.items.forEach((it, i) => {
      const r = this.cardRect(i);
      const a = this.anim[i] ?? 0;
      const why = it.locked();
      const sold = it.soldOut();
      const afford = (it.cur === 'nut' ? d.nuts : d.crumbs) >= it.price();
      ctx.save();
      ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
      const sc = 1 + a * 0.04; ctx.scale(sc, sc);
      const bg = why ? '#4a3a3a' : sold ? '#5a6a4a' : it.cur === 'nut' ? (a > 0.5 ? '#ffe680' : '#f2e2a8') : a > 0.5 ? '#ffd34a' : '#f6ecd2';
      rrect(ctx, -r.w / 2 + 3, -r.h / 2 + 5, r.w, r.h, 14, 'rgba(0,0,0,0.35)', 0);
      rrect(ctx, -r.w / 2, -r.h / 2, r.w, r.h, 14, bg, a > 0.5 ? 4 : 3);
      ctx.restore();
      const ix = r.x + 38, iy = r.y + r.h / 2;
      if (why) text(ctx, '?', ix, iy + 2, { size: 34, color: '#8a7a7a', align: 'center', base: 'middle' });
      else it.icon(ctx, ix, iy, 0.95, this.t);
      const fg = why ? '#b8a8a8' : OUT;
      text(ctx, why ? '???' : it.name, r.x + 72, r.y + 30, { size: 18, color: fg });
      let status: string;
      if (why) status = why;
      else if (sold) status = it.key === 'honey' ? 'полные карманы' : 'куплено';
      else status = String(it.price());
      const sy = r.y + 56;
      if (!why && !sold) {
        if (it.cur === 'nut') nutIcon(ctx, r.x + 84, sy - 6, 0.45, this.t); else drawCrumb(ctx, r.x + 84, sy - 6, 1.1, 0);
        text(ctx, status, r.x + 98, sy, { size: 19, color: afford ? '#3a6a2a' : '#b0453a' });
      } else text(ctx, status, r.x + 72, sy, { size: 16, font: 'body', color: why ? '#a89898' : '#2a4a1a' });
      const lv = it.level?.();
      if (lv && !why) for (let k = 0; k < lv[1]; k++) { ctx.beginPath(); ctx.arc(r.x + r.w - 18 - k * 14, r.y + 18, 5, 0, TAU); ctx.fillStyle = k < lv[0] ? '#3a8a2a' : 'rgba(0,0,0,0.18)'; ctx.fill(); }
    });
    // description of the selected card
    const it = this.items[this.sel];
    const dy = GY + 5 * (CARD_H + GAP) + 18;
    ctx.font = '400 20px Pangolin, sans-serif';
    const desc = it ? (it.locked() ? `Что это? ${this.opts.shop?.keeper ?? 'Медведь'} хитро подмигивает.` : bindText(it.desc)) : this.opts.shop ? 'Закрыть лавку и гулять дальше (Esc).' : this.coop ? this.coopDesc()
      : this.sel === this.items.length ? 'Готов? Тогда вперёд!' : this.opts.settings && this.sel === this.items.length + 2 ? 'Звук, картинка, управление, сложность.' : '';
    wrap(ctx, desc, PW - 48).slice(0, 2).forEach((l, i) => text(ctx, l, PX + 24, dy + i * 25, { size: 20, font: 'body', color: '#f6ecd2' }));
    // buttons
    this.buttons.forEach((b, j) => {
      const i = this.items.length + j;
      const r = this.buttonRect(j);
      const a = this.anim[i] ?? 0;
      const dis = !this.coop && j === 1 && save.data.reached < 2;
      const readyBtn = !!this.coop && j === 0 && !this.coop.host() && this.coop.ready();
      rrect(ctx, r.x + 3, r.y + 5, r.w, r.h, 14, 'rgba(0,0,0,0.35)', 0);
      rrect(ctx, r.x, r.y, r.w, r.h, 14, dis ? '#6a5a5a' : a > 0.5 ? '#ffd34a' : readyBtn ? '#5ac85a' : j === 0 ? '#9ae06a' : '#f6ecd2', a > 0.5 ? 4 : 3);
      // a long label shrinks to fit its button
      const label = typeof b.label === 'function' ? b.label() : b.label;
      const fs = j === 0 ? 18 : 17;
      ctx.font = `900 ${fs}px Rubik, "Arial Black", sans-serif`;
      const tw = ctx.measureText(label).width;
      text(ctx, label, r.x + r.w / 2, r.y + r.h / 2 + 2, { size: tw > r.w - 16 ? Math.max(11, Math.floor(fs * (r.w - 16) / tw)) : fs, color: dis ? '#a89898' : OUT, align: 'center', base: 'middle' });
    });
    this.fx.draw(ctx);
  }
}

function pick<T>(a: T[]): T { return a[Math.floor(Math.random() * a.length)]; }


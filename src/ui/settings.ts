import { W, H, clamp, damp, ease } from '../engine/util';
import {
  input, BIND_ACTIONS, BIND_SLOTS, DEFAULT_KB, DEFAULT_PAD, PAD_FIXED_ACTIONS, RESERVED_KEYS, RESERVED_PAD, bindCode,
  type BindAction, type Captured,
} from '../engine/input';
import { PB } from '../engine/pads';
import { audio } from '../engine/audio';
import { save } from '../engine/save';
import { rrect, rrPath, fillStroke, text, wrap, OUT } from '../art/draw';
import { drawHint, drawKeyCode, keyCodeWidth, drawPadButton, drawGlyph, glyphDevice, keyLabel, padButtonLabel, type GlyphDevice } from './glyphs';
import { QUICK_PHRASES } from './chat';
import { RT } from '../three/runtime';
import { net } from '../net/session';
import { coop, DIFF_NAME, DIFF_COLOR, type Difficulty } from '../three/game/coop';

/*
 * «Настройки»: one panel for sound, picture, controls (the full table, rebinding keyboard / mouse / pad) and
 * difficulty, opened from everywhere — the main menu, the pause menu (solo and co-op), the co-op lobby, the den,
 * and F1 in a level. Canvas UI like the rest (1280×720 logical), mouse + keyboard + pad. Everything is saved in
 * save.data.settings at once; applySettings() puts the saved state into audio / renderer / input at boot.
 */

type C = CanvasRenderingContext2D;
type PadDev = Exclude<GlyphDevice, 'kb'>;
export type SettingsTab = 'sound' | 'video' | 'controls' | 'diff';
const TABS: [SettingsTab, string][] = [['sound', 'Звук'], ['video', 'Изображение'], ['controls', 'Управление'], ['diff', 'Сложность']];

// ───────────────────────── applying the saved settings ─────────────────────────

/** volumes → audio (music, sounds, master) and friends' voices */
export function applyAudio() {
  const s = save.data.settings;
  audio.setMasterVolume(s.master);
  audio.setMusicVolume(s.music);
  audio.setSfxVolume(s.sfx);
  applyVoice();
}

/**
 * Friends' voices: net/voice.ts reads settings.voice (slider 0..1) / settings.voice3d on its own (voiceHud's timer);
 * this pushes a change at once. Feature-detected so an older voice module just ignores it.
 */
export function applyVoice() {
  const s = save.data.settings;
  const v = net.voice as unknown as { setVolume?: (x: number) => void; setSpatial?: (on: boolean) => void };
  try { v.setVolume?.(s.voice); } catch { /* older API */ }
  try { v.setSpatial?.(s.voice3d); } catch { /* older API */ }
}

/** outlines, soft shadows, resolution → the renderer */
export function applyVideo() {
  const s = save.data.settings, r = RT.r3;
  if (!r) return;
  r.outlines = s.outlines;
  r.ao = s.ao;
  r.setMaxRatio(s.res);
}

/** binds + rumble → input */
export function applyControls() {
  const s = save.data.settings;
  input.setBinds(s.binds);
  input.rumbleEnabled = s.rumble;
}

export function applySettings() { applyAudio(); applyVideo(); applyControls(); }

/** true only the first time for this key (remembered in the settings, so «Новая игра» doesn't repeat it) */
export function seenOnce(key: string): boolean {
  const seen = save.data.settings.seen;
  if (seen.includes(key)) return false;
  seen.push(key);
  save.write();
  return true;
}

// ───────────────────────── action names ─────────────────────────

export const BIND_LABEL: Record<BindAction, string> = {
  fwd: 'Вперёд', bwd: 'Назад', left: 'Влево', right: 'Вправо',
  jump: 'Прыжок (в воздухе — двойной)', attack: 'Удар', shoot: 'Рогатка (держи — целиться)', dash: 'Рывок',
  special: 'Приём героя (у Тоши — рывок)',
  swap: 'Сменить оружие', heal: 'Съесть мёд', interact: 'Поднять друга, подарить мёд',
  camL: 'Повернуть камеру влево', camR: 'Повернуть камеру вправо', zoomOut: 'Отдалить камеру', zoomIn: 'Приблизить камеру',
  pause: 'Пауза (ещё Esc / Options)', chat: 'Чат', talk: 'Говорить (держать)', score: 'Таблица очков (держать)',
  ping: 'Метка «сюда»', emote: 'Эмоция',
  qp1: `Фраза «${QUICK_PHRASES[0]}»`, qp2: `Фраза «${QUICK_PHRASES[1]}»`, qp3: `Фраза «${QUICK_PHRASES[2]}»`, qp4: `Фраза «${QUICK_PHRASES[3]}»`,
};
/** buttons that share one pad button on purpose (R3: tap = swap, hold = emote) */
const PAD_PAIR: BindAction[][] = [['swap', 'emote']];

/** pad glyph family for the table: the pad in hand, else Xbox letters */
function padDev(): PadDev {
  const g = glyphDevice();
  if (g !== 'kb') return g;
  const k = input.padKind;
  return k === 'ps4' || k === 'ps5' || k === 'switch' ? k : 'xbox';
}

// ───────────────────────── rebinding ─────────────────────────

const same = <T>(a: T[], b: T[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** store an action's binds (only differences from the defaults are kept) and apply them */
function storeBinds(a: BindAction, kb: string[], pad: number[]) {
  const b = save.data.settings.binds;
  if (same(kb, DEFAULT_KB[a])) delete b.kb[a]; else b.kb[a] = kb.slice();
  if (same(pad, DEFAULT_PAD[a])) delete b.pad[a]; else b.pad[a] = pad.slice();
}

/**
 * Put `code` into slot `slot` of action `a` (keyboard/mouse codes or pad buttons). Another action that had it gets
 * this slot's old key instead (a swap) or loses it; returns a note for the player about that.
 */
export function assignBind(a: BindAction, dev: 'kb' | 'pad', slot: number, code: string | number): string {
  const mine = input.bindsOf(a);
  const list: (string | number)[] = dev === 'kb' ? mine.kb : mine.pad;
  const old = list[slot];
  let note = '';
  for (const o of BIND_ACTIONS) {
    if (o === a) continue;
    const ob = input.bindsOf(o);
    const ol: (string | number)[] = dev === 'kb' ? ob.kb : ob.pad;
    const at = ol.indexOf(code);
    if (at < 0) continue;
    if (dev === 'pad' && PAD_PAIR.some((p) => p.includes(a) && p.includes(o))) continue;
    if (old !== undefined && !ol.includes(old) && !(dev === 'pad' && PAD_FIXED_ACTIONS.has(o))) {
      ol[at] = old;
      note = `«${BIND_LABEL[o]}» теперь на ${dev === 'kb' ? keyLabel(old as string) : padButtonLabel(padDev(), old as number)}`;
    } else {
      ol.splice(at, 1);
      note = `У «${BIND_LABEL[o]}» больше нет ${dev === 'kb' ? keyLabel(code as string) : padButtonLabel(padDev(), code as number)}`;
    }
    storeBinds(o, ob.kb, ob.pad);
  }
  const dup = list.indexOf(code);
  if (dup >= 0 && dup !== slot) list.splice(dup, 1);
  if (slot < list.length) list[slot] = code; else list.push(code);
  list.splice(BIND_SLOTS);
  storeBinds(a, mine.kb, mine.pad);
  input.setBinds(save.data.settings.binds);
  save.write();
  return note;
}

/** clear one slot (the action keeps its other one) */
function clearBind(a: BindAction, dev: 'kb' | 'pad', slot: number) {
  const b = input.bindsOf(a);
  if (dev === 'kb') b.kb.splice(slot, 1); else b.pad.splice(slot, 1);
  storeBinds(a, b.kb, b.pad);
  input.setBinds(save.data.settings.binds);
  save.write();
}

export function resetBind(a: BindAction) {
  const b = save.data.settings.binds;
  delete b.kb[a]; delete b.pad[a];
  input.setBinds(b);
  save.write();
}

export function resetAllBinds() {
  save.data.settings.binds = { kb: {}, pad: {} };
  input.setBinds(save.data.settings.binds);
  save.write();
}

// ───────────────────────── the panel ─────────────────────────

type RowKind = 'slider' | 'toggle' | 'bind' | 'button' | 'info' | 'head' | 'note';
interface Row {
  kind: RowKind;
  label: string | (() => string);
  help?: string | (() => string);
  disabled?: () => boolean;
  /** slider */
  get?: () => number; set?: (v: number) => void; min?: number; max?: number; step?: number; fmt?: (v: number) => string;
  /** toggle / choice */
  value?: () => string; prev?: () => void; next?: () => void;
  /** button */
  act?: () => void;
  /** bind */
  bind?: BindAction;
  /** info: what the keyboard / pad columns say (fixed controls) */
  kbText?: string; padText?: string | (() => string);
  /** note: a paragraph */
  color?: () => string;
}

const PX = 104, PY = 22, PW = 1072, PH = 676;
const CX = PX + 34, CW = PW - 68, CY = PY + 140, CH = 440;
const TAB_W = 218, TAB_H = 46, TAB_Y = PY + 78;
/** controls table columns: keyboard slots, pad slots, reset */
const COLS = [{ x: CX + 336, w: 140 }, { x: CX + 484, w: 140 }, { x: CX + 652, w: 112 }, { x: CX + 772, w: 112 }, { x: CX + 900, w: 52 }];
const BAR_X = CX + 400, BAR_W = 430;
const ROW_H: Record<RowKind, number> = { slider: 50, toggle: 50, bind: 40, button: 54, info: 38, head: 34, note: 64 };
const CLOSE = { x: PX + PW - 66, y: PY + 16, w: 50, h: 50 };

export interface SettingsOpts {
  tab?: SettingsTab;
  onClose: () => void;
  /** where it's open: the difficulty page says what can be changed there */
  where?: 'menu' | 'level' | 'lobby' | 'den';
  /** co-op lobby host: step the room's difficulty */
  roomDiff?: (d: number) => void;
}

const DIFF_TEXT: Record<Difficulty, string> = {
  easy: 'Лёгкая: +3 сердечка, крошки при падении не теряются, Король медленнее.',
  normal: 'Нормальная: как задумано.',
  hard: 'Хардкор: падение в библиотеке — нокаут, выход только всей командой, враги крепче, сердечек меньше.',
};

export class SettingsPanel {
  tab: SettingsTab;
  t = 0;
  closed = false;
  /** selected row in the tab (-1 = the tab bar) */
  sel = 0;
  /** controls table: selected cell (0-1 keyboard slots, 2-3 pad slots, 4 reset) */
  cell = 0;
  private rows: Row[] = [];
  private scroll = 0;
  private scrollWant = 0;
  private dragging = false;
  private msg: { text: string; t: number; bad: boolean } | null = null;
  /** waiting for a key / button for this action and slot */
  private wait: { a: BindAction; dev: 'kb' | 'pad'; slot: number; t: number } | null = null;

  constructor(private o: SettingsOpts) {
    this.tab = o.tab ?? 'sound';
    this.build();
    this.sel = this.firstSel();
    if (this.tab === 'controls') this.sel = this.rows.findIndex((r) => r.kind === 'bind');
    this.scrollTo(true);
  }

  // ── rows ──
  private build() {
    const s = save.data.settings;
    const vol = (k: 'master' | 'music' | 'sfx' | 'voice', label: string, help: string, after: () => void): Row => ({
      kind: 'slider', label, help, min: 0, max: 1, step: 0.05,
      get: () => s[k], set: (v) => { s[k] = v; after(); save.write(); },
      fmt: (v) => (v <= 0 ? 'выкл' : `${Math.round(v * 20)} / 20`),
    });
    const toggle = (label: string, get: () => boolean, set: (on: boolean) => void, help?: string, on = 'да', off = 'нет'): Row => ({
      kind: 'toggle', label, help, value: () => (get() ? on : off), prev: () => set(!get()), next: () => set(!get()),
    });
    const choice = <T>(label: string, list: [T, string][], get: () => T, set: (v: T) => void, help?: string | (() => string), disabled?: () => boolean): Row => {
      const at = () => Math.max(0, list.findIndex(([v]) => v === get()));
      return {
        kind: 'toggle', label, help, disabled,
        value: () => list[at()][1],
        prev: () => set(list[(at() - 1 + list.length) % list.length][0]),
        next: () => set(list[(at() + 1) % list.length][0]),
      };
    };
    const w = <A extends unknown[]>(fn: (...a: A) => void) => (...a: A) => { fn(...a); save.write(); };
    if (this.tab === 'sound') {
      this.rows = [
        vol('master', 'Общая громкость', 'Всё сразу: музыка и звуки. Шкала по слуху — первый шаг еле слышно.', () => audio.setMasterVolume(s.master)),
        vol('music', 'Музыка', 'Громкость музыки.', () => audio.setMusicVolume(s.music)),
        vol('sfx', 'Звуки', 'Удары, прыжки, крошки…', () => { audio.setSfxVolume(s.sfx); audio.sfx('coin'); }),
        vol('voice', 'Голоса друзей', 'Как громко слышно друзей в голосовом чате.', applyVoice),
        toggle('Голос в пространстве', () => s.voice3d, (on) => { s.voice3d = on; applyVoice(); save.write(); },
          'Вкл: друга слышно оттуда, где стоит его Тоша — слева, справа, издалека. Выкл: как по рации, всех одинаково.', 'вкл', 'выкл'),
        toggle('Микрофон', () => net.voice.ptt, (on) => net.voice.setPTT(on),
          'По кнопке: тебя слышно, пока держишь «Говорить». Всегда: пока микрофон включён (включается в комнате → Голос).', 'по кнопке', 'всегда'),
      ];
    } else if (this.tab === 'video') {
      const fs = () => !!document.fullscreenElement;
      this.rows = [
        toggle('Полный экран', fs, () => { try { if (!fs()) void document.documentElement.requestFullscreen(); else void document.exitFullscreen(); } catch { /* not allowed */ } }),
        toggle('Контуры', () => s.outlines, w(() => { s.outlines = !s.outlines; applyVideo(); }), 'Мультяшная обводка вокруг всего.'),
        toggle('Мягкие тени', () => s.ao, w(() => { s.ao = !s.ao; applyVideo(); }), 'Тени в углах и под предметами. Выключи, если игра подтормаживает.'),
        choice('Чёткость', [[1.5, 'высокая'], [1, 'средняя'], [0.75, 'низкая']], () => s.res, w((v: number) => { s.res = v; applyVideo(); }),
          'Ниже — быстрее на слабом компьютере, но картинка мягче.'),
        toggle('Тряска экрана', () => s.shake, w(() => { s.shake = !s.shake; })),
        { kind: 'slider', label: 'Дальность камеры', min: 4, max: 13, step: 0.5, get: () => s.camDist, set: (v) => { s.camDist = v; save.write(); }, fmt: (v) => `${v.toFixed(1)} м`,
          help: () => `В игре — колёсико мыши или ${keyName('zoomOut')} / ${keyName('zoomIn')}. Дальше видно больше вокруг.` },
        { kind: 'slider', label: 'Поле зрения', min: 50, max: 80, step: 2, get: () => s.fov, set: (v) => { s.fov = v; save.write(); }, fmt: (v) => `${v}°`,
          help: 'Шире — видно больше по бокам, но всё мельче.' },
      ];
    } else if (this.tab === 'controls') {
      const sens = (k: 'sens' | 'padSens', label: string, help: string): Row => ({
        kind: 'slider', label, help, min: 0.2, max: 3, step: 0.2, get: () => s[k], set: (v) => { s[k] = v; save.write(); }, fmt: (v) => `×${v.toFixed(1)}`,
      });
      this.rows = [
        sens('sens', 'Чувствительность мыши', 'Как быстро камера поворачивается за мышью.'),
        sens('padSens', 'Чувствительность стика', 'Как быстро камера поворачивается правым стиком.'),
        toggle('Инвертировать по вертикали', () => s.invertY, w(() => { s.invertY = !s.invertY; }), 'Мышь / стик вверх — камера смотрит вниз, как в самолёте.'),
        toggle('Вибрация геймпада', () => s.rumble, w(() => { s.rumble = !s.rumble; applyControls(); })),
        { kind: 'head', label: 'Действие' },
        ...BIND_ACTIONS.map((a): Row => ({ kind: 'bind', label: BIND_LABEL[a], bind: a })),
        { kind: 'info', label: 'Камера', kbText: 'Мышь (кликни по экрану)', padText: 'Правый стик' },
        { kind: 'info', label: 'Отдалить / приблизить', kbText: 'Колёсико мыши', padText: 'кнопки выше' },
        { kind: 'info', label: 'Меню: выбрать / назад', kbText: 'Enter, Пробел / Esc', padText: () => `${padButtonLabel(padDev(), PB.SOUTH)} / ${padButtonLabel(padDev(), PB.EAST)}, крестовина` },
        { kind: 'info', label: 'Управление и настройки', kbText: 'F1 (в игре)', padText: () => `${padButtonLabel(padDev(), PB.START)} → Настройки` },
        { kind: 'button', label: 'Сбросить всё управление', act: () => { resetAllBinds(); this.say('Управление как было с самого начала'); } },
      ];
    } else {
      const room = net.active;
      const solo = choice('Сложность', [[true, 'полегче'], [false, 'нормально']] as [boolean, string][], () => s.easy, w((v: boolean) => { s.easy = v; }),
        () => (s.easy ? DIFF_TEXT.easy : DIFF_TEXT.normal) + (this.o.where === 'level' && !room ? ' Сменится после свечки или новой главы.' : ''));
      if (!room) this.rows = [solo, { kind: 'note', label: 'Это твоя сложность в одиночной игре. В комнате с друзьями сложность выбирает хозяин.' }];
      else {
        const canEdit = !!this.o.roomDiff;
        const why = canEdit ? 'Ты хозяин: сложность для всей комнаты.' : net.isHost ? 'Поменять можно в лобби между главами.' : 'Сложность комнаты выбирает хозяин в лобби.';
        this.rows = [
          {
            kind: 'toggle', label: 'Сложность комнаты', value: () => DIFF_NAME[coop.cfgDiff()],
            prev: () => this.o.roomDiff?.(-1), next: () => this.o.roomDiff?.(1), disabled: () => !this.o.roomDiff,
            help: () => DIFF_TEXT[coop.cfgDiff()],
          },
          { kind: 'note', label: () => `${why} ${DIFF_TEXT[coop.cfgDiff()]}`, color: () => DIFF_COLOR[coop.cfgDiff()] },
          { ...solo, label: 'Своя (одиночная игра)', help: () => (s.easy ? DIFF_TEXT.easy : DIFF_TEXT.normal) + ' Действует, когда играешь один.' },
        ];
      }
    }
  }

  private selectable(i: number) {
    const r = this.rows[i];
    return !!r && (r.kind === 'slider' || r.kind === 'toggle' || r.kind === 'bind' || r.kind === 'button');
  }
  private firstSel() { for (let i = 0; i < this.rows.length; i++) if (this.selectable(i)) return i; return -1; }
  private rowY(i: number) { let y = 0; for (let k = 0; k < i; k++) y += ROW_H[this.rows[k].kind]; return y; }
  private contentH() { return this.rowY(this.rows.length); }
  private scrollTo(now = false) {
    if (this.sel < 0) { this.scrollWant = 0; }
    else {
      const top = this.rowY(this.sel), bot = top + ROW_H[this.rows[this.sel].kind];
      // keep a row of context above / below
      if (top - 40 < this.scrollWant) this.scrollWant = top - 40;
      if (bot + 40 > this.scrollWant + CH) this.scrollWant = bot + 40 - CH;
    }
    this.scrollWant = clamp(this.scrollWant, 0, Math.max(0, this.contentH() - CH));
    if (now) this.scroll = this.scrollWant;
  }

  setTab(t: SettingsTab) {
    if (t === this.tab) return;
    this.tab = t;
    this.build();
    this.sel = -1;
    this.scroll = this.scrollWant = 0;
    audio.sfx('menuMove');
  }
  private stepTab(d: number) {
    const i = TABS.findIndex(([k]) => k === this.tab);
    this.setTab(TABS[(i + d + TABS.length) % TABS.length][0]);
  }

  private say(s: string, bad = false) { this.msg = { text: s, t: 0, bad }; }

  /** the scene goes away under the panel: drop a rebind in progress (no onClose) */
  dispose() {
    if (this.wait) input.stopCapture();
    this.wait = null;
  }

  close() {
    if (this.closed) return;
    input.stopCapture();
    this.closed = true;
    save.write();
    audio.sfx('menuMove');
    this.o.onClose();
  }

  // ── update ──
  update(dt: number) {
    this.t += dt;
    input.menuTick(); // the d-pad steers this panel (no co-op quick phrases)
    if (this.msg) { this.msg.t += dt; if (this.msg.t > 4) this.msg = null; }
    this.scroll = damp(this.scroll, this.scrollWant, 16, dt);
    if (this.wait) {
      this.wait.t += dt;
      // the capture is one-shot; it lands in onCapture. Give up after a while
      if (this.wait.t > 10) { input.stopCapture(); this.wait = null; this.say('Не дождались — оставили как было'); }
      input.wheel = 0;
      return;
    }
    if (input.pressed('back') || input.pressed('pause')) { this.close(); return; }
    if (input.pressed('help')) { this.setTab('controls'); this.sel = this.rows.findIndex((r) => r.kind === 'bind'); this.scrollTo(true); }
    if (input.keyHit('KeyQ') || input.padHit(PB.L1)) this.stepTab(-1);
    if (input.keyHit('KeyE') || input.padHit(PB.R1)) this.stepTab(1);
    this.keys();
    this.mouse();
    input.wheel = 0; // the camera behind must not zoom while this scrolls
  }

  private move(d: number) {
    const n = this.rows.length;
    let i = this.sel;
    for (let k = 0; k < n + 1; k++) {
      i += d;
      if (i < 0 || i >= n) { i = -1; break; }
      if (this.selectable(i)) break;
    }
    if (i === -1 && d > 0 && this.sel === -1) i = this.firstSel();
    if (i === -1 && d > 0) i = this.sel; // bottom: stay
    this.sel = i;
    this.scrollTo();
    audio.sfx('menuMove');
  }

  private keys() {
    if (input.pressed('down')) this.move(1);
    if (input.pressed('up')) { if (this.sel >= 0) this.move(-1); }
    const l = input.pressed('left'), r = input.pressed('right');
    const ok = input.pressed('confirm') || input.pressed('attack') || (input.pressed('jump') && !input.down('up'));
    if (this.sel < 0) {
      if (l) this.stepTab(-1);
      if (r) this.stepTab(1);
      if (ok) this.move(1);
      return;
    }
    const row = this.rows[this.sel];
    if (!row || row.disabled?.()) return;
    if (row.kind === 'slider') {
      if (l) this.nudge(row, -1);
      if (r) this.nudge(row, 1);
    } else if (row.kind === 'toggle') {
      if (l) { row.prev?.(); audio.sfx('menuMove'); }
      if (r || ok) { row.next?.(); audio.sfx('menuMove'); }
    } else if (row.kind === 'button') {
      if (ok) { audio.sfx('menuSelect'); row.act?.(); }
    } else if (row.kind === 'bind') {
      const cells = this.cellsOf(row.bind!);
      if (!cells.includes(this.cell)) this.cell = cells[0];
      const at = cells.indexOf(this.cell);
      if (l && at > 0) { this.cell = cells[at - 1]; audio.sfx('menuMove'); }
      if (r && at < cells.length - 1) { this.cell = cells[at + 1]; audio.sfx('menuMove'); }
      if (ok) this.activateCell(row.bind!, this.cell);
    }
  }

  private nudge(row: Row, d: number) {
    const v = clamp(Math.round(((row.get!() + d * row.step!) - row.min!) / row.step!) * row.step! + row.min!, row.min!, row.max!);
    const fixed = +v.toFixed(3);
    if (fixed !== row.get!()) { row.set!(fixed); audio.sfx('menuMove'); }
  }

  /** cells of a bind row the cursor can stand on */
  private cellsOf(a: BindAction): number[] {
    return PAD_FIXED_ACTIONS.has(a) ? [0, 1, 4] : [0, 1, 2, 3, 4];
  }

  private activateCell(a: BindAction, c: number) {
    audio.sfx('menuSelect');
    if (c === 4) { resetBind(a); this.say(`«${BIND_LABEL[a]}» — как было`); return; }
    const dev = c < 2 ? 'kb' : 'pad';
    const b = input.bindsOf(a);
    const slot = Math.min(c % 2, (dev === 'kb' ? b.kb : b.pad).length);
    this.wait = { a, dev, slot, t: 0 };
    input.startCapture((cap) => this.onCapture(cap));
  }

  private onCapture(c: Captured) {
    const w = this.wait;
    if (!w) return;
    const again = (why: string) => { this.say(why, true); input.startCapture((cap) => this.onCapture(cap)); };
    const done = (note: string) => {
      this.wait = null;
      audio.sfx('checkpoint', { volume: 0.5 });
      this.say(note || `Готово: «${BIND_LABEL[w.a]}»`);
    };
    const cancel = () => { this.wait = null; audio.sfx('menuMove'); };
    if (c.kind === 'key') {
      if (c.code === 'Escape') { cancel(); return; }
      if (w.dev === 'pad') { again('Нажми кнопку на геймпаде (Esc — отмена)'); return; }
      // Delete / Backspace clears the second slot
      if ((c.code === 'Delete' || c.code === 'Backspace') && w.slot > 0) { clearBind(w.a, 'kb', w.slot); this.wait = null; this.say('Вторая клавиша убрана'); return; }
      if (RESERVED_KEYS.has(c.code)) { again(`${keyLabel(c.code)} — занята меню или браузером, выбери другую`); return; }
      done(assignBind(w.a, 'kb', w.slot, bindCode(c.code)));
    } else if (c.kind === 'mouse') {
      if (w.dev === 'pad' || inRect(c.x, c.y, this.cancelRect())) { cancel(); return; }
      done(assignBind(w.a, 'kb', w.slot, c.code));
    } else {
      if (c.button === PB.START) { cancel(); return; }
      if (w.dev === 'kb') { if (c.button === PB.EAST) cancel(); else again('Нажми клавишу или кнопку мыши (○ / B — отмена)'); return; }
      if (RESERVED_PAD.has(c.button)) { again('Крестовина и Options заняты меню — выбери другую кнопку'); return; }
      done(assignBind(w.a, 'pad', w.slot, c.button));
    }
  }

  // ── mouse ──
  private rowAt(my: number): number {
    if (my < CY || my > CY + CH) return -1;
    let y = CY - this.scroll;
    for (let i = 0; i < this.rows.length; i++) {
      const h = ROW_H[this.rows[i].kind];
      if (my >= y && my < y + h) return i;
      y += h;
    }
    return -1;
  }

  private mouse() {
    const mx = input.mouseX, my = input.mouseY;
    if (input.wheel && this.contentH() > CH) {
      this.scrollWant = clamp(this.scrollWant + input.wheel * 80, 0, this.contentH() - CH);
    }
    if (!input.mouseDown) this.dragging = false;
    if (input.mouseClicked && inRect(mx, my, CLOSE)) { this.close(); return; }
    // tabs
    for (let i = 0; i < TABS.length; i++) {
      const r = { x: CX + i * (TAB_W + 10), y: TAB_Y, w: TAB_W, h: TAB_H };
      if (input.mouseClicked && inRect(mx, my, r)) { this.setTab(TABS[i][0]); return; }
    }
    const i = this.rowAt(my);
    const inside = mx >= CX && mx <= CX + CW;
    if ((input.mouseMoved || input.mouseClicked) && inside && i >= 0 && this.selectable(i) && i !== this.sel && !this.dragging) this.sel = i;
    const row = this.rows[this.sel];
    if (row?.kind === 'bind' && (input.mouseMoved || input.mouseClicked) && i === this.sel) {
      for (const c of this.cellsOf(row.bind!)) if (mx >= COLS[c].x && mx <= COLS[c].x + COLS[c].w) this.cell = c;
    }
    // slider drag
    if (row?.kind === 'slider' && !row.disabled?.() && (this.dragging || (input.mouseClicked && i === this.sel && mx >= BAR_X - 12 && mx <= BAR_X + BAR_W + 12))) {
      this.dragging = input.mouseDown || input.mouseClicked;
      const k = clamp((mx - BAR_X) / BAR_W, 0, 1);
      const v = +(Math.round((row.min! + k * (row.max! - row.min!) - row.min!) / row.step!) * row.step! + row.min!).toFixed(3);
      if (v !== row.get!()) row.set!(clamp(v, row.min!, row.max!));
      return;
    }
    if (!input.mouseClicked || !inside || i < 0 || i !== this.sel || !row || row.disabled?.()) return;
    if (row.kind === 'toggle') {
      if (mx < BAR_X + BAR_W / 2 - 60 && mx >= BAR_X) row.prev?.(); else row.next?.();
      audio.sfx('menuMove');
    } else if (row.kind === 'button') { audio.sfx('menuSelect'); row.act?.(); }
    else if (row.kind === 'bind') {
      for (const c of this.cellsOf(row.bind!)) if (mx >= COLS[c].x && mx <= COLS[c].x + COLS[c].w) { this.cell = c; this.activateCell(row.bind!, c); }
    }
  }

  private cancelRect() { return { x: W / 2 - 90, y: H / 2 + 34, w: 180, h: 46 }; }

  // ── draw ──
  draw(ctx: C) {
    const a = ease.outBack(clamp(this.t * 6, 0, 1));
    ctx.save();
    ctx.fillStyle = `rgba(12,6,14,${0.72 * clamp(this.t * 8, 0, 1)})`; ctx.fillRect(-2000, -2000, W + 4000, H + 4000);
    ctx.translate(W / 2, H / 2); ctx.scale(0.94 + 0.06 * a, 0.94 + 0.06 * a); ctx.translate(-W / 2, -H / 2);
    rrect(ctx, PX + 5, PY + 8, PW, PH, 28, 'rgba(0,0,0,0.35)', 0);
    rrect(ctx, PX, PY, PW, PH, 28, 'rgba(32,16,12,0.95)', 5);
    text(ctx, 'Настройки', CX, PY + 56, { size: 40, color: '#ffd34a', stroke: 7 });
    // close button
    const hov = inRect(input.mouseX, input.mouseY, CLOSE);
    rrect(ctx, CLOSE.x, CLOSE.y, CLOSE.w, CLOSE.h, 16, hov ? '#ffd34a' : '#f6ecd2', 4);
    text(ctx, '✕', CLOSE.x + CLOSE.w / 2, CLOSE.y + CLOSE.h / 2 + 2, { size: 26, color: OUT, align: 'center', base: 'middle' });
    this.drawTabs(ctx);
    // rows
    ctx.save();
    ctx.beginPath(); ctx.rect(CX - 14, CY - 4, CW + 28, CH + 8); ctx.clip();
    let y = CY - this.scroll;
    this.rows.forEach((r, i) => {
      const h = ROW_H[r.kind];
      if (y + h > CY - 4 && y < CY + CH + 4) this.drawRow(ctx, r, i, y, h);
      y += h;
    });
    ctx.restore();
    // scroll bar
    const total = this.contentH();
    if (total > CH) {
      const bh = Math.max(40, CH * CH / total), by = CY + (CH - bh) * (this.scroll / (total - CH));
      rrect(ctx, PX + PW - 22, CY, 8, CH, 4, 'rgba(255,255,255,0.08)', 0);
      rrect(ctx, PX + PW - 22, by, 8, bh, 4, 'rgba(255,211,74,0.7)', 0);
    }
    this.drawFooter(ctx);
    ctx.restore();
    if (this.wait) this.drawWait(ctx);
  }

  private drawTabs(ctx: C) {
    TABS.forEach(([k, label], i) => {
      const x = CX + i * (TAB_W + 10);
      const on = k === this.tab;
      const focus = on && this.sel < 0;
      const hov = inRect(input.mouseX, input.mouseY, { x, y: TAB_Y, w: TAB_W, h: TAB_H });
      rrect(ctx, x, TAB_Y, TAB_W, TAB_H, 16, on ? '#ffd34a' : hov ? '#fff3d8' : 'rgba(246,236,210,0.75)', focus ? 5 : 3);
      if (focus) { ctx.save(); ctx.globalAlpha = 0.6 + Math.sin(this.t * 6) * 0.35; rrPath(ctx, x - 6, TAB_Y - 6, TAB_W + 12, TAB_H + 12, 21); fillStroke(ctx, null, 3, '#fff3d8'); ctx.restore(); }
      text(ctx, label, x + TAB_W / 2, TAB_Y + TAB_H / 2 + 2, { size: 21, color: OUT, align: 'center', base: 'middle' });
    });
  }

  private drawRow(ctx: C, r: Row, i: number, y: number, h: number) {
    const sel = i === this.sel;
    const dis = r.disabled?.() ?? false;
    const label = typeof r.label === 'function' ? r.label() : r.label;
    if (sel) {
      rrect(ctx, CX - 8, y + 3, CW + 16, h - 6, 14, 'rgba(255,211,74,0.16)', 0);
      ctx.fillStyle = '#ffd34a'; ctx.fillRect(CX - 8, y + 9, 5, h - 18);
    }
    const mid = y + h / 2;
    const lc = dis ? '#9a8a80' : '#fff3d8';
    switch (r.kind) {
      case 'head': {
        text(ctx, label, CX + 14, mid + 6, { size: 16, color: '#d8c8b0' });
        text(ctx, 'Клавиатура и мышь', COLS[0].x + (COLS[1].x + COLS[1].w - COLS[0].x) / 2, mid + 6, { size: 16, color: '#d8c8b0', align: 'center' });
        text(ctx, 'Геймпад', COLS[2].x + (COLS[3].x + COLS[3].w - COLS[2].x) / 2, mid + 6, { size: 16, color: '#d8c8b0', align: 'center' });
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(CX, y + h - 2, CW, 2);
        return;
      }
      case 'note': {
        ctx.font = '400 19px Pangolin, sans-serif';
        wrap(ctx, label, CW - 40).slice(0, 2).forEach((l, k) => text(ctx, l, CX + 14, y + 26 + k * 24, { size: 19, font: 'body', color: r.color?.() ?? '#d8c8b0' }));
        return;
      }
      case 'slider': {
        text(ctx, label, CX + 14, mid + 8, { size: 23, color: lc });
        const v = r.get!(), n = Math.round((r.max! - r.min!) / r.step!), k = Math.round((v - r.min!) / r.step!);
        const sw = BAR_W / n;
        for (let s = 0; s < n; s++) {
          const on = s < k;
          const hh = 12 + (s / n) * 16; // little steps growing like a volume wedge
          rrect(ctx, BAR_X + s * sw + 1.5, mid + 14 - hh, sw - 3, hh, 3, on ? (sel ? '#ffd34a' : '#e8c060') : 'rgba(255,255,255,0.14)', 0);
        }
        text(ctx, r.fmt ? r.fmt(v) : String(v), BAR_X + BAR_W + 18, mid + 8, { size: 20, color: '#ffd34a' });
        if (sel) {
          text(ctx, '◀', BAR_X - 22, mid + 8, { size: 18, color: '#ffd34a', align: 'center' });
          text(ctx, '▶', BAR_X + BAR_W + 120, mid + 8, { size: 18, color: '#ffd34a', align: 'center' });
        }
        return;
      }
      case 'toggle': {
        text(ctx, label, CX + 14, mid + 8, { size: 23, color: lc });
        const pw = 260, px = BAR_X;
        rrect(ctx, px, mid - 18, pw, 36, 14, dis ? 'rgba(255,255,255,0.08)' : sel ? '#ffd34a' : '#f6ecd2', 3);
        text(ctx, r.value!(), px + pw / 2, mid + 2, { size: 20, color: dis ? '#c8b8a8' : OUT, align: 'center', base: 'middle' });
        if (sel && !dis) {
          text(ctx, '◀', px + 18, mid + 2, { size: 16, color: OUT, align: 'center', base: 'middle' });
          text(ctx, '▶', px + pw - 18, mid + 2, { size: 16, color: OUT, align: 'center', base: 'middle' });
        }
        return;
      }
      case 'button': {
        const bw = 380, bx = CX + CW / 2 - bw / 2;
        rrect(ctx, bx, y + 7, bw, h - 14, 16, sel ? '#ffd34a' : '#f6ecd2', sel ? 4 : 3);
        text(ctx, label, bx + bw / 2, mid + 2, { size: 20, color: OUT, align: 'center', base: 'middle' });
        return;
      }
      case 'info': {
        text(ctx, label, CX + 14, mid + 7, { size: 19, font: 'body', color: '#d8c8b0' });
        text(ctx, r.kbText ?? '', COLS[0].x + (COLS[1].x + COLS[1].w - COLS[0].x) / 2, mid + 7, { size: 18, font: 'body', color: '#c8b8a8', align: 'center' });
        const pt = typeof r.padText === 'function' ? r.padText() : r.padText ?? '';
        text(ctx, pt, COLS[2].x + (COLS[3].x + COLS[3].w - COLS[2].x) / 2, mid + 7, { size: 18, font: 'body', color: '#c8b8a8', align: 'center' });
        return;
      }
      case 'bind': this.drawBind(ctx, r.bind!, label, sel, y, h); return;
    }
  }

  private drawBind(ctx: C, a: BindAction, label: string, sel: boolean, y: number, h: number) {
    const mid = y + h / 2;
    ctx.font = '400 20px Pangolin, sans-serif';
    const lw = ctx.measureText(label).width, room = COLS[0].x - CX - 26;
    text(ctx, label, CX + 14, mid + 7, { size: lw > room ? Math.floor(20 * room / lw) : 20, font: 'body', color: '#fff3d8' });
    const b = input.bindsOf(a);
    const dev = padDev();
    const changed = !same(b.kb, DEFAULT_KB[a]) || !same(b.pad, DEFAULT_PAD[a]);
    const cells = this.cellsOf(a);
    for (let c = 0; c < 5; c++) {
      const col = COLS[c];
      const on = sel && this.cell === c;
      const waiting = this.wait && this.wait.a === a && (c < 2 ? this.wait.dev === 'kb' : this.wait.dev === 'pad') && c % 2 === Math.min(this.wait.slot, 1);
      if (c === 4) {
        if (!changed && !on) continue;
        rrect(ctx, col.x, mid - 16, col.w, 32, 12, on ? '#ffd34a' : 'rgba(246,236,210,0.85)', on ? 3 : 2);
        text(ctx, '↺', col.x + col.w / 2, mid + 2, { size: 20, color: OUT, align: 'center', base: 'middle' });
        continue;
      }
      if (!cells.includes(c)) {
        if (c === 2) text(ctx, 'левый стик', COLS[2].x + (COLS[3].x + COLS[3].w - COLS[2].x) / 2, mid + 7, { size: 17, font: 'body', color: '#9a8a80', align: 'center' });
        continue;
      }
      rrect(ctx, col.x, mid - 17, col.w, 34, 12, waiting ? '#7ad04a' : on ? 'rgba(255,211,74,0.95)' : 'rgba(255,255,255,0.07)', on || waiting ? 3 : 0);
      const cx = col.x + col.w / 2;
      if (waiting) { text(ctx, '…', cx, mid + 2, { size: 22, color: OUT, align: 'center', base: 'middle' }); continue; }
      if (c < 2) {
        const code = b.kb[c];
        if (!code) { text(ctx, '—', cx, mid + 2, { size: 18, color: on ? OUT : '#7a6a60', align: 'center', base: 'middle' }); continue; }
        const gw = keyCodeWidth(ctx, code, 31);
        const sz = gw > col.w - 8 ? 31 * (col.w - 8) / gw : 31;
        drawKeyCode(ctx, code, cx, mid, sz);
      } else {
        const i = b.pad[c - 2];
        if (i === undefined) { text(ctx, '—', cx, mid + 2, { size: 18, color: on ? OUT : '#7a6a60', align: 'center', base: 'middle' }); continue; }
        drawPadButton(ctx, dev, i, cx, mid, 30);
        if ((a === 'swap' || a === 'emote') && input.bindsOf(a === 'swap' ? 'emote' : 'swap').pad.includes(i)) {
          text(ctx, a === 'swap' ? 'тап' : 'держи', cx + 22, mid + 7, { size: 14, font: 'body', color: on ? OUT : '#c8b8a8' });
        }
      }
    }
  }

  private drawFooter(ctx: C) {
    const fy = PY + PH - 64;
    ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(CX, fy - 22, CW, 2);
    let line = '';
    let color = '#f6ecd2';
    if (this.msg) { line = this.msg.text; color = this.msg.bad ? '#ff9a8a' : '#9ae06a'; }
    else if (this.sel >= 0) {
      const r = this.rows[this.sel];
      if (r?.kind === 'bind') line = this.cell === 4 ? 'Вернуть этому действию клавиши и кнопки по умолчанию.' : this.cell < 2 ? 'Выбери ячейку и нажми — потом нажми новую клавишу или кнопку мыши. Занятая — поменяется местами.' : 'Выбери ячейку и нажми — потом нажми новую кнопку на геймпаде.';
      else if (r?.help) line = typeof r.help === 'function' ? r.help() : r.help;
    } else line = 'Вкладки: ◀ ▶, или Q / E, или клик.';
    ctx.font = '400 19px Pangolin, sans-serif';
    wrap(ctx, line, CW - 20).slice(0, 2).forEach((l, i) => text(ctx, l, CX + 6, fy + 4 + i * 23, { size: 19, font: 'body', color }));
    // prompts
    const y = PY + PH - 14;
    let x = CX;
    const dev = glyphDevice();
    if (dev === 'kb') {
      x += drawHint(ctx, 'confirm', 'выбрать', x, y - 4, { size: 27 }) + 22;
      x += drawHint(ctx, 'back', 'закрыть', x, y - 4, { size: 27 }) + 22;
      x += drawKeyCode(ctx, 'KeyQ', x, y - 4, 27, 'left') + 4;
      x += drawKeyCode(ctx, 'KeyE', x, y - 4, 27, 'left') + 8;
      text(ctx, 'вкладки', x, y + 2, { size: 19, font: 'body', color: '#fff3d8', stroke: 4 });
    } else {
      x += drawHint(ctx, 'confirm', 'выбрать', x, y - 4, { size: 27 }) + 22;
      x += drawHint(ctx, 'back', 'закрыть', x, y - 4, { size: 27 }) + 22;
      x += drawPadButton(ctx, dev, PB.L1, x, y - 4, 27, 'left') + 4;
      x += drawPadButton(ctx, dev, PB.R1, x, y - 4, 27, 'left') + 8;
      text(ctx, 'вкладки', x, y + 2, { size: 19, font: 'body', color: '#fff3d8', stroke: 4 });
    }
  }

  private drawWait(ctx: C) {
    const w = this.wait!;
    ctx.save();
    ctx.fillStyle = 'rgba(10,4,8,0.55)'; ctx.fillRect(-2000, -2000, W + 4000, H + 4000);
    const bw = 620, bh = 210, bx = W / 2 - bw / 2, by = H / 2 - 110;
    rrect(ctx, bx + 5, by + 7, bw, bh, 24, 'rgba(0,0,0,0.35)', 0);
    rrect(ctx, bx, by, bw, bh, 24, '#fff7e6', 5);
    text(ctx, `«${BIND_LABEL[w.a]}»`, W / 2, by + 50, { size: 28, color: '#b0453a', align: 'center' });
    const s = w.dev === 'kb' ? 'Нажми клавишу или кнопку мыши' : 'Нажми кнопку на геймпаде';
    text(ctx, s + '…', W / 2, by + 92, { size: 22, font: 'body', color: OUT, align: 'center', alpha: 0.7 + Math.sin(this.t * 6) * 0.3 });
    const cancel = w.dev === 'kb' ? (w.slot > 0 ? 'Esc — отмена, Delete — убрать вторую' : 'Esc — отмена') : 'Esc или Options — отмена';
    text(ctx, cancel, W / 2, by + 124, { size: 17, font: 'body', color: '#8a6a5a', align: 'center' });
    const r = this.cancelRect();
    rrect(ctx, r.x, r.y, r.w, r.h, 14, inRect(input.mouseX, input.mouseY, r) ? '#ffd34a' : '#f6ecd2', 3);
    text(ctx, 'Отмена', r.x + r.w / 2, r.y + r.h / 2 + 2, { size: 20, color: OUT, align: 'center', base: 'middle' });
    ctx.restore();
  }
}

function inRect(x: number, y: number, r: { x: number; y: number; w: number; h: number }) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

/** the first key of an action, as text */
function keyName(a: BindAction): string { const k = input.bindsOf(a).kb[0]; return k ? keyLabel(k) : '—'; }

// ───────────────────────── first time in a level: the essentials ─────────────────────────

/**
 * A small card (left, under the HUD) the first time a player is in control in a level, solo or co-op: move, jump,
 * fight, the camera zoom, and where the full controls are. Non-blocking; fades out after a while, or at once when
 * the panel opens. Device-aware (pad glyphs while a pad is in hand), shows the player's own binds.
 */
export class ControlsHint {
  t = 0;
  on = false;
  held = false;
  done: boolean;
  constructor() { this.done = save.data.settings.seen.includes('controls'); }
  /** `ready`: the hero is in the player's hands and nothing covers the screen */
  update(dt: number, ready: boolean) {
    if (this.done) return;
    if (!this.on) { if (!ready) return; this.on = true; seenOnce('controls'); }
    // a cutscene (bars) or a menu came up: hide and hold the clock until the hero is mine again
    this.held = !ready;
    if (this.held) return;
    this.t += dt;
    if (this.t > 16) this.done = true;
  }
  dismiss() { if (this.on && this.t < 15.4) this.t = 15.4; else if (!this.on) this.done = true; }
  /** the card's bottom edge on screen while it shows (0 = hidden): the hud starts its toast column below it */
  bottom = 0;
  draw(ctx: C) {
    this.bottom = 0;
    if (this.done || !this.on || this.held) return;
    const a = clamp(Math.min(this.t * 3, (16 - this.t) / 0.6), 0, 1);
    if (a <= 0) return;
    const pad = glyphDevice() !== 'kb';
    // (under the HUD and the co-op scoreboard tip at y 146)
    const x = 20, y = 172, w = 430, rh = 38;
    const rows: [(cx: number, cy: number) => number, string][] = pad ? [
      [(cx, cy) => stickText(ctx, 'Левый стик', cx, cy), 'бежать'],
      [(cx, cy) => glyphs(ctx, ['jump', 'attack', 'shoot'], cx, cy), 'прыжок, удар, рогатка'],
      [(cx, cy) => stickText(ctx, 'Правый стик', cx, cy), 'крутить камеру'],
      input.padButtonsFor('zoomOut').length
        ? [(cx, cy) => glyphs(ctx, ['zoomOut', 'zoomIn'], cx, cy), 'отдалить / приблизить камеру']
        : [(cx, cy) => stickText(ctx, 'Настройки', cx, cy), 'дальность камеры (Изображение)'],
      [(cx, cy) => glyphs(ctx, ['pause'], cx, cy), 'пауза, управление, настройки'],
    ] : [
      [(cx, cy) => codes(ctx, ['fwd', 'left', 'bwd', 'right'].map((k) => input.bindsOf(k as BindAction).kb[0] ?? ''), cx, cy), 'бежать'],
      [(cx, cy) => glyphs(ctx, ['jump', 'attack', 'shoot'], cx, cy), 'прыжок, удар, рогатка'],
      [(cx, cy) => codes(ctx, ['колёсико'], cx, cy), 'отдалить / приблизить камеру'],
      [(cx, cy) => codes(ctx, ['F1', 'Escape'], cx, cy), 'управление и настройки'],
    ];
    const h = 50 + rows.length * rh;
    this.bottom = y + h + 6;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(-(1 - ease.outCubic(clamp(this.t * 3, 0, 1))) * 40, 0);
    rrect(ctx, x + 4, y + 6, w, h, 18, 'rgba(0,0,0,0.3)', 0);
    rrect(ctx, x, y, w, h, 18, 'rgba(30,15,20,0.86)', 3);
    text(ctx, 'Как играть', x + 18, y + 32, { size: 21, color: '#ffd34a', stroke: 4 });
    // time left
    rrect(ctx, x + w - 98, y + 18, 80 * clamp(1 - this.t / 16, 0, 1), 5, 2, 'rgba(255,211,74,0.6)', 0);
    rows.forEach(([g, label], i) => {
      const cy = y + 62 + i * rh;
      const gw = g(x + 18, cy);
      text(ctx, '— ' + label, x + 18 + Math.max(gw, 90) + 10, cy + 6, { size: 18, font: 'body', color: '#fff3d8' });
    });
    ctx.restore();
  }
}

function glyphs(ctx: C, acts: BindAction[], x: number, y: number): number {
  let w = 0;
  for (const a of acts) { const gw = drawGlyph(ctx, a, x + w, y, 26, 'left'); if (gw) w += gw + 5; }
  return w - 5;
}
function codes(ctx: C, list: string[], x: number, y: number): number {
  let w = 0;
  for (const c of list) { if (!c) continue; w += drawKeyCode(ctx, c, x + w, y, 26, 'left') + 4; }
  return w - 4;
}
function stickText(ctx: C, s: string, x: number, y: number): number {
  ctx.font = '900 15px Rubik, sans-serif';
  const w = ctx.measureText(s).width + 18;
  rrect(ctx, x, y - 13, w, 26, 13, '#433a4c', 2);
  text(ctx, s, x + w / 2, y + 1, { size: 15, color: '#fff', align: 'center', base: 'middle' });
  return w;
}

/** a one-time camera tip: squeezed against a wall / a big hall (the player's own keys, or where it is for a pad) */
export function zoomTip(kind: 'wall' | 'big'): string {
  const pad = glyphDevice() !== 'kb';
  const how = pad
    ? (input.padButtonsFor('zoomOut').length ? `${padButtonLabel(padDev(), input.padButtonsFor('zoomOut')[0])} / ${padButtonLabel(padDev(), input.padButtonsFor('zoomIn')[0] ?? input.padButtonsFor('zoomOut')[0])}` : 'Настройки → Изображение → Дальность камеры')
    : `колёсико мыши или ${keyName('zoomOut')} ${keyName('zoomIn')}`;
  return kind === 'wall' ? `Камеру прижало к стене? Приблизить / отдалить: ${how}` : `Большой зал — отдали камеру: ${how}`;
}

import { input, DEFAULT_KB, DEFAULT_PAD, type Action, type BindAction } from '../engine/input';
import { PB } from '../engine/pads';
import { OUT, circle, fillStroke, rrPath, rrect, text } from '../art/draw';

/**
 * Button prompts that follow the device in hand: PlayStation shapes (✕ ○ □ △, L1/R2, Options/Create)
 * for DualShock/DualSense, Xbox letters for Xbox and unknown pads, Switch letters for Nintendo,
 * and the key / mouse button when the last input came from keyboard or mouse.
 */

type C = CanvasRenderingContext2D;
export type GlyphDevice = 'ps4' | 'ps5' | 'xbox' | 'switch' | 'kb';

/** which prompt set to show right now */
export function glyphDevice(): GlyphDevice {
  if (input.lastDevice !== 'pad' || !input.padKind) return 'kb';
  const k = input.padKind;
  return k === 'ps4' || k === 'ps5' || k === 'switch' ? k : 'xbox';
}

// which binding to show when an action has several
const PAD_PREF: Partial<Record<Action, number[]>> = {
  dash: [PB.R2, PB.EAST], special: [PB.EAST], shoot: [PB.NORTH, PB.L2], confirm: [PB.SOUTH], back: [PB.EAST],
  up: [PB.UP], down: [PB.DOWN], left: [PB.LEFT], right: [PB.RIGHT],
};
// (binds come first: a rebound action shows its own key, these only order the defaults)
const KEY_PREF: Partial<Record<Action, string[]>> = {
  left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'],
  confirm: ['Enter', 'Space'], back: ['Escape'], pause: ['Escape'],
};

const KEY_LABEL: Record<string, string> = {
  Space: 'Пробел', ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'Alt',
  Escape: 'Esc', Enter: 'Enter', NumpadEnter: 'Enter',
  Tab: 'Tab', Backspace: '⌫', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  BracketLeft: '[', BracketRight: ']', Minus: '−', Equal: '=', NumpadSubtract: 'Num −', NumpadAdd: 'Num +',
  NumpadMultiply: 'Num *', NumpadDivide: 'Num /', NumpadDecimal: 'Num .', Semicolon: ';', Quote: "'", Comma: ',', Period: '.',
  Slash: '/', Backslash: '\\', Backquote: '`', IntlBackslash: '§', Delete: 'Del', Insert: 'Ins', Home: 'Home', End: 'End',
  PageUp: 'PgUp', PageDown: 'PgDn',
  Mouse0: 'ЛКМ', Mouse1: 'СКМ', Mouse2: 'ПКМ', Mouse3: 'Мышь 4', Mouse4: 'Мышь 5',
};
export function keyLabel(code: string): string {
  if (KEY_LABEL[code]) return KEY_LABEL[code];
  const n = /^Numpad(\d)$/.exec(code);
  if (n) return 'Num ' + n[1];
  const m = /^(?:Key|Digit)(.+)$/.exec(code);
  if (m) return m[1];
  const ms = /^Mouse(\d+)$/.exec(code);
  return ms ? 'Мышь ' + (+ms[1] + 1) : code;
}
const isMouse = (code: string) => code.startsWith('Mouse');

const PS_LABEL = ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3', '↑', '↓', '←', '→', 'PS', 'Тачпад'];
const XBOX_LABEL = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', '↑', '↓', '←', '→', 'Xbox', 'Share'];
const SWITCH_LABEL = ['B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', '−', '+', 'LS', 'RS', '↑', '↓', '←', '→', 'Home', 'Capture'];

/** label of standard pad button i on a device */
export function padButtonLabel(dev: Exclude<GlyphDevice, 'kb'>, i: number): string {
  if (dev === 'ps5' && i === PB.SELECT) return 'Create';
  const t = dev === 'xbox' ? XBOX_LABEL : dev === 'switch' ? SWITCH_LABEL : PS_LABEL;
  return t[i] ?? String(i);
}

type Glyph =
  | { t: 'btn'; dev: Exclude<GlyphDevice, 'kb'>; i: number }
  | { t: 'key'; label: string }
  | { t: 'mouse'; btn: 0 | 2 }
  | { t: 'none' };

interface Resolved { g: Glyph; label: string; hold: boolean }

function resolve(a: Action, dev: GlyphDevice): Resolved {
  if (dev !== 'kb') {
    const bound = input.padButtonsFor(a);
    const pref = (PAD_PREF[a] ?? []).filter((i) => bound.includes(i));
    // only offer buttons this pad has (no touchpad on Xbox One / in Safari → show the key instead)
    const usable = [...pref, ...bound].filter((i) => !input.padKind || input.padHas(i));
    if (usable.length) {
      const i = usable[0];
      return { g: { t: 'btn', dev, i }, label: padButtonLabel(dev, i), hold: a === 'emote' };
    }
  }
  const keys = input.keysFor(a);
  // mouse buttons count only while playing with the pointer locked; otherwise show the key
  const mouse = keys.filter(isMouse), kbd = keys.filter((k) => !isMouse(k));
  const m = input.mouseCombat ? mouse[0] : undefined;
  if (m === 'Mouse0' || m === 'Mouse2') return { g: { t: 'mouse', btn: m === 'Mouse0' ? 0 : 2 }, label: keyLabel(m), hold: false };
  const code = m ?? (KEY_PREF[a] ?? []).find((k) => kbd.includes(k)) ?? kbd[0] ?? mouse[0];
  if (!code) return { g: { t: 'none' }, label: '', hold: false };
  if (code === 'Mouse0' || code === 'Mouse2') return { g: { t: 'mouse', btn: code === 'Mouse0' ? 0 : 2 }, label: keyLabel(code), hold: false };
  return { g: { t: 'key', label: keyLabel(code) }, label: keyLabel(code), hold: false };
}

/** text for the action's button on the current device: "✕", "R1", "A", "Пробел", "ЛКМ", ... */
export function glyphLabel(a: Action, dev: GlyphDevice = glyphDevice()): string {
  return resolve(a, dev).label;
}

/** true when the prompt means "hold" (emote = hold R3 on a pad) */
export function glyphHold(a: Action, dev: GlyphDevice = glyphDevice()): boolean {
  return resolve(a, dev).hold;
}

// ---------- drawing ----------

const DARK = '#2e2836';
const DARK2 = '#433a4c';
const CAP = '#fff7e6';
const CAP_SIDE = '#d6c19a';
const PS_COL = ['#8fb4ff', '#ff7676', '#ff9ad5', '#5fe0b8'];
const XB_COL: Record<string, string> = { A: '#7ed957', B: '#ff5f57', X: '#4fa8ff', Y: '#ffd34a' };
/** font size (× glyph size) of the label on the PlayStation touchpad glyph */
const TOUCH_FS = 0.26;

function fontW(ctx: C, s: string, size: number) {
  ctx.font = `900 ${size}px Rubik, "Arial Black", sans-serif`;
  return ctx.measureText(s).width;
}

function glyphW(ctx: C, g: Glyph, size: number): number {
  switch (g.t) {
    case 'none': return 0;
    case 'mouse': return size * 0.74;
    case 'key': {
      const fs = size * (g.label.length > 2 ? 0.42 : 0.52);
      return Math.max(size, fontW(ctx, g.label, fs) + size * 0.55);
    }
    case 'btn': {
      const i = g.i;
      if (i <= 3 || i === PB.L3 || i === PB.R3 || (i >= PB.UP && i <= PB.RIGHT) || i === PB.HOME) return size;
      const label = padButtonLabel(g.dev, i);
      // PlayStation touchpad: a wide flat pad with a small label
      if (i === PB.EXTRA && (g.dev === 'ps4' || g.dev === 'ps5')) return Math.max(size * 1.55, fontW(ctx, label, size * TOUCH_FS) + size * 0.45);
      return Math.max(size * 1.3, fontW(ctx, label, size * (label.length > 3 ? 0.34 : 0.44)) + size * 0.5);
    }
  }
}

/** width the glyph for this action takes at this size (to lay out "[✕] Прыжок") */
export function glyphWidth(ctx: C, a: Action, size = 28, dev: GlyphDevice = glyphDevice()): number {
  return glyphW(ctx, resolve(a, dev).g, size);
}

function drawPsShape(ctx: C, i: number, x: number, y: number, size: number) {
  const s = size * 0.2;
  ctx.save();
  ctx.strokeStyle = PS_COL[i]; ctx.lineWidth = Math.max(1.5, size * 0.1); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  if (i === 0) { ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s); ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s); }
  else if (i === 1) ctx.arc(x, y, s * 1.1, 0, Math.PI * 2);
  else if (i === 2) rrPath(ctx, x - s, y - s, s * 2, s * 2, s * 0.2);
  else { ctx.moveTo(x, y - s * 1.2); ctx.lineTo(x + s * 1.15, y + s * 0.8); ctx.lineTo(x - s * 1.15, y + s * 0.8); ctx.closePath(); }
  ctx.stroke();
  ctx.restore();
}

function drawDpad(ctx: C, dir: number, x: number, y: number, size: number, lw: number) {
  const a = size * 0.17, L = size * 0.46;
  ctx.beginPath();
  ctx.moveTo(x - a, y - L); ctx.lineTo(x + a, y - L); ctx.lineTo(x + a, y - a); ctx.lineTo(x + L, y - a);
  ctx.lineTo(x + L, y + a); ctx.lineTo(x + a, y + a); ctx.lineTo(x + a, y + L); ctx.lineTo(x - a, y + L);
  ctx.lineTo(x - a, y + a); ctx.lineTo(x - L, y + a); ctx.lineTo(x - L, y - a); ctx.lineTo(x - a, y - a);
  ctx.closePath();
  fillStroke(ctx, DARK2, lw);
  // lit arm: 12 up, 13 down, 14 left, 15 right
  const g = lw * 0.6;
  ctx.fillStyle = '#ffe9a8';
  if (dir === PB.UP) ctx.fillRect(x - a + g, y - L + g, a * 2 - g * 2, L - a);
  else if (dir === PB.DOWN) ctx.fillRect(x - a + g, y + a, a * 2 - g * 2, L - a - g);
  else if (dir === PB.LEFT) ctx.fillRect(x - L + g, y - a + g, L - a, a * 2 - g * 2);
  else ctx.fillRect(x + a, y - a + g, L - a - g, a * 2 - g * 2);
}

function drawBtn(ctx: C, g: Extract<Glyph, { t: 'btn' }>, x: number, y: number, size: number, w: number, lw: number) {
  const { dev, i } = g;
  const r = size / 2;
  const label = padButtonLabel(dev, i);
  if (i <= 3) {
    circle(ctx, x, y, r - lw / 2, DARK, lw);
    if (dev === 'ps4' || dev === 'ps5') drawPsShape(ctx, i, x, y, size);
    else text(ctx, label, x, y + size * 0.03, { size: size * 0.56, color: dev === 'xbox' ? XB_COL[label] ?? '#fff' : '#fff', align: 'center', base: 'middle' });
    return;
  }
  if (i >= PB.UP && i <= PB.RIGHT) { drawDpad(ctx, i, x, y, size, lw); return; }
  if (i === PB.L3 || i === PB.R3 || i === PB.HOME) {
    circle(ctx, x, y, r - lw / 2, DARK2, lw);
    circle(ctx, x, y, r * 0.62, null, Math.max(1, lw * 0.5));
    text(ctx, label, x, y + size * 0.02, { size: size * (label.length > 2 ? 0.26 : 0.36), color: '#fff', align: 'center', base: 'middle' });
    return;
  }
  const h = i === PB.EXTRA && (dev === 'ps4' || dev === 'ps5') ? size * 0.86 : i >= PB.SELECT ? size * 0.7 : size * 0.8;
  const trig = i === PB.L2 || i === PB.R2;
  // triggers: rounded top; bumpers/menus: pills
  rrect(ctx, x - w / 2 + lw / 2, y - h / 2, w - lw, h, trig ? h * 0.48 : h * 0.3, i >= PB.SELECT ? DARK : DARK2, lw);
  if (i === PB.EXTRA && (dev === 'ps4' || dev === 'ps5')) {
    text(ctx, label, x, y + size * 0.02, { size: size * TOUCH_FS, color: '#d8d0e8', align: 'center', base: 'middle' });
    return;
  }
  text(ctx, label, x, y + size * 0.02, { size: size * (label.length > 3 ? 0.34 : 0.44), color: '#fff', align: 'center', base: 'middle' });
}

function drawKey(ctx: C, label: string, x: number, y: number, size: number, w: number, lw: number) {
  const h = size * 0.92, d = size * 0.12;
  rrect(ctx, x - w / 2 + lw / 2, y - h / 2, w - lw, h, size * 0.2, CAP_SIDE, lw);
  rrect(ctx, x - w / 2 + lw, y - h / 2 + lw * 0.5, w - lw * 2, h - d - lw, size * 0.16, CAP, 0);
  text(ctx, label, x, y - d / 2 + size * 0.02, { size: size * (label.length > 2 ? 0.42 : 0.52), color: OUT, align: 'center', base: 'middle' });
}

function drawMouse(ctx: C, btn: 0 | 2, x: number, y: number, size: number, lw: number) {
  const mw = size * 0.7, mh = size * 0.98;
  const x0 = x - mw / 2, y0 = y - mh / 2;
  rrPath(ctx, x0, y0, mw, mh, mw * 0.48);
  ctx.fillStyle = CAP; ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#ffd34a';
  ctx.fillRect(btn === 0 ? x0 : x, y0, mw / 2, mh * 0.44);
  ctx.restore();
  ctx.strokeStyle = OUT; ctx.lineWidth = Math.max(1, lw * 0.7); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x, y0 + lw * 0.5); ctx.lineTo(x, y0 + mh * 0.44); ctx.moveTo(x0 + lw * 0.3, y0 + mh * 0.44); ctx.lineTo(x0 + mw - lw * 0.3, y0 + mh * 0.44); ctx.stroke();
  rrPath(ctx, x0, y0, mw, mh, mw * 0.48);
  fillStroke(ctx, null, lw);
}

/** little clock badge: "hold this" */
function drawHoldBadge(ctx: C, x: number, y: number, size: number, lw: number) {
  const r = size * 0.2;
  circle(ctx, x, y, r, '#ffd34a', Math.max(1, lw * 0.7));
  ctx.strokeStyle = OUT; ctx.lineWidth = Math.max(1, lw * 0.6); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - r * 0.6); ctx.moveTo(x, y); ctx.lineTo(x + r * 0.45, y + r * 0.1); ctx.stroke();
}

/**
 * Draws the button for an action on the current device, centred at (x, y); `size` ≈ its height in px.
 * Pass align 'left' to start at x instead. Returns the width drawn (0 when the action has no binding).
 */
export function drawGlyph(ctx: C, a: Action, x: number, y: number, size = 28, align: 'center' | 'left' = 'center', dev: GlyphDevice = glyphDevice()): number {
  const res = resolve(a, dev);
  return drawResolved(ctx, res, x, y, size, align);
}

/** draws a key cap / mouse with this code ('KeyW', 'Space', 'Mouse0'…), or any short label as a cap (e.g. 'колёсико') */
export function drawKeyCode(ctx: C, code: string, x: number, y: number, size = 28, align: 'center' | 'left' = 'center'): number {
  const g: Glyph = code === 'Mouse0' || code === 'Mouse2' ? { t: 'mouse', btn: code === 'Mouse0' ? 0 : 2 } : { t: 'key', label: KEY_LABEL[code] || /^(Key|Digit|Numpad|Mouse)/.test(code) ? keyLabel(code) : code };
  return drawResolved(ctx, { g, label: '', hold: false }, x, y, size, align);
}

/** width drawKeyCode takes */
export function keyCodeWidth(ctx: C, code: string, size = 28): number {
  const g: Glyph = code === 'Mouse0' || code === 'Mouse2' ? { t: 'mouse', btn: code === 'Mouse0' ? 0 : 2 } : { t: 'key', label: KEY_LABEL[code] || /^(Key|Digit|Numpad|Mouse)/.test(code) ? keyLabel(code) : code };
  return glyphW(ctx, g, size);
}

/** draws standard pad button i of a device (for controls cards that show the whole layout) */
export function drawPadButton(ctx: C, dev: Exclude<GlyphDevice, 'kb'>, i: number, x: number, y: number, size = 28, align: 'center' | 'left' = 'center'): number {
  return drawResolved(ctx, { g: { t: 'btn', dev, i }, label: padButtonLabel(dev, i), hold: false }, x, y, size, align);
}

function drawResolved(ctx: C, res: Resolved, x: number, y: number, size: number, align: 'center' | 'left'): number {
  const g = res.g;
  const w = glyphW(ctx, g, size);
  if (!w) return 0;
  const cx = align === 'left' ? x + w / 2 : x;
  const lw = Math.max(1.5, size * 0.09);
  ctx.save();
  if (g.t === 'btn') drawBtn(ctx, g, cx, y, size, w, lw);
  else if (g.t === 'key') drawKey(ctx, g.label, cx, y, size, w, lw);
  else if (g.t === 'mouse') drawMouse(ctx, g.btn, cx, y, size, lw);
  if (res.hold) drawHoldBadge(ctx, cx + w / 2 - size * 0.08, y - size * 0.36, size, lw);
  ctx.restore();
  return w;
}

/**
 * "[glyph] label" prompt, e.g. drawHint(ctx, 'interact', 'Поднять друга', x, y).
 * (x, y) is the left edge / vertical centre; returns the total width.
 */
export function drawHint(
  ctx: C, a: Action, label: string, x: number, y: number,
  o: { size?: number; color?: string; stroke?: number; dev?: GlyphDevice } = {},
): number {
  const size = o.size ?? 26;
  const gw = drawGlyph(ctx, a, x, y, size, 'left', o.dev ?? glyphDevice());
  const tx = x + (gw ? gw + size * 0.3 : 0);
  text(ctx, label, tx, y + size * 0.04, { size: size * 0.72, font: 'body', color: o.color ?? '#fff3d8', base: 'middle', stroke: o.stroke ?? 4 });
  ctx.font = `400 ${size * 0.72}px Pangolin, "Comic Sans MS", sans-serif`;
  return tx - x + ctx.measureText(label).width;
}

// ---------- texts that name keys ----------

/** the keys of an action as text, "Shift / L" (current binds; keyboard + mouse) */
export function keysText(a: BindAction, sep = ' / '): string {
  return input.bindsOf(a).kb.map(keyLabel).join(sep) || '—';
}

/** texts written with the default keys (level signs, story toasts, item cards): [as written, action, how it's split] */
const KEY_WORDS: [string, BindAction, 'all' | 'first'][] = [
  ['Shift или L', 'dash', 'all'], ['Shift / L', 'dash', 'all'], ['ПКМ (K)', 'shoot', 'all'], ['ЛКМ / J', 'attack', 'all'],
  ['Shift', 'dash', 'first'], ['Пробел', 'jump', 'first'], ['ПКМ', 'shoot', 'first'], ['ЛКМ', 'attack', 'first'],
  ['(E)', 'heal', 'first'], ['(T)', 'chat', 'first'], ['(R)', 'interact', 'first'], ['Q —', 'swap', 'first'],
  ['W —', 'fwd', 'first'], ['S —', 'bwd', 'first'],
];
const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);
/** an action still has its default keys and buttons (then texts written with them are right as they are) */
export function isDefaultBind(a: BindAction): boolean {
  const b = input.bindsOf(a);
  return same(b.kb, DEFAULT_KB[a]) && same(b.pad, DEFAULT_PAD[a]);
}

/**
 * A hint written with the default keys ("Shift / L — рывок", "Пробел — прыжок", "Съешь в бою (E)") → the player's
 * own keys when they rebound that action. Untouched while everything is at the defaults.
 */
export function bindText(str: string): string {
  if (BIND_KEYS_DEFAULT()) return str;
  let out = '';
  let i = 0;
  outer: while (i < str.length) {
    for (const [w, a, how] of KEY_WORDS) {
      if (!str.startsWith(w, i)) continue;
      // whole words only for the letter ones
      const before = i > 0 ? str[i - 1] : ' ';
      if (/[A-Za-zА-Яа-я0-9]/.test(before)) continue;
      if (isDefaultBind(a) || !input.bindsOf(a).kb.length) { out += w; i += w.length; continue outer; }
      const keys = input.bindsOf(a).kb.map(keyLabel);
      const k = how === 'all' ? keys.join(' / ') : keys[0];
      out += w.startsWith('(') ? `(${k})` : w.endsWith(' —') ? `${k} —` : k;
      i += w.length;
      continue outer;
    }
    out += str[i++];
  }
  return out;
}
/** nothing rebound at all (fast path for bindText) */
function BIND_KEYS_DEFAULT(): boolean {
  for (const [, a] of KEY_WORDS) if (!isDefaultBind(a)) return false;
  return true;
}

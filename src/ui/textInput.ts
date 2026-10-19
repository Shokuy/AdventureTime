import { input, type Action } from '../engine/input';
import { RT } from '../three/runtime';

/*
 * A DOM <input> laid over the canvas UI for typing (player name, chat, room codes).
 * Coordinates are in the logical 1280×720 UI space; the element follows window resizes.
 * While it is focused the game ignores keyboard and pad (input.suspended) and the pointer lock is released.
 * Keys typed into it never reach the game's window key handler; the pad can only close it (✕ done, ○ cancel),
 * and the button that closed it doesn't reach the game either.
 */

export interface TextInputOpts {
  /** logical-canvas rectangle */
  x: number; y: number; w: number; h: number;
  value?: string;
  placeholder?: string;
  maxLength?: number;
  /** logical font size (default: 55% of the height) */
  size?: number;
  /** select the whole value on open (default true) */
  select?: boolean;
  /** what losing focus means: commit (default), cancel, or stay open unfocused (chat) */
  onBlur?: 'submit' | 'cancel' | 'keep';
  /** stay open after Enter (chat: send, clear, keep typing) */
  keepOpen?: boolean;
  /** allowed characters (others are stripped while typing), e.g. /[A-Z0-9]/ for room codes */
  allow?: RegExp;
  uppercase?: boolean;
  /** text centered (default) or left-aligned */
  align?: 'center' | 'left';
  onSubmit?(value: string): void;
  onCancel?(): void;
  onChange?(value: string): void;
}

const STYLE_ID = 'gk-textinput-style';
function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
    .gk-textinput { position: fixed; z-index: 6; box-sizing: border-box; margin: 0; outline: none;
      background: #fff8e6; color: #2a1b1a; border-style: solid; border-color: #2a1b1a;
      font-family: Pangolin, "Comic Sans MS", sans-serif; caret-color: #e8383d;
      box-shadow: 0 0.35em 0 rgba(0,0,0,0.35), inset 0 0.18em 0 rgba(255,255,255,0.8);
      transition: box-shadow 0.15s; -webkit-appearance: none; appearance: none; }
    .gk-textinput:focus { background: #fffdf4; box-shadow: 0 0.35em 0 rgba(0,0,0,0.35), 0 0 0 0.18em #ffd34a; }
    .gk-textinput::placeholder { color: #a8907c; opacity: 1; }
    .gk-textinput::selection { background: #ffd34a; color: #2a1b1a; }
  `;
  document.head.appendChild(st);
}

/**
 * While focused the game ignores keyboard and pad (input.suspended). Turning it off again makes input latch the
 * pad buttons still held, so the ✕ / ○ that closed the box never also jumps / dashes / backs out in the game.
 */
function setSuspended(v: boolean) { input.suspended = v; }

/** pad actions the box reacts to (input.padHeld: the active pad only, with its per-model button layout) */
const PAD_DONE: Action[] = ['confirm', 'pause'];
const PAD_CANCEL: Action = 'back';

let current: TextInput | null = null;

/** the currently open text field (only one at a time) */
export function activeTextInput(): TextInput | null { return current; }
/** true while the player is typing (handy for scenes that also read the keyboard) */
export function isTyping(): boolean { return !!current && current.focused; }

export class TextInput {
  readonly el: HTMLInputElement;
  private o: TextInputOpts;
  private raf = 0;
  private lastLayout = '';
  private openedAt = performance.now();
  /** pad actions held last frame (edge detection; the ✕ that opened the box must be released first) */
  private padPrev = new Set<Action>();
  closed = false;
  focused = false;

  constructor(o: TextInputOpts) {
    injectStyle();
    current?.close();
    current = this;
    this.o = o;
    const el = document.createElement('input');
    el.type = 'text';
    el.className = 'gk-textinput';
    el.autocomplete = 'off';
    el.spellcheck = false;
    el.setAttribute('autocapitalize', o.uppercase ? 'characters' : 'off');
    el.setAttribute('enterkeyhint', o.keepOpen ? 'send' : 'done');
    if (o.maxLength) el.maxLength = o.maxLength;
    el.placeholder = o.placeholder ?? '';
    el.value = this.clean(o.value ?? '');
    el.style.textAlign = o.align ?? 'center';
    this.el = el;
    el.addEventListener('keydown', this.onKey);
    el.addEventListener('input', this.onInput);
    el.addEventListener('focus', this.onFocus);
    el.addEventListener('blur', this.onBlurEv);
    // clicks on the field must not reach the canvas (it would steal focus back)
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.appendChild(el);
    this.layout(true);
    input.releaseLock();
    // remember which pad buttons are already held (the ✕ / A press that opened us must not submit)
    this.padPrev = this.padNow();
    this.focus();
    if (o.select !== false) el.select();
    const tick = () => { if (this.closed) return; this.layout(); this.pollPad(); this.raf = requestAnimationFrame(tick); };
    this.raf = requestAnimationFrame(tick);
  }

  get value() { return this.el.value; }
  set value(v: string) { this.el.value = this.clean(v); }

  focus() { try { this.el.focus({ preventScroll: true }); } catch { this.el.focus(); } }

  /** move/resize to another logical rectangle */
  setRect(x: number, y: number, w: number, h: number) { Object.assign(this.o, { x, y, w, h }); this.layout(true); }

  close() {
    if (this.closed) return;
    this.closed = true;
    cancelAnimationFrame(this.raf);
    this.el.removeEventListener('blur', this.onBlurEv);
    this.el.remove();
    if (current === this) current = null;
    setSuspended(false);
    this.focused = false;
    // give the keyboard back to the game canvas
    const ui = document.getElementById('ui');
    try { ui?.focus({ preventScroll: true }); } catch { /* */ }
    input.clearAll();
  }

  private clean(v: string) {
    if (this.o.uppercase) v = v.toUpperCase();
    if (this.o.allow) { const re = this.o.allow; v = [...v].filter((ch) => re.test(ch)).join(''); }
    if (this.o.maxLength) v = v.slice(0, this.o.maxLength);
    return v;
  }

  private submit() {
    const v = this.el.value;
    this.o.onSubmit?.(v);
    if (this.o.keepOpen && !this.closed) { this.el.value = ''; this.focus(); }
    else this.close();
  }

  private cancel() {
    this.close();
    this.o.onCancel?.();
  }

  private onKey = (e: KeyboardEvent) => {
    // keep typing away from the game's window-level key handler
    e.stopPropagation();
    // ignore the auto-repeat of the key that opened us
    const fresh = performance.now() - this.openedAt < 180;
    if (e.key === 'Enter' || e.key === 'NumpadEnter') {
      e.preventDefault();
      if (e.repeat || fresh || e.isComposing) return;
      this.submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (e.repeat || fresh) return;
      this.cancel();
    }
  };

  private onInput = () => {
    const v = this.clean(this.el.value);
    if (v !== this.el.value) {
      const pos = this.el.selectionStart ?? v.length;
      this.el.value = v;
      try { this.el.setSelectionRange(Math.min(pos, v.length), Math.min(pos, v.length)); } catch { /* */ }
    }
    this.o.onChange?.(v);
  };

  private onFocus = () => { this.focused = true; setSuspended(true); input.releaseLock(); };

  private onBlurEv = () => {
    this.focused = false;
    setSuspended(false);
    const mode = this.o.onBlur ?? 'submit';
    // the window losing focus (alt-tab) is not the player leaving the field
    if (!document.hasFocus()) return;
    if (mode === 'submit') this.submit();
    else if (mode === 'cancel') this.cancel();
  };

  private padNow(): Set<Action> {
    const out = new Set<Action>();
    for (const a of [...PAD_DONE, PAD_CANCEL]) if (input.padHeld(a)) out.add(a);
    return out;
  }

  /** a pad can't type, but it can close the field: ✕ / A or Options = done, ○ / B = cancel */
  private pollPad() {
    const now = this.padNow(), prev = this.padPrev;
    const hit = (a: Action) => now.has(a) && !prev.has(a);
    this.padPrev = now;
    if (!this.focused) return; // unfocused (chat left open): the pad plays the game
    if (hit(PAD_CANCEL)) this.cancel();
    else if (PAD_DONE.some(hit)) this.submit();
  }

  private layout(force = false) {
    const o = this.o;
    const key = `${RT.scale}|${RT.ox}|${RT.oy}|${o.x}|${o.y}|${o.w}|${o.h}`;
    if (!force && key === this.lastLayout) return;
    this.lastLayout = key;
    const s = RT.scale;
    const st = this.el.style;
    st.left = `${RT.ox + o.x * s}px`;
    st.top = `${RT.oy + o.y * s}px`;
    st.width = `${o.w * s}px`;
    st.height = `${o.h * s}px`;
    st.fontSize = `${(o.size ?? o.h * 0.55) * s}px`;
    st.borderWidth = `${Math.max(2, 4 * s)}px`;
    st.borderRadius = `${16 * s}px`;
    st.padding = `0 ${14 * s}px`;
  }
}

/** open a text field (closes any other one) */
export function openTextInput(o: TextInputOpts): TextInput { return new TextInput(o); }

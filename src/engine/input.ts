import { PadReader, STD_BUTTONS, canRumble, isLinuxDesktop, type GamepadLike, type PadFrame, type PadKind } from './pads';

export type { PadKind } from './pads';

export type Action =
  | 'left' | 'right' | 'up' | 'down' | 'jump' | 'attack' | 'shoot' | 'dash'
  | 'swap' | 'heal' | 'pause' | 'confirm' | 'back' | 'fwd' | 'bwd' | 'camL' | 'camR'
  // co-op update
  | 'interact' | 'ping' | 'score' | 'talk' | 'chat' | 'qp1' | 'qp2' | 'qp3' | 'qp4' | 'emote'
  // settings update: camera zoom keys, F1 = controls & settings
  | 'zoomIn' | 'zoomOut' | 'help'
  // «Хрумляндия»: the hero's own special / team move (Бублик: bridge / trampoline…; heroes without one: dash)
  | 'special';

// co-op keys, same in 2D and 3D: R revive/use, G ping, Tab (hold) scoreboard, V (hold) push-to-talk,
// T chat (Enter stays confirm), 1-4 quick phrases, B emote
const COOP_KEYS: Record<string, Action[]> = {
  KeyR: ['interact'], KeyG: ['ping'], Tab: ['score'], KeyV: ['talk'], KeyT: ['chat'],
  Digit1: ['qp1'], Digit2: ['qp2'], Digit3: ['qp3'], Digit4: ['qp4'],
  Numpad1: ['qp1'], Numpad2: ['qp2'], Numpad3: ['qp3'], Numpad4: ['qp4'],
  KeyB: ['emote'],
};

const KEYMAP: Record<string, Action[]> = {
  ArrowLeft: ['left'], KeyA: ['left'],
  ArrowRight: ['right'], KeyD: ['right'],
  ArrowUp: ['up', 'jump'], KeyW: ['up', 'jump'],
  ArrowDown: ['down'], KeyS: ['down'],
  Space: ['jump', 'confirm'], KeyZ: ['jump'],
  KeyJ: ['attack'], KeyX: ['attack'],
  KeyK: ['shoot'], KeyC: ['shoot'],
  KeyL: ['dash'], ShiftLeft: ['dash'], ShiftRight: ['dash'],
  KeyQ: ['swap'], KeyE: ['heal'], KeyF: ['heal'],
  Escape: ['pause', 'back'], KeyP: ['pause'],
  Enter: ['confirm'], NumpadEnter: ['confirm'], Backspace: ['back'],
  Mouse0: ['attack'], Mouse2: ['shoot'],
  ...COOP_KEYS,
};

// ───────────── 3D: rebindable (settings → Управление) ─────────────

/** actions the player can rebind, in the order the controls table shows them */
export const BIND_ACTIONS = [
  'fwd', 'bwd', 'left', 'right', 'jump', 'attack', 'shoot', 'dash', 'special', 'swap', 'heal', 'interact',
  'camL', 'camR', 'zoomOut', 'zoomIn', 'pause', 'chat', 'talk', 'score', 'ping', 'emote', 'qp1', 'qp2', 'qp3', 'qp4',
] as const;
export type BindAction = typeof BIND_ACTIONS[number];
/** overrides over the defaults (what the save keeps): key codes incl. 'Mouse0'..'Mouse4' / standard pad buttons */
export interface Binds { kb?: Partial<Record<string, string[]>>; pad?: Partial<Record<string, number[]>> }
/** slots per action and device in the table */
export const BIND_SLOTS = 2;

/**
 * 3D defaults. WASD/arrows move relative to the camera, the mouse looks around; mouse buttons are codes 'Mouse0'
 * (left), 'Mouse1' (middle), 'Mouse2' (right), 'Mouse3'/'Mouse4' (side) and count only while the pointer is locked
 * in play (input.mouseCombat). Co-op keys, same in 2D and 3D: R revive/use, G ping, Tab (hold) scoreboard,
 * V (hold) push-to-talk, T chat (Enter stays confirm), 1-4 quick phrases, B emote.
 */
export const DEFAULT_KB: Record<BindAction, string[]> = {
  fwd: ['KeyW', 'ArrowUp'], bwd: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  jump: ['Space'], attack: ['Mouse0', 'KeyJ'], shoot: ['Mouse2', 'KeyK'], dash: ['ShiftLeft', 'KeyL'], special: ['KeyC'],
  swap: ['KeyQ'], heal: ['KeyE', 'KeyF'], interact: ['KeyR'],
  camL: ['KeyZ', 'BracketLeft'], camR: ['BracketRight'], zoomOut: ['Minus', 'NumpadSubtract'], zoomIn: ['Equal', 'NumpadAdd'],
  pause: ['KeyP'], chat: ['KeyT'], talk: ['KeyV'], score: ['Tab'], ping: ['KeyG'], emote: ['KeyB'],
  qp1: ['Digit1', 'Numpad1'], qp2: ['Digit2', 'Numpad2'], qp3: ['Digit3', 'Numpad3'], qp4: ['Digit4', 'Numpad4'],
};
/** keys that always work on top of the binds (menus, Esc, F1) */
const FIXED_KB: Record<string, Action[]> = {
  Escape: ['pause', 'back'], Enter: ['confirm'], NumpadEnter: ['confirm'], Space: ['confirm'], Backspace: ['back'], F1: ['help'],
};
/** never bindable: the fixed menu keys plus the browser's own (reload, full screen, dev tools) */
export const RESERVED_KEYS = new Set(['Escape', 'Enter', 'NumpadEnter', 'F1', 'F5', 'F11', 'F12', 'MetaLeft', 'MetaRight', 'ContextMenu', 'CapsLock', 'NumLock']);
/** a bound key also brings these (W/S keep stepping through menus, as before) */
const BIND_EXTRA: Partial<Record<BindAction, Action[]>> = { fwd: ['up'], bwd: ['down'] };
/** left/right twins act as one key */
const TWIN: Record<string, string> = { ShiftLeft: 'ShiftRight', ControlLeft: 'ControlRight', AltLeft: 'AltRight' };
const TWINS = new Set(Object.values(TWIN));
/** the code a binding stores for a pressed key (ShiftRight → ShiftLeft) */
export function bindCode(code: string): string {
  for (const k in TWIN) if (TWIN[k] === code) return k;
  return code;
}
/** movement on a pad is the left stick (and the d-pad solo): not rebindable there */
export const PAD_FIXED_ACTIONS = new Set<BindAction>(['fwd', 'bwd', 'left', 'right']);

/** keys whose browser default (scroll, focus jump, history back, help) we swallow while playing */
const SWALLOW = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Tab', 'F1']);

/**
 * Gamepad, standard indices (PlayStation / Xbox names), defaults:
 *  0 ✕/A jump+confirm   1 ○/B special+back (a hero without a special move dashes)   2 □/X attack   3 △/Y shoot
 *  4 L1/LB heal         5 R1/RB interact  6 L2/LT shoot (hold = aim)   7 R2/RT dash
 *  8 Create/Share/View scoreboard (hold)  9 Options/Menu pause
 *  10 L3 ping           11 R3 tap = swap weapon, hold = emote (a button bound to both: handled in pollPad)
 *  12-15 d-pad ↑↓←→: menus always; solo 3D also moves the hero (as before); online co-op (input.coop)
 *        sends quick phrases ↑1 →2 ↓3 ←4 instead of moving, except while a menu has the d-pad (menuTick)
 *  17 touchpad (PS) / Share (Xbox Series) push-to-talk (hold)
 * Everything but confirm/back on ✕/○, Options and the d-pad can be rebound (settings → Управление).
 */
export const DEFAULT_PAD: Record<BindAction, number[]> = {
  fwd: [], bwd: [], left: [], right: [],
  jump: [0], attack: [2], shoot: [3, 6], dash: [7], special: [1], swap: [11], heal: [4], interact: [5],
  camL: [], camR: [], zoomOut: [], zoomIn: [], pause: [], chat: [], talk: [17], score: [8], ping: [10], emote: [11],
  qp1: [], qp2: [], qp3: [], qp4: [],
};
/** pad buttons that always do this on top of the binds */
const FIXED_PAD: Record<number, Action[]> = { 0: ['confirm'], 1: ['back'], 9: ['pause'], 12: ['up'], 13: ['down'], 14: ['left'], 15: ['right'] };
/** never bindable: Options (pause/menus), the d-pad (menus, solo movement, co-op phrases), Home */
export const RESERVED_PAD = new Set([9, 12, 13, 14, 15, 16]);

function addTo(m: Record<string | number, Action[]>, k: string | number, a: Action) {
  const l = (m[k] ??= []);
  if (!l.includes(a)) l.push(a);
}
function buildKeymap(kb: Record<BindAction, string[]>): Record<string, Action[]> {
  const m: Record<string, Action[]> = {};
  for (const a of BIND_ACTIONS) {
    for (const code of kb[a]) {
      for (const c of TWIN[code] ? [code, TWIN[code]] : [code]) {
        addTo(m, c, a);
        for (const x of BIND_EXTRA[a] ?? []) addTo(m, c, x);
      }
    }
  }
  for (const [code, acts] of Object.entries(FIXED_KB)) for (const a of acts) addTo(m, code, a);
  return m;
}
function buildPadmap(pad: Record<BindAction, number[]>): Record<number, Action[]> {
  const m: Record<number, Action[]> = {};
  for (const a of BIND_ACTIONS) for (const i of pad[a]) addTo(m, i, a);
  for (const [i, acts] of Object.entries(FIXED_PAD)) for (const a of acts) addTo(m, +i, a);
  return m;
}
const isBindAction = (a: string): a is BindAction => (BIND_ACTIONS as readonly string[]).includes(a);
function copyBinds<T>(d: Record<BindAction, T[]>): Record<BindAction, T[]> {
  return Object.fromEntries(BIND_ACTIONS.map((a) => [a, d[a].slice()])) as Record<BindAction, T[]>;
}
/** pad buttons → actions with the default binds (tests, docs) */
export const PADMAP: Record<number, Action[]> = buildPadmap(DEFAULT_PAD);

/** what a rebind waits for: a key, a mouse button ('Mouse0'..; x/y in UI space) or a standard pad button */
export type Captured = { kind: 'key'; code: string } | { kind: 'mouse'; code: string; x: number; y: number } | { kind: 'pad'; button: number };
/** co-op quick phrases on the d-pad (only with input.coop, never while a menu has the d-pad) */
export const PAD_QP: Record<number, Action> = { 12: 'qp1', 15: 'qp2', 13: 'qp3', 14: 'qp4' };
/** R3: released before this → 'swap', held this long → 'emote' (no swap) */
const R3_HOLD_MS = 350;
/** another pad takes over only after the one in hand was unused this long (stops duplicate devices fighting) */
const SWITCH_IDLE_MS = 400;
/** at most one rumble command per this many ms, unless the new mix is stronger */
const RUMBLE_GAP_MS = 60;
const STICK_DIR_ACTS: Action[] = ['left', 'right', 'up', 'fwd', 'down', 'bwd'];

export interface PadEvent {
  type: 'connect' | 'disconnect';
  /** human name: "DualSense", "DualShock 4", "Xbox", ... */
  name: string;
  kind: PadKind;
  index: number;
}

class PadEntry {
  reader: PadReader;
  frame: PadFrame | null = null;
  /** last fresh input (new press, big stick tilt, or the press that revealed it): picks which pad wants focus */
  lastActive = -1;
  /** last time it was in use (anything held, a stick being moved; not the reveal press): keeps the focus */
  lastUse = -1e9;
  constructor(public gp: GamepadLike, public seenAt: number, linux: boolean) { this.reader = new PadReader(gp, linux); }
}

interface RumbleFx { w: number; s: number; end: number }

function isTextTarget(t: EventTarget | null): boolean {
  if (!t || !(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export class Input {
  private keymap: Record<string, Action[]> = KEYMAP;
  private mode: '2d' | '3d' = '2d';
  /** effective 3D binds (defaults + the player's rebinds) and the maps built from them */
  private kbBinds = copyBinds(DEFAULT_KB);
  private padBinds = copyBinds(DEFAULT_PAD);
  private keymap3d = buildKeymap(this.kbBinds);
  private padmap = buildPadmap(this.padBinds);
  /** a rebind is waiting for the next key / mouse button / pad button (settings) */
  private capture: ((c: Captured) => void) | null = null;
  private capPrev: boolean[] = [];
  private capAt = 0;
  /** raw key codes / pad buttons pressed this tick, whatever they're bound to (settings tabs: Q/E, L1/R1) */
  private rawQueue = new Set<string>();
  private rawKeys = new Set<string>();
  private rawPad: boolean[] = [];
  private rawPadPrev: boolean[] = [];
  private keys = new Set<string>();
  /** mouse look delta accumulated since the last tick (pixels) */
  lookX = 0;
  lookY = 0;
  private lookAccX = 0;
  private lookAccY = 0;
  wheel = 0;
  private wheelAcc = 0;
  /** active gamepad sticks, deadzoned (radial, rescaled) and drift-compensated; y down */
  stickRX = 0;
  stickRY = 0;
  stickLX = 0;
  stickLY = 0;
  locked = false;
  /** when true, mouse buttons map to attack/shoot (only while pointer locked) */
  mouseCombat = false;
  /**
   * Online co-op (the session sets it while connected): the d-pad stops moving the hero and sends quick
   * phrases qp1-4 instead. Solo leaves it false: the d-pad moves the hero in 3D and steers menus, as before.
   */
  coop = false;
  /** allow input.rumble() (settings toggle) */
  rumbleEnabled = true;
  private el: HTMLElement | null = null;
  private _suspended = false;
  private offs: (() => void)[] = [];

  /** test hooks: where pads come from and what time it is */
  padSource: () => readonly (GamepadLike | null)[] = () => {
    try { return navigator.getGamepads ? (navigator.getGamepads() as unknown as (GamepadLike | null)[]) : []; } catch { return []; }
  };
  now: () => number = () => performance.now();
  linux = isLinuxDesktop();

  setMode(mode: '2d' | '3d') { this.mode = mode; this.keymap = mode === '3d' ? this.keymap3d : KEYMAP; }

  /**
   * Apply the player's rebinds (save.data.settings.binds) over the defaults; unknown actions / reserved keys are
   * dropped. Only the 3D game is rebindable (the 2D version keeps its fixed keys).
   */
  setBinds(b: Binds | null | undefined) {
    const kb = copyBinds(DEFAULT_KB), pad = copyBinds(DEFAULT_PAD);
    for (const [a, codes] of Object.entries(b?.kb ?? {})) {
      if (!isBindAction(a) || !Array.isArray(codes)) continue;
      kb[a] = codes.filter((c) => typeof c === 'string' && c && !RESERVED_KEYS.has(c)).slice(0, BIND_SLOTS);
    }
    for (const [a, btns] of Object.entries(b?.pad ?? {})) {
      if (!isBindAction(a) || !Array.isArray(btns) || PAD_FIXED_ACTIONS.has(a)) continue;
      pad[a] = btns.filter((i) => Number.isInteger(i) && i >= 0 && i < STD_BUTTONS && !RESERVED_PAD.has(i)).slice(0, BIND_SLOTS);
    }
    this.kbBinds = kb; this.padBinds = pad;
    this.keymap3d = buildKeymap(kb);
    this.padmap = buildPadmap(pad);
    if (this.mode === '3d') this.keymap = this.keymap3d;
    this.keys.clear(); this.mouseHeld.clear(); this.queue.clear();
  }

  /** the effective binds of an action (copies): keyboard/mouse codes and pad buttons, in slot order */
  bindsOf(a: BindAction): { kb: string[]; pad: number[] } { return { kb: this.kbBinds[a].slice(), pad: this.padBinds[a].slice() }; }

  /**
   * Rebinding: the next key, mouse button or pad button goes to `cb` instead of the game (one shot). Buttons held
   * when it starts must be let go first; whatever was pressed counts in the game only after a release.
   */
  startCapture(cb: (c: Captured) => void) {
    this.capture = cb;
    this.capAt = this.now();
    this.capPrev = (this.active?.frame?.p ?? []).slice();
    this.keys.clear(); this.queue.clear(); this.mouseHeld.clear();
  }
  stopCapture() { if (this.capture) { this.capture = null; this.padLatch = true; } }
  get capturing() { return !!this.capture; }
  private deliver(c: Captured) {
    const cb = this.capture;
    this.capture = null;
    this.padLatch = true;
    cb?.(c);
  }

  /** this physical key went down this tick (ignores binds; for UI like the settings tabs) */
  keyHit(code: string) { return this.rawKeys.has(code); }
  /** standard pad button i went down this tick on the active pad (ignores binds) */
  padHit(i: number) { return !!this.rawPad[i] && !this.rawPadPrev[i]; }

  /**
   * While true (a chat / name box has focus) the keyboard is ignored entirely and the pad drives nothing
   * (it is still read: hot-plug, activity, padHeld). Pad buttons still held when it turns false count only
   * after a release, so the ✕ / ○ that closed the box never also jumps / dashes / backs out.
   */
  get suspended() { return this._suspended; }
  set suspended(v: boolean) {
    if (v === this._suspended) return;
    this._suspended = v;
    // drop held keys and this tick's actions so the hero doesn't keep running while typing
    // (and again after, in case a keyup was eaten)
    this.keys.clear();
    this.queue.clear();
    this.pressedSet.clear();
    this.padDown = new Set();
    if (!v) this.padLatch = true;
  }

  requestLock() {
    try { if (this.el && document.pointerLockElement !== this.el) void this.el.requestPointerLock(); } catch { /* not allowed */ }
  }
  releaseLock() { try { if (document.pointerLockElement) document.exitPointerLock(); } catch { /* ignore */ } }
  private queue = new Set<Action>();
  private pressedSet = new Set<Action>();
  private padDown = new Set<Action>();
  /** actions held via mouse buttons (pointer locked) */
  private mouseHeld = new Map<number, Action[]>();
  mouseX = 0;
  mouseY = 0;
  mouseDown = false;
  mouseClicked = false;
  private clickQueued = false;
  mouseMoved = false;
  anyKeyQueued = false;
  anyKey = false;
  lastDevice: 'kb' | 'pad' = 'kb';
  onFirstGesture: (() => void) | null = null;

  // ---- gamepads ----
  private pads = new Map<string, PadEntry>();
  private active: PadEntry | null = null;
  private padSubs = new Set<(e: PadEvent) => void>();
  /** a pad button bound to both swap and emote (R3 by default): tap = swap, hold = emote */
  private r3 = { down: false, t0: 0, emote: false, i: -1 };
  private stickDir = { l: false, r: false, u: false, d: false };
  /** buttons that count again only after a release (held while typing / when typing ended) */
  private padBlock: boolean[] = new Array(STD_BUTTONS).fill(false);
  private padLatch = false;
  /** pressed buttons of the active pad last poll (after padBlock) */
  private btnPrev: boolean[] = [];
  private qpHeld = new Set<Action>();
  /** mapped pad actions held right now, ignoring suspended/padBlock (padHeld) */
  private padHeldSet = new Set<Action>();
  private menuNow = false;
  private menuPrev = false;
  private rumbleFx: RumbleFx[] = [];
  private rumbleOut = { w: 0, s: 0, until: 0, gp: null as GamepadLike | null };
  private rumbleAt = -1e9;
  /** name of the active pad ('' when none): "DualSense", "DualShock 4", "Xbox", ... */
  padName = '';
  /** family of the active pad, null when none */
  padKind: PadKind | null = null;

  private listen<E extends Event>(t: EventTarget, type: string, fn: (e: E) => void, opts?: AddEventListenerOptions) {
    const h = fn as unknown as EventListener;
    t.addEventListener(type, h, opts);
    this.offs.push(() => t.removeEventListener(type, h, opts));
  }

  /** `keyTarget`: where key events are heard (window; tests pass a detached element) */
  attach(el: HTMLElement, toLogical: (cx: number, cy: number) => [number, number], keyTarget: EventTarget = window) {
    this.detach();
    this.el = el;
    this.listen(document, 'pointerlockchange', () => { this.locked = document.pointerLockElement === el; if (!this.locked) this.mouseHeld.clear(); });
    this.listen<MouseEvent>(el, 'mousemove', (e) => {
      if (this.locked) { this.lookAccX += e.movementX; this.lookAccY += e.movementY; }
    });
    this.listen<WheelEvent>(el, 'wheel', (e) => { this.wheelAcc += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    this.listen<KeyboardEvent>(keyTarget, 'keydown', (e) => {
      this.gesture();
      if (this._suspended || isTextTarget(e.target)) return;
      if (this.capture) { e.preventDefault(); if (!e.repeat) { this.lastDevice = 'kb'; this.deliver({ kind: 'key', code: e.code }); } return; }
      const acts = this.keymap[e.code];
      // a bound key never does its browser thing (e.g. ' = quick find) — unless it's a shortcut (Ctrl+R stays reload)
      if (SWALLOW.has(e.code) || (acts && e.code !== 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.rawQueue.add(e.code);
      if (acts) for (const a of acts) this.queue.add(a);
      this.anyKeyQueued = true;
      this.lastDevice = 'kb';
    });
    this.listen<KeyboardEvent>(keyTarget, 'keyup', (e) => { this.keys.delete(e.code); });
    this.listen(window, 'blur', () => { this.keys.clear(); this.mouseHeld.clear(); });
    this.listen<PointerEvent>(el, 'pointermove', (e) => {
      const [x, y] = toLogical(e.clientX, e.clientY);
      this.mouseX = x; this.mouseY = y; this.mouseMoved = true;
    });
    this.listen<PointerEvent>(el, 'pointerdown', (e) => {
      this.gesture();
      const [x, y] = toLogical(e.clientX, e.clientY);
      this.mouseX = x; this.mouseY = y;
      this.lastDevice = 'kb';
      // (no preventDefault: that would also cancel the mouseup that stops a side button's history back)
      if (this.capture && e.pointerType !== 'touch') { this.deliver({ kind: 'mouse', code: 'Mouse' + e.button, x, y }); return; }
      // combat buttons are handled by mousedown (pointer events don't fire for chorded presses)
      if (this.locked && this.mouseCombat) return;
      this.mouseDown = true; this.clickQueued = true;
      el.focus();
    });
    this.listen(window, 'pointerup', () => { this.mouseDown = false; });
    this.listen<MouseEvent>(el, 'mousedown', (e) => {
      if (!this.locked || !this.mouseCombat || this.capture) return;
      const acts = this.keymap['Mouse' + e.button];
      if (acts?.length) { for (const a of acts) this.queue.add(a); this.mouseHeld.set(e.button, acts); this.lastDevice = 'kb'; }
    });
    this.listen<MouseEvent>(window, 'mouseup', (e) => {
      this.mouseHeld.delete(e.button);
      // mouse side buttons are game buttons (bindable), never history back / forward out of the game
      if (e.button === 3 || e.button === 4) e.preventDefault();
    });
    this.listen(el, 'contextmenu', (e) => e.preventDefault());
    // hot-plug: notice pads right away even if no tick runs (polling in beginTick catches everything else,
    // including pads that the browser only reveals after a button press)
    this.listen(window, 'gamepadconnected', () => this.scanPads());
    this.listen(window, 'gamepaddisconnected', () => this.scanPads());
  }

  /** undo attach(): remove every listener it added */
  detach() {
    for (const off of this.offs) off();
    this.offs = [];
    this.el = null;
    this.keys.clear();
    this.mouseHeld.clear();
  }

  private gesture() {
    if (this.onFirstGesture) { const f = this.onFirstGesture; this.onFirstGesture = null; f(); }
  }

  /** called at the start of each fixed update tick */
  beginTick() {
    for (const a of this.queue) this.pressedSet.add(a);
    this.queue.clear();
    this.rawKeys = this.rawQueue; this.rawQueue = new Set();
    // a rebind nobody answers (its panel went away with the scene) never keeps the keyboard
    if (this.capture && this.now() - this.capAt > 12000) this.capture = null;
    this.mouseClicked = this.clickQueued; this.clickQueued = false;
    this.lookX = this.lookAccX; this.lookY = this.lookAccY; this.lookAccX = 0; this.lookAccY = 0;
    this.wheel = this.wheelAcc; this.wheelAcc = 0;
    this.anyKey = this.anyKeyQueued; this.anyKeyQueued = false;
    this.pollPad();
  }

  endTick() {
    this.pressedSet.clear();
    this.rawKeys.clear();
    this.mouseClicked = false;
    this.anyKey = false;
    this.mouseMoved = false;
    this.lookX = 0; this.lookY = 0; this.wheel = 0;
    this.menuPrev = this.menuNow; this.menuNow = false;
  }

  /**
   * A menu / list / overlay reads the d-pad this tick (MenuList.update calls it every tick). In co-op the
   * next tick's d-pad presses then only navigate and send no quick phrases. Call it every tick it applies.
   */
  menuTick() { this.menuNow = true; }

  // ---------- gamepads ----------

  /** subscribe to pad connect/disconnect (e.g. toast "Подключён DualSense"); returns unsubscribe */
  onPad(cb: (e: PadEvent) => void): () => void {
    this.padSubs.add(cb);
    return () => { this.padSubs.delete(cb); };
  }

  /** a gamepad is connected (not necessarily used yet) */
  get padConnected() { return this.pads.size > 0; }

  private emitPad(type: PadEvent['type'], e: PadEntry) {
    const ev: PadEvent = { type, name: e.reader.ident.name, kind: e.reader.ident.kind, index: e.gp.index };
    for (const f of this.padSubs) { try { f(ev); } catch (err) { console.error(err); } }
  }

  /** sync the pad list with the browser: add new pads, drop vanished ones */
  private scanPads(): GamepadLike[] {
    const now = this.now();
    const list: GamepadLike[] = [];
    const seen = new Set<string>();
    for (const gp of this.padSource()) {
      if (!gp || gp.connected === false) continue;
      const key = gp.index + '|' + gp.id;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(gp);
      let e = this.pads.get(key);
      if (!e) {
        e = new PadEntry(gp, now, this.linux);
        this.pads.set(key, e);
        this.emitPad('connect', e);
      }
      e.gp = gp;
    }
    for (const [k, e] of this.pads) {
      if (seen.has(k)) continue;
      this.pads.delete(k);
      if (this.active === e) this.active = null;
      this.emitPad('disconnect', e);
    }
    this.pickActive(now);
    return list;
  }

  /**
   * ONE pad drives the game: the one with the latest fresh input (a known pad wins a tie), but it takes over
   * only when the pad in hand is unused for SWITCH_IDLE_MS — a pad revealed with a stuck button can't grab
   * the focus from someone aiming with L2. The newest pad until anyone touches one.
   */
  private pickActive(now: number) {
    let best: PadEntry | null = null;
    for (const e of this.pads.values()) {
      if (e.lastActive < 0) continue;
      if (!best || e.lastActive > best.lastActive
        || (e.lastActive === best.lastActive && best.reader.ident.kind === 'generic' && e.reader.ident.kind !== 'generic')) best = e;
    }
    const cur = this.active;
    if (best && best !== cur && (!cur || now - cur.lastUse > SWITCH_IDLE_MS)) this.active = best;
    if (!this.active) for (const e of this.pads.values()) if (!this.active || e.seenAt > this.active.seenAt) this.active = e;
    const a = this.active;
    this.padName = a ? a.reader.ident.name : '';
    this.padKind = a ? a.reader.ident.kind : null;
    if (a !== cur) { this.resetPadState(); this.padBlock.fill(false); }
  }

  private resetPadState() {
    this.stickDir = { l: false, r: false, u: false, d: false };
    this.r3.down = false;
    this.btnPrev = [];
    this.qpHeld.clear();
  }

  private pollPad() {
    const now = this.now();
    // read every pad (activity tracking needs all of them, also while typing), then pick the active one
    for (const gp of this.scanPads()) {
      const e = this.pads.get(gp.index + '|' + gp.id);
      if (!e) continue;
      const fr = (e.frame = e.reader.read(gp, now));
      if (fr.active) e.lastActive = now;
      if (fr.busy) e.lastUse = now;
    }
    this.pickActive(now);
    if (this.rumbleFx.length) this.mixRumble(now);

    const prev = this.padDown;
    const down = (this.padDown = new Set<Action>());
    this.padHeldSet.clear();
    this.stickLX = this.stickLY = this.stickRX = this.stickRY = 0;
    const resumed = this.padLatch;
    this.padLatch = false;
    const f = this.active?.frame;
    this.rawPadPrev = this.rawPad;
    this.rawPad = f && !this._suspended ? f.p.slice() : [];
    if (!f) { this.resetPadState(); this.padBlock.fill(false); return; }
    // the press that revealed this pad was let go: it's the device in hand (a stuck button never lets go)
    if (f.wake) { this.lastDevice = 'pad'; this.gesture(); }

    // mapped buttons as they are, for UI outside the tick and while typing (text boxes: ✕ done, ○ cancel)
    const pm = this.padmap;
    for (let i = 0; i < STD_BUTTONS; i++) if (f.p[i]) for (const a of pm[i] ?? []) this.padHeldSet.add(a);

    // rebinding: a fresh press (not one held when it started) is the answer; the game sees nothing meanwhile
    if (this.capture && !this._suspended) {
      const prevP = this.capPrev;
      this.capPrev = f.p.slice();
      for (let i = 0; i < STD_BUTTONS; i++) if (f.p[i] && !prevP[i]) { this.lastDevice = 'pad'; this.deliver({ kind: 'pad', button: i }); break; }
      this.resetPadState();
      return;
    }

    // buttons pressed while typing, or still held when it ended, count again only after a release
    const blk = this.padBlock;
    const p: boolean[] = new Array(STD_BUTTONS);
    for (let i = 0; i < STD_BUTTONS; i++) {
      if (!f.p[i]) blk[i] = false;
      else if (this._suspended || resumed) blk[i] = true;
      p[i] = f.p[i] && !blk[i];
    }
    if (this._suspended) { this.resetPadState(); return; } // typing: the pad drives nothing

    // a button bound to both swap and emote is a tap/hold pair (below), the rest are plain
    let pair = -1;
    for (let i = 0; i < STD_BUTTONS; i++) {
      const acts = pm[i];
      if (!acts) continue;
      const dual = pair < 0 && acts.includes('swap') && acts.includes('emote');
      if (dual) pair = i;
      if (p[i]) for (const a of acts) if (!dual || (a !== 'swap' && a !== 'emote')) down.add(a);
    }
    // co-op quick phrases: a fresh d-pad press during play (not while a menu has the d-pad), held until let go
    const qpOk = this.coop && !this.menuPrev;
    for (const k in PAD_QP) {
      const i = +k, a = PAD_QP[i];
      if (!p[i]) this.qpHeld.delete(a);
      else if (qpOk && !this.btnPrev[i]) this.qpHeld.add(a);
      if (this.qpHeld.has(a)) down.add(a);
    }
    this.btnPrev = p;
    // R3 (or whichever button has both): tap = swap weapon, hold = emote
    let tapSwap = false;
    if (this.r3.i !== pair) this.r3 = { down: false, t0: 0, emote: false, i: pair };
    if (pair >= 0 && p[pair]) {
      if (!this.r3.down) { this.r3.down = true; this.r3.t0 = now; this.r3.emote = false; }
      else if (now - this.r3.t0 >= R3_HOLD_MS) this.r3.emote = true;
      if (this.r3.emote) down.add('emote');
    } else if (this.r3.down) {
      this.r3.down = false;
      if (!this.r3.emote) tapSwap = true;
    }

    this.stickLX = f.lx; this.stickLY = f.ly;
    this.stickRX = f.rx; this.stickRY = f.ry;
    // left stick also steers menus (with hysteresis so it doesn't chatter at the threshold)
    const sd = this.stickDir;
    const thr = (on: boolean, v: number) => (on ? v > 0.35 : v > 0.55);
    sd.l = thr(sd.l, -f.lx); sd.r = thr(sd.r, f.lx);
    sd.u = thr(sd.u, -f.ly); sd.d = thr(sd.d, f.ly);
    if (sd.l) down.add('left');
    if (sd.r) down.add('right');
    if (sd.u) { down.add('up'); down.add('fwd'); }
    if (sd.d) { down.add('down'); down.add('bwd'); }
    // a stick still pushed when typing ended keeps steering but doesn't count as a fresh menu step
    if (resumed) for (const a of STICK_DIR_ACTS) if (down.has(a)) prev.add(a);

    let edge = tapSwap;
    if (tapSwap) this.pressedSet.add('swap');
    for (const a of down) if (!prev.has(a)) { this.pressedSet.add(a); edge = true; }
    if (edge) this.anyKey = true;
    if (edge || (f.active && !f.reveal)) this.lastDevice = 'pad';
    if (edge) this.gesture();
  }

  /**
   * Rumble the active pad (0..1 magnitudes). No-op without support (Firefox), when disabled, or when the
   * player is on keyboard. Effects mix: the pad plays the strongest of everything still running, so a short
   * strong hit on top of a long buzz plays at once and the buzz comes back after it. Commands are throttled
   * to one per 60 ms unless the mix gets stronger.
   */
  rumble(weak: number, strong: number, ms: number) {
    if (!this.rumbleEnabled || this.lastDevice !== 'pad') return;
    const gp = this.active?.gp;
    if (!gp || !canRumble(gp)) return;
    const w = Math.min(1, Math.max(0, weak || 0)), s = Math.min(1, Math.max(0, strong || 0));
    const dur = Math.min(5000, Math.max(0, ms || 0));
    if (dur <= 0 || Math.max(w, s) <= 0) return;
    const now = this.now();
    const fx = this.rumbleFx.filter((e) => e.end > now);
    fx.push({ w, s, end: now + dur });
    if (fx.length > 12) { fx.sort((a, b) => b.end - a.end); fx.length = 12; }
    this.rumbleFx = fx;
    this.mixRumble(now);
  }

  /** send the current mix to the pad if it changed (called by rumble() and every tick while effects run) */
  private mixRumble(now: number) {
    const fx = (this.rumbleFx = this.rumbleFx.filter((e) => e.end > now));
    if (!fx.length) return;
    const gp = this.active?.gp;
    if (!gp || !canRumble(gp) || !this.rumbleEnabled) { this.rumbleFx = []; return; }
    const mixAt = (t: number): [number, number] => {
      let w = 0, s = 0;
      for (const e of fx) if (e.end > t) { w = Math.max(w, e.w); s = Math.max(s, e.s); }
      return [w, s];
    };
    const [w, s] = mixAt(now);
    // this mix holds until the first effect end that changes it
    let until = now;
    for (const end of fx.map((e) => e.end).sort((a, b) => a - b)) {
      until = end;
      const [w2, s2] = mixAt(end);
      if (w2 !== w || s2 !== s) break;
    }
    const o = this.rumbleOut;
    const playing = o.gp === gp && now < o.until;
    if (playing && w === o.w && s === o.s && until <= o.until) return;
    const stronger = !playing || w > o.w || s > o.s;
    if (!stronger && now - this.rumbleAt < RUMBLE_GAP_MS) return; // a later tick sends it
    this.rumbleAt = now;
    Object.assign(o, { w, s, until, gp });
    try {
      const r = gp.vibrationActuator!.playEffect!('dual-rumble', { startDelay: 0, duration: Math.round(until - now), weakMagnitude: w, strongMagnitude: s });
      if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => { /* pad gone / not allowed */ });
    } catch { /* unsupported */ }
  }

  /** the active pad can rumble */
  get canRumble() { return canRumble(this.active?.gp); }

  /** the active pad has standard button i (17 = touchpad/share is missing on some pads) */
  padHas(i: number): boolean {
    const a = this.active;
    return !!a && a.reader.has(a.gp, i);
  }

  /**
   * Mapped action held on the active pad as of the last poll — works while `suspended` and outside the tick,
   * ignores the release-first rule. For UI that reads the pad itself, e.g. a text box: ✕ 'confirm' = done,
   * ○ 'back' = cancel, Options 'pause' = done (do your own edge detection). Button actions only.
   */
  padHeld(a: Action): boolean { return !this.modal && this.padHeldSet.has(a); }

  // ---------- queries ----------

  private keyDown(a: Action): boolean {
    for (const k of this.keys) { const acts = this.keymap[k]; if (acts && acts.includes(a)) return true; }
    return false;
  }

  /**
   * A modal overlay (the hero picker) owns the input this tick: the scene under it sees no actions, no movement
   * (the overlay reads its keys first, then the scene updates with modal = true).
   */
  modal = false;

  down(a: Action): boolean {
    if (this.modal) return false;
    if (this.padDown.has(a)) return true;
    for (const m of this.mouseHeld.values()) if (m.includes(a)) return true;
    return this.keyDown(a);
  }

  pressed(a: Action): boolean { return !this.modal && this.pressedSet.has(a); }

  consume(a: Action) { this.pressedSet.delete(a); }

  axisX() { return (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0); }

  /** 3D move vector in camera space: x = strafe right, y = forward (keys, left stick, d-pad in solo) */
  move3(): { x: number; y: number } {
    if (this.modal) return { x: 0, y: 0 };
    const pad = !this.coop; // in co-op the d-pad is quick phrases
    const d = (a: Action) => this.keyDown(a) || (pad && this.padDown.has(a));
    let x = (d('right') ? 1 : 0) - (d('left') ? 1 : 0);
    let y = (d('fwd') || d('up') ? 1 : 0) - (d('bwd') || d('down') ? 1 : 0);
    if (this.stickLX || this.stickLY) { x = this.stickLX; y = -this.stickLY; }
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }

  /** key codes (and 'MouseN') bound to an action in the current mode, binds in slot order first (hints / glyphs) */
  keysFor(a: Action): string[] {
    const out: string[] = [];
    if (this.mode === '3d' && isBindAction(a)) out.push(...this.kbBinds[a]);
    for (const k in this.keymap) if (this.keymap[k].includes(a) && !out.includes(k) && !TWINS.has(k)) out.push(k);
    return out;
  }

  /** standard pad buttons bound to an action, binds in slot order first (hints / glyphs) */
  padButtonsFor(a: Action): number[] {
    const out: number[] = isBindAction(a) ? this.padBinds[a].slice() : [];
    for (const [k, acts] of Object.entries(FIXED_PAD)) if (acts.includes(a) && !out.includes(+k)) out.push(+k);
    for (const [k, q] of Object.entries(PAD_QP)) if (q === a && !out.includes(+k)) out.push(+k);
    return out;
  }

  clearAll() { this.pressedSet.clear(); this.queue.clear(); this.mouseClicked = false; }
}

export const input = new Input();

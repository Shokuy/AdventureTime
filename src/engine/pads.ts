/**
 * Controller database: who a pad is (from gamepad.id) and how to read it as a W3C "standard" pad,
 * also when the browser hands us the raw HID order (mapping !== 'standard': older Firefox, Safari HID,
 * Firefox on Linux, odd builds). Raw layouts follow Chromium's gamepad_standard_mappings_{mac,linux}
 * and Firefox's GamepadRemapping.cpp, so we read exactly what those browsers would have remapped.
 *
 * Pure logic, no DOM: input.ts owns the polling, tests feed fake Gamepad objects.
 */

export type PadKind = 'ps5' | 'ps4' | 'xbox' | 'switch' | 'generic';

/** standard gamepad button indices (W3C) + 17 = PlayStation touchpad / Xbox Series Share / Switch Capture */
export const PB = {
  SOUTH: 0, EAST: 1, WEST: 2, NORTH: 3, L1: 4, R1: 5, L2: 6, R2: 7, SELECT: 8, START: 9,
  L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, HOME: 16, EXTRA: 17,
} as const;
export const STD_BUTTONS = 18;

/** the bits of the Gamepad API we use (structural, so tests can pass plain objects) */
export interface PadButtonLike { pressed: boolean; value: number }
export interface RumbleLike {
  playEffect?: (type: string, params: Record<string, number>) => Promise<unknown> | unknown;
  effects?: readonly string[];
  type?: string;
}
export interface GamepadLike {
  id: string;
  index: number;
  mapping: string;
  connected?: boolean;
  buttons: readonly PadButtonLike[];
  axes: readonly number[];
  vibrationActuator?: RumbleLike | null;
}

// ---------- identification ----------

export type LayoutId =
  | 'sonyHid' | 'sonyLinux' | 'ds3' | 'x360' | 'xOneS' | 'xBt' | 'xBt2016' | 'xOneBt' | 'xLinux' | 'hid' | 'generic';

export interface PadIdent {
  vendor: number | null;
  product: number | null;
  kind: PadKind;
  /** human name for toasts: "DualSense", "DualShock 4", "Xbox", ... */
  name: string;
  /** raw layout for this exact product (used only when mapping !== 'standard') */
  layout: LayoutId | null;
}

const V_SONY = 0x054c, V_MS = 0x045e, V_NINTENDO = 0x057e, V_VALVE = 0x28de, V_8BITDO = 0x2dc8;

type Known = [PadKind, string, LayoutId | null];
const KNOWN: Record<string, Known> = {
  // Sony
  '054c:05c4': ['ps4', 'DualShock 4', 'sonyHid'],
  '054c:09cc': ['ps4', 'DualShock 4', 'sonyHid'],
  '054c:0ba0': ['ps4', 'DualShock 4', 'sonyHid'], // USB wireless adaptor
  '054c:0ce6': ['ps5', 'DualSense', 'sonyHid'],
  '054c:0df2': ['ps5', 'DualSense Edge', 'sonyHid'],
  '054c:0e5f': ['ps5', 'PS Access', 'sonyHid'],
  '054c:0268': ['ps4', 'DualShock 3', 'ds3'],
  // Microsoft
  '045e:028e': ['xbox', 'Xbox 360', 'x360'],
  '045e:028f': ['xbox', 'Xbox 360', 'x360'],
  '045e:0719': ['xbox', 'Xbox 360', 'x360'],
  '045e:02d1': ['xbox', 'Xbox One', 'x360'],
  '045e:02dd': ['xbox', 'Xbox One', 'x360'],
  '045e:02e3': ['xbox', 'Xbox Elite', 'x360'],
  '045e:02ea': ['xbox', 'Xbox One', 'x360'],
  '045e:0b00': ['xbox', 'Xbox Elite', 'x360'],
  '045e:0b0a': ['xbox', 'Xbox Adaptive', 'x360'],
  '045e:0b12': ['xbox', 'Xbox', 'x360'], // Series X|S over USB
  '045e:02e0': ['xbox', 'Xbox One', 'xOneS'],
  '045e:02fd': ['xbox', 'Xbox One', 'xBt2016'],
  '045e:0b05': ['xbox', 'Xbox Elite', 'xBt2016'], // newer firmware (>10 axes) switches to xOneBt
  '045e:0b0c': ['xbox', 'Xbox Adaptive', 'xOneBt'],
  '045e:0b13': ['xbox', 'Xbox', 'xBt'],
  '045e:0b20': ['xbox', 'Xbox One', 'xBt'],
  '045e:0b21': ['xbox', 'Xbox Adaptive', 'xBt'],
  '045e:0b22': ['xbox', 'Xbox Elite', 'xBt'],
  // Nintendo
  '057e:2009': ['switch', 'Switch Pro', null],
  '057e:200e': ['switch', 'Joy-Con', null],
  '057e:2006': ['switch', 'Joy-Con (L)', null],
  '057e:2007': ['switch', 'Joy-Con (R)', null],
};

const hex4 = (n: number) => n.toString(16).padStart(4, '0');

/**
 * Vendor/product from every id format we know:
 *  Chrome/Edge:  "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)"
 *  Firefox:      "054c-0ce6-DualSense Wireless Controller"
 *  Safari (HID): "54c-ce6-DualSense Wireless Controller" (no zero padding)
 *  Safari (GameController) and Chrome XInput carry no ids at all:
 *                "DualSense Wireless Controller Extended Gamepad", "Xbox 360 Controller (XInput STANDARD GAMEPAD)"
 */
export function parseVidPid(id: string): { vendor: number | null; product: number | null } {
  let m = /vendor:\s*([0-9a-f]{1,4})\s*product:\s*([0-9a-f]{1,4})/i.exec(id);
  if (!m) m = /^\s*([0-9a-f]{1,4})-([0-9a-f]{1,4})-./i.exec(id);
  if (!m) return { vendor: null, product: null };
  return { vendor: parseInt(m[1], 16), product: parseInt(m[2], 16) };
}

/** the product name part of the id, without ids / browser decorations */
export function cleanPadName(id: string): string {
  return id
    .replace(/^\s*[0-9a-f]{1,4}-[0-9a-f]{1,4}-/i, '')
    .replace(/\((?:[^)]*?)(?:STANDARD GAMEPAD|Vendor:|XInput)[^)]*\)/gi, '')
    .replace(/\s+Extended\s+Gamepad\s*$/i, '')
    .replace(/(Controller)\s+Gamepad\s*$/i, '$1') // Safari: "<vendorName> [Extended ]Gamepad"
    .replace(/^(?:Sony (?:Interactive|Computer) Entertainment|Microsoft|Nintendo Co\., Ltd\.)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function identifyPad(id: string): PadIdent {
  const { vendor, product } = parseVidPid(id);
  if (vendor !== null && product !== null) {
    const k = KNOWN[hex4(vendor) + ':' + hex4(product)];
    if (k) return { vendor, product, kind: k[0], name: k[1], layout: k[2] };
  }
  const n = cleanPadName(id).toLowerCase();
  const by = (kind: PadKind, name: string): PadIdent => ({ vendor, product, kind, name, layout: null });
  if (/dualsense edge/.test(n)) return by('ps5', 'DualSense Edge');
  if (/dualsense|\bps5\b|playstation\(r\)5/.test(n)) return by('ps5', 'DualSense');
  if (/dualshock\s*4|\bps4\b/.test(n) || /^wireless controller\b/.test(n)) return by('ps4', 'DualShock 4');
  if (/dualshock|playstation|sony/.test(n) || vendor === V_SONY) return by('ps4', 'PlayStation');
  if (/xbox|xinput|x-box|microsoft/.test(n) || vendor === V_MS) return by('xbox', 'Xbox');
  if (/steam/.test(n) || vendor === V_VALVE) return by('xbox', 'Steam');
  if (/pro controller|joy-?con|nintendo|switch/.test(n) || vendor === V_NINTENDO) return by('switch', 'Switch');
  if (vendor === V_8BITDO || /8bitdo/.test(n)) return by('generic', '8BitDo');
  const nice = cleanPadName(id);
  return by('generic', nice && nice.length <= 24 ? nice : nice ? nice.slice(0, 22).trim() + '…' : 'Геймпад');
}

/** which raw layout to read a pad with; null = the browser already gives the standard layout */
export function pickLayout(ident: PadIdent, mapping: string, axesLen: number, linux: boolean): LayoutId | null {
  if (mapping === 'standard') return null;
  // Linux evdev/joydev order (Firefox on Linux): hat as two axes, no axis 9
  if (linux && axesLen < 10) {
    if (ident.kind === 'ps4' || ident.kind === 'ps5') return ident.layout === 'ds3' ? 'ds3' : 'sonyLinux';
    return axesLen >= 6 ? 'xLinux' : 'generic';
  }
  if (ident.layout === 'xBt2016' && ident.name === 'Xbox Elite' && axesLen > 10) return 'xOneBt';
  if (ident.layout) return ident.layout;
  if (ident.kind === 'ps4' || ident.kind === 'ps5') return axesLen >= 10 ? 'sonyHid' : 'generic';
  // unknown HID pad on macOS/Windows: DirectInput order, right stick on Z/Rz, hat on axis 9
  return axesLen >= 10 ? 'hid' : 'generic';
}

// ---------- raw layouts ----------
// Per standard slot: 'bN' raw button, 'tN' trigger axis (-1..1 → 0..1), 'hN' hat axis (direction from the
// d-pad slot), '-N' / '+N' half of an axis, 'aN' plain axis; 'x|y' = max of both; '.' = absent.
// buttons: 0 ✕/A 1 ○/B 2 □/X 3 △/Y 4 L1 5 R1 6 L2 7 R2 8 Share/View 9 Options/Menu 10 L3 11 R3 12-15 d-pad ↑↓←→ 16 home 17 touchpad/share
// axes: LX LY RX RY

interface LayoutDef { buttons: string; axes: string }
const LAYOUTS: Record<LayoutId, LayoutDef> = {
  // DualShock 4 / DualSense, raw HID on macOS & Windows (axes X Y Z Rx Ry Rz … hat@9)
  sonyHid: { buttons: 'b1 b2 b0 b3 b4 b5 t3|b6 t4|b7 b8 b9 b10 b11 h9 h9 h9 h9 b12 b13', axes: 'a0 a1 a2 a5' },
  // hid-sony / hid-playstation through evdev (Linux)
  sonyLinux: { buttons: 'b0 b1 b3 b2 b4 b5 t2|b6 t5|b7 b8 b9 b11 b12 -7 +7 -6 +6 b10 .', axes: 'a0 a1 a3 a4' },
  // DualShock 3 / SIXAXIS (pressure-sensitive buttons)
  ds3: { buttons: 'b14 b13 b15 b12 b10 b11 b8|t14 b9|t15 b0 b3 b1 b2 b4 b6 b7 b5 b16 .', axes: 'a0 a1 a2 a5' },
  // Xbox 360 / One over USB through a HID driver (macOS)
  x360: { buttons: 'b0 b1 b2 b3 b4 b5 t2 t5 b9 b8 b6 b7 b11 b12 b13 b14 b10 .', axes: 'a0 a1 a3 a4' },
  // Xbox One S Bluetooth, original firmware (045e:02e0)
  xOneS: { buttons: 'b0 b1 b2 b3 b4 b5 t2 t5 b6 b7 b8 b9 h9 h9 h9 h9 b10 .', axes: 'a0 a1 a3 a4' },
  // Xbox Bluetooth (Series X|S, One S 2019+ firmware); 15 = Share on Series pads
  xBt: { buttons: 'b0 b1 b3 b4 b6 b7 t3 t4 b10 b11 b13 b14 h9 h9 h9 h9 b12 b15', axes: 'a0 a1 a2 a5' },
  // Xbox One S Bluetooth 2016 firmware (045e:02fd): View on 16, Xbox button moved between 15 and 12
  xBt2016: { buttons: 'b0 b1 b3 b4 b6 b7 t3 t4 b16 b11 b13 b14 h9 h9 h9 h9 b12|b15 .', axes: 'a0 a1 a2 a5' },
  // Xbox Adaptive / Elite 2 new firmware over Bluetooth: triggers on 10/11
  xOneBt: { buttons: 'b0 b1 b3 b4 b6 b7 t10 t11 b31 b11 b13 b14 h9 h9 h9 h9 b30 .', axes: 'a0 a1 a2 a5' },
  // xpad / generic evdev order (Linux): A B X Y LB RB Back Start Guide LS RS, triggers on axes 2/5
  xLinux: { buttons: 'b0 b1 b2 b3 b4 b5 t2 t5 b6 b7 b9 b10 -7 +7 -6 +6 b8 .', axes: 'a0 a1 a3 a4' },
  // unknown DirectInput pad: Logitech/8BitDo D-mode style (1=A 2=B 0=X 3=Y), right stick Z/Rz
  hid: { buttons: 'b1 b2 b0 b3 b4 b5 b6 b7 b8 b9 b10 b11 h9 h9 h9 h9 b12 b13', axes: 'a0 a1 a2 a5' },
  // last resort: assume the buttons are already in standard order; a hat axis is found at runtime
  generic: { buttons: 'b0 b1 b2 b3 b4 b5 b6 b7 b8 b9 b10 b11 b12 b13 b14 b15 b16 b17', axes: 'a0 a1 a2 a3' },
};

type SrcKind = 'b' | 't' | 'h' | '-' | '+' | 'a';
interface Src { k: SrcKind; i: number }
interface Compiled { buttons: Src[][]; axes: Src[][] }

function compileSlot(s: string): Src[] {
  if (s === '.' || !s) return [];
  return s.split('|').map((p) => ({ k: p[0] as SrcKind, i: parseInt(p.slice(1), 10) }));
}
const compiledCache = new Map<LayoutId, Compiled>();
export function compileLayout(id: LayoutId): Compiled {
  let c = compiledCache.get(id);
  if (!c) {
    const d = LAYOUTS[id];
    c = { buttons: d.buttons.split(' ').map(compileSlot), axes: d.axes.split(' ').map(compileSlot) };
    compiledCache.set(id, c);
  }
  return c;
}

// ---------- helpers ----------

/**
 * Hat switch on one axis: -1 = up, then clockwise in steps of 2/7 (… 1 = up-left).
 * Rest is a value > 1 (≈1.2857), and some drivers say exactly 0 for "no data yet".
 */
export function decodeHat(v: number): { up: boolean; down: boolean; left: boolean; right: boolean } {
  if (!(Math.abs(v) <= 1.05) || v === 0) return { up: false, down: false, left: false, right: false };
  const k = ((Math.round((v + 1) * 3.5) % 8) + 8) % 8; // 0 = up, 2 = right, 4 = down, 6 = left
  return { up: k === 7 || k === 0 || k === 1, right: k >= 1 && k <= 3, down: k >= 3 && k <= 5, left: k >= 5 && k <= 7 };
}

/** radial deadzone with rescale: direction kept, magnitude remapped inner..outer → 0..1 */
export function radialDeadzone(x: number, y: number, inner = 0.16, outer = 0.94): [number, number] {
  const m = Math.hypot(x, y);
  if (m <= inner || !isFinite(m)) return [0, 0];
  const k = Math.min(1, (m - inner) / Math.max(0.05, outer - inner)) / m;
  return [x * k, y * k];
}

export const STICK_INNER = 0.16;
export const STICK_OUTER = 0.94;

/** ±1 step of an 8-bit stick: anything inside this box around the anchor counts as "not moving" */
const STILL_BOX = 0.01;
/** seconds dead still (no buttons held) before a rest spot is trusted as the stick's real centre */
const LEARN_AFTER = 2;
/** a tilt this big (raw) let go of within SNAP_WINDOW s before the stick settled = it sprang back by itself */
const SNAP_FROM = 0.5;
const SNAP_WINDOW = 0.25;
/** rest spots further out than this (raw) are a held stick, never drift; the learned centre is capped at DRIFT_MAX */
const DRIFT_MAX_RAW = 0.3;
const DRIFT_MAX = 0.25;

/**
 * Stick drift: a worn stick springs back to a spot off-centre. That spot is learned only when it clearly is
 * the rest position: the stick sits inside the deadzone, or it just snapped back from a big tilt — and then
 * stays dead still for 2 s with no button held on the pad. A thumb holding a gentle tilt (slow walk, slow
 * aim) jitters, holds buttons, or eased in, so it is never learned. A reading inside the plain deadzone is
 * always 0 (a wrong centre can never move the hero by itself), and passing through the true centre pulls a
 * learned one back toward it.
 */
export class StickFilter {
  ox = 0;
  oy = 0;
  /** anchor of the current still period and how long (s) the stick stayed in a STILL_BOX around it */
  private ax = 0;
  private ay = 0;
  private still = 0;
  /** seconds since the stick was last tilted beyond SNAP_FROM */
  private sinceBig = 1e9;
  /** the current still period began right after a big tilt was let go */
  private snapped = false;

  /** `busy`: a button is held on this pad (the player is playing, not resting the stick) */
  apply(x: number, y: number, dt: number, busy = false): [number, number] {
    const m = Math.hypot(x, y);
    this.sinceBig = m > SNAP_FROM ? 0 : this.sinceBig + dt;
    if (busy || Math.abs(x - this.ax) > STILL_BOX || Math.abs(y - this.ay) > STILL_BOX) {
      this.ax = x; this.ay = y; this.still = 0;
      this.snapped = this.sinceBig < SNAP_WINDOW;
    } else this.still += dt;

    if (this.still >= LEARN_AFTER && m < DRIFT_MAX_RAW && (m <= STICK_INNER || this.snapped)) {
      const k = Math.min(1, dt * 3);
      this.ox += (x - this.ox) * k;
      this.oy += (y - this.oy) * k;
      const o = Math.hypot(this.ox, this.oy);
      if (o > DRIFT_MAX) { this.ox *= DRIFT_MAX / o; this.oy *= DRIFT_MAX / o; }
    } else if (m < STICK_INNER * 0.5) {
      // at (or passing through) the true centre: a learned offset is probably stale
      const k = Math.min(1, dt * 4);
      this.ox -= this.ox * k;
      this.oy -= this.oy * k;
    }
    if (m <= STICK_INNER || !isFinite(m)) return [0, 0];
    const off = Math.hypot(this.ox, this.oy);
    return radialDeadzone(x - this.ox, y - this.oy, STICK_INNER, STICK_OUTER - off);
  }

  /** the stick moved within the last second (a resting worn stick doesn't count as the player using it) */
  get moving() { return this.still < 1; }

  reset() { this.ox = this.oy = this.ax = this.ay = this.still = 0; this.sinceBig = 1e9; this.snapped = false; }
}

// ---------- reading one pad ----------

export interface PadFrame {
  /** 0..1 per standard button */
  v: number[];
  /** pressed per standard button (triggers with hysteresis; buttons held since connect are ignored until released) */
  p: boolean[];
  /** sticks after drift compensation + radial deadzone, -1..1, y down */
  lx: number; ly: number; rx: number; ry: number;
  /** the player touched this pad this frame (new press or stick pushed) */
  active: boolean;
  /** the player is using this pad: a button held or a stick in use (not the reveal press, not a resting worn stick) */
  busy: boolean;
  /** first frame of a pad that showed up with a button held (how browsers reveal pads) */
  reveal: boolean;
  /** the button(s) that revealed this pad were just let go (a stuck button never is) */
  wake: boolean;
}

const AXIS_LIVE = 0.15;
const TRIG_ON = 0.45, TRIG_OFF = 0.3;

/**
 * Reads one physical pad into the standard layout. Keeps the per-pad memory needed for that:
 * which axes ever moved (stuck/phantom axes and "0 until first touch" triggers stay silent),
 * which buttons were seen released (a button held at connect, or a stuck one, is ignored), hat axes found
 * at runtime, trigger hysteresis and stick drift.
 */
export class PadReader {
  readonly ident: PadIdent;
  readonly layout: LayoutId | null;
  private c: Compiled | null;
  private first: number[] | null = null;
  private live: boolean[] = [];
  /** axes seen beyond ±1.05: hat switches, never sticks */
  readonly hatAxes = new Set<number>();
  private armed: boolean[] = new Array(STD_BUTTONS).fill(false);
  private prevP: boolean[] = new Array(STD_BUTTONS).fill(false);
  private trig = [false, false];
  private fl = new StickFilter();
  private fr = new StickFilter();
  private lastT = -1;
  private frames = 0;
  /** raw buttons held when the pad showed up, until all are let go */
  private revealBtns: number[] | null = null;

  constructor(gp: GamepadLike, linux = false) {
    this.ident = identifyPad(gp.id);
    this.layout = pickLayout(this.ident, gp.mapping, gp.axes.length, linux);
    this.c = this.layout ? compileLayout(this.layout) : null;
  }

  /** this pad physically has standard button i (e.g. 17 = touchpad is missing on Xbox One and in Safari) */
  has(gp: GamepadLike, i: number): boolean {
    if (!this.c) return i < gp.buttons.length;
    return (this.c.buttons[i] ?? []).some((s) => (s.k === 'b' ? s.i < gp.buttons.length : s.i < gp.axes.length));
  }

  private axis(gp: GamepadLike, i: number): number {
    const v = gp.axes[i];
    if (v === undefined || !isFinite(v)) return 0;
    if (!this.live[i]) return 0;
    return v;
  }

  private rawBtn(gp: GamepadLike, i: number): number {
    const b = gp.buttons[i];
    if (!b) return 0;
    // analog value wins (the browser's own "pressed" fires at ~0.1 on triggers); digital pads may say 0
    return b.value > 0 ? Math.min(1, b.value) : b.pressed ? 1 : 0;
  }

  private src(gp: GamepadLike, s: Src, slot: number): number {
    switch (s.k) {
      case 'b': return this.rawBtn(gp, s.i);
      case 't': return this.live[s.i] ? Math.min(1, Math.max(0, ((gp.axes[s.i] ?? -1) + 1) / 2)) : 0;
      case 'h': {
        if (!this.live[s.i]) return 0;
        const h = decodeHat(gp.axes[s.i] ?? 2);
        return (slot === PB.UP ? h.up : slot === PB.DOWN ? h.down : slot === PB.LEFT ? h.left : h.right) ? 1 : 0;
      }
      case '-': return Math.max(0, -this.axis(gp, s.i));
      case '+': return Math.max(0, this.axis(gp, s.i));
      case 'a': return this.hatAxes.has(s.i) ? 0 : this.axis(gp, s.i);
    }
  }

  read(gp: GamepadLike, nowMs: number): PadFrame {
    const dt = this.lastT < 0 ? 1 / 60 : Math.min(0.1, Math.max(0, (nowMs - this.lastT) / 1000));
    this.lastT = nowMs;
    const firstFrame = this.frames++ === 0;

    // axis liveness + runtime hat detection
    if (!this.first) this.first = gp.axes.map((a) => (isFinite(a) ? a : 0));
    for (let i = 0; i < gp.axes.length; i++) {
      const a = gp.axes[i];
      if (!isFinite(a)) continue;
      if (Math.abs(a) > 1.05) this.hatAxes.add(i);
      if (!this.live[i] && Math.abs(a - (this.first[i] ?? 0)) > AXIS_LIVE) this.live[i] = true;
    }

    // buttons → standard slots
    const v: number[] = new Array(STD_BUTTONS).fill(0);
    if (this.c) {
      const bs = this.c.buttons;
      for (let i = 0; i < STD_BUTTONS; i++) {
        let m = 0;
        for (const s of bs[i] ?? []) m = Math.max(m, this.src(gp, s, i));
        v[i] = m;
      }
    } else {
      for (let i = 0; i < STD_BUTTONS; i++) v[i] = this.rawBtn(gp, i);
    }
    // hat found at runtime (generic layouts / standard pads with an extra hat axis)
    if (this.hatAxes.size && (!this.c || this.layout === 'generic' || this.layout === 'xLinux')) {
      for (const hi of this.hatAxes) {
        if (!this.live[hi]) continue;
        const h = decodeHat(gp.axes[hi]);
        if (h.up) v[PB.UP] = 1;
        if (h.down) v[PB.DOWN] = 1;
        if (h.left) v[PB.LEFT] = 1;
        if (h.right) v[PB.RIGHT] = 1;
        break;
      }
    }

    const p: boolean[] = new Array(STD_BUTTONS).fill(false);
    for (let i = 0; i < STD_BUTTONS; i++) {
      if (i === PB.L2 || i === PB.R2) {
        const t = i - PB.L2;
        this.trig[t] = this.trig[t] ? v[i] > TRIG_OFF : v[i] > TRIG_ON;
        p[i] = this.trig[t];
      } else p[i] = v[i] > 0.5;
      if (!p[i]) this.armed[i] = true;
      else if (!this.armed[i]) { p[i] = false; v[i] = 0; }
    }

    // sticks (a held button = the player is busy: drift is never learned then)
    const ax = (slot: number) => {
      const srcs = this.c ? this.c.axes[slot] : [{ k: 'a' as const, i: slot }];
      const s = srcs[0];
      return s ? this.src(gp, s, -1) : 0;
    };
    let held = false;
    for (let i = 0; i < STD_BUTTONS && !held; i++) if (v[i] > 0.1) held = true;
    const [lx, ly] = this.fl.apply(ax(0), ax(1), dt, held);
    const [rx, ry] = this.fr.apply(ax(2), ax(3), dt, held);
    // in use: a real press held (stuck / held-since-connect buttons are never "pressed"), or a stick being moved
    const busy = p.some(Boolean) || ((lx !== 0 || ly !== 0) && this.fl.moving) || ((rx !== 0 || ry !== 0) && this.fr.moving);

    let active = Math.hypot(lx, ly) > 0.5 || Math.hypot(rx, ry) > 0.5;
    for (let i = 0; i < STD_BUTTONS && !active; i++) if (p[i] && !this.prevP[i]) active = true;
    // pads that only show up after a button press (browser privacy): that press picks the pad
    const reveal = firstFrame && gp.buttons.some((b) => b && b.pressed);
    if (reveal) {
      active = true;
      this.revealBtns = [];
      gp.buttons.forEach((b, i) => { if (b && b.pressed) this.revealBtns!.push(i); });
    }
    let wake = false;
    if (!reveal && this.revealBtns && this.revealBtns.every((i) => !gp.buttons[i]?.pressed)) { wake = true; this.revealBtns = null; }
    this.prevP = p;
    return { v, p, lx, ly, rx, ry, active, busy, reveal, wake };
  }
}

/** true when this browser runs on desktop Linux (raw pads come in evdev order there) */
export function isLinuxDesktop(): boolean {
  try { return /Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent); } catch { return false; }
}

/** dual-rumble support on this pad (Chrome/Edge/Safari; Firefox has none) */
export function canRumble(gp: GamepadLike | null | undefined): boolean {
  const va = gp?.vibrationActuator;
  if (!va || typeof va.playEffect !== 'function') return false;
  if (Array.isArray(va.effects)) return va.effects.includes('dual-rumble');
  return va.type === undefined || va.type === 'dual-rumble';
}

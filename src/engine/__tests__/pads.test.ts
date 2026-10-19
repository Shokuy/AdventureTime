/**
 * Gamepad mapping tests with fake Gamepad objects. Run in a browser tab served by Vite:
 *   const m = await import('/src/engine/__tests__/pads.test.ts'); m.runPadTests()
 * Returns { pass, fail, log } and prints failures to the console.
 */
import { Input, type Action } from '../input';
import {
  PB, PadReader, StickFilter, cleanPadName, decodeHat, identifyPad, parseVidPid, radialDeadzone,
  type GamepadLike, type PadKind,
} from '../pads';
import { drawGlyph, glyphLabel, padButtonLabel } from '../../ui/glyphs';

interface FakePad extends GamepadLike {
  buttons: { pressed: boolean; value: number }[];
  axes: number[];
  index: number;
  connected: boolean;
}

function fake(id: string, mapping: string, nb: number, axes: number[], index = 0): FakePad {
  return { id, index, mapping, connected: true, buttons: Array.from({ length: nb }, () => ({ pressed: false, value: 0 })), axes: axes.slice() };
}
const press = (p: FakePad, i: number, v = 1) => { p.buttons[i] = { pressed: v > 0.1, value: v }; };
const release = (p: FakePad, i: number) => { p.buttons[i] = { pressed: false, value: 0 }; };

const HAT_REST = 9 / 7;
const HAT = { up: -1, upRight: -5 / 7, right: -3 / 7, downRight: -1 / 7, down: 1 / 7, downLeft: 3 / 7, left: 5 / 7, upLeft: 1 };

export function runPadTests() {
  const log: string[] = [];
  let pass = 0, fail = 0;
  const ok = (cond: unknown, name: string) => {
    if (cond) pass++;
    else { fail++; log.push('FAIL ' + name); console.error('FAIL', name); }
  };
  const near = (a: number, b: number, eps = 0.03) => Math.abs(a - b) <= eps;

  // ---------- ids ----------
  const ids: [string, number | null, number | null][] = [
    ['DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', 0x054c, 0x0ce6],
    ['054c-0ce6-DualSense Wireless Controller', 0x054c, 0x0ce6],
    ['54c-5c4-Wireless Controller', 0x054c, 0x05c4],
    ['USB Gamepad (Vendor: 0079 Product: 0011)', 0x0079, 0x0011],
    ['Xbox 360 Controller (XInput STANDARD GAMEPAD)', null, null],
    ['DualSense Wireless Controller Extended Gamepad', null, null],
  ];
  for (const [id, v, p] of ids) {
    const r = parseVidPid(id);
    ok(r.vendor === v && r.product === p, `parseVidPid ${id} → ${r.vendor}:${r.product}`);
  }
  ok(cleanPadName('054c-0ce6-Sony Interactive Entertainment DualSense Wireless Controller') === 'DualSense Wireless Controller', 'cleanPadName firefox linux');
  ok(cleanPadName('USB Gamepad (Vendor: 0079 Product: 0011)') === 'USB Gamepad', 'cleanPadName chrome');

  const kinds: [string, PadKind, string][] = [
    ['DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', 'ps5', 'DualSense'],
    ['DualSense Edge Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0df2)', 'ps5', 'DualSense Edge'],
    ['Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)', 'ps4', 'DualShock 4'],
    ['054c-05c4-Wireless Controller', 'ps4', 'DualShock 4'],
    ['54c-ce6-DualSense Wireless Controller', 'ps5', 'DualSense'],
    ['DualSense Wireless Controller Extended Gamepad', 'ps5', 'DualSense'],
    ['DUALSHOCK 4 Wireless Controller Extended Gamepad', 'ps4', 'DualShock 4'],
    ['Wireless Controller Extended Gamepad', 'ps4', 'DualShock 4'],
    ['Xbox 360 Controller (XInput STANDARD GAMEPAD)', 'xbox', 'Xbox'],
    ['Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', 'xbox', 'Xbox'],
    ['045e-0b13-Xbox Wireless Controller', 'xbox', 'Xbox'],
    ['Xbox Wireless Controller Extended Gamepad', 'xbox', 'Xbox'],
    ['Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)', 'switch', 'Switch Pro'],
    ['Steam Virtual Gamepad', 'xbox', 'Steam'],
    ['USB Gamepad (Vendor: 0079 Product: 0011)', 'generic', 'USB Gamepad'],
  ];
  for (const [id, k, n] of kinds) {
    const r = identifyPad(id);
    ok(r.kind === k && r.name === n, `identify ${id} → ${r.kind} "${r.name}"`);
  }

  // ---------- hat ----------
  const hatCases: [number, string][] = [
    [HAT.up, 'u'], [HAT.upRight, 'ur'], [HAT.right, 'r'], [HAT.downRight, 'dr'], [HAT.down, 'd'],
    [HAT.downLeft, 'dl'], [HAT.left, 'l'], [HAT.upLeft, 'ul'], [HAT_REST, ''], [0, ''], [3.2857, ''], [NaN, ''],
  ];
  for (const [v, want] of hatCases) {
    const h = decodeHat(v);
    const got = (h.up ? 'u' : '') + (h.down ? 'd' : '') + (h.left ? 'l' : '') + (h.right ? 'r' : '');
    ok(got === want, `decodeHat ${v.toFixed(3)} → "${got}" want "${want}"`);
  }

  // ---------- deadzone / drift ----------
  ok(radialDeadzone(0.1, 0.1)[0] === 0, 'deadzone kills 0.14 radius');
  ok(near(radialDeadzone(0.94, 0)[0], 1), 'deadzone outer → 1');
  ok(near(Math.hypot(...radialDeadzone(0.75, 0.75)), 1), 'deadzone diagonal clamps to 1');
  const mid = radialDeadzone(0.55, 0);
  ok(mid[0] > 0.45 && mid[0] < 0.55 && mid[1] === 0, 'deadzone rescales and keeps direction');
  const DT = 1 / 60;
  const sf = new StickFilter();
  let out: [number, number] = [0, 0];
  for (let i = 0; i < 20; i++) sf.apply(0.9, 0, DT); // run...
  for (let i = 0; i < 300; i++) out = sf.apply(0.24, 0.06, DT); // ...let go: a worn stick springs back off-centre
  ok(out[0] === 0 && out[1] === 0 && near(sf.ox, 0.24, 0.04), `drift learned after a snap-back (ox=${sf.ox.toFixed(3)})`);
  out = sf.apply(1, 0.06, DT);
  ok(out[0] > 0.95, `full tilt still reaches 1 after drift compensation (${out[0].toFixed(3)})`);
  const sf2 = new StickFilter();
  let o2: [number, number] = [0, 0];
  for (let i = 0; i < 120; i++) o2 = sf2.apply(0.6 + Math.sin(i) * 0.02, 0, DT); // thumb holding the stick
  ok(o2[0] > 0.45, 'held stick is not eaten by drift learning');
  {
    // review case: a gentle deliberate tilt (slow walk) held 3 s, dead still and with 1-step noise
    const want = (0.28 - 0.16) / (0.94 - 0.16);
    for (const noise of [0, 1 / 127.5]) {
      const f = new StickFilter();
      let o: [number, number] = [0, 0], minX = 1;
      for (let i = 0; i < 180; i++) { o = f.apply(0.28 + (i % 2 ? noise : 0), 0, DT); if (i > 5) minX = Math.min(minX, o[0]); }
      ok(minX > want - 0.02 && f.ox === 0, `gentle tilt 0.28 held 3 s stays ${want.toFixed(3)} (min ${minX.toFixed(3)}, noise ${noise.toFixed(4)})`);
      let back = 0;
      for (let i = 0; i < 90; i++) { o = f.apply(0, 0, DT); back = Math.max(back, Math.abs(o[0])); }
      ok(back === 0, `released after a gentle tilt → no movement by itself (${back.toFixed(3)})`);
    }
    // eased down from a big tilt but a button is held (aiming with L2 while panning slowly): never learned
    const f = new StickFilter();
    for (let i = 0; i < 10; i++) f.apply(0.8, 0, DT, true);
    let o: [number, number] = [0, 0];
    for (let i = 0; i < 240; i++) o = f.apply(0.27, 0, DT, true);
    ok(f.ox === 0 && o[0] > 0.13, `slow aim with a button held keeps panning (${o[0].toFixed(3)})`);
    // a centre learned wrongly can never move the hero once the stick is back inside the deadzone, and fades
    const g = new StickFilter();
    g.ox = 0.25;
    o = g.apply(0, 0, DT);
    ok(o[0] === 0 && o[1] === 0, 'wrong centre: stick at rest gives 0');
    for (let i = 0; i < 30; i++) g.apply(0.01, 0, DT);
    ok(g.ox < 0.04, `wrong centre fades at the true centre (ox=${g.ox.toFixed(3)})`);
  }

  // ---------- standard mapping (Chrome DualSense) ----------
  {
    const p = fake('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', 'standard', 18, [0, 0, 0, 0]);
    const r = new PadReader(p);
    let t = 0;
    const rd = () => r.read(p, (t += 16));
    ok(r.layout === null, 'standard pad: no remap');
    rd();
    press(p, 0); ok(rd().p[PB.SOUTH], 'std ✕ pressed');
    release(p, 0);
    press(p, 6, 0.6); ok(rd().p[PB.L2], 'std L2 0.6 pressed');
    press(p, 6, 0.35); ok(rd().p[PB.L2], 'std L2 0.35 still pressed (hysteresis)');
    press(p, 6, 0.2); ok(!rd().p[PB.L2], 'std L2 0.2 released');
    press(p, 17); ok(rd().p[PB.EXTRA], 'std touchpad (17)');
    release(p, 17);
    p.axes[2] = 0.9; p.axes[3] = -0.9;
    const f = rd();
    ok(f.rx > 0.6 && f.ry < -0.6, `std right stick (${f.rx.toFixed(2)}, ${f.ry.toFixed(2)})`);
    ok(r.has(p, 17), 'std pad has 17');
  }
  {
    // Chrome trigger reading 0.5 until first touch → ignored until released
    const p = fake('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)', 'standard', 18, [0, 0, 0, 0]);
    press(p, 7, 0.5);
    const r = new PadReader(p);
    ok(!r.read(p, 0).p[PB.R2], 'R2 stuck at 0.5 on connect is ignored');
    press(p, 7, 0.0); r.read(p, 16);
    press(p, 7, 0.9); ok(r.read(p, 32).p[PB.R2], 'R2 works after first release');
  }

  // ---------- raw DualShock 4 / DualSense (Firefox / Safari HID on macOS & Windows) ----------
  for (const id of ['054c-05c4-Wireless Controller', '054c-0ce6-DualSense Wireless Controller']) {
    const axes = [0, 0, 0, 0, 0, 0, 0, 0, 0, HAT_REST]; // triggers read 0 ("no data") until touched
    const p = fake(id, '', 15, axes);
    const r = new PadReader(p);
    let t = 0;
    const rd = () => r.read(p, (t += 16));
    ok(r.layout === 'sonyHid', `${id} → sonyHid (${r.layout})`);
    let f = rd();
    ok(!f.p[PB.L2] && f.v[PB.L2] === 0 && !f.p[PB.R2], `${id}: untouched triggers read 0`);
    const face: [number, number, string][] = [[1, PB.SOUTH, '✕'], [2, PB.EAST, '○'], [0, PB.WEST, '□'], [3, PB.NORTH, '△'],
      [4, PB.L1, 'L1'], [5, PB.R1, 'R1'], [8, PB.SELECT, 'Share'], [9, PB.START, 'Options'], [10, PB.L3, 'L3'], [11, PB.R3, 'R3'], [13, PB.EXTRA, 'touchpad']];
    for (const [raw, std, n] of face) {
      press(p, raw); f = rd();
      ok(f.p[std] && f.p.filter(Boolean).length === 1, `${id}: raw ${raw} → ${n}`);
      release(p, raw); rd();
    }
    const dirs: [number, number[]][] = [[HAT.up, [PB.UP]], [HAT.right, [PB.RIGHT]], [HAT.down, [PB.DOWN]], [HAT.left, [PB.LEFT]], [HAT.upRight, [PB.UP, PB.RIGHT]], [HAT.downLeft, [PB.DOWN, PB.LEFT]]];
    for (const [v, want] of dirs) {
      p.axes[9] = v; f = rd();
      const got = [PB.UP, PB.DOWN, PB.LEFT, PB.RIGHT].filter((i) => f.p[i]);
      ok(got.join() === want.join(), `${id}: hat ${v.toFixed(2)} → [${got}] want [${want}]`);
      p.axes[9] = HAT_REST; rd();
    }
    ok(!rd().p[PB.UP], `${id}: hat rest releases`);
    // triggers -1..1 on axes 3/4
    p.axes[3] = -1; p.axes[4] = -1; f = rd();
    ok(!f.p[PB.L2] && f.v[PB.L2] === 0, `${id}: L2 at rest after first touch`);
    p.axes[3] = 1; p.axes[4] = 0.2; f = rd();
    ok(f.p[PB.L2] && near(f.v[PB.L2], 1) && f.p[PB.R2] && near(f.v[PB.R2], 0.6), `${id}: L2 full, R2 0.6`);
    p.axes[3] = -1; p.axes[4] = -1; rd();
    // right stick on axes 2 (Z) and 5 (Rz), not on the trigger axes
    p.axes[2] = 0.9; p.axes[5] = -0.9; f = rd();
    ok(f.rx > 0.6 && f.ry < -0.6, `${id}: right stick from axes 2/5 (${f.rx.toFixed(2)}, ${f.ry.toFixed(2)})`);
    p.axes[2] = 0; p.axes[5] = 0;
    p.axes[0] = -1; f = rd();
    ok(f.lx < -0.9 && f.ly === 0, `${id}: left stick`);
    ok(r.has(p, 17), `${id}: has touchpad`);
  }

  // ---------- raw Xbox ----------
  {
    const p = fake('045e-0b13-Xbox Wireless Controller', '', 16, [0, 0, 0, -1, -1, 0, 0, 0, 0, HAT_REST]);
    const r = new PadReader(p);
    let t = 0;
    const rd = () => r.read(p, (t += 16));
    ok(r.layout === 'xBt', `xbox series bt → xBt (${r.layout})`);
    rd();
    const face: [number, number][] = [[0, PB.SOUTH], [1, PB.EAST], [3, PB.WEST], [4, PB.NORTH], [6, PB.L1], [7, PB.R1], [10, PB.SELECT], [11, PB.START], [13, PB.L3], [14, PB.R3], [15, PB.EXTRA]];
    for (const [raw, std] of face) {
      press(p, raw); const f = rd();
      ok(f.p[std] && f.p.filter(Boolean).length === 1, `xBt raw ${raw} → std ${std}`);
      release(p, raw); rd();
    }
    p.axes[4] = 1; ok(rd().p[PB.R2], 'xBt RT on axis 4');
    p.axes[4] = -1; p.axes[9] = HAT.left; ok(rd().p[PB.LEFT], 'xBt hat left');
  }
  {
    const p = fake('045e-028e-Xbox 360 Wired Controller', '', 15, [0, 0, -1, 0, 0, -1]);
    const r = new PadReader(p);
    ok(r.layout === 'x360', `xbox 360 mac → x360 (${r.layout})`);
    r.read(p, 0);
    press(p, 13); ok(r.read(p, 16).p[PB.LEFT], 'x360 d-pad left is button 13');
    release(p, 13);
    press(p, 9); ok(r.read(p, 32).p[PB.SELECT], 'x360 back is button 9');
    release(p, 9);
    p.axes[5] = 1; ok(r.read(p, 48).p[PB.R2], 'x360 RT on axis 5');
  }

  // ---------- Linux (evdev order) ----------
  {
    const p = fake('054c-0ce6-Sony Interactive Entertainment DualSense Wireless Controller', '', 13, [0, 0, -1, 0, 0, -1, 0, 0]);
    const r = new PadReader(p, true);
    let t = 0;
    const rd = () => r.read(p, (t += 16));
    ok(r.layout === 'sonyLinux', `linux dualsense → sonyLinux (${r.layout})`);
    rd();
    press(p, 3); ok(rd().p[PB.WEST], 'linux raw 3 → □'); release(p, 3); rd();
    press(p, 2); ok(rd().p[PB.NORTH], 'linux raw 2 → △'); release(p, 2); rd();
    press(p, 11); ok(rd().p[PB.L3], 'linux raw 11 → L3'); release(p, 11); rd();
    p.axes[6] = -1; p.axes[7] = 1; const f = rd();
    ok(f.p[PB.LEFT] && f.p[PB.DOWN] && !f.p[PB.UP], 'linux hat axes 6/7');
    p.axes[6] = 0; p.axes[7] = 0;
    p.axes[2] = 1; ok(rd().p[PB.L2], 'linux L2 axis 2');
    p.axes[2] = -1; p.axes[3] = 0.9; ok(rd().rx > 0.6, 'linux right stick axis 3');
    ok(!r.has(p, 17), 'linux: no touchpad button');
  }

  // ---------- unknown pads ----------
  {
    const p = fake('USB Gamepad (Vendor: 0079 Product: 0011)', '', 12, [0, 0, 0, 0, 0, 0, 0, 0, 0, HAT_REST]);
    const r = new PadReader(p);
    ok(r.layout === 'hid', `unknown HID → hid (${r.layout})`);
    r.read(p, 0);
    press(p, 1); ok(r.read(p, 16).p[PB.SOUTH], 'hid raw 1 → south'); release(p, 1);
    p.axes[9] = HAT.down; ok(r.read(p, 32).p[PB.DOWN], 'hid hat down');
  }
  {
    // weird pad: hat on axis 3 (would be the right stick Y); found at runtime and kept out of the stick
    const p = fake('1234-5678-Weird Pad', '', 12, [0, 0, 0, HAT_REST, 0, 0]);
    const r = new PadReader(p);
    ok(r.layout === 'generic', `weird pad → generic (${r.layout})`);
    r.read(p, 0);
    p.axes[3] = HAT.up;
    const f = r.read(p, 16);
    ok(f.p[PB.UP] && f.ry === 0, `runtime hat on axis 3 → up, right stick untouched (ry=${f.ry})`);
  }

  // ---------- Input: one active pad, phantoms, hot-plug ----------
  {
    const inp = new Input();
    let now = 1000;
    inp.now = () => now;
    const list: (FakePad | null)[] = [];
    inp.padSource = () => list;
    const events: string[] = [];
    inp.onPad((e) => events.push(e.type + ':' + e.name));
    const tick = (ms = 16) => { now += ms; inp.beginTick(); };
    const after = () => inp.endTick();

    // phantom device: stuck axes and a stuck button, never changes
    const phantom = fake('Virtual Joystick (Vendor: 1234 Product: bead)', 'standard', 17, [-1, 1, 0.5, -0.7], 0);
    press(phantom, 3);
    list.push(phantom);
    tick();
    ok(events.join() === 'connect:Virtual Joystick', `phantom connect event (${events})`);
    ok(!inp.down('shoot') && inp.stickLX === 0 && inp.stickRY === 0, 'phantom: stuck button/axes ignored');
    ok(inp.move3().x === 0 && inp.move3().y === 0, 'phantom: no movement');
    after();

    // real pad appears after a button press (browser privacy): picked up and becomes the active pad
    const ds = fake('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', 'standard', 18, [0, 0, 0, 0], 1);
    press(ds, 0);
    list.push(ds);
    tick();
    ok(events.includes('connect:DualSense'), 'DualSense connect event');
    ok(inp.padName === 'DualSense' && inp.padKind === 'ps5', `active pad = DualSense (${inp.padName})`);
    ok(!inp.pressed('jump'), 'reveal press does not fire jump');
    ok(inp.lastDevice === 'kb', 'reveal press alone does not flip prompts yet');
    after();
    release(ds, 0); tick();
    ok(inp.lastDevice === 'pad' && !inp.pressed('jump'), 'letting go of the reveal press flips prompts to the pad');
    after();
    press(ds, 0); tick();
    ok(inp.pressed('jump') && inp.pressed('confirm') && inp.lastDevice === 'pad', 'second ✕ press → jump+confirm');
    after();
    release(ds, 0); tick(); after();

    // new pad layout
    const checks: [number, string[]][] = [
      [1, ['dash', 'back']], [2, ['attack']], [3, ['shoot']], [4, ['heal']], [5, ['interact']], [6, ['shoot']], [7, ['dash']],
      [8, ['score']], [9, ['pause']], [10, ['ping']], [12, ['up']], [13, ['down']], [14, ['left']], [15, ['right']], [17, ['talk']],
    ];
    const QPS: Action[] = ['qp1', 'qp2', 'qp3', 'qp4'];
    for (const [b, acts] of checks) {
      press(ds, b); tick();
      ok(acts.every((a) => inp.pressed(a as Action) && inp.down(a as Action)) && !QPS.some((q) => inp.pressed(q)), `pad ${b} → ${acts}`);
      after(); release(ds, b); tick(); after();
    }
    // solo (default): the d-pad moves the hero in 3D like before, no quick phrases
    press(ds, 15); tick();
    ok(inp.move3().x === 1 && !inp.pressed('qp2'), 'solo: d-pad right strafes, no phrase');
    after(); release(ds, 15); tick(); after();
    press(ds, 12); tick();
    ok(inp.move3().y === 1, 'solo: d-pad up walks forward');
    after(); release(ds, 12); tick(); after();
    // co-op: d-pad = quick phrases (and still menu directions), no hero movement
    inp.coop = true;
    const qpCases: [number, Action, Action][] = [[12, 'qp1', 'up'], [15, 'qp2', 'right'], [13, 'qp3', 'down'], [14, 'qp4', 'left']];
    for (const [b, q, dir] of qpCases) {
      press(ds, b); tick();
      ok(inp.pressed(q) && inp.pressed(dir) && inp.move3().x === 0 && inp.move3().y === 0, `co-op: d-pad ${b} → ${q} + ${dir}, no move`);
      after(); release(ds, b); tick(); after();
    }
    // ...but not while a menu has the d-pad (lobby, shop, pause): only navigation
    let qpLeak = false, navOk = true;
    for (const [b, q, dir] of qpCases) {
      inp.menuTick(); after(); // menu was up last tick
      press(ds, b); tick(); inp.menuTick();
      qpLeak ||= inp.pressed(q); navOk &&= inp.pressed(dir);
      after(); release(ds, b); tick(); inp.menuTick(); after();
    }
    ok(!qpLeak && navOk, 'co-op: d-pad in a menu navigates without phrases');
    // held from the menu into play: no phrase on menu close, the next fresh press sends one
    inp.menuTick(); after();
    press(ds, 13); tick(); inp.menuTick(); after();
    let heldLeak = false;
    for (let i = 0; i < 3; i++) { tick(); heldLeak ||= inp.pressed('qp3') || inp.down('qp3'); after(); } // menu closed, still held
    release(ds, 13); tick(); after();
    press(ds, 13); tick();
    ok(!heldLeak && inp.pressed('qp3'), 'co-op: d-pad held through menu close sends nothing until pressed again');
    after(); release(ds, 13); tick(); after();
    inp.coop = false;

    // R3: tap = swap, hold = emote
    press(ds, 11); tick(); after(); tick(); after(); release(ds, 11); tick();
    ok(inp.pressed('swap') && !inp.pressed('emote'), 'R3 tap → swap');
    after();
    press(ds, 11);
    let emoted = false, swapped = false;
    for (let i = 0; i < 30; i++) { tick(); emoted ||= inp.pressed('emote'); swapped ||= inp.pressed('swap'); after(); }
    release(ds, 11); tick(); swapped ||= inp.pressed('swap'); after();
    ok(emoted && !swapped, 'R3 hold → emote, no swap');

    // sticks
    ds.axes[0] = 0.8; ds.axes[1] = -0.8; tick();
    const m = inp.move3();
    ok(m.x > 0.6 && m.y > 0.6 && inp.down('right') && inp.down('fwd'), `left stick → move3 (${m.x.toFixed(2)}, ${m.y.toFixed(2)})`);
    after();
    ds.axes[0] = 0.1; ds.axes[1] = 0.05; tick();
    ok(inp.stickLX === 0 && inp.stickLY === 0 && !inp.down('right'), 'small tilt inside deadzone');
    after();
    ds.axes[0] = 0; ds.axes[1] = 0;

    // a duplicate device (e.g. DS4Windows' virtual Xbox pad) mirroring the same input does not steal focus
    const dup = fake('Xbox 360 Controller (XInput STANDARD GAMEPAD)', 'standard', 17, [0, 0, 0, 0], 2);
    list.push(dup);
    tick(); after();
    for (let i = 0; i < 10; i++) {
      press(ds, 2); press(dup, 2); tick(); after();
      release(ds, 2); release(dup, 2); tick(); after();
    }
    ok(inp.padName === 'DualSense', `duplicate pad does not steal focus (${inp.padName})`);
    // ...but a second pad takes over once the first is idle
    now += 500;
    press(dup, 0); tick(); after(); release(dup, 0); tick();
    ok(inp.padName === 'Xbox' && inp.padKind === 'xbox', `idle pad hands over (${inp.padName})`);
    after();

    // unplug
    list.splice(list.indexOf(dup), 1);
    tick(); after();
    ok(events.includes('disconnect:Xbox') && inp.padName === 'DualSense', `unplug → disconnect + fallback (${inp.padName})`);
    list.length = 0;
    tick(); after();
    ok(inp.padName === '' && inp.padKind === null && !inp.padConnected, 'all unplugged');

    // replug with the button held, then use it
    const ds4 = fake('054c-09cc-Wireless Controller', '', 14, [0, 0, 0, 0, 0, 0, 0, 0, 0, HAT_REST], 0);
    press(ds4, 1);
    list.push(ds4);
    tick(); after();
    ok(inp.padName === 'DualShock 4' && events[events.length - 1] === 'connect:DualShock 4', 'hot-plug raw DS4');
    release(ds4, 1); tick(); after();
    ds4.axes[9] = HAT.up; tick();
    ok(inp.pressed('up') && !inp.pressed('qp1') && inp.move3().y === 1, 'raw DS4 hat up → up (solo: walks, no phrase)');
    after();
  }

  const DS_ID = 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';
  const rig = () => {
    const inp = new Input();
    const st = { now: 1000 };
    inp.now = () => st.now;
    const list: (FakePad | null)[] = [];
    inp.padSource = () => list;
    const tick = (ms = 16) => { st.now += ms; inp.beginTick(); };
    const after = () => inp.endTick();
    const step = (n = 1) => { for (let i = 0; i < n; i++) { tick(); after(); } };
    return { inp, list, tick, after, step };
  };

  // ---------- Input: a device revealed with a stuck button can't grab the focus ----------
  {
    const { inp, list, tick, after, step } = rig();
    const ds = fake(DS_ID, 'standard', 18, [0, 0, 0, 0], 0);
    list.push(ds);
    step();
    press(ds, 0); step(); release(ds, 0); step();
    press(ds, 6, 1); step(60); // aiming with L2, nothing else, for a second
    const stuck = fake('Virtual Device (Vendor: 1234 Product: 5678)', 'standard', 17, [0, 0, 0, 0], 1);
    press(stuck, 4);
    list.push(stuck);
    tick();
    ok(inp.padName === 'DualSense' && inp.down('shoot'), `late stuck device does not take over a pad in use (${inp.padName}, aim ${inp.down('shoot')})`);
    after();
    step(40);
    press(ds, 0); tick();
    ok(inp.padName === 'DualSense' && inp.pressed('jump') && inp.down('shoot'), 'next ✕ on the DualSense still works, aim kept');
    after(); release(ds, 0); release(ds, 6); step();
  }
  {
    // revealed in the same poll: a stuck generic device at index 0 and the DualSense → the known pad wins the tie
    const { inp, list, tick, after, step } = rig();
    const stuck = fake('Virtual Device (Vendor: 1234 Product: 5678)', 'standard', 17, [0, 0, 0, 0], 0);
    const ds = fake(DS_ID, 'standard', 18, [0, 0, 0, 0], 1);
    press(stuck, 4); press(ds, 0);
    list.push(stuck, ds);
    step();
    ok(inp.padName === 'DualSense', `revealed together: known pad wins the tie (${inp.padName})`);
    release(ds, 0); step();
    press(ds, 2); tick();
    ok(inp.pressed('attack'), 'revealed together: first □ works');
    after();
  }
  {
    // same, but the stuck device looks like a real pad and wins the tie: the first real press takes over at once
    const { inp, list, tick, after, step } = rig();
    const stuck = fake('Xbox 360 Controller (XInput STANDARD GAMEPAD)', 'standard', 17, [0, 0, 0, 0], 0);
    const ds = fake(DS_ID, 'standard', 18, [0, 0, 0, 0], 1);
    press(stuck, 4); press(ds, 0);
    list.push(stuck, ds);
    step();
    ok(inp.padName === 'Xbox', `tie between known pads: first one (${inp.padName})`);
    release(ds, 0); tick(); after();
    press(ds, 2); tick();
    ok(inp.padName === 'DualSense' && inp.pressed('attack'), `stuck device never in use: first □ on the DualSense 32 ms later takes over and works (${inp.padName})`);
    after();
    ok(inp.lastDevice === 'pad', 'prompts on the pad');
  }

  // ---------- Input: slow walk / slow aim are not eaten by drift learning (review measurements) ----------
  {
    const { inp, list, tick, after, step } = rig();
    const ds = fake(DS_ID, 'standard', 18, [0, 0, 0, 0], 0);
    list.push(ds);
    step(); press(ds, 0); step(); release(ds, 0); step();
    let minL = 1;
    for (let i = 0; i < 180; i++) { ds.axes[0] = 0.28; tick(); if (i > 5) minL = Math.min(minL, inp.stickLX); after(); }
    ds.axes[0] = 0;
    let backL = 0;
    for (let i = 0; i < 60; i++) { tick(); backL = Math.max(backL, Math.abs(inp.stickLX), Math.abs(inp.move3().x)); after(); }
    ok(minL > 0.13 && backL === 0, `left stick 0.28 held 3 s keeps walking (min ${minL.toFixed(3)}), no walking back after release (${backL.toFixed(3)})`);
    // aim with L2, pan slowly right at 0.27 with 1-step noise
    press(ds, 6, 1);
    for (let i = 0; i < 10; i++) { ds.axes[2] = 0.9; tick(); after(); }
    let minR = 1;
    for (let i = 0; i < 180; i++) { ds.axes[2] = 0.27 + (i % 3 === 0 ? 1 / 127.5 : 0); tick(); if (i > 5) minR = Math.min(minR, inp.stickRX); after(); }
    release(ds, 6); ds.axes[2] = 0;
    let backR = 0;
    for (let i = 0; i < 60; i++) { tick(); backR = Math.max(backR, Math.abs(inp.stickRX)); after(); }
    ok(minR > 0.12 && backR === 0, `slow aim pan 0.27 with L2 keeps panning (min ${minR.toFixed(3)}), camera doesn't turn back (${backR.toFixed(3)})`);
  }

  // ---------- Input: typing (suspended) mutes the pad ----------
  {
    const { inp, list, tick, after, step } = rig();
    const ds = fake(DS_ID, 'standard', 18, [0, 0, 0, 0], 0);
    list.push(ds);
    step(); press(ds, 0); step(); release(ds, 0); step();
    ds.axes[0] = 0.9; press(ds, 2); tick();
    ok(inp.stickLX > 0.5 && inp.pressed('attack'), 'before typing: stick + □ work');
    after();
    inp.suspended = true; // the name box opens
    ok(!inp.down('attack') && !inp.down('right'), 'suspend drops pad actions at once');
    tick();
    ok(inp.stickLX === 0 && inp.move3().x === 0 && !inp.down('attack') && !inp.down('right'), 'suspended: held stick / buttons drive nothing');
    after(); release(ds, 2); step();
    press(ds, 0); tick();
    ok(!inp.pressed('jump') && !inp.pressed('confirm') && !inp.down('jump') && !inp.anyKey && inp.padHeld('confirm'), 'suspended: ✕ does nothing in game, padHeld(confirm) sees it');
    after();
    inp.suspended = false; // the box submits on ✕ (its rAF runs before the next tick); ✕ still held
    tick();
    ok(!inp.pressed('jump') && !inp.pressed('confirm') && !inp.down('jump'), '✕ that closed the box does not jump');
    ok(inp.stickLX > 0.5 && inp.down('right') && !inp.pressed('right'), 'stick still pushed: steers again, but no fresh menu step');
    after(); release(ds, 0); step();
    press(ds, 0); tick(); ok(inp.pressed('jump'), '✕ works again after a release'); after(); release(ds, 0); step();
    // the review's order: the box sees ○ first and closes before the game ever polls it
    ds.axes[0] = 0;
    inp.suspended = true; step();
    press(ds, 1);
    inp.suspended = false;
    tick();
    ok(!inp.pressed('back') && !inp.pressed('dash') && !inp.down('dash'), '○ that cancelled the box does not back out / dash');
    after(); release(ds, 1); step();
    press(ds, 1); tick(); ok(inp.pressed('back') && inp.pressed('dash'), '○ works again after a release'); after(); release(ds, 1); step();
    // R3 held through a text box: no swap when it is let go afterwards
    press(ds, 11); step(2);
    inp.suspended = true; step(2); inp.suspended = false; step(2);
    release(ds, 11); tick();
    ok(!inp.pressed('swap'), 'R3 held through typing: no swap on release');
    after();
  }

  // ---------- keyboard: new keys, suspended, text fields ----------
  if (typeof document !== 'undefined') {
    const inp = new Input();
    inp.padSource = () => [];
    inp.setMode('3d');
    // a detached tree: key events never reach window, so the live game's own input doesn't see them
    const root = document.createElement('div');
    const el = document.createElement('div');
    root.appendChild(el);
    inp.attach(el, (x, y) => [x, y], root);
    const key = (code: string, type: 'keydown' | 'keyup' = 'keydown', target: EventTarget = root) => {
      const e = new KeyboardEvent(type, { code, bubbles: true, cancelable: true });
      target.dispatchEvent(e);
      return e;
    };
    const kb: [string, string][] = [['KeyR', 'interact'], ['KeyG', 'ping'], ['Tab', 'score'], ['KeyV', 'talk'], ['KeyT', 'chat'],
      ['Digit1', 'qp1'], ['Digit4', 'qp4'], ['KeyB', 'emote'], ['BracketRight', 'camR'], ['BracketLeft', 'camL'], ['KeyZ', 'camL']];
    for (const [code, act] of kb) {
      key(code); inp.beginTick();
      ok(inp.pressed(act as Action) && inp.down(act as Action), `key ${code} → ${act}`);
      inp.endTick(); key(code, 'keyup');
    }
    key('KeyV'); inp.beginTick(); ok(!inp.down('camR'), 'V is no longer camR'); inp.endTick(); key('KeyV', 'keyup');
    key('Enter'); inp.beginTick(); ok(!inp.pressed('chat') && inp.pressed('confirm'), 'Enter is confirm, not chat'); inp.endTick(); key('Enter', 'keyup');
    ok(key('Tab').defaultPrevented, 'Tab default prevented in game'); key('Tab', 'keyup');
    key('KeyW'); inp.beginTick(); ok(inp.down('fwd'), 'W held'); inp.endTick();
    inp.suspended = true;
    inp.beginTick(); ok(!inp.down('fwd'), 'suspend drops held keys'); inp.endTick();
    const sp = key('Space'); key('KeyJ'); inp.beginTick();
    ok(!sp.defaultPrevented && !inp.pressed('jump') && !inp.pressed('attack') && !inp.down('attack'), 'suspended: keys ignored, Space not swallowed');
    inp.endTick();
    inp.suspended = false;
    key('KeyW', 'keyup'); key('Space', 'keyup'); key('KeyJ', 'keyup');
    const box = document.createElement('input');
    root.appendChild(box);
    const e2 = key('KeyJ', 'keydown', box); inp.beginTick();
    ok(!inp.pressed('attack') && !e2.defaultPrevented, 'typing in an <input> is ignored');
    inp.endTick(); key('KeyJ', 'keyup', box);
    inp.detach();
    key('KeyJ'); inp.beginTick();
    ok(!inp.pressed('attack'), 'detach() removes the listeners');
    inp.endTick();
  }

  // ---------- rumble ----------
  {
    const inp = new Input();
    let now = 0;
    inp.now = () => now;
    const calls: string[] = [];
    const p = fake('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', 'standard', 18, [0, 0, 0, 0]);
    p.vibrationActuator = { effects: ['dual-rumble', 'trigger-rumble'], playEffect: (type, o) => { calls.push(type + ':' + o.strongMagnitude + ':' + o.duration); return Promise.resolve('complete'); } };
    inp.padSource = () => [p];
    inp.beginTick(); inp.endTick();
    inp.rumble(0.5, 0.5, 200);
    ok(calls.length === 0, 'no rumble while on keyboard');
    press(p, 0); now += 16; inp.beginTick(); inp.endTick();
    ok(inp.canRumble && inp.lastDevice === 'pad', 'pad active + can rumble');
    const tick = (ms: number) => { now += ms; inp.beginTick(); inp.endTick(); };
    inp.rumble(0.3, 0.8, 300);
    inp.rumble(0.3, 0.8, 300);
    ok(calls.length === 1, `same effect twice within 60 ms: one command (${calls.length})`);
    tick(20); inp.rumble(0.1, 0.2, 100);
    ok(calls.length === 1, 'weaker effect does not cut a stronger one');
    tick(20); inp.rumble(0.3, 0.9, 200);
    ok(calls.length === 2 && calls[1] === 'dual-rumble:0.9:200', `stronger effect bypasses the 60 ms gate (${calls[1]})`);
    tick(400); calls.length = 0;
    // review case 1: hit then death in the same tick → the death rumble plays
    inp.rumble(0.2, 0.1, 80); inp.rumble(1, 1, 700);
    ok(calls.length === 2 && calls[1] === 'dual-rumble:1:700', `hit then death: death plays (${calls})`);
    for (let i = 0; i < 6; i++) tick(16);
    ok(calls.length === 2, 'the hit ending under the death rumble sends nothing');
    tick(800); calls.length = 0;
    // review case 2: a short strong bump on a long effect → bump, then the long one resumes for its remainder
    inp.rumble(0.5, 0.9, 1500);
    tick(100); inp.rumble(1, 1, 50);
    ok(calls[1] === 'dual-rumble:1:50', `short bump plays (${calls})`);
    for (let i = 0; i < 5; i++) tick(16);
    const last = calls[calls.length - 1].split(':');
    ok(calls.length === 3 && last[1] === '0.9' && +last[2] > 1300 && +last[2] <= 1350, `long effect resumes after the bump (${calls})`);
    tick(2000);
    const ff = fake('054c-0ce6-DualSense Wireless Controller', 'standard', 18, [0, 0, 0, 0]);
    inp.padSource = () => [ff];
    now += 1000; inp.beginTick(); inp.endTick();
    let threw = false;
    try { inp.rumble(1, 1, 100); } catch { threw = true; }
    ok(!threw && !inp.canRumble, 'Firefox (no actuator): rumble is a no-op');
  }

  // ---------- glyphs ----------
  ok(glyphLabel('jump', 'ps5') === '✕' && glyphLabel('attack', 'ps4') === '□' && glyphLabel('shoot', 'ps5') === '△', 'ps face glyphs');
  ok(glyphLabel('interact', 'ps5') === 'R1' && glyphLabel('heal', 'ps5') === 'L1' && glyphLabel('dash', 'ps5') === 'R2', 'ps shoulder glyphs');
  ok(glyphLabel('score', 'ps5') === 'Create' && glyphLabel('score', 'ps4') === 'Share' && glyphLabel('pause', 'ps5') === 'Options', 'ps menu glyphs');
  ok(glyphLabel('jump', 'xbox') === 'A' && glyphLabel('interact', 'xbox') === 'RB' && glyphLabel('score', 'xbox') === 'View', 'xbox glyphs');
  ok(glyphLabel('jump', 'switch') === 'B' && glyphLabel('swap', 'xbox') === 'RS' && glyphLabel('emote', 'ps5') === 'R3', 'switch / stick glyphs');
  ok(glyphLabel('ping', 'kb') === 'G' && glyphLabel('score', 'kb') === 'Tab' && glyphLabel('jump', 'kb') === 'Пробел', 'keyboard glyphs');
  ok(padButtonLabel('ps5', 17) === 'Тачпад', 'touchpad label');
  if (typeof document !== 'undefined') {
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    if (ctx) {
      let threw = false, zero = 0;
      const acts = ['jump', 'attack', 'shoot', 'dash', 'swap', 'heal', 'pause', 'confirm', 'back', 'interact', 'ping', 'score', 'talk', 'chat', 'qp1', 'qp2', 'qp3', 'qp4', 'emote', 'up', 'left'] as const;
      for (const dev of ['ps5', 'ps4', 'xbox', 'switch', 'kb'] as const) {
        for (const a of acts) {
          try { if (!drawGlyph(ctx, a, 40, 40, 28, 'center', dev) && !(dev !== 'kb' && a === 'chat')) zero++; } catch (err) { threw = true; console.error(err); }
        }
      }
      ok(!threw && zero === 0, `drawGlyph draws every action on every device (missing ${zero})`);
    }
  }

  log.unshift(`${pass} passed, ${fail} failed`);
  return { pass, fail, log };
}

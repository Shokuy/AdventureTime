import { TAU, mix } from '../engine/util';
import { OUT } from './draw';
import { drawPortrait as drawProloguePortrait, type Who } from './characters';

/**
 * Round dialog portraits of every speaker after the prologue (docs/script-fangs.md §0 «Говорящие»), in one place.
 *
 * `drawPortrait(ctx, id, cx, cy, r, t, talk, expr, variant)` — the same contract as the prologue's portraits
 * (art/characters.ts): a disc of radius r at (cx, cy), the speaker head-and-shoulders inside it, `t` drives blinks /
 * idle motion, `talk` (0..1) opens the mouth, `expr` is one of PortraitExpr (unknown → normal). Тоша, Бублик, Вторник
 * and the narrator ARE the prologue portraits (drawn by characters.ts), so the cast stays one family.
 *
 * Drawing happens in a 100×100 box (the disc has radius 50) scaled to r: line weights LW / LF / LD below are the game's
 * cartoon weights (draw.ts OUT colour). Every filled shape gets the same toon treatment — base, a shadow crescent on the
 * lower-right, a rim light on the upper-left, one clean outline (union shapes are outlined once, no inner seams).
 * Eyes: white, iris with gradient, pupil, two highlights, upper/lower lids in the skin colour. Mouths are ONE closed shape:
 * the interior, tongue, teeth and fangs are clipped inside it.
 */

type C = CanvasRenderingContext2D;

export type PortraitId =
  | 'tosha' | 'bublik' | 'bear' | 'narrator'
  | 'pastila' | 'noki' | 'pryanik' | 'zefirych' | 'beze' | 'ponchik' | 'marmeladka' | 'iriska'
  | 'kamysh' | 'svetlyachikha' | 'netopyr' | 'morok' | 'shepot' | 'nochka' | 'tenka' | 'polnoch' | 'kisloplyu'
  | 'karamel' | 'voron' | 'shurshik'
  | 'zhitel' | 'presnyak';
export type PortraitExpr = 'normal' | 'happy' | 'sad' | 'angry' | 'scared' | 'surprised' | 'sly' | 'sleepy' | 'hurt';
/** 'seen': Шёпот revealed (the default Шёпот is invisible — eyes in the dark); 'mouse': a lieutenant shrunk into a
 *  little bat-mouse (the finale, §9.2.3) */
export type PortraitVariant = 'seen' | 'mouse';

export interface PortraitInfo { name: string; color: string; bg: string }
export const PORTRAIT_INFO: Record<PortraitId, PortraitInfo> = {
  tosha: { name: 'Тоша', color: '#ff8a2a', bg: '#ffe7c4' },
  bublik: { name: 'Бублик', color: '#b0612e', bg: '#ffe0b8' },
  bear: { name: 'Медведь Вторник', color: '#b0453a', bg: '#e6d2b0' },
  narrator: { name: '', color: '#f0c040', bg: '#2a1b1a' },
  pastila: { name: 'Пастила', color: '#e8508a', bg: '#ffe0ec' },
  noki: { name: 'Ноки', color: '#8a2a5a', bg: '#e6dcf2' },
  pryanik: { name: 'Пряник', color: '#a8642a', bg: '#f6e2c4' },
  zefirych: { name: 'Дед Зефирыч', color: '#8a8ab8', bg: '#ecebff' },
  beze: { name: 'Мадам Безе', color: '#e87aa0', bg: '#ffeef4' },
  ponchik: { name: 'Пончик', color: '#d0703a', bg: '#ffe8d0' },
  marmeladka: { name: 'Мармеладка', color: '#3aa84a', bg: '#e0f8dc' },
  iriska: { name: 'Ириска', color: '#c87a2a', bg: '#fff0d8' },
  kamysh: { name: 'Камыш', color: '#3f7a3a', bg: '#dcefcf' },
  svetlyachikha: { name: 'Матушка Светлячиха', color: '#c89a10', bg: '#fff3c0' },
  netopyr: { name: 'Граф Нетопырь', color: '#6a1a3a', bg: '#ecdcea' },
  morok: { name: 'Мадам Морок', color: '#6a2a8a', bg: '#e8dcf0' },
  shepot: { name: 'Шёпот', color: '#6a6aa8', bg: '#16142a' },
  nochka: { name: 'Ночка', color: '#4a2a8a', bg: '#dcd6ee' },
  tenka: { name: 'Тенька', color: '#b04ab0', bg: '#f6e2f8' },
  polnoch: { name: 'Король Полночь', color: '#5a4a7a', bg: '#d6d0e4' },
  kisloplyu: { name: 'Граф Кислоплюй', color: '#b89a10', bg: '#f4f7c8' },
  // v2 (docs/script-fangs-v2.md §0): the diary of Пастила's great-great-grandmother, Мадам Морок's raven, Шёпот by name
  karamel: { name: 'Карамель (дневник)', color: '#c0702a', bg: '#fff1d6' },
  voron: { name: 'Кар-Карыч', color: '#3a3a5a', bg: '#dcdce8' },
  shurshik: { name: 'Шуршик', color: '#6a6aa8', bg: '#d6d2ee' },
  zhitel: { name: 'Житель', color: '#c85a8a', bg: '#fff0f6' },
  presnyak: { name: 'Пресняк', color: '#7a7a86', bg: '#e4e4e8' },
};
export const PORTRAIT_IDS = Object.keys(PORTRAIT_INFO) as PortraitId[];
export const PORTRAIT_EXPRS: PortraitExpr[] = ['normal', 'happy', 'sad', 'angry', 'scared', 'surprised', 'sly', 'sleepy', 'hurt'];

const PROLOGUE: Partial<Record<PortraitId, Who>> = { tosha: 'hero', bublik: 'dog', bear: 'bear', narrator: 'narrator' };

/** line weights in the 100-unit portrait box (at in-game r=62: ≈5 / 3.7 / 2.5 px) */
const LW = 4, LF = 3, LD = 2;
const INK = OUT;

// ───────────────────────── entry ─────────────────────────

export function drawPortrait(ctx: C, id: PortraitId | string, cx: number, cy: number, r: number, t: number, talk: number, expr?: string, variant?: PortraitVariant) {
  const pid = (id in PORTRAIT_INFO ? id : 'zhitel') as PortraitId;
  const who = PROLOGUE[pid];
  if (who) { drawProloguePortrait(ctx, who, cx, cy, r, t, talk, prologueExpr(who, expr)); return; }
  const info = PORTRAIT_INFO[pid];
  const mouse = variant === 'mouse' && MOUSE_KIND[pid] !== undefined;
  const seen = variant === 'seen';
  const bg = mouse ? '#e8e0f2' : pid === 'shepot' && seen ? '#d6d2ee' : info.bg;
  // (Шуршик = Шёпот revealed: one portrait, the name comes from the speaker map, f3:named)
  const k = r / 50;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(k, k);
  ctx.beginPath(); ctx.arc(0, 0, 50, 0, TAU);
  const dark = luminance(bg) < 0.3;
  const g = ctx.createRadialGradient(-12, -16, 4, 0, 0, 52);
  g.addColorStop(0, mix(bg, '#ffffff', dark ? 0.12 : 0.55));
  g.addColorStop(0.65, bg);
  g.addColorStop(1, mix(bg, info.color, dark ? 0.25 : 0.32));
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); ctx.clip();
  // the prologue's slowly turning rays
  ctx.fillStyle = dark ? 'rgba(160,170,255,0.08)' : 'rgba(255,255,255,0.35)';
  for (let i = 0; i < 8; i++) { const a = t * 0.3 + (i / 8) * TAU; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 50, a, a + 0.25); ctx.closePath(); ctx.fill(); }
  const st = state(expr, t, talk, pid);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (mouse) drawMouse(ctx, MOUSE_KIND[pid]!, st);
  else if (pid === 'shepot') (seen ? shepotSeen : shepotHidden)(ctx, st);
  else PAINT[pid](ctx, st);
  // a soft inner vignette so every portrait sits in its disc the same way
  const v = ctx.createRadialGradient(0, 0, 38, 0, 0, 50);
  v.addColorStop(0, 'rgba(40,20,40,0)'); v.addColorStop(1, 'rgba(40,20,40,0.16)');
  ctx.fillStyle = v; ctx.fillRect(-50, -50, 100, 100);
  ctx.restore();
  ctx.restore();
  // the frame: identical to the prologue's (pixel weights, not scaled)
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU);
  ctx.lineWidth = 5; ctx.strokeStyle = OUT; ctx.stroke();
  ctx.lineWidth = 2.5; ctx.strokeStyle = info.color; ctx.beginPath(); ctx.arc(cx, cy, r - 4, 0, TAU); ctx.stroke();
  ctx.restore();
}

function prologueExpr(who: Who, expr?: string): string | undefined {
  if (!expr) return undefined;
  if (who === 'hero') return ({ sad: 'scared', sly: 'happy' } as Record<string, string>)[expr] ?? expr;
  if (who === 'dog') return expr === 'happy' || expr === 'angry' ? expr : expr === 'sly' ? 'happy' : 'normal';
  return expr;
}

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

// ───────────────────────── expression state ─────────────────────────

type MouthKind = 'smile' | 'grin' | 'frown' | 'flat' | 'o' | 'smirk' | 'grit' | 'wavy';
interface St {
  t: number; talk: number; expr: PortraitExpr; blink: boolean;
  eye: 'open' | 'arc' | 'squeeze';
  lid: number; slant: number; low: number; scale: number; pupil: number; lookX: number; lookY: number;
  browRaise: number; browAng: number; slyBrow: boolean;
  mouth: MouthKind; open: number;
}
const SEED: Partial<Record<PortraitId, number>> = {};
function state(expr: string | undefined, t: number, talk: number, id: PortraitId): St {
  const e = (PORTRAIT_EXPRS as string[]).includes(expr ?? '') ? (expr as PortraitExpr) : 'normal';
  const seed = SEED[id] ?? (SEED[id] = (PORTRAIT_IDS.indexOf(id) * 0.73) % 3);
  const blink = ((t + seed) % 3.9) < 0.13;
  const s: St = {
    t, talk, expr: e, blink, eye: 'open', lid: 0.1, slant: 0, low: 0, scale: 1, pupil: 1, lookX: 0, lookY: 0,
    browRaise: 0, browAng: 0, slyBrow: false, mouth: 'smile', open: 0,
  };
  switch (e) {
    case 'happy': s.eye = 'arc'; s.browRaise = 1.5; s.mouth = 'grin'; s.open = 0.5; break;
    case 'sad': s.lid = 0.3; s.slant = -0.7; s.lookY = 0.6; s.browAng = -2.6; s.browRaise = 0.5; s.mouth = 'frown'; break;
    case 'angry': s.lid = 0.34; s.slant = 0.9; s.browAng = 3.2; s.browRaise = -1.5; s.mouth = 'grit'; s.open = 0.42; break;
    case 'scared': s.lid = 0; s.scale = 1.08; s.pupil = 0.62; s.browAng = -2.8; s.browRaise = 2; s.mouth = 'wavy'; s.open = 0.35; break;
    case 'surprised': s.lid = 0; s.scale = 1.12; s.pupil = 0.7; s.browRaise = 3.5; s.mouth = 'o'; s.open = 0.55; break;
    case 'sly': s.lid = 0.42; s.slant = 0.25; s.low = 0.16; s.lookX = 0.75; s.slyBrow = true; s.mouth = 'smirk'; break;
    case 'sleepy': s.lid = 0.62; s.slant = -0.15; s.lookY = 0.4; s.browRaise = -1; s.mouth = 'flat'; break;
    case 'hurt': s.eye = 'squeeze'; s.browAng = -2.8; s.browRaise = 0.5; s.mouth = 'grit'; s.open = 0.5; break;
    default: break;
  }
  if (talk > 0.02) s.open = Math.max(s.open, s.mouth === 'grit' ? s.open : 0) + talk * (s.mouth === 'o' ? 0.35 : 0.62) * (1 - s.open * 0.4);
  return s;
}

// ───────────────────────── drawing kit ─────────────────────────

type Path = (c: C) => void;
interface Toon { lw?: number; sh?: string | null; off?: number; rim?: string | null; rimW?: number; edge?: Path }

/** base + shadow crescent (lower right) + rim light (upper left) + one outline around the (union) path */
function toon(c: C, path: Path, base: string, o: Toon = {}) {
  const lw = o.lw ?? LW;
  if (lw > 0 && !o.edge) { c.beginPath(); path(c); c.lineWidth = lw * 2; c.strokeStyle = INK; c.lineJoin = 'round'; c.lineCap = 'round'; c.stroke(); }
  c.beginPath(); path(c);
  c.fillStyle = base; c.fill();
  c.save(); c.clip();
  const off = o.off ?? 4.5;
  const dx = off * 0.75, dy = off;
  // rim light: a crescent along the upper-left edge (filled, so union shapes get no inner seams)
  const rw = o.rim === null ? 0 : Math.min(2.4, (o.rimW ?? 2.6) * 0.75, off * 0.45);
  if (rw > 0) {
    c.globalAlpha = 0.85; c.fillStyle = o.rim ?? mix(base, '#ffffff', 0.5); c.fillRect(-300, -300, 600, 600); c.globalAlpha = 1;
    c.translate(rw * 0.75, rw); c.beginPath(); path(c); c.translate(-rw * 0.75, -rw); c.clip();
    c.fillStyle = base; c.fillRect(-300, -300, 600, 600);
  }
  // shadow: a crescent along the lower-right edge
  if (o.sh !== null) {
    c.fillStyle = o.sh ?? mix(base, '#3a1f48', 0.26); c.fillRect(-300, -300, 600, 600);
    c.translate(-dx, -dy); c.beginPath(); path(c); c.fillStyle = base; c.fill(); c.translate(dx, dy);
  }
  c.restore();
  // a shape laid over a same-coloured mass (bangs over hair): outline only its free edge, no seam through the mass
  if (o.edge && lw > 0) stroke(c, o.edge, INK, lw);
}

/** a plain filled shape with an outline (no shading) */
function flat(c: C, path: Path, fill: string | CanvasGradient, lw = LF) {
  c.beginPath(); path(c);
  if (lw > 0) { c.lineWidth = lw * 2; c.strokeStyle = INK; c.lineJoin = 'round'; c.stroke(); }
  c.beginPath(); path(c);
  c.fillStyle = fill; c.fill();
}

const E = (x: number, y: number, rx: number, ry: number, rot = 0): Path => (c) => {
  c.moveTo(x + Math.cos(rot) * rx, y + Math.sin(rot) * rx); c.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, TAU);
};
const O = (x: number, y: number, r: number): Path => E(x, y, r, r);
/** several shapes as one union path */
const U = (...ps: Path[]): Path => (c) => { for (const p of ps) p(c); };
const poly = (pts: number[]): Path => (c) => { c.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); c.closePath(); };

function stroke(c: C, path: Path, color = INK, w = LF) {
  c.beginPath(); path(c); c.lineWidth = w; c.strokeStyle = color; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke();
}
function inside(c: C, path: Path, draw: () => void) { c.save(); c.beginPath(); path(c); c.clip(); draw(); c.restore(); }
function dot(c: C, x: number, y: number, r: number, fill: string) { c.beginPath(); c.arc(x, y, r, 0, TAU); c.fillStyle = fill; c.fill(); }
function shine(c: C, x: number, y: number, rx: number, ry: number, a = 0.55, rot = -0.5) {
  c.save(); c.globalAlpha = a; c.fillStyle = '#ffffff'; c.beginPath(); E(x, y, rx, ry, rot)(c); c.fill(); c.restore();
}
function glowAt(c: C, x: number, y: number, r: number, col: string, a = 0.6) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.save(); c.globalAlpha = a; c.globalCompositeOperation = 'lighter'; c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); c.restore();
}

// ── face parts ──

interface FaceCfg {
  ex: number; ey: number; erx: number; ery: number; iris: string; skin: string;
  x?: number; sclera?: string; irisK?: number; slit?: boolean; lash?: boolean; liner?: boolean; glowEyes?: boolean;
  brow?: string | null; browW?: number; browLw?: number; browY?: number; browInk?: boolean;
  my: number; mw: number; fangs?: number; lips?: string; teeth?: boolean; inner?: string;
  blush?: string | null; blushX?: number; blushY?: number; blushR?: number;
  lid?: number; lookX?: number; normalMouth?: MouthKind;
  nose?: 'dot' | 'line' | 'button' | null; noseY?: number; noseCol?: string;
}

function features(c: C, f: FaceCfg, s: St) {
  const x0 = f.x ?? 0;
  // blush (under everything else)
  if (f.blush !== null) {
    const bc = f.blush ?? 'rgba(255,110,140,0.38)';
    for (const sd of [-1, 1]) { c.fillStyle = bc; c.beginPath(); E(x0 + sd * (f.blushX ?? f.ex + 6), f.blushY ?? f.ey + f.ery + 3, f.blushR ?? 4.6, (f.blushR ?? 4.6) * 0.6)(c); c.fill(); }
  }
  // eyes
  for (const sd of [-1, 1] as const) {
    eye(c, { x: x0 + sd * f.ex, y: f.ey, rx: f.erx, ry: f.ery, side: sd, cfg: f }, s);
  }
  // brows
  if (f.brow !== null) {
    for (const sd of [-1, 1] as const) {
      let ang = s.browAng, raise = s.browRaise;
      if (s.slyBrow) { if (sd === 1) { raise += 2.5; ang = -1.2; } else { ang = 1.6; raise -= 0.5; } }
      brow(c, x0 + sd * f.ex, f.ey - f.ery * s.scale - (f.browY ?? 3.5) - raise, f.browW ?? f.erx * 2, ang, sd, f.brow ?? INK, f.browLw ?? 2.6, f.browInk ?? false);
    }
  }
  // nose
  const ny = f.noseY ?? (f.ey + f.my) / 2 + 1;
  if (f.nose === 'dot') { c.fillStyle = f.noseCol ?? mix(f.skin, '#5a2030', 0.45); c.beginPath(); E(x0, ny, 1.8, 1.3)(c); c.fill(); }
  else if (f.nose === 'line') stroke(c, (cc) => { cc.moveTo(x0 + 0.5, ny - 3); cc.quadraticCurveTo(x0 + 2.4, ny + 0.5, x0 - 0.8, ny + 1); }, mix(f.skin, '#3a1a2a', 0.55), LD);
  else if (f.nose === 'button') { toon(c, E(x0, ny, 3.4, 2.6), f.noseCol ?? mix(f.skin, '#ff6080', 0.3), { lw: LD, off: 1.5, rimW: 1.2 }); }
  // mouth
  let kind = s.mouth;
  if (s.expr === 'normal' && f.normalMouth) kind = f.normalMouth;
  mouth(c, { x: x0, y: f.my, w: f.mw, fangs: f.fangs ?? 0, lips: f.lips, teeth: f.teeth ?? true, inner: f.inner }, kind, s.open);
}

interface EyeArgs { x: number; y: number; rx: number; ry: number; side: -1 | 1; cfg: FaceCfg }
function eye(c: C, a: EyeArgs, s: St) {
  const f = a.cfg;
  const { x, y, side } = a;
  const lidCol = mix(f.skin, '#4a2040', 0.12);
  let mode = s.eye;
  if (s.blink && mode === 'open') mode = 'squeeze';
  if (s.blink || (mode === 'open' && Math.max(s.lid, f.lid ?? 0) >= 0.9)) {
    // closed: a calm lid line curving down
    stroke(c, (cc) => { cc.moveTo(x - a.rx, y); cc.quadraticCurveTo(x, y + a.ry * 0.55, x + a.rx, y); }, INK, LF);
    if (f.lash || f.liner) stroke(c, (cc) => { cc.moveTo(x + side * a.rx * 0.95, y); cc.lineTo(x + side * (a.rx + 2.6), y - 1.6); }, INK, LD);
    return;
  }
  if (mode === 'arc') {
    stroke(c, (cc) => { cc.moveTo(x - a.rx, y + a.ry * 0.3); cc.quadraticCurveTo(x, y - a.ry * 1.05, x + a.rx, y + a.ry * 0.3); }, INK, LF + 0.6);
    if (f.lash || f.liner) stroke(c, (cc) => { cc.moveTo(x + side * a.rx * 0.9, y + a.ry * 0.1); cc.lineTo(x + side * (a.rx + 2.6), y - 1.8); }, INK, LD);
    return;
  }
  if (mode === 'squeeze') {
    // > <
    stroke(c, (cc) => { cc.moveTo(x + side * a.rx, y - a.ry * 0.62); cc.lineTo(x - side * a.rx * 0.75, y); cc.lineTo(x + side * a.rx, y + a.ry * 0.62); }, INK, LF + 0.4);
    return;
  }
  const rx = a.rx * s.scale, ry = a.ry * s.scale;
  const lid = Math.max(s.lid, s.expr === 'normal' ? (f.lid ?? 0.1) : 0);
  const look = s.lookX !== 0 ? s.lookX : (f.lookX ?? 0);
  const sclera = E(x, y, rx, ry);
  flat(c, sclera, f.sclera ?? '#ffffff', LF);
  inside(c, sclera, () => {
    // shadow of the brow ridge on the white
    c.fillStyle = 'rgba(70,40,90,0.16)'; c.beginPath(); E(x, y - ry * 0.95, rx * 1.3, ry * 0.55)(c); c.fill();
    const ir = Math.min(rx, ry) * (f.irisK ?? 0.7);
    const ix = x + look * (rx - ir * 0.8) * 0.85, iy = y + s.lookY * (ry - ir) * 0.7 + ry * 0.06;
    const g = c.createRadialGradient(ix, iy + ir * 0.35, ir * 0.1, ix, iy, ir);
    g.addColorStop(0, mix(f.iris, '#ffffff', 0.38)); g.addColorStop(0.6, f.iris); g.addColorStop(1, mix(f.iris, '#000000', 0.4));
    c.fillStyle = g; c.beginPath(); c.arc(ix, iy, ir, 0, TAU); c.fill();
    c.lineWidth = 1; c.strokeStyle = mix(f.iris, '#000000', 0.55); c.stroke();
    const pr = ir * 0.5 * s.pupil;
    c.fillStyle = '#160a16'; c.beginPath();
    if (f.slit) E(ix, iy, pr * 0.42, ir * 0.78 * Math.max(0.7, s.pupil))(c); else c.arc(ix, iy, pr, 0, TAU);
    c.fill();
    if (f.glowEyes) glowAt(c, ix, iy, ir * 1.6, f.iris, 0.5);
    dot(c, ix - ir * 0.36, iy - ir * 0.38, ir * 0.32, '#ffffff');
    dot(c, ix + ir * 0.4, iy + ir * 0.36, ir * 0.14, 'rgba(255,255,255,0.9)');
    // upper lid
    const base = y - ry + 2 * ry * lid;
    if (lid > 0.02 || s.slant !== 0) {
      const yIn = base + s.slant * ry * 0.55, yOut = base - s.slant * ry * 0.55;
      const yL = side < 0 ? yOut : yIn, yR = side < 0 ? yIn : yOut;
      const lidPath: Path = (cc) => {
        cc.moveTo(x - rx - 3, y - ry - 6); cc.lineTo(x + rx + 3, y - ry - 6); cc.lineTo(x + rx + 3, yR);
        cc.quadraticCurveTo(x, (yL + yR) / 2 + ry * 0.18, x - rx - 3, yL); cc.closePath();
      };
      c.beginPath(); lidPath(c); c.fillStyle = lidCol; c.fill();
      stroke(c, (cc) => { cc.moveTo(x + rx + 3, yR); cc.quadraticCurveTo(x, (yL + yR) / 2 + ry * 0.18, x - rx - 3, yL); }, INK, LF);
    }
    // lower lid (sly / happy squint)
    if (s.low > 0.02) {
      const yb = y + ry - 2 * ry * s.low;
      c.beginPath(); c.moveTo(x - rx - 3, y + ry + 6); c.lineTo(x + rx + 3, y + ry + 6); c.lineTo(x + rx + 3, yb); c.quadraticCurveTo(x, yb - ry * 0.2, x - rx - 3, yb); c.closePath();
      c.fillStyle = lidCol; c.fill();
      stroke(c, (cc) => { cc.moveTo(x + rx + 3, yb); cc.quadraticCurveTo(x, yb - ry * 0.2, x - rx - 3, yb); }, INK, LD);
    }
  });
  // a heavier lash line on the top of the eye
  if (lid < 0.2) { c.beginPath(); c.ellipse(x, y, rx, ry, 0, Math.PI * 1.12, Math.PI * 1.88); c.lineWidth = LF * 0.9; c.strokeStyle = INK; c.stroke(); }
  if (f.liner || f.lash) {
    // a little wing / lashes at the outer corner, following the lid
    const ly = y - ry + 2 * ry * lid - s.slant * ry * 0.55;
    const ox = x + side * rx * 0.98, oy = Math.min(y, ly + ry * 0.15);
    c.fillStyle = INK; c.beginPath(); c.moveTo(ox, oy - 1.6); c.lineTo(ox + side * (f.liner ? 4.2 : 2.8), oy - (f.liner ? 3.4 : 2.6)); c.lineTo(ox - side * 0.4, oy + 1.4); c.closePath(); c.fill();
    if (f.lash) stroke(c, (cc) => { cc.moveTo(x + side * rx * 0.55, Math.min(y - ry * 0.82, ly)); cc.lineTo(x + side * rx * 0.85, Math.min(y - ry * 0.82, ly) - 3); }, INK, 1.6);
  }
}

function brow(c: C, x: number, y: number, w: number, ang: number, side: -1 | 1, col: string, lw: number, ink: boolean) {
  const ix = x - side * w / 2, ox = x + side * w / 2;
  const iy = y + ang * 0.5, oy = y - ang * 0.5 + 0.6;
  const path: Path = (cc) => { cc.moveTo(ox, oy); cc.quadraticCurveTo(x, Math.min(iy, oy) - 2.2, ix, iy); };
  if (ink) stroke(c, path, INK, lw + 2.4);
  stroke(c, path, col, lw);
}

interface MouthCfg { x: number; y: number; w: number; fangs: number; lips?: string; teeth: boolean; inner?: string }
function mouth(c: C, m: MouthCfg, kind: MouthKind, open: number) {
  const { x, y, w } = m;
  if (kind === 'o') {
    const rx = w * 0.2 + open * 1.6, ry = Math.max(2.6, w * 0.2 + open * w * 0.32);
    const p = E(x, y + ry * 0.35, rx, ry);
    flat(c, p, m.inner ?? '#5a1626', 0);
    inside(c, p, () => {
      c.fillStyle = '#e8707e'; c.beginPath(); E(x, y + ry * 1.2, rx * 0.8, ry * 0.5)(c); c.fill();
      fangsAt(c, m, [x - rx * 0.5, y + ry * 0.35 - ry + 0.3], [x + rx * 0.5, y + ry * 0.35 - ry + 0.3], ry * 0.7);
    });
    stroke(c, p, m.lips ?? INK, m.lips ? LF + 0.6 : LF);
    return;
  }
  if (m.lips && kind === 'frown' && open < 0.1) kind = 'flat';
  let cl = 0, cr = 0, top = 0, extra = 0;
  switch (kind) {
    case 'smile': cl = cr = -2.4; top = 1.2; extra = 0.25; break;
    case 'grin': cl = cr = -3; top = -0.2; extra = 0.35; break;
    case 'frown': cl = cr = 2.2; top = -1.4; extra = -0.1; break;
    case 'flat': cl = cr = 0; top = 0.3; break;
    case 'smirk': cl = 0.8; cr = -3.2; top = 0.6; extra = 0.15; break;
    case 'grit': cl = cr = 0.6; top = -0.4; break;
    case 'wavy': cl = cr = 1.6; top = -0.6; break;
  }
  const L: [number, number] = [x - w / 2, y + cl], R: [number, number] = [x + w / 2, y + cr];
  const H = open * Math.max(w, 10) * (kind === 'grin' ? 0.62 : kind === 'grit' ? 0.6 : 0.5);
  const topMid = y + top, botMid = topMid + H * (1 + extra) + (kind === 'smile' || kind === 'grin' ? 0.6 : 0);
  const tcy = 2 * topMid - (L[1] + R[1]) / 2, bcy = 2 * botMid - (L[1] + R[1]) / 2;
  const tcx = kind === 'smirk' ? x + 1.5 : x;
  const quadAt = (u: number, cy: number): [number, number] => {
    const a = (1 - u) * (1 - u), b = 2 * u * (1 - u), d = u * u;
    return [a * L[0] + b * tcx + d * R[0], a * L[1] + b * cy + d * R[1]];
  };
  if (H < 1.6) {
    // closed
    const line: Path = (cc) => { cc.moveTo(L[0], L[1]); cc.quadraticCurveTo(tcx, tcy, R[0], R[1]); };
    if (m.lips) {
      const lm = 0.25 * L[1] + 0.5 * tcy + 0.25 * R[1];
      const lip: Path = (cc) => {
        cc.moveTo(L[0] - 0.5, L[1]);
        cc.bezierCurveTo(x - w * 0.3, lm - 3.4, x - w * 0.12, lm - 3.2, x, lm - 1.7);
        cc.bezierCurveTo(x + w * 0.12, lm - 3.2, x + w * 0.3, lm - 3.4, R[0] + 0.5, R[1]);
        cc.quadraticCurveTo(x, 2 * (lm + 3.2) - (L[1] + R[1]) / 2, L[0] - 0.5, L[1]); cc.closePath();
      };
      flat(c, lip, m.lips, LD * 0.8);
      shine(c, x + w * 0.12, lm + 1.8, w * 0.12, 0.9, 0.45, 0);
      stroke(c, line, mix(m.lips, '#2a0a1a', 0.55), LD);
    } else {
      // fangs hang from the lip line (drawn first: the line sits on top of their roots)
      if (m.fangs && kind !== 'frown') {
        for (const u of fangUs(m.fangs)) {
          const [px, py] = quadAt(u, tcy);
          const fp = poly([px - 1.6, py - 0.6, px + 1.6, py - 0.6, px + 0.2, py + 4.2]);
          flat(c, fp, '#ffffff', 1);
        }
      }
      stroke(c, line, INK, LF);
      if (kind === 'smile' || kind === 'smirk') {
        // corner ticks
        stroke(c, (cc) => { cc.moveTo(R[0] - 0.6, R[1] - 1.4); cc.lineTo(R[0] + 0.9, R[1] + 0.9); }, INK, LD);
        if (kind === 'smile') stroke(c, (cc) => { cc.moveTo(L[0] + 0.6, L[1] - 1.4); cc.lineTo(L[0] - 0.9, L[1] + 0.9); }, INK, LD);
      }
    }
    return;
  }
  const shape: Path = (cc) => {
    cc.moveTo(L[0], L[1]);
    if (kind === 'wavy') {
      cc.bezierCurveTo(x - w * 0.2, topMid - 2, x + w * 0.2, topMid + 2, R[0], R[1]);
    } else cc.quadraticCurveTo(tcx, tcy, R[0], R[1]);
    cc.quadraticCurveTo(x, bcy, L[0], L[1]); cc.closePath();
  };
  flat(c, shape, m.inner ?? '#5a1626', 0);
  inside(c, shape, () => {
    if (kind === 'grit') {
      // clenched teeth: upper and lower rows
      c.fillStyle = '#fffaf2'; c.fillRect(x - w, topMid - 10, w * 2, H + 20);
      stroke(c, (cc) => { cc.moveTo(L[0], (topMid + botMid) / 2); cc.lineTo(R[0], (topMid + botMid) / 2); }, mix(INK, '#ffffff', 0.25), 1.2);
      for (const dx of [-w * 0.22, 0, w * 0.22]) stroke(c, (cc) => { cc.moveTo(x + dx, topMid - 4); cc.lineTo(x + dx, botMid + 4); }, 'rgba(60,30,40,0.35)', 0.9);
      if (m.fangs) for (const u of fangUs(m.fangs)) { const [px] = quadAt(u, tcy); const fp = poly([px - 1.8, topMid - 3, px + 1.8, topMid - 3, px, (topMid + botMid) / 2 + 2.6]); flat(c, fp, '#ffffff', 0.9); }
      return;
    }
    if (H > 3) { c.fillStyle = '#e8707e'; c.beginPath(); E(x, botMid + 0.5, w * 0.3, Math.max(1.6, H * 0.42))(c); c.fill(); }
    if (m.teeth) {
      c.beginPath(); c.moveTo(L[0], L[1]); c.quadraticCurveTo(tcx, tcy, R[0], R[1]);
      c.lineWidth = Math.min(4.4, H * 0.55); c.strokeStyle = '#fffaf2'; c.stroke();
    }
    if (m.fangs) for (const u of fangUs(m.fangs)) {
      const [px, py] = quadAt(u, tcy);
      const len = Math.min(5.2, H * 0.7 + 1.2);
      const fp = poly([px - 1.9, py - 1, px + 1.9, py - 1, px + 0.2, py + len]);
      flat(c, fp, '#ffffff', 0.9);
    }
  });
  stroke(c, shape, m.lips ?? INK, m.lips ? LF + 0.8 : LF);
}
function fangUs(f: number): number[] { return f === 2 ? [0.27, 0.73] : f === 1 ? [0.72] : f === -1 ? [0.28] : []; }
function fangsAt(c: C, m: MouthCfg, l: [number, number], r: [number, number], len: number) {
  const pts = m.fangs === 2 ? [l, r] : m.fangs === 1 ? [r] : m.fangs === -1 ? [l] : [];
  for (const [px, py] of pts) flat(c, poly([px - 1.7, py - 1, px + 1.7, py - 1, px, py + Math.min(4.5, len)]), '#ffffff', 0.9);
}

// ── body parts ──

/** head-and-shoulders torso: the shoulder line reaching the disc's lower edge */
function torso(c: C, col: string, o: { w?: number; top?: number; neck?: number } = {}) {
  const w = o.w ?? 44, top = o.top ?? 31;
  toon(c, (cc) => {
    cc.moveTo(-w - 10, 70); cc.lineTo(-w - 4, top + 22);
    cc.quadraticCurveTo(-w + 2, top + 2, -w * 0.45, top); cc.lineTo(w * 0.45, top);
    cc.quadraticCurveTo(w - 2, top + 2, w + 4, top + 22); cc.lineTo(w + 10, 70); cc.closePath();
  }, col, { off: 6 });
}
function neck(c: C, skin: string, w = 8, y0 = 16, y1 = 34) {
  toon(c, poly([-w, y0, w, y0, w + 1, y1, -w - 1, y1]), skin, { lw: LF, sh: mix(skin, '#3a1f48', 0.32), off: 3, rim: null });
  c.fillStyle = 'rgba(60,20,60,0.22)'; c.beginPath(); E(0, y0 + 3, w + 1, 4)(c); c.fill();
}
/** a soft-cornered egg head */
const headPath = (x: number, y: number, rx: number, ry: number, chin = 1): Path => (c) => {
  c.moveTo(x, y - ry);
  c.bezierCurveTo(x + rx * 0.56, y - ry, x + rx, y - ry * 0.56, x + rx, y);
  c.bezierCurveTo(x + rx, y + ry * 0.6 * chin, x + rx * 0.55, y + ry, x, y + ry);
  c.bezierCurveTo(x - rx * 0.55, y + ry, x - rx, y + ry * 0.6 * chin, x - rx, y);
  c.bezierCurveTo(x - rx, y - ry * 0.56, x - rx * 0.56, y - ry, x, y - ry);
  c.closePath();
};

// ───────────────────────── the cast ─────────────────────────

type Paint = (c: C, s: St) => void;

// ── Пастила: принцесса-учёная — зефирные кудри, корона, гогглы на лбу, халат поверх розового платья ──
const pastila: Paint = (c, s) => {
  const skin = '#ffe8ee', hair = '#ff9ec0', hairD = '#e86f9c';
  // marshmallow curls behind: one union, outlined once
  const back = U(O(-27, -6, 11), O(-30, 10, 10), O(-28, 25, 10), O(27, -6, 11), O(30, 10, 10), O(28, 25, 10), O(-18, -24, 13), O(18, -24, 13), O(0, -30, 15));
  toon(c, back, hair, { sh: hairD, off: 5 });
  // lab coat over a pink dress
  torso(c, '#fbfaff');
  toon(c, poly([-13, 31, 13, 31, 0, 54]), '#ff7aa8', { lw: LF, off: 2 });
  for (const sd of [-1, 1]) toon(c, poly([sd * 13, 31, sd * 25, 33, sd * 6, 62, sd * 2, 50]), '#ffffff', { lw: LF, off: 2.5, sh: '#e2e0f0' });
  neck(c, skin, 7, 16, 32);
  toon(c, headPath(0, 3, 24, 25, 0.9), skin, { off: 5 });
  features(c, { ex: 9.5, ey: 6, erx: 6, ery: 7.4, iris: '#a23a9a', skin, lash: true, brow: '#c2457a', browW: 9, browLw: 2.4, browY: 3.4, my: 18, mw: 10, blushX: 15.5, blushY: 14, nose: 'dot', noseY: 12.5 }, s);
  // marshmallow bangs (union), never below the brows
  const bangs = U(O(-17, -17, 9), O(-6, -21, 10), O(7, -21, 10), O(18, -16, 8.5), E(0, -25, 18, 7));
  toon(c, bangs, hair, { sh: hairD, off: 3.5 });
  // goggles pushed up on the forehead: strap + two brass-rimmed lenses
  stroke(c, (cc) => { cc.moveTo(-25, -15); cc.quadraticCurveTo(0, -30, 25, -15); }, INK, 6);
  stroke(c, (cc) => { cc.moveTo(-25, -15); cc.quadraticCurveTo(0, -30, 25, -15); }, '#8a5ab8', 3.4);
  for (const sd of [-1, 1]) {
    const gx = sd * 9, gy = -21;
    toon(c, O(gx, gy, 7.2), '#e8b84a', { lw: LF, off: 2, sh: '#b8862a', rimW: 1.4 });
    const gl = c.createLinearGradient(gx - 5, gy - 5, gx + 5, gy + 5);
    gl.addColorStop(0, '#e8fbff'); gl.addColorStop(1, '#7ac8f0');
    flat(c, O(gx, gy, 4.6), gl, LD * 0.8);
    stroke(c, (cc) => { cc.arc(gx, gy, 3, Math.PI * 1.1, Math.PI * 1.55); }, '#ffffff', 1.4);
  }
  toon(c, (cc) => { cc.roundRect(-3, -23.5, 6, 4, 1.5); }, '#c8963a', { lw: LD, off: 1, rim: null });
  // a little crown, tilted
  c.save(); c.translate(12, -37); c.rotate(0.28);
  toon(c, poly([-8, 4, -9, -5, -4.5, -1, 0, -8, 4.5, -1, 9, -5, 8, 4]), '#ffd34a', { lw: LF, off: 2, sh: '#e0a020' });
  dot(c, 0, 0.5, 1.7, '#ff4a8a'); dot(c, -5.5, 1.5, 1.1, '#7ad0ff'); dot(c, 5.5, 1.5, 1.1, '#7ad0ff');
  c.restore();
};

// ── Ноки: полувампирша-рокерша — колючее каре с красной прядью, острое ухо, клык, кожанка, топор-гитара ──
const noki: Paint = (c, s) => {
  const skin = '#ece3f3', hair = '#2a2232', hairD = '#17121d', hairL = '#6a5a80';
  // the axe-guitar's headstock over her right shoulder (behind everything)
  c.save(); c.translate(36, 6); c.rotate(0.32);
  toon(c, (cc) => { cc.roundRect(-3, -2, 6, 60, 2); }, '#7a4a2a', { lw: LF, off: 2, rim: null });
  for (let i = 0; i < 4; i++) stroke(c, (cc) => { cc.moveTo(-3, 8 + i * 7); cc.lineTo(3, 8 + i * 7); }, '#d8c890', 1);
  toon(c, poly([-3, 0, -11, -10, -6, -20, 6, -16, 3, 0]), '#c8203a', { lw: LF, off: 2.5 });
  stroke(c, (cc) => { cc.moveTo(-8, -11); cc.lineTo(-4, -18); }, '#ff8a9a', 1.4);
  c.restore();
  // back hair: a bob with spiky ends
  const back: Path = (cc) => {
    cc.moveTo(-31, 20); cc.lineTo(-34, 4); cc.quadraticCurveTo(-37, -33, 0, -35); cc.quadraticCurveTo(37, -33, 34, 4); cc.lineTo(31, 20);
    cc.lineTo(27, 13); cc.lineTo(24, 23); cc.lineTo(19, 14); cc.lineTo(-19, 14); cc.lineTo(-24, 23); cc.lineTo(-27, 13); cc.closePath();
  };
  toon(c, back, hair, { sh: hairD, rim: hairL, off: 5 });
  // leather jacket, red tee, studs
  torso(c, '#2e2636');
  toon(c, poly([-11, 31, 11, 31, 0, 47]), '#c8203a', { lw: LF, off: 2 });
  for (const sd of [-1, 1]) {
    toon(c, poly([sd * 11, 31, sd * 22, 32, sd * 9, 58, sd * 3, 46]), '#3e3448', { lw: LF, off: 2, rim: '#7a6a8a' });
    for (const [sx, sy] of [[33, 40], [39, 46], [27, 36]]) { flat(c, poly([sd * sx - 2, sy + 1.5, sd * sx + 2, sy + 1.5, sd * sx, sy - 3]), '#d8dce8', 1); }
  }
  neck(c, skin, 6.5, 16, 32);
  // the pointy ear (her right ear pokes out of the bob)
  toon(c, poly([-20, 0, -38, -13, -21, 11]), skin, { lw: LF, off: 2.5 });
  c.fillStyle = '#e8b8d0'; c.beginPath(); poly([-22.5, 1.5, -33, -8.5, -22.5, 7.5])(c); c.fill();
  // silver hoops
  stroke(c, (cc) => { cc.arc(-25, 13, 2.6, 0, TAU); }, '#c8ccd8', 1.4);
  toon(c, headPath(0, 3, 23, 25, 0.85), skin, { off: 5 });
  features(c, { ex: 9.5, ey: 6, erx: 5.8, ery: 6.8, iris: '#d0203a', skin, liner: true, lid: 0.28, brow: '#2a2232', browW: 9, browLw: 2.2, browY: 3.6, my: 18, mw: 10, fangs: 1, normalMouth: 'smirk', blush: 'rgba(220,120,170,0.3)', blushX: 15, blushY: 14, nose: 'line', noseY: 12 }, s);
  // spiky fringe with the red streak
  const fringe: Path = (cc) => {
    cc.moveTo(-24, 2); cc.quadraticCurveTo(-26, -26, -4, -29); cc.quadraticCurveTo(22, -30, 25, -6);
    cc.lineTo(25, 14); cc.lineTo(20, 4); cc.lineTo(18.5, -8);
    cc.lineTo(13, -6); cc.lineTo(10, -13); cc.lineTo(5, -6); cc.lineTo(1, -12); cc.lineTo(-4, -5); cc.lineTo(-8, -12); cc.lineTo(-13, -6); cc.lineTo(-16, -13); cc.lineTo(-20, -5); cc.closePath();
  };
  toon(c, fringe, hair, { sh: hairD, rim: hairL, off: 3, lw: LF, edge: (cc) => { cc.moveTo(25, -6); cc.lineTo(25, 14); cc.lineTo(20, 4); cc.lineTo(18.5, -8); cc.lineTo(13, -6); cc.lineTo(10, -13); cc.lineTo(5, -6); cc.lineTo(1, -12); cc.lineTo(-4, -5); cc.lineTo(-8, -12); cc.lineTo(-13, -6); cc.lineTo(-16, -13); cc.lineTo(-20, -5); cc.lineTo(-24, 2); } });
  inside(c, fringe, () => {
    c.fillStyle = '#d8243e'; c.beginPath(); poly([6, -34, 13, -34, 13.5, -8, 10, -13, 7, -9])(c); c.fill();
    c.fillStyle = '#ff6a7a'; c.beginPath(); poly([8, -32, 10, -32, 10.5, -14, 8.5, -16])(c); c.fill();
  });
};

// ── Пряник: пряничный стражник — шлем-формочка, глазурь, мундир, копьё-скалка ──
const pryanik: Paint = (c, s) => {
  const skin = '#c98544';
  // rolling-pin spear behind the right shoulder
  c.save(); c.translate(38, 20); c.rotate(0.18);
  toon(c, (cc) => { cc.roundRect(-2, -60, 4, 80, 2); }, '#a06a3a', { lw: LF, off: 1.5, rim: null });
  toon(c, (cc) => { cc.roundRect(-6, -48, 12, 26, 5); }, '#e8c890', { lw: LF, off: 3 });
  c.restore();
  torso(c, '#c83a3a');
  // icing piping and gold buttons
  stroke(c, (cc) => { cc.moveTo(-30, 40); cc.quadraticCurveTo(0, 46, 30, 40); }, '#ffffff', 2.4);
  for (const by of [38, 48]) toon(c, O(0, by, 2.8), '#ffd34a', { lw: LD, off: 1, rimW: 1 });
  neck(c, skin, 7, 16, 32);
  const head = headPath(0, 3, 25, 25, 1);
  toon(c, head, skin, { off: 5, sh: '#a5672e' });
  // icing scallop around the face edge
  inside(c, head, () => {
    c.save(); c.translate(0, 3); c.setLineDash([3, 3.2]); c.lineDashOffset = 0;
    c.beginPath(); c.ellipse(0, 0, 21, 21, 0, Math.PI * 0.12, Math.PI * 0.88); c.lineWidth = 2; c.strokeStyle = 'rgba(255,255,255,0.9)'; c.stroke();
    c.restore();
  });
  features(c, { ex: 9, ey: 5, erx: 5.4, ery: 6.4, iris: '#4a2a1a', skin, brow: '#ffffff', browW: 9, browLw: 2.4, browInk: true, browY: 3.4, my: 17, mw: 11, blush: 'rgba(255,90,120,0.55)', blushX: 16, blushY: 12, blushR: 3.6, nose: 'button', noseY: 11.5, noseCol: '#b06a34' }, s);
  // cookie-cutter helmet with a crest
  const helm: Path = (cc) => {
    cc.moveTo(-26, -4); cc.lineTo(-26, -12); cc.quadraticCurveTo(-24, -32, 0, -33); cc.quadraticCurveTo(24, -32, 26, -12); cc.lineTo(26, -4);
    cc.quadraticCurveTo(0, -11, -26, -4); cc.closePath();
  };
  toon(c, helm, '#d8deea', { sh: '#9aa2b6', off: 4, rim: '#ffffff' });
  stroke(c, (cc) => { cc.moveTo(-25, -9); cc.quadraticCurveTo(0, -16, 25, -9); }, '#9aa2b6', 2);
  for (const x of [-16, -6, 4, 14]) dot(c, x + 1, -12 + Math.abs(x) * 0.08, 1.2, '#9aa2b6');
  toon(c, poly([-3, -32, 0, -44, 3, -32]), '#ffd34a', { lw: LF, off: 1.5, sh: '#d8a020' });
  toon(c, O(0, -45, 3), '#e83a4a', { lw: LD, off: 1.2 });
};

// ── Дед Зефирыч: старый зефирный фонарщик — пышные усы, картуз, шест с фонарём ──
const zefirych: Paint = (c, s) => {
  const skin = '#fff3f6';
  // lamplighter's pole with a lantern on the right
  // (the whole lantern inside the disc: its top at ≈ 40 from the centre, not cut by the frame)
  c.save(); c.translate(3, 32);
  toon(c, (cc) => { cc.roundRect(30, -24, 4, 90, 2); }, '#8a6a3a', { lw: LF, off: 1.5, rim: null });
  stroke(c, (cc) => { cc.moveTo(32, -24); cc.quadraticCurveTo(32, -30, 34, -31); }, INK, 2);
  glowAt(c, 34, -32, 16, '#ffd060', 0.75);
  toon(c, poly([28, -28, 40, -28, 38, -38, 30, -38]), '#3a3a5a', { lw: LF, off: 1.5 });
  flat(c, (cc) => { cc.roundRect(30.5, -37, 7, 8, 1.5); }, '#ffe890', LD * 0.6);
  dot(c, 34, -32.5, 2, '#ffffff');
  toon(c, poly([29, -38, 34, -44, 39, -38]), '#3a3a5a', { lw: LF, off: 1 });
  c.restore();
  torso(c, '#5a5a92');
  for (const by of [40, 50]) toon(c, O(-8, by, 2.4), '#e8c060', { lw: LD, off: 1, rimW: 1 });
  toon(c, poly([-12, 31, 12, 31, 0, 42]), '#f0eaff', { lw: LF, off: 1.5 });
  neck(c, skin, 7, 16, 32);
  // a squishy marshmallow block of a head
  const head: Path = (cc) => { cc.roundRect(-23, -22, 46, 48, 15); };
  toon(c, head, skin, { off: 5, sh: '#e8cfe0' });
  features(c, { ex: 9.5, ey: 2, erx: 4.6, ery: 5.2, iris: '#5a6ab0', skin, lid: 0.32, brow: null, my: 21, mw: 9, blush: 'rgba(255,130,160,0.45)', blushX: 16, blushY: 9, nose: null }, s);
  // bushy brows (unions) above the eyes
  for (const sd of [-1, 1]) {
    const by = -7.5 - s.browRaise + (s.browAng > 0 ? 1 : 0);
    const tilt = sd * s.browAng * 0.35;
    toon(c, U(O(sd * 6, by + tilt, 3.6), O(sd * 10, by - 1, 4.2), O(sd * 14.5, by + 0.5 - tilt, 3.6)), '#ffffff', { lw: LD, off: 1.5, sh: '#dcd8ee' });
  }
  // the moustache (one union) and a pink nose on top
  const mo = U(O(-5, 14, 5.2), O(-11, 15, 5), O(-16.5, 13.5, 3.8), O(5, 14, 5.2), O(11, 15, 5), O(16.5, 13.5, 3.8));
  toon(c, mo, '#ffffff', { lw: LF, off: 2.5, sh: '#dcd8ee' });
  toon(c, E(0, 9.5, 4.4, 3.6), '#ff9ab4', { lw: LF, off: 1.5 });
  // lamplighter's cap
  const cap: Path = (cc) => { cc.moveTo(-24, -15); cc.quadraticCurveTo(-25, -36, 0, -36); cc.quadraticCurveTo(25, -36, 24, -15); cc.closePath(); };
  toon(c, cap, '#4a4a7a', { off: 4 });
  toon(c, (cc) => { cc.moveTo(-26, -16); cc.quadraticCurveTo(0, -11, 26, -16); cc.quadraticCurveTo(28, -10, 22, -9); cc.quadraticCurveTo(0, -5, -22, -9); cc.quadraticCurveTo(-28, -10, -26, -16); cc.closePath(); }, '#2a2a48', { lw: LF, off: 2, rim: '#6a6aa0' });
  toon(c, O(0, -24, 3.6), '#ffd34a', { lw: LD, off: 1.2, sh: '#d8a020' });
};

// ── Мадам Безе: пухлая пекарша — завиток безе, бантик, фартук, румянец, губки ──
const beze: Paint = (c, s) => {
  const skin = '#fff7ef';
  torso(c, '#ff8fb4', { w: 46 });
  toon(c, (cc) => { cc.moveTo(-20, 32); cc.lineTo(20, 32); cc.lineTo(22, 70); cc.lineTo(-22, 70); cc.closePath(); }, '#ffffff', { lw: LF, off: 3, sh: '#efe6f0' });
  stroke(c, (cc) => { cc.moveTo(-20, 36); cc.quadraticCurveTo(0, 40, 20, 36); }, '#ff8fb4', 2);
  neck(c, skin, 8, 16, 32);
  toon(c, headPath(0, 4, 27, 24, 1.15), skin, { off: 5, sh: '#f2d8dc' });
  features(c, { ex: 10.5, ey: 5, erx: 5.4, ery: 6.4, iris: '#5aa0d8', skin, lash: true, brow: '#c88a9a', browW: 9, browLw: 2.2, browY: 3.6, my: 17.5, mw: 11, lips: '#e8466e', blush: 'rgba(255,100,140,0.5)', blushX: 18, blushY: 12, blushR: 5.6, nose: 'dot', noseY: 11.5 }, s);
  // the meringue swirl: stacked tiers with a curl
  const tiers = U(E(0, -19, 26, 9), E(-1, -27, 21, 8), E(1, -34, 15, 7), E(2, -40, 9, 6));
  toon(c, tiers, '#ffffff', { sh: '#ecdce8', off: 3 });
  for (const [y, w] of [[-21, 22], [-29, 17], [-36, 11]] as const) stroke(c, (cc) => { cc.moveTo(-w, y + 1); cc.quadraticCurveTo(0, y + 5, w, y - 1); }, '#e2cfe0', 1.6);
  toon(c, (cc) => { cc.moveTo(0, -45); cc.quadraticCurveTo(8, -50, 7, -44); cc.quadraticCurveTo(4, -41, 1, -44); cc.closePath(); }, '#ffffff', { lw: LD, off: 1, sh: '#ecdce8' });
  // pink bow
  c.save(); c.translate(-18, -24); c.rotate(-0.3);
  toon(c, U(poly([0, 0, -9, -6, -9, 6]), poly([0, 0, 9, -6, 9, 6])), '#ff6a9a', { lw: LF, off: 1.5 });
  toon(c, O(0, 0, 2.6), '#e8467a', { lw: LD, off: 1 });
  c.restore();
};

// ── Пончик: почтальон-пончик — глазурь с посыпкой, фуражка, сумка ──
const ponchik: Paint = (c, s) => {
  const skin = '#e6a256';
  torso(c, '#3a6ad8');
  // satchel strap across the chest, and the bag with a letter
  toon(c, poly([-34, 32, -28, 30, 30, 64, 22, 68]), '#8a5a2a', { lw: LF, off: 1.5, rim: null });
  toon(c, (cc) => { cc.roundRect(-44, 44, 22, 18, 4); }, '#a06a34', { lw: LF, off: 2.5 });
  flat(c, poly([-40, 44, -26, 44, -27, 37, -39, 38]), '#fffaf0', LD);
  stroke(c, (cc) => { cc.moveTo(-39, 38); cc.lineTo(-33, 42); cc.lineTo(-27, 37); }, '#c8b8a0', 1);
  neck(c, skin, 7, 16, 32);
  const head = E(0, 3, 26, 25);
  toon(c, head, skin, { off: 5, sh: '#c27a36' });
  // pink glaze with drips, sprinkles inside it
  const glaze: Path = (cc) => {
    cc.moveTo(-26, 0); cc.quadraticCurveTo(-26, -22, 0, -22); cc.quadraticCurveTo(26, -22, 26, 0);
    cc.quadraticCurveTo(23, -5, 21, -3); cc.quadraticCurveTo(19, 4, 16, -2); cc.quadraticCurveTo(12, -7, 8, -4);
    cc.quadraticCurveTo(4, -2, 0, -5); cc.quadraticCurveTo(-5, -8, -9, -4); cc.quadraticCurveTo(-13, 3, -16, -3);
    cc.quadraticCurveTo(-20, -7, -26, 0); cc.closePath();
  };
  inside(c, head, () => toon(c, glaze, '#ff8ac0', { lw: LF * 0.5, off: 2.5, sh: '#e86aa4' }));
  inside(c, glaze, () => {
    const cols = ['#ffd34a', '#7ad8ff', '#ffffff', '#9af08a', '#ff5a5a'];
    const sp = [[-16, -10, 0.4], [-8, -16, -0.6], [2, -12, 0.9], [10, -17, 0.2], [17, -9, -0.8], [-3, -19, 1.4], [8, -8, -0.2], [-18, -4, 1.1]];
    sp.forEach(([x, y, r], i) => { c.save(); c.translate(x, y); c.rotate(r); c.fillStyle = cols[i % cols.length]; c.beginPath(); c.roundRect(-2.2, -0.8, 4.4, 1.6, 0.8); c.fill(); c.restore(); });
  });
  features(c, { ex: 9.5, ey: 6, erx: 5.4, ery: 6.4, iris: '#6a3a1a', skin, brow: '#7a4a1a', browW: 8.5, browLw: 2.4, browY: 3.4, my: 18, mw: 11, blushX: 16, blushY: 14, nose: 'dot', noseY: 12.5 }, s);
  // postman's cap
  c.save(); c.translate(0, 4); c.rotate(-0.08);
  const cap: Path = (cc) => { cc.moveTo(-20, -22); cc.lineTo(-23, -31); cc.quadraticCurveTo(0, -42, 23, -31); cc.lineTo(20, -22); cc.closePath(); };
  toon(c, cap, '#3a6ad8', { off: 3 });
  toon(c, (cc) => { cc.moveTo(-21, -22); cc.quadraticCurveTo(0, -25, 21, -22); cc.quadraticCurveTo(14, -15, 0, -15); cc.quadraticCurveTo(-14, -15, -21, -22); cc.closePath(); }, '#1e2a48', { lw: LF, off: 1.5, rim: '#5a6a98' });
  toon(c, (cc) => { cc.roundRect(-4.5, -32, 9, 6.5, 1.2); }, '#ffd34a', { lw: LD, off: 1, sh: '#d8a020' });
  stroke(c, (cc) => { cc.moveTo(-4.5, -32); cc.lineTo(0, -28.5); cc.lineTo(4.5, -32); }, '#a87a10', 1);
  c.restore();
};

// ── Мармеладка: зелёная мармеладная девочка с фонариком ──
const marmeladka: Paint = (c, s) => {
  const skin = '#76d86e', skinD = '#3fae4a';
  // gummy buns + the hair behind
  const gum = { sh: '#2a8a38', off: 3.5, rim: '#b8f8a8' };
  for (const sd of [-1, 1]) { toon(c, O(sd * 24, -22, 9.5), '#3fbf52', gum); shine(c, sd * 24 - 3, -26, 3, 1.8, 0.55); }
  toon(c, E(0, -2, 27, 27), '#3fbf52', gum);
  torso(c, '#ffb43a');
  toon(c, poly([-11, 31, 11, 31, 0, 41]), '#ffe08a', { lw: LF, off: 1.5 });
  neck(c, skin, 6.5, 16, 32);
  const head = headPath(0, 4, 23, 24, 0.9);
  toon(c, head, skin, { off: 5, sh: skinD, rim: '#d8ffc8' });
  // gummy gloss + sugar crystals
  inside(c, head, () => {
    shine(c, -11, -8, 6, 3.4, 0.6, -0.6);
    c.fillStyle = 'rgba(255,255,255,0.75)';
    for (const [x, y] of [[-16, 18], [17, 20], [14, -9], [-4, 24], [6, 22], [-19, 4]]) { c.save(); c.translate(x, y); c.rotate(x); c.fillRect(-0.9, -0.9, 1.8, 1.8); c.restore(); }
  });
  features(c, { ex: 9, ey: 6, erx: 6, ery: 7.2, iris: '#1e7a3a', skin, lash: true, brow: '#2a8a3a', browW: 8, browLw: 2.2, browY: 3.4, my: 18, mw: 10, blush: 'rgba(255,120,150,0.45)', blushX: 15, blushY: 14, nose: null }, s);
  // gummy bangs
  const bangs: Path = (cc) => {
    cc.moveTo(-23, 4); cc.quadraticCurveTo(-26, -25, 0, -25); cc.quadraticCurveTo(26, -25, 23, 4);
    cc.quadraticCurveTo(21, -8, 11, -11); cc.quadraticCurveTo(5, -6, -1, -12); cc.quadraticCurveTo(-13, -9, -23, 4); cc.closePath();
  };
  toon(c, bangs, '#3fbf52', { ...gum, lw: LF, edge: (cc) => { cc.moveTo(23, 4); cc.quadraticCurveTo(21, -8, 11, -11); cc.quadraticCurveTo(5, -6, -1, -12); cc.quadraticCurveTo(-13, -9, -23, 4); } });
  inside(c, bangs, () => shine(c, -8, -19, 6, 2.2, 0.55, -0.3));
  c.save(); c.translate(14, -21); c.rotate(0.4);
  toon(c, U(poly([0, 0, -8, -5.5, -8, 5.5]), poly([0, 0, 8, -5.5, 8, 5.5])), '#ff4a6a', { lw: LF, off: 1.5 });
  toon(c, O(0, 0, 2.3), '#d8304e', { lw: LD, off: 0.8 });
  c.restore();
  // the flashlight held up in her hand, beam to the upper right
  c.save();
  c.globalCompositeOperation = 'lighter';
  const beam = c.createLinearGradient(30, 30, 50, -10);
  beam.addColorStop(0, 'rgba(255,240,150,0.55)'); beam.addColorStop(1, 'rgba(255,240,150,0)');
  c.fillStyle = beam; c.beginPath(); poly([28, 30, 40, 36, 62, -6, 44, -22])(c); c.fill();
  c.restore();
  c.save(); c.translate(32, 38); c.rotate(-0.5);
  toon(c, (cc) => { cc.roundRect(-3.5, -4, 7, 16, 2); }, '#e84a4a', { lw: LF, off: 1.5 });
  toon(c, poly([-5.5, -4, 5.5, -4, 4, -9, -4, -9]), '#d8dce8', { lw: LF, off: 1 });
  flat(c, E(0, -9, 4, 1.5), '#fff8c0', LD * 0.6);
  c.restore();
  toon(c, E(27, 44, 6, 5), skin, { lw: LF, off: 2, sh: skinD });
};

// ── Ириска: тянучка-лаборантка — огромные очки, пучок с карандашом, сажа ──
const iriska: Paint = (c, s) => {
  const skin = '#ecb878';
  // bun with a pencil
  c.save(); c.translate(6, -32); c.rotate(0.6);
  toon(c, (cc) => { cc.roundRect(-1.8, -14, 3.6, 24, 1); }, '#ffcc3a', { lw: LD, off: 1, rim: null });
  flat(c, poly([-1.8, -14, 1.8, -14, 0, -18]), '#f0d8b0', 1);
  c.restore();
  toon(c, O(0, -30, 10), '#8a4a1a', { sh: '#683410', off: 3 });
  stroke(c, (cc) => { cc.arc(0, -30, 5.5, 0.4, 4.2); }, '#683410', 1.6);
  torso(c, '#ffffff');
  toon(c, poly([-11, 31, 11, 31, 0, 44]), '#c87a2a', { lw: LF, off: 1.5 });
  toon(c, (cc) => { cc.roundRect(-36, 44, 12, 12, 2); }, '#f4f2fa', { lw: LD, off: 1.5 });
  for (const [px, col] of [[-33, '#e84a4a'], [-29, '#3a8ad8']] as const) toon(c, (cc) => { cc.roundRect(px, 38, 2.4, 8, 1); }, col, { lw: 1.2, off: 0.5, rim: null });
  // a toffee stain on the coat
  c.fillStyle = 'rgba(200,120,40,0.55)'; c.beginPath(); E(22, 50, 4.5, 3)(c); c.fill();
  neck(c, skin, 7, 16, 32);
  const head = headPath(0, 4, 24, 24, 0.9);
  // side hair behind the ears
  toon(c, U(E(-21, 6, 8, 19), E(21, 6, 8, 19), E(0, -8, 25, 20)), '#8a4a1a', { sh: '#683410', off: 3 });
  toon(c, head, skin, { off: 5, sh: '#c8904e' });
  // soot smudges (only on the face)
  inside(c, head, () => {
    c.fillStyle = 'rgba(50,40,50,0.32)';
    for (const [x, y, rx, ry] of [[-16, 15, 5, 3], [14, -12, 4, 2.4], [5, 22, 3, 2]]) { c.beginPath(); E(x, y, rx, ry, 0.4)(c); c.fill(); }
  });
  features(c, { ex: 10, ey: 5, erx: 6.4, ery: 7.4, iris: '#8a4a1a', skin, brow: '#683410', browW: 8, browLw: 2.4, browY: 5.5, my: 18.5, mw: 10, blushX: 17, blushY: 15, nose: 'dot', noseY: 13.5 }, s);
  // fringe
  toon(c, (cc) => { cc.moveTo(-23, -2); cc.quadraticCurveTo(-24, -24, 0, -24); cc.quadraticCurveTo(24, -24, 23, -2); cc.quadraticCurveTo(18, -12, 10, -12); cc.quadraticCurveTo(4, -9, 0, -13); cc.quadraticCurveTo(-8, -10, -14, -13); cc.quadraticCurveTo(-20, -10, -23, -2); cc.closePath(); }, '#8a4a1a', { sh: '#683410', off: 3, rim: '#c8804a', lw: LF, edge: (cc) => { cc.moveTo(23, -2); cc.quadraticCurveTo(18, -12, 10, -12); cc.quadraticCurveTo(4, -9, 0, -13); cc.quadraticCurveTo(-8, -10, -14, -13); cc.quadraticCurveTo(-20, -10, -23, -2); } });
  // HUGE round glasses
  for (const sd of [-1, 1]) {
    const gx = sd * 10, gy = 5;
    c.save(); c.globalAlpha = 0.18; c.fillStyle = '#bfe8ff'; c.beginPath(); c.arc(gx, gy, 10, 0, TAU); c.fill(); c.restore();
    stroke(c, (cc) => { cc.arc(gx, gy, 10.5, 0, TAU); }, INK, 5);
    stroke(c, (cc) => { cc.arc(gx, gy, 10.5, 0, TAU); }, '#4a3a4a', 2.6);
    stroke(c, (cc) => { cc.arc(gx, gy, 7.5, Math.PI * 1.1, Math.PI * 1.4); }, 'rgba(255,255,255,0.85)', 1.6);
  }
  stroke(c, (cc) => { cc.moveTo(-1, 3); cc.quadraticCurveTo(0, 1, 1, 3); }, '#4a3a4a', 2.4);
};

// ── Камыш: старая лягушка-паромщик — соломенная шляпа, камышинка во рту, седые брови ──
const kamysh: Paint = (c, s) => {
  const skin = '#86b85e', skinD = '#5e9040', belly = '#dcebaa';
  torso(c, '#6a5a3a', { w: 46 });
  toon(c, poly([-12, 31, 12, 31, 0, 46]), '#e8dcc0', { lw: LF, off: 1.5 });
  // straw hat pushed back (behind the eye bulges)
  toon(c, E(0, -20, 30, 6.5), '#e8c870', { off: 2, sh: '#c8a050' });
  toon(c, (cc) => { cc.moveTo(-17, -20); cc.quadraticCurveTo(-17, -38, 0, -38); cc.quadraticCurveTo(17, -38, 17, -20); cc.closePath(); }, '#efd488', { off: 3, sh: '#c8a050' });
  toon(c, (cc) => { cc.moveTo(-17, -22); cc.quadraticCurveTo(0, -20, 17, -22); cc.lineTo(17, -26); cc.quadraticCurveTo(0, -24, -17, -26); cc.closePath(); }, '#8a3a2a', { lw: LD, off: 1, rim: null });
  // wide frog head with eye bulges (one union)
  const head = U(E(0, 8, 34, 22), O(-16, -9, 12), O(16, -9, 12));
  toon(c, head, skin, { off: 5, sh: skinD });
  inside(c, head, () => { c.fillStyle = belly; c.beginPath(); E(0, 26, 27, 13)(c); c.fill(); });
  for (const sd of [-1, 1]) dot(c, sd * 3.5, 6, 1.1, '#3e6a2a');
  features(c, { ex: 16, ey: -9, erx: 7.4, ery: 7.4, iris: '#c8a020', skin, slit: false, lid: 0.42, brow: '#f4f2e8', browW: 11, browLw: 3.4, browInk: true, browY: 4.5, my: 16, mw: 30, blush: null, nose: null }, s);
  // the reed held in the right corner of the mouth: its root sits ON the corner (drawn over the lip line), it never
  // crosses an open mouth (the corner moves with the mouth's shape)
  const sway = Math.sin(s.t * 1.6) * 1.5;
  const cy = s.mouth === 'grin' || s.mouth === 'smile' ? 13.4 : s.mouth === 'frown' || s.mouth === 'wavy' ? 17.8 : s.mouth === 'smirk' ? 13 : 16.4;
  const rx0 = s.mouth === 'o' ? 10 + s.open * 2 : 16.2, ry0 = s.mouth === 'o' ? 17.5 : cy;
  const reed: Path = (cc) => { cc.moveTo(rx0, ry0); cc.quadraticCurveTo(27, 9, 37, -3 + sway); };
  stroke(c, reed, INK, 4.4);
  stroke(c, reed, '#d8b860', 2.2);
  toon(c, E(36.5, -5 + sway, 2.6, 6, 0.7), '#7a4a2a', { lw: LD, off: 1 });
  toon(c, E(rx0, ry0, 2.2, 1.7), skin, { lw: LD, off: 0.8, rim: null, sh: skinD });
  // wrinkles
  for (const sd of [-1, 1]) stroke(c, (cc) => { cc.moveTo(sd * 10, 4); cc.quadraticCurveTo(sd * 16, 6, sd * 22, 4); }, skinD, 1.4);
};

// ── Матушка Светлячиха: огромный добрый светлячок — бархатные крылья, перистые усики, светящееся брюшко ──
const svetlyachikha: Paint = (c, s) => {
  const skin = '#5a4570';
  const pulse = 0.75 + 0.25 * Math.sin(s.t * 2.4);
  // velvet wings
  for (const sd of [-1, 1]) {
    const wing = E(sd * 30, 18, 12, 22, sd * 0.55);
    toon(c, wing, '#a888c4', { sh: '#7a5a9a', off: 3.5, rim: '#e0d0f0' });
    inside(c, wing, () => { for (const [dx, dy] of [[-2, 10], [3, 20], [-1, 28]]) dot(c, sd * (30 + dx), dy, 1.8, 'rgba(255,240,170,0.8)'); });
  }
  // the glowing belly below
  glowAt(c, 0, 52, 30 * pulse + 6, '#ffe070', 0.9);
  toon(c, E(0, 50, 22, 16), '#ffe86a', { sh: '#f0c030', off: 3, rim: '#ffffff' });
  toon(c, E(0, 35, 18, 7), '#4a3a5a', { lw: LF, off: 2 });
  // a lace shawl
  toon(c, (cc) => { cc.moveTo(-26, 30); cc.quadraticCurveTo(0, 44, 26, 30); cc.lineTo(20, 26); cc.quadraticCurveTo(0, 34, -20, 26); cc.closePath(); }, '#fff4e0', { lw: LF, off: 1.5, sh: '#ecdcc0' });
  // feathery antennae
  for (const sd of [-1, 1]) {
    const tip: [number, number] = [sd * 27, -33 + Math.sin(s.t * 1.8 + sd) * 1.2];
    stroke(c, (cc) => { cc.moveTo(sd * 7, -18); cc.quadraticCurveTo(sd * 12, -36, tip[0], tip[1]); }, INK, 2.6);
    c.save(); c.translate(tip[0] + sd * 2, tip[1] + 2); c.rotate(sd * 0.9);
    toon(c, E(0, 0, 4, 8), '#7a5a90', { lw: LD, off: 1.5 });
    for (let i = -3; i <= 3; i++) stroke(c, (cc) => { cc.moveTo(0, i * 2.2); cc.lineTo(sd * 3.6, i * 2.2 - 1); }, '#c8a8e0', 0.9);
    c.restore();
  }
  const head = E(0, 6, 25, 23);
  toon(c, head, skin, { off: 5, sh: '#3e2c52', rim: '#9a80b8' });
  // warm light from below on the chin
  inside(c, head, () => { const g = c.createLinearGradient(0, 30, 0, 14); g.addColorStop(0, `rgba(255,220,100,${0.45 * pulse})`); g.addColorStop(1, 'rgba(255,220,100,0)'); c.fillStyle = g; c.fillRect(-30, 10, 60, 24); });
  features(c, { ex: 10, ey: 5, erx: 7.2, ery: 8.4, iris: '#e0a020', skin, lash: true, lid: 0.18, brow: null, my: 19, mw: 10, blush: 'rgba(255,140,170,0.5)', blushX: 17, blushY: 15, nose: null }, s);
  // a little lace bonnet
  toon(c, (cc) => { cc.moveTo(-22, -6); cc.quadraticCurveTo(-24, -24, 0, -24); cc.quadraticCurveTo(24, -24, 22, -6); cc.quadraticCurveTo(12, -14, 0, -14); cc.quadraticCurveTo(-12, -14, -22, -6); cc.closePath(); }, '#fff4e0', { lw: LF, off: 2, sh: '#ecdcc0' });
  for (let i = -3; i <= 3; i++) dot(c, i * 5.5, -14.5 + Math.abs(i) * 1.3, 1.2, '#e0c8a8');
};

// ── Граф Нетопырь: тощий вампир-франт — монокль, зализанные волосы, уши-крылья, плащ с высоким воротником ──
const netopyr: Paint = (c, s) => {
  const skin = '#ddd2ea';
  // the red moon behind him
  glowAt(c, 26, -30, 22, '#ff6a6a', 0.45);
  toon(c, O(28, -32, 11), '#f06a6a', { lw: 0, off: 3, sh: '#d84a5a', rim: null });
  // the cape's high collar, red lining
  for (const sd of [-1, 1]) {
    toon(c, poly([sd * 12, 32, sd * 46, 4, sd * 42, -26, sd * 18, 14]), '#2a1830', { lw: LF, off: 3, rim: '#5a3a6a' });
    toon(c, poly([sd * 15, 28, sd * 40, 4, sd * 38, -18, sd * 19, 16]), '#b0203a', { lw: LD, off: 2.5 });
  }
  torso(c, '#241a30', { w: 40 });
  toon(c, poly([-10, 30, 10, 30, 0, 52]), '#f4eef8', { lw: LF, off: 1.5 });
  // cravat with a ruby
  toon(c, U(poly([0, 36, -8, 31, -7, 41]), poly([0, 36, 8, 31, 7, 41])), '#e8dcf2', { lw: LD, off: 1.5 });
  toon(c, O(0, 36, 2.6), '#d02040', { lw: LD, off: 1 });
  neck(c, skin, 6, 18, 31);
  // bat-wing ears
  for (const sd of [-1, 1]) {
    const ear: Path = (cc) => {
      cc.moveTo(sd * 18, -6); cc.lineTo(sd * 44, -24); cc.quadraticCurveTo(sd * 40, -14, sd * 42, -6);
      cc.quadraticCurveTo(sd * 35, -8, sd * 34, -1); cc.quadraticCurveTo(sd * 28, -3, sd * 26, 4); cc.lineTo(sd * 18, 8); cc.closePath();
    };
    toon(c, ear, skin, { lw: LF, off: 2 });
    inside(c, ear, () => {
      c.fillStyle = '#c8a8d8'; c.beginPath(); poly([sd * 21, -3, sd * 40, -20, sd * 38, -9, sd * 33, -4, sd * 26, 0, sd * 21, 4])(c); c.fill();
      stroke(c, (cc) => { cc.moveTo(sd * 21, 0); cc.lineTo(sd * 38, -8); cc.moveTo(sd * 21, 2); cc.lineTo(sd * 31, -3); }, '#a888b8', 1);
    });
  }
  // a long face with a pointed chin
  const head: Path = (cc) => {
    cc.moveTo(0, -24); cc.bezierCurveTo(13, -24, 20, -14, 20, -1); cc.bezierCurveTo(20, 13, 10, 25, 0, 30);
    cc.bezierCurveTo(-10, 25, -20, 13, -20, -1); cc.bezierCurveTo(-20, -14, -13, -24, 0, -24); cc.closePath();
  };
  toon(c, head, skin, { off: 4.5, sh: '#b8a8cc' });
  // cheekbones
  for (const sd of [-1, 1]) stroke(c, (cc) => { cc.moveTo(sd * 15, 9); cc.quadraticCurveTo(sd * 12, 14, sd * 9, 15); }, '#b8a8cc', 1.6);
  features(c, { ex: 8.5, ey: 2, erx: 5.2, ery: 5.2, iris: '#d0203a', skin, sclera: '#fffaf0', lid: 0.3, brow: '#1c1426', browW: 8.5, browLw: 2.2, browY: 3.6, my: 19, mw: 9, fangs: 2, blush: null, nose: 'line', noseY: 9.5 }, s);
  // pencil moustache (between nose and mouth, never on them)
  for (const sd of [-1, 1]) {
    stroke(c, (cc) => { cc.moveTo(sd * 1.4, 14.2); cc.quadraticCurveTo(sd * 7, 13, sd * 9.5, 11); cc.quadraticCurveTo(sd * 11.5, 9.3, sd * 10.2, 8.6); }, '#1c1426', 1.8);
  }
  // slicked hair with a widow's peak
  const hair: Path = (cc) => {
    cc.moveTo(-21, 0); cc.quadraticCurveTo(-24, -30, 0, -29); cc.quadraticCurveTo(24, -30, 21, 0);
    cc.quadraticCurveTo(19, -11, 7, -14); cc.lineTo(0, -6); cc.lineTo(-7, -14); cc.quadraticCurveTo(-19, -11, -21, 0); cc.closePath();
  };
  toon(c, hair, '#1e1428', { sh: '#120c18', rim: '#5a4a78', off: 3 });
  inside(c, hair, () => { for (const dx of [-10, -3, 4, 11]) stroke(c, (cc) => { cc.moveTo(dx * 0.3, -14); cc.quadraticCurveTo(dx, -22, dx * 1.6, -30); }, 'rgba(140,120,190,0.5)', 1.1); });
  // the monocle on his left eye (viewer's right) with a gold chain
  const mx = 8.5, my = 2;
  c.save(); c.globalAlpha = 0.22; c.fillStyle = '#d8f0ff'; c.beginPath(); c.arc(mx, my, 7.4, 0, TAU); c.fill(); c.restore();
  stroke(c, (cc) => { cc.arc(mx, my, 7.6, 0, TAU); }, INK, 4.2);
  stroke(c, (cc) => { cc.arc(mx, my, 7.6, 0, TAU); }, '#f0c84a', 2.2);
  stroke(c, (cc) => { cc.arc(mx, my, 5.4, Math.PI * 1.1, Math.PI * 1.45); }, 'rgba(255,255,255,0.9)', 1.3);
  c.save(); c.setLineDash([1.6, 1.4]);
  stroke(c, (cc) => { cc.moveTo(mx + 5.5, my + 5.4); cc.quadraticCurveTo(24, 18, 17, 32); }, '#f0c84a', 1.5);
  c.restore();
};

// ── Мадам Морок: дама в вуали с вороном на плече ──
const morok: Paint = (c, s) => {
  const skin = '#e8def0';
  // long dark hair behind
  toon(c, U(E(0, -6, 30, 28), E(-22, 18, 11, 20), E(22, 18, 11, 20)), '#3a1f4e', { sh: '#25122f', rim: '#7a4a9a', off: 4 });
  torso(c, '#4a2466');
  // lace collar + cameo
  toon(c, (cc) => { cc.moveTo(-18, 30); cc.quadraticCurveTo(0, 40, 18, 30); cc.lineTo(14, 26); cc.quadraticCurveTo(0, 33, -14, 26); cc.closePath(); }, '#2a1438', { lw: LF, off: 1.5 });
  toon(c, E(0, 40, 4, 5), '#c8a0e0', { lw: LD, off: 1.5, sh: '#9a6ab8' });
  neck(c, skin, 6, 16, 31);
  toon(c, headPath(0, 3, 22, 24, 0.85), skin, { off: 4.5, sh: '#c2b0d6' });
  features(c, { ex: 9, ey: 5, erx: 5.6, ery: 6.2, iris: '#c0204a', skin, liner: true, lash: true, lid: 0.3, brow: '#3a1f4e', browW: 8, browLw: 2, browY: 4, my: 17.5, mw: 9, lips: '#8a1a4a', blush: 'rgba(200,100,160,0.3)', blushX: 15, blushY: 13, nose: 'line', noseY: 11.5 }, s);
  // side-parted hair over the forehead
  toon(c, (cc) => { cc.moveTo(-22, 6); cc.quadraticCurveTo(-25, -24, 2, -25); cc.quadraticCurveTo(24, -24, 22, 4); cc.quadraticCurveTo(18, -10, 6, -13); cc.quadraticCurveTo(-10, -12, -22, 6); cc.closePath(); }, '#3a1f4e', { sh: '#25122f', rim: '#7a4a9a', off: 3, lw: LF, edge: (cc) => { cc.moveTo(22, 4); cc.quadraticCurveTo(18, -10, 6, -13); cc.quadraticCurveTo(-10, -12, -22, 6); } });
  // the hat
  c.save(); c.translate(3, -22); c.rotate(-0.16);
  toon(c, E(0, 0, 25, 5.5), '#24122f', { lw: LF, off: 1.5, rim: '#6a4a8a' });
  toon(c, (cc) => { cc.moveTo(-12, -1); cc.quadraticCurveTo(-12, -13, 0, -13); cc.quadraticCurveTo(12, -13, 12, -1); cc.closePath(); }, '#24122f', { lw: LF, off: 2, rim: '#6a4a8a' });
  toon(c, (cc) => { cc.moveTo(-12, -1); cc.quadraticCurveTo(0, 1, 12, -1); cc.lineTo(11.6, -4.5); cc.quadraticCurveTo(0, -2.5, -11.6, -4.5); cc.closePath(); }, '#b0204a', { lw: LD, off: 1, rim: null });
  toon(c, (cc) => { cc.moveTo(4, -9); cc.quadraticCurveTo(22, -24, 30, -16); cc.quadraticCurveTo(20, -16, 8, -5); cc.closePath(); }, '#7a3aa0', { lw: LD, off: 1.5, rim: '#c890e8' });
  toon(c, O(-8, -2, 2.8), '#d02050', { lw: LD, off: 1 });
  c.restore();
  // the veil: net clipped to its shape, a scalloped hem just under the eyes
  const veil: Path = (cc) => {
    cc.moveTo(-23, -19); cc.lineTo(27, -27); cc.lineTo(25, 10);
    for (let i = 0; i < 6; i++) { const x0 = 25 - i * 8.3; cc.quadraticCurveTo(x0 - 4.2, 14, x0 - 8.3, 10.5); }
    cc.lineTo(-25, -4); cc.closePath();
  };
  inside(c, veil, () => {
    c.fillStyle = 'rgba(30,10,40,0.22)'; c.fillRect(-40, -40, 80, 60);
    c.strokeStyle = 'rgba(30,10,40,0.45)'; c.lineWidth = 0.7;
    for (let i = -10; i <= 10; i++) { c.beginPath(); c.moveTo(i * 4 - 20, -30); c.lineTo(i * 4 + 20, 16); c.stroke(); c.beginPath(); c.moveTo(i * 4 + 20, -30); c.lineTo(i * 4 - 20, 16); c.stroke(); }
    for (const [x, y] of [[-12, -4], [6, -10], [16, 2], [-4, 6]]) dot(c, x, y, 0.9, 'rgba(30,10,40,0.7)');
  });
  stroke(c, (cc) => { cc.moveTo(25, 10); for (let i = 0; i < 6; i++) { const x0 = 25 - i * 8.3; cc.quadraticCurveTo(x0 - 4.2, 14, x0 - 8.3, 10.5); } }, 'rgba(30,10,40,0.7)', 1.2);
  // the raven on her right shoulder (viewer's left)
  const by = 30 + Math.sin(s.t * 2) * 0.8, hx = -30, hy = 15 + Math.sin(s.t * 2 + 0.6) * 1;
  toon(c, poly([-38, 40, -46, 54, -36, 52, -30, 44]), '#1e1a2a', { lw: LF, off: 1.5, rim: '#5a5a7a' });
  const body = E(-34, by, 10, 12, 0.3);
  toon(c, body, '#24202e', { off: 3, sh: '#15121c', rim: '#6a6a8a' });
  inside(c, body, () => { for (let i = 0; i < 3; i++) stroke(c, (cc) => { cc.moveTo(-40 + i * 3, by - 4 + i * 3); cc.quadraticCurveTo(-34 + i * 3, by + 2 + i * 3, -28 + i * 2, by + 2 + i * 4); }, '#4a4a64', 1.1); });
  const look = s.expr === 'surprised' || s.expr === 'scared' ? -1 : 1;
  toon(c, poly([hx + look * 6, hy - 2, hx + look * 15, hy + 1, hx + look * 6, hy + 3.5]), '#3a3640', { lw: LD, off: 1, rim: '#8a8a9a' });
  toon(c, O(hx, hy, 7.5), '#24202e', { off: 2.5, sh: '#15121c', rim: '#6a6a8a' });
  dot(c, hx + look * 3.2, hy - 1.6, 2.4, '#ffb030'); dot(c, hx + look * 3.5, hy - 1.6, 1.2, '#140a10'); dot(c, hx + look * 2.7, hy - 2.3, 0.6, '#ffffff');
  if (s.expr === 'angry') stroke(c, (cc) => { cc.moveTo(hx + look * 0.5, hy - 5.5); cc.lineTo(hx + look * 6, hy - 3.6); }, INK, 1.6);
};

// ── Шёпот: невидимка — только глаза и мерцающий контур ушей ──
function shepotHidden(c: C, s: St) {
  // a heat haze where he stands
  for (let i = 0; i < 4; i++) {
    c.strokeStyle = `rgba(150,170,240,${0.07 + 0.04 * Math.sin(s.t * 2 + i)})`; c.lineWidth = 2.4;
    c.beginPath(); E(Math.sin(s.t + i) * 2, 14, 16 + i * 7, 22 + i * 6)(c); c.stroke();
  }
  // the shimmer of a big cloak and two tall ears (outline only, faint)
  const ghost: Path = U(poly([-12, -4, -26, -40, -3, -10]), poly([12, -4, 26, -40, 3, -10]), E(0, 6, 18, 17), (cc) => { cc.moveTo(-40, 64); cc.quadraticCurveTo(-36, 26, -12, 22); cc.lineTo(12, 22); cc.quadraticCurveTo(36, 26, 40, 64); cc.closePath(); });
  c.save(); c.globalAlpha = 0.12 + 0.06 * Math.sin(s.t * 1.7); c.fillStyle = '#8a9aff'; c.beginPath(); ghost(c); c.fill(); c.restore();
  c.save(); c.globalAlpha = 0.35 + 0.15 * Math.sin(s.t * 2.3); c.setLineDash([3, 4]); c.lineDashOffset = -s.t * 8;
  stroke(c, ghost, '#b8c4ff', 1.4); c.restore();
  // two pale glowing eyes
  const closed = s.blink || s.eye === 'squeeze' || s.expr === 'sleepy';
  const sq = s.eye === 'arc' ? 0.35 : s.expr === 'scared' || s.expr === 'surprised' ? 1.25 : 1;
  for (const sd of [-1, 1]) {
    const ex = sd * 8, ey = 4;
    glowAt(c, ex, ey, 14, '#a8b8ff', 0.8);
    if (closed) { stroke(c, (cc) => { cc.moveTo(ex - 5, ey); cc.quadraticCurveTo(ex, ey + 2.5, ex + 5, ey); }, '#e8ecff', 2); continue; }
    c.fillStyle = '#f4f6ff'; c.beginPath(); E(ex, ey + (s.eye === 'arc' ? 1.5 : 0), 4.6, 5.6 * sq)(c); c.fill();
    if (s.eye !== 'arc') { c.fillStyle = 'rgba(110,130,230,0.9)'; c.beginPath(); c.arc(ex + s.lookX * 1.5, ey + 1, 2 * (s.expr === 'scared' ? 0.7 : 1), 0, TAU); c.fill(); }
  }
  if (s.open > 0.08) { c.fillStyle = 'rgba(200,210,255,0.4)'; c.beginPath(); E(0, 17, 4, 1 + s.open * 4)(c); c.fill(); }
}

// ── Шёпот (раскрыт): маленький ушастый вампирчик в огромном плаще ──
function shepotSeen(c: C, s: St) {
  const skin = '#dcd4f2';
  // the huge cloak: a collar towering over him
  for (const sd of [-1, 1]) toon(c, poly([sd * 6, 40, sd * 50, 30, sd * 46, -16, sd * 22, 12]), '#2a2a48', { lw: LF, off: 3, rim: '#5a5a8a' });
  toon(c, (cc) => { cc.moveTo(-52, 72); cc.quadraticCurveTo(-48, 30, -16, 28); cc.lineTo(16, 28); cc.quadraticCurveTo(48, 30, 52, 72); cc.closePath(); }, '#24243e', { off: 5, rim: '#5a5a8a' });
  toon(c, O(0, 33, 3.4), '#e8c060', { lw: LD, off: 1.2 });
  // Карамель's garden apron (down to his heels): bib, a pocket with a trowel, ties at the neck
  const apron: Path = (cc) => { cc.moveTo(-13, 31); cc.lineTo(13, 31); cc.lineTo(15, 44); cc.quadraticCurveTo(26, 47, 30, 72); cc.lineTo(-30, 72); cc.quadraticCurveTo(-26, 47, -15, 44); cc.closePath(); };
  toon(c, apron, '#7aa85a', { off: 3, sh: '#4e7a3a', rim: '#b0d890' });
  stroke(c, (cc) => { cc.moveTo(-13, 31); cc.lineTo(-7, 24); cc.moveTo(13, 31); cc.lineTo(7, 24); }, '#4e7a3a', 2);
  toon(c, (cc) => { cc.roundRect(-9, 40, 18, 9, 2); }, '#8ab86a', { lw: LD, off: 1, rim: null, sh: '#4e7a3a' });
  stroke(c, (cc) => { cc.moveTo(4, 41); cc.lineTo(7, 33); }, '#8a8a9a', 2.4);
  toon(c, E(7.5, 31.5, 1.8, 2.8, 0.4), '#b8b8c8', { lw: LD, off: 0.8, rim: null });
  // enormous bat ears
  for (const sd of [-1, 1]) {
    const ear = poly([sd * 9, -6, sd * 30, -44, sd * 22, 2]);
    toon(c, ear, skin, { lw: LF, off: 2.5 });
    inside(c, ear, () => { c.fillStyle = '#f0a8c8'; c.beginPath(); poly([sd * 12, -6, sd * 27, -36, sd * 20, -1])(c); c.fill(); });
  }
  toon(c, headPath(0, 10, 19, 18, 1), skin, { off: 4, sh: '#b4a8d2' });
  features(c, { ex: 7.5, ey: 10, erx: 5.6, ery: 6.8, iris: '#c0203a', skin, lid: 0.05, brow: '#5a5a7a', browW: 6.5, browLw: 1.8, browY: 2.8, my: 21, mw: 7, fangs: 2, blush: 'rgba(240,120,170,0.45)', blushX: 12, blushY: 18, blushR: 3.4, nose: null }, s);
  // tuft of hair
  toon(c, (cc) => { cc.moveTo(-8, -6); cc.quadraticCurveTo(-2, -16, 2, -8); cc.quadraticCurveTo(5, -15, 9, -6); cc.quadraticCurveTo(0, -3, -8, -6); cc.closePath(); }, '#5a5a7a', { lw: LD, off: 1.5, rim: '#9a9ac0' });
  if (s.expr === 'scared' || s.expr === 'sad') toon(c, E(15, 16, 1.6, 2.6), '#9ad0ff', { lw: 1, off: 0.8, rim: '#ffffff' });
}

// ── Ночка и Тенька: близняшки, зеркальные — Ночка в чёрном смотрит влево, Тенька в лиловом — вправо ──
function twin(c: C, s: St, tenka: boolean) {
  const P = tenka
    ? { hair: '#e6d6fa', hairD: '#bca4e0', hairL: '#ffffff', dress: '#a678d8', dressL: '#d8b8f8', iris: '#e0409a', bow: '#ff6ad0', skin: '#ecdff4' }
    : { hair: '#1e1828', hairD: '#100c16', hairL: '#5a4a80', dress: '#221a30', dressL: '#4a3a64', iris: '#6a4aff', bow: '#6a4aff', skin: '#e2d8ee' };
  c.save();
  if (tenka) c.scale(-1, 1); // mirrored twins: Тенька is Ночка's reflection
  const st: St = { ...s, lookX: s.lookX !== 0 ? -Math.abs(s.lookX) : -0.7 }; // always looks to her side (mirror flips it)
  // side ponytail
  toon(c, U(E(-30, 4, 9, 14, -0.4), E(-34, 22, 7, 12, -0.2), O(-35, 34, 5)), P.hair, { sh: P.hairD, rim: P.hairL, off: 3 });
  toon(c, E(0, -4, 27, 26), P.hair, { sh: P.hairD, rim: P.hairL, off: 4 });
  torso(c, P.dress, { w: 42 });
  // high ruffled collar
  toon(c, U(O(-12, 31, 5), O(-4, 33, 5), O(4, 33, 5), O(12, 31, 5)), '#f4eefa', { lw: LF, off: 1.5, sh: '#d8cce8' });
  toon(c, O(0, 40, 2.6), P.bow, { lw: LD, off: 1 });
  neck(c, P.skin, 6, 16, 28);
  for (const sd of [-1, 1]) toon(c, poly([sd * 20, 0, sd * 33, -10, sd * 21, 10]), P.skin, { lw: LF, off: 2 });
  toon(c, headPath(0, 4, 21, 23, 0.9), P.skin, { off: 4.5, sh: mix(P.skin, '#6a4a90', 0.25) });
  features(c, { ex: 8.5, ey: 6, erx: 5.4, ery: 6.6, iris: P.iris, skin: P.skin, lash: true, brow: tenka ? '#a888d0' : '#1e1828', browW: 7.5, browLw: 2, browY: 3.4, my: 18, mw: 8.5, fangs: 2, blushX: 14, blushY: 14, nose: 'dot', noseY: 12.5 }, st);
  // side-swept bangs
  toon(c, (cc) => { cc.moveTo(-23, 6); cc.quadraticCurveTo(-27, -30, 0, -30); cc.quadraticCurveTo(27, -30, 22, 2); cc.quadraticCurveTo(14, -6, 10, -12); cc.quadraticCurveTo(0, -6, -10, -10); cc.quadraticCurveTo(-16, -6, -23, 6); cc.closePath(); }, P.hair, { sh: P.hairD, rim: P.hairL, off: 3, lw: LF, edge: (cc) => { cc.moveTo(22, 2); cc.quadraticCurveTo(14, -6, 10, -12); cc.quadraticCurveTo(0, -6, -10, -10); cc.quadraticCurveTo(-16, -6, -23, 6); } });
  // bow on the ponytail side
  c.save(); c.translate(-20, -18); c.rotate(-0.5);
  toon(c, U(poly([0, 0, -8, -5.5, -8, 5.5]), poly([0, 0, 8, -5.5, 8, 5.5])), P.bow, { lw: LF, off: 1.5 });
  toon(c, O(0, 0, 2.3), mix(P.bow, '#000000', 0.2), { lw: LD, off: 1 });
  c.restore();
  c.restore();
}
const nochka: Paint = (c, s) => twin(c, s, false);
const tenka: Paint = (c, s) => twin(c, s, true);

// ── Король Полночь: высокий, бледно-серый, корона-полумесяц, плащ из чужих теней ──
const polnoch: Paint = (c, s) => {
  const skin = '#cfcfdc';
  // the crimson moon low behind him
  glowAt(c, 0, -30, 34, '#c02040', 0.35);
  // the cloak of stolen shadows: a towering collar with silhouettes drifting in it
  const collar: Path = (cc) => {
    cc.moveTo(-56, 70); cc.lineTo(-48, -6); cc.lineTo(-38, 4); cc.lineTo(-40, -30); cc.lineTo(-22, 0);
    cc.lineTo(22, 0); cc.lineTo(40, -30); cc.lineTo(38, 4); cc.lineTo(48, -6); cc.lineTo(56, 70); cc.closePath();
  };
  toon(c, collar, '#1e1830', { off: 5, sh: '#120e1e', rim: '#4a3a6a' });
  inside(c, collar, () => {
    const drift = (s.t * 3) % 20;
    for (const [x0, y0, sc] of [[-36, 20, 1], [34, 26, 0.9], [-28, 46, 0.8], [30, 50, 1.1], [-42, -4, 0.7], [42, 4, 0.75]] as const) {
      const y = y0 - drift * 0.3 * sc;
      c.save(); c.translate(x0, y); c.scale(sc, sc); c.globalAlpha = 0.5;
      c.fillStyle = '#6a5a9a'; c.beginPath(); E(0, -6, 4.2, 4.6)(c); c.fill();
      c.beginPath(); c.moveTo(-7, 6); c.quadraticCurveTo(-6, -2, 0, -1.5); c.quadraticCurveTo(6, -2, 7, 6); c.closePath(); c.fill();
      c.globalAlpha = 0.9; dot(c, -1.5, -6.5, 0.8, '#d8c8ff'); dot(c, 1.5, -6.5, 0.8, '#d8c8ff');
      c.restore();
    }
  });
  torso(c, '#2a2240', { w: 34, top: 33 });
  toon(c, poly([-9, 32, 9, 32, 0, 50]), '#9a1a30', { lw: LF, off: 1.5 });
  neck(c, skin, 6, 18, 33);
  for (const sd of [-1, 1]) toon(c, poly([sd * 17, -4, sd * 31, -16, sd * 18, 8]), skin, { lw: LF, off: 2 });
  // a long, gaunt face
  const head: Path = (cc) => {
    cc.moveTo(0, -22); cc.bezierCurveTo(12, -22, 19, -14, 19, -2); cc.bezierCurveTo(19, 12, 11, 24, 0, 30);
    cc.bezierCurveTo(-11, 24, -19, 12, -19, -2); cc.bezierCurveTo(-19, -14, -12, -22, 0, -22); cc.closePath();
  };
  toon(c, head, skin, { off: 4.5, sh: '#a2a2b8' });
  // sunken eye sockets
  for (const sd of [-1, 1]) { c.fillStyle = 'rgba(70,60,100,0.28)'; c.beginPath(); E(sd * 8, 2, 7.5, 6.8)(c); c.fill(); }
  for (const sd of [-1, 1]) stroke(c, (cc) => { cc.moveTo(sd * 14, 10); cc.quadraticCurveTo(sd * 11, 16, sd * 8, 17); }, '#a2a2b8', 1.6);
  features(c, { ex: 8, ey: 2, erx: 5, ery: 4.8, iris: '#d0203a', skin, sclera: '#f2f0fa', irisK: 0.55, glowEyes: true, lid: 0.32, brow: '#8c8aa0', browW: 9, browLw: 3, browInk: true, browY: 3.2, my: 20, mw: 9, fangs: 2, blush: null, nose: 'line', noseY: 11 }, s);
  // silver hair swept back, a sharp widow's peak
  toon(c, (cc) => { cc.moveTo(-20, -2); cc.quadraticCurveTo(-22, -27, 0, -26); cc.quadraticCurveTo(22, -27, 20, -2); cc.quadraticCurveTo(17, -12, 6, -14); cc.lineTo(0, -7); cc.lineTo(-6, -14); cc.quadraticCurveTo(-17, -12, -20, -2); cc.closePath(); }, '#9a98ae', { sh: '#76748c', rim: '#dcdaf0', off: 3 });
  // the crescent crown: a thin band with a big crescent (horns up)
  stroke(c, (cc) => { cc.moveTo(-17, -20); cc.quadraticCurveTo(0, -27, 17, -20); }, INK, 5.4);
  stroke(c, (cc) => { cc.moveTo(-17, -20); cc.quadraticCurveTo(0, -27, 17, -20); }, '#e4e0f4', 2.8);
  glowAt(c, 0, -34, 14, '#c8c0ff', 0.5);
  toon(c, (cc) => { cc.arc(0, -36, 11, Math.PI * 0.05, Math.PI * 0.95); cc.arc(0, -40, 9, Math.PI * 0.92, Math.PI * 0.08, true); cc.closePath(); }, '#eeeaff', { lw: LF, off: 2, sh: '#b8b0e0' });
  toon(c, poly([0, -31, -2.4, -27, 0, -24, 2.4, -27]), '#d02040', { lw: LD, off: 1 });
};

// ── Граф Кислоплюй: только письмо — жёлтый конверт, колючий почерк, лимонная печать ──
const kisloplyu: Paint = (c, s) => {
  const wob = Math.sin(s.t * 3) * 0.04 + (s.talk > 0.05 ? Math.sin(s.t * 18) * 0.03 : 0);
  // sour steam
  for (const sd of [-1, 1]) {
    const ph = s.t * 1.4 + (sd > 0 ? 1.5 : 0);
    const k = ph % 1;
    c.save(); c.globalAlpha = 0.65 * (1 - k);
    stroke(c, (cc) => { cc.moveTo(sd * 14, -22 - k * 10); cc.quadraticCurveTo(sd * 20 + Math.sin(ph * 3) * 3, -30 - k * 10, sd * 12, -38 - k * 10); }, '#a8c828', 2.6);
    c.restore();
  }
  c.save(); c.translate(0, 6); c.rotate(-0.08 + wob);
  const env: Path = (cc) => { cc.roundRect(-34, -22, 68, 46, 4); };
  toon(c, env, '#ffe45a', { off: 4, sh: '#e8c030' });
  // prickly handwriting
  inside(c, env, () => {
    c.strokeStyle = '#4a6a10'; c.lineWidth = 1.3; c.lineJoin = 'miter';
    for (const [y, x0, x1] of [[2, -24, 6], [9, -24, 22], [16, -24, 14]] as const) {
      c.beginPath(); c.moveTo(x0, y);
      for (let x = x0, i = 0; x < x1; x += 2.6, i++) c.lineTo(x + 1.3, y + (i % 2 ? 2.4 : -2.8) + ((i * 7) % 3 === 0 ? -1.6 : 0));
      c.stroke();
    }
    stroke(c, (cc) => { cc.moveTo(12, 1); cc.lineTo(26, 3); }, '#4a6a10', 1);
  });
  // the flap — lifts when the letter «speaks»
  const lift = Math.min(1, s.open * 1.4);
  const flapTip = 4 - lift * 16;
  toon(c, poly([-34, -22, 34, -22, 0, flapTip]), '#ffdc3a', { lw: LF, off: 2.5, sh: '#e8b820' });
  // the lemon wax seal
  toon(c, O(0, flapTip, 7.5), '#c8e030', { lw: LF, off: 2, sh: '#98b018' });
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; stroke(c, (cc) => { cc.moveTo(0, flapTip); cc.lineTo(Math.cos(a) * 5, flapTip + Math.sin(a) * 5); }, '#f4ff9a', 1); }
  stroke(c, (cc) => { cc.arc(0, flapTip, 5, 0, TAU); }, '#f4ff9a', 1);
  // a stamp in the corner
  toon(c, (cc) => { cc.roundRect(19, -18, 11, 13, 1); }, '#ffffff', { lw: LD, off: 1, rim: null });
  flat(c, O(24.5, -11.5, 3.2), '#e8d020', 0);
  c.restore();
};

/** a candy-wrapper cap sitting on the head, with a twisted frilly tail on top */
function candyCap(c: C, col: string, stripe: string, dark: string, droop = false) {
  c.save(); if (droop) { c.translate(0, 1); }
  const tailRot = droop ? 0.9 : 0.25;
  c.save(); c.translate(2, -27); c.rotate(tailRot);
  toon(c, poly([0, 2, -7, -12, -2, -9, 0, -14, 2, -9, 7, -12]), col, { lw: LF, off: 1.5, sh: dark });
  c.restore();
  const cap: Path = (cc) => { cc.moveTo(-26, 0); cc.bezierCurveTo(-27, -30, 27, -30, 26, 0); cc.quadraticCurveTo(0, -9, -26, 0); cc.closePath(); };
  toon(c, cap, col, { off: 3.5, sh: dark });
  inside(c, cap, () => { for (let i = -4; i <= 4; i++) stroke(c, (cc) => { cc.moveTo(i * 7 - 6, -30); cc.lineTo(i * 7 + 6, 2); }, stripe, 2.2); });
  stroke(c, cap, INK, LF);
  toon(c, (cc) => { cc.moveTo(-5, -24); cc.quadraticCurveTo(0, -27, 5, -24); cc.lineTo(4, -21); cc.quadraticCurveTo(0, -23, -4, -21); cc.closePath(); }, dark, { lw: LD, off: 1, rim: null });
  c.restore();
}

// ── Житель: горожанин-конфета — шапочка-фантик ──
const zhitel: Paint = (c, s) => {
  const skin = '#ffd8e4';
  torso(c, '#7ac8ff');
  toon(c, poly([-11, 31, 11, 31, 0, 42]), '#ffffff', { lw: LF, off: 1.5 });
  neck(c, skin, 7, 16, 32);
  toon(c, headPath(0, 4, 24, 24, 1), skin, { off: 5, sh: '#ebb4c4' });
  features(c, { ex: 9.5, ey: 6, erx: 5.4, ery: 6.4, iris: '#6a3a8a', skin, brow: '#a8507a', browW: 8, browLw: 2.4, browY: 3.4, my: 18, mw: 10, blushX: 16, blushY: 14, nose: 'dot', noseY: 12.5 }, s);
  candyCap(c, '#ff7aa8', '#ffffff', '#e85a8a');
};

// ── Пресняк: серый, сонный, выцветший житель ──
const presnyak: Paint = (c, s) => {
  const skin = '#cdcdd2';
  torso(c, '#9a9aa4');
  toon(c, poly([-11, 31, 11, 31, 0, 42]), '#bcbcc4', { lw: LF, off: 1.5 });
  neck(c, skin, 7, 16, 32);
  toon(c, headPath(0, 4, 24, 24, 1), skin, { off: 5, sh: '#a8a8b0', rim: '#e4e4e8' });
  const st: St = s.expr === 'normal' ? { ...s, lid: 0.58, slant: -0.15, mouth: 'flat', browRaise: -1 } : s;
  features(c, { ex: 9.5, ey: 6, erx: 5.4, ery: 6.4, iris: '#7a7a86', skin, sclera: '#ecece8', brow: '#7a7a84', browW: 8, browLw: 2.4, browY: 3.4, my: 18, mw: 9, blush: null, nose: 'dot', noseY: 12.5 }, st);
  // the same candy cap, its colour drunk away
  candyCap(c, '#b8b8c0', '#d0d0d6', '#9a9aa4', true);
  // drifting «z»
  const k = (s.t * 0.4) % 1;
  c.save(); c.globalAlpha = Math.sin(k * Math.PI) * 0.8;
  c.font = '900 9px Rubik, sans-serif'; c.fillStyle = '#7a7a86'; c.fillText('z', 24 + k * 6, -14 - k * 14);
  c.restore();
};

// ── Карамель (дневник): голос из раскрытой тетради — обложка с лейкой, страницы с почерком и рисунками ──
const karamel: Paint = (c, s) => {
  const flut = s.talk > 0.05 ? Math.sin(s.t * 16) * 1.6 : 0;
  // a warm glow out of the pages (the voice)
  glowAt(c, 0, 4, 46, '#ffd890', 0.35 + s.open * 0.25);
  c.save(); c.translate(0, 5); c.rotate(-0.06 + Math.sin(s.t * 1.2) * 0.02); c.scale(0.84, 0.84);
  // the cover under the pages: green leather, the watering can stamped on its spine flap
  const cover: Path = (cc) => { cc.moveTo(-43, -26); cc.quadraticCurveTo(-22, -32, 0, -27); cc.quadraticCurveTo(22, -32, 43, -26); cc.lineTo(44, 30); cc.quadraticCurveTo(22, 25, 0, 31); cc.quadraticCurveTo(-22, 25, -44, 30); cc.closePath(); };
  toon(c, cover, '#5f8a3e', { off: 3, sh: '#3e6428', rim: '#9ac070' });
  // the ribbon bookmark hanging out at the bottom
  const rb = Math.sin(s.t * 2.2) * 2;
  toon(c, poly([3, 26, 7, 26, 8 + rb, 44, 5 + rb, 40, 2 + rb, 44]), '#e84a6a', { lw: LD, off: 1 });
  // pages: left and right, curving into the spine
  const left: Path = (cc) => { cc.moveTo(-40, -23); cc.quadraticCurveTo(-20, -28, -1, -23); cc.lineTo(-1, 27); cc.quadraticCurveTo(-20, 22, -41, 26); cc.closePath(); };
  const right: Path = (cc) => { cc.moveTo(1, -23); cc.quadraticCurveTo(20, -28, 40, -23 - flut); cc.lineTo(41, 26); cc.quadraticCurveTo(20, 22, 1, 27); cc.closePath(); };
  toon(c, left, '#fff6e2', { lw: LF, off: 2.5, sh: '#ecdcb8', rim: null });
  toon(c, right, '#fff6e2', { lw: LF, off: 2.5, sh: '#ecdcb8', rim: null });
  // the spine's shadow
  inside(c, U(left, right), () => {
    const g = c.createLinearGradient(-8, 0, 8, 0);
    g.addColorStop(0, 'rgba(120,80,40,0)'); g.addColorStop(0.5, 'rgba(120,80,40,0.35)'); g.addColorStop(1, 'rgba(120,80,40,0)');
    c.fillStyle = g; c.fillRect(-8, -30, 16, 60);
    // faint ruled lines
    c.strokeStyle = 'rgba(150,170,210,0.35)'; c.lineWidth = 0.6;
    for (let y = -14; y < 24; y += 5.5) { c.beginPath(); c.moveTo(-38, y); c.quadraticCurveTo(-20, y - 3, -2, y); c.moveTo(2, y); c.quadraticCurveTo(20, y - 3, 39, y); c.stroke(); }
  });
  const ink = '#6a3a1a';
  // left page: the watering can (Карамель's sign) sketched in ink, a pressed flower under it
  c.save(); c.translate(-21, -6);
  stroke(c, (cc) => { cc.moveTo(-9, 2); cc.lineTo(-7, 12); cc.lineTo(7, 12); cc.lineTo(9, 2); cc.closePath(); }, ink, 1.6);
  stroke(c, (cc) => { cc.moveTo(9, 4); cc.lineTo(17, -4); cc.moveTo(15, -6); cc.lineTo(19, -2); }, ink, 1.6);
  stroke(c, (cc) => { cc.moveTo(-9, 4); cc.quadraticCurveTo(-15, 2, -11, -3); cc.moveTo(-6, 2); cc.quadraticCurveTo(0, -6, 6, 2); }, ink, 1.4);
  for (let i = 0; i < 3; i++) dot(c, 20 + i * 1.6, 0 + i * 2.6, 0.8, '#5aa8e8');
  c.restore();
  // a pressed flower (pink) at the bottom of the left page
  for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU + 0.3; c.fillStyle = '#ff9ec0'; c.beginPath(); E(-24 + Math.cos(a) * 3, 15 + Math.sin(a) * 3, 2.6, 1.6, a)(c); c.fill(); }
  dot(c, -24, 15, 1.4, '#ffd34a');
  stroke(c, (cc) => { cc.moveTo(-24, 17); cc.quadraticCurveTo(-27, 21, -30, 23); }, '#6a9a4a', 1.1);
  // right page: handwriting (flows as she speaks) and a doodled face — Карамель's own little self-portrait
  const shown = s.talk > 0.05 ? 0.4 + 0.6 * ((s.t * 0.7) % 1) : 1;
  c.save(); c.beginPath(); c.rect(2, -30, 40 * shown + 2, 60); c.clip();
  for (const [y, x1] of [[12, 37], [17.5, 30], [23, 34]] as const) {
    c.beginPath(); c.moveTo(6, y);
    for (let x = 6, i = 0; x < x1; x += 2.2, i++) c.quadraticCurveTo(x + 1.1, y - 2.6 - (i % 3), x + 2.2, y);
    c.strokeStyle = ink; c.lineWidth = 1.1; c.stroke();
  }
  c.restore();
  // the doodle: round face, a bun with a leaf, expression from the line
  const fx = 22, fy = -9;
  stroke(c, (cc) => { cc.arc(fx, fy, 9.5, 0, TAU); }, ink, 1.5);
  stroke(c, (cc) => { cc.arc(fx + 1, fy - 12, 4, 0, TAU); }, ink, 1.4);
  stroke(c, (cc) => { cc.moveTo(fx + 4, fy - 15); cc.quadraticCurveTo(fx + 10, fy - 19, fx + 11, fy - 14); cc.quadraticCurveTo(fx + 7, fy - 13, fx + 4, fy - 15); }, '#4a8a3a', 1.3);
  for (const sd of [-1, 1]) {
    const ex = fx + sd * 3.6, ey = fy - 1.5;
    if (s.blink || s.eye === 'squeeze') stroke(c, (cc) => { cc.moveTo(ex - 1.6, ey); cc.lineTo(ex + 1.6, ey); }, ink, 1.3);
    else if (s.eye === 'arc') stroke(c, (cc) => { cc.moveTo(ex - 1.8, ey + 0.6); cc.quadraticCurveTo(ex, ey - 1.8, ex + 1.8, ey + 0.6); }, ink, 1.3);
    else dot(c, ex, ey, s.expr === 'surprised' || s.expr === 'scared' ? 1.6 : 1.2, ink);
  }
  for (const sd of [-1, 1]) { c.fillStyle = 'rgba(255,120,150,0.4)'; c.beginPath(); E(fx + sd * 6, fy + 2.5, 2, 1.2)(c); c.fill(); }
  const mo = s.open;
  if (s.mouth === 'o' || mo > 0.25) { c.fillStyle = ink; c.beginPath(); E(fx, fy + 4.5, 1.6 + mo, 1 + mo * 2.2)(c); c.fill(); }
  else if (s.mouth === 'frown' || s.mouth === 'wavy') stroke(c, (cc) => { cc.moveTo(fx - 3, fy + 5.5); cc.quadraticCurveTo(fx, fy + 3, fx + 3, fy + 5.5); }, ink, 1.3);
  else stroke(c, (cc) => { cc.moveTo(fx - 3.2, fy + 3.6); cc.quadraticCurveTo(fx, fy + 6.6, fx + 3.2, fy + 3.6); }, ink, 1.3);
  // the turning page corner when she speaks
  if (flut > 0.3) toon(c, poly([40, -23 - flut, 30, -22, 39, -14]), '#f6e8c8', { lw: LD, off: 1, rim: null });
  c.restore();
};

// ── Кар-Карыч: ворон Мадам Морок — чёрный, взъерошенный, жёлтый глаз, большой клюв, честный и ворчливый ──
const voron: Paint = (c, s) => {
  const ink = '#1c1a26', feath = '#26243a', featL = '#5a5a82';
  // shoulders / folded wings
  toon(c, (cc) => { cc.moveTo(-48, 70); cc.quadraticCurveTo(-46, 24, -20, 20); cc.lineTo(20, 20); cc.quadraticCurveTo(46, 24, 48, 70); cc.closePath(); }, feath, { off: 5, sh: '#15131f', rim: featL });
  for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) stroke(c, (cc) => { cc.moveTo(sd * (20 + i * 8), 30 + i * 4); cc.quadraticCurveTo(sd * (28 + i * 8), 44 + i * 4, sd * (24 + i * 7), 58); }, '#3e3c5a', 1.4);
  // the head (a scruffy crest on top)
  const crest = U(poly([-6, -24, -2, -38, 2, -25]), poly([0, -25, 8, -36, 7, -22]), poly([-12, -21, -14, -32, -4, -24]));
  toon(c, crest, feath, { lw: LF, off: 1.5, sh: '#15131f', rim: featL });
  const head = E(0, 0, 24, 25);
  toon(c, head, feath, { off: 5, sh: '#15131f', rim: featL });
  // chest ruff
  toon(c, U(O(-8, 22, 6), O(0, 25, 6.5), O(8, 22, 6)), '#2e2c46', { lw: LF, off: 2, rim: featL });
  // eyes: yellow, round, on pale bare eye-rings (so a closed / squinting eye still reads), heavy brows of feathers
  for (const sd of [-1, 1]) toon(c, E(sd * 11, -4, 8.6, 8.8), '#5c5a80', { lw: LD, off: 1.5, rim: '#8a8ab0', sh: '#46446a' });
  const fc: FaceCfg = { ex: 11, ey: -4, erx: 6, ery: 6.4, iris: '#f0b020', skin: '#5c5a80', sclera: '#fff6d8', irisK: 0.82, my: 0, mw: 0, blush: null, nose: null, brow: null, lid: 0.15 };
  for (const sd of [-1, 1] as const) eye(c, { x: sd * 11, y: -4, rx: 6, ry: 6.4, side: sd, cfg: fc }, s);
  for (const sd of [-1, 1] as const) brow(c, sd * 11, -4 - 6.4 * s.scale - 4.5 - s.browRaise, 13, s.browAng + 1, sd, '#8a8ab0', 3.2, true);
  // the beak: upper and lower mandibles (the lower drops when he caws)
  const open = Math.min(1, s.open * 1.4);
  const lower: Path = (cc) => { cc.moveTo(-7, 9); cc.quadraticCurveTo(0, 12 + open * 9, 3, 18 + open * 10); cc.quadraticCurveTo(5, 12 + open * 6, 7, 9); cc.closePath(); };
  toon(c, lower, '#3a3640', { lw: LF, off: 1.5, rim: '#8a8a9a' });
  if (open > 0.1) flat(c, (cc) => { cc.moveTo(-5, 9); cc.quadraticCurveTo(0, 11 + open * 7, 4, 9); cc.closePath(); }, '#c8304a', 0);
  const upper: Path = (cc) => { cc.moveTo(-9, 1); cc.quadraticCurveTo(0, -3, 9, 1); cc.quadraticCurveTo(8, 10, 3, 19); cc.quadraticCurveTo(-1, 12, -9, 1); cc.closePath(); };
  toon(c, upper, '#4a4652', { lw: LF, off: 2, sh: '#2a2830', rim: '#9a9aaa' });
  dot(c, -2.5, 4, 0.9, '#1a1820'); dot(c, 2.5, 4, 0.9, '#1a1820');
  void ink;
};

const narrator: Paint = () => { /* drawn by the prologue's portrait (never reached) */ };

const PAINT: Record<PortraitId, Paint> = {
  tosha: narrator, bublik: narrator, bear: narrator, narrator,
  pastila, noki, pryanik, zefirych, beze, ponchik, marmeladka, iriska, kamysh, svetlyachikha, netopyr, morok,
  shepot: (c, s) => shepotHidden(c, s), nochka, tenka, polnoch, kisloplyu, zhitel, presnyak,
  karamel, voron, shurshik: (c, s) => shepotSeen(c, s),
};

// ───────────────────────── the lieutenants as little bat-mice (finale) ─────────────────────────
type MouseKind = 'netopyr' | 'morok' | 'shepot' | 'nochka' | 'tenka';
const MOUSE_KIND: Partial<Record<PortraitId, MouseKind>> = { netopyr: 'netopyr', morok: 'morok', shepot: 'shepot', shurshik: 'shepot', nochka: 'nochka', tenka: 'tenka' };

function drawMouse(c: C, kind: MouseKind, s: St) {
  const fur = kind === 'tenka' ? '#8a6aaa' : kind === 'nochka' ? '#3a3248' : kind === 'shepot' ? '#8a8aa4' : kind === 'morok' ? '#4a5a5a' : '#5a3a76';
  const furD = mix(fur, '#000000', 0.3), furL = mix(fur, '#ffffff', 0.45);
  const flap = Math.sin(s.t * 8) * 3;
  // little wings
  for (const sd of [-1, 1]) {
    const wing: Path = (cc) => {
      cc.moveTo(sd * 14, 16); cc.quadraticCurveTo(sd * 34, -4 + flap, sd * 46, 8 + flap);
      cc.quadraticCurveTo(sd * 40, 14, sd * 41, 22); cc.quadraticCurveTo(sd * 33, 18, sd * 30, 26); cc.quadraticCurveTo(sd * 24, 21, sd * 16, 30); cc.closePath();
    };
    toon(c, wing, furD, { lw: LF, off: 2, rim: furL });
  }
  if (kind === 'shepot') toon(c, (cc) => { cc.moveTo(-40, 72); cc.quadraticCurveTo(-34, 22, -10, 20); cc.lineTo(10, 20); cc.quadraticCurveTo(34, 22, 40, 72); cc.closePath(); }, '#2a2a48', { off: 4, rim: '#5a5a8a' });
  else toon(c, E(0, 44, 22, 18), fur, { off: 4, sh: furD, rim: furL });
  if (kind === 'netopyr') for (const sd of [-1, 1]) toon(c, poly([sd * 6, 36, sd * 26, 24, sd * 24, 6, sd * 12, 24]), '#b0203a', { lw: LF, off: 2 });
  // ears
  const earH = kind === 'shepot' ? 46 : 34;
  for (const sd of [-1, 1]) {
    const ear = poly([sd * 6, -4, sd * 24, -earH + 6, sd * 22, 4]);
    toon(c, ear, fur, { lw: LF, off: 2, sh: furD });
    inside(c, ear, () => { c.fillStyle = '#f0a8c8'; c.beginPath(); poly([sd * 9, -3, sd * 22, -earH + 12, sd * 19, 2])(c); c.fill(); });
  }
  toon(c, E(0, 10, 22, 20), fur, { off: 4, sh: furD, rim: furL });
  toon(c, E(0, 18, 12, 8), mix(fur, '#ffe8f0', 0.55), { lw: 0, off: 2, rim: null });
  const st: St = kind === 'nochka' ? { ...s, lookX: s.lookX || -0.7 } : kind === 'tenka' ? { ...s, lookX: s.lookX || 0.7 } : s;
  features(c, { ex: 8, ey: 8, erx: 5.6, ery: 6.6, iris: '#d0203a', skin: fur, lid: 0.05, brow: null, my: 19, mw: 7, fangs: 2, blush: 'rgba(255,130,170,0.45)', blushX: 13, blushY: 16, blushR: 3.2, nose: 'dot', noseY: 14, noseCol: '#ff8ab0' }, st);
  if (kind === 'netopyr') {
    stroke(c, (cc) => { cc.arc(8, 8, 7.4, 0, TAU); }, INK, 4);
    stroke(c, (cc) => { cc.arc(8, 8, 7.4, 0, TAU); }, '#f0c84a', 2);
    c.save(); c.setLineDash([1.5, 1.3]); stroke(c, (cc) => { cc.moveTo(13, 13); cc.quadraticCurveTo(18, 22, 14, 30); }, '#f0c84a', 1.4); c.restore();
  } else if (kind === 'morok') {
    c.save(); c.translate(2, -8); c.rotate(-0.2);
    toon(c, E(0, 0, 14, 3.4), '#24122f', { lw: LD, off: 1, rim: '#6a4a8a' });
    toon(c, (cc) => { cc.moveTo(-7, -1); cc.quadraticCurveTo(-7, -9, 0, -9); cc.quadraticCurveTo(7, -9, 7, -1); cc.closePath(); }, '#24122f', { lw: LD, off: 1, rim: '#6a4a8a' });
    toon(c, (cc) => { cc.moveTo(2, -7); cc.quadraticCurveTo(12, -16, 18, -11); cc.quadraticCurveTo(11, -10, 5, -4); cc.closePath(); }, '#7a3aa0', { lw: LD, off: 1 });
    c.restore();
    inside(c, poly([-17, -8, 19, -12, 18, 12, -18, 12]), () => { c.fillStyle = 'rgba(30,10,40,0.25)'; c.fillRect(-20, -14, 40, 26); c.strokeStyle = 'rgba(30,10,40,0.45)'; c.lineWidth = 0.6; for (let i = -6; i <= 6; i++) { c.beginPath(); c.moveTo(i * 4 - 12, -14); c.lineTo(i * 4 + 12, 12); c.stroke(); c.beginPath(); c.moveTo(i * 4 + 12, -14); c.lineTo(i * 4 - 12, 12); c.stroke(); } });
  } else if (kind === 'nochka' || kind === 'tenka') {
    const sd = kind === 'nochka' ? -1 : 1;
    const bc = kind === 'nochka' ? '#6a4aff' : '#ff6ad0';
    c.save(); c.translate(sd * 13, -6); c.rotate(sd * 0.4);
    toon(c, U(poly([0, 0, -7, -5, -7, 5]), poly([0, 0, 7, -5, 7, 5])), bc, { lw: LF, off: 1.2 });
    toon(c, O(0, 0, 2), mix(bc, '#000000', 0.2), { lw: LD, off: 0.8 });
    c.restore();
  } else if (kind === 'shepot') {
    toon(c, O(0, 28, 2.8), '#e8c060', { lw: LD, off: 1 });
  }
}

import * as THREE from 'three';
import { canvasTex, PAL, BOOK_COLORS } from '../gfx';
import { rng, TAU, type UVRect } from './kit';

/**
 * Procedural, cached CanvasTextures for the world kit. Every function caches by its arguments,
 * so calling it again is free. Textures marked "tile" use RepeatWrapping and are meant for
 * world-scaled UVs (see kit.boxGeo(…, tile)).
 */

type G = CanvasRenderingContext2D;
const OUT = PAL.outline;
export const FONT_HEAD = 'Rubik, "Arial Black", sans-serif';
export const FONT_HAND = 'Pangolin, "Comic Sans MS", sans-serif';

const cache = new Map<string, THREE.Texture>();
function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = cache.get(key);
  if (!t) { t = make(); t.name = key; cache.set(key, t); }
  return t;
}
function tex(key: string, w: number, h: number, draw: (g: G, w: number, h: number) => void, wrap = false) {
  return cached(key, () => canvasTex(w, h, draw, { wrap }));
}

// ───────────────────────── color & drawing utils ─────────────────────────

function rgbOf(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** lighten (amt>0) / darken (amt<0) a #hex color → #hex */
export function shade(hex: string, amt: number): string {
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt))));
  const [r, g, b] = rgbOf(hex);
  return '#' + ((1 << 24) | (f(r) << 16) | (f(g) << 8) | f(b)).toString(16).slice(1);
}
export function rgba(hex: string, a: number) { const [r, g, b] = rgbOf(hex); return `rgba(${r},${g},${b},${a})`; }
function hashStr(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

function rrPath(g: G, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}
function circle(g: G, x: number, y: number, r: number, fill?: string, stroke?: string, lw = 3) {
  g.beginPath(); g.arc(x, y, r, 0, TAU);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}
function ellipse(g: G, x: number, y: number, rx: number, ry: number, rot: number, fill?: string, stroke?: string, lw = 3) {
  g.beginPath(); g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}
function line(g: G, x0: number, y0: number, x1: number, y1: number, color: string, lw: number) {
  g.strokeStyle = color; g.lineWidth = lw; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
}
/** horizontal wavy line periodic over `w` (tiles seamlessly) */
function wavyH(g: G, w: number, y: number, amp: number, cycles: number, phase: number, color: string, lw: number) {
  g.strokeStyle = color; g.lineWidth = lw; g.lineCap = 'round';
  g.beginPath();
  for (let x = -8; x <= w + 8; x += 8) {
    const yy = y + Math.sin((x / w) * TAU * cycles + phase) * amp + Math.sin((x / w) * TAU * (cycles * 2 + 1) + phase * 1.7) * amp * 0.35;
    if (x === -8) g.moveTo(x, yy); else g.lineTo(x, yy);
  }
  g.stroke();
}
/** draw fn at wrapped offsets so features crossing the edge tile seamlessly */
function wrap9(w: number, h: number, x: number, y: number, rad: number, fn: (x: number, y: number) => void) {
  for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
    const px = x + ox, py = y + oy;
    if (px + rad < 0 || px - rad > w || py + rad < 0 || py - rad > h) continue;
    fn(px, py);
  }
}
function speckle(g: G, w: number, h: number, n: number, color: string, alpha: number, r0: number, r1: number, R: () => number) {
  g.fillStyle = rgba(color, alpha);
  for (let i = 0; i < n; i++) { g.beginPath(); g.arc(R() * w, R() * h, r0 + R() * (r1 - r0), 0, TAU); g.fill(); }
}
/** canvas of grey texels: k<1 → 'multiply' layer (white = neutral), k>1 → 'color-dodge' layer (black = neutral) */
function factorLayers(cw: number, ch: number, k: (x: number, y: number) => number): [HTMLCanvasElement, HTMLCanvasElement] {
  const mk = () => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; return c; };
  const cm = mk(), cd = mk();
  const gm = cm.getContext('2d')!, gd = cd.getContext('2d')!;
  const im = gm.createImageData(cw, ch), id = gd.createImageData(cw, ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const f = k(x, y), i = (y * cw + x) * 4;
    const m = Math.round(Math.min(1, f) * 255), d = Math.round(Math.max(0, 1 - 1 / Math.max(1, f)) * 255);
    im.data[i] = im.data[i + 1] = im.data[i + 2] = m; im.data[i + 3] = 255;
    id.data[i] = id.data[i + 1] = id.data[i + 2] = d; id.data[i + 3] = 255;
  }
  gm.putImageData(im, 0, 0); gd.putImageData(id, 0, 0);
  return [cm, cd];
}
/**
 * Tileable multiplicative value noise over a region of the canvas (keeps hue): brightness × (1 ± amp)
 * from a `cx × cy` lattice (anisotropic → streaky grain) plus optional ±`fine` per-pixel grain.
 * Exact multiply/divide via 'multiply' + 'color-dodge' layers; the lattice is upscaled with bilinear
 * filtering (with one wrapped border texel → seamless when the region is a whole tile), so it costs a
 * few drawImage calls instead of a per-pixel JS loop.
 */
function mottle(g: G, x0: number, y0: number, w: number, h: number, seed: number, cx: number, cy: number, amp: number, fine = 0) {
  const R = rng(seed);
  const lat = new Float32Array(cx * cy);
  for (let i = 0; i < lat.length; i++) lat[i] = R() * 2 - 1;
  const layers = factorLayers(cx + 2, cy + 2, (x, y) => 1 + lat[((y - 1 + cy) % cy) * cx + ((x - 1 + cx) % cx)] * amp);
  g.save();
  g.beginPath(); g.rect(x0, y0, w, h); g.clip();
  g.imageSmoothingEnabled = true;
  // whole padded lattice, so the wrapped border texels land just outside the clip
  const ops: GlobalCompositeOperation[] = ['multiply', 'color-dodge'];
  layers.forEach((c, i) => { g.globalCompositeOperation = ops[i]; g.drawImage(c, x0 - w / cx, y0 - h / cy, w + (2 * w) / cx, h + (2 * h) / cy); });
  if (fine > 0) {
    const N = 64;
    const noise = new Float32Array(N * N);
    for (let i = 0; i < noise.length; i++) noise[i] = 1 + (R() * 2 - 1) * fine;
    const fl = factorLayers(N, N, (x, y) => noise[y * N + x]);
    g.translate(x0, y0);
    fl.forEach((c, i) => { const pat = g.createPattern(c, 'repeat'); if (!pat) return; g.globalCompositeOperation = ops[i]; g.fillStyle = pat; g.fillRect(0, 0, w, h); });
  }
  g.restore();
}
/** darken toward the edges of a rect (worn / rounded look), inside a clip of that rect */
function edgeShade(g: G, x: number, y: number, w: number, h: number, depth: number, dark: number, light = 0) {
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  const lin = (x0: number, y0: number, x1: number, y1: number, c0: string, c1: string) => { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, c0); gr.addColorStop(1, c1); return gr; };
  const dk = `rgba(20,8,0,${dark})`, clr = 'rgba(20,8,0,0)';
  g.fillStyle = lin(x, y + h, x, y + h - depth, dk, clr); g.fillRect(x, y + h - depth, w, depth);
  g.fillStyle = lin(x + w, y, x + w - depth, y, dk, clr); g.fillRect(x + w - depth, y, depth, h);
  g.fillStyle = lin(x, y, x + depth, y, `rgba(20,8,0,${dark * 0.6})`, clr); g.fillRect(x, y, depth, h);
  if (light > 0) { g.fillStyle = lin(x, y, x, y + depth * 0.6, `rgba(255,240,215,${light})`, 'rgba(255,240,215,0)'); g.fillRect(x, y, w, depth * 0.6); }
  g.restore();
}

/** set the biggest font (≤ maxSize) so text fits maxW */
function fitFont(g: G, text: string, maxW: number, maxSize: number, weight: string, family: string) {
  let size = maxSize;
  for (; size > 8; size -= 2) { g.font = `${weight} ${size}px ${family}`; if (g.measureText(text).width <= maxW) break; }
  return size;
}
/** hand-drawn "title" squiggle */
function squiggle(g: G, x: number, y: number, len: number, amp: number, color: string, lw: number, R: () => number, vertical = false) {
  g.strokeStyle = color; g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath();
  const n = Math.max(4, Math.floor(len / (lw * 2.2)));
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = (i % 2 ? 1 : -1) * amp * (0.6 + R() * 0.4);
    const px = vertical ? x + a : x + t * len, py = vertical ? y + t * len : y + a;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.stroke();
}

// ───────────────────────── wood ─────────────────────────

export type WoodTone = 'warm' | 'dark' | 'light' | 'red' | 'honey';
const WOOD: Record<WoodTone, [string, string]> = {
  warm: ['#b47a46', '#6e4024'],
  dark: ['#7a4a2c', '#3e2212'],
  light: ['#d89a5e', '#9a6234'],
  red: ['#9a4a2a', '#5a2414'],
  honey: ['#c98a40', '#7a4a1c'],
};

/** wood pores: short dark dashes along U (wrap-safe) */
function pores(g: G, w: number, h: number, y0: number, y1: number, n: number, color: string, R: () => number) {
  for (let i = 0; i < n; i++) {
    const x = R() * w, y = y0 + R() * (y1 - y0), len = 3 + R() * 10, th = 0.8 + R() * 1.1;
    g.fillStyle = rgba(color, 0.18 + R() * 0.22);
    wrap9(w, h, x, y, len, (px, py) => { g.beginPath(); g.ellipse(px, py, len / 2, th / 2, 0, 0, TAU); g.fill(); });
  }
}

/** tile: `planks` floor/wall planks running along U, seams + nails + knots. */
export function woodPlanksTex(tone: WoodTone = 'warm', planks = 4) {
  return tex(`planks:${tone}:${planks}`, 512, 512, (g, w, h) => {
    const R = rng(11 + planks);
    const [base, dark] = WOOD[tone];
    const ph = h / planks;
    for (let i = 0; i < planks; i++) {
      const y0 = i * ph;
      g.fillStyle = shade(base, (R() - 0.5) * 0.2);
      g.fillRect(0, y0, w, ph);
      // slightly rounded plank: light catches the upper half, the lower edge falls into shade
      const gr = g.createLinearGradient(0, y0, 0, y0 + ph);
      gr.addColorStop(0, 'rgba(255,238,205,0.14)'); gr.addColorStop(0.35, 'rgba(255,238,205,0.04)');
      gr.addColorStop(0.7, 'rgba(30,12,0,0)'); gr.addColorStop(1, 'rgba(30,12,0,0.2)');
      g.fillStyle = gr; g.fillRect(0, y0, w, ph);
      for (let k = 0; k < 9; k++) wavyH(g, w, y0 + 8 + R() * (ph - 16), 1 + R() * 3, 1 + Math.floor(R() * 3), R() * TAU, rgba(dark, 0.16 + R() * 0.2), 1 + R() * 2.5);
      for (let k = 0; k < 4; k++) wavyH(g, w, y0 + 10 + R() * (ph - 20), 1 + R() * 2, 1 + Math.floor(R() * 2), R() * TAU, 'rgba(255,232,195,0.13)', 1 + R() * 1.5);
      pores(g, w, h, y0 + 6, y0 + ph - 6, 60, dark, R);
      if (R() < 0.7) {
        const kx = R() * w, ky = y0 + ph * (0.3 + R() * 0.4);
        wrap9(w, h, kx, ky, 30, (x, y) => {
          ellipse(g, x, y, 16, 7, 0, rgba(dark, 0.45));
          ellipse(g, x, y, 24, 11, 0, undefined, rgba(dark, 0.35), 2);
          ellipse(g, x, y, 7, 3, 0, rgba(dark, 0.8));
          ellipse(g, x - 3, y - 2, 4, 1.5, 0, 'rgba(255,230,190,0.25)');
        });
      }
      g.fillStyle = 'rgba(255,240,210,0.16)'; g.fillRect(0, y0 + 3, w, 5);
      g.fillStyle = 'rgba(30,10,0,0.22)'; g.fillRect(0, y0 + ph - 8, w, 8);
      line(g, -4, y0 + 1, w + 4, y0 + 1, OUT, 4);
      const jx = ((i * 0.43 + 0.13 + R() * 0.15) % 1) * w;
      // end grain darkens toward the butt joint
      for (const s of [-1, 1]) for (const ox of [-w, 0, w]) {
        const ex = jx + ox;
        if (Math.max(ex, ex + s * 22) < 0 || Math.min(ex, ex + s * 22) > w) continue;
        const eg = g.createLinearGradient(ex, 0, ex + s * 22, 0);
        eg.addColorStop(0, rgba(dark, 0.3)); eg.addColorStop(1, rgba(dark, 0));
        g.fillStyle = eg;
        g.fillRect(Math.min(ex, ex + s * 22), y0 + 3, 22, ph - 3);
      }
      line(g, jx, y0, jx, y0 + ph, OUT, 3.5);
      for (const sx of [-12, 12]) for (const sy of [0.28, 0.72]) {
        circle(g, jx + sx, y0 + ph * sy, 4.5, '#3a2618');
        circle(g, jx + sx - 1.2, y0 + ph * sy - 1.2, 1.6, 'rgba(255,230,190,0.6)');
      }
    }
    // tileable streaky value noise (along the grain) + a finer octave: no two board patches look stamped
    mottle(g, 0, 0, w, h, 101 + planks, 3, planks * 5, 0.1, 0.025);
    mottle(g, 0, 0, w, h, 202 + planks, 16, planks * 14, 0.05);
  }, true);
}

/** tile: continuous furniture wood grain running along U (no seams). */
export function woodGrainTex(tone: WoodTone = 'warm') {
  return tex(`grain:${tone}`, 512, 512, (g, w, h) => {
    const R = rng(77 + tone.length);
    const [base, dark] = WOOD[tone];
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 10; k++) { g.fillStyle = rgba(k % 2 ? dark : '#ffe0b0', 0.05 + R() * 0.05); g.fillRect(0, R() * h, w, 10 + R() * 40); }
    for (let k = 0; k < 34; k++) wavyH(g, w, R() * h, 2 + R() * 6, 1 + Math.floor(R() * 2), R() * TAU, rgba(dark, 0.12 + R() * 0.22), 1 + R() * 3);
    for (let k = 0; k < 10; k++) wavyH(g, w, R() * h, 2 + R() * 5, 1 + Math.floor(R() * 2), R() * TAU, 'rgba(255,230,190,0.12)', 1 + R() * 2);
    pores(g, w, h, 0, h, 220, dark, R);
    for (let k = 0; k < 2; k++) {
      const kx = R() * w, ky = R() * h;
      wrap9(w, h, kx, ky, 50, (x, y) => {
        for (let r = 5; r < 40; r += 7) ellipse(g, x, y, r * 2, r * 0.8, 0, undefined, rgba(dark, 0.3), 2);
        ellipse(g, x, y, 9, 4, 0, rgba(dark, 0.75));
      });
    }
    mottle(g, 0, 0, w, h, 303 + tone.length, 2, 14, 0.1, 0.025);
    mottle(g, 0, 0, w, h, 404 + tone.length, 10, 40, 0.05);
  }, true);
}

/** crate: one canvas with side face on top half (v 0.5..1) and lid face on bottom half (v 0..0.5). */
export function crateTex(label = '') {
  return tex(`crate:${label}`, 512, 1024, (g) => {
    const R = rng(hashStr(label) + 5);
    const plank = (x: number, y: number, w: number, h: number, horiz: boolean) => {
      g.fillStyle = shade(WOOD.light[0], (R() - 0.5) * 0.15); g.fillRect(x, y, w, h);
      for (let k = 0; k < 6; k++) {
        g.strokeStyle = rgba(WOOD.light[1], 0.25 + R() * 0.2); g.lineWidth = 1.5 + R() * 1.5;
        g.beginPath();
        if (horiz) { const yy = y + 6 + R() * (h - 12); g.moveTo(x, yy); g.bezierCurveTo(x + w * 0.3, yy + (R() - 0.5) * 8, x + w * 0.7, yy + (R() - 0.5) * 8, x + w, yy); }
        else { const xx = x + 6 + R() * (w - 12); g.moveTo(xx, y); g.bezierCurveTo(xx + (R() - 0.5) * 8, y + h * 0.3, xx + (R() - 0.5) * 8, y + h * 0.7, xx, y + h); }
        g.stroke();
      }
      g.strokeStyle = OUT; g.lineWidth = 4; g.strokeRect(x + 2, y + 2, w - 4, h - 4);
    };
    // side (top half of canvas)
    for (let i = 0; i < 4; i++) plank(0, i * 128, 512, 128, true);
    // diagonal brace
    g.save(); g.translate(256, 256); g.rotate(-Math.atan2(512, 512));
    g.fillStyle = shade(WOOD.warm[0], -0.05); g.fillRect(-380, -34, 760, 68);
    g.strokeStyle = OUT; g.lineWidth = 5; g.strokeRect(-380, -34, 760, 68);
    for (const x of [-250, 250]) { circle(g, x, -14, 6, '#3a2618'); circle(g, x, 14, 6, '#3a2618'); }
    g.restore();
    if (label) {
      g.save(); g.translate(256, 256); g.rotate((R() - 0.5) * 0.12);
      fitFont(g, label, 400, 120, '900', FONT_HEAD);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = 'rgba(40,20,10,0.78)'; g.fillText(label, 0, 6);
      g.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(0,0,0,${0.2 + R() * 0.4})`; g.fillRect((R() - 0.5) * 420, (R() - 0.5) * 120, 3 + R() * 10, 2 + R() * 4); }
      g.restore();
    }
    // lid (bottom half)
    for (let i = 0; i < 4; i++) plank(i * 128, 512, 128, 512, false);
    g.fillStyle = 'rgba(20,10,0,0.55)';
    for (let i = 1; i < 4; i++) g.fillRect(i * 128 - 5, 512, 10, 512);
    for (let k = 0; k < 18; k++) { // straw poking out of the gaps
      const x = Math.floor(1 + R() * 3) * 128, y = 530 + R() * 470;
      line(g, x, y, x + (R() - 0.5) * 60, y + (R() - 0.5) * 40, '#f0d070', 3);
    }
  });
}

// ───────────────────────── cloth / walls / floors ─────────────────────────

/** tile: red/white gingham tablecloth (2×2 checks per tile) with a visible thread weave. */
export function tableclothTex(c1: string = PAL.clothRed, c2: string = PAL.cloth) {
  return tex(`cloth:${c1}:${c2}`, 256, 256, (g, w, h) => {
    const R = rng(3);
    g.fillStyle = c2; g.fillRect(0, 0, w, h);
    g.fillStyle = rgba(c1, 0.55); g.fillRect(0, 0, w / 2, h); g.fillRect(0, 0, w, h / 2);
    g.fillStyle = rgba(c1, 0.35); g.fillRect(0, 0, w / 2, h / 2);
    // dyed threads inside the coloured bands (real gingham shows them as fine stripes)
    const deep = shade(c1, -0.25);
    for (let i = 3; i < w / 2; i += 6) { g.fillStyle = rgba(deep, 0.09); g.fillRect(i, 0, 2, h); g.fillRect(0, i, w, 2); }
    // over/under weave: alternating light & dark 1-px threads both ways
    for (let i = 0; i < w; i += 3) {
      const a = 0.02 + R() * 0.025;
      g.fillStyle = `rgba(0,0,0,${a})`; g.fillRect(i, 0, 1, h); g.fillRect(0, i, w, 1);
      g.fillStyle = `rgba(255,255,255,${a * 1.3})`; g.fillRect(i + 1, 0, 1, h); g.fillRect(0, i + 1, w, 1);
    }
    // tiny weave "knots" where threads cross
    for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},${0.035 + R() * 0.045})`; g.fillRect(Math.floor(R() * w / 3) * 3, Math.floor(R() * h / 3) * 3, 2, 2); }
    g.strokeStyle = rgba(shade(c1, -0.4), 0.25); g.lineWidth = 2;
    g.strokeRect(1, 1, w / 2 - 2, h - 2);
    // soft cloth irregularity (tileable)
    mottle(g, 0, 0, w, h, 17, 4, 4, 0.05, 0.035);
  }, true);
}

/** tile: chunky stone bricks (4 rows × 2 bricks, staggered), bevelled, chipped and grainy. */
export function stoneBricksTex(color: string = PAL.stone) {
  return tex(`stone:${color}`, 512, 512, (g, w, h) => {
    const R = rng(hashStr(color));
    g.fillStyle = shade(color, -0.5); g.fillRect(0, 0, w, h);
    speckle(g, w, h, 500, '#000000', 0.12, 0.8, 2.2, R); // gritty mortar
    const rows = 4, bh = h / rows, bw = w / 2;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * bw / 2;
      for (let k = 0; k < 2; k++) {
        const col = shade(color, (R() - 0.5) * 0.22);
        const seed = r * 10 + k + 1;
        for (const ox of [0, -w]) {
          const x = k * bw + off + ox, y = r * bh;
          if (x + bw < 0 || x > w) continue;
          const B = rng(seed);
          rrPath(g, x + 6, y + 6, bw - 12, bh - 12, 14); g.fillStyle = col; g.fill();
          g.save(); g.clip();
          // bevel: light from the top-left, shade toward the bottom-right
          const bev = g.createLinearGradient(x, y, x + bw * 0.35, y + bh);
          bev.addColorStop(0, 'rgba(255,255,255,0.16)'); bev.addColorStop(0.45, 'rgba(255,255,255,0)'); bev.addColorStop(1, 'rgba(0,0,0,0.22)');
          g.fillStyle = bev; g.fillRect(x, y, bw, bh);
          g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x, y, bw, 16);
          g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(x, y + bh - 22, bw, 22);
          for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(${B() < 0.5 ? '0,0,0' : '255,255,255'},${0.06 + B() * 0.08})`; g.beginPath(); g.arc(x + B() * bw, y + B() * bh, 1 + B() * 4, 0, TAU); g.fill(); }
          // a few shallow pits with a lit lower lip
          for (let i = 0; i < 5; i++) {
            const px = x + 20 + B() * (bw - 40), py = y + 18 + B() * (bh - 36), pr = 2 + B() * 4;
            ellipse(g, px, py, pr * 1.4, pr, 0, 'rgba(0,0,0,0.22)');
            ellipse(g, px + 1, py + pr * 0.7, pr * 1.1, pr * 0.35, 0, 'rgba(255,255,255,0.12)');
          }
          if (B() < 0.35) { // crack
            g.strokeStyle = rgba(OUT, 0.55); g.lineWidth = 2.5; g.beginPath();
            let px = x + 20 + B() * (bw - 40), py = y + 10;
            g.moveTo(px, py);
            for (let q = 0; q < 4; q++) { px += (B() - 0.5) * 30; py += 10 + B() * 14; g.lineTo(px, py); }
            g.stroke();
          }
          g.restore();
          // chipped corner
          if (B() < 0.5) {
            const cxr = B() < 0.5 ? x + 8 : x + bw - 8, cyr = B() < 0.5 ? y + 8 : y + bh - 8;
            g.beginPath(); g.moveTo(cxr, cyr);
            g.lineTo(cxr + (cxr < x + bw / 2 ? 18 : -18), cyr); g.lineTo(cxr, cyr + (cyr < y + bh / 2 ? 14 : -14)); g.closePath();
            g.fillStyle = shade(color, -0.5); g.fill();
          }
          rrPath(g, x + 6, y + 6, bw - 12, bh - 12, 14); g.strokeStyle = rgba(OUT, 0.8); g.lineWidth = 4; g.stroke();
        }
      }
    }
    mottle(g, 0, 0, w, h, hashStr(color) + 7, 6, 6, 0.08, 0.04);
    mottle(g, 0, 0, w, h, hashStr(color) + 9, 24, 24, 0.04);
  }, true);
}

/** tile: carved stone drums with vertical flutes (pillars). U = around, V = up. */
export function fluteTex(color: string = PAL.stone) {
  return tex(`flute:${color}`, 512, 256, (g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    const n = 16, fw = w / n;
    for (let i = 0; i < n; i++) {
      const gr = g.createLinearGradient(i * fw, 0, (i + 1) * fw, 0);
      gr.addColorStop(0, shade(color, -0.35)); gr.addColorStop(0.35, shade(color, 0.12)); gr.addColorStop(0.7, color); gr.addColorStop(1, shade(color, -0.35));
      g.fillStyle = gr; g.fillRect(i * fw + 3, 0, fw - 6, h);
    }
    line(g, 0, 2, w, 2, rgba(OUT, 0.8), 4);
    const R = rng(9);
    speckle(g, w, h, 120, '#000000', 0.08, 1, 3, R);
  }, true);
}

export type DamaskTheme = 'pantry' | 'feast' | 'library';
const DAMASK: Record<DamaskTheme, [string, string, string]> = {
  pantry: ['#c7874a', '#d9a060', '#a8642e'],
  feast: ['#8e1f2e', '#b0303e', '#f2c23a'],
  library: ['#225f5c', '#2f7d76', '#7fc4b4'],
};
function damaskMotif(g: G, cx: number, cy: number, s: number, fill: string, accent: string) {
  g.save(); g.translate(cx, cy); g.scale(s, s);
  const half = (sgn: number) => {
    g.beginPath();
    g.moveTo(0, -1.05);
    g.bezierCurveTo(sgn * 0.22, -0.78, sgn * 0.48, -0.5, sgn * 0.2, -0.12);
    g.bezierCurveTo(sgn * 0.62, -0.05, sgn * 0.62, 0.48, sgn * 0.08, 0.8);
    g.lineTo(0, 1.02); g.lineTo(0, -1.05); g.closePath();
    g.fillStyle = fill; g.fill();
    // scroll curl
    g.beginPath(); g.arc(sgn * 0.62, -0.42, 0.2, 0, TAU); g.lineWidth = 0.09; g.strokeStyle = fill; g.stroke();
    g.beginPath(); g.arc(sgn * 0.62, -0.42, 0.07, 0, TAU); g.fillStyle = fill; g.fill();
    // leaf
    g.beginPath(); g.ellipse(sgn * 0.58, 0.42, 0.24, 0.1, sgn * 0.7, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(sgn * 0.3, 0.92, 0.18, 0.07, -sgn * 0.5, 0, TAU); g.fill();
  };
  half(1); half(-1);
  g.beginPath(); g.moveTo(0, -0.55); g.lineTo(0.12, -0.3); g.lineTo(0, -0.05); g.lineTo(-0.12, -0.3); g.closePath(); g.fillStyle = accent; g.fill();
  g.beginPath(); g.arc(0, 0.32, 0.1, 0, TAU); g.fill();
  g.restore();
}
/** tile: damask wallpaper (pantry warm, feast red+gold, library teal). */
export function damaskTex(theme: DamaskTheme) {
  return tex(`damask:${theme}`, 512, 512, (g, w, h) => {
    const [base, motif, accent] = DAMASK[theme];
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 64) { g.fillStyle = 'rgba(255,255,255,0.035)'; g.fillRect(x, 0, 32, h); }
    for (const [x, y] of [[128, 128], [384, 384]] as const) {
      wrap9(w, h, x, y, 130, (px, py) => damaskMotif(g, px, py, 105, motif, accent));
    }
    for (const [x, y] of [[384, 128], [128, 384]] as const) {
      wrap9(w, h, x, y, 30, (px, py) => {
        g.save(); g.translate(px, py); g.rotate(Math.PI / 4); g.fillStyle = rgba(accent, 0.8); g.fillRect(-9, -9, 18, 18); g.restore();
        circle(g, px, py - 30, 4, rgba(motif, 0.9)); circle(g, px, py + 30, 4, rgba(motif, 0.9));
      });
    }
    const R = rng(4);
    speckle(g, w, h, 300, '#000000', 0.04, 1, 3, R);
    mottle(g, 0, 0, w, h, 41, 5, 5, 0.06, 0.025); // printed-paper unevenness
  }, true);
}

/** tile: painted bookshelves (library walls): 2 shelf rows per tile. */
export function libraryWallTex() {
  return tex('libwall', 512, 512, (g, w, h) => {
    const R = rng(21);
    g.fillStyle = '#3e2416'; g.fillRect(0, 0, w, h);
    for (let row = 0; row < 2; row++) {
      const y0 = row * 256, base = y0 + 226;
      g.fillStyle = '#2a170c'; g.fillRect(0, y0, w, 226);
      let x = 6 + R() * 10;
      while (x < w - 30) {
        if (R() < 0.12) { x += 18 + R() * 30; continue; }
        const bw = 18 + R() * 24, bh = 110 + R() * 95;
        const col = shade(BOOK_COLORS[Math.floor(R() * BOOK_COLORS.length)], -0.18 + (R() - 0.5) * 0.15);
        const lean = R() < 0.08 && x + bw + 30 < w;
        g.save();
        if (lean) { g.translate(x, base); g.rotate(0.22); g.translate(-x, -base); }
        g.fillStyle = col; g.fillRect(x, base - bh, bw, bh);
        g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x + 3, base - bh, 4, bh);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + bw - 5, base - bh, 5, bh);
        g.fillStyle = 'rgba(242,194,58,0.85)';
        g.fillRect(x + 2, base - bh + 12, bw - 4, 4); g.fillRect(x + 2, base - 22, bw - 4, 4);
        if (R() < 0.6) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + 4, base - bh * 0.62, bw - 8, bh * 0.22); }
        g.strokeStyle = rgba(OUT, 0.9); g.lineWidth = 3; g.strokeRect(x, base - bh, bw, bh);
        g.restore();
        x += bw + (lean ? 26 : 1 + R() * 3);
      }
      // soft shadow under the plank above + darker back corners: the painted shelf gets depth
      const top = g.createLinearGradient(0, y0, 0, y0 + 46);
      top.addColorStop(0, 'rgba(10,4,0,0.5)'); top.addColorStop(1, 'rgba(10,4,0,0)');
      g.fillStyle = top; g.fillRect(0, y0, w, 46);
      const bot = g.createLinearGradient(0, base - 18, 0, base);
      bot.addColorStop(0, 'rgba(10,4,0,0)'); bot.addColorStop(1, 'rgba(10,4,0,0.28)');
      g.fillStyle = bot; g.fillRect(0, base - 18, w, 18);
      // shelf plank
      g.fillStyle = '#8a5530'; g.fillRect(0, base, w, 30);
      for (let k = 0; k < 4; k++) wavyH(g, w, base + 6 + R() * 18, 1 + R(), 1 + Math.floor(R() * 2), R() * TAU, 'rgba(60,30,10,0.25)', 1 + R());
      g.fillStyle = 'rgba(255,230,180,0.25)'; g.fillRect(0, base + 2, w, 5);
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, base + 24, w, 6);
      line(g, -2, base, w + 2, base, OUT, 4); line(g, -2, base + 30, w + 2, base + 30, OUT, 3);
    }
    mottle(g, 0, 0, w, h, 23, 8, 8, 0.07, 0.03);
  }, true);
}

/** tile: earthen wall with strata, pebbles and roots (den). */
export function earthTex() {
  return tex('earth', 512, 512, (g, w, h) => {
    const R = rng(31);
    g.fillStyle = '#6b4a32'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 7; k++) { g.fillStyle = rgba(k % 2 ? '#4e3220' : '#8a6444', 0.35); const y = R() * h; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x / w * TAU * 2 + k) * 10); g.lineTo(w, y + 40); g.lineTo(0, y + 40); g.fill(); }
    speckle(g, w, h, 400, '#2a1a10', 0.18, 1, 3, R);
    for (let i = 0; i < 26; i++) {
      const x = R() * w, y = R() * h, r = 5 + R() * 12;
      wrap9(w, h, x, y, r + 4, (px, py) => ellipse(g, px, py, r, r * 0.7, R() * 3, shade('#9a8a7a', (R() - 0.5) * 0.3), rgba(OUT, 0.7), 2.5));
    }
    for (let k = 0; k < 4; k++) {
      let x = R() * w, y = -20;
      const pts: [number, number][] = [[x, y]];
      while (y < h + 20) { x += (R() - 0.5) * 50; y += 30 + R() * 30; pts.push([x, y]); }
      for (const ox of [-w, 0, w]) {
        for (const [col, lw] of [[OUT, 12], ['#a8743e', 7], ['#c99058', 2]] as const) {
          g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round';
          g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(px + ox, py) : g.moveTo(px + ox, py))); g.stroke();
        }
      }
    }
  }, true);
}

/** tile: packed dirt floor with pebbles & straw (den). */
export function dirtTex() {
  return tex('dirt', 512, 512, (g, w, h) => {
    const R = rng(41);
    g.fillStyle = '#7a5638'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) ellipse(g, R() * w, R() * h, 20 + R() * 50, 10 + R() * 30, R() * 3, rgba(R() < 0.5 ? '#5e3e26' : '#946a48', 0.35));
    speckle(g, w, h, 600, '#2a1a10', 0.15, 1, 2.5, R);
    for (let i = 0; i < 30; i++) { const x = R() * w, y = R() * h, r = 4 + R() * 8; wrap9(w, h, x, y, r, (px, py) => ellipse(g, px, py, r, r * 0.7, R() * 3, '#9a8a78', rgba(OUT, 0.6), 2)); }
    for (let i = 0; i < 40; i++) { const x = R() * w, y = R() * h, a = R() * TAU, l = 10 + R() * 20; line(g, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, '#e0c060', 2.5); }
  }, true);
}

/** red carpet runner: U across the width (gold border on both sides), V repeats along the length. */
export function carpetTex() {
  return tex('carpet', 256, 512, (g, w, h) => {
    g.fillStyle = PAL.carpet; g.fillRect(0, 0, w, h);
    const R = rng(51);
    speckle(g, w, h, 900, '#000000', 0.06, 0.8, 2, R);
    for (const x of [0, w - 30]) {
      g.fillStyle = PAL.gold; g.fillRect(x, 0, 30, h);
      g.fillStyle = '#c8901a'; g.fillRect(x + 12, 0, 6, h);
      for (let y = 8; y < h; y += 32) circle(g, x + 15, y, 4, '#8a1f2a');
    }
    line(g, 32, 0, 32, h, '#7a1420', 4); line(g, w - 32, 0, w - 32, h, '#7a1420', 4);
    mottle(g, 0, 0, w, h, 52, 4, 8, 0.07, 0.05); // pile
    for (const cy of [128, 384]) {
      g.save(); g.translate(w / 2, cy);
      g.beginPath(); g.moveTo(0, -90); g.lineTo(62, 0); g.lineTo(0, 90); g.lineTo(-62, 0); g.closePath();
      g.fillStyle = '#8a1f2a'; g.fill(); g.strokeStyle = PAL.gold; g.lineWidth = 6; g.stroke();
      g.beginPath(); g.moveTo(0, -46); g.lineTo(30, 0); g.lineTo(0, 46); g.lineTo(-30, 0); g.closePath(); g.fillStyle = PAL.gold; g.fill();
      circle(g, 0, 0, 10, '#8a1f2a');
      g.restore();
      for (const dy of [-128, 128]) circle(g, w / 2, cy + dy, 7, PAL.gold);
    }
  }, true);
}

/** rug (non-tiling): border bands, medallion, corner motifs. */
export function rugTex(color = '#b8323a') {
  return tex(`rug:${color}`, 512, 512, (g, w, h) => {
    const R = rng(hashStr(color));
    const dark = shade(color, -0.4), light = shade(color, 0.35);
    g.fillStyle = dark; g.fillRect(0, 0, w, h);
    g.fillStyle = PAL.gold; g.fillRect(18, 18, w - 36, h - 36);
    g.fillStyle = color; g.fillRect(34, 34, w - 68, h - 68);
    for (let x = 50; x < w - 40; x += 28) { circle(g, x, 26, 5, dark); circle(g, x, h - 26, 5, dark); }
    for (let y = 50; y < h - 40; y += 28) { circle(g, 26, y, 5, dark); circle(g, w - 26, y, 5, dark); }
    g.strokeStyle = light; g.lineWidth = 5; g.strokeRect(60, 60, w - 120, h - 120);
    g.save(); g.translate(w / 2, h / 2);
    g.beginPath(); g.moveTo(0, -150); g.lineTo(150, 0); g.lineTo(0, 150); g.lineTo(-150, 0); g.closePath();
    g.fillStyle = dark; g.fill(); g.strokeStyle = PAL.gold; g.lineWidth = 8; g.stroke();
    circle(g, 0, 0, 70, light, PAL.gold, 6);
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; ellipse(g, Math.cos(a) * 42, Math.sin(a) * 42, 16, 7, a, color); }
    circle(g, 0, 0, 16, PAL.gold);
    g.restore();
    for (const [cx, cy] of [[60, 60], [w - 60, 60], [60, h - 60], [w - 60, h - 60]] as const) {
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + (cx < w / 2 ? 60 : -60), cy); g.lineTo(cx, cy + (cy < h / 2 ? 60 : -60)); g.closePath(); g.fillStyle = dark; g.fill();
    }
    speckle(g, w, h, 1500, '#000000', 0.05, 0.6, 1.8, R);
    mottle(g, 0, 0, w, h, hashStr(color) + 3, 6, 6, 0.07, 0.05); // pile
    edgeShade(g, 0, 0, w, h, 26, 0.18);
  });
}

// ───────────────────────── books ─────────────────────────

function drawCover(g: G, x: number, y: number, w: number, h: number, color: string, seed: number) {
  const R = rng(seed);
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = color; g.fillRect(x, y, w, h);
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},0.05)`; g.fillRect(x + R() * w, y + R() * h, 2 + R() * 5, 1.5); }
  const gr = g.createRadialGradient(x + w / 2, y + h / 2, Math.min(w, h) * 0.2, x + w / 2, y + h / 2, Math.max(w, h) * 0.75);
  gr.addColorStop(0, 'rgba(255,255,255,0.08)'); gr.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  const m = Math.min(w, h) * 0.09, gold = PAL.gold;
  // tooled-in frame: dark groove offset under the gold lines reads as embossing
  const sh = m * 0.09;
  rrPath(g, x + m + sh, y + m + sh, w - 2 * m, h - 2 * m, m * 0.6); g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = m * 0.36; g.stroke();
  rrPath(g, x + m, y + m, w - 2 * m, h - 2 * m, m * 0.6); g.strokeStyle = gold; g.lineWidth = m * 0.32; g.stroke();
  rrPath(g, x + m - sh * 0.6, y + m - sh * 0.6, w - 2 * m, h - 2 * m, m * 0.6); g.strokeStyle = 'rgba(255,248,200,0.45)'; g.lineWidth = m * 0.07; g.stroke();
  g.strokeStyle = gold;
  rrPath(g, x + m * 1.6, y + m * 1.6, w - 3.2 * m, h - 3.2 * m, m * 0.4); g.lineWidth = m * 0.1; g.stroke();
  for (const [cx, cy, sx, sy] of [[x + m, y + m, 1, 1], [x + w - m, y + m, -1, 1], [x + m, y + h - m, 1, -1], [x + w - m, y + h - m, -1, -1]] as const) {
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + sx * m * 2.2, cy); g.quadraticCurveTo(cx + sx * m * 0.8, cy + sy * m * 0.8, cx, cy + sy * m * 2.2); g.closePath(); g.fillStyle = gold; g.fill();
  }
  const cx = x + w / 2, cy = y + h / 2, s = Math.min(w, h);
  const kind = seed % 4;
  if (kind === 0) {
    circle(g, cx, cy, s * 0.2, shade(color, -0.3), gold, s * 0.025);
    g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i / 10 * TAU, r = i % 2 ? s * 0.06 : s * 0.15; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    g.closePath(); g.fillStyle = gold; g.fill();
  } else if (kind === 1) {
    rrPath(g, cx - s * 0.28, cy - s * 0.2, s * 0.56, s * 0.4, s * 0.04); g.fillStyle = shade(color, -0.35); g.fill(); g.strokeStyle = gold; g.lineWidth = s * 0.02; g.stroke();
    for (let i = 0; i < 3; i++) squiggle(g, cx - s * 0.2, cy - s * 0.09 + i * s * 0.09, s * (0.4 - i * 0.08), s * 0.018, gold, s * 0.018, R);
  } else if (kind === 2) { // crown
    g.beginPath(); const cw = s * 0.4, ch = s * 0.24;
    g.moveTo(cx - cw / 2, cy + ch / 2); g.lineTo(cx - cw / 2, cy - ch / 2); g.lineTo(cx - cw / 4, cy); g.lineTo(cx, cy - ch * 0.7); g.lineTo(cx + cw / 4, cy); g.lineTo(cx + cw / 2, cy - ch / 2); g.lineTo(cx + cw / 2, cy + ch / 2); g.closePath();
    g.fillStyle = gold; g.fill();
    for (const dx of [-cw / 2, 0, cw / 2]) circle(g, cx + dx, cy - (dx === 0 ? ch * 0.7 : ch / 2), s * 0.025, gold);
    squiggle(g, cx - s * 0.22, cy + s * 0.25, s * 0.44, s * 0.018, gold, s * 0.018, R);
  } else {
    g.save(); g.translate(cx, cy); g.rotate(Math.PI / 4);
    g.fillStyle = shade(color, -0.3); g.fillRect(-s * 0.15, -s * 0.15, s * 0.3, s * 0.3);
    g.strokeStyle = gold; g.lineWidth = s * 0.025; g.strokeRect(-s * 0.15, -s * 0.15, s * 0.3, s * 0.3);
    g.restore();
    circle(g, cx, cy, s * 0.05, gold);
  }
  // worn edges: scuffed lighter rim + darker corners
  g.strokeStyle = 'rgba(255,240,220,0.13)'; g.lineWidth = m * 0.5; g.strokeRect(x + m * 0.25, y + m * 0.25, w - m * 0.5, h - m * 0.5);
  for (let i = 0; i < 40; i++) {
    const t = R(), side = Math.floor(R() * 4), len = 3 + R() * 10;
    const px = side < 2 ? x + t * w : (side === 2 ? x + 2 + R() * 4 : x + w - 6 + R() * 4);
    const py = side >= 2 ? y + t * h : (side === 0 ? y + 2 + R() * 4 : y + h - 6 + R() * 4);
    g.fillStyle = `rgba(255,235,210,${0.1 + R() * 0.12})`; g.fillRect(px, py, side < 2 ? len : 2, side < 2 ? 2 : len);
  }
  g.restore();
  edgeShade(g, x, y, w, h, m * 0.9, 0.22);
  mottle(g, Math.round(x), Math.round(y), Math.round(w), Math.round(h), seed * 13 + 5, 7, 8, 0.08, 0.04);
}
function drawSpine(g: G, x: number, y: number, w: number, h: number, color: string, variant: number, seed: number) {
  const R = rng(seed);
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  const gr = g.createLinearGradient(x, 0, x + w, 0);
  gr.addColorStop(0, shade(color, -0.35)); gr.addColorStop(0.3, shade(color, 0.12)); gr.addColorStop(0.55, color); gr.addColorStop(1, shade(color, -0.4));
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},0.05)`; g.fillRect(x + R() * w, y + R() * h, 1.5, 3 + R() * 6); }
  const gold = PAL.gold;
  const band = (yy: number, double: boolean) => {
    g.fillStyle = gold; g.fillRect(x, yy, w, h * 0.012);
    if (double) g.fillRect(x, yy + h * 0.022, w, h * 0.006);
  };
  if (variant === 0) {
    band(y + h * 0.05, true); band(y + h * 0.92, true);
    const lx = x + w * 0.16, ly = y + h * 0.24, lw = w * 0.68, lh = h * 0.42;
    rrPath(g, lx, ly, lw, lh, w * 0.12); g.fillStyle = shade(color, -0.45); g.fill(); g.strokeStyle = gold; g.lineWidth = w * 0.05; g.stroke();
    squiggle(g, x + w * 0.5, ly + lh * 0.1, lh * 0.8, w * 0.1, gold, w * 0.08, R, true);
    circle(g, x + w / 2, y + h * 0.78, w * 0.13, gold);
  } else {
    for (const t of [0.14, 0.3, 0.7, 0.86]) {
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x, y + h * t, w, h * 0.025);
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x, y + h * t - h * 0.008, w, h * 0.008);
    }
    const ly = y + h * 0.36, lh = h * 0.26;
    g.fillStyle = gold; g.fillRect(x + w * 0.12, ly, w * 0.76, lh);
    g.fillStyle = shade(color, -0.5); g.fillRect(x + w * 0.18, ly + lh * 0.05, w * 0.64, lh * 0.9);
    squiggle(g, x + w * 0.5, ly + lh * 0.12, lh * 0.76, w * 0.08, gold, w * 0.07, R, true);
    band(y + h * 0.03, false); band(y + h * 0.955, false);
  }
  // scuffed head & tail of the spine
  for (const yy of [y, y + h - h * 0.025]) {
    for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(255,235,210,${0.08 + R() * 0.1})`; g.fillRect(x + R() * w * 0.8, yy + R() * h * 0.02, 3 + R() * w * 0.3, 2); }
  }
  g.restore();
  mottle(g, Math.round(x), Math.round(y), Math.round(w), Math.round(h), seed * 7 + 3, 2, 12, 0.07, 0.035);
}
function drawPages(g: G, x: number, y: number, w: number, h: number) {
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = '#f6ead0'; g.fillRect(x, y, w, h);
  const R = rng(61);
  for (let yy = y + 3; yy < y + h; yy += 5 + R() * 3) { g.fillStyle = `rgba(150,110,60,${0.18 + R() * 0.2})`; g.fillRect(x, yy, w, 1.5); }
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, 'rgba(120,80,30,0.25)'); gr.addColorStop(0.15, 'rgba(0,0,0,0)'); gr.addColorStop(0.85, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(120,80,30,0.25)');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  g.restore();
}

/** standalone book cover texture (gold frame + emblem) */
export function bookCoverTex(color: string, seed = 0) { return tex(`cover:${color}:${seed}`, 256, 320, (g, w, h) => drawCover(g, 0, 0, w, h, color, seed)); }
/** standalone book spine texture (gold bands + title squiggles); U across the spine, V along it */
export function bookSpineTex(color: string, variant = 0) { return tex(`spine:${color}:${variant}`, 64, 320, (g, w, h) => drawSpine(g, 0, 0, w, h, color, variant, hashStr(color) + variant)); }
/** standalone page-edges texture: lines run along U */
export function pageEdgesTex() { return tex('pages', 256, 64, (g, w, h) => drawPages(g, 0, 0, w, h), true); }

export interface BookAtlas {
  tex: THREE.Texture;
  colors: string[];
  /** index of a color in this atlas (exact match, case-insensitive), -1 if missing */
  index(color: string): number;
  spine(ci: number, variant: number): UVRect;
  cover(ci: number): UVRect;
  plain(ci: number): UVRect;
  pages: UVRect;
}
const atlases = new Map<string, BookAtlas>();
/** One texture holding spines/covers/plain patches for many colors + page edges (so all books batch into one draw call). */
export function bookAtlas(colors: string[] = BOOK_COLORS): BookAtlas {
  const key = colors.join(',');
  const have = atlases.get(key);
  if (have) return have;
  const n = colors.length;
  const SW = 96, SH = 576, CW = 384, CH = 480, PH = 160, PL = 64;
  const W = n > 1 ? 2048 : 512;
  const perRow = Math.floor(W / CW);
  const coverRows = Math.ceil(n / perRow);
  const spinesPerRow = Math.floor(W / SW);
  const spineRows = Math.ceil((2 * n) / spinesPerRow);
  const pagesY = spineRows * SH + coverRows * CH;
  const plainPerRow = Math.floor((W - 512) / PL);
  const H = pagesY + Math.max(PH, Math.ceil(n / Math.max(1, plainPerRow)) * PL);
  const pad = 3;
  const rect = (x: number, y: number, w: number, h: number): UVRect => ({ u0: (x + pad) / W, u1: (x + w - pad) / W, v0: 1 - (y + h - pad) / H, v1: 1 - (y + pad) / H });
  const spinePos = (ci: number, v: number) => { const k = ci * 2 + v; return [(k % spinesPerRow) * SW, Math.floor(k / spinesPerRow) * SH] as const; };
  const coverPos = (ci: number) => [(ci % perRow) * CW, spineRows * SH + Math.floor(ci / perRow) * CH] as const;
  const plainPos = (ci: number) => [512 + (ci % plainPerRow) * PL, pagesY + Math.floor(ci / plainPerRow) * PL] as const;
  const t = canvasTex(W, H, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    colors.forEach((c, ci) => {
      for (let v = 0; v < 2; v++) { const [x, y] = spinePos(ci, v); drawSpine(g, x, y, SW, SH, c, v, hashStr(c) + v * 7); }
      const [cx, cy] = coverPos(ci); drawCover(g, cx, cy, CW, CH, c, ci + hashStr(c));
      const [px, py] = plainPos(ci); g.fillStyle = shade(c, -0.08); g.fillRect(px, py, PL, PL);
    });
    drawPages(g, 0, pagesY, 512, PH);
  });
  t.name = `bookAtlas:${key}`;
  const lower = colors.map((c) => c.toLowerCase());
  const atlas: BookAtlas = {
    tex: t, colors,
    index: (c) => lower.indexOf(c.toLowerCase()),
    spine: (ci, v) => { const [x, y] = spinePos(ci, v); return rect(x, y, SW, SH); },
    cover: (ci) => { const [x, y] = coverPos(ci); return rect(x, y, CW, CH); },
    plain: (ci) => { const [x, y] = plainPos(ci); return rect(x + 8, y + 8, PL - 16, PL - 16); },
    pages: rect(0, pagesY, 512, PH),
  };
  atlases.set(key, atlas);
  return atlas;
}

// ───────────────────────── labels ─────────────────────────

export type Fruit = 'strawberry' | 'orange' | 'pear' | 'honey' | 'cherry';
function drawFruit(g: G, kind: Fruit, cx: number, cy: number, s: number) {
  g.lineJoin = 'round';
  if (kind === 'strawberry') {
    g.beginPath(); g.moveTo(cx, cy + s); g.bezierCurveTo(cx - s * 1.1, cy + s * 0.2, cx - s * 0.9, cy - s * 0.75, cx, cy - s * 0.55); g.bezierCurveTo(cx + s * 0.9, cy - s * 0.75, cx + s * 1.1, cy + s * 0.2, cx, cy + s); g.closePath();
    g.fillStyle = '#e8283a'; g.fill(); g.strokeStyle = OUT; g.lineWidth = s * 0.08; g.stroke();
    for (let i = 0; i < 9; i++) ellipse(g, cx + Math.sin(i * 2.4) * s * 0.45, cy + (i / 9) * s * 0.9 - s * 0.25, s * 0.05, s * 0.08, 0, '#ffe680');
    for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i - 2) * 0.55; ellipse(g, cx + Math.cos(a) * s * 0.3, cy - s * 0.6 + Math.sin(a) * s * 0.12, s * 0.25, s * 0.09, a, '#4aa83a', OUT, s * 0.05); }
  } else if (kind === 'orange') {
    circle(g, cx, cy + s * 0.1, s * 0.85, '#ff9a1e', OUT, s * 0.08);
    circle(g, cx - s * 0.3, cy - s * 0.2, s * 0.18, 'rgba(255,255,255,0.45)');
    ellipse(g, cx + s * 0.3, cy - s * 0.8, s * 0.35, s * 0.15, -0.5, '#4aa83a', OUT, s * 0.05);
  } else if (kind === 'pear') {
    g.beginPath(); g.moveTo(cx, cy - s * 0.85); g.bezierCurveTo(cx + s * 0.45, cy - s * 0.85, cx + s * 0.3, cy - s * 0.1, cx + s * 0.75, cy + s * 0.45); g.bezierCurveTo(cx + s, cy + s * 1.05, cx - s, cy + s * 1.05, cx - s * 0.75, cy + s * 0.45); g.bezierCurveTo(cx - s * 0.3, cy - s * 0.1, cx - s * 0.45, cy - s * 0.85, cx, cy - s * 0.85);
    g.fillStyle = '#9ccc3a'; g.fill(); g.strokeStyle = OUT; g.lineWidth = s * 0.08; g.stroke();
    line(g, cx, cy - s * 0.85, cx + s * 0.1, cy - s * 1.1, OUT, s * 0.08);
  } else if (kind === 'cherry') {
    for (const dx of [-0.42, 0.42]) { line(g, cx + dx * s, cy + s * 0.2, cx + s * 0.1, cy - s * 0.85, '#4a7a2a', s * 0.07); circle(g, cx + dx * s, cy + s * 0.45, s * 0.42, '#d01e3a', OUT, s * 0.07); circle(g, cx + dx * s - s * 0.12, cy + s * 0.32, s * 0.1, 'rgba(255,255,255,0.6)'); }
  } else {
    // honey pot with a drip and a bee
    rrPath(g, cx - s * 0.75, cy - s * 0.35, s * 1.5, s * 1.25, s * 0.45); g.fillStyle = '#e0a020'; g.fill(); g.strokeStyle = OUT; g.lineWidth = s * 0.08; g.stroke();
    g.fillStyle = '#f6efe0'; g.fillRect(cx - s * 0.85, cy - s * 0.6, s * 1.7, s * 0.32); g.strokeRect(cx - s * 0.85, cy - s * 0.6, s * 1.7, s * 0.32);
    ellipse(g, cx + s * 0.75, cy - s * 0.95, s * 0.26, s * 0.18, 0, '#ffd23a', OUT, s * 0.05);
    line(g, cx + s * 0.68, cy - s * 1.1, cx + s * 0.68, cy - s * 0.8, OUT, s * 0.06);
    ellipse(g, cx + s * 0.7, cy - s * 1.2, s * 0.15, s * 0.08, -0.4, 'rgba(255,255,255,0.8)');
  }
}
/** jar label: pinked paper, frame, fruit pictogram and text. */
export function jarLabelTex(text: string, fruit: Fruit = 'strawberry', ink = '#c8203a') {
  return tex(`jarlabel:${text}:${fruit}:${ink}`, 512, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.beginPath();
    const zig = 12;
    g.moveTo(0, zig);
    for (let x = 0; x <= w; x += zig * 2) { g.lineTo(x + zig, 0); g.lineTo(Math.min(w, x + zig * 2), zig); }
    g.lineTo(w, h - zig);
    for (let x = w; x >= 0; x -= zig * 2) { g.lineTo(x - zig, h); g.lineTo(Math.max(0, x - zig * 2), h - zig); }
    g.closePath(); g.fillStyle = '#fbf3dc'; g.fill();
    g.strokeStyle = ink; g.lineWidth = 7; g.strokeRect(26, 30, w - 52, h - 60);
    g.lineWidth = 2.5; g.strokeRect(38, 42, w - 76, h - 84);
    drawFruit(g, fruit, 120, h / 2 + 6, 62);
    g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
    fitFont(g, text, 270, 74, '900', FONT_HEAD);
    g.fillText(text, 330, h / 2 + 4);
    const R = rng(hashStr(text));
    speckle(g, w, h, 160, '#7a5a30', 0.08, 1, 3, R);
  });
}

export type CanKind = 'fish' | 'tomato' | 'peas';
function drawCanPicto(g: G, kind: CanKind, cx: number, cy: number, s: number) {
  if (kind === 'fish') {
    g.beginPath(); g.moveTo(cx - s, cy); g.quadraticCurveTo(cx - s * 0.2, cy - s * 0.75, cx + s * 0.55, cy - s * 0.08); g.lineTo(cx + s, cy - s * 0.45); g.lineTo(cx + s * 0.92, cy + s * 0.45); g.lineTo(cx + s * 0.55, cy + s * 0.08); g.quadraticCurveTo(cx - s * 0.2, cy + s * 0.75, cx - s, cy); g.closePath();
    g.fillStyle = '#5aa0d8'; g.fill(); g.strokeStyle = OUT; g.lineWidth = s * 0.08; g.stroke();
    circle(g, cx - s * 0.6, cy - s * 0.1, s * 0.12, '#fff', OUT, s * 0.04); circle(g, cx - s * 0.6, cy - s * 0.1, s * 0.05, OUT);
    for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(cx - s * 0.1 + i * s * 0.22, cy, s * 0.18, -1, 1); g.strokeStyle = rgba(OUT, 0.5); g.lineWidth = s * 0.04; g.stroke(); }
  } else if (kind === 'tomato') {
    circle(g, cx, cy + s * 0.08, s * 0.82, '#e8382a', OUT, s * 0.08);
    circle(g, cx - s * 0.3, cy - s * 0.2, s * 0.16, 'rgba(255,255,255,0.5)');
    g.beginPath();
    for (let i = 0; i < 10; i++) { const a = i / 10 * TAU, r = i % 2 ? s * 0.12 : s * 0.38; g.lineTo(cx + Math.cos(a) * r, cy - s * 0.68 + Math.sin(a) * r * 0.5); }
    g.closePath(); g.fillStyle = '#3a9a3a'; g.fill(); g.strokeStyle = OUT; g.lineWidth = s * 0.05; g.stroke();
  } else {
    g.beginPath(); g.ellipse(cx, cy, s, s * 0.42, -0.25, 0, TAU); g.fillStyle = '#6ab83a'; g.fill(); g.strokeStyle = OUT; g.lineWidth = s * 0.07; g.stroke();
    for (let i = 0; i < 4; i++) circle(g, cx - s * 0.55 + i * s * 0.37, cy + s * 0.1 - i * s * 0.09, s * 0.17, '#a8e05a', OUT, s * 0.04);
  }
}
/**
 * Can texture for the can lathe: V 0..0.06 underside (silver), 0.06..0.8 the label band,
 * 0.8..1 rim + lid rings. Two label panels around (one faces +Z).
 */
export function canLabelTex(kind: CanKind, color = '#2e86c1', text?: string) {
  const label = text ?? (kind === 'fish' ? 'РЫБКА' : kind === 'tomato' ? 'ТОМАТЫ' : 'ГОРОШЕК');
  return tex(`can:${kind}:${color}:${label}`, 1024, 512, (g, w, h) => {
    const vy = (v: number) => (1 - v) * h;
    // metal
    const metal = g.createLinearGradient(0, 0, w, 0);
    for (let i = 0; i <= 8; i++) metal.addColorStop(i / 8, i % 2 ? '#e8eef6' : '#a8b2c2');
    g.fillStyle = metal; g.fillRect(0, 0, w, h);
    for (let v = 0.81; v < 1; v += 0.025) line(g, 0, vy(v), w, vy(v), 'rgba(60,70,90,0.45)', 2.5);
    line(g, 0, vy(0.87), w, vy(0.87), OUT, 4);
    // label band
    const y0 = vy(0.8), y1 = vy(0.06);
    g.fillStyle = color; g.fillRect(0, y0, w, y1 - y0);
    g.fillStyle = '#fff6e0'; g.fillRect(0, y0 + 10, w, 14); g.fillRect(0, y1 - 24, w, 14);
    g.fillStyle = PAL.gold; g.fillRect(0, y0 + 4, w, 4); g.fillRect(0, y1 - 8, w, 4);
    // lathe U=0.5 faces +Z, so panels are centered at U=0.5 (front) and U=0/1 (back, drawn on both edges to wrap)
    for (const cx0 of [w * 0.5, 0, w]) {
      const cx = cx0, cy = (y0 + y1) / 2 - 18;
      ellipse(g, cx, cy, 150, 92, 0, '#fff6e0', OUT, 5);
      drawCanPicto(g, kind, cx, cy, 64);
      g.fillStyle = '#fff6e0'; g.textAlign = 'center'; g.textBaseline = 'middle';
      fitFont(g, label, 300, 54, '900', FONT_HEAD);
      g.lineWidth = 8; g.strokeStyle = OUT; g.strokeText(label, cx, cy + 128); g.fillText(label, cx, cy + 128);
    }
    line(g, 0, y0, w, y0, OUT, 4); line(g, 0, y1, w, y1, OUT, 4);
  }, true);
}

/** bottle label (cream with a crown and text) */
export function bottleLabelTex(text = 'ВИНО', ink = '#7a1428') {
  return tex(`bottlelabel:${text}:${ink}`, 256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    rrPath(g, 8, 8, w - 16, h - 16, 30); g.fillStyle = '#f8edd0'; g.fill(); g.strokeStyle = ink; g.lineWidth = 6; g.stroke();
    g.beginPath(); g.moveTo(78, 120); g.lineTo(78, 70); g.lineTo(103, 95); g.lineTo(128, 55); g.lineTo(153, 95); g.lineTo(178, 70); g.lineTo(178, 120); g.closePath(); g.fillStyle = PAL.gold; g.fill(); g.strokeStyle = OUT; g.lineWidth = 4; g.stroke();
    g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
    fitFont(g, text, 200, 52, '900', FONT_HEAD); g.fillText(text, 128, 172);
  });
}

/** small decal text with alpha (sack stencils, plaques) */
export function stencilTex(text: string, ink = 'rgba(60,30,15,0.85)', w = 512, h = 192) {
  return tex(`stencil:${text}:${ink}:${w}x${h}`, w, h, (g) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
    fitFont(g, text, w * 0.9, h * 0.8, '900', FONT_HEAD);
    g.fillText(text, w / 2, h / 2 + 4);
    const R = rng(hashStr(text));
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(0,0,0,${0.3 + R() * 0.5})`; g.fillRect(R() * w, R() * h, 2 + R() * 8, 2 + R() * 4); }
    g.globalCompositeOperation = 'source-over';
  });
}

/** brass plaque with engraved text */
export function plaqueTex(text: string) {
  return tex(`plaque:${text}`, 512, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#ffe08a'); gr.addColorStop(0.5, '#e0a830'); gr.addColorStop(1, '#a87418');
    rrPath(g, 4, 4, w - 8, h - 8, 24); g.fillStyle = gr; g.fill(); g.strokeStyle = OUT; g.lineWidth = 6; g.stroke();
    g.fillStyle = '#5a3208'; g.textAlign = 'center'; g.textBaseline = 'middle';
    fitFont(g, text, w - 80, 64, '900', FONT_HEAD); g.fillText(text, w / 2, h / 2 + 3);
    for (const x of [26, w - 26]) circle(g, x, h / 2, 7, '#8a5a10', OUT, 2);
  });
}

// ───────────────────────── tableware (lathe-mapped: U around, V along profile) ─────────────────────────

/** plate: V 0..0.4 underside, 0.45..0.64 rim band with blue motifs, 0.64..1 well (center = 1). */
export function plateTex(accent = '#2c5fa8') {
  return tex(`plate:${accent}`, 1024, 256, (g, w, h) => {
    const vy = (v: number) => (1 - v) * h;
    g.fillStyle = '#fbf6ec'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e6dccb'; g.fillRect(0, vy(0.42), w, vy(0) - vy(0.42));
    g.fillStyle = PAL.gold; g.fillRect(0, vy(0.47), w, 6);
    const y0 = vy(0.62), y1 = vy(0.48);
    const n = 10, cw = w / n;
    for (let i = 0; i < n; i++) {
      const cx = i * cw + cw / 2, cy = (y0 + y1) / 2;
      g.beginPath(); g.moveTo(cx - cw * 0.42, cy); g.quadraticCurveTo(cx, cy - (y1 - y0) * 0.75, cx + cw * 0.42, cy); g.quadraticCurveTo(cx, cy + (y1 - y0) * 0.75, cx - cw * 0.42, cy);
      g.fillStyle = accent; g.fill();
      circle(g, cx, cy, (y1 - y0) * 0.14, '#fbf6ec');
      circle(g, i * cw, cy, (y1 - y0) * 0.12, accent);
    }
    g.fillStyle = accent; g.fillRect(0, vy(0.64), w, 5); g.fillRect(0, vy(0.75), w, 3);
  }, true);
}

/** porcelain body band for cups/bowls/teapots: colored band (v0..v1) with dots and a gold line. */
export function porcelainTex(color: string, v0: number, v1: number, base = '#fbf6ec') {
  return tex(`porc:${color}:${v0}:${v1}:${base}`, 1024, 256, (g, w, h) => {
    const vy = (v: number) => (1 - v) * h;
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const y0 = vy(v1), y1 = vy(v0);
    g.fillStyle = color; g.fillRect(0, y0, w, y1 - y0);
    const n = 12, cw = w / n, bh = y1 - y0;
    for (let i = 0; i < n; i++) {
      const cx = i * cw + cw / 2, cy = (y0 + y1) / 2;
      for (let k = 0; k < 5; k++) { const a = k / 5 * TAU; ellipse(g, cx + Math.cos(a) * bh * 0.2, cy + Math.sin(a) * bh * 0.2, bh * 0.16, bh * 0.09, a, '#fbf6ec'); }
      circle(g, cx, cy, bh * 0.08, PAL.gold);
      circle(g, i * cw, cy, bh * 0.06, '#fbf6ec');
    }
    g.fillStyle = PAL.gold; g.fillRect(0, y0 - 6, w, 5); g.fillRect(0, y1 + 1, w, 5);
  }, true);
}

/** thimble: silver with rows of dimples (tile). */
export function thimbleTex() {
  return tex('thimble', 256, 256, (g, w, h) => {
    g.fillStyle = PAL.thimble; g.fillRect(0, 0, w, h);
    for (let row = 0; row < 8; row++) for (let c = 0; c < 8; c++) {
      const x = c * 32 + (row % 2) * 16 + 8, y = row * 32 + 16;
      wrap9(w, h, x, y, 12, (px, py) => {
        circle(g, px, py, 10, '#9aa2b2');
        circle(g, px + 2, py + 2, 7, '#e8eef6');
        circle(g, px, py, 6, '#b8c0ce');
      });
    }
  }, true);
}

/** cookie tin: lathe-mapped body with flowers & gold bands. */
export function tinTex(color = '#2c6fb8') {
  return tex(`tin:${color}`, 1024, 256, (g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    const R = rng(hashStr(color));
    g.fillStyle = PAL.gold; g.fillRect(0, 20, w, 14); g.fillRect(0, h - 34, w, 14);
    for (let i = 0; i < 8; i++) {
      const cx = i * 128 + 64, cy = h / 2;
      circle(g, cx, cy, 44, '#e8b060', OUT, 4);
      for (let k = 0; k < 6; k++) circle(g, cx + (R() - 0.5) * 50, cy + (R() - 0.5) * 50, 6, '#5a2e1a');
      for (let k = 0; k < 5; k++) { const a = k / 5 * TAU; ellipse(g, cx + 64 + Math.cos(a) * 14, cy - 50 + Math.sin(a) * 14, 10, 6, a, '#ff8ab0'); }
      circle(g, cx + 64, cy - 50, 6, PAL.gold);
    }
  }, true);
}
/** tin lid top (planar disc) */
export function tinLidTex(color = '#2c6fb8') {
  return tex(`tinlid:${color}`, 512, 512, (g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    circle(g, w / 2, h / 2, 220, undefined, PAL.gold, 14);
    circle(g, w / 2, h / 2, 190, undefined, PAL.gold, 4);
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; circle(g, w / 2 + Math.cos(a) * 205, h / 2 + Math.sin(a) * 205, 8, '#ff8ab0'); }
    circle(g, w / 2, h / 2, 110, '#e8b060', OUT, 6);
    const R = rng(5);
    for (let k = 0; k < 9; k++) circle(g, w / 2 + (R() - 0.5) * 140, h / 2 + (R() - 0.5) * 140, 12, '#5a2e1a');
  });
}

// ───────────────────────── food ─────────────────────────

/** tile: cheese with holes */
export function cheeseTex() {
  return tex('cheese', 512, 512, (g, w, h) => {
    g.fillStyle = PAL.cheese; g.fillRect(0, 0, w, h);
    const R = rng(71);
    speckle(g, w, h, 300, '#d89a20', 0.15, 2, 6, R);
    for (let i = 0; i < 16; i++) {
      const x = R() * w, y = R() * h, r = 10 + R() * 36;
      wrap9(w, h, x, y, r + 6, (px, py) => {
        circle(g, px, py, r, '#c8901a');
        circle(g, px - r * 0.18, py - r * 0.18, r * 0.8, '#b07a12');
        g.beginPath(); g.arc(px, py, r, 0.2, 1.9); g.strokeStyle = 'rgba(255,250,200,0.8)'; g.lineWidth = 3; g.stroke();
        g.beginPath(); g.arc(px, py, r, Math.PI + 0.2, Math.PI + 1.9); g.strokeStyle = rgba(OUT, 0.55); g.lineWidth = 3; g.stroke();
      });
    }
  }, true);
}
/** tile: bread crust with flour dust */
export function breadTex() {
  return tex('bread', 512, 512, (g, w, h) => {
    g.fillStyle = PAL.bread; g.fillRect(0, 0, w, h);
    const R = rng(81);
    for (let i = 0; i < 40; i++) ellipse(g, R() * w, R() * h, 20 + R() * 60, 10 + R() * 30, R() * 3, rgba(R() < 0.5 ? '#8a4a1a' : '#e0a050', 0.3));
    speckle(g, w, h, 500, '#5a2a0a', 0.15, 1, 2.5, R);
    speckle(g, w, h, 400, '#fff6e0', 0.45, 1, 3, R);
  }, true);
}
/** tile: cookie dough with chocolate chips */
export function cookieTex() {
  return tex('cookie', 512, 512, (g, w, h) => {
    g.fillStyle = '#d9a060'; g.fillRect(0, 0, w, h);
    const R = rng(91);
    for (let i = 0; i < 30; i++) ellipse(g, R() * w, R() * h, 20 + R() * 40, 12 + R() * 20, R() * 3, rgba(R() < 0.5 ? '#b07a3a' : '#f0c080', 0.35));
    speckle(g, w, h, 300, '#7a4a20', 0.25, 1, 3, R);
    for (let i = 0; i < 14; i++) {
      const x = R() * w, y = R() * h, r = 12 + R() * 12;
      wrap9(w, h, x, y, r + 4, (px, py) => { ellipse(g, px, py, r, r * 0.8, R() * 3, '#4a2412', OUT, 3); ellipse(g, px - r * 0.3, py - r * 0.3, r * 0.3, r * 0.2, 0, 'rgba(255,255,255,0.3)'); });
    }
  }, true);
}
/** tile: sparkly sugar crystals */
export function sugarTex() {
  return tex('sugar', 256, 256, (g, w, h) => {
    g.fillStyle = '#f4f2fa'; g.fillRect(0, 0, w, h);
    const R = rng(101);
    for (let i = 0; i < 160; i++) { const x = R() * w, y = R() * h, s = 3 + R() * 8; g.fillStyle = R() < 0.5 ? '#dcd8ea' : '#ffffff'; g.fillRect(x, y, s, s); }
    for (let i = 0; i < 12; i++) { const x = R() * w, y = R() * h; line(g, x - 6, y, x + 6, y, '#ffffff', 2); line(g, x, y - 6, x, y + 6, '#ffffff', 2); }
  }, true);
}
/** tile: burlap weave */
export function burlapTex() {
  return tex('burlap', 256, 256, (g, w, h) => {
    g.fillStyle = '#c9a46a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < w; i += 8) { g.fillStyle = 'rgba(90,60,20,0.25)'; g.fillRect(i, 0, 3, h); g.fillRect(0, i, w, 3); }
    const R = rng(111);
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '255,240,200' : '80,50,20'},0.18)`; g.fillRect(R() * w, R() * h, 8 + R() * 16, 3); }
  }, true);
}
/** barrel staves: U around (12 staves), V up; dark seams. */
export function barrelTex() {
  return tex('barrel', 512, 256, (g, w, h) => {
    const R = rng(121);
    const n = 12, sw = w / n;
    for (let i = 0; i < n; i++) {
      g.fillStyle = shade(WOOD.warm[0], (R() - 0.5) * 0.2); g.fillRect(i * sw, 0, sw, h);
      for (let k = 0; k < 4; k++) { const x = i * sw + 5 + R() * (sw - 10); line(g, x, 0, x + (R() - 0.5) * 6, h, rgba(WOOD.warm[1], 0.3), 1.5); }
      line(g, i * sw + 1, 0, i * sw + 1, h, OUT, 3);
    }
  }, true);
}
/** tile: liquid surface (soup / jam) */
export function liquidTex(kind: 'soup' | 'jam' | 'tea' | 'wine') {
  return tex(`liquid:${kind}`, 512, 512, (g, w, h) => {
    const base = kind === 'soup' ? '#e2642a' : kind === 'jam' ? '#b0182e' : kind === 'tea' ? '#a8642a' : '#6a1030';
    const hi = kind === 'soup' ? '#ff9a4a' : kind === 'jam' ? '#e83a52' : kind === 'tea' ? '#d08a4a' : '#9a2a50';
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const R = rng(kind.length * 13);
    for (let k = 0; k < 14; k++) wavyH(g, w, R() * h, 8 + R() * 14, 1 + Math.floor(R() * 2), R() * TAU, rgba(hi, 0.35), 6 + R() * 10);
    if (kind === 'soup') {
      for (let i = 0; i < 14; i++) { const x = R() * w, y = R() * h; wrap9(w, h, x, y, 20, (px, py) => { circle(g, px, py, 14, '#ff9a2a', OUT, 3); circle(g, px, py, 6, '#ffc060'); }); }
      for (let i = 0; i < 18; i++) { const x = R() * w, y = R() * h; wrap9(w, h, x, y, 10, (px, py) => circle(g, px, py, 8, '#6ab83a', OUT, 2.5)); }
      for (let i = 0; i < 30; i++) ellipse(g, R() * w, R() * h, 6 + R() * 10, 3 + R() * 5, 0, 'rgba(255,220,120,0.45)');
    } else if (kind === 'jam') {
      for (let i = 0; i < 60; i++) ellipse(g, R() * w, R() * h, 3, 5, R() * 3, 'rgba(255,230,140,0.55)');
      for (let i = 0; i < 16; i++) ellipse(g, R() * w, R() * h, 12 + R() * 20, 4 + R() * 6, 0, 'rgba(255,255,255,0.3)');
    } else {
      for (let i = 0; i < 16; i++) ellipse(g, R() * w, R() * h, 12 + R() * 20, 4 + R() * 6, 0, 'rgba(255,255,255,0.2)');
    }
  }, true);
}
/** spaghetti noodle tangle (tile) */
export function noodleTex() {
  return tex('noodles', 512, 512, (g, w, h) => {
    g.fillStyle = '#e8b848'; g.fillRect(0, 0, w, h);
    const R = rng(131);
    for (let i = 0; i < 90; i++) {
      const x = R() * w, y = R() * h, r = 20 + R() * 60, a0 = R() * TAU;
      wrap9(w, h, x, y, r + 6, (px, py) => {
        g.beginPath(); g.arc(px, py, r, a0, a0 + 1.5 + R() * 3);
        g.strokeStyle = rgba(OUT, 0.55); g.lineWidth = 9; g.stroke();
        g.strokeStyle = PAL.noodle; g.lineWidth = 6; g.stroke();
      });
    }
  }, true);
}
/** tile: velvet cushion with tufting buttons */
export function velvetTex(color = '#a8243a') {
  return tex(`velvet:${color}`, 256, 256, (g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    const dark = shade(color, -0.35);
    for (const [x, y] of [[0, 0], [128, 128], [256, 0], [0, 256], [256, 256]] as const) {
      const gr = g.createRadialGradient(x, y, 4, x, y, 90); gr.addColorStop(0, dark); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - 90, y - 90, 180, 180);
    }
    for (const [x, y] of [[0, 0], [128, 128], [256, 0], [0, 256], [256, 256]] as const) { circle(g, x, y, 9, PAL.gold, OUT, 2); }
    g.strokeStyle = rgba(dark, 0.8); g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(256, 256); g.moveTo(256, 0); g.lineTo(0, 256); g.stroke();
  }, true);
}

// ───────────────────────── pictures & signs ─────────────────────────

/** the King's portrait (purple, mustache, crown, drumstick). 512×640 */
export function kingPortraitTex() {
  return tex('kingPortrait', 512, 640, (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#2b5a54'); bg.addColorStop(1, '#122a28');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) damaskMotif(g, (i % 3) * 200 + 60, Math.floor(i / 3) * 260 + 110, 60, 'rgba(255,255,255,0.06)', 'rgba(255,255,255,0.08)');
    const lw = 7;
    g.lineJoin = 'round'; g.lineCap = 'round';
    // robe
    g.beginPath(); g.moveTo(40, h); g.bezierCurveTo(60, 470, 160, 430, 256, 430); g.bezierCurveTo(352, 430, 452, 470, 472, h); g.closePath();
    g.fillStyle = PAL.robe; g.fill(); g.strokeStyle = OUT; g.lineWidth = lw; g.stroke();
    // ermine collar
    g.beginPath(); g.moveTo(110, 520); g.bezierCurveTo(150, 440, 362, 440, 402, 520); g.bezierCurveTo(330, 560, 182, 560, 110, 520); g.closePath();
    g.fillStyle = PAL.ermine; g.fill(); g.stroke();
    for (let i = 0; i < 7; i++) ellipse(g, 150 + i * 36, 505 + Math.sin(i) * 10, 5, 9, 0, OUT);
    // head
    ellipse(g, 256, 300, 150, 140, 0, PAL.kingSkin, OUT, lw);
    ellipse(g, 256, 390, 95, 45, 0, PAL.kingSkinD); // double chin
    ellipse(g, 160, 330, 30, 20, 0, '#e894c8'); ellipse(g, 352, 330, 30, 20, 0, '#e894c8');
    // smug closed eyes
    for (const x of [200, 312]) { g.beginPath(); g.arc(x, 280, 22, 0.15 * Math.PI, 0.85 * Math.PI); g.strokeStyle = OUT; g.lineWidth = 7; g.stroke(); line(g, x - 26, 248, x + 20, 242 + (x > 256 ? 6 : -4), OUT, 6); }
    ellipse(g, 256, 318, 24, 20, 0, PAL.kingSkinD, OUT, 5);
    // mustache
    const st = (sgn: number) => {
      g.beginPath(); g.moveTo(256, 340);
      g.bezierCurveTo(256 + sgn * 40, 320, 256 + sgn * 110, 330, 256 + sgn * 130, 300);
      g.bezierCurveTo(256 + sgn * 150, 280, 256 + sgn * 170, 300, 256 + sgn * 150, 320);
      g.bezierCurveTo(256 + sgn * 140, 370, 256 + sgn * 60, 380, 256, 360); g.closePath();
      g.fillStyle = PAL.stache; g.fill(); g.strokeStyle = OUT; g.lineWidth = lw; g.stroke();
    };
    st(1); st(-1);
    g.beginPath(); g.arc(256, 372, 22, 0.1 * Math.PI, 0.9 * Math.PI); g.strokeStyle = OUT; g.lineWidth = 6; g.stroke();
    // crown
    g.beginPath(); g.moveTo(150, 190); g.lineTo(140, 90); g.lineTo(200, 140); g.lineTo(256, 60); g.lineTo(312, 140); g.lineTo(372, 90); g.lineTo(362, 190); g.closePath();
    g.fillStyle = PAL.gold; g.fill(); g.strokeStyle = OUT; g.lineWidth = lw; g.stroke();
    g.fillStyle = '#c8901a'; g.fillRect(150, 165, 212, 25); g.strokeRect(150, 165, 212, 25);
    circle(g, 256, 178, 13, '#e8283a', OUT, 4); circle(g, 200, 178, 9, '#2e86c1', OUT, 3); circle(g, 312, 178, 9, '#27ae60', OUT, 3);
    for (const [x, y] of [[140, 90], [256, 60], [372, 90]] as const) circle(g, x, y, 12, PAL.gold, OUT, 4);
    // drumstick in hand
    g.save(); g.translate(400, 560); g.rotate(-0.6);
    ellipse(g, 0, -40, 42, 55, 0, '#b8642a', OUT, lw);
    g.fillStyle = '#fbf6ec'; g.fillRect(-10, 10, 20, 50); g.strokeRect(-10, 10, 20, 50);
    circle(g, -12, 64, 13, '#fbf6ec', OUT, 5); circle(g, 12, 64, 13, '#fbf6ec', OUT, 5);
    g.restore();
    ellipse(g, 400, 590, 40, 30, 0, PAL.kingSkin, OUT, lw);
    // varnish & canvas grain
    const R = rng(141);
    speckle(g, w, h, 800, '#000000', 0.05, 1, 2, R);
    const vg = g.createRadialGradient(w / 2, h / 2, 150, w / 2, h / 2, 420); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(30,10,0,0.45)');
    g.fillStyle = vg; g.fillRect(0, 0, w, h);
  });
}

/** night sky seen through an arched window: moon, stars, mullions. 256×512 (for an arch w:h = 1:2). */
export function moonWindowTex() {
  return tex('moonWindow', 256, 512, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#0b1240'); sky.addColorStop(0.7, '#24387e'); sky.addColorStop(1, '#3c5aa8');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    const R = rng(151);
    for (let i = 0; i < 70; i++) { const x = R() * w, y = R() * h * 0.85, s = R() < 0.15 ? 3 : 1.5; g.fillStyle = `rgba(255,250,220,${0.5 + R() * 0.5})`; g.fillRect(x, y, s, s); }
    const mg = g.createRadialGradient(160, 140, 30, 160, 140, 120); mg.addColorStop(0, 'rgba(255,250,210,0.6)'); mg.addColorStop(1, 'rgba(255,250,210,0)');
    g.fillStyle = mg; g.fillRect(0, 0, w, h);
    circle(g, 160, 140, 52, '#fff6d0');
    circle(g, 145, 125, 10, '#e8dcae'); circle(g, 175, 160, 14, '#e8dcae'); circle(g, 180, 118, 6, '#e8dcae');
    // distant towers silhouette
    g.fillStyle = '#0a0f2a';
    g.beginPath(); g.moveTo(0, h); g.lineTo(0, 400); g.lineTo(40, 400); g.lineTo(40, 360); g.lineTo(60, 330); g.lineTo(80, 360); g.lineTo(80, 420); g.lineTo(150, 420); g.lineTo(150, 380); g.lineTo(190, 380); g.lineTo(190, 440); g.lineTo(w, 430); g.lineTo(w, h); g.closePath(); g.fill();
    // mullions & leading
    g.strokeStyle = OUT; g.lineWidth = 10;
    line(g, w / 2, 0, w / 2, h, OUT, 10);
    for (const y of [180, 330]) line(g, 0, y, w, y, OUT, 10);
    g.strokeStyle = 'rgba(42,27,26,0.6)'; g.lineWidth = 3;
    for (let y = 30; y < h; y += 50) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + 25); g.stroke(); g.beginPath(); g.moveTo(w, y); g.lineTo(0, y + 25); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.beginPath(); g.moveTo(20, 0); g.lineTo(70, 0); g.lineTo(10, h * 0.5); g.lineTo(0, h * 0.4); g.closePath(); g.fill();
  });
}

/** wooden board with a pinned parchment note and handwritten text (\n for line breaks). 512×256 */
export function signTex(text: string) {
  return tex(`sign:${text}`, 512, 256, (g, w, h) => {
    const R = rng(hashStr(text));
    g.fillStyle = WOOD.warm[0]; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 14; k++) wavyH(g, w, R() * h, 2 + R() * 4, 1, R() * TAU, rgba(WOOD.warm[1], 0.3), 2);
    line(g, 0, h / 2, w, h / 2, rgba(OUT, 0.8), 4);
    g.strokeStyle = OUT; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
    // parchment
    g.save(); g.translate(w / 2, h / 2); g.rotate((R() - 0.5) * 0.05);
    g.beginPath();
    const pw = w * 0.84, ph = h * 0.76;
    g.moveTo(-pw / 2, -ph / 2);
    for (let x = -pw / 2; x < pw / 2; x += 16) g.lineTo(x, -ph / 2 + (R() - 0.5) * 6);
    for (let y = -ph / 2; y < ph / 2; y += 16) g.lineTo(pw / 2 + (R() - 0.5) * 6, y);
    for (let x = pw / 2; x > -pw / 2; x -= 16) g.lineTo(x, ph / 2 + (R() - 0.5) * 6);
    for (let y = ph / 2; y > -ph / 2; y -= 16) g.lineTo(-pw / 2 + (R() - 0.5) * 6, y);
    g.closePath(); g.fillStyle = '#f4e4bc'; g.fill(); g.strokeStyle = rgba(OUT, 0.6); g.lineWidth = 3; g.stroke();
    const vg = g.createRadialGradient(0, 0, 40, 0, 0, pw * 0.6); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(140,90,30,0.35)');
    g.fillStyle = vg; g.fill();
    const lines = text.split('\n');
    g.fillStyle = '#3a2010'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = Math.min(80, (ph * 0.86) / lines.length);
    for (const l of lines) size = Math.min(size, fitFont(g, l, pw * 0.88, size, '400', FONT_HAND));
    g.font = `400 ${size}px ${FONT_HAND}`;
    lines.forEach((l, i) => g.fillText(l, 0, (i - (lines.length - 1) / 2) * size * 1.05 + 3));
    g.restore();
    for (const [x, y] of [[w * 0.1, h * 0.14], [w * 0.9, h * 0.14]] as const) circle(g, x, y, 9, '#c8343a', OUT, 3);
  });
}

/** royal banner: color field, gold border, crown emblem. U across, V up (0..1). */
export function bannerTex(color: string = PAL.robe) {
  return tex(`banner:${color}`, 256, 512, (g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 24) { g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(x, 0, 10, h); }
    g.fillStyle = PAL.gold; g.fillRect(0, 0, 18, h); g.fillRect(w - 18, 0, 18, h); g.fillRect(0, 0, w, 22);
    g.fillStyle = shade(color, -0.3); g.fillRect(18, 22, 6, h); g.fillRect(w - 24, 22, 6, h);
    const cx = w / 2, cy = 200;
    circle(g, cx, cy, 82, shade(color, -0.25), PAL.gold, 8);
    g.beginPath(); g.moveTo(cx - 52, cy + 30); g.lineTo(cx - 58, cy - 34); g.lineTo(cx - 24, cy - 6); g.lineTo(cx, cy - 50); g.lineTo(cx + 24, cy - 6); g.lineTo(cx + 58, cy - 34); g.lineTo(cx + 52, cy + 30); g.closePath();
    g.fillStyle = PAL.gold; g.fill(); g.strokeStyle = OUT; g.lineWidth = 5; g.stroke();
    for (const [x, y] of [[cx - 58, cy - 34], [cx, cy - 50], [cx + 58, cy - 34]] as const) circle(g, x, y, 8, PAL.gold, OUT, 3);
    circle(g, cx, cy + 12, 9, '#2e86c1', OUT, 3);
    // drumstick & fork crest below
    g.save(); g.translate(cx, 360);
    for (const s of [-1, 1]) { g.save(); g.rotate(s * 0.6); g.fillStyle = PAL.gold; g.fillRect(-6, -70, 12, 140); g.restore(); }
    circle(g, 0, 0, 18, PAL.gold, OUT, 4);
    g.restore();
    const R = rng(hashStr(color));
    speckle(g, w, h, 400, '#000000', 0.05, 1, 2, R);
    // swallowtail notch (transparent → alphaTest)
    g.globalCompositeOperation = 'destination-out';
    g.beginPath(); g.moveTo(0, h + 1); g.lineTo(w / 2, h * 0.86); g.lineTo(w, h + 1); g.closePath(); g.fill();
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = PAL.gold; g.lineWidth = 8;
    g.beginPath(); g.moveTo(0, h); g.lineTo(w / 2, h * 0.86); g.lineTo(w, h); g.stroke();
  });
}

/** arched wooden door: vertical planks, iron straps & studs. 256×512 */
export function doorTex() {
  return tex('door', 256, 512, (g, w, h) => {
    const R = rng(161);
    const n = 5, pw = w / n;
    for (let i = 0; i < n; i++) {
      g.fillStyle = shade(WOOD.dark[0], (R() - 0.5) * 0.2); g.fillRect(i * pw, 0, pw, h);
      for (let k = 0; k < 5; k++) { const x = i * pw + 4 + R() * (pw - 8); line(g, x, 0, x + (R() - 0.5) * 8, h, rgba(WOOD.dark[1], 0.4), 2); }
      line(g, i * pw + 1, 0, i * pw + 1, h, OUT, 4);
    }
    for (const y of [110, 400]) {
      g.fillStyle = '#3a3440'; g.fillRect(0, y, w, 26);
      g.strokeStyle = OUT; g.lineWidth = 3; g.strokeRect(-2, y, w + 4, 26);
      for (let x = 14; x < w; x += 38) circle(g, x, y + 13, 5, '#8a8494', OUT, 2);
    }
  });
}

// ───────────────────────── fx & sky ─────────────────────────

/** soft radial glow (white → transparent) for additive sprites */
export function glowTex() {
  return tex('glow', 128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
}
/** vertical light shaft fade (top bright → bottom transparent, soft sides) */
export function beamTex() {
  return tex('beam', 128, 256, (g, w, h) => {
    for (let x = 0; x < w; x++) {
      const s = Math.sin((x / (w - 1)) * Math.PI);
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, `rgba(255,255,255,${0.9 * s})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x, 0, 1, h);
    }
  });
}

export type SkyTheme = 'pantry' | 'feast' | 'library' | 'gallery' | 'throne' | 'den';
const SKY: Record<SkyTheme, [string, string, string]> = {
  pantry: ['#140a06', '#3a2010', '#120806'],
  feast: ['#1a0608', '#4a1418', '#12060a'],
  library: ['#04121a', '#123a40', '#040c10'],
  gallery: ['#0a0614', '#2a1a44', '#08040e'],
  throne: ['#060a24', '#2a2a5e', '#0a0614'],
  den: ['#0e0804', '#2e1e10', '#0a0604'],
};
/** vertical gradient for the backdrop sphere (V: 0 bottom → 1 top), with dust motes / stars. */
export function skyTex(theme: SkyTheme) {
  return tex(`sky:${theme}`, 512, 512, (g, w, h) => {
    const [top, mid, bot] = SKY[theme];
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, top); gr.addColorStop(0.45, mid); gr.addColorStop(0.55, mid); gr.addColorStop(1, bot);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const R = rng(theme.length * 17);
    const n = theme === 'throne' ? 220 : 90;
    for (let i = 0; i < n; i++) {
      const x = R() * w, y = R() * h * 0.5, a = theme === 'throne' ? 0.4 + R() * 0.6 : 0.08 + R() * 0.15;
      g.fillStyle = theme === 'throne' ? `rgba(255,250,220,${a})` : `rgba(255,200,120,${a})`;
      g.fillRect(x, y, R() < 0.1 ? 3 : 1.5, R() < 0.1 ? 3 : 1.5);
    }
    if (theme === 'throne') {
      const mg = g.createRadialGradient(w * 0.5, 30, 5, w * 0.5, 30, 140); mg.addColorStop(0, 'rgba(220,230,255,0.55)'); mg.addColorStop(1, 'rgba(220,230,255,0)');
      g.fillStyle = mg; g.fillRect(0, 0, w, 200);
    }
  });
}

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Built, BoxCol } from '../physics/types';
import { PAL, matU, basic, noOutline, canvasTex } from '../gfx';
import { B, TAU, clamp, lerp, rng, rr, tmat, cg, latheV } from './kit';
import { woodGrainTex, rugTex, glowTex, shade, FONT_HAND, FONT_HEAD } from './textures';

/**
 * MAGIC BOOK PORTAL — a giant fairy-tale tome standing on a carved lectern; it is the level exit.
 *
 * Local layout at s = 1 (front = +Z after rotation, origin = bottom-center of the base on the floor):
 *  - stair step   x ±2.6, z 2.6..3.6, top y = 0.6
 *  - dais (step)  x ±3.7, z −2.2..2.6, top y = 1.2      ← the hero stands here and jumps into the pages
 *  - column + bookrest under the book, bookrest top y = 2.95 (z −1.5..0.5)
 *  - open book ≈ 7.3 wide × 9 tall, pages from y ≈ 3.3 to ≈ 11.9 (lower edge ≈ 2.1 above the dais)
 * `open(k)` sets the target openness (0 closed … 1 open); the book eases toward it (≈1.6 s for a full
 * opening). Pass `instant = true` to jump straight to k (e.g. if you animate k yourself).
 * `pageCenter`/`radius` (world) describe the trigger sphere in front of the pages. Colliders: stair, dais,
 * column, bookrest, a back plate behind the book, and the closed book (only while openness < 0.4).
 * Exactly one PointLight (golden, intensity follows the openness).
 */

// ───────────────────────── dimensions (s = 1) ─────────────────────────
const W = 3.55; // one half (cover) width
const H = 9; // book height
const P = 0.42; // page block thickness per half
const C = 0.17; // cover thickness
const BOOK_Y = 2.95; // bookrest top
const PIVOT_Z = -0.42; // gutter front (hinge) z
const TILT = 0.08; // book leans back
const V_OPEN = 0.16; // open halves form a shallow V (outer edges forward)
const HOVER = 0.16; // the open book floats a little above the rest
const FX_Y = 4.3; // vortex center (book-local height)
const TRIG_Y = 3.9; // trigger center (book-local height) — a bit lower so a jump from the dais reaches it
const TRIG_R = 4.0;
const COVER = '#4b2378';
const GOLD = PAL.gold;

const smooth = (t: number) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a), 0, 1);
const easeInOut = (t: number) => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; };

// ───────────────────────── textures (module cache) ─────────────────────────
type G2 = CanvasRenderingContext2D;
const texCache = new Map<string, THREE.Texture>();
function ctex(key: string, w: number, h: number, draw: (g: G2, w: number, h: number) => void, wrap = false) {
  let t = texCache.get(key);
  if (!t) { t = canvasTex(w, h, draw, { wrap }); t.name = key; texCache.set(key, t); }
  return t;
}
function rrect(g: G2, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.roundRect(x, y, w, h, r);
}
function star(g: G2, cx: number, cy: number, r0: number, r1: number, n: number, rot = -Math.PI / 2) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) { const a = rot + i / (n * 2) * TAU, r = i % 2 ? r1 : r0; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  g.closePath();
}
function sparkle4(g: G2, cx: number, cy: number, r: number, thin = 0.18) {
  g.beginPath();
  for (let i = 0; i < 8; i++) { const a = -Math.PI / 2 + i / 8 * TAU, rr2 = i % 2 ? r * thin : r; g.lineTo(cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2); }
  g.closePath();
}
/** gold curly flourish (a spiral) */
function curl(g: G2, cx: number, cy: number, r: number, dir: number, turns = 1.3) {
  g.beginPath();
  for (let i = 0; i <= 40; i++) {
    const t = i / 40, a = dir * t * turns * TAU, rr2 = r * (1 - t * 0.85);
    const x = cx + Math.cos(a) * rr2, y = cy + Math.sin(a) * rr2;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.stroke();
}

/** front cover: purple leather, gold frames, title plate, rays around the medallion, moon & stars */
function tomeCoverTex() {
  return ctex('portal:cover', 400, 1024, (g, w, h) => {
    const R = rng(77);
    g.fillStyle = COVER; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},${0.04 + R() * 0.04})`; g.fillRect(R() * w, R() * h, 2 + R() * 4, 1.5); }
    const vg = g.createRadialGradient(w / 2, h / 2, 60, w / 2, h / 2, h * 0.62);
    vg.addColorStop(0, 'rgba(255,220,255,0.10)'); vg.addColorStop(1, 'rgba(10,0,20,0.55)');
    g.fillStyle = vg; g.fillRect(0, 0, w, h);
    const gold = GOLD, goldD = '#a8741a';
    // frames
    g.strokeStyle = goldD; g.lineWidth = 18; rrect(g, 22, 22, w - 44, h - 44, 26); g.stroke();
    g.strokeStyle = gold; g.lineWidth = 11; rrect(g, 22, 22, w - 44, h - 44, 26); g.stroke();
    g.lineWidth = 4; rrect(g, 48, 48, w - 96, h - 96, 16); g.stroke();
    // dotted rune border
    g.fillStyle = gold;
    for (let y = 80; y < h - 80; y += 26) for (const x of [62, w - 62]) { g.beginPath(); g.arc(x, y, (y / 26) % 2 < 1 ? 4 : 2.5, 0, TAU); g.fill(); }
    // corner curls
    g.strokeStyle = gold; g.lineWidth = 5; g.lineCap = 'round';
    for (const [cx, cy, d] of [[86, 86, 1], [w - 86, 86, -1], [86, h - 86, -1], [w - 86, h - 86, 1]] as const) curl(g, cx, cy, 26, d);
    // title plate
    const ty = 120, th = 92;
    g.fillStyle = shade(COVER, -0.45); rrect(g, 70, ty, w - 140, th, 18); g.fill();
    g.strokeStyle = gold; g.lineWidth = 6; rrect(g, 70, ty, w - 140, th, 18); g.stroke();
    g.font = `900 54px ${FONT_HEAD}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = 54; while (size > 20) { g.font = `900 ${size}px ${FONT_HEAD}`; if (g.measureText('СКАЗКИ').width < w - 180) break; size -= 2; }
    g.fillStyle = goldD; g.fillText('СКАЗКИ', w / 2 + 2, ty + th / 2 + 4);
    g.fillStyle = '#ffe9a0'; g.fillText('СКАЗКИ', w / 2, ty + th / 2 + 1);
    // rays around the medallion (3D medallion sits on top at the center)
    const cy = h / 2;
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * TAU, r0 = 120, r1 = i % 2 ? 165 : 200;
      g.strokeStyle = i % 2 ? goldD : gold; g.lineWidth = i % 2 ? 4 : 7;
      g.beginPath(); g.moveTo(w / 2 + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(w / 2 + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.stroke();
    }
    g.strokeStyle = gold; g.lineWidth = 5; g.beginPath(); g.arc(w / 2, cy, 112, 0, TAU); g.stroke();
    // moon & stars near the bottom
    const my = h - 200;
    g.fillStyle = gold; g.beginPath(); g.arc(w / 2, my, 46, 0, TAU); g.fill();
    g.fillStyle = shade(COVER, -0.2); g.beginPath(); g.arc(w / 2 + 20, my - 12, 42, 0, TAU); g.fill();
    for (const [x, y, r] of [[w / 2 - 92, my - 40, 14], [w / 2 + 88, my + 26, 11], [w / 2 - 60, my + 50, 8], [w / 2 + 66, my - 56, 8]] as const) { g.fillStyle = gold; sparkle4(g, x, y, r * 1.6, 0.25); g.fill(); }
    // vines along the sides of the medallion
    g.strokeStyle = gold; g.lineWidth = 4;
    for (const sx of [-1, 1]) {
      g.beginPath();
      for (let i = 0; i <= 30; i++) { const t = i / 30, y = 260 + t * 140, x = w / 2 + sx * (120 + Math.sin(t * TAU * 1.5) * 18); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
      g.beginPath();
      for (let i = 0; i <= 30; i++) { const t = i / 30, y = h - 400 + t * 120, x = w / 2 + sx * (120 + Math.sin(t * TAU * 1.5 + 1) * 18); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
    }
  });
}

/** handwriting-ish ink lines */
function inkLines(g: G2, x: number, y: number, w: number, h: number, lh: number, R: () => number, ink = 'rgba(92,58,36,0.78)', indent = 0) {
  g.strokeStyle = ink; g.lineWidth = Math.max(2, lh * 0.16); g.lineCap = 'round'; g.lineJoin = 'round';
  let first = true;
  for (let yy = y; yy < y + h - lh * 0.3; yy += lh) {
    let xx = x + (first ? indent : 0);
    first = false;
    const end = x + w - (R() < 0.2 ? R() * w * 0.5 : R() * w * 0.06);
    while (xx < end - 8) {
      const ww = Math.min(end - xx, 10 + R() * 34), ph = R() * 6, fr = 0.5 + R() * 0.3;
      g.beginPath();
      for (let k = 0; k <= ww; k += 2) { const py = yy + Math.sin(k * fr + ph) * lh * 0.13 + Math.sin(k * 0.17 + ph) * lh * 0.05; if (k === 0) g.moveTo(xx + k, py); else g.lineTo(xx + k, py); }
      g.stroke();
      xx += ww + 6 + R() * 6;
    }
  }
}
function parchment(g: G2, x: number, w: number, h: number, gutter: -1 | 0 | 1, R: () => number) {
  g.fillStyle = '#fbf0d2'; g.fillRect(x, 0, w, h);
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(170,120,60,${0.03 + R() * 0.05})`; g.beginPath(); g.arc(x + R() * w, R() * h, 2 + R() * 9, 0, TAU); g.fill(); }
  const eg = g.createLinearGradient(x, 0, x + w, 0);
  if (gutter === 1) { eg.addColorStop(0, 'rgba(150,100,40,0.18)'); eg.addColorStop(0.12, 'rgba(0,0,0,0)'); eg.addColorStop(0.8, 'rgba(0,0,0,0)'); eg.addColorStop(1, 'rgba(120,70,20,0.55)'); }
  else if (gutter === -1) { eg.addColorStop(0, 'rgba(120,70,20,0.55)'); eg.addColorStop(0.2, 'rgba(0,0,0,0)'); eg.addColorStop(0.88, 'rgba(0,0,0,0)'); eg.addColorStop(1, 'rgba(150,100,40,0.18)'); }
  else { eg.addColorStop(0, 'rgba(150,100,40,0.15)'); eg.addColorStop(0.1, 'rgba(0,0,0,0)'); eg.addColorStop(0.9, 'rgba(0,0,0,0)'); eg.addColorStop(1, 'rgba(150,100,40,0.15)'); }
  g.fillStyle = eg; g.fillRect(x, 0, w, h);
  const vg = g.createLinearGradient(0, 0, 0, h);
  vg.addColorStop(0, 'rgba(150,100,40,0.18)'); vg.addColorStop(0.06, 'rgba(0,0,0,0)'); vg.addColorStop(0.94, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(150,100,40,0.18)');
  g.fillStyle = vg; g.fillRect(x, 0, w, h);
}
function goldBorder(g: G2, x: number, w: number, h: number) {
  g.strokeStyle = '#d6a21e'; g.lineWidth = 5; rrect(g, x + 22, 26, w - 44, h - 52, 10); g.stroke();
  g.lineWidth = 2; rrect(g, x + 32, 36, w - 64, h - 72, 6); g.stroke();
  g.fillStyle = '#d6a21e';
  for (const [cx, cy] of [[x + 27, 31], [x + w - 27, 31], [x + 27, h - 31], [x + w - 27, h - 31]] as const) { sparkle4(g, cx, cy, 14, 0.3); g.fill(); }
}

const PW = 384; // page column width in the atlas
const ATLAS_W = 1280, ATLAS_H = 1024;
/** page atlas: [0] left page "Жили-были", [1] right page with a castle picture, [2] loose text page, [3] page-edge lines */
function pageAtlasTex() {
  return ctex('portal:pages', ATLAS_W, ATLAS_H, (g, w, h) => {
    const R = rng(5);
    // left page
    parchment(g, 0, PW, h, -1, R);
    goldBorder(g, 0, PW, h);
    // illuminated drop cap
    g.fillStyle = '#b8283a'; rrect(g, 52, 64, 108, 120, 10); g.fill();
    g.strokeStyle = '#e8b52a'; g.lineWidth = 6; rrect(g, 52, 64, 108, 120, 10); g.stroke();
    g.font = `900 92px ${FONT_HEAD}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ffd96a'; g.fillText('Ж', 106, 128);
    g.font = `400 46px ${FONT_HAND}`; g.textAlign = 'left'; g.fillStyle = '#5a3420';
    g.fillText('или-были', 168, 108);
    inkLines(g, 168, 150, PW - 210, 40, 22, R);
    inkLines(g, 52, 200, PW - 104, 250, 24, R);
    // tiny crown vignette
    const cy = 520;
    g.fillStyle = '#e8b52a'; g.beginPath();
    g.moveTo(PW / 2 - 60, cy + 30); g.lineTo(PW / 2 - 60, cy - 20); g.lineTo(PW / 2 - 30, cy + 5); g.lineTo(PW / 2, cy - 38); g.lineTo(PW / 2 + 30, cy + 5); g.lineTo(PW / 2 + 60, cy - 20); g.lineTo(PW / 2 + 60, cy + 30); g.closePath(); g.fill();
    g.strokeStyle = '#8a5a14'; g.lineWidth = 3; g.stroke();
    for (const dx of [-60, 0, 60]) { g.fillStyle = '#d8343a'; g.beginPath(); g.arc(PW / 2 + dx, cy - (dx === 0 ? 38 : 20), 8, 0, TAU); g.fill(); }
    inkLines(g, 52, 590, PW - 104, 330, 24, R, undefined, 30);
    g.font = `400 26px ${FONT_HAND}`; g.textAlign = 'center'; g.fillStyle = '#8a6a40'; g.fillText('~ 7 ~', PW / 2, h - 58);

    // right page (picture + text)
    const x1 = PW;
    parchment(g, x1, PW, h, 1, R);
    goldBorder(g, x1, PW, h);
    const pcx = x1 + PW / 2, pcy = 250, pr = 150;
    g.save(); g.beginPath(); g.arc(pcx, pcy, pr, 0, TAU); g.clip();
    const sky = g.createLinearGradient(0, pcy - pr, 0, pcy + pr); sky.addColorStop(0, '#2c3e8f'); sky.addColorStop(1, '#8e6ad0');
    g.fillStyle = sky; g.fillRect(pcx - pr, pcy - pr, pr * 2, pr * 2);
    g.fillStyle = '#fff3c0'; g.beginPath(); g.arc(pcx + 70, pcy - 70, 28, 0, TAU); g.fill();
    g.fillStyle = '#4a5ab0'; g.beginPath(); g.arc(pcx + 82, pcy - 80, 24, 0, TAU); g.fill();
    for (let i = 0; i < 16; i++) { g.fillStyle = '#fff3c0'; sparkle4(g, pcx - pr + R() * pr * 2, pcy - pr + R() * pr, 4 + R() * 6, 0.3); g.fill(); }
    g.fillStyle = '#3a8a4a'; g.beginPath(); g.ellipse(pcx, pcy + pr + 40, pr * 1.3, pr * 0.75, 0, 0, TAU); g.fill();
    // castle
    g.fillStyle = '#f0e6d8';
    const bx = pcx - 60, by = pcy + 10;
    g.fillRect(bx, by, 120, 80);
    for (const [tx, tw, tht] of [[bx - 18, 34, 120], [bx + 104, 34, 120], [bx + 42, 36, 150]] as const) {
      g.fillStyle = '#f0e6d8'; g.fillRect(tx, by + 80 - tht, tw, tht);
      g.fillStyle = '#d8343a'; g.beginPath(); g.moveTo(tx - 6, by + 80 - tht); g.lineTo(tx + tw / 2, by + 80 - tht - 46); g.lineTo(tx + tw + 6, by + 80 - tht); g.closePath(); g.fill();
    }
    g.fillStyle = '#5a3a24'; g.beginPath(); g.arc(pcx, by + 80, 18, Math.PI, 0); g.fill(); g.fillRect(pcx - 18, by + 62 + 18, 36, 0);
    for (const wx of [bx - 6, bx + 116, bx + 54]) { g.fillStyle = '#ffd24a'; g.fillRect(wx, by - 10, 10, 16); }
    g.restore();
    g.strokeStyle = '#d6a21e'; g.lineWidth = 8; g.beginPath(); g.arc(pcx, pcy, pr, 0, TAU); g.stroke();
    g.lineWidth = 3; g.beginPath(); g.arc(pcx, pcy, pr + 12, 0, TAU); g.stroke();
    inkLines(g, x1 + 52, 440, PW - 104, 480, 24, R, undefined, 30);
    g.font = `400 26px ${FONT_HAND}`; g.textAlign = 'center'; g.fillStyle = '#8a6a40'; g.fillText('~ 8 ~', pcx, h - 58);

    // loose page
    const x2 = PW * 2;
    parchment(g, x2, PW, h, 0, R);
    goldBorder(g, x2, PW, h);
    inkLines(g, x2 + 52, 70, PW - 104, 380, 24, R, undefined, 30);
    g.fillStyle = '#d6a21e'; star(g, x2 + PW / 2, 512, 40, 17, 5); g.fill();
    inkLines(g, x2 + 52, 590, PW - 104, 330, 24, R, undefined, 30);

    // page-edge lines (along U)
    const x3 = PW * 3, ew = w - x3;
    g.fillStyle = '#f2e2bc'; g.fillRect(x3, 0, ew, h);
    for (let yy = 2; yy < h; yy += 4 + R() * 5) { g.fillStyle = `rgba(150,105,55,${0.2 + R() * 0.3})`; g.fillRect(x3, yy, ew, 1.5 + R()); }
  });
}
const pageRect = (i: number) => ({ u0: (i * PW + 2) / ATLAS_W, u1: ((i + 1) * PW - 2) / ATLAS_W });
const EDGE_U0 = (PW * 3 + 4) / ATLAS_W, EDGE_U1 = (ATLAS_W - 4) / ATLAS_W;

/** 4×4 glyph atlas (white): 0-9 letters, 10 sparkle, 11 dot, 12 star, 13 moon, 14 8-star, 15 rune circle */
const GLYPHS = ['Ж', 'Ф', 'Я', 'Б', 'Щ', 'Ю', 'Ꙋ', 'Ѣ', '§', 'Ы'];
function glyphAtlasTex() {
  return ctex('portal:glyphs', 512, 512, (g) => {
    const cs = 128;
    g.clearRect(0, 0, 512, 512);
    g.fillStyle = '#ffffff'; g.strokeStyle = '#ffffff';
    g.shadowColor = 'rgba(255,255,255,0.95)';
    for (let i = 0; i < 16; i++) {
      const cx = (i % 4) * cs + cs / 2, cy = Math.floor(i / 4) * cs + cs / 2;
      g.save();
      g.shadowBlur = 14;
      if (i < 10) {
        g.font = `${i % 2 ? '400' : '900'} ${i % 2 ? 84 : 72}px ${i % 2 ? FONT_HAND : FONT_HEAD}`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(GLYPHS[i], cx, cy + 4);
      } else if (i === 10) { sparkle4(g, cx, cy, 54, 0.14); g.fill(); }
      else if (i === 11) {
        g.shadowBlur = 0;
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, 50); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(cx - 60, cy - 60, 120, 120);
      } else if (i === 12) { star(g, cx, cy, 46, 20, 5); g.fill(); }
      else if (i === 13) {
        g.beginPath(); g.arc(cx, cy, 40, 0, TAU); g.fill();
        g.globalCompositeOperation = 'destination-out'; g.shadowBlur = 0;
        g.beginPath(); g.arc(cx + 18, cy - 12, 36, 0, TAU); g.fill();
      } else if (i === 14) { star(g, cx, cy, 50, 12, 8); g.fill(); }
      else { g.lineWidth = 7; g.beginPath(); g.arc(cx, cy, 36, 0, TAU); g.stroke(); star(g, cx, cy, 30, 12, 4); g.fill(); }
      g.restore();
    }
  });
}

/** soft radial light rays (sunburst) */
function raysTex() {
  return ctex('portal:rays', 512, 512, (g, w, h) => {
    const R = rng(23);
    const cx = w / 2, cy = h / 2;
    g.clearRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 22; i++) {
      const a = i / 22 * TAU + R() * 0.15, wd = 0.04 + R() * 0.09, len = w * (0.32 + R() * 0.18);
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, len);
      const al = 0.35 + R() * 0.4;
      gr.addColorStop(0, `rgba(255,255,255,${al})`); gr.addColorStop(0.5, `rgba(255,255,255,${al * 0.45})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a - wd) * len, cy + Math.sin(a - wd) * len);
      g.lineTo(cx + Math.cos(a + wd) * len, cy + Math.sin(a + wd) * len);
      g.closePath(); g.fill();
    }
  });
}
/** spiral vortex arms (crisp, tapered, converging to the center) */
function swirlTex() {
  return ctex('portal:swirl2', 512, 512, (g, w, h) => {
    const cx = w / 2, cy = h / 2, RR = w * 0.49;
    g.clearRect(0, 0, w, h);
    const arms = 4;
    for (let a = 0; a < arms; a++) {
      const outer: [number, number][] = [], inner: [number, number][] = [];
      for (let i = 0; i <= 60; i++) {
        const t = i / 60;
        const th = a / arms * TAU + t * 2.4 * Math.PI;
        const r = RR * Math.pow(1 - t, 1.05) + 2;
        const wd = 0.5 * (1 - t) + 0.08;
        outer.push([cx + Math.cos(th + wd / 2) * r, cy + Math.sin(th + wd / 2) * r]);
        inner.push([cx + Math.cos(th - wd / 2) * r, cy + Math.sin(th - wd / 2) * r]);
      }
      g.beginPath();
      outer.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      for (let i = inner.length - 1; i >= 0; i--) g.lineTo(inner[i][0], inner[i][1]);
      g.closePath();
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, RR);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.85)'); gr.addColorStop(0.85, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fill();
    }
  });
}
/** magic circle: rings + rune letters + star */
function runeRingTex() {
  return ctex('portal:runering', 512, 512, (g, w, h) => {
    const cx = w / 2, cy = h / 2;
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#ffffff'; g.fillStyle = '#ffffff';
    g.shadowColor = 'rgba(255,255,255,0.9)'; g.shadowBlur = 8;
    g.lineWidth = 7; g.beginPath(); g.arc(cx, cy, 246, 0, TAU); g.stroke();
    g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, 232, 0, TAU); g.stroke();
    g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, 178, 0, TAU); g.stroke();
    g.lineWidth = 6; g.beginPath(); g.arc(cx, cy, 168, 0, TAU); g.stroke();
    g.font = `900 34px ${FONT_HEAD}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const txt = 'ЖИЛИ✦БЫЛИ✦В✦ТРИДЕВЯТОМ✦ЦАРСТВЕ✦';
    const n = txt.length;
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU;
      g.save(); g.translate(cx + Math.sin(a) * 205, cy - Math.cos(a) * 205); g.rotate(a);
      g.fillText(txt[i], 0, 0); g.restore();
    }
    // hexagram + inner circle
    g.lineWidth = 4;
    for (const off of [0, Math.PI / 3]) {
      g.beginPath();
      for (let i = 0; i <= 3; i++) { const a = off + i / 3 * TAU - Math.PI / 2; const x = cx + Math.cos(a) * 160, y = cy + Math.sin(a) * 160; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
    }
    g.beginPath(); g.arc(cx, cy, 80, 0, TAU); g.stroke();
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; sparkle4(g, cx + Math.cos(a) * 120, cy + Math.sin(a) * 120, 9, 0.3); g.fill(); }
  });
}
/** light shaft for the cones: v=1 (top, at the page) bright → transparent, several soft rays around U */
function shaftTex() {
  return ctex('portal:shaft', 256, 256, (g, w, h) => {
    const R = rng(9);
    const prof = new Float32Array(w);
    for (let i = 0; i < 9; i++) {
      const c = R() * w, wd = 6 + R() * 18, a = 0.4 + R() * 0.6;
      for (let x = 0; x < w; x++) {
        for (const o of [-w, 0, w]) { const d = (x - c - o) / wd; prof[x] += a * Math.exp(-d * d); }
      }
    }
    for (let x = 0; x < w; x++) {
      const v = Math.min(1, 0.18 + prof[x]);
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.08, `rgba(255,255,255,${v})`); gr.addColorStop(0.45, `rgba(255,255,255,${v * 0.35})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x, 0, 1, h);
    }
  }, true);
}
/** vertical flowing streaks for the light "pouring" down over the bookrest (tiles in V) */
function pourTex() {
  return ctex('portal:pour', 128, 256, (g, w, h) => {
    const R = rng(31);
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      const x = R() * w, wd = 3 + R() * 9, y = R() * h, len = 40 + R() * 120, a = 0.25 + R() * 0.5;
      for (const oy of [-h, 0, h]) {
        const gr = g.createLinearGradient(0, y + oy, 0, y + oy + len);
        gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(x - wd / 2, y + oy, wd, len);
      }
    }
    // soft side fade
    g.globalCompositeOperation = 'destination-in';
    const sg = g.createLinearGradient(0, 0, w, 0);
    sg.addColorStop(0, 'rgba(0,0,0,0)'); sg.addColorStop(0.2, 'rgba(0,0,0,1)'); sg.addColorStop(0.8, 'rgba(0,0,0,1)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sg; g.fillRect(0, 0, w, h);
  }, true);
}

// ───────────────────────── geometry helpers ─────────────────────────

/** open-book page profile (0 = gutter … 1 = fore-edge), 1 = full thickness */
function pageProfile(u: number) {
  if (u < 0.28) return 0.48 + 0.52 * Math.sin((u / 0.28) * Math.PI / 2);
  return 1 - 0.3 * Math.pow((u - 0.28) / 0.72, 1.5);
}

/** Page block of one half (side +1 = right, −1 = left) in half-local space (hinge at the origin, pages z ≤ 0). */
function pageBlock(side: 1 | -1, region: number) {
  const NU = 22;
  const xi = 0.03, xo = W - 0.15, y0 = 0.2, y1 = H - 0.2;
  const nFront = (NU + 1) * 2, nTop = (NU + 1) * 2, nBot = (NU + 1) * 2, nEdge = 4;
  const count = nFront + nTop + nBot + nEdge;
  const pos = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  const idx: number[] = [];
  const pr = pageRect(region);
  const xs: number[] = [];
  for (let i = 0; i <= NU; i++) {
    const t = i / NU;
    xs.push(side > 0 ? lerp(xi, xo, t) : lerp(-xo, -xi, t));
  }
  const uOf = (i: number) => (side > 0 ? i / NU : 1 - i / NU); // 0 at gutter
  const oF = 0, oT = nFront, oB = nFront + nTop, oE = nFront + nTop + nBot;
  for (let i = 0; i <= NU; i++) {
    const tu = lerp(pr.u0, pr.u1, i / NU);
    uv.set([tu, 0.012, tu, 0.988], (oF + i * 2) * 2);
    const eu = lerp(EDGE_U0, EDGE_U1, uOf(i));
    uv.set([eu, 1, eu, 0], (oT + i * 2) * 2);
    uv.set([eu, 1, eu, 0], (oB + i * 2) * 2);
  }
  uv.set([EDGE_U0, 0, EDGE_U0, 1, EDGE_U1, 0, EDGE_U1, 1], oE * 2);
  for (let i = 0; i < NU; i++) {
    const a = oF + i * 2, b2 = a + 2;
    idx.push(a, b2, b2 + 1, a, b2 + 1, a + 1); // front (+z): bottom row j=0, top row j=1
    const k = oT + i * 2; // top: [front, back] pairs, normal +y
    idx.push(k + 1, k, k + 2, k + 1, k + 2, k + 3);
    const q = oB + i * 2; // bottom, normal −y
    idx.push(q + 1, q + 2, q, q + 1, q + 3, q + 2);
  }
  // fore-edge: A(back,y0) B(front,y0) C(back,y1) D(front,y1)
  if (side > 0) idx.push(oE, oE + 3, oE + 1, oE, oE + 2, oE + 3);
  else idx.push(oE, oE + 1, oE + 3, oE, oE + 3, oE + 2);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  let last = -1;
  const shape = (bulge: number) => {
    if (Math.abs(bulge - last) < 0.002) return;
    last = bulge;
    for (let i = 0; i <= NU; i++) {
      const zf = -P + P * lerp(1, pageProfile(uOf(i)), bulge);
      const x = xs[i];
      pos.set([x, y0, zf, x, y1, zf], (oF + i * 2) * 3);
      pos.set([x, y1, zf, x, y1, -P], (oT + i * 2) * 3);
      pos.set([x, y0, zf, x, y0, -P], (oB + i * 2) * 3);
    }
    const ze = -P + P * lerp(1, pageProfile(1), bulge), xe = side * xo;
    pos.set([xe, y0, -P, xe, y0, ze, xe, y1, -P, xe, y1, ze], oE * 3);
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  };
  shape(0);
  return { geo, shape };
}

/** gold corner protector (triangular prism) wrapping a cover corner; corner at the origin, legs along −x/+y etc. */
const cornerGeo = () => cg('portal:corner', () => {
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(0.75, 0); s.quadraticCurveTo(0.3, 0.3, 0, 0.75); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: C + 0.07, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.03, bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, -(C + 0.07) / 2);
  return g;
});

// ───────────────────────── particles (one draw call) ─────────────────────────

const PT_VERT = /* glsl */`
attribute float size;
attribute float alpha;
attribute float glyph;
attribute float rot;
attribute vec3 tint;
uniform float uViewH;
uniform float uScale;
varying float vAlpha;
varying float vGlyph;
varying float vRot;
varying vec3 vTint;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(size * uScale * uViewH * 0.5 * projectionMatrix[1][1] / max(0.2, -mv.z), 0.0, 256.0);
  vAlpha = alpha; vGlyph = glyph; vRot = rot; vTint = tint;
}`;
const PT_FRAG = /* glsl */`
uniform sampler2D uAtlas;
varying float vAlpha;
varying float vGlyph;
varying float vRot;
varying vec3 vTint;
void main() {
  if (vAlpha < 0.004) discard;
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) * 1.05 + 0.5;
  if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) discard;
  float gi = floor(vGlyph + 0.5);
  vec2 cell = vec2(mod(gi, 4.0), 3.0 - floor(gi / 4.0));
  vec4 t = texture2D(uAtlas, (vec2(p.x, 1.0 - p.y) + cell) / 4.0);
  gl_FragColor = vec4(vTint * t.rgb, t.a * vAlpha);
}`;

interface Pt { kind: 0 | 1 | 2; life: number; ph: number; prev: number; r0: number; a0: number; z0: number; turns: number; size: number; spin: number; sx: number; sy: number }

// ───────────────────────── the portal ─────────────────────────

export interface MagicBookPortal extends Built {
  /** target openness 0..1 (eases toward it); instant = jump there now */
  open(k: number, instant?: boolean): void;
  /** world-space center of the exit trigger (in front of the pages) */
  pageCenter: THREE.Vector3;
  /** trigger radius (world units) */
  radius: number;
}

export function magicBookPortal(o: { x: number; y: number; z: number; rotY?: number; s?: number }): MagicBookPortal {
  const s = o.s ?? 1;
  const b = new B('magicBookPortal');
  const S = b.group();
  S.scale.setScalar(s);
  const R = rng(4242);

  // ── materials
  const wood = tmat(woodGrainTex('warm'));
  const woodD = tmat(woodGrainTex('dark'));
  const woodR = tmat(woodGrainTex('red'));
  const gold = tmat(null, GOLD);
  const goldD = tmat(null, '#c8901a');
  const leather = tmat(null, COVER);
  const leatherD = tmat(null, shade(COVER, -0.3));
  const coverArt = tmat(tomeCoverTex());
  const pageTex = pageAtlasTex();
  const pageM = matU('#ffffff', { map: pageTex, emissive: '#ffe6a0', emissiveIntensity: 0 });
  pageM.emissiveMap = pageTex;
  const looseM = matU('#ffffff', { map: pageTex, emissive: '#ffe6a0', emissiveIntensity: 0, side: THREE.DoubleSide });
  looseM.emissiveMap = pageTex;
  const gemM = matU('#e8304a', { emissive: '#ff2a55', emissiveIntensity: 0.25 });
  const runner = tmat(rugTex('#a8243a'));

  // ── base: stair + dais (the step the hero jumps from)
  const p = { parent: S };
  b.m(new RoundedBoxGeometry(5.2, 0.6, 1.0, 2, 0.08), woodD, 0, 0.3, 3.1, p);
  b.m(new RoundedBoxGeometry(7.4, 1.2, 4.8, 2, 0.1), woodD, 0, 0.6, 0.2, p);
  b.bx(gold, 7.44, 0.1, 0.1, 0, 1.17, 2.6, 0, p);
  b.bx(gold, 0.1, 0.1, 4.84, 3.7, 1.17, 0.2, 0, p);
  b.bx(gold, 0.1, 0.1, 4.84, -3.7, 1.17, 0.2, 0, p);
  b.bx(gold, 5.24, 0.08, 0.08, 0, 0.57, 3.6, 0, p);
  // carved panels on the dais front & sides (+ gold studs)
  for (const sx of [-1, 1]) {
    b.m(new RoundedBoxGeometry(2.1, 0.55, 0.1, 2, 0.04), woodR, sx * 2.45, 0.88, 2.6, p);
    for (const dx of [-0.85, 0.85]) b.sp(gold, 0.07, sx * 2.45 + dx, 0.88, 2.66, 8, p);
    b.m(new RoundedBoxGeometry(0.1, 0.62, 3.8, 2, 0.04), woodR, sx * 3.7, 0.62, 0.2, p);
    b.sp(gold, 0.16, sx * 3.73, 0.62, 0.2, 10, { ...p, sx: 0.07 });
  }
  b.m(new RoundedBoxGeometry(3.7, 0.3, 0.1, 2, 0.04), woodR, 0, 0.3, 3.6, p);
  // royal runner over the stairs
  b.bx(runner, 2.2, 0.03, 1.0, 0, 0.615, 3.1, 0, p);
  b.bx(runner, 2.2, 0.6, 0.03, 0, 0.3, 3.615, 0, p);
  b.bx(runner, 2.2, 0.6, 0.03, 0, 0.9, 2.615, 0, p);
  b.bx(runner, 2.2, 0.03, 2.1, 0, 1.215, 1.55, 0, p);
  // lectern column (carved baluster)
  const col = latheV([[0, 0, 0], [0.95, 0, 0.05, 1], [0.95, 0.14, 0.1], [0.72, 0.24, 0.15], [0.5, 0.4, 0.25], [0.62, 0.55, 0.35], [0.82, 0.75, 0.5], [0.64, 0.98, 0.65], [0.42, 1.12, 0.75], [0.55, 1.24, 0.85], [0.9, 1.34, 0.95], [0.9, 1.42, 1, 1], [0, 1.42, 1]], 28);
  b.m(col, wood, 0, 1.2, -0.45, p);
  b.m(cg('portal:ring', () => new THREE.TorusGeometry(1, 0.06, 6, 28)), gold, 0, 1.2 + 0.75, -0.45, { ...p, rx: Math.PI / 2, s: 0.82 });
  // scroll brackets
  for (const sx of [-1, 1]) {
    b.m(cg('portal:scroll', () => new THREE.TorusGeometry(0.42, 0.12, 8, 22, Math.PI * 1.45)), wood, sx * 1.15, 2.2, -0.35, { ...p, rz: sx > 0 ? -0.3 : Math.PI + 0.3, sz: 2.2 });
    b.sp(gold, 0.13, sx * 1.15, 2.2, -0.08, 10, p);
  }
  // bookrest + lip
  b.m(new RoundedBoxGeometry(5.4, 0.36, 2.0, 2, 0.08), wood, 0, 2.77, -0.5, p);
  b.bx(gold, 5.44, 0.08, 0.08, 0, 2.62, 0.5, 0, p);
  b.m(new RoundedBoxGeometry(5.4, 0.3, 0.2, 2, 0.06), woodD, 0, 3.02, 0.4, p);
  for (const sx of [-1, 1]) b.sp(gold, 0.16, sx * 2.72, 2.8, 0.42, 10, p);
  // gold medallion under the lip
  b.m(cg('portal:disc', () => new THREE.CylinderGeometry(1, 1, 1, 24)), gold, 0, 2.62, 0.55, { ...p, rx: Math.PI / 2, sx: 0.32, sy: 0.08, sz: 0.32 });
  b.m(cg('portal:gem', () => new THREE.OctahedronGeometry(1, 0)), tmat(null, '#3aa0e8', { emissive: '#2a80d8', emissiveIntensity: 0.35 }), 0, 2.62, 0.62, { ...p, s: 0.14, sz: 0.07 });

  // ── colliders (scaled)
  const k = s;
  b.box(-2.6 * k, 0, 2.6 * k, 2.6 * k, 0.6 * k, 3.6 * k);
  b.box(-3.7 * k, 0, -2.2 * k, 3.7 * k, 1.2 * k, 2.6 * k);
  b.cyl(0, -0.45 * k, 0.85 * k, 1.2 * k, 2.6 * k);
  b.box(-2.7 * k, 2.6 * k, -1.5 * k, 2.7 * k, BOOK_Y * k, 0.5 * k);
  b.box(-3.7 * k, BOOK_Y * k, -1.75 * k, 3.7 * k, (BOOK_Y + H + 0.4) * k, -1.1 * k);
  const closedCol: BoxCol = b.box(-1.9 * k, BOOK_Y * k, -1.1 * k, 1.9 * k, (BOOK_Y + H) * k, 0.25 * k);

  // ── the book
  const book = b.group(0, BOOK_Y, PIVOT_Z, S, true);
  book.rotation.x = -TILT;
  const slide = b.group(0, 0, 0, book, true);
  const halfR = b.group(0, 0, 0, slide, true);
  const halfL = b.group(0, 0, 0, slide, true);
  const coverGeo = new RoundedBoxGeometry(W, H, C, 2, 0.06);
  for (const [half, sd] of [[halfR, 1], [halfL, -1]] as const) {
    b.m(coverGeo, leather, sd * W / 2, H / 2, -P - C / 2, { parent: half });
    // inner cover lining (thin dark board visible around the pages)
    b.bx(leatherD, W - 0.12, H - 0.12, 0.02, sd * W / 2, H / 2, -P + 0.005, 0, { parent: half });
    // gold corners on the outer edge
    for (const top of [0, 1]) {
      b.m(cornerGeo(), gold, sd * W, top ? H : 0, -P - C / 2, { parent: half, rz: sd > 0 ? (top ? Math.PI : Math.PI / 2) : (top ? -Math.PI / 2 : 0) });
    }
    // gold edge bands along the spine side
    for (const yy of [0.06, H - 0.06]) b.bx(goldD, 0.5, 0.12, C + 0.05, sd * 0.32, yy, -P - C / 2, 0, { parent: half });
  }
  const pagesR = pageBlock(1, 1), pagesL = pageBlock(-1, 0);
  b.m(pagesR.geo, pageM, 0, 0, 0, { parent: halfR, keep: true });
  b.m(pagesL.geo, pageM, 0, 0, 0, { parent: halfL, keep: true });
  // front cover art & medallion (left half outer face)
  const fz = -P - C - 0.012;
  b.m(cg('portal:plane', () => new THREE.PlaneGeometry(1, 1)), coverArt, -W / 2, H / 2, fz, { parent: halfL, ry: Math.PI, sx: W - 0.14, sy: H - 0.14, cast: false });
  const med = b.group(-W / 2, H / 2, fz, halfL);
  med.rotation.y = Math.PI;
  b.m(cg('portal:disc', () => new THREE.CylinderGeometry(1, 1, 1, 24)), gold, 0, 0, 0.06, { parent: med, rx: Math.PI / 2, sx: 0.92, sy: 0.12, sz: 0.92 });
  b.m(cg('portal:ring2', () => new THREE.TorusGeometry(1, 0.08, 8, 32)), goldD, 0, 0, 0.13, { parent: med, s: 0.78 });
  const starG = cg('portal:star', () => {
    const sh = new THREE.Shape();
    for (let i = 0; i < 16; i++) { const a = Math.PI / 2 + i / 16 * TAU, r = i % 2 ? 0.3 : 1; if (i) sh.lineTo(Math.cos(a) * r, Math.sin(a) * r); else sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    sh.closePath();
    return new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
  });
  b.m(starG, gold, 0, 0, 0.12, { parent: med, s: 0.62 });
  b.m(cg('portal:gem', () => new THREE.OctahedronGeometry(1, 0)), gemM, 0, 0, 0.26, { parent: med, s: 0.3, sz: 0.16, keep: true });
  // clasp strap (right half): wraps the fore-edge onto the front cover
  const clasp = b.group(W + 0.02, H * 0.5, -P - C, halfR, true);
  const cl = 2 * (P + C) + 0.06;
  b.bx(leatherD, 0.06, 0.9, cl, 0.03, 0, cl / 2, 0, { parent: clasp });
  b.bx(leatherD, 0.75, 0.9, 0.06, -0.35, 0, cl + 0.01, 0, { parent: clasp });
  b.m(new RoundedBoxGeometry(0.46, 0.6, 0.08, 2, 0.03), gold, -0.42, 0, cl + 0.06, { parent: clasp });
  b.m(cg('portal:keyhole', () => new THREE.CylinderGeometry(1, 1, 1, 12)), tmat(null, '#2a1b1a'), -0.42, 0.05, cl + 0.1, { parent: clasp, rx: Math.PI / 2, sx: 0.07, sy: 0.04, sz: 0.07 });
  b.bx(tmat(null, '#2a1b1a'), 0.05, 0.14, 0.04, -0.42, -0.07, cl + 0.1, 0, { parent: clasp });
  // spine (rebuilt when the opening angle changes)
  const spineMesh = b.m(new THREE.BufferGeometry(), leather, 0, 0, 0, { parent: slide, keep: true, dyn: true });
  const spineBand = b.m(new THREE.BufferGeometry(), gold, 0, 0, 0, { parent: slide, keep: true, dyn: true });
  let lastD = -1;
  const spineProfile: [number, number, number][] = [[P, 0, 0], [P + C, 0, 0], [P + C, 0, 0], [P + C, H, 1], [P + C, H, 1], [P, H, 1], [P, H, 1], [P, 0, 0]];
  const bandProfile: [number, number, number][] = [];
  for (const yy of [1.1, 2.0, H - 2.0, H - 1.1]) bandProfile.push([P + C - 0.01, yy - 0.14, 0], [P + C + 0.05, yy - 0.1, 0], [P + C + 0.05, yy + 0.1, 0], [P + C - 0.01, yy + 0.14, 0]);
  const setSpine = (d: number, m: number) => {
    spineMesh.rotation.y = m; spineBand.rotation.y = m;
    if (Math.abs(d - lastD) < 0.003) return;
    lastD = d;
    const mk = (pr: [number, number, number][]) => new THREE.LatheGeometry(pr.map((q) => new THREE.Vector2(q[0], q[1])), 14, Math.PI - d / 2, d);
    spineMesh.geometry.dispose(); spineMesh.geometry = mk(spineProfile);
    spineBand.geometry.dispose();
    const bg: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) bg.push(new THREE.LatheGeometry(bandProfile.slice(i * 4, i * 4 + 4).map((q) => new THREE.Vector2(q[0], q[1])), 14, Math.PI - d / 2, d));
    const merged = new THREE.BufferGeometry();
    // tiny manual merge (same attribute layout)
    let n = 0; for (const g of bg) n += g.attributes.position.count;
    const pa = new Float32Array(n * 3), na = new Float32Array(n * 3), ua = new Float32Array(n * 2); const ia: number[] = [];
    let off = 0;
    for (const g of bg) {
      pa.set(g.attributes.position.array as Float32Array, off * 3); na.set(g.attributes.normal.array as Float32Array, off * 3); ua.set(g.attributes.uv.array as Float32Array, off * 2);
      const gi = g.index!.array; for (let i = 0; i < gi.length; i++) ia.push(gi[i] + off);
      off += g.attributes.position.count; g.dispose();
    }
    merged.setAttribute('position', new THREE.BufferAttribute(pa, 3)); merged.setAttribute('normal', new THREE.BufferAttribute(na, 3)); merged.setAttribute('uv', new THREE.BufferAttribute(ua, 2)); merged.setIndex(ia);
    spineBand.geometry = merged;
  };

  // loose fluttering pages: front side shows the right page, back side the left page, so a flip
  // starts and ends looking exactly like the static pages (seamless riffling)
  const NU = 10, NV = 3;
  const XI = 0.03, XO = W - 0.15, PY0 = 0.2, PY1 = H - 0.2;
  interface Loose { meshes: THREE.Mesh[]; pos: Float32Array; geo: THREE.BufferGeometry; ph: number; sp: number }
  const loose: Loose[] = [];
  const rR = pageRect(1), rL = pageRect(0);
  const looseBackM = looseM.clone();
  looseBackM.side = THREE.BackSide;
  looseM.side = THREE.FrontSide;
  for (let i = 0; i < 4; i++) {
    const geo = new THREE.BufferGeometry();
    const n = (NU + 1) * (NV + 1);
    const pos = new Float32Array(n * 3), uvF = new Float32Array(n * 2), uvB = new Float32Array(n * 2);
    const idx: number[] = [];
    for (let v = 0; v <= NV; v++) for (let u = 0; u <= NU; u++) {
      const q = v * (NU + 1) + u, vv = lerp(0.012, 0.988, v / NV);
      uvF[q * 2] = lerp(rR.u0, rR.u1, u / NU); uvF[q * 2 + 1] = vv;
      uvB[q * 2] = lerp(rL.u1, rL.u0, u / NU); uvB[q * 2 + 1] = vv;
      if (u < NU && v < NV) idx.push(q, q + 1, q + NU + 2, q, q + NU + 2, q + NU + 1);
    }
    const pa = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', pa);
    geo.setAttribute('uv', new THREE.BufferAttribute(uvF, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const geoB = new THREE.BufferGeometry();
    geoB.setAttribute('position', pa);
    geoB.setAttribute('normal', geo.attributes.normal);
    geoB.setAttribute('uv', new THREE.BufferAttribute(uvB, 2));
    geoB.setIndex(geo.index);
    const meshes = [b.m(geo, looseM, 0, 0, 0, { parent: slide, keep: true, dyn: true, cast: false }), b.m(geoB, looseBackM, 0, 0, 0, { parent: slide, keep: true, dyn: true, cast: false })];
    for (const me of meshes) { me.visible = false; me.frustumCulled = false; }
    loose.push({ meshes, pos, geo, ph: i / 4 + R() * 0.05, sp: rr(R, 0.85, 1.15) });
  }
  const bendPage = (L: Loose, q: number, bulge: number, t: number) => {
    const { pos } = L;
    const theta = lerp(-V_OPEN, V_OPEN - Math.PI, easeInOut(q));
    const lag = 1.15 * Math.sin(Math.PI * q);
    const flat = Math.cos(Math.PI * q);
    for (let v = 0; v <= NV; v++) {
      const fv = v / NV, y = lerp(PY0, PY1, fv);
      let x = XI * Math.cos(theta), z = -XI * Math.sin(theta);
      const wob = 1 + 0.35 * Math.sin(fv * Math.PI * 1.3 + t * 3 + L.ph * 9);
      for (let u = 0; u <= NU; u++) {
        const fu = u / NU;
        const phi = theta + lag * Math.pow(fu, 1.4) * wob;
        const off = flat * (0.03 - P * (1 - pageProfile(fu)) * bulge);
        const q3 = (v * (NU + 1) + u) * 3;
        pos[q3] = x + Math.sin(phi) * off; pos[q3 + 1] = y; pos[q3 + 2] = z + Math.cos(phi) * off;
        x += ((XO - XI) / NU) * Math.cos(phi);
        z -= ((XO - XI) / NU) * Math.sin(phi);
      }
    }
    (L.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    L.geo.computeVertexNormals();
  };

  // ── FX (all additive, no outline) — in book space, centered on the vortex
  const fx = b.group(0, FX_Y, 0.05, book, true);
  const plane = cg('portal:plane', () => new THREE.PlaneGeometry(1, 1));
  const addFx = (geo: THREE.BufferGeometry, color: string, map: THREE.Texture, sc: number, z: number, side: THREE.Side = THREE.FrontSide) => {
    const m = basic(color, { additive: true, map, side, fog: false, depthWrite: false });
    m.opacity = 0;
    const me = b.m(geo, m, 0, 0, z, { parent: fx, glow: true, dyn: true, s: sc, keep: true });
    me.visible = false;
    return { me, m };
  };
  const halo = addFx(plane, '#ffb83a', glowTex(), 1, 0.7); halo.me.scale.set(11, 13, 1);
  const core = addFx(plane, '#fff1c0', glowTex(), 4.2, 0.8);
  const rays1 = addFx(plane, '#ffc04a', raysTex(), 17, -1.3);
  const rays2 = addFx(plane, '#ffe8a8', raysTex(), 11, 0.75);
  const swirl1 = addFx(plane, '#ff7410', swirlTex(), 7.2, 0.85);
  swirl1.m.blending = THREE.NormalBlending;
  const swirl2 = addFx(plane, '#fff0b0', swirlTex(), 4.2, 0.9);
  const ring = addFx(plane, '#ffd25a', runeRingTex(), 7.6, 1.1, THREE.DoubleSide);
  const coneGeo = cg('portal:cone', () => new THREE.CylinderGeometry(2.3, 4.6, 7.5, 32, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 3.75));
  const shaft = shaftTex();
  const cones = [0, 1, 2].map((i) => {
    const c = addFx(coneGeo, i === 1 ? '#fff0c0' : '#ffc850', shaft, 1, 0.6, THREE.DoubleSide);
    c.me.rotation.x = 0.16 + i * 0.07; c.me.rotation.y = (i - 1) * 0.1;
    c.me.scale.set(1 - i * 0.12, 1 - i * 0.12, 1 + i * 0.1);
    return c;
  });
  // light pouring down over the bookrest & dais
  const pourGeo = cg('portal:pourGeo', () => {
    // bent ribbon: from the page bottom forward and down to the dais
    const g = new THREE.PlaneGeometry(1, 1, 1, 12);
    const pa = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) {
      const v = pa.getY(i) + 0.5; // 1 = top
      const t = 1 - v;
      pa.setXYZ(i, pa.getX(i) * (1 + t * 0.5), -t * 2.4, Math.sin(t * Math.PI * 0.5) * 2.2);
    }
    g.computeVertexNormals();
    return g;
  });
  const pourTx = pourTex().clone(); pourTx.needsUpdate = true; pourTx.wrapS = pourTx.wrapT = THREE.RepeatWrapping; pourTx.repeat.set(2, 1);
  const pour = (() => {
    const m = basic('#ffcf5a', { additive: true, map: pourTx, side: THREE.DoubleSide, fog: false, depthWrite: false });
    m.opacity = 0;
    const me = b.m(pourGeo, m, 0, 0.35, 0.15, { parent: book, glow: true, dyn: true, keep: true, sx: 6.4, sy: 1, sz: 1 });
    me.visible = false;
    return { me, m };
  })();
  // floor magic circle on the dais
  const floorRing = (() => {
    const m = basic('#ffcc4a', { additive: true, map: runeRingTex(), fog: false, depthWrite: false });
    m.opacity = 0;
    const me = b.m(plane, m, 0, 1.235, 1.45, { parent: S, glow: true, dyn: true, keep: true, rx: -Math.PI / 2, s: 4.1 });
    me.visible = false;
    return { me, m };
  })();
  const fxAll = [halo, core, rays1, rays2, swirl1, swirl2, ring, ...cones];

  // particles: glyphs & sparkles spiralling into the pages, motes drifting out
  const pts: Pt[] = [];
  const counts: [0 | 1 | 2, number][] = [[0, 34], [1, 50], [2, 40]];
  for (const [kind, n] of counts) for (let i = 0; i < n; i++) {
    pts.push({ kind, life: kind === 0 ? rr(R, 2.6, 4.2) : kind === 1 ? rr(R, 1.6, 2.8) : rr(R, 2.2, 3.6), ph: R(), prev: 0, r0: 0, a0: 0, z0: 0, turns: 0, size: 0, spin: rr(R, -1.5, 1.5), sx: 0, sy: 0 });
  }
  const NP = pts.length;
  const pPos = new Float32Array(NP * 3), pSize = new Float32Array(NP), pAlpha = new Float32Array(NP), pGlyph = new Float32Array(NP), pRot = new Float32Array(NP), pTint = new Float32Array(NP * 3);
  const respawn = (q: Pt, i: number) => {
    if (q.kind === 2) { q.sx = rr(R, -2.9, 2.9); q.sy = rr(R, -3.6, 3.8); q.size = rr(R, 0.18, 0.42); pGlyph[i] = [10, 11, 14][Math.floor(R() * 3)]; return; }
    q.a0 = R() * TAU;
    q.sy = rr(R, -4.4, 4.4);
    q.r0 = q.kind === 0 ? rr(R, 3.6, 7.2) : rr(R, 2.6, 6.4);
    q.z0 = q.kind === 0 ? rr(R, 1.2, 4.6) : rr(R, 0.4, 3.2);
    q.turns = rr(R, 0.6, 1.4);
    q.size = q.kind === 0 ? rr(R, 0.6, 1.0) : rr(R, 0.22, 0.5);
    pGlyph[i] = q.kind === 0 ? Math.floor(R() * 10) : [10, 11, 12, 14, 13][Math.floor(R() * 5)];
  };
  const tmpC = new THREE.Color();
  pts.forEach((q, i) => {
    respawn(q, i);
    tmpC.set(q.kind === 0 ? (R() < 0.3 ? '#fff0b0' : '#ffc83a') : R() < 0.5 ? '#fff6dc' : '#ffd86a');
    pTint.set([tmpC.r * 1.6, tmpC.g * 1.6, tmpC.b * 1.6], i * 3);
  });
  const pGeo = new THREE.BufferGeometry();
  const dyn = (a: Float32Array, n: number) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
  pGeo.setAttribute('position', dyn(pPos, 3));
  pGeo.setAttribute('size', dyn(pSize, 1));
  pGeo.setAttribute('alpha', dyn(pAlpha, 1));
  pGeo.setAttribute('glyph', dyn(pGlyph, 1));
  pGeo.setAttribute('rot', dyn(pRot, 1));
  pGeo.setAttribute('tint', new THREE.BufferAttribute(pTint, 3));
  const pMat = new THREE.ShaderMaterial({
    uniforms: { uAtlas: { value: glyphAtlasTex() }, uViewH: { value: 800 }, uScale: { value: s } },
    vertexShader: PT_VERT, fragmentShader: PT_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  points.userData.dyn = true;
  points.renderOrder = 3;
  const vp = new THREE.Vector4();
  points.onBeforeRender = (renderer) => { renderer.getCurrentViewport(vp); pMat.uniforms.uViewH.value = vp.w; };
  fx.add(points);
  noOutline(points);

  // the one light
  const LIGHT_BASE = 24;
  const light = b.light('#ffc25a', 0, 24 * s, 1.3, 0, 5.2, 4.4, S);

  // ── animation
  let target = 0, cur = 0;
  const RATE = 1 / 1.6;
  const update = (t: number, dt: number) => {
    dt = Math.min(dt, 0.1);
    cur += clamp(target - cur, -RATE * dt, RATE * dt);
    const kk = cur;
    const shake = Math.sin(Math.PI * seg(kk, 0.0, 0.16)) * (kk < 0.16 ? 1 : 0);
    const unlatch = smooth(seg(kk, 0.03, 0.2));
    const e = easeInOut(seg(kk, 0.1, 0.68));
    const settle = Math.sin(Math.PI * seg(kk, 0.6, 0.86)) * 0.07;
    const bulge = smooth(seg(kk, 0.3, 0.8));
    const glow = smooth(seg(kk, 0.04, 0.6));
    const aura = smooth(seg(kk, 0.42, 1));
    const lift = smooth(seg(kk, 0.15, 0.85));

    // book transform
    const bob = Math.sin(t * 1.3) * 0.06 * lift;
    book.position.y = BOOK_Y + HOVER * lift + bob;
    book.rotation.x = -TILT + shake * 0.025 * Math.sin(t * 61);
    book.rotation.z = shake * 0.02 * Math.sin(t * 47) + Math.sin(t * 0.9) * 0.008 * lift;
    slide.position.x = -W / 2 * (1 - e);
    const thL = lerp(Math.PI, V_OPEN, e) - settle, thR = lerp(0, -V_OPEN, e) + settle * 0.3;
    halfL.rotation.y = thL;
    halfR.rotation.y = thR;
    setSpine(thL - thR, (thL + thR) / 2);
    // strap flips outward and around the fore-edge, ending flat on the back cover
    clasp.rotation.set(Math.sin(Math.PI * unlatch) * 0.45, unlatch * (1.5 * Math.PI - 0.04), 0, 'YXZ');
    pagesR.shape(bulge); pagesL.shape(bulge);
    closedCol.active = kk < 0.4;

    // glow on paper & gem
    const pulse = 0.88 + 0.12 * Math.sin(t * 3.1) + 0.05 * Math.sin(t * 7.3);
    // glowing paper: crossfade from lit paper to self-lit (keeps it below white so text & the swirl stay readable)
    pageM.emissiveIntensity = Math.pow(glow, 0.6) * 0.95 * pulse;
    pageM.color.setScalar(1 - 0.8 * glow * glow);
    for (const m of [looseM, looseBackM]) { m.emissiveIntensity = pageM.emissiveIntensity; m.color.copy(pageM.color); }
    gemM.emissiveIntensity = 0.3 + 0.25 * Math.sin(t * 2.4) + glow * 1.2;

    // fluttering pages
    const fl = aura;
    const fast = Math.sin(Math.PI * seg(kk, 0.45, 0.95));
    for (const L of loose) {
      L.ph += dt * (0.42 + 0.9 * fast) * L.sp;
      const q = seg(L.ph % 1, 0, 0.62);
      const on = fl > 0.25 && q > 0 && q < 1;
      for (const me of L.meshes) me.visible = on;
      if (on) bendPage(L, q, bulge, t);
    }

    // fx
    const vis = aura > 0.003;
    for (const f of fxAll) f.me.visible = vis;
    pour.me.visible = vis; floorRing.me.visible = vis;
    halo.m.opacity = aura * (0.32 + 0.06 * Math.sin(t * 2.3));
    core.m.opacity = aura * (0.5 + 0.15 * Math.sin(t * 4.1));
    core.me.scale.setScalar(4.2 + 0.4 * Math.sin(t * 3.3));
    rays1.m.opacity = aura * 0.75; rays1.me.rotation.z = t * 0.1;
    rays2.m.opacity = aura * 0.22; rays2.me.rotation.z = -t * 0.19;
    rays1.me.scale.setScalar(17 * (0.92 + 0.08 * Math.sin(t * 1.7)));
    swirl1.m.opacity = aura * 0.8; swirl1.me.rotation.z = -t * 1.4;
    swirl2.m.opacity = aura * 0.7; swirl2.me.rotation.z = -t * 2.3 + 0.5;
    ring.m.opacity = aura * 0.5; ring.me.rotation.z = t * 0.35;
    cones.forEach((c, i) => { c.m.opacity = aura * (0.26 + 0.07 * Math.sin(t * (1.3 + i * 0.4) + i)); c.me.rotation.z = t * (0.25 + i * 0.13) * (i % 2 ? -1 : 1); });
    pour.m.opacity = aura * 0.4; pourTx.offset.y = t * 0.45;
    floorRing.m.opacity = aura * (0.5 + 0.12 * Math.sin(t * 2)); floorRing.me.rotation.z = -t * 0.25;

    // particles
    const inA = aura, idle = 0.25 + 0.75 * aura;
    for (let i = 0; i < NP; i++) {
      const q = pts[i];
      const f = ((t / q.life) + q.ph) % 1;
      if (f < q.prev) respawn(q, i);
      q.prev = f;
      let x: number, y: number, z: number, a: number, sz: number;
      if (q.kind === 2) {
        x = q.sx + Math.sin(f * 4 + q.ph * 20) * 0.5 * f;
        y = q.sy + f * 3.2;
        z = 0.25 + f * 2.6;
        a = Math.sin(Math.PI * f) * inA;
        sz = q.size * (1 - 0.5 * f);
      } else {
        const rf = Math.pow(1 - f, 1.25);
        const r = q.r0 * rf;
        const ang = q.a0 + q.turns * TAU * f * (1 + f);
        x = Math.cos(ang) * r; y = Math.sin(ang) * r * 0.92;
        z = q.z0 * (1 - f) * (1 - f) + 0.15;
        a = smooth(f / 0.15) * (1 - smooth((f - 0.82) / 0.18)) * (q.kind === 0 ? inA : idle);
        sz = q.size * (0.3 + 0.7 * Math.sqrt(1 - f));
        if (q.kind === 1 && aura < 0.3) { // idle shimmer orbiting the closed book
          const w = smooth(aura / 0.3), oa = q.a0 + t * 0.5;
          x = lerp(Math.cos(oa) * 2.5, x, w); y = lerp(q.sy + Math.sin(t * 0.8 + q.a0) * 0.4, y, w); z = lerp(Math.sin(oa) * 1.3, z, w);
          a = lerp(Math.sin(Math.PI * f) * 0.5, a, w);
        }
      }
      pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
      pAlpha[i] = a; pSize[i] = sz;
      pRot[i] = q.spin * t + (q.kind === 0 ? Math.sin(t * 2 + i) * 0.3 : 0);
    }
    for (const n of ['position', 'size', 'alpha', 'glyph', 'rot']) (pGeo.attributes[n] as THREE.BufferAttribute).needsUpdate = true;

    // light
    const flick = 0.9 + 0.06 * Math.sin(t * 7.7) + 0.04 * Math.sin(t * 13.1);
    light.intensity = LIGHT_BASE * (0.12 * glow + 0.88 * aura) * flick;
  };
  b.update(update);
  update(0, 0);

  const built = b.done(o.x, o.y, o.z, (o.rotY ?? 0) / (Math.PI / 2));
  // trigger center: book-local (0, TRIG_Y, 0.6) with the open pose (hover, tilt)
  const lc = new THREE.Vector3(0, TRIG_Y, 0.6).applyEuler(new THREE.Euler(-TILT, 0, 0));
  lc.add(new THREE.Vector3(0, BOOK_Y + HOVER, PIVOT_Z)).multiplyScalar(s);
  const pageCenter = lc.applyMatrix4(built.obj.matrix);
  return Object.assign(built, {
    open(kv: number, instant = false) { target = clamp(kv, 0, 1); if (instant) cur = target; },
    pageCenter,
    radius: TRIG_R * s,
  });
}

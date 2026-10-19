import { TAU, mix, clamp, ease } from '../engine/util';
import { OUT, circle, ellipse, rrect, limb, limbQ, line, fillStroke, rrPath } from './draw';

type C = CanvasRenderingContext2D;

const fl = (col: string, f?: number) => (f && f > 0.05 ? mix(col, '#ffffff', Math.round(Math.min(1, f) * 4) / 4) : col);

// ───────────────────────────── HERO (Тоша) ─────────────────────────────
export const HERO = {
  skin: '#ffd9b3', skinD: '#efbf94', beanie: '#ff8a2a', band: '#e0621a', pom: '#fff3da',
  scarf: '#e8383d', scarfD: '#b8242c', shirt: '#3fb8a8', shirtD: '#2f8f84', shorts: '#6b4a3a', boot: '#4a2f25',
};

export type HeroState = 'idle' | 'run' | 'walk' | 'jump' | 'fall' | 'hurt' | 'dash' | 'grabbed' | 'dead' | 'sit' | 'tumble' | 'cheer' | 'lookUp' | 'sneak';
export type HeroExpr = 'normal' | 'happy' | 'angry' | 'scared' | 'surprised' | 'hurt' | 'sleepy';

export interface HeroPose {
  t: number;
  facing: number;
  state: HeroState;
  phase?: number;
  sx?: number; sy?: number; rot?: number;
  atk?: { kind: 'sword' | 'fork' | 'sling' | 'pogo'; p: number; alt?: boolean } | null;
  weapon?: 'sword' | 'fork' | 'none';
  flash?: number;
  alpha?: number;
  wind?: number;
  expr?: HeroExpr;
  talk?: number;
  look?: number;
}

function drawSword(ctx: C, hx: number, hy: number, ang: number, f?: number) {
  ctx.save(); ctx.translate(hx, hy); ctx.rotate(ang);
  rrect(ctx, -6, -2.2, 8, 4.4, 2, fl('#5a3520', f), 2);
  // blade
  ctx.beginPath(); ctx.moveTo(2, -3.2); ctx.lineTo(28, -3.2); ctx.lineTo(34, 0); ctx.lineTo(28, 3.2); ctx.lineTo(2, 3.2); ctx.closePath();
  fillStroke(ctx, fl('#e2b77a', f), 2.2);
  line(ctx, 5, -1, 27, -1, 'rgba(255,255,255,0.55)', 1.5);
  rrect(ctx, 0, -6.5, 4, 13, 1.5, fl('#8a5530', f), 2);
  ctx.restore();
}

function drawFork(ctx: C, hx: number, hy: number, ang: number, f?: number) {
  ctx.save(); ctx.translate(hx, hy); ctx.rotate(ang);
  rrect(ctx, -14, -2.4, 50, 4.8, 2.4, fl('#cdd6e2', f), 2);
  rrect(ctx, 34, -7, 7, 14, 3, fl('#cdd6e2', f), 2);
  for (const ty of [-5, 0, 5]) rrect(ctx, 39, ty - 1.4, 17, 2.8, 1.4, fl('#e8eef5', f), 1.6);
  line(ctx, -10, -0.8, 30, -0.8, 'rgba(255,255,255,0.6)', 1.2);
  ctx.restore();
}

function drawSling(ctx: C, hx: number, hy: number, pull: number) {
  ctx.save(); ctx.translate(hx, hy);
  limb(ctx, 0, 0, 0, 7, 3, '#8a5530', 1.5);
  limb(ctx, 0, 0, 3, -8, 3, '#8a5530', 1.5);
  limb(ctx, 0, 0, -2, -8, 3, '#8a5530', 1.5);
  ctx.strokeStyle = '#d23a3a'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(3, -8); ctx.lineTo(-4 - pull * 10, -4); ctx.lineTo(-2, -8); ctx.stroke();
  ctx.restore();
}

export function drawHero(ctx: C, x: number, y: number, s: number, p: HeroPose) {
  const t = p.t;
  const st = p.state;
  const ph = p.phase ?? 0;
  const F = p.flash;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s * p.facing, s);
  if (p.alpha !== undefined) ctx.globalAlpha = p.alpha;
  if (p.rot) { ctx.translate(0, -24); ctx.rotate(p.rot); ctx.translate(0, 24); }
  ctx.scale(p.sx ?? 1, p.sy ?? 1);

  let bob = 0, lean = 0, headTilt = 0;
  let fB = { x: -4, y: 0 }, fF = { x: 4, y: 0 };
  let hB = { x: -9, y: -15 }, hF = { x: 9, y: -15 };
  let wind = p.wind ?? 0;
  let expr: HeroExpr = p.expr ?? 'normal';
  switch (st) {
    case 'idle':
      bob = Math.sin(t * 3) * 0.8;
      hB = { x: -9, y: -14 + bob }; hF = { x: 9, y: -14 + bob };
      break;
    case 'run': case 'walk': case 'sneak': {
      const amp = st === 'run' ? 8 : st === 'sneak' ? 6 : 5;
      bob = -Math.abs(Math.sin(ph)) * (st === 'run' ? 2.5 : 1.2) + (st === 'sneak' ? 3 : 0);
      fF = { x: Math.sin(ph) * amp, y: -Math.max(0, Math.cos(ph)) * 5 };
      fB = { x: Math.sin(ph + Math.PI) * amp, y: -Math.max(0, Math.cos(ph + Math.PI)) * 5 };
      hF = { x: 4 - Math.sin(ph) * 8, y: -16 + bob }; hB = { x: -2 + Math.sin(ph) * 8, y: -16 + bob };
      if (st === 'sneak') { hF = { x: 12, y: -26 }; hB = { x: 6, y: -24 }; }
      lean = st === 'run' ? 0.13 : st === 'sneak' ? 0.22 : 0.04;
      if (st === 'run') wind = Math.max(wind, 0.8);
      break;
    }
    case 'jump': fF = { x: 5, y: -7 }; fB = { x: -5, y: -3 }; hF = { x: 11, y: -27 }; hB = { x: -11, y: -25 }; wind = Math.max(wind, 0.4); break;
    case 'fall': fF = { x: 6, y: -1 }; fB = { x: -6, y: -2 }; hF = { x: 12, y: -31 }; hB = { x: -12, y: -31 }; wind = Math.max(wind, 0.3); break;
    case 'hurt': lean = -0.25; fF = { x: 7, y: -3 }; fB = { x: -5, y: 0 }; hF = { x: 12, y: -29 }; hB = { x: -12, y: -27 }; expr = 'hurt'; break;
    case 'dash': lean = 0.4; fF = { x: -2, y: -4 }; fB = { x: -10, y: -2 }; hF = { x: -6, y: -18 }; hB = { x: -13, y: -16 }; wind = 1; expr = p.expr ?? 'angry'; break;
    case 'grabbed': {
      const k = Math.sin(t * 25);
      fF = { x: 6 + k * 4, y: -2 }; fB = { x: -6 - k * 4, y: -1 };
      hF = { x: 12, y: -31 + k * 5 }; hB = { x: -12, y: -31 - k * 5 };
      expr = 'scared'; break;
    }
    case 'cheer': hF = { x: 10, y: -36 }; hB = { x: -10, y: -36 }; bob = -Math.abs(Math.sin(t * 8)) * 3; expr = p.expr ?? 'happy'; break;
    case 'sit': fF = { x: 11, y: -3 }; fB = { x: 7, y: -2 }; bob = 7; hF = { x: 10, y: -10 }; hB = { x: -9, y: -8 }; break;
    case 'tumble': fF = { x: 7, y: -8 }; fB = { x: -7, y: -10 }; hF = { x: 13, y: -33 }; hB = { x: -13, y: -35 }; expr = p.expr ?? 'scared'; wind = 0.6; break;
    case 'lookUp': headTilt = -0.25; bob = Math.sin(t * 3) * 0.8; break;
    case 'dead': expr = 'hurt'; hF = { x: 12, y: -10 }; hB = { x: -12, y: -10 }; break;
  }

  // attack overrides front hand
  const atk = p.atk;
  let weaponDraw: (() => void) | null = null;
  const sh = { x: 2, y: -24 + bob };
  const weapon = p.weapon ?? 'sword';
  if (atk) {
    const k = clamp(atk.p, 0, 1);
    if (atk.kind === 'sword') {
      const e = ease.outCubic(clamp(k * 1.6, 0, 1));
      const a0 = atk.alt ? 1.0 : -2.3, a1 = atk.alt ? -2.0 : 1.0;
      const a = a0 + (a1 - a0) * e;
      hF = { x: sh.x + Math.cos(a) * 10, y: sh.y + Math.sin(a) * 10 };
      lean = 0.1 + 0.15 * Math.sin(k * Math.PI);
      if (k < 0.55) {
        const cur = a, start = a0 + (a1 - a0) * Math.max(0, e - 0.55);
        weaponDraw = () => {
          ctx.save();
          ctx.globalAlpha = (ctx.globalAlpha || 1) * (1 - k / 0.55) * 0.9;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          const aa = Math.min(start, cur), bb = Math.max(start, cur);
          ctx.arc(sh.x, sh.y, 44, aa, bb);
          ctx.arc(sh.x, sh.y, 26, bb, aa, true);
          ctx.closePath(); ctx.fill();
          ctx.restore();
          drawSword(ctx, hF.x, hF.y, a, F);
        };
      } else weaponDraw = () => drawSword(ctx, hF.x, hF.y, a, F);
    } else if (atk.kind === 'pogo') {
      const a = Math.PI / 2 + Math.sin(k * Math.PI) * 0.2;
      hF = { x: 4, y: -12 };
      fF = { x: 6, y: -8 }; fB = { x: -6, y: -9 };
      weaponDraw = () => {
        if (k < 0.5) {
          ctx.save(); ctx.globalAlpha = (1 - k * 2) * 0.85; ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(4, -10, 42, 0.5, Math.PI - 0.5); ctx.arc(4, -10, 26, Math.PI - 0.5, 0.5, true); ctx.closePath(); ctx.fill();
          ctx.restore();
        }
        drawSword(ctx, hF.x, hF.y, a, F);
      };
    } else if (atk.kind === 'fork') {
      const ext = k < 0.3 ? ease.outBack(k / 0.3) : 1 - ease.inOut((k - 0.3) / 0.7);
      hF = { x: 4 + ext * 16, y: -21 + bob };
      hB = { x: 0 + ext * 10, y: -20 + bob };
      lean = 0.18 * ext;
      weaponDraw = () => {
        if (ext > 0.6) {
          ctx.save(); ctx.globalAlpha = (ext - 0.6) * 2; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
          for (const dy of [-6, 0, 6]) { ctx.beginPath(); ctx.moveTo(hF.x + 10, hF.y + dy); ctx.lineTo(hF.x + 70, hF.y + dy * 0.5); ctx.stroke(); }
          ctx.restore();
        }
        drawFork(ctx, hF.x, hF.y, 0, F);
      };
    } else if (atk.kind === 'sling') {
      hF = { x: 15, y: -24 + bob };
      hB = { x: 6 - (1 - k) * 4, y: -24 + bob };
      weaponDraw = () => drawSling(ctx, hF.x, hF.y, Math.max(0, 1 - k * 3));
    }
  } else if (weapon !== 'none' && st !== 'dead' && st !== 'sit') {
    if (weapon === 'sword') {
      const a = st === 'run' ? -0.7 : st === 'dash' ? 2.6 : -1.15;
      weaponDraw = () => drawSword(ctx, hF.x, hF.y, a, F);
    } else {
      const a = st === 'dash' ? 0 : st === 'run' ? -0.25 : -0.6;
      weaponDraw = () => drawFork(ctx, hF.x - 4, hF.y, a, F);
    }
  }

  // scarf tail (behind)
  {
    const w = clamp(wind, 0, 1);
    const sx = -5, sy = -27 + bob;
    const ex = -9 - 17 * w, ey = -27 + bob + 15 * (1 - w) + Math.sin(t * 14) * 3 * w;
    const cx = -8 - 6 * w, cy = -22 + bob + Math.sin(t * 14 + 1) * 2 * w;
    limbQ(ctx, sx, sy, cx, cy, ex, ey, 5, fl(HERO.scarf, F), 2);
    limbQ(ctx, sx, sy + 2, cx - 2, cy + 3, ex + 3, ey + 4, 3.5, fl(HERO.scarfD, F), 2);
  }

  // back arm + back leg
  limb(ctx, -2, -11 + bob * 0.3, fB.x, fB.y - 3, 4.5, fl(HERO.skinD, F));
  ellipse(ctx, fB.x + 1.5, fB.y - 2.2, 4.6, 3, fl(shadeBoot(true), F), 2);

  ctx.save();
  ctx.translate(0, -11); ctx.rotate(lean); ctx.translate(0, 11);
  limb(ctx, -2, -24 + bob, hB.x, hB.y, 4, fl(HERO.skinD, F));
  circle(ctx, hB.x, hB.y, 2.8, fl(HERO.skinD, F), 2);

  // body
  rrect(ctx, -8, -17 + bob, 16, 8, 3, fl(HERO.shorts, F), 2.5);
  rrect(ctx, -8.5, -28 + bob, 17, 14, 5, fl(HERO.shirt, F), 2.5);
  line(ctx, -5, -18 + bob, 6, -18 + bob, fl(HERO.shirtD, F), 2);
  ctx.restore();

  // front leg
  limb(ctx, 2, -11 + bob * 0.3, fF.x, fF.y - 3, 4.5, fl(HERO.skin, F));
  ellipse(ctx, fF.x + 1.5, fF.y - 2.2, 4.8, 3.1, fl(HERO.boot, F), 2);

  ctx.save();
  ctx.translate(0, -11); ctx.rotate(lean); ctx.translate(0, 11);
  // head
  ctx.save();
  ctx.translate(1, -40 + bob); ctx.rotate(headTilt); ctx.translate(-1, 40 - bob);
  const hy = -40 + bob;
  circle(ctx, 1, hy, 14, fl(HERO.skin, F), 2.6);
  // face
  const look = p.look ?? 0;
  const ex1 = 5 + look, ex2 = 11 + look, ey = hy + 6;
  const blink = (t % 3.7) < 0.12 && expr !== 'hurt';
  ctx.fillStyle = OUT; ctx.strokeStyle = OUT; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
  if (expr === 'hurt') {
    for (const ex of [ex1, ex2]) { ctx.beginPath(); ctx.moveTo(ex - 2, ey - 2); ctx.lineTo(ex + 1.5, ey); ctx.lineTo(ex - 2, ey + 2); ctx.stroke(); }
  } else if (expr === 'happy') {
    for (const ex of [ex1, ex2]) { ctx.beginPath(); ctx.arc(ex, ey + 1, 2.2, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
  } else if (expr === 'sleepy' || blink) {
    for (const ex of [ex1, ex2]) { ctx.beginPath(); ctx.moveTo(ex - 2, ey); ctx.lineTo(ex + 2, ey); ctx.stroke(); }
  } else if (expr === 'scared' || expr === 'surprised') {
    for (const ex of [ex1, ex2]) { circle(ctx, ex, ey, 3.2, '#fff', 1.4); circle(ctx, ex + 0.6, ey, 1.4, OUT, 0); }
  } else {
    for (const ex of [ex1, ex2]) { ctx.beginPath(); ctx.ellipse(ex, ey, 1.8, 2.7, 0, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#fff';
    for (const ex of [ex1, ex2]) { ctx.beginPath(); ctx.arc(ex + 0.6, ey - 1, 0.7, 0, TAU); ctx.fill(); }
  }
  if (expr === 'angry') {
    line(ctx, ex1 - 2.5, ey - 5.5, ex1 + 2, ey - 3.5, OUT, 1.8);
    line(ctx, ex2 - 2, ey - 3.5, ex2 + 2.5, ey - 5.5, OUT, 1.8);
  }
  // cheek
  ctx.fillStyle = 'rgba(255,110,110,0.45)';
  ctx.beginPath(); ctx.ellipse(12 + look, hy + 10, 2.6, 1.6, 0, 0, TAU); ctx.fill();
  // mouth
  const talk = p.talk ?? 0;
  const mx = 8.5 + look, my = hy + 10.5;
  if (expr === 'hurt' || expr === 'scared' || expr === 'surprised' || talk > 0.3) {
    ellipse(ctx, mx, my + 0.5, 2.2, 1.6 + talk * 1.2 + (expr === 'surprised' ? 1 : 0), '#8a2030', 1.4);
  } else if (expr === 'angry') {
    line(ctx, mx - 2.5, my + 1, mx + 2.5, my + 0.3, OUT, 1.6);
  } else {
    ctx.beginPath(); ctx.arc(mx, my - 1.5, 3, 0.2 * Math.PI, 0.8 * Math.PI); ctx.lineWidth = 1.6; ctx.stroke();
  }
  // beanie
  ctx.beginPath(); ctx.arc(1, hy - 3, 15, Math.PI, 0); ctx.closePath();
  fillStroke(ctx, fl(HERO.beanie, F), 2.6);
  ctx.strokeStyle = 'rgba(160,60,0,0.35)'; ctx.lineWidth = 1.4;
  for (const kx of [-8, -2, 4, 10]) { ctx.beginPath(); ctx.moveTo(kx, hy - 5); ctx.quadraticCurveTo(kx * 0.8 + 1, hy - 12, kx * 0.5 + 1, hy - 16); ctx.stroke(); }
  rrect(ctx, -14.5, hy - 6, 31, 7, 3.5, fl(HERO.band, F), 2.4);
  const pomX = -4 - wind * 5 + Math.sin(t * 6) * 0.6;
  const pomY = hy - 19 + Math.abs(Math.sin(ph)) * (st === 'run' ? 2 : 0);
  limb(ctx, -1, hy - 16, pomX, pomY, 2, fl(HERO.beanie, F), 1.5);
  circle(ctx, pomX, pomY, 4.8, fl(HERO.pom, F), 2.2);
  ctx.restore();

  // scarf wrap
  rrect(ctx, -8.5, -30 + bob, 18, 5.5, 2.7, fl(HERO.scarf, F), 2.2);
  // front arm
  limb(ctx, 2, -24 + bob, hF.x, hF.y, 4, fl(HERO.skin, F));
  if (weaponDraw) weaponDraw();
  circle(ctx, hF.x, hF.y, 2.9, fl(HERO.skin, F), 2);
  ctx.restore();

  ctx.restore();
}
function shadeBoot(back: boolean) { return back ? '#3a2219' : HERO.boot; }

// ───────────────────────────── WATERMELON GUARDS (Арбузята) ─────────────────────────────
export type GuardKind = 'guard' | 'spitter' | 'feeder';
export interface GuardPose {
  t: number; facing: number;
  state: 'idle' | 'walk' | 'windup' | 'attack' | 'hurt' | 'stun' | 'spit' | 'cheer' | 'alert';
  phase?: number; flash?: number; kind: GuardKind; sx?: number; sy?: number; carry?: boolean;
}

export function drawGuard(ctx: C, x: number, y: number, s: number, p: GuardPose) {
  const F = p.flash;
  const t = p.t, ph = p.phase ?? 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s * p.facing * (p.sx ?? 1), s * (p.sy ?? 1));
  const walking = p.state === 'walk';
  const bob = walking ? -Math.abs(Math.sin(ph)) * 2 : Math.sin(t * 4) * 0.6;
  const f1 = walking ? Math.sin(ph) * 6 : 0, f2 = walking ? Math.sin(ph + Math.PI) * 6 : 0;
  const footC = fl('#1f5a24', F);
  ellipse(ctx, -7 + f2, -3 - Math.max(0, Math.cos(ph + Math.PI)) * (walking ? 3 : 0), 6.5, 3.6, footC, 2);

  // back arm
  const armC = fl('#2f7d33', F);
  let hand = { x: 14, y: -18 + bob };
  let spearA = -1.35;
  if (p.state === 'windup') { hand = { x: 4, y: -22 + bob }; spearA = -0.05; }
  else if (p.state === 'attack') { hand = { x: 24, y: -21 + bob }; spearA = 0; }
  else if (p.state === 'hurt' || p.state === 'stun') { hand = { x: 12, y: -30 }; spearA = -2.2; }
  else if (p.state === 'cheer') { hand = { x: 12, y: -40 + Math.sin(t * 10) * 3 }; spearA = -1.6; }
  else if (p.state === 'alert') { hand = { x: 15, y: -26 }; spearA = -1.5; }
  if (p.carry) { hand = { x: 6, y: -44 }; }
  limb(ctx, -10, -22 + bob, -16, -14 + bob + (walking ? Math.sin(ph) * 3 : 0), 5, shadeArm(armC), 2);

  // body
  const bodyC = fl('#3e9a3a', F);
  ctx.save();
  ctx.beginPath(); ctx.ellipse(0, -21 + bob, 18, 19, 0, 0, TAU);
  ctx.fillStyle = bodyC; ctx.fill();
  ctx.clip();
  ctx.strokeStyle = fl('#20662a', F); ctx.lineWidth = 4.5;
  for (let i = -3; i <= 3; i++) {
    const sx0 = i * 8.5 - 2;
    ctx.beginPath(); ctx.moveTo(sx0, -42 + bob);
    for (let k = 1; k <= 6; k++) ctx.lineTo(sx0 + (k % 2 ? 2.5 : -2.5) + i * 0.6 * k * 0.3, -42 + bob + k * 7);
    ctx.stroke();
  }
  ctx.restore();
  ellipse(ctx, 0, -21 + bob, 18, 19, null, 2.6);
  // face window
  const puff = p.state === 'spit' ? 1.15 : 1;
  ellipse(ctx, 7, -22 + bob, 11 * puff, 12 * puff, fl('#d9f0a8', F), 2.2);
  ellipse(ctx, 7.5, -22 + bob, 9 * puff, 10 * puff, fl('#ff5468', F), 0);
  // seeds eyes
  const angry = p.state === 'windup' || p.state === 'attack' || p.state === 'alert';
  ctx.fillStyle = OUT;
  for (const ex of [3.5, 11]) {
    ctx.beginPath(); ctx.ellipse(ex, -25 + bob, 2, 3, ex < 7 ? 0.25 : -0.25, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = '#fff';
  for (const ex of [4, 11.5]) { ctx.beginPath(); ctx.arc(ex, -26 + bob, 0.8, 0, TAU); ctx.fill(); }
  if (angry) {
    line(ctx, 1, -30 + bob, 6, -28 + bob, OUT, 1.8);
    line(ctx, 9, -28 + bob, 14, -30 + bob, OUT, 1.8);
  }
  if (p.state === 'hurt' || p.state === 'stun') {
    ellipse(ctx, 8, -17 + bob, 2.6, 2.2, '#5a1020', 1.2);
  } else if (p.state === 'cheer' || p.carry) {
    ctx.beginPath(); ctx.arc(8, -19 + bob, 3, 0.1 * Math.PI, 0.9 * Math.PI); ctx.lineWidth = 1.5; ctx.strokeStyle = OUT; ctx.stroke();
  } else {
    line(ctx, 5.5, -17.5 + bob, 10, -17.5 + bob, OUT, 1.6);
  }
  // seeds dots on flesh
  ctx.fillStyle = 'rgba(40,10,10,0.55)';
  for (const [sx, sy] of [[2, -16], [13, -18], [8, -13]]) { ctx.beginPath(); ctx.ellipse(sx, sy + bob, 0.9, 1.4, 0, 0, TAU); ctx.fill(); }

  // bottle-cap helmet
  const capC = fl(p.kind === 'spitter' ? '#3a6ad8' : p.kind === 'feeder' ? '#f0c040' : '#d8343a', F);
  ctx.beginPath();
  const cy = -39 + bob;
  ctx.moveTo(-12, cy + 4);
  for (let i = 0; i <= 8; i++) ctx.lineTo(-12 + i * 3, cy + 4 + (i % 2 ? 2.5 : 0));
  ctx.lineTo(12, cy - 3); ctx.quadraticCurveTo(0, cy - 8, -12, cy - 3); ctx.closePath();
  fillStroke(ctx, capC, 2.2);
  line(ctx, -7, cy - 3.5, 5, cy - 4.5, 'rgba(255,255,255,0.55)', 1.6);

  // front foot
  ellipse(ctx, 7 + f1, -3 - Math.max(0, Math.cos(ph)) * (walking ? 3 : 0), 6.5, 3.6, footC, 2);

  // weapon + front arm
  if (p.carry) {
    // big steak on a plate above head
    ellipse(ctx, 0, -50, 22, 4, fl('#e8eef5', F), 2);
    ellipse(ctx, 0, -57, 16, 8, fl('#a8402a', F), 2);
    line(ctx, -8, -58, 6, -55, '#f4d0b0', 2.4);
    limb(ctx, 10, -22 + bob, 10, -48, 5, armC, 2);
    limb(ctx, -10, -22 + bob, -10, -48, 5, armC, 2);
  } else if (p.kind === 'guard') {
    ctx.save(); ctx.translate(hand.x, hand.y); ctx.rotate(spearA);
    limb(ctx, -16, 0, 40, 0, 2.6, fl('#e8c88a', F), 1.6);
    ctx.beginPath(); ctx.moveTo(40, -2.6); ctx.lineTo(50, 0); ctx.lineTo(40, 2.6); ctx.closePath(); fillStroke(ctx, fl('#f2dca8', F), 1.6);
    circle(ctx, 30, 0, 5, fl('#5c8a2a', F), 1.8);
    circle(ctx, 31.5, -0.5, 1.8, fl('#d8343a', F), 0);
    ctx.restore();
    limb(ctx, 10, -22 + bob, hand.x, hand.y, 5, armC, 2);
    circle(ctx, hand.x, hand.y, 3.4, armC, 2);
  } else {
    // spitter: straw
    const sp = p.state === 'spit';
    ctx.save(); ctx.translate(14, -20 + bob); ctx.rotate(sp ? -0.1 : 0.15);
    rrect(ctx, 0, -2, 18, 4, 2, fl('#ffffff', F), 1.6);
    line(ctx, 3, -1.5, 3, 1.5, '#e04040', 1.6); line(ctx, 8, -1.5, 8, 1.5, '#e04040', 1.6); line(ctx, 13, -1.5, 13, 1.5, '#e04040', 1.6);
    ctx.restore();
    limb(ctx, 10, -22 + bob, 18, -16 + bob, 5, armC, 2);
    circle(ctx, 18, -16 + bob, 3.4, armC, 2);
  }
  ctx.restore();
}
function shadeArm(c: string) { return mix(c, '#000000', 0.2); }

// ───────────────────────────── MEATBALL ─────────────────────────────
export function drawMeatball(ctx: C, x: number, y: number, s: number, rot: number, t: number, facing: number, flash?: number) {
  ctx.save(); ctx.translate(x, y - 17 * s); ctx.scale(s, s);
  circle(ctx, 0, 0, 17, fl('#8c4a2c', flash), 2.6);
  ctx.save(); ctx.rotate(rot);
  ctx.fillStyle = fl('#6a3218', flash);
  for (const [a, r, z] of [[0, 9, 3], [1.4, 11, 2.4], [2.6, 6, 2.8], [3.9, 12, 2.2], [5.1, 8, 3]]) {
    ctx.beginPath(); ctx.arc(Math.cos(a) * r, Math.sin(a) * r, z, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = fl('#4f9a3a', flash);
  for (const a of [0.7, 2.2, 4.4]) { ctx.beginPath(); ctx.ellipse(Math.cos(a) * 12, Math.sin(a) * 12, 2.2, 1.1, a, 0, TAU); ctx.fill(); }
  ctx.restore();
  // face always upright
  const fx = facing * 5;
  for (const ex of [fx - 4, fx + 5]) { circle(ctx, ex, -4, 3.4, '#fff', 1.4); circle(ctx, ex + facing * 1.2, -3.6, 1.6, OUT, 0); }
  line(ctx, fx - 8, -10, fx - 1, -7.5, OUT, 2.2);
  line(ctx, fx + 1.5, -7.5, fx + 8.5, -10, OUT, 2.2);
  ctx.beginPath(); ctx.moveTo(fx - 4, 5); ctx.lineTo(fx + 6, 5); ctx.lineTo(fx + 1, 9 + Math.sin(t * 12)); ctx.closePath();
  fillStroke(ctx, '#5a1020', 1.4);
  ctx.restore();
}

// ───────────────────────────── JELLY ─────────────────────────────
export function drawJelly(ctx: C, x: number, y: number, s: number, t: number, sq: number, facing: number, flash?: number, hue = 0) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s * (1 + sq * 0.25), s * (1 - sq * 0.25));
  const col = hue === 1 ? '#5ad1ff' : hue === 2 ? '#9cf25a' : '#ff5f9e';
  ctx.globalAlpha *= 0.92;
  ctx.beginPath();
  ctx.moveTo(-18, 0);
  ctx.bezierCurveTo(-20, -18, -12, -30, 0, -30 + Math.sin(t * 6) * 1.5);
  ctx.bezierCurveTo(12, -30, 20, -18, 18, 0);
  ctx.closePath();
  fillStroke(ctx, fl(col, flash), 2.6);
  ctx.globalAlpha /= 0.92;
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath(); ctx.ellipse(-8, -20, 4, 7, -0.5, 0, TAU); ctx.fill();
  const fx = facing * 3;
  for (const ex of [fx - 5, fx + 5]) { ctx.fillStyle = OUT; ctx.beginPath(); ctx.ellipse(ex, -14, 2, 3, 0, 0, TAU); ctx.fill(); }
  ctx.beginPath(); ctx.arc(fx, -8, 3, 0.15 * Math.PI, 0.85 * Math.PI); ctx.strokeStyle = OUT; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath(); ctx.arc(6, -5 - ((t * 10) % 18), 1.5, 0, TAU); ctx.fill();
  ctx.restore();
}

// ───────────────────────────── FLYING BOOK ─────────────────────────────
export function drawBookBat(ctx: C, x: number, y: number, s: number, t: number, color: string, facing: number, flash?: number) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s * facing, s);
  const a = Math.sin(t * 14) * 0.9;
  const cov = fl(color, flash);
  for (const side of [-1, 1]) {
    const ox = side * 3;
    const tipx = ox + side * 22 * Math.cos(a * 0.6), tipy = -14 * Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(ox, -12); ctx.lineTo(tipx, tipy - 12); ctx.lineTo(tipx, tipy + 12); ctx.lineTo(ox, 12); ctx.closePath();
    fillStroke(ctx, '#f6ecd2', 2);
    ctx.beginPath();
    ctx.moveTo(ox, -13); ctx.lineTo(tipx + side * 2, tipy - 14); ctx.lineTo(tipx + side * 2, tipy - 10); ctx.lineTo(ox, -9); ctx.closePath();
    fillStroke(ctx, cov, 1.8);
  }
  rrect(ctx, -4, -13, 8, 26, 2, cov, 2);
  line(ctx, -3, -7, 3, -7, '#f0c040', 1.6);
  line(ctx, -3, 7, 3, 7, '#f0c040', 1.6);
  circle(ctx, -1.5, -1, 2.6, '#fff', 1.2); circle(ctx, 3.5, -1, 2.6, '#fff', 1.2);
  circle(ctx, -1, -0.6, 1.2, OUT, 0); circle(ctx, 4, -0.6, 1.2, OUT, 0);
  line(ctx, -4, -5, 0.5, -3.5, OUT, 1.4); line(ctx, 2, -3.5, 6, -5, OUT, 1.4);
  ctx.restore();
}

// ───────────────────────────── BEAR (Вторник) ─────────────────────────────
export function drawBear(ctx: C, x: number, y: number, s: number, t: number, o: { talk?: number; wave?: number; facing?: number; stand?: boolean; walkPhase?: number } = {}) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s * (o.facing ?? 1), s);
  const brown = '#8a5634', light = '#c98e5a', moss = '#97a874';
  const breath = Math.sin(t * 1.6) * 1.2;
  if (o.stand) {
    const ph = o.walkPhase ?? 0;
    ellipse(ctx, -14 + Math.sin(ph) * 8, -8, 13, 9, brown, 2.6);
    ellipse(ctx, 14 - Math.sin(ph) * 8, -8, 13, 9, brown, 2.6);
  }
  // body
  ellipse(ctx, 0, -42 - breath, 40, 42 + breath, brown, 3);
  ellipse(ctx, 4, -36 - breath, 25, 28, light, 0);
  // vest
  ctx.beginPath(); ctx.moveTo(-36, -60); ctx.quadraticCurveTo(-22, -78, -10, -76); ctx.lineTo(-14, -14); ctx.quadraticCurveTo(-32, -18, -38, -34); ctx.closePath();
  fillStroke(ctx, '#b0453a', 2.4);
  rrect(ctx, -30, -46, 9, 9, 1, '#d8b04a', 1.6);
  ctx.beginPath(); ctx.moveTo(36, -60); ctx.quadraticCurveTo(26, -78, 18, -76); ctx.lineTo(24, -16); ctx.quadraticCurveTo(34, -22, 38, -36); ctx.closePath();
  fillStroke(ctx, '#b0453a', 2.4);
  if (!o.stand) {
    // feet
    ellipse(ctx, -24, -8, 15, 10, brown, 2.6);
    ellipse(ctx, 26, -8, 15, 10, brown, 2.6);
    ellipse(ctx, -24, -8, 8, 5.5, light, 0);
    ellipse(ctx, 26, -8, 8, 5.5, light, 0);
  }
  // arm with mug
  const wave = o.wave ?? 0;
  if (wave > 0) {
    const a = Math.sin(t * 9) * 0.4;
    limb(ctx, 28, -62, 46 + Math.cos(a - 1.2) * 6, -96 + Math.sin(a) * 6, 13, brown, 2.6);
  } else {
    limb(ctx, 28, -62, 36, -38, 13, brown, 2.6);
    rrect(ctx, 30, -54, 18, 20, 3, '#e8e0d0', 2.2);
    ctx.beginPath(); ctx.arc(50, -44, 5, -Math.PI / 2, Math.PI / 2); ctx.lineWidth = 2.2; ctx.strokeStyle = OUT; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2;
    for (let i = 0; i < 2; i++) {
      const k = (t * 0.6 + i * 0.5) % 1;
      ctx.globalAlpha = 1 - k;
      ctx.beginPath(); ctx.moveTo(36 + i * 6, -58 - k * 20); ctx.quadraticCurveTo(42 + i * 6, -64 - k * 20, 36 + i * 6, -70 - k * 20); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  limb(ctx, -28, -62, -34, -36, 13, brown, 2.6);
  // head
  const hy = -94 - breath;
  circle(ctx, -21, hy - 22, 9, brown, 2.6); circle(ctx, -21, hy - 22, 4.5, light, 0);
  circle(ctx, 21, hy - 22, 9, brown, 2.6); circle(ctx, 21, hy - 22, 4.5, light, 0);
  circle(ctx, 0, hy, 28, brown, 3);
  // moss beard
  ctx.beginPath();
  ctx.moveTo(-18, hy + 8);
  const bumps = [[-20, hy + 22], [-12, hy + 34], [0, hy + 40], [12, hy + 34], [22, hy + 22], [20, hy + 8]];
  for (const [bx, by] of bumps) ctx.quadraticCurveTo(bx - 6, by + 4, bx, by);
  ctx.closePath();
  fillStroke(ctx, moss, 2.4);
  ctx.fillStyle = '#7a8c58';
  for (const [bx, by] of [[-8, hy + 26], [6, hy + 30], [14, hy + 18], [-14, hy + 16]]) { ctx.beginPath(); ctx.arc(bx, by, 2.4, 0, TAU); ctx.fill(); }
  // muzzle
  ellipse(ctx, 3, hy + 8, 15, 10, light, 2.4);
  ellipse(ctx, 4, hy + 2, 6, 4.2, OUT, 0);
  const talk = o.talk ?? 0;
  if (talk > 0.2) ellipse(ctx, 4, hy + 13, 5, 2 + talk * 3, '#5a1020', 1.6);
  else { ctx.beginPath(); ctx.arc(4, hy + 9, 4, 0.2 * Math.PI, 0.8 * Math.PI); ctx.strokeStyle = OUT; ctx.lineWidth = 1.8; ctx.stroke(); }
  // eyes + glasses
  const blink = (t % 4.3) < 0.14;
  for (const ex of [-10, 13]) {
    if (blink) line(ctx, ex - 2.5, hy - 6, ex + 2.5, hy - 6, OUT, 2);
    else circle(ctx, ex, hy - 6, 2.4, OUT, 0);
    ctx.beginPath(); ctx.arc(ex, hy - 6, 7.5, 0, TAU); ctx.lineWidth = 2.2; ctx.strokeStyle = '#c8a040'; ctx.stroke();
    ctx.fillStyle = 'rgba(200,230,255,0.25)'; ctx.fill();
  }
  line(ctx, -2.5, hy - 6, 5.5, hy - 6, '#c8a040', 2);
  // brows
  line(ctx, -16, hy - 16, -5, hy - 15, '#d8d8c8', 3.5);
  line(ctx, 8, hy - 15, 19, hy - 16, '#d8d8c8', 3.5);
  // thimble hat
  ctx.save(); ctx.translate(2, hy - 26); ctx.rotate(0.15);
  rrect(ctx, -13, -20, 26, 22, 5, '#c7ccd6', 2.4);
  ctx.fillStyle = '#9aa0ae';
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { ctx.beginPath(); ctx.arc(-8 + i * 5.3, -14 + j * 5.5, 1.1, 0, TAU); ctx.fill(); }
  rrect(ctx, -15, -2, 30, 5, 2, '#b0b6c2', 2);
  ctx.restore();
  ctx.restore();
}

// ───────────────────────────── DOG (Бублик, такса) ─────────────────────────────
export function drawDog(ctx: C, x: number, y: number, s: number, t: number, o: { facing?: number; L?: number; walk?: number; state?: 'idle' | 'walk' | 'sit' | 'cheer' | 'fly'; talk?: number; expr?: 'normal' | 'happy' | 'angry' } = {}) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s * (o.facing ?? 1), s);
  const L = o.L ?? 46;
  const body = '#b0612e', belly = '#e0a066', dark = '#7a3e1c';
  const st = o.state ?? 'idle';
  const ph = o.walk ?? 0;
  const walking = st === 'walk';
  const lift = (k: number) => (walking ? -Math.max(0, Math.cos(ph + k)) * 4 : 0);
  const sw = (k: number) => (walking ? Math.sin(ph + k) * 5 : 0);
  const fly = st === 'fly';
  // tail
  const wag = Math.sin(t * (st === 'cheer' ? 22 : 10)) * 0.5;
  ctx.save(); ctx.translate(-L / 2 - 8, -20); ctx.rotate(-0.7 + wag);
  limbQ(ctx, 0, 0, -8, -6, -14, -10, 4.5, body, 2.2);
  ctx.restore();
  // back legs (far)
  limb(ctx, -L / 2 + 2, -12, -L / 2 + 2 + sw(Math.PI), -3 + lift(Math.PI) + (fly ? -2 : 0), 6, dark, 2.2);
  limb(ctx, L / 2 - 2, -12, L / 2 - 2 + sw(0), -3 + lift(0) + (fly ? -2 : 0), 6, dark, 2.2);
  // body
  const bob = walking ? -Math.abs(Math.sin(ph)) * 1.5 : Math.sin(t * 3) * 0.5;
  rrect(ctx, -L / 2 - 12, -29 + bob, L + 24, 20, 10, body, 2.8);
  rrect(ctx, -L / 2 - 4, -16 + bob, L + 8, 6, 3, belly, 0);
  // near legs
  limb(ctx, -L / 2 - 4, -12, -L / 2 - 4 + sw(0), -3 + lift(0), 6.5, body, 2.4);
  limb(ctx, L / 2 + 4, -12, L / 2 + 4 + sw(Math.PI), -3 + lift(Math.PI), 6.5, body, 2.4);
  // head
  const hx = L / 2 + 14, hy = -34 + bob + (st === 'sit' ? -4 : 0);
  // collar + bagel tag
  rrect(ctx, L / 2 + 2, -32 + bob, 8, 16, 3, '#d8343a', 2);
  ctx.beginPath(); ctx.arc(L / 2 + 8, -12 + bob, 4, 0, TAU); ctx.arc(L / 2 + 8, -12 + bob, 1.5, 0, TAU, true);
  fillStroke(ctx, '#e8a850', 1.6);
  circle(ctx, hx, hy, 12, body, 2.8);
  ellipse(ctx, hx + 11, hy + 4, 10, 6.5, belly, 2.4);
  circle(ctx, hx + 20, hy + 2, 3.4, OUT, 0);
  const e = o.expr ?? 'normal';
  if (e === 'happy') { ctx.beginPath(); ctx.arc(hx + 3, hy - 3, 2.4, Math.PI * 1.1, Math.PI * 1.9); ctx.strokeStyle = OUT; ctx.lineWidth = 2; ctx.stroke(); }
  else { circle(ctx, hx + 3, hy - 3, 2.4, OUT, 0); circle(ctx, hx + 3.6, hy - 3.8, 0.8, '#fff', 0); }
  if (e === 'angry') line(ctx, hx - 1, hy - 8, hx + 6, hy - 6, OUT, 2);
  const talk = o.talk ?? 0;
  if (talk > 0.2 || st === 'cheer') ellipse(ctx, hx + 12, hy + 9, 4, 2 + talk * 2.5, '#8a2030', 1.4);
  else line(ctx, hx + 8, hy + 9, hx + 15, hy + 8.5, OUT, 1.6);
  // ear
  ctx.save(); ctx.translate(hx - 5, hy - 4); ctx.rotate(0.25 + Math.sin(t * 5) * 0.1 + (fly ? -1.2 : 0));
  ellipse(ctx, 0, 9, 5.5, 12, dark, 2.4);
  ctx.restore();
  ctx.restore();
}

/** giant stretchy paw-fist */
export function drawDogFist(ctx: C, x: number, y: number, s: number, rot: number) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  ellipse(ctx, 0, 0, 60, 52, '#b0612e', 4);
  for (const [px, py] of [[34, -30], [46, -6], [44, 20], [30, 40]]) ellipse(ctx, px, py, 16, 13, '#b0612e', 3.5);
  ellipse(ctx, 6, 4, 26, 22, '#e0a066', 0);
  ctx.restore();
}

// ───────────────────────────── KING (Король Громадин) ─────────────────────────────
export interface KingHand { x: number; y: number; state: 'open' | 'fist' | 'flat' | 'grab' | 'rest'; side: -1 | 1; rot?: number; glow?: number; flash?: number; scale?: number }
export interface KingPose {
  x: number; y: number; s: number; t: number;
  eye: number; mouth: number; anger: number; look?: number; lean?: number;
  hands: KingHand[]; flash?: number; crownTilt?: number; chew?: number; stand?: number; dizzy?: number;
  hurt?: number;
  armsLater?: boolean;
}

export const KING = {
  skin: '#c6a2e4', skinD: '#a882cc', robe: '#a8243a', robeD: '#7e1428', gold: '#f2c23a', ermine: '#fbf6ec', stache: '#e2762c', stacheD: '#b8541a',
};

export function drawKingHand(ctx: C, h: KingHand, s: number) {
  const F = h.flash;
  const sk = fl(KING.skin, F);
  ctx.save(); ctx.translate(h.x, h.y); ctx.scale(s * (h.scale ?? 1) * h.side, s * (h.scale ?? 1)); if (h.rot) ctx.rotate(h.rot);
  if (h.glow && h.glow > 0) {
    ctx.save(); ctx.globalAlpha = h.glow * (0.5 + 0.5 * Math.sin(performance.now() / 90));
    ellipse(ctx, 0, -70, 120, 95, null, 14);
    ctx.strokeStyle = '#ffe14a'; ctx.lineWidth = 12; ctx.stroke();
    ctx.restore();
  }
  if (h.state === 'fist') {
    ellipse(ctx, 0, -70, 82, 68, sk, 5);
    for (let i = 0; i < 4; i++) ellipse(ctx, -48 + i * 32, -16, 19, 16, sk, 4);
    ellipse(ctx, 70, -66, 22, 38, sk, 4.5, -0.4);
    line(ctx, -30, -40, -20, -30, fl(KING.skinD, F), 4);
  } else {
    const spread = h.state === 'open' ? 1.25 : h.state === 'grab' ? 0.7 : 1;
    const curl = h.state === 'grab' ? 1 : 0;
    ellipse(ctx, 0, -86, 86, 66, sk, 5);
    for (let i = 0; i < 4; i++) {
      const fx = (-51 + i * 34) * spread;
      const len = 62 - Math.abs(i - 1.5) * 8 - curl * 20;
      rrPath(ctx, fx - 17, -64, 34, len + 4, 17);
      fillStroke(ctx, sk, 4.5);
      // nail
      ellipse(ctx, fx, -64 + len - 8, 8, 5, fl('#efd8f8', F), 2.4);
    }
    ctx.save(); ctx.translate(78, -100); ctx.rotate(0.6 - curl * 0.5);
    rrPath(ctx, -16, -6, 32, 64, 16); fillStroke(ctx, sk, 4.5);
    ctx.restore();
    ellipse(ctx, 0, -86, 86, 66, null, 0);
    ctx.fillStyle = sk; ctx.beginPath(); ctx.ellipse(0, -96, 80, 50, 0, 0, TAU); ctx.fill();
    // palm crease
    ctx.strokeStyle = fl(KING.skinD, F); ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(-6, -110, 40, 0.3, 1.6); ctx.stroke();
  }
  ctx.restore();
}

export function drawThrone(ctx: C, x: number, y: number, s: number) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  const gold = KING.gold;
  // back
  ctx.beginPath();
  ctx.moveTo(-480, 0); ctx.lineTo(-480, -900);
  ctx.quadraticCurveTo(-480, -1060, -300, -1080);
  ctx.quadraticCurveTo(-150, -1180, 0, -1200);
  ctx.quadraticCurveTo(150, -1180, 300, -1080);
  ctx.quadraticCurveTo(480, -1060, 480, -900);
  ctx.lineTo(480, 0); ctx.closePath();
  fillStroke(ctx, gold, 8);
  ctx.beginPath();
  ctx.moveTo(-420, 0); ctx.lineTo(-420, -880);
  ctx.quadraticCurveTo(-410, -1010, -280, -1020);
  ctx.quadraticCurveTo(-140, -1110, 0, -1130);
  ctx.quadraticCurveTo(140, -1110, 280, -1020);
  ctx.quadraticCurveTo(410, -1010, 420, -880);
  ctx.lineTo(420, 0); ctx.closePath();
  fillStroke(ctx, '#7a1838', 6);
  // tufted pattern
  ctx.fillStyle = '#5e0f2a';
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) {
    const px = -330 + c * 132 + (r % 2) * 66, py = -960 + r * 150;
    if (px > 400) continue;
    ctx.beginPath(); ctx.arc(px, py, 10, 0, TAU); ctx.fill();
  }
  // jewels on top
  circle(ctx, 0, -1150, 34, '#e83a5a', 6);
  circle(ctx, -300, -1060, 22, '#3ac8e8', 5);
  circle(ctx, 300, -1060, 22, '#3ac8e8', 5);
  // armrests
  rrect(ctx, -560, -380, 160, 380, 30, gold, 8);
  rrect(ctx, 400, -380, 160, 380, 30, gold, 8);
  circle(ctx, -480, -400, 60, gold, 8);
  circle(ctx, 480, -400, 60, gold, 8);
  ctx.restore();
}

export function drawKing(ctx: C, k: KingPose) {
  const F = k.flash;
  const t = k.t;
  const skin = fl(mix(KING.skin, '#e86a8a', clamp(k.anger, 0, 1) * 0.45), F);
  const skinD = fl(mix(KING.skinD, '#c0405a', clamp(k.anger, 0, 1) * 0.4), F);
  ctx.save();
  ctx.translate(k.x, k.y);
  ctx.scale(k.s, k.s);
  const stand = k.stand ?? 0;
  const breath = Math.sin(t * 1.3) * 8;
  ctx.translate(0, -stand * 160);
  if (k.lean) ctx.rotate(k.lean);

  // robe/body
  ctx.beginPath();
  ctx.moveTo(-410, 160 * stand + 10);
  ctx.bezierCurveTo(-450, -200, -340, -410 - breath, -210, -450 - breath);
  ctx.lineTo(210, -450 - breath);
  ctx.bezierCurveTo(340, -410 - breath, 450, -200, 410, 160 * stand + 10);
  ctx.closePath();
  fillStroke(ctx, fl(KING.robe, F), 7);
  // robe shading folds
  ctx.strokeStyle = fl(KING.robeD, F); ctx.lineWidth = 10;
  for (const fx of [-300, -230, 230, 300]) { ctx.beginPath(); ctx.moveTo(fx, -300); ctx.quadraticCurveTo(fx * 1.15, -100, fx * 1.1, 160 * stand); ctx.stroke(); }
  // belly
  ellipse(ctx, 0, -190 - breath * 0.5, 170 + breath * 0.6, 190 + breath * 0.3, skin, 6);
  ctx.fillStyle = skinD; ctx.beginPath(); ctx.ellipse(0, -120, 10, 16, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = skinD; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(0, -190, 150, 0.4, Math.PI - 0.4); ctx.stroke();
  // robe edges with gold trim
  for (const side of [-1, 1]) {
    ctx.save(); ctx.scale(side, 1);
    ctx.beginPath();
    ctx.moveTo(110, -430); ctx.bezierCurveTo(200, -300, 210, -60, 160, 160 * stand + 10);
    ctx.lineTo(240, 160 * stand + 10); ctx.bezierCurveTo(280, -80, 260, -320, 190, -440); ctx.closePath();
    fillStroke(ctx, fl(KING.robe, F), 6);
    ctx.beginPath(); ctx.moveTo(110, -430); ctx.bezierCurveTo(200, -300, 210, -60, 160, 160 * stand + 10);
    ctx.strokeStyle = fl(KING.gold, F); ctx.lineWidth = 22; ctx.stroke();
    ctx.strokeStyle = OUT; ctx.lineWidth = 4; ctx.stroke();
    ctx.restore();
  }
  // ermine collar
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI + (i / 12) * Math.PI;
    const cx = Math.cos(a) * 270, cy = -440 - breath + Math.sin(a) * -40 + 30;
    circle(ctx, cx, cy, 52, fl(KING.ermine, F), 5);
  }
  ctx.fillStyle = OUT;
  for (let i = 0; i < 12; i++) {
    const a = Math.PI + ((i + 0.5) / 12) * Math.PI;
    const cx = Math.cos(a) * 270, cy = -440 - breath + Math.sin(a) * -40 + 34;
    ctx.beginPath(); ctx.ellipse(cx, cy, 6, 12, 0, 0, TAU); ctx.fill();
  }

  // head
  const hy = -620 - breath * 0.7;
  ctx.save();
  if (k.dizzy) ctx.rotate(Math.sin(t * 4) * 0.05 * k.dizzy);
  ellipse(ctx, 0, hy, 245, 205, skin, 7);
  // chin folds
  ctx.strokeStyle = skinD; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(0, hy + 30, 190, 0.55, Math.PI - 0.55); ctx.stroke();
  // little hairs
  ctx.strokeStyle = OUT; ctx.lineWidth = 5;
  for (const hx of [-30, 0, 30]) { ctx.beginPath(); ctx.moveTo(hx, hy - 200); ctx.bezierCurveTo(hx - 10, hy - 250, hx + 30, hy - 260, hx + 20, hy - 230); ctx.stroke(); }
  // cheeks
  ctx.fillStyle = `rgba(255,90,140,${0.35 + k.anger * 0.3})`;
  ctx.beginPath(); ctx.ellipse(-160, hy + 60, 55, 32, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(160, hy + 60, 55, 32, 0, 0, TAU); ctx.fill();
  // eyes
  const eye = clamp(k.eye, 0, 1);
  const look = (k.look ?? 0) * 14;
  for (const side of [-1, 1]) {
    const ex = side * 88, ey = hy - 40;
    ctx.save();
    ctx.beginPath(); ctx.ellipse(ex, ey, 44, 38, 0, 0, TAU);
    ctx.fillStyle = k.anger > 0.6 ? '#fff0f0' : '#ffffff'; ctx.fill();
    ctx.clip();
    if (k.dizzy && k.dizzy > 0.3) {
      ctx.strokeStyle = OUT; ctx.lineWidth = 5;
      ctx.beginPath();
      for (let a = 0; a < 12; a += 0.3) { const r = a * 2.6; const px = ex + Math.cos(a + t * 6 * side) * r, py = ey + Math.sin(a + t * 6 * side) * r; if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
      ctx.stroke();
    } else {
      circle(ctx, ex + look, ey + 6, 15, OUT, 0);
      circle(ctx, ex + look + 5, ey, 5, '#fff', 0);
    }
    if (k.anger > 0.5) {
      ctx.strokeStyle = '#e04050'; ctx.lineWidth = 2.5;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(ex + side * 44, ey - 10 + i * 10); ctx.lineTo(ex + side * 26, ey - 6 + i * 8); ctx.stroke(); }
    }
    // eyelid
    const lidY = ey - 38 + 76 * (1 - eye) * 0.92;
    ctx.fillStyle = skinD;
    ctx.fillRect(ex - 50, ey - 50, 100, lidY - (ey - 50));
    ctx.restore();
    ellipse(ctx, ex, ey, 44, 38, null, 5);
    ctx.strokeStyle = OUT; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(ex - 42, lidY); ctx.quadraticCurveTo(ex, lidY + 8, ex + 42, lidY); ctx.stroke();
    // brows
    const ang = side * (0.15 + k.anger * 0.45);
    ctx.save(); ctx.translate(ex, ey - 62 + k.anger * 10); ctx.rotate(ang);
    rrect(ctx, -46, -9, 92, 18, 9, fl(KING.stacheD, F), 4);
    ctx.restore();
  }
  // nose
  ellipse(ctx, 0, hy + 22, 48, 40, skinD, 6);
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.ellipse(-14, hy + 8, 14, 9, -0.5, 0, TAU); ctx.fill();
  // mouth
  const chew = k.chew ? Math.abs(Math.sin(t * 9)) * k.chew : 0;
  const m = clamp(k.mouth + chew * 0.35, 0, 1);
  const my = hy + 120;
  if (m > 0.04) {
    ctx.beginPath(); ctx.ellipse(0, my, 80 + m * 40, 14 + m * 80, 0, 0, TAU);
    fillStroke(ctx, '#5a1028', 6);
    ctx.save(); ctx.clip();
    ctx.fillStyle = '#e05a7a'; ctx.beginPath(); ctx.ellipse(0, my + 10 + m * 60, 70, 40, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff';
    for (let i = -2; i <= 2; i++) { rrPath(ctx, i * 34 - 14, my - 14 - m * 80, 28, 30, 6); ctx.fill(); }
    ctx.restore();
  } else {
    ctx.strokeStyle = OUT; ctx.lineWidth = 7;
    ctx.beginPath();
    if (k.anger > 0.4) ctx.arc(0, my + 60, 70, -Math.PI * 0.8, -Math.PI * 0.2);
    else ctx.arc(0, my - 40, 70, Math.PI * 0.25, Math.PI * 0.75);
    ctx.stroke();
  }
  // mustache
  for (const side of [-1, 1]) {
    ctx.save(); ctx.scale(side, 1); ctx.translate(0, hy + 60);
    const wig = Math.sin(t * 2 + side) * 4 + m * 12;
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.bezierCurveTo(60, -45, 150, -40, 205, -10 - wig);
    ctx.bezierCurveTo(240, 10 - wig, 250, -40 - wig, 222, -52 - wig);
    ctx.bezierCurveTo(262, -46 - wig, 262, 30 - wig, 200, 34 - wig);
    ctx.bezierCurveTo(140, 40, 60, 34, 0, 18);
    ctx.closePath();
    fillStroke(ctx, fl(KING.stache, F), 6);
    ctx.strokeStyle = fl(KING.stacheD, F); ctx.lineWidth = 4;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(30 + i * 40, -8 + i * 2); ctx.quadraticCurveTo(60 + i * 40, 4, 40 + i * 50, 18); ctx.stroke(); }
    ctx.restore();
  }
  // crown (tiny)
  ctx.save(); ctx.translate(0, hy - 200); ctx.rotate((k.crownTilt ?? 0.12) + Math.sin(t * 1.3) * 0.02);
  ctx.beginPath();
  ctx.moveTo(-46, 0); ctx.lineTo(-52, -44); ctx.lineTo(-24, -20); ctx.lineTo(0, -56); ctx.lineTo(24, -20); ctx.lineTo(52, -44); ctx.lineTo(46, 0); ctx.closePath();
  fillStroke(ctx, fl(KING.gold, F), 5);
  circle(ctx, 0, -14, 9, '#e83a5a', 3);
  circle(ctx, -52, -46, 6, '#fff', 3); circle(ctx, 52, -46, 6, '#fff', 3); circle(ctx, 0, -58, 6, '#fff', 3);
  ctx.restore();
  // dizzy stars
  if (k.dizzy && k.dizzy > 0.2) {
    for (let i = 0; i < 4; i++) {
      const a = t * 3 + (i / 4) * TAU;
      ctx.save(); ctx.translate(Math.cos(a) * 200, hy - 230 + Math.sin(a) * 40);
      ctx.beginPath();
      for (let j = 0; j < 10; j++) { const r = j % 2 ? 12 : 28; const aa = (j / 10) * TAU - Math.PI / 2; if (j === 0) ctx.moveTo(Math.cos(aa) * r, Math.sin(aa) * r); else ctx.lineTo(Math.cos(aa) * r, Math.sin(aa) * r); }
      ctx.closePath(); fillStroke(ctx, '#ffe14a', 4);
      ctx.restore();
    }
  }
  ctx.restore();
  ctx.restore();
  if (!k.armsLater) drawKingArms(ctx, k);
}

/** arms + hands, in world space */
export function drawKingArms(ctx: C, k: KingPose) {
  const F = k.flash;
  const stand = k.stand ?? 0;
  for (const h of k.hands) {
    const shx = k.x + h.side * 280 * k.s, shy = k.y + (-400 - stand * 160) * k.s;
    const hx = h.x, hy2 = h.y - 120 * k.s * (h.scale ?? 1);
    const mx = (shx + hx) / 2 + h.side * 140 * k.s, my = (shy + hy2) / 2 + 60 * k.s;
    limbQ(ctx, shx, shy, mx, my, hx, hy2, 150 * k.s, fl(KING.robe, F), 6 * k.s + 1);
    // cuff
    const cx = hx + (mx - hx) * 0.28, cy = hy2 + (my - hy2) * 0.28;
    circle(ctx, cx, cy, 82 * k.s, fl(KING.ermine, F), 5 * k.s + 1);
    ctx.fillStyle = OUT;
    ctx.beginPath(); ctx.ellipse(cx - 20 * k.s, cy, 5 * k.s, 10 * k.s, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + 25 * k.s, cy + 10 * k.s, 5 * k.s, 10 * k.s, 0, 0, TAU); ctx.fill();
    drawKingHand(ctx, h, k.s);
  }
}

// ───────────────────────────── PORTRAITS ─────────────────────────────
export type Who = 'hero' | 'bear' | 'king' | 'dog' | 'guard' | 'narrator';
export const WHO_INFO: Record<Who, { name: string; color: string; bg: string; pitch: number }> = {
  hero: { name: 'Тоша', color: '#ff8a2a', bg: '#ffe7c4', pitch: 1.25 },
  bear: { name: 'Медведь Вторник', color: '#b0453a', bg: '#e6d2b0', pitch: 0.7 },
  king: { name: 'Король Громадин', color: '#a8243a', bg: '#e7d2f4', pitch: 0.5 },
  dog: { name: 'Бублик', color: '#b0612e', bg: '#ffe0b8', pitch: 1.0 },
  guard: { name: 'Арбузёнок', color: '#3e9a3a', bg: '#dff4c8', pitch: 1.6 },
  narrator: { name: '', color: '#f0c040', bg: '#2a1b1a', pitch: 0.9 },
};

export function drawPortrait(ctx: C, who: Who, cx: number, cy: number, r: number, t: number, talk: number, expr?: string) {
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU);
  ctx.fillStyle = WHO_INFO[who].bg; ctx.fill();
  ctx.save(); ctx.clip();
  // rays
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i < 8; i++) {
    const a = t * 0.3 + (i / 8) * TAU;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a, a + 0.25); ctx.closePath(); ctx.fill();
  }
  const k = r / 50;
  switch (who) {
    case 'hero': drawHero(ctx, cx - 16 * k, cy + 96 * k, 2.6 * k, { t, facing: 1, state: 'idle', weapon: 'none', talk, expr: (expr as HeroExpr) ?? 'normal' }); break;
    case 'bear': drawBear(ctx, cx - 2 * k, cy + 128 * k, 1.25 * k, t, { talk }); break;
    case 'king': drawKing(ctx, { x: cx, y: cy + 150 * k, s: 0.24 * k, t, eye: expr === 'angry' ? 1 : 0.5, mouth: talk * 0.5, anger: expr === 'angry' ? 1 : 0, hands: [], chew: expr === 'chew' ? 1 : 0 }); break;
    case 'dog': { const s2 = 2.3 * k; drawDog(ctx, cx - 8 * k - 37 * s2, cy + 8 * k + 34 * s2, s2, t, { talk, expr: (expr as 'happy') ?? 'happy' }); break; }
    case 'guard': drawGuard(ctx, cx - 12 * k, cy + 62 * k, 2.2 * k, { t, facing: 1, state: expr === 'cheer' ? 'cheer' : 'idle', kind: 'guard' }); break;
    case 'narrator': break;
  }
  ctx.restore();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU);
  ctx.lineWidth = 5; ctx.strokeStyle = OUT; ctx.stroke();
  ctx.lineWidth = 2.5; ctx.strokeStyle = WHO_INFO[who].color; ctx.beginPath(); ctx.arc(cx, cy, r - 4, 0, TAU); ctx.stroke();
  ctx.restore();
}

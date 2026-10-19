import { W, H, clamp, ease, TAU } from '../engine/util';
import { save } from '../engine/save';
import { rrect, text, heartPath, fillStroke, OUT, wrap, glow } from '../art/draw';
import { drawCrumb, drawHoney, drawPea, drawSwordIcon, drawForkIcon, drawFeather, drawCloak, drawSlingIcon, drawBerryHeart } from '../art/props';
export interface HudPlayer { hp: number; maxHp: number; ammo: number; weapon: 'sword' | 'fork'; lid?: boolean; /** «Хрумляндия»: the hero played (Tosha when absent) */ kind?: string }
/** the other heroes' HUD badge (their weapon slot): initial + colour; who uses peas / a double jump */
const HERO_BADGE: Record<string, { ch: string; color: string; peas: boolean; dj: boolean }> = {
  bublik: { ch: 'Б', color: '#e8a850', peas: false, dj: false },
  noki: { ch: 'Н', color: '#c8304a', peas: false, dj: false },
  pastila: { ch: 'П', color: '#ff78b4', peas: false, dj: true },
};
import * as Props from '../art/props';
type IconFn = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t?: number) => void;
/** icon from the art module if it exists yet, else a plain token */
function artIcon(name: string, ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number, fallback: string) {
  const f = (Props as unknown as Record<string, IconFn | undefined>)[name];
  if (f) { f(ctx, x, y, s, t); return; }
  ctx.beginPath(); ctx.arc(x, y, 13 * s, 0, TAU); ctx.fillStyle = fallback; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = OUT; ctx.stroke();
}
import type { PickupKind } from '../game/types';
/** the widest a toast line gets (the corners stay free for the HUD's own tips) */
const TOAST_W = 680;
import { bindText } from './glyphs';

type C = CanvasRenderingContext2D;

export class Hud {
  shownCrumbs = 0;
  crumbPulse = 0;
  hpPulse = 0;
  lastHp = -1;
  toasts: { text: string; t: number; dur: number }[] = [];
  /** where the toast column starts at the least (a first-time card at the left top pushes it down) */
  toastTop = 0;
  /** where the toast stack ends (the banner goes below it) */
  private toastBottom = 140;
  chapter: { title: string; sub: string; t: number } | null = null;
  bossName = '';
  bossHp = 0; bossMax = 0; bossShown = 0; bossVis = 0;
  banner: { text: string; t: number; color: string } | null = null;

  toast(str: string, dur = 3.2) {
    str = bindText(str); // hints written with the default keys show the player's own
    if (this.toasts.some((t) => t.text === str && t.t < t.dur - 0.5)) return;
    this.toasts.push({ text: str, t: 0, dur }); if (this.toasts.length > 3) this.toasts.shift();
  }
  showChapter(title: string, sub: string) { this.chapter = { title, sub, t: 0 }; }
  showBanner(str: string, color = '#ff5a4a') { this.banner = { text: str, t: 0, color }; }

  update(dt: number, p: HudPlayer) {
    if (this.shownCrumbs !== save.data.crumbs) {
      const diff = save.data.crumbs - this.shownCrumbs;
      this.shownCrumbs += Math.sign(diff) * Math.max(1, Math.floor(Math.abs(diff) * 0.2));
      this.crumbPulse = 1;
    }
    this.crumbPulse = Math.max(0, this.crumbPulse - dt * 4);
    if (this.lastHp !== p.hp) { if (this.lastHp >= 0) this.hpPulse = 1; this.lastHp = p.hp; }
    this.hpPulse = Math.max(0, this.hpPulse - dt * 3);
    for (const t of this.toasts) t.t += dt;
    this.toasts = this.toasts.filter((t) => t.t < t.dur);
    if (this.chapter) { this.chapter.t += dt; if (this.chapter.t > 4.2) this.chapter = null; }
    if (this.banner) { this.banner.t += dt; if (this.banner.t > 2.2) this.banner = null; }
    this.bossShown += (this.bossHp - this.bossShown) * Math.min(1, dt * 6);
  }

  /** toasts = false: a menu / panel is up (the pause's title lines, the hub's shop): no toasts, chapter card or banner */
  draw(ctx: C, p: HudPlayer, t: number, statsAlpha = 1, toasts = true) {
    if (statsAlpha > 0.01) { ctx.save(); ctx.globalAlpha = statsAlpha; this.drawStats(ctx, p, t); ctx.restore(); }
    this.drawOverlays(ctx, toasts);
  }

  private drawStats(ctx: C, p: HudPlayer, t: number) {
    // hearts
    const hx = 30, hy = 26;
    for (let i = 0; i < p.maxHp; i++) {
      const x = hx + i * 40, y = hy;
      const full = i < p.hp;
      const pulse = full && i === p.hp - 1 ? 1 + this.hpPulse * 0.4 : 1;
      const low = p.hp <= 2 && full ? 1 + Math.sin(t * 10) * 0.08 : 1;
      ctx.save(); ctx.translate(x + 17, y + 2); ctx.scale(pulse * low, pulse * low);
      heartPath(ctx, 0, -2, 36);
      fillStroke(ctx, full ? '#ff3a5a' : 'rgba(40,20,30,0.6)', 3.5);
      if (full) { ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.ellipse(-8, 7, 4, 5, -0.5, 0, TAU); ctx.fill(); }
      ctx.restore();
    }
    if (p.lid) {
      const lx = hx + p.maxHp * 40 + 18;
      ctx.save(); ctx.globalAlpha *= 0.95;
      artIcon('drawPotLid', ctx, lx, hy + 2, 0.75, t, '#b8c0d0');
      ctx.restore();
    }
    // crumbs
    const cy = 78;
    rrect(ctx, 20, cy - 4, 130, 40, 14, 'rgba(30,15,15,0.55)', 0);
    drawCrumb(ctx, 42, cy + 16, 1.6 + this.crumbPulse * 0.4, 0);
    text(ctx, String(Math.round(this.shownCrumbs)), 66, cy + 27, { size: 24, color: '#ffe0a0', stroke: 5 });
    let ix = 162;
    // golden walnuts
    if (save.data.nuts > 0 || save.data.upgrades.nutHeart || save.data.upgrades.nutSling) {
      rrect(ctx, ix, cy - 4, 74, 40, 14, 'rgba(30,15,15,0.55)', 0);
      artIcon('drawGoldenNut', ctx, ix + 20, cy + 16, 0.55, t, '#ffcf3a');
      text(ctx, String(save.data.nuts), ix + 38, cy + 27, { size: 20, color: '#ffe680', stroke: 5 });
      ix += 86;
    }
    // potions
    rrect(ctx, ix, cy - 4, 74, 40, 14, 'rgba(30,15,15,0.55)', 0);
    drawHoney(ctx, ix + 22, cy + 18, 1.1);
    text(ctx, '×' + save.data.potions, ix + 38, cy + 27, { size: 20, color: '#ffd060', stroke: 5 });
    ix += 86;
    const badge = p.kind ? HERO_BADGE[p.kind] : undefined;
    if (save.data.abilities.slingshot && (!badge || badge.peas)) {
      rrect(ctx, ix, cy - 4, 84, 40, 14, 'rgba(30,15,15,0.55)', 0);
      drawPea(ctx, ix + 20, cy + 16, 1.5);
      text(ctx, `${p.ammo}`, ix + 36, cy + 27, { size: 20, color: p.ammo > 0 ? '#c8f0a0' : '#ff8a8a', stroke: 5 });
      ix += 96;
    }
    // weapon + abilities
    rrect(ctx, ix, cy - 4, 46, 40, 14, 'rgba(30,15,15,0.55)', 0);
    if (badge) {
      ctx.beginPath(); ctx.arc(ix + 23, cy + 16, 14, 0, Math.PI * 2); ctx.fillStyle = badge.color; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = OUT; ctx.stroke();
      text(ctx, badge.ch, ix + 23, cy + 23, { size: 19, color: OUT, align: 'center' });
    } else if (p.weapon === 'fork') drawForkIcon(ctx, ix + 23, cy + 16, 0.95); else drawSwordIcon(ctx, ix + 23, cy + 16, 0.95);
    ix += 56;
    if (save.data.abilities.doubleJump && (!badge || badge.dj)) { drawFeather(ctx, ix + 12, cy + 16, 0.6); ix += 30; }
    if (save.data.abilities.dash) { drawCloak(ctx, ix + 12, cy + 16, 0.7); ix += 30; }
  }

  private drawOverlays(ctx: C, showToasts = true) {

    // boss bar
    if (this.bossMax > 0) {
      this.bossVis = Math.min(1, this.bossVis + 0.03);
      const bw = 640, bx = (W - bw) / 2, by = H - 56 + (1 - ease.outCubic(this.bossVis)) * 80;
      text(ctx, this.bossName, W / 2, by - 10, { size: 22, color: '#ffe0f0', align: 'center', stroke: 6 });
      rrect(ctx, bx, by, bw, 26, 13, '#2a1020', 4);
      const k = clamp(this.bossShown / this.bossMax, 0, 1);
      const k2 = clamp(this.bossHp / this.bossMax, 0, 1);
      if (k > 0) rrect(ctx, bx + 4, by + 4, (bw - 8) * k, 18, 9, '#ffe0a0', 0);
      if (k2 > 0) rrect(ctx, bx + 4, by + 4, (bw - 8) * k2, 18, 9, '#e83a6a', 0);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(bx + 10, by + 6, (bw - 20) * k2, 4);
      for (const mark of [0.6, 0.25]) { ctx.fillStyle = OUT; ctx.fillRect(bx + 4 + (bw - 8) * mark - 1.5, by + 2, 3, 22); }
    }

    // toasts: a centre column (a long hint wraps instead of running under the corner tips — the co-op scoreboard tip,
    // the combo line), stacked by their real height
    let ty = Math.max(140, this.toastTop);
    if (showToasts) this.toasts.forEach((tt) => {
      const a = tt.t < 0.25 ? tt.t / 0.25 : tt.t > tt.dur - 0.4 ? (tt.dur - tt.t) / 0.4 : 1;
      const y = ty - (1 - ease.outCubic(clamp(tt.t * 4, 0, 1))) * 20;
      ctx.save(); ctx.globalAlpha = clamp(a, 0, 1);
      ctx.font = '400 22px Pangolin, sans-serif';
      const lines = wrap(ctx, tt.text, TOAST_W);
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 40, h = 38 + (lines.length - 1) * 26;
      rrect(ctx, W / 2 - w / 2, y, w, h, 14, 'rgba(30,15,20,0.8)', 3);
      lines.forEach((l, j) => text(ctx, l, W / 2, y + 26 + j * 26, { size: 22, font: 'body', color: '#fff3d8', align: 'center' }));
      ctx.restore();
      ty += h + 10;
    });
    this.toastBottom = ty;

    // chapter title
    if (this.chapter && showToasts) {
      const c = this.chapter;
      const a = c.t < 0.6 ? c.t / 0.6 : c.t > 3.4 ? (4.2 - c.t) / 0.8 : 1;
      ctx.save(); ctx.globalAlpha = clamp(a, 0, 1);
      const g = ctx.createLinearGradient(0, H * 0.3, 0, H * 0.58);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(10,4,8,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, H * 0.3, W, H * 0.28);
      const slide = (1 - ease.outCubic(clamp(c.t / 0.8, 0, 1))) * 40;
      text(ctx, c.sub, W / 2, H * 0.4 - slide * 0.5, { size: 22, color: '#ffd34a', align: 'center', stroke: 5 });
      text(ctx, c.title, W / 2, H * 0.4 + 56 + slide, { size: 58, color: '#fff3d8', align: 'center', stroke: 9 });
      ctx.restore();
    }

    if (this.banner && showToasts) {
      const b = this.banner;
      const a = b.t < 0.2 ? b.t / 0.2 : b.t > 1.8 ? (2.2 - b.t) / 0.4 : 1;
      const sc = 1 + Math.max(0, 0.3 - b.t) * 2;
      ctx.save(); ctx.globalAlpha = clamp(a, 0, 1);
      // below the toast stack («ЗАСАДА!» used to sit right on top of two hint toasts)
      ctx.translate(W / 2, Math.max(H * 0.28, this.toastBottom + 36)); ctx.scale(sc, sc); ctx.rotate(Math.sin(b.t * 20) * 0.02);
      text(ctx, b.text, 0, 0, { size: 64, color: b.color, align: 'center', base: 'middle', stroke: 10 });
      ctx.restore();
    }
  }
}

// ───────────────────────────── ITEM GET POPUP ─────────────────────────────
export const ITEM_INFO: Partial<Record<PickupKind, { title: string; desc: string }>> = {
  doubleJump: { title: 'Перо Прыгуна', desc: 'Двойной прыжок! Нажми прыжок ещё раз прямо в воздухе.' },
  dash: { title: 'Плащ-Рывок', desc: 'Рывок на Shift / L. Пока несёшься — тебя не задеть. Работает и в воздухе!' },
  fork: { title: 'Вилка-Копьё', desc: 'Тяжёлое оружие: бьёт дальше и сильнее, но медленнее. Q — сменить оружие.' },
  sling: { title: 'Рогатка', desc: 'Щёлкни ПКМ (K) — горох летит в цель в жёлтой рамке. Зажми ПКМ — целишься сам, отпусти — выстрел.' },
  container: { title: 'Сердце-Вишня', desc: 'Максимум здоровья увеличен на одно сердечко!' },
};

export class ItemPopup {
  kind: PickupKind | null = null;
  t = 0;
  /** compact = 3D games: a card at the bottom, the scene (hero holding the item) stays visible above */
  compact = false;
  show(kind: PickupKind) { this.kind = kind; this.t = 0; }
  get active() { return this.kind !== null; }
  close() { this.kind = null; }
  update(dt: number) { if (this.kind) this.t += dt; }
  draw(ctx: C) {
    if (!this.kind) return;
    const info = ITEM_INFO[this.kind];
    if (!info) return;
    if (this.compact) { this.drawCompact(ctx, info); return; }
    const a = ease.outBack(clamp(this.t * 3, 0, 1));
    ctx.save();
    ctx.fillStyle = `rgba(10,4,8,${0.6 * clamp(this.t * 4, 0, 1)})`; ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    ctx.scale(a, a);
    // rays
    ctx.save(); ctx.rotate(this.t * 0.4);
    ctx.fillStyle = 'rgba(255,220,120,0.15)';
    for (let i = 0; i < 12; i++) { ctx.beginPath(); ctx.moveTo(0, -60); ctx.arc(0, -60, 420, (i / 12) * TAU, (i / 12) * TAU + 0.16); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    rrect(ctx, -330, -200, 660, 360, 30, '#fff7e6', 6);
    rrect(ctx, -330, -200, 660, 60, 30, '#ffd34a', 0);
    ctx.fillStyle = '#ffd34a'; ctx.fillRect(-327, -170, 654, 30);
    text(ctx, 'НОВАЯ ШТУКА!', 0, -158, { size: 30, color: OUT, align: 'center' });
    glow(ctx, 0, -60, 120, '#ffe9a0', 0.6);
    const iy = -60 + Math.sin(this.t * 3) * 5;
    this.icon(ctx, 0, iy, 1);
    text(ctx, info.title, 0, 40, { size: 40, color: '#b0453a', align: 'center' });
    ctx.font = '400 24px Pangolin, sans-serif';
    const lines = wrap(ctx, bindText(info.desc), 560);
    lines.forEach((l, i) => text(ctx, l, 0, 84 + i * 30, { size: 24, font: 'body', color: OUT, align: 'center' }));
    if (this.t > 0.8) text(ctx, 'Нажми Пробел / Enter', 0, 148, { size: 18, color: '#8a6a4a', align: 'center', alpha: 0.6 + Math.sin(this.t * 5) * 0.3 });
    ctx.restore();
  }
  private icon(ctx: C, x: number, y: number, k: number) {
    if (this.kind === 'doubleJump') drawFeather(ctx, x, y, 2.6 * k, this.t);
    if (this.kind === 'dash') drawCloak(ctx, x, y, 2.8 * k, this.t);
    if (this.kind === 'fork') drawForkIcon(ctx, x, y, 3 * k);
    if (this.kind === 'sling') drawSlingIcon(ctx, x, y, 2.6 * k);
    if (this.kind === 'container') drawBerryHeart(ctx, x, y, 2.6 * k, this.t, true);
  }
  private drawCompact(ctx: C, info: { title: string; desc: string }) {
    const a = ease.outBack(clamp(this.t * 3, 0, 1));
    ctx.save();
    const g = ctx.createLinearGradient(0, H - 260, 0, H);
    g.addColorStop(0, 'rgba(10,4,8,0)'); g.addColorStop(1, `rgba(10,4,8,${0.55 * clamp(this.t * 3, 0, 1)})`);
    ctx.fillStyle = g; ctx.fillRect(-2000, H - 260, W + 4000, 2260);
    ctx.translate(W / 2, H - 112);
    ctx.scale(a, a);
    const w = 720, h = 170;
    rrect(ctx, -w / 2 + 6, -h / 2 + 8, w, h, 26, 'rgba(0,0,0,0.3)', 0);
    rrect(ctx, -w / 2, -h / 2, w, h, 26, '#fff7e6', 5);
    rrect(ctx, -w / 2 + 22, -h / 2 - 22, 250, 44, 18, '#ffd34a', 4);
    text(ctx, 'НОВАЯ ШТУКА!', -w / 2 + 147, -h / 2 + 8, { size: 24, color: OUT, align: 'center' });
    glow(ctx, -w / 2 + 92, 8, 70, '#ffe9a0', 0.55);
    this.icon(ctx, -w / 2 + 92, 8 + Math.sin(this.t * 3) * 3, 0.62);
    text(ctx, info.title, -w / 2 + 180, -22, { size: 34, color: '#b0453a' });
    ctx.font = '400 21px Pangolin, sans-serif';
    const lines = wrap(ctx, bindText(info.desc), w - 210);
    lines.forEach((l, i) => text(ctx, l, -w / 2 + 182, 14 + i * 26, { size: 21, font: 'body', color: OUT }));
    if (this.t > 0.8) text(ctx, 'Пробел / Enter', w / 2 - 22, h / 2 - 16, { size: 15, color: '#8a6a4a', align: 'right', alpha: 0.6 + Math.sin(this.t * 5) * 0.3 });
    ctx.restore();
  }
}

export function drawControlsCard(ctx: C, x: number, y: number) {
  const rows: [string, string][] = [
    ['← → / A D', 'бежать'],
    ['Пробел / W / ↑', 'прыжок (держи — выше)'],
    ['↓ + прыжок', 'спрыгнуть с полки'],
    ['J / X', 'удар'],
    ['↓ + удар в воздухе', 'удар вниз (отскок!)'],
    ['K / C', 'рогатка'],
    ['Shift / L', 'рывок'],
    ['Q', 'сменить оружие'],
    ['E / F', 'съесть мёд (+3 ♥)'],
    ['Esc / P', 'пауза'],
  ];
  rrect(ctx, x - 300, y, 600, rows.length * 38 + 40, 22, '#fff7e6', 5);
  rows.forEach(([k, v], i) => {
    const ry = y + 44 + i * 38;
    text(ctx, k, x - 20, ry, { size: 20, color: '#b0453a', align: 'right' });
    text(ctx, v, x + 10, ry, { size: 22, font: 'body', color: OUT });
  });
}

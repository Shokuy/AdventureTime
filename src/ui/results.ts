import { W, H, TAU, clamp, ease } from '../engine/util';
import { audio } from '../engine/audio';
import { rrect, text, OUT } from '../art/draw';
import { drawCrumb } from '../art/props';
import { drawCrown } from './scoreboard';
import { drawHint } from './glyphs';
import { coop, DIFF_NAME, type Difficulty } from '../three/game/coop';

type C = CanvasRenderingContext2D;

export interface ResultStats { kills: number; enemies: number; crumbs: number; lost: number; deaths: number; hits: number; nuts: number; nutsTotal: number; time: number }
interface Row { label: string; value: string; bonus: number; good: boolean }

// ───────────────── co-op team page (feature 24) ─────────────────
export interface TeamRow {
  id: string; name: string; color: string; me: boolean;
  pts: number; crumbs: number; kills: number; dmg: number; revives: number; downs: number; nuts: number; best: number;
  /** fun titles («Гроза арбузов»…) */
  titles: string[];
}
export interface TeamCheck { label: string; good: boolean }
export interface TeamResults { rows: TeamRow[]; mvp: string | null; medal: 1 | 2 | 3; checks: TeamCheck[] }
/**
 * Co-op: the score plugin (src/three/game/score.ts) points this at the running chapter's team table.
 * null in solo → the card is exactly the old single page.
 */
export const TEAM_RESULTS: { get: (() => TeamResults | null) | null } = { get: null };

const TITLE_COLORS: Record<string, string> = {
  'Гроза арбузов': '#ff7a5a', 'Ангел-хранитель': '#8ad8ff', 'Крошкоед': '#ffc860', 'Камикадзе': '#ff6a8a',
  'Комбо-мастер': '#c89aff', 'Орехолов': '#ffe14a', 'Тяжёлая рука': '#ff9a3a', 'Турист': '#9ae0a0',
};

const MEDAL = [
  { name: '', c1: '#888', c2: '#555', ink: '#555' },
  { name: 'БРОНЗА', c1: '#e8a060', c2: '#9a5a2a', ink: '#9a5a2a' },
  { name: 'СЕРЕБРО', c1: '#f2f4fa', c2: '#9aa2b8', ink: '#5e6880' },
  { name: 'ЗОЛОТО', c1: '#ffe680', c2: '#d89a1a', ink: '#c07a10' },
];

/** the difficulty the chapter was played on: a little pill in the card's top-right corner */
const DIFF_TAG: Record<Difficulty, [string, string]> = { easy: ['#7ac85a', '#fff7e6'], normal: ['#e6d6bc', '#7a5a4a'], hard: ['#d8283a', '#fff7e6'] };
function drawDiffTag(ctx: C, diff: Difficulty, right: number, y: number) {
  const label = (diff === 'hard' ? '☠ ' : '') + DIFF_NAME[diff].toUpperCase();
  ctx.font = '900 15px Rubik, "Arial Black", sans-serif';
  const w = ctx.measureText(label).width + 26;
  const [bg, ink] = DIFF_TAG[diff];
  rrect(ctx, right - w, y, w, 28, 14, bg, 3);
  text(ctx, label, right - w / 2, y + 20, { size: 15, color: ink, align: 'center' });
}

function drawMedal(ctx: C, medal: number, mx: number, my: number, sc: number, rot: number) {
  const m = MEDAL[medal];
  ctx.save();
  ctx.translate(mx, my); ctx.scale(sc, sc); ctx.rotate(rot);
  ctx.fillStyle = '#c83a4a'; ctx.beginPath(); ctx.moveTo(-22, -10); ctx.lineTo(-30, 52); ctx.lineTo(-12, 42); ctx.lineTo(-2, 58); ctx.lineTo(4, -6); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#3a6ad8'; ctx.beginPath(); ctx.moveTo(22, -10); ctx.lineTo(30, 52); ctx.lineTo(12, 42); ctx.lineTo(2, 58); ctx.lineTo(-4, -6); ctx.closePath(); ctx.fill();
  const g = ctx.createRadialGradient(-10, -12, 4, 0, 0, 40);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.3, m.c1); g.addColorStop(1, m.c2);
  ctx.beginPath(); ctx.arc(0, 0, 38, 0, TAU); ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = OUT; ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 28, 0, TAU); ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.stroke();
  for (let i = 0; i < medal; i++) text(ctx, '★', (i - (medal - 1) / 2) * 16, 7, { size: 18, color: '#fff7e6', align: 'center', stroke: 3 });
  ctx.restore();
}

const TEAM_COLS = ['Очки', 'Крошки', 'Враги', 'Урон', 'Подъёмы', 'Падения', 'Орешки', 'Комбо'] as const;
const TEAM_KEYS = ['pts', 'crumbs', 'kills', 'dmg', 'revives', 'downs', 'nuts', 'best'] as const;

/**
 * "Chapter complete" card: what you collected, how well you fought, a medal and bonus crumbs for playing well.
 * Bonuses: most enemies beaten, few hits taken, no deaths, every golden walnut found.
 * Co-op adds a second page: the team table, MVP, fun titles and the team medal.
 */
export class LevelResults {
  t = 0; done = false;
  rows: Row[] = [];
  bonus = 0;
  medal: 1 | 2 | 3;
  /** 0 = my results, 1 = the team (co-op only) */
  page = 0;
  team: TeamResults | null = null;
  private tt = 0;
  private teamShown = -1;
  private teamStamp = 0;
  private shown = 0;
  private stamped = false;
  private paid = false;
  /** the difficulty this chapter was played on (co-op: the room's) */
  readonly diff: Difficulty = coop.diff;
  constructor(public title: string, s: ResultStats, public best: number, private pay: (n: number) => void) {
    const mm = Math.floor(s.time / 60), ss = Math.floor(s.time % 60);
    let pts = 0, possible = 0;
    this.rows.push({ label: 'Крошки', value: `${s.crumbs}${s.lost ? `  (растеряно ${s.lost})` : ''}`, bonus: 0, good: true });
    if (s.enemies > 0) {
      possible++;
      const ok = s.kills >= Math.ceil(s.enemies * 0.85);
      if (ok) pts++;
      this.rows.push({ label: 'Враги побеждены', value: `${Math.min(s.kills, s.enemies)} из ${s.enemies}`, bonus: ok ? 20 : 0, good: ok });
    }
    if (s.nutsTotal > 0) {
      possible++;
      const ok = s.nuts >= s.nutsTotal;
      if (ok) pts++;
      this.rows.push({ label: 'Золотые орешки', value: `${s.nuts} из ${s.nutsTotal}`, bonus: ok ? 20 : 0, good: ok });
    }
    possible++;
    const fewHits = s.hits <= 3;
    if (fewHits) pts++;
    this.rows.push({ label: 'Пропущено ударов', value: String(s.hits), bonus: fewHits ? 25 : s.hits <= 8 ? 10 : 0, good: s.hits <= 8 });
    possible++;
    if (s.deaths === 0) pts++;
    this.rows.push({ label: 'Падения', value: String(s.deaths), bonus: s.deaths === 0 ? 15 : 0, good: s.deaths === 0 });
    this.rows.push({ label: 'Время', value: `${mm}:${String(ss).padStart(2, '0')}`, bonus: 0, good: true });
    this.medal = pts >= possible ? 3 : pts * 2 >= possible ? 2 : 1;
    this.bonus = this.rows.reduce((a, r) => a + r.bonus, 0) + [0, 0, 10, 25][this.medal];
  }

  private get stampAt() { return 0.5 + this.rows.length * 0.33 + 0.3; }

  update(dt: number, confirm: boolean) {
    this.t += dt;
    if (this.page === 1) { this.updateTeam(dt, confirm); return; }
    const n = Math.min(this.rows.length, Math.floor((this.t - 0.5) / 0.33) + 1);
    if (n > this.shown && this.t > 0.5) { this.shown = n; audio.sfx('coin', { pitch: 0.8 + n * 0.08 }); }
    const stampAt = this.stampAt;
    if (!this.stamped && this.t > stampAt) {
      this.stamped = true;
      audio.sfx(this.medal === 3 ? 'victory' : 'artifact', { volume: 0.8 });
    }
    if (!this.paid && this.t > stampAt + 0.4) { this.paid = true; this.pay(this.bonus); audio.sfx('buy'); }
    if (confirm) {
      if (!this.paid) { this.t = stampAt + 0.45; this.shown = this.rows.length; this.stamped = true; this.paid = true; this.pay(this.bonus); }
      else if (this.t > stampAt + 0.7) {
        // co-op: on to the team page
        this.team = TEAM_RESULTS.get?.() ?? null;
        if (this.team && this.team.rows.length) { this.page = 1; this.tt = 0; audio.sfx('menuSelect'); }
        else this.done = true;
      }
    }
  }

  // team page timeline: rows, then titles, then MVP, then the team medal
  private get teamRowsEnd() { return 0.45 + (this.team?.rows.length ?? 0) * 0.18; }
  private get teamEnd() { return this.teamRowsEnd + 1.5; }

  private updateTeam(dt: number, confirm: boolean) {
    this.tt += dt;
    // the host's final table may land a moment later than the card: keep it fresh
    this.team = TEAM_RESULTS.get?.() ?? this.team;
    const team = this.team!;
    const n = Math.min(team.rows.length, Math.floor((this.tt - 0.45) / 0.18) + 1);
    if (n > this.teamShown && this.tt > 0.45) { this.teamShown = n; audio.sfx('coin', { pitch: 0.9 + n * 0.07 }); }
    const re = this.teamRowsEnd;
    if (this.teamStamp === 0 && this.tt > re + 0.25) { this.teamStamp = 1; audio.sfx('pogo', { volume: 0.5 }); }
    if (this.teamStamp === 1 && this.tt > re + 0.7) { this.teamStamp = 2; audio.sfx('victory', { volume: 0.6 }); }
    if (this.teamStamp === 2 && this.tt > re + 1.1) { this.teamStamp = 3; audio.sfx('artifact', { volume: 0.7 }); }
    if (confirm) {
      if (this.tt < this.teamEnd) { this.tt = this.teamEnd; this.teamShown = team.rows.length; this.teamStamp = 3; }
      else this.done = true;
    }
  }

  draw(ctx: C) {
    const k = ease.outCubic(clamp(this.t / 0.4, 0, 1));
    ctx.save();
    ctx.fillStyle = `rgba(14,6,12,${0.72 * k})`; ctx.fillRect(-2000, -2000, W + 4000, H + 4000);
    if (this.page === 0) this.drawMine(ctx, k, 0);
    else {
      const s = ease.inCubic(clamp(this.tt / 0.35, 0, 1));
      if (s < 1) this.drawMine(ctx, k * (1 - s), -s * 700);
      this.drawTeam(ctx);
    }
    ctx.restore();
  }

  /** page 1: my own results (the classic card) */
  private drawMine(ctx: C, k: number, dx: number) {
    ctx.save();
    ctx.translate(dx, 0);
    const pw = 780, ph = 470, px = W / 2 - pw / 2, py = H / 2 - ph / 2 + (1 - k) * 40;
    ctx.globalAlpha = k;
    rrect(ctx, px + 6, py + 8, pw, ph, 28, 'rgba(0,0,0,0.35)', 0);
    rrect(ctx, px, py, pw, ph, 28, '#fff7e6', 5);
    text(ctx, 'ГЛАВА ПРОЙДЕНА!', W / 2, py + 56, { size: 40, color: '#ff8a2a', align: 'center', stroke: 7 });
    drawDiffTag(ctx, this.diff, px + pw - 22, py + 18);
    text(ctx, this.title, W / 2, py + 88, { size: 20, font: 'body', color: '#7a5a4a', align: 'center' });
    this.rows.forEach((r, i) => {
      if (i >= this.shown) return;
      const y = py + 136 + i * 42;
      const a = clamp((this.t - 0.5 - i * 0.33) / 0.2, 0, 1);
      ctx.globalAlpha = k * a;
      text(ctx, r.label, px + 50, y, { size: 22, font: 'body', color: OUT });
      text(ctx, r.value, px + 410, y, { size: 22, color: r.good ? '#3a7a2a' : '#b0453a', align: 'right' });
      if (i === 0) drawCrumb(ctx, px + 430, y - 8, 1.2, this.t);
      if (r.bonus > 0) text(ctx, `+${r.bonus}`, px + 530, y, { size: 22, color: '#d88a1a', align: 'right', stroke: 4, strokeColor: '#fff7e6' });
    });
    ctx.globalAlpha = k;
    // medal
    if (this.stamped) {
      const st = clamp((this.t - this.stampAt) / 0.3, 0, 1);
      const sc = (1 + (1 - ease.outBack(st)) * 1.4) * 1.5;
      const m = MEDAL[this.medal];
      const mx = px + 660, my = py + 215;
      ctx.globalAlpha = k * st;
      drawMedal(ctx, this.medal, mx, my, sc, -0.15 + Math.sin(this.t * 2) * 0.04);
      text(ctx, m.name, mx, my + 100, { size: 18, color: m.c2, align: 'center', stroke: 4, strokeColor: '#fff7e6' });
      if (this.best > 0 && this.medal > this.best) text(ctx, 'Новый рекорд!', mx, my + 124, { size: 15, font: 'body', color: '#d83a4a', align: 'center' });
      ctx.globalAlpha = k;
    }
    // bonus total
    if (this.paid) {
      const y = py + ph - 64;
      rrect(ctx, px + 40, y - 30, pw - 80, 44, 16, '#ffe9b0', 3);
      drawCrumb(ctx, px + 72, y - 8, 1.5, this.t);
      text(ctx, `Награда за прохождение: +${this.bonus} крошек`, W / 2 + 14, y, { size: 22, color: '#7a4a1a', align: 'center' });
      if (this.t > this.stampAt + 0.7) {
        ctx.globalAlpha = k * (0.6 + Math.sin(this.t * 4) * 0.3);
        text(ctx, TEAM_RESULTS.get ? 'Пробел / клик — итоги команды' : 'Пробел / клик — дальше', W / 2, py + ph - 16, { size: 16, font: 'body', color: '#9a7a6a', align: 'center' });
      }
    }
    ctx.restore();
  }

  /** page 2 (co-op): everyone's numbers, MVP, titles and the team medal */
  private drawTeam(ctx: C) {
    const team = this.team;
    if (!team) return;
    const tt = this.tt;
    const k = ease.outCubic(clamp((tt - 0.1) / 0.4, 0, 1));
    // the card hugs the table: rows, then the MVP / medal strip
    const RH = 50, nRows = team.rows.length;
    const pw = 1180, ph = 124 + 18 + nRows * RH + 24 + 140 + 34, px = W / 2 - pw / 2, py = (H - ph) / 2 - 8 + (1 - k) * 60;
    const re = this.teamRowsEnd;
    ctx.save();
    ctx.globalAlpha = k;
    ctx.translate((1 - k) * 300, 0);
    rrect(ctx, px + 6, py + 8, pw, ph, 28, 'rgba(0,0,0,0.35)', 0);
    rrect(ctx, px, py, pw, ph, 28, '#fff7e6', 5);
    text(ctx, 'ИТОГИ КОМАНДЫ', W / 2, py + 54, { size: 38, color: '#ff8a2a', align: 'center', stroke: 7 });
    drawDiffTag(ctx, this.diff, px + pw - 26, py + 20);
    text(ctx, this.title, W / 2, py + 84, { size: 19, font: 'body', color: '#7a5a4a', align: 'center' });
    // header
    const c0 = px + 300, cw = 74, tx = px + 905;
    const hy = py + 124;
    text(ctx, 'Игрок', px + 78, hy, { size: 16, font: 'body', color: '#9a7a6a' });
    TEAM_COLS.forEach((c, i) => text(ctx, c, c0 + i * cw + cw / 2, hy, { size: 16, font: 'body', color: '#9a7a6a', align: 'center' }));
    text(ctx, 'Звания', tx + 4, hy, { size: 16, font: 'body', color: '#9a7a6a' });
    ctx.fillStyle = 'rgba(42,27,26,0.15)'; ctx.fillRect(px + 30, hy + 10, pw - 60, 2);
    // per-column best (highlighted)
    const bestOf = (key: (typeof TEAM_KEYS)[number]) => Math.max(...team.rows.map((r) => r[key]));
    const best = TEAM_KEYS.map((key) => bestOf(key));
    team.rows.forEach((r, i) => {
      const ry = hy + 18 + i * RH;
      const a = clamp((tt - 0.45 - i * 0.18) / 0.2, 0, 1);
      if (a <= 0) return;
      ctx.globalAlpha = k * a;
      if (r.me) rrect(ctx, px + 24, ry, pw - 48, RH - 6, 14, '#ffe9b0', 0);
      const my = ry + (RH - 6) / 2;
      if (r.id === team.mvp && tt > re + 0.7) drawCrown(ctx, px + 52, my, 0.75, tt);
      else text(ctx, String(i + 1), px + 52, my + 7, { size: 20, color: '#b8a090', align: 'center' });
      ctx.font = '700 22px Rubik, sans-serif';
      const nw = ctx.measureText(r.name).width;
      text(ctx, r.name, px + 78, my + 8, { size: nw > 200 ? Math.max(13, Math.floor(22 * 200 / nw)) : 22, weight: 700, color: r.color, stroke: 5 });
      TEAM_KEYS.forEach((key, j) => {
        const v = r[key];
        const top = v > 0 && v === best[j] && team.rows.length > 1 && key !== 'downs';
        text(ctx, String(v), c0 + j * cw + cw / 2, my + 8, { size: j === 0 ? 23 : 21, color: j === 0 ? '#d86a1a' : top ? '#2a8a3a' : OUT, align: 'center' });
      });
      // titles: little badges that pop in after the rows
      const ta = clamp((tt - re - 0.25 - i * 0.08) / 0.25, 0, 1);
      if (ta > 0) {
        r.titles.slice(0, 2).forEach((ti, j) => {
          ctx.font = '400 15px Pangolin, sans-serif';
          const bw = ctx.measureText(ti).width + 18;
          const bx = tx, by = my - 20 + j * 21 + (r.titles.length === 1 ? 10 : 0);
          const s = ease.outBack(ta);
          ctx.save();
          ctx.translate(bx + bw / 2, by + 9); ctx.scale(s, s);
          rrect(ctx, -bw / 2, -9, bw, 19, 9, TITLE_COLORS[ti] ?? '#c8b8ff', 2);
          text(ctx, ti, 0, 5, { size: 15, font: 'body', color: OUT, align: 'center' });
          ctx.restore();
        });
      }
    });
    ctx.globalAlpha = k;
    // MVP
    const by = py + ph - 174;
    const mvp = team.rows.find((r) => r.id === team.mvp);
    if (mvp && tt > re + 0.7) {
      const s = ease.outBack(clamp((tt - re - 0.7) / 0.35, 0, 1));
      ctx.save();
      ctx.translate(px + 40 + 270, by + 70); ctx.scale(s, s);
      rrect(ctx, -270, -70, 540, 140, 20, '#ffe9b0', 3);
      drawCrown(ctx, -200, -4, 2.1, tt);
      text(ctx, 'MVP', -130, -18, { size: 36, color: '#ff8a2a', stroke: 6 });
      ctx.font = '700 30px Rubik, sans-serif';
      const nw = ctx.measureText(mvp.name).width;
      text(ctx, mvp.name, -130, 26, { size: nw > 360 ? Math.floor(30 * 360 / nw) : 30, weight: 700, color: mvp.color, stroke: 6 });
      text(ctx, `${mvp.pts} очков — лучший в команде!`, -130, 54, { size: 17, font: 'body', color: '#7a5a4a' });
      ctx.restore();
    }
    // team medal + what it took
    if (tt > re + 1.1) {
      const st = clamp((tt - re - 1.1) / 0.3, 0, 1);
      const mx = px + 680, my = by + 62;
      ctx.globalAlpha = k * st;
      drawMedal(ctx, team.medal, mx, my, (1 + (1 - ease.outBack(st)) * 1.4) * 1.15, -0.12 + Math.sin(tt * 2) * 0.04);
      ctx.globalAlpha = k * st;
      text(ctx, 'Медаль команды:', px + 760, by + 22, { size: 20, color: OUT });
      const lw = ctx.measureText('Медаль команды:').width;
      text(ctx, MEDAL[team.medal].name, px + 770 + lw, by + 22, { size: 22, color: MEDAL[team.medal].ink });
      team.checks.forEach((c, i) => {
        text(ctx, (c.good ? '✔ ' : '✖ ') + c.label, px + 760, by + 54 + i * 27, { size: 18, font: 'body', color: c.good ? '#3a7a2a' : '#b0453a' });
      });
    }
    if (tt > this.teamEnd) {
      ctx.globalAlpha = k * (0.65 + Math.sin(this.t * 4) * 0.3);
      drawHint(ctx, 'confirm', 'дальше', px + pw - 150, py + ph - 17, { size: 22, color: '#9a7a6a', stroke: 0 });
    }
    ctx.restore();
  }
}

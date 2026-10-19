import { drawPortrait, PORTRAIT_IDS, PORTRAIT_EXPRS, PORTRAIT_INFO, type PortraitId, type PortraitVariant } from '../../art/portraits';
import { Dialog } from '../../ui/dialog';
import { rrect, text, wrap, OUT } from '../../art/draw';

/* Dev page: /portraits-preview.html — every dialog portrait × every expression.
 * ?ids=noki,pastila  (subset)   ?r=80 (big radius)   ?t=1.3 (freeze time)   ?talk=0.6 (freeze mouth)
 * ?mode=box  — the real dialog box layout (r=62) for each id with a sample line.
 * window.__pv.render(t) redraws at time t (for screenshots). */

const q = new URLSearchParams(location.search);
const ids = (q.get('ids')?.split(',') as PortraitId[]) ?? PORTRAIT_IDS;
const R = Number(q.get('r') ?? 80);
const mode = q.get('mode') ?? 'grid';
const fixedT = q.get('t'), fixedTalk = q.get('talk');
const extra: { id: PortraitId; variant: PortraitVariant; label: string }[] = [];
if (!q.get('ids') || ids.includes('shepot')) extra.push({ id: 'shepot', variant: 'seen', label: 'shepot (seen)' });
if (q.get('mice') !== '0') for (const id of ['netopyr', 'morok', 'shepot', 'nochka', 'tenka'] as PortraitId[]) if (!q.get('ids') || ids.includes(id)) extra.push({ id, variant: 'mouse', label: id + ' (mouse)' });
const rows: { id: PortraitId; variant?: PortraitVariant; label: string }[] = [...ids.map((id) => ({ id, label: id })), ...extra];

const cv = document.getElementById('c') as HTMLCanvasElement;
const ctx = cv.getContext('2d')!;
const cell = R * 2 + 16, labelW = 150, smallR = 31;
const cols = PORTRAIT_EXPRS.length;
let Wd = 0, Hd = 0;
if (mode === 'box') { Wd = 1120; Hd = rows.length * 190 + 20; }
else { Wd = labelW + cols * cell + 140 + 80 + 20; Hd = 40 + rows.length * cell; }
cv.width = Wd; cv.height = Hd;
cv.style.width = Wd + 'px'; cv.style.height = Hd + 'px';

const LINES = ['Ну что, пойдём? Ночь длинная, а пастилы в городе всё меньше и меньше!', 'Пи! Не пустим! Я всё ещё граф!'];

function render(t: number) {
  ctx.fillStyle = '#2a2230'; ctx.fillRect(0, 0, Wd, Hd);
  const talk = fixedTalk !== null ? Number(fixedTalk) : Math.abs(Math.sin(t * 16));
  if (mode === 'box') {
    rows.forEach((row, i) => {
      const bw = 1060, bh = Dialog.BOX_H, bx = 30, by = 30 + i * 190;
      const info = PORTRAIT_INFO[row.id];
      rrect(ctx, bx + 6, by + 8, bw, bh, 22, 'rgba(0,0,0,0.4)', 0);
      rrect(ctx, bx, by, bw, bh, 22, '#fff7e6', 5);
      drawPortrait(ctx, row.id, bx + 86, by + bh / 2 - 6, 62, t, talk, i % 3 === 1 ? 'happy' : undefined, row.variant);
      ctx.font = '900 20px Rubik, sans-serif';
      const name = info.name || '—';
      const nw = ctx.measureText(name).width + 30;
      rrect(ctx, bx + 160, by - 18, nw, 34, 12, info.color, 4);
      text(ctx, name, bx + 175, by + 6, { size: 20, color: '#fff', stroke: 0 });
      ctx.font = '400 27px Pangolin, "Comic Sans MS", sans-serif';
      wrap(ctx, LINES[row.variant === 'mouse' ? 1 : 0], bw - 210).forEach((ln, j) => text(ctx, ln, bx + 170, by + 50 + j * 34, { size: 27, font: 'body', color: OUT }));
    });
    return;
  }
  ctx.font = '700 13px system-ui'; ctx.fillStyle = '#f3e9dc'; ctx.textAlign = 'center';
  PORTRAIT_EXPRS.forEach((e, j) => ctx.fillText(e, labelW + j * cell + cell / 2, 24));
  ctx.fillText('talk r62', labelW + cols * cell + 70, 24);
  ctx.fillText('r31', labelW + cols * cell + 180, 24);
  rows.forEach((row, i) => {
    const y = 40 + i * cell + cell / 2;
    ctx.textAlign = 'left'; ctx.fillStyle = '#f3e9dc'; ctx.font = '700 14px system-ui';
    ctx.fillText(row.label, 10, y);
    ctx.font = '12px system-ui'; ctx.fillStyle = '#b8a8c8'; ctx.fillText(PORTRAIT_INFO[row.id].name, 10, y + 16);
    PORTRAIT_EXPRS.forEach((e, j) => drawPortrait(ctx, row.id, labelW + j * cell + cell / 2, y, R, t + j * 0.37, fixedTalk !== null ? Number(fixedTalk) : 0, e, row.variant));
    drawPortrait(ctx, row.id, labelW + cols * cell + 70, y, Math.min(62, cell / 2 - 6), t, talk, undefined, row.variant);
    drawPortrait(ctx, row.id, labelW + cols * cell + 180, y, smallR, t, talk, undefined, row.variant);
  });
}

let raf = 0;
const loop = (ms: number) => { render(fixedT !== null ? Number(fixedT) : ms / 1000); raf = requestAnimationFrame(loop); };
if (fixedT !== null) render(Number(fixedT)); else raf = requestAnimationFrame(loop);
(window as unknown as { __pv: unknown }).__pv = { render: (t: number) => { cancelAnimationFrame(raf); render(t); } };

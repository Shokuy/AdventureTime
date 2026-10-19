import '@fontsource/rubik/900.css';
import '@fontsource/rubik/700.css';
import '@fontsource/pangolin/400.css';
import { W, H } from './engine/util';
import { input } from './engine/input';
import { audio } from './engine/audio';
import { save } from './engine/save';
import { game, StoryStep } from './game/game';
import { MenuScene } from './scenes/menu';
import { LevelScene } from './scenes/level';
import { DenScene } from './scenes/den';
import { StoryScene } from './scenes/story';
import { CreditsScene } from './scenes/credits';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
let scale = 1, ox = 0, oy = 0, dpr = 1;
let lastW = 0, lastH = 0, lastDpr = 0;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const cw = rect.width || window.innerWidth, ch = rect.height || window.innerHeight;
  lastW = cw; lastH = ch; lastDpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(cw * dpr);
  canvas.height = Math.floor(ch * dpr);
  scale = Math.min(cw / W, ch / H);
  ox = (cw - W * scale) / 2;
  oy = (ch - H * scale) / 2;
}
window.addEventListener('resize', resize);
resize();

input.attach(canvas, (cx, cy) => [(cx - ox) / scale, (cy - oy) / scale]);
input.onFirstGesture = () => {
  audio.init();
  audio.setMusicVolume(save.data.settings.music);
  audio.setSfxVolume(save.data.settings.sfx);
};
canvas.focus();

save.load();

game.menu = () => new MenuScene();
game.factories = {
  story: (s: StoryStep) => new StoryScene((s as { id: 'intro' | 'ending' }).id),
  level: (s: StoryStep, i: number) => new LevelScene((s as { id: string }).id, i),
  den: (s: StoryStep) => new DenScene((s as { visit: number }).visit),
  credits: () => new CreditsScene(),
};

// debug helpers in the console: __game.story(n)
(window as unknown as Record<string, unknown>).__game = game;
(window as unknown as Record<string, unknown>).__save = save;

let last = performance.now();
let acc = 0;
const STEP = 1 / 60;
let started = false;

function frame(now: number) {
  const r = canvas.getBoundingClientRect();
  if (r.width !== lastW || r.height !== lastH || (window.devicePixelRatio || 1) !== lastDpr) resize();
  const elapsed = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += elapsed;
  let steps = 0;
  while (acc >= STEP && steps < 5) {
    input.beginTick();
    game.update(STEP);
    input.endTick();
    acc -= STEP;
    steps++;
  }
  if (steps === 5) acc = 0;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0a0406';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, ox * dpr, oy * dpr);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
  game.render(ctx);
  if (!started) drawClickToStart(ctx);
  ctx.restore();
  requestAnimationFrame(frame);
}

function drawClickToStart(c: CanvasRenderingContext2D) {
  void c;
}

function renderNow() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0a0406';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, ox * dpr, oy * dpr);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
  game.render(ctx);
  ctx.restore();
}

// debug: advance the simulation deterministically (useful when the tab is hidden)
(window as unknown as Record<string, unknown>).__step = (frames: number, keys: string[] = []) => {
  for (const k of keys) window.dispatchEvent(new KeyboardEvent('keydown', { code: k }));
  for (let i = 0; i < frames; i++) { input.beginTick(); game.update(STEP); input.endTick(); }
  for (const k of keys) window.dispatchEvent(new KeyboardEvent('keyup', { code: k }));
  renderNow();
};

async function boot() {
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('900 40px Rubik'),
        document.fonts.load('700 40px Rubik'),
        document.fonts.load('400 24px Pangolin'),
      ]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch { /* fonts optional */ }
  started = true;
  game.set(new MenuScene());
  requestAnimationFrame(frame);
}

void boot();

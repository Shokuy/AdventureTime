import '@fontsource/rubik/900.css';
import '@fontsource/rubik/700.css';
import '@fontsource/pangolin/400.css';
import { W, H } from './engine/util';
import { input } from './engine/input';
import { audio } from './engine/audio';
import { save, setSaveKey } from './engine/save';
import { game, StoryStep } from './game/game';
import { CreditsScene } from './scenes/credits';
import { Renderer3D } from './three/render';
import { RT } from './three/runtime';
import { Level3D } from './three/game/level';
import { Menu3D, Den3D, Story3D } from './three/scenes3d';
import { net } from './net/session';
import { coopFlow, COOP_SCENES } from './three/game/coopFlow';
import { LobbyScene } from './three/scenes/lobby';
import { WorldMap3D } from './three/scenes/worldMap';
import { episodeScene } from './three/scenes/episodeStub';
import { completeEpisode, migrateEpisodes } from './three/game/episodes';
import { applySettings, applyAudio } from './ui/settings';
import './three/game/socialPlugin';
import './three/game/coopMechanics';
import './three/game/score';
import './three/game/pvp';
import './three/game/voice3d';
import './three/game/arc';

const glCanvas = document.getElementById('game3d') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLCanvasElement;
const ctx = ui.getContext('2d')!;
let dpr = 1;
let lastW = 0, lastH = 0, lastDpr = 0;

const r3 = new Renderer3D(glCanvas);
RT.r3 = r3;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = window.innerWidth, ch = window.innerHeight;
  lastW = cw; lastH = ch; lastDpr = window.devicePixelRatio || 1;
  ui.width = Math.floor(cw * dpr);
  ui.height = Math.floor(ch * dpr);
  RT.winW = cw; RT.winH = ch;
  RT.scale = Math.min(cw / W, ch / H);
  RT.ox = (cw - W * RT.scale) / 2;
  RT.oy = (ch - H * RT.scale) / 2;
  r3.setSize(cw, ch, window.devicePixelRatio || 1);
}
window.addEventListener('resize', resize);
resize();

input.setMode('3d');
input.attach(ui, (cx, cy) => [(cx - RT.ox) / RT.scale, (cy - RT.oy) / RT.scale]);
// While developing (vite dev): total silence (no music, no sounds) so testing never makes noise.
// Add ?music=1 to the URL to hear it again.
if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV && !new URLSearchParams(location.search).has('music')) {
  const setMusic = audio.setMusicVolume.bind(audio);
  const setSfx = audio.setSfxVolume.bind(audio);
  const setMaster = audio.setMasterVolume.bind(audio);
  audio.setMusicVolume = () => setMusic(0);
  audio.setSfxVolume = () => setSfx(0);
  audio.setMasterVolume = () => setMaster(0);
  setMusic(0);
  setSfx(0);
  setMaster(0);
}

input.onFirstGesture = () => {
  audio.init();
  applyAudio();
};
ui.focus();

setSaveKey('gromadnoe-korolevstvo-3d-save-v1');
save.load();
// saved settings: volumes, picture (outlines, soft shadows, resolution), rebinds
applySettings();

// «Хрумляндия»: saves that finished the prologue before the map existed open it right away
migrateEpisodes();

game.menu = () => new Menu3D();
// after the prologue: the world map; an episode's unbuilt level / scene step plays its card
game.map = () => new WorldMap3D();
game.onPrologueDone = () => { completeEpisode('prologue'); };
game.factories = {
  story: (s: StoryStep) => new Story3D((s as { id: 'intro' | 'ending' }).id),
  level: (s: StoryStep, i: number) => new Level3D((s as { id: string }).id, i),
  den: (s: StoryStep) => new Den3D((s as { visit: number }).visit),
  credits: () => new CreditsScene(),
  scene: (s: StoryStep) => { const st = s as { ep: string; id: string }; return episodeScene(st.ep, st.id); },
};

// co-op scene flow (the host moves the room between chapters, the den, story scenes and the credits)
COOP_SCENES.den = (visit) => new Den3D(visit);
COOP_SCENES.story = (id) => new Story3D(id);
COOP_SCENES.credits = () => new CreditsScene();
COOP_SCENES.lobby = () => new LobbyScene();
COOP_SCENES.map = () => new WorldMap3D();
COOP_SCENES.scene = (ep, id) => episodeScene(ep, id);
coopFlow.init();

const w = window as unknown as Record<string, unknown>;
w.__game = game;
w.__save = save;
w.__Level3D = Level3D;
w.__RT = RT;
w.__net = net;
w.__coopFlow = coopFlow;

const STEP = 1 / 60;
let last = performance.now();
let acc = 0;

function draw() {
  const is3d = !!(game.scene as unknown as { is3d?: boolean } | null)?.is3d || game.scene instanceof Level3D;
  glCanvas.style.visibility = is3d ? 'visible' : 'hidden';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ui.width, ui.height);
  if (!is3d) { ctx.fillStyle = '#0a0406'; ctx.fillRect(0, 0, ui.width, ui.height); }
  ctx.setTransform(RT.scale * dpr, 0, 0, RT.scale * dpr, RT.ox * dpr, RT.oy * dpr);
  game.render(ctx, false);
  if (game.fade > 0) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = game.fade;
    ctx.fillStyle = game.fadeColor;
    ctx.fillRect(0, 0, ui.width, ui.height);
    ctx.globalAlpha = 1;
  }
}

function frame(now: number) {
  hiddenTicks = false;
  if (window.innerWidth !== lastW || window.innerHeight !== lastH || (window.devicePixelRatio || 1) !== lastDpr) resize();
  const elapsed = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += elapsed;
  let steps = 0;
  while (acc >= STEP && steps < 4) {
    input.beginTick();
    game.update(STEP);
    input.endTick();
    acc -= STEP;
    steps++;
  }
  if (steps === 4) acc = 0;
  draw();
  requestAnimationFrame(frame);
}

// A hidden tab gets no animation frames. If I'm hosting a co-op room the world must keep running for my
// friends, so a worker clock (not throttled like page timers) drives the simulation without drawing.
let hiddenTicks = false;
let hiddenLast = 0;
try {
  const src = 'let id=0;onmessage=(e)=>{clearInterval(id);if(e.data)id=setInterval(()=>postMessage(0),16)}';
  const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  worker.onmessage = () => {
    if (!document.hidden || !net.active) return;
    const now = performance.now();
    if (!hiddenTicks) { hiddenTicks = true; hiddenLast = now; return; }
    let el = Math.min(0.25, (now - hiddenLast) / 1000);
    hiddenLast = now;
    while (el >= STEP) { input.beginTick(); game.update(STEP); input.endTick(); el -= STEP; }
    hiddenLast -= el * 1000;
  };
  document.addEventListener('visibilitychange', () => { worker.postMessage(document.hidden ? 1 : 0); last = performance.now(); acc = 0; });
} catch { /* no workers: a hidden host pauses its world */ }

// debug: deterministic stepping (works even when the tab is hidden)
w.__tick = (frames: number, keys: string[] = []) => {
  for (const k of keys) window.dispatchEvent(new KeyboardEvent('keydown', { code: k }));
  for (let i = 0; i < frames; i++) { input.beginTick(); game.update(STEP); input.endTick(); }
  for (const k of keys) window.dispatchEvent(new KeyboardEvent('keyup', { code: k }));
};
w.__step = (frames: number, keys: string[] = []) => {
  (w.__tick as (f: number, k: string[]) => void)(frames, keys);
  draw();
};

if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) void import('./three/dev/testkit');

async function boot() {
  try {
    await Promise.race([
      Promise.all([document.fonts.load('900 40px Rubik'), document.fonts.load('700 40px Rubik'), document.fonts.load('400 24px Pangolin')]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch { /* fonts optional */ }
  game.set(new Menu3D());
  document.getElementById('loading')?.remove();
  requestAnimationFrame(frame);
}

void boot();

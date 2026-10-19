import { W, H } from '../engine/util';
import { save } from '../engine/save';
import { input } from '../engine/input';
import { audio } from '../engine/audio';

export interface Scene {
  update(dt: number): void;
  render(ctx: CanvasRenderingContext2D): void;
  leave?(): void;
}

export type StoryStep =
  | { kind: 'story'; id: 'intro' | 'ending' }
  | { kind: 'level'; id: string; title: string }
  | { kind: 'den'; visit: number }
  | { kind: 'credits' }
  /** an episode's scene step (EPISODE_SCENES) — or a level not built yet: the «Серия в разработке» card */
  | { kind: 'scene'; id: string; ep: string };

/**
 * A playlist other than the prologue's STORY — an episode of «Хрумляндия» (episodes.ts builds it): advance() walks
 * its steps, past the last one done() decides what's next (the world map). The prologue keeps using story().
 */
export interface Run {
  id: string;
  steps: StoryStep[];
  i: number;
  /** a step starts (progress for «Продолжить») */
  at?: (i: number) => void;
  done: () => void;
}

export const STORY: StoryStep[] = [
  { kind: 'story', id: 'intro' },
  { kind: 'level', id: 'pantry', title: 'Глава 1. Кладовая' },
  { kind: 'den', visit: 1 },
  { kind: 'level', id: 'feast', title: 'Глава 2. Пиршественный зал' },
  { kind: 'den', visit: 2 },
  { kind: 'level', id: 'library', title: 'Глава 3. Библиотека' },
  { kind: 'den', visit: 3 },
  { kind: 'level', id: 'chase', title: 'Глава 4. Погоня' },
  { kind: 'level', id: 'throne', title: 'Глава 5. Король Громадин' },
  { kind: 'story', id: 'ending' },
  { kind: 'credits' },
];

type Factory = () => Scene;

class Game {
  scene: Scene | null = null;
  private pending: Factory | null = null;
  fade = 1;
  private fadeDir = -1;
  private fadeSpeed = 2.5;
  fadeColor = '#0c0608';
  factories: Record<string, (step: StoryStep, index: number) => Scene> = {};
  menu: Factory | null = null;
  /** the world map of Хрумляндия (after the prologue); none registered → the main menu */
  map: Factory | null = null;
  /** the prologue's credits are over: mark it done (episodes.ts, wired in main3d) */
  onPrologueDone: (() => void) | null = null;
  /** the episode being played (null: the prologue's STORY or a menu) */
  run: Run | null = null;
  time = 0;

  go(f: Factory, speed = 2.5, color = '#0c0608') {
    if (this.pending) return;
    this.pending = f;
    this.fadeDir = 1;
    this.fadeSpeed = speed;
    this.fadeColor = color;
    input.clearAll();
  }

  /** like go(), but a newer request replaces one still fading (network scene changes must never be dropped) */
  goNow(f: Factory, speed = 2.5, color = '#0c0608') {
    if (this.pending) { this.pending = f; return; }
    this.go(f, speed, color);
  }

  /** immediately set (used at boot) */
  set(s: Scene) { this.scene = s; this.fade = 1; this.fadeDir = -1; }

  toMenu() { this.run = null; if (this.menu) { audio.stopMusic(0.6); this.go(this.menu); } }

  /** the world map (the main menu while none is registered) */
  toMap() {
    this.run = null;
    if (!this.map) { this.toMenu(); return; }
    audio.stopMusic(0.6);
    this.go(this.map);
  }

  /** the prologue's credits ended: «Главы» / the prologue node replay from the boss, the prologue is done → the world map */
  endPrologue() {
    save.data.story = Math.max(0, STORY.findIndex((s) => s.kind === 'level' && s.id === 'throne'));
    this.onPrologueDone?.();
    save.write();
    this.toMap();
  }

  story(index: number) {
    this.run = null;
    const step = STORY[index];
    if (!step) { this.toMenu(); return; }
    save.data.story = index;
    save.data.reached = Math.max(save.data.reached, index);
    save.data.started = true;
    save.write();
    const make = this.factories[step.kind];
    this.go(() => make(step, index));
  }

  /** play step `i` of an episode run; past its last step → run.done() */
  play(run: Run, i = 0) {
    const step = run.steps[i];
    if (!step) { this.run = null; run.done(); return; }
    this.run = run;
    run.i = i;
    run.at?.(i);
    const make = this.factories[step.kind];
    this.go(() => make(step, i));
  }

  /** the next step: of the episode being played, else of the prologue's STORY */
  advance() {
    if (this.run) { this.play(this.run, this.run.i + 1); return; }
    this.story(save.data.story + 1);
  }

  update(dt: number) {
    this.time += dt;
    if (this.fadeDir > 0) {
      this.fade = Math.min(1, this.fade + dt * this.fadeSpeed);
      if (this.fade >= 1 && this.pending) {
        this.scene?.leave?.();
        const f = this.pending; this.pending = null;
        this.scene = f();
        this.fadeDir = -1;
        input.clearAll();
        return;
      }
    } else if (this.fade > 0) {
      this.fade = Math.max(0, this.fade - dt * this.fadeSpeed);
    }
    if (!this.pending) this.scene?.update(dt);
  }

  render(ctx: CanvasRenderingContext2D, drawFade = true) {
    this.scene?.render(ctx);
    if (drawFade && this.fade > 0) {
      ctx.globalAlpha = this.fade;
      ctx.fillStyle = this.fadeColor;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }
}

export const game = new Game();

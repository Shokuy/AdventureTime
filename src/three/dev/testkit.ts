/* Dev-only helpers for scripted playtests from the browser console (loaded in `vite dev` only). */
import * as THREE from 'three';
import type { Level3D } from '../game/level';
import { save } from '../../engine/save';
import { game } from '../../game/game';
import { playEpisode, EPISODES } from '../game/episodes';

type W = Record<string, unknown> & { __step: (frames: number, keys?: string[]) => void; __tick: (frames: number, keys?: string[]) => void; __game: { scene: unknown } };
const w = window as unknown as W;
const scene = () => w.__game.scene as Level3D;
let frozen = false, stepping = false;

/** advance without rendering (fast); respects __freeze */
function tick(f: number, k: string[] = []) { stepping = true; try { w.__tick(f, k); } finally { stepping = false; } }

/** keys held across frames (keydown once when pressed, keyup once when released) — like a real player */
const held = new Set<string>();
function holdKeys(keys: string[]) {
  const want = new Set(keys);
  for (const k of [...held]) if (!want.has(k)) { window.dispatchEvent(new KeyboardEvent('keyup', { code: k })); held.delete(k); }
  for (const k of want) if (!held.has(k)) { window.dispatchEvent(new KeyboardEvent('keydown', { code: k })); held.add(k); }
}

/** step frames, auto-advancing dialogs; stop early when until() is true (returns the frame index, or -1) */
function play(frames: number, until?: ((L: Level3D) => boolean) | null, keys: string[] = []) {
  for (let i = 0; i < frames; i++) {
    const L = scene();
    if (until && until(L)) return i;
    if ((L.dialog?.active || L.popup?.active || L.results) && i % 14 === 0) tick(1, ['Enter']);
    else tick(1, keys);
  }
  return -1;
}

/** runner autopilot for the chase: lane plan + jumps + dodging the King's slams and walnuts */
function chaseBot(maxSec: number, trace: string[] | null = null, sprint = true, tr0 = 238, tr1 = 252) {
  const L = scene();
  const p = L.player;
  const zPlan: [number, number][] = [[0, 0], [28, 2.8], [38, 0], [66, 0], [70, 2.1], [80, 0], [118, 0], [150, 0], [170, 0], [194, 3.5], [203, -3.5], [214, 0], [230, 1.5], [238, 0], [278, -2.2], [286, 0]];
  const jumpAt = [43.6, 56.9, 120.0, 136.2, 140.6, 239.6];
  const djAt = [244.0];
  const dashAt = [245.5];
  const tz = (x: number) => { let z = 0; for (const [x0, zz] of zPlan) if (x >= x0) z = zz; return z; };
  const log: string[] = []; const hits: string[] = [];
  let jumpedX = -99, frames = 0, lastHp = p.hp, hold = 0, dj = false;
  const dashed = new Set<number>();
  while (frames < 60 * maxSec && !p.dead && !L.complete) {
    const keys: string[] = sprint ? ['KeyW'] : [];
    let want = tz(p.pos.x);
    const ch = L.chaser as unknown as { slam: { state: string; marker: { position: { x: number; z: number } } } } | null;
    const s = ch?.slam;
    if (s && (s.state === 'track' || s.state === 'slam') && s.marker.position.x - p.pos.x > -2 && s.marker.position.x - p.pos.x < 9 && Math.abs(s.marker.position.z - want) < 4) want = s.marker.position.z > 0 ? s.marker.position.z - 4.2 : s.marker.position.z + 4.2;
    for (const f of L.fallers) if (Math.abs(f.marker.position.z - want) < 1.5 && f.marker.position.x - p.pos.x > -1 && f.marker.position.x - p.pos.x < 6) want = f.marker.position.z > 0 ? f.marker.position.z - 2 : f.marker.position.z + 2;
    want = Math.max(-6, Math.min(6, want));
    const dz = want - p.pos.z;
    if (dz > 0.3) keys.push('KeyD'); else if (dz < -0.3) keys.push('KeyA');
    for (const j of jumpAt) if (p.pos.x > j && p.pos.x < j + 2.5 && p.body.onGround && Math.abs(jumpedX - j) > 0.01) { jumpedX = j; hold = 22; }
    let tapJump = false;
    for (const j of djAt) if (p.pos.x > j && p.pos.x < j + 2 && !p.body.onGround && !dashed.has(-j)) { dashed.add(-j); hold = 0; tapJump = true; }
    if (hold > 0) { keys.push('Space'); hold--; }
    if (tapJump) { holdKeys(keys.filter((k) => k !== 'Space')); tick(1, ['Space']); }
    for (const j of dashAt) if (!dashed.has(j) && p.pos.x > j && !p.body.onGround) { dashed.add(j); keys.push('ShiftLeft'); }
    if (p.body.onGround && p.pos.x < 239.5) { for (const j of dashAt) dashed.delete(j); for (const j of djAt) dashed.delete(-j); }
    if (trace && p.pos.x > tr0 && p.pos.x < tr1) trace.push(`${p.pos.x.toFixed(1)},${p.pos.y.toFixed(1)},${p.body.vel.y.toFixed(0)}${p.canDouble ? 'd' : ''}${keys.length ? ':' + keys.join('+') : ''}`);
    for (const e of L.enemies) if (e.body.pos.x - p.pos.x > 0 && e.body.pos.x - p.pos.x < 2.6 && Math.abs(e.body.pos.z - p.pos.z) < 1.5) keys.push('KeyJ');
    if (p.pos.x > 120 && p.pos.x < 127 && p.body.vel.y < 1 && !p.body.onGround && !dj) { dj = true; holdKeys([]); tick(1, ['Space']); }
    // falling toward a pit: double jump
    if (!p.body.onGround && p.body.vel.y < -1 && !dj && p.canDouble && L.phys.groundAt(p.pos.x + 0.6, p.pos.z, p.pos.y + 0.5, 0.2) < -0.2) { dj = true; holdKeys([]); tick(1, ['Space']); }
    if (p.body.onGround && (p.pos.x < 119 || p.pos.x > 128)) dj = false;
    if (p.grabbedBy && frames % 4 === 0) { holdKeys([]); tick(1, ['Space']); }
    if (p.pos.x < jumpedX - 1) jumpedX = -99;
    // taps (attack/dash) are pressed fresh; movement and jump are held like a real player
    const taps: string[] = keys.filter((k) => k === 'KeyJ' || k === 'ShiftLeft');
    holdKeys(keys.filter((k) => !taps.includes(k)));
    if (L.dialog?.active && frames % 14 === 0) tick(1, ['Enter']); else tick(1, taps);
    frames++;
    if (p.hp < lastHp) hits.push(`x${p.pos.x.toFixed(0)}`);
    lastHp = p.hp;
    if (frames % 120 === 0) log.push(`${p.pos.x.toFixed(0)}/${(p.pos.x - ((L.chaser as unknown as { front: number })?.front ?? 0)).toFixed(0)}/${p.hp}`);
  }
  holdKeys([]);
  return { log: log.join(' '), hits: hits.join(','), dead: p.dead, complete: L.complete, x: p.pos.x.toFixed(1) };
}

/** record what hurts the hero */
function traceHurt() {
  const L = scene(); const p = L.player; const causes: string[] = [];
  const oh = p.hurt.bind(p);
  p.hurt = (L2, d, from) => { const r = oh(L2, d, from); if (r) causes.push(`hurt@${p.pos.x.toFixed(1)},${p.pos.z.toFixed(1)} from ${from.x.toFixed(1)},${from.y.toFixed(1)},${from.z.toFixed(1)}`); return r; };
  const oz = p.hazardHit.bind(p);
  p.hazardHit = (L2, d) => { causes.push(`hazard@${p.pos.x.toFixed(1)},${p.pos.y.toFixed(2)},${p.pos.z.toFixed(1)}`); return oz(L2, d); };
  return causes;
}

/** freeze the real-time loop so only __step/__play advance the game (for screenshots of exact moments) */
function installFreeze() {
  const g = w.__game as unknown as { update: (dt: number) => void; __wrapped?: boolean };
  if (g.__wrapped) return;
  const orig = g.update.bind(g);
  g.update = (dt: number) => { if (!frozen || stepping) orig(dt); };
  g.__wrapped = true;
  const st = w.__step;
  w.__step = (f: number, k: string[] = []) => { stepping = true; try { st(f, k); } finally { stepping = false; } };
}
function freeze(on = true) { installFreeze(); frozen = on; return frozen; }

/** start a level at a point (as if respawning at a checkpoint there) */
function goLevel(id: string, index: number, at?: [number, number, number], seen: string[] = []) {
  const g = w.__game as unknown as { go: (f: () => unknown, speed?: number) => void; fade: number };
  const Lc = w.__Level3D as unknown as new (id: string, i: number, cp?: { pos: THREE.Vector3; yaw: number }, seen?: Set<string>) => Level3D;
  g.go(() => new Lc(id, index, at ? { pos: new THREE.Vector3(...at), yaw: Math.PI / 2 } : undefined, new Set(seen)), 100);
  play(3); g.fade = 0;
  return scene();
}

/**
 * Smoke-test the whole story: every level's intro, its story triggers, the exit cutscene, the boss victory,
 * the ending and the credits. Returns a log; errors are caught per stage.
 */
function chainTest(steps = [0, 1, 3, 5, 7, 8, 9, 10]) {
  const g = w.__game as unknown as { story: (i: number) => void; scene: unknown; fade: number };
  const log: string[] = [];
  const errs: string[] = [];
  const onErr = (e: ErrorEvent) => errs.push(e.message);
  window.addEventListener('error', onErr);
  const sceneName = () => (g.scene as { constructor: { name: string } }).constructor.name;
  const waitScene = (pred: () => boolean, max = 6000) => { for (let i = 0; i < max; i++) { if (pred()) return i; play(1); } return -1; };
  const stage = (name: string, fn: () => void) => { try { fn(); log.push('ok ' + name); } catch (e) { log.push('FAIL ' + name + ': ' + (e as Error).message); } };
  for (const idx of steps) {
    stage('story ' + idx, () => {
      const old = g.scene;
      g.story(idx);
      waitScene(() => g.scene !== old, 600); play(2); g.fade = 0;
      const sc = g.scene as Level3D & { is3d?: boolean };
      const nm = sceneName();
      if (nm !== 'Level3D') {
        const n = waitScene(() => sceneName() !== nm, 60 * 140);
        log.push(`  ${nm} ran ${n} frames`);
        return;
      }
      const L = sc;
      waitScene(() => !L.inCutscene, 60 * 90);
      // story triggers
      for (const tr of L.triggers) if (!tr.fired) { tr.fired = true; L.run(tr.script); waitScene(() => !L.inCutscene, 60 * 60); log.push('  trigger ' + tr.script); }
      for (const a of L.arenas) if (a.state === 'idle') { a.state = 'done'; }
      play(10);
      if (L.boss) {
        const b = L.boss as unknown as { hp: number; state: string; damage: (L: Level3D, n: number, at: THREE.Vector3) => void };
        b.state = 'idle';
        b.damage(L, 9999, L.player.pos.clone());
        waitScene(() => sceneName() !== 'Level3D' || g.scene !== L, 60 * 120);
        log.push('  boss → ' + sceneName());
        return;
      }
      if (L.exitZone) {
        const c = L.exitZone.min.clone().add(L.exitZone.max).multiplyScalar(0.5);
        L.player.body.pos.copy(c);
        L.player.body.gravity = 0;
        play(2);
        L.player.body.gravity = 32;
        const n = waitScene(() => g.scene !== L, 60 * 60);
        log.push('  exit → ' + sceneName() + ' (' + n + ')');
      } else log.push('  NO EXIT');
    });
  }
  window.removeEventListener('error', onErr);
  return { log, errs };
}

/** «Хрумляндия»: play an episode solo from step `step` (no lock check); returns its steps' kinds */
function goEpisode(id: string, step = 0) {
  if (!EPISODES[id]) return null;
  playEpisode(id, step);
  return game.run ? game.run.steps.map((s) => s.kind + ':' + ('id' in s ? s.id : '')) : 'prologue';
}

/** open the world map (solo), my figurine on node `at` */
function map(at?: string) {
  if (at && EPISODES[at]) save.data.mapAt = at;
  game.toMap();
  return true;
}

Object.assign(window, { __goEpisode: goEpisode, __map: map });
Object.assign(window, { __save: save, __chainTest: chainTest, __THREE: THREE, __goLevel: goLevel, __play: play, __chaseBot: chaseBot, __traceHurt: traceHurt, __freeze: freeze });

import * as THREE from 'three';
import { input } from '../../../engine/input';
import { audio } from '../../../engine/audio';
import { save } from '../../../engine/save';
import { clamp, approach } from '../../../engine/util';
import { mat } from '../../gfx';
import { BRIDGE_TOP, BRIDGE_FROM } from '../../models/bublik';
import type { HeroFx } from '../../models/hero';
import type { CylCol } from '../../physics/types';
import type { Level3D } from '../level';
import type { Player3 } from '../player';
import type { RemoteHero3 } from '../remoteHero';
import type { HeroKit, RemoteKitView } from './kit';

/*
 * Бублик — the stretchy dog (GDD 2.2).
 *  attack  ground: «лапа-пружина», a paw punch 3 m forward (punch / punchAlt); air: «мельница», paws spinning all
 *          around (pogo on a hit, like Tosha's air spin).
 *  shoot   «лапа-крюк» (replaces the slingshot): the paw shoots out up to 10 m to a grapple ring (addGrappleRing),
 *          a ledge (a wall with a top he can stand on) or an enemy and yanks him there (an enemy gets a punch).
 *  jump    no double jump.            dash   «перекат»: rolls into a ball (dodges hits like a dash).
 *  special hold: «Мост» — he plants his back paws and stretches forward (≤ 12 m, stops at walls) while held; friends
 *          walk across on his back (a real collider on their machines: BublikView). Let go with the front paws on
 *          ground → he pulls himself over (crossing a gap solo); over the void → he snaps back.
 *          tap: «Батут» — he puffs up for 6 s (tap again / attack / roll to pop): friends who land on him bounce high
 *          (his head collider gets `bounce` on their machines); puffed he walks slowly and floats down like a balloon.
 */

const RUN = 7.0;
const JUMP = 11.2;
const HOLD_T = 0.22;
const BRIDGE_MAX = 12;
const BRIDGE_SPEED = 15;
const PUFF_T = 6;
const PUNCH_RANGE = 3.1;
const GRAPPLE_RANGE = 10;
const PAW_SPEED = 46;
const PULL_SPEED = 22;

interface Grapple {
  phase: 'out' | 'pull' | 'back';
  kind: 'ring' | 'ledge' | 'enemy' | 'miss';
  at: THREE.Vector3;
  dist: number;
  t: number;
}

// ───────────────────────── grapple rings (any level can place them) ─────────────────────────
const RINGS = new WeakMap<Level3D, THREE.Vector3[]>();
/**
 * A golden ring Бублик's paw can hook (build it on every machine, e.g. in a level's build()). Returns its group.
 * Other heroes just see a decoration (Tosha can't reach it — use rings for shortcuts and secrets, not the main path).
 */
export function addGrappleRing(L: Level3D, x: number, y: number, z: number, o: { yaw?: number; rope?: number } = {}) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = o.yaw ?? 0;
  const gold = mat('#f2c23a'), dark = mat('#8a5a2a');
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.07, 10, 28), gold);
  ring.castShadow = true;
  g.add(ring);
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), mat('#ff6aa8'));
  bead.position.y = 0.42;
  g.add(bead);
  const rope = o.rope ?? 1.6;
  if (rope > 0) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, rope, 6), dark);
    r.position.y = 0.42 + rope / 2;
    g.add(r);
  }
  L.scene.add(g);
  let list = RINGS.get(L);
  if (!list) { list = []; RINGS.set(L, list); }
  list.push(new THREE.Vector3(x, y, z));
  return g;
}

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();

export function bublikKit(p: Player3): HeroKit {
  let holding = false, held = 0;
  let bridgeOn = false, bridge = 0, wallAt = BRIDGE_MAX, anchored = false, retracting = false, gapSeen = false, anchorAt = 0;
  const bDir = new THREE.Vector3(), bStart = new THREE.Vector3(), bFront = new THREE.Vector3();
  let pull: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number } | null = null;
  let puffT = 0, puffK = 0;
  let gr: Grapple | null = null;
  let reach = 0, aim = 0;
  let alt = false;
  let lookT = 0;
  let cand: Grapple | null = null;
  const fxOut: HeroFx = {};

  const fwd = () => p.forward(v1);
  const busy = () => bridgeOn || !!pull || !!gr;

  // ── trampoline ──
  function puffUp(L: Level3D) {
    puffT = PUFF_T;
    audio.sfx('bounce', { pitch: 0.7 }); audio.sfx('whoosh', { pitch: 1.4, volume: 0.6 });
    p.squash = 1.35;
    L.fx.ring(p.pos.clone().setY(p.pos.y + 0.6), 1.4, '#ffe9a0', 0.35, false);
    L.fx.text(p.center().setY(p.pos.y + 1.7), 'Батут!', '#ffe14a', 22);
  }
  function deflate(L: Level3D | null, quiet = false) {
    if (puffT <= 0) return;
    puffT = 0;
    p.body.gravity = 32; p.body.maxFall = 40;
    if (L && !quiet) {
      audio.sfx('break', { pitch: 1.8, volume: 0.5 });
      L.fx.emit(p.center().setY(p.pos.y + 0.6), { count: 14, speed: [2, 5], life: [0.2, 0.45], size: [0.12, 0.22], colors: ['#ffffff', '#e8d8c0', '#ffe9a0'], drag: 4 });
    }
  }

  // ── bridge ──
  function startBridge(L: Level3D) {
    bridgeOn = true; retracting = false; anchored = false; gapSeen = false; anchorAt = 0;
    p.forward(bDir);
    bStart.copy(p.pos);
    bridge = BRIDGE_FROM + 0.5;
    // stop short of walls in the way (at the back's height and the head's)
    let d = BRIDGE_MAX;
    for (const h of [0.14, BRIDGE_TOP + 0.3]) {
      v2.copy(bStart).setY(bStart.y + h);
      d = Math.min(d, L.phys.raycast(v2, bDir, BRIDGE_MAX + 0.5, (c) => c.tag === 'hero'));
    }
    wallAt = Math.max(BRIDGE_FROM + 0.6, d - 0.15);
    audio.sfx('whoosh', { pitch: 0.7 });
    L.fx.dust(p.pos.clone(), 6);
  }
  function frontAnchored(L: Level3D) {
    bFront.copy(bStart).addScaledVector(bDir, bridge - 0.15);
    const gy = L.phys.groundAt(bFront.x, bFront.z, bStart.y + 0.5, 0.25);
    return gy > bStart.y - 0.8 ? gy : null;
  }
  function releaseBridge(L: Level3D) {
    if (!bridgeOn) return;
    bridgeOn = false;
    const gy = frontAnchored(L);
    if (gy !== null && bridge > 1.8) {
      // the front paws are on the far side: pull the rest of the dog over
      const to = bStart.clone().addScaledVector(bDir, bridge - 0.3).setY(gy + 0.02);
      pull = { from: p.pos.clone(), to, t: 0, dur: Math.max(0.2, bridge / 26) };
      p.body.gravity = 0; p.body.vel.set(0, 0, 0);
      audio.sfx('whoosh', { pitch: 1.1 });
    } else retracting = true;
  }

  // ── grapple ──
  function findTarget(L: Level3D): Grapple | null {
    const f = fwd();
    const c = p.center(v2).setY(p.pos.y + 0.55);
    // rings in front (clear line)
    let best: Grapple | null = null, bd = GRAPPLE_RANGE;
    for (const r of RINGS.get(L) ?? []) {
      v3.copy(r).sub(c);
      const d = v3.length();
      if (d > bd || d < 1) continue;
      const flat = Math.hypot(v3.x, v3.z) || 1;
      if ((v3.x * f.x + v3.z * f.z) / flat < 0.5) continue;
      v3.normalize();
      if (L.phys.raycast(c, v3, d - 0.4, (k) => k.tag === 'hero') < d - 0.5) continue;
      bd = d; best = { phase: 'out', kind: 'ring', at: r.clone(), dist: d, t: 0 };
    }
    if (best) return best;
    // an enemy in front
    const e = L.nearestTarget(c, f, GRAPPLE_RANGE, 0.45);
    if (e) {
      v3.copy(e).sub(c); const d = v3.length(); v3.normalize();
      if (d > 1.2 && L.phys.raycast(c, v3, d, (k) => k.tag === 'hero') >= d - 0.6) return { phase: 'out', kind: 'enemy', at: e.clone(), dist: d, t: 0 };
    }
    // a ledge: a wall ahead whose top I could stand on
    for (const pitch of [0.12, 0.42, 0.78]) {
      v3.set(f.x * Math.cos(pitch), Math.sin(pitch), f.z * Math.cos(pitch));
      const d = L.phys.raycast(c, v3, GRAPPLE_RANGE, (k) => k.tag === 'hero');
      if (d >= GRAPPLE_RANGE || d < 0.8) continue;
      const hit = c.clone().addScaledVector(v3, d);
      const probe = hit.clone().addScaledVector(f, 0.45);
      const top = L.phys.groundAt(probe.x, probe.z, hit.y + 2.4, 0.12);
      if (top < p.pos.y + 0.7 || top - hit.y > 2.4) continue;
      if (L.phys.pointInSolid(probe.clone().setY(top + 0.6)) || L.phys.pointInSolid(probe.clone().setY(top + 1.2))) continue;
      const at = probe.setY(top + 0.05);
      return { phase: 'out', kind: 'ledge', at, dist: at.distanceTo(c), t: 0 };
    }
    return null;
  }
  function startGrapple(L: Level3D) {
    if (puffT > 0) deflate(L);
    const t = findTarget(L);
    const c = p.center(v2).setY(p.pos.y + 0.55);
    if (t) {
      gr = t;
      p.yaw = Math.atan2(t.at.x - p.pos.x, t.at.z - p.pos.z);
    } else {
      // a miss: the paw flies out along the camera's aim and comes back
      const d = p.camAimDir(L);
      gr = { phase: 'out', kind: 'miss', at: c.clone().addScaledVector(d, GRAPPLE_RANGE), dist: GRAPPLE_RANGE, t: 0 };
      p.yaw = Math.atan2(d.x, d.z);
    }
    v3.copy(gr.at).sub(c);
    aim = Math.atan2(v3.y, Math.hypot(v3.x, v3.z));
    reach = 0;
    p.atk = 'grab'; p.atkT = 0; p.atkDur = 99; p.atkId++; p.atkHit = false;
    audio.sfx('throw', { pitch: 1.3 });
    L.noise(p.pos, 4);
  }
  function endGrapple() {
    gr = null; reach = 0;
    if (p.atk === 'grab') { p.atk = null; p.atkT = 0; }
    p.body.gravity = 32;
  }
  function tickGrapple(L: Level3D, dt: number) {
    const g = gr!;
    g.t += dt;
    const c = p.center(v2).setY(p.pos.y + 0.55);
    if (g.phase === 'out') {
      reach = Math.min(g.dist, reach + PAW_SPEED * dt);
      if (reach >= g.dist - 1e-3) {
        if (g.kind === 'miss') g.phase = 'back';
        else {
          g.phase = 'pull'; g.t = 0;
          audio.sfx('grab', { pitch: 1.2 });
          L.fx.sparks(g.at.clone(), 8, ['#ffffff', '#ffe14a']);
        }
      }
    } else if (g.phase === 'back') {
      reach = Math.max(0, reach - PAW_SPEED * 1.2 * dt);
      if (reach <= 0) endGrapple();
    } else {
      // yanked toward the target (physics still pushes him out of walls: he slides up a ledge's face)
      const target = v3.copy(g.at);
      if (g.kind === 'ledge') target.y += 0.5;
      else if (g.kind === 'ring') target.y -= 0.9;
      const to = target.sub(p.pos);
      const d = to.length();
      p.body.gravity = 0;
      if (d > 0.01) p.body.vel.copy(to).multiplyScalar(PULL_SPEED / d);
      v3.copy(g.at).sub(c);
      reach = Math.max(0, v3.length() - 0.2);
      aim = Math.atan2(v3.y, Math.hypot(v3.x, v3.z));
      if (d < (g.kind === 'enemy' ? 1.6 : 0.6) || g.t > 1.1) arrive(L, g);
    }
  }
  function arrive(L: Level3D, g: Grapple) {
    const f = fwd();
    const b = p.body;
    endGrapple();
    if (g.kind === 'ledge') { b.vel.set(f.x * 3, 5.5, f.z * 3); }
    else if (g.kind === 'ring') { b.vel.set(f.x * 9, 11, f.z * 9); p.canDouble = false; audio.sfx('bounce', { pitch: 1.3 }); L.fx.ring(g.at.clone(), 1.0, '#ffe14a', 0.3, false); }
    else {
      // a flying punch on arrival
      const hit = L.meleeHit(p.center(), f, 1.9, 0.9, save.data.dmg + 1, ++p.atkId, 'punch');
      b.vel.set(-f.x * 4, 7, -f.z * 4);
      if (hit) { audio.sfx('pogo'); L.fx.stars(p.center().addScaledVector(f, 1), 10); }
    }
    p.jumping = false;
  }

  const kit: HeroKit = {
    kind: 'bublik', run: RUN, jump: JUMP, swap: false,

    locked: () => bridgeOn || !!pull || (!!gr && gr.phase === 'pull'),
    moveMul: () => (puffT > 0 ? 0.45 : gr ? 0.3 : 1),

    pre(L, dt, ctl) {
      const b = p.body;
      // balloon
      if (puffT > 0) {
        puffT -= dt;
        if (puffT <= 0) { puffT = 1; deflate(L); }
        else if (!b.onGround && p.dashT <= 0) { b.gravity = 12; b.maxFall = 4.5; }
        else { b.gravity = 32; b.maxFall = 40; }
      }
      puffK = approach(puffK, puffT > 0 ? 1 : 0, dt * 7);
      // bridge: grow forward while held, stop at a wall / 12 m
      if (bridgeOn) {
        // control taken (a story scene, a menu) or the ground went away: snap back, never pull across
        if (!ctl || (!b.onGround && p.pos.y < bStart.y - 0.6)) { bridgeOn = false; retracting = true; holding = false; }
        else {
          // grow until a wall / 12 m, or until the paws reach ground again past a gap (a snug bridge, not a 12 m plank)
          const stopAt = gapSeen && anchorAt > 0 ? anchorAt + 0.7 : BRIDGE_MAX;
          bridge = Math.min(wallAt, stopAt, bridge + BRIDGE_SPEED * dt);
          const was = anchored;
          anchored = frontAnchored(L) !== null;
          if (!anchored && bridge > BRIDGE_FROM + 0.8) gapSeen = true;
          if (anchored && !was && gapSeen) { anchorAt = bridge; audio.sfx('land', { volume: 0.4, pitch: 1.3 }); L.fx.dust(bFront.clone(), 4); }
          bStart.x = p.pos.x; bStart.z = p.pos.z;
        }
      } else if (retracting) {
        bridge = Math.max(0, bridge - 40 * dt);
        if (bridge <= 0) retracting = false;
      }
      // pulling myself across my bridge
      if (pull) {
        pull.t += dt;
        const k = Math.min(1, pull.t / pull.dur);
        const e = k * k * (3 - 2 * k);
        v2.lerpVectors(pull.from, pull.to, e);
        b.vel.subVectors(v2, p.pos).divideScalar(Math.max(dt, 1e-3));
        b.gravity = 0;
        bridge = Math.max(0.5, bFront.distanceTo(v2.setY(bFront.y)) + 0.15);
        if (k >= 1) {
          pull = null; bridge = 0; b.gravity = 32; b.vel.set(bDir.x * 2.5, 2, bDir.z * 2.5);
          audio.sfx('land', { volume: 0.5 }); L.fx.dust(p.pos.clone(), 8);
        }
      }
      if (gr) tickGrapple(L, dt);
      // where a grapple would go (lock-on marker in the HUD), checked a few times a second
      lookT -= dt;
      if (lookT <= 0 && !gr && ctl) { lookT = 0.12; cand = findTarget(L); }
      p.quickLock = !gr && cand && ctl ? cand.at : null;
    },

    // a roll instead of a dash
    dash(L, mx, mz) {
      if (busy()) return false;
      deflate(L);
      p.dashT = 0.34; p.dashCD = 0.5;
      if (Math.hypot(mx, mz) > 0.05) p.yaw = Math.atan2(mx, mz);
      p.squash = 0.8;
      audio.sfx('dash', { pitch: 0.75 });
      L.noise(p.pos, 5);
      L.fx.dust(p.pos.clone(), 5);
      return true;
    },
    dashTick(L, dt) {
      const b = p.body;
      p.dashT -= dt;
      const f = fwd();
      b.vel.x = f.x * 15; b.vel.z = f.z * 15;
      if (b.onGround && Math.random() < 0.5) L.fx.dust(p.pos.clone(), 1);
      if (p.dashT <= 0) { b.vel.x *= 0.45; b.vel.z *= 0.45; }
    },
    // no double jump
    airJump: () => false,

    shoot(L, _dt, ctl) {
      p.aiming = false; p.aimK = 0;
      if (ctl && input.pressed('shoot') && !busy() && p.dashT <= 0) startGrapple(L);
    },

    attack(L) {
      if (busy()) return true;
      if (puffT > 0) { deflate(L); return true; }
      if (!p.body.onGround) {
        p.atk = 'mill'; p.atkDur = 0.5; p.atkCD = 0.5;
        audio.sfx('swing', { pitch: 0.85 });
      } else {
        alt = !alt;
        p.atk = alt ? 'punchAlt' : 'punch'; p.atkDur = 0.38; p.atkCD = 0.42;
        audio.sfx('swingHeavy', { pitch: 1.15 });
      }
      const tgt = L.nearestTarget(p.center(), p.forward(), PUNCH_RANGE + 0.6, 0.5);
      if (tgt) p.yaw = Math.atan2(tgt.x - p.pos.x, tgt.z - p.pos.z);
      return true;
    },
    processAttack(L, k) {
      if (p.atk === 'grab') return true;
      const dmg = save.data.dmg;
      const c = p.center(), f = p.forward();
      let hit = false;
      if (p.atk === 'punch' || p.atk === 'punchAlt') {
        if (k > 0.12 && k < 0.62) {
          hit = L.meleeHit(c, f, PUNCH_RANGE, 0.32, dmg, p.atkId, 'punch');
          if (L.meleeHit(c, f, 1.3, 1.0, dmg, p.atkId, 'punch')) hit = true;
        }
      } else if (p.atk === 'mill') {
        if (k < 0.85) hit = L.meleeHit(c, f, 1.9, Math.PI, dmg, p.atkId, 'spin');
        if (hit && !p.atkHit) { p.body.vel.y = 10; p.airDash = true; p.jumping = false; audio.sfx('pogo'); }
      }
      if (hit) p.atkHit = true;
      return true;
    },

    special(L, dt, ctl) {
      const down = ctl && input.down('special');
      if (ctl && input.pressed('special')) { holding = true; held = 0; }
      if (!holding) return;
      if (down) {
        held += dt;
        if (!bridgeOn && !busy() && held >= HOLD_T && p.body.onGround && puffT <= 0 && !p.atk && p.dashT <= 0) startBridge(L);
      } else {
        holding = false;
        if (bridgeOn) releaseBridge(L);
        else if (held < HOLD_T && !busy()) { if (puffT > 0) deflate(L); else if (!p.atk && p.dashT <= 0) puffUp(L); }
      }
    },

    interrupt(L) {
      if (bridgeOn) { bridgeOn = false; retracting = true; }
      if (pull) { pull = null; bridge = 0; p.body.gravity = 32; }
      if (gr) endGrapple();
      if (puffT > 0) deflate(L, true);
      holding = false;
    },
    reset() {
      bridgeOn = false; retracting = false; bridge = 0; pull = null; gr = null; reach = 0; puffT = 0; puffK = 0; holding = false;
      p.body.gravity = 32; p.body.maxFall = 40;
    },

    fx() {
      let r = reach;
      const k = p.atk && p.atkDur > 0 ? clamp(p.atkT / p.atkDur, 0, 1) : 0;
      if (p.atk === 'punch' || p.atk === 'punchAlt') r = (PUNCH_RANGE - 0.35) * Math.sin(clamp((k - 0.06) / 0.64, 0, 1) * Math.PI);
      else if (p.atk === 'mill') r = 1.25 * Math.sin(clamp(k / 0.9, 0, 1) * Math.PI);
      fxOut.reach = r > 0.01 ? r : 0;
      fxOut.aim = p.atk === 'grab' ? aim : 0;
      fxOut.bridge = bridge > 0.05 ? bridge : 0;
      fxOut.puff = puffK > 0.01 ? puffK : 0;
      return fxOut;
    },
    expr: () => (bridgeOn ? 'angry' : null),
    meter: () => (puffT > 0 ? { k: puffT / PUFF_T, label: 'Батут' } : null),
  };
  return kit;
}

/**
 * A friend's Бублик here: while he stretches as a bridge, a row of solid discs along his back (top at BRIDGE_TOP above
 * his feet), so MY hero can walk across on MY machine. (The trampoline is his head collider's `bounce`, see
 * RemoteHero3 / HERO_BODY.)
 */
export class BublikView implements RemoteKitView {
  private discs: CylCol[] = [];
  private on = false;
  update(L: Level3D, r: RemoteHero3, fx: HeroFx, _dt: number) {
    const len = fx.bridge ?? 0;
    const want = len > BRIDGE_FROM + 0.9 && !r.dead && !r.downed && !r.hidden;
    if (!want) { if (this.on) { for (const d of this.discs) d.active = false; this.on = false; } return; }
    this.on = true;
    const sx = Math.sin(r.yaw), sz = Math.cos(r.yaw);
    const from = BRIDGE_FROM + 0.35, to = len - 0.1;
    const n = Math.max(1, Math.ceil((to - from) / 0.42) + 1);
    while (this.discs.length < n) {
      const d: CylCol = { kind: 'cyl', x: 0, z: 0, r: 0.44, y0: 0, y1: 0, tag: 'bridge', active: false };
      this.discs.push(d);
      L.phys.add(d);
    }
    const top = r.pos.y + BRIDGE_TOP;
    for (let i = 0; i < this.discs.length; i++) {
      const d = this.discs[i];
      if (i >= n) { d.active = false; continue; }
      const s = n === 1 ? from : from + ((to - from) * i) / (n - 1);
      d.x = r.pos.x + sx * s; d.z = r.pos.z + sz * s;
      d.y1 = top; d.y0 = top - 0.22;
      d.active = true;
    }
  }
  dispose(L: Level3D) { for (const d of this.discs) L.phys.remove(d); this.discs.length = 0; }
}

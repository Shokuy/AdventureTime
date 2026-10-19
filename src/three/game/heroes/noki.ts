import * as THREE from 'three';
import { input } from '../../../engine/input';
import { audio } from '../../../engine/audio';
import { save } from '../../../engine/save';
import { approach, clamp } from '../../../engine/util';
import { net } from '../../../net/session';
import type { HeroFx } from '../../models/hero';
import type { Level3D } from '../level';
import type { Player3 } from '../player';
import type { RemoteHero3 } from '../remoteHero';
import type { HeroKit, RemoteKitView } from './kit';
import { team, vampOn } from './team';

/*
 * Ноки — the half-vampire rocker (GDD 2.3).
 *  attack  the axe-guitar: heavy chops (axe / axeAlt, slower, +1 damage, a wide arc); air: axeSpin (pogo on a hit).
 *          Keep the button held after a chop → she raises the axe and charges (≤ 0.7 s, slow walk); let go → a slam:
 *          +2 damage in front (+3 fully charged; 'fork': pries shields open) and a shockwave all around.
 *  shoot   «Щипок»: a short sonic note (≈ 10 m, 1 damage, no ammo; the shared slingshot controls: tap / hold to aim).
 *  jump    glide instead of a double jump: hold jump while falling → little bat wings, she sinks slowly, ≤ 3 s per jump.
 *  dash    bat form: 0.6 s straight ahead without gravity, through enemies (dash i-frames) and low gaps (a small body;
 *          she stays a bat while there is no room to stand up).
 *  special «Аккорд» (every 7 s): a sound wave 6 m around — every enemy gets a 'chord' hit (vampires stunned 2.2 s and
 *          revealed, пресняки restored, others staggered), the invisible within 10 m show for 5 s, and once per 30 s
 *          every hero in reach (her too) gets +1 ♥ (team.ts: each friend's own machine applies it).
 *  sun     in the light of «солнышки» / Пастила's beacon she walks and swings slower.
 *  vampires take ×1.5 from her axe and chord (bane.ts — the vampire side multiplies; the pluck hits like a pea).
 */
const RUN = 7.4;
const JUMP = 11.6;
const GLIDE_MAX = 3;
const GLIDE_FALL = 2.2;
const BAT_T = 0.6;
const BAT_SPEED = 13;
const BAT_CD = 0.75;
/** body in bat form (Player3's is 0.3 × 0.95) and how long she may stay a bat while there's no room to stand up */
const BODY_R = 0.3, BODY_H = 0.95, BAT_R = 0.2, BAT_H = 0.42, BAT_MORE = 0.8;
const SWING_DUR = 0.46;
const SWING_CD = 0.52;
const SLAM_DUR = 0.62;
/** the slam's raised-axe pose (fraction of the 'axe' chop) */
const WIND = 0.28;
const CHARGE_T = 0.7;
const CHARGE_MIN = 0.22;
export const CHORD_R = 6;
export const CHORD_CD = 7;
export const HEAL_CD = 30;
const REVEAL_R = 10;
const PLUCK_CD = 0.45;
const PLUCK_SPEED = 24;
/** in the light: walk ×0.7, swings ×1.2 slower */
const SUN_SLOW = 0.7;
const SUN_ATK = 1.2;

const v1 = new THREE.Vector3();

export function nokiKit(p: Player3): HeroKit {
  let glideT = 0, gliding = false, glideK = 0, batK = 0, alt = false;
  let chordCD = 0, healCD = 0;
  let held = false, charging = false, chargeT = 0, full = false, slam = false, slamFull = false, slamFx = false;
  let small = false, batMore = 0;
  let sunK = 0, puffT = 0;
  const fxOut: HeroFx = {};

  const myId = (L: Level3D) => (L.nl ? net.myId : null);
  function shrink(on: boolean) { small = on; p.body.r = on ? BAT_R : BODY_R; p.body.h = on ? BAT_H : BODY_H; }
  function roomToStand(L: Level3D) {
    const b = p.body;
    for (const y of [0.5, 0.88]) if (L.phys.pointInSolid(v1.set(b.pos.x, b.pos.y + y, b.pos.z))) return false;
    return true;
  }
  function cancelCharge() {
    if (!charging) return;
    charging = false; chargeT = 0; full = false;
    if (p.atk === 'axe' && !slam) { p.atk = null; p.atkT = 0; }
  }
  function startCharge() {
    charging = true; chargeT = 0; full = false;
    p.atk = 'axe'; p.atkDur = SLAM_DUR; p.atkT = WIND * SLAM_DUR; p.atkId++; p.atkHit = false;
    audio.sfx('clang', { pitch: 0.7, volume: 0.4 });
  }
  function release(L: Level3D) {
    if (chargeT < CHARGE_MIN) { cancelCharge(); return; }
    charging = false; slam = true; slamFull = full; slamFx = false;
    p.atkT = WIND * p.atkDur; p.atkCD = 0.45;
    audio.sfx('swingHeavy', { pitch: 0.7 });
    L.noise(p.pos, 6);
  }

  const kit: HeroKit = {
    kind: 'noki', run: RUN, jump: JUMP, swap: false,
    innate: { sling: true }, shotAtk: 'sling', fireRange: 12,

    moveMul: () => (charging ? 0.45 : 1) * (sunK > 0.5 ? SUN_SLOW : 1),

    pre(L, dt, ctl) {
      const b = p.body;
      chordCD -= dt; healCD -= dt;
      if (b.onGround) glideT = 0;
      if (slam && p.atk !== 'axe') slam = false;
      // the sun («солнышки», Пастила's beacon): slower, smoking a little
      const V = vampOn(L);
      const sun = V ? V.sunAt(p.center(v1)) : 0;
      sunK = approach(sunK, sun > 0.3 ? 1 : 0, dt * 4);
      if (sunK > 0.5) {
        if ((puffT -= dt) <= 0) { puffT = 0.12; L.fx.emit(p.center(v1).setY(p.pos.y + 1.05), { count: 1, speed: [0.3, 0.8], life: [0.4, 0.7], size: [0.08, 0.14], colors: ['#d8d0e0', '#a8a0b8'], g: -1.5, drag: 2 }); }
        L.hint('noki_sun', 'Ноки — полувампир: в свете солнышек она медленнее. Дерись в тени!');
      }
      // glide: jump held while falling (≤ 3 s per jump)
      const want = ctl && !b.onGround && b.vel.y < 0 && input.down('jump') && glideT < GLIDE_MAX && p.dashT <= 0 && (!p.atk || p.atk === 'sling');
      if (want) {
        glideT += dt; gliding = true;
        b.vel.y = Math.max(b.vel.y, -GLIDE_FALL);
        if (Math.random() < 0.15) L.fx.emit(p.center(), { count: 1, speed: [0.2, 0.6], life: [0.3, 0.5], size: [0.06, 0.1], colors: ['#8a5ae0', '#3a2a4e'], drag: 2 });
      } else gliding = false;
      glideK = approach(glideK, gliding ? 1 : 0, dt * 8);
      batK = approach(batK, p.dashT > 0 ? 1 : 0, dt * 14);
      // the heavy hit: charging while the button stays down, a slam on release
      if (!input.down('attack')) held = false;
      if (charging) {
        if (!ctl || p.dashT > 0 || p.knockT > 0 || p.atk !== 'axe') cancelCharge();
        else if (!input.down('attack')) release(L);
        else {
          chargeT += dt;
          if (chargeT >= CHARGE_T && !full) {
            full = true; p.squash = 1.15;
            audio.sfx('clang', { pitch: 1.3, volume: 0.6 });
            L.fx.ring(p.pos.clone().setY(p.pos.y + 0.06), 1.3, '#e0b0ff', 0.3);
          }
          if (Math.random() < (full ? 0.7 : 0.35)) {
            p.rig.weaponTip.getWorldPosition(v1);
            L.fx.emit(v1, { count: 1, speed: [0.3, 1.2], life: [0.2, 0.4], size: [0.05, full ? 0.14 : 0.09], colors: full ? ['#ffffff', '#e0b0ff', '#c070ff'] : ['#c070ff', '#8a5ae0'], drag: 3 });
          }
        }
      }
    },

    // bat form
    dash(L, mx, mz) {
      cancelCharge(); slam = false;
      p.dashT = BAT_T; p.dashCD = BAT_CD; batMore = 0;
      if (Math.hypot(mx, mz) > 0.05) p.yaw = Math.atan2(mx, mz);
      shrink(true);
      audio.sfx('batFlap', { pitch: 1.2 }); audio.sfx('whoosh', { pitch: 1.5, volume: 0.6 });
      L.fx.emit(p.center(), { count: 14, speed: [1, 3], life: [0.25, 0.5], size: [0.15, 0.3], colors: ['#3a2a4e', '#6a4a8a', '#1c1622'], drag: 3 });
      return true;
    },
    dashTick(L, dt) {
      const b = p.body;
      p.dashT -= dt;
      const f = p.forward(v1);
      b.vel.x = f.x * BAT_SPEED; b.vel.z = f.z * BAT_SPEED; b.vel.y = 0; b.gravity = 0;
      if (Math.random() < 0.4) L.fx.emit(p.center(), { count: 1, speed: [0.1, 0.4], life: [0.2, 0.4], size: [0.1, 0.2], colors: ['#3a2a4e', '#6a4a8a'], drag: 3 });
      if (p.dashT > 0) return;
      // still under something low (a gap she flew into): stay a bat a little longer
      if (!roomToStand(L) && batMore < BAT_MORE) { p.dashT = 0.05; batMore += 0.05; return; }
      shrink(false);
      b.gravity = 32; b.vel.x *= 0.4; b.vel.z *= 0.4;
      L.fx.emit(p.center(), { count: 10, speed: [1, 2.5], life: [0.2, 0.4], size: [0.15, 0.25], colors: ['#3a2a4e', '#6a4a8a'], drag: 3 });
    },
    airJump: () => false,

    // «Щипок»: a sonic note (shared slingshot controls, no peas)
    fire(L, from, dir) {
      cancelCharge();
      // (a ranged poke: hits like a pea — no bane, no shield shove from afar)
      team(L).shot('note', from, v1.copy(dir).multiplyScalar(PLUCK_SPEED), '#c070ff', { dmg: 1, kind: 'pea' });
      audio.sfx('clang', { pitch: 2.2, volume: 0.35 });
      L.fx.ring(from.clone(), 0.5, '#c070ff', 0.2, false);
      L.noise(p.pos, 5);
      return PLUCK_CD;
    },

    attack(L) {
      if (charging || slam) return true;
      held = true;
      const sm = sunK > 0.5 ? SUN_ATK : 1;
      if (!p.body.onGround) { p.atk = 'axeSpin'; p.atkDur = 0.4 * sm; p.atkCD = 0.44 * sm; audio.sfx('swingHeavy', { pitch: 1.1 }); }
      else { alt = !alt; p.atk = alt ? 'axe' : 'axeAlt'; p.atkDur = SWING_DUR * sm; p.atkCD = SWING_CD * sm; audio.sfx('swingHeavy', { pitch: 0.85 }); }
      const tgt = L.nearestTarget(p.center(), p.forward(), 3.2, 1.0);
      if (tgt) p.yaw = Math.atan2(tgt.x - p.pos.x, tgt.z - p.pos.z);
      return true;
    },
    processAttack(L, k) {
      if (p.atk === 'chord' || p.atk === 'sling') return true;
      if (charging) { p.atkT = WIND * p.atkDur; return true; }
      const base = save.data.dmg + 1;
      const c = p.center(), f = p.forward();
      let hit = false;
      if (slam) {
        if (k > 0.3 && k < 0.58) {
          if (!slamFx) {
            slamFx = true;
            team(L).slam(p.pos.clone().addScaledVector(f, 1.1), 2.6);
            L.tcam.shake(slamFull ? 0.45 : 0.3);
            audio.sfx('slam', { pitch: 1.2 });
            L.noise(p.pos, 9);
          }
          const d = base + 1 + (slamFull ? 1 : 0);
          hit = L.meleeHit(c, f, 2.7, 0.95, d, p.atkId, 'fork');
          if (L.meleeHit(c, f, 2.4, Math.PI, d - 1, p.atkId, 'sword')) hit = true;
        }
      } else if (p.atk === 'axe') { if (k > 0.3 && k < 0.6) hit = L.meleeHit(c, f, 2.2, 0.9, base, p.atkId, 'fork'); }
      else if (p.atk === 'axeAlt') { if (k > 0.25 && k < 0.6) hit = L.meleeHit(c, f, 2.1, 1.4, base, p.atkId, 'sword'); }
      else if (p.atk === 'axeSpin') {
        if (k < 0.85) hit = L.meleeHit(c, f, 1.9, Math.PI, base, p.atkId, 'spin');
        if (hit && !p.atkHit) { p.body.vel.y = 10; p.airDash = true; p.jumping = false; audio.sfx('pogo'); }
      }
      if (hit) p.atkHit = true;
      // still holding the button after a chop: raise the axe and charge the heavy hit
      if (!slam && (p.atk === 'axe' || p.atk === 'axeAlt') && k >= 0.62 && held && p.body.onGround) startCharge();
      return true;
    },

    // «Аккорд»
    special(L, _dt, ctl) {
      if (!ctl || !input.pressed('special') || p.dashT > 0) return;
      if (chordCD > 0) {
        audio.sfx('denied', { volume: 0.4 });
        L.fx.text(p.center().setY(p.pos.y + 1.6), `Аккорд: ещё ${Math.ceil(chordCD)} с`, '#d8b0ff', 18);
        return;
      }
      cancelCharge(); slam = false;
      chordCD = CHORD_CD;
      const heal = healCD <= 0;
      if (heal) healCD = HEAL_CD;
      p.atk = 'chord'; p.atkT = 0; p.atkDur = 0.8; p.atkCD = 0.5; p.atkId++; p.atkHit = false;
      const c = p.center();
      // the wave: a 'chord' hit for every enemy in reach (vampires: stunned + revealed; пресняки: restored; others: staggered)
      L.meleeHit(c, p.forward(), CHORD_R, Math.PI, 1, p.atkId, 'chord');
      const V = vampOn(L);
      if (V) { V.chord(c, CHORD_R, myId(L)); V.revealAround(c, REVEAL_R, 5); }
      team(L).chord(p.pos.clone(), CHORD_R, heal);
      audio.sfx('clang', { pitch: 1.6, volume: 0.6 }); audio.sfx('whoosh', { pitch: 0.6 });
      L.tcam.shake(0.2);
      L.noise(p.pos, 10);
    },

    interrupt() {
      gliding = false; slam = false;
      cancelCharge();
      if (small) shrink(false);
    },
    reset() {
      glideT = 0; gliding = false; glideK = 0; batK = 0; charging = false; chargeT = 0; slam = false; held = false; sunK = 0;
      shrink(false);
    },
    fx() {
      fxOut.bat = batK > 0.01 ? batK : 0;
      fxOut.glide = glideK > 0.01 ? glideK : 0;
      fxOut.charge = charging ? clamp(chargeT / CHARGE_T, 0.05, 1) : 0;
      return fxOut;
    },
    expr: () => (charging ? 'angry' : null),
    meter: () => ({ k: chordCD <= 0 ? 1 : 1 - chordCD / CHORD_CD, label: healCD <= 0 ? 'Аккорд +♥' : 'Аккорд' }),
  };
  return kit;
}

/** a friend's Ноки here: sparks on her axe while she charges, a smoky trail as a bat, wisps while gliding */
export class NokiView implements RemoteKitView {
  private t = 0;
  update(L: Level3D, r: RemoteHero3, fx: HeroFx, dt: number) {
    if ((this.t -= dt) > 0 || r.hidden || r.dead) return;
    if ((fx.charge ?? 0) > 0.05) {
      this.t = 0.05;
      r.rig.weaponTip.getWorldPosition(v1);
      const full = (fx.charge ?? 0) > 0.98;
      L.fx.emit(v1, { count: 1, speed: [0.3, 1.2], life: [0.2, 0.4], size: [0.05, full ? 0.14 : 0.09], colors: full ? ['#ffffff', '#e0b0ff', '#c070ff'] : ['#c070ff', '#8a5ae0'], drag: 3 });
    } else if ((fx.bat ?? 0) > 0.5) {
      this.t = 0.04;
      L.fx.emit(r.center(v1), { count: 1, speed: [0.1, 0.4], life: [0.2, 0.4], size: [0.1, 0.2], colors: ['#3a2a4e', '#6a4a8a'], drag: 3 });
    } else if ((fx.glide ?? 0) > 0.5) {
      this.t = 0.12;
      L.fx.emit(r.center(v1), { count: 1, speed: [0.2, 0.6], life: [0.3, 0.5], size: [0.06, 0.1], colors: ['#8a5ae0', '#3a2a4e'], drag: 2 });
    }
  }
  dispose(_L: Level3D) { /* nothing of its own */ }
}

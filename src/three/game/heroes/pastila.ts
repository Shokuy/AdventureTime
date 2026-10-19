import * as THREE from 'three';
import { input } from '../../../engine/input';
import { audio } from '../../../engine/audio';
import { save } from '../../../engine/save';
import { approach, clamp, W, H } from '../../../engine/util';
import { text } from '../../../art/draw';
import { drawGlyph } from '../../../ui/glyphs';
import type { HeroFx } from '../../models/hero';
import type { Level3D } from '../level';
import type { Player3 } from '../player';
import type { HeroKit } from './kit';
import { team, drawGadgetIcon, GADGET_NAMES } from './team';

/*
 * Пастила — the princess-scientist (GDD 2.4), the team's support.
 *  attack  «колба-хлоп»: a short flask smash (flask / flaskAlt), the weakest melee.
 *  shoot   the syrup-syringe pistol: the shared slingshot controls (tap = auto-aimed, hold = aim mode) but no peas —
 *          a sticky syrup glob (her syrup colour) every 0.4 s; a hit is a 'syrup' hit: vampires are stung and stuck
 *          (stunned ~1.2 s), пресняки get their colour back at once (the vampire kit's rules), 1 damage.
 *  dash    short (0.12 s).            jump  double jump (innate).
 *  special gadgets — tap: use the current one; hold: the gadget wheel (stick / WASD picks, let go to choose):
 *            «Батут-пряник»  a gingerbread jump pad for 15 s (anyone bounces ≈ 5.6 m; walking onto it launches too), cd 18 s
 *            «Сиропный щит»  a syrup dome 2.8 m for 4 s: enemy shots splash on it, cd 12 s
 *            «Маяк-солнышко» a sun for 8 s, 6 m: in the vampire arc vamp(L).light — vampires inside burn (×2) and show,
 *                            keep out of it; Ноки is slower in it too. cd 20 s
 *          Gadgets are world objects on every machine (team.ts).
 *  team    lifts downed friends twice as fast (reviveMul, coopMechanics).
 */
const RUN = 7.4;
const JUMP = 11.4;
const HOLD_T = 0.22;
const SYRUP_CD = 0.4;
const SYRUP_SPEED = 26;
const GADGET_CD = [18, 12, 20];
const PAD_AHEAD = 1.5;

const v1 = new THREE.Vector3();

export function pastilaKit(p: Player3): HeroKit {
  let alt = false, placing = false;
  let sel = 0, pick = 0, holding = false, held = 0, wheel = false, wheelK = 0;
  const cd = [0, 0, 0];
  const fx: HeroFx = {};
  const syrupColor = () => (p.rig.look.backColor as string | undefined) ?? '#ff3a7a';

  /** where a jump pad goes: on the ground in front of her (or under her feet at an edge) */
  function padSpot(L: Level3D): THREE.Vector3 | null {
    const b = p.body, f = p.forward(v1);
    for (const d of [PAD_AHEAD, 0]) {
      const x = b.pos.x + f.x * d, z = b.pos.z + f.z * d;
      const gy = L.phys.groundAt(x, z, b.pos.y + 0.6, 0.35);
      if (gy > -1e8 && gy > b.pos.y - (b.onGround ? 0.7 : 4) && !L.phys.pointInSolid(new THREE.Vector3(x, gy + 0.8, z))) return new THREE.Vector3(x, gy, z);
    }
    return null;
  }

  function use(L: Level3D) {
    const i = sel;
    if (cd[i] > 0) {
      audio.sfx('denied', { volume: 0.4 });
      L.fx.text(p.center().setY(p.pos.y + 1.6), `${GADGET_NAMES[i]}: ещё ${Math.ceil(cd[i])} с`, '#ffb0cc', 18);
      return;
    }
    if (p.atk && p.atk !== 'syringe') return;
    const T = team(L);
    if (i === 0) {
      const at = padSpot(L);
      if (!at) { audio.sfx('denied', { volume: 0.4 }); L.fx.text(p.center().setY(p.pos.y + 1.6), 'Батуту нужна земля', '#ffb0cc', 18); return; }
      T.pad(at);
    } else if (i === 1) T.dome(p.pos.clone(), syrupColor());
    else T.beacon(p.pos.clone().addScaledVector(p.forward(v1), 0.6));
    cd[i] = GADGET_CD[i];
    // a quick toss with the free hand (no hit)
    p.atk = 'flaskAlt'; p.atkT = 0; p.atkDur = 0.32; p.atkCD = 0.3; placing = true;
    audio.sfx('throw', { pitch: 1.3, volume: 0.6 });
    L.fx.text(p.center().setY(p.pos.y + 1.7), GADGET_NAMES[i] + '!', '#ffd0e8', 20);
  }

  /** stick / WASD → a slot of the wheel (0 up, 1 down-left, 2 down-right); -1 = centre */
  function slotOf(m: { x: number; y: number }) {
    if (Math.hypot(m.x, m.y) < 0.45) return -1;
    const dirs = [[0, 1], [-0.866, -0.5], [0.866, -0.5]];
    let best = -1, bd = -2;
    for (let i = 0; i < 3; i++) { const d = dirs[i][0] * m.x + dirs[i][1] * m.y; if (d > bd) { bd = d; best = i; } }
    return best;
  }

  const kit: HeroKit = {
    kind: 'pastila', run: RUN, jump: JUMP, swap: false,
    innate: { sling: true, doubleJump: true, dash: true }, shotAtk: 'syringe', fireRange: 22, reviveMul: 2,

    // the wheel is open: she stands still (the stick picks a gadget)
    locked: () => wheel,

    pre(_L, dt) {
      for (let i = 0; i < 3; i++) cd[i] = Math.max(0, cd[i] - dt);
      wheelK = approach(wheelK, wheel ? 1 : 0, dt * 9);
      if (placing && p.atk !== 'flaskAlt') placing = false;
    },

    dashTick(_L, dt) {
      // a short hop of a dash: Tosha's speed, about half the length
      const b = p.body;
      if (p.dashT > 0.12) p.dashT = 0.12;
      p.dashT -= dt;
      const f = p.forward(v1);
      b.vel.x = f.x * 21; b.vel.z = f.z * 21; b.vel.y = 0; b.gravity = 0;
      if (p.dashT <= 0) { b.vel.x *= 0.4; b.vel.z *= 0.4; b.gravity = 32; }
    },

    // the syrup syringe
    fire(L, from, dir) {
      team(L).shot('syrup', from, v1.copy(dir).multiplyScalar(SYRUP_SPEED).setY(dir.y * SYRUP_SPEED + 1.2), syrupColor(), { dmg: 1, kind: 'syrup' });
      audio.sfx('splash', { pitch: 2.2, volume: 0.35 });
      L.noise(p.pos, 4);
      return SYRUP_CD;
    },

    attack(L) {
      placing = false;
      alt = !alt;
      p.atk = alt ? 'flask' : 'flaskAlt'; p.atkDur = 0.36; p.atkCD = 0.4;
      audio.sfx('swing', { pitch: 1.25 });
      const tgt = L.nearestTarget(p.center(), p.forward(), 2.4, 1.0);
      if (tgt) p.yaw = Math.atan2(tgt.x - p.pos.x, tgt.z - p.pos.z);
      return true;
    },
    processAttack(L, k) {
      if (p.atk === 'syringe' || placing) return true;
      let hit = false;
      if (k > 0.3 && k < 0.6) hit = L.meleeHit(p.center(), p.forward(), 1.7, 1.1, save.data.dmg, p.atkId, 'sword');
      if (hit && !p.atkHit) { p.atkHit = true; audio.sfx('break', { pitch: 1.6, volume: 0.5 }); L.fx.emit(p.center().addScaledVector(p.forward(), 1.2), { count: 12, speed: [1, 3], life: [0.3, 0.6], size: [0.08, 0.16], colors: ['#ff3a7a', '#ffb0cc', '#ffffff'], g: 6 }); }
      return true;
    },

    // gadgets: tap = use, hold = the wheel
    special(L, dt, ctl) {
      if (ctl && input.pressed('special')) { holding = true; held = 0; pick = sel; }
      if (!holding) return;
      if (ctl && input.down('special')) {
        held += dt;
        if (held >= HOLD_T && !wheel && p.dashT <= 0) { wheel = true; pick = sel; audio.sfx('menuMove', { pitch: 1.2, volume: 0.6 }); }
        if (wheel) {
          const s = slotOf(input.move3());
          if (s >= 0 && s !== pick) { pick = s; audio.sfx('menuMove', { pitch: 1.5, volume: 0.5 }); }
        }
      } else {
        holding = false;
        if (wheel) {
          wheel = false;
          if (pick !== sel) { sel = pick; audio.sfx('menuSelect', { volume: 0.6 }); }
          L.fx.text(p.center().setY(p.pos.y + 1.7), GADGET_NAMES[sel], '#ffd0e8', 20);
        } else if (ctl && held < HOLD_T) use(L);
      }
    },

    interrupt() { holding = false; wheel = false; placing = false; },
    reset() { holding = false; wheel = false; wheelK = 0; placing = false; },
    fx() { fx.gadget = wheel ? 1 + pick : 0; return fx; },
    meter: () => ({ k: 1 - cd[sel] / GADGET_CD[sel], label: GADGET_NAMES[sel] }),

    // the gadget wheel
    hud(ctx) {
      if (wheelK < 0.02) return;
      const cx = W / 2, cy = H / 2 + 10, R = 110 * (0.7 + 0.3 * wheelK);
      ctx.save();
      ctx.globalAlpha = wheelK;
      ctx.beginPath(); ctx.arc(cx, cy, R + 70, 0, Math.PI * 2); ctx.fillStyle = 'rgba(30,15,30,0.45)'; ctx.fill();
      const pos = [[0, -1], [-0.866, 0.5], [0.866, 0.5]];
      for (let i = 0; i < 3; i++) {
        const x = cx + pos[i][0] * R, y = cy + pos[i][1] * R;
        const on = i === pick, ready = cd[i] <= 0;
        const rr = on ? 50 : 40;
        ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2);
        ctx.fillStyle = on ? 'rgba(255,230,245,0.97)' : 'rgba(255,240,248,0.75)'; ctx.fill();
        ctx.lineWidth = on ? 6 : 3.5; ctx.strokeStyle = on ? '#ff4a8a' : '#2a1b1a'; ctx.stroke();
        drawGadgetIcon(ctx, i, x, y - 4, on ? 1.35 : 1.1);
        if (!ready) {
          // cooldown: a dark pie that shrinks + the seconds
          const k = clamp(cd[i] / GADGET_CD[i], 0, 1);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, rr - 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); ctx.closePath();
          ctx.fillStyle = 'rgba(20,10,20,0.55)'; ctx.fill();
          text(ctx, String(Math.ceil(cd[i])), x, y + 9, { size: 26, color: '#ffffff', align: 'center', stroke: 5 });
        }
        text(ctx, GADGET_NAMES[i], x, y + rr + 22, { size: on ? 19 : 16, color: on ? '#fff3d8' : '#e8d8e0', align: 'center', stroke: 4 });
      }
      text(ctx, 'Гаджет', cx, cy - 6, { size: 18, color: '#ffd0e8', align: 'center', stroke: 4 });
      drawGlyph(ctx, 'special', cx, cy + 18, 24);
      ctx.restore();
    },
  };
  return kit;
}

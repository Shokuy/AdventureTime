import { input } from '../../../engine/input';
import { audio } from '../../../engine/audio';
import type { Level3D } from '../level';
import type { Player3 } from '../player';
import type { HeroKit } from './kit';
import { team, CALL_R } from './team';
import { isPrologueLevel } from './where';

/**
 * Тоша: the classic hero — no move hooks, so Player3 runs his moves exactly as before (sword / fork + air spin,
 * the slingshot with aim mode, double jump and dash when unlocked, the boost jump on a friend's head).
 * Beyond the prologue his special is «Геройский клич» (GDD 2.1, every 20 s): he and every friend within 7 m get 5 s of
 * speed (×1.3) and a golden shield that takes one hit (8 s) — team.ts sends it, each friend's machine applies it.
 * In the prologue's chapters and PvP the special button still dashes (no `special` hook there); the dash stays on
 * R2 / Shift everywhere.
 */
const CALL_CD = 20;

export function toshaKit(p: Player3): HeroKit {
  let callCD = 0, cheerT = 0;
  let lastL: Level3D | null = null;

  function call(L: Level3D, _dt: number, ctl: boolean) {
    if (!ctl || !input.pressed('special')) return;
    if (callCD > 0) {
      audio.sfx('denied', { volume: 0.4 });
      L.fx.text(p.center().setY(p.pos.y + 1.6), `Клич: ещё ${Math.ceil(callCD)} с`, '#ffe9a0', 18);
      return;
    }
    callCD = CALL_CD;
    team(L).call(p.pos.clone(), CALL_R);
    p.squash = 1.3;
    if (p.body.onGround && !p.atk && !p.forceState) { p.forceState = 'cheer'; cheerT = 0.6; }
    audio.sfx('checkpoint', { pitch: 1.3, volume: 0.7 }); audio.sfx('whoosh', { pitch: 0.8, volume: 0.5 });
    L.tcam.shake(0.15);
    L.noise(p.pos, 8);
  }

  const kit: HeroKit = {
    kind: 'tosha', run: 7.6, jump: 11.6, swap: true,
    pre(L, dt) {
      // a new level: the call only beyond the prologue (there the special button dashes as before)
      if (L !== lastL) { lastL = L; kit.special = isPrologueLevel(L.def.id) ? undefined : call; }
      callCD -= dt;
      if (cheerT > 0 && (cheerT -= dt) <= 0 && p.forceState === 'cheer') p.forceState = null;
    },
    interrupt() { if (cheerT > 0 && p.forceState === 'cheer') p.forceState = null; cheerT = 0; },
    fx: () => NO_FX,
    meter: () => (kit.special ? { k: callCD <= 0 ? 1 : 1 - callCD / CALL_CD, label: 'Геройский клич' } : null),
  };
  return kit;
}
const NO_FX = {};

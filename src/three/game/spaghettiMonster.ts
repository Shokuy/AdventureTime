import * as THREE from 'three';
import { audio } from '../../engine/audio';
import { choose, clamp, rand } from '../../engine/util';
import { net } from '../../net/session';
import { createSpaghettiMonster } from '../models/spaghetti';
import type { SpaghettiRig, SpagAnim } from '../models/spaghetti';
import type { CylCol } from '../physics/types';
import type { Level3D, Actor3, Hittable3, HeroLike } from './level';
import type { Shot3, Noodle3 } from './objects';
import { GM } from './netLevel';
import type { Netted } from './netLevel';
import { NetTrack, type NetPose } from './netInterp';
import { coop } from './coop';

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const tmpHold = new THREE.Vector3();
const netPose: NetPose = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0 };

/** what Player3.updateGrabbed needs from whatever is holding the hero */
interface Grabber { tip(): THREE.Vector3; release(): void }

/** co-op host: run `f` with its effects sent to everyone (my own sword / peas hit outside the captured world tick) */
export function sharedFx(L: Level3D, f: () => void) {
  const nl = L.nl;
  if (nl && nl.isHost && !nl.capturing) nl.capture(f); else f();
}
/** co-op host: run `f` with its effects kept on this machine (what happens to MY hero inside the captured world tick) */
export function localFx(L: Level3D, f: () => void) {
  const nl = L.nl;
  if (!nl || !nl.capturing) { f(); return; }
  nl.capturing = false;
  try { f(); } finally { nl.capturing = true; }
}
/** a hero's display name (co-op feed lines) */
export function heroName(id: string) { return net.members.get(id)?.name ?? 'Тоша'; }

type SpagState = 'idle' | 'lash' | 'grab' | 'hold' | 'stun' | 'tired' | 'spit' | 'dead';
/** state ids on the wire */
const STATES: SpagState[] = ['idle', 'lash', 'grab', 'hold', 'stun', 'tired', 'spit', 'dead'];
/** co-op: fixed net ids (the monster is made after the level build, by SCRIPTS3.special) */
const NET_ID = 920;

/**
 * The spaghetti monster: a meatball with noodle tentacles.
 *  • LASH — winds up (tentacles coil back), then sweeps low across a wide arc: jump over it or stay out of reach;
 *  • GRAB — three tentacles reach for the hero; caught = mash jump/attack to break free while it drags you in;
 *  • its crust is tough: normal hits only chip 1. After each lash it is TIRED for a moment (full damage),
 *    and a pea in the eye STUNS it (full damage +1);
 *  • below half health it gets angry: faster double lashes, spits meatballs, and pops out two meatball babies.
 * `runner` mode (chase): it times its lash to the hero running past.
 *
 * Co-op: the host runs the AI (targets any hero) and replicates the rig state; clients play it back at NetLevel.playT
 * (netInterp.ts): its turn, the lash / grab progress (never backwards inside one attack) and the grab target.
 * Lashes are checked victim-side (each machine tests its own hero against its own copy of the tentacles);
 * a client whose hero is caught by the puppet's grab claims it, the host accepts one holder and replicates the
 * hold point that the held hero dangles from. Hitting the monster while it holds a FRIEND makes it let go.
 */
export class SpagMonster3 implements Actor3, Hittable3, Netted {
  rig: SpaghettiRig;
  root = new THREE.Group();
  anim: SpagAnim = { state: 'idle', lashDir: 0, p: 0, flash: 0, anger: 0.3 };
  hp: number; maxHp: number;
  state: SpagState = 'idle';
  t = 0; st = 0; cd = 1.5;
  dur = 1.6;
  /** angry second half: faster, combos, spits */
  enraged = false;
  private comboLeft = 0;
  private spat = 0;
  private quickHits = 0;
  /** melee dedupe: my atk ids as numbers, friends' as "id:atk" (every hero counts from 0) */
  hitIds = new Set<number | string>();
  struck = false;
  col: CylCol;
  /** the grabber my OWN hero hangs from (solo, the host's hero, or a client's hero) */
  holding: Grabber | null = null;
  holdPt = new THREE.Vector3();
  /** root-local grab target handed to the rig */
  private tgtLocal = new THREE.Vector3();
  // ── co-op ──
  netId = 0;
  netFar = 90;
  get netRoot() { return this.root; }
  /** net id of the hero in the tentacles (my own: net.myId); authoritative on the host, for show on clients */
  private holder: string | null = null;
  /** host: the hero it goes after (sticky while attacking) */
  private tgt: HeroLike | null = null;
  /** attack counter (a new lash / grab even when the state name stays the same) */
  private seq = 0;
  private grabEnd = -9;
  // client puppet: the host's snapshots played back (hold point x y z, turn as the angle; the record as data)
  private got = false;
  private track: NetTrack<number[]> | null = null;
  private netSeq = -1;
  private claimed = -1;
  /** client: when the host last showed the monster holding someone */
  private holdSeen = -9;

  constructor(L: Level3D, public pos: THREE.Vector3, public S = 1.9, yaw = 0, public aggro = 17, public runner = false) {
    this.rig = createSpaghettiMonster();
    this.root.add(this.rig.root);
    this.root.position.copy(pos);
    this.root.rotation.y = yaw;
    this.root.scale.setScalar(S);
    L.scene.add(this.root);
    this.hp = this.maxHp = runner ? 8 : 30;
    this.col = { kind: 'cyl', x: pos.x, z: pos.z, r: 1.35 * S, y0: pos.y, y1: pos.y + 3.2 * S, tag: 'monster' };
    L.col(this.col);
    L.extraTargets.push(() => (this.state === 'dead' ? new THREE.Vector3(0, -999, 0) : this.bodyCenter()));
    this.rig.update(0, this.anim);
    if (L.nl) {
      // a friend in my tentacles: the slingshot / sword auto-aim helps to cut him loose (feature 17)
      L.extraTargets.push(() => (this.state === 'hold' && this.holder && this.holder !== net.myId ? this.victimPoint() : new THREE.Vector3(0, -999, 0)));
      // a bigger team → a tougher meatball
      this.hp = this.maxHp = Math.round(this.maxHp * coop.hpScale());
      // made after the build on every machine in the same order → the same fixed id everywhere
      let id = NET_ID;
      while (L.nl.get(id)) id++;
      L.nl.add(this, id);
    }
  }

  bodyCenter(out = new THREE.Vector3()) { return out.copy(this.pos).setY(this.pos.y + 1.85 * this.S); }
  eyePoint(out = new THREE.Vector3()) {
    const fwd = tmp2.set(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y));
    return this.bodyCenter(out).addScaledVector(fwd, 1.1 * this.S).setY(this.pos.y + 2.4 * this.S);
  }

  /** host: who to go after (solo: always the player). Sticky: a new hero must be clearly closer to steal it. */
  private pickTarget(L: Level3D): HeroLike {
    if (!L.nl) return L.player;
    const dist = (h: HeroLike) => Math.hypot(h.pos.x - this.pos.x, h.pos.z - this.pos.z);
    let best: HeroLike | null = null, bd = Infinity;
    for (const h of L.alivePlayers()) {
      if (Math.abs(h.pos.y - this.pos.y) >= 6) continue;
      let d = dist(h);
      // runner: whoever is in the strike window first
      if (this.runner && !(h.pos.x > this.pos.x - 15 && h.pos.x < this.pos.x - 5)) d += 1000;
      if (h === this.tgt) d -= 3;
      if (d < bd) { bd = d; best = h; }
    }
    this.tgt = best ?? L.player;
    return this.tgt;
  }

  update(L: Level3D, dt: number) {
    if (!L.authority) { this.puppet(L, dt); return; }
    this.t += dt; this.st += dt;
    const a = this.anim;
    a.flash = Math.max(0, a.flash - dt * 6);
    const p = this.state === 'idle' || !this.tgt ? this.pickTarget(L) : this.tgt;
    const d = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    const near = !p.dead && d < this.aggro && Math.abs(p.pos.y - this.pos.y) < 6 && (!L.nl || (!p.downed && !p.hidden));
    const frozen = L.worldCut;
    switch (this.state) {
      case 'idle': {
        a.state = 'idle'; a.anger = near ? 0.7 : 0.3;
        // re-arm after the hero got thrown back (co-op: anyone still coming)
        const behind = L.nl ? L.alivePlayers().some((h) => h.pos.x < this.pos.x - 16) : p.pos.x < this.pos.x - 16;
        if (this.runner && behind) this.cd = 0.2;
        if (near && !frozen) {
          this.cd -= dt;
          // face the hero lazily
          const want = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
          let dd = want - this.root.rotation.y; dd = Math.atan2(Math.sin(dd), Math.cos(dd));
          if (!this.runner) this.root.rotation.y += dd * Math.min(1, dt * 1.5);
          const readyRunner = this.runner ? p.pos.x > this.pos.x - 15 && p.pos.x < this.pos.x - 5 : true;
          if (this.cd <= 0 && readyRunner) {
            if (!this.runner && this.enraged && d > 6 && Math.random() < 0.45) this.beginSpit(L);
            else if (!this.runner && d < 10 && Math.random() < (this.enraged ? 0.4 : 0.3)) this.begin('grab', L, p);
            else { this.comboLeft = this.enraged && !this.runner ? 1 : 0; this.begin('lash', L, p); }
          }
        }
        break;
      }
      case 'lash': {
        a.state = 'lash';
        a.p = clamp(this.st / this.dur, 0, 1);
        if (a.p > 0.35 && !this.struck) { this.struck = true; audio.sfx('whoosh', { pitch: 0.7 }); }
        if (a.p > 0.36 && a.p < 0.66) this.hitTest(L, 'lash');
        if (a.p > 0.62 && a.p < 0.64) { L.tcam.shake(0.25); audio.sfx('slam', { volume: 0.6, pitch: 1.3 }); }
        if (a.p >= 1) {
          if (this.comboLeft > 0) { this.comboLeft--; this.begin('lash', L, p); this.anim.lashDir = -this.anim.lashDir; break; }
          // worn out after lashing: the moment to strike
          this.state = this.runner ? 'idle' : 'tired'; this.st = 0; this.cd = this.runner ? 99 : rand(0.5, 1.0);
        }
        break;
      }
      case 'tired':
        a.state = 'hurt'; a.anger = 0.2;
        if (this.st > (this.enraged ? 0.75 : 1.0)) { this.state = 'idle'; this.st = 0; }
        break;
      case 'spit': {
        a.state = 'idle'; a.anger = 1;
        const turn = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z) - this.root.rotation.y;
        this.root.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * Math.min(1, dt * 4);
        this.root.scale.setScalar(this.S * (1 + Math.sin(this.st * 20) * 0.03));
        if (this.st > 0.55 + this.spat * 0.35 && this.spat < 3) {
          this.spat++;
          const from = this.eyePoint().setY(this.pos.y + 2.2 * this.S);
          const T = 0.95, g = 14;
          const tgt = p.pos.clone().add(new THREE.Vector3(p.vel.x * T * 0.6 + rand(-1.2, 1.2), 0.5, p.vel.z * T * 0.6 + rand(-1.2, 1.2)));
          const vel = new THREE.Vector3((tgt.x - from.x) / T, (tgt.y - from.y + 0.5 * g * T * T) / T, (tgt.z - from.z) / T);
          const shot = L.spawnEnemyShot('meat', from, vel, g);
          shot.ignoreTag = 'monster';
          // co-op: the clients' copies start inside my body too (the spawn message has no ignoreTag)
          if (L.nl && shot.netId) L.nl.entEvent(this, 'spit', { s: shot.netId });
          audio.sfx('throw', { pitch: 0.8 }); audio.sfx('chomp', { volume: 0.4 });
        }
        if (this.st > 1.8) { this.state = 'tired'; this.st = 0; this.root.scale.setScalar(this.S); this.cd = rand(0.4, 0.9); }
        break;
      }
      case 'grab': {
        a.state = 'grab';
        a.p = clamp(this.st / this.dur, 0, 1);
        this.root.updateMatrixWorld();
        a.target = this.root.worldToLocal(this.tgtLocal.copy(p.center()));
        if (a.p > 0.3 && a.p < 0.7) this.hitTest(L, 'grab');
        if (a.p >= 1) { this.state = 'idle'; this.st = 0; this.cd = rand(0.8, 1.4); this.grabEnd = this.t; }
        break;
      }
      case 'hold': {
        // drag the hero in while he struggles
        a.state = 'grab'; a.p = 0.75;
        const mouth = this.bodyCenter(tmp).add(tmp2.set(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y)).multiplyScalar(2.2 * this.S));
        this.holdPt.lerp(mouth.setY(this.pos.y + 1.4 * this.S), Math.min(1, dt * 0.9));
        this.root.updateMatrixWorld();
        a.target = this.root.worldToLocal(this.tgtLocal.copy(this.holdPt));
        if (!L.nl || this.holder === net.myId) {
          // my own hero: did he break free?
          if (L.player.grabbedBy !== (this.holding as unknown as Noodle3)) { this.holding = null; this.holder = null; this.state = 'stun'; this.st = 0; }
        } else {
          // a friend: gone, down, or (lost message) not hanging any more
          const r = this.holder ? L.remote(this.holder) : undefined;
          if (!r || r.dead || r.downed || (this.st > 2 && !r.grabbed)) { this.letGo(L, false); this.state = 'stun'; this.st = 0; }
        }
        break;
      }
      case 'stun':
        a.state = 'hurt';
        if (this.st > 2.2) { this.state = 'idle'; this.st = 0; this.cd = 0.6; }
        break;
      case 'dead':
        a.state = 'dead';
        break;
    }
    this.rig.update(dt, a);
  }

  private beginSpit(L: Level3D) {
    this.state = 'spit'; this.st = 0; this.spat = 0; this.seq++;
    audio.sfx('warn', { volume: 0.5, pitch: 0.6 });
    L.bark(this.rig.root, choose(['Тьфу-тьфу-тьфу!', 'Ешь фрикадельки!', 'Пфуй!']), 1.2, 3.6);
  }

  private begin(k: 'lash' | 'grab', L: Level3D, p: HeroLike) {
    this.state = k; this.st = 0; this.struck = false; this.seq++;
    this.dur = k === 'lash' ? (this.runner ? 1.35 : this.enraged ? 1.3 : 1.7) : this.enraged ? 1.25 : 1.5;
    this.root.updateMatrixWorld();
    const local = this.root.worldToLocal(tmp.copy(p.pos));
    if (this.runner) {
      // aim where the runner will be when the sweep passes (≈0.6 s ahead)
      local.copy(this.root.worldToLocal(tmp.copy(p.pos).add(new THREE.Vector3(p.vel.x * 0.55, 0, 0))));
    }
    this.anim.lashDir = Math.atan2(local.x, local.z);
    audio.sfx('warn', { volume: 0.5, pitch: 0.7 });
    if (Math.random() < 0.5) L.bark(this.rig.root, choose(['Буль-буль!', 'Ням-лапша!', 'Хвать-хвать!', 'Слюррп!']), 1.2, 3.6);
  }

  /** my own hero vs the tentacles (solo, the host's hero, and each client's hero against its puppet) */
  private hitTest(L: Level3D, k: 'lash' | 'grab') {
    const p = L.player;
    if (p.dead || p.invuln > 0 || p.dashing || p.grabbedBy || (L.nl && p.downed)) return;
    if (k === 'grab' && !L.authority && (this.claimed === this.netSeq || this.holding)) return;
    const pc = p.center();
    const segs = this.rig.segments();
    for (const s of segs) {
      for (let i = Math.floor(s.length * 0.35); i < s.length; i++) {
        const q = s[i];
        if (Math.abs(q.y - pc.y) > 0.9) continue;
        if (Math.hypot(q.x - pc.x, q.z - pc.z) < 0.55 + 0.12 * this.S) {
          if (k === 'lash') {
            tmp.copy(p.pos).sub(this.pos).setY(0).normalize();
            const knock = new THREE.Vector3(tmp.x * 10, 8, tmp.z * 10);
            const from = this.bodyCenter();
            localFx(L, () => { p.hurt(L, 1, from, knock); });
          } else if (L.authority) localFx(L, () => this.grabHero(L));
          else {
            // client: my hero is in the puppet's tentacles — ask the host (it picks one holder)
            this.claimed = this.netSeq;
            L.nl?.entEvent(this, 'claim', {});
          }
          return;
        }
      }
    }
  }

  /** my own hero gets caught (solo, or the host's hero) */
  private grabHero(L: Level3D) {
    const p = L.player;
    this.holdPt.copy(p.center());
    this.holding = this.makeGrabber(L, false);
    this.state = 'hold'; this.st = 0;
    if (L.nl) { this.holder = net.myId; L.nl.entEvent(this, 'hold', { who: net.myId, at: this.holdPt }); }
    this.hang(L);
  }

  /** the grabber my hero hangs from; on a client letting go is reported to the host */
  private makeGrabber(L: Level3D, remote: boolean): Grabber {
    const self = this;
    const g: Grabber = remote
      ? {
        tip: () => self.grabTip(),
        release: () => { if (self.holding === g) { self.holding = null; L.nl?.entEvent(self, 'free', {}); } },
      }
      : {
        tip: () => self.holdPt.clone().setY(self.holdPt.y + 0.6),
        release: () => { if (self.state === 'hold') { self.state = 'stun'; self.st = 0; self.anim.flash = 1; } self.holding = null; self.holder = null; },
      };
    return g;
  }

  /** put my hero into the tentacles */
  private hang(L: Level3D) {
    const p = L.player;
    p.grabbedBy = this.holding as unknown as Noodle3;
    p.grip = 6; p.grabDmgT = 1.1;
    p.atk = null; p.dashT = 0; p.body.gravity = 32;
    audio.sfx('grab');
    L.tcam.shake(0.25);
    L.fx.text(p.center().setY(p.pos.y + 1.6), 'Хвать!', '#f6d06a', 26);
    L.toast('Жми прыжок или удар, чтобы вырваться!');
  }

  /** where the held hero dangles (a victim's grabber follows it) */
  grabTip() { return this.holdPt.clone().setY(this.holdPt.y + 0.6); }
  /** the held hero's middle (the tentacles wrapped around him) */
  private victimPoint(out = new THREE.Vector3()) { return out.copy(this.holdPt).setY(this.holdPt.y + 0.5); }
  /** host: the tentacles hold a hero other than `hitter` (a hit near them is a rescue) */
  private holdsOther(hitter: string) { return !!this.holder && this.state === 'hold' && this.holder !== hitter; }

  /** host: the friend in the tentacles broke free (also reachable through L.netRelease) */
  netReleased(_L: Level3D, who: string, _why: string) {
    if (who !== this.holder) return;
    this.holder = null;
    if (this.state === 'hold') { this.state = 'stun'; this.st = 0; this.anim.flash = 1; }
  }

  /** host: let go of whoever is held (pea in the eye, a friend's rescue, death) */
  private letGo(L: Level3D, bounce: boolean) {
    if (this.holding) {
      L.player.grabbedBy = null;
      if (bounce) { L.player.body.vel.y = 8; L.player.invuln = 0.8; }
      this.holding = null;
    }
    if (L.nl && this.holder && this.holder !== net.myId) L.nl.entEvent(this, 'let', { who: this.holder, b: bounce ? 1 : 0 });
    this.holder = null;
  }

  /** host: a hit by someone else than the held hero frees the friend (feature 17) */
  private rescue(L: Level3D, by: string | null) {
    if (!L.nl || this.state !== 'hold' || !this.holder) return;
    const hitter = by ?? net.myId;
    if (hitter === this.holder) return;
    const who = this.holder;
    this.letGo(L, true);
    this.state = 'stun'; this.st = 0; this.anim.flash = 1;
    L.fx.text(this.eyePoint().setY(this.pos.y + 3.6 * this.S), 'Отпусти!', '#7ad0ff', 26);
    L.feed(`${heroName(hitter)} спас ${heroName(who)}!`, '#9ff0a0');
    L.nl.entEvent(this, 'rescue', { by: hitter, who });
    // the same swing also asks coopMechanics to free him: it skips a rescue that just happened
    ((L.refs.rescuedAt ??= {}) as Record<string, number>)[who] = L.t;
  }

  /** host: a client says its hero is in the puppet's tentacles */
  private claim(L: Level3D, from: string) {
    const r = L.remote(from);
    if (!r || r.dead || r.downed || this.holder || this.holding) return;
    // its copy runs a little behind mine: a claim that lands just after the grab ended still counts
    if (!(this.state === 'grab' || (this.state === 'idle' && this.t - this.grabEnd < 0.6))) return;
    this.holder = from;
    this.holdPt.copy(r.center());
    this.state = 'hold'; this.st = 0;
    L.nl!.entEvent(this, 'hold', { who: from, at: this.holdPt });
    audio.sfx('grab');
    L.fx.text(r.center().setY(r.pos.y + 1.6), 'Хвать!', '#f6d06a', 26);
  }

  // ───────────────────────── co-op replication ─────────────────────────
  /** [state, st, dur, rotY, lashDir, anger, flash, hp, enraged, seq, tx, ty, tz (root-local grab target), hx, hy, hz (hold point)] */
  netSnap(): number[] {
    const a = this.anim, g = this.tgtLocal;
    return [STATES.indexOf(this.state), this.st, this.dur, this.root.rotation.y, a.lashDir, a.anger, a.flash > 0.5 ? 1 : 0, this.hp,
      this.enraged ? 1 : 0, this.seq % 1000, g.x, g.y, g.z, this.holdPt.x, this.holdPt.y, this.holdPt.z];
  }

  /** client: a snapshot taken at host time t, played back at NetLevel.playT (puppet) */
  netApply(v: number[], t?: number) {
    if (t === undefined) return;
    (this.track ??= new NetTrack<number[]>(60)).push(t, v[13], v[14], v[15], v[3], v);
  }

  /** client: a snapshot's discrete fields, as the playback passes it */
  private netFields(v: number[]) {
    const s = STATES[v[0]] ?? 'idle';
    // (the reliable 'hold' event already put it in the hold: the last frames of its grab still in the playback don't undo that)
    if (!(this.state === 'hold' && this.holder && s === 'grab')) {
      // a new attack (or state): its clock starts where the host's was
      if (s !== this.state || v[9] !== this.netSeq || !this.got) { this.st = v[1]; this.tgtLocal.set(v[10], v[11], v[12]); }
      this.state = s;
    }
    if (s !== 'hold' && s !== 'grab') this.holder = null;
    this.netSeq = v[9];
    this.dur = v[2] || 1.6;
    this.anim.lashDir = v[4];
    if (v[6] || v[7] < this.hp) this.anim.flash = 1;
    this.hp = v[7];
    this.enraged = !!v[8];
    if (s === 'dead') this.col.active = false;
    this.got = true;
  }

  netEvent(L: Level3D, ev: string, d: { from?: string; who?: string; at?: THREE.Vector3; b?: number; by?: string; s?: number }) {
    if (L.authority) {
      if (ev === 'claim' && d.from) this.claim(L, d.from);
      else if (ev === 'free' && d.from) this.netReleased(L, d.from, 'free');
      return;
    }
    switch (ev) {
      case 'spit': {
        // my copy of the spat meatball (its spawn arrived just before this)
        const s = d.s ? (L.nl?.get(d.s) as unknown as Shot3 | undefined) : undefined;
        if (s) s.ignoreTag = 'monster';
        break;
      }
      case 'hold': {
        if (d.at) this.holdPt.copy(d.at);
        this.state = 'hold'; this.st = 0; this.holdSeen = this.t;
        const who = d.who ?? '';
        this.holder = who || null;
        if (who !== net.myId) {
          const h = L.remote(who);
          audio.sfx('grab');
          if (h) L.fx.text(h.center().setY(h.pos.y + 1.6), 'Хвать!', '#f6d06a', 26);
          break;
        }
        const p = L.player;
        // too late (dead, down, or something else already holds me): tell the host to let go
        if (p.dead || p.downed || p.grabbedBy) { L.nl?.entEvent(this, 'free', {}); break; }
        this.holdPt.copy(p.center());
        this.holding = this.makeGrabber(L, true);
        this.hang(L);
        break;
      }
      case 'let': {
        if (d.who !== net.myId) break;
        const p = L.player;
        if (this.holding && p.grabbedBy === (this.holding as unknown as Noodle3)) {
          p.grabbedBy = null;
          if (d.b) { p.body.vel.y = 8; p.invuln = 0.8; }
        }
        this.holding = null;
        break;
      }
      case 'hint':
        L.hint('spagArmor', 'Корка у монстра крепкая! Бей, когда он устал после удара щупальцами — или оглуши горохом в глаз');
        break;
      case 'rescue':
        if (d.by && d.who) L.feed(`${heroName(d.by)} спас ${heroName(d.who)}!`, '#9ff0a0');
        break;
    }
  }

  /** client: show the host's monster as it was at the playback time; my own hero is still checked against these tentacles */
  private puppet(L: Level3D, dt: number) {
    // (its attack clock runs with the playback)
    this.t += dt; this.st += L.nl?.playDt ?? dt;
    const a = this.anim;
    a.flash = Math.max(0, a.flash - dt * 6);
    const tr = this.track, play = L.nl?.playT ?? -Infinity;
    if (tr && tr.eval(play, dt, netPose)) {
      tr.passed(play, (v) => this.netFields(v));
      const c = tr.cur!, n = tr.next;
      a.anger = tr.lerp(5);
      this.root.rotation.y = netPose.yaw;
      // inside one attack its clock and grab target come from the two snapshots around the playback — never back
      if (n && n[0] === c[0] && n[9] === c[9] && STATES[c[0]] === this.state) {
        this.st = Math.max(this.st - (L.nl?.playDt ?? dt), tr.lerp(1));
        this.tgtLocal.set(tr.lerp(10), tr.lerp(11), tr.lerp(12));
      }
      // the point a held hero dangles from (MY hero: the newest word, as it carries me)
      const hp = this.holding ? tr.newestPos(tmpHold) : netPose.pos;
      this.holdPt.lerp(hp, Math.min(1, dt * 8));
    }
    switch (this.state) {
      case 'lash':
        a.state = 'lash';
        a.p = clamp(this.st / this.dur, 0, 1);
        if (a.p > 0.36 && a.p < 0.66) this.hitTest(L, 'lash');
        break;
      case 'grab':
        a.state = 'grab';
        a.p = clamp(this.st / this.dur, 0, 1);
        a.target = this.tgtLocal;
        if (a.p > 0.3 && a.p < 0.7) this.hitTest(L, 'grab');
        break;
      case 'hold':
        a.state = 'grab'; a.p = 0.75;
        this.root.updateMatrixWorld();
        a.target = this.root.worldToLocal(this.tgtLocal.copy(this.holdPt));
        break;
      case 'tired': case 'stun': a.state = 'hurt'; break;
      case 'dead': a.state = 'dead'; break;
      default: a.state = 'idle';
    }
    this.root.scale.setScalar(this.state === 'spit' ? this.S * (1 + Math.sin(this.st * 20) * 0.03) : this.S);
    // the host dropped me (missed message, it died): don't dangle from nothing
    if (this.state === 'hold') this.holdSeen = this.t;
    if (this.holding && this.t - this.holdSeen > 1) {
      const p = L.player;
      if (p.grabbedBy === (this.holding as unknown as Noodle3)) { p.grabbedBy = null; p.body.vel.y = 8; p.invuln = 0.8; }
      this.holding = null;
    }
    this.rig.update(dt, a);
  }

  // ───────────────────────── getting hit (host) ─────────────────────────
  /** co-op client: would my swing connect? (local hit-stop only — the host decides the hit) */
  predictHit(_L: Level3D, c: THREE.Vector3, range: number): boolean {
    if (this.state === 'dead') return false;
    const surf = Math.hypot(c.x - this.pos.x, c.z - this.pos.z) - this.col.r;
    return surf <= range + 0.3 && c.y <= this.pos.y + 3.3 * this.S && c.y >= this.pos.y - 1;
  }

  meleeHit(L: Level3D, c: THREE.Vector3, dir: THREE.Vector3, range: number, dmg: number, atkId: number, kind: string): boolean {
    if (!L.authority || this.state === 'dead') return false;
    const by = L.attacker;
    const key = by ? `${by}:${atkId}` : atkId;
    if (this.hitIds.has(key)) return false;
    // measured to the body's surface (its collider), so the hero hits it from wherever he can stand
    const surf = Math.hypot(c.x - this.pos.x, c.z - this.pos.z) - this.col.r;
    // co-op: a swing at the tentacles wrapped around a friend counts too (he dangles up to ~2.5 m above the floor)
    const v = this.victimPoint(tmp);
    const atTentacle = !!L.nl && this.holdsOther(by ?? net.myId) && Math.hypot(c.x - v.x, c.z - v.z) < range + 0.6 && Math.abs(c.y - v.y) < 2.8;
    if (!atTentacle && (surf > range + 0.3 || c.y > this.pos.y + 3.3 * this.S || c.y < this.pos.y - 1)) return false;
    this.hitIds.add(key);
    sharedFx(L, () => {
      this.rescue(L, by);
      this.hurt(L, dmg, c.clone().addScaledVector(dir, range * 0.6), kind === 'fork', by);
    });
    return true;
  }

  shotHit(L: Level3D, s: Shot3): boolean {
    if (!L.authority || this.state === 'dead') return false;
    const by = s.shooter;
    if (s.pos.distanceTo(this.eyePoint()) < 0.9 * this.S) {
      sharedFx(L, () => {
        if ((this.state as string) !== 'dead') {
          if (this.holding || this.holder) {
            const who = this.holder;
            this.letGo(L, true);
            if (L.nl && who && (by ?? net.myId) !== who) {
              L.feed(`${heroName(by ?? net.myId)} спас ${heroName(who)}!`, '#9ff0a0'); L.nl.entEvent(this, 'rescue', { by: by ?? net.myId, who });
              ((L.refs.rescuedAt ??= {}) as Record<string, number>)[who] = L.t;
            }
          }
          this.state = 'stun'; this.st = 0;
          L.fx.text(s.pos.clone().setY(s.pos.y + 1.6), 'В глаз!', '#ffe14a', 26);
        }
        this.hurt(L, s.dmg, s.pos.clone(), false, by);
      });
      return true;
    }
    // body — or (co-op) the tentacles around a held friend
    if (s.pos.distanceTo(this.bodyCenter()) < 1.45 * this.S + s.r || (L.nl && this.holdsOther(by ?? net.myId) && s.pos.distanceTo(this.victimPoint(tmp)) < 0.9 + s.r)) {
      sharedFx(L, () => { this.rescue(L, by); this.hurt(L, 1, s.pos.clone(), false, by); });
      return true;
    }
    return false;
  }

  private hurt(L: Level3D, dmg: number, at: THREE.Vector3, heavy: boolean, by: string | null = null) {
    const open = this.state === 'tired' || this.state === 'stun' || this.state === 'hold' || this.runner;
    // its crust shrugs off ordinary hits; tired or stunned it takes the full blow
    const real = open ? dmg + (this.state === 'stun' ? 1 : 0) : 1;
    this.hp -= real;
    this.anim.flash = 1;
    audio.sfx('hit', { pitch: open ? 0.8 : 1.3 });
    L.fx.juice(at.clone(), open ? 12 : 5, ['#d8402a', '#b8301a', '#f6d06a']);
    L.fx.text(at.clone().setY(at.y + 1.2), String(real), open ? '#ffe14a' : '#c8c0b8', open ? 28 : 20);
    if (!open && !this.runner) {
      this.armorHint(L, by);
      // pester it and it lashes right back (co-op: at whoever pestered it)
      this.quickHits++;
      if (this.quickHits >= 3 && this.state === 'idle') {
        this.quickHits = 0; this.comboLeft = 0;
        const h = (by && L.remote(by)) || L.player;
        if (L.nl) this.tgt = h;
        this.begin('lash', L, h);
      }
    }
    if (this.hp <= 0) { this.die(L); return; }
    if (!this.enraged && !this.runner && this.hp <= this.maxHp * 0.5) this.enrage(L);
    if (heavy && open && this.state === 'tired') this.st -= 0.25;
  }

  /** the one-time "tough crust" tip goes to whoever hit it */
  private armorHint(L: Level3D, by: string | null) {
    if (L.nl && by && by !== net.myId) { net.send(by, GM.ent, { id: this.netId, ev: 'hint', d: {} }); return; }
    localFx(L, () => L.hint('spagArmor', 'Корка у монстра крепкая! Бей, когда он устал после удара щупальцами — или оглуши горохом в глаз'));
  }

  private enrage(L: Level3D) {
    this.enraged = true;
    this.anim.anger = 1;
    audio.sfx('roar', { pitch: 1.3, volume: 0.7 });
    L.tcam.shake(0.5);
    L.hud.showBanner('МОНСТР В ЯРОСТИ!', '#ff5a4a');
    L.bark(this.rig.root, 'Ррр! Детки, ко мне!', 1.6, 3.6);
    for (const s of [-1, 1]) {
      const c = this.bodyCenter();
      const e = L.spawnEnemy('meatball', c.x + s * 2.5, this.pos.y, c.z + 1.5, { to: new THREE.Vector3(c.x + s * 6, this.pos.y, c.z + 4) });
      e.body.vel.set(s * 4, 8, 2);
      e.loot = 1;
      e.provoke(L);
      L.fx.juice(c.clone(), 10, ['#d8402a', '#8c4a2c']);
    }
  }

  private die(L: Level3D) {
    this.state = 'dead';
    this.col.active = false;
    this.letGo(L, false);
    audio.sfx('enemyDie'); audio.sfx('splash');
    L.tcam.shake(0.4);
    const c = this.bodyCenter();
    L.fx.juice(c, 30, ['#d8402a', '#b8301a', '#f6d06a']);
    L.fx.chunks(c, 16, ['#8c4a2c', '#f6d06a', '#d8402a'], this.pos.y, [0.15, 0.3]);
    L.hud.showBanner('МОНСТР ПОВЕРЖЕН!', '#ffd34a');
    for (let i = 0; i < (this.runner ? 4 : 12); i++) L.dropPickup(Math.random() < 0.25 ? 'bigcrumb' : 'crumb', c);
    if (!this.runner) { L.dropPickup('honey', c); L.dropPickup('heart', c); }
  }
}

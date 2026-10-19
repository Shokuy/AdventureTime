import * as THREE from 'three';
import { input } from '../engine/input';
import { save } from '../engine/save';
import { clamp, damp, invLerp, lerp, noise1 } from '../engine/util';
import type { PhysWorld } from './physics/world';
import type { Collider } from './physics/types';

export type CamMode = 'follow' | 'cine' | 'chase' | 'boss';

const tmpV = new THREE.Vector3();
const tmpD = new THREE.Vector3();
const tmpL = new THREE.Vector3();
const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (a: number, b: number, x: number) => { const k = invLerp(a, b, x); return k * k * (3 - 2 * k); };
/** the player's zoom range (wheel / zoom keys / settings «Дальность камеры») */
export const ZOOM_MIN = 4, ZOOM_MAX = 13;
/** inside a raised ambush ring: the orbit keeps this far inside the bars; it tilts up to RING_PITCH (rad) to do so */
const RING_MARGIN = 0.8, RING_PITCH = 0.85, RING_OUT = 1.5, RING_PITCH_OUT = 1.15;
/** the vertical field of view every cutscene shot (L.shot) is framed for */
const CINE_FOV = 58;

/** boss fight framing: the camera stays on MY hero; the boss only nudges it */
const BOSS = {
  /** extra orbit distance over the player's zoom, and the farthest it may get */
  extra: 2, maxDist: 12,
  /** auto-turn toward the boss while the mouse is idle: rate, cap (rad/s), fade-in by distance to him (m) */
  turn: 1.1, turnCap: 0.7, turnNear: 8, turnFar: 20,
  /** look-point lean toward the boss (m): sideways/forward and up, faded in by distance */
  lean: 1.2, up0: 0.3, up: 0.9,
  /** the focus never lags further than this behind the hero (m); a jump further than `snap` is a teleport */
  lag: 1.8, snap: 14,
  /** shake strength (his slams and roars come every second) */
  shake: 0.5,
};

/** Third-person orbit camera with collision, auto-follow, shake and cinematic overrides. */
export class TPCamera {
  // near 0.3 (not 0.1): 3× more depth precision everywhere → no z-fighting of thin layers at distance.
  // The orbit camera never gets closer than 1.2 to the focus, so nothing gets clipped.
  cam = new THREE.PerspectiveCamera(58, 16 / 9, 0.3, 900);
  mode: CamMode = 'follow';
  yaw = 0;
  pitch = 0.32;
  /** orbit distance: the player's zoom (kept in the settings, so it carries over between levels) */
  dist = clamp(save.data.settings.camDist, ZOOM_MIN, ZOOM_MAX);
  zoomDist = this.dist;
  private zoomSeen = save.data.settings.camDist;
  focus = new THREE.Vector3();
  private trauma = 0;
  private st = 0;
  private idleLook = 0;
  fovKick = 0;
  /** settings «Поле зрения» */
  get baseFov() { return save.data.settings.fov; }
  /** cinematic targets */
  cinePos = new THREE.Vector3();
  cineLook = new THREE.Vector3();
  private curLook = new THREE.Vector3();
  cineSmooth = 0; // 0 = hard set, >0 damping speed
  /** boss/chase helpers */
  bossPoint: THREE.Vector3 | null = null;
  chaseOffset = new THREE.Vector3(-7, 4.3, 0);
  minPitch = -0.15;
  maxPitch = 1.2;
  /** 0..1 slingshot aim blend: over-the-shoulder, closer, narrower FOV */
  aimK = 0;
  private aimFocus = new THREE.Vector3();
  /** boss mode: the look point's current lean toward the boss (smoothed, bounded) */
  private lean = new THREE.Vector3();
  private leanWant = new THREE.Vector3();
  /** orbit distance after collisions: pulled in at once (never through a wall), eased back out; <0 = unset */
  private colD = -1;
  /** colliders the orbit camera passes through (e.g. the boss's moving palms — they'd pump the zoom) */
  camSkip: ((c: Collider) => boolean) | null = null;
  /**
   * raised ambush rings (arena bars) around: instead of being shoved against their tall invisible wall (it used to end
   * up inside a bar, 1.2 m from the hero, the hero filling the screen) the orbit tilts up inside the ring (ringLift).
   * Set by the level each frame (x, z: centre; r: radius; y0..y1: the bars' height).
   */
  rings: { x: number; z: number; r: number; y0: number; y1: number }[] = [];
  private skipRing = (c: Collider) => (c.tag === 'gate') || (this.camSkip ? this.camSkip(c) : false);

  setAspect(a: number) { this.cam.aspect = a; this.cam.updateProjectionMatrix(); }

  /** the orbit is squeezed in by a wall right now (for the "zoom in/out" tip) */
  get pulledIn() { return this.mode === 'follow' && this.colD > 0 && this.colD < Math.min(3, this.zoomDist - 1.5); }

  shake(a: number) {
    if (!save.data.settings.shake) a *= 0.3;
    this.trauma = Math.min(1, this.trauma + a);
  }

  /** forward/right on the ground plane for camera-relative movement */
  basis() {
    const f = new THREE.Vector2(-Math.sin(this.yaw), -Math.cos(this.yaw));
    const r = new THREE.Vector2(Math.cos(this.yaw), -Math.sin(this.yaw));
    return { f, r };
  }

  snapBehind(yaw: number) { this.yaw = yaw; }

  /** place camera instantly (after teleports / level start) */
  snap(target: THREE.Vector3) {
    this.focus.copy(target).add(new THREE.Vector3(0, this.mode === 'boss' ? 1.15 : 0.9, 0));
    this.dist = this.zoomDist + (this.mode === 'boss' ? BOSS.extra : 0);
    this.colD = -1;
    this.lean.set(0, 0, 0);
    this.apply(null, 0);
  }

  update(dt: number, target: THREE.Vector3, vel: THREE.Vector3, phys: PhysWorld | null, controllable: boolean) {
    this.st += dt * 25;
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    if (this.mode === 'cine') { this.updateCine(dt); return; }

    // input
    if (controllable) {
      const st = save.data.settings;
      const sens = 0.0024 * st.sens * (1 - 0.35 * this.aimK);
      const inv = st.invertY ? -1 : 1;
      if (input.lookX || input.lookY) this.idleLook = 0;
      this.yaw -= input.lookX * sens;
      this.pitch += input.lookY * sens * inv;
      if (input.stickRX || input.stickRY) { this.yaw -= input.stickRX * dt * 2.6 * st.padSens; this.pitch += input.stickRY * dt * 1.8 * st.padSens * inv; this.idleLook = 0; }
      if (input.down('camL')) { this.yaw += dt * 2.2; this.idleLook = 0; }
      if (input.down('camR')) { this.yaw -= dt * 2.2; this.idleLook = 0; }
      // zoom: wheel steps, or hold the zoom keys / buttons; remembered for the next levels
      const z = input.wheel * 0.8 + ((input.down('zoomOut') ? 1 : 0) - (input.down('zoomIn') ? 1 : 0)) * 6 * dt;
      if (z) { this.zoomDist = clamp(this.zoomDist + z, ZOOM_MIN, ZOOM_MAX); st.camDist = this.zoomSeen = Math.round(this.zoomDist * 10) / 10; }
    }
    // «Дальность камеры» moved in the settings
    if (save.data.settings.camDist !== this.zoomSeen) { this.zoomSeen = save.data.settings.camDist; this.zoomDist = clamp(this.zoomSeen, ZOOM_MIN, ZOOM_MAX); }
    this.idleLook += dt;
    this.pitch = clamp(this.pitch, this.minPitch, this.maxPitch);

    const hs = Math.hypot(vel.x, vel.z);
    if (this.mode === 'follow') {
      // lazy auto-align behind the movement direction when the player isn't steering the camera
      if (this.idleLook > 1.2 && hs > 2 && this.aimK < 0.1) {
        const want = Math.atan2(-vel.x, -vel.z);
        let diff = ((want - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        // don't spin when running toward the camera
        if (Math.abs(diff) < 2.2) this.yaw += diff * Math.min(1, dt * 0.9 * (hs / 7));
        diff = 0;
      }
      this.focus.x = damp(this.focus.x, target.x, 12, dt);
      this.focus.z = damp(this.focus.z, target.z, 12, dt);
      this.focus.y = damp(this.focus.y, target.y + 0.95, vel.y < -8 ? 14 : 6, dt);
    } else if (this.mode === 'boss' && this.bossPoint) {
      // locked on MY hero; the boss only nudges the framing (a bounded lean, a gentle turn while the mouse rests)
      const bp = this.bossPoint;
      const dx = target.x - bp.x, dz = target.z - bp.z;
      const hd = Math.hypot(dx, dz);
      if (this.idleLook > 1 && this.aimK < 0.1) {
        // turn so he stays ahead — rate-capped, faded out near him (the bearing round him swings wildly there),
        // and never a swing round when the hero runs back toward the camera
        const w = smooth(BOSS.turnNear, BOSS.turnFar, hd);
        const diff = wrapA(Math.atan2(dx, dz) - this.yaw);
        if (w > 0 && Math.abs(diff) < 2.2) this.yaw += clamp(diff * BOSS.turn, -BOSS.turnCap, BOSS.turnCap) * w * dt;
      }
      // (squeezed in close by a pillar or a wall, every lag shows hugely: track him tighter)
      const tight = this.colD > 0 && this.colD < 4 ? 2 : 1;
      this.follow(target, 1.15, 10 * tight, 7 * tight, dt);
      const k = smooth(4, 30, hd);
      if (hd > 0.01) this.leanWant.set(-dx / hd, 0, -dz / hd).multiplyScalar(BOSS.lean * k);
      else this.leanWant.set(0, 0, 0);
      this.leanWant.y = BOSS.up0 + BOSS.up * k;
      this.lean.x = damp(this.lean.x, this.leanWant.x, 2, dt);
      this.lean.y = damp(this.lean.y, this.leanWant.y, 2, dt);
      this.lean.z = damp(this.lean.z, this.leanWant.z, 2, dt);
    } else if (this.mode === 'chase') {
      this.focus.x = damp(this.focus.x, target.x, 8, dt);
      this.focus.y = damp(this.focus.y, target.y + 1, 4, dt);
      this.focus.z = damp(this.focus.z, target.z, 4, dt);
    }
    const zd = this.mode === 'boss' ? Math.min(BOSS.maxDist, this.zoomDist + BOSS.extra) : this.zoomDist;
    this.dist = damp(this.dist, lerp(zd, 2.5, this.aimK), this.aimK > 0.05 ? 14 : 4, dt);
    this.cam.fov = damp(this.cam.fov, this.baseFov + this.fovKick + (this.mode === 'chase' ? 6 : 0) - 12 * this.aimK, 8, dt);
    this.fovKick = damp(this.fovKick, 0, 4, dt);
    this.cam.updateProjectionMatrix();
    this.apply(phys, dt);
  }

  /** focus follows the hero (feet + dy) smoothly, but never lags far behind him; a teleport snaps it */
  private follow(target: THREE.Vector3, dy: number, kxz: number, ky: number, dt: number) {
    const f = this.focus, ty = target.y + dy;
    if (Math.hypot(f.x - target.x, f.y - ty, f.z - target.z) > BOSS.snap) { f.set(target.x, ty, target.z); this.colD = -1; return; }
    f.x = damp(f.x, target.x, kxz, dt);
    f.z = damp(f.z, target.z, kxz, dt);
    f.y = damp(f.y, ty, ky, dt);
    const lx = f.x - target.x, lz = f.z - target.z, l = Math.hypot(lx, lz);
    if (l > BOSS.lag) { f.x = target.x + (lx / l) * BOSS.lag; f.z = target.z + (lz / l) * BOSS.lag; }
    f.y = clamp(f.y, ty - BOSS.lag, ty + BOSS.lag);
  }

  private apply(phys: PhysWorld | null, dt: number) {
    const cam = this.cam;
    if (this.mode === 'chase') {
      // runner view: behind the hero, looking down the gallery
      const o = this.chaseOffset;
      cam.position.set(this.focus.x + o.x, this.focus.y + o.y, this.focus.z * 0.6 + o.z);
      tmpV.set(this.focus.x + 7, this.focus.y + 0.6, this.focus.z * 0.75);
      cam.lookAt(tmpV);
    } else {
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      tmpD.set(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp);
      // over-the-shoulder offset while aiming the slingshot
      const af = this.aimFocus.copy(this.focus);
      if (this.aimK > 0.001) af.add(tmpV.set(Math.cos(this.yaw) * 0.85, 0.32, -Math.sin(this.yaw) * 0.85).multiplyScalar(this.aimK));
      let d = this.dist;
      if (phys) {
        const ringy = this.rings.length > 0;
        if (ringy) d = this.ringLift(af, tmpD, d);
        const hit = phys.raycast(af, tmpD, d + 0.4, ringy ? this.skipRing : this.camSkip ?? undefined);
        if (hit < d + 0.4) d = Math.max(1.2, hit - 0.4);
      }
      // boss fight: pulled in at once (never through a wall), eased back out (no zoom pumping past pillars)
      if (this.colD < 0 || d <= this.colD || this.mode !== 'boss') this.colD = d;
      else if (dt > 0) this.colD = Math.min(d, damp(this.colD, d, 3.5, dt));
      d = this.colD;
      cam.position.copy(af).addScaledVector(tmpD, d);
      if (this.mode === 'boss' && this.bossPoint) {
        // the lean shrinks with the distance (a close camera must not swing the hero off-screen) and while aiming
        const k = (1 - this.aimK) * clamp((d - 1.2) / 7, 0, 1);
        tmpL.copy(af).addScaledVector(this.lean, k);
        // squeezed in close (a pillar, a wall): look at his middle, not over his head
        tmpL.y -= 0.45 * (1 - clamp((d - 1.2) / 3.5, 0, 1));
        cam.lookAt(tmpL);
      } else cam.lookAt(af);
    }
    const p = this.trauma * this.trauma * (this.mode === 'boss' ? BOSS.shake : 1);
    if (p > 0.0001) {
      cam.rotation.z += noise1(this.st, 3) * 0.05 * p;
      cam.position.x += noise1(this.st, 1) * 0.5 * p;
      cam.position.y += noise1(this.st, 7) * 0.4 * p;
    }
  }

  /**
   * inside a raised ring of bars: where the ring would cut the orbit short (my hero by the bars, the camera turned
   * toward them) the camera tilts UP — the same orbit length, steeper — so it stays inside the ring; past RING_PITCH it
   * keeps that tilt and looks over / through the thin bars from outside (the level hides the bars in its way, see
   * Level3D.ringBarsClear) instead of being shoved against their tall invisible wall (it used to end up inside a bar,
   * 1.2 m from the hero, the hero filling the screen). Continuous: at RING_PITCH both cases are the same spot.
   * Turns `dir` in place; returns the orbit distance.
   */
  private ringLift(o: THREE.Vector3, dir: THREE.Vector3, d: number) {
    for (const g of this.rings) {
      const ox = o.x - g.x, oz = o.z - g.z;
      if (Math.hypot(ox, oz) > g.r || o.y < g.y0 - 1 || o.y > g.y1 + 1) continue;
      const hl = Math.hypot(dir.x, dir.z);
      if (hl < 1e-4) continue;
      const ux = dir.x / hl, uz = dir.z / hl;
      // how far the camera may go horizontally (to R − margin along the orbit's bearing)
      const R = g.r - RING_MARGIN, b = ox * ux + oz * uz, c0 = ox * ox + oz * oz - R * R;
      const disc = b * b - c0;
      const allow = Math.max(0, disc > 0 ? -b + Math.sqrt(disc) : 0);
      if (d * hl <= allow) continue;
      const p0 = Math.asin(clamp(dir.y, -1, 1));
      let p = Math.max(p0, Math.min(RING_PITCH, Math.acos(clamp(allow / d, 0, 1))));
      // outside, the market's stalls and awnings crowd the ring (no colliders on awnings): stay within RING_OUT of the
      // bars — steeper still (to RING_PITCH_OUT), then closer
      const Ro = g.r + RING_OUT, c1 = ox * ox + oz * oz - Ro * Ro;
      const out = -b + Math.sqrt(Math.max(0, b * b - c1));
      if (d * Math.cos(p) > out) {
        p = Math.max(p, Math.min(RING_PITCH_OUT, Math.acos(clamp(out / d, 0, 1))));
        if (d * Math.cos(p) > out) d = Math.max(2.4, out / Math.cos(p));
      }
      dir.set(ux * Math.cos(p), Math.sin(p), uz * Math.cos(p));
    }
    return d;
  }

  /** cinematic: camera moves toward cinePos and looks at cineLook */
  private updateCine(dt: number) {
    const cam = this.cam;
    if (this.cineSmooth > 0) {
      cam.position.x = damp(cam.position.x, this.cinePos.x, this.cineSmooth, dt);
      cam.position.y = damp(cam.position.y, this.cinePos.y, this.cineSmooth, dt);
      cam.position.z = damp(cam.position.z, this.cinePos.z, this.cineSmooth, dt);
      this.curLook.x = damp(this.curLook.x, this.cineLook.x, this.cineSmooth, dt);
      this.curLook.y = damp(this.curLook.y, this.cineLook.y, this.cineSmooth, dt);
      this.curLook.z = damp(this.curLook.z, this.cineLook.z, this.cineSmooth, dt);
    } else {
      cam.position.copy(this.cinePos);
      this.curLook.copy(this.cineLook);
    }
    cam.lookAt(this.curLook);
    const p = this.trauma * this.trauma;
    if (p > 0.0001) {
      cam.rotation.z += noise1(this.st, 3) * 0.05 * p;
      cam.position.x += noise1(this.st, 1) * 0.5 * p;
      cam.position.y += noise1(this.st, 7) * 0.4 * p;
    }
    // cutscene shots are framed for this lens, whatever «Поле зрения» the player picked for play
    cam.fov = damp(cam.fov, CINE_FOV + this.fovKick, 6, dt);
    cam.updateProjectionMatrix();
  }

  /** start a cinematic shot from the current camera pose */
  beginCine() {
    this.mode = 'cine';
    this.cinePos.copy(this.cam.position);
    const dir = new THREE.Vector3();
    this.cam.getWorldDirection(dir);
    this.cineLook.copy(this.cam.position).addScaledVector(dir, 8);
    this.curLook.copy(this.cineLook);
  }

  /** derive orbit yaw/pitch from the current camera pose so leaving a cutscene is seamless */
  endCine(mode: CamMode, focus: THREE.Vector3) {
    this.mode = mode;
    const off = this.cam.position.clone().sub(focus);
    this.yaw = Math.atan2(off.x, off.z);
    const len = off.length();
    this.pitch = clamp(Math.asin(clamp(off.y / Math.max(0.001, len), -1, 1)), this.minPitch, this.maxPitch);
    this.dist = clamp(len, 3, 16);
    this.focus.copy(focus);
    this.colD = -1;
    this.lean.set(0, 0, 0);
  }
}

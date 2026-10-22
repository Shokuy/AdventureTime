import * as THREE from 'three';
import type { Waiter } from '../../../../game/coroutine';
import type { Level3D } from '../../level';
import { noOutline } from '../../../gfx';

/*
 * Ноки's lost shadow — «тень без хозяина», the visual thread А of docs/script-fangs-v2.md §1.6: a little girl with
 * pigtails and a guitar, a flat black silhouette. Shared by every series (moved here from fangs5/finale.ts; the old
 * `fly` / `ground` meshes and `dispose()` keep the finale's API).
 *
 *   const girl = new ShadowGirl(L);
 *   girl.waveOnWall(pos, normal);            // С2: on the dome's parapet, waving (only Бублик notices)
 *   yield girl.hopAhead([p0, p1, p2], 3);    // С3: hops over the water from tussock to tussock (a Waiter)
 *   girl.inMirror(pos, normal, 'left');      // С4: in a maze mirror, pointing the way
 *   girl.sitBeside(pos, yaw);                // С5: sits by the campfire (takes the cookie: girl.reach(true))
 *   girl.holdHand(pos, normal);              // С6: holds the King's hand at the cannon (reaching up)
 *   girl.hide();  girl.dispose();
 *
 * Everything is local visuals (scripts run on every machine and drive it). `pose` frames are canvas silhouettes; the
 * upright plane `fly` is used for wall / mirror / standing poses, the flat `ground` plane for a shadow on the ground.
 */

type Pose = 'stand' | 'wave1' | 'wave2' | 'point' | 'sit' | 'reach' | 'hop';
const TEX = new Map<Pose, THREE.Texture>();

/** one silhouette frame (128×192 canvas, the girl's feet at the bottom) */
function frame(p: Pose): THREE.Texture {
  const hit = TEX.get(p);
  if (hit) return hit;
  const c = document.createElement('canvas'); c.width = 128; c.height = 192;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(10,6,20,0.93)';
  const sit = p === 'sit', hop = p === 'hop';
  const dy = sit ? 46 : hop ? -10 : 0;
  g.save(); g.translate(0, dy);
  // head + pigtails
  g.beginPath(); g.arc(64, 44, 18, 0, Math.PI * 2); g.fill();
  const tw = hop ? 0.9 : 0.35;
  g.beginPath(); g.ellipse(40, 50, 6, 18, tw, 0, Math.PI * 2); g.ellipse(88, 50, 6, 18, -tw, 0, Math.PI * 2); g.fill();
  // dress
  g.beginPath(); g.moveTo(46, 62); g.lineTo(82, 62); g.lineTo(sit ? 98 : 92, sit ? 112 : 130); g.lineTo(sit ? 30 : 36, sit ? 112 : 130); g.closePath(); g.fill();
  // legs
  if (sit) { g.fillRect(34, 104, 46, 11); g.fillRect(72, 104, 11, 28); g.fillRect(36, 104, 11, 28); }
  else if (hop) { g.save(); g.translate(52, 128); g.rotate(0.5); g.fillRect(-6, 0, 12, 42); g.restore(); g.save(); g.translate(76, 128); g.rotate(-0.5); g.fillRect(-6, 0, 12, 42); g.restore(); }
  else { g.fillRect(46, 128, 12, 50); g.fillRect(70, 128, 12, 50); }
  // the guitar on her back / side
  g.beginPath(); g.ellipse(94, sit ? 100 : 112, 20, 15, 0.5, 0, Math.PI * 2); g.fill();
  g.save(); g.translate(78, sit ? 82 : 92); g.rotate(-0.7); g.fillRect(-3, -46, 6, 48); g.restore();
  // arms
  const arm = (x: number, y: number, a: number, len = 34) => { g.save(); g.translate(x, y); g.rotate(a); g.beginPath(); g.roundRect(-4, 0, 8, len, 4); g.fill(); g.beginPath(); g.arc(0, len, 6, 0, Math.PI * 2); g.fill(); g.restore(); };
  if (p === 'wave1') arm(48, 66, 2.6);
  else if (p === 'wave2') arm(48, 66, 2.1);
  else if (p === 'point') arm(48, 66, 1.6, 42);
  else if (p === 'reach') arm(48, 66, 2.9, 44);
  else if (sit) arm(48, 66, 0.6, 30);
  else arm(48, 66, 0.25);
  g.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  TEX.set(p, t);
  return t;
}

type Mode =
  | { k: 'off' }
  | { k: 'wave' }
  | { k: 'still'; pose: Pose }
  | { k: 'hop'; path: THREE.Vector3[]; i: number; u: number; speed: number; done: boolean };

export class ShadowGirl {
  /** the upright silhouette (walls, mirrors, standing) */
  fly: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  /** the shadow lying on the ground (the finale: it lies down at Ноки's feet) */
  ground: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private mode: Mode = { k: 'off' };
  private t = 0;
  private upd: (t: number, dt: number) => void;
  constructor(private L: Level3D) {
    const mat = new THREE.MeshBasicMaterial({ map: frame('stand'), transparent: true, depthWrite: false, color: '#ffffff', side: THREE.DoubleSide, opacity: 0 });
    // (centred plane, like the finale's: the moves lift it by half its height so her feet are on the spot)
    this.fly = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.8), mat);
    noOutline(this.fly);
    L.scene.add(this.fly);
    const gm = new THREE.MeshBasicMaterial({ map: frame('stand'), transparent: true, depthWrite: false, opacity: 0, color: '#000000' });
    gm.polygonOffset = true; gm.polygonOffsetFactor = -3;
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.4).translate(0, 1.2, 0).rotateX(-Math.PI / 2), gm);
    noOutline(this.ground);
    L.scene.add(this.ground);
    this.fly.visible = this.ground.visible = false;
    this.upd = (_t, dt) => this.update(dt);
    L.updaters.push(this.upd);
  }

  private setPose(p: Pose) { const m = frame(p); if (this.fly.material.map !== m) { this.fly.material.map = m; this.fly.material.needsUpdate = true; } }
  private base = 1;
  private sitting = false;
  private show(opacity = 0.92, scale = 1) {
    this.fly.visible = true; this.fly.material.opacity = opacity; this.fly.scale.setScalar(scale);
    this.base = scale;
    this.fly.position.y += 0.9 * scale;
    this.ground.visible = false;
  }
  /** stand the upright plane at `pos` (her feet), facing along `normal` (out of the wall / mirror) */
  private stand(pos: THREE.Vector3, normal: THREE.Vector3, lift = 0.02) {
    this.fly.position.copy(pos).addScaledVector(normal, lift);
    this.fly.rotation.set(0, Math.atan2(normal.x, normal.z), 0);
    this.sitting = false;
  }

  /** С2: on a wall / parapet, waving (`scale` 0.8 = a small girl) */
  waveOnWall(pos: THREE.Vector3, normal: THREE.Vector3, scale = 0.8) { this.stand(pos, normal); this.show(0.92, scale); this.mode = { k: 'wave' }; this.t = 0; }
  /** С4: in a mirror (the plane just in front of the glass), pointing to her right (`'right'`) or left */
  inMirror(pos: THREE.Vector3, normal: THREE.Vector3, side: 'left' | 'right' = 'right', scale = 0.8) {
    this.stand(pos, normal, 0.03); this.show(0.8, scale);
    this.fly.scale.x = side === 'right' ? -scale : scale; // the frame points to her left: mirror it
    this.mode = { k: 'still', pose: 'point' }; this.setPose('point');
  }
  /** С5: sitting beside someone at (pos), turned to yaw (upright: by the fire there is no wall to fall on) */
  sitBeside(pos: THREE.Vector3, yaw: number, scale = 0.75) {
    this.fly.position.copy(pos); this.fly.rotation.set(0, yaw, 0);
    this.show(0.88, scale); this.sitting = true; this.mode = { k: 'still', pose: 'sit' }; this.setPose('sit');
  }
  /** С5: reach out (takes the cookie) / back to sitting */
  reach(on: boolean) { const m = this.mode; if (m.k === 'still') { m.pose = on ? 'reach' : this.sitting ? 'sit' : 'stand'; this.setPose(m.pose); } }
  /** С6: holding the King's hand back at the cannon: reaching up, on a wall / the floor's edge, facing `normal` */
  holdHand(pos: THREE.Vector3, normal: THREE.Vector3, scale = 0.9) { this.stand(pos, normal); this.show(0.95, scale); this.mode = { k: 'still', pose: 'reach' }; this.setPose('reach'); }
  /** С3: hops over the water along `path` (a shadow ON the water: the flat plane), `speed` m/s; a Waiter for the hop */
  hopAhead(path: THREE.Vector3[], speed = 3): Waiter {
    if (path.length < 2) return { update: () => true };
    this.fly.visible = false;
    this.ground.visible = true; this.ground.material.opacity = 0.75;
    this.ground.position.copy(path[0]).setY(path[0].y + 0.03);
    const m: Mode = { k: 'hop', path: path.map((p) => p.clone()), i: 0, u: 0, speed, done: false };
    this.mode = m;
    return { update: () => m.done || this.mode !== m };
  }
  hide() { this.fly.visible = this.ground.visible = false; this.mode = { k: 'off' }; }

  private update(dt: number) {
    this.t += dt;
    const m = this.mode;
    if (m.k === 'wave') this.setPose(Math.floor(this.t * 3.2) % 2 ? 'wave1' : 'wave2');
    else if (m.k === 'still') {
      // a breath, so it reads as alive
      this.fly.scale.y = this.base * (1 + Math.sin(this.t * 2.4) * 0.015);
    } else if (m.k === 'hop' && !m.done) {
      const a = m.path[m.i], b = m.path[m.i + 1];
      const len = Math.max(0.01, a.distanceTo(b));
      m.u += (dt * m.speed) / len;
      const k = Math.min(1, m.u);
      const p = this.ground.position.lerpVectors(a, b, k);
      p.y += 0.03;
      // a hop = the shadow shrinks while she's "up", then lands
      const up = Math.sin(k * Math.PI);
      this.ground.scale.set(1 - up * 0.35, 1, 1 - up * 0.35);
      this.ground.rotation.y = Math.atan2(b.x - a.x, b.z - a.z) + Math.PI;
      if (k >= 1) { m.i++; m.u = 0; if (m.i >= m.path.length - 1) { m.done = true; this.ground.scale.set(1, 1, 1); } }
    }
  }

  dispose() {
    const i = this.L.updaters.indexOf(this.upd);
    if (i >= 0) this.L.updaters.splice(i, 1);
    this.fly.removeFromParent(); this.ground.removeFromParent();
    this.fly.geometry.dispose(); this.ground.geometry.dispose();
    this.fly.material.dispose(); this.ground.material.dispose();
  }
}

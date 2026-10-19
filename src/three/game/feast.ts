import * as THREE from 'three';
import { audio } from '../../engine/audio';
import { choose, clamp, damp, lerp, rand } from '../../engine/util';
import { createKing, createGuard } from '../models';
import type { KingRig, KingAnim, GuardAnim, Rig } from '../models';
import { mat, mesh, noOutline } from '../gfx';
import { makeBlob } from '../fx';
import type { Level3D } from './level';
import type { Netted } from './netLevel';
import { NetTrack, type NetPose } from './netInterp';
import { localFx } from './spaghettiMonster';
import { createFood, createPlatter, PLATTER_TOP } from '../models/food';
import type { FoodKind } from '../models/food';

/**
 * Chapter 2 set piece: the King sits on his throne at the head of the banquet table and eats.
 *  • pairs of watermelon servants pop out of a kitchen hatch in the table and carry platters to him;
 *    his right hand takes the food and stuffs it into his mouth;
 *  • his left hand keeps snatching snacks from the plates on the near end of the table —
 *    a growing shadow shows where the palm will land, and anyone under it gets swatted.
 *
 * Co-op: ONE shared King. The host runs him (snack picks among all heroes, servants, plates) and replicates
 * hands, servants, plates and his face; clients play them back at NetLevel.playT (netInterp.ts) — the snack palm's
 * drop falls on its own copy. The swat and the servants' shove are checked victim-side: every machine tests only its
 * own hero (the host sends the moment the palm lands; a client takes it when the playback gets there).
 */

type HState = 'rest' | 'reach' | 'hover' | 'drop' | 'grab' | 'toMouth' | 'eat' | 'back';
type Pose = KingAnim['hands'][number]['pose'];

interface Snack { at: THREE.Vector3; kind: FoodKind; obj: THREE.Object3D | null; respawn: number }

/** wire ids */
const HSTATES: HState[] = ['rest', 'reach', 'hover', 'drop', 'grab', 'toMouth', 'eat', 'back'];
const POSES: Pose[] = ['rest', 'open', 'flat', 'fist', 'grab'];
const PSTATES: Pair['state'][] = ['below', 'rise', 'walk', 'wait', 'cheer', 'back', 'sink'];
const FOODS: FoodKind[] = ['drumstick', 'pie', 'ham', 'grapes', 'pudding', 'cakeSlice'];
/** co-op: fixed net id (the King is made after the level build, by SCRIPTS3.special) */
const NET_ID = 901;

class FHand {
  pos = new THREE.Vector3();
  rest: THREE.Vector3;
  state: HState = 'rest';
  t = 0; vy = 0; wait = rand(2, 4);
  target = new THREE.Vector3();
  food: THREE.Object3D | null = null;
  /** what the hand holds, for clients: −1 nothing, 0..3 snack index, 10+k platter food FOODS[k] */
  code = -1;
  snack: Snack | null = null;
  pose: Pose = 'rest';
  /** client: where my copy was when it went back to following the host's hand (after its own drop): fades */
  off = new THREE.Vector3();
  following = false;
  /** client: the snack palm's drop, played by my copy */
  falling = false;
  /** glowing floor telegraph (same look as the boss fight): ring + growing fill */
  marker = new THREE.Group();
  // normal blending: reads on the light tablecloth (additive would wash out on white)
  ringM = new THREE.MeshBasicMaterial({ color: '#e8380a', transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, fog: false });
  fillM = new THREE.MeshBasicMaterial({ color: '#ff6a00', transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, fog: false });
  fill: THREE.Mesh;
  constructor(rest: THREE.Vector3) {
    this.rest = rest.clone(); this.pos.copy(rest);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2), this.ringM);
    this.fill = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), this.fillM);
    ring.renderOrder = 4; this.fill.renderOrder = 3;
    this.marker.add(this.fill, ring);
    noOutline(this.marker);
    this.marker.visible = false;
  }
  set(s: HState) { this.state = s; this.t = 0; }
}

interface Pair {
  g: THREE.Group;
  guards: Rig<GuardAnim>[];
  blobs: THREE.Mesh[];
  platter: THREE.Object3D;
  food: THREE.Object3D | null;
  /** what is on the platter */
  kind: FoodKind | null;
  state: 'below' | 'rise' | 'walk' | 'wait' | 'cheer' | 'back' | 'sink';
  t: number;
  delay: number;
  /** client: the host's pair (position, heading) played back */
  track: NetTrack<null> | null;
}

const PALM_R = 2.6;
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const netPose: NetPose = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0 };
const feedPose: NetPose = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0 };
const pairPose: NetPose = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0 };
/** snapshot layout: where the hands' and the pairs' records start */
const NS_HAND = 9, NS_MARK = 21, NS_PAIR = 25;

export class FeastKing3 implements Netted {
  who = 'king' as const;
  rig: KingRig;
  root = new THREE.Group();
  anim: KingAnim;
  hands: [FHand, FHand];
  pairs: Pair[] = [];
  snacks: Snack[] = [];
  hatch: THREE.Group;
  hatchLid: THREE.Group;
  hatchOpen = 0;
  t = 0; talk = 0; chewT = 0;
  /** set by cutscenes: the King stares at the hero */
  noticed = false;
  /** while false the snack hand never swats the hero (e.g. during the intro) */
  dangerous = true;
  /** cutscene hook: force the snack hand to grab this snack next */
  forceSnack: Snack | null = null;
  tableY: number;
  hatchPos: THREE.Vector3;
  servePos: THREE.Vector3;
  private mouthPos = new THREE.Vector3();
  private lookTarget = new THREE.Vector3();
  /** snack-hand telegraph fill (−1 = hidden) */
  private markerK = -1;
  // ── co-op ──
  netId = 0;
  /** the palm lands on clients when the playback gets there */
  netTimed = ['palm'];
  /** barks are anchored to his head */
  get netRoot() { return this.rig.head; }
  private L: Level3D;
  /** client: the host's snapshots played back — the snack hand (x y z) carries the whole record; the feeding hand */
  private track: NetTrack<number[]> | null = null;
  private feedTr: NetTrack<null> | null = null;
  /** client: the host's palm landed (its event) before my copy's drop did: swat when mine lands */
  private swatDue: { at: THREE.Vector3; ty: number; d: boolean } | null = null;

  constructor(L: Level3D, o: { x: number; seatY: number; tableY: number; hatch: THREE.Vector3; serve: THREE.Vector3; snacks: [number, number, FoodKind][] }) {
    this.L = L;
    this.tableY = o.tableY;
    this.hatchPos = o.hatch.clone();
    this.servePos = o.serve.clone();
    this.rig = createKing();
    this.root.add(this.rig.root);
    this.root.position.set(o.x, o.seatY, 0);
    this.root.rotation.y = -Math.PI / 2; // faces −X, down the table
    L.scene.add(this.root);
    const ty = o.tableY;
    this.hands = [new FHand(new THREE.Vector3(o.x - 13.5, ty + 0.05, -6.2)), new FHand(new THREE.Vector3(o.x - 13.5, ty + 0.05, 6.2))];
    for (const h of this.hands) L.scene.add(h.marker);
    this.anim = {
      eye: 0.45, mouth: 0, anger: 0, look: { x: 0, y: -0.3 }, dizzy: 0, chew: 0.5, slump: 0.12, stand: 0, flash: 0, talk: 0,
      hands: [
        { pos: new THREE.Vector3(), pose: 'rest', glow: 0, flash: 0 },
        { pos: new THREE.Vector3(), pose: 'rest', glow: 0, flash: 0 },
      ],
    };
    // snacks on plates near the King (his left hand keeps grabbing them)
    for (const [x, z, kind] of o.snacks) {
      const s: Snack = { at: new THREE.Vector3(x, ty, z), kind, obj: null, respawn: 0 };
      this.spawnSnack(L, s);
      this.snacks.push(s);
    }
    // the kitchen hatch in the tabletop
    this.hatch = new THREE.Group();
    this.hatch.position.copy(this.hatchPos);
    const hole = mesh(new THREE.PlaneGeometry(3.2, 3.2).rotateX(-Math.PI / 2), mat('#1a0c08'), { cast: false });
    hole.position.y = 0.02;
    this.hatch.add(hole);
    const frame = mat('#6a3a1e');
    for (const [w, d, x, z] of [[3.6, 0.3, 0, -1.75], [3.6, 0.3, 0, 1.75], [0.3, 3.2, -1.75, 0], [0.3, 3.2, 1.75, 0]] as const) {
      const b = mesh(new THREE.BoxGeometry(w, 0.12, d), frame); b.position.set(x, 0.06, z); this.hatch.add(b);
    }
    this.hatchLid = new THREE.Group();
    this.hatchLid.position.set(-1.6, 0.08, 0);
    const lid = mesh(new THREE.BoxGeometry(3.2, 0.16, 3.2), mat('#a8683a'));
    lid.position.set(1.6, 0, 0);
    this.hatchLid.add(lid);
    for (const z of [-0.8, 0.8]) { const st = mesh(new THREE.BoxGeometry(3.0, 0.05, 0.3), mat('#7a4a28')); st.position.set(1.6, 0.1, z); this.hatchLid.add(st); }
    const ring = mesh(new THREE.TorusGeometry(0.3, 0.07, 8, 16), mat('#c8a040')); ring.rotation.x = Math.PI / 2; ring.position.set(2.8, 0.12, 0); this.hatchLid.add(ring);
    this.hatch.add(this.hatchLid);
    L.scene.add(this.hatch);
    // two pairs of servants with platters, half a cycle apart
    for (let i = 0; i < 2; i++) this.pairs.push(this.makePair(L, i * 9));
    this.syncRig(0);
    // co-op: made after the build on every machine → a fixed id everywhere
    L.nl?.add(this, NET_ID);
  }

  private spawnSnack(L: Level3D, s: Snack) {
    const f = createFood(s.kind, 0.55);
    f.position.copy(s.at).setY(s.at.y + 0.42);
    f.rotation.y = rand(0, Math.PI * 2);
    L.scene.add(f);
    s.obj = f;
  }

  private makePair(L: Level3D, delay: number): Pair {
    const g = new THREE.Group();
    const guards: Rig<GuardAnim>[] = [];
    const blobs: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const r = createGuard('feeder');
      const plate = r.root.getObjectByName('plate');
      if (plate) plate.scale.setScalar(0.0001); // they carry the big platter together instead
      r.root.position.set(0, 0, side * 1.5);
      r.root.scale.setScalar(1.6);
      g.add(r.root);
      guards.push(r);
      const bl = makeBlob(0.55);
      L.scene.add(bl);
      blobs.push(bl);
    }
    const platter = createPlatter(1.2);
    platter.position.set(0, 2.55, 0);
    platter.rotation.y = Math.PI / 2; // long axis along the walk: one servant in front, one behind
    g.add(platter);
    g.position.copy(this.hatchPos).setY(this.tableY - 2.4);
    g.visible = false;
    L.scene.add(g);
    return { g, guards, blobs, platter, food: null, kind: null, state: 'below', t: 0, delay, track: null };
  }

  /** put a dish on a pair's platter */
  private serveFood(p: Pair, kind: FoodKind) {
    p.food = createFood(kind, 0.85); p.food.position.set(0, PLATTER_TOP, 0); p.food.scale.multiplyScalar(1 / 1.2 * 1.1); p.platter.add(p.food);
    p.kind = kind;
  }

  /** for the intro: a pair of servants is already halfway to the King with a platter */
  primeFeeding() {
    if (!this.L.authority) return; // co-op client: the host's snapshot brings it
    const p = this.pairs[0];
    if (!p.food) this.serveFood(p, 'drumstick');
    p.state = 'walk'; p.t = 1; p.g.visible = true;
    p.g.position.lerpVectors(this.hatchPos, this.servePos, 0.62).setY(this.tableY);
    p.g.rotation.y = Math.atan2(this.servePos.x - this.hatchPos.x, this.servePos.z - this.hatchPos.z);
    this.hands[1].set('rest'); this.hands[1].t = 1;
  }

  mouth(out = new THREE.Vector3()) { return this.rig.mouthAnchor.getWorldPosition(out); }
  face(out = new THREE.Vector3()) { return this.rig.faceAnchor.getWorldPosition(out); }

  update(L: Level3D, dt: number) {
    if (!L.authority) { this.puppet(L, dt); return; }
    this.t += dt;
    this.talk = Math.max(0, this.talk - dt * 3);
    this.chewT = Math.max(0, this.chewT - dt);
    this.mouth(this.mouthPos);
    for (const p of this.pairs) this.updatePair(L, p, dt);
    this.updateFeedHand(L, this.hands[1], dt);
    this.updateSnackHand(L, this.hands[0], dt);
    for (const s of this.snacks) (s.obj?.userData.update as ((dt: number) => void) | undefined)?.(dt);
    for (const s of this.snacks) if (!s.obj) { s.respawn -= dt; if (s.respawn <= 0) { this.spawnSnack(L, s); L.fx.emit(s.at.clone().setY(s.at.y + 0.8), { count: 10, speed: [1, 2.5], life: [0.3, 0.6], size: [0.25, 0.5], colors: ['#ffffff', '#ffe8c8'], drag: 3 }); } }
    this.updateHatch(dt);
    // face & body
    const a = this.anim;
    const busy = this.hands.find((h) => h.state === 'hover' || h.state === 'reach' || h.state === 'drop');
    if (this.noticed) { const h = L.nl ? L.targetFor(this.root.position) : L.player; this.lookTarget.copy(h.pos).setY(h.pos.y + 0.6); }
    else if (busy) this.lookTarget.copy(busy.target);
    else if (this.hands.some((h) => h.state === 'toMouth' || h.state === 'eat')) this.lookTarget.copy(this.mouthPos).add(tmp.set(-6, -3, 0));
    else this.lookTarget.set(this.root.position.x - 30, this.tableY, Math.sin(this.t * 0.3) * 8);
    this.root.updateMatrixWorld();
    const lt = this.root.worldToLocal(tmp.copy(this.lookTarget));
    const headY = 21;
    const dd = Math.max(4, Math.hypot(lt.x, lt.z));
    a.look.x = damp(a.look.x, clamp(-lt.x / dd * 2.2, -1, 1), 5, dt);
    a.look.y = damp(a.look.y, clamp((lt.y - headY) / dd * 1.6, -1, 1), 5, dt);
    const eating = this.hands.some((h) => h.state === 'eat');
    a.eye = damp(a.eye, this.noticed ? 1 : busy ? 0.72 : eating ? 0.25 : 0.48, 6, dt);
    a.anger = damp(a.anger, this.noticed ? 0.55 : 0, 4, dt);
    a.chew = damp(a.chew, this.chewT > 0 ? 1 : 0.25, 5, dt);
    const opening = this.hands.some((h) => h.state === 'toMouth' && h.t > 0.55);
    a.mouth = damp(a.mouth, opening ? 0.95 : eating ? 0.3 : 0, 10, dt);
    // lean forward a little when reaching far down the table
    let lean = 0.12;
    for (const h of this.hands) lean = Math.max(lean, clamp((this.root.position.x - 14 - h.pos.x) / 22, 0, 1) * 0.42);
    a.slump = damp(a.slump, this.noticed ? 0.05 : lean, 3, dt);
    this.syncRig(dt);
  }

  /** hatch lid follows the servants */
  private updateHatch(dt: number) {
    const want = this.pairs.some((p) => p.state === 'rise' || p.state === 'sink' || (p.state === 'walk' && p.t < 0.6) || (p.state === 'back' && this.distXZ(p.g.position, this.hatchPos) < 1.5)) ? 1 : 0;
    this.hatchOpen = damp(this.hatchOpen, want, 6, dt);
    this.hatchLid.rotation.z = this.hatchOpen * 1.9;
  }

  syncRig(dt: number) {
    const a = this.anim;
    a.talk = this.talk > 0 ? Math.abs(Math.sin(this.t * 14)) : 0;
    this.root.updateMatrixWorld();
    this.hands.forEach((h, i) => {
      a.hands[i].pos.copy(this.root.worldToLocal(tmp2.copy(h.pos)));
      a.hands[i].pose = h.pose;
      a.hands[i].glow = 0; a.hands[i].flash = 0;
    });
    this.rig.update(dt, a);
  }

  private distXZ(a: THREE.Vector3, b: THREE.Vector3) { return Math.hypot(a.x - b.x, a.z - b.z); }

  // ── servants ──
  private updatePair(L: Level3D, p: Pair, dt: number) {
    p.t += dt;
    const walkSpeed = 2.5;
    const H = this.hatchPos, S = this.servePos;
    let gs: GuardAnim['state'] = 'carry', spd = 0;
    switch (p.state) {
      case 'below':
        p.g.visible = false;
        if (p.t > p.delay) {
          p.delay = 0.6;
          if (!p.food) this.serveFood(p, choose<FoodKind>(['drumstick', 'ham', 'pie', 'cakeSlice']));
          p.state = 'rise'; p.t = 0; p.g.visible = true;
          p.g.position.copy(H).setY(this.tableY - 2.4);
          p.g.rotation.y = Math.atan2(S.x - H.x, S.z - H.z);
        }
        break;
      case 'rise':
        p.g.position.y = lerp(this.tableY - 2.4, this.tableY, clamp(p.t / 0.9, 0, 1));
        if (p.t > 0.9) { p.state = 'walk'; p.t = 0; }
        break;
      case 'walk': {
        spd = 1;
        tmp.copy(S).sub(p.g.position).setY(0);
        const d = tmp.length();
        if (d < 0.1) { p.state = 'wait'; p.t = 0; break; }
        p.g.position.addScaledVector(tmp.normalize(), Math.min(d, walkSpeed * dt));
        p.g.rotation.y = Math.atan2(tmp.x, tmp.z);
        break;
      }
      case 'wait':
        // the King's right hand comes for the food
        if (p.food && this.hands[1].state === 'rest' && this.hands[1].t > 0.4 && !this.hands[1].food) {
          const h = this.hands[1];
          p.platter.getWorldPosition(h.target);
          h.target.y += 0.25;
          h.set('reach');
        }
        if (!p.food) { p.state = 'cheer'; p.t = 0; }
        break;
      case 'cheer':
        gs = 'cheer';
        if (p.t > 1.1) { p.state = 'back'; p.t = 0; }
        break;
      case 'back': {
        spd = 1;
        tmp.copy(H).sub(p.g.position).setY(0);
        const d = tmp.length();
        if (d < 0.1) { p.state = 'sink'; p.t = 0; break; }
        p.g.position.addScaledVector(tmp.normalize(), Math.min(d, walkSpeed * 1.15 * dt));
        p.g.rotation.y = Math.atan2(tmp.x, tmp.z);
        break;
      }
      case 'sink':
        p.g.position.y = lerp(this.tableY, this.tableY - 2.4, clamp(p.t / 0.8, 0, 1));
        if (p.t > 0.8) { p.state = 'below'; p.t = 0; p.delay = rand(2.5, 4); }
        break;
    }
    this.pairVisuals(L, p, dt, gs, spd);
  }

  /** servant rigs, their shadows, and their shove (victim-side: only ever my own hero) */
  private pairVisuals(L: Level3D, p: Pair, dt: number, gs: GuardAnim['state'], spd: number) {
    for (let i = 0; i < p.guards.length; i++) {
      const r = p.guards[i];
      r.update(dt, { state: gs, speed: spd, flash: 0 });
      const bl = p.blobs[i];
      r.root.getWorldPosition(tmp);
      bl.visible = p.g.visible && p.g.position.y > this.tableY - 0.3;
      bl.position.set(tmp.x, this.tableY + 0.04, tmp.z);
      // servants shove the hero aside (they don't hurt him)
      const pl = L.player;
      if (bl.visible && !pl.dead && Math.abs(pl.pos.y - this.tableY) < 1.2) {
        const dx = pl.pos.x - tmp.x, dz = pl.pos.z - tmp.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.4 && d > 0.001) { pl.body.vel.x += (dx / d) * 9; pl.body.vel.z += (dz / d) * 9; pl.knockT = Math.max(pl.knockT, 0.12); }
      }
    }
  }

  // ── right hand: takes the food from the servants and eats it ──
  private updateFeedHand(L: Level3D, h: FHand, dt: number) {
    h.t += dt;
    switch (h.state) {
      case 'rest':
        this.restPose(h, dt);
        break;
      case 'reach':
        this.moveTo(h, tmp.copy(h.target).setY(h.target.y + 4), 5, dt);
        h.pose = 'open';
        if (h.t > 0.9) h.set('drop');
        break;
      case 'drop':
        this.moveTo(h, h.target, 9, dt);
        h.pose = 'open';
        if (h.t > 0.35) {
          const pair = this.pairs.find((p) => p.state === 'wait' && p.food);
          if (pair && pair.food) {
            pair.platter.remove(pair.food); pair.food.scale.multiplyScalar(1.2); L.scene.add(pair.food); h.food = pair.food; pair.food = null;
            h.code = 10 + FOODS.indexOf(pair.kind ?? 'drumstick'); pair.kind = null;
            audio.sfx('grab', { volume: 0.5, pitch: 0.7 });
          }
          h.set('grab');
        }
        break;
      case 'grab':
        h.pose = 'grab';
        this.moveTo(h, tmp.copy(h.target).setY(h.target.y + 1.5), 6, dt);
        if (h.t > 0.3) h.set('toMouth');
        break;
      case 'toMouth':
        h.pose = 'grab';
        this.moveTo(h, tmp.copy(this.mouthPos).add(tmp2.set(-4.2, -2.6, 0)), 3.2, dt);
        if (h.t > 1.15) { h.set('eat'); this.chomp(L, h); }
        break;
      case 'eat':
        h.pose = 'rest';
        this.moveTo(h, tmp.copy(this.mouthPos).add(tmp2.set(-5, -5, 1)), 3, dt);
        if (h.t > 0.6) h.set('back');
        break;
      case 'back':
        this.restPose(h, dt);
        if (h.t > 0.9) h.set('rest');
        break;
      default: h.set('rest');
    }
    this.carry(h, dt);
  }

  /** host: which snack the hand goes for — usually the one nearest to a hero on the table */
  private pickSnack(L: Level3D, avail: Snack[]): Snack {
    if (!L.nl) {
      const pl = L.player;
      const nearHero = avail.slice().sort((a, b) => this.distXZ(a.at, pl.pos) - this.distXZ(b.at, pl.pos))[0];
      const heroClose = Math.abs(pl.pos.y - this.tableY) < 2 && this.distXZ(nearHero.at, pl.pos) < 9;
      return heroClose && Math.random() < 0.7 ? nearHero : choose(avail);
    }
    // co-op: the snack closest to any hero up on the table
    let best: Snack | null = null, bd = Infinity;
    for (const h of L.alivePlayers()) {
      if (Math.abs(h.pos.y - this.tableY) >= 2) continue;
      for (const s of avail) { const d = this.distXZ(s.at, h.pos); if (d < bd) { bd = d; best = s; } }
    }
    return best && bd < 9 && Math.random() < 0.7 ? best : choose(avail);
  }

  // ── left hand: snatches snacks from the plates; swats whoever is underneath ──
  private updateSnackHand(L: Level3D, h: FHand, dt: number) {
    h.t += dt;
    let markerK = -1;
    switch (h.state) {
      case 'rest':
        this.restPose(h, dt);
        h.wait -= dt;
        if ((h.wait <= 0 && !(L.nl ? L.worldCut : L.inCutscene)) || this.forceSnack) {
          const avail = this.snacks.filter((s) => s.obj);
          let pick: Snack | null = this.forceSnack;
          this.forceSnack = null;
          if (!pick && avail.length) pick = this.pickSnack(L, avail);
          if (pick) {
            h.snack = pick;
            h.target.copy(pick.at);
            // co-op: a friend's head collider is not the plate (the palm lands on the table, not on his hat)
            const heads = L.nl ? [...L.nl.remotes.values()].map((r) => r.col).filter((c) => c.active !== false) : [];
            for (const c of heads) c.active = false;
            const gy = L.phys.groundAt(pick.at.x, pick.at.z, pick.at.y + 6, 0.3);
            for (const c of heads) c.active = true;
            if (gy > -1e8) h.target.y = gy;
            h.set('reach');
            audio.sfx('whoosh', { pitch: 0.5, volume: 0.5 });
          } else h.wait = 1;
        }
        break;
      case 'reach':
        this.moveTo(h, tmp.copy(h.target).setY(h.target.y + 8), 3.2, dt);
        h.pose = 'open';
        markerK = clamp(h.t / 1.1, 0, 1) * 0.5;
        if (h.t > 1.1) { h.set('hover'); audio.sfx('warn', { volume: 0.35, pitch: 0.8 }); }
        break;
      case 'hover':
        this.moveTo(h, tmp.copy(h.target).setY(h.target.y + 7.5 + Math.sin(h.t * 30) * 0.12), 8, dt);
        h.pose = 'open';
        markerK = 0.5 + clamp(h.t / 0.75, 0, 1) * 0.5;
        if (h.t > 0.75) { h.set('drop'); h.vy = -6; }
        break;
      case 'drop': {
        h.vy -= 120 * dt;
        h.pos.y += h.vy * dt;
        h.pos.x = damp(h.pos.x, h.target.x, 10, dt); h.pos.z = damp(h.pos.z, h.target.z, 10, dt);
        h.pose = 'flat';
        markerK = 1;
        if (h.pos.y <= h.target.y + 0.05) {
          h.pos.y = h.target.y + 0.05;
          L.tcam.shake(0.35);
          audio.sfx('slam', { volume: 0.8 });
          L.fx.dust(h.pos.clone(), 14, '#f6e8d0');
          L.fx.ring(h.pos.clone().setY(this.tableY + 0.1), 4.5, '#ffffff', 0.35);
          // swat! (each machine checks its own hero)
          L.nl?.entEvent(this, 'palm', { at: h.pos, ty: h.target.y, d: this.dangerous ? 1 : 0 });
          this.swat(L, h.pos, h.target.y, this.dangerous);
          const s = h.snack;
          if (s && s.obj) { (s.obj.userData.poke as ((k: number) => void) | undefined)?.(1); h.food = s.obj; h.code = this.snacks.indexOf(s); s.obj = null; s.respawn = rand(5, 8); }
          h.set('grab');
        }
        break;
      }
      case 'grab':
        h.pose = 'grab';
        if (h.t > 0.35) {
          if (h.food) h.set('toMouth');
          else { L.bark(this.rig.head, 'Хм? Пусто...', 1.2, 9); this.talk = 0.3; h.set('back'); }
        }
        break;
      case 'toMouth':
        h.pose = 'grab';
        this.moveTo(h, tmp.copy(this.mouthPos).add(tmp2.set(-4.2, -2.6, 0)), 3, dt);
        if (h.t > 1.2) { h.set('eat'); this.chomp(L, h); }
        break;
      case 'eat':
        h.pose = 'rest';
        this.moveTo(h, tmp.copy(this.mouthPos).add(tmp2.set(-5, -5, -1)), 3, dt);
        if (h.t > 0.6) h.set('back');
        break;
      case 'back':
        this.restPose(h, dt);
        if (h.t > 0.9) { h.set('rest'); h.wait = rand(2.2, 4.2); }
        break;
    }
    this.carry(h, dt);
    this.markerK = markerK;
    this.drawMarker(h, markerK);
  }

  /** the palm landed at `at`: my own hero underneath gets swatted */
  private swat(L: Level3D, at: THREE.Vector3, ty: number, dangerous: boolean) {
    const pl = L.player;
    if (!dangerous || pl.dead || Math.abs(pl.pos.y - ty) >= 1.8 || this.distXZ(pl.pos, at) >= PALM_R + 0.4) return;
    tmp.copy(pl.pos).sub(at).setY(0);
    if (tmp.lengthSq() < 0.01) tmp.set(-1, 0, 0);
    tmp.normalize();
    const knock = new THREE.Vector3(tmp.x * 12, 8, tmp.z * 12);
    localFx(L, () => {
      if (pl.hurt(L, 1, at.clone(), knock)) {
        L.bark(this.rig.head, choose(['Хм? Что-то мелкое шуршит...', 'Это ещё что за крошка?..', 'Ммм? Изюминка?']), 1.8, 9);
        this.talk = 0.5;
      }
    });
  }

  /** glowing ring + fill where the palm will land */
  private drawMarker(h: FHand, markerK: number) {
    if (markerK >= 0) {
      h.marker.visible = true;
      h.marker.position.set(h.target.x, h.target.y + 0.08, h.target.z);
      h.marker.scale.setScalar(PALM_R + 0.4);
      h.fill.scale.setScalar(Math.max(0.02, markerK));
      h.ringM.opacity = 0.85 + (markerK > 0.6 ? Math.sin(this.t * 30) * 0.15 : 0);
      h.fillM.opacity = 0.25 + markerK * 0.25;
    } else h.marker.visible = false;
  }

  private restPose(h: FHand, dt: number) {
    tmp.copy(h.rest);
    tmp.y += 0.2 + Math.sin(this.t * 1.4 + h.rest.z) * 0.12;
    this.moveTo(h, tmp, 3.5, dt);
    h.pose = 'rest';
  }

  private moveTo(h: FHand, p: THREE.Vector3, k: number, dt: number) {
    h.pos.x = damp(h.pos.x, p.x, k, dt); h.pos.y = damp(h.pos.y, p.y, k, dt); h.pos.z = damp(h.pos.z, p.z, k, dt);
  }

  /** food sits in the closed hand */
  private carry(h: FHand, dt: number) {
    if (!h.food) return;
    h.food.position.copy(h.pos).add(tmp.set(-1.7, 1.6, 0));
    h.food.rotation.z = damp(h.food.rotation.z, 0.6, 4, dt);
  }

  private chomp(L: Level3D, h: FHand) {
    const f = h.food;
    h.food = null; h.code = -1;
    if (f) L.scene.remove(f);
    audio.sfx('chomp'); audio.sfx('chomp', { pitch: 0.8, volume: 0.6 });
    this.chewT = 2.2;
    L.fx.chunks(this.mouthPos.clone(), 14, ['#c8823a', '#f6d8a0', '#a8402a'], this.tableY, [0.15, 0.35]);
    if (Math.random() < 0.35 && !this.noticed) { L.bark(this.rig.head, choose(['Ням!', 'Ммм... ещё!', 'Вкуснотища!', 'Ам!']), 1.1, 9); this.talk = 0.3; }
  }

  // ───────────────────────── co-op replication ─────────────────────────
  /**
   * [eye, mouth, anger, lookX, lookY, chew, slump, talk, flags(noticed 1 | dangerous 2),
   *  (state, pose, x, y, z, food) × 2 hands, markerK, tx, ty, tz,
   *  (state, x, y, z, rotY, platterFood) × 2 pairs, snackMask]
   */
  netSnap(): number[] {
    const a = this.anim;
    const out = [a.eye, a.mouth, a.anger, a.look.x, a.look.y, a.chew, a.slump, this.talk, (this.noticed ? 1 : 0) | (this.dangerous ? 2 : 0)];
    for (const h of this.hands) out.push(HSTATES.indexOf(h.state), POSES.indexOf(h.pose), h.pos.x, h.pos.y, h.pos.z, h.food ? h.code : -1);
    const h0 = this.hands[0];
    out.push(this.markerK, h0.target.x, h0.target.y, h0.target.z);
    for (const p of this.pairs) out.push(PSTATES.indexOf(p.state), p.g.position.x, p.g.position.y, p.g.position.z, p.g.rotation.y, p.food && p.kind ? FOODS.indexOf(p.kind) : -1);
    let mask = 0;
    this.snacks.forEach((s, i) => { if (s.obj) mask |= 1 << i; });
    out.push(mask);
    return out;
  }

  /** client: a snapshot taken at host time t, played back at NetLevel.playT (puppet) */
  netApply(v: number[], t?: number) {
    if (t === undefined) return;
    const h0 = NS_HAND, h1 = NS_HAND + 6;
    (this.track ??= new NetTrack<number[]>(150, 8)).push(t, v[h0 + 2], v[h0 + 3], v[h0 + 4], 0, v);
    (this.feedTr ??= new NetTrack<null>(150, 8)).push(t, v[h1 + 2], v[h1 + 3], v[h1 + 4], 0, null);
    // (the intro puts a pair half-way down the table at once: that jump is stepped, not walked)
    this.pairs.forEach((p, k) => { const i = NS_PAIR + k * 6; (p.track ??= new NetTrack<null>(20)).push(t, v[i + 1], v[i + 2], v[i + 3], v[i + 4], null); });
  }

  /** client: a snapshot's discrete fields, as the playback passes it */
  private netFields(v: number[]) {
    const L = this.L;
    this.talk = Math.max(this.talk, v[7]);
    const fl = v[8];
    this.noticed = !!(fl & 1); this.dangerous = !!(fl & 2);
    // hands first: a snack / dish the hand just took moves into it instead of vanishing
    this.hands.forEach((h, k) => {
      const i = NS_HAND + k * 6;
      const st = HSTATES[v[i]] ?? 'rest';
      if (st !== h.state) {
        h.set(st);
        // the snack palm comes down: my copy falls by itself (the same fall as the host's)
        if (k === 0 && st === 'drop') { h.falling = true; h.vy = -6; }
        else h.falling = false;
      }
      h.pose = POSES[v[i + 1]] ?? 'rest';
      this.netHandFood(L, h, v[i + 5]);
    });
    this.pairs.forEach((p, k) => {
      const i = NS_PAIR + k * 6;
      const st = PSTATES[v[i]] ?? 'below';
      if (st !== p.state) { p.state = st; p.t = 0; }
      this.netPlatter(p, v[i + 5]);
    });
    const mask = v[NS_PAIR + this.pairs.length * 6];
    this.snacks.forEach((s, k) => {
      const on = !!(mask & (1 << k));
      if (on && !s.obj) this.spawnSnack(L, s);
      else if (!on && s.obj) { L.scene.remove(s.obj); s.obj = null; }
    });
  }

  /** client: the host's hand holds `code` now */
  private netHandFood(L: Level3D, h: FHand, code: number) {
    if (code === h.code && (code < 0) === !h.food) return;
    if (h.food) { L.scene.remove(h.food); h.food = null; }
    h.code = code;
    if (code < 0) return;
    if (code < 10) {
      const s = this.snacks[code];
      if (!s) return;
      if (s.obj) { (s.obj.userData.poke as ((k: number) => void) | undefined)?.(1); h.food = s.obj; s.obj = null; }
      else { h.food = createFood(s.kind, 0.55); L.scene.add(h.food); }
    } else {
      const kind = FOODS[code - 10];
      if (!kind) return;
      const pair = this.pairs.find((p) => p.food && p.kind === kind);
      if (pair && pair.food) { pair.platter.remove(pair.food); pair.food.scale.multiplyScalar(1.2); L.scene.add(pair.food); h.food = pair.food; pair.food = null; pair.kind = null; }
      else { h.food = createFood(kind, 0.85); h.food.scale.multiplyScalar(1.1); L.scene.add(h.food); }
    }
    h.food.position.copy(h.pos).add(tmp.set(-1.7, 1.6, 0));
  }

  /** client: the host's platter carries `k` (−1 = empty) */
  private netPlatter(p: Pair, k: number) {
    const kind = k >= 0 ? FOODS[k] ?? null : null;
    if (kind === p.kind && !!p.food === !!kind) return;
    if (p.food) { p.platter.remove(p.food); p.food = null; }
    p.kind = null;
    if (kind) this.serveFood(p, kind);
  }

  netEvent(L: Level3D, ev: string, d: { at?: THREE.Vector3; ty?: number; d?: number }) {
    if (ev !== 'palm' || L.authority || !d.at) return;
    // the palm hit the table on the host at this point of the playback: check my own hero there — when my copy of the
    // palm lands, if it is still on its way down
    const sw = { at: d.at, ty: d.ty ?? d.at.y - 0.05, d: !!d.d };
    if (this.hands[0].falling) this.swatDue = sw; else this.swat(L, sw.at, sw.ty, sw.d);
  }

  /** client: show the host's King as he was at the playback time */
  private puppet(L: Level3D, dt: number) {
    this.t += dt;
    this.talk = Math.max(0, this.talk - dt * 3);
    this.mouth(this.mouthPos);
    const play = L.nl?.playT ?? -Infinity;
    const tr = this.track;
    const got = !!tr && tr.eval(play, dt, netPose);
    if (tr && got) {
      tr.passed(play, (v) => this.netFields(v));
      const c = tr.cur!, n = tr.next;
      // his face between the two snapshots around the playback
      const a = this.anim;
      a.eye = tr.lerp(0); a.mouth = tr.lerp(1); a.anger = tr.lerp(2); a.look.x = tr.lerp(3); a.look.y = tr.lerp(4);
      a.chew = tr.lerp(5); a.slump = tr.lerp(6);
      // the snack telegraph: grows between snapshots of one aim; a new aim (or none) is taken as it comes
      const both = c[NS_MARK] >= 0 && !!n && n[NS_MARK] >= 0;
      this.markerK = both ? tr.lerp(NS_MARK) : c[NS_MARK];
      if (both) this.hands[0].target.set(tr.lerp(NS_MARK + 1), tr.lerp(NS_MARK + 2), tr.lerp(NS_MARK + 3));
      else this.hands[0].target.set(c[NS_MARK + 1], c[NS_MARK + 2], c[NS_MARK + 3]);
    }
    for (const p of this.pairs) {
      p.t += dt;
      p.g.visible = p.state !== 'below';
      if (p.track && p.track.eval(play, dt, pairPose)) { p.g.position.copy(pairPose.pos); p.g.rotation.y = pairPose.yaw; }
      const walking = p.state === 'walk' || p.state === 'back';
      this.pairVisuals(L, p, dt, p.state === 'cheer' ? 'cheer' : 'carry', walking ? 1 : 0);
    }
    this.puppetHand(L, this.hands[0], got ? netPose : null, dt);
    const fed = !!this.feedTr && this.feedTr.eval(play, dt, feedPose);
    this.puppetHand(L, this.hands[1], fed ? feedPose : null, dt);
    this.drawMarker(this.hands[0], this.markerK);
    this.hands[1].marker.visible = false;
    for (const s of this.snacks) (s.obj?.userData.update as ((dt: number) => void) | undefined)?.(dt);
    this.updateHatch(dt);
    this.syncRig(dt);
  }

  /** client: a hand where the host's was at the playback time — except the snack palm's drop, which my copy plays */
  private puppetHand(L: Level3D, h: FHand, pose: NetPose | null, dt: number) {
    h.t += dt;
    let follow = false;
    if (h.falling) {
      // (on the playback's clock: the palm lands when the host's did in the played-back snapshots)
      const pdt = L.nl?.playDt ?? dt;
      h.vy -= 120 * pdt;
      h.pos.y += h.vy * pdt;
      h.pos.x = damp(h.pos.x, h.target.x, 10, dt); h.pos.z = damp(h.pos.z, h.target.z, 10, dt);
      h.pose = 'flat';
      if (h.pos.y <= h.target.y + 0.05) { h.pos.y = h.target.y + 0.05; h.falling = false; }
    } else if (h.state === 'drop' && h === this.hands[0] && !h.following) {
      // my copy's palm is down on the table: it stays there until the host's lifts
    } else if (pose) {
      if (!h.following) h.off.copy(h.pos).sub(pose.pos);
      h.off.multiplyScalar(Math.exp(-dt / 0.12));
      h.pos.copy(pose.pos).add(h.off);
      follow = true;
    }
    h.following = follow;
    // the host's palm already landed: my hero is checked once my copy is down too (or its drop was cut short)
    const sw = this.swatDue;
    if (sw && h === this.hands[0] && !h.falling) { this.swatDue = null; this.swat(L, sw.at, sw.ty, sw.d); }
    this.carry(h, dt);
  }
}

import * as THREE from 'three';
import type { Built } from '../physics/types';
import * as O from '../world/outdoor';
import { bmat } from '../world/kit';
import { noOutline } from '../gfx';
import { NIGHT as PAL } from '../game/arc/town/palette';
import * as T from '../game/arc/town/props';
import { createHeroModel } from '../models/heroes';
import type { HeroAnim, HeroState, HeroExpr } from '../models/hero';
import type { HeroRig } from '../models/hero';
import { createBat, type VRig } from '../game/arc/vampires/models';
import { profile, type HeroKind } from '../../net/profile';
import { FX3 } from '../fx';

/**
 * The main menu's backdrop after the prologue: Пастильное королевство at night under the Алая луна — marshmallow
 * towers, gingerbread houses, lit marmalade lamps, bats crossing the moon, and the four heroes on the square (mine in my
 * own look). Decoration only: the hub's props without its colliders, no physics, a few lamp lights.
 */

const MOON = new THREE.Vector3(0.34, 0.42, -0.84).normalize();

interface Figure { kind: HeroKind; rig: HeroRig; base: { state: HeroState; expr: HeroExpr }; emote: { state: HeroState; t: number } | null; next: number }
interface Bat { rig: VRig; root: THREE.Group; c: THREE.Vector3; r: number; w: number; ph: number; tilt: number }

export class MenuTown {
  scene = new THREE.Scene();
  fx = new FX3();
  private built: Built[] = [];
  private figs: Figure[] = [];
  private bats: Bat[] = [];
  private t = 0;

  constructor() {
    const s = this.scene;
    s.background = new THREE.Color(PAL.bg);
    s.fog = new THREE.Fog('#2a1838', 34, 150);
    s.add(new THREE.HemisphereLight('#8a7ad0', '#2a1838', 0.9));
    const moon = new THREE.DirectionalLight('#ff9e9e', 1.25);
    moon.position.copy(MOON).multiplyScalar(60);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    const sc = moon.shadow.camera; sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.far = 160;
    moon.shadow.bias = -0.0006;
    s.add(moon, moon.target);

    // the Алая луна: the town palette's night sky with a big red moon
    s.add(O.skyDome(PAL.sky, MOON, { sunSize: 0.0, moonDir: MOON, moonSize: 0.11 }).mesh);
    const glare = O.sunGlare('#ff5a4a', 70, 0.4);
    glare.position.copy(MOON).multiplyScalar(220);
    s.add(glare);
    const az = Math.atan2(MOON.x, -MOON.z);
    const hl = PAL.hills;
    s.add(O.hillRings([
      { r: 120, base: -6, amp: 9, seed: 41, color: hl[0].color, rim: hl[0].rim, haze: hl[0].haze, bumps: 3, seg: 600 },
      { r: 190, base: -2, amp: 20, seed: 42, color: hl[1].color, rim: hl[1].rim, haze: hl[1].haze, bumps: 2, seg: 600 },
      { r: 280, base: 4, amp: 36, seed: 43, color: hl[2].color, rim: hl[2].rim, haze: hl[2].haze, seg: 500, notch: 0.3 },
    ], az, '#2a2a5a'));

    // ground: cobbles out to the hills, the plaza disc under the heroes
    const ground = new THREE.Mesh(new THREE.CircleGeometry(130, 48).rotateX(-Math.PI / 2), bmat(PAL.cobble[1]));
    ground.position.y = -0.04; ground.receiveShadow = true;
    s.add(ground);
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(9, 40).rotateX(-Math.PI / 2), bmat(PAL.plaza[0]));
    plaza.position.set(-1, -0.02, -5); s.add(plaza);
    for (const m of [ground, plaza]) noOutline(m);

    const pal = PAL;
    const add = (b: Built) => { this.built.push(b); s.add(b.obj); return b; };
    add(T.fountain({ x: -3, y: 0, z: -8, r: 3.2, pal }));
    // the palace skyline behind the square
    add(T.marshmallowTower({ x: -2, y: 0, z: -30, r: 4, h: 20, roof: pal.roofs[0], seed: 901, pal }));
    add(T.marshmallowTower({ x: -13, y: 0, z: -27, r: 2.8, h: 14.5, roof: pal.roofs[2], seed: 902, pal }));
    add(T.marshmallowTower({ x: 10, y: 0, z: -33, r: 2.6, h: 15, roof: pal.roofs[2], seed: 903, pal }));
    add(T.marshmallowTower({ x: 20, y: 0, z: -28, r: 2.1, h: 11, roof: pal.roofs[1], seed: 904, pal }));
    add(T.marshmallowTower({ x: -22, y: 0, z: -34, r: 2.2, h: 12, roof: pal.roofs[1], seed: 905, pal }));
    add(T.clockTower({ x: 21, y: 0, z: -22, r: 2.2, h: 11, pal }));
    // gingerbread rows on both sides of the square, facing it
    for (const [x, z, w, d, h, rot, seed] of [
      [-14, -6, 5, 5, 3.8, 1, 11], [-14.5, 2, 5.5, 5, 4.4, 1, 12], [-13.5, -14, 5, 5, 3.4, 1, 13],
      [17, -2, 5, 5, 4.0, 3, 21], [16.5, 6, 5, 5, 3.6, 3, 22], [-5, -19, 6, 5, 4.2, 0, 31], [5, -21, 5, 5, 3.6, 0, 32],
    ] as const) add(T.gingerHouse({ x, y: 0, z, w, d, h, rotY: rot, seed, pal }));
    for (const [x, z, kind, sc2, c] of [
      [-9, 4, 'gumdrop', 1.0, 0], [8.5, -8, 'lolly', 0.9, 2], [-10, -12, 'cotton', 1.0, 4], [11, 3, 'gumdrop', 0.9, 1], [-18, 9, 'lolly', 1.1, 3],
    ] as const) add(T.candyTree({ x, y: 0, z, s: sc2, kind, color: pal.candy[c], pal }));
    // lamps around the square: only the near ones cast light
    for (const [x, z, light] of [[-6.5, 2.5, true], [6.5, 2.5, true], [-8, -9, true], [5.5, -10, false], [-1, -15, false], [9.5, -4, false]] as const) {
      add(T.marmaladeLamp({ x, y: 0, z, light, rotY: x < 0 ? 0 : 2, pal }));
    }
    add(T.candyBench({ x: -6, y: 0, z: -3, rotY: 1, color: pal.candy[0], pal }));
    add(T.flowerBed({ x: 3.5, y: 0, z: -6.5, w: 2.6, d: 1.6, pal }));

    // the four heroes on the square (canonical looks; mine as I dressed it)
    const lineup: [HeroKind, number, number, number, HeroState, HeroExpr][] = [
      ['tosha', 1.0, 1.4, 0.15, 'idle', 'happy'],
      ['bublik', 2.4, 1.9, -0.1, 'idle', 'happy'],
      ['noki', 3.8, 1.2, -0.35, 'idle', 'normal'],
      ['pastila', -0.4, 1.0, 0.4, 'idle', 'normal'],
    ];
    for (const [kind, x, z, yaw, state, expr] of lineup) {
      const rig = createHeroModel(kind, kind === profile.kind ? profile.lookOf(kind) : undefined);
      rig.root.position.set(x, 0, z);
      rig.root.rotation.y = yaw;
      s.add(rig.root);
      this.figs.push({ kind, rig, base: { state, expr }, emote: null, next: 2 + Math.random() * 5 });
    }

    // bats circling: a flock in front of the moon, a couple low over the roofs
    for (let i = 0; i < 9; i++) {
      const rig = createBat();
      const root = new THREE.Group(); root.add(rig.root);
      const far = i < 6;
      const c = far ? MOON.clone().multiplyScalar(70).add(new THREE.Vector3(0, -6, 0)) : new THREE.Vector3(-4 + i * 4, 9, -14);
      root.scale.setScalar(far ? 5 : 2.2);
      s.add(root);
      this.bats.push({ rig, root, c, r: far ? 7 + (i % 3) * 3 : 5 + i, w: (far ? 0.35 : 0.5) * (i % 2 ? 1 : -1), ph: i * 1.7, tilt: 0.3 + (i % 3) * 0.15 });
    }
    this.scene.add(this.fx.group);
  }

  /** where the camera should be at time t (a slow sway over the square; the menu column sits on the left) */
  camera(cam: THREE.PerspectiveCamera, t: number) {
    const a = t * 0.05;
    cam.position.set(-1.2 + Math.sin(a) * 2.2, 2.3 + Math.sin(t * 0.18) * 0.25, 9.5 + Math.cos(a) * 0.8);
    cam.lookAt(1.2 + Math.sin(a * 0.7) * 0.6, 3.4, -8);
  }

  update(dt: number) {
    this.t += dt;
    const t = this.t;
    for (const b of this.built) b.update?.(t, dt);
    for (const f of this.figs) {
      f.next -= dt;
      if (!f.emote && f.next <= 0) {
        const pick: HeroState[] = f.kind === 'pastila' ? ['wave', 'lookUp'] : f.kind === 'noki' ? ['dance', 'lookUp'] : ['wave', 'cheer', 'lookUp'];
        f.emote = { state: pick[Math.floor(Math.random() * pick.length)], t: 2.4 };
        f.next = 5 + Math.random() * 6;
      }
      if (f.emote) { f.emote.t -= dt; if (f.emote.t <= 0) f.emote = null; }
      const a: HeroAnim = { state: f.emote?.state ?? f.base.state, speed: 0, attack: null, weapon: f.kind === 'tosha' ? 'sword' : 'none', flash: 0, talk: 0, expr: f.emote ? 'happy' : f.base.expr, squash: 1 };
      f.rig.update(dt, a);
    }
    for (const b of this.bats) {
      const ang = t * b.w + b.ph;
      b.root.position.set(b.c.x + Math.cos(ang) * b.r, b.c.y + Math.sin(ang * 2) * b.r * b.tilt * 0.3, b.c.z + Math.sin(ang) * b.r * 0.4);
      b.root.rotation.y = -ang + (b.w > 0 ? 0 : Math.PI);
      b.rig.update(dt, { st: 'fly', p: 0, speed: 1, flash: 0 });
    }
    // fireflies / sugar sparks drifting over the square
    if (Math.random() < 0.25) this.fx.glow.emit(new THREE.Vector3(-6 + Math.random() * 12, 0.5 + Math.random() * 3, -8 + Math.random() * 9), { count: 1, speed: [0.1, 0.35], life: [2, 4], size: [0.05, 0.1], colors: ['#ffd27a', '#ff9ab8', '#ffffff'], g: -0.15 });
    this.fx.update(dt);
  }
}

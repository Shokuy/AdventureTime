import * as THREE from 'three';
import { W, H, clamp, ease } from '../../../../engine/util';
import { rrect, text, OUT } from '../../../../art/draw';
import { basic, canvasTex, noOutline } from '../../../gfx';
import { G, grp, part, Mats } from '../../../models/kit';
import type { Level3D } from '../../level';
import { vamp } from '../vampires';
import { townProps, createFolk, TOWN_DAY, type FolkRig, type FolkAnim } from '../town';
import { drawFace } from '../town/speech';
import { girlTex } from './kingRig';

/**
 * The finale of «Замок Полночь»: the dawn after the King (the sky warms, the moon pales away), Ноки's shadow coming
 * back, Пастила's little mirror, the morning square of Пастильное королевство with the giant raspberry pie (§9.7) far
 * east of the castle, Пончик's sour letter and its card (§9.8), and a fade to black for the cut between them.
 * All of it is local to each machine (the scenes run everywhere and drive it).
 */

export const SQUARE = new THREE.Vector3(400, 0, 0);

// ───────────────────────── sky: night → dawn → day ─────────────────────────
interface SkyLook { bg: string; fog: string; fogFar: number; zen: string; hor: string; hemiS: string; hemiG: string; hemiI: number; sun: string; sunI: number; dir: [number, number, number] }
const DAWN: SkyLook = { bg: '#e8a0a0', fog: '#e8b0b0', fogFar: 230, zen: '#4a5aa8', hor: '#ffb488', hemiS: '#ffd8c8', hemiG: '#6a5070', hemiI: 1.05, sun: '#ffc890', sunI: 1.7, dir: [1, 0.3, 0.15] };
const DAY: SkyLook = {
  bg: TOWN_DAY.bg, fog: TOWN_DAY.fog[0], fogFar: TOWN_DAY.fog[2], zen: TOWN_DAY.sky.zenith, hor: TOWN_DAY.sky.horizon,
  hemiS: TOWN_DAY.hemi[0], hemiG: TOWN_DAY.hemi[1], hemiI: TOWN_DAY.hemi[2], sun: TOWN_DAY.sun.color, sunI: TOWN_DAY.sun.intensity, dir: TOWN_DAY.sun.dir,
};

export class Daybreak {
  private sky: THREE.Mesh | null = null;
  private cols: THREE.BufferAttribute | null = null;
  private from: SkyLook | null = null;
  private to: SkyLook = DAWN;
  private t = 0; private dur = 1;
  private on = false;
  constructor(private L: Level3D) {
    L.updaters.push((_t, dt) => this.update(dt));
  }
  /** the night's look → `to` over `secs` (first call takes over from the vampire kit's night) */
  go(to: 'dawn' | 'day', secs: number) {
    const L = this.L;
    const V = vamp(L);
    if (!this.on) {
      this.on = true;
      // the night's own sky / fog control steps aside
      V.night?.dispose(); V.night = null;
      const g = new THREE.SphereGeometry(470, 24, 12);
      this.cols = new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3);
      g.setAttribute('color', this.cols);
      this.sky = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false }));
      this.sky.renderOrder = -1000; this.sky.frustumCulled = false; noOutline(this.sky);
      L.scene.add(this.sky);
      this.from = this.snapNow();
    } else this.from = this.cur();
    this.to = to === 'dawn' ? DAWN : DAY;
    this.t = 0; this.dur = Math.max(0.01, secs);
    if (secs <= 0) this.t = this.dur;
    this.apply();
  }
  private snapNow(): SkyLook {
    const L = this.L;
    const fog = L.scene.fog as THREE.Fog;
    const bg = L.scene.background instanceof THREE.Color ? '#' + L.scene.background.getHexString() : '#2a0d20';
    return { bg, fog: '#' + fog.color.getHexString(), fogFar: fog.far, zen: '#12040c', hor: '#6a1a34', hemiS: '#' + L.hemi.color.getHexString(), hemiG: '#' + L.hemi.groundColor.getHexString(), hemiI: L.hemi.intensity, sun: '#' + L.sun.color.getHexString(), sunI: L.sun.intensity, dir: [...L.def.sun.dir] as [number, number, number] };
  }
  private k() { return ease.inOut(clamp(this.t / this.dur, 0, 1)); }
  private cur(): SkyLook {
    const k = this.k(), a = this.from!, b = this.to;
    const c = (x: string, y: string) => '#' + new THREE.Color(x).lerp(new THREE.Color(y), k).getHexString();
    return { bg: c(a.bg, b.bg), fog: c(a.fog, b.fog), fogFar: a.fogFar + (b.fogFar - a.fogFar) * k, zen: c(a.zen, b.zen), hor: c(a.hor, b.hor), hemiS: c(a.hemiS, b.hemiS), hemiG: c(a.hemiG, b.hemiG), hemiI: a.hemiI + (b.hemiI - a.hemiI) * k, sun: c(a.sun, b.sun), sunI: a.sunI + (b.sunI - a.sunI) * k, dir: [0, 1, 2].map((i) => a.dir[i] + (b.dir[i] - a.dir[i]) * k) as [number, number, number] };
  }
  private update(dt: number) {
    if (!this.on) return;
    if (this.t < this.dur) { this.t += dt; this.apply(); }
    if (this.sky) this.sky.position.copy(this.L.tcam.cam.position);
  }
  private apply() {
    if (!this.from || !this.sky || !this.cols) return;
    const L = this.L, s = this.cur();
    if (L.scene.background instanceof THREE.Color) L.scene.background.set(s.bg); else L.scene.background = new THREE.Color(s.bg);
    const fog = L.scene.fog as THREE.Fog;
    fog.color.set(s.fog); fog.far = s.fogFar; fog.near = Math.min(60, s.fogFar * 0.3);
    L.hemi.color.set(s.hemiS); L.hemi.groundColor.set(s.hemiG); L.hemi.intensity = s.hemiI;
    L.sun.color.set(s.sun); L.sun.intensity = s.sunI;
    L.def.sun.dir[0] = s.dir[0]; L.def.sun.dir[1] = s.dir[1]; L.def.sun.dir[2] = s.dir[2];
    const pos = this.sky.geometry.attributes.position as THREE.BufferAttribute;
    const zen = new THREE.Color(s.zen), hor = new THREE.Color(s.hor), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 470;
      c.copy(hor).lerp(zen, Math.sqrt(clamp((y + 0.05) / 0.6, 0, 1)));
      this.cols.setXYZ(i, c.r, c.g, c.b);
    }
    this.cols.needsUpdate = true;
  }
}

// ───────────────────────── a fade to black (scene cuts) ─────────────────────────
export class Fade {
  a = 0; to = 0; speed = 2;
  constructor(L: Level3D) {
    L.updaters.push((_t, dt) => { this.a += clamp(this.to - this.a, -dt * this.speed, dt * this.speed); });
    L.overlayDraw.push((ctx) => { if (this.a > 0.002) { ctx.fillStyle = `rgba(8,4,10,${this.a})`; ctx.fillRect(-2000, -2000, W + 4000, H + 4000); } });
  }
  out(secs = 0.6) { this.to = 1; this.speed = 1 / secs; return { update: () => this.a >= 0.999 }; }
  in(secs = 0.8) { this.to = 0; this.speed = 1 / secs; return { update: () => this.a <= 0.001 }; }
}

// ───────────────────────── the card of an item (§10: «Кислое письмо») ─────────────────────────
export class ItemCard {
  private t = -1; private dur = 0; private title = ''; private body = '';
  constructor(L: Level3D) {
    L.updaters.push((_t, dt) => { if (this.t >= 0) { this.t += dt; if (this.t > this.dur) this.t = -1; } });
    L.overlayDraw.push((ctx) => this.draw(ctx));
  }
  show(title: string, body: string, secs = 4) { this.title = title; this.body = body; this.t = 0; this.dur = secs; }
  private draw(ctx: CanvasRenderingContext2D) {
    if (this.t < 0) return;
    const a = clamp(Math.min(this.t * 4, (this.dur - this.t) * 3), 0, 1);
    const s = ease.outBack(clamp(this.t * 3, 0, 1));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(W / 2, 170); ctx.scale(s, s);
    rrect(ctx, -280, -70, 560, 140, 20, '#fff8d0', 5);
    // the envelope
    rrect(ctx, -250, -40, 90, 62, 6, '#ffe45a', 4);
    ctx.lineWidth = 4; ctx.strokeStyle = OUT; ctx.beginPath(); ctx.moveTo(-250, -40); ctx.lineTo(-205, -6); ctx.lineTo(-160, -40); ctx.stroke();
    ctx.fillStyle = '#9ad020'; ctx.beginPath(); ctx.arc(-205, -6, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    text(ctx, this.title, -140, -16, { size: 30, color: '#a87a10', stroke: 5 });
    ctx.font = '400 20px Pangolin, sans-serif';
    text(ctx, this.body, -140, 22, { size: 19, font: 'body', color: OUT });
    ctx.restore();
  }
}

// ───────────────────────── Ноки's shadow ─────────────────────────
/** the little shadow (a girl with a guitar): flies round, then lies down at Ноки's feet as her shadow */
export class ShadowGirl {
  fly: THREE.Mesh;
  ground: THREE.Mesh;
  constructor(L: Level3D) {
    const mat = new THREE.MeshBasicMaterial({ map: girlTex(), transparent: true, depthWrite: false, color: '#ffffff', side: THREE.DoubleSide, opacity: 0 });
    this.fly = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.8), mat);
    noOutline(this.fly); L.scene.add(this.fly);
    const gm = new THREE.MeshBasicMaterial({ map: girlTex(), transparent: true, depthWrite: false, opacity: 0, color: '#000000' });
    gm.polygonOffset = true; gm.polygonOffsetFactor = -3;
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.4).translate(0, 1.2, 0).rotateX(-Math.PI / 2), gm);
    noOutline(this.ground); L.scene.add(this.ground);
    this.fly.visible = this.ground.visible = false;
  }
  dispose() { this.fly.removeFromParent(); this.ground.removeFromParent(); }
}

// ───────────────────────── Пастила's little mirror ─────────────────────────
export function createMirror(): THREE.Group {
  const g = new THREE.Group();
  const tex = canvasTex(256, 256, (c) => {
    const gr = c.createRadialGradient(128, 110, 10, 128, 128, 128);
    gr.addColorStop(0, '#f4f8ff'); gr.addColorStop(1, '#a8b8d8');
    c.fillStyle = gr; c.fillRect(0, 0, 256, 256);
    drawFace(c, 'noki', 128, 132, 100, 0, 0, 'sad');
    c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.ellipse(80, 70, 40, 16, -0.6, 0, Math.PI * 2); c.fill();
  });
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.22, 32), new THREE.MeshBasicMaterial({ map: tex }));
  glass.position.z = 0.012;
  g.add(glass);
  const M = new Mats();
  part(g, G.torus(0.23, 0.03, 8, 32), M.get('#e8c060'), [0, 0, 0]);
  part(g, G.cyl(), M.get('#ff8ab8'), [0, -0.36, 0], [0.035, 0.26, 0.035]);
  noOutline(glass);
  return g;
}

// ───────────────────────── the giant raspberry pie ─────────────────────────
function pie(): THREE.Group {
  const g = new THREE.Group();
  const M = new Mats();
  part(g, G.cyl(), M.get('#d8963a'), [0, 0.35, 0], [2.4, 0.7, 2.4]);
  part(g, G.cyl(), M.get('#c8243a'), [0, 0.72, 0], [2.2, 0.08, 2.2]);
  for (let i = -3; i <= 3; i++) {
    part(g, G.cyl(), M.get('#e8a850'), [i * 0.6, 0.8, 0], [0.12, 4.2 * Math.sqrt(Math.max(0.05, 1 - (i * 0.6 / 2.3) ** 2)), 0.06], [Math.PI / 2, 0, 0]);
    part(g, G.cyl(), M.get('#e8a850'), [0, 0.82, i * 0.6], [0.12, 4.2 * Math.sqrt(Math.max(0.05, 1 - (i * 0.6 / 2.3) ** 2)), 0.06], [0, 0, Math.PI / 2]);
  }
  for (let i = 0; i < 18; i++) { const a = i * 2.4, r = 0.4 + (i % 6) * 0.3; part(g, G.ball(), M.get('#e8304a'), [Math.cos(a) * r, 0.92, Math.sin(a) * r], 0.14); }
  part(g, G.torus(2.35, 0.18, 8, 40), M.get('#e8a850'), [0, 0.72, 0], 1, [Math.PI / 2, 0, 0]);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
  return g;
}

// ───────────────────────── the morning square (§9.7) ─────────────────────────
export interface Folk { rig: FolkRig; g: THREE.Group; anim: FolkAnim }
export interface Square {
  /** spots of the scene (world): the table, the cast's marks, where Пончик runs in from */
  table: THREE.Vector3; marks: Record<'tosha' | 'bublik' | 'noki' | 'pastila' | 'bear', THREE.Vector3>; ponchikFrom: THREE.Vector3;
  folk: Record<'zefirych' | 'beze' | 'marmeladka' | 'ponchik', Folk>;
  letter: THREE.Group;
}
/** build it once (at the level build: same on every machine, visuals only) */
export function buildSquare(L: Level3D): Square {
  const S = SQUARE;
  const pal = TOWN_DAY;
  // the plaza (cobbles), a few candy houses round it, trees, the fountain
  const floor = new THREE.Mesh(new THREE.BoxGeometry(48, 1, 48), new THREE.MeshToonMaterial({ color: '#ffe6ee' }));
  floor.position.set(S.x, -0.5, S.z); floor.receiveShadow = true; L.deco(floor);
  L.col({ kind: 'box', min: new THREE.Vector3(S.x - 24, -1, S.z - 24), max: new THREE.Vector3(S.x + 24, 0, S.z + 24) });
  const ring = new THREE.Mesh(new THREE.RingGeometry(6, 7.5, 40).rotateX(-Math.PI / 2), basic('#ffc8da'));
  ring.position.set(S.x, 0.02, S.z); L.deco(ring);
  const houses: [number, number, number, number, number, number][] = [[-14, -16, 7, 6, 6, 0], [0, -18, 8, 6, 7, 0], [14, -16, 7, 6, 6, 0], [-18, 0, 6, 8, 6, 1], [18, 2, 6, 8, 7, 3], [-14, 15, 7, 6, 6, 2], [14, 15, 7, 6, 6, 2]];
  houses.forEach(([x, z, w, d, h, q], i) => L.add(townProps.gingerHouse({ x: S.x + x, y: 0, z: S.z + z, w, d, h, rotY: q, seed: 70 + i, pal })));
  for (const [x, z] of [[-7, -10], [7, -10], [-10, 8], [10, 8]] as const) L.add(townProps.candyTree({ x: S.x + x, y: 0, z: S.z + z, pal, seed: Math.round(x * 3 + z) }));
  L.add(townProps.fountain({ x: S.x, y: 0, z: S.z - 8, pal }));
  // the long table with the pie
  const table = new THREE.Vector3(S.x, 0, S.z + 2);
  const tb = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(9, 0.3, 3.2), new THREE.MeshToonMaterial({ color: '#fff4f8' }));
  top.position.y = 1.0; top.castShadow = true; tb.add(top);
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.6, 3.4), new THREE.MeshToonMaterial({ color: '#ff8ab0' }));
  cloth.position.y = 0.75; tb.add(cloth);
  for (const x of [-4, 4]) for (const z of [-1.3, 1.3]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1, 8), new THREE.MeshToonMaterial({ color: '#c8803e' })); leg.position.set(x, 0.5, z); tb.add(leg); }
  const p = pie(); p.position.y = 1.15; tb.add(p);
  tb.position.copy(table);
  L.deco(tb);
  const marks = {
    tosha: new THREE.Vector3(S.x - 1.4, 0, S.z + 5.4), bublik: new THREE.Vector3(S.x + 0.4, 0, S.z + 5.6), noki: new THREE.Vector3(S.x + 2.4, 0, S.z + 5.2),
    pastila: new THREE.Vector3(S.x - 3.2, 0, S.z + 4.8), bear: new THREE.Vector3(S.x - 5.6, 0, S.z + 2.4),
  };
  const mk = (kind: Parameters<typeof createFolk>[0], look: Parameters<typeof createFolk>[1], x: number, z: number, yaw: number): Folk => {
    const rig = createFolk(kind, look);
    const g = new THREE.Group(); g.add(rig.root); g.position.set(S.x + x, 0, S.z + z); g.rotation.y = yaw;
    L.scene.add(g);
    const anim: FolkAnim = { state: 'idle', speed: 0, talk: 0, look: 0 };
    L.updaters.push((_t, dt) => { if (g.visible) rig.update(dt, anim); });
    return { rig, g, anim };
  };
  const folk = {
    zefirych: mk('marsh', { color: '#fff8fa', hat: 'top', accent: '#6a6a9a', hold: 'pole', glasses: true }, 5.0, 5.4, Math.atan2(-5, -3.4)),
    beze: mk('cupcake', { color: '#fffaf6', accent: '#ff9fc0', hat: 'chef', scale: 1.15, apron: true }, 4.8, -0.2, Math.atan2(-4.8, 2.2)),
    marmeladka: mk('gumdrop', { color: '#5ad86a', hold: 'lantern', hat: 'bow', accent: '#ff5a8a', scale: 0.85 }, -6.6, 6.6, Math.atan2(6.6, -4.6)),
    ponchik: mk('gumdrop', { color: '#e8a050', hat: 'beret', accent: '#3a6ad8', hold: 'bag' }, 14, 20, Math.PI),
  };
  // the sour letter (Пончик carries it in): a yellow envelope with a lemon seal, sour steam
  const letter = new THREE.Group();
  const env = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.04), new THREE.MeshToonMaterial({ color: '#ffe45a' }));
  letter.add(env);
  const seal = new THREE.Mesh(G.cyl(), new THREE.MeshToonMaterial({ color: '#9ad020' })); seal.scale.set(0.06, 0.02, 0.06); seal.rotation.x = Math.PI / 2; seal.position.z = 0.03; letter.add(seal);
  letter.visible = false;
  L.scene.add(letter);
  return { table, marks, ponchikFrom: new THREE.Vector3(S.x + 14, 0, S.z + 20), folk, letter };
}

export { grp };

import * as THREE from 'three';
import { noOutline } from '../../../gfx';
import { glowTex } from '../../../world/textures';
import type { Level3D } from '../../level';
import { townProps as T, TOWN_NIGHT, type FolkKind } from '../town';
import type { FolkLook } from '../town/people';
import { stripeTex } from '../town/tex';
import { SIGNS } from './lines';

/*
 * v2 §5.1 «Судья из-за гор»: the Праздник фонариков' contest on the square at the clock tower — a low round stage
 * with a «ЖЮРИ» board on two poles and bunting (the judge — the Count — stands on it facing the square), the three
 * contestants with their paper lanterns on sticks in a half-ring in front of it (Пончик orange, Безе pink, Мармеладка
 * green), a chalkboard «Самый яркий фонарик. Победитель: ___» on an easel (the name scratched out with a claw), and
 * after the intro the dropped contest lanterns lying grey on the cobbles (§5.2). Built at level build on every machine
 * (visuals + the stage's collider; nothing here is net state).
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const TOWER_DOOR = V(-13.5, 0, -11.2);
/** the stage: from the tower's door (§5.1: door + (3.5; 0; 4.0) — nudged off the flowerbed east of the porch) */
const YAW = 0.946;
export const JURY = {
  c: TOWER_DOOR.clone().add(V(4.15, 0, 4.47)),
  /** facing the square (toward the fountain) */
  yaw: YAW,
  f: V(Math.sin(YAW), 0, Math.cos(YAW)),
  /** the stage's side (to the Count's left) */
  r: V(Math.cos(YAW), 0, -Math.sin(YAW)),
  R: 1.6, top: 0.42,
};
/** the Count on the stage (feet) */
export const JUDGE_AT = JURY.c.clone().setY(JURY.top);

export type ContestId = 'ponchik' | 'beze' | 'marmeladka';
export interface Contestant { id: ContestId; kind: FolkKind; look: FolkLook; color: string; at: THREE.Vector3; yaw: number }
/** the three in a half-ring in front of the stage, in the order the judge goes along them */
export const CONTEST: Contestant[] = (() => {
  const spot = (a: number, d = 3.25) => JURY.c.clone().add(V(Math.sin(YAW + a) * d, 0, Math.cos(YAW + a) * d));
  const mk = (id: ContestId, kind: FolkKind, look: FolkLook, color: string, a: number): Contestant => {
    const at = spot(a);
    return { id, kind, look, color, at, yaw: Math.atan2(JURY.c.x - at.x, JURY.c.z - at.z) };
  };
  return [
    mk('ponchik', 'gumdrop', { color: '#e8a050', hat: 'beret', accent: '#3a6ad8' }, '#ff9a3a', -0.62),
    mk('beze', 'cupcake', { color: '#fffaf6', accent: '#ff9fc0', hat: 'chef', apron: true }, '#ff7ab0', 0),
    mk('marmeladka', 'gumdrop', { color: '#5ad86a', hat: 'bow', accent: '#ff5a8a', scale: 0.85 }, '#6af07a', 0.62),
  ];
})();

/** a paper lantern on a stick (held by a contestant in the intro; lying on the cobbles after) */
export class PaperLantern {
  g = new THREE.Group();
  /** the paper globe (world position via head()) */
  globe: THREE.Mesh;
  private mat: THREE.MeshToonMaterial;
  private glowM: THREE.SpriteMaterial;
  private base: THREE.Color;
  /** 0 bright … 1 drunk grey */
  grey = 0;
  private shown = -1;
  constructor(color: string) {
    this.base = new THREE.Color(color);
    this.mat = new THREE.MeshToonMaterial({ color, emissive: color, emissiveIntensity: 0.85 });
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.0, 6), new THREE.MeshToonMaterial({ color: '#8a5a3a' }));
    stick.position.set(0, 0.5, 0);
    this.g.add(stick);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.34, 6), stick.material);
    arm.rotation.z = Math.PI / 2; arm.position.set(0.17, 1.0, 0);
    this.g.add(arm);
    this.globe = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10).scale(1, 1.25, 1), this.mat);
    this.globe.position.set(0.34, 0.78, 0);
    this.g.add(this.globe);
    const cap = new THREE.MeshToonMaterial({ color: '#3a2a3a' });
    for (const y of [0.99, 0.57]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 10), cap); c.position.set(0.34, y, 0); this.g.add(c); }
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.2, 4), cap); string.position.set(0.34, 0.9, 0); this.g.add(string);
    this.glowM = new THREE.SpriteMaterial({ map: glowTex(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7 });
    const s = new THREE.Sprite(this.glowM); s.scale.setScalar(1.1); s.position.copy(this.globe.position); noOutline(s);
    this.g.add(s);
    this.apply();
  }
  head(out = new THREE.Vector3()) { return this.globe.getWorldPosition(out); }
  apply() {
    if (Math.abs(this.shown - this.grey) < 0.003) return;
    this.shown = this.grey;
    const k = this.grey;
    const l = this.base.r * 0.3 + this.base.g * 0.59 + this.base.b * 0.11;
    this.mat.color.copy(this.base).lerp(new THREE.Color(l * 0.7, l * 0.7, l * 0.76), k);
    this.mat.emissive.copy(this.base).multiplyScalar(1 - k);
    this.glowM.opacity = 0.7 * (1 - k);
  }
}

/** the contest's set on the square */
export class JuryStage {
  /** the dropped lanterns on the cobbles (after the intro) */
  lying: THREE.Group;
  constructor(L: Level3D) {
    const pal = TOWN_NIGHT;
    const { c, R, top, f, r } = JURY;
    const g = new THREE.Group();
    // the round stage: a striped skirt, a wooden top, an icing rim
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(R, R + 0.05, top - 0.06, 32), new THREE.MeshToonMaterial({ map: stripeTex('#ff7aa8', '#fff0f6', 12) }));
    skirt.position.y = (top - 0.06) / 2;
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.04, R + 0.04, 0.08, 32), new THREE.MeshToonMaterial({ color: '#b07a4e' }));
    deck.position.y = top - 0.04;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R + 0.04, 0.05, 6, 40), new THREE.MeshToonMaterial({ color: pal.icing }));
    rim.rotation.x = Math.PI / 2; rim.position.y = top;
    for (const m of [skirt, deck, rim]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
    g.position.copy(c);
    L.deco(g);
    L.col({ kind: 'cyl', x: c.x, z: c.z, r: R, y0: 0, y1: top });
    // two poles at the back, the «ЖЮРИ» board between them, bunting from pole to pole
    const poleM = new THREE.MeshToonMaterial({ color: '#d8d2e6' });
    const tops: THREE.Vector3[] = [];
    for (const s of [-1, 1]) {
      const p = c.clone().addScaledVector(f, -(R - 0.2)).addScaledVector(r, s * 1.15);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.9, 8), poleM);
      pole.position.set(p.x, top + 1.45, p.z); pole.castShadow = true;
      L.deco(pole);
      L.col({ kind: 'cyl', x: p.x, z: p.z, r: 0.08, y0: top, y1: top + 2.9 });
      tops.push(V(p.x, top + 2.85, p.z));
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshToonMaterial({ color: '#ffd34a', emissive: '#ffa818', emissiveIntensity: 0.6 }));
      ball.position.set(p.x, top + 2.95, p.z); L.deco(ball);
    }
    const back = c.clone().addScaledVector(f, -(R - 0.18));
    L.add(T.facadeSign({ x: back.x, y: top + 2.25, z: back.z, rotY: YAW / (Math.PI / 2), label: SIGNS.jury, color: '#ffd34a', w: 1.7, pal }));
    this.bunting(L, tops[0], tops[1], 0.45);
    this.bunting(L, tops[0], c.clone().addScaledVector(r, -2.6).addScaledVector(f, -0.6).setY(3.2), 0.5);
    this.bunting(L, tops[1], c.clone().addScaledVector(r, 2.6).addScaledVector(f, -0.6).setY(3.2), 0.5);
    // the chalkboard on an easel beside the stage (west side), facing the square
    this.board(L, c.clone().addScaledVector(r, -2.75).addScaledVector(f, 0.2));
    // the contest lanterns dropped on the cobbles (shown once the intro is over)
    this.lying = new THREE.Group();
    const lay: [number, number, number][] = [[0.35, -0.2, 1.2], [-0.3, 0.25, -1.4], [0.2, 0.3, 0.6]];
    CONTEST.forEach((k, i) => {
      const pl = new PaperLantern(k.color);
      pl.grey = 1; pl.apply();
      const [dx, dz, ry] = lay[i];
      pl.g.position.copy(k.at).add(V(dx, 0.04, dz));
      pl.g.rotation.set(0, ry, Math.PI / 2 - 0.08);
      pl.g.position.y = 0.06;
      this.lying.add(pl.g);
    });
    this.lying.visible = false;
    L.deco(this.lying);
  }

  private bunting(L: Level3D, a: THREE.Vector3, b: THREE.Vector3, sag: number) {
    const cols = ['#ff7aa8', '#ffd34a', '#7ad8ff', '#9af08a', '#ff9a4a'];
    const n = Math.max(4, Math.round(a.distanceTo(b) / 0.32));
    const tri = new THREE.BufferGeometry().setFromPoints([V(-0.11, 0, 0), V(0.11, 0, 0), V(0, -0.24, 0)]);
    tri.setIndex([0, 1, 2]); tri.computeVertexNormals();
    const cord: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = a.clone().lerp(b, t); p.y -= Math.sin(t * Math.PI) * sag;
      cord.push(p);
      if (i === 0 || i === n) continue;
      const m = new THREE.Mesh(tri, new THREE.MeshBasicMaterial({ color: cols[i % cols.length], side: THREE.DoubleSide }));
      m.position.copy(p);
      m.rotation.y = Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2;
      noOutline(m);
      L.deco(m);
    }
    const line = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cord), n * 2, 0.012, 4), new THREE.MeshBasicMaterial({ color: '#2a1e2e' }));
    noOutline(line);
    L.deco(line);
  }

  private board(L: Level3D, at: THREE.Vector3) {
    const g = new THREE.Group();
    const wood = new THREE.MeshToonMaterial({ color: '#8a5a3a' });
    for (const [x, rz] of [[-0.42, 0.12], [0.42, -0.12]] as const) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.9, 0.07), wood); leg.position.set(x, 0.92, 0.05); leg.rotation.set(-0.12, 0, rz); g.add(leg); }
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.7, 0.07), wood); back.position.set(0, 0.82, -0.32); back.rotation.x = 0.3; g.add(back);
    const c = document.createElement('canvas'); c.width = 256; c.height = 200;
    const x = c.getContext('2d')!;
    x.fillStyle = '#2a3a32'; x.fillRect(0, 0, 256, 200);
    x.strokeStyle = '#8a5a3a'; x.lineWidth = 12; x.strokeRect(0, 0, 256, 200);
    x.fillStyle = '#f4f0e0'; x.textAlign = 'center';
    x.font = '700 26px Rubik, sans-serif'; x.fillText('Самый яркий', 128, 46); x.fillText('фонарик', 128, 76);
    x.font = '400 22px Pangolin, sans-serif'; x.textAlign = 'left'; x.fillText('Победитель:', 22, 124);
    x.strokeStyle = 'rgba(244,240,224,0.8)'; x.lineWidth = 2; x.beginPath(); x.moveTo(150, 128); x.lineTo(232, 128); x.stroke();
    // the name scratched out with a claw: three ragged strokes
    x.strokeStyle = 'rgba(200,40,60,0.9)'; x.lineWidth = 4;
    for (let i = 0; i < 3; i++) { x.beginPath(); x.moveTo(146 + i * 6, 100 + i * 9); x.lineTo(176 + i * 8, 114 + i * 6); x.lineTo(236 - i * 4, 104 + i * 10); x.stroke(); }
    x.fillStyle = 'rgba(244,240,224,0.75)'; x.font = '400 18px Pangolin, sans-serif'; x.fillText('1. ☆   2. ☆   3. ☆', 30, 170);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const slate = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.8, 0.05), [wood, wood, wood, wood, new THREE.MeshToonMaterial({ map: tex }), wood]);
    slate.position.set(0, 1.25, 0.1); slate.rotation.x = -0.12;
    g.add(slate);
    g.traverse((o) => { o.castShadow = true; });
    g.position.copy(at); g.rotation.y = YAW;
    L.deco(g);
    L.col({ kind: 'cyl', x: at.x, z: at.z, r: 0.5, y0: 0, y1: 1.7 });
    L.signAt(at.x + JURY.f.x * 1.1, 0, at.z + JURY.f.z * 1.1, SIGNS.board);
  }
}

import * as THREE from 'three';
import { clamp } from '../../../../engine/util';
import { basic, canvasTex, noOutline } from '../../../gfx';
import { G, part, Mats } from '../../../models/kit';
import type { Level3D } from '../../level';
import type { BoxCol } from '../../../physics/types';
import { ROOF } from './boss';
import { F5 } from './lines';

/**
 * (v2 §9.0 / §9.3) The King's dinner table «на сто персон» across the roof: north–south down the middle, empty grey
 * plates with place cards of the kingdoms he means to drink, empty high-backed chairs, red candles, and at the south
 * head his throne-chair with Вторник's raspberry pie (it greys from the knife to the edge in the cold open).
 * At the start of the fight a shadow drags it to the north edge and it sinks into the roof (`away`); after the King
 * it stands there again (the defeat scene). Visuals + one box collider (on only while it stands): every machine.
 */

export const TABLE = { x: 0, z0: ROOF.z + 2.4, z1: ROOF.z - 14.6, w: 1.7, h: 0.86 };
/** the King's seat at the head of the table (he sits facing north, down the table into the moon) */
export const SEAT = new THREE.Vector3(TABLE.x, ROOF.y, TABLE.z0 + 0.95);
/** the pie in front of him */
export const PIE_AT = new THREE.Vector3(TABLE.x, ROOF.y + TABLE.h + 0.03, TABLE.z0 - 0.62);

const TAU = Math.PI * 2;
const BOXG = new THREE.BoxGeometry(1, 1, 1);
const tmp = new THREE.Vector3();

function cardTex(name: string) {
  return canvasTex(256, 96, (g, w, h) => {
    g.fillStyle = '#d8d4e0'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#6a6278'; g.lineWidth = 6; g.strokeRect(5, 5, w - 10, h - 10);
    g.fillStyle = '#2a2234';
    let size = 30;
    g.font = `700 ${size}px Rubik, sans-serif`;
    while (g.measureText(name).width > w - 26 && size > 14) { size -= 2; g.font = `700 ${size}px Rubik, sans-serif`; }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(name, w / 2, h / 2 + 2);
  });
}

/** a raspberry pie whose colour drains out from a point (vertex colours) */
export class GreyPie {
  root = new THREE.Group();
  private meshes: { m: THREE.Mesh; base: Float32Array; col: THREE.BufferAttribute; pos: THREE.BufferAttribute }[] = [];
  private mat = new THREE.MeshToonMaterial({ color: '#ffffff', vertexColors: true });
  private from = new THREE.Vector3(0.2, 0, 0);
  constructor() {
    const add = (geo: THREE.BufferGeometry, color: string, p: [number, number, number], s: number | [number, number, number] = 1, r?: [number, number, number]) => {
      geo = geo.clone();
      const m = new THREE.Mesh(geo, this.mat);
      m.position.set(...p);
      if (typeof s === 'number') m.scale.setScalar(s); else m.scale.set(...s);
      if (r) m.rotation.set(...r);
      m.castShadow = true;
      this.root.add(m);
      m.updateMatrix();
      geo.applyMatrix4(m.matrix);
      m.position.set(0, 0, 0); m.scale.setScalar(1); m.rotation.set(0, 0, 0);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const c = new THREE.Color(color);
      const base = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) { base[i * 3] = c.r; base[i * 3 + 1] = c.g; base[i * 3 + 2] = c.b; }
      const col = new THREE.BufferAttribute(base.slice(), 3);
      geo.setAttribute('color', col);
      this.meshes.push({ m, base, col, pos });
    };
    const R = 0.34;
    add(G.cyl(), '#d8963a', [0, 0.06, 0], [R, 0.12, R]);
    add(G.cyl(), '#c8243a', [0, 0.125, 0], [R * 0.92, 0.02, R * 0.92]);
    add(G.torus(R * 0.98, 0.035, 6, 28), '#e8a850', [0, 0.125, 0], 1, [Math.PI / 2, 0, 0]);
    for (let i = -2; i <= 2; i++) {
      const L = 2 * R * 0.9 * Math.sqrt(Math.max(0.08, 1 - (i * 0.12 / (R * 0.95)) ** 2));
      add(G.cyl(), '#e8a850', [i * 0.12, 0.14, 0], [0.02, L, 0.012], [Math.PI / 2, 0, 0]);
      add(G.cyl(), '#e8a850', [0, 0.145, i * 0.12], [0.02, L, 0.012], [0, 0, Math.PI / 2]);
    }
    for (let i = 0; i < 12; i++) { const a = i * 2.4, r = 0.06 + (i % 5) * 0.05; add(G.ball(), '#e8304a', [Math.cos(a) * r, 0.16, Math.sin(a) * r], 0.028); }
    noOutline(this.root);
    this.grey(0);
  }
  /** where the knife went in (pie-local x, z) */
  cutAt(x: number, z: number) { this.from.set(x, 0, z); }
  /** 0 = raspberry, 1 = all grey (the grey front runs from the cut to the far edge) */
  grey(k: number) {
    const front = k * 0.85;
    for (const { base, col, pos } of this.meshes) {
      for (let i = 0; i < pos.count; i++) {
        tmp.set(pos.getX(i), 0, pos.getZ(i));
        const g = clamp((front - tmp.distanceTo(this.from)) / 0.12 + (k >= 1 ? 1 : 0), 0, 1);
        const r = base[i * 3], gg = base[i * 3 + 1], b = base[i * 3 + 2];
        const l = 0.3 * r + 0.55 * gg + 0.15 * b;
        const gy = 0.32 + l * 0.45;
        col.setXYZ(i, r + (gy - r) * g, gg + (gy - gg) * g, b + (gy - b) * g);
      }
      col.needsUpdate = true;
    }
  }
}

export interface Feast {
  root: THREE.Group;
  pie: GreyPie;
  knife: THREE.Group;
  /** 0 = standing at its place, 1 = gone (dragged north and sunk into the roof) */
  away: number;
  setAway(k: number): void;
  /** a scene animates it: the per-frame rule (gone while the King fights) steps aside */
  hold: boolean;
}

export function buildFeast(L: Level3D): Feast {
  const M = new Mats();
  const root = new THREE.Group();
  root.position.set(TABLE.x, ROOF.y, 0);
  const len = TABLE.z0 - TABLE.z1, zc = (TABLE.z0 + TABLE.z1) / 2;
  const wood = M.get('#3a2a36'), cloth = M.get('#6a5a72'), clothD = M.get('#4a3e58'), iron = M.get('#2a2632'), plateM = M.get('#b8b4c2'), seatM = M.get('#2e2638'), velvet = M.get('#5a1a34');
  // the top, the cloth (down the long sides only: the King's legs go under the head end)
  part(root, BOXG, wood, [0, TABLE.h - 0.05, zc], [TABLE.w, 0.1, len]);
  part(root, BOXG, cloth, [0, TABLE.h + 0.006, zc], [TABLE.w + 0.08, 0.02, len + 0.06]);
  for (const s of [1, -1]) part(root, BOXG, clothD, [s * (TABLE.w / 2 + 0.04), TABLE.h - 0.22, zc], [0.02, 0.44, len + 0.06]);
  for (let z = TABLE.z1 + 0.5; z <= TABLE.z0 - 0.4; z += 3.3) for (const s of [1, -1]) part(root, G.cyl(), iron, [s * (TABLE.w / 2 - 0.2), TABLE.h / 2, z], [0.06, TABLE.h, 0.06]);
  // a runner of red down the middle
  part(root, BOXG, velvet, [0, TABLE.h + 0.02, zc], [0.34, 0.012, len - 0.4]);
  // plates, place cards, empty chairs
  let ci = 0;
  for (let z = TABLE.z0 - 1.9; z > TABLE.z1 + 0.5; z -= 1.45) {
    for (const s of [1, -1]) {
      const x = s * (TABLE.w / 2 - 0.32);
      part(root, G.cyl(), plateM, [x, TABLE.h + 0.025, z], [0.21, 0.025, 0.21]);
      part(root, G.cyl(), M.get('#9c98a8'), [x, TABLE.h + 0.04, z], [0.13, 0.01, 0.13]);
      // the place card (a little tent, its name toward the chair)
      const name = F5.placeCards[ci++ % F5.placeCards.length];
      const card = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.13), new THREE.MeshBasicMaterial({ map: cardTex(name), side: THREE.DoubleSide }));
      card.position.set(x - s * 0.2, TABLE.h + 0.1, z);
      card.rotation.set(0, s * Math.PI / 2, 0);
      card.rotateX(-0.25);
      noOutline(card);
      root.add(card);
      // a knife and a fork
      part(root, BOXG, M.get('#c8c8d4'), [x, TABLE.h + 0.02, z + 0.3], [0.03, 0.01, 0.22]);
      part(root, BOXG, M.get('#c8c8d4'), [x, TABLE.h + 0.02, z - 0.3], [0.03, 0.01, 0.22]);
      // the chair
      const cx = s * (TABLE.w / 2 + 0.45);
      part(root, BOXG, seatM, [cx, 0.5, z], [0.5, 0.08, 0.5]);
      part(root, BOXG, seatM, [cx + s * 0.24, 1.05, z], [0.07, 1.1, 0.5]);
      part(root, G.cone(), seatM, [cx + s * 0.24, 1.72, z], [0.12, 0.26, 0.12]);
      for (const dz of [-0.2, 0.2]) part(root, G.cyl(), iron, [cx - s * 0.2, 0.25, z + dz], [0.03, 0.5, 0.03]);
    }
  }
  // candles down the table (red flames)
  for (let z = TABLE.z0 - 3.4; z > TABLE.z1 + 1; z -= 4.2) {
    part(root, G.cyl(), iron, [0, TABLE.h + 0.25, z], [0.05, 0.5, 0.05]);
    part(root, BOXG, iron, [0, TABLE.h + 0.5, z], [0.5, 0.04, 0.04]);
    for (const dx of [-0.24, 0, 0.24]) {
      part(root, G.cyl(), M.get('#e8e0d0'), [dx, TABLE.h + 0.62, z], [0.035, 0.2, 0.035]);
      const fl = part(root, G.ball(), basic('#ff5040'), [dx, TABLE.h + 0.76, z], [0.035, 0.06, 0.035]);
      noOutline(fl);
    }
  }
  // the throne-chair at the head (south): he sits facing north, down the table into the moon
  const th = new THREE.Group();
  th.position.set(0, 0, SEAT.z - root.position.z);
  root.add(th);
  part(th, BOXG, seatM, [0, 0.5, 0.05], [0.8, 0.12, 0.7]);
  part(th, BOXG, seatM, [0, 1.55, 0.42], [0.86, 2.1, 0.12]);
  part(th, BOXG, velvet, [0, 1.4, 0.35], [0.66, 1.6, 0.04]);
  for (const s of [1, -1]) { part(th, G.cyl(), iron, [s * 0.36, 0.25, -0.2], [0.04, 0.5, 0.04]); part(th, G.cyl(), iron, [s * 0.36, 0.25, 0.3], [0.04, 0.5, 0.04]); part(th, BOXG, seatM, [s * 0.4, 0.8, 0.05], [0.08, 0.06, 0.6]); }
  const cres = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 6, 18, Math.PI * 1.3), M.get('#e8e4f4'));
  cres.position.set(0, 2.78, 0.42); cres.rotation.z = Math.PI * 0.85; th.add(cres);
  // the pie, a silver knife
  const pie = new GreyPie();
  pie.root.position.set(PIE_AT.x - root.position.x, PIE_AT.y - root.position.y, PIE_AT.z);
  root.add(pie.root);
  part(root, G.cyl(), plateM, [PIE_AT.x, TABLE.h + 0.02, PIE_AT.z], [0.42, 0.025, 0.42]);
  const knife = new THREE.Group();
  part(knife, BOXG, M.get('#e8e8f4'), [0, -0.12, 0], [0.012, 0.22, 0.05]);
  part(knife, BOXG, M.get('#4a3a4a'), [0, 0.06, 0], [0.025, 0.13, 0.035]);
  knife.visible = false;
  root.add(knife);
  // it stands where you could walk into it: a collider while it is there
  const col: BoxCol = { kind: 'box', min: new THREE.Vector3(TABLE.x - TABLE.w / 2 - 0.1, ROOF.y, TABLE.z1), max: new THREE.Vector3(TABLE.x + TABLE.w / 2 + 0.1, ROOF.y + TABLE.h, TABLE.z0) };
  L.col(col);
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
  L.scene.add(root);
  const f: Feast = {
    root, pie, knife, away: 0, hold: false,
    setAway(k: number) {
      k = clamp(k, 0, 1);
      f.away = k;
      root.position.set(TABLE.x, ROOF.y - 2.6 * k * k, -3.2 * k);
      root.visible = k < 0.999;
      col.active = k < 0.05;
    },
  };
  return f;
}
void TAU;

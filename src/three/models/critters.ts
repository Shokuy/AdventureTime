import * as THREE from 'three';
import { PAL, BOOK_COLORS, basic, canvasTex, noOutline } from '../gfx';
import type { Rig } from './rig';
import { G, Mats, TAU, clamp, damp, grp, part, cached, Blinker } from './kit';

const fo = { cast: false };

// ───────────────────────── Meatball ─────────────────────────
const lumpyGeo = () => cached('meatball-lumpy', () => {
  const g = new THREE.SphereGeometry(1, 36, 26);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 1
      + 0.045 * Math.sin(v.x * 7.1 + v.y * 2.3) * Math.sin(v.z * 6.3 - v.y * 4.1)
      + 0.025 * Math.sin(v.x * 13 + v.z * 11 + v.y * 9);
    v.multiplyScalar(n);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
});
let meatTexCache: THREE.Texture | null = null;
function meatTex() {
  if (meatTexCache) return meatTexCache;
  meatTexCache = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = PAL.meatball; g.fillRect(0, 0, w, h);
    const blob = (x: number, y: number, rx: number, ry: number, c: string) => {
      g.fillStyle = c;
      for (const dx of [-w, 0, w]) { g.beginPath(); g.ellipse(x + dx, y, rx, ry, (x * 0.37) % 3, 0, TAU); g.fill(); }
    };
    for (let i = 0; i < 26; i++) blob((i * 71.3) % w, (i * 37.9) % h, 7 + (i % 4) * 3, 4 + (i % 3) * 2, '#6e3420');
    for (let i = 0; i < 34; i++) blob((i * 53.1 + 17) % w, (i * 29.3 + 9) % h, 3, 2, '#b06a3e');
    for (let i = 0; i < 12; i++) blob((i * 97.7 + 31) % w, (i * 41.3 + 23) % h, 2.5, 1.6, '#5d9a3a');
  }, { wrap: true });
  return meatTexCache;
}

export function createMeatball(): Rig<{ roll: number; flash: number }> {
  const M = new Mats();
  const black = basic('#1b1214');
  const white = basic('#ffffff');
  const R = 0.45;
  const root = new THREE.Group();
  root.name = 'meatball';
  const center = grp(root, [0, R, 0]);
  const ball = grp(center, undefined, undefined, 'roll');
  part(ball, lumpyGeo(), M.get('#ffffff', { map: meatTex() }), undefined, R);
  // sauce blobs (roll with the ball)
  const sauce = M.get(PAL.sauce);
  // blobs sit near the ±X sides so rolling (about X) never sweeps them across the upright face
  for (const [x, y, z, s] of [[0.82, 0.5, 0.25, 0.12], [-0.85, 0.3, -0.42, 0.1], [0.8, -0.4, -0.45, 0.09], [-0.78, -0.45, 0.45, 0.085]] as const) {
    const d = new THREE.Vector3(x, y, z).normalize();
    const m = part(ball, G.sphere(), sauce, [d.x * R * 0.98, d.y * R * 0.98, d.z * R * 0.98], [s, s * 0.45, s]);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
  }

  // face stays upright (child of center, not of the rolling ball)
  const face = grp(center, [0, 0, 0]);
  const pupils: THREE.Mesh[] = [];
  for (const s of [1, -1]) {
    part(face, G.sphere(), white, [s * 0.13, 0.075, 0.42], [0.09, 0.1, 0.06], undefined, fo);
    pupils.push(part(face, G.ball(), black, [s * 0.115, 0.06, 0.475], [0.045, 0.05, 0.02], undefined, fo));
    part(face, G.capsule(0.024, 0.11), M.get('#3a1a10'), [s * 0.13, 0.2, 0.43], 1, [0, 0, Math.PI / 2 + s * 0.42], fo);
  }
  const grin = grp(face, [0, -0.12, 0.435], [0.25, 0, 0]);
  part(grin, G.sphere(), basic('#4a0f18'), undefined, [0.19, 0.08, 0.05], undefined, fo);
  part(grin, G.sphere(), white, [0, 0.035, 0.018], [0.16, 0.032, 0.04], undefined, fo);
  part(grin, G.sphere(), white, [0, -0.04, 0.012], [0.12, 0.026, 0.04], undefined, fo);
  for (const x of [-0.08, -0.027, 0.027, 0.08]) part(grin, G.capsule(0.006, 0.03), black, [x, 0.035, 0.055], 1, undefined, fo);

  let lastRoll = 0, spin = 0, t = Math.random() * 3, init = false;
  const blinker = new Blinker();
  return {
    root,
    update(dt, a) {
      dt = Math.min(dt, 0.1);
      t += dt;
      if (!init) { lastRoll = a.roll; init = true; }
      const v = dt > 0 ? (a.roll - lastRoll) / dt : 0;
      lastRoll = a.roll;
      spin = damp(spin, Math.min(1, Math.abs(v) / 8), 6, dt);
      ball.rotation.x = a.roll;
      const bounce = Math.abs(Math.sin(a.roll * 2)) * 0.03 * spin;
      center.position.y = R + bounce;
      const sq = 1 + 0.03 * Math.sin(t * 4) * (1 - spin) - 0.05 * spin * Math.abs(Math.cos(a.roll * 2));
      center.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
      face.rotation.z = Math.sin(t * 12) * 0.05 * spin;
      face.position.y = -0.02 * spin;
      const bl = blinker.update(dt);
      for (const p of pupils) p.scale.y = 0.05 * (1 - 0.85 * bl);
      M.flash(a.flash);
    },
  };
}

// ───────────────────────── Jelly ─────────────────────────
const JELLY_COLORS = ['#ff5f9e', '#5fb4ff', '#68d65a'];
const jellyGeo = () => cached('jelly-dome', () => {
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0)];
  const H = 0.7, n = 40;
  for (let i = 0; i <= n; i++) {
    const y = (i / n) * H;
    const u = y / H;
    const base = 0.37 * Math.pow(Math.max(0, 1 - Math.pow(u, 2.6)), 0.55) * (1 + 0.06 * (1 - u));
    const ridge = u < 0.62 ? 1 + 0.045 * Math.cos(u * TAU * 3.2) * (1 - u) : 1;
    pts.push(new THREE.Vector2(Math.max(0.0005, base * ridge), y));
  }
  pts[pts.length - 1].x = 0;
  const g = new THREE.LatheGeometry(pts, 40);
  g.computeVertexNormals();
  return g;
});

export function createJelly(hue: 0 | 1 | 2): Rig<{ squash: number; flash: number }> {
  const M = new Mats();
  const col = JELLY_COLORS[hue] ?? JELLY_COLORS[0];
  const root = new THREE.Group();
  root.name = 'jelly';
  const body = grp(root);
  const jm = M.get(col, { transparent: true, opacity: 0.8 });
  // the dome doesn't write depth, so the face (drawn after it) shows crisply "inside" the jelly
  jm.depthWrite = false;
  const dome = part(body, jellyGeo(), jm);
  dome.renderOrder = 2;
  // darker core for depth
  const core = part(body, G.sphere(), M.get(new THREE.Color(col).multiplyScalar(0.7), { transparent: true, opacity: 0.5 }), [0, 0.24, -0.04], [0.2, 0.18, 0.18], undefined, { cast: false });
  core.renderOrder = 1;
  (core.material as THREE.Material).depthWrite = false;
  const black = basic('#2a0f1c', { transparent: true });
  const glintM = basic('#ffffff', { transparent: true });
  const eyes: THREE.Mesh[] = [];
  const faceParts: THREE.Mesh[] = [];
  for (const s of [1, -1]) {
    const e = part(body, G.ball(), black, [s * 0.1, 0.36, 0.305], [0.042, 0.058, 0.025], [0, s * 0.3, 0], fo);
    eyes.push(e);
    faceParts.push(e, part(body, G.ball(), glintM, [s * 0.1 + 0.014, 0.385, 0.328], 0.013, undefined, fo));
  }
  faceParts.push(part(body, G.arc(0.05, 0.012, Math.PI), black, [0, 0.28, 0.325], [1, 1, 0.6], [0.2, 0, Math.PI], fo));
  for (const f of faceParts) f.renderOrder = 3;
  const hl = part(body, G.sphere(), basic('#ffffff', { transparent: true, opacity: 0.85 }), [-0.14, 0.52, 0.2], [0.075, 0.04, 0.02], [0.6, -0.5, 0.5], { cast: false, receive: false });
  const hl2 = part(body, G.sphere(), basic('#ffffff', { transparent: true, opacity: 0.7 }), [-0.21, 0.42, 0.24], [0.022, 0.016, 0.01], [0.6, -0.7, 0.5], { cast: false, receive: false });
  hl.renderOrder = hl2.renderOrder = 4;
  noOutline(hl); noOutline(hl2);

  let sy = 1, vy = 0, t = Math.random() * 4;
  const blinker = new Blinker();
  return {
    root,
    update(dt, a) {
      dt = Math.min(dt, 0.05);
      t += dt;
      const target = 1 - 0.32 * clamp(a.squash, -1, 1);
      // springy wobble toward the target squash
      vy += ((target - sy) * 260 - vy * 9) * dt;
      sy += vy * dt;
      const idle = 1 + 0.035 * Math.sin(t * 5.2);
      const y = Math.max(0.3, sy * idle);
      const xz = 1 / Math.sqrt(y);
      body.scale.set(xz * (1 + 0.02 * Math.sin(t * 7.1)), y, xz * (1 + 0.02 * Math.cos(t * 6.3)));
      body.rotation.z = Math.sin(t * 3.1) * 0.03;
      const bl = blinker.update(dt);
      for (const e of eyes) e.scale.y = 0.058 * (1 - 0.9 * bl);
      M.flash(a.flash);
    },
  };
}

// ───────────────────────── Book bat ─────────────────────────
export function createBookBat(color: string = BOOK_COLORS[0]): Rig<{ flap: number; flash: number }> {
  const M = new Mats();
  const root = new THREE.Group();
  root.name = 'bookBat';
  const bob = grp(root);
  const cover = M.get(color);
  const coverD = M.get(new THREE.Color(color).multiplyScalar(0.72));
  const gold = M.get(PAL.gold);
  const paper = M.get('#fbf1d6');
  const box = cached('box', () => new THREE.BoxGeometry(1, 1, 1));
  const L = 0.5;

  // spine (top, along Z)
  part(bob, G.cyl(), coverD, [0, 0.02, 0], [0.055, L, 0.055], [Math.PI / 2, 0, 0]);
  for (const z of [-0.16, 0.16]) part(bob, G.torus(0.056, 0.012, 6, 18), gold, [0, 0.02, z], 1, undefined, fo);

  // page wedge hanging below the spine (triangular prism, vertex down)
  const wedge = part(bob, cached('book-wedge', () => new THREE.CylinderGeometry(0.17, 0.17, 0.44, 3, 1)), paper, [0, -0.085, 0], 1, [Math.PI / 2, 0, 0]);
  void wedge;

  // covers (wings)
  const wings: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const pv = grp(bob, [s * 0.03, 0.03, 0]);
    part(pv, box, cover, [s * 0.2, 0, 0], [0.38, 0.03, L + 0.02]);
    part(pv, box, paper, [s * 0.18, -0.03, 0], [0.33, 0.035, L - 0.04]);
    part(pv, box, gold, [s * 0.21, 0.017, 0], [0.16, 0.008, 0.22], undefined, fo);
    part(pv, box, coverD, [s * 0.21, 0.02, 0], [0.11, 0.008, 0.16], undefined, fo);
    // gold corners
    for (const z of [-1, 1]) part(pv, G.ball(), gold, [s * 0.375, 0, z * (L / 2)], [0.025, 0.022, 0.025], undefined, fo);
    wings.push(pv);
  }

  // face on the wedge front
  const black = basic('#1b1214');
  const white = basic('#ffffff');
  const eyeWhites: THREE.Mesh[] = [];
  for (const s of [1, -1]) {
    eyeWhites.push(part(bob, G.ball(), white, [s * 0.048, -0.05, 0.226], [0.036, 0.04, 0.012], undefined, fo));
    part(bob, G.ball(), black, [s * 0.042, -0.056, 0.236], [0.018, 0.022, 0.008], undefined, fo);
    part(bob, G.capsule(0.008, 0.035), black, [s * 0.05, -0.002, 0.234], 1, [0, 0, Math.PI / 2 + s * 0.45], fo);
  }
  part(bob, G.arc(0.025, 0.007, Math.PI), black, [0, -0.13, 0.228], [1, 0.8, 0.5], undefined, fo);
  // bookmark ribbon "tongue"
  const ribbon = grp(bob, [0, -0.2, 0.17]);
  part(ribbon, box, M.get('#e8383d'), [0, -0.08, 0], [0.04, 0.16, 0.008]);
  part(ribbon, G.cone(), M.get('#e8383d'), [0, -0.17, 0], [0.028, 0.04, 0.006], [Math.PI, 0, 0], fo);

  let t = Math.random() * 3;
  const blinker = new Blinker();
  return {
    root,
    update(dt, a) {
      t += Math.min(dt, 0.1);
      const s = Math.sin(a.flap);
      const ang = 0.12 + 0.72 * s;
      wings[0].rotation.z = ang;
      wings[1].rotation.z = -ang;
      bob.position.y = -s * 0.045;
      bob.rotation.x = Math.cos(a.flap) * 0.06;
      ribbon.rotation.x = 0.25 + Math.cos(a.flap * 1.0) * 0.25;
      ribbon.rotation.z = Math.sin(t * 3) * 0.15;
      const bl = blinker.update(dt);
      for (const e of eyeWhites) e.scale.y = 0.04 * (1 - 0.85 * bl);
      M.flash(a.flash);
    },
  };
}

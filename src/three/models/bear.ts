import * as THREE from 'three';
import { PAL, basic, canvasTex } from '../gfx';
import type { Rig } from './rig';
import { G, Mats, TAU, clamp, lerp, damp, smooth, grp, part, merge, surf, cached, Blinker, vis } from './kit';

export interface BearAnim {
  state: 'sit' | 'stand' | 'walk';
  talk: number;
  /** 0..1 raises the free arm and waves */
  wave: number;
  speed: number;
}

const BODY_SIT_Y = 0.74;
const BODY_STAND_Y = 1.1;

function vestTex() {
  return canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = PAL.vest; g.fillRect(0, 0, w, h);
    // soft vertical folds
    for (let i = 0; i < 12; i++) { g.fillStyle = 'rgba(80,10,10,0.10)'; g.fillRect(i * (w / 12), 0, 10, h); }
    const patch = (x: number, y: number, pw: number, ph: number, col: string, rot: number) => {
      g.save(); g.translate(x, y); g.rotate(rot);
      g.fillStyle = col; g.fillRect(-pw / 2, -ph / 2, pw, ph);
      g.strokeStyle = '#f6e6c4'; g.lineWidth = 3; g.setLineDash([7, 6]);
      g.strokeRect(-pw / 2 + 5, -ph / 2 + 5, pw - 10, ph - 10);
      g.restore();
    };
    patch(w * 0.2, h * 0.55, 70, 60, '#d8a23a', 0.15);
    patch(w * 0.52, h * 0.35, 60, 52, '#5a7ab0', -0.1);
    patch(w * 0.83, h * 0.62, 64, 58, '#7a9a4a', 0.2);
    // hem stitch
    g.strokeStyle = '#f0d0a0'; g.lineWidth = 3; g.setLineDash([10, 8]);
    g.beginPath(); g.moveTo(0, h - 14); g.lineTo(w, h - 14); g.stroke();
  });
}

function thimbleTex() {
  return canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = PAL.thimble; g.fillRect(0, 0, w, h);
    const rows = 7, cols = 18;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = (c + (r % 2 ? 0.5 : 0) + 0.25) * (w / cols);
        const y = (r + 0.6) * (h / (rows + 0.6));
        g.fillStyle = '#8c93a3';
        g.beginPath(); g.ellipse(x, y, 4.2, 4.2, 0, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.55)';
        g.beginPath(); g.ellipse(x + 1.2, y + 1.4, 2, 1.4, 0, 0, TAU); g.fill();
      }
    }
  }, { wrap: true });
}

const beardGeo = () => cached('bear-beard', () => merge([
  { g: G.sphere(), p: [0, -0.02, 0.07], s: 0.12 },
  { g: G.sphere(), p: [0.13, 0.01, 0.03], s: 0.105 },
  { g: G.sphere(), p: [-0.13, 0.01, 0.03], s: 0.105 },
  { g: G.sphere(), p: [0.23, 0.07, -0.04], s: 0.085 },
  { g: G.sphere(), p: [-0.23, 0.07, -0.04], s: 0.085 },
  { g: G.sphere(), p: [0.07, -0.14, 0.03], s: 0.095 },
  { g: G.sphere(), p: [-0.07, -0.14, 0.03], s: 0.095 },
  { g: G.sphere(), p: [0.17, -0.09, -0.01], s: 0.08 },
  { g: G.sphere(), p: [-0.17, -0.09, -0.01], s: 0.08 },
  { g: G.sphere(), p: [0, -0.25, 0.0], s: 0.08 },
]));

const browGeo = () => cached('bear-brow', () => merge([
  { g: G.ball(), p: [-0.055, -0.006, 0], s: 0.042 },
  { g: G.ball(), p: [0, 0.008, 0.005], s: 0.05 },
  { g: G.ball(), p: [0.056, 0.0, 0], s: 0.044 },
  { g: G.ball(), p: [0.02, 0.03, -0.01], s: 0.035 },
]));

export function createBear(): Rig<BearAnim> {
  const M = new Mats();
  const black = basic('#1b1214');
  const white = basic('#ffffff');
  const fur = M.get(PAL.bear);
  const light = M.get(PAL.bearLight);
  const fo = { cast: false };

  const root = new THREE.Group();
  root.name = 'bear';
  const bodyG = grp(root, [0, BODY_SIT_Y, 0], undefined, 'body');
  const torso = grp(bodyG);

  part(torso, G.sphere(), fur, undefined, [0.78, 0.74, 0.7]);
  const belly = part(torso, G.sphere(), light, [0, -0.1, 0.43], [0.52, 0.56, 0.3]);
  // vest: open sphere shell (gap in front)
  const vestGeo = cached('bear-vest', () => new THREE.SphereGeometry(1, 40, 18, Math.PI / 2 + 0.62, TAU - 1.24, 0.4, 1.45));
  part(torso, vestGeo, M.get('#ffffff', { map: vestTex(), side: THREE.DoubleSide }), [0, 0.01, 0], [0.81, 0.77, 0.73]);
  for (const y of [0.2, -0.05]) {
    const a = Math.PI / 2 + 0.62;
    const r = Math.sin(0.4 + 1.45 * (0.5 - y * 0.6));
    part(torso, G.ball(), M.get(PAL.glasses), [-Math.cos(a) * 0.81 * r, y, Math.sin(a) * 0.73 * r + 0.02], 0.035);
  }

  // legs
  const legs: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const hip = grp(torso, [s * 0.36, -0.5, 0.3]);
    part(hip, G.capsule(0.2, 0.26), fur, [0, -0.2, 0]);
    part(hip, G.sphere(), fur, [0, -0.46, 0.07], [0.19, 0.14, 0.26]);
    part(hip, G.sphere(), light, [0, -0.585, 0.06], [0.13, 0.03, 0.15], undefined, fo);
    for (const [x, z] of [[-0.085, 0.2], [0, 0.235], [0.085, 0.2]] as const) part(hip, G.ball(), light, [x, -0.57, z], [0.045, 0.025, 0.045], undefined, fo);
    legs.push(hip);
  }

  // arms
  const mkArm = (s: number) => {
    const sh = grp(torso, [s * 0.66, 0.36, 0.05]);
    sh.rotation.order = 'YXZ';
    part(sh, G.capsule(0.15, 0.28), fur, [0, -0.19, 0]);
    const paw = grp(sh, [0, -0.42, 0]);
    part(paw, G.sphere(), fur, undefined, 0.165);
    part(paw, G.sphere(), light, [0, -0.06, 0.08], [0.1, 0.08, 0.07], undefined, fo);
    return { sh, paw };
  };
  const armMug = mkArm(-1); // right paw (−X) holds the mug
  const armFree = mkArm(1);
  const mugHold = grp(armMug.paw);
  const mug = grp(mugHold, [0.04, 0.03, 0.14]);
  const mugM = M.get('#f3e7cf');
  part(mug, G.cyl(), mugM, [0, 0, 0], [0.105, 0.2, 0.105]);
  part(mug, G.cyl(), M.get('#d8463c'), [0, 0.03, 0], [0.108, 0.045, 0.108]);
  part(mug, G.cyl(), M.get('#6a3a1e'), [0, 0.097, 0], [0.088, 0.01, 0.088], undefined, fo);
  part(mug, G.torus(0.055, 0.017, 8, 16), mugM, [0.11, 0, 0], 1);
  const steam: THREE.Mesh[] = [];
  const steamM = basic('#ffffff', { transparent: true, opacity: 0.55, depthWrite: false });
  for (let i = 0; i < 3; i++) {
    const m = part(mug, G.ball(), steamM, [0, 0.16 + i * 0.07, 0], 0.03, undefined, { cast: false, receive: false });
    m.layers.set(1);
    steam.push(m);
  }

  // head
  const neck = grp(torso, [0, 0.72, 0.06]);
  const head = grp(neck, [0, 0.22, 0.04], undefined, 'head');
  head.rotation.order = 'YXZ';
  const HR = 0.47;
  part(head, G.sphere(), fur, undefined, [HR, HR * 0.95, HR]);
  for (const s of [1, -1]) {
    part(head, G.sphere(), fur, [s * 0.33, 0.31, -0.06], [0.135, 0.13, 0.09]);
    part(head, G.sphere(), light, [s * 0.33, 0.3, -0.0], [0.085, 0.08, 0.04], undefined, fo);
  }
  part(head, G.sphere(), light, [0, -0.12, 0.36], [0.24, 0.175, 0.18]);
  part(head, G.sphere(), M.get('#2a1b1a'), [0, -0.04, 0.53], [0.085, 0.06, 0.06]);
  part(head, G.ball(), white, [0.03, -0.015, 0.583], 0.016, undefined, fo);
  const mouthG = grp(head, [0, -0.2, 0.5]);
  const smile = part(mouthG, G.arc(0.05, 0.011, Math.PI), black, [0, 0.02, 0.02], [1, 0.8, 0.6], [0, 0, Math.PI], fo);
  const mouthOpen = part(mouthG, G.ball(), basic('#5a1620'), [0, -0.01, 0.0], [0.07, 0.04, 0.04], undefined, fo);
  const beard = part(head, beardGeo(), M.get(PAL.moss), [0, -0.33, 0.33]);
  // eyes + glasses
  const eyeMeshes: THREE.Mesh[] = [];
  for (const s of [1, -1]) {
    const e = surf(head, s * 0.33, 0.12, HR * 0.97);
    eyeMeshes.push(part(e, G.ball(), black, [0, 0, 0.004], [0.042, 0.05, 0.022], undefined, fo));
    part(e, G.ball(), white, [0.014, 0.018, 0.022], 0.012, undefined, fo);
    const gl = surf(head, s * 0.33, 0.12, HR + 0.03);
    part(gl, G.torus(0.1, 0.017, 8, 28), M.get(PAL.glasses), undefined, 1, undefined, fo);
    part(gl, G.ball(), basic('#cfe8ff', { transparent: true, opacity: 0.25 }), [0, 0, -0.004], [0.095, 0.095, 0.01], undefined, { cast: false, receive: false }).layers.set(1);
    // temple arm
    const tmp = grp(head, [s * 0.28, 0.08, 0.3]);
    part(tmp, G.cyl(), M.get(PAL.glasses), [s * 0.08, 0.0, -0.13], [0.012, 0.32, 0.012], [Math.PI / 2, -s * 0.5, 0], fo);
  }
  part(head, G.capsule(0.014, 0.07), M.get(PAL.glasses), [0, 0.1, 0.475], 1, [0, 0, Math.PI / 2], fo);
  const brows: THREE.Mesh[] = [];
  for (const s of [1, -1]) {
    const bg = surf(head, s * 0.33, 0.42, HR * 0.96);
    brows.push(part(bg, browGeo(), M.get('#b9b4ad'), [0, 0, 0.02], [s, 1, 1], [0, 0, -s * 0.18]));
  }
  // thimble hat
  const hat = grp(head, [0.09, 0.4, -0.04], [-0.12, 0, -0.24]);
  const tTex = thimbleTex();
  const thM = M.get('#ffffff', { map: tTex });
  part(hat, cached('bear-thimble', () => new THREE.CylinderGeometry(0.2, 0.235, 0.3, 32, 1, true)), M.get('#ffffff', { map: tTex, side: THREE.DoubleSide }), [0, 0.15, 0]);
  part(hat, G.dome(), thM, [0, 0.3, 0], [0.2, 0.09, 0.2]);
  part(hat, G.torus(0.235, 0.028, 8, 32), M.get('#aeb4c2'), [0, 0.005, 0], 1, [Math.PI / 2, 0, 0]);

  // ── anim ──
  const blinker = new Blinker();
  let t = 0, phase = 0, standK = 0, waveK = 0, talkK = 0;
  const legSit = -Math.PI / 2 + 0.12;

  function update(dt: number, a: BearAnim) {
    dt = Math.min(dt, 0.1);
    t += dt;
    const standing = a.state !== 'sit';
    standK = damp(standK, standing ? 1 : 0, 5, dt);
    const sk = smooth(standK);
    const walking = a.state === 'walk';
    const spd = clamp(a.speed, 0, 1);
    if (walking) phase += dt * (4 + 4 * spd);
    const ws = walking ? Math.sin(phase) : 0;
    waveK = damp(waveK, clamp(a.wave), 8, dt);
    talkK = damp(talkK, clamp(a.talk), 20, dt);

    const breathe = Math.sin(t * 1.7);
    bodyG.position.y = lerp(BODY_SIT_Y, BODY_STAND_Y, sk) + (walking ? Math.abs(ws) * 0.04 : 0);
    bodyG.rotation.z = walking ? ws * 0.09 : 0;
    torso.scale.set(1 + 0.008 * breathe, 1 + 0.014 * breathe, 1 + 0.008 * breathe);
    belly.scale.set(0.52, 0.56, 0.3 + 0.012 * breathe);

    legs[0].rotation.x = lerp(legSit, walking ? -ws * 0.4 : 0, sk);
    legs[1].rotation.x = lerp(legSit, walking ? ws * 0.4 : 0, sk);
    legs[0].rotation.z = lerp(0.12, 0.05, sk);
    legs[1].rotation.z = lerp(-0.12, -0.05, sk);

    // mug arm: holds the mug in front of the belly, sips occasionally
    const sip = smooth(clamp(Math.sin(t * 0.45) * 4 - 3.2)) * (1 - talkK);
    armMug.sh.rotation.set(lerp(-0.95, -1.75, sip) + (walking ? ws * 0.05 : 0), lerp(0.55, 0.7, sip), lerp(-0.22, -0.1, sip));
    mugHold.quaternion.copy(armMug.sh.quaternion).invert();
    mug.rotation.z = -sip * 0.5;
    // free arm: rest on the belly ↔ raised waving
    const wv = smooth(waveK);
    const wiggle = Math.sin(t * 9) * 0.38 * wv;
    armFree.sh.rotation.set(lerp(-0.55 + (walking ? -ws * 0.3 : 0), -0.25, wv), lerp(-0.4, 0, wv), lerp(0.3, 2.55, wv) + wiggle);

    neck.rotation.x = Math.sin(t * 9.5) * 0.04 * talkK + 0.02 * breathe;
    head.rotation.set(-0.04 * wv, 0, Math.sin(t * 0.6) * 0.04 + wiggle * 0.08);

    const open = talkK * (0.55 + 0.45 * Math.sin(t * 15));
    vis(mouthOpen, open > 0.08);
    vis(smile, open <= 0.08);
    mouthOpen.scale.set(0.065, 0.012 + 0.05 * open, 0.04);
    beard.position.y = -0.33 - 0.035 * open;
    const bl = blinker.update(dt);
    for (const e of eyeMeshes) e.scale.y = 0.05 * (1 - 0.9 * bl);
    for (let i = 0; i < 2; i++) brows[i].position.y = 0.012 * talkK * Math.max(0, Math.sin(t * 4)) + 0.015 * wv;
    for (let i = 0; i < steam.length; i++) {
      const k = (t * 0.5 + i / steam.length) % 1;
      steam[i].position.set(Math.sin(k * 6 + i) * 0.03, 0.12 + k * 0.25, 0);
      steam[i].scale.setScalar(0.02 + k * 0.035);
      (steam[i].material as THREE.MeshBasicMaterial).opacity = 0.5;
      steam[i].visible = k < 0.9;
    }
  }

  return { root, update };
}

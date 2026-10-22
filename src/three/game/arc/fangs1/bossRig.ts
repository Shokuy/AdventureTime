import * as THREE from 'three';
import { basic, noOutline } from '../../../gfx';
import { G, Mats, TAU, clamp, damp, grp, part, cached, Blinker } from '../../../models/kit';
import type { Rig } from '../../../models/rig';
import { createBat, createStars, spinStars, type VAnim } from '../vampires';

/**
 * Граф Нетопырь (docs/script-fangs.md §0: «тощий вампир-франт, монокль, плащ-крылья»): a tall thin dandy in a tailcoat,
 * a red cravat, slick hair with a widow's peak, a gold monocle on a chain, a thin moustache and fangs. His cape opens
 * into two bat wings when he flies. Poses (`st`): perch, fly, tele (screech before a swoop), dive, drop (a bomb),
 * summon (arms up), snuff (a cape sweep), down (knocked down, dizzy on the floor), hurt, rise; v2: bow (a judge's bow /
 * sniffing a lantern), reveal (the cape thrown open, the lining shown), sip (a straw in the mouth, hovering), pose
 * («Ах! Софиты!» — frozen in the light, a hand up, chin up). `small` 0..1 shrinks him
 * into a little bat (the defeat, §13.4). Feet at the origin, facing +Z, ≈ 2.3 m tall.
 */
export interface CountAnim {
  st: string; p: number; flash: number; talk: number; small: number; glow: number; speed: number;
  /** v2: the monocle's glint 0..1 (before a swoop; in the dark) */
  glint?: number;
}
export interface CountRig extends Rig<CountAnim> {
  top: number; M: Mats; bat: THREE.Group;
  /**
   * v2 §2.1 the cape's lining, sewn from patches of drunk colours: `n` patches (a new one after each phase), `fade`
   * 0..1 the colours draining out of it (the defeat)
   */
  lining(n: number, fade?: number): void;
  /** the monocle (world position, for the defeat's falling monocle) */
  monocle: THREE.Object3D;
}

const fo = { cast: false };
const SKIN = '#ddd2ea', SKIN_D = '#bba8d4';
const COAT = '#2a1f3e', COAT_L = '#3e2e5a';
const CAPE = '#1f1730', CAPE_IN = '#b31c3c';
const HAIR = '#1a1226';

function wingGeo() {
  return cached('count-wing', () => {
    const s = new THREE.Shape();
    s.moveTo(0, 0.1);
    s.quadraticCurveTo(0.5, 0.36, 1, 0.2);
    s.quadraticCurveTo(0.93, -0.16, 0.82, -0.42);
    s.quadraticCurveTo(0.72, -0.2, 0.6, -0.36);
    s.quadraticCurveTo(0.5, -0.14, 0.36, -0.4);
    s.quadraticCurveTo(0.22, -0.16, 0.08, -0.46);
    s.lineTo(0, -0.3);
    s.lineTo(0, 0.1);
    const g = new THREE.ShapeGeometry(s, 12);
    g.rotateX(Math.PI / 2);
    return g;
  });
}

/** a soft four-pointed star (the monocle's glint) */
let glintT: THREE.Texture | null = null;
function glintTex(): THREE.Texture {
  return glintT ??= (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 30);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,240,200,0.6)'); r.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(255,255,255,0.95)';
    for (const [w, h] of [[3, 30], [30, 3]]) { g.beginPath(); g.ellipse(32, 32, w, h, 0, 0, Math.PI * 2); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
}

export function createCount(): CountRig {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'count';
  const all = grp(root);
  const body = grp(all, [0, 0, 0]);
  // ── legs ──
  const trousers = M.get('#1c1528'), shoe = M.get('#0f0a16');
  const legs: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const l = grp(body, [s * 0.13, 0.86, 0]);
    part(l, G.capsule(0.06, 0.62), trousers, [0, -0.42, 0]);
    part(l, G.sphere(), shoe, [0, -0.82, 0.07], [0.07, 0.05, 0.16]);
    part(l, G.cone(), shoe, [0, -0.81, 0.24], [0.03, 0.09, 0.03], [Math.PI / 2 - 0.25, 0, 0], fo);
    legs.push(l);
  }
  // ── torso: a tailcoat, shirt front, red cravat ──
  const torso = grp(body, [0, 0.86, 0]);
  part(torso, G.sphere(), M.get(COAT), [0, 0.38, 0], [0.24, 0.44, 0.19]);
  part(torso, G.sphere(), M.get('#f2eaf6'), [0, 0.46, 0.11], [0.1, 0.3, 0.1]);
  for (const s of [1, -1]) part(torso, G.cone(), M.get(COAT), [s * 0.12, -0.08, -0.12], [0.09, 0.42, 0.05], [Math.PI + 0.2, 0, s * 0.18]);
  part(torso, G.sphere(), M.get(CAPE_IN), [0, 0.72, 0.17], [0.07, 0.06, 0.05], undefined, fo);
  for (const s of [1, -1]) part(torso, G.cone(), M.get(CAPE_IN), [s * 0.06, 0.66, 0.18], [0.04, 0.1, 0.03], [Math.PI, 0, s * 0.3], fo);
  for (let i = 0; i < 3; i++) part(torso, G.ball(), M.get('#e8c24a'), [0, 0.5 - i * 0.12, 0.2], 0.02, undefined, fo);
  // the high collar
  for (const s of [1, -1]) {
    const c = part(torso, G.cone(), M.get(CAPE_IN, { side: THREE.DoubleSide }), [s * 0.17, 0.88, -0.07], [0.15, 0.32, 0.02], [0.2, s * 0.5, s * -0.3]);
    c.castShadow = false;
  }
  // v2: the lining — patches of the colours he drank (a canvas; redrawn per phase / as it fades)
  const linC = document.createElement('canvas'); linC.width = linC.height = 128;
  const linT = new THREE.CanvasTexture(linC); linT.colorSpace = THREE.SRGBColorSpace;
  const PATCHES = ['#e8285a', '#ff8ab8', '#5ad86a', '#ff9a3a', '#7ad8ff', '#ffd34a', '#c070ff'];
  let linKey = '';
  const drawLining = (n: number, fade: number) => {
    const key = n + ':' + fade.toFixed(2);
    if (key === linKey) return;
    linKey = key;
    const g = linC.getContext('2d')!;
    const grey = (hex: string) => { const c = new THREE.Color(hex); const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11; c.lerp(new THREE.Color(l * 0.85, l * 0.85, l * 0.9), fade); return '#' + c.getHexString(); };
    g.fillStyle = grey(CAPE_IN); g.fillRect(0, 0, 128, 128);
    // patches in a fixed order (the same on every machine), stitched with pale thread
    const spots = [[8, 10, 50, 40], [66, 6, 54, 46], [10, 60, 44, 56], [60, 58, 60, 30], [58, 94, 62, 30], [30, 40, 40, 30], [84, 40, 40, 40]];
    for (let i = 0; i < Math.min(n, spots.length); i++) {
      const [x, y, w, h] = spots[i];
      g.fillStyle = grey(PATCHES[i]);
      g.beginPath(); g.moveTo(x, y + 4); g.lineTo(x + w - 3, y); g.lineTo(x + w, y + h - 5); g.lineTo(x + 4, y + h); g.closePath(); g.fill();
      g.setLineDash([3, 3]); g.strokeStyle = grey('#fff0d8'); g.lineWidth = 1.6; g.stroke(); g.setLineDash([]);
    }
    linT.needsUpdate = true;
  };
  drawLining(3, 0);
  const linMat = (side: THREE.Side) => M.get('#ffffff', { side, map: linT });
  // the folded cape (shown when he stands)
  const capeGeo = cached('count-cape', () => new THREE.CylinderGeometry(0.22, 0.46, 1.25, 18, 1, true, Math.PI - Math.PI * 0.55, Math.PI * 1.1));
  const capeG = grp(torso, [0, 0.8, -0.03]);
  part(capeG, capeGeo, M.get(CAPE, { side: THREE.FrontSide }), [0, -0.62, 0]);
  part(capeG, capeGeo, linMat(THREE.BackSide), [0, -0.62, 0], 0.985, undefined, fo);
  // ── wings (the cape spread) ──
  const mem = M.get(CAPE, { side: THREE.DoubleSide }), lining = linMat(THREE.DoubleSide), boneM = M.get('#120c1a');
  const wingP: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const pv = grp(torso, [s * 0.16, 0.72, -0.08]);
    const w = part(pv, wingGeo(), mem, [0, 0, 0], [1.9 * s, 1, 1.9]);
    w.castShadow = true;
    part(pv, wingGeo(), lining, [0, -0.012, 0], [1.84 * s, 1, 1.84], undefined, fo);
    part(pv, G.capsule(0.018, 0.9), boneM, [s * 0.9, 0.01, 0.3], [1, 1.9, 1], [0, 0, Math.PI / 2], fo);
    wingP.push(pv);
  }
  // ── arms ──
  const arms: THREE.Group[] = [];
  const skin = M.get(SKIN), skinD = M.get(SKIN_D);
  for (const s of [1, -1]) {
    const a = grp(torso, [s * 0.25, 0.7, 0]);
    part(a, G.capsule(0.05, 0.42), M.get(COAT_L), [0, -0.24, 0]);
    part(a, G.sphere(), M.get('#f2eaf6'), [0, -0.48, 0], 0.055);
    const hand = grp(a, [0, -0.54, 0.02]);
    part(hand, G.sphere(), skin, [0, 0, 0], [0.06, 0.07, 0.05]);
    for (let i = -1; i <= 1; i++) part(hand, G.cone(), basic('#efe8f8'), [i * 0.025, -0.08, 0.02], [0.012, 0.05, 0.012], [Math.PI, 0, 0], fo);
    arms.push(a);
  }
  // ── head: long pale face, ears, slick hair, eyes, monocle, moustache, fangs ──
  const head = grp(torso, [0, 1.02, 0.03]);
  part(head, G.sphere(), skin, [0, 0, 0], [0.2, 0.27, 0.21]);
  part(head, G.sphere(), skin, [0, -0.17, 0.05], [0.12, 0.1, 0.13]);
  for (const s of [1, -1]) part(head, G.cone(), skinD, [s * 0.21, 0.06, -0.02], [0.05, 0.2, 0.03], [0, 0, s * -1.15]);
  part(head, G.dome(), M.get(HAIR), [0, 0.06, -0.02], [0.205, 0.25, 0.215], [-0.3, 0, 0]);
  part(head, G.cone(), M.get(HAIR), [0, 0.15, 0.17], [0.06, 0.14, 0.03], [Math.PI + 0.35, 0, 0], fo);
  const white = basic('#fff4f6'), pup = basic('#d0203a'), black = basic('#120c1a');
  const whites: THREE.Mesh[] = [];
  for (const s of [1, -1]) {
    whites.push(part(head, G.ball(), white, [s * 0.075, 0.03, 0.18], [0.05, 0.04, 0.025], undefined, fo));
    part(head, G.ball(), pup, [s * 0.072, 0.028, 0.198], [0.022, 0.026, 0.01], undefined, fo);
    part(head, G.capsule(0.01, 0.07), black, [s * 0.08, 0.085, 0.19], 1, [0, 0, Math.PI / 2 + s * 0.35], fo);
  }
  // the monocle on the right eye, a gold chain to the coat
  const gold = M.get('#e8c24a');
  part(head, G.torus(0.055, 0.009, 6, 20), gold, [-0.075, 0.03, 0.2], 1, undefined, fo);
  const glass = part(head, G.ball(), basic('#cfe8ff', { transparent: true, opacity: 0.35, depthWrite: false }), [-0.075, 0.03, 0.205], [0.05, 0.05, 0.006], undefined, fo);
  noOutline(glass);
  part(head, G.capsule(0.005, 0.32), gold, [-0.13, -0.15, 0.17], 1, [0.1, 0, 0.25], fo);
  const monocle = new THREE.Object3D(); monocle.position.set(-0.075, 0.03, 0.21); head.add(monocle);
  // v2: the monocle's glint (a four-pointed star sprite; the swoop's first telegraph, his tell in the dark)
  const glintM = new THREE.SpriteMaterial({ map: glintTex(), color: '#fff8d8', blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, opacity: 0 });
  const glintS = new THREE.Sprite(glintM); glintS.position.copy(monocle.position).add(new THREE.Vector3(0, 0, 0.03)); glintS.renderOrder = 6;
  noOutline(glintS); head.add(glintS);
  // v2: a striped straw («Глоточек»)
  const straw = grp(head, [0.02, -0.16, 0.2]);
  const strawGeo = cached('count-straw', () => new THREE.CylinderGeometry(0.014, 0.014, 0.9, 6).translate(0, 0.45, 0));
  part(straw, strawGeo, M.get('#ffffff'), [0, 0, 0], 1, undefined, fo);
  for (let i = 0; i < 4; i++) part(straw, G.torus(0.016, 0.006, 4, 8), M.get('#ff4a8a'), [0, 0.12 + i * 0.2, 0], 1, [Math.PI / 2, 0, 0], fo);
  straw.rotation.x = 2.1;
  straw.visible = false;
  // moustache
  for (const s of [1, -1]) part(head, G.capsule(0.01, 0.08), M.get(HAIR), [s * 0.05, -0.1, 0.21], 1, [0, 0, Math.PI / 2 + s * 0.35], fo);
  const mouth = grp(head, [0, -0.15, 0.19]);
  const mouthIn = part(mouth, G.ball(), basic('#4a0f1c'), [0, 0, 0], [0.06, 0.02, 0.02], undefined, fo);
  for (const k of [1, -1]) part(mouth, G.cone(), basic('#ffffff'), [k * 0.03, -0.02, 0.012], [0.014, 0.04, 0.014], [Math.PI, 0, 0], fo);
  // eyes glow (darkness, telegraphs)
  const glow = part(head, G.ball(), basic('#ff3040', { additive: true, opacity: 0, depthWrite: false }), [0, 0.03, 0.2], [0.18, 0.07, 0.03], undefined, { cast: false, receive: false });
  noOutline(glow);
  // dizzy stars
  const stars = createStars();
  stars.position.set(0, 2.45, 0);
  stars.visible = false;
  root.add(stars);
  // the little bat he becomes
  const bat = new THREE.Group();
  const br = createBat();
  bat.add(br.root);
  bat.visible = false;
  root.add(bat);
  const batAnim: VAnim = { st: 'fly', p: 0, speed: 0, flash: 0 };

  const blinker = new Blinker();
  const eyeY = whites.map((w) => w.scale.y);
  let t = 0, spread = 0, pitch = 0, lean = 0, sit = 0, open = 0, glowK = 0, armUp = 0, armF = 0, walk = 0;
  return {
    root, M, top: 2.35, bat, monocle,
    lining: (n, fade = 0) => drawLining(n, fade),
    update(dt, a) {
      dt = Math.min(dt, 0.05); t += dt;
      let wantSpread = 0, wantPitch = 0, wantLean = 0, wantSit = 0, wantOpen = a.talk, rate = 0, amp = 0, wantArmUp = 0, wantArmF = 0, wantGlow = a.glow;
      switch (a.st) {
        case 'fly': wantSpread = 1; rate = 7; amp = 0.45; wantPitch = 0.15; break;
        case 'tele': wantSpread = 1; rate = 0; wantPitch = -0.15; wantOpen = 1; wantGlow = Math.max(wantGlow, 0.6 + 0.4 * a.p); wantArmUp = 0.6; break;
        case 'dive': wantSpread = 0.55; rate = 0; wantPitch = 1.05; wantOpen = 0.8; wantGlow = Math.max(wantGlow, 1); wantArmF = 1.3; break;
        case 'drop': wantSpread = 1; rate = 9; amp = 0.35; wantArmF = 0.6 + Math.sin(a.p * Math.PI) * 0.8; wantOpen = 0.4; break;
        case 'summon': wantSpread = 1; rate = 5; amp = 0.3; wantArmUp = 1.4; wantOpen = 1; wantGlow = Math.max(wantGlow, 0.8); break;
        case 'snuff': wantSpread = 1; rate = 12; amp = 0.6; wantArmF = 1; wantLean = 0.3; break;
        case 'down': wantSit = 1; wantLean = -0.25; break;
        case 'hurt': wantSit = 1; wantLean = -0.5; wantOpen = 0.8; break;
        case 'rise': wantSpread = 1; rate = 14; amp = 0.7; wantPitch = -0.2; break;
        case 'walk': walk += dt * 6; break;
        case 'bow': wantPitch = 0.42 * (a.p > 0 ? a.p : 1); wantArmF = 0.5; wantArmUp = 0.15; break;
        case 'reveal': wantSpread = 1; rate = 0; wantArmUp = 0.75; wantPitch = -0.08; wantOpen = Math.max(wantOpen, 0.3); break;
        case 'sip': wantSpread = 1; rate = 4; amp = 0.18; wantPitch = 0.38; wantArmF = 0.4; break;
        case 'pose': wantSpread = 1; rate = 0; wantPitch = -0.22; wantArmUp = 1.2; wantGlow = Math.max(wantGlow, 0.5); break;
        default: break; // perch / idle: standing tall, cape closed
      }
      spread = damp(spread, wantSpread, 7, dt);
      pitch = damp(pitch, wantPitch, 8, dt);
      lean = damp(lean, wantLean, 8, dt);
      sit = damp(sit, wantSit, 9, dt);
      open = damp(open, Math.max(wantOpen, a.talk), 14, dt);
      glowK = damp(glowK, wantGlow, 8, dt);
      armUp = damp(armUp, wantArmUp, 8, dt);
      armF = damp(armF, wantArmF, 10, dt);
      // wings / cape
      const flap = rate > 0 ? Math.sin(t * rate) * amp : (a.st === 'tele' ? 0.5 + Math.sin(t * 40) * 0.05 : a.st === 'dive' ? -0.35 : a.st === 'reveal' ? 0.35 : a.st === 'pose' ? 0.6 + Math.sin(t * 30) * 0.03 : 0);
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1 : -1, pv = wingP[i];
        pv.visible = spread > 0.04;
        pv.scale.setScalar(Math.max(0.05, spread));
        pv.rotation.set(-0.15 * spread, s * (1 - spread) * 0.9, s * (flap * spread - (1 - spread) * 1.2));
      }
      capeG.visible = spread < 0.6;
      capeG.scale.set(1, 1 - spread * 0.4, 1);
      // body: sitting dazed / pitched in a dive
      body.position.y = -sit * 0.62 + (rate > 0 ? -Math.sin(t * rate) * 0.04 : 0);
      body.rotation.x = pitch + lean;
      legs[0].rotation.x = -sit * 1.4 + Math.sin(walk) * 0.5; legs[1].rotation.x = -sit * 1.4 - Math.sin(walk) * 0.5;
      legs[0].rotation.z = sit * 0.25; legs[1].rotation.z = -sit * 0.25;
      arms[0].rotation.set(-armF + Math.sin(t * 2) * 0.05 * (1 - spread), 0, armUp * 1.1 + sit * 0.3 + 0.08);
      arms[1].rotation.set(-armF * (a.st === 'drop' ? 0.2 : 1) + Math.sin(t * 2 + 1) * 0.05 * (1 - spread), 0, -armUp * 1.1 - sit * 0.3 - 0.08);
      // «Ах! Софиты!»: one hand up to the light, the other on the hip
      if (a.st === 'pose') { arms[1].rotation.set(0.2, 0, -0.9); arms[0].rotation.set(-0.3, 0, 2.6); }
      head.rotation.z = a.st === 'down' ? Math.sin(t * 3) * 0.2 : a.st === 'pose' ? 0.18 : 0;
      head.rotation.x = a.st === 'tele' ? -0.25 : a.st === 'pose' ? -0.3 : a.st === 'sip' ? 0.25 : 0;
      straw.visible = a.st === 'sip';
      const gl = clamp(a.glint ?? 0, 0, 1);
      glintM.opacity = gl;
      glintS.visible = gl > 0.01;
      glintS.scale.setScalar(0.12 + 0.5 * gl);
      glintM.rotation = t * 1.5;
      mouth.scale.set(1, 1 + open * 2.4, 1);
      mouthIn.visible = open > 0.12;
      (glow.material as THREE.MeshBasicMaterial).opacity = glowK * 0.85;
      const bl = blinker.update(dt);
      whites.forEach((e, i) => { e.scale.y = eyeY[i] * (1 - 0.9 * bl); });
      stars.visible = a.st === 'down';
      if (stars.visible) spinStars(stars, t, 0.55);
      // the little bat
      const sm = clamp(a.small, 0, 1);
      all.scale.setScalar(Math.max(0.01, 1 - sm * 0.95));
      all.visible = sm < 0.9;
      bat.visible = sm > 0.55;
      if (bat.visible) { bat.scale.setScalar(1.3 * (sm - 0.5) * 2); bat.position.y = 0.6 + Math.sin(t * 6) * 0.08; br.update(dt, batAnim); }
      M.flash(a.flash);
    },
  };
}

export { TAU };

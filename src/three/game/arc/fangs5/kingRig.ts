import * as THREE from 'three';
import { basic, canvasTex, noOutline, matU } from '../../../gfx';
import { G, Mats, TAU, clamp, damp, grp, part, cached, lerp } from '../../../models/kit';
import type { Rig } from '../../../models/rig';

/**
 * Король Полночь (docs/script-fangs.md §0: «высокий, бледно-серый, корона-полумесяц, плащ из чужих теней (в нём мелькают
 * силуэты)»), his giant shadow form against the moon (phase 3), the shadow hands that reach over the roof, and the
 * Солнечная пушка. Feet at y = 0, facing +Z; the King is ≈2.7 units tall (the hero is 1).
 */
const fo = { cast: false };

export interface KAnim {
  /** idle walk windup slash thrust cast fly dive stagger block kneel talk bow hover */
  st: string;
  p: number;
  speed: number;
  flash: number;
  talk: number;
  /** 0..1 bat wings unfolded (phase 2: «Крылья Нетопыря») */
  wings: number;
  /** 0..1 a star of light on the blade (the parry window) */
  glint: number;
  /** 0..1 the shadow sword is out */
  sword: number;
  /** 0..1 the cloak's stolen shadows stir (they flicker brighter) */
  stir: number;
  /** 0..1 burning (the solar shot) */
  burn: number;
}
export const kAnim = (): KAnim => ({ st: 'idle', p: 0, speed: 0, flash: 0, talk: 0, wings: 0, glint: 0, sword: 1, stir: 0, burn: 0 });

export interface KingRig extends Rig<KAnim> {
  M: Mats;
  head: THREE.Object3D;
  /** the blade's tip and middle (world positions via getWorldPosition) */
  tip: THREE.Object3D;
  /** the cloak (for the scenes: the girl with the guitar shows in it) */
  cloak: THREE.Object3D;
  /** a silhouette of a girl with a guitar in the folds (shown by the boss intro) */
  girl: THREE.Object3D;
  top: number;
}

// ───────────────────────── the cloak of stolen shadows ─────────────────────────
let cloakTexC: THREE.Texture | null = null;
function cloakTex() {
  if (cloakTexC) return cloakTexC;
  cloakTexC = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#1c162c'; g.fillRect(0, 0, w, h);
    // silhouettes of everyone he took a shadow from
    const person = (x: number, y: number, s: number, kind: number) => {
      g.save(); g.translate(x, y); g.scale(s, s);
      g.fillStyle = 'rgba(120,100,170,0.55)';
      g.beginPath(); g.arc(0, -46, 12, 0, TAU); g.fill();
      g.beginPath(); g.moveTo(-14, -34); g.lineTo(14, -34); g.lineTo(18, 10); g.lineTo(-18, 10); g.closePath(); g.fill();
      g.fillRect(-12, 10, 8, 26); g.fillRect(4, 10, 8, 26);
      if (kind === 1) { g.beginPath(); g.ellipse(-16, -40, 5, 14, 0.3, 0, TAU); g.ellipse(16, -40, 5, 14, -0.3, 0, TAU); g.fill(); g.beginPath(); g.ellipse(22, 0, 12, 9, 0.6, 0, TAU); g.fill(); g.fillRect(8, -24, 4, 26); }
      if (kind === 2) { g.beginPath(); g.arc(-10, -58, 6, 0, TAU); g.arc(10, -58, 6, 0, TAU); g.fill(); }
      if (kind === 3) { g.beginPath(); g.moveTo(-8, -58); g.lineTo(0, -74); g.lineTo(8, -58); g.fill(); }
      g.restore();
    };
    for (let i = 0; i < 14; i++) person(20 + i * 37, 120 + (i % 3) * 40, 0.8 + (i % 4) * 0.12, i === 5 ? 1 : i % 3 === 1 ? 2 : i % 5 === 2 ? 3 : 0);
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, 'rgba(0,0,0,0.35)'); gr.addColorStop(0.5, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(60,20,80,0.4)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, { wrap: true });
  return cloakTexC;
}
let girlTexC: THREE.Texture | null = null;
/** the girl with pigtails and a guitar (her shadow): black silhouette with soft edges */
export function girlTex() {
  if (girlTexC) return girlTexC;
  girlTexC = canvasTex(128, 192, (g) => {
    g.fillStyle = 'rgba(10,6,20,0.92)';
    g.beginPath(); g.arc(64, 44, 18, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(40, 50, 6, 18, 0.35, 0, TAU); g.ellipse(88, 50, 6, 18, -0.35, 0, TAU); g.fill();
    g.beginPath(); g.moveTo(44, 62); g.lineTo(84, 62); g.lineTo(92, 130); g.lineTo(36, 130); g.closePath(); g.fill();
    g.fillRect(46, 128, 12, 50); g.fillRect(70, 128, 12, 50);
    g.beginPath(); g.ellipse(94, 112, 20, 15, 0.5, 0, TAU); g.fill();
    g.save(); g.translate(78, 92); g.rotate(-0.7); g.fillRect(-3, -46, 6, 48); g.restore();
  });
  return girlTexC;
}

/** a scalloped bat wing (right wing: toward +X), size 1 */
function wingGeo() {
  return cached('f5kwing', () => {
    const s = new THREE.Shape();
    s.moveTo(0, 0.1); s.quadraticCurveTo(0.5, 0.42, 1.0, 0.32); s.quadraticCurveTo(0.92, 0.0, 0.84, -0.32);
    s.quadraticCurveTo(0.72, -0.12, 0.6, -0.3); s.quadraticCurveTo(0.48, -0.1, 0.34, -0.3); s.quadraticCurveTo(0.2, -0.1, 0, -0.22); s.lineTo(0, 0.1);
    return new THREE.ShapeGeometry(s, 10);
  });
}

/** a crescent moon ☾ (in XY, size 1, facing +Z) */
function crescentGeo() {
  return cached('f5cres', () => {
    const s = new THREE.Shape();
    s.absarc(0, 0, 1, Math.PI * 0.3, Math.PI * 1.7, false);
    s.absarc(0.42, 0, 0.78, Math.PI * 1.62, Math.PI * 0.38, true);
    return new THREE.ExtrudeGeometry(s, { depth: 0.18, bevelEnabled: false }).translate(0, 0, -0.09);
  });
}

export function createKingMidnight(): KingRig {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'kingMidnight';
  // (his pale face glows a little: it reads against the red moon behind him)
  const skin = matU('#e6e4ee', { emissive: '#56546a', emissiveIntensity: 0.55 }), skinD = matU('#c8c6d8', { emissive: '#3a3848', emissiveIntensity: 0.5 }), dark = M.get('#2a2438'), dark2 = M.get('#1e1830'), silver = M.get('#e8e4f4'), hair = M.get('#8c8a9e');
  const base = grp(root);
  // legs (long, dark, pointed boots)
  const legs: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const l = grp(base, [s * 0.16, 1.1, 0]);
    part(l, G.capsule(0.09, 0.85), dark2, [0, -0.5, 0]);
    part(l, G.sphere(), dark, [0, -1.02, 0.08], [0.1, 0.07, 0.2]);
    part(l, G.cone(), dark, [0, -1.0, 0.3], [0.05, 0.16, 0.05], [Math.PI / 2 - 0.25, 0, 0], fo);
    legs.push(l);
  }
  const body = grp(base, [0, 1.1, 0]);
  const torso = grp(body);
  part(torso, G.sphere(), dark, [0, 0.42, 0], [0.34, 0.5, 0.25]);
  for (const s of [1, -1]) part(torso, G.sphere(), M.get('#3a3250'), [s * 0.34, 0.8, 0], [0.16, 0.12, 0.16]);
  part(torso, G.sphere(), M.get('#3a3250'), [0, 0.44, 0.1], [0.16, 0.42, 0.17]);
  // a silver crescent brooch, a belt
  part(torso, G.torus(0.07, 0.018, 6, 16), silver, [0, 0.72, 0.24], 1, undefined, fo);
  part(torso, G.cyl(), M.get('#4a3a5a'), [0, 0.06, 0], [0.31, 0.08, 0.24]);
  // a white jabot under the chin
  const lace = M.get('#e8e4f0');
  for (let k = 0; k < 3; k++) part(torso, G.cone(), lace, [0, 0.86 - k * 0.09, 0.2 + k * 0.01], [0.1 - k * 0.015, 0.1, 0.05], [Math.PI, 0, 0]);
  // the cloak of stolen shadows: high collar, falling to the floor behind him
  const cloak = grp(torso, [0, 0.88, -0.05]);
  const ctex = cloakTex();
  const cloakM = matU('#ffffff', { map: ctex, side: THREE.DoubleSide });
  const cg = cached('f5kcloak', () => new THREE.CylinderGeometry(0.34, 0.95, 2.05, 22, 4, true, Math.PI - 1.45, 2.9));
  part(cloak, cg, cloakM, [0, -1.0, 0]);
  const inner = M.get('#5a1428', { side: THREE.BackSide });
  part(cloak, cg, inner, [0, -1.0, 0.01], 0.98, undefined, fo);
  for (const s of [1, -1]) {
    const c = part(cloak, G.cone(), M.get('#1e1830', { side: THREE.DoubleSide }), [s * 0.26, 0.14, 0.02], [0.18, 0.42, 0.04], [0.2, s * 0.6, s * -0.45]);
    c.castShadow = false;
  }
  // a girl with a guitar in the folds (shown when he «поправляет плащ»)
  const girl = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.63), new THREE.MeshBasicMaterial({ map: girlTex(), transparent: true, opacity: 0, depthWrite: false, color: '#b8a0ff' }));
  girl.position.set(0.18, -0.9, -0.7); girl.rotation.y = Math.PI; noOutline(girl);
  cloak.add(girl);
  // wings (phase 2), folded into the cloak
  const wingM = M.get('#2b1f3e', { side: THREE.DoubleSide });
  const wings: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const pv = grp(torso, [s * 0.2, 0.72, -0.18]);
    const w = new THREE.Mesh(wingGeo(), wingM); w.rotation.x = Math.PI / 2; w.scale.set(s * 2.4, 2.4, 1); w.castShadow = true;
    pv.add(w);
    wings.push(pv);
  }
  // arms: the right one holds the shadow sword
  const arms: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const a = grp(torso, [s * 0.36, 0.8, 0]);
    part(a, G.capsule(0.1, 0.4), dark, [0, -0.26, 0]);
    const fore = grp(a, [0, -0.5, 0]);
    part(fore, G.capsule(0.09, 0.3), dark, [0, -0.16, 0]);
    part(fore, G.cone(), M.get('#e8e4f0'), [0, -0.36, 0], [0.15, 0.2, 0.15], [Math.PI, 0, 0]);
    part(fore, G.sphere(), M.get('#9a98b4'), [0, -0.46, 0.02], [0.09, 0.1, 0.08]);
    for (let i = -1; i <= 1; i++) part(fore, G.cone(), M.get('#9a98b0'), [i * 0.03, -0.52, 0.05], [0.014, 0.06, 0.014], [Math.PI, 0, 0], fo);
    arms.push(a);
  }
  const sword = grp(arms[0].children[1] as THREE.Object3D, [0, -0.46, 0.06]);
  const bladeM = M.get('#160e24');
  part(sword, G.cyl(), M.get('#5a4a7a'), [0, 0, 0], [0.035, 0.24, 0.035], [Math.PI / 2, 0, 0]);
  part(sword, cached('f5guard', () => new THREE.BoxGeometry(0.34, 0.05, 0.07)), silver, [0, 0, 0.12]);
  const blade = part(sword, cached('f5blade', () => new THREE.CylinderGeometry(0.01, 0.06, 1.6, 4, 1).translate(0, 0.8, 0)), bladeM, [0, 0, 0.14], [1, 1, 0.35], [Math.PI / 2, 0, 0]);
  const edge = new THREE.Mesh(cached('f5edge', () => new THREE.CylinderGeometry(0.004, 0.075, 1.62, 4, 1).translate(0, 0.81, 0)), basic('#a070ff', { additive: true, transparent: true, opacity: 0.55, depthWrite: false }));
  edge.rotation.x = Math.PI / 2; edge.position.z = 0.14; edge.scale.set(1.3, 1, 0.5); noOutline(edge);
  sword.add(edge);
  const tip = grp(sword, [0, 0, 1.6]);
  const glintM = new THREE.SpriteMaterial({ color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const glint = new THREE.Sprite(glintM); glint.position.z = 1.15; glint.scale.setScalar(0.9); noOutline(glint);
  sword.add(glint);
  void blade;
  // the head: long and pale, pointed ears, slicked silver hair, the crescent crown
  const head = grp(torso, [0, 1.04, 0.02]);
  part(head, G.sphere(), skin, [0, 0.08, 0], [0.2, 0.26, 0.2]);
  part(head, G.sphere(), skin, [0, -0.08, 0.05], [0.12, 0.12, 0.13]);
  for (const s of [1, -1]) part(head, G.cone(), skinD, [s * 0.2, 0.1, -0.02], [0.045, 0.17, 0.03], [0, 0, s * -1.15]);
  part(head, G.dome(), hair, [0, 0.12, -0.03], [0.205, 0.22, 0.205], [-0.3, 0, 0]);
  part(head, G.cone(), hair, [0, 0.22, 0.17], [0.05, 0.11, 0.03], [Math.PI + 0.35, 0, 0], fo);
  // a silver circlet with spikes and a crescent moon on the front, horns up (☽ lying down)
  const crown = grp(head, [0, 0.25, -0.01]);
  crown.rotation.x = -0.22;
  part(crown, G.cyl(), silver, [0, 0.02, 0], [0.2, 0.07, 0.2]);
  for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2 + 0.45; part(crown, G.cone(), silver, [Math.sin(a) * 0.19, 0.11, Math.cos(a) * 0.19], [0.03, 0.12, 0.03]); }
  part(crown, crescentGeo(), M.get('#fff4c8'), [0, 0.2, 0.17], 0.12, [0, 0, Math.PI / 2]);
  const white = basic('#f4f2ff'), red = basic('#e0203a');
  const eyes: THREE.Mesh[] = [];
  for (const s of [1, -1]) {
    eyes.push(part(head, G.ball(), white, [s * 0.075, 0.08, 0.17], [0.05, 0.035, 0.025], undefined, fo));
    part(head, G.ball(), red, [s * 0.075, 0.08, 0.19], [0.016, 0.016, 0.01], undefined, fo);
    part(head, G.capsule(0.01, 0.07), basic('#3a3448'), [s * 0.075, 0.135, 0.18], 1, [0, 0, Math.PI / 2 + s * 0.35], fo);
  }
  const mouth = grp(head, [0, -0.07, 0.17]);
  const mouthIn = part(mouth, G.ball(), basic('#2a0c18'), [0, 0, 0], [0.05, 0.012, 0.01], undefined, fo);
  for (const s of [1, -1]) part(mouth, G.cone(), basic('#ffffff'), [s * 0.025, -0.012, 0.004], [0.01, 0.03, 0.01], [Math.PI, 0, 0], fo);
  // burning (the solar shot): an orange glow over the cloak
  const burnM = new THREE.MeshBasicMaterial({ color: '#ffa040', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const burnMesh = new THREE.Mesh(cg, burnM); burnMesh.position.y = -1.0; burnMesh.scale.setScalar(1.02); noOutline(burnMesh);
  cloak.add(burnMesh);

  let t = Math.random() * 5, walk = 0;
  const cur = { lean: 0, kneel: 0, armR: new THREE.Vector3(), armL: new THREE.Vector3(), wings: 0, twist: 0, crouch: 0 };
  return {
    root, M, head, tip, cloak, girl, top: 2.9,
    update(dt, a) {
      dt = Math.min(dt, 0.05); t += dt;
      walk += dt * clamp(a.speed, 0, 8) * 1.6;
      const sw = a.speed > 0.3 ? Math.sin(walk) : 0;
      // wanted pose
      let lean = 0, kneel = 0, twist = 0, crouch = 0;
      const R = new THREE.Vector3(0.2, 0, 0.15), Lw = new THREE.Vector3(0.1, 0, -0.15); // (rx, ry, rz) shoulder
      const p = a.p;
      switch (a.st) {
        case 'walk': R.set(0.3 - sw * 0.3, 0, 0.2); Lw.set(sw * 0.4, 0, -0.2); break;
        case 'windup': R.set(-2.4 * p - 0.4, -0.6 * p, 0.9 * p); Lw.set(-0.4, 0, -0.5); twist = -0.6 * p; crouch = 0.15 * p; break;
        case 'slash': { const k = Math.sin(Math.min(1, p * 2.2) * Math.PI / 2); R.set(lerp(-2.8, 0.6, k), lerp(-0.6, 1.3, k), lerp(0.9, 0.2, k)); twist = lerp(-0.6, 0.7, k); lean = 0.2; crouch = 0.1; Lw.set(0.6, 0, -0.9); break; }
        case 'thrust': R.set(-1.5, 0, 0.05); Lw.set(0.8, 0, -1.0); lean = 0.45; crouch = 0.2; break;
        case 'cast': R.set(-2.6, 0, 0.5); Lw.set(-2.6, 0, -0.5); lean = -0.15; break;
        case 'fly': case 'hover': R.set(0.3, 0, 0.6); Lw.set(0.3, 0, -0.6); lean = 0.25; break;
        case 'dive': R.set(-1.4, 0, 0.2); Lw.set(-0.5, 0, -0.3); lean = 1.0; break;
        case 'stagger': R.set(0.8 + Math.sin(t * 9) * 0.2, 0, 0.5); Lw.set(0.5, 0, -0.6); lean = 0.35 + Math.sin(t * 6) * 0.1; kneel = 0.4; break;
        case 'block': R.set(-1.2, 0.9, 0.3); Lw.set(-0.6, 0, -0.4); crouch = 0.12; break;
        case 'kneel': R.set(0.9, 0, 0.3); Lw.set(0.7, 0, -0.5); lean = 0.25; kneel = 1; break;
        case 'talk': R.set(0.2, 0, 0.2); Lw.set(-0.9 + Math.sin(t * 3) * 0.2, 0.5, -0.4); break;
        case 'bow': R.set(0.4, 0, 0.2); Lw.set(-0.4, 0.6, -0.2); lean = 0.5 * Math.sin(Math.min(1, p) * Math.PI); break;
        default: R.set(0.25 + Math.sin(t * 1.3) * 0.05, 0, 0.18); Lw.set(0.12, 0, -0.18);
      }
      const k = 1 - Math.exp(-dt * (a.st === 'slash' || a.st === 'thrust' ? 30 : 10));
      cur.armR.lerp(R, k); cur.armL.lerp(Lw, k);
      cur.lean = lerp(cur.lean, lean, k); cur.kneel = lerp(cur.kneel, kneel, k); cur.twist = lerp(cur.twist, twist, k); cur.crouch = lerp(cur.crouch, crouch, k);
      arms[0].rotation.set(cur.armR.x, cur.armR.y, cur.armR.z);
      arms[1].rotation.set(cur.armL.x, cur.armL.y, cur.armL.z);
      (arms[0].children[1] as THREE.Object3D).rotation.x = a.st === 'windup' ? -0.6 : -0.15;
      (arms[1].children[1] as THREE.Object3D).rotation.x = -0.25;
      body.rotation.x = cur.lean;
      body.rotation.y = cur.twist;
      const fly = a.st === 'fly' || a.st === 'hover' || a.st === 'dive';
      body.position.y = 1.1 - cur.kneel * 0.45 - cur.crouch * 0.3 + (fly ? 0 : Math.sin(t * 1.6) * 0.02);
      legs[0].rotation.x = fly ? 0.3 : sw * 0.5 - cur.kneel * 1.3; legs[1].rotation.x = fly ? 0.5 : -sw * 0.5 + cur.kneel * 0.2;
      legs[0].position.y = legs[1].position.y = 1.1 - cur.kneel * 0.45 - cur.crouch * 0.3;
      head.rotation.x = -cur.lean * 0.4 + (a.st === 'stagger' ? Math.sin(t * 7) * 0.2 : 0);
      head.rotation.z = a.st === 'stagger' ? Math.sin(t * 5) * 0.25 : 0;
      // cloak sways; stolen shadows drift inside it
      cloak.rotation.x = 0.08 + cur.lean * 0.3 + (fly ? 0.5 : 0) + Math.sin(t * 2) * 0.03;
      ctex.offset.x = (t * 0.02) % 1;
      cloakM.emissive.setRGB(0.12 * a.stir + a.flash * 0.9, 0.08 * a.stir + a.flash * 0.9, 0.2 * a.stir + a.flash * 0.9);
      // wings
      cur.wings = damp(cur.wings, a.wings, 8, dt);
      const flap = fly ? Math.sin(t * (a.st === 'dive' ? 0 : 9)) * 0.5 : 0;
      wings.forEach((w, i) => {
        const s = i === 0 ? 1 : -1;
        w.scale.setScalar(Math.max(0.01, cur.wings));
        w.rotation.set(0, s * (0.2 + (a.st === 'dive' ? 0.9 : 0)), s * (flap + 0.15));
        w.visible = cur.wings > 0.02;
      });
      // sword
      sword.scale.setScalar(Math.max(0.01, a.sword));
      sword.visible = a.sword > 0.02;
      glintM.opacity = a.glint;
      glint.scale.setScalar(0.5 + a.glint * 0.8 + Math.sin(t * 30) * 0.1 * a.glint);
      glint.material.rotation = t * 3;
      // face
      const bl = (t % 3.7) < 0.12 ? 1 : 0;
      for (const e of eyes) e.scale.y = 0.035 * (1 - 0.9 * bl);
      mouth.scale.set(1, 1 + a.talk * 3, 1);
      mouthIn.visible = true;
      burnM.opacity = a.burn * (0.45 + 0.25 * Math.sin(t * 20));
      M.flash(a.flash);
    },
  };
}

// ───────────────────────── the giant shadow (phase 3) ─────────────────────────
export interface GiantAnim { breath: number; reach: [number, number]; burn: number; fade: number; roar: number; bow: number }
export interface GiantRig extends Rig<GiantAnim> {
  /** shoulders (world: getWorldPosition) where the shadow arms start */
  shoulders: [THREE.Object3D, THREE.Object3D];
  chest: THREE.Object3D;
  head: THREE.Object3D;
  setOpacity(k: number): void;
}
export function createGiantShadow(): GiantRig {
  const root = new THREE.Group(); root.name = 'giantShadow';
  const mats: THREE.MeshBasicMaterial[] = [];
  const dm = (c: string, o = 0.94) => { const m = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, fog: false, depthWrite: true }); mats.push(m); return m; };
  const body = dm('#08040e'), rim = dm('#2a1240', 0.6);
  const s = 10; // ×10: ≈ 28 m tall
  const inner = grp(root);
  inner.scale.setScalar(s);
  const torso = grp(inner, [0, 1.2, 0]);
  part(torso, G.sphere(), body, [0, 0.4, 0], [0.42, 0.75, 0.3], undefined, fo);
  part(torso, G.cone(), body, [0, -0.55, 0], [0.62, 1.4, 0.4], [Math.PI, 0, 0], fo);
  const head = grp(torso, [0, 1.25, 0.02]);
  part(head, G.sphere(), body, [0, 0, 0], [0.24, 0.3, 0.22], undefined, fo);
  for (const sg of [1, -1]) part(head, G.cone(), body, [sg * 0.24, 0.04, 0], [0.06, 0.2, 0.04], [0, 0, sg * -1.15], fo);
  part(head, G.torus(0.21, 0.035, 8, 28), dm('#4a1828', 0.95), [0, 0.24, 0], 1, [Math.PI / 2 - 0.2, 0, 0], fo);
  part(head, crescentGeo(), dm('#7a2838', 0.95), [0, 0.46, 0.12], 0.18, undefined, fo);
  // glowing eyes
  const eyeM = new THREE.SpriteMaterial({ color: '#ff2040', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const eyes: THREE.Sprite[] = [];
  for (const sg of [1, -1]) { const e = new THREE.Sprite(eyeM); e.position.set(sg * 0.09, 0.03, 0.24); e.scale.set(0.16, 0.07, 1); noOutline(e); head.add(e); eyes.push(e); }
  // the cloak spread like wings against the moon
  const capes: THREE.Mesh[] = [];
  for (const sg of [1, -1]) {
    const sh = new THREE.Shape();
    sh.moveTo(0, 0.4); sh.quadraticCurveTo(0.9, 0.9, 1.9, 0.55); sh.quadraticCurveTo(1.7, 0.0, 1.75, -0.6);
    sh.quadraticCurveTo(1.4, -0.35, 1.25, -0.9); sh.quadraticCurveTo(1.0, -0.6, 0.8, -1.2); sh.quadraticCurveTo(0.5, -0.9, 0.2, -1.5); sh.lineTo(0, -1.4); sh.lineTo(0, 0.4);
    const m = new THREE.Mesh(new THREE.ShapeGeometry(sh, 10), dm('#0c0616', 0.88));
    m.scale.set(sg, 1, 1); m.position.set(0, 0.5, -0.12);
    (m.material as THREE.Material).side = THREE.DoubleSide;
    torso.add(m); capes.push(m);
    const edge = new THREE.Mesh(new THREE.ShapeGeometry(sh, 10), rim);
    edge.scale.set(sg * 1.03, 1.03, 1); edge.position.set(0, 0.48, -0.14);
    (edge.material as THREE.Material).side = THREE.DoubleSide;
    torso.add(edge);
  }
  const shoulders: [THREE.Object3D, THREE.Object3D] = [grp(torso, [0.42, 0.85, 0.1]), grp(torso, [-0.42, 0.85, 0.1])];
  // burning edge (the solar shot)
  const burnM = new THREE.MeshBasicMaterial({ color: '#ffa040', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
  for (const c of capes) { const b = new THREE.Mesh(c.geometry, burnM); b.scale.copy(c.scale).multiplyScalar(1.01); b.position.copy(c.position); b.position.z += 0.01; torso.add(b); }
  inner.traverse((o) => { if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).castShadow = false; (o as THREE.Mesh).receiveShadow = false; } });
  noOutline(inner);
  let t = 0;
  return {
    root, shoulders, chest: torso, head,
    setOpacity(k: number) { for (const m of mats) m.opacity = (m === rim ? 0.6 : 0.92) * k; },
    update(dt, a) {
      t += dt;
      torso.position.y = 1.2 + Math.sin(t * 1.2) * 0.03 * a.breath - a.bow * 0.4;
      torso.rotation.x = a.bow * 0.5 + a.roar * -0.15;
      capes.forEach((c, i) => { c.rotation.y = (i ? -1 : 1) * (0.1 + Math.sin(t * 1.5 + i) * 0.06); c.rotation.z = (i ? -1 : 1) * a.roar * 0.15; });
      for (const e of eyes) e.scale.set(0.16 + a.roar * 0.08, 0.07 + a.roar * 0.05 + (Math.sin(t * 7) > 0.97 ? -0.06 : 0), 1);
      eyeM.opacity = 1 - a.fade;
      burnM.opacity = a.burn * (0.55 + 0.3 * Math.sin(t * 18));
      head.rotation.z = Math.sin(t * 0.7) * 0.05;
      void a.reach;
    },
  };
}

// ───────────────────────── a shadow hand ─────────────────────────
export interface HandRig { root: THREE.Group; arm: THREE.Mesh; update(dt: number, pose: number, flash: number): void; setArm(from: THREE.Vector3, to: THREE.Vector3): void; dispose(): void }
/** pose: 0 open (reaching), 1 claw (slam), 2 fist (holding) */
export function createShadowHand(): HandRig {
  const root = new THREE.Group(); root.name = 'shadowHand';
  const m = new THREE.MeshToonMaterial({ color: '#0a0612', transparent: true, opacity: 0.95, emissive: new THREE.Color('#1a0626'), emissiveIntensity: 0.6 });
  const palm = grp(root);
  palm.scale.setScalar(1.6);
  part(palm, G.sphere(), m, [0, 0.35, 0], [0.75, 0.3, 0.85]);
  const fingers: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) {
    const f = grp(palm, [(i - 1.5) * 0.36, 0.35, 0.7]);
    part(f, G.capsule(0.12, 0.6), m, [0, 0, 0.4], 1, [Math.PI / 2, 0, 0]);
    part(f, G.cone(), basic('#8a5ab8'), [0, -0.02, 0.86], [0.08, 0.32, 0.06], [Math.PI / 2 + 0.5, 0, 0], fo);
    fingers.push(f);
  }
  const thumb = grp(palm, [0.82, 0.35, 0.1]);
  part(thumb, G.capsule(0.12, 0.45), m, [0, 0, 0.3], 1, [Math.PI / 2, 0, 0]);
  fingers.push(thumb);
  const arm = new THREE.Mesh(G.cyl(), m);
  arm.castShadow = false;
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
  let cur = 0;
  const up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3();
  return {
    root, arm,
    update(dt, pose, flash) {
      cur = damp(cur, pose, 10, dt);
      const curl = cur <= 1 ? cur * 0.9 : 0.9 + (cur - 1) * 0.9;
      fingers.forEach((f, i) => { f.rotation.x = curl * (i === 4 ? 0.8 : 1.4); });
      m.emissive.setRGB(0.1 + flash, 0.02 + flash, 0.15 + flash);
    },
    setArm(from, to) {
      d.copy(to).sub(from);
      const len = d.length();
      arm.position.copy(from).addScaledVector(d, 0.5);
      arm.quaternion.setFromUnitVectors(up, d.normalize());
      arm.scale.set(0.9, Math.max(0.01, len), 0.9);
    },
    dispose() { root.removeFromParent(); arm.removeFromParent(); },
  };
}

// ───────────────────────── the Sun cannon ─────────────────────────
export interface CannonRig { root: THREE.Group; muzzle: THREE.Object3D; update(dt: number, charge: number, fire: number): void }
export function createSunCannon(): CannonRig {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'sunCannon';
  const pink = M.get('#ff8ab8'), gold = M.get('#e8b840'), wood = M.get('#a8643a'), brass = M.get('#d8a040');
  for (const s of [1, -1]) {
    const w = grp(root, [s * 0.75, 0.62, 0]);
    part(w, G.torus(0.55, 0.1, 10, 24), gold, [0, 0, 0], 1, [0, Math.PI / 2, 0]);
    part(w, G.cyl(), pink, [0, 0, 0], [0.16, 0.14, 0.16], [0, 0, Math.PI / 2]);
    for (let i = 0; i < 6; i++) part(w, G.cyl(), wood, [0, 0, 0], [0.04, 1.0, 0.04], [i * Math.PI / 6, 0, 0], fo);
  }
  part(root, cached('f5carr', () => new THREE.BoxGeometry(1.2, 0.35, 1.8)), wood, [0, 0.75, -0.2]);
  const barrel = grp(root, [0, 1.15, 0.1]);
  barrel.rotation.x = -0.32;
  part(barrel, G.cyl(), brass, [0, 0, 0.6], [0.38, 1.9, 0.38], [Math.PI / 2, 0, 0]);
  for (const z of [-0.2, 0.5, 1.2]) part(barrel, G.torus(0.4, 0.06, 8, 24), pink, [0, 0, z]);
  part(barrel, cached('f5muz', () => new THREE.CylinderGeometry(0.52, 0.38, 0.5, 24, 1, true)), gold, [0, 0, 1.7], 1, [Math.PI / 2, 0, 0]);
  const muzzle = grp(barrel, [0, 0, 1.95]);
  // sun emblem on the side
  for (const s of [1, -1]) {
    const em = grp(barrel, [s * 0.39, 0, 0.4]);
    part(em, G.cyl(), gold, [0, 0, 0], [0.22, 0.03, 0.22], [0, 0, Math.PI / 2]);
    for (let i = 0; i < 8; i++) part(em, G.cone(), gold, [0, Math.cos(i * TAU / 8) * 0.28, Math.sin(i * TAU / 8) * 0.28], [0.05, 0.12, 0.03], [i * TAU / 8 + Math.PI / 2, 0, 0], fo);
  }
  // the syrup tank: a glass ball on top, golden syrup inside (the charge)
  const tank = grp(root, [0, 1.95, -0.55]);
  part(tank, G.sphere(), new THREE.MeshToonMaterial({ color: '#e8f4ff', transparent: true, opacity: 0.35 }), [0, 0, 0], 0.48, undefined, fo);
  const syrupM = new THREE.MeshBasicMaterial({ color: '#ffc020' });
  const syrup = part(tank, G.sphere(), syrupM, [0, -0.1, 0], 0.4, undefined, fo);
  part(tank, G.cyl(), gold, [0, -0.5, 0], [0.12, 0.2, 0.12]);
  const glowM = new THREE.SpriteMaterial({ color: '#ffd040', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const glow = new THREE.Sprite(glowM); glow.scale.setScalar(2.4); noOutline(glow); tank.add(glow);
  const mglow = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#fff0a0', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  mglow.scale.setScalar(2); noOutline(mglow); muzzle.add(mglow);
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
  let t = 0;
  return {
    root, muzzle,
    update(dt, charge, fire) {
      t += dt;
      const c = clamp(charge, 0, 1);
      syrup.scale.set(0.4 * (0.3 + 0.7 * c), 0.4 * (0.15 + 0.85 * c), 0.4 * (0.3 + 0.7 * c));
      syrup.position.y = -0.38 + 0.3 * c;
      syrupM.color.setRGB(1, 0.6 + 0.3 * c, 0.1 + 0.4 * c * (0.5 + 0.5 * Math.sin(t * 6)));
      glowM.opacity = c * (0.4 + 0.2 * Math.sin(t * 5));
      (mglow.material as THREE.SpriteMaterial).opacity = Math.max(fire, c > 0.98 ? 0.5 + 0.4 * Math.sin(t * 12) : 0);
      barrel.position.z = 0.1 - fire * 0.35;
      M.flash(0);
    },
  };
}

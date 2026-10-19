import * as THREE from 'three';
import { basic, noOutline } from '../../../gfx';
import { G, Mats, grp, part, damp, clamp, Blinker, cached } from '../../../models/kit';

/**
 * Шёпот: what you glimpse in the fight is a tall hooded cloak with huge ears and two pale eyes, long clawed arms
 * (the cloak is far too big for the one inside); in the defeat scene the cloak sags and a little, skinny, eared
 * vampire sits in it, hiding his face in his paws. Feet at y = 0, facing +Z. Own materials (invisibility, flash).
 */
export interface ShepotAnim {
  /** idle | stalk | tele (shimmer before a claw) | claw | aim | throw | blow (snuffs a light) | stun | hurt | small */
  st: string;
  p: number;
  speed: number;
  flash: number;
  /** 0 = the tall cloak, 1 = the little vampire sitting (the defeat) */
  small: number;
  /** 0..1 hiding the face in the paws (small form) */
  hide: number;
  talk: number;
  /** how visible (0..1): the eye glow follows it (the body's dither is the Invisibility's) */
  vis: number;
}
export interface ShepotRig { root: THREE.Group; M: Mats; top: number; hand: THREE.Object3D; update(dt: number, a: ShepotAnim): void }

const CLOAK = '#2a2142', CLOAK_IN = '#4a2a6a', SKIN = '#cfc3e8', EAR_IN = '#f0a8c8';

function cloakGeo() {
  return cached('f3-cloak', () => {
    const pts: THREE.Vector2[] = [];
    // a bell-shaped cloak: wide hem, narrow shoulders, the hood above
    const prof: [number, number][] = [[0.95, 0], [0.88, 0.25], [0.7, 0.7], [0.52, 1.2], [0.42, 1.55], [0.36, 1.75], [0.0, 1.8]];
    for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
    const g = new THREE.LatheGeometry(pts, 22);
    // a ragged hem
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < 0.05) { const a = Math.atan2(pos.getZ(i), pos.getX(i)); pos.setY(i, y + (Math.sin(a * 7) * 0.5 + 0.5) * 0.18); }
    }
    g.computeVertexNormals();
    return g;
  });
}

export function createShepot(): ShepotRig {
  const M = new Mats();
  const root = new THREE.Group(); root.name = 'shepot';
  const cloakM = M.get(CLOAK), inner = M.get(CLOAK_IN, { side: THREE.DoubleSide });
  const big = grp(root);
  const body = grp(big, [0, 0, 0]);
  const cloak = part(body, cloakGeo(), cloakM, [0, 0, 0], [1, 1.25, 1]);
  void cloak;
  const lining = part(body, cloakGeo(), inner, [0, 0.02, 0], [0.96, 1.2, 0.96]);
  lining.scale.multiplyScalar(0.98);
  // the hood + face hole in it
  const hood = grp(body, [0, 2.15, 0.02]);
  part(hood, G.sphere(), cloakM, [0, 0, 0], [0.42, 0.46, 0.44]);
  part(hood, G.sphere(), basic('#07050c'), [0, -0.04, 0.2], [0.3, 0.32, 0.28], undefined, { cast: false });
  // huge ears out of the hood
  const ears: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const e = grp(hood, [s * 0.3, 0.22, -0.02], [0, 0, s * -0.55]);
    part(e, G.cone(), M.get(SKIN), [0, 0.38, 0], [0.16, 0.8, 0.07]);
    part(e, G.cone(), M.get(EAR_IN), [0, 0.36, 0.035], [0.1, 0.6, 0.03], undefined, { cast: false });
    ears.push(e);
  }
  // pale eyes in the dark
  const eyeM = basic('#e8ecff');
  const eyes: THREE.Mesh[] = [];
  for (const s of [1, -1]) eyes.push(part(hood, G.ball(), eyeM, [s * 0.11, 0.0, 0.42], [0.075, 0.1, 0.04], undefined, { cast: false }));
  const eyeGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#b8c8ff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 }));
  eyeGlow.scale.setScalar(0.9); eyeGlow.position.set(0, 0, 0.45);
  noOutline(eyeGlow);
  hood.add(eyeGlow);
  // long thin arms with claws (out of the cloak's front)
  const arms: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const a = grp(body, [s * 0.42, 1.65, 0.15]);
    part(a, G.capsule(0.06, 0.7), cloakM, [0, -0.4, 0]);
    const h = grp(a, [0, -0.85, 0]);
    part(h, G.sphere(), M.get(SKIN), [0, 0, 0], [0.09, 0.08, 0.1]);
    for (let i = -1; i <= 1; i++) part(h, G.cone(), M.get('#f4f0ff'), [i * 0.04, -0.06, 0.08], [0.02, 0.16, 0.02], [Math.PI * 0.62, 0, 0], { cast: false });
    arms.push(a);
  }
  const hand = grp(arms[0], [0, -0.95, 0.12]);

  // ── the little vampire inside (shown in the defeat scene) ──
  const small = grp(root);
  small.visible = false;
  const sb = grp(small, [0, 0, 0]);
  part(sb, G.sphere(), M.get(CLOAK), [0, 0.22, 0], [0.55, 0.22, 0.5]); // the sagging cloak around him
  part(sb, G.sphere(), M.get('#3a2a52'), [0, 0.42, 0], [0.22, 0.26, 0.2]);
  const sh = grp(sb, [0, 0.8, 0.02]);
  part(sh, G.sphere(), M.get(SKIN), [0, 0, 0], [0.2, 0.19, 0.19]);
  const sEars: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const e = grp(sh, [s * 0.15, 0.08, 0], [0, 0, s * -0.9]);
    part(e, G.sphere(), M.get(SKIN), [0, 0.2, 0], [0.11, 0.24, 0.04]);
    part(e, G.sphere(), M.get(EAR_IN), [0, 0.2, 0.02], [0.07, 0.17, 0.02], undefined, { cast: false });
    sEars.push(e);
  }
  const sEyes: THREE.Mesh[] = [];
  for (const s of [1, -1]) {
    sEyes.push(part(sh, G.ball(), basic('#ffffff'), [s * 0.07, 0.02, 0.16], [0.05, 0.065, 0.03], undefined, { cast: false }));
    part(sh, G.ball(), basic('#b8203a'), [s * 0.065, 0.015, 0.185], [0.025, 0.03, 0.015], undefined, { cast: false });
  }
  for (const s of [1, -1]) part(sh, G.cone(), basic('#ffffff'), [s * 0.025, -0.1, 0.17], [0.012, 0.035, 0.012], [Math.PI, 0, 0], { cast: false });
  const paws: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const a = grp(sb, [s * 0.18, 0.55, 0.08]);
    part(a, G.capsule(0.035, 0.22), M.get('#3a2a52'), [0, -0.12, 0]);
    part(a, G.sphere(), M.get(SKIN), [0, -0.26, 0], 0.05);
    paws.push(a);
  }

  const blinker = new Blinker();
  let t = Math.random() * 5, sway = 0, lunge = 0;
  return {
    root, M, top: 2.7, hand,
    update(dt, a) {
      dt = Math.min(dt, 0.05); t += dt;
      big.visible = a.small < 0.5;
      small.visible = a.small >= 0.5;
      const b = blinker.update(dt);
      if (big.visible) {
        sway = damp(sway, clamp(a.speed / 6, 0, 1), 5, dt);
        body.rotation.x = sway * 0.25;
        body.position.y = Math.sin(t * 2.2) * 0.05 + 0.04;
        body.scale.set(1 + Math.sin(t * 3.1) * 0.02, 1 + Math.sin(t * 2.2) * 0.02, 1);
        let armA = -0.2 + Math.sin(t * 1.7) * 0.1, armB = -0.2 - Math.sin(t * 1.7) * 0.1, spread = 0.15, hoodTilt = 0;
        let want = 0;
        switch (a.st) {
          case 'tele': armA = -2.3; armB = -2.1; spread = 0.5; hoodTilt = -0.25; want = 0; break;
          case 'claw': want = 1; armA = -0.6 + a.p * 1.6; armB = -0.4 + a.p * 1.2; spread = 0.1; hoodTilt = 0.3; break;
          case 'aim': armA = -2.6; armB = -0.3; hoodTilt = -0.1; break;
          case 'throw': armA = -0.3 - (1 - a.p) * 2.2; armB = -0.3; break;
          case 'blow': hoodTilt = 0.35 + Math.sin(t * 20) * 0.05; armA = -1.0; armB = -1.0; spread = 0.6; break;
          case 'stun': hoodTilt = Math.sin(t * 6) * 0.3; armA = -0.1; armB = -0.1; spread = 0.7; break;
          case 'hurt': hoodTilt = -0.4; armA = -1.4; armB = -1.4; break;
        }
        lunge = damp(lunge, want, 14, dt);
        body.position.z = lunge * 0.35;
        arms[0].rotation.set(armA, 0, spread); arms[1].rotation.set(armB, 0, -spread);
        hood.rotation.x = damp(hood.rotation.x, hoodTilt, 10, dt);
        for (const [i, e] of ears.entries()) e.rotation.x = Math.sin(t * 2 + i) * 0.12 - sway * 0.4;
        for (const e of eyes) e.scale.y = 0.1 * (1 - b * 0.9);
        (eyeGlow.material as THREE.SpriteMaterial).opacity = (a.st === 'tele' || a.st === 'aim' ? 0.95 : 0.5) * (1 - b * 0.8) * clamp((a.vis - 0.05) * 2.5, 0, 1);
        eyeGlow.visible = a.vis > 0.06;
      } else {
        // small: hiding the face in the paws, peeking out
        const hide = a.hide;
        sh.rotation.x = 0.3 * hide - a.talk * 0.1;
        for (const [i, p] of paws.entries()) { const s = i ? -1 : 1; p.rotation.set(-2.3 * hide - 0.2, 0, s * (0.4 - hide * 0.6)); }
        for (const [i, e] of sEars.entries()) e.rotation.x = -0.5 * hide + Math.sin(t * 3 + i) * 0.08;
        for (const e of sEyes) e.scale.y = 0.065 * (1 - b * 0.9);
        sb.position.y = Math.sin(t * 2) * 0.01;
      }
      M.flash(a.flash);
    },
  };
}

let gT: THREE.Texture | null = null;
function glowTex() {
  if (gT) return gT;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  gT = new THREE.CanvasTexture(c);
  return gT;
}

/** a glass shard (the boss throws them): restyle a projectile's look */
export function shardLook(obj: THREE.Object3D) {
  for (const c of [...obj.children]) obj.remove(c);
  const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), basic('#d8f0ff', { transparent: true, opacity: 0.85 }));
  m.scale.set(0.5, 1.7, 0.35);
  m.rotation.x = Math.PI / 2;
  obj.add(m);
  const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#cfe8ff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 }));
  glint.scale.setScalar(0.9);
  noOutline(glint);
  obj.add(glint);
}

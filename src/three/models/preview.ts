import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PAL, mat, LAYER_NO_OUTLINE } from '../gfx';
import { createHero, type HeroAnim, type HeroState, type HeroExpr } from './hero';
import { createGuard, type GuardAnim, type GuardKind } from './guard';
import { createBear, type BearAnim } from './bear';
import { createDog, createDogFist, type DogAnim } from './dog';
import { createKing, KING_HAND_REST, type KingAnim } from './king';
import { createMeatball, createJelly, createBookBat } from './critters';
import { createGoldenNut, createCherryBomb } from './collectibles';

/* Dev-only page: http://localhost:5173/model-preview.html — shows every character model with cycling states. */

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#2b2035');
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
camera.layers.enable(LAYER_NO_OUTLINE);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight('#fff1dc', '#6a5878', 1.25));
const sun = new THREE.DirectionalLight('#ffffff', 2.1);
sun.position.set(8, 16, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const sc = sun.shadow.camera;
sc.left = -36; sc.right = 36; sc.top = 36; sc.bottom = -36; sc.near = 0.5; sc.far = 90;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.05;
scene.add(sun);
sun.target.position.set(0, 0, -6);
scene.add(sun.target);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), mat('#c79a6a'));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
// tile lines for scale (1 unit grid)
const grid = new THREE.GridHelper(80, 80, 0x9a7450, 0xa98058);
grid.position.y = 0.002;
(grid.material as THREE.Material).transparent = true;
(grid.material as THREE.Material).opacity = 0.35;
grid.layers.set(LAYER_NO_OUTLINE);
scene.add(grid);

// ───────────────────────── models ─────────────────────────
interface Entry { name: string; tick: (dt: number, t: number) => void }
const entries: Entry[] = [];
const params = new URLSearchParams(location.search);

// UI state
const ui = {
  heroState: params.get('hero') ?? 'auto',
  heroAttack: params.get('attack') ?? 'auto',
  heroExpr: params.get('expr') ?? 'auto',
  heroWeapon: params.get('weapon') ?? 'sword',
  guardState: params.get('guard') ?? 'auto',
  timeScale: Number(params.get('ts') ?? '1'),
  bearState: params.get('bear') ?? 'auto',
  dogState: params.get('dog') ?? 'auto',
  dogExpr: params.get('dogExpr') ?? 'auto',
  kingMode: params.get('king') ?? 'auto',
  attackP: params.get('p') !== null ? Number(params.get('p')) : -1,
  look: params.get('look') !== null ? Number(params.get('look')) : NaN,
};

// hero
const hero = createHero();
hero.root.position.set(0, 0, 0);
scene.add(hero.root);
const heroStates: HeroState[] = ['idle', 'run', 'walk', 'sneak', 'jump', 'fall', 'dash', 'hurt', 'grabbed', 'dead', 'sit', 'cheer', 'lookUp', 'tumble'];
const heroExprs: HeroExpr[] = ['normal', 'happy', 'angry', 'scared', 'surprised', 'hurt', 'sleepy'];
const attackKinds = ['sword', 'swordAlt', 'fork', 'spin', 'sling'] as const;
const heroAnim: HeroAnim = { state: 'idle', speed: 0, attack: null, weapon: 'sword', flash: 0, talk: 0, expr: 'normal', squash: 1 };
const tipMarker = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshBasicMaterial({ color: '#00ffcc' }));
tipMarker.layers.set(LAYER_NO_OUTLINE);
scene.add(tipMarker);
entries.push({
  name: 'hero',
  tick(dt, t) {
    const slot = Math.floor(t / 3);
    const local = t % 3;
    const a = heroAnim;
    a.state = ui.heroState === 'auto' ? heroStates[slot % heroStates.length] : (ui.heroState as HeroState);
    a.speed = a.state === 'run' ? 1 : a.state === 'walk' ? 0.4 : a.state === 'sneak' ? 0.3 : 0;
    a.weapon = ui.heroWeapon as HeroAnim['weapon'];
    a.expr = ui.heroExpr === 'auto' ? heroExprs[Math.floor(t / 1.5) % heroExprs.length] : (ui.heroExpr as HeroExpr);
    a.talk = a.expr === 'normal' && a.state === 'idle' ? Math.max(0, Math.sin(t * 13)) * 0.8 : 0;
    a.flash = a.state === 'hurt' ? Math.max(0, 1 - local * 3) : 0;
    a.squash = a.state === 'jump' ? 1 + 0.15 * Math.max(0, 1 - local * 2) : 1;
    let kind: (typeof attackKinds)[number] | null = null;
    if (ui.heroAttack === 'auto') kind = (a.state === 'idle' || a.state === 'run') && slot % 2 === 0 ? attackKinds[(slot >> 1) % attackKinds.length] : null;
    else if (ui.heroAttack !== 'none') kind = ui.heroAttack as (typeof attackKinds)[number];
    if (kind) {
      const dur = kind === 'spin' ? 0.55 : kind === 'sling' ? 0.7 : 0.38;
      const p = ui.attackP >= 0 ? ui.attackP : (local % (dur + 0.45)) / dur;
      a.attack = p <= 1 ? { kind, p } : null;
      if (kind === 'fork') a.weapon = 'fork';
    } else a.attack = null;
    hero.update(dt, a);
    hero.weaponTip.getWorldPosition(tipMarker.position);
    status.hero = `hero: ${a.state}${a.attack ? ' +' + a.attack.kind + ' p=' + a.attack.p.toFixed(2) : ''} expr=${a.expr}`;
  },
});

// expression lineup (row of heroes at z=4)
heroExprs.forEach((ex, i) => {
  const h = createHero();
  h.root.position.set((i - 3) * 0.75, 0, 4);
  scene.add(h.root);
  const an: HeroAnim = { state: 'idle', speed: 0, attack: null, weapon: i % 2 ? 'fork' : 'sword', flash: 0, talk: 0, expr: ex, squash: 1 };
  entries.push({ name: 'lineup' + i, tick(dt) { h.update(dt, an); } });
});

// state lineup (z = 8) and attack lineup (z = 11), only when ?lineup=1 (keeps the default page light)
const lineup = params.get('lineup');
if (lineup === 'states') {
  heroStates.forEach((st, i) => {
    const h = createHero();
    h.root.position.set((i - 6.5) * 0.9, 0, 8);
    h.root.rotation.y = Number(params.get('rot') ?? '1.0');
    scene.add(h.root);
    const an: HeroAnim = { state: st, speed: st === 'run' ? 1 : st === 'walk' ? 0.4 : st === 'sneak' ? 0.3 : 0, attack: null, weapon: 'sword', flash: 0, talk: 0, expr: 'normal', squash: 1 };
    entries.push({ name: 'st' + i, tick(dt) { h.update(dt, an); } });
  });
}
if (lineup === 'attacks') {
  const ps = [0.12, 0.3, 0.45, 0.8];
  attackKinds.forEach((kind, i) => {
    ps.forEach((p, j) => {
      const h = createHero();
      h.root.position.set((i * 4 + j - 9.5) * 0.9, 0, 8);
      scene.add(h.root);
      const an: HeroAnim = { state: 'idle', speed: 0, attack: { kind, p }, weapon: kind === 'fork' ? 'fork' : 'sword', flash: 0, talk: 0, expr: 'normal', squash: 1 };
      entries.push({ name: `atk${i}${j}`, tick(dt) { h.update(dt, an); } });
    });
  });
}

// guards
const guardStates: GuardAnim['state'][] = ['idle', 'walk', 'windup', 'attack', 'hurt', 'spit', 'cheer', 'alert', 'carry', 'look', 'block', 'bash', 'throw', 'charge', 'dizzy'];
const guardKinds: GuardKind[] = ['guard', 'spitter', 'feeder', 'shield', 'bomber', 'charger'];
// new kinds stand in their own row to the right (x ≈ 10–13), the charger is ~1.3× bigger
const guardPos: Record<GuardKind, [number, number]> = { guard: [1.5, 0], spitter: [2.55, 0], feeder: [3.6, 0], shield: [10.0, 0], bomber: [11.6, 0], charger: [13.3, 0] };
guardKinds.forEach((kind, i) => {
  const g = createGuard(kind);
  g.root.position.set(guardPos[kind][0], 0, guardPos[kind][1]);
  // ?grot=<rad> turns the new kinds (e.g. -1.57 shows their left side to the default cameras)
  if (i >= 3) g.root.rotation.y = Number(params.get('grot') ?? '0');
  scene.add(g.root);
  const an: GuardAnim = { state: 'idle', speed: 0, flash: 0 };
  const seq: Record<GuardKind, GuardAnim['state'][]> = {
    guard: ['idle', 'walk', 'windup', 'attack', 'hurt', 'alert', 'cheer'],
    spitter: ['idle', 'walk', 'spit', 'hurt', 'alert', 'cheer'],
    feeder: ['carry', 'idle', 'walk', 'carry', 'hurt', 'cheer'],
    shield: ['idle', 'walk', 'block', 'bash', 'hurt', 'look', 'dizzy'],
    bomber: ['idle', 'walk', 'throw', 'hurt', 'look', 'alert'],
    charger: ['idle', 'windup', 'charge', 'dizzy', 'attack', 'hurt', 'look'],
  };
  entries.push({
    name: kind,
    tick(dt, t) {
      const list = seq[kind];
      const slot = Math.floor(t / 2.5);
      an.state = ui.guardState === 'auto' ? list[slot % list.length] : (ui.guardState as GuardAnim['state']);
      an.speed = an.state === 'walk' || an.state === 'carry' ? 0.6 : an.state === 'charge' ? 1 : 0;
      an.p = ui.attackP >= 0 ? ui.attackP : undefined;
      an.look = Number.isNaN(ui.look) ? undefined : ui.look;
      an.flash = an.state === 'hurt' ? Math.max(0, 1 - (t % 2.5) * 3) : 0;
      g.update(dt, an);
      if (i === 0) status.guard = `guards: ${an.state}`;
      if (kind === 'shield') status.guard2 = `shield/bomber/charger: ${an.state}`;
    },
  });
});

// collectibles: golden walnut (spun / bobbed here like the game will) + cherry bomb (fuse cycles 0 → 1)
const nut = createGoldenNut();
nut.root.position.set(15.0, 0.55, 0);
scene.add(nut.root);
const cbomb = createCherryBomb();
cbomb.root.position.set(15.9, 0.36, 0);
scene.add(cbomb.root);
entries.push({
  name: 'collectibles',
  tick(dt, t) {
    nut.root.rotation.y = t * 1.6;
    nut.root.position.y = 0.55 + Math.sin(t * 2.2) * 0.06;
    if (ui.attackP >= 0) nut.root.rotation.y = ui.attackP * Math.PI * 2;
    nut.update(dt);
    const fuse = ui.attackP >= 0 ? ui.attackP : (t % 3) / 3;
    cbomb.update(dt, fuse);
    status.bomb = `fuse=${fuse.toFixed(2)}`;
  },
});

// bear
const bear = createBear();
bear.root.position.set(-3.3, 0, 0);
scene.add(bear.root);
const bearAnim: BearAnim = { state: 'sit', talk: 0, wave: 0, speed: 0 };
const bearSeq: Array<[BearAnim['state'], number, number]> = [['sit', 0, 0], ['sit', 1, 0], ['sit', 0, 1], ['stand', 0, 1], ['walk', 1, 0]];
entries.push({
  name: 'bear',
  tick(dt, t) {
    const [st, talk, wave] = ui.bearState === 'auto' ? bearSeq[Math.floor(t / 3) % bearSeq.length] : [ui.bearState as BearAnim['state'], 1, 0];
    bearAnim.state = st; bearAnim.wave = wave; bearAnim.speed = st === 'walk' ? 0.5 : 0;
    bearAnim.talk = talk ? Math.max(0, Math.sin(t * 9)) : 0;
    bear.update(dt, bearAnim);
    status.bear = `bear: ${st}${talk ? ' talk' : ''}${wave ? ' wave' : ''}`;
  },
});

// dogs (normal + stretched ×3)
const dogStates: DogAnim['state'][] = ['idle', 'walk', 'sit', 'fly'];
const dogExprs: DogAnim['expr'][] = ['normal', 'happy', 'angry'];
for (let i = 0; i < 2; i++) {
  const d = createDog();
  d.root.position.set(5.2 + i * 1.3, 0, i ? -1.4 : 0);
  scene.add(d.root);
  const an: DogAnim = { state: 'idle', speed: 0, talk: 0, stretch: i ? 3 : 1, expr: 'happy' };
  entries.push({
    name: 'dog' + i,
    tick(dt, t) {
      an.state = ui.dogState === 'auto' ? dogStates[Math.floor(t / 3) % dogStates.length] : (ui.dogState as DogAnim['state']);
      if (i) an.state = an.state === 'sit' ? 'idle' : an.state;
      an.expr = ui.dogExpr === 'auto' ? dogExprs[Math.floor(t / 2) % dogExprs.length] : (ui.dogExpr as DogAnim['expr']);
      an.speed = an.state === 'walk' ? 0.6 : 0;
      an.talk = an.expr === 'normal' ? Math.max(0, Math.sin(t * 10)) : 0;
      an.stretch = i ? 3 + Math.sin(t * 0.6) * 0.5 : 1;
      d.update(dt, an);
      if (!i) status.dog = `dog: ${an.state} ${an.expr}`;
    },
  });
}
const fist = createDogFist();
fist.position.set(8.4, 0.6, 0.3);
scene.add(fist);

// critters
const meat = createMeatball();
meat.root.position.set(-5.4, 0, 0.3);
scene.add(meat.root);
entries.push({ name: 'meatball', tick(dt, t) { meat.update(dt, { roll: Math.sin(t * 0.5) * 6, flash: (t % 4) < 0.15 ? 1 : 0 }); } });
for (let i = 0; i < 3; i++) {
  const j = createJelly(i as 0 | 1 | 2);
  j.root.position.set(-6.6 - i * 0.95, 0, 0.3);
  scene.add(j.root);
  entries.push({ name: 'jelly' + i, tick(dt, t) { const k = (t * 0.8 + i * 0.33) % 2; j.update(dt, { squash: k < 0.25 ? 0.8 : k < 0.5 ? -0.8 : 0, flash: 0 }); } });
}
const book = createBookBat();
book.root.position.set(-9.8, 1.1, 0.3);
scene.add(book.root);
const book2 = createBookBat('#2e86c1');
book2.root.position.set(-10.9, 1.3, -0.2);
scene.add(book2.root);
entries.push({ name: 'book', tick(dt, t) { book.update(dt, { flap: t * 9, flash: 0 }); book2.update(dt, { flap: t * 9 + 1.5, flash: 0 }); } });

// king (hands at rest + one hand raised open, plus a cycle of moods / hand poses)
const king = createKing();
king.root.position.set(0, 0, -24);
scene.add(king.root);
const kingAnim: KingAnim = {
  eye: 0.5, mouth: 0, anger: 0, look: { x: 0, y: 0 }, dizzy: 0, chew: 0, slump: 0, stand: 0, flash: 0, talk: 0,
  hands: [
    { pos: KING_HAND_REST[0].clone(), pose: 'rest', glow: 0, flash: 0 },
    { pos: new THREE.Vector3(9, 15, 14), pose: 'open', glow: 0, flash: 0 },
  ],
};
const kingModes = ['idle', 'talk', 'angry', 'mouth', 'slam', 'fist', 'grab', 'sweep', 'dizzy', 'slump', 'stand'] as const;
const anchorMarker = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), new THREE.MeshBasicMaterial({ color: '#00ffcc' }));
anchorMarker.layers.set(LAYER_NO_OUTLINE);
scene.add(anchorMarker);
const mouthMarker = anchorMarker.clone();
(mouthMarker.material as THREE.MeshBasicMaterial) = new THREE.MeshBasicMaterial({ color: '#ff00cc' });
scene.add(mouthMarker);
entries.push({
  name: 'king',
  tick(dt, t) {
    const mode = ui.kingMode === 'auto' ? kingModes[Math.floor(t / 4) % kingModes.length] : ui.kingMode;
    const lt = t % 4;
    const a = kingAnim;
    a.eye = 0.5; a.mouth = 0; a.anger = 0; a.dizzy = 0; a.chew = 0.6; a.slump = 0; a.stand = 0; a.talk = 0; a.flash = 0;
    a.look.x = Math.sin(t * 0.8) * 0.8; a.look.y = Math.sin(t * 0.53) * 0.5;
    const [L, R] = a.hands;
    L.pos.copy(KING_HAND_REST[0]); L.pose = 'rest'; L.glow = 0; L.flash = 0; L.yaw = 0;
    R.pos.set(9, 15, 14); R.pose = 'open'; R.glow = 0; R.flash = 0; R.yaw = 0;
    switch (mode) {
      case 'talk': a.talk = 1; a.eye = 0.7; a.chew = 0; break;
      case 'angry': a.anger = 1; a.eye = 0.85; a.mouth = 0.3; a.chew = 0; R.pose = 'fist'; R.pos.set(8, 13, 12); break;
      case 'mouth': a.mouth = 1; a.eye = 1; a.chew = 0; break;
      case 'slam': { const k = Math.min(1, lt / 0.6); R.pos.set(10, 14 * (1 - k * k), 17); R.pose = k < 1 ? 'open' : 'flat'; R.glow = k >= 1 ? 1 : 0; R.flash = lt > 0.6 && lt < 0.75 ? 1 : 0; a.anger = 0.6; break; }
      case 'fist': R.pose = 'fist'; R.pos.set(9, 0, 15); a.anger = 0.8; a.eye = 0.8; break;
      case 'grab': R.pose = 'grab'; R.pos.set(5, 2, 19); a.eye = 0.9; a.look.y = -0.8; break;
      case 'sweep': R.pose = 'open'; R.pos.set(Math.sin(lt * 1.6) * 16, 1, 18); R.yaw = -Math.sin(lt * 1.6) * 0.8; L.pose = 'flat'; L.pos.set(-12, 0, 8); break;
      case 'dizzy': a.dizzy = 1; a.eye = 0.8; a.mouth = 0.4; a.chew = 0; L.pose = 'flat'; L.pos.set(-11, 0, 9); R.pose = 'flat'; R.pos.set(11, 0, 9); break;
      case 'slump': a.dizzy = 1; a.slump = 1; a.eye = 0.4; a.chew = 0; L.pose = 'flat'; L.pos.set(-11, 0, 10); R.pose = 'flat'; R.pos.set(11, 0, 10); R.glow = 1; break;
      case 'stand': a.stand = 1; a.eye = 0.9; a.anger = 0.5; L.pos.set(-10, 16, 8); R.pos.set(10, 16, 8); L.pose = 'fist'; R.pose = 'fist'; break;
      default: break;
    }
    king.update(dt, a);
    king.faceAnchor.getWorldPosition(anchorMarker.position);
    king.mouthAnchor.getWorldPosition(mouthMarker.position);
    status.king = `king: ${mode}`;
  },
});

// mesh / material counts (console) — budget check
{
  const count = (o: THREE.Object3D) => { let m = 0; const mats = new Set<string>(); o.traverse((c) => { if ((c as THREE.Mesh).isMesh) { m++; const mm = (c as THREE.Mesh).material as THREE.Material; mats.add(mm.uuid); } }); return `${m} meshes / ${mats.size} materials`; };
  const report: Record<string, string> = {
    hero: count(hero.root), guard: count(scene.getObjectByName('guard-guard') ?? new THREE.Group()), spitter: count(scene.getObjectByName('guard-spitter') ?? new THREE.Group()),
    feeder: count(scene.getObjectByName('guard-feeder') ?? new THREE.Group()), shield: count(scene.getObjectByName('guard-shield') ?? new THREE.Group()),
    bomber: count(scene.getObjectByName('guard-bomber') ?? new THREE.Group()), charger: count(scene.getObjectByName('guard-charger') ?? new THREE.Group()),
    goldenNut: count(nut.root), cherryBomb: count(cbomb.root), bear: count(bear.root), dog: count(scene.getObjectByName('dog') ?? new THREE.Group()),
    dogFist: count(fist), king: count(king.root), meatball: count(meat.root), jelly: count(scene.getObjectByName('jelly') ?? new THREE.Group()), bookBat: count(book.root),
  };
  console.log('[model-preview] budget', JSON.stringify(report));
  (window as unknown as { __modelBudget: Record<string, string> }).__modelBudget = report;
  (window as unknown as { __king: typeof king; __hero: typeof hero }).__king = king;
  (window as unknown as { __hero: typeof hero }).__hero = hero;
}

// ───────────────────────── outline post pass (approximation of the game's) ─────────────────────────
const normalMat = new THREE.MeshNormalMaterial();
let rtColor: THREE.WebGLRenderTarget | null = null;
let rtNormal: THREE.WebGLRenderTarget | null = null;
function ensureTargets(W: number, H: number) {
  if (rtColor && rtColor.width === W && rtColor.height === H) return;
  rtColor?.dispose(); rtNormal?.dispose();
  rtColor = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
  rtNormal = new THREE.WebGLRenderTarget(W, H);
  rtNormal.depthTexture = new THREE.DepthTexture(W, H);
}
const post = new THREE.ShaderMaterial({
  uniforms: {
    tColor: { value: null }, tNormal: { value: null }, tDepth: { value: null },
    res: { value: new THREE.Vector2(1, 1) }, dbg: { value: Number(params.get('dbg') ?? '0') }, thick: { value: 2.0 * Math.min(2, window.devicePixelRatio) }, near: { value: 0.1 }, far: { value: 400 }, ink: { value: new THREE.Color(PAL.outline) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    uniform sampler2D tColor, tNormal, tDepth; uniform vec2 res; uniform float near, far; uniform vec3 ink; uniform int dbg; uniform float thick;
    varying vec2 vUv;
    float lin(float d){ float z = d * 2.0 - 1.0; return (2.0 * near * far) / (far + near - z * (far - near)); }
    void main(){
      vec2 px = 1.0 / res;
      vec3 col = texture2D(tColor, vUv).rgb;
      float d0 = lin(texture2D(tDepth, vUv).r);
      vec3 n0 = texture2D(tNormal, vUv).rgb;
      float e = 0.0;
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.785398;
        vec2 o = vec2(cos(a), sin(a)) * px * thick;
        float d = lin(texture2D(tDepth, vUv + o).r);
        vec3 n = texture2D(tNormal, vUv + o).rgb;
        e = max(e, step(0.035 * d0 + 0.02, abs(d - d0)));
        e = max(e, smoothstep(0.35, 0.6, length(n - n0)));
      }
      gl_FragColor = vec4(mix(col, ink, e * 0.92), 1.0);
      if (dbg == 1) gl_FragColor = vec4(n0, 1.0);
      if (dbg == 2) gl_FragColor = vec4(vec3(fract(d0)), 1.0);
      if (dbg == 3) gl_FragColor = vec4(vec3(e), 1.0);
      #include <colorspace_fragment>
    }`,
  depthTest: false, depthWrite: false,
});
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post);
const postScene = new THREE.Scene();
postScene.add(quad);
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
let outlines = params.get('outline') !== '0';

function resize() {
  const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
const dbs = new THREE.Vector2();

function render() {
  renderer.getDrawingBufferSize(dbs);
  if (!outlines || dbs.x < 2 || dbs.y < 2) { renderer.setRenderTarget(null); renderer.render(scene, camera); return; }
  ensureTargets(dbs.x, dbs.y);
  const rc = rtColor!, rn = rtNormal!;
  post.uniforms.res.value.copy(dbs);
  renderer.setRenderTarget(rc);
  renderer.render(scene, camera);
  const bg = scene.background;
  scene.background = null;
  scene.overrideMaterial = normalMat;
  camera.layers.set(0);
  renderer.setRenderTarget(rn);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  renderer.render(scene, camera);
  scene.overrideMaterial = null;
  scene.background = bg;
  camera.layers.enable(LAYER_NO_OUTLINE);
  post.uniforms.tColor.value = rc.texture;
  post.uniforms.tNormal.value = rn.texture;
  post.uniforms.tDepth.value = rn.depthTexture;
  post.uniforms.near.value = camera.near;
  post.uniforms.far.value = camera.far;
  renderer.setRenderTarget(null);
  renderer.render(postScene, postCam);
}

// ───────────────────────── camera presets & UI ─────────────────────────
const views: Record<string, [THREE.Vector3Tuple, THREE.Vector3Tuple]> = {
  all: [[5, 15, 33], [0, 9, -10]],
  hero: [[0.9, 1.0, 2.6], [0, 0.55, 0]],
  heroGame: [[0.3, 2.4, -5.6], [0, 0.7, 1.5]],
  heroSide: [[-1.9, 0.75, 0.05], [0, 0.55, 0]],
  face: [[0.1, 0.78, 1.7], [0, 0.66, 0]],
  faces: [[0, 1.0, 9.0], [0, 0.6, 4]],
  states: [[0, 3.0, 21.5], [0, 0.4, 8]],
  states1: [[-3.15, 1.7, 14.2], [-3.15, 0.45, 8]],
  states2: [[3.15, 1.7, 14.2], [3.15, 0.45, 8]],
  attacks1: [[-4.5, 1.7, 14.5], [-4.5, 0.45, 8]],
  attacks2: [[3.0, 1.7, 14.5], [3.0, 0.45, 8]],
  attacksTop: [[-2.7, 7.5, 10.5], [-2.7, 0, 8.2]],
  attacksTop2: [[4.5, 7.5, 10.5], [4.5, 0, 8.2]],
  attacks: [[0, 3.6, 24], [0, 0.4, 8]],
  guards: [[2.6, 1.2, 3.6], [2.55, 0.5, 0]],
  guardsGame: [[2.4, 3.2, 6.5], [2.55, 0.5, 0]],
  guards2: [[11.75, 1.5, 5.8], [11.75, 0.6, 0]],
  guards2Game: [[11.7, 3.6, 6.0], [11.7, 0.6, 0]],
  shield: [[10.25, 1.05, 2.5], [10.0, 0.55, 0.15]],
  bomber: [[11.85, 1.05, 2.5], [11.6, 0.55, 0.1]],
  charger: [[13.75, 1.55, 3.7], [13.3, 0.7, 0.2]],
  collect: [[15.45, 1.0, 2.5], [15.45, 0.45, 0]],
  collectFar: [[15.45, 3.2, 6.8], [15.45, 0.45, 0]],
  bear: [[-2.4, 2.0, 5.4], [-3.3, 1.2, 0]],
  dog: [[6.4, 1.3, 3.6], [6.0, 0.35, -0.3]],
  dogSide: [[4.1, 1.1, 1.2], [6.6, 0.3, -0.6]],
  fist: [[7.6, 1.2, 2.2], [8.4, 0.6, 0.3]],
  critters: [[-8.0, 1.5, 4.4], [-8.0, 0.55, 0]],
  meatball: [[-4.9, 1.0, 2.1], [-5.4, 0.45, 0.3]],
  books: [[-9.9, 1.9, 2.4], [-10.3, 1.15, 0.0]],
  king: [[12, 12, 24], [0, 13, -24]],
  kingFace: [[4, 21, 2], [0, 20, -24]],
  kingLow: [[0, 3.5, 6], [0, 12, -24]],
  kingSide: [[46, 15, -12], [0, 13, -22]],
  kingHand: [[18, 10, 6], [7, 2, -8]],
};
function setView(name: string) {
  const v = views[name];
  if (!v) return;
  camera.position.set(...v[0]);
  controls.target.set(...v[1]);
  controls.update();
  document.querySelectorAll<HTMLButtonElement>('#ui button[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
}

const status: Record<string, string> = {};
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function extraUI(_sel: SelFn) { /* more selectors added below as models land */ }
const uiEl = document.getElementById('ui') as HTMLDivElement;
function buildUI() {
  uiEl.innerHTML = '';
  const row = (label: string) => { const r = document.createElement('div'); r.className = 'row'; const l = document.createElement('label'); l.textContent = label; r.appendChild(l); uiEl.appendChild(r); return r; };
  const vr = row('view');
  for (const name of Object.keys(views)) {
    const b = document.createElement('button');
    b.textContent = name; b.dataset.view = name;
    b.onclick = () => setView(name);
    vr.appendChild(b);
  }
  const sel = (label: string, opts: readonly string[], get: () => string, set: (v: string) => void) => {
    const r = row(label);
    const s = document.createElement('select');
    for (const o of opts) { const op = document.createElement('option'); op.value = o; op.textContent = o; s.appendChild(op); }
    s.value = get();
    s.onchange = () => set(s.value);
    r.appendChild(s);
  };
  sel('hero', ['auto', ...heroStates], () => ui.heroState, (v) => (ui.heroState = v));
  sel('attack', ['auto', 'none', ...attackKinds], () => ui.heroAttack, (v) => (ui.heroAttack = v));
  sel('expr', ['auto', ...heroExprs], () => ui.heroExpr, (v) => (ui.heroExpr = v));
  sel('weapon', ['sword', 'fork', 'none'], () => ui.heroWeapon, (v) => (ui.heroWeapon = v));
  sel('guard', ['auto', ...guardStates], () => ui.guardState, (v) => (ui.guardState = v));
  sel('bear', ['auto', 'sit', 'stand', 'walk'], () => ui.bearState, (v) => (ui.bearState = v));
  sel('dog', ['auto', ...dogStates], () => ui.dogState, (v) => (ui.dogState = v));
  sel('dogExpr', ['auto', ...dogExprs], () => ui.dogExpr, (v) => (ui.dogExpr = v));
  sel('king', ['auto', ...kingModes], () => ui.kingMode, (v) => (ui.kingMode = v));
  extraUI(sel);
  sel('speed', ['1', '0.5', '0.25', '0.1', '0'], () => String(ui.timeScale), (v) => (ui.timeScale = Number(v)));
  sel('outline', ['on', 'off'], () => (outlines ? 'on' : 'off'), (v) => (outlines = v === 'on'));
}
type SelFn = (label: string, opts: readonly string[], get: () => string, set: (v: string) => void) => void;

// ───────────────────────── loop ─────────────────────────
const statusEl = document.getElementById('status') as HTMLDivElement;
let simT = Number(params.get('t') ?? '0');
let last = performance.now();
function frame(now: number) {
  const realDt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  const dt = realDt * ui.timeScale;
  simT += dt;
  for (const e of entries) e.tick(dt, simT);
  controls.update();
  render();
  statusEl.textContent = Object.values(status).join(' | ') + `  t=${simT.toFixed(1)}`;
  requestAnimationFrame(frame);
}

// ?warm=seconds pre-simulates (useful when the pane is hidden and frames are throttled)
for (let i = 0, n = Math.round(Number(params.get('warm') ?? '0') * 60); i < n; i++) { simT += 1 / 60; for (const e of entries) e.tick(1 / 60, simT); }
buildUI();
if (params.get('ui') === '0') { uiEl.style.display = 'none'; }
setView(params.get('view') ?? 'all');
requestAnimationFrame(frame);

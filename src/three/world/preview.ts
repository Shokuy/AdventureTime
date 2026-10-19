import '@fontsource/rubik/900.css';
import '@fontsource/pangolin/400.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Renderer3D } from '../render';
import { LAYER_NO_OUTLINE, BOOK_COLORS } from '../gfx';
import type { Built } from '../physics/types';
import * as P from './props';
import { room, skyBackdrop, type RoomTheme } from './rooms';

/**
 * World-kit diorama: every prop + a small room per theme. Keys:
 *  C colliders (wireframes + mini heroes on walkable tops)   X x-ray colliders   O outlines   L labels
 *  1..9 camera presets (also ?p=N, or ?cam=x,y,z&tgt=x,y,z, ?c=1 to start with colliders)
 */

const canvas = document.getElementById('view') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLDivElement;
const q = new URLSearchParams(location.search);

async function main() {
  await Promise.all([document.fonts.load('900 40px Rubik'), document.fonts.load('400 40px Pangolin')]).catch(() => undefined);

  const r3 = new Renderer3D(canvas);
  const renderer = r3.renderer;
  renderer.info.autoReset = false;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1a1018');
  scene.fog = new THREE.Fog('#1a1018', 160, 420);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.3, 900);
  camera.layers.enable(LAYER_NO_OUTLINE);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;

  const hemi = new THREE.HemisphereLight('#ffe8c8', '#4a2a3a', 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff0d8', 2.2);
  sun.position.set(60, 120, 70);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = -160; sc.right = 160; sc.top = 160; sc.bottom = -160; sc.near = 1; sc.far = 400;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);

  const builts: Built[] = [];
  const labels: THREE.Sprite[] = [];
  const add = (b: Built) => { scene.add(b.obj); builts.push(b); return b; };
  const label = (text: string, x: number, y: number, z: number) => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(20,10,8,0.75)'; g.beginPath(); g.roundRect(2, 2, 252, 60, 14); g.fill();
    g.fillStyle = '#ffe9b0'; g.font = '700 30px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 34);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    s.scale.set(4, 1, 1); s.position.set(x, y, z); s.renderOrder = 999;
    s.layers.set(LAYER_NO_OUTLINE);
    scene.add(s); labels.push(s);
  };
  const heroGeo = new THREE.CapsuleGeometry(0.3, 0.35, 4, 12).translate(0, 0.475, 0); // 0.95 tall like the player
  const heroMat = new THREE.MeshToonMaterial({ color: '#ff8a2a' });
  const hero = (x: number, y: number, z: number) => {
    const m = new THREE.Mesh(heroGeo, heroMat); m.position.set(x, y, z); m.castShadow = true; scene.add(m); return m;
  };

  // ── gallery floor (stone, with pool holes) + north wall for wall decor
  const holes = [{ x0: -26, x1: -14, z0: 42, z1: 52 }, { x0: -6, x1: 6, z0: 43, z1: 51 }];
  add(room({ theme: 'gallery', x0: -92, x1: 92, z0: -70, z1: 70, floorY: 0, wallH: 26, holes, walls: { n: true, s: false, e: false, w: false }, carpet: false, banners: false }));
  add(skyBackdrop({ theme: 'throne', center: { x: 0, y: 0, z: 0 }, radius: 600 }));

  // ── wall decor on the north wall (wall face at z = -70)
  const WZ = -70;
  const decor: [string, number, number, () => Built][] = [
    ['door', -80, 0, () => P.door({ x: -80, y: 0, z: WZ, w: 7, h: 12 })],
    ['window', -62, 5, () => P.window({ x: -62, y: 5, z: WZ, w: 7, h: 14 })],
    ['painting', -45, 5, () => P.painting({ x: -45, y: 5, z: WZ, w: 9, h: 11 })],
    ['banner', -31, 4, () => P.banner({ x: -31, y: 4, z: WZ, w: 5, h: 13 })],
    ['torch', -23, 6, () => P.torch({ x: -23, y: 6, z: WZ })],
    ['mousehole', -15, 0, () => P.mousehole({ x: -15, y: 0, z: WZ, w: 3, h: 4, light: true })],
    ['shelfBoard', -2, 6, () => P.shelfBoard({ x: -2, y: 6, z: WZ + 2, w: 10, d: 4 })],
    ['bookshelf', 24, 0, () => P.bookshelf({ x: 24, y: 0, z: WZ + 2.5, w: 24, h: 30, d: 5, shelves: 4, seed: 7 })],
  ];
  for (const [n, x, y, mk] of decor) { add(mk()); label(n, x, y + (n === 'bookshelf' ? 32 : n === 'mousehole' ? 6 : 15), WZ + 3); hero(x + 2, 0, WZ + 4); }
  add(P.chandelier({ x: 62, y: 22, z: -40, r: 5, chain: 8 })); label('chandelier', 62, 32, -40);

  // ── prop rows
  type E = [string, number, () => Built, number?];
  const rows: [number, E[]][] = [
    [-45, [
      ['bookStack', -80, () => P.bookStack({ x: -80, y: 0, z: -45, n: 4, w: 7, d: 5, seed: 3 })],
      ['book lying', -68, () => P.book({ x: -68, y: 0, z: -45, w: 8, h: 2, d: 6, color: BOOK_COLORS[1] })],
      ['book upright', -59, () => P.book({ x: -59, y: 0, z: -45, w: 1.8, h: 8, d: 6, lying: false, color: BOOK_COLORS[3] })],
      ['crate', -51, () => P.crate({ x: -51, y: 0, z: -45, w: 3.6, h: 3.6, d: 3.6, label: 'МУКА' })],
      ['jar red', -42, () => P.jar({ x: -42, y: 0, z: -45, r: 3, h: 8, jam: 'red' })],
      ['jar orange', -34, () => P.jar({ x: -34, y: 0, z: -45, r: 2.6, h: 7, jam: 'orange' })],
      ['jar green', -26, () => P.jar({ x: -26, y: 0, z: -45, r: 2.6, h: 7.5, jam: 'green' })],
      ['jar honey', -18, () => P.jar({ x: -18, y: 0, z: -45, r: 3.2, h: 9, jam: 'honey' })],
      ['can fish', -9, () => P.can({ x: -9, y: 0, z: -45, r: 2, h: 4, label: 'fish' })],
      ['can tomato', -3, () => P.can({ x: -3, y: 0, z: -45, r: 2, h: 5, label: 'ТОМАТЫ' })],
      ['can peas', 3, () => P.can({ x: 3, y: 0, z: -45, r: 1.6, h: 3.4, label: 'peas' })],
      ['crate x2', 11, () => P.crate({ x: 11, y: 0, z: -45, w: 4, h: 3, d: 4, label: 'ЯБЛОКИ', rotY: 1 })],
      ['tall crate', 18, () => P.crate({ x: 18, y: 0, z: -45, w: 4, h: 14, d: 4, label: 'СУХАРИ' })],
    ]],
    [-24, [
      ['cheese', -80, () => P.cheese({ x: -80, y: 0, z: -24, w: 6, h: 4, d: 4 })],
      ['bread', -70, () => P.bread({ x: -70, y: 0, z: -24, w: 8, h: 3, d: 4 })],
      ['butter', -61, () => P.butter({ x: -61, y: 0, z: -24 })],
      ['sugarCube', -54, () => P.sugarCube({ x: -54, y: 0, z: -24, s: 2.5 })],
      ['plate', -45, () => P.plate({ x: -45, y: 0, z: -24, r: 5 })],
      ['cup', -34, () => P.cup({ x: -34, y: 0, z: -24, r: 2.2, h: 3, color: '#8e44ad' })],
      ['goblet', -26, () => P.goblet({ x: -26, y: 0, z: -24, r: 2, h: 7 })],
      ['cake', -15, () => P.cake({ x: -15, y: 0, z: -24, r: 5, h: 6 })],
      ['bowl soup', 0, () => P.bowl({ x: 0, y: 0, z: -24, r: 6, h: 4, contents: 'soup' })],
      ['bowl spaghetti', 15, () => P.bowl({ x: 15, y: 0, z: -24, r: 6, h: 4, contents: 'spaghetti', color: '#27ae60' })],
      ['bowl empty', 30, () => P.bowl({ x: 30, y: 0, z: -24, r: 5, h: 3.5, contents: 'empty', color: '#2c3e8f' })],
      ['big flat bowl', 55, () => P.bowl({ x: 55, y: 0, z: -24, r: 13.5, h: 2.6, contents: 'soup' })],
    ]],
    [2, [
      ['jellyBlock', -80, () => P.jellyBlock({ x: -80, y: 0, z: 2, w: 3, h: 2, d: 3 })],
      ['cookie', -72, () => P.cookie({ x: -72, y: 0, z: 2, r: 2.5, h: 0.8 })],
      ['spoon', -58, () => P.spoon({ x: -58, y: 0, z: 2, len: 14, w: 3 })],
      ['table+cloth', -25, () => P.table({ x: -25, y: 0, z: 2, w: 30, d: 16, h: 12, cloth: true })],
      ['table', 18, () => P.table({ x: 18, y: 0, z: 2, w: 20, d: 12, h: 10, cloth: false })],
    ]],
    [26, [
      ['candle', -80, () => P.candle({ x: -80, y: 0, z: 26, r: 1.2, h: 5, light: true })],
      ['sack', -71, () => P.sack({ x: -71, y: 0, z: 26, label: 'МУКА' })],
      ['bottle', -63, () => P.bottle({ x: -63, y: 0, z: 26, r: 1.4, h: 6 })],
      ['barrel', -55, () => P.barrel({ x: -55, y: 0, z: 26 })],
      ['sausages', -47, () => P.sausages({ x: -47, y: 10, z: 26, n: 5, len: 7 })],
      ['garlic', -41, () => P.garlic({ x: -41, y: 10, z: 26 })],
      ['tin', -33, () => P.tin({ x: -33, y: 0, z: 26, r: 3, h: 2 })],
      ['teapot', -22, () => P.teapot({ x: -22, y: 0, z: 26, r: 2.5, color: '#c0392b' })],
      ['pedestal', -12, () => P.pedestal({ x: -12, y: 0, z: 26 })],
      ['signpost', -7, () => P.signpost({ x: -7, y: 0, z: 26, text: 'Кладовая →' })],
      ['rug', 4, () => P.rug({ x: 4, y: 0, z: 26, w: 10, d: 7, color: '#2c6fb8' })],
      ['pillar', 20, () => P.pillar({ x: 20, y: 0, z: 26, r: 2, h: 20 })],
      ['candle plain', 30, () => P.candle({ x: 30, y: 0, z: 26, r: 0.7, h: 3, holder: false, color: '#ff9ec4' })],
    ]],
    [48, [
      ['throne', -62, () => P.throne({ x: -62, y: 0, z: 48, s: 0.8 })],
      ['pool soup', -20, () => P.pool({ x: -20, y: -0.3, z: 47, w: 12, d: 10, kind: 'soup' })],
      ['pool jam', 0, () => P.pool({ x: 0, y: -0.3, z: 47, w: 12, d: 8, kind: 'jam' })],
      ['forkRow', 20, () => P.forkRow({ x: 20, y: 0, z: 48, w: 6, d: 4 })],
    ]],
  ];
  for (const [z, list] of rows) for (const [n, x, mk] of list) {
    const b = add(mk());
    const bb = new THREE.Box3().setFromObject(b.obj);
    label(n, x, Math.max(bb.max.y, 2) + 2, z);
    if (!n.startsWith('pool')) hero(Math.min(bb.max.x + 0.9, x + 16), 0, z + 2.5);
  }
  // table toppings: things on the tablecloth (test props standing on another prop)
  const TT = 12;
  add(P.forkRow({ x: -33, y: TT, z: 4, w: 5, d: 4 }));
  add(P.plate({ x: -24, y: TT, z: 2, r: 3.5 }));
  add(P.goblet({ x: -16, y: TT, z: 0, r: 1.4, h: 5 }));
  hero(-28, TT, 7);

  // ── themed rooms (east side, open toward -X)
  const themes: RoomTheme[] = ['pantry', 'feast', 'library', 'gallery', 'throne', 'den'];
  themes.forEach((t, i) => {
    const z0 = -110 + i * 38, z1 = z0 + 32, x0 = 104, x1 = 140;
    add(room({ theme: t, x0, x1, z0, z1, floorY: 0, wallH: 18, walls: { n: true, s: true, e: true, w: false } }));
    label(t, 110, 21, (z0 + z1) / 2);
    hero(112, 0, (z0 + z1) / 2);
    const cz = (z0 + z1) / 2;
    if (t === 'pantry') { add(P.shelfBoard({ x: 130, y: 6, z: z0 + 2, w: 16, d: 4 })); add(P.jar({ x: 126, y: 6.8, z: z0 + 2, r: 1.4, h: 3.5, jam: 'orange' })); add(P.crate({ x: 132, y: 0, z: cz, w: 3.5, h: 3.5, d: 3.5 })); add(P.sausages({ x: 124, y: 16, z: cz, n: 4, len: 6 })); }
    if (t === 'feast') { add(P.table({ x: 126, y: 0, z: cz, w: 18, d: 10, h: 8 })); add(P.candle({ x: 126, y: 8, z: cz, r: 0.8, h: 3, light: true })); }
    if (t === 'library') { add(P.bookshelf({ x: 128, y: 0, z: z0 + 2.5, w: 16, h: 17, d: 5, shelves: 2, seed: 4 })); add(P.bookStack({ x: 126, y: 0, z: cz + 6, n: 3, w: 6, d: 4.5 })); }
    if (t === 'gallery') { add(P.painting({ x: 128, y: 4, z: z0, w: 7, h: 9 })); add(P.pedestal({ x: 128, y: 0, z: cz + 2 })); }
    if (t === 'throne') { add(P.pillar({ x: 136, y: 0, z: z0 + 4, r: 1.5, h: 18 })); add(P.torch({ x: 140, y: 7, z: cz, rotY: 3 })); add(P.window({ x: 126, y: 5, z: z0, w: 5, h: 10 })); }
    if (t === 'den') { add(P.rug({ x: 124, y: 0, z: cz, w: 9, d: 6 })); add(P.barrel({ x: 134, y: 0, z: cz - 6 })); add(P.candle({ x: 128, y: 0, z: cz + 6, r: 0.6, h: 2, light: true })); }
  });

  // ── collider overlay
  const colGroup = new THREE.Group(); colGroup.visible = q.get('c') === '1'; scene.add(colGroup);
  const lineMats = {
    box: new THREE.LineBasicMaterial({ color: '#3cff6a' }), cyl: new THREE.LineBasicMaterial({ color: '#3ad8ff' }),
    hz: new THREE.LineBasicMaterial({ color: '#ff3a3a' }), bounce: new THREE.LineBasicMaterial({ color: '#ff5ff0' }), crumbly: new THREE.LineBasicMaterial({ color: '#ffe23a' }),
  };
  const segs: Record<keyof typeof lineMats, number[]> = { box: [], cyl: [], hz: [], bounce: [], crumbly: [] };
  const boxEdges = (a: THREE.Vector3, b: THREE.Vector3, out: number[]) => {
    const c = [[a.x, a.y, a.z], [b.x, a.y, a.z], [b.x, a.y, b.z], [a.x, a.y, b.z], [a.x, b.y, a.z], [b.x, b.y, a.z], [b.x, b.y, b.z], [a.x, b.y, b.z]];
    for (const [i, j] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) out.push(...c[i], ...c[j]);
  };
  let nCols = 0, nHz = 0, nLights = 0;
  const tops = new THREE.Group(); colGroup.add(tops);
  for (const b of builts) {
    nLights += b.lights?.length ?? 0;
    for (const c of b.colliders) {
      nCols++;
      if (c.kind === 'box') {
        boxEdges(c.min, c.max, c.bounce ? segs.bounce : c.crumbly ? segs.crumbly : segs.box);
        const w = c.max.x - c.min.x, d = c.max.z - c.min.z;
        if (c.tag !== 'floor' && c.tag !== 'wall' && w > 0.6 && d > 0.6) { const h = hero((c.min.x + c.max.x) / 2, c.max.y, (c.min.z + c.max.z) / 2); scene.remove(h); h.scale.setScalar(0.5); tops.add(h); }
      } else {
        const out = segs.cyl, n = 20;
        for (let i = 0; i < n; i++) {
          const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
          for (const y of [c.y0, c.y1]) out.push(c.x + Math.cos(a0) * c.r, y, c.z + Math.sin(a0) * c.r, c.x + Math.cos(a1) * c.r, y, c.z + Math.sin(a1) * c.r);
        }
        for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2; out.push(c.x + Math.cos(a) * c.r, c.y0, c.z + Math.sin(a) * c.r, c.x + Math.cos(a) * c.r, c.y1, c.z + Math.sin(a) * c.r); }
        if (c.r > 0.45) { const h = hero(c.x, c.y1, c.z); scene.remove(h); h.scale.setScalar(0.5); tops.add(h); }
      }
    }
    for (const h of b.hazards ?? []) { nHz++; boxEdges(h.min, h.max, segs.hz); }
  }
  for (const k of Object.keys(segs) as (keyof typeof lineMats)[]) {
    if (!segs[k].length) continue;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(segs[k], 3));
    const ls = new THREE.LineSegments(g, lineMats[k]); ls.layers.set(LAYER_NO_OUTLINE); ls.renderOrder = 998; ls.frustumCulled = false;
    colGroup.add(ls);
  }
  const setXray = (on: boolean) => { for (const m of Object.values(lineMats)) { m.depthTest = !on; m.needsUpdate = true; } };

  // ── camera presets
  const presets: [string, [number, number, number], [number, number, number]][] = [
    ['overview', [10, 95, 135], [0, 0, -10]],
    ['wall decor', [-46, 18, -28], [-46, 8, -70]],
    ['bookshelf', [24, 20, -30], [24, 14, -68]],
    ['pantry row', [-40, 18, -26], [-40, 3, -45]],
    ['food row', [-25, 22, -4], [-20, 2, -24]],
    ['tables', [-20, 30, 40], [-22, 6, 0]],
    ['misc row', [-40, 18, 52], [-46, 2, 26]],
    ['throne & pools', [-30, 32, 88], [-30, 5, 46]],
    ['rooms', [60, 60, 0], [122, 6, 0]],
  ];
  const go = (i: number) => {
    const p = presets[Math.max(0, Math.min(presets.length - 1, i))];
    camera.position.set(...p[1]); controls.target.set(...p[2]); controls.update();
  };
  go(Number(q.get('p') ?? 1) - 1);
  const cam = q.get('cam'), tgt = q.get('tgt');
  if (cam) { const v = cam.split(',').map(Number); camera.position.set(v[0], v[1], v[2]); }
  if (tgt) { const v = tgt.split(',').map(Number); controls.target.set(v[0], v[1], v[2]); }
  controls.update();
  if (q.get('x') === '1') setXray(true);
  if (q.get('o') === '0') r3.outlines = false;

  let xray = q.get('x') === '1';
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'c') colGroup.visible = !colGroup.visible;
    else if (k === 'x') { xray = !xray; setXray(xray); }
    else if (k === 'o') r3.outlines = !r3.outlines;
    else if (k === 'l') for (const s of labels) s.visible = !s.visible;
    else if (k >= '1' && k <= '9') go(Number(k) - 1);
  });

  const resize = () => {
    r3.setSize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize); resize();

  let last = performance.now();
  let t = 0, fpsT = 0, frames = 0, fps = 0;
  const loop = () => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    t += dt; fpsT += dt; frames++;
    if (fpsT > 0.5) { fps = Math.round(frames / fpsT); fpsT = 0; frames = 0; }
    for (const b of builts) b.update?.(t, dt);
    controls.update();
    renderer.info.reset();
    r3.render(scene, camera);
    hud.innerHTML = `<b>World kit preview</b>  ${fps} fps\n` +
      `draw calls ${renderer.info.render.calls}  tris ${(renderer.info.render.triangles / 1000).toFixed(0)}k  (all passes)\n` +
      `props ${builts.length}  colliders ${nCols}  hazards ${nHz}  lights ${nLights}\n` +
      `[C] colliders ${colGroup.visible ? 'ON' : 'off'}  [X] x-ray ${xray ? 'ON' : 'off'}  [O] outlines ${r3.outlines ? 'ON' : 'off'}  [L] labels\n` +
      `[1-9] ${presets.map((p, i) => `${i + 1} ${p[0]}`).join(' · ')}\n` +
      `green box · cyan cyl · red hazard · pink bounce · yellow crumbly · orange = 0.95-tall hero`;
    requestAnimationFrame(loop);
  };
  loop();
  /** debug: render one frame at time `tt` (handy when the tab is in the background and rAF is throttled) */
  const frame = (tt: number) => { for (const b of builts) b.update?.(tt, 1 / 60); controls.update(); renderer.info.reset(); r3.render(scene, camera); };
  (window as unknown as { __preview: unknown }).__preview = { scene, camera, controls, builts, go, renderer, frame };
}

main().catch((e) => { hud.textContent = String(e?.stack ?? e); console.error(e); });

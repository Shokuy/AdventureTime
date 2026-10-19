import '@fontsource/rubik/900.css';
import '@fontsource/pangolin/400.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Renderer3D } from '../render';
import { LAYER_NO_OUTLINE, mat } from '../gfx';
import type { Built } from '../physics/types';
import { magicBookPortal } from '../world/portal';
import { createSpaghettiMonster, type SpagAnim } from '../models/spaghetti';

/*
 * Dev page: http://localhost:5173/portal-preview.html
 *  ?view=portal|spag|both   ?k=0..1 (fixed openness)   ?state=idle|lash|grab|hurt|dead   ?cam=x,y,z&tgt=x,y,z
 *  keys: O toggle book open/close · C colliders+trigger · SPACE pause · N next monster state · 1..4 camera presets
 */

const canvas = document.getElementById('view') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLDivElement;
const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'both';

async function main() {
  await Promise.all([document.fonts.load('900 40px Rubik'), document.fonts.load('400 40px Pangolin')]).catch(() => undefined);
  const r3 = new Renderer3D(canvas);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0e1a22');
  scene.fog = new THREE.Fog('#16262f', 50, 150);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.3, 500);
  camera.layers.enable(LAYER_NO_OUTLINE);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight('#cfe6ff', '#1a2a33', 1.0));
  const sun = new THREE.DirectionalLight('#d6e8ff', 2.0);
  sun.position.set(16, 40, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 120 });
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), mat('#6b4a3a'));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(60, 30, 1), mat('#3e3250'));
  wall.position.set(0, 15, -4.5); wall.receiveShadow = true; scene.add(wall);

  const builts: Built[] = [];
  const colGroup = new THREE.Group(); colGroup.visible = q.get('c') === '1'; scene.add(colGroup);
  const heroGeo = new THREE.CapsuleGeometry(0.3, 0.35, 4, 12).translate(0, 0.475, 0);
  const heroMat = new THREE.MeshToonMaterial({ color: '#ff8a2a' });
  const hero = (x: number, y: number, z: number) => { const m = new THREE.Mesh(heroGeo, heroMat); m.position.set(x, y, z); m.castShadow = true; scene.add(m); return m; };

  let portal: ReturnType<typeof magicBookPortal> | null = null;
  const px = view === 'both' ? -6 : 0;
  if (view !== 'spag') {
    portal = magicBookPortal({ x: px, y: 0, z: -1.5, rotY: parseFloat(q.get('rot') ?? '0') * Math.PI / 2, s: parseFloat(q.get('s') ?? '1') });
    scene.add(portal.obj); builts.push(portal);
    hero(px + 1.2, 1.2, -1.5 + 1.6);
    hero(px - 4.6, 0, 3);
    const fk = q.get('k');
    if (fk !== null) portal.open(parseFloat(fk), true);
    for (const c of portal.colliders) {
      if (c.kind === 'box') {
        const sz = new THREE.Vector3().subVectors(c.max, c.min);
        const m = new THREE.Mesh(new THREE.BoxGeometry(sz.x, sz.y, sz.z), new THREE.MeshBasicMaterial({ color: '#33ff66', wireframe: true }));
        m.position.copy(c.min).addScaledVector(sz, 0.5); m.userData.col = c; colGroup.add(m);
      } else {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(c.r, c.r, c.y1 - c.y0, 16), new THREE.MeshBasicMaterial({ color: '#33ccff', wireframe: true }));
        m.position.set(c.x, (c.y0 + c.y1) / 2, c.z); colGroup.add(m);
      }
    }
    const trig = new THREE.Mesh(new THREE.SphereGeometry(portal.radius, 24, 16), new THREE.MeshBasicMaterial({ color: '#ff3366', wireframe: true }));
    trig.position.copy(portal.pageCenter); colGroup.add(trig);
  }

  // monster
  let spag: ReturnType<typeof createSpaghettiMonster> | null = null;
  const states: SpagAnim['state'][] = ['idle', 'lash', 'grab', 'hurt', 'idle', 'lash', 'dead'];
  let si = 0, st = 0;
  const anim: SpagAnim = { state: (q.get('state') as SpagAnim['state']) ?? 'idle', lashDir: 0, p: 0, target: new THREE.Vector3(1.5, 0.8, 4.5), flash: 0, anger: parseFloat(q.get('anger') ?? '0.5') };
  const fixedState = q.get('state') !== null;
  const tipMarks: THREE.Mesh[] = [];
  const grabHero = hero(1.5, 0, 4.5);
  grabHero.visible = false;
  if (view !== 'portal') {
    spag = createSpaghettiMonster();
    spag.root.position.set(view === 'both' ? 8 : 0, 0, 2);
    scene.add(spag.root);
    for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff2266' })); m.layers.set(LAYER_NO_OUTLINE); colGroup.add(m); tipMarks.push(m); }
  }

  // camera
  const presets: Record<string, [number[], number[]]> = {
    '1': view === 'spag' ? [[0, 6, 16], [0, 1.5, 2]] : [[px, 7.5, 17], [px, 5.5, -1.5]],
    '2': [[px + 9, 5, 9], [px, 5, -1.5]],
    '3': [[px, 3, 7], [px, 6, -1.5]],
    '4': view === 'both' ? [[8, 9, 18], [8, 1, 2]] : [[0, 12, 14], [0, 1, 2]],
  };
  const setCam = (p: [number[], number[]]) => { camera.position.set(p[0][0], p[0][1], p[0][2]); controls.target.set(p[1][0], p[1][1], p[1][2]); };
  setCam(presets[q.get('p') ?? '1']);
  const cq = q.get('cam'), tq = q.get('tgt');
  if (cq && tq) { const c = cq.split(',').map(Number), t = tq.split(',').map(Number); camera.position.set(c[0], c[1], c[2]); controls.target.set(t[0], t[1], t[2]); }

  let openT = q.get('open') === '0' ? 0 : 1;
  let paused = false;
  if (portal && q.get('k') === null) portal.open(openT);
  addEventListener('keydown', (e) => {
    if (e.key === 'o' || e.key === 'O') { openT = openT ? 0 : 1; portal?.open(openT); }
    if (e.key === 'c' || e.key === 'C') colGroup.visible = !colGroup.visible;
    if (e.key === ' ') paused = !paused;
    if (e.key === 'n' || e.key === 'N') { si = (si + 1) % states.length; st = 0; }
    if (presets[e.key]) setCam(presets[e.key]);
  });
  const resize = () => { r3.setSize(innerWidth, innerHeight, devicePixelRatio); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  resize(); addEventListener('resize', resize);

  let t = 0, last = performance.now();
  const dbg = { portal, spag, anim, scene, camera, controls, r3, render: () => r3.render(scene, camera), setT: (v: number) => { t = v; }, pause: (v: boolean) => { paused = v; }, step: (dt: number) => tick(dt) };
  (window as unknown as { dbg: typeof dbg }).dbg = dbg;
  function tick(dt: number) {
    t += dt;
    for (const b of builts) b.update?.(t, dt);
    if (spag) {
      if (!fixedState) {
        st += dt;
        const s = states[si];
        const dur = s === 'idle' ? 2.5 : s === 'lash' ? 2.2 : s === 'grab' ? 2.6 : s === 'hurt' ? 0.8 : 3.5;
        if (st > dur) { si = (si + 1) % states.length; st = 0; if (states[si] === 'lash') anim.lashDir = (Math.random() - 0.5) * 2; }
        anim.state = s;
        anim.p = Math.min(1, st / dur);
        anim.flash = s === 'hurt' ? Math.max(0, 1 - st / 0.25) : 0;
      } else if (q.get('pp') !== null) {
        anim.p = parseFloat(q.get('pp') ?? '0');
        anim.lashDir = parseFloat(q.get('dir') ?? '0');
      } else if (anim.state !== 'idle' && anim.state !== 'dead') {
        st += dt;
        const dur = anim.state === 'hurt' ? 0.8 : 2.2;
        anim.p = (st % (dur + 0.6)) / dur;
        if (anim.p > 1) anim.p = 1;
      }
      grabHero.visible = anim.state === 'grab';
      if (anim.target) grabHero.position.copy(anim.target).add(spag.root.position).setY(spag.root.position.y + anim.target.y - 0.5);
      spag.update(dt, anim);
      const tips = spag.tips();
      tips.forEach((p, i) => { if (tipMarks[i]) tipMarks[i].position.copy(p); });
    }
  }
  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!paused) tick(dt);
    controls.update();
    const info = r3.renderer.info;
    info.autoReset = false; info.reset();
    r3.render(scene, camera);
    hud.textContent = `view=${view}  O open/close  C colliders  N next state  SPACE pause  1-4 cams\n` +
      (portal ? `pageCenter ${portal.pageCenter.toArray().map((v) => v.toFixed(2)).join(', ')}  r=${portal.radius}\n` : '') +
      (spag ? `monster: ${anim.state} p=${anim.p.toFixed(2)} lashDir=${anim.lashDir.toFixed(2)}\n` : '') +
      `calls ${info.render.calls} tris ${info.render.triangles}`;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
main();

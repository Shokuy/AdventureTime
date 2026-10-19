import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Renderer3D } from '../render';
import { mat, LAYER_NO_OUTLINE } from '../gfx';
import { createArtifact, type ArtifactKind } from '../models/artifacts';
import { createFood, createPlatter, PLATTER_TOP, type FoodKind } from '../models/food';
import { createGuard } from '../models/guard';
import { createHero } from '../models/hero';
import { drawFeather, drawCloak, drawSlingIcon, drawForkIcon, drawBerryHeart } from '../../art/props';
import { rrect, glow, OUT } from '../../art/draw';

/* Scratch page (dev only): http://localhost:5173/artifacts-preview.html?view=art|food|icons */

const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'art';
const spin = Number(params.get('spin') ?? '0.6');
const frozen = params.get('t');
const ui = document.getElementById('ui')!;
ui.innerHTML = ['art', 'food', 'icons'].map((v) => `<a href="?view=${v}">${v}</a>`).join('');

const canvas = document.getElementById('c') as HTMLCanvasElement;
const KINDS: ArtifactKind[] = ['dash', 'doubleJump', 'fork', 'sling', 'container'];

if (view === 'icons') runIcons(); else run3d();

function run3d() {
  const R = new Renderer3D(canvas);
  if (params.get('outline') === '0') R.outlines = false;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#2a1d33');
  scene.fog = new THREE.Fog('#2a1d33', 60, 200);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 400);
  camera.layers.enable(LAYER_NO_OUTLINE);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight('#e8d8ff', '#2a1e3a', 1.05));
  const sun = new THREE.DirectionalLight('#ffe2c0', 2.0);
  sun.position.set(6, 10, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 0.5, far: 40 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), mat('#6a4a5e'));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);

  const tickers: Array<(dt: number) => void> = [];
  const measured: Array<{ name: string; obj: THREE.Object3D }> = [];
  (window as unknown as { __measure: () => unknown }).__measure = () => measured.map(({ name, obj }) => {
    const box = new THREE.Box3();
    const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
    obj.updateWorldMatrix(true, true);
    obj.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh || !c.layers.isEnabled(0) || !c.visible) return;
      const g = m.geometry; if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      box.union(b);
    });
    const r = (v: number) => Math.round(v * 100) / 100;
    return { name, min: [r(box.min.x), r(box.min.y), r(box.min.z)], max: [r(box.max.x), r(box.max.y), r(box.max.z)] };
  });
  if (view === 'art') {
    const focus = params.get('focus');
    const kinds = focus ? [focus as ArtifactKind] : KINDS;
    kinds.forEach((k, i) => {
      const a = createArtifact(k);
      const holder = new THREE.Group();
      holder.position.set((i - (kinds.length - 1) / 2) * 1.7, 1.25, 0);
      holder.add(a.root);
      scene.add(holder);
      const light = new THREE.PointLight('#ffe9a0', 4, 6, 1.6);
      light.position.set(0, 0.5, 0.6);
      holder.add(light);
      // pedestal
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.45, 24), mat('#8a7aa0'));
      ped.position.set(holder.position.x, 0.225, 0); ped.castShadow = ped.receiveShadow = true;
      scene.add(ped);
      tickers.push((dt) => { a.update(dt); a.root.rotation.y += dt * spin; });
      measured.push({ name: k, obj: a.root });
    });
    const hero = createHero();
    hero.root.position.set(-((kinds.length - 1) / 2) * 1.7 - 1.2, 0, 0);
    scene.add(hero.root);
    hero.update(0.016, { state: 'idle', speed: 0, attack: null, weapon: 'sword', flash: 0, talk: 0, expr: 'happy', squash: 1 });
    camera.position.set(0, focus ? 2.3 : 2.6, focus ? 2.5 : 7.5);
    controls.target.set(0, 1.2, 0);
    const az = Number(params.get('az') ?? '0');
    if (az) { camera.position.set(Math.sin(az) * (focus ? 2.5 : 7.5), focus ? 2.3 : 2.6, Math.cos(az) * (focus ? 2.5 : 7.5)); }
  } else {
    const FK: FoodKind[] = ['drumstick', 'pie', 'ham', 'grapes', 'pudding', 'cakeSlice'];
    const focus = params.get('focus') as FoodKind | null;
    const list = focus ? [focus] : FK;
    list.forEach((k, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      const x = focus ? 0 : (col - 1) * 5.4, z = focus ? 0 : row * -4.6;
      const pl = createPlatter();
      pl.position.set(x, 0, z);
      scene.add(pl);
      const f = createFood(k);
      f.position.set(x, PLATTER_TOP, z);
      scene.add(f);
      measured.push({ name: k, obj: f }, { name: 'platter', obj: pl });
      const up = f.userData.update as ((dt: number) => void) | undefined;
      if (up) tickers.push(up);
      if (spin) tickers.push((dt) => { f.rotation.y += dt * spin * 0.5; });
    });
    const hero = createHero();
    hero.root.position.set(focus ? -3.4 : -8.6, 0, 0);
    if (focus) for (const sx of [-1, 1]) { const gd = createGuard('guard'); gd.root.position.set(sx * 2.9, 0, 0.9); gd.root.rotation.y = -sx * 0.6; scene.add(gd.root); tickers.push((dt) => gd.update(dt, { state: 'idle', speed: 0, flash: 0 })); }
    scene.add(hero.root);
    hero.update(0.016, { state: 'idle', speed: 0, attack: null, weapon: 'sword', flash: 0, talk: 0, expr: 'happy', squash: 1 });
    camera.position.set(0, 7, focus ? 7 : 15);
    controls.target.set(0, 1, focus ? 0 : -2.3);
    sun.shadow.camera.left = -20; sun.shadow.camera.right = 20; sun.shadow.camera.top = 20; sun.shadow.camera.bottom = -20;
  }
  const cp = params.get('cam');
  if (cp) { const [x, y, z, tx, ty, tz] = cp.split(',').map(Number); camera.position.set(x, y, z); controls.target.set(tx, ty, tz); }
  controls.update();

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    R.setSize(w, h, window.devicePixelRatio);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  let last = performance.now();
  if (frozen) { const tt = Number(frozen); for (const f of tickers) f(tt); }
  function loop(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!frozen) for (const f of tickers) f(dt);
    controls.update();
    R.render(scene, camera);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

function runIcons() {
  const ctx = canvas.getContext('2d')!;
  const draws: Record<ArtifactKind, (x: number, y: number, s: number, t: number) => void> = {
    doubleJump: (x, y, s, t) => drawFeather(ctx, x, y, s, t),
    dash: (x, y, s, t) => drawCloak(ctx, x, y, s, t),
    fork: (x, y, s) => drawForkIcon(ctx, x, y, s),
    sling: (x, y, s) => drawSlingIcon(ctx, x, y, s),
    container: (x, y, s, t) => drawBerryHeart(ctx, x, y, s, t, true),
  };
  const popupScale: Record<ArtifactKind, number> = { doubleJump: 2.6, dash: 2.8, fork: 3, sling: 2.6, container: 2.6 };
  const one = params.get('icon') as ArtifactKind | null;
  function frame(now: number) {
    const t = frozen ? Number(frozen) : now / 1000;
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = window.devicePixelRatio;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#3a2a30'; ctx.fillRect(0, 0, w, h);
    const kinds = one ? [one] : KINDS;
    const sc = (one ? 1 : 0.5) * Number(params.get('zoom') ?? '1');
    kinds.forEach((k, i) => {
      const cx = one ? w / 2 : 190 + (i % 3) * 360, cy = one ? 260 + Number(params.get('dy') ?? '0') : 130 + Math.floor(i / 3) * 210;
      ctx.save();
      ctx.translate(cx, cy); ctx.scale(sc, sc);
      rrect(ctx, -330, -200, 660, 360, 30, '#fff7e6', 6);
      rrect(ctx, -330, -200, 660, 60, 30, '#ffd34a', 0);
      ctx.fillStyle = '#ffd34a'; ctx.fillRect(-327, -170, 654, 30);
      glow(ctx, 0, -60, 120, '#ffe9a0', 0.6);
      draws[k](0, -60 + Math.sin(t * 3) * 5, popupScale[k], t);
      ctx.fillStyle = OUT; ctx.font = '900 40px Rubik, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(k, 0, 40);
      ctx.restore();
    });
    // world-size + HUD-size strip
    const y0 = one ? 560 : 560;
    rrect(ctx, 20, y0 - 50, w - 40, 170, 16, '#5a4a40', 0);
    KINDS.forEach((k, i) => {
      const x = 90 + i * 120;
      draws[k](x, y0, k === 'fork' ? 1.5 : 1.3, t);
      ctx.fillStyle = 'rgba(30,15,15,0.55)'; rrect(ctx, x - 23, y0 + 52, 46, 40, 14, 'rgba(30,15,15,0.55)', 0);
      const hs = k === 'doubleJump' ? 0.6 : k === 'dash' ? 0.7 : k === 'fork' ? 0.95 : 0.85;
      draws[k](x, y0 + 72, hs, t);
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
